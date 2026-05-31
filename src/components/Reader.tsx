import { useMemo, useState } from 'react';
import type { Book, Settings } from '../lib/types';
import type { useSpeech } from '../hooks/useSpeech';
import { BookView } from './BookView';
import { FocusReader } from './FocusReader';
import {
  IconArrowLeft,
  IconList,
  IconBook,
  IconFocus,
  IconGear,
  IconClose,
  IconSparkles,
  IconCheck,
} from './Icons';
import { countWords } from '../lib/tokenize';

type Speech = ReturnType<typeof useSpeech>;

export function Reader({
  book,
  settings,
  update,
  speech,
  onPersist,
  onExit,
  onOpenSettings,
  onRegliedern,
  regliederBusy,
  hasKey,
}: {
  book: Book;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  speech: Speech;
  onPersist: (patch: { progress?: Record<string, number>; lastChapterId?: string }) => void;
  onExit: () => void;
  onOpenSettings: () => void;
  onRegliedern: () => void;
  regliederBusy: boolean;
  hasKey: boolean;
}) {
  const initialIndex = useMemo(() => {
    const i = book.chapters.findIndex((c) => c.id === book.lastChapterId);
    return i >= 0 ? i : 0;
  }, [book]);

  const [chapterIndex, setChapterIndex] = useState(initialIndex);
  const [mode, setMode] = useState<'buch' | 'fokus'>('buch');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const chapter = book.chapters[chapterIndex] ?? book.chapters[0];

  const goChapter = (i: number) => {
    const clamped = Math.min(Math.max(0, i), book.chapters.length - 1);
    setChapterIndex(clamped);
    onPersist({ lastChapterId: book.chapters[clamped].id });
  };

  const saveProgress = (wordIndex: number) => {
    const progress = { ...(book.progress || {}), [chapter.id]: wordIndex };
    onPersist({ progress, lastChapterId: chapter.id });
  };

  const startIndex = book.progress?.[chapter.id] ?? 0;

  return (
    <div className="reader" data-theme={settings.theme}>
      <div className="reader-bar">
        <button className="btn icon ghost" onClick={onExit} aria-label="Zur Bibliothek">
          <IconArrowLeft />
        </button>
        <button className="btn icon ghost" onClick={() => setDrawerOpen(true)} aria-label="Kapitel">
          <IconList />
        </button>
        <div className="book-title">
          {book.title}
          <small>
            Kap. {chapterIndex + 1}/{book.chapters.length} · {chapter.title}
          </small>
        </div>
        <div className="mode-toggle" role="group" aria-label="Lesemodus">
          <button
            className={mode === 'buch' ? 'active' : ''}
            onClick={() => setMode('buch')}
          >
            <IconBook /> <span>Buch</span>
          </button>
          <button
            className={mode === 'fokus' ? 'active' : ''}
            onClick={() => setMode('fokus')}
          >
            <IconFocus /> <span>Fokus</span>
          </button>
        </div>
        <button className="btn icon ghost" onClick={onOpenSettings} aria-label="Einstellungen">
          <IconGear />
        </button>
      </div>

      {mode === 'buch' && (
        <BookView
          key={chapter.id}
          chapter={chapter}
          chapterNumber={chapterIndex + 1}
          chapterTotal={book.chapters.length}
          settings={settings}
          speech={speech}
          hasPrev={chapterIndex > 0}
          hasNext={chapterIndex < book.chapters.length - 1}
          onPrev={() => goChapter(chapterIndex - 1)}
          onNext={() => goChapter(chapterIndex + 1)}
        />
      )}

      {mode === 'fokus' && (
        <FocusReader
          key={chapter.id}
          chapter={chapter}
          chapterNumber={chapterIndex + 1}
          settings={settings}
          update={update}
          speech={speech}
          startIndex={startIndex}
          hasNext={chapterIndex < book.chapters.length - 1}
          onProgress={saveProgress}
          onExit={() => setMode('buch')}
          onNextChapter={() => goChapter(chapterIndex + 1)}
        />
      )}

      {drawerOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <aside className="drawer">
            <header>
              <h3>Kapitel</h3>
              <button
                className="btn icon ghost"
                onClick={() => setDrawerOpen(false)}
                aria-label="Schließen"
              >
                <IconClose />
              </button>
            </header>
            <div style={{ padding: '0 14px 12px' }}>
              <button
                className="btn small"
                style={{ width: '100%' }}
                onClick={onRegliedern}
                disabled={regliederBusy || !hasKey}
                title={hasKey ? '' : 'Dafür einen Gemini-Schlüssel in den Einstellungen hinterlegen'}
              >
                {regliederBusy ? <span className="spinner" /> : <IconSparkles width={16} height={16} />}
                {regliederBusy ? 'KI gliedert…' : 'Kapitel neu mit KI gliedern'}
              </button>
            </div>
            <div className="chapters">
              {book.chapters.map((c, i) => (
                <button
                  key={c.id}
                  className={`chapter-item ${i === chapterIndex ? 'active' : ''}`}
                  onClick={() => {
                    goChapter(i);
                    setDrawerOpen(false);
                  }}
                >
                  <span className="num">{i + 1}</span>
                  <span className="ct">
                    {c.title}
                    {i === chapterIndex && <IconCheck width={14} height={14} style={{ marginLeft: 6, verticalAlign: '-2px', color: 'var(--accent)' }} />}
                  </span>
                  <span className="cw">{Math.round(countWords(c.text) / 100) / 10}k</span>
                </button>
              ))}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
