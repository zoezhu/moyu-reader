import type { Chapter } from '../../types';
import { detectTextChapters, MAX_TEXT_CHARS, type ImportProgress, type ParsedBook } from '../importers';

export async function parsePdf(bytes: Uint8Array, onProgress: ImportProgress): Promise<ParsedBook> {
  onProgress('正在加载本地 PDF 解析器…');
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const assetBase = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  let document: Awaited<typeof task.promise> | undefined;
  try {
    document = await task.promise;
    if (document.numPages > 10_000) throw new Error('PDF 超过 10,000 页，请拆分后导入。');
    let text = '';
    const pageOffsets: number[] = [];
    let emptyPages = 0;
    for (let number = 1; number <= document.numPages; number++) {
      onProgress(`正在提取 PDF 文字 ${number}/${document.numPages} 页…`);
      const page = await document.getPage(number);
      const content = await page.getTextContent({ disableNormalization: true });
      let pageText = '';
      let previous: { right: number; baseline: number; height: number; hasEOL: boolean } | undefined;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const x = item.transform[4];
        const baseline = item.transform[5];
        const height = Math.abs(item.height || item.transform[3] || 12);
        if (previous && pageText && !pageText.endsWith('\n')) {
          if (Math.abs(baseline - previous.baseline) > Math.max(height, previous.height) * 0.5) pageText += '\n';
          else if (x - previous.right > Math.max(height, previous.height) * 0.2 && !/\s$/u.test(pageText) && !/^\s/u.test(item.str)) pageText += ' ';
        }
        pageText += item.str;
        if (item.hasEOL && !pageText.endsWith('\n')) pageText += '\n';
        previous = { right: x + item.width, baseline, height, hasEOL: item.hasEOL };
      }
      pageText = pageText.trim();
      if (text && pageText) text += '\n\n';
      pageOffsets.push(text.length);
      if (!pageText) emptyPages++;
      text += pageText;
      page.cleanup();
      if (text.length > MAX_TEXT_CHARS) throw new Error('PDF 提取出的文字过长，请拆分后导入。');
      if (number % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!text.trim()) throw new Error('这个 PDF 没有可提取的文字，可能是扫描版。请先进行 OCR 文字识别，再导入识别后的 PDF 或 TXT。');

    const chapters: Chapter[] = [];
    const warnings: string[] = [];
    type Outline = Awaited<ReturnType<typeof document.getOutline>>;
    let outline: Outline | null = null;
    try { outline = await document.getOutline(); }
    catch { warnings.push('PDF 书签无法读取，已尝试从正文标题建立目录。'); }
    type OutlineItem = NonNullable<Outline>[number];
    const walk = async (items: OutlineItem[], level: number): Promise<void> => {
      for (const item of items) {
        if (chapters.length > 5_000) return;
        try {
          const destination = typeof item.dest === 'string' ? await document!.getDestination(item.dest) : item.dest;
          if (Array.isArray(destination) && destination.length) {
            const pageRef = destination[0];
            const page = typeof pageRef === 'number' ? pageRef : await document!.getPageIndex(pageRef);
            if (page >= 0 && page < pageOffsets.length && item.title.trim()) {
              const title = item.title.trim();
              const pageText = text.slice(pageOffsets[page], pageOffsets[page + 1] ?? text.length);
              const headingPosition = pageText.indexOf(title);
              chapters.push({ id: '', title, offset: pageOffsets[page] + Math.max(0, headingPosition), level });
            }
          }
        } catch { /* A broken bookmark should not discard readable page text. */ }
        if (item.items?.length) await walk(item.items, level + 1);
      }
    };
    if (outline) await walk(outline, 0);
    const selected = (chapters.length ? chapters : detectTextChapters(text)).sort((a, b) => a.offset - b.offset).map((chapter, index) => ({ ...chapter, id: `chapter_${index + 1}` }));
    if (emptyPages) warnings.push(`${emptyPages} 页未提取到文字；空白页或扫描图片中的内容不会进入正文。`);
    warnings.push('PDF 按可提取的文本顺序读取；复杂多栏排版可能需要校对顺序。');
    return { text, chapters: selected, warnings };
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('这个 PDF 需要密码。请先解锁并保存副本，再导入。');
    if (error instanceof Error && error.name === 'InvalidPDFException') throw new Error('PDF 文件损坏或格式无效，请重新导出后导入。');
    throw error;
  } finally {
    if (document) await document.destroy();
    else await task.destroy();
  }
}
