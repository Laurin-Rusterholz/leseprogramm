// Buch als Textdatei exportieren – zum Nachprüfen der Extraktion/Gliederung.
import type { Book } from './types';

const SOURCE_LABEL: Record<Book['chapterSource'], string> = {
  ki: 'KI',
  heuristik: 'Heuristik',
  einzel: 'ein Kapitel',
};

/** Erzeugt eine gut lesbare Markdown-Fassung des kompletten Buches. */
export function bookToMarkdown(book: Book): string {
  const out: string[] = [];
  out.push(`# ${book.title}`);
  if (book.author) out.push(`*${book.author}*`);
  out.push(
    `> ${book.wordCount.toLocaleString('de-CH')} Wörter · ${book.pageCount} Seiten · ` +
      `${book.chapters.length} Kapitel · Gliederung: ${SOURCE_LABEL[book.chapterSource]}`,
  );
  out.push('');
  book.chapters.forEach((c, i) => {
    out.push('');
    out.push(`## ${i + 1}. ${c.title}`);
    out.push('');
    out.push(c.text.trim());
  });
  return out.join('\n').trim() + '\n';
}

/** Löst den Download einer Textdatei im Browser aus. */
export function downloadTextFile(filename: string, content: string, mime = 'text/markdown'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Macht aus einem Titel einen sicheren Dateinamen. */
export function safeFilename(name: string): string {
  const cleaned = (name || 'buch')
    .replace(/[^\w\-äöüÄÖÜß ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return cleaned || 'buch';
}
