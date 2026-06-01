// Zerlegung von Text in Wörter (Tokens) für den Fokus-Modus (RSVP)
// und Berechnung des optischen Fixpunkts (ORP / "Optimal Recognition Point").

export interface Token {
  text: string;
  /** Index des Pivot-Buchstabens (ORP) innerhalb des Wortes */
  orp: number;
  /** Faktor für die Anzeigedauer (>1 = länger stehen lassen) */
  delay: number;
  /** Zeichen-Offset des Tokens im Quelltext (für Vorlese-Synchronisation) */
  offset: number;
}

const SENTENCE_END = /[.!?…]["'»“”)\]]?$/;
const CLAUSE_END = /[,;:–—]["'»“”)\]]?$/;

/**
 * Bestimmt den optischen Fixpunkt eines Wortes.
 * Werte nach gängiger RSVP-Praxis (z. B. Spritz).
 */
export function orpIndex(word: string): number {
  const len = word.length;
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

/**
 * Zerlegt Text in eine Token-Liste. Erhält Satzzeichen am Wort und
 * vergibt längere Anzeigedauern an Satz-/Teilsatzenden und langen Wörtern.
 */
export function tokenize(text: string, longWordPause = true): Token[] {
  const tokens: Token[] = [];
  // Wörter inkl. anhängender Satzzeichen über Whitespace trennen.
  const regex = /\S+/g;
  let match: RegExpExecArray | null;
  // Das erste Wort sowie jedes Wort direkt nach einem Satzende gilt als
  // Satzanfang und wird etwas länger gezeigt (sanftes „Eingewöhnen").
  let atSentenceStart = true;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const offset = match.index;

    // Sehr lange "Wörter" (z. B. URLs) defensiv aufteilen
    if (raw.length > 30) {
      for (let i = 0; i < raw.length; i += 22) {
        const part = raw.slice(i, i + 22);
        tokens.push({ text: part, orp: orpIndex(part), delay: 1, offset: offset + i });
      }
      atSentenceStart = SENTENCE_END.test(raw);
      continue;
    }

    let delay = 1;
    if (SENTENCE_END.test(raw)) delay = 2.2;
    else if (CLAUSE_END.test(raw)) delay = 1.6;
    if (longWordPause && raw.length >= 9) delay = Math.max(delay, 1.4);
    // Satzanfang: kurz langsamer, um sich zu orientieren.
    if (atSentenceStart) delay = Math.max(delay, 1.5);

    tokens.push({ text: raw, orp: orpIndex(raw), delay, offset });
    atSentenceStart = SENTENCE_END.test(raw);
  }
  return tokens;
}

/** Geschätzte Lesedauer in Sekunden bei gegebener WPM. */
export function estimateSeconds(tokenCount: number, wpm: number): number {
  if (wpm <= 0) return 0;
  return (tokenCount / wpm) * 60;
}

/** Sekunden hübsch als m:ss / h:mm:ss formatieren. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Zählt Wörter in einem Text. */
export function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

/**
 * Teilt Text in Sätze samt Zeichen-Offsets. Für das Vorlesen werden zu
 * lange Sätze zusätzlich an Teilsatzgrenzen aufgebrochen, damit die
 * Sprachausgabe (besonders auf iOS) zuverlässig bleibt.
 */
export function splitSentences(text: string, maxLen = 240): Sentence[] {
  const sentences: Sentence[] = [];
  const regex = /[^.!?…\n]+[.!?…]*\n*|\n+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;
    if (raw.trim().length === 0) continue;

    if (raw.length <= maxLen) {
      sentences.push({ text: raw.trim(), start: start + leadingWs(raw), end: start + raw.length });
      continue;
    }
    // Langen Satz an Kommata/Semikola weiter aufteilen
    const sub = /[^,;:–—]+[,;:–—]*/g;
    let sm: RegExpExecArray | null;
    let buffer = '';
    let bufStart = start;
    while ((sm = sub.exec(raw)) !== null) {
      if (buffer === '') bufStart = start + sm.index;
      buffer += sm[0];
      if (buffer.length >= maxLen) {
        sentences.push({ text: buffer.trim(), start: bufStart + leadingWs(buffer), end: bufStart + buffer.length });
        buffer = '';
      }
    }
    if (buffer.trim().length > 0) {
      sentences.push({ text: buffer.trim(), start: bufStart + leadingWs(buffer), end: bufStart + buffer.length });
    }
  }
  return sentences;
}

function leadingWs(s: string): number {
  const m = s.match(/^\s*/);
  return m ? m[0].length : 0;
}
