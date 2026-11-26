import type { Book, ReadingProgress, ReaderSettings } from '../types';
import { DEFAULT_READING_KEYS, normalizeReadingKeys } from './reading-shortcut';

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

export const getBooks = () => read<Book[]>('books');
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
export const getProgress = (bookId: string) => read<ReadingProgress | undefined>('progress', bookId);
export const saveProgress = (progress: ReadingProgress) => write('progress', progress);

export const defaultSettings: ReaderSettings = {
  fontSize: 16,
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
      fontSize: typeof saved.fontSize === 'number' ? Math.max(13, Math.min(22, saved.fontSize)) : 16,
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
