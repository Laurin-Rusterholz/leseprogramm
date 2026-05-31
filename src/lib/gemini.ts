// Anbindung an Google Gemini (Generative Language API) direkt aus dem Browser.
// Der API-Key wird vom Nutzer im Frontend eingegeben.
import type { AiChapterMarker } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

function friendlyError(status: number, raw: string): GeminiError {
  let message = raw;
  try {
    const json = JSON.parse(raw);
    message = json?.error?.message || raw;
  } catch {
    /* raw belassen */
  }
  if (status === 400 && /api key not valid/i.test(message)) {
    return new GeminiError('Der API-Schlüssel ist ungültig. Bitte prüfe ihn in den Einstellungen.', status);
  }
  if (status === 429) {
    return new GeminiError('Limit erreicht (zu viele Anfragen). Bitte kurz warten und erneut versuchen.', status);
  }
  if (status === 403) {
    return new GeminiError('Zugriff verweigert. Ist die "Generative Language API" für deinen Schlüssel aktiviert?', status);
  }
  if (status === 404) {
    return new GeminiError('Modell nicht gefunden. Wähle in den Einstellungen ein anderes Gemini-Modell.', status);
  }
  return new GeminiError(message || `Fehler ${status}`, status);
}

export interface GeminiModelInfo {
  name: string;
  displayName: string;
}

/** Verfügbare Modelle abrufen, die Inhalte generieren können. */
export async function listModels(apiKey: string): Promise<GeminiModelInfo[]> {
  const res = await fetch(`${BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`);
  if (!res.ok) throw friendlyError(res.status, await res.text());
  const data = await res.json();
  const models = (data.models || []) as Array<{
    name: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
  return models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      name: m.name.replace(/^models\//, ''),
      displayName: m.displayName || m.name.replace(/^models\//, ''),
    }))
    .filter((m) => /gemini/i.test(m.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface GenerateOptions {
  responseSchema?: unknown;
  temperature?: number;
  signal?: AbortSignal;
}

/** Einen einzelnen generateContent-Aufruf durchführen und Text zurückgeben. */
export async function generateText(
  apiKey: string,
  model: string,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      ...(opts.responseSchema
        ? { responseMimeType: 'application/json', responseSchema: opts.responseSchema }
        : {}),
    },
  };

  const res = await fetch(
    `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    },
  );

  if (!res.ok) throw friendlyError(res.status, await res.text());
  const data = await res.json();

  const candidate = data.candidates?.[0];
  if (!candidate) {
    if (data.promptFeedback?.blockReason) {
      throw new GeminiError('Die Anfrage wurde vom Modell blockiert: ' + data.promptFeedback.blockReason);
    }
    throw new GeminiError('Keine Antwort vom Modell erhalten.');
  }
  const parts = candidate.content?.parts || [];
  return parts.map((p: { text?: string }) => p.text || '').join('');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Liest den Text einer Seite per Gemini-Vision aus einem (JPEG-)Bild aus.
 * Dient als OCR-Fallback für gescannte PDFs ohne Textebene.
 */
export async function ocrImage(
  apiKey: string,
  model: string,
  base64Image: string,
  mimeType = 'image/jpeg',
  signal?: AbortSignal,
): Promise<string> {
  if (!apiKey) throw new GeminiError('Kein API-Schlüssel hinterlegt.');
  const prompt =
    'Dies ist das Bild einer Buchseite. Gib ausschließlich den fortlaufenden ' +
    'Lesetext der Seite exakt wieder – ohne Kopf-/Fußzeilen, Seitenzahlen oder ' +
    'Kommentare. Behalte Absätze bei und trenne sie durch eine Leerzeile. ' +
    'Steht eine Kapitelüberschrift auf der Seite, gib sie als eigene Zeile aus. ' +
    'Ist die Seite leer oder enthält keinen Text, antworte mit nichts.';
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }],
      },
    ],
    generationConfig: { temperature: 0 },
  };

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      },
    );
    if (res.status === 429 && attempt < 4) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw friendlyError(res.status, await res.text());
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map((p: { text?: string }) => p.text || '').join('');
  }
}

const CHAPTER_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      start_marker: { type: 'STRING' },
    },
    required: ['title', 'start_marker'],
  },
};

// Sehr große Texte werden in Blöcke geteilt (fast nie nötig – die meisten
// Bücher passen in einen Aufruf).
const SINGLE_CALL_LIMIT = 1_500_000;
const CHUNK_SIZE = 1_200_000;
const CHUNK_OVERLAP = 3_000;

function buildPrompt(text: string, part?: { index: number; total: number }): string {
  const intro =
    part && part.total > 1
      ? `Dies ist Teil ${part.index} von ${part.total} eines längeren Buchtextes. ` +
        `Gib nur Kapitel zurück, die in DIESEM Teil beginnen.\n\n`
      : '';
  return (
    `Du bist ein erfahrener Lektor. Analysiere den folgenden Buchtext und ermittle seine Kapitelstruktur.\n` +
    intro +
    `Gib ein JSON-Array zurück. Jedes Element beschreibt ein Kapitel mit:\n` +
    `- "title": ein aussagekräftiger Kapiteltitel. Übernimm vorhandene Überschriften möglichst wörtlich; ` +
    `gibt es keine, formuliere einen kurzen, treffenden Titel.\n` +
    `- "start_marker": die ERSTEN 6 bis 12 Wörter des Kapitels, WÖRTLICH und EXAKT aus dem Text kopiert ` +
    `(gleiche Schreibweise, gleiche Zeichen), damit die Textstelle eindeutig wiedergefunden werden kann. ` +
    `Erfinde nichts und paraphrasiere nicht.\n\n` +
    `Hinweise: Berücksichtige Vorwort, Prolog, Einleitung, Epilog und Nachwort als eigene Kapitel, falls vorhanden. ` +
    `Ignoriere Seitenzahlen sowie Kopf- und Fußzeilen. Ein Inhaltsverzeichnis dient nur als Hinweis, ist aber kein Kapitelanfang. ` +
    `Gibt es keine klaren Kapitel, teile den Text in sinnvolle, etwa gleich lange Abschnitte mit beschreibenden Titeln.\n` +
    `Antworte ausschließlich mit dem JSON-Array.\n\n` +
    `=== BUCHTEXT ===\n` +
    text
  );
}

function parseMarkers(raw: string): AiChapterMarker[] {
  let txt = raw.trim();
  // Eventuelle Code-Fences entfernen
  txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(txt);
  } catch {
    // Versuche, das erste JSON-Array herauszuschneiden
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) throw new GeminiError('Antwort der KI konnte nicht als JSON gelesen werden.');
    parsed = JSON.parse(m[0]);
  }
  if (!Array.isArray(parsed)) throw new GeminiError('Unerwartetes Antwortformat der KI.');
  return parsed
    .filter((x): x is AiChapterMarker => !!x && typeof x.title === 'string' && typeof x.start_marker === 'string')
    .map((x) => ({ title: x.title, start_marker: x.start_marker }));
}

export interface DetectProgress {
  step: number;
  total: number;
}

/**
 * Erkennt die Kapitel eines Buches mit Gemini. Liefert die Marker in
 * Lesereihenfolge; die genaue Positionierung übernimmt `chaptersFromAiMarkers`.
 */
export async function detectChapters(
  apiKey: string,
  model: string,
  text: string,
  onProgress?: (p: DetectProgress) => void,
  signal?: AbortSignal,
): Promise<AiChapterMarker[]> {
  if (!apiKey) throw new GeminiError('Kein API-Schlüssel hinterlegt.');

  if (text.length <= SINGLE_CALL_LIMIT) {
    onProgress?.({ step: 1, total: 1 });
    const raw = await generateText(apiKey, model, buildPrompt(text), {
      responseSchema: CHAPTER_SCHEMA,
      signal,
    });
    return parseMarkers(raw);
  }

  // Große Bücher in überlappende Blöcke teilen
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  const all: AiChapterMarker[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({ step: i + 1, total: chunks.length });
    const raw = await generateText(apiKey, model, buildPrompt(chunks[i], { index: i + 1, total: chunks.length }), {
      responseSchema: CHAPTER_SCHEMA,
      signal,
    });
    all.push(...parseMarkers(raw));
  }
  return all;
}
