// Persistenz: primär über Netlify Functions + Netlify Blobs (serverseitig,
// geräteübergreifend). Sind die Functions nicht erreichbar (z. B. reines
// `vite dev`), wird transparent auf lokalen Speicher (IndexedDB/localStorage)
// zurückgegriffen.
import type { Book, BookMeta, Settings } from './types';

const API_BOOKS = '/api/books';
const API_SETTINGS = '/api/settings';

export type StorageMode = 'cloud' | 'lokal' | 'unbekannt';
let mode: StorageMode = 'unbekannt';
export function storageMode(): StorageMode {
  return mode;
}

async function fetchJSON(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, options);
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    if (ct.includes('application/json')) {
      const body = await res.json().catch(() => null);
      if (body?.error) msg = body.error;
    }
    throw new Error(msg);
  }
  if (!ct.includes('application/json')) {
    // z. B. SPA-Fallback liefert HTML -> Functions nicht vorhanden
    throw new Error('Keine JSON-Antwort (Functions nicht verfügbar)');
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Bücher
// ---------------------------------------------------------------------------

export async function getAllBooks(): Promise<BookMeta[]> {
  if (mode !== 'lokal') {
    try {
      const data = (await fetchJSON(API_BOOKS)) as BookMeta[];
      mode = 'cloud';
      return sortMeta(data);
    } catch {
      mode = 'lokal';
    }
  }
  return sortMeta(await localGetAllMeta());
}

export async function getBook(id: string): Promise<Book | undefined> {
  if (mode === 'cloud') {
    try {
      return (await fetchJSON(`${API_BOOKS}?id=${encodeURIComponent(id)}`)) as Book;
    } catch {
      /* Fallback unten */
    }
  }
  return localGetBook(id);
}

export async function saveBook(book: Book): Promise<void> {
  if (mode === 'cloud') {
    try {
      await fetchJSON(API_BOOKS, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(book),
      });
      return;
    } catch {
      mode = 'lokal';
    }
  }
  await localSaveBook(book);
}

export async function updateProgress(
  id: string,
  patch: { progress?: Record<string, number>; lastChapterId?: string },
): Promise<void> {
  if (mode === 'cloud') {
    try {
      await fetchJSON(API_BOOKS, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      return;
    } catch {
      /* Fallback unten */
    }
  }
  await localUpdateProgress(id, patch);
}

export async function deleteBook(id: string): Promise<void> {
  if (mode === 'cloud') {
    try {
      await fetchJSON(`${API_BOOKS}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      return;
    } catch {
      /* Fallback unten */
    }
  }
  await localDeleteBook(id);
}

function sortMeta(list: BookMeta[]): BookMeta[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

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

export async function loadSettings(): Promise<Settings> {
  if (mode !== 'lokal') {
    try {
      const remote = await fetchJSON(API_SETTINGS);
      mode = 'cloud';
      if (remote && typeof remote === 'object') return { ...DEFAULT_SETTINGS, ...remote };
      // remote ist null -> evtl. lokal vorhandene Einstellungen übernehmen
      const local = loadSettingsLocal();
      return local;
    } catch {
      mode = 'lokal';
    }
  }
  return loadSettingsLocal();
}

export async function saveSettings(settings: Settings): Promise<void> {
  // immer auch lokal sichern (schneller Start, Fallback)
  saveSettingsLocal(settings);
  if (mode === 'cloud') {
    try {
      await fetchJSON(API_SETTINGS, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });
    } catch {
      /* lokal bereits gesichert */
    }
  }
}

function loadSettingsLocal(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettingsLocal(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* Speicher evtl. voll */
  }
}

// ---------------------------------------------------------------------------
// Zuletzt geöffnetes Buch (immer lokal, geräteabhängig)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Lokaler Fallback-Speicher (IndexedDB) für Bücher
// ---------------------------------------------------------------------------

const DB_NAME = 'leseprogramm';
const DB_VERSION = 1;
const STORE = 'books';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(m: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, m);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          resolve(req.result);
          db.close();
        };
        t.onerror = () => {
          reject(t.error);
          db.close();
        };
      }),
  );
}

function metaOf(b: Book): BookMeta {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    wordCount: b.wordCount,
    pageCount: b.pageCount,
    chapterCount: b.chapters.length,
    createdAt: b.createdAt,
    chapterSource: b.chapterSource,
    lastChapterId: b.lastChapterId,
    progress: b.progress || {},
  };
}

async function localGetAllMeta(): Promise<BookMeta[]> {
  try {
    const books = await tx<Book[]>('readonly', (s) => s.getAll() as IDBRequest<Book[]>);
    return books.map(metaOf);
  } catch {
    return [];
  }
}
async function localGetBook(id: string): Promise<Book | undefined> {
  return tx<Book | undefined>('readonly', (s) => s.get(id) as IDBRequest<Book | undefined>);
}
async function localSaveBook(book: Book): Promise<void> {
  await tx('readwrite', (s) => s.put(book));
}
async function localUpdateProgress(
  id: string,
  patch: { progress?: Record<string, number>; lastChapterId?: string },
): Promise<void> {
  const book = await localGetBook(id);
  if (!book) return;
  if (patch.progress !== undefined) book.progress = patch.progress;
  if (patch.lastChapterId !== undefined) book.lastChapterId = patch.lastChapterId;
  await localSaveBook(book);
}
async function localDeleteBook(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}
