import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '../lib/types';
import { loadSettings, saveSettings } from '../lib/storage';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return { settings, update } as const;
}
