/**
 * Live's settings for Map: the Live screen's own, loaded from the same file and saved back to it, so the two screens
 * share one Live look. Only one of the two screens is ever open, so they never write at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { validateLiveSettings, type LiveSettings } from '../live/settings';

const SAVE_AFTER_MS = 500;

export function useLiveSettings(): { settings: LiveSettings | null; update: (change: (s: LiveSettings) => LiveSettings) => void } {
  const bridge = window.studio?.live;
  const [settings, setSettings] = useState<LiveSettings | null>(null);
  const unsaved = useRef<LiveSettings | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await (bridge?.loadSettings().catch(() => null) ?? Promise.resolve(null));
      if (!cancelled) { loaded.current = true; setSettings(validateLiveSettings(saved)); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Saved shortly after a change; leaving Map within that time still saves it.
  useEffect(() => {
    if (!settings || !unsaved.current) return;
    const timer = setTimeout(() => { const s = unsaved.current; unsaved.current = null; if (s) void bridge?.saveSettings(s).catch(() => {}); }, SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [settings]);
  useEffect(() => () => { if (unsaved.current) void bridge?.saveSettings(unsaved.current).catch(() => {}); }, []);

  const update = useCallback((change: (s: LiveSettings) => LiveSettings) => setSettings(value => {
    if (!value) return value;
    const next = validateLiveSettings(change(value));
    unsaved.current = next;
    return next;
  }), []);
  return { settings, update };
}
