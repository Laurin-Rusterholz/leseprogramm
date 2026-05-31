// Reine Textaufbereitung für die PDF-Extraktion (ohne pdf.js-Abhängigkeit,
// damit getrennt testbar).

export interface TextItemLike {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
}

export interface PageContentLike {
  items: TextItemLike[];
}

/**
 * Setzt die Textfragmente einer Seite anhand ihrer Y-/X-Position zu Zeilen
 * zusammen. Das ergibt deutlich besseren Lesefluss als bloßes Aneinanderreihen.
 */
export function reconstructPageText(content: PageContentLike): string {
  const items = content.items;
  interface Line {
    y: number;
    parts: { x: number; str: string }[];
  }
  const lines: Line[] = [];
  const yTolerance = 3;

  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const tr = item.transform;
    const x = tr ? tr[4] : 0;
    const y = tr ? tr[5] : 0;
    if (item.str.trim() === '' && !item.hasEOL) continue;

    // Passende bestehende Zeile (ähnliche Y-Position) suchen
    let line = lines.find((l) => Math.abs(l.y - y) <= yTolerance);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, str: item.str });
  }

  // Zeilen von oben nach unten (PDF-Y verläuft von unten nach oben)
  lines.sort((a, b) => b.y - a.y);

  const lineStrings = lines.map((line) => {
    line.parts.sort((a, b) => a.x - b.x);
    return line.parts
      .map((p) => p.str)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  });

  return lineStrings.filter((l) => l.length > 0).join('\n');
}

const HEADING_RE =
  /^(kapitel|chapter|teil|abschnitt|buch|prolog|epilog|vorwort|nachwort|einleitung|einführung|vorbemerkung|inhalt(sverzeichnis)?|anhang|widmung|danksagung|impressum)\b/i;
const NUMBERED_RE = /^(\d{1,3})([.)]|\s)\s*\S/;
const ROMAN_RE = /^[IVXLCDM]{1,6}[.)]?\s+\S/;
const SENTENCE_END_RE = /[.!?…]["'»“”)\]]?$/;

/** Sieht eine (kurze) Zeile wie eine Überschrift aus? */
export function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 70) return false;
  if (HEADING_RE.test(t) || NUMBERED_RE.test(t) || ROMAN_RE.test(t)) return true;
  // kurze, satzzeichenlose Zeile in Großschreibung
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (t.length <= 50 && letters.length >= 3) {
    const upper = letters.replace(/[^A-ZÀ-Þ]/g, '');
    if (upper.length / letters.length > 0.7) return true;
  }
  return false;
}

/**
 * Räumt extrahierten Text auf: verbindet am Zeilenende getrennte Wörter,
 * setzt umgebrochene Zeilen wieder zu Absätzen zusammen und hält dabei
 * Überschriften als eigene Zeilen erhalten (wichtig für die Kapitelerkennung
 * und ein sauberes Schriftbild).
 */
export function cleanupText(raw: string): string {
  let text = raw.replace(/\r\n?/g, '\n');
  // Am Zeilenende mit Bindestrich getrennte Wörter zusammenfügen:
  // "Beispiel-\nwort" -> "Beispielwort"
  text = text.replace(/([A-Za-zÀ-ÿ])-\n([a-zà-ÿ])/g, '$1$2');

  const lines = text.split('\n');
  const paragraphs: string[] = [];
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) paragraphs.push(t.replace(/[ \t]{2,}/g, ' '));
    buf = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') {
      flush();
      continue;
    }
    if (looksLikeHeading(line)) {
      flush();
      paragraphs.push(line);
      continue;
    }
    if (buf === '') {
      buf = line;
      continue;
    }
    // Nur fortlaufende (umgebrochene) Zeilen zusammenfügen: wenn der Puffer
    // weder mit einem Satzzeichen endet noch kurz/überschriftartig ist.
    const continues = !SENTENCE_END_RE.test(buf) && buf.length >= 36 && !looksLikeHeading(buf);
    if (continues) buf += ' ' + line;
    else {
      flush();
      buf = line;
    }
  }
  flush();

  return paragraphs.join('\n\n').trim();
}
