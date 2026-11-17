import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditAction } from '../map/editor';
import { initialMapState, mapReducer, type MapState } from '../map/state';
import { autosaveSchedule, canEdit } from '../map/autosave';
import { acceptMapMessage, toWire, type MapMessage } from '../map/messages';
import { createShow, validateShow, type ShowDocument } from '../map/show';

export interface Display { id: number; label: string; primary: boolean }

const TOO_LARGE = 'This show is too large to send to the wall. The wall keeps its last show.';
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
  saver: ReturnType<typeof autosaveSchedule<string>>;
  /** The screen showing the session, told when a save fails or recovers; null while Map is not shown. */
  onSaveResult: ((failed: boolean) => void) | null;
}
let session: Session | null = null;
function mapSession(): Session {
  if (session) return session;
  const bridge = window.studio?.map;
  const created: Session = {
    state: initialMapState(createShow()), loaded: false, saveFailed: false, onSaveResult: null,
    saver: autosaveSchedule<string>(async text => {
      if (!bridge) return;
      // A failed write is reported, never swallowed: the operator keeps working and can Save As.
      try { await bridge.saveAutosave(text); created.saveFailed = false; created.onSaveResult?.(false); }
      catch (error) { created.saveFailed = true; created.onSaveResult?.(true); throw error; }
    }, 500),
  };
  // Registered once for the window's life: closing must not lose an edit made in the last half second,
  // and a save that fails refuses the close, with a message, even when Map is not on screen.
  if (bridge) window.studio?.onBeforeClose(async () => {
    try { await created.saver.flush(); }
    catch { created.saveFailed = true; created.onSaveResult?.(true); throw new Error('The Map show could not be saved. Open Map and use Save As to keep it.'); }
  });
  session = created;
  return created;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [tool, setTool] = useState<'select' | 'rectangle'>('select');
  const [lastRefusal, setLastRefusal] = useState<string | null>(null);
  const [sendWarning, setSendWarning] = useState<string | null>(null);
  const [blackout, setBlackoutState] = useState(false);
  const [testGrid, setTestGridState] = useState(false);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [display, setDisplay] = useState<number | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  // While a drag is in progress this trial show is drawn and sent to the wall; the held show changes only on release.
  const [preview, setPreview] = useState<ShowDocument | null>(null);
  const shown = preview ?? show;
  const [saveError, setSaveError] = useState<string | null>(kept.saveFailed ? SAVE_FAILED : null);
  const [wallPicture, setWallPicture] = useState<ImageBitmap | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef({ shown, blackout, testGrid });
  latest.current = { shown, blackout, testGrid };
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
    const offOutput = bridge.onOutputChanged(setOutputOpen);
    const offDisplays = bridge.onDisplaysChanged(() => void refreshDisplays());
    // The wall's own picture, for the operator screen. Old pictures are left to the garbage collector,
    // so one still being drawn is never closed under it.
    const offPreview = bridge.onPreview(bytes => {
      void createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })).then(setWallPicture).catch(() => {});
    });
    kept.onSaveResult = failed => setSaveError(failed ? SAVE_FAILED : null);
    // Leaving Map writes what is waiting. A failure stays recorded in the session and still refuses the close.
    return () => { offOutput(); offDisplays(); offPreview(); kept.onSaveResult = null; saver.flush().catch(() => {}); void bridge.closeOutput().catch(() => {}); };
  }, []);
  useEffect(() => { if (!outputOpen) setWallPicture(null); }, [outputOpen]);

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

  // When the wall reports ready: blackout and test grid first, so the wall never paints shapes while Blackout is on.
  // This effect is declared before the show effect, so it runs first when the output opens.
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    sendNow({ type: 'blackout', on: latest.current.blackout });
    sendNow({ type: 'testGrid', on: latest.current.testGrid });
    sendNow(showMessage(latest.current.shown));
  }, [outputOpen]);
  // Then the whole show again after every edit, and the trial show while a drag is in progress.
  const dragging = preview !== null;
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    if (dragging) sendNextFrame(showMessage(shown) as MapMessage & { type: 'show' });
    else sendNow(showMessage(shown));
  }, [shown, outputOpen]);

  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  const step = useCallback((action: Parameters<typeof mapReducer>[1]) => {
    const before = stateRef.current;
    const after = mapReducer(before, action);
    kept.state = stateRef.current = after;
    setState(after);
    if (after.show !== before.show) { saver.save(JSON.stringify(after.show)); setNotice(null); }
    return after;
  }, []);
  const dispatch = useCallback((action: EditAction) => {
    if (!canEdit(loadedRef.current)) { setLastRefusal('Loading the show…'); return false; }
    const after = step({ type: 'edit', action });
    setLastRefusal(after.refusal);
    return after.refusal === null;
  }, [step]);
  const undo = useCallback(() => { if (canEdit(loadedRef.current)) step({ type: 'undo' }); }, [step]);
  const redo = useCallback(() => { if (canEdit(loadedRef.current)) step({ type: 'redo' }); }, [step]);

  const setBlackout = (on: boolean) => { setBlackoutState(on); if (outputOpen) bridge?.send({ type: 'blackout', on }); };
  const setTestGrid = (on: boolean) => { setTestGridState(on); if (outputOpen) bridge?.send({ type: 'testGrid', on }); };
  const openOutput = async () => {
    if (display === null) return;
    try { await bridge?.openOutput(display); }
    catch (error) { onError((error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); await refreshDisplays(); }
  };
  const closeOutput = () => { void bridge?.closeOutput(); };

  // The wall's crosshair follows the selected corner, including while it is being dragged.
  const crossPoint = selectedId !== null && selectedIndex !== null ? shown.shapes.find(s => s.id === selectedId)?.points[selectedIndex] ?? null : null;
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

  const setSelection = (id: string | null, index: number | null = null) => { setSelectedId(id); setSelectedIndex(id === null ? null : index); };

  return { show, shown, preview, setPreview, wallPicture, openShow, saveShowAs, saveError, notice, loaded, selectedId, selectedIndex, setSelection, identify, setSelectedId: (id: string | null) => setSelection(id), tool, setTool, setLastRefusal, dispatch, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0,
    lastRefusal, sendWarning, blackout, setBlackout, testGrid, setTestGrid, displays, display, setDisplay, outputOpen, openOutput, closeOutput, desktop: !!bridge };
}
