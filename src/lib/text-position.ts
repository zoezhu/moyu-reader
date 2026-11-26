interface EncodedCharacter {
  encodedWidth: number;
  sourceWidth: number;
}

const shortEscapeCodes: Record<string, number> = {
  '"': 34,
  '\\': 92,
  '/': 47,
  b: 8,
  f: 12,
  n: 10,
  r: 13,
  t: 9,
};

function codeUnitAt(literal: string, position: number): { code: number; width: number } {
  if (literal.charCodeAt(position) !== 92) return { code: literal.charCodeAt(position), width: 1 };
  if (literal[position + 1] === 'u') return { code: Number.parseInt(literal.slice(position + 2, position + 6), 16), width: 6 };
  return { code: shortEscapeCodes[literal[position + 1]], width: 2 };
}

/** Read one decoded Unicode character, retaining lone UTF-16 surrogates. */
function characterAt(literal: string, position: number, end: number): EncodedCharacter {
  const first = codeUnitAt(literal, position);
  if (first.code >= 0xd800 && first.code <= 0xdbff && position + first.width < end) {
    const second = codeUnitAt(literal, position + first.width);
    if (second.code >= 0xdc00 && second.code <= 0xdfff) {
      return { encodedWidth: first.width + second.width, sourceWidth: 2 };
    }
  }
  return { encodedWidth: first.width, sourceWidth: 1 };
}

function nonnegativeInteger(offset: number): number {
  return Number.isNaN(offset) ? 0 : Math.max(0, Math.floor(offset));
}

/**
 * Convert a decoded UTF-16 offset to a position in a valid JSON string literal.
 * The returned offset includes the opening quote. Interior surrogate positions
 * snap to the character's beginning, and positions beyond the text clamp to
 * immediately before the closing quote. No source text is rewritten.
 */
export function sourceOffsetToJsonOffset(literal: string, sourceOffset: number): number {
  const target = nonnegativeInteger(sourceOffset);
  const end = Math.max(1, literal.length - 1);
  let source = 0;
  let encoded = 1;
  while (encoded < end) {
    const character = characterAt(literal, encoded, end);
    if (target < source + character.sourceWidth) return encoded;
    source += character.sourceWidth;
    encoded += character.encodedWidth;
  }
  return end;
}
