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

/**
 * Erzeugt eine normalisierte Fassung des Textes (zusammengefasster
 * Whitespace) samt Rückabbildung auf die Originalpositionen. So lassen
 * sich KI-Zitate robust wiederfinden, auch wenn sich Leerzeichen/Umbrüche
 * unterscheiden.
 */
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

/**
 * Findet ein (annähernd) wörtliches Zitat im normalisierten Text und gibt
 * dessen **normalisierten** Index zurück (oder -1). Bevorzugt Treffer ab
 * `fromHint` (Vorwärts-Lesefortschritt), damit z. B. ein Inhaltsverzeichnis
 * am Anfang nicht fälschlich als Kapitelanfang erkannt wird. Fällt bei Bedarf
 * auf einen kürzeren Anfang des Markers zurück.
 */
export function findMarkerOffset(info: NormalizedText, marker: string, fromHint = 0): number {
  const m = normalizeMarker(marker);
  if (!m) return -1;
  const candidates = [m];
  const words = m.split(' ');
  if (words.length > 5) candidates.push(words.slice(0, 5).join(' '));
  if (words.length > 3) candidates.push(words.slice(0, 3).join(' '));

  // 1) Vorwärts ab Lesefortschritt suchen
  if (fromHint > 0) {
    for (const cand of candidates) {
      const idx = info.lower.indexOf(cand.toLowerCase(), fromHint);
      if (idx !== -1) return idx;
    }
  }
  // 2) Sonst global suchen
  for (const cand of candidates) {
    const idx = info.lower.indexOf(cand.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

export interface ChapterPoint {
  title: string;
  offset: number;
}

/**
 * Baut aus sortierten Startpunkten fertige Kapitel (mit Text) zusammen.
 * Das erste Kapitel beginnt immer bei 0 (kein Text geht verloren); echte
 * Duplikate (nahezu identische Startpunkte, z. B. aus Block-Überlappungen)
 * werden zusammengeführt.
 */
export function buildChaptersFromPoints(text: string, points: ChapterPoint[]): Chapter[] {
  const valid = points
    .filter((p) => p.offset >= 0 && p.offset <= text.length)
    .sort((a, b) => a.offset - b.offset);

  const result: ChapterPoint[] = [];
  if (valid.length === 0) {
    result.push({ title: 'Text', offset: 0 });
  } else if (valid[0].offset > 600) {
    // Spürbarer Vorspann vor dem ersten erkannten Kapitel -> eigenes Kapitel
    result.push({ title: 'Anfang', offset: 0 });
    result.push(valid[0]);
  } else {
    // Kleinen Vorspann in das erste Kapitel aufnehmen (Start bei 0)
    result.push({ title: valid[0].title, offset: 0 });
  }
  for (let i = 1; i < valid.length; i++) {
    const last = result[result.length - 1];
    // nur echte Duplikate (fast identische Position) überspringen
    if (valid[i].offset - last.offset < 5) continue;
    result.push(valid[i]);
  }

  const chapters: Chapter[] = [];
  for (let i = 0; i < result.length; i++) {
    const start = result[i].offset;
    const end = i + 1 < result.length ? result[i + 1].offset : text.length;
    const chunk = text.slice(start, end).trim();
    if (!chunk) continue;
    chapters.push({
      id: makeId(),
      title: result[i].title.trim() || `Kapitel ${chapters.length + 1}`,
      start,
      end,
      text: chunk,
    });
  }

  return chapters.length > 0 ? chapters : [singleChapter(text)];
}

/** Erzeugt Kapitel aus KI-Markern. */
export function chaptersFromAiMarkers(text: string, markers: AiChapterMarker[]): Chapter[] {
  const info = normalize(text);
  const points: ChapterPoint[] = [];
  let hint = 0; // normalisierter Lesefortschritt
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
 * Dient als Fallback ohne KI bzw. wenn die KI nicht erreichbar ist.
 */
export function heuristicChapters(text: string): Chapter[] {
  const points: ChapterPoint[] = [];
  let offset = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineStart = offset;
    offset += line.length + 1; // +1 für das entfernte "\n"

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

  // Zu wenige Überschriften gefunden -> in gleichmäßige Abschnitte teilen
  if (points.length < 2) {
    return splitIntoSections(text);
  }
  return buildChaptersFromPoints(text, points);
}

function isMostlyCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, '');
  return upper.length / letters.length > 0.7;
}

/**
 * Teilt Text ohne erkennbare Kapitel in etwa gleich große Abschnitte
 * (an Absatzgrenzen), damit auch ohne KI angenehm gelesen werden kann.
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
    offset += para.length + 2; // +2 für den entfernten Absatztrenner
    if (wordsInSection >= targetWords) {
      wordsInSection = 0;
      sectionIndex++;
      atSectionStart = true;
    }
  }

  return buildChaptersFromPoints(text, points);
}
