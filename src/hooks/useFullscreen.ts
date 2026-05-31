import { useCallback, useEffect, useState } from 'react';

interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}
interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
}

/**
 * Vollbild-Steuerung. Auf iPhones unterstützt Safari die Fullscreen-API für
 * beliebige Elemente nicht – dann greift in der App ein CSS-Vollbild als
 * Ersatz, sodass der Fokus-Modus trotzdem den ganzen Bildschirm einnimmt.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => {
      const doc = document as WebkitDocument;
      setIsFullscreen(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  const enter = useCallback(async (el: HTMLElement | null) => {
    if (!el) return;
    const e = el as WebkitElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (e.webkitRequestFullscreen) await e.webkitRequestFullscreen();
    } catch {
      /* Vollbild evtl. nicht erlaubt – CSS-Ersatz übernimmt */
    }
  }, []);

  const exit = useCallback(async () => {
    const doc = document as WebkitDocument;
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    } catch {
      /* ignore */
    }
  }, []);

  return { isFullscreen, enter, exit } as const;
}
