// Persistenz: Bücher in IndexedDB (groß), Einstellungen in localStorage.
import type { Book, Settings } from './types';

const DB_NAME = 'leseprogramm';
const DB_VERSION = 1;
const STORE = 'books';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const request = fn(store);
        transaction.oncomplete = () => {
          resolve(request.result);
          db.close();
        };
        transaction.onerror = () => {
          reject(transaction.error);
          db.close();
        };
      }),
  );
}

export async function getAllBooks(): Promise<Book[]> {
  const books = await tx<Book[]>('readonly', (s) => s.getAll() as IDBRequest<Book[]>);
  return books.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getBook(id: string): Promise<Book | undefined> {
  return tx<Book | undefined>('readonly', (s) => s.get(id) as IDBRequest<Book | undefined>);
}

export async function saveBook(book: Book): Promise<void> {
  await tx('readwrite', (s) => s.put(book));
}

export async function deleteBook(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

// ----- Einstellungen (localStorage) -----

const SETTINGS_KEY = 'leseprogramm.settings';

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'gemini-2.0-flash',
  wpm: 350,
  punctuationPause: 1,
  longWordPause: true,
  showOrp: true,
  showContext: true,
  fontScale: 1,
  lineHeight: 1.7,
  ttsEnabled: false,
  voiceURI: '',
  ttsRate: 1,
  ttsPitch: 1,
  theme: 'warm',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* Speicher evtl. voll – nicht kritisch */
  }
}

const LAST_BOOK_KEY = 'leseprogramm.lastBook';
export function loadLastBookId(): string | null {
  try {
    return localStorage.getItem(LAST_BOOK_KEY);
  } catch {
    return null;
  }
}
export function saveLastBookId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_BOOK_KEY, id);
    else localStorage.removeItem(LAST_BOOK_KEY);
  } catch {
    /* ignore */
  }
}
