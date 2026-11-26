import type { ReadingSlot } from '../types';

export type ReadingEncoding = NonNullable<ReadingSlot['encoding']>;

export interface EncodedReadingCharacter {
  /** Offsets inside the displayed literal, including any delimiters. */
  from: number;
  to: number;
  /** Offsets inside the original text, measured in UTF-16 units. */
  sourceFrom: number;
  sourceTo: number;
  character: string;
}

const escapes: Record<string, string> = {
  '"': '"', "'": "'", '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
};
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function literalBounds(literal: string, encoding: ReadingEncoding = 'json'): { start: number; end: number } {
  const start = encoding === 'raw' || encoding === 'xml' ? 0
    : encoding === 'sql' && /^[eE]'/u.test(literal) ? 2 : 1;
  return { start, end: Math.max(start, literal.length - (encoding === 'raw' || encoding === 'xml' ? 0 : 1)) };
}

/** Decode one source unit without losing the width of its displayed spelling. */
function unitAt(literal: string, position: number, end: number, encoding: ReadingEncoding): { character: string; end: number } {
  const character = literal[position];
  if ((encoding === 'json' || encoding === 'sql') && character === '\\') {
    const code = literal[position + 1];
    const width = code === 'u' ? 4 : encoding === 'sql' && code === 'U' ? 8 : encoding === 'sql' && code === 'x' ? 2 : 0;
    if (width && position + width + 2 <= end) {
      const digits = literal.slice(position + 2, position + width + 2);
      if (/^[\da-f]+$/iu.test(digits)) {
        const value = Number.parseInt(digits, 16);
        if (value <= 0x10ffff) return { character: String.fromCodePoint(value), end: position + width + 2 };
      }
    }
    if (code in escapes) return { character: escapes[code], end: Math.min(end, position + 2) };
  }
  if (encoding === 'sql' && character === "'" && literal[position + 1] === "'") return { character: "'", end: position + 2 };
  if (encoding === 'csv' && character === '"' && literal[position + 1] === '"') return { character: '"', end: position + 2 };
  if (encoding === 'xml' && character === '&') {
    const match = literal.slice(position, Math.min(end, position + 16)).match(/^&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/iu);
    if (match) {
      const entity = match[1];
      const value = entity[0] === '#' ? Number.parseInt(entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1), entity[1]?.toLowerCase() === 'x' ? 16 : 10) : null;
      if (value === null) return { character: entities[entity.toLowerCase()], end: position + match[0].length };
      if (value <= 0x10ffff) return { character: String.fromCodePoint(value), end: position + match[0].length };
    }
  }
  return { character, end: position + 1 };
}

/** One map is shared by navigation, progress restoration and whitespace display. */
export function encodedReadingCharacters(literal: string, encoding: ReadingEncoding = 'json'): EncodedReadingCharacter[] {
  const { start, end } = literalBounds(literal, encoding);
  const characters: EncodedReadingCharacter[] = [];
  let position = start;
  let source = 0;
  while (position < end) {
    const from = position;
    let unit = unitAt(literal, position, end, encoding);
    const first = unit.character.charCodeAt(0);
    if (unit.character.length === 1 && first >= 0xd800 && first <= 0xdbff && unit.end < end) {
      const next = unitAt(literal, unit.end, end, encoding);
      const second = next.character.charCodeAt(0);
      if (next.character.length === 1 && second >= 0xdc00 && second <= 0xdfff) unit = { character: unit.character + next.character, end: next.end };
    }
    characters.push({ from, to: unit.end, sourceFrom: source, sourceTo: source + unit.character.length, character: unit.character });
    source += unit.character.length;
    position = unit.end;
  }
  return characters;
}
