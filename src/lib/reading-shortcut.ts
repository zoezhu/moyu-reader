import type { ReaderSettings, ReadingDirection } from '../types';

type ReadingKeys = Pick<ReaderSettings, 'readingKey' | 'previousReadingKey'>;

export const DEFAULT_READING_KEYS: ReadingKeys = {
  readingKey: 'z',
  previousReadingKey: 'e',
};

export const READING_SHORTCUTS = [
  { key: 'readingKey', other: 'previousReadingKey', direction: 1, label: '向下跳转键', target: '下一条', defaultKey: DEFAULT_READING_KEYS.readingKey },
  { key: 'previousReadingKey', other: 'readingKey', direction: -1, label: '向上跳转键', target: '上一条', defaultKey: DEFAULT_READING_KEYS.previousReadingKey },
] as const;

const supportedKey = /^[a-z0-9 ]$/i;

/** A single unmodified letter, number or space, with a direction-specific default. */
export function normalizeReadingKey(value: unknown, fallback = DEFAULT_READING_KEYS.readingKey): string {
  return typeof value === 'string' && supportedKey.test(value) ? value.toLowerCase() : fallback;
}

/** Preserve a saved downward key while ensuring both directions remain usable. */
export function normalizeReadingKeys(down: unknown, up: unknown): ReadingKeys {
  const readingKey = normalizeReadingKey(down);
  let previousReadingKey = normalizeReadingKey(up, DEFAULT_READING_KEYS.previousReadingKey);
  if (previousReadingKey === readingKey) {
    previousReadingKey = readingKey === DEFAULT_READING_KEYS.previousReadingKey
      ? DEFAULT_READING_KEYS.readingKey : DEFAULT_READING_KEYS.previousReadingKey;
  }
  return { readingKey, previousReadingKey };
}

export function readingKeyLabel(key: string): string {
  const normalized = normalizeReadingKey(key);
  return normalized === ' ' ? '空格' : normalized.toUpperCase();
}

function isUnmodifiedKey(event: KeyboardEvent): boolean {
  return !event.defaultPrevented && !event.isComposing
    && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}

/** Settings capture accepts one distinct press; it never records held keys. */
export function readingKeyFromEvent(event: KeyboardEvent): string | null {
  if (!isUnmodifiedKey(event) || event.repeat || !supportedKey.test(event.key)) return null;
  return event.key.toLowerCase();
}

/** Include held keys so the caller can suppress native scrolling without stepping. */
export function getReadingDirection(event: KeyboardEvent, settings: ReadingKeys): ReadingDirection | null {
  if (!isUnmodifiedKey(event)) return null;
  const key = event.key.toLowerCase();
  return READING_SHORTCUTS.find(shortcut => settings[shortcut.key] === key)?.direction ?? null;
}
