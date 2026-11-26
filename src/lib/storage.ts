import type { Book, Chapter, ReadingProgress, ReaderSettings } from '../types';
import { DEFAULT_READING_KEYS, normalizeReadingKeys } from './reading-shortcut';
import { isDisplayFormat } from './display-formats';

const DB_NAME = 'json-workbench-local';
let connection: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (!connection) {
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('books', { keyPath: 'id' });
        request.result.createObjectStore('progress', { keyPath: 'bookId' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const invalidate = () => { if (connection === pending) connection = undefined; };
        db.onversionchange = () => { db.close(); invalidate(); };
        db.onclose = invalidate;
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
    connection = pending;
    // open() can throw synchronously (for example, a temporary SecurityError).
    // Clear both synchronous and request failures without invalidating a newer DB.
    void pending.catch(() => { if (connection === pending) connection = undefined; });
  }
  return connection;
}

async function read<T>(store: string, key?: string): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const request = key === undefined ? transaction.objectStore(store).getAll() : transaction.objectStore(store).get(key);
    transaction.oncomplete = () => resolve(request.result as T);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('本地读取已中断'));
    request.onerror = () => reject(request.error);
  });
}

async function write(store: string, value: unknown): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    const objectStore = transaction.objectStore(store);
    objectStore.put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('本地保存已中断'));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Stored data may come from an older build or an interrupted/manual migration. */
function storedBook(value: unknown): Book | null {
  if (!isRecord(value)
    || typeof value.id !== 'string' || !value.id
    || typeof value.name !== 'string' || typeof value.alias !== 'string'
    || (value.format !== 'txt' && value.format !== 'epub' && value.format !== 'pdf')
    || typeof value.text !== 'string'
    || !nonnegativeNumber(value.importedAt) || !nonnegativeNumber(value.size)) return null;
  const text = value.text;
  const chapters = Array.isArray(value.chapters) ? value.chapters.filter((chapter): chapter is Chapter =>
    isRecord(chapter) && typeof chapter.id === 'string' && typeof chapter.title === 'string'
    && nonnegativeNumber(chapter.offset) && Number.isInteger(chapter.offset) && chapter.offset < text.length
    && nonnegativeNumber(chapter.level) && Number.isInteger(chapter.level)) : [];
  const warnings = Array.isArray(value.warnings) ? value.warnings.filter((warning) => typeof warning === 'string') : [];
  return {
    id: value.id, name: value.name, alias: value.alias, format: value.format,
    text, importedAt: value.importedAt, size: value.size, chapters, warnings,
  };
}

export const getBooks = async () => (await read<unknown[]>('books')).map(storedBook).filter((book): book is Book => book !== null);
export const saveBook = (book: Book) => write('books', book);
export async function deleteBook(id: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    // The file and bookmark must either both disappear or both remain.
    const transaction = db.transaction(['books', 'progress'], 'readwrite');
    transaction.objectStore('books').delete(id);
    transaction.objectStore('progress').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('本地移除已中断'));
  });
}
export async function getProgress(bookId: string): Promise<ReadingProgress | undefined> {
  const value = await read<unknown>('progress', bookId);
  if (!isRecord(value) || value.bookId !== bookId
    || !nonnegativeNumber(value.sourceOffset) || !Number.isInteger(value.sourceOffset)
    || !nonnegativeNumber(value.updatedAt)) return undefined;
  return { bookId, sourceOffset: value.sourceOffset, updatedAt: value.updatedAt };
}
export const saveProgress = (progress: ReadingProgress) => write('progress', progress);

export const defaultSettings: ReaderSettings = {
  fontSize: 16,
  displayFormat: 'json',
  ...DEFAULT_READING_KEYS,
  density: 'comfortable',
  showChapterTitles: false,
  showOutput: true,
  showSidebar: true,
};

export function readSettings(): ReaderSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('workbench-settings') ?? '{}');
    return {
      fontSize: typeof saved.fontSize === 'number' && Number.isFinite(saved.fontSize) ? Math.max(13, Math.min(22, saved.fontSize)) : 16,
      displayFormat: isDisplayFormat(saved.displayFormat) ? saved.displayFormat : 'json',
      ...normalizeReadingKeys(saved.readingKey, saved.previousReadingKey),
      // Version 2 replaces uniform padding with varied reading blocks. Existing
      // installations start with the new reading-first layout, keeping all
      // unrelated preferences and stored books/positions.
      density: saved.layoutVersion === 2 && ['comfortable', 'sparse', 'extra-sparse'].includes(saved.density) ? saved.density : 'comfortable',
      showChapterTitles: saved.showChapterTitles === true,
      showOutput: saved.showOutput !== false,
      showSidebar: saved.showSidebar !== false,
    };
  } catch { return defaultSettings; }
}

export function writeSettings(settings: ReaderSettings): boolean {
  try { localStorage.setItem('workbench-settings', JSON.stringify({ ...settings, layoutVersion: 2 })); return true; }
  catch { return false; }
}

export function readActiveBook(): string | null {
  try { return localStorage.getItem('workbench-active'); } catch { return null; }
}

export function writeActiveBook(id: string) {
  try { localStorage.setItem('workbench-active', id); } catch { /* Session stays usable. */ }
}
