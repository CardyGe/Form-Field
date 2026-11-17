import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useMap } from './useMap';
import { paint } from '../map/draw';
import { applyEdit, type EditAction } from '../map/editor';
import { parsePixelField, pointInPolygon, stageFromPointer, stagePixelsPerScreenPixel } from '../map/geometry';
import { shortcutFor, shouldCommit } from '../map/keys';
import { STAGE_SIZE, type Point, type ShowDocument } from '../map/show';

const REASONS: Record<string, string> = {
  crossing: 'Outline crosses itself', collapsed: 'Outline is too thin or flat', 'too-few': 'A shape needs at least three corners',
  'too-many': 'Too many corners', outside: 'Outline must stay on the stage', locked: 'That shape is locked',
  'not-found': 'That shape is gone', 'too-many-shapes': 'Too many shapes', 'duplicate-id': 'That shape already exists',
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

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** A text box that keeps its own draft and hands it over on blur or Enter. */
function CommitField({ label, value, onCommit, narrow }: { label: string; value: string; onCommit: (text: string) => void; narrow?: boolean }) {
  const [draft, setDraft] = useState(value);
  const start = useRef(value); // the text shown when the box was focused
  useEffect(() => { setDraft(value); start.current = value; }, [value]);
  const commit = () => {
    const changed = shouldCommit(start.current, draft);
    if (changed) onCommit(draft);
    setDraft(value); start.current = value;
  };
  return <label className="map-field">{label}<input aria-label={label} className={narrow ? 'narrow' : ''} value={draft} onFocus={() => { start.current = value; }} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} /></label>;
}

/** The Map screen. `header` is the app's own mode switch, so all screens share it. */
export default function MapPanel({ header, onError }: { header: ReactNode; onError: (message: string) => void }) {
  const map = useMap(onError);
  const canvas = useRef<HTMLCanvasElement>(null);

  const drag = useRef<Drag | null>(null);
  // While a drag is in progress the canvas shows this trial show; the real show changes only on release.
  const [preview, setPreview] = useState<ShowDocument | null>(null);
  const [dragNote, setDragNote] = useState<string | null>(null);
  const shown = preview ?? map.show;
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    const bump = () => setResizeTick(n => n + 1);
    window.addEventListener('resize', bump);
    return () => window.removeEventListener('resize', bump);
  }, []);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    paint(ctx, shown, { blackout: false, testGrid: false, identifyId: null, crosshair: null, selectedId: map.selectedId, selectedIndex: null, outlinesOnly: false, invalidIds: [] });
    // Corner handles are for the operator only; the output never draws them.
    const selected = shown.shapes.find(s => s.id === map.selectedId);
    // Handles keep a fixed size on screen, whatever size the canvas is displayed at.
    const handle = HANDLE_SIZE_PX * stagePixelsPerScreenPixel(canvas.current?.getBoundingClientRect().width ?? 0);
    if (selected) selected.points.forEach((point, i) => {
      const c = stagePx(point);
      ctx.fillStyle = i === map.selectedIndex ? '#ffd400' : '#ffffff';
      ctx.fillRect(c.x - handle / 2, c.y - handle / 2, handle, handle);
      ctx.strokeStyle = '#000000'; ctx.lineWidth = 2;
      ctx.strokeRect(c.x - handle / 2, c.y - handle / 2, handle, handle);
    });
  }, [shown, map.selectedId, map.selectedIndex, resizeTick]);

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
    if (!action) { setPreview(null); setDragNote(null); return; }
    const result = applyEdit(map.show, action);
    // A refused position leaves the last valid picture on screen and says why.
    if (result.ok) { setPreview(result.show); setDragNote(null); }
    else { setPreview(null); setDragNote(reasonText(result.reason)); }
  };

  const finishDrag = (e: PointerEvent<HTMLCanvasElement>, commit: boolean) => {
    const d = drag.current;
    drag.current = null; setPreview(null); setDragNote(null);
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
    const action = shortcutFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, target: e.target as HTMLElement | null });
    if (!action) return;
    if (action === 'undo') { e.preventDefault(); map.undo(); }
    else if (action === 'redo') { e.preventDefault(); map.redo(); }
    else if (action === 'select') map.setTool('select');
    else if (action === 'rectangle') map.setTool('rectangle');
    else if (action === 'deselect') map.setSelection(null);
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
  useEffect(() => setInspectorNote(null), [map.selectedId, map.selectedIndex]);
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
  const status = reason ?? inspectorNote ?? map.sendWarning ?? (map.outputOpen ? 'Showing on the output' : map.loaded ? 'Ready' : 'Loading…');

  return <section className="live-shell map-shell" role="region" aria-label="Map">
    <header className="app-header">{header}<div className="live-actions">
      <label className="live-inline">Projector<select aria-label="Projector" value={map.display ?? ''} disabled={map.outputOpen || !map.displays.length} onChange={e => map.setDisplay(Number(e.target.value))}>
        {map.displays.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      {map.outputOpen ? <button className="primary-button" onClick={map.closeOutput}>Close output</button>
        : <button className="primary-button" disabled={!map.desktop || map.display === null} title="Show the stage full screen on the chosen projector · Esc closes it" onClick={() => void map.openOutput()}>Open output</button>}
      <button className={`text-button live-toggle ${map.blackout ? 'on' : ''}`} aria-pressed={map.blackout} onClick={() => map.setBlackout(!map.blackout)}>Blackout</button>
      <button className="text-button" aria-pressed={map.testGrid} onClick={() => map.setTestGrid(!map.testGrid)}>Test grid</button>
      <button className="text-button" aria-pressed={map.tool === 'select'} title="Pick and move shapes and corners" onClick={() => map.setTool('select')}>Select</button>
      <button className="text-button" aria-pressed={map.tool === 'rectangle'} title="Drag on the stage to draw a rectangle" onClick={() => map.setTool('rectangle')}>Rectangle</button>
      <button className="text-button" disabled={!map.selectedId || !map.desktop} title="Flash the selected shape on the output" onClick={map.identify}>Identify</button>
      <button className="text-button" disabled={!map.canUndo} title="Undo · ⌘Z" onClick={map.undo}>Undo</button>
      <button className="text-button" disabled={!map.canRedo} title="Redo · ⇧⌘Z" onClick={map.redo}>Redo</button>
    </div></header>
    <div className="map-body">
      <aside className="live-column map-shapes" aria-label="Shapes">
        <h2>Shapes</h2>
        {map.show.shapes.length === 0 && <p className="muted-text">No shapes yet.</p>}
        <ul className="map-shape-list">{map.show.shapes.map(shape => <li key={shape.id} className={shape.id === map.selectedId ? 'selected' : ''}>
          <button className="map-shape-name" aria-pressed={shape.id === map.selectedId} onClick={() => map.setSelectedId(shape.id)}>
            <span className="map-swatch" style={{ background: shape.colour }} />{shape.name}</button>
          <button className="text-button" aria-pressed={shape.visible} aria-label={`${shape.visible ? 'Hide' : 'Show'} ${shape.name}`} onClick={() => map.dispatch({ type: 'setVisible', shapeId: shape.id, visible: !shape.visible })}>{shape.visible ? 'Shown' : 'Hidden'}</button>
          <button className="text-button" aria-pressed={shape.locked} aria-label={`${shape.locked ? 'Unlock' : 'Lock'} ${shape.name}`} onClick={() => map.dispatch({ type: 'setLocked', shapeId: shape.id, locked: !shape.locked })}>{shape.locked ? 'Locked' : 'Unlocked'}</button>
        </li>)}</ul>
      </aside>
      <main className="map-stage" tabIndex={0} aria-label="Stage area"><canvas ref={canvas} aria-label="Stage" style={{ cursor: map.tool === 'rectangle' ? 'crosshair' : 'default', touchAction: 'none' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={e => finishDrag(e, true)} onPointerCancel={e => finishDrag(e, false)} width={STAGE_SIZE.width} height={STAGE_SIZE.height} /></main>
      <aside className="live-column map-inspector" aria-label="Details">
        <h2>Details</h2>
        {!selectedShape ? <p className="muted-text">Pick a shape to see its details.</p> : <>
          <CommitField label="Name" value={selectedShape.name} onCommit={commitName} />
          <CommitField label="Colour" value={selectedShape.colour} onCommit={commitColour} narrow />
          <div className="map-toggles">
            <button className="text-button" aria-pressed={selectedShape.visible} onClick={() => map.dispatch({ type: 'setVisible', shapeId: selectedShape.id, visible: !selectedShape.visible })}>{selectedShape.visible ? 'Shown' : 'Hidden'}</button>
            <button className="text-button" aria-pressed={selectedShape.locked} onClick={() => map.dispatch({ type: 'setLocked', shapeId: selectedShape.id, locked: !selectedShape.locked })}>{selectedShape.locked ? 'Locked' : 'Unlocked'}</button>
          </div>
          {selectedPoint ? <>
            <h3>Corner {map.selectedIndex! + 1}</h3>
            <CommitField label="X" value={String(Math.round(selectedPoint.x * STAGE_SIZE.width))} onCommit={t => commitPosition('x', t)} narrow />
            <CommitField label="Y" value={String(Math.round(selectedPoint.y * STAGE_SIZE.height))} onCommit={t => commitPosition('y', t)} narrow />
            <p className="muted-text">Positions are in pixels on the projector. Click the stage, then use the arrow keys to nudge (Shift for 10).</p>
          </> : <p className="muted-text">Click a corner on the stage to set its exact position.</p>}
        </>}
      </aside>
    </div>
    <footer className="map-status" role="status">{status}</footer>
  </section>;
}
