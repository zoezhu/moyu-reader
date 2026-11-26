import type { Book, BookFormat, Chapter } from '../types';

export type ImportProgress = (message: string) => void;
export interface ParsedBook {
  text: string;
  chapters: Chapter[];
  title?: string;
  warnings: string[];
}

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_TEXT_CHARS = 10_000_000;

/** Chapter locations always refer to the unchanged decoded source string. */
export function detectTextChapters(text: string): Chapter[] {
  const candidates: Array<Chapter & { end: number; volume: boolean }> = [];
  const lines = /[^\r\n]+/g;
  let match: RegExpExecArray | null;
  while ((match = lines.exec(text))) {
    const raw = match[0];
    const title = raw.trim();
    if (!title || title.length > 80 || /[。！？!?；;]/u.test(title)) continue;
    // Dotted TOC rows and prose sentences are not chapter boundaries.
    if (/(?:\.{2,}|…{2,}|·{3,})\s*\d*\s*$/u.test(title)) continue;
    const chinese = /^第[零〇一二三四五六七八九十百千万两\d０-９]+[章回卷部篇节集](?:[\s　:：、.\-—].{0,64}|[^，,。！？；;]{0,28})?$/u.test(title);
    const english = /^(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+)(?:\s|[.:\-–—]|$).{0,64}$/iu.test(title);
    const special = /^(?:序章|楔子|引子|序言|前言|后记|尾声|终章|番外)(?:[\s　:：、\-—].{0,40})?$/u.test(title);
    if (!chinese && !english && !special) continue;
    const leading = raw.length - raw.trimStart().length;
    candidates.push({
      id: '', title, offset: match.index + leading, end: match.index + raw.length,
      level: 0,
      volume: /^第[^章回节集]+[卷部篇]/u.test(title) || /^(?:part|book)\s/iu.test(title),
    });
  }

  const lastTitle = new Map<string, number>();
  for (const candidate of candidates) lastTitle.set(candidate.title.toLocaleLowerCase(), candidate.offset);
  const filtered = candidates.filter((candidate, index) => {
    if (lastTitle.get(candidate.title.toLocaleLowerCase()) === candidate.offset) return true;
    const next = candidates[index + 1];
    const previous = candidates[index - 1];
    const clustered = (next && next.offset - candidate.end < 100) || (previous && candidate.offset - previous.end < 100);
    const nearContents = /(?:目\s*录|contents)/iu.test(text.slice(Math.max(0, candidate.offset - 250), candidate.offset));
    return !clustered && !nearContents;
  });
  const hasVolumes = filtered.some((chapter) => chapter.volume);
  return filtered.map((chapter, index) => ({
    id: `chapter_${index + 1}`,
    title: chapter.title,
    offset: chapter.offset,
    level: hasVolumes && !chapter.volume ? 1 : 0,
  }));
}

function readFile(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('无法读取这个文件，请重新选择。'));
    reader.readAsArrayBuffer(file);
  });
}

function decodePlainText(bytes: Uint8Array): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      try {
        text = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
        warnings.push('文件按 GB18030 编码读取。');
      } catch {
        throw new Error('无法识别文本编码，请将文件另存为 UTF-8 后导入。');
      }
    }
  }
  const controls = text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g)?.length ?? 0;
  if (text.includes('\u0000') || controls > Math.max(2, text.length * 0.005) || /^(?:%PDF-|PK\u0003\u0004)/.test(text)) {
    throw new Error('这个文件不是可读取的纯文本，请选择 TXT、EPUB 或 PDF 文件。');
  }
  return { text, warnings };
}

export async function importBook(file: File, onProgress: ImportProgress = () => {}): Promise<Book> {
  if (!file.size) throw new Error('文件为空，请选择有内容的文件。');
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 100 MB，请选择较小的文件。');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !['txt', 'epub', 'pdf'].includes(extension)) {
    throw new Error('暂时支持 TXT、EPUB 和 PDF 格式。');
  }
  const format = extension as BookFormat;
  onProgress('正在读取本地文件…');
  const bytes = new Uint8Array(await readFile(file));
  let parsed: ParsedBook;
  if (format === 'txt') {
    const decoded = decodePlainText(bytes);
    if (decoded.text.length > MAX_TEXT_CHARS) throw new Error('文本超过 1,000 万字符，请按卷拆分后导入。');
    parsed = { ...decoded, chapters: detectTextChapters(decoded.text) };
  } else if (format === 'epub') {
    const { parseEpub } = await import('./importers/epub');
    parsed = await parseEpub(bytes, onProgress);
  } else {
    const { parsePdf } = await import('./importers/pdf');
    parsed = await parsePdf(bytes, onProgress);
  }
  if (!parsed.text.trim()) throw new Error('没有找到可读取的文字。');
  if (parsed.text.length > MAX_TEXT_CHARS) throw new Error('提取出的文本超过 1,000 万字符，请按卷拆分后导入。');
  const id = globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  onProgress('本地解析完成。');
  return {
    id,
    name: parsed.title || file.name.replace(/\.(txt|epub|pdf)$/i, ''),
    alias: `response_${id.replace(/-/g, '').slice(0, 8)}.json`,
    format,
    text: parsed.text,
    chapters: parsed.chapters,
    importedAt: Date.now(),
    size: file.size,
    warnings: parsed.warnings,
  };
}
