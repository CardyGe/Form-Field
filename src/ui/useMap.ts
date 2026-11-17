import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditAction } from '../map/editor';
import { initialMapState, mapReducer, type MapState } from '../map/state';
import { autosaveSchedule, canEdit } from '../map/autosave';
import { acceptMapMessage } from '../map/messages';
import { createShow, validateShow, type ShowDocument } from '../map/show';

export interface Display { id: number; label: string; primary: boolean }

const TOO_LARGE = 'This show is too large to send to the wall. The wall keeps its last show.';

/** What the operator screen does with the show: hold it, save it, and keep the wall in step. */
export function useMap(onError: (message: string) => void) {
  const bridge = window.studio?.map;
  // The state is advanced through the pure reducer; the ref lets callbacks read it without waiting for a render.
  const stateRef = useRef<MapState>(initialMapState(createShow()));
  const [state, setState] = useState<MapState>(stateRef.current);
  const show = state.show;
  const [loaded, setLoaded] = useState(false);
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
  const latest = useRef({ show, blackout, testGrid });
  latest.current = { show, blackout, testGrid };
  const saver = useRef<ReturnType<typeof autosaveSchedule<string>> | null>(null);
  if (!saver.current) saver.current = autosaveSchedule<string>(async text => { await bridge?.saveAutosave(text).catch(() => {}); }, 500);

  // The saved working show, once. A damaged file was already moved aside by the main process, so an empty show is fine.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await bridge?.loadAutosave().catch(() => null) ?? null;
      if (cancelled) return;
      const next = validateShow(saved).show;
      stateRef.current = mapReducer(stateRef.current, { type: 'load', show: next });
      setState(stateRef.current); setLoaded(true);
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
    // Closing the window must not lose an edit made in the last half second.
    const offClose = window.studio!.onBeforeClose(async () => { await saver.current?.flush(); });
    return () => { offOutput(); offDisplays(); offClose(); saver.current?.flush(); void bridge.closeOutput().catch(() => {}); };
  }, []);

  // The wall gets the whole show when it reports ready, and again after every edit.
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    const message = { type: 'show' as const, show };
    if (!acceptMapMessage(message)) { setSendWarning(TOO_LARGE); return; }
    setSendWarning(null);
    bridge.send(message);
  }, [show, outputOpen]);
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    bridge.send({ type: 'blackout', on: latest.current.blackout });
    bridge.send({ type: 'testGrid', on: latest.current.testGrid });
  }, [outputOpen]);

  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  const step = useCallback((action: Parameters<typeof mapReducer>[1]) => {
    const before = stateRef.current;
    const after = mapReducer(before, action);
    stateRef.current = after;
    setState(after);
    if (after.show !== before.show) saver.current?.save(JSON.stringify(after.show));
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

  // The wall's crosshair follows the selected corner.
  const crossPoint = selectedId !== null && selectedIndex !== null ? show.shapes.find(s => s.id === selectedId)?.points[selectedIndex] ?? null : null;
  const crossX = crossPoint?.x ?? null, crossY = crossPoint?.y ?? null;
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    bridge.send(crossX === null || crossY === null ? { type: 'crosshair', point: null, shapeId: null } : { type: 'crosshair', point: { x: crossX, y: crossY }, shapeId: selectedId });
  }, [crossX, crossY, selectedId, outputOpen]);

  // Identify flashes the selected shape on the wall for three seconds; pressing again restarts the timer.
  const identifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopIdentify = () => { if (identifyTimer.current) clearTimeout(identifyTimer.current); identifyTimer.current = null; };
  useEffect(() => stopIdentify, []);
  const identify = () => {
    if (!selectedId || !bridge) return;
    stopIdentify();
    bridge.send({ type: 'identify', shapeId: selectedId });
    identifyTimer.current = setTimeout(() => { identifyTimer.current = null; bridge.send({ type: 'identify', shapeId: null }); }, 3000);
  };

  const setSelection = (id: string | null, index: number | null = null) => { setSelectedId(id); setSelectedIndex(id === null ? null : index); };

  return { show, loaded, selectedId, selectedIndex, setSelection, identify, setSelectedId: (id: string | null) => setSelection(id), tool, setTool, setLastRefusal, dispatch, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0,
    lastRefusal, sendWarning, blackout, setBlackout, testGrid, setTestGrid, displays, display, setDisplay, outputOpen, openOutput, closeOutput, desktop: !!bridge };
}
