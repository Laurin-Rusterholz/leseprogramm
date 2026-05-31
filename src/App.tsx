import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { Book } from './lib/types';
import { useSettings } from './hooks/useSettings';
import { useSpeech } from './hooks/useSpeech';
import {
  getAllBooks,
  getBook,
  saveBook,
  deleteBook as dbDeleteBook,
  saveLastBookId,
} from './lib/storage';
import { extractPdf } from './lib/pdf';
import { detectChapters } from './lib/gemini';
import {
  chaptersFromAiMarkers,
  heuristicChapters,
  makeId,
} from './lib/chapters';
import { countWords } from './lib/tokenize';
import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { SettingsPanel } from './components/SettingsPanel';
import { ImportOverlay } from './components/ImportOverlay';
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

  const [books, setBooks] = useState<Book[]>([]);
  const [current, setCurrent] = useState<Book | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [importing, setImporting] = useState<ImportState>(IDLE_IMPORT);
  const [regliederBusy, setRegliederBusy] = useState(false);

  // Theme auf <body> spiegeln
  useLayoutEffect(() => {
    document.body.dataset.theme = settings.theme;
  }, [settings.theme]);

  const notify = useCallback((message: string, type: ToastType = 'info') => {
    const id = makeId();
    setToasts((t) => [...t, { id, message, type }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setBooks(await getAllBooks());
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ---- PDF-Import ----
  const importOne = useCallback(
    async (file: File) => {
      try {
        setImporting({
          active: true,
          title: file.name.replace(/\.pdf$/i, ''),
          stage: 'PDF wird gelesen …',
          progress: 0,
        });

        const { text, pageCount, title, author } = await extractPdf(file, (p) => {
          setImporting((s) => ({
            ...s,
            stage: 'Text wird extrahiert …',
            detail: `Seite ${p.page} von ${p.total}`,
            progress: p.total ? p.page / p.total : null,
          }));
        });

        if (!text || text.trim().length < 20) {
          notify(
            'Aus diesem PDF ließ sich kaum Text gewinnen. Vermutlich ein gescanntes Bild-PDF ohne Textebene.',
            'error',
          );
          setImporting(IDLE_IMPORT);
          return;
        }

        const bookTitle = (title && title.length > 1 ? title : file.name.replace(/\.pdf$/i, '')).trim();
        const id = makeId();
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
            const markers = await detectChapters(
              settings.apiKey.trim(),
              settings.model,
              text,
              (p) =>
                setImporting((s) => ({
                  ...s,
                  detail: p.total > 1 ? `Abschnitt ${p.step} von ${p.total}` : 'Analysiere …',
                })),
            );
            chapters = chaptersFromAiMarkers(text, markers);
            chapterSource = 'ki';
          } catch (e) {
            notify(
              'KI-Kapitel nicht möglich (' +
                (e instanceof Error ? e.message : 'Fehler') +
                '). Kapitel wurden automatisch geschätzt.',
              'error',
            );
            chapters = heuristicChapters(text);
          }
        } else {
          chapters = heuristicChapters(text);
        }

        if (chapters.length <= 1 && chapterSource !== 'ki') chapterSource = 'einzel';

        const book: Book = {
          id,
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

        await saveBook(book);
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

  const handleFiles = useCallback(
    async (files: File[]) => {
      for (const f of files) {
        // sequentiell, damit Fortschritt sauber angezeigt wird
        // eslint-disable-next-line no-await-in-loop
        await importOne(f);
      }
    },
    [importOne],
  );

  // ---- Buch öffnen / löschen / aktualisieren ----
  const openBook = useCallback(async (id: string) => {
    const b = await getBook(id);
    if (b) {
      setCurrent(b);
      saveLastBookId(id);
    }
  }, []);

  const updateBook = useCallback((book: Book) => {
    setCurrent((cur) => (cur && cur.id === book.id ? book : cur));
    setBooks((list) => list.map((b) => (b.id === book.id ? book : b)));
    void saveBook(book);
  }, []);

  const removeBook = useCallback(
    async (book: Book) => {
      if (!window.confirm(`„${book.title}“ wirklich aus der Bibliothek löschen?`)) return;
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
      updateBook(updated);
      notify(`Neu gegliedert · ${chapters.length} Kapitel.`, 'success');
    } catch (e) {
      notify('Gliederung fehlgeschlagen: ' + (e instanceof Error ? e.message : 'Fehler'), 'error');
    } finally {
      setRegliederBusy(false);
    }
  }, [current, settings.apiKey, settings.model, notify, updateBook]);

  const hasKey = settings.apiKey.trim().length > 0;

  return (
    <div className="app">
      {current ? (
        <Reader
          book={current}
          settings={settings}
          update={update}
          speech={speech}
          onUpdateBook={updateBook}
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
