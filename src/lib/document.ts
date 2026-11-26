import templateData from '../data/config-template.json';
import type { Book, Chapter, DisplayFormat, DocumentModel, ParkingZone, ReaderSettings, ReadingSection, ReadingSlot, TextChunk } from '../types';
import { formatDocument } from './format-document';

type JsonObject = Record<string, unknown>;
interface Configuration extends JsonObject {
  input_schema?: { properties?: Record<string, JsonObject>; required?: unknown; type?: unknown };
}

// JSON imports infer a union with hundreds of mutually-exclusive optional property names.
// The reference response has already been validated as JSON; narrow it to the shared schema here.
const configurations = templateData.data.list as unknown as Configuration[];
const INDENT = '      ';
const CONTENT_MARKER = '__JSON_WORKBENCH_CONTENT_SLOT_74b8__';
const sentenceEnd = /[。！？!?；;\n]/u;
const whitespace = /\s/u;

function integer(value: number | undefined, fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value!))) : fallback;
}

function hashBook(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}

/** Stable across refreshes and independent of the current rendered window. */
function plannedValue(seed: number, index: number, salt: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

function safeBoundary(text: string, offset: number): number {
  const bounded = Math.min(text.length, Math.max(0, Math.floor(offset)));
  if (bounded > 0 && bounded < text.length) {
    const before = text.charCodeAt(bounded - 1);
    const after = text.charCodeAt(bounded);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return bounded - 1;
  }
  return bounded;
}

function orderedChapters(book: Book): Chapter[] {
  const ordered = book.chapters
    .filter((chapter) => Number.isFinite(chapter.offset) && chapter.offset >= 0 && chapter.offset < book.text.length)
    .map((chapter) => ({ ...chapter, offset: safeBoundary(book.text, chapter.offset) }))
    .sort((a, b) => a.offset - b.offset || a.level - b.level);
  return ordered.filter((chapter, index) => index === 0 || chapter.offset !== ordered[index - 1].offset);
}

/** Slice without deleting, normalising or rewriting even one source character. Offsets are UTF-16 offsets. */
export function chunkBook(book: Book, targetSize?: number): TextChunk[] {
  const text = book.text;
  if (!text.length) return [];
  const fixedTarget = targetSize === undefined ? undefined : integer(targetSize, 80, 16, 500);
  const seed = hashBook(book.id);
  const chapters = orderedChapters(book);
  const boundaries = [...new Set([0, ...chapters.map((chapter) => chapter.offset), text.length])].sort((a, b) => a - b);
  const chunks: TextChunk[] = [];
  let chapterCursor = -1;

  for (let region = 0; region < boundaries.length - 1; region++) {
    let start = boundaries[region];
    const regionEnd = boundaries[region + 1];
    while (start < regionEnd) {
      while (chapterCursor + 1 < chapters.length && chapters[chapterCursor + 1].offset <= start) chapterCursor++;
      const target = fixedTarget ?? (80 + plannedValue(seed, chunks.length, 0x54e1729b) % 81);
      const minimum = fixedTarget === undefined ? Math.max(80, Math.floor(target * 0.75)) : Math.max(8, Math.floor(target * 0.6));
      const maximum = fixedTarget === undefined ? Math.min(180, Math.ceil(target * 1.2)) : Math.ceil(target * 1.4);
      let cursor = start;
      let count = 0;
      let targetEnd = start;
      let sentenceCandidate: { offset: number; distance: number; count: number } | undefined;
      let paragraphCandidate: { offset: number; distance: number; count: number } | undefined;
      let wordCandidate: { offset: number; distance: number; count: number } | undefined;

      while (cursor < regionEnd && count < maximum) {
        const point = text.codePointAt(cursor)!;
        const character = String.fromCodePoint(point);
        cursor += character.length;
        count++;
        if (count <= target) targetEnd = cursor;
        if (count >= minimum) {
          const candidate = { offset: cursor, distance: Math.abs(count - target), count };
          // Later boundaries win equal-distance ties, matching the original sort.
          if (character === '\n' && /^(?:[ \t]*\r?\n)/u.test(text.slice(cursor, cursor + 32))
            && (!paragraphCandidate || candidate.distance <= paragraphCandidate.distance)) paragraphCandidate = candidate;
          if (sentenceEnd.test(character) || (character === '.' && (cursor === regionEnd || whitespace.test(text[cursor])))) {
            if (!sentenceCandidate || candidate.distance <= sentenceCandidate.distance) sentenceCandidate = candidate;
          } else if (whitespace.test(character) || /[，,：:]/u.test(character)) {
            if (!wordCandidate || candidate.distance <= wordCandidate.distance) wordCandidate = candidate;
          }
        }
      }

      let end: number;
      if (cursor === regionEnd) {
        end = regionEnd;
      } else {
        const candidate = fixedTarget === undefined && paragraphCandidate
          ? paragraphCandidate : sentenceCandidate ?? wordCandidate;
        end = candidate?.offset ?? targetEnd;
        // Keep separators with their paragraph where possible. Their code points
        // count towards the same hard limit, including long runs of blank lines.
        // Reuse the scan's code-point count instead of allocating another array
        // for every source character in every reading block.
        let length = fixedTarget === undefined ? (candidate?.count ?? target) : 0;
        while (end < regionEnd && (fixedTarget !== undefined || length < 180)) {
          const character = String.fromCodePoint(text.codePointAt(end)!);
          if (!whitespace.test(character)) break;
          end += character.length;
          length++;
        }
      }
      end = safeBoundary(text, end);
      if (end <= start) end = start + String.fromCodePoint(text.codePointAt(start)!).length;
      chunks.push({
        index: chunks.length,
        start,
        end,
        text: text.slice(start, end),
        ...(chapterCursor >= 0 ? { chapterId: chapters[chapterCursor].id } : {}),
      });
      start = end;
    }
  }
  return chunks;
}

/** Binary search stays cheap even for very long books. At a boundary, choose the following chunk. */
export function findChunkAtOffset(chunks: TextChunk[], offset: number): number {
  if (!chunks.length) return -1;
  const target = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  let low = 0;
  let high = chunks.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (chunks[middle].end <= target) low = middle + 1;
    else if (chunks[middle].start > target) high = middle - 1;
    else return middle;
  }
  return Math.min(chunks.length - 1, Math.max(0, low));
}

/** Build chapter navigation without omitting text before the first heading. */
export function getReadingSections(book: Book, chunks: TextChunk[]): ReadingSection[] {
  const chapters = orderedChapters(book);
  if (!chapters.length || !chunks.length) return [];
  const starts: Chapter[] = [...chapters];
  if (chapters[0].offset > 0) {
    let id = `${book.id}:file-start`;
    while (chapters.some(chapter => chapter.id === id)) id += ':start';
    // The preamble is a sibling of the top-level chapters, not their child.
    const rootLevel = chapters.reduce((minimum, chapter) =>
      Number.isInteger(chapter.level) && chapter.level >= 0 ? Math.min(minimum, chapter.level) : minimum, Infinity);
    starts.unshift({ id, title: '文件开头', offset: 0, level: Number.isFinite(rootLevel) ? rootLevel : 0 });
  }
  return starts.map((chapter, index) => {
    const endOffset = starts[index + 1]?.offset ?? book.text.length;
    return {
      ...chapter,
      startChunk: findChunkAtOffset(chunks, chapter.offset),
      endChunk: index + 1 < starts.length ? findChunkAtOffset(chunks, endOffset) : chunks.length,
      endOffset,
    };
  });
}

function renderRecord(record: Configuration): string {
  return JSON.stringify(record, null, 2).split('\n').map((line) => INDENT + line).join('\n');
}

const pureRecords = configurations.map((record) => {
  const text = renderRecord(record);
  return { text, lineCount: text.split('\n').length };
});

interface CarrierTemplate {
  before: string;
  after: string;
  lineIndex: number;
  lineCount: number;
}

const carrierRecords = configurations
  .filter((record) => record.input_schema?.properties?.prompt)
  .sort((a, b) => {
    const rank = (record: Configuration) => record.id === '114761' ? 0 : record.id === '114770' ? 1 : record.input_schema!.properties!.prompt.default === '' ? 2 : 3;
    return rank(a) - rank(b);
  });

function compactParameter(source: JsonObject): JsonObject {
  const value: JsonObject = {};
  for (const key of ['type', 'default', 'enum', 'minItems', 'maxItems', 'minimum', 'maximum']) {
    if (!(key in source)) continue;
    // Retain the real constraints, but avoid making each small carrier another
    // multi-screen documentation block.
    if (key === 'default' && typeof source[key] === 'string' && source[key].length > 160) continue;
    value[key] = source[key];
  }
  return value;
}

function compactCarrier(record: Configuration): string {
  const schema = record.input_schema!;
  const properties = schema.properties!;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === 'string' && name in properties)
    : [];
  const names = new Set(['prompt', ...required]);
  for (const name of ['ratio', 'resolution', 'size', 'image_list', 'image_url', 'video_duration']) {
    if (names.size >= Math.max(4, required.length)) break;
    if (name in properties) names.add(name);
  }
  const identity = ['id', 'config_key', 'config_type']
    .filter(key => key in record).map(key => JSON.stringify(key) + ': ' + JSON.stringify(record[key]));
  const execution = ['scope', 'timeout_s', 'status']
    .filter(key => key in record).map(key => JSON.stringify(key) + ': ' + JSON.stringify(record[key])).join(', ');
  const promptDescription = properties.prompt.description ?? '提示词';
  const otherParameters = [...names].filter(name => name !== 'prompt');
  const lines = [
    '{',
    ...identity.map(field => '  ' + field + ','),
    '  "input_schema": {',
    '    "properties": { "prompt": {',
    '        "default": ' + JSON.stringify(CONTENT_MARKER) + ',',
    '        "description": ' + JSON.stringify(promptDescription) + ', "type": "string"',
    '      }' + (otherParameters.length ? ',' : ''),
    ...(otherParameters.length ? ['      ' + otherParameters.map(name =>
      JSON.stringify(name) + ': ' + JSON.stringify(compactParameter(properties[name]))).join(', ')] : []),
    '    },',
    '    "required": ' + JSON.stringify(required) + ',',
    '    "type": "object"',
    '  },',
    '  ' + execution,
    '}',
  ];
  return lines.map(line => INDENT + line).join('\n');
}

const carrierTemplates: CarrierTemplate[] = carrierRecords.map((record) => {
  const text = compactCarrier(record);
  const encodedMarker = JSON.stringify(CONTENT_MARKER);
  const offset = text.indexOf(encodedMarker);
  if (offset < 0) throw new Error('Configuration template has no text slot.');
  return {
    before: text.slice(0, offset),
    after: text.slice(offset + encodedMarker.length),
    lineIndex: text.slice(0, offset).split('\n').length - 1,
    lineCount: text.split('\n').length,
  };
});

interface RenderedRecord {
  text: string;
  lineCount: number;
  content?: { chunk: TextChunk; localOffset: number; encodedLength: number; lineIndex: number };
}

export interface DocumentOptions {
  format?: DisplayFormat;
  start?: number;
  count?: number;
  /** Whole-book chunk bounds; rangeEnd is exclusive. */
  rangeStart?: number;
  rangeEnd?: number;
  density?: ReaderSettings['density'];
  /** Minimum size of occasional long parking regions, not every reading gap. */
  minGapLines?: number;
}

function configurationBreaks(seed: number, start: number, end: number, density: ReaderSettings['density']): Set<number> {
  const [minimum, spread] = density === 'extra-sparse' ? [5, 5] : density === 'sparse' ? [8, 7] : [12, 9];
  const breaks = new Set<number>();
  let index = 0;
  let group = 0;
  while (index < end) {
    index += minimum + plannedValue(seed, group++, 0x6a3c9e51) % spread;
    // Keep the global sequence stable without allocating every earlier break
    // again when the reader opens a window near the end of a long book.
    if (index >= start && index < end) breaks.add(index);
  }
  return breaks;
}

/**
 * Build only a bounded response window, never a million-line JSON document for a whole novel.
 * Reading runs use compact real fields; occasional full records provide long parking regions.
 * Slot ranges include the complete JSON string literal: JSON.parse(text.slice(from, to)) restores it.
 */
export function buildDocument(book: Book, chunks: TextChunk[], options: DocumentOptions = {}): DocumentModel {
  const rangeStart = integer(options.rangeStart, 0, 0, chunks.length);
  const rangeEnd = integer(options.rangeEnd, chunks.length, rangeStart, chunks.length);
  const hasRange = options.rangeStart !== undefined || options.rangeEnd !== undefined;
  // Explicit section views always keep their window inside that section. Preserve
  // the legacy exhausted-window behaviour for callers without section bounds.
  const lastStart = hasRange && rangeEnd > rangeStart ? rangeEnd - 1 : rangeEnd;
  const start = integer(options.start, rangeStart, rangeStart, lastStart);
  const count = integer(options.count, 24, 1, 120);
  const end = Math.min(rangeEnd, start + count);
  const gap = integer(options.minGapLines, 50, 0, 2000);
  const density = options.density ?? 'comfortable';
  const seed = hashBook(book.id);
  const breaks = configurationBreaks(seed, start, end, density);
  const prefix = `{
  "reqid": ${JSON.stringify(book.id)},
  "code": 0,
  "data": {
    "list": [
`;
  const records: RenderedRecord[] = [];
  let nextLine = prefix.split('\n').length;
  let lastSlotLine: number | undefined;
  const addPure = (key: number, ordinal: number) => {
    const cursor = plannedValue(seed, key, 0x482cf69d) + ordinal * 17;
    const record = pureRecords[cursor % pureRecords.length];
    records.push(record);
    nextLine += record.lineCount;
  };

  for (let index = start; index < end; index++) {
    const chunk = chunks[index];
    const template = carrierTemplates[index % carrierTemplates.length];
    const encoded = JSON.stringify(chunk.text);
    if (lastSlotLine === undefined) {
      // A dependable parking region is available even in a one-chapter window.
      let ordinal = 0;
      while (nextLine + template.lineIndex - 1 < gap) addPure(index ^ 0x24a1, ordinal++);
    } else if (breaks.has(index)) {
      const multiplier = density === 'extra-sparse' ? 1.7 : density === 'sparse' ? 1.3 : 1;
      const longGap = Math.ceil(gap * (multiplier + (plannedValue(seed, index, 0x7124ac8d) % 36) / 100));
      let ordinal = 0;
      while (nextLine + template.lineIndex - lastSlotLine - 1 < longGap) addPure(index, ordinal++);
    }
    lastSlotLine = nextLine + template.lineIndex;
    records.push({
      text: template.before + encoded + template.after,
      lineCount: template.lineCount,
      content: { chunk, localOffset: template.before.length, encodedLength: encoded.length, lineIndex: template.lineIndex },
    });
    nextLine += template.lineCount;
  }

  if (lastSlotLine !== undefined) {
    let ordinal = 0;
    while (nextLine - lastSlotLine - 1 < gap) addPure(end ^ 0x19d3, ordinal++);
  } else {
    // An empty document still opens on a complete, useful configuration view.
    let ordinal = 0;
    do { addPure(start ^ 0x24a1, ordinal++); } while (nextLine < gap);
  }

  const fragments = [prefix];
  const slots: ReadingSlot[] = [];
  let characterOffset = prefix.length;
  let lineOffset = prefix.split('\n').length;
  records.forEach((record, index) => {
    if (record.content) {
      const { chunk, localOffset, encodedLength, lineIndex } = record.content;
      slots.push({
        chunkIndex: chunk.index,
        line: lineOffset + lineIndex,
        from: characterOffset + localOffset,
        to: characterOffset + localOffset + encodedLength,
        sourceStart: chunk.start,
        sourceEnd: chunk.end,
      });
    }
    const fragment = record.text + (index + 1 < records.length ? ',\n' : '\n');
    fragments.push(fragment);
    characterOffset += fragment.length;
    lineOffset += record.lineCount;
  });
  fragments.push(`    ],\n    "total": ${records.length}\n  }\n}\n`);
  const text = fragments.join('');
  const lastLine = text.split('\n').length - 1;
  const parkingZones: ParkingZone[] = [];
  let zoneStart = 1;
  for (const slot of slots) {
    if (slot.line > zoneStart) parkingZones.push({ startLine: zoneStart, endLine: slot.line - 1 });
    zoneStart = slot.line + 1;
  }
  if (zoneStart <= lastLine) parkingZones.push({ startLine: zoneStart, endLine: lastLine });

  const model: DocumentModel = { format: 'json', text, slots, parkingZones, windowStart: start, windowEnd: end, totalChunks: chunks.length, rangeStart, rangeEnd };
  return options.format && options.format !== 'json' ? formatDocument(model, book, options.format) : model;
}
