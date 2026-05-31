// Lesemodell: Wörter (Tokens) plus Zuordnung zu Sätzen – Grundlage für den
// Fokus-Modus und die satzweise Synchronisation der Sprachausgabe.
import { tokenize, splitSentences, type Token } from './tokenize';

export interface VoiceSentence {
  text: string;
  /** Zeichen-Offset des Satzanfangs im Kapiteltext */
  start: number;
  /** erster und letzter Token-Index dieses Satzes */
  first: number;
  last: number;
}

export interface ReadingModel {
  tokens: Token[];
  sentences: VoiceSentence[];
  /** Token-Index -> Index des zugehörigen Satzes in `sentences` */
  tokenToSentence: number[];
}

export function buildReadingModel(text: string, longWordPause: boolean): ReadingModel {
  const tokens = tokenize(text, longWordPause);
  const rawSentences = splitSentences(text);

  // Jedem Token den passenden (Roh-)Satz zuordnen
  const firstByRaw = new Array(rawSentences.length).fill(-1);
  const lastByRaw = new Array(rawSentences.length).fill(-1);
  let si = 0;
  for (let ti = 0; ti < tokens.length; ti++) {
    const off = tokens[ti].offset;
    while (si < rawSentences.length - 1 && off >= rawSentences[si].end) si++;
    if (firstByRaw[si] === -1) firstByRaw[si] = ti;
    lastByRaw[si] = ti;
  }

  // Nur Sätze mit mindestens einem Token behalten
  const sentences: VoiceSentence[] = [];
  const tokenToSentence = new Array(tokens.length).fill(0);
  for (let i = 0; i < rawSentences.length; i++) {
    if (firstByRaw[i] === -1) continue;
    const vsIndex = sentences.length;
    sentences.push({
      text: rawSentences[i].text,
      start: rawSentences[i].start,
      first: firstByRaw[i],
      last: lastByRaw[i],
    });
    for (let t = firstByRaw[i]; t <= lastByRaw[i]; t++) tokenToSentence[t] = vsIndex;
  }

  return { tokens, sentences, tokenToSentence };
}

/**
 * Bildet einen Zeichen-Index innerhalb eines Satzes (wie ihn die
 * Sprachausgabe in `boundary`-Events liefert) auf den passenden Token ab.
 */
export function tokenAtChar(model: ReadingModel, sentenceIndex: number, charIndex: number): number {
  const s = model.sentences[sentenceIndex];
  if (!s) return 0;
  const absolute = s.start + charIndex;
  let result = s.first;
  for (let t = s.first; t <= s.last; t++) {
    if (model.tokens[t].offset <= absolute) result = t;
    else break;
  }
  return result;
}
