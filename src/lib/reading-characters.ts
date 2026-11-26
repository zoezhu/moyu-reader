/** Source positions of readable characters inside a complete JSON string literal. */
export interface ReadingCharacter { position: number; sourceOffset: number }

export function readingCharacters(literal: string, documentFrom: number, sourceStart: number): ReadingCharacter[] {
  const result: ReadingCharacter[] = [];
  let encoded = 1;
  let source = 0;
  for (const character of JSON.parse(literal) as string) {
    if (!/\s/u.test(character)) result.push({ position: documentFrom + encoded, sourceOffset: sourceStart + source });
    // Advance by encoded UTF-16 units, preserving escaped backslashes, quotes,
    // control characters and either spelling of a Unicode surrogate pair.
    for (let unit = 0; unit < character.length; unit++) {
      encoded += literal[encoded] === '\\' ? literal[encoded + 1] === 'u' ? 6 : 2 : 1;
    }
    source += character.length;
  }
  return result;
}
