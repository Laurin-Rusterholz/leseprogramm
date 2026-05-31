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

/**
 * OCR-Fallback für gescannte PDFs: rendert jede Seite als Bild und lässt sie
 * von Gemini transkribieren. Sendet die Seiten einzeln an die KI.
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

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= total; pageNum++) {
    if (signal?.aborted) throw new Error('Abgebrochen');
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    // Auf ~1600px Breite skalieren – gut lesbar, aber nicht zu groß.
    const scale = Math.min(2.5, Math.max(1.2, 1600 / base.width));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const base64 = (canvas.toDataURL('image/jpeg', 0.72).split(',')[1] as string) || '';
      const pageText = await ocrImage(apiKey, model, base64, 'image/jpeg', signal);
      if (pageText && pageText.trim()) pageTexts.push(pageText.trim());
    }
    // Speicher freigeben
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    onProgress?.({ page: pageNum, total });
  }

  await pdf.cleanup();
  await loadingTask.destroy();

  const text = cleanupText(pageTexts.join('\n\n'));
  return { text, pageCount: total, title, author };
}
