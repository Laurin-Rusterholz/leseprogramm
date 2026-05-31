// Testet die Logik der Netlify Functions mit einem In-Memory-Blob-Store.
// Ausführen: npx tsx scripts/functest.ts
import { handleBooks, type BlobLike } from '../netlify/functions/books.mts';
import { handleSettings } from '../netlify/functions/settings.mts';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, info?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error('  ✗', name, info ?? '');
  }
}

function memStore(): BlobLike {
  const map = new Map<string, unknown>();
  return {
    async get(key: string) {
      return map.has(key) ? structuredClone(map.get(key)) : null;
    },
    async setJSON(key: string, value: unknown) {
      map.set(key, structuredClone(value));
      return undefined;
    },
    async delete(key: string) {
      map.delete(key);
      return undefined;
    },
  };
}

const BASE = 'https://example.com/api/books';
const req = (method: string, opts: { id?: string; body?: unknown } = {}) =>
  new Request(opts.id ? `${BASE}?id=${encodeURIComponent(opts.id)}` : BASE, {
    method,
    ...(opts.body !== undefined
      ? { body: JSON.stringify(opts.body), headers: { 'content-type': 'application/json' } }
      : {}),
  });

function book(id: string, title: string) {
  return {
    id,
    title,
    author: 'Autor',
    text: `Text von ${title}. Ein Satz. Noch ein Satz.`,
    chapters: [
      { id: 'c1', title: 'Eins', start: 0, end: 5, text: 'Text' },
      { id: 'c2', title: 'Zwei', start: 5, end: 10, text: 'mehr' },
    ],
    pageCount: 3,
    wordCount: 9,
    createdAt: Date.now(),
    chapterSource: 'ki',
    progress: {},
  };
}

async function main() {
  const store = memStore();

  // leerer Index
  let res = await handleBooks(store, req('GET'));
  check('leerer index', res.status === 200 && Array.isArray(await res.json()));

  // Buch speichern
  res = await handleBooks(store, req('POST', { body: book('a', 'Alpha') }));
  check('post a ok', res.status === 200);

  // Index enthält Metadaten (ohne großen Text)
  res = await handleBooks(store, req('GET'));
  const index = await res.json();
  check('index länge 1', index.length === 1, index.length);
  check('meta felder', index[0].title === 'Alpha' && index[0].chapterCount === 2 && index[0].id === 'a');
  check('meta ohne text', !('text' in index[0]));

  // Vollbuch laden (Text + Kapitel + Meta gemerged)
  res = await handleBooks(store, req('GET', { id: 'a' }));
  const full = await res.json();
  check('vollbuch text', typeof full.text === 'string' && full.text.includes('Alpha'));
  check('vollbuch kapitel', Array.isArray(full.chapters) && full.chapters.length === 2);
  check('vollbuch titel aus meta', full.title === 'Alpha');

  // Fortschritt aktualisieren (PATCH) – ohne den Text neu zu senden
  res = await handleBooks(store, req('PATCH', { body: { id: 'a', progress: { c1: 42 }, lastChapterId: 'c2' } }));
  check('patch ok', res.status === 200);
  res = await handleBooks(store, req('GET', { id: 'a' }));
  const afterPatch = await res.json();
  check('fortschritt gespeichert', afterPatch.progress?.c1 === 42 && afterPatch.lastChapterId === 'c2', afterPatch.progress);

  // zweites Buch -> neueste zuerst
  await handleBooks(store, req('POST', { body: book('b', 'Beta') }));
  res = await handleBooks(store, req('GET'));
  const idx2 = await res.json();
  check('index länge 2', idx2.length === 2, idx2.length);
  check('neueste zuerst', idx2[0].id === 'b');

  // löschen
  res = await handleBooks(store, req('DELETE', { id: 'a' }));
  check('delete ok', res.status === 200);
  res = await handleBooks(store, req('GET', { id: 'a' }));
  check('gelöscht -> 404', res.status === 404);
  res = await handleBooks(store, req('GET'));
  check('index länge 1 nach delete', (await res.json()).length === 1);

  // unbekannte id
  res = await handleBooks(store, req('GET', { id: 'gibtsnicht' }));
  check('unbekannt -> 404', res.status === 404);

  // ---- Einstellungen ----
  const sstore = memStore();
  const sbase = 'https://example.com/api/settings';
  res = await handleSettings(sstore, new Request(sbase, { method: 'GET' }));
  check('settings initial null', (await res.json()) === null);
  res = await handleSettings(
    sstore,
    new Request(sbase, { method: 'POST', body: JSON.stringify({ apiKey: 'k', wpm: 400 }), headers: { 'content-type': 'application/json' } }),
  );
  check('settings post ok', res.status === 200);
  res = await handleSettings(sstore, new Request(sbase, { method: 'GET' }));
  const s = await res.json();
  check('settings gelesen', s?.apiKey === 'k' && s?.wpm === 400, s);

  console.log(`\nFunction-Test: ${passed} bestanden, ${failed} fehlgeschlagen.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
