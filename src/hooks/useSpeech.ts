import { useCallback, useEffect, useRef, useState } from 'react';

export interface SpeakCallbacks {
  voiceURI?: string;
  rate?: number;
  pitch?: number;
  lang?: string;
  onSegmentStart?: (index: number) => void;
  onBoundary?: (index: number, charIndex: number, charLength: number) => void;
  onSegmentEnd?: (index: number) => void;
  /** finished=true bei normalem Ende, false bei Abbruch */
  onDone?: (finished: boolean) => void;
}

/**
 * Sprachausgabe über die Web Speech API. Spricht eine Folge von Segmenten
 * (i. d. R. Sätze) nacheinander – das ist auf iOS/iPadOS deutlich
 * zuverlässiger als ein einzelner langer Text und erlaubt eine
 * satzweise Synchronisation.
 */
export function useSpeech() {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const supported = !!synth;

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);

  const cancelledRef = useRef(false);
  const segmentsRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const cbRef = useRef<SpeakCallbacks>({});
  const keepAliveRef = useRef<number | null>(null);
  // Generations-Token: macht verspätete Callbacks abgebrochener Äußerungen wirkungslos
  const genRef = useRef(0);

  useEffect(() => {
    if (!synth) return;
    const load = () => {
      const v = synth.getVoices();
      if (v.length) setVoices(v);
    };
    load();
    synth.addEventListener('voiceschanged', load);
    return () => synth.removeEventListener('voiceschanged', load);
  }, [synth]);

  const stopKeepAlive = useCallback(() => {
    if (keepAliveRef.current !== null) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (!synth) return;
    cancelledRef.current = true;
    genRef.current++; // laufende Callbacks entwerten
    stopKeepAlive();
    synth.cancel();
    setSpeaking(false);
    setPaused(false);
    const cb = cbRef.current;
    cbRef.current = {};
    cb.onDone?.(false);
  }, [synth, stopKeepAlive]);

  const speakIndex = useCallback(
    (i: number, gen: number) => {
      if (!synth) return;
      if (gen !== genRef.current) return; // veraltete Sequenz
      const segments = segmentsRef.current;
      if (i >= segments.length) {
        stopKeepAlive();
        setSpeaking(false);
        setPaused(false);
        cbRef.current.onDone?.(true);
        return;
      }
      indexRef.current = i;
      const cb = cbRef.current;
      const utt = new SpeechSynthesisUtterance(segments[i]);
      if (cb.lang) utt.lang = cb.lang;
      if (cb.voiceURI) {
        const v = synth.getVoices().find((x) => x.voiceURI === cb.voiceURI);
        if (v) {
          utt.voice = v;
          utt.lang = v.lang;
        }
      }
      utt.rate = cb.rate ?? 1;
      utt.pitch = cb.pitch ?? 1;
      utt.onstart = () => {
        if (gen !== genRef.current) return;
        setSpeaking(true);
        setPaused(false);
        cb.onSegmentStart?.(i);
      };
      utt.onboundary = (e) => {
        if (gen !== genRef.current) return;
        cb.onBoundary?.(i, e.charIndex, (e as SpeechSynthesisEvent & { charLength?: number }).charLength ?? 0);
      };
      utt.onend = () => {
        if (gen !== genRef.current) return;
        cb.onSegmentEnd?.(i);
        speakIndex(i + 1, gen);
      };
      utt.onerror = () => {
        if (gen !== genRef.current) return;
        // Fehler eines Segments überspringen
        speakIndex(i + 1, gen);
      };
      synth.speak(utt);
    },
    [synth, stopKeepAlive],
  );

  const speak = useCallback(
    (segments: string[], cb: SpeakCallbacks = {}) => {
      if (!synth) return;
      synth.cancel();
      cancelledRef.current = false;
      const gen = ++genRef.current;
      segmentsRef.current = segments.filter((s) => s.trim().length > 0);
      cbRef.current = cb;
      indexRef.current = 0;
      setSpeaking(true);
      setPaused(false);
      // Chrome pausiert die Synthese nach ~15 s von selbst – regelmäßig "anstupsen".
      stopKeepAlive();
      keepAliveRef.current = window.setInterval(() => {
        if (synth.speaking && !synth.paused) {
          synth.pause();
          synth.resume();
        }
      }, 10000);
      speakIndex(0, gen);
    },
    [synth, speakIndex, stopKeepAlive],
  );

  const pause = useCallback(() => {
    if (!synth) return;
    synth.pause();
    setPaused(true);
  }, [synth]);

  const resume = useCallback(() => {
    if (!synth) return;
    synth.resume();
    setPaused(false);
  }, [synth]);

  useEffect(() => {
    return () => {
      // Beim Verlassen alles stoppen
      if (synth) {
        cancelledRef.current = true;
        genRef.current++;
        synth.cancel();
      }
      stopKeepAlive();
    };
  }, [synth, stopKeepAlive]);

  return { supported, voices, speaking, paused, speak, cancel, pause, resume } as const;
}
