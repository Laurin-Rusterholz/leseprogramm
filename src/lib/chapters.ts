// Kapitel-Erzeugung: aus KI-Markern, per Heuristik oder als ein Stück.
import type { AiChapterMarker, Chapter } from './types';

export function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface NormalizedText {
  norm: string;
  /** map[i] = Original-Offset des i-ten Zeichens in `norm` */
  map: number[];
  lower: string;
}

function normalize(text: string): NormalizedText {
  const chars: string[] = [];
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (!prevSpace) {
        chars.push(' ');
        map.push(i);
        prevSpace = true;
      }
    } else {
      chars.push(c);
      map.push(i);
      prevSpace = false;
    }
  }
  const norm = chars.join('');
  return { norm, map, lower: norm.toLowerCase() };
}

function normalizeMarker(marker: string): string {
  return marker.replace(/\s+/g, ' ').trim();
}

// --- Inhaltsverzeichnis-Erkennung -----------------------------------------
// Ein Inhaltsverzeichnis (TOC) am Buchanfang würde sonst dazu führen, dass die
// Kapitel-Marker dort gefunden werden (weil die Überschriften im TOC stehen)
// und alle „Kapitel" zu winzigen Slices schrumpfen.

const TOC_HEADING_RE =
  /^(kapitel|chapter|teil|abschnitt|prolog|epilog|vorwort|nachwort|einleitung|einführung|inhalt(sverzeichnis)?|anhang|widmung|impressum)\b/i;
const TOC_NUMBERED_RE = /^(\d{1,3})([.)]|\s)\s*\S/;
const TOC_ROMAN_RE = /^[IVXLCDM]{1,6}[.)]?\s+\S/;

function isMostlyCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, '');
  return upper.length / letters.length > 0.7;
}

function looksLikeTocLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 70) return false;
  if (TOC_HEADING_RE.test(t) || TOC_NUMBERED_RE.test(t) || TOC_ROMAN_RE.test(t)) return true;
  if (t.length <= 50 && isMostlyCaps(t)) return true;
  return false;
}

/**
 * Erkennt am Buchanfang ein Inhaltsverzeichnis (viele kurze Überschriften ohne
 * Fließtext dazwischen) und liefert den **Original-Offset**, ab dem die echten
 * Kapitel beginnen. Der Offset zeigt auf den Anfang der letzten Überschrift vor
 * dem ersten Fließtext – so wird die erste echte Kapitelüberschrift nie
 * versehentlich übersprungen. 0 = kein TOC erkannt.
 */
export function detectTocEnd(text: string): number {
  const horizon = Math.min(text.length, 25000);
  const lines = text.slice(0, horizon).split('\n');
  let pos = 0;
  let headingsRun = 0;
  let lastHeadingStart = -1;
  let tocEnd = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    const lineStart = pos;
    pos += line.length + 1; // +1 für das entfernte "\n"
    if (trimmed === '') continue;

    if (looksLikeTocLine(trimmed)) {
      headingsRun++;
      lastHeadingStart = lineStart;
      continue;
    }
    // Fließtext (lange Zeile oder Zeile mit Satzendzeichen) -> TOC zu Ende
    const isFlowingText = trimmed.length > 70 || /[.!?]/.test(trimmed);
    if (isFlowingText) {
      if (headingsRun >= 5) {
        tocEnd = lastHeadingStart;
        break;
      }
      headingsRun = 0;
    }
  }
  return tocEnd > 0 ? tocEnd : 0;
}

/**
 * Findet ein (annähernd) wörtliches Zitat im normalisierten Text und gibt
 * dessen **normalisierten** Index zurück (oder -1). Sucht nur ab `fromHint`,
 * damit Treffer im Inhaltsverzeichnis vermieden werden. Ein globaler Fallback
 * ist nur erlaubt, wenn noch kein Lesefortschritt besteht (fromHint === 0) –
 * sonst würde er wieder ins TOC zurückfallen.
 */
export function findMarkerOffset(info: NormalizedText, marker: string, fromHint = 0): number {
  const m = normalizeMarker(marker);
  if (!m) return -1;
  const candidates = [m];
  const words = m.split(' ');
  if (words.length > 5) candidates.push(words.slice(0, 5).join(' '));
  if (words.length > 3) candidates.push(words.slice(0, 3).join(' '));

  for (const cand of candidates) {
    const idx = info.lower.indexOf(cand.toLowerCase(), fromHint);
    if (idx !== -1) return idx;
  }
  if (fromHint === 0) {
    for (const cand of candidates) {
      const idx = info.lower.indexOf(cand.toLowerCase());
      if (idx !== -1) return idx;
    }
  }
  return -1;
}

export interface ChapterPoint {
  title: string;
  offset: number;
}

/**
 * Baut aus sortierten Startpunkten fertige Kapitel zusammen. Das erste Kapitel
 * beginnt immer bei 0 (kein Text geht verloren). Sehr kleine „Kapitel"
 * (< 400 Zeichen) werden mit dem Nachbarn verschmolzen – das sind fast immer
 * Überschriften ohne Inhalt (z. B. Reste aus dem TOC).
 */
export function buildChaptersFromPoints(text: string, points: ChapterPoint[]): Chapter[] {
  const valid = points
    .filter((p) => p.offset >= 0 && p.offset <= text.length)
    .sort((a, b) => a.offset - b.offset);

  const result: ChapterPoint[] = [];
  if (valid.length === 0) {
    result.push({ title: 'Text', offset: 0 });
  } else if (valid[0].offset > 600) {
    result.push({ title: 'Anfang', offset: 0 });
    result.push(valid[0]);
  } else {
    result.push({ title: valid[0].title, offset: 0 });
  }
  for (let i = 1; i < valid.length; i++) {
    const last = result[result.length - 1];
    if (valid[i].offset - last.offset < 5) continue;
    result.push(valid[i]);
  }

  // Rohe Kapitel ...
  type Raw = { title: string; start: number; end: number; chunk: string };
  const raw: Raw[] = [];
  for (let i = 0; i < result.length; i++) {
    const start = result[i].offset;
    const end = i + 1 < result.length ? result[i + 1].offset : text.length;
    const chunk = text.slice(start, end).trim();
    if (!chunk) continue;
    raw.push({ title: result[i].title.trim() || `Kapitel ${raw.length + 1}`, start, end, chunk });
  }

  // ... am Anfang aufeinanderfolgende winzige Überschriften zusammenfassen
  const merged: Raw[] = [];
  for (const r of raw) {
    const tooSmall = r.chunk.length < 400;
    const prev = merged[merged.length - 1];
    if (tooSmall && prev && prev.chunk.length < 800) {
      prev.end = r.end;
      prev.chunk = text.slice(prev.start, r.end).trim();
      continue;
    }
    merged.push(r);
  }

  // ... einzelne kleine Überschrift direkt vor großem Kapitel anhängen
  const final: Raw[] = [];
  for (let i = 0; i < merged.length; i++) {
    const cur = merged[i];
    const next = merged[i + 1];
    if (cur.chunk.length < 400 && next) {
      final.push({
        title: cur.title,
        start: cur.start,
        end: next.end,
        chunk: text.slice(cur.start, next.end).trim(),
      });
      i++; // next wurde verschluckt
      continue;
    }
    final.push(cur);
  }

  const chapters: Chapter[] = final.map((r) => ({
    id: makeId(),
    title: r.title,
    start: r.start,
    end: r.end,
    text: r.chunk,
  }));

  return chapters.length > 0 ? chapters : [singleChapter(text)];
}

/** Übersetzt einen Original-Offset in den nächstgelegenen normalisierten Index. */
function origToNorm(info: NormalizedText, origOffset: number): number {
  if (origOffset <= 0) return 0;
  for (let i = 0; i < info.map.length; i++) {
    if (info.map[i] >= origOffset) return i;
  }
  return info.map.length;
}

/** Erzeugt Kapitel aus KI-Markern (überspringt ein Inhaltsverzeichnis). */
export function chaptersFromAiMarkers(text: string, markers: AiChapterMarker[]): Chapter[] {
  const info = normalize(text);
  const tocEndNorm = origToNorm(info, detectTocEnd(text));

  const points: ChapterPoint[] = [];
  let hint = tocEndNorm; // Suche startet nach dem Inhaltsverzeichnis
  for (const marker of markers) {
    if (!marker || !marker.start_marker) continue;
    const normIdx = findMarkerOffset(info, marker.start_marker, hint);
    if (normIdx === -1) continue;
    points.push({ title: marker.title || `Kapitel ${points.length + 1}`, offset: info.map[normIdx] });
    hint = normIdx + 1;
  }
  return buildChaptersFromPoints(text, points);
}

/** Der gesamte Text als ein einziges Kapitel. */
export function singleChapter(text: string): Chapter {
  return {
    id: makeId(),
    title: 'Ganzer Text',
    start: 0,
    end: text.length,
    text: text.trim(),
  };
}

const HEADING_KEYWORDS =
  /^(kapitel|chapter|teil|abschnitt|buch|prolog|epilog|vorwort|nachwort|einleitung|einführung|vorbemerkung|inhalt(sverzeichnis)?|anhang|widmung|danksagung|impressum)\b/i;
const NUMBERED = /^(\d{1,3})([.)]|\s)\s*\S/;
const ROMAN = /^[IVXLCDM]{1,6}[.)]?\s+\S/;

/**
 * Heuristische Kapitelerkennung anhand typischer Überschriften.
 * Springt das Inhaltsverzeichnis am Buchanfang aktiv über.
 */
export function heuristicChapters(text: string): Chapter[] {
  const tocEnd = detectTocEnd(text);
  const points: ChapterPoint[] = [];
  let offset = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineStart = offset;
    offset += line.length + 1; // +1 für das entfernte "\n"

    if (lineStart < tocEnd) continue; // TOC-Bereich überspringen
    if (trimmed.length === 0 || trimmed.length > 70) continue;

    const prevBlank = i === 0 || lines[i - 1].trim() === '';
    const isHeading =
      HEADING_KEYWORDS.test(trimmed) ||
      NUMBERED.test(trimmed) ||
      ROMAN.test(trimmed) ||
      (prevBlank && trimmed.length <= 50 && isMostlyCaps(trimmed));

    if (isHeading && prevBlank) {
      points.push({ title: trimmed, offset: lineStart });
    }
  }

  if (points.length < 2) {
    return splitIntoSections(text);
  }
  return buildChaptersFromPoints(text, points);
}

/**
 * Teilt Text ohne erkennbare Kapitel in etwa gleich große Abschnitte.
 */
export function splitIntoSections(text: string, targetWords = 3500): Chapter[] {
  const paragraphs = text.split(/\n{2,}/);
  const totalWords = (text.match(/\S+/g) || []).length;
  if (totalWords <= targetWords * 1.5 || paragraphs.length < 4) {
    return [singleChapter(text)];
  }

  const points: ChapterPoint[] = [];
  let offset = 0;
  let wordsInSection = 0;
  let sectionIndex = 1;
  let atSectionStart = true;

  for (const para of paragraphs) {
    if (atSectionStart) {
      points.push({ title: `Abschnitt ${sectionIndex}`, offset });
      atSectionStart = false;
    }
    const w = (para.match(/\S+/g) || []).length;
    wordsInSection += w;
    offset += para.length + 2;
    if (wordsInSection >= targetWords) {
      wordsInSection = 0;
      sectionIndex++;
      atSectionStart = true;
    }
  }

  return buildChaptersFromPoints(text, points);
}
