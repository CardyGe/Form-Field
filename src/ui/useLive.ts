import { useCallback, useEffect, useRef, useState } from 'react';
import { Stage } from '../live/Stage';
import { chooseDisplay, defaultLiveSettings, validateLiveSettings, type LiveSettings } from '../live/settings';
import type { SourceState } from '../live/source';
import type { PeopleStatus } from '../live/MaskProvider';

export interface Display { id: number; label: string; primary: boolean }

/**
 * Everything the Live screen does. While the artwork window is closed the
 * picture is drawn here, on `canvas`. While it is open the artwork window
 * draws it and owns the camera; this side only sends settings and shows the
 * small preview that comes back.
 */
export function useLive(onError: (message: string) => void) {
  const bridge = window.studio?.live;
  const [settings, setSettings] = useState<LiveSettings | null>(null);
  const [access, setAccess] = useState<'granted' | 'refused' | null>(null);
  const [sourceState, setSourceState] = useState<SourceState>({ status: 'idle' });
  const [cameras, setCameras] = useState<{ deviceId: string; label: string }[]>([]);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [outputOpen, setOutputOpen] = useState(false);
  const [blackout, setBlackoutState] = useState(false);
  const [view, setView] = useState<'art' | 'tracking' | 'people'>('art');
  const [people, setPeople] = useState<{ status: PeopleStatus | null; roomCaptured: boolean }>({ status: null, roomCaptured: false });
  const [file, setFile] = useState<File | null>(null);
  const [fps, setFps] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const stage = useRef<Stage | null>(null);
  const unsaved = useRef<LiveSettings | null>(null);
  const latest = useRef({ settings, blackout, file });
  latest.current = { settings, blackout, file };

  // Saved settings, camera access and the list of displays, once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [saved, granted, found] = await Promise.all([
        bridge?.loadSettings().catch(() => null) ?? null,
        bridge?.cameraAccess().catch(() => 'refused' as const) ?? 'granted' as const,
        bridge?.displays().catch(() => []) ?? [],
      ]);
      if (cancelled) return;
      const next = validateLiveSettings(saved);
      next.display = chooseDisplay(found, next.display);
      setAccess(granted); setDisplays(found); setSettings(next);
    })();
    return () => { cancelled = true; };
  }, []);

  // A projector can be plugged in or pulled out at any time; a display that has gone is replaced in the settings.
  const refreshDisplays = async () => {
    const found = await bridge?.displays().catch(() => []) ?? [];
    setDisplays(found);
    setSettings(value => value && value.display !== chooseDisplay(found, value.display) ? { ...value, display: chooseDisplay(found, value.display) } : value);
  };

  // The artwork window opening and closing, and its preview.
  useEffect(() => {
    if (!bridge) return;
    const offOutput = bridge.onOutputChanged(open => {
      setOutputOpen(open);
      if (open) {
        setView('art');
        const now = latest.current;
        if (now.settings) bridge.send({ type: 'settings', settings: now.settings });
        bridge.send({ type: 'blackout', on: now.blackout });
      }
    });
    const offState = bridge.onState(({ people: status, roomCaptured, ...state }) => { setSourceState(state as SourceState); setPeople({ status: status ?? null, roomCaptured: roomCaptured === true }); });
    const offDisplays = bridge.onDisplaysChanged(() => void refreshDisplays());
    let url: string | null = null;
    const offPreview = bridge.onPreview((jpeg, rate) => {
      const next = URL.createObjectURL(new Blob([jpeg], { type: 'image/jpeg' }));
      setPreview(next); setFps(rate);
      if (url) URL.revokeObjectURL(url);
      url = next;
    });
    return () => { offOutput(); offState(); offDisplays(); offPreview(); if (url) URL.revokeObjectURL(url); void bridge.closeOutput().catch(() => {}); };
  }, []);
  useEffect(() => { if (!outputOpen) setPreview(null); }, [outputOpen]);

  // The local renderer: only while the artwork window is closed.
  const ready = !!settings && access !== null;
  useEffect(() => {
    if (!canvas || !ready || outputOpen) return;
    let made: Stage;
    try { made = new Stage(canvas); } catch (error) { onError((error as Error).message); return; }
    stage.current = made;
    made.onState = state => {
      setSourceState(state);
      if (state.status === 'running') void made.listCameras().then(setCameras).catch(() => {});
    };
    const now = latest.current;
    made.renderer.blackout = now.blackout;
    if (now.settings) made.apply(now.settings, now.file);
    const timer = setInterval(() => setFps(made.renderer.stats().fps), 1000);
    const peopleTimer = setInterval(() => { const r = made.peopleReport(); setPeople({ status: r.people, roomCaptured: r.roomCaptured }); }, 500);
    return () => { clearInterval(timer); clearInterval(peopleTimer); stage.current = null; made.dispose(); setSourceState({ status: 'idle' }); };
  }, [canvas, ready, outputOpen]);

  // Every change goes to whichever side is drawing, and is saved shortly after.
  useEffect(() => {
    if (!settings) return;
    stage.current?.apply(settings, file);
    if (outputOpen) bridge?.send({ type: 'settings', settings });
    unsaved.current = settings;
    const timer = setTimeout(() => { unsaved.current = null; void bridge?.saveSettings(settings).catch(() => {}); }, 500);
    return () => clearTimeout(timer);
  }, [settings, file]);
  // Leaving Live within that half second must not lose the last change.
  useEffect(() => () => { if (unsaved.current) void bridge?.saveSettings(unsaved.current).catch(() => {}); }, []);
  useEffect(() => { if (stage.current) stage.current.renderer.view = view; }, [view, outputOpen, canvas, ready]);

  const update = useCallback((change: (value: LiveSettings) => LiveSettings) => setSettings(value => value && validateLiveSettings(change(value))), []);
  const setBlackout = (on: boolean) => { setBlackoutState(on); if (stage.current) stage.current.renderer.blackout = on; if (outputOpen) bridge?.send({ type: 'blackout', on }); };
  const clear = () => { stage.current?.renderer.clear(); if (outputOpen) bridge?.send({ type: 'clear' }); };
  const openOutput = async () => {
    if (!settings || settings.display === null) return;
    try { await bridge?.openOutput(settings.display); }
    catch (error) { onError((error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); await refreshDisplays(); }
  };
  const closeOutput = () => { void bridge?.closeOutput(); };
  const captureRoom = () => {
    if (outputOpen) bridge?.send({ type: 'captureRoom' });
    else { stage.current?.renderer.captureRoom(); setTimeout(() => { const r = stage.current?.peopleReport(); if (r) setPeople({ status: r.people, roomCaptured: r.roomCaptured }); }, 200); }
  };
  const retry = () => { if (settings) stage.current?.retry(settings, file); if (outputOpen) bridge?.send({ type: 'retry' }); };
  const chooseFile = (chosen: File) => { setFile(chosen); update(s => ({ ...s, source: { kind: 'file', deviceId: s.source.deviceId } })); };

  return { settings: settings ?? defaultLiveSettings(), ready, access, update, sourceState, cameras, displays, outputOpen, blackout, setBlackout, clear,
    openOutput, closeOutput, view, setView, people, captureRoom, fps, preview, setCanvas, file, chooseFile, retry, desktop: !!bridge };
}
