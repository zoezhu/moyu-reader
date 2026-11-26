import { encodedReadingCharacters, type ReadingEncoding } from './reading-encoding';

/** Source positions of readable characters inside a format-specific text slot. */
export interface ReadingCharacter { position: number; sourceOffset: number }

export function readingCharacters(literal: string, documentFrom: number, sourceStart: number, encoding: ReadingEncoding = 'json'): ReadingCharacter[] {
  return encodedReadingCharacters(literal, encoding)
    .filter(unit => !/\s/u.test(unit.character))
    .map(unit => ({ position: documentFrom + unit.from, sourceOffset: sourceStart + unit.sourceFrom }));
}
