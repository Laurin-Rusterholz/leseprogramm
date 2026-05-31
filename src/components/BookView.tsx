import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Chapter, Settings } from '../lib/types';
import { splitSentences } from '../lib/tokenize';
import type { useSpeech } from '../hooks/useSpeech';
import { IconPlay, IconPause, IconClose, IconSpeaker, IconChevronLeft, IconChevronRight } from './Icons';

type Speech = ReturnType<typeof useSpeech>;

export function BookView({
  chapter,
  chapterNumber,
  chapterTotal,
  settings,
  speech,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  chapter: Chapter;
  chapterNumber: number;
  chapterTotal: number;
  settings: Settings;
  speech: Speech;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const sentences = useMemo(() => splitSentences(chapter.text), [chapter.text]);

  // Sätze zu Absätzen gruppieren (Leerzeile = neuer Absatz)
  const paragraphs = useMemo(() => {
    const paras: number[][] = [];
    let cur: number[] = [];
    for (let i = 0; i < sentences.length; i++) {
      cur.push(i);
      const next = sentences[i + 1];
      const gap = next ? chapter.text.slice(sentences[i].end, next.start) : '';
      if (!next || /\n\s*\n/.test(gap)) {
        paras.push(cur);
        cur = [];
      }
    }
    return paras;
  }, [sentences, chapter.text]);

  const [active, setActive] = useState(-1);
  const [reading, setReading] = useState(false);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoStartedFor = useRef<string>('');

  const stop = () => {
    speech.cancel();
    setReading(false);
    setPaused(false);
    setActive(-1);
  };

  const start = () => {
    if (!speech.supported || sentences.length === 0) return;
    setReading(true);
    setPaused(false);
    setActive(0);
    speech.speak(
      sentences.map((s) => s.text),
      {
        voiceURI: settings.voiceURI || undefined,
        rate: settings.ttsRate,
        pitch: settings.ttsPitch,
        lang: 'de-DE',
        onSegmentStart: (i) => setActive(i),
        onDone: (finished) => {
          setReading(false);
          setPaused(false);
          if (finished) setActive(-1);
        },
      },
    );
  };

  // Beim Kapitelwechsel zurücksetzen; bei aktivierter Sprachausgabe automatisch starten
  useEffect(() => {
    stop();
    scrollRef.current?.scrollTo({ top: 0 });
    if (settings.ttsEnabled && speech.supported && autoStartedFor.current !== chapter.id) {
      autoStartedFor.current = chapter.id;
      // kleiner Versuch eines Autostarts (klappt nach erster Nutzerinteraktion)
      const t = setTimeout(start, 300);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);

  // aktiven Satz sichtbar halten
  useEffect(() => {
    if (active < 0) return;
    const el = scrollRef.current?.querySelector(`[data-si="${active}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  const togglePlay = () => {
    if (!reading) start();
    else if (paused) {
      speech.resume();
      setPaused(false);
    } else {
      speech.pause();
      setPaused(true);
    }
  };

  return (
    <div
      className="book-scroll"
      ref={scrollRef}
      style={
        {
          '--font-scale': settings.fontScale,
          '--line-height': settings.lineHeight,
        } as CSSProperties
      }
    >
      <article className="book-col">
        <header className="chapter-head">
          <div className="kicker">
            Kapitel {chapterNumber} von {chapterTotal}
          </div>
          <h1>{chapter.title}</h1>
        </header>

        <div className="book-text">
          {paragraphs.map((para, pi) => (
            <p key={pi} className={pi === 0 ? 'drop' : undefined}>
              {para.map((si, k) => (
                <span key={si}>
                  <span className={`sent ${active === si ? 'active' : ''}`} data-si={si}>
                    {sentences[si].text}
                  </span>
                  {k < para.length - 1 ? ' ' : ''}
                </span>
              ))}
            </p>
          ))}
        </div>

        <nav className="chapter-nav">
          <button className="btn" onClick={onPrev} disabled={!hasPrev}>
            <IconChevronLeft /> Vorheriges
          </button>
          <button className="btn" onClick={onNext} disabled={!hasNext}>
            Nächstes <IconChevronRight />
          </button>
        </nav>
      </article>

      {speech.supported && (
        <div className="read-bar">
          <button
            className="btn icon primary"
            onClick={togglePlay}
            aria-label={reading && !paused ? 'Pause' : 'Vorlesen'}
          >
            {reading && !paused ? <IconPause /> : <IconPlay />}
          </button>
          {reading ? (
            <>
              <span className="rb-progress">
                Satz {Math.min(active + 1, sentences.length)} / {sentences.length}
              </span>
              <button className="btn icon ghost" onClick={stop} aria-label="Vorlesen beenden">
                <IconClose />
              </button>
            </>
          ) : (
            <span className="rb-progress" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconSpeaker width={15} height={15} /> Vorlesen
            </span>
          )}
        </div>
      )}
    </div>
  );
}
