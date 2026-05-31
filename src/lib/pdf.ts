// PDF-Textextraktion im Browser mit pdf.js
import * as pdfjsLib from 'pdfjs-dist';
// Vite bündelt den Worker und liefert eine URL zurück.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { reconstructPageText, cleanupText, type PageContentLike } from './pdfText';

export { cleanupText } from './pdfText';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

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
  const loadingTask = pdfjsLib.getDocument({
    data,
    // Standardschriften für Texte ohne eingebettete Fonts
    useSystemFonts: true,
    isEvalSupported: false,
  });
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
