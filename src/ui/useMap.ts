import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditAction } from '../map/editor';
import { applyStudioEdit, initialMapState, mapReducer, type MapState } from '../map/state';
import type { Project } from '../shared/types';
import { autosaveSchedule, canEdit } from '../map/autosave';
import { acceptMapMessage, sourcesToSend, toWire, wallInputs, type MapMessage } from '../map/messages';
import { useLiveSettings } from './useLiveSettings';
import type { LiveSettings } from '../live/settings';
import { createShow, usesLive, validateShow, type ShowDocument } from '../map/show';
import { reactivity, type ReactivityEngine } from '../react/engine';
import { fire, type TriggerAction } from '../react/links';
import type { Signals } from '../react/signals';
import { MeterStore } from '../react/meter';
import { usesEmberSmokeAudio } from '../react/ember-smoke';
import { autoAdvanceDue, nextAutoScene } from '../map/wild';

/** Whether a show uses sound, the beat, tempo or MIDI at all: only then does the engine listen. */
export const showReacts = (show: ShowDocument) => show.links.length > 0 || show.triggers.length > 0 || show.sources.some(s => s.tempoSync !== null || s.project.layers.some(usesEmberSmokeAudio))
  // Stage 7: a border run with the tempo, or auto-advance by bars, follows the beat.
  || show.shapes.some(s => !!s.border.run?.beats) || show.autoAdvance?.unit === 'bars';

export type MapTool = 'select' | 'rectangle' | 'triangle' | 'ellipse' | 'pen';
/** The shapes soloed, directly or through their group, that are still in the show. */
export function soloIds(show: ShowDocument, solo: { shapes: string[]; groups: string[] }): string[] {
  return show.shapes.filter(s => solo.shapes.includes(s.id) || (s.groupId !== null && solo.groups.includes(s.groupId))).map(s => s.id);
}

export interface Display { id: number; label: string; primary: boolean }

const TOO_LARGE = 'This show is too large to send to the wall. The wall keeps its last show.';
const TOO_LARGE_SOURCE = 'A composition is too large to send to the projector, so its shape keeps what the projector already had, or its colour.';
export const SAVE_FAILED = 'Could not save — keep working, then use Save As';
const DAMAGED = 'That file could not be read. Nothing was changed.';
const fileName = (file: string) => file.split(/[\\/]/).pop() || file;
/** How many shapes in a file did not survive validation. */
const leftOut = (raw: unknown, show: ShowDocument): number => {
  const shapes = raw && typeof raw === 'object' ? (raw as { shapes?: unknown }).shapes : undefined;
  return Array.isArray(shapes) ? Math.max(0, shapes.length - show.shapes.length) : 0;
};
const isDamaged = (value: unknown) => !!value && typeof value === 'object' && (value as { damaged?: unknown }).damaged === true && !('shapes' in value);

/**
 * One Map session per window. It outlives the Map screen, so leaving Map and coming back keeps the shapes
 * and the undo history, and a save that keeps failing still refuses the close after the screen has gone.
 */
interface Session {
  state: MapState;
  loaded: boolean;
  saveFailed: boolean;
  /** Writes the show when it has been still for half a second; the show is turned into text only then. */
  saver: ReturnType<typeof autosaveSchedule<ShowDocument>>;
  /** The screen showing the session, told when a save fails or recovers; null while Map is not shown. */
  onSaveResult: ((failed: boolean) => void) | null;
  /** Whether the wall's window is open, and which composition revisions it has been sent (emptied when it opens). */
  outputOpen: boolean;
  sentSources: Map<string, number>;
  /** The wall's switches, kept here so they survive leaving Map while the wall stays open. */
  blackout: boolean;
  testGrid: boolean;
  freeze: boolean;
  /** A shape's composition being edited in Studio: the wall stays open and follows the edits. */
  studioEdit: { sourceId: string; shapeId: string; first: boolean } | null;
  /** How many Map screens are mounted (React may mount one twice in development). */
  mounted: number;
  /** A Studio edit waiting to reach the wall at the next frame (edits come faster than frames while a slider moves). */
  wallFrame: number | null;
  /** Told when a Studio edit could not reach the wall. */
  onStudioWarning: ((text: string) => void) | null;
  /** Solo: shapes and groups soloed. Not saved, not an undo step; kept while the app is open. */
  solo: { shapes: string[]; groups: string[] };
  /** Snap, and whether the trace-over photo is shown on this screen. */
  snap: boolean;
  photoShown: boolean;
}
let session: Session | null = null;
function mapSession(): Session {
  if (session) return session;
  const bridge = window.studio?.map;
  const created: Session = {
    state: initialMapState(createShow()), loaded: false, saveFailed: false, onSaveResult: null,
    outputOpen: false, sentSources: new Map(), blackout: false, testGrid: false, freeze: false, studioEdit: null, mounted: 0, wallFrame: null, onStudioWarning: null,
    solo: { shapes: [], groups: [] }, snap: true, photoShown: true,
    saver: autosaveSchedule<ShowDocument>(async show => {
      if (!bridge) return;
      // A failed write is reported, never swallowed: the operator keeps working and can Save As.
      try { await bridge.saveAutosave(JSON.stringify(show)); created.saveFailed = false; created.onSaveResult?.(false); }
      catch (error) { created.saveFailed = true; created.onSaveResult?.(true); throw error; }
    }, 500),
  };
  // Registered once for the window's life: closing must not lose an edit made in the last half second,
  // and a save that fails refuses the close, with a message, even when Map is not on screen.
  if (bridge) window.studio?.onBeforeClose(async () => {
    try { await created.saver.flush(); }
    catch { created.saveFailed = true; created.onSaveResult?.(true); throw new Error('The Map show could not be saved. Open Map and use Save As to keep it.'); }
  });
  // Followed for the window's life, so the session knows whether the wall is open even while Map is not shown.
  bridge?.onOutputChanged(open => { created.outputOpen = open; if (open) created.sentSources = new Map(); });
  session = created;
  return created;
}

/** Sends the wall the compositions it lacks, then the show. False when something was too large to send. */
function pushToWall(s: Session, show: ShowDocument): { show: boolean; sources: boolean } {
  const bridge = window.studio?.map;
  const result = { show: true, sources: true };
  if (!s.outputOpen || !bridge) return result;
  const { messages, sent } = sourcesToSend(show, s.sentSources);
  s.sentSources = sent;
  for (const message of messages) { if (acceptMapMessage(message as unknown)) bridge.send(message); else result.sources = false; }
  const message: MapMessage = { type: 'show', show: toWire(show) };
  if (acceptMapMessage(message as unknown)) bridge.send(message); else result.show = false;
  return result;
}

/**
 * Starts editing a shape's composition in Studio. The wall stays open and follows each change.
 * Returns the composition and the shape's name, or null when the shape plays no composition.
 */
export function beginStudioEdit(sourceId: string, shapeId: string): { project: Project; shapeName: string } | null {
  const s = mapSession();
  const source = s.state.show.sources.find(src => src.id === sourceId);
  const shape = s.state.show.shapes.find(sh => sh.id === shapeId);
  if (!source || !shape) return null;
  s.studioEdit = { sourceId, shapeId, first: true };
  // The Map screen's crosshair and flash belong to Map: they leave the wall while Studio has it.
  if (s.outputOpen) { window.studio?.map.send({ type: 'crosshair', point: null, shapeId: null }); window.studio?.map.send({ type: 'identify', shapeId: null }); }
  return { project: source.project, shapeName: shape.name };
}

/** Why Map could not take a change made in Studio, in words. */
const STUDIO_REFUSALS: Record<string, string> = {
  'too-many-layers': 'a shape\'s composition can have at most four layers',
  'bad-composition': 'the composition could not be read',
  locked: 'the shape is locked in Map',
  'not-found': 'the shape is no longer in the show',
};

/** A change made in Studio to the shape's composition. Returns why it was refused or did not reach the wall, or null. */
export function studioEdit(project: Project): string | null {
  const s = mapSession(), edit = s.studioEdit;
  if (!edit) return null;
  const before = s.state;
  s.state = applyStudioEdit(before, edit.sourceId, project, edit.first);
  if (s.state.show === before.show) return STUDIO_REFUSALS[s.state.refusal ?? ''] ?? s.state.refusal;
  edit.first = false;
  s.saver.save(s.state.show);
  // At most once a frame: the latest change goes, earlier ones in the same frame are skipped.
  if (s.wallFrame === null) s.wallFrame = requestAnimationFrame(() => {
    s.wallFrame = null;
    const sent = pushToWall(s, s.state.show);
    if (!sent.sources) s.onStudioWarning?.('the composition is too large to send to the projector, so the projector keeps what it had (the show keeps the change)');
  });
  return null;
}

/** Studio's way to hear that an edit could not reach the projector. */
export function onStudioWallWarning(listener: ((text: string) => void) | null): void { mapSession().onStudioWarning = listener; }

/** Back to Map. */
export function endStudioEdit(): void {
  mapSession().studioEdit = null;
}

/** What the operator screen does with the show: hold it, save it, and keep the wall in step. */
export function useMap(onError: (message: string) => void) {
  const bridge = window.studio?.map;
  const kept = mapSession();
  // The state is advanced through the pure reducer; the ref lets callbacks read it without waiting for a render.
  const stateRef = useRef<MapState>(kept.state);
  const [state, setState] = useState<MapState>(stateRef.current);
  const show = state.show;
  const [loaded, setLoaded] = useState(kept.loaded);
  // The selection: every selected shape, the first being the one whose details and points are shown;
  // the chosen point is selectedIndex of ring selectedRing (-1 the outline, 0 and up its holes).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIds[0] ?? null;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedRing, setSelectedRing] = useState(-1);
  const [tool, setTool] = useState<MapTool>('select');
  const [solo, setSoloState] = useState(kept.solo);
  const [snap, setSnapState] = useState(kept.snap);
  const [photoShown, setPhotoShownState] = useState(kept.photoShown);
  const [lastRefusal, setLastRefusal] = useState<string | null>(null);
  const [sendWarning, setSendWarning] = useState<string | null>(null);
  /** Kept apart from the show's own warning, which every show message clears. */
  const [sourceWarning, setSourceWarning] = useState<string | null>(null);
  /** Goes up every time an output says it is ready, even one that reloaded while already open: it is sent everything. */
  const [outputEpoch, setOutputEpoch] = useState(0);
  const [blackout, setBlackoutState] = useState(kept.blackout);
  const [testGrid, setTestGridState] = useState(kept.testGrid);
  const [freeze, setFreezeState] = useState(kept.freeze);
  /** How the wall is keeping up, as it reports once a second while the output is open. */
  const [wallState, setWallState] = useState<import('../map/compositor').CompositorStats | null>(null);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [display, setDisplay] = useState<number | null>(null);
  // The wall may still be open from before (a shape edited in Studio keeps it open).
  const [outputOpen, setOutputOpen] = useState(kept.outputOpen);
  // While a drag is in progress this trial show is drawn and sent to the wall; the held show changes only on release.
  const [preview, setPreview] = useState<ShowDocument | null>(null);
  const shown = preview ?? show;
  const [saveError, setSaveError] = useState<string | null>(kept.saveFailed ? SAVE_FAILED : null);
  const [wallPicture, setWallPicture] = useState<ImageBitmap | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef({ shown, blackout, testGrid, freeze });
  latest.current = { shown, blackout, testGrid, freeze };
  const saver = kept.saver;

  // The saved working show, once per window. A damaged file was already moved aside by the main process, so an empty show is fine.
  useEffect(() => {
    if (kept.loaded) return;
    let cancelled = false;
    void (async () => {
      const saved = await bridge?.loadAutosave().catch(() => null) ?? null;
      if (cancelled || kept.loaded) return;
      const next = validateShow(saved).show;
      kept.state = stateRef.current = mapReducer(stateRef.current, { type: 'load', show: next });
      kept.loaded = true;
      setState(stateRef.current); setLoaded(true);
      const dropped = leftOut(saved, next);
      if (dropped > 0) setNotice(`${dropped} shape${dropped === 1 ? '' : 's'} in the saved show could not be read and ${dropped === 1 ? 'was' : 'were'} left out.`);
    })();
    return () => { cancelled = true; };
  }, []);

  const refreshDisplays = useCallback(async () => {
    const found = await bridge?.displays().catch(() => []) ?? [];
    setDisplays(found);
    setDisplay(current => found.some(d => d.id === current) ? current : (found.find(d => !d.primary) ?? found[0])?.id ?? null);
  }, []);
  useEffect(() => {
    void refreshDisplays();
    if (!bridge) return;
    const offOutput = bridge.onOutputChanged(open => { setOutputOpen(open); if (open) setOutputEpoch(n => n + 1); });
    const offDisplays = bridge.onDisplaysChanged(() => void refreshDisplays());
    // The wall's own picture, for the operator screen. Old pictures are left to the garbage collector,
    // so one still being drawn is never closed under it.
    const offPreview = bridge.onPreview(bytes => {
      void createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })).then(setWallPicture).catch(() => {});
    });
    const offState = bridge.onState(setWallState);
    kept.onSaveResult = failed => setSaveError(failed ? SAVE_FAILED : null);
    kept.mounted++;
    // Leaving Map writes what is waiting. A failure stays recorded in the session and still refuses the close.
    // The wall closes too, unless a shape is being edited in Studio: then it stays open and follows the edits.
    // Decided a moment later: React's development double mount remounts at once, and must not close the wall.
    return () => {
      offOutput(); offDisplays(); offPreview(); offState(); kept.onSaveResult = null; saver.flush().catch(() => {});
      kept.mounted--;
      setTimeout(() => { if (kept.mounted === 0 && !kept.studioEdit) void bridge.closeOutput().catch(() => {}); }, 0);
    };
  }, []);
  useEffect(() => { if (!outputOpen) { setWallPicture(null); setWallState(null); } }, [outputOpen]);

  // Sends to the wall. During a drag, show and crosshair go at most once per animation frame (the latest wins);
  // anything sent at once replaces what is waiting for the frame, so an old preview never lands after a release.
  const waiting = useRef<{ show?: MapMessage; crosshair?: MapMessage }>({});
  const frame = useRef<number | null>(null);
  const deliver = (message: MapMessage) => {
    if (!acceptMapMessage(message as unknown)) { if (message.type === 'show') setSendWarning(TOO_LARGE); return; } // the wall keeps its last show
    if (message.type === 'show') setSendWarning(null);
    bridge?.send(message);
  };
  const sendNow = (message: MapMessage) => {
    if (message.type === 'show' || message.type === 'crosshair') delete waiting.current[message.type];
    deliver(message);
  };
  const sendNextFrame = (message: MapMessage & { type: 'show' | 'crosshair' }) => {
    waiting.current[message.type] = message;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const { show: nextShow, crosshair } = waiting.current;
      waiting.current = {};
      if (nextShow) deliver(nextShow);
      if (crosshair) deliver(crosshair);
    });
  };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const showMessage = (s: ShowDocument): MapMessage => ({ type: 'show', show: toWire(s) });
  /** A scene switch's fade time, for the wall: it travels on the switch's own show message. */
  const wallFade = useRef<number | null>(null);
  /** What the wall was last told of Live: its settings, null (not used), or undefined (nothing yet, since it opened). */
  const sentLive = useRef<LiveSettings | null | undefined>(undefined);
  const sendLive = () => {
    const want = usesLive(stateRef.current.show) ? liveRef.current : null;
    if (want === sentLive.current) return;
    if (want === null && sentLive.current === undefined) { sentLive.current = null; return; }
    const message: MapMessage = { type: 'liveSettings', settings: want };
    if (acceptMapMessage(message as unknown)) { bridge?.send(message); sentLive.current = want; }
  };

  /**
   * Compositions the output does not have yet go first, so the show never names one the wall cannot play.
   * The record of what the wall has is the session's (emptied whenever an output opens), shared with Studio edits.
   */
  const sendSources = (s: ShowDocument) => {
    const { messages, sent } = sourcesToSend(s, kept.sentSources);
    kept.sentSources = sent;
    if (!messages.length) return;
    let refused = false;
    for (const message of messages) {
      if (!acceptMapMessage(message as unknown)) { refused = true; continue; }
      bridge?.send(message);
    }
    setSourceWarning(refused ? TOO_LARGE_SOURCE : null);
  };

  // When the wall reports ready: blackout and test grid first, so the wall never paints shapes while Blackout is on.
  // This effect is declared before the show effect, so it runs first when the output opens.
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    sendNow({ type: 'blackout', on: latest.current.blackout });
    sendNow({ type: 'testGrid', on: latest.current.testGrid });
    sendNow({ type: 'freeze', on: latest.current.freeze });
    // Solo before the show, so the wall never paints one frame of the shapes solo hides.
    sendNow({ type: 'solo', ids: soloIds(latest.current.shown, kept.solo) });
    sendSources(latest.current.shown);
    // Live's settings before the show, so a Live shape can start at once.
    sentLive.current = undefined;
    sendLive();
    sendNow(showMessage(latest.current.shown));
  }, [outputOpen, outputEpoch]);
  // Then the whole show again after every edit, and the trial show while a drag is in progress.
  const dragging = preview !== null;
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    sendSources(shown);
    if (dragging) sendNextFrame(showMessage(shown) as MapMessage & { type: 'show' });
    else {
      const fadeMs = wallFade.current;
      wallFade.current = null;
      sendNow(fadeMs === null ? showMessage(shown) : { ...showMessage(shown), fadeMs } as MapMessage);
    }
  }, [shown, outputOpen]);

  // Solo reaches the wall as the shapes it covers, sent again whenever that changes.
  const soloed = soloIds(shown, solo);
  const soloKey = soloed.join('\n');
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    sendNow({ type: 'solo', ids: soloed });
  }, [soloKey]);
  // Solo and the selection forget shapes and groups that have left the show (deleted, or undone).
  useEffect(() => {
    const s = kept.solo;
    const shapes = s.shapes.filter(id => show.shapes.some(sh => sh.id === id)), groups = s.groups.filter(id => show.groups.some(g => g.id === id));
    if (shapes.length !== s.shapes.length || groups.length !== s.groups.length) { kept.solo = { shapes, groups }; setSoloState(kept.solo); }
    setSelectedIds(ids => {
      const live = ids.filter(id => show.shapes.some(sh => sh.id === id));
      if (live.length === ids.length) return ids;
      if (live[0] !== ids[0]) { setSelectedIndex(null); setSelectedRing(-1); }
      return live;
    });
  }, [show]);

  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  const step = useCallback((action: Parameters<typeof mapReducer>[1]) => {
    const before = stateRef.current;
    const after = mapReducer(before, action);
    kept.state = stateRef.current = after;
    setState(after);
    if (after.show !== before.show) { saver.save(after.show); setNotice(null); }
    return after;
  }, []);
  const dispatch = useCallback((action: EditAction, merge?: string) => {
    if (!canEdit(loadedRef.current)) { setLastRefusal('Loading the show…'); return false; }
    const after = step({ type: 'edit', action, merge });
    // What triggers and auto-advance do never clears a note the operator may be reading.
    if (merge !== 'trigger' || after.refusal !== null) setLastRefusal(after.refusal);
    return after.refusal === null;
  }, [step]);
  const undo = useCallback(() => { if (canEdit(loadedRef.current)) step({ type: 'undo' }); }, [step]);
  const redo = useCallback(() => { if (canEdit(loadedRef.current)) step({ type: 'redo' }); }, [step]);

  const setBlackout = (on: boolean) => { kept.blackout = on; setBlackoutState(on); if (outputOpen) bridge?.send({ type: 'blackout', on }); };
  const setTestGrid = (on: boolean) => { kept.testGrid = on; setTestGridState(on); if (outputOpen) bridge?.send({ type: 'testGrid', on }); };
  /** Freeze holds the wall's picture: the instruments stop where they are. */
  const setFreeze = (on: boolean) => { kept.freeze = on; setFreezeState(on); if (outputOpen) bridge?.send({ type: 'freeze', on }); };

  // ---- Scenes and reactivity (stage 5) ----
  /** This screen's own compositor is told of a scene switch's fade through this, as the wall is through a message. */
  const pendingFade = useRef<number | null>(null);
  /** Switches scene: the wall and this screen crossfade over the scene's own fade time, or the show's. */
  const switchScene = (sceneId: string, merge?: string) => {
    const s = stateRef.current.show, scene = s.scenes.find(sc => sc.id === sceneId);
    if (!scene || s.sceneId === sceneId) return false;
    const ms = Math.round((scene.fadeSeconds ?? s.sceneFade) * 1000);
    if (!dispatch({ type: 'switchScene', sceneId }, merge)) return false;
    // Only once the switch is made. The wall gets the fade with the next whole show it is sent (never a drag's
    // trial show), so it can only ever belong to this switch.
    if (outputOpen) wallFade.current = ms;
    else pendingFade.current = ms;
    return true;
  };
  const stepScene = (by: 1 | -1, merge?: string) => {
    const s = stateRef.current.show;
    if (!s.scenes.length) return;
    const at = s.scenes.findIndex(sc => sc.id === s.sceneId);
    const next = s.scenes[((at < 0 ? (by > 0 ? -1 : 0) : at) + by + s.scenes.length) % s.scenes.length];
    switchScene(next.id, merge);
  };
  const [engine, setEngine] = useState<ReactivityEngine | null>(null);
  const meter = useMemo(() => new MeterStore(), []);
  /** This screen's compositor hears the signals here. */
  const onSignals = useRef<((signals: Signals) => void) | null>(null);
  // Live in Map: the Live screen's settings, sent to the wall while the show plays Live anywhere.
  const liveSettings = useLiveSettings();
  const live = liveSettings.settings;
  const liveRef = useRef<LiveSettings | null>(live);
  liveRef.current = live;
  const showUsesLive = usesLive(show);
  const reacts = showReacts(show) || (showUsesLive && !!live?.links.some(l => l.on));
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => { if (outputOpen) sendLive(); }, [live, showUsesLive, outputOpen]);
  /** This screen's own compositor hears Live's Clear and Capture empty room here, as the wall does through messages. */
  const onLiveAction = useRef<((action: 'clear' | 'captureRoom' | 'retry' | 'videoRetry') => void) | null>(null);
  const clearLive = () => { onLiveAction.current?.('clear'); if (outputOpen) bridge?.send({ type: 'liveClear' }); };
  const retryVideos = () => { onLiveAction.current?.('videoRetry'); if (outputOpen) bridge?.send({ type: 'videoRetry' }); };
  const retryLive = () => { onLiveAction.current?.('retry'); if (outputOpen) bridge?.send({ type: 'liveRetry' }); };
  const captureLiveRoom = () => { onLiveAction.current?.('captureRoom'); if (outputOpen) bridge?.send({ type: 'liveCaptureRoom' }); };
  useEffect(() => { if ((reacts || panelOpen) && !engine) setEngine(reactivity()); }, [reacts, panelOpen, engine]);
  // Once a frame: signals to the wall and to this screen, and triggers fired as ordinary actions.
  const triggerAct = useRef<(action: TriggerAction) => void>(() => {});
  triggerAct.current = action => {
    switch (action.kind) {
      // What triggers do is one undo step however often they fire, so the beat never pushes the operator's edits out.
      case 'scene': switchScene(action.sceneId, 'trigger'); break;
      case 'next-scene': stepScene(1, 'trigger'); break;
      case 'previous-scene': stepScene(-1, 'trigger'); break;
      case 'vary': dispatch({ type: 'varySource', sourceId: action.sourceId, entropy: Math.floor(Math.random() * 1e6) }, 'trigger'); break;
      case 'blackout': setBlackout(!latest.current.blackout); break;
      case 'freeze': setFreeze(!latest.current.freeze); break;
      case 'tap': engine?.tap(); break;
    }
  };
  // Scene auto-advance: counts only while neither Freeze nor Blackout is on; any scene change starts the count again.
  // What it does is one undo step with the triggers, so it never pushes the operator's edits out.
  const switchRef = useRef(switchScene);
  switchRef.current = switchScene;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const auto = show.autoAdvance, autoKey = auto ? `${auto.unit}:${auto.every}:${auto.order}` : '';
  useEffect(() => {
    if (!auto) return;
    let elapsed = 0, bars = 0, last = performance.now(), lastBeat: number | null = null, sceneAt = stateRef.current.show.sceneId;
    const id = setInterval(() => {
      const t = performance.now(), s = stateRef.current.show, { freeze, blackout } = latest.current;
      const signals = engineRef.current?.signals, beat = signals?.['tempo.beat'] !== undefined && signals?.['tempo.phase'] !== undefined ? signals['tempo.beat'] + signals['tempo.phase'] : null;
      if (s.sceneId !== sceneAt) { sceneAt = s.sceneId; elapsed = 0; bars = 0; }
      if (!freeze && !blackout) {
        elapsed += (t - last) / 1000;
        if (beat !== null && lastBeat !== null && beat > lastBeat) bars += (beat - lastBeat) / 4;
      }
      last = t; lastBeat = beat;
      if (!autoAdvanceDue(auto, elapsed, bars)) return;
      elapsed = 0; bars = 0;
      const next = nextAutoScene(s, s.sceneId, Math.random);
      if (next && switchRef.current(next, 'trigger')) sceneAt = next;
    }, 100);
    return () => clearInterval(id);
  }, [autoKey]);
  const listening = useRef({ panelOpen, outputOpen, reacts });
  listening.current = { panelOpen, outputOpen, reacts };
  const active = !!engine && (reacts || panelOpen);
  useEffect(() => {
    if (!engine || !active) return;
    // Triggers compare with the signals as they were, so a control already past halfway does not fire at once.
    let prev: Signals = { ...engine.signals }, shown = 0;
    // One subscription while anything reacts; the panel and the output are read as they are now, so opening either
    // never restarts the sound input.
    const off = engine.subscribe(now => {
      const { panelOpen, outputOpen, reacts } = listening.current;
      // The wall gets only the signals the show uses, so a controller with many knobs never makes the message too large.
      if (outputOpen && reacts) {
        const used = wallInputs(stateRef.current.show, liveRef.current);
        bridge?.send({ type: 'signals', signals: Object.fromEntries(Object.entries(now).filter(([k]) => used.has(k))) });
      }
      onSignals.current?.(now);
      for (const action of fire(stateRef.current.show.triggers, prev, now)) triggerAct.current(action);
      prev = now;
      // The panel's meters update a few times a second, not every frame.
      const t = performance.now();
      if (panelOpen && t - shown > 100) { shown = t; meter.set(now); }
    });
    // Leaving Map, or nothing reacting any more: the wall goes back to the set values at once.
    return () => { off(); if (listening.current.outputOpen) bridge?.send({ type: 'signals', signals: {} }); };
  }, [engine, active]);
  const openOutput = async () => {
    if (display === null) return;
    try { await bridge?.openOutput(display); }
    catch (error) { onError((error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); await refreshDisplays(); }
  };
  const closeOutput = () => { void bridge?.closeOutput(); };

  // The wall's crosshair follows the selected corner, including while it is being dragged.
  const crossShape = selectedId !== null ? shown.shapes.find(s => s.id === selectedId) : undefined;
  const crossPoint = crossShape && selectedIndex !== null ? (selectedRing < 0 ? crossShape.points : crossShape.holes[selectedRing])?.[selectedIndex] ?? null : null;
  const crossX = crossPoint?.x ?? null, crossY = crossPoint?.y ?? null;
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    const message: MapMessage & { type: 'crosshair' } = crossX === null || crossY === null ? { type: 'crosshair', point: null, shapeId: null } : { type: 'crosshair', point: { x: crossX, y: crossY }, shapeId: selectedId };
    if (dragging) sendNextFrame(message); else sendNow(message);
  }, [crossX, crossY, selectedId, outputOpen]);

  // Open replaces the held show and its undo history through the normal load path. A cancel does nothing and says nothing.
  const openShow = async () => {
    if (!bridge || !canEdit(loadedRef.current)) return;
    // Open replaces everything here, so it asks first when there is something to lose.
    const count = stateRef.current.show.shapes.length;
    if (count > 0 && !window.confirm(`Open a show file? It replaces the ${count} shape${count === 1 ? '' : 's'} here. Use Save As first to keep ${count === 1 ? 'it' : 'them'}.`)) return;
    let opened: unknown;
    try { opened = await bridge.openShow(); } catch { opened = { damaged: true }; }
    if (opened === null || opened === undefined) return;
    if (isDamaged(opened)) { setNotice(DAMAGED); return; }
    const { show: next } = validateShow(opened);
    setSelection(null); setPreview(null); setLastRefusal(null);
    step({ type: 'load', show: next });
    const dropped = leftOut(opened, next);
    setNotice(dropped > 0 ? `Show opened. ${dropped} shape${dropped === 1 ? '' : 's'} could not be read and ${dropped === 1 ? 'was' : 'were'} left out.` : 'Show opened');
  };
  // Save As always asks for a file name, and says which file it wrote.
  const saveShowAs = async () => {
    if (!bridge || !canEdit(loadedRef.current)) return;
    try {
      const file = await bridge.saveShow(JSON.stringify(stateRef.current.show), true);
      if (file) setNotice(`Saved as ${fileName(file)}`);
    } catch { setNotice('Could not save the show file. Nothing was changed on disk.'); }
  };

  // Identify flashes the selected shape on the wall for three seconds; pressing again restarts the timer.
  const identifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopIdentify = () => { if (identifyTimer.current) clearTimeout(identifyTimer.current); identifyTimer.current = null; };
  // Leaving the screen mid-flash must not leave the wall flashing.
  useEffect(() => () => {
    if (identifyTimer.current) bridge?.send({ type: 'identify', shapeId: null });
    stopIdentify();
  }, []);
  const identify = () => {
    if (!selectedId || !bridge) return;
    stopIdentify();
    bridge.send({ type: 'identify', shapeId: selectedId });
    identifyTimer.current = setTimeout(() => { identifyTimer.current = null; bridge.send({ type: 'identify', shapeId: null }); }, 3000);
  };

  const setSelection = (id: string | null, index: number | null = null, ring = -1) => { setSelectedIds(id === null ? [] : [id]); setSelectedIndex(id === null ? null : index); setSelectedRing(id === null ? -1 : ring); };
  /** Several shapes; their points are not chosen. */
  const selectMany = (ids: string[]) => { setSelectedIds(ids); setSelectedIndex(null); setSelectedRing(-1); };
  /** Shift-click: adds a shape to the selection, or takes it out. */
  const toggleSelected = (id: string) => { setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]); setSelectedIndex(null); setSelectedRing(-1); };
  const setSolo = (next: { shapes: string[]; groups: string[] }) => { kept.solo = next; setSoloState(next); };
  const setSnap = (on: boolean) => { kept.snap = on; setSnapState(on); };
  const setPhotoShown = (on: boolean) => { kept.photoShown = on; setPhotoShownState(on); };

  return { currentShow: () => stateRef.current.show, live, updateLive: liveSettings.update, clearLive, captureLiveRoom, retryLive, retryVideos, onLiveAction, switchScene, stepScene, pendingFade, engine: engine, startEngine: (): ReactivityEngine => { const e = engine ?? reactivity(); if (!engine) setEngine(e); return e; }, signals: meter, onSignals, reactivityPanel: panelOpen, setReactivityPanel: setPanelOpen,
    show, shown, preview, setPreview, wallPicture, openShow, saveShowAs, saveError, notice, loaded, selectedId, selectedIds, selectedIndex, selectedRing, setSelection, selectMany, toggleSelected, identify, setSelectedId: (id: string | null) => setSelection(id), tool, setTool,
    solo, setSolo, soloed, snap, setSnap, photoShown, setPhotoShown, setLastRefusal, dispatch, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0,
    lastRefusal, sendWarning: sendWarning ?? sourceWarning, blackout, setBlackout, testGrid, setTestGrid, freeze, setFreeze, wallState, displays, display, setDisplay, outputOpen, openOutput, closeOutput, desktop: !!bridge };
}
