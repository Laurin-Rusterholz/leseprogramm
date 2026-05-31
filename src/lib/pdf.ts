// PDF-Textextraktion im Browser mit pdf.js
import * as pdfjsLib from 'pdfjs-dist';
// Vite bündelt den Worker und liefert eine URL zurück.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { reconstructPageText, cleanupText, type PageContentLike } from './pdfText';
import { ocrImage } from './gemini';

export { cleanupText } from './pdfText';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// CMap-/Standardschrift-Daten (von scripts/copy-pdf-assets.mjs nach
// public/pdfjs kopiert). Ohne diese scheitert die Textextraktion bei vielen
// PDFs mit CID-/Spezialschriften – dann käme z. B. nur der Titel durch.
const DOC_OPTIONS = {
  useSystemFonts: true,
  isEvalSupported: false,
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
};

export interface ExtractResult {
  text: string;
  pageCount: number;
  title?: string;
  author?: string;
}

export interface ExtractProgress {
  page: number;
  total: number;
}

/**
 * Extrahiert den gesamten Text aus einer PDF-Datei und versucht dabei,
 * sinnvolle Zeilen- und Absatzumbrüche zu rekonstruieren (pdf.js liefert
 * den Text in einzelnen Fragmenten samt Position).
 */
export async function extractPdf(
  file: File,
  onProgress?: (p: ExtractProgress) => void,
): Promise<ExtractResult> {
  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data, ...DOC_OPTIONS });
  const pdf = await loadingTask.promise;
  const total = pdf.numPages;

  let title: string | undefined;
  let author: string | undefined;
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as Record<string, unknown> | undefined;
    if (info) {
      if (typeof info.Title === 'string' && info.Title.trim()) title = info.Title.trim();
      if (typeof info.Author === 'string' && info.Author.trim()) author = info.Author.trim();
    }
  } catch {
    // Metadaten sind optional
  }

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= total; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    pageTexts.push(reconstructPageText(content as unknown as PageContentLike));
    onProgress?.({ page: pageNum, total });
    // Seite freigeben (Speicher bei großen Büchern)
    page.cleanup();
  }

  await pdf.cleanup();
  await loadingTask.destroy();

  const text = cleanupText(pageTexts.join('\n\n'));
  return { text, pageCount: total, title, author };
}

async function readMeta(pdf: pdfjsLib.PDFDocumentProxy): Promise<{ title?: string; author?: string }> {
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as Record<string, unknown> | undefined;
    const out: { title?: string; author?: string } = {};
    if (info) {
      if (typeof info.Title === 'string' && info.Title.trim()) out.title = info.Title.trim();
      if (typeof info.Author === 'string' && info.Author.trim()) out.author = info.Author.trim();
    }
    return out;
  } catch {
    return {};
  }
}

async function renderPageToJpeg(page: pdfjsLib.PDFPageProxy): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  // Auf ~1600px Breite skalieren – gut lesbar, aber nicht zu groß.
  const scale = Math.min(2.5, Math.max(1.2, 1600 / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  let base64 = '';
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    base64 = (canvas.toDataURL('image/jpeg', 0.72).split(',')[1] as string) || '';
  }
  canvas.width = 0;
  canvas.height = 0;
  return base64;
}

/**
 * KI-Extraktion: rendert jede PDF-Seite als Bild und lässt sie von Gemini
 * vorlesen/transkribieren. Umgeht damit Schriftprobleme der Textebene und
 * funktioniert auch bei gescannten PDFs. Mehrere Seiten werden parallel
 * verarbeitet (begrenzte Gleichzeitigkeit).
 */
export async function ocrPdf(
  file: File,
  apiKey: string,
  model: string,
  onProgress?: (p: ExtractProgress) => void,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data, ...DOC_OPTIONS });
  const pdf = await loadingTask.promise;
  const total = pdf.numPages;
  const { title, author } = await readMeta(pdf);

  const results: string[] = new Array(total).fill('');
  let nextPage = 1;
  let completed = 0;

  const worker = async () => {
    while (true) {
      if (signal?.aborted) throw new Error('Abgebrochen');
      const pageNum = nextPage++;
      if (pageNum > total) return;
      const page = await pdf.getPage(pageNum);
      const base64 = await renderPageToJpeg(page);
      page.cleanup();
      const text = base64 ? await ocrImage(apiKey, model, base64, 'image/jpeg', signal) : '';
      results[pageNum - 1] = text.trim();
      completed++;
      onProgress?.({ page: completed, total });
    }
  };

  // Die eigentlichen KI-Aufrufe werden in gemini.ts global gedrosselt; hier
  // genügt eine kleine Pipeline (rendern, während die Vorseite verarbeitet wird).
  const concurrency = Math.min(2, total);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  await pdf.cleanup();
  await loadingTask.destroy();

  const text = cleanupText(results.filter((t) => t).join('\n\n'));
  return { text, pageCount: total, title, author };
}
