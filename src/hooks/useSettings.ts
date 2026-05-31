import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../lib/types';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/storage';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);

  // Beim Start aus dem (entfernten) Speicher laden
  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
      })
      .finally(() => {
        if (cancelled) return;
        loadedRef.current = true;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      // erst speichern, nachdem initial geladen wurde (sonst überschreiben
      // wir den Server mit Default-Werten); leicht entprellt.
      if (loadedRef.current) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          void saveSettings(next);
        }, 500);
      }
      return next;
    });
  }, []);

  return { settings, update, loaded } as const;
}
