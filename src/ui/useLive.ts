import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage } from '../live/Stage';
import { chooseDisplay, defaultLiveSettings, MERIDIAN_LIVE_MOVES, validateLiveSettings, type LiveSettings } from '../live/settings';
import type { SourceState } from '../live/source';
import type { PeopleStatus } from '../live/MaskProvider';
import { reactivity, type ReactivityEngine } from '../react/engine';
import { MeterStore } from '../react/meter';
import { heardSignals, onlySignals } from '../live/heard';
import { installationMessage, logFault, saveInstallation, useInstallation } from './installation';
import { installationDisplay } from './installation-display';

export interface Display { id: number; label: string; primary: boolean }
/** What Meridian Live tells the operator: words and counts, never a picture. */
export interface MeridianReadout { status: string; bodies: number; limiterOn: boolean; limiterError: string | null; qualityReduced: boolean }
/** What Meridian hears when it follows the music: the same signals Map and the Studio give it. */
const MERIDIAN_SIGNALS = ['audio.level', 'audio.bass', 'audio.mids', 'audio.highs', 'beat.pulse', 'tempo.beat', 'tempo.phase', 'tempo.bpm', 'tempo.external'];
const followsMusic = (s: LiveSettings | null): boolean => s?.look === 'meridian' && s.meridian.liveMusic >= .5;

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
  const [meridian, setMeridian] = useState<MeridianReadout | null>(null);
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
      // A move held when the app last closed is let go.
      for (const key of MERIDIAN_LIVE_MOVES) next.meridian[key] = 0;
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
        bridge.send(installationMessage());
      }
    });
    const offState = bridge.onState(({ people: status, roomCaptured, meridian: readout, ...state }) => { setSourceState(state as SourceState); setPeople({ status: status ?? null, roomCaptured: roomCaptured === true }); setMeridian(readMeridian(readout)); });
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

  // Installation mode: on launch the saved Live settings go straight to the output, and Meridian's autopilot runs there.
  // Only on the saved projector (or, with none saved, a display that is not the main screen), trying again whenever the displays
  // change, so a projector switched on after the Mac is found. Closing the output by hand is respected until the displays change.
  const installation = useInstallation(), triedDisplays = useRef<Display[] | null>(null);
  const [installationWaiting, setInstallationWaiting] = useState<string | null>(null);
  useEffect(() => { if (outputOpen) bridge?.send(installationMessage()); }, [installation]);
  useEffect(() => {
    const active = !!bridge && !!settings && !!installation?.on && installation.surface === 'live';
    if (!active || outputOpen) { setInstallationWaiting(null); return; }
    if (settings!.source.kind === 'file') { setInstallationWaiting('Installation cannot open the output while a video file is the source.'); return; }
    const choice = installationDisplay(installation!.display, displays);
    setInstallationWaiting(choice.waiting);
    if (choice.id === null || triedDisplays.current === displays) return;
    triedDisplays.current = displays;
    const id = choice.id;
    void bridge!.openOutput(id).then(() => { if (installation!.display !== id) void saveInstallation({ display: id }).catch(() => {}); })
      .catch(error => { triedDisplays.current = null; logFault(`Installation could not open the Live output: ${(error as Error).message}`); });
  }, [settings, outputOpen, displays, installation]);
  useEffect(() => {
    if (meridian?.limiterError) logFault(`Live: flash limiter not running: ${meridian.limiterError}`);
    if (meridian?.status.startsWith('Camera lost')) logFault(`Live: ${meridian.status}`);
  }, [meridian]);

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
    const peopleTimer = setInterval(() => { const r = made.peopleReport(); setPeople({ status: r.people, roomCaptured: r.roomCaptured }); setMeridian(made.meridianReadout()); }, 500);
    return () => { clearInterval(timer); clearInterval(peopleTimer); stage.current = null; made.dispose(); setSourceState({ status: 'idle' }); setMeridian(null); };
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

  // Sound, the beat, tempo and MIDI: heard only while a link needs them or the operator has the sound panel open.
  const links = settings?.links ?? [];
  const music = followsMusic(settings);
  const reacts = links.some(l => l.on) || music;
  const [panelOpen, setPanelOpen] = useState(false);
  const [engine, setEngine] = useState<ReactivityEngine | null>(null);
  const meter = useMemo(() => new MeterStore(), []);
  useEffect(() => { if ((reacts || panelOpen) && !engine) setEngine(reactivity()); }, [reacts, panelOpen, engine]);
  const usedInputs = [...new Set([...links.map(l => l.input), ...(music ? MERIDIAN_SIGNALS : [])])].sort().join(' ');
  // Read as they are now, so opening the panel or the output, or a new link, never interrupts the links on screen.
  const listening = useRef({ panelOpen, outputOpen, reacts, usedInputs });
  listening.current = { panelOpen, outputOpen, reacts, usedInputs };
  const active = !!engine && (reacts || panelOpen);
  useEffect(() => {
    if (!engine || !active) return;
    let shown = 0, usedKey = '', used = new Set<string>();
    const off = engine.subscribe(now => {
      const { panelOpen, outputOpen, reacts, usedInputs } = listening.current;
      if (usedInputs !== usedKey) { usedKey = usedInputs; used = new Set(usedInputs.split(' ').filter(Boolean)); }
      // Whether the tempo stands on its own (MIDI, tap, a fixed number) travels with the signals, as in Map.
      const only = onlySignals(heardSignals(now, engine.prefs.tempo), used);
      if (stage.current) stage.current.renderer.signals = only;
      if (outputOpen && reacts) bridge?.send({ type: 'signals', signals: only });
      const t = performance.now();
      if (panelOpen && t - shown > 100) { shown = t; meter.set(now); }
    });
    // With nothing driving them, the looks go back to their sliders as set.
    return () => { off(); if (stage.current) stage.current.renderer.signals = {}; if (listening.current.outputOpen) bridge?.send({ type: 'signals', signals: {} }); };
  }, [engine, active]);

  const update = useCallback((change: (value: LiveSettings) => LiveSettings) => setSettings(value => value && validateLiveSettings(change(value))), []);
  const setBlackout = (on: boolean) => { setBlackoutState(on); if (stage.current) stage.current.renderer.blackout = on; if (outputOpen) bridge?.send({ type: 'blackout', on }); };
  const clear = () => { stage.current?.renderer.clear(); if (outputOpen) bridge?.send({ type: 'clear' }); };
  const openOutput = async () => {
    if (!settings || settings.display === null) return;
    try {
      await bridge?.openOutput(settings.display);
      if (installation?.on && installation.surface === 'live' && installation.display !== settings.display) void saveInstallation({ display: settings.display }).catch(() => {});
    }
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
    openOutput, closeOutput, view, setView, people, meridian, installationWaiting, captureRoom, fps, preview, setCanvas, file, chooseFile, retry, desktop: !!bridge,
    engine, startEngine: (): ReactivityEngine => { const e = engine ?? reactivity(); if (!engine) setEngine(e); return e; }, signals: meter, reactivityPanel: panelOpen, setReactivityPanel: setPanelOpen };
}

/** A readout from the artwork window, checked: it crosses a process boundary. */
function readMeridian(value: unknown): MeridianReadout | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return typeof v.status === 'string' && typeof v.bodies === 'number' ? { status: v.status.slice(0, 80), bodies: v.bodies, limiterOn: v.limiterOn === true, limiterError: typeof v.limiterError === 'string' ? v.limiterError.slice(0, 200) : null, qualityReduced: v.qualityReduced === true } : null;
}
