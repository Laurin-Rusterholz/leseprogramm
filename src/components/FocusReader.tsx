import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chapter, Settings } from '../lib/types';
import { buildReadingModel } from '../lib/reading';
import { estimateSeconds, formatDuration } from '../lib/tokenize';
import { useFullscreen } from '../hooks/useFullscreen';
import type { useSpeech } from '../hooks/useSpeech';
import {
  IconPlay,
  IconPause,
  IconBack,
  IconForward,
  IconRestart,
  IconClose,
  IconExpand,
  IconSpeaker,
  IconSpeakerOff,
  IconMinus,
  IconPlus,
  IconCheck,
  IconChevronRight,
} from './Icons';

type Speech = ReturnType<typeof useSpeech>;
type Status = 'idle' | 'countdown' | 'playing' | 'paused' | 'done';

export function FocusReader({
  chapter,
  chapterNumber,
  settings,
  update,
  speech,
  startIndex,
  hasNext,
  onProgress,
  onExit,
  onNextChapter,
}: {
  chapter: Chapter;
  chapterNumber: number;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  speech: Speech;
  startIndex: number;
  hasNext: boolean;
  onProgress: (index: number) => void;
  onExit: () => void;
  onNextChapter: () => void;
}) {
  const model = useMemo(
    () => buildReadingModel(chapter.text, settings.longWordPause),
    [chapter.text, settings.longWordPause],
  );
  const tokens = model.tokens;
  const total = tokens.length;

  const clampStart = Math.min(Math.max(0, startIndex), Math.max(0, total - 1));
  const [index, setIndexState] = useState(clampStart);
  const [status, setStatus] = useState<Status>('idle');
  const [countdown, setCountdown] = useState(3);
  const [voiceOn, setVoiceOn] = useState(settings.ttsEnabled && speech.supported);
  const [immersed, setImmersed] = useState(false);

  const fs = useFullscreen();
  const rootRef = useRef<HTMLDivElement>(null);

  // Refs für die zeitkritische Steuerung (vermeiden veraltete Closures)
  const indexRef = useRef(index);
  const playingRef = useRef(false);
  const wpmRef = useRef(settings.wpm);
  const voiceOnRef = useRef(voiceOn);
  const wordTimer = useRef<number | null>(null);
  const spokenSentenceRef = useRef(-1);
  const immerseTimer = useRef<number | null>(null);

  wpmRef.current = settings.wpm;
  voiceOnRef.current = voiceOn;

  const totalRef = useRef(total);
  totalRef.current = total;
  const setIndex = useCallback((i: number) => {
    const clamped = Math.min(Math.max(0, i), Math.max(0, totalRef.current - 1));
    indexRef.current = clamped;
    setIndexState(clamped);
  }, []);

  const clearWordTimer = () => {
    if (wordTimer.current !== null) {
      clearTimeout(wordTimer.current);
      wordTimer.current = null;
    }
  };

  const finish = useCallback(() => {
    playingRef.current = false;
    clearWordTimer();
    speech.cancel();
    setIndex(totalRef.current - 1);
    setStatus('done');
    onProgress(totalRef.current - 1);
  }, [speech, setIndex, onProgress]);

  // Sprechgeschwindigkeit aus der WpM ableiten, damit die Stimme so schnell
  // liest, wie die Wörter angezeigt werden (rate 1 ≈ ~165 WpM bei den meisten Stimmen).
  const rateForWpm = (wpm: number) => Math.min(4, Math.max(0.5, wpm / 165));

  // Liest ab Token i bis zum Satzende vor (bei Satzwechsel bzw. beim Fortsetzen).
  const speakFromToken = useCallback(
    (i: number) => {
      if (!voiceOnRef.current || !speech.supported) return;
      const sentenceIdx = model.tokenToSentence[i] ?? 0;
      spokenSentenceRef.current = sentenceIdx;
      const s = model.sentences[sentenceIdx];
      const startTok = model.tokens[i];
      const lastTok = s ? model.tokens[s.last] : undefined;
      if (!s || !startTok || !lastTok) return;
      const segment = chapter.text.slice(startTok.offset, lastTok.offset + lastTok.text.length).trim();
      if (!segment) return;
      speech.speak([segment], {
        voiceURI: settings.voiceURI || undefined,
        rate: rateForWpm(wpmRef.current),
        pitch: settings.ttsPitch,
        lang: 'de-DE',
      });
    },
    [model, speech, settings.voiceURI, settings.ttsPitch, chapter.text],
  );

  // Der WpM-Takt steuert die Anzeige (in beiden Modi). Bei aktivierter Stimme
  // wird beim Eintritt in einen neuen Satz dieser Satz vorgelesen – mit einer
  // Rate, die zur WpM passt, sodass Stimme und Anzeige gleich schnell laufen.
  const scheduleWpm = useCallback(() => {
    clearWordTimer();
    const i = indexRef.current;
    const delay = (60000 / wpmRef.current) * (tokens[i]?.delay ?? 1);
    if (i >= total - 1) {
      // letztes Wort noch für seine Dauer stehen lassen, dann beenden
      wordTimer.current = window.setTimeout(() => finish(), delay);
      return;
    }
    wordTimer.current = window.setTimeout(() => {
      const next = indexRef.current + 1;
      setIndex(next);
      if (voiceOnRef.current && model.tokenToSentence[next] !== spokenSentenceRef.current) {
        speakFromToken(next);
      }
      if (playingRef.current) scheduleWpm();
    }, delay);
  }, [tokens, total, setIndex, finish, model, speakFromToken]);

  const beginPlay = useCallback(() => {
    playingRef.current = true;
    setStatus('playing');
    if (voiceOnRef.current && speech.supported) speakFromToken(indexRef.current);
    scheduleWpm();
  }, [scheduleWpm, speakFromToken, speech.supported]);

  const play = useCallback(() => {
    if (status === 'done' || indexRef.current >= total - 1) {
      setIndex(0);
    }
    if (voiceOnRef.current && speech.supported) {
      // Sofort starten – die Sprachausgabe muss aus der Nutzergeste heraus
      // beginnen, sonst blockiert sie iOS/iPadOS.
      beginPlay();
    } else {
      // Kurzer Countdown beim Start des reinen Lesemodus
      setStatus('countdown');
      setCountdown(3);
    }
  }, [status, total, setIndex, beginPlay, speech.supported]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setStatus('paused');
    clearWordTimer();
    if (voiceOnRef.current) speech.cancel();
    onProgress(indexRef.current);
  }, [speech, onProgress]);

  const resume = useCallback(() => {
    playingRef.current = true;
    setStatus('playing');
    if (voiceOnRef.current && speech.supported) speakFromToken(indexRef.current);
    scheduleWpm();
  }, [speech.supported, scheduleWpm, speakFromToken]);

  const togglePlay = useCallback(() => {
    if (status === 'playing') pause();
    else if (status === 'paused') resume();
    else if (status === 'idle' || status === 'done') play();
  }, [status, pause, resume, play]);

  const step = useCallback(
    (delta: number) => {
      setIndex(indexRef.current + delta);
      onProgress(indexRef.current);
      // Bei laufender Wiedergabe mit Stimme die Audio-Position mitziehen
      if (playingRef.current && voiceOnRef.current) speakFromToken(indexRef.current);
    },
    [setIndex, onProgress, speakFromToken],
  );

  const handleExit = useCallback(() => {
    playingRef.current = false;
    clearWordTimer();
    speech.cancel();
    onProgress(indexRef.current);
    fs.exit();
    onExit();
  }, [speech, onProgress, fs, onExit]);

  // Countdown ablaufen lassen
  useEffect(() => {
    if (status !== 'countdown') return;
    if (countdown <= 0) {
      beginPlay();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [status, countdown, beginPlay]);

  // Tastatursteuerung
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          step(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          step(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          update({ wpm: Math.min(1000, settings.wpm + 25) });
          break;
        case 'ArrowDown':
          e.preventDefault();
          update({ wpm: Math.max(100, settings.wpm - 25) });
          break;
        case 'Escape':
          e.preventDefault();
          handleExit();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlay, step, settings.wpm, update]);

  // Bedienelemente automatisch ausblenden, während gelesen wird
  useEffect(() => {
    if (status !== 'playing') {
      setImmersed(false);
      if (immerseTimer.current) clearTimeout(immerseTimer.current);
      return;
    }
    const arm = () => {
      setImmersed(false);
      if (immerseTimer.current) clearTimeout(immerseTimer.current);
      immerseTimer.current = window.setTimeout(() => setImmersed(true), 2600);
    };
    arm();
    window.addEventListener('pointermove', arm);
    return () => {
      window.removeEventListener('pointermove', arm);
      if (immerseTimer.current) clearTimeout(immerseTimer.current);
    };
  }, [status]);

  // Aufräumen beim Verlassen
  useEffect(() => {
    return () => {
      clearWordTimer();
      speech.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartGesture = () => {
    // Vollbild nur auf direkte Nutzeraktion anfordern (iPad/Desktop)
    if (!fs.isFullscreen) fs.enter(rootRef.current);
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    if (status === 'playing') {
      // Wiedergabe für sauberen Moduswechsel anhalten
      pause();
    }
    speech.cancel();
    clearWordTimer();
    spokenSentenceRef.current = -1;
    setVoiceOn(next);
    voiceOnRef.current = next;
  };

  const cur = tokens[index];
  const progress = total > 1 ? index / (total - 1) : 1;
  const remaining = estimateSeconds(total - index, settings.wpm);

  const prevWords = tokens
    .slice(Math.max(0, index - 3), index)
    .map((t) => t.text)
    .join(' ');
  const nextWords = tokens
    .slice(index + 1, index + 4)
    .map((t) => t.text)
    .join(' ');

  return (
    <div
      ref={rootRef}
      className={`focus ${immersed ? 'immersed' : ''}`}
      data-theme={settings.theme}
    >
      <div className="focus-top">
        <div className="ft-row">
          <button className="iconbtn" onClick={handleExit} aria-label="Fokus-Modus verlassen">
            <IconClose />
          </button>
          <div className="ft-title">
            {chapterNumber}. {chapter.title}
          </div>
          <span className="ft-stat">
            {Math.min(index + 1, total)} / {total} · noch {formatDuration(remaining)}
          </span>
          <button
            className="iconbtn"
            onClick={toggleVoice}
            aria-label={voiceOn ? 'Vorlesen aus' : 'Vorlesen an'}
            disabled={!speech.supported}
            style={{ color: voiceOn ? 'var(--focus-pivot)' : undefined }}
          >
            {voiceOn ? <IconSpeaker /> : <IconSpeakerOff />}
          </button>
          {!fs.isFullscreen && (
            <button className="iconbtn" onClick={() => fs.enter(rootRef.current)} aria-label="Vollbild">
              <IconExpand />
            </button>
          )}
        </div>
        <div className="fprogress">
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      {/* Lesefläche */}
      {status === 'done' ? (
        <div className="reticle">
          <div className="end-screen">
            <div className="done-badge">
              <IconCheck />
            </div>
            <h2>Kapitel gelesen</h2>
            <p>
              {total} Wörter in {chapter.title}
            </p>
            <div className="end-actions">
              <button
                className="btn"
                onClick={() => {
                  setIndex(0);
                  play();
                }}
              >
                <IconRestart /> Noch einmal
              </button>
              {hasNext && (
                <button className="btn primary" onClick={onNextChapter}>
                  Nächstes Kapitel <IconChevronRight />
                </button>
              )}
              <button className="btn" onClick={handleExit}>
                Fertig
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="reticle">
          <div className="tap-zones" aria-hidden>
            <div className="tz" onClick={() => step(-5)} />
            <div className="tz" onClick={togglePlay} />
            <div className="tz" onClick={() => step(5)} />
          </div>

          {settings.showContext && <div className="rsvp-context">{prevWords}</div>}

          <div className="rsvp-stage">
            <span className="rsvp-rule top" />
            <span className="rsvp-rule bottom" />
            {cur && settings.showOrp ? (
              <div className="rsvp-word">
                <span className="before">{cur.text.slice(0, cur.orp)}</span>
                <span className="pivot">{cur.text[cur.orp]}</span>
                <span className="after">{cur.text.slice(cur.orp + 1)}</span>
              </div>
            ) : (
              <div className="rsvp-word no-orp">{cur?.text}</div>
            )}
          </div>

          {settings.showContext && <div className="rsvp-context">{nextWords}</div>}

          {status === 'countdown' && (
            <div className="countdown">
              <span key={countdown}>{countdown > 0 ? countdown : 'Los'}</span>
            </div>
          )}
          {status === 'paused' && <div className="focus-paused-hint">Pausiert · Leertaste oder tippen zum Fortsetzen</div>}
          {status === 'idle' && (
            <div className="focus-paused-hint">Tippe auf ► oder drücke die Leertaste</div>
          )}
        </div>
      )}

      {/* Steuerung unten */}
      {status !== 'done' && (
        <div className="focus-controls">
          <div className="speed">
            <button
              className="iconbtn"
              onClick={() => update({ wpm: Math.max(100, settings.wpm - 25) })}
              aria-label="Langsamer"
            >
              <IconMinus />
            </button>
            <input
              type="range"
              min={100}
              max={1000}
              step={10}
              value={settings.wpm}
              onChange={(e) => update({ wpm: parseInt(e.target.value, 10) })}
              aria-label="Geschwindigkeit"
            />
            <button
              className="iconbtn"
              onClick={() => update({ wpm: Math.min(1000, settings.wpm + 25) })}
              aria-label="Schneller"
            >
              <IconPlus />
            </button>
            <span className="val">{settings.wpm} WpM</span>
          </div>
          <div className="transport">
            <button className="iconbtn" onClick={() => step(-10)} aria-label="10 Wörter zurück">
              <IconBack />
            </button>
            <button
              className="play"
              onClick={() => {
                handleStartGesture();
                togglePlay();
              }}
              aria-label={status === 'playing' ? 'Pause' : 'Start'}
            >
              {status === 'playing' ? <IconPause /> : <IconPlay />}
            </button>
            <button className="iconbtn" onClick={() => step(10)} aria-label="10 Wörter vor">
              <IconForward />
            </button>
            <button
              className="iconbtn"
              onClick={() => {
                setIndex(0);
                onProgress(0);
              }}
              aria-label="Zum Anfang"
            >
              <IconRestart />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
