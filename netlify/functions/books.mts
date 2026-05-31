// Netlify Function: Bücher-Speicher auf Netlify Blobs.
// Routen (per netlify.toml auf /api/books gemappt):
//   GET    /api/books            -> Index (Liste der Buch-Metadaten)
//   GET    /api/books?id=ID      -> vollständiges Buch (Text + Kapitel + Fortschritt)
//   POST   /api/books            -> Buch speichern (Body = vollständiges Buch)
//   PATCH  /api/books            -> nur Fortschritt/letztes Kapitel aktualisieren
//   DELETE /api/books?id=ID      -> Buch löschen
import { getStore } from '@netlify/blobs';

const STORE = 'leseprogramm';
const INDEX_KEY = 'index';

// Minimaler Speicher-Vertrag (erlaubt das Testen mit einem In-Memory-Store)
export interface BlobLike {
  get(key: string, opts?: { type?: string }): Promise<any>;
  setJSON(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const toMeta = (book: any) => ({
  id: book.id,
  title: book.title,
  author: book.author,
  wordCount: book.wordCount || 0,
  pageCount: book.pageCount || 0,
  chapterCount: Array.isArray(book.chapters) ? book.chapters.length : book.chapterCount || 0,
  createdAt: book.createdAt || Date.now(),
  chapterSource: book.chapterSource || 'heuristik',
  lastChapterId: book.lastChapterId,
  progress: book.progress || {},
});

export async function handleBooks(store: BlobLike, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const readIndex = async (): Promise<any[]> =>
    ((await store.get(INDEX_KEY, { type: 'json' })) as any[]) || [];

  try {
    if (req.method === 'GET') {
      if (id) {
        const heavy = await store.get(`book:${id}`, { type: 'json' });
        if (!heavy) return json({ error: 'Buch nicht gefunden' }, 404);
        const meta = (await readIndex()).find((m) => m.id === id) || {};
        return json({ ...meta, ...heavy });
      }
      return json(await readIndex());
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const book = await req.json();
      if (!book?.id) return json({ error: 'id fehlt' }, 400);
      await store.setJSON(`book:${book.id}`, {
        id: book.id,
        text: book.text || '',
        chapters: book.chapters || [],
      });
      const index = await readIndex();
      await store.setJSON(INDEX_KEY, [toMeta(book), ...index.filter((m) => m.id !== book.id)]);
      return json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const patch = await req.json();
      if (!patch?.id) return json({ error: 'id fehlt' }, 400);
      const index = await readIndex();
      await store.setJSON(
        INDEX_KEY,
        index.map((m) =>
          m.id === patch.id
            ? {
                ...m,
                ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
                ...(patch.lastChapterId !== undefined ? { lastChapterId: patch.lastChapterId } : {}),
              }
            : m,
        ),
      );
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (!id) return json({ error: 'id fehlt' }, 400);
      await store.delete(`book:${id}`);
      const index = await readIndex();
      await store.setJSON(INDEX_KEY, index.filter((m) => m.id !== id));
      return json({ ok: true });
    }

    return json({ error: 'Methode nicht erlaubt' }, 405);
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

export default async (req: Request): Promise<Response> => {
  let store: BlobLike;
  try {
    store = getStore(STORE) as unknown as BlobLike;
  } catch (e: any) {
    return json({ error: 'Netlify Blobs nicht verfügbar: ' + String(e?.message || e) }, 500);
  }
  return handleBooks(store, req);
};
