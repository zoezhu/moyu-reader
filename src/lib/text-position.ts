import { encodedReadingCharacters, literalBounds, type ReadingEncoding } from './reading-encoding';

/** Map an original UTF-16 offset to its displayed spelling, snapping inside emoji. */
export function sourceOffsetToEncodedOffset(literal: string, sourceOffset: number, encoding: ReadingEncoding = 'json'): number {
  const target = Number.isNaN(sourceOffset) ? 0 : Math.max(0, Math.floor(sourceOffset));
  const unit = encodedReadingCharacters(literal, encoding).find(character => target < character.sourceTo);
  return unit?.from ?? literalBounds(literal, encoding).end;
}

export function sourceOffsetToJsonOffset(literal: string, sourceOffset: number): number {
  return sourceOffsetToEncodedOffset(literal, sourceOffset, 'json');
}
