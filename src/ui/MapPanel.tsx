import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useMap } from './useMap';
import MapMenu, { type MenuEntry } from './MapMenu';
import { paint } from '../map/draw';
import { applyEdit, attemptEdit, type EditAction } from '../map/editor';
import { parsePixelField, pointInPolygon, stageFromPointer, stagePixelsPerScreenPixel } from '../map/geometry';
import { shortcutFor, shouldCommit } from '../map/keys';
import { MAX_NAME_LENGTH, SPEED_RANGE, STAGE_SIZE, type Point, type ShowDocument } from '../map/show';
import { MapCompositor } from '../map/compositor';
import { GOVERNOR_SCALES } from '../map/playout';
import { PRESETS } from '../core/project';
import { KIND_LABELS } from '../core/library';
import { ACID_DRIP, CANDY, CYAN_YELLOW, ELECTRIC, HOT_SIGNAL, LIME_VIOLET, NEON_STRATA, POP_PORTAL, POUR, SOLAR } from '../core/palettes';

const REASONS: Record<string, string> = {
  crossing: 'Outline crosses itself', collapsed: 'Outline is too thin or flat', 'too-few': 'A shape needs at least three corners',
  'too-many': 'Too many corners', outside: 'Outline must stay on the stage', locked: 'That shape is locked',
  'not-found': 'That shape is gone', 'too-many-shapes': 'Too many shapes', 'duplicate-id': 'That shape already exists',
  'name-too-long': `Names can be at most ${MAX_NAME_LENGTH} characters`,
};
const COLOURS = ['#ff3b30', '#34c759', '#0a84ff', '#ffcc00', '#bf5af2', '#ff9f0a'];
const MIN_DRAG_PX = 4;       // a rectangle drag smaller than this (projector pixels) creates nothing
const HANDLE_REACH_PX = 14;  // how close to a corner counts as grabbing it (pixels on screen)
const HANDLE_SIZE_PX = 14;   // corner handle size (pixels on screen)

type Drag =
  | { kind: 'rectangle'; start: Point; id: string }
  | { kind: 'shape'; shapeId: string; start: Point }
  | { kind: 'point'; shapeId: string; index: number; start: Point };

const stagePx = (p: Point) => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height });
const newId = () => `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const newSourceId = () => `source-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const randomSeed = () => Math.floor(Math.random() * 1e6);

/** The Library, grouped as Studio groups it. */
const LIBRARY = Object.entries(PRESETS.reduce<Record<string, typeof PRESETS>>((groups, preset) => {
  (groups[preset.kind] ??= []).push(preset);
  return groups;
}, {})).map(([kind, presets]) => ({ label: KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind, presets }));
const PALETTES: [string, string[]][] = [
  ['Neon strata', NEON_STRATA], ['Acid drip', ACID_DRIP], ['Pop portal', POP_PORTAL], ['Hot signal', HOT_SIGNAL], ['Lime violet', LIME_VIOLET],
  ['Electric', ELECTRIC], ['Candy', CANDY], ['Solar', SOLAR], ['Cyan yellow', CYAN_YELLOW], ['Pour', POUR],
];
const paletteName = (palette: string[]) => PALETTES.find(([, colours]) => colours.join() === palette.join())?.[0] ?? '';

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** A text box that keeps its own draft and hands it over on blur or Enter. */
function CommitField({ label, value, onCommit, narrow, maxLength }: { label: string; value: string; onCommit: (text: string) => void; narrow?: boolean; maxLength?: number }) {
  const [draft, setDraft] = useState(value);
  const start = useRef(value); // the text shown when the box was focused
  useEffect(() => { setDraft(value); start.current = value; }, [value]);
  const commit = () => {
    const changed = shouldCommit(start.current, draft);
    if (changed) onCommit(draft);
    setDraft(value); start.current = value;
  };
  return <label className="map-field">{label}<input aria-label={label} className={narrow ? 'narrow' : ''} maxLength={maxLength} value={draft} onFocus={() => { start.current = value; }} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} /></label>;
}

/** The Map screen. `header` is the app's own mode switch, so all screens share it. */
export default function MapPanel({ header, onError }: { header: ReactNode; onError: (message: string) => void }) {
  const map = useMap(onError);
  const canvas = useRef<HTMLCanvasElement>(null);

  const drag = useRef<Drag | null>(null);
  // While a drag is in progress the canvas (and the wall) show map.preview; the real show changes only on release.
  const setPreview = map.setPreview;
  const [dragNote, setDragNote] = useState<string | null>(null);
  // The right-click menu: where it opened, and whether it is about a shape or the empty stage.
  const [menu, setMenu] = useState<{ x: number; y: number; shapeId: string | null } | null>(null);
  // A drag position that would be refused: drawn in red on this screen only, while the wall keeps the last valid picture.
  const [refused, setRefused] = useState<{ show: ShowDocument; id: string } | null>(null);
  const shown = map.shown;
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    const bump = () => setResizeTick(n => n + 1);
    window.addEventListener('resize', bump);
    return () => window.removeEventListener('resize', bump);
  }, []);

  // With the output closed, this screen plays the instruments itself, with the same compositor as the wall.
  const compositor = useRef<MapCompositor | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    try { compositor.current = new MapCompositor(canvas.current); } catch { compositor.current = null; }
    return () => { compositor.current?.dispose(); compositor.current = null; };
  }, []);
  const drawInputs = { shown, refused, selectedId: map.selectedId, selectedIndex: map.selectedIndex, outputOpen: map.outputOpen, wallPicture: map.wallPicture };
  const inputs = useRef(drawInputs);
  inputs.current = drawInputs;
  const playedShow = useRef<ShowDocument | null>(null);
  const drawStage = useCallback((now: number) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const { shown, refused, selectedId, selectedIndex, outputOpen, wallPicture } = inputs.current;
    // With the output open, the wall's own picture is drawn behind the outlines, so this screen shows what the projector
    // really has; the outlines are drawn here at once, so dragging feels instant while the picture follows a moment later.
    const background = outputOpen ? wallPicture ?? undefined : undefined;
    const picture = refused?.show ?? shown;
    const options = { blackout: false, testGrid: false, identifyId: null, crosshair: null, selectedId, selectedIndex: null,
      outlinesOnly: !!background, invalidIds: refused ? [refused.id] : [] };
    const local = compositor.current && !outputOpen && picture.sources.length > 0 ? compositor.current : null;
    if (local) {
      if (playedShow.current !== picture) { local.setShow(picture, new Map(picture.sources.map(s => [s.id, s.project]))); playedShow.current = picture; }
      local.setOptions(options);
      local.frame(now);
    } else paint(ctx, picture, options, background);
    // Corner handles are for the operator only; the output never draws them.
    const selected = picture.shapes.find(s => s.id === selectedId);
    // Handles keep a fixed size on screen, whatever size the canvas is displayed at.
    const handle = HANDLE_SIZE_PX * stagePixelsPerScreenPixel(canvas.current?.getBoundingClientRect().width ?? 0);
    if (selected) selected.points.forEach((point, i) => {
      const c = stagePx(point);
      ctx.fillStyle = i === selectedIndex ? '#ffd400' : '#ffffff';
      ctx.fillRect(c.x - handle / 2, c.y - handle / 2, handle, handle);
      ctx.strokeStyle = '#000000'; ctx.lineWidth = 2;
      ctx.strokeRect(c.x - handle / 2, c.y - handle / 2, handle, handle);
    });
  }, []);
  useEffect(() => { drawStage(performance.now()); }, [shown, refused, map.selectedId, map.selectedIndex, map.outputOpen, map.wallPicture, resizeTick, drawStage]);
  // Instruments move, so while they play here the stage is drawn every frame.
  const playsHere = !map.outputOpen && (refused?.show ?? shown).sources.length > 0;
  useEffect(() => {
    if (!playsHere) return;
    let raf = requestAnimationFrame(function loop(now) { drawStage(now); raf = requestAnimationFrame(loop); });
    return () => cancelAnimationFrame(raf);
  }, [playsHere, drawStage]);

  const pointerAt = (e: PointerEvent<HTMLCanvasElement>): Point => stageFromPointer(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
  const reasonText = (reason: string) => REASONS[reason] ?? reason;
  const tooSmall = (a: Point, b: Point) => Math.abs(a.x - b.x) * STAGE_SIZE.width < MIN_DRAG_PX || Math.abs(a.y - b.y) * STAGE_SIZE.height < MIN_DRAG_PX;

  /** The edit a drag asks for at the pointer's current position, or null when it asks for none. */
  const editFor = (d: Drag, at: Point): EditAction | null => {
    if (d.kind === 'rectangle') return tooSmall(d.start, at) ? null : { type: 'addRectangle', id: d.id, a: d.start, b: at, colour: COLOURS[map.show.shapes.length % COLOURS.length] };
    if (d.kind === 'point') return { type: 'movePoint', shapeId: d.shapeId, index: d.index, to: at };
    return { type: 'moveShape', shapeId: d.shapeId, dx: at.x - d.start.x, dy: at.y - d.start.y };
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !map.loaded) return;
    const at = pointerAt(e);
    map.setLastRefusal(null); setDragNote(null);
    if (map.tool === 'rectangle') {
      drag.current = { kind: 'rectangle', start: at, id: newId() };
    } else {
      const selected = map.show.shapes.find(s => s.id === map.selectedId);
      const reach = HANDLE_REACH_PX * stagePixelsPerScreenPixel(e.currentTarget.getBoundingClientRect().width);
      const corner = selected && selected.visible ? selected.points.findIndex(p => {
        const a = stagePx(p), b = stagePx(at);
        return Math.hypot(a.x - b.x, a.y - b.y) <= reach;
      }) : -1;
      if (selected && corner >= 0) {
        map.setSelection(selected.id, corner);
        drag.current = { kind: 'point', shapeId: selected.id, index: corner, start: at };
      } else {
        // The last shape in the list is drawn on top, so it is the one picked.
        const hit = [...map.show.shapes].reverse().find(s => s.visible && pointInPolygon(at, s.points));
        map.setSelection(hit?.id ?? null);
        drag.current = hit ? { kind: 'shape', shapeId: hit.id, start: at } : null;
      }
    }
    if (drag.current) e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const action = editFor(d, pointerAt(e));
    if (!action) { setPreview(null); setDragNote(null); setRefused(null); return; }
    const result = applyEdit(map.show, action);
    // A refused position keeps the last valid picture on the wall, draws the refused outline in red here, and says why.
    if (result.ok) { setPreview(result.show); setDragNote(null); setRefused(null); }
    else {
      setDragNote(reasonText(result.reason));
      const attempt = attemptEdit(map.show, action);
      setRefused(attempt ? { show: attempt.show, id: attempt.shapeId } : null);
    }
  };

  const finishDrag = (e: PointerEvent<HTMLCanvasElement>, commit: boolean) => {
    const d = drag.current;
    drag.current = null; setPreview(null); setDragNote(null); setRefused(null);
    if (!d || !commit) return;
    const at = pointerAt(e);
    const moved = Math.hypot((at.x - d.start.x) * STAGE_SIZE.width, (at.y - d.start.y) * STAGE_SIZE.height) >= MIN_DRAG_PX / 2;
    if (d.kind !== 'rectangle' && !moved) return; // a plain click only selects
    const action = editFor(d, at);
    if (!action) return;
    if (map.dispatch(action) && d.kind === 'rectangle') map.setSelection(d.id);
  };

  // Arrow keys move the chosen corner, unless the key press belongs to a text box.
  // Shortcuts work from anywhere in Map, unless the key press belongs to a text box.
  const onKeyDown = (e: globalThis.KeyboardEvent) => {
    if (menu) return; // the open menu handles its own keys
    const target = e.target as HTMLElement | null;
    // Delete, Backspace and Tab act on shapes only while the stage has focus (or nothing does), never from a button.
    const onStage = !target || target === document.body || !!target.closest?.('.map-stage');
    const action = shortcutFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, onStage, target });
    if (!action) return;
    if (action === 'undo') { e.preventDefault(); map.undo(); }
    else if (action === 'redo') { e.preventDefault(); map.redo(); }
    else if (action === 'select') map.setTool('select');
    else if (action === 'rectangle') map.setTool('rectangle');
    else if (action === 'deselect') map.setSelection(null);
    else if (action === 'duplicate') {
      if (!selectedShape) return;
      e.preventDefault();
      duplicate(selectedShape.id);
    }
    else if (action === 'next-corner' || action === 'previous-corner') {
      if (!selectedShape) return;
      e.preventDefault();
      const n = selectedShape.points.length, i = map.selectedIndex;
      const next = action === 'next-corner' ? (i === null ? 0 : (i + 1) % n) : (i === null ? n - 1 : (i - 1 + n) % n);
      map.setSelection(selectedShape.id, next);
    }
    else if (action === 'delete') {
      if (!selectedShape) return;
      e.preventDefault();
      if (map.dispatch({ type: 'delete', shapeId: selectedShape.id })) map.setSelection(null);
    } else {
      const step = ARROWS[e.key];
      if (!step || !selectedShape || map.selectedIndex === null) return;
      e.preventDefault();
      const size = e.shiftKey ? 10 : 1;
      map.dispatch({ type: 'nudgePoint', shapeId: selectedShape.id, index: map.selectedIndex, dxPx: step[0] * size, dyPx: step[1] * size });
    }
  };
  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const listener = (e: globalThis.KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const selectedShape = map.show.shapes.find(s => s.id === map.selectedId) ?? null;
  const selectedPoint = selectedShape && map.selectedIndex !== null ? selectedShape.points[map.selectedIndex] ?? null : null;
  const [inspectorNote, setInspectorNote] = useState<string | null>(null);
  // What the selected shape plays.
  const selectedSource = selectedShape?.sourceId ? map.show.sources.find(s => s.id === selectedShape.sourceId) ?? null : null;
  const [speedDraft, setSpeedDraft] = useState<number | null>(null);
  useEffect(() => setSpeedDraft(null), [selectedSource?.id]);
  const choosePlays = (value: string) => {
    if (!selectedShape) return;
    if (value === 'colour') map.dispatch({ type: 'setContent', shapeId: selectedShape.id, content: { kind: 'colour' } });
    else if (value.startsWith('preset:')) map.dispatch({ type: 'setContent', shapeId: selectedShape.id, content: { kind: 'preset', presetId: value.slice('preset:'.length), sourceId: newSourceId(), seed: randomSeed() } });
  };
  const vary = (sourceId: string) => map.dispatch({ type: 'varySource', sourceId, entropy: randomSeed() });
  const commitSpeed = () => {
    if (selectedSource && speedDraft !== null && speedDraft !== selectedSource.speed) map.dispatch({ type: 'setSourceSpeed', sourceId: selectedSource.id, speed: speedDraft });
    setSpeedDraft(null);
  };
  useEffect(() => setInspectorNote(null), [map.selectedId, map.selectedIndex]);
  // Shape actions shared by the right-click menu, the keyboard and the Details panel.
  const duplicate = (shapeId: string) => {
    const id = newId();
    // A copy of an instrument shape gets a source of its own, so its settings are its own from then on.
    if (map.dispatch({ type: 'duplicate', shapeId, id, sourceId: newSourceId() })) map.setSelection(id);
  };
  const remove = (shapeId: string) => { if (map.dispatch({ type: 'delete', shapeId })) map.setSelection(null); };
  const focusName = () => requestAnimationFrame(() => {
    const field = document.querySelector<HTMLInputElement>('.map-inspector input[aria-label="Name"]');
    field?.focus(); field?.select();
  });
  const openMenu = (x: number, y: number, shapeId: string | null) => {
    drag.current = null; setPreview(null); setDragNote(null); setRefused(null);
    if (shapeId) map.setSelection(shapeId, shapeId === map.selectedId ? map.selectedIndex : null);
    setMenu({ x, y, shapeId });
  };
  const onStageMenu = (e: MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!map.loaded) return;
    const at = stageFromPointer(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
    // The topmost visible shape under the pointer, as a left click would pick.
    const hit = [...map.show.shapes].reverse().find(s => s.visible && pointInPolygon(at, s.points));
    openMenu(e.clientX, e.clientY, hit?.id ?? null);
  };
  const menuEntries = (shapeId: string | null): MenuEntry[] => {
    const index = shapeId ? map.show.shapes.findIndex(s => s.id === shapeId) : -1;
    const shape = index >= 0 ? map.show.shapes[index] : null;
    if (!shape) return [
      { kind: 'item', label: 'Draw a rectangle', shortcut: 'R', checked: map.tool === 'rectangle', onSelect: () => map.setTool('rectangle') },
      { kind: 'item', label: 'Select and move', shortcut: 'V', checked: map.tool === 'select', onSelect: () => map.setTool('select') },
      { kind: 'separator' },
      { kind: 'item', label: 'Test grid', checked: map.testGrid, onSelect: () => map.setTestGrid(!map.testGrid) },
      { kind: 'item', label: 'Blackout', checked: map.blackout, onSelect: () => map.setBlackout(!map.blackout) },
      ...(map.selectedId ? [{ kind: 'separator' } as const, { kind: 'item', label: 'Deselect', shortcut: 'Esc', onSelect: () => map.setSelection(null) } as const] : []),
    ];
    const last = map.show.shapes.length - 1, locked = shape.locked;
    const reorder = (to: 'front' | 'back' | 'forward' | 'backward') => () => map.dispatch({ type: 'reorder', shapeId: shape.id, to });
    return [
      { kind: 'item', label: 'Duplicate', shortcut: '⌘D', onSelect: () => duplicate(shape.id) },
      ...(shape.sourceId ? [{ kind: 'item', label: 'Vary', disabled: locked, onSelect: () => vary(shape.sourceId!) } as const] : []),
      { kind: 'item', label: locked ? 'Delete (unlock first)' : 'Delete', shortcut: '⌫', danger: true, disabled: locked, onSelect: () => remove(shape.id) },
      { kind: 'separator' },
      { kind: 'item', label: 'Bring to front', disabled: locked || index === last, onSelect: reorder('front') },
      { kind: 'item', label: 'Bring forward', disabled: locked || index === last, onSelect: reorder('forward') },
      { kind: 'item', label: 'Send backward', disabled: locked || index === 0, onSelect: reorder('backward') },
      { kind: 'item', label: 'Send to back', disabled: locked || index === 0, onSelect: reorder('back') },
      { kind: 'separator' },
      { kind: 'swatches', label: 'Colour', colours: COLOURS, current: shape.colour, disabled: locked, onPick: colour => map.dispatch({ type: 'setColour', shapeId: shape.id, colour }) },
      { kind: 'item', label: 'Rename…', disabled: locked, onSelect: focusName },
      { kind: 'separator' },
      { kind: 'item', label: 'Locked', checked: shape.locked, onSelect: () => map.dispatch({ type: 'setLocked', shapeId: shape.id, locked: !shape.locked }) },
      { kind: 'item', label: 'Shown', checked: shape.visible, onSelect: () => map.dispatch({ type: 'setVisible', shapeId: shape.id, visible: !shape.visible }) },
      { kind: 'item', label: 'Identify on the projector', disabled: !map.outputOpen || !shape.visible, onSelect: map.identify },
    ];
  };

  const commitPosition = (axis: 'x' | 'y', text: string) => {
    if (!selectedShape || !selectedPoint || map.selectedIndex === null) return;
    const px = parsePixelField(text, { min: 0, max: axis === 'x' ? STAGE_SIZE.width : STAGE_SIZE.height });
    if (px === null) return;
    const to = axis === 'x' ? { x: px / STAGE_SIZE.width, y: selectedPoint.y } : { x: selectedPoint.x, y: px / STAGE_SIZE.height };
    if (to.x === selectedPoint.x && to.y === selectedPoint.y) return;
    map.dispatch({ type: 'movePoint', shapeId: selectedShape.id, index: map.selectedIndex, to });
  };
  const commitName = (text: string) => {
    const name = text.trim();
    if (selectedShape && name && name !== selectedShape.name) map.dispatch({ type: 'rename', shapeId: selectedShape.id, name });
  };
  const commitColour = (text: string) => {
    if (!selectedShape) return;
    const colour = text.trim();
    if (!/^#[0-9a-f]{6}$/i.test(colour)) { setInspectorNote('Colour must look like #rrggbb'); return; }
    setInspectorNote(null);
    if (colour !== selectedShape.colour) map.dispatch({ type: 'setColour', shapeId: selectedShape.id, colour });
  };

  const reason = dragNote ?? (map.lastRefusal ? (map.lastRefusal.endsWith('…') ? map.lastRefusal : `Not applied: ${reasonText(map.lastRefusal)}`) : null);
  // How the wall is keeping up, from its report once a second.
  const wall = map.wallState;
  const wallText = wall ? `Showing on the projector · ${wall.fps} fps${wall.level ? ` · instruments drawn at ${Math.round(GOVERNOR_SCALES[wall.level] * 100)} %${wall.level === 3 ? ', every other frame' : ''}` : ''}` : 'Showing on the projector';
  const failing = wall?.failing[0] ? `An instrument could not start, so its shape plays its colour: ${wall.failing[0].reason}` : null;
  const status = reason ?? inspectorNote ?? map.saveError ?? map.sendWarning ?? failing ?? map.notice ?? (map.outputOpen ? wallText : map.loaded ? 'Ready' : 'Loading…');

  return <section className="live-shell map-shell" role="region" aria-label="Map">
    <header className="app-header">{header}<div className="live-actions">
      <button className="text-button" disabled={!map.desktop || !map.loaded} title="Open a show file; it replaces the shapes here" onClick={() => void map.openShow()}>Open</button>
      <button className="text-button" disabled={!map.desktop || !map.loaded} title="Save the show to a file you name" onClick={() => void map.saveShowAs()}>Save As</button>
      <label className="live-inline">Projector<select aria-label="Projector" value={map.display ?? ''} disabled={map.outputOpen || !map.displays.length} onChange={e => map.setDisplay(Number(e.target.value))}>
        {map.displays.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      {map.outputOpen ? <button className="primary-button" onClick={map.closeOutput}>Close output</button>
        : <button className="primary-button" disabled={!map.desktop || map.display === null} title="Show the stage on the chosen projector, full screen · On this screen it opens as a window you can move · Esc closes it" onClick={() => void map.openOutput()}>Open output</button>}
      <button className={`text-button live-toggle ${map.blackout ? 'on' : ''}`} aria-pressed={map.blackout} onClick={() => map.setBlackout(!map.blackout)}>Blackout</button>
      <button className={`text-button live-toggle ${map.freeze ? 'on' : ''}`} aria-pressed={map.freeze} title="Hold the picture: the instruments stop where they are" onClick={() => map.setFreeze(!map.freeze)}>Freeze</button>
      <button className="text-button" aria-pressed={map.testGrid} onClick={() => map.setTestGrid(!map.testGrid)}>Test grid</button>
      <button className="text-button" aria-pressed={map.tool === 'select'} title="Pick and move shapes and corners" onClick={() => map.setTool('select')}>Select</button>
      <button className="text-button" aria-pressed={map.tool === 'rectangle'} title="Drag on the stage to draw a rectangle" onClick={() => map.setTool('rectangle')}>Rectangle</button>
      <button className="text-button" disabled={!map.selectedId || !map.desktop} title="Flash the selected shape on the projector" onClick={map.identify}>Identify</button>
      <button className="text-button" disabled={!map.canUndo} title="Undo · ⌘Z" onClick={map.undo}>Undo</button>
      <button className="text-button" disabled={!map.canRedo} title="Redo · ⇧⌘Z" onClick={map.redo}>Redo</button>
    </div></header>
    <div className="map-body">
      <aside className="live-column map-shapes" aria-label="Shapes">
        <h2>Shapes</h2>
        {map.show.shapes.length === 0 && <p className="muted-text">No shapes yet.</p>}
        <ul className="map-shape-list">{map.show.shapes.map(shape => <li key={shape.id} className={shape.id === map.selectedId ? 'selected' : ''}
          onContextMenu={e => { e.preventDefault(); if (map.loaded) openMenu(e.clientX, e.clientY, shape.id); }}>
          <button className="map-shape-name" aria-pressed={shape.id === map.selectedId} onClick={() => map.setSelectedId(shape.id)}>
            <span className="map-swatch" style={{ background: shape.colour }} />{shape.name}</button>
          <button className="text-button" aria-pressed={shape.visible} aria-label={`${shape.visible ? 'Hide' : 'Show'} ${shape.name}`} onClick={() => map.dispatch({ type: 'setVisible', shapeId: shape.id, visible: !shape.visible })}>{shape.visible ? 'Shown' : 'Hidden'}</button>
          <button className="text-button" aria-pressed={shape.locked} aria-label={`${shape.locked ? 'Unlock' : 'Lock'} ${shape.name}`} onClick={() => map.dispatch({ type: 'setLocked', shapeId: shape.id, locked: !shape.locked })}>{shape.locked ? 'Locked' : 'Unlocked'}</button>
        </li>)}</ul>
      </aside>
      <main className="map-stage" tabIndex={0} aria-label="Stage area"><canvas ref={canvas} aria-label="Stage" data-wall={map.outputOpen && map.wallPicture ? 'picture' : 'local'} style={{ cursor: map.tool === 'rectangle' ? 'crosshair' : 'default', touchAction: 'none' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={e => finishDrag(e, true)} onPointerCancel={e => finishDrag(e, false)} onContextMenu={onStageMenu} width={STAGE_SIZE.width} height={STAGE_SIZE.height} /></main>
      <aside className="live-column map-inspector" aria-label="Details">
        <h2>Details</h2>
        {!selectedShape ? <p className="muted-text">Pick a shape to see its details.</p> : <>
          <CommitField label="Name" value={selectedShape.name} onCommit={commitName} maxLength={MAX_NAME_LENGTH} />
          <CommitField label="Colour" value={selectedShape.colour} onCommit={commitColour} narrow />
          <h3>Content</h3>
          <label className="map-field">Plays<select aria-label="Plays" value={selectedSource ? 'current' : 'colour'} disabled={selectedShape.locked} onChange={e => choosePlays(e.target.value)}>
            <option value="colour">Its colour</option>
            {selectedSource && <option value="current">{selectedSource.project.name}</option>}
            {LIBRARY.map(group => <optgroup key={group.label} label={group.label}>{group.presets.map(p => <option key={p.id} value={`preset:${p.id}`}>{p.name}</option>)}</optgroup>)}
          </select></label>
          {selectedSource && <>
            <div className="map-toggles">
              <button className="text-button" disabled={selectedShape.locked} title="A new variation of this instrument" onClick={() => vary(selectedSource.id)}>Vary</button>
            </div>
            <label className="map-field">Palette<select aria-label="Palette" value={paletteName(selectedSource.project.layers[0]?.palette ?? [])} disabled={selectedShape.locked}
              onChange={e => { const found = PALETTES.find(([name]) => name === e.target.value); if (found) map.dispatch({ type: 'setSourcePalette', sourceId: selectedSource.id, palette: found[1] }); }}>
              <option value="" disabled>As made</option>
              {PALETTES.map(([name]) => <option key={name} value={name}>{name}</option>)}
            </select></label>
            <label className="map-field">Speed · {(speedDraft ?? selectedSource.speed).toFixed(2)}×
              <input aria-label="Speed" type="range" min={SPEED_RANGE.min} max={SPEED_RANGE.max} step={0.05} value={speedDraft ?? selectedSource.speed} disabled={selectedShape.locked}
                onChange={e => setSpeedDraft(Number(e.target.value))} onPointerUp={commitSpeed} onKeyUp={commitSpeed} onBlur={commitSpeed} /></label>
          </>}
          <div className="map-toggles">
            <button className="text-button" aria-pressed={selectedShape.visible} onClick={() => map.dispatch({ type: 'setVisible', shapeId: selectedShape.id, visible: !selectedShape.visible })}>{selectedShape.visible ? 'Shown' : 'Hidden'}</button>
            <button className="text-button" aria-pressed={selectedShape.locked} onClick={() => map.dispatch({ type: 'setLocked', shapeId: selectedShape.id, locked: !selectedShape.locked })}>{selectedShape.locked ? 'Locked' : 'Unlocked'}</button>
          </div>
          <div className="map-toggles">
            <button className="text-button" title="Copy this shape · ⌘D" onClick={() => duplicate(selectedShape.id)}>Duplicate</button>
            <button className="text-button danger-button" disabled={selectedShape.locked} title={selectedShape.locked ? 'Unlock the shape to delete it' : 'Delete this shape · ⌫'}
              onClick={() => remove(selectedShape.id)}>Delete shape</button>
          </div>
          {selectedPoint ? <>
            <h3>Corner {map.selectedIndex! + 1}</h3>
            <CommitField label="X" value={String(Math.round(selectedPoint.x * STAGE_SIZE.width))} onCommit={t => commitPosition('x', t)} narrow />
            <CommitField label="Y" value={String(Math.round(selectedPoint.y * STAGE_SIZE.height))} onCommit={t => commitPosition('y', t)} narrow />
            <p className="muted-text">Positions are in pixels on the projector. Click the stage, then use the arrow keys to nudge (Shift for 10). Tab steps to the next corner.</p>
          </> : <p className="muted-text">Click a corner on the stage to set its exact position.</p>}
        </>}
      </aside>
    </div>
    <footer className="map-status" role="status">{status}</footer>
    {menu && <MapMenu x={menu.x} y={menu.y} label={menu.shapeId ? 'Shape' : 'Stage'} entries={menuEntries(menu.shapeId)} onClose={() => setMenu(null)} />}
  </section>;
}
