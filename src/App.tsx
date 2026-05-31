import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { Book, BookMeta } from './lib/types';
import { useSettings } from './hooks/useSettings';
import { useSpeech } from './hooks/useSpeech';
import {
  getAllBooks,
  getBook,
  saveBook,
  deleteBook as dbDeleteBook,
  updateProgress,
  saveLastBookId,
  storageMode,
  type StorageMode,
} from './lib/storage';
import { extractPdf, ocrPdf } from './lib/pdf';
import { detectChapters, configureRateLimit } from './lib/gemini';
import { chaptersFromAiMarkers, heuristicChapters, makeId } from './lib/chapters';
import { countWords } from './lib/tokenize';
import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { SettingsPanel } from './components/SettingsPanel';
import { ImportOverlay } from './components/ImportOverlay';
import { ImportChoice, type ExtractMethod } from './components/ImportChoice';
import { Toasts, type ToastItem, type ToastType } from './components/Toasts';
import { IconGear, IconSparkles } from './components/Icons';

interface ImportState {
  active: boolean;
  title: string;
  stage: string;
  detail?: string;
  progress: number | null;
  ai?: boolean;
}

const IDLE_IMPORT: ImportState = { active: false, title: '', stage: '', progress: null };

export default function App() {
  const { settings, update } = useSettings();
  const speech = useSpeech();

  const [books, setBooks] = useState<BookMeta[]>([]);
  const [current, setCurrent] = useState<Book | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [importing, setImporting] = useState<ImportState>(IDLE_IMPORT);
  const [regliederBusy, setRegliederBusy] = useState(false);
  const [mode, setMode] = useState<StorageMode>('unbekannt');
  const [pending, setPending] = useState<File[] | null>(null);

  useLayoutEffect(() => {
    document.body.dataset.theme = settings.theme;
  }, [settings.theme]);

  // KI-Drosselung an die Einstellung koppeln (Schutz vor 429)
  useEffect(() => {
    configureRateLimit(settings.geminiRpm);
  }, [settings.geminiRpm]);

  const notify = useCallback((message: string, type: ToastType = 'info') => {
    const id = makeId();
    setToasts((t) => [...t, { id, message, type }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await getAllBooks();
      setBooks(list);
      setMode(storageMode());
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ---- PDF-Import ----
  const importOne = useCallback(
    async (file: File, method: ExtractMethod) => {
      const baseTitle = file.name.replace(/\.pdf$/i, '');
      const ocrProgress = (p: { page: number; total: number }) =>
        setImporting((s) => ({
          ...s,
          stage: 'Die KI liest die Seiten …',
          detail: `Seite ${p.page} von ${p.total}`,
          progress: p.total ? p.page / p.total : null,
          ai: true,
        }));

      try {
        let text = '';
        let pageCount = 0;
        let title: string | undefined;
        let author: string | undefined;

        if (method === 'ki') {
          setImporting({ active: true, title: baseTitle, stage: 'Die KI liest die Seiten …', progress: null, ai: true });
          const r = await ocrPdf(file, settings.apiKey.trim(), settings.model, ocrProgress);
          text = r.text;
          pageCount = r.pageCount;
          title = r.title;
          author = r.author;
        } else {
          setImporting({ active: true, title: baseTitle, stage: 'Text wird extrahiert …', progress: 0 });
          const r = await extractPdf(file, (p) =>
            setImporting((s) => ({
              ...s,
              stage: 'Text wird extrahiert …',
              detail: `Seite ${p.page} von ${p.total}`,
              progress: p.total ? p.page / p.total : null,
            })),
          );
          text = r.text;
          pageCount = r.pageCount;
          title = r.title;
          author = r.author;

          // Wenig Text trotz mehrerer Seiten -> OCR per KI anbieten
          const lowYield = text.trim().length < Math.max(80, pageCount * 40);
          if (lowYield && settings.apiKey.trim()) {
            const ok = window.confirm(
              `In „${(title && title.length > 1 ? title : baseTitle)}“ wurde wenig Text gefunden ` +
                `(${text.trim().length} Zeichen auf ${pageCount} Seite${pageCount === 1 ? '' : 'n'}). ` +
                `Soll stattdessen die KI die Seiten lesen? Das ist zuverlässiger, dauert aber etwas.`,
            );
            if (ok) {
              const ocr = await ocrPdf(file, settings.apiKey.trim(), settings.model, ocrProgress);
              if (ocr.text.trim().length > text.trim().length) text = ocr.text;
            }
          }
        }

        const bookTitle = (title && title.length > 1 ? title : baseTitle).trim();

        if (!text || text.trim().length < 20) {
          notify(
            settings.apiKey.trim()
              ? 'Aus diesem PDF ließ sich kein Text gewinnen.'
              : 'Aus diesem PDF ließ sich kaum Text gewinnen – vermutlich gescannt oder mit Spezialschriften. Hinterlege einen Gemini-Schlüssel und wähle „Genau lesen (KI)“.',
            'error',
          );
          setImporting(IDLE_IMPORT);
          return;
        }

        let chapters;
        let chapterSource: Book['chapterSource'] = 'heuristik';
        if (settings.apiKey.trim()) {
          try {
            setImporting({
              active: true,
              title: bookTitle,
              stage: 'Die KI gliedert das Buch in Kapitel …',
              detail: 'Das kann bei großen Büchern einen Moment dauern.',
              progress: null,
              ai: true,
            });
            const markers = await detectChapters(settings.apiKey.trim(), settings.model, text, (p) =>
              setImporting((s) => ({
                ...s,
                detail: p.total > 1 ? `Abschnitt ${p.step} von ${p.total}` : 'Analysiere …',
              })),
            );
            chapters = chaptersFromAiMarkers(text, markers);
            chapterSource = 'ki';
          } catch (e) {
            notify(
              'KI-Kapitel nicht möglich (' + (e instanceof Error ? e.message : 'Fehler') + '). Kapitel wurden geschätzt.',
              'error',
            );
            chapters = heuristicChapters(text);
          }
        } else {
          chapters = heuristicChapters(text);
        }

        if (chapters.length <= 1 && chapterSource !== 'ki') chapterSource = 'einzel';

        const book: Book = {
          id: makeId(),
          title: bookTitle,
          author,
          text,
          chapters,
          pageCount,
          wordCount: countWords(text),
          createdAt: Date.now(),
          chapterSource,
          progress: {},
        };

        setImporting({ active: true, title: bookTitle, stage: 'Wird gespeichert …', progress: null });
        await saveBook(book);
        setMode(storageMode());
        await refresh();
        setImporting(IDLE_IMPORT);
        notify(`„${bookTitle}“ importiert · ${chapters.length} Kapitel.`, 'success');
        setCurrent(book);
        saveLastBookId(book.id);
      } catch (e) {
        console.error(e);
        notify('Fehler beim Import: ' + (e instanceof Error ? e.message : 'Unbekannt'), 'error');
        setImporting(IDLE_IMPORT);
      }
    },
    [settings.apiKey, settings.model, notify, refresh],
  );

  const runImport = useCallback(
    async (files: File[], method: ExtractMethod) => {
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        await importOne(f, method);
      }
    },
    [importOne],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      // Mit Schlüssel: Methode wählen lassen (KI ist empfohlen).
      // Ohne Schlüssel: direkt die Textebene nutzen.
      if (settings.apiKey.trim()) setPending(files);
      else void runImport(files, 'text');
    },
    [settings.apiKey, runImport],
  );

  // ---- Buch öffnen / löschen / aktualisieren ----
  const openBook = useCallback(
    async (id: string) => {
      try {
        const b = await getBook(id);
        if (b) {
          setCurrent(b);
          saveLastBookId(id);
        } else {
          notify('Buch konnte nicht geladen werden.', 'error');
        }
      } catch (e) {
        notify('Buch konnte nicht geladen werden: ' + (e instanceof Error ? e.message : ''), 'error');
      }
    },
    [notify],
  );

  // Vollständiges Speichern (z. B. nach Neugliederung)
  const saveFullBook = useCallback((book: Book) => {
    setCurrent((cur) => (cur && cur.id === book.id ? book : cur));
    setBooks((list) =>
      list.map((m) =>
        m.id === book.id
          ? { ...m, chapterCount: book.chapters.length, chapterSource: book.chapterSource, lastChapterId: book.lastChapterId }
          : m,
      ),
    );
    void saveBook(book);
  }, []);

  // Leichtgewichtiges Speichern von Fortschritt / letztem Kapitel
  const persistProgress = useCallback(
    (id: string, patch: { progress?: Record<string, number>; lastChapterId?: string }) => {
      setCurrent((cur) =>
        cur && cur.id === id
          ? {
              ...cur,
              ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
              ...(patch.lastChapterId !== undefined ? { lastChapterId: patch.lastChapterId } : {}),
            }
          : cur,
      );
      setBooks((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
      void updateProgress(id, patch);
    },
    [],
  );

  const removeBook = useCallback(
    async (book: BookMeta) => {
      if (!window.confirm(`„${book.title}“ wirklich löschen?`)) return;
      await dbDeleteBook(book.id);
      if (current?.id === book.id) {
        setCurrent(null);
        saveLastBookId(null);
      }
      await refresh();
      notify('Buch gelöscht.', 'info');
    },
    [current, refresh, notify],
  );

  const regliedern = useCallback(async () => {
    if (!current) return;
    if (!settings.apiKey.trim()) {
      notify('Bitte zuerst einen Gemini-Schlüssel in den Einstellungen hinterlegen.', 'error');
      return;
    }
    setRegliederBusy(true);
    try {
      const markers = await detectChapters(settings.apiKey.trim(), settings.model, current.text);
      const chapters = chaptersFromAiMarkers(current.text, markers);
      const updated: Book = {
        ...current,
        chapters,
        chapterSource: 'ki',
        progress: {},
        lastChapterId: chapters[0]?.id,
      };
      saveFullBook(updated);
      notify(`Neu gegliedert · ${chapters.length} Kapitel.`, 'success');
    } catch (e) {
      notify('Gliederung fehlgeschlagen: ' + (e instanceof Error ? e.message : 'Fehler'), 'error');
    } finally {
      setRegliederBusy(false);
    }
  }, [current, settings.apiKey, settings.model, notify, saveFullBook]);

  const hasKey = settings.apiKey.trim().length > 0;

  return (
    <div className="app">
      {current ? (
        <Reader
          book={current}
          settings={settings}
          update={update}
          speech={speech}
          onPersist={(patch) => persistProgress(current.id, patch)}
          onExit={() => {
            setCurrent(null);
            saveLastBookId(null);
          }}
          onOpenSettings={() => setShowSettings(true)}
          onRegliedern={regliedern}
          regliederBusy={regliederBusy}
          hasKey={hasKey}
        />
      ) : (
        <>
          <header className="topbar">
            <button className="brand" onClick={() => setCurrent(null)}>
              <span className="logo">📖</span>
              <span className="title">
                <b>Leseprogramm</b>
                <span>ruhig lesen — Buch oder Fokus</span>
              </span>
            </button>
            <span className="spacer" />
            <span
              className="chip"
              title={
                mode === 'cloud'
                  ? 'Deine Bücher liegen auf Netlify Blobs (geräteübergreifend).'
                  : mode === 'lokal'
                    ? 'Functions nicht erreichbar – Speicherung lokal in diesem Browser.'
                    : ''
              }
            >
              {mode === 'cloud' ? '☁︎ Netlify' : mode === 'lokal' ? '⌂ Lokal' : '…'}
            </span>
            <span className={`chip ${hasKey ? 'ok' : 'warn'}`}>
              <IconSparkles width={14} height={14} />
              {hasKey ? 'KI bereit' : 'Kein Schlüssel'}
            </span>
            <button className="btn icon ghost" onClick={() => setShowSettings(true)} aria-label="Einstellungen">
              <IconGear />
            </button>
          </header>
          <main className="content">
            <Library
              books={books}
              hasKey={hasKey}
              onOpen={openBook}
              onDelete={removeBook}
              onFiles={handleFiles}
            />
          </main>
        </>
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          update={update}
          speech={speech}
          notify={notify}
          onClose={() => setShowSettings(false)}
        />
      )}

      {pending && (
        <ImportChoice
          fileName={pending[0]?.name.replace(/\.pdf$/i, '') || ''}
          count={pending.length}
          hasKey={hasKey}
          onChoose={(method: ExtractMethod) => {
            const files = pending;
            setPending(null);
            void runImport(files, method);
          }}
          onClose={() => setPending(null)}
        />
      )}

      {importing.active && (
        <ImportOverlay
          title={importing.title}
          stage={importing.stage}
          detail={importing.detail}
          progress={importing.progress}
          ai={importing.ai}
        />
      )}

      <Toasts items={toasts} onClose={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
