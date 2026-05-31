// Netlify Function: Einstellungen (inkl. API-Key) auf Netlify Blobs.
//   GET  /api/settings -> gespeicherte Einstellungen (oder null)
//   POST /api/settings -> Einstellungen speichern
import { getStore } from '@netlify/blobs';
import type { BlobLike } from './books.mts';

const STORE = 'leseprogramm';
const KEY = 'settings';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function handleSettings(store: BlobLike, req: Request): Promise<Response> {
  try {
    if (req.method === 'GET') {
      const settings = await store.get(KEY, { type: 'json' });
      return json(settings ?? null);
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const settings = await req.json();
      await store.setJSON(KEY, settings);
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
  return handleSettings(store, req);
};
