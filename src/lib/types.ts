// Zentrale Datentypen der App

export interface Chapter {
  id: string;
  title: string;
  /** Zeichen-Offset im Gesamttext, an dem das Kapitel beginnt */
  start: number;
  /** Zeichen-Offset (exklusiv), an dem das Kapitel endet */
  end: number;
  text: string;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  /** Vollständiger, extrahierter Text */
  text: string;
  chapters: Chapter[];
  pageCount: number;
  wordCount: number;
  createdAt: number;
  /** Wie wurden die Kapitel erzeugt? */
  chapterSource: 'ki' | 'heuristik' | 'einzel';
  /** Fortschritt pro Kapitel: zuletzt gelesener Wort-Index (Fokus-Modus) */
  progress?: Record<string, number>;
  /** Zuletzt geöffnetes Kapitel */
  lastChapterId?: string;
}

/** Schlanke Metadaten für die Bibliotheksübersicht (ohne den großen Buchtext). */
export interface BookMeta {
  id: string;
  title: string;
  author?: string;
  wordCount: number;
  pageCount: number;
  chapterCount: number;
  createdAt: number;
  chapterSource: 'ki' | 'heuristik' | 'einzel';
  lastChapterId?: string;
  progress?: Record<string, number>;
}

export type ReadingMode = 'buch' | 'fokus';

export interface Settings {
  apiKey: string;
  model: string;
  /** Max. KI-Anfragen pro Minute (Schutz vor Rate-Limits/429) */
  geminiRpm: number;
  // Fokus-Modus (RSVP)
  wpm: number;
  /** Zusätzliche Pause an Satzzeichen (Faktor) */
  punctuationPause: number;
  /** Lange Wörter etwas länger zeigen */
  longWordPause: boolean;
  /** Optischen Fixpunkt (ORP) hervorheben */
  showOrp: boolean;
  /** Kontextwörter (vorher/nachher) blass anzeigen */
  showContext: boolean;
  // Buchansicht
  fontScale: number;
  lineHeight: number;
  // Vorlesen / TTS
  ttsEnabled: boolean;
  voiceURI: string;
  ttsRate: number;
  ttsPitch: number;
  // Darstellung
  theme: 'warm' | 'sepia' | 'nacht';
}

export interface AiChapterMarker {
  title: string;
  /** Wörtliches Textzitat vom Kapitelanfang, um die Position zu finden */
  start_marker: string;
}
