import { unzipSync } from 'fflate';
import type { Chapter } from '../../types';
import { detectTextChapters, MAX_TEXT_CHARS, type ImportProgress, type ParsedBook } from '../importers';

type Entry = { path: string; mediaType: string; properties: string };
type Link = { path: string; fragment: string; title: string; level: number };
type Extracted = { text: string; anchors: Map<string, number>; headings: Array<{ title: string; offset: number; level: number }> };

function elements(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((node) => node.localName === localName);
}

function children(root: Element, localName: string): Element[] {
  return Array.from(root.children).filter((node) => node.localName === localName);
}

function parseXml(source: string): Document {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('EPUB 的目录或内容结构损坏，无法读取。');
  return document;
}

function cleanPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function decodePart(part: string): string {
  try { return decodeURIComponent(part); } catch { return part; }
}

function resolveHref(base: string, href: string): { path: string; fragment: string } | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return null;
  const hash = href.indexOf('#');
  const rawPath = (hash === -1 ? href : href.slice(0, hash)).split('?')[0];
  const fragment = hash === -1 ? '' : decodePart(href.slice(hash + 1));
  const path = rawPath
    ? cleanPath(rawPath.startsWith('/') ? decodePart(rawPath) : `${base.slice(0, base.lastIndexOf('/') + 1)}${decodePart(rawPath)}`)
    : base;
  return { path, fragment };
}

/** Extract inert text only. No EPUB HTML, styles, links, or scripts enter the live page. */
function extractDocument(source: string): Extracted {
  let document = new DOMParser().parseFromString(source, 'application/xhtml+xml');
  if (document.getElementsByTagName('parsererror').length) document = new DOMParser().parseFromString(source, 'text/html');
  const root = elements(document, 'body')[0] ?? document.documentElement;
  const anchors = new Map<string, number>();
  const headings: Extracted['headings'] = [];
  const parts: string[] = [];
  let outputLength = 0;
  const append = (text: string) => {
    if (!text) return;
    parts.push(text);
    outputLength += text.length;
  };
  // Inspect only the suffix needed by whitespace and heading rules; repeatedly
  // scanning the growing chapter string makes many-paragraph EPUBs quadratic.
  const tail = (length: number): string => {
    const selected: string[] = [];
    let remaining = length;
    for (let index = parts.length - 1; index >= 0 && remaining > 0; index--) {
      const part = parts[index];
      selected.push(part.slice(-remaining));
      remaining -= part.length;
    }
    return selected.reverse().join('');
  };
  const blockTags = new Set(['p', 'div', 'section', 'article', 'aside', 'blockquote', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'table', 'tr', 'figure', 'figcaption', 'hr']);
  const ignoredTags = new Set(['script', 'style', 'head', 'noscript', 'svg', 'math', 'audio', 'video', 'iframe', 'object']);
  const newline = () => {
    while (parts.length) {
      const last = parts[parts.length - 1];
      let end = last.length;
      while (end > 0 && (last[end - 1] === ' ' || last[end - 1] === '\t')) end--;
      if (end === last.length) break;
      outputLength -= last.length - end;
      if (end) { parts[parts.length - 1] = last.slice(0, end); break; }
      parts.pop();
    }
    const ending = tail(2);
    if (outputLength && ending !== '\n\n') append(ending.endsWith('\n') ? '\n' : '\n\n');
  };
  const visit = (node: Node, preformatted = false): void => {
    if (node.nodeType === 3) {
      let text = node.textContent ?? '';
      if (!preformatted) {
        text = text.replace(/[\t\r\n\f ]+/g, ' ');
        if (!outputLength || /\s$/u.test(tail(1))) text = text.replace(/^ /, '');
      }
      append(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.localName.toLowerCase();
    if (ignoredTags.has(tag) || element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return;
    if (tag === 'nav' && /(?:^|\s)toc(?:\s|$)/.test(element.getAttribute('epub:type') ?? '')) return;
    if (blockTags.has(tag)) newline();
    const anchor = element.getAttribute('id') || element.getAttribute('name');
    if (anchor) anchors.set(anchor, outputLength);
    const headingStart = outputLength;
    if (tag === 'br') { append('\n'); return; }
    for (const child of Array.from(node.childNodes)) visit(child, preformatted || tag === 'pre');
    if (/^h[1-6]$/.test(tag)) {
      const title = tail(outputLength - headingStart).trim();
      if (title && title.length <= 120) headings.push({ title, offset: headingStart, level: Number(tag[1]) - 1 });
    }
    if (blockTags.has(tag)) newline();
  };
  visit(root);
  const output = parts.join('');
  const leading = output.length - output.trimStart().length;
  const text = output.trim();
  for (const [key, value] of anchors) anchors.set(key, Math.max(0, Math.min(text.length, value - leading)));
  for (const heading of headings) heading.offset = Math.max(0, heading.offset - leading);
  return { text, anchors, headings };
}

function readNav(source: string, navPath: string): Link[] {
  const document = parseXml(source);
  const navs = elements(document, 'nav');
  const nav = navs.find((node) => /(?:^|\s)toc(?:\s|$)/.test(node.getAttribute('epub:type') ?? node.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '') || node.getAttribute('role') === 'doc-toc') ?? navs[0];
  if (!nav) return [];
  const links: Link[] = [];
  const walkList = (list: Element, level: number) => {
    for (const li of children(list, 'li')) {
      // A span-only group has no destination of its own. Looking through its
      // descendants steals the first child link and assigns it the wrong level.
      const anchor = children(li, 'a')[0];
      if (anchor) {
        const target = resolveHref(navPath, anchor.getAttribute('href') ?? '');
        const title = anchor.textContent?.replace(/\s+/g, ' ').trim();
        if (target && title) links.push({ ...target, title, level });
      }
      for (const nested of children(li, 'ol')) walkList(nested, level + 1);
    }
  };
  const list = children(nav, 'ol')[0] ?? elements(nav, 'ol')[0];
  if (list) walkList(list, 0);
  return links;
}

function readNcx(source: string, ncxPath: string): Link[] {
  const document = parseXml(source);
  const map = elements(document, 'navMap')[0];
  const links: Link[] = [];
  if (!map) return links;
  const walk = (point: Element, level: number) => {
    const content = children(point, 'content')[0];
    const label = children(point, 'navLabel')[0];
    const title = label?.textContent?.replace(/\s+/g, ' ').trim();
    const target = content ? resolveHref(ncxPath, content.getAttribute('src') ?? '') : null;
    if (target && title) links.push({ ...target, title, level });
    for (const child of children(point, 'navPoint')) walk(child, level + 1);
  };
  for (const point of children(map, 'navPoint')) walk(point, 0);
  return links;
}

export async function parseEpub(bytes: Uint8Array, onProgress: ImportProgress): Promise<ParsedBook> {
  onProgress('正在解析 EPUB 结构…');
  let files: Record<string, Uint8Array>;
  try {
    let totalSize = 0;
    let entryCount = 0;
    files = unzipSync(bytes, {
      filter(entry) {
        if (++entryCount > 25_000) throw new Error('EPUB 内部文件过多。');
        if (!/\.(?:xml|opf|ncx|xhtml|html|htm)$/i.test(entry.name)) return false;
        totalSize += entry.originalSize;
        if (entry.originalSize > 20 * 1024 * 1024 || totalSize > 96 * 1024 * 1024) throw new Error('EPUB 解压后的文本体积过大。');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('EPUB')) throw error;
    throw new Error('无法解压 EPUB，请确认文件完整且未加密。');
  }
  const normalizedFiles: Record<string, Uint8Array> = {};
  for (const [path, value] of Object.entries(files)) normalizedFiles[cleanPath(path)] = value;
  const read = (path: string) => {
    const content = normalizedFiles[path];
    if (!content) throw new Error('EPUB 缺少目录或正文文件，无法完整读取。');
    return new TextDecoder('utf-8').decode(content);
  };
  const container = parseXml(read('META-INF/container.xml'));
  const rootFile = elements(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!rootFile) throw new Error('EPUB 没有有效的内容清单。');
  const packagePath = cleanPath(decodePart(rootFile));
  const packageDocument = parseXml(read(packagePath));
  const metadata = elements(packageDocument, 'metadata')[0];
  const title = metadata ? elements(metadata, 'title')[0]?.textContent?.trim() : undefined;
  const manifest = new Map<string, Entry>();
  for (const item of elements(packageDocument, 'item')) {
    const id = item.getAttribute('id');
    const target = resolveHref(packagePath, item.getAttribute('href') ?? '');
    if (id && target) manifest.set(id, { path: target.path, mediaType: item.getAttribute('media-type') ?? '', properties: item.getAttribute('properties') ?? '' });
  }
  const spine = elements(packageDocument, 'spine')[0];
  if (!spine) throw new Error('EPUB 没有正文阅读顺序。');
  const order = children(spine, 'itemref').filter((item) => item.getAttribute('linear') !== 'no').map((item) => {
    const entry = manifest.get(item.getAttribute('idref') ?? '');
    if (!entry) throw new Error('EPUB 正文清单缺少章节，无法完整读取。');
    return entry;
  });
  if (!order.length) throw new Error('EPUB 没有可读取的正文。');

  let text = '';
  const locations = new Map<string, { offset: number; anchors: Map<string, number> }>();
  const headings: Chapter[] = [];
  for (let index = 0; index < order.length; index++) {
    const entry = order[index];
    onProgress(`正在读取 EPUB 内容 ${index + 1}/${order.length}…`);
    const extracted = extractDocument(read(entry.path));
    if (text && extracted.text) text += '\n\n';
    const offset = text.length;
    locations.set(entry.path, { offset, anchors: extracted.anchors });
    for (const heading of extracted.headings) headings.push({ ...heading, id: '', offset: offset + heading.offset });
    text += extracted.text;
    if (text.length > MAX_TEXT_CHARS) throw new Error('EPUB 正文过长，请拆分文件后导入。');
    if (index % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const warnings: string[] = [];
  const nav = Array.from(manifest.values()).find((entry) => entry.properties.split(/\s+/).includes('nav'));
  const ncx = manifest.get(spine.getAttribute('toc') ?? '') ?? Array.from(manifest.values()).find((entry) => entry.mediaType === 'application/x-dtbncx+xml');
  let links: Link[] = [];
  try {
    if (nav) links = readNav(read(nav.path), nav.path);
    if (!links.length && ncx) links = readNcx(read(ncx.path), ncx.path);
  } catch {
    warnings.push('目录文件无法解析，已尝试使用正文标题定位。');
  }
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const location = locations.get(link.path);
    if (!location) continue;
    const offset = location.offset + (location.anchors.get(link.fragment) ?? 0);
    const key = `${offset}:${link.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chapters.push({ id: '', title: link.title, offset, level: link.level });
  }
  let selected = chapters.length ? chapters : headings.length ? headings : detectTextChapters(text);
  selected = selected.filter((chapter) => chapter.offset < text.length).sort((a, b) => a.offset - b.offset);
  const minimumLevel = selected.length ? Math.min(...selected.map((chapter) => chapter.level)) : 0;
  selected = selected.map((chapter, index) => ({ ...chapter, id: `chapter_${index + 1}`, level: Math.max(0, chapter.level - minimumLevel) }));
  return { text, chapters: selected, title, warnings };
}
