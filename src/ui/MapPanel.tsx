import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useMap, showReacts, type MapTool } from './useMap';
import MapMenu, { type MenuEntry } from './MapMenu';
import MapShapeList from './MapShapeList';
import MapIcon from './mapIcons';
import MapDetails from './MapDetails';
import MapReactivity from './MapReactivity';
import MapScenes from './MapScenes';
import MapLookBrowser from './MapLookBrowser';
import { PRESETS } from '../core/project';
import { mapActions, newId, newSourceId } from './mapActions';
import { paint, ringPx, shownOnWall, traceRing } from '../map/draw';
import { applyEdit, attemptEdit, type EditAction } from '../map/editor';
import { rectangleFromDrag, stageFromPointer, stagePixelsPerScreenPixel } from '../map/geometry';
import { shortcutFor } from '../map/keys';
import { ellipseRing, hitShape, isCurved, squareBox, triangleRing } from '../map/outline';
import { joinedAnchors, snapMove, snapPoint, type SnapTarget } from '../map/snap';
import { boxHandles, marqueeSelect, pick, selectionBox, transformFor, type Box, type BoxHandle } from '../map/gestures';
import { ownCornersPinnable } from '../map/placement';
import { MAX_NAME_LENGTH, STAGE_SIZE, isShapeLocked, isShapeShown, type CurvePoint, type Point, type ShowDocument } from '../map/show';
import { MapCompositor } from '../map/compositor';
import { GOVERNOR_SCALES } from '../map/playout';

const REASONS: Record<string, string> = {
  crossing: 'Outline crosses itself', collapsed: 'Outline is too thin or flat', 'too-few': 'A shape needs at least three points',
  'too-many': 'Too many points (32 a shape, holes included)', outside: 'Points must stay on the stage', locked: 'That shape is locked',
  'hole-outside': 'A hole must sit inside its shape without touching its outline', 'holes-overlap': 'Holes cannot overlap',
  'too-many-holes': 'A shape can have at most 8 holes', 'too-many-groups': 'Too many groups', 'bad-grid': 'That grid size cannot be made',
  'not-four-corners': 'Only a shape with four corners, no curves and no holes can be made into a grid', blocker: 'A Blocker plays nothing',
  'bad-colour': 'That colour could not be used', 'bad-photo': 'That picture could not be used',
  'not-found': 'That shape is gone', 'too-many-shapes': 'Too many shapes', 'duplicate-id': 'That shape already exists',
  'name-too-long': `Names can be at most ${MAX_NAME_LENGTH} characters`,
  'too-many-sources': 'Too many instruments in this show', 'needs-source-id': 'That shape could not be copied',
  'unknown-preset': 'That look is not in the Library', 'bad-palette': 'That palette could not be used',
  'pin-folded': 'Those four corners fold over: the picture cannot be laid on them', 'pin-flat': 'Those four corners are too close to a line to carry a picture',
  'pin-own-corners': 'This shape pins by its own four corners: drag those', 'not-pinned': 'Choose Pin first', 'nothing-to-share': 'That shape plays no instrument to share',
  'corners-folded': 'The stage corners would fold over', 'corners-outside': 'Stage corners can go at most half a stage past the edge',
  'too-many-layers': 'A shape\'s composition can have at most four layers', 'bad-composition': 'That composition could not be read',
};
const COLOURS = ['#ff3b30', '#34c759', '#0a84ff', '#ffcc00', '#bf5af2', '#ff9f0a'];
const MIN_DRAG_PX = 4;       // a drawn box smaller than this (projector pixels) creates nothing
const REACH_PX = 10;         // how close to a point counts as grabbing it, and snapping reach (pixels on screen)
const HANDLE_SIZE_PX = 12;   // point handle size (pixels on screen)
const BOX_OUTSET_PX = 14;    // the scale handles sit this far outside the selection (pixels on screen)
const TURN_PX = 26;          // the turn handle sits this far above the box (pixels on screen)
const PHOTO_SIZE = { width: STAGE_SIZE.width, height: STAGE_SIZE.height };
const TOOLS: { tool: MapTool; label: string; key: string; title: string }[] = [
  { tool: 'select', label: 'Select', key: 'V', title: 'Pick, move, scale and turn shapes; drag points and curve handles' },
  { tool: 'rectangle', label: 'Rectangle', key: 'R', title: 'Drag on the stage to draw a rectangle (Shift: square)' },
  { tool: 'triangle', label: 'Triangle', key: 'T', title: 'Drag on the stage to draw a triangle' },
  { tool: 'ellipse', label: 'Ellipse', key: 'E', title: 'Drag on the stage to draw an ellipse (Shift: circle)' },
  { tool: 'pen', label: 'Pen', key: 'P', title: 'Click for a corner, click and drag for a curve; Enter or click the first point to close' },
];

type Drag =
  | { kind: 'draw'; tool: 'rectangle' | 'triangle' | 'ellipse'; start: Point; id: string; hole: string | null }
  | { kind: 'move'; shapeIds: string[]; start: Point; copies: { ids: string[]; sourceIds: string[] } | null }
  | { kind: 'point'; shapeId: string; ring: number; index: number; start: Point; alt: boolean }
  | { kind: 'handle'; shapeId: string; ring: number; index: number; which: 'in' | 'out' }
  | { kind: 'box'; handle: BoxHandle; start: Point; box: Box; shapeIds: string[] }
  | { kind: 'pin'; shapeId: string; index: number; start: Point }
  | { kind: 'corner'; index: number; start: Point }
  | { kind: 'marquee'; start: Point; now: Point; additive: boolean }
  | { kind: 'pen-handle' };
/** A Pen outline being drawn: its points so far, and the shape it will cut a hole in, if any. */
type Pen = { points: CurvePoint[]; hole: string | null };

const stagePx = (p: Point) => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height });
const CORNER_PX = 16;        // stage-corner handle radius (pixels on screen)
/** Where the stage's corners go on the projector: the show's stage corners, or the stage's own. */
const stageCornerPoints = (show: { stageCorners: Point[] | null }): Point[] => show.stageCorners ?? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
/** A corner past the stage's edge is shown, and grabbed, at the edge. */
/** A stage corner as shown: where it is, kept inside the stage area around the stage so it can always be grabbed. */
function visibleCorner(p: Point, stage: Element, area: Element): Point {
  const cr = stage.getBoundingClientRect(), ar = area.getBoundingClientRect();
  if (!cr.width || !cr.height) return p;
  const inset = CORNER_PX + 2;
  const x0 = (ar.left + inset - cr.left) / cr.width, x1 = (ar.right - inset - cr.left) / cr.width;
  const y0 = (ar.top + inset - cr.top) / cr.height, y1 = (ar.bottom - inset - cr.top) / cr.height;
  return { x: Math.min(x1, Math.max(x0, p.x)), y: Math.min(y1, Math.max(y0, p.y)) };
}
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** The photo, decoded once per picture, and the rectangle it fills: as large as fits on the stage, centred. */
function usePhoto(data: string | null, onLoad: () => void) {
  return useMemo(() => {
    if (!data) return null;
    const image = new Image();
    image.onload = onLoad;
    image.src = data;
    return image;
  }, [data]);
}
const photoRect = (image: HTMLImageElement) => {
  const scale = Math.min(STAGE_SIZE.width / image.naturalWidth, STAGE_SIZE.height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  return { x: (STAGE_SIZE.width - w) / 2, y: (STAGE_SIZE.height - h) / 2, w, h };
};
/** A chosen picture, shrunk to fit the stage, as a JPEG data URL small enough to keep in the show. */
async function photoFromFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_SIZE.width / bitmap.width, PHOTO_SIZE.height / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    const data = canvas.toDataURL('image/jpeg', quality);
    if (data.length < 6 * 1024 * 1024) return data;
  }
  throw new Error('too large');
}

/** The Map screen. `header` is the app's own mode switch, so all screens share it. */
export default function MapPanel({ header, onError, onEditInStudio }: { header: ReactNode; onError: (message: string) => void; onEditInStudio?: (sourceId: string, shapeId: string) => void }) {
  const map = useMap(onError);
  const act = mapActions(map);
  const canvas = useRef<HTMLCanvasElement>(null);
  /** A see-through layer over the whole stage area, for handles that sit outside the stage (box handles, stage corners). */
  const handles = useRef<HTMLCanvasElement>(null);

  const drag = useRef<Drag | null>(null);
  // While a drag is in progress the canvas (and the wall) show map.preview; the real show changes only on release.
  const setPreview = map.setPreview;
  const [dragNote, setDragNote] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; shapeId: string | null } | null>(null);
  // A drag position that would be refused: drawn in red on this screen only, while the wall keeps the last valid picture.
  const [refused, setRefused] = useState<{ show: ShowDocument; ids: string[] } | null>(null);
  const [pen, setPenState] = useState<Pen | null>(null);
  const penRef = useRef<Pen | null>(null);
  const setPen = (next: Pen | null) => { penRef.current = next; setPenState(next); };
  const [hover, setHover] = useState<Point | null>(null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  // Stage corners: while on, the four corner handles are shown and the shape tools rest; the last one touched takes the arrow keys.
  // The look browser, open for the selected shape.
  const [looksOpen, setLooksOpen] = useState(false);
  // Linked shapes are one instrument: a change of look reaches them all, unless this is turned off.
  const [linkedChanges, setLinkedChanges] = useState(true);
  const [cornersMode, setCornersMode] = useState(false);
  const [cornerIndex, setCornerIndex] = useState(0);
  const [snapMark, setSnapMark] = useState<SnapTarget | null>(null);
  const [inspectorNote, setInspectorNote] = useState<string | null>(null);
  const shown = map.shown;
  const [redrawTick, setRedrawTick] = useState(0);
  const redraw = useCallback(() => setRedrawTick(n => n + 1), []);
  useEffect(() => {
    window.addEventListener('resize', redraw);
    return () => window.removeEventListener('resize', redraw);
  }, [redraw]);
  const photo = usePhoto(map.show.photo?.data ?? null, redraw);
  const photoInput = useRef<HTMLInputElement>(null);

  // With the output closed, this screen plays the instruments itself, with the same compositor as the wall.
  const compositor = useRef<MapCompositor | null>(null);
  const pendingFadeRef = useRef<{ current: number | null } | null>(null);
  pendingFadeRef.current = map.pendingFade;
  // Signals reach this screen's compositor directly.
  map.onSignals.current = signals => compositor.current?.setSignals(signals);
  useEffect(() => {
    if (!canvas.current) return;
    // It draws on its own hidden canvas; this screen copies that picture and draws its marks over it.
    try { compositor.current = new MapCompositor(document.createElement('canvas')); } catch { compositor.current = null; }
    return () => { compositor.current?.dispose(); compositor.current = null; };
  }, []);
  const drawInputs = { cornersMode, cornerIndex, shown, refused, selectedId: map.selectedId, selectedIds: map.selectedIds, selectedIndex: map.selectedIndex, selectedRing: map.selectedRing, outputOpen: map.outputOpen, wallPicture: map.wallPicture,
    freeze: map.freeze, soloed: map.soloed, pen, hover, marquee, snapMark, photo: map.photoShown && map.show.photo && photo?.complete ? { image: photo, opacity: map.show.photo.opacity } : null, tool: map.tool };
  const inputs = useRef(drawInputs);
  inputs.current = drawInputs;
  const playedShow = useRef<ShowDocument | null>(null);
  const screenScale = () => stagePixelsPerScreenPixel(canvas.current?.getBoundingClientRect().width ?? 0);

  const drawStage = useCallback((now: number) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const d = inputs.current;
    // With the output open, the wall's own picture is drawn behind the outlines, so this screen shows what the projector
    // really has; the outlines are drawn here at once, so dragging feels instant while the picture follows a moment later.
    const background = d.outputOpen ? d.wallPicture ?? undefined : undefined;
    const picture = d.refused?.show ?? d.shown;
    const options = { blackout: false, testGrid: false, identifyId: null, crosshair: null, selectedId: d.selectedId, selectedIndex: null,
      outlinesOnly: !!background, invalidIds: d.refused ? d.refused.ids : [], solo: d.soloed, operator: true };
    // With the output closed this screen draws the stage as the wall would (placement, pins, look), instruments or not.
    const local = compositor.current && !d.outputOpen && !compositor.current.stats().contextLost ? compositor.current : null;
    if (local) {
      if (playedShow.current !== picture) {
        // A scene switch crossfades over its fade time here as on the wall.
        local.setShow(picture, new Map(picture.sources.map(s => [s.id, s.project])), pendingFadeRef.current?.current ?? undefined);
        if (pendingFadeRef.current) pendingFadeRef.current.current = null;
        playedShow.current = picture;
      }
      local.setOptions(options);
      local.setFrozen(d.freeze);
      // This screen draws its marks over the stage, so the stage is drawn again under them every time.
      local.invalidate();
      local.frame(now);
      ctx.drawImage(local.canvas, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    } else {
      // Not playing here (the wall plays them, or nothing does): the instruments here give their graphics contexts back.
      if (playedShow.current && compositor.current) { compositor.current.setShow({ shapes: [], sources: [], groups: [] }, new Map()); playedShow.current = null; }
      paint(ctx, picture, options, background);
    }
    const k = screenScale();
    // The photo: over the picture at its own opacity, with every outline drawn again on top so it can be traced.
    if (d.photo) {
      const r = photoRect(d.photo.image);
      ctx.save(); ctx.globalAlpha = d.photo.opacity; ctx.drawImage(d.photo.image, r.x, r.y, r.w, r.h); ctx.restore();
      for (const s of picture.shapes) {
        if (!shownOnWall(picture, s, d.soloed)) continue;
        ctx.beginPath(); for (const ring of [s.points, ...s.holes]) traceRing(ctx, ringPx(ring));
        ctx.strokeStyle = s.blocker ? '#808080' : s.colour; ctx.lineWidth = 2 * k; ctx.stroke();
      }
    }
    // Every selected shape is outlined; the first one's points (holes included) get handles.
    // A refused outline keeps its red: no selection outline is drawn over it.
    for (const s of picture.shapes) {
      if (!d.selectedIds.includes(s.id) || !isShapeShown(picture, s) || d.refused?.ids.includes(s.id)) continue;
      ctx.beginPath(); for (const ring of [s.points, ...s.holes]) traceRing(ctx, ringPx(ring));
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2 * k; ctx.stroke();
    }
    const selected = picture.shapes.find(s => s.id === d.selectedId);
    const handle = HANDLE_SIZE_PX * k;
    if (selected && d.selectedIds.length === 1) {
      [selected.points, ...selected.holes].forEach((ring, r) => ring.forEach((point, i) => {
        const c = stagePx(point), chosen = r - 1 === d.selectedRing && i === d.selectedIndex;
        // The chosen point's curve handles: a line out to each, ending in a dot.
        if (chosen) for (const h of [point.in, point.out]) if (h) {
          const e = stagePx({ x: point.x + h.x, y: point.y + h.y });
          ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 1.5 * k; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.stroke();
          ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(e.x, e.y, handle / 2.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = chosen ? '#ffd400' : '#ffffff';
        ctx.strokeStyle = '#000000'; ctx.lineWidth = 2 * k;
        // A curve point is round, a corner square, so the two can be told apart at a glance.
        ctx.beginPath();
        if (isCurved(point)) ctx.arc(c.x, c.y, handle / 2, 0, Math.PI * 2); else ctx.rect(c.x - handle / 2, c.y - handle / 2, handle, handle);
        ctx.fill(); ctx.stroke();
      }));
    }
    // The Pen outline so far, with a line to the pointer; the first point is ringed, since clicking it closes the shape.
    if (d.pen && d.pen.points.length) {
      const pts = ringPx(d.pen.points);
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (a.out || b.in) ctx.bezierCurveTo(a.x + (a.out?.x ?? 0), a.y + (a.out?.y ?? 0), b.x + (b.in?.x ?? 0), b.y + (b.in?.y ?? 0), b.x, b.y); else ctx.lineTo(b.x, b.y);
      }
      if (d.hover) { const h = stagePx(d.hover); ctx.lineTo(h.x, h.y); }
      ctx.strokeStyle = '#00e0ff'; ctx.lineWidth = 2 * k; ctx.stroke();
      pts.forEach((p, i) => { ctx.fillStyle = i === 0 ? '#00e0ff' : '#ffffff'; ctx.fillRect(p.x - handle / 2, p.y - handle / 2, handle, handle); });
      ctx.strokeStyle = '#00e0ff'; ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, REACH_PX * k, 0, Math.PI * 2); ctx.stroke();
    }
    // A pinned shape's own pin handles: diamonds joined by a dashed line.
    if (selected && d.selectedIds.length === 1 && selected.placement.kind === 'pin' && selected.placement.pin && !ownCornersPinnable(selected)) {
      const pin = selected.placement.pin.map(stagePx);
      ctx.save(); ctx.setLineDash([8 * k, 6 * k]); ctx.strokeStyle = '#ff7ad9'; ctx.lineWidth = 1.5 * k;
      ctx.beginPath(); pin.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.stroke(); ctx.restore();
      for (const q of pin) {
        ctx.beginPath(); ctx.moveTo(q.x, q.y - handle * .7); ctx.lineTo(q.x + handle * .7, q.y); ctx.lineTo(q.x, q.y + handle * .7); ctx.lineTo(q.x - handle * .7, q.y); ctx.closePath();
        ctx.fillStyle = '#ff7ad9'; ctx.fill(); ctx.strokeStyle = '#000000'; ctx.lineWidth = 2 * k; ctx.stroke();
      }
    }
    if (d.marquee) {
      const a = stagePx(d.marquee.a), b = stagePx(d.marquee.b);
      ctx.save(); ctx.setLineDash([6 * k, 4 * k]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 * k; ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.restore();
    }
    if (d.snapMark) {
      const c = stagePx(d.snapMark.at);
      ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(c.x, c.y, 7 * k, 0, Math.PI * 2); ctx.stroke();
    }
    // The handles that may sit outside the stage are drawn on the layer over the whole stage area, in stage pixels.
    const o = handles.current, area = o?.parentElement, c = canvas.current;
    const octx = o?.getContext('2d');
    if (o && area && c && octx) {
      const ar = area.getBoundingClientRect(), cr = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const w = Math.round(ar.width * dpr), h = Math.round(ar.height * dpr);
      if (o.width !== w || o.height !== h) { o.width = w; o.height = h; }
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, w, h);
      const toArea = cr.width > 0 ? cr.width / STAGE_SIZE.width * dpr : 1;
      octx.setTransform(toArea, 0, 0, toArea, (cr.left - ar.left) * dpr, (cr.top - ar.top) * dpr);
      const ctx = octx;
    // The scale-and-turn box around the selection.
    const editable = d.tool === 'select' && d.selectedIds.length > 0 && picture.shapes.filter(s => d.selectedIds.includes(s.id)).every(s => isShapeShown(picture, s) && !isShapeLocked(picture, s));
    const box = editable ? selectionBox(picture, d.selectedIds) : null;
    if (box && !d.cornersMode) {
      const h = boxHandles(box, { outsetPx: BOX_OUTSET_PX * k, turnPx: TURN_PX * k });
      ctx.save(); ctx.setLineDash([6 * k, 4 * k]); ctx.strokeStyle = 'rgba(255,212,0,0.7)'; ctx.lineWidth = 1 * k;
      ctx.strokeRect(h.nw.x, h.nw.y, h.se.x - h.nw.x, h.se.y - h.nw.y); ctx.restore();
      ctx.strokeStyle = 'rgba(255,212,0,0.7)'; ctx.beginPath(); ctx.moveTo(h.turn.x, h.nw.y); ctx.lineTo(h.turn.x, h.turn.y); ctx.stroke();
      for (const name of ['nw', 'ne', 'se', 'sw'] as const) { ctx.fillStyle = '#ffd400'; ctx.fillRect(h[name].x - handle / 2.5, h[name].y - handle / 2.5, handle / 1.25, handle / 1.25); }
      ctx.beginPath(); ctx.arc(h.turn.x, h.turn.y, handle / 2, 0, Math.PI * 2); ctx.fillStyle = '#ffd400'; ctx.fill();
    }
    // Stage corners: where the stage's corners go on the projector, numbered, joined by a dashed line.
    if (d.cornersMode) {
      const corners = stageCornerPoints(picture).map(p => visibleCorner(p, c, area)).map(stagePx);
      ctx.save(); ctx.setLineDash([10 * k, 6 * k]); ctx.strokeStyle = '#00e0ff'; ctx.lineWidth = 2 * k;
      ctx.beginPath(); corners.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.stroke(); ctx.restore();
      corners.forEach((q, i) => {
        ctx.beginPath(); ctx.arc(q.x, q.y, CORNER_PX * k, 0, Math.PI * 2);
        ctx.fillStyle = i === d.cornerIndex ? '#00e0ff' : 'rgba(0,224,255,0.35)'; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * k; ctx.stroke();
        ctx.fillStyle = '#000000'; ctx.font = `600 ${14 * k}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), q.x, q.y);
      });
    }
    }
  }, []);
  useEffect(() => { drawStage(performance.now()); }, [cornersMode, cornerIndex, shown, refused, map.selectedIds, map.selectedIndex, map.selectedRing, map.outputOpen, map.wallPicture, redrawTick, pen, hover, marquee, snapMark, map.soloed.join(), map.photoShown, map.tool, drawStage]);
  // Instruments move, so while they play here the stage is drawn every frame.
  const playsHere = !map.outputOpen && ((refused?.show ?? shown).sources.length > 0 || showReacts(shown));
  useEffect(() => {
    if (!playsHere) return;
    let raf = requestAnimationFrame(function loop(now) { drawStage(now); raf = requestAnimationFrame(loop); });
    return () => cancelAnimationFrame(raf);
  }, [playsHere, drawStage]);

  /** Where the pointer is on the stage, kept to the stage; and the same without keeping it there (it may be beside the stage). */
  const pointerAt = (e: { clientX: number; clientY: number }): Point => stageFromPointer(canvas.current!.getBoundingClientRect(), e.clientX, e.clientY);
  const pointerFree = (e: { clientX: number; clientY: number }): Point => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: r.width ? (e.clientX - r.left) / r.width : 0, y: r.height ? (e.clientY - r.top) / r.height : 0 };
  };
  const reasonText = (reason: string) => REASONS[reason] ?? reason;
  const reach = () => ({ reachPx: REACH_PX * screenScale(), outsetPx: BOX_OUTSET_PX * screenScale(), turnPx: TURN_PX * screenScale() });
  /** Snapping is on unless switched off, or Ctrl is held. */
  const snapping = (e: { ctrlKey: boolean }) => map.snap && !e.ctrlKey;
  const snapped = (at: Point, e: { ctrlKey: boolean }, exclude: string[]): Point => {
    if (!snapping(e)) { setSnapMark(null); return at; }
    const r = snapPoint(at, map.show, { shapeIds: exclude }, REACH_PX * screenScale());
    setSnapMark(r.target);
    return r.at;
  };
  const selection = () => ({ ids: map.selectedIds, ring: map.selectedRing, index: map.selectedIndex });
  const colourFor = () => COLOURS[map.show.shapes.length % COLOURS.length];

  /** The edit a drag asks for at the pointer's current position, or null when it asks for none. */
  const editFor = (d: Drag, raw: Point, e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): EditAction | null => {
    switch (d.kind) {
      case 'draw': {
        let at = snapped(raw, e, []);
        if (e.shiftKey) at = squareBox(d.start, at);
        if (Math.abs(at.x - d.start.x) * STAGE_SIZE.width < MIN_DRAG_PX || Math.abs(at.y - d.start.y) * STAGE_SIZE.height < MIN_DRAG_PX) return null;
        const points = d.tool === 'ellipse' ? ellipseRing(d.start, at) : d.tool === 'triangle' ? triangleRing(d.start, at) : rectangleFromDrag(d.start, at);
        return d.hole ? { type: 'addHole', shapeId: d.hole, points } : { type: 'addShape', id: d.id, points, colour: colourFor() };
      }
      case 'point': {
        const joined = snapping(e);
        const from = (d.ring < 0 ? map.show.shapes.find(s => s.id === d.shapeId)?.points : map.show.shapes.find(s => s.id === d.shapeId)?.holes[d.ring])?.[d.index];
        const exclude = [d.shapeId, ...(joined && from ? joinedAnchors(map.show, d.shapeId, from).map(j => j.shapeId) : [])];
        return { type: 'movePoint', shapeId: d.shapeId, ring: d.ring, index: d.index, to: snapped(raw, e, exclude), joined };
      }
      case 'pin': setSnapMark(null); return { type: 'movePin', shapeId: d.shapeId, index: d.index, to: snapped(raw, e, [d.shapeId]) };
      case 'corner': setSnapMark(null); return { type: 'moveStageCorner', index: d.index, to: raw };
      case 'handle': setSnapMark(null); return { type: 'moveHandle', shapeId: d.shapeId, ring: d.ring, index: d.index, which: d.which, to: raw, mirror: !e.altKey };
      case 'box': {
        const m = transformFor(d.handle, d.start, stagePx(raw), d.box, e.shiftKey);
        return { type: 'transformShapes', shapeIds: d.shapeIds, matrix: m };
      }
      case 'move': {
        let dx = raw.x - d.start.x, dy = raw.y - d.start.y;
        if (snapping(e)) {
          const shapes = map.show.shapes.filter(s => d.shapeIds.includes(s.id));
          const r = snapMove(shapes.flatMap(s => [...s.points, ...s.holes.flat()]), dx, dy, map.show, { shapeIds: d.shapeIds }, REACH_PX * screenScale());
          dx = r.dx; dy = r.dy; setSnapMark(r.target);
        } else setSnapMark(null);
        if (d.copies) return { type: 'duplicateShapes', shapeIds: d.shapeIds, ids: d.copies.ids, sourceIds: d.copies.sourceIds, offset: { dx, dy } };
        return { type: 'moveShapes', shapeIds: d.shapeIds, dx, dy };
      }
      default: return null;
    }
  };

  const clearDrag = () => { drag.current = null; setPreview(null); setDragNote(null); setRefused(null); setMarquee(null); setSnapMark(null); };

  /** Closes the Pen outline: a new shape, or a hole in the shape it was started in. A refused outline keeps the Pen open. */
  const closePen = () => {
    const p = penRef.current;
    if (!p || p.points.length < 3) { if (p) map.setLastRefusal('too-few'); return; }
    const id = newId();
    const ok = map.dispatch(p.hole ? { type: 'addHole', shapeId: p.hole, points: p.points } : { type: 'addShape', id, points: p.points, colour: colourFor() });
    if (!ok) return;
    setPen(null); setHover(null);
    map.setSelection(p.hole ?? id);
  };

  /** A press with Alt and a drawing tool inside the selected shape starts a hole in it. */
  const holeTarget = (at: Point, alt: boolean): string | null => {
    if (!alt || map.selectedIds.length !== 1) return null;
    const s = map.show.shapes.find(sh => sh.id === map.selectedId);
    return s && isShapeShown(map.show, s) && !isShapeLocked(map.show, s) && hitShape(at, s.points, s.holes) ? s.id : null;
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !map.loaded) return;
    const raw = pointerAt(e);
    map.setLastRefusal(null); setDragNote(null);
    const tool = map.tool;
    // Stage corners: only the four corner handles answer, and the corner keeps pointing at the projector's picture.
    if (cornersMode) {
      const free = pointerFree(e), here = stagePx(free), r = CORNER_PX * 1.5 * screenScale(), area = e.currentTarget;
      const i = stageCornerPoints(map.show).findIndex(q => { const c = stagePx(visibleCorner(q, canvas.current!, area)); return Math.hypot(c.x - here.x, c.y - here.y) <= r; });
      if (i >= 0) { setCornerIndex(i); drag.current = { kind: 'corner', index: i, start: free }; e.currentTarget.setPointerCapture(e.pointerId); }
      return;
    }
    if (tool === 'pen') {
      const p = penRef.current;
      const at = snapped(raw, e, []);
      // Clicking the first point closes the outline.
      if (p && p.points.length >= 3) {
        const first = stagePx(p.points[0]), here = stagePx(raw);
        if (Math.hypot(first.x - here.x, first.y - here.y) <= REACH_PX * screenScale()) { closePen(); return; }
      }
      // A second click on the last point (a double-click, say) adds nothing: two points on one spot would be refused.
      if (p) {
        const prev = stagePx(p.points[p.points.length - 1]), here = stagePx(at);
        if (Math.hypot(prev.x - here.x, prev.y - here.y) <= REACH_PX * screenScale()) return;
      }
      const next: Pen = p ? { ...p, points: [...p.points, at] } : { points: [at], hole: holeTarget(raw, e.altKey) };
      setPen(next);
      drag.current = { kind: 'pen-handle' };
    } else if (tool !== 'select') {
      drag.current = { kind: 'draw', tool, start: snapped(raw, e, []), id: newId(), hole: holeTarget(raw, e.altKey) };
    } else {
      const picked = pick(pointerFree(e), map.show, selection(), reach());
      if (picked.kind === 'pin') drag.current = { kind: 'pin', shapeId: picked.shapeId, index: picked.index, start: raw };
      else if (picked.kind === 'handle') drag.current = { kind: 'handle', shapeId: picked.shapeId, ring: picked.ring, index: picked.index, which: picked.which };
      else if (picked.kind === 'point') {
        map.setSelection(picked.shapeId, picked.index, picked.ring);
        drag.current = { kind: 'point', shapeId: picked.shapeId, ring: picked.ring, index: picked.index, start: raw, alt: e.altKey };
      } else if (picked.kind === 'box') {
        const ids = act.selected();
        drag.current = { kind: 'box', handle: picked.handle, start: stagePx(pointerFree(e)), box: selectionBox(map.show, ids)!, shapeIds: ids };
      } else if (picked.kind === 'side' || picked.kind === 'shape') {
        const id = picked.shapeId;
        if (e.shiftKey) { map.toggleSelected(id); return; }
        const ids = map.selectedIds.includes(id) ? act.selected() : [id];
        if (!map.selectedIds.includes(id)) map.setSelection(id);
        else if (map.selectedIndex !== null) map.setSelection(map.selectedId, null, -1);
        // Alt-drag leaves the originals where they are and drags copies.
        drag.current = { kind: 'move', shapeIds: ids, start: raw, copies: e.altKey ? { ids: ids.map(() => newId()), sourceIds: ids.map(() => newSourceId()) } : null };
      } else {
        if (!e.shiftKey) map.setSelection(null);
        drag.current = { kind: 'marquee', start: raw, now: raw, additive: e.shiftKey };
      }
    }
    if (drag.current) e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const raw = pointerAt(e);
    const d = drag.current;
    if (map.tool === 'pen' && penRef.current) setHover(snapping(e) ? snapPoint(raw, map.show, { shapeIds: [] }, REACH_PX * screenScale()).at : raw);
    if (!d) return;
    if (d.kind === 'marquee') { d.now = raw; setMarquee({ a: d.start, b: raw }); return; }
    if (d.kind === 'pen-handle') {
      // Dragging away from a just-placed Pen point gives it curve handles, mirrored.
      const p = penRef.current;
      if (!p) return;
      const last = p.points[p.points.length - 1];
      const out = { x: raw.x - last.x, y: raw.y - last.y };
      const curved = Math.hypot(out.x * STAGE_SIZE.width, out.y * STAGE_SIZE.height) >= MIN_DRAG_PX;
      const point: CurvePoint = curved ? { x: last.x, y: last.y, in: { x: -out.x, y: -out.y }, out } : { x: last.x, y: last.y };
      setPen({ ...p, points: [...p.points.slice(0, -1), point] });
      return;
    }
    const action = editFor(d, d.kind === 'box' || d.kind === 'corner' ? pointerFree(e) : raw, e);
    if (!action) { setPreview(null); setDragNote(null); setRefused(null); return; }
    const result = applyEdit(map.show, action);
    // A refused position keeps the last valid picture on the wall, draws the refused outline in red here, and says why.
    if (result.ok) { setPreview(result.show); setDragNote(null); setRefused(null); }
    else {
      setDragNote(reasonText(result.reason));
      const attempt = attemptEdit(map.show, action);
      setRefused(attempt ? { show: attempt.show, ids: attempt.shapeIds } : null);
    }
  };

  const finishDrag = (e: PointerEvent<HTMLElement>, commit: boolean) => {
    const d = drag.current;
    clearDrag();
    if (!d || !commit) return;
    const raw = d.kind === 'box' || d.kind === 'corner' ? pointerFree(e) : pointerAt(e);
    if (d.kind === 'pen-handle') return;
    if (d.kind === 'marquee') {
      const moved = Math.hypot((raw.x - d.start.x) * STAGE_SIZE.width, (raw.y - d.start.y) * STAGE_SIZE.height) >= MIN_DRAG_PX;
      if (!moved) return;
      const inside = marqueeSelect(map.show, d.start, raw);
      map.selectMany(d.additive ? [...map.selectedIds, ...inside.filter(id => !map.selectedIds.includes(id))] : inside);
      return;
    }
    const startPx = d.kind === 'box' ? d.start : 'start' in d ? stagePx(d.start) : null;
    const nowPx = stagePx(raw);
    const moved = startPx ? Math.hypot(nowPx.x - startPx.x, nowPx.y - startPx.y) >= MIN_DRAG_PX / 2 : true;
    // Alt-click on a point switches it between corner and curve.
    if (d.kind === 'point' && !moved && d.alt) {
      const shape = map.show.shapes.find(s => s.id === d.shapeId);
      const point = (d.ring < 0 ? shape?.points : shape?.holes[d.ring])?.[d.index];
      if (point) map.dispatch({ type: 'setCurve', shapeId: d.shapeId, ring: d.ring, index: d.index, curved: !isCurved(point) });
      return;
    }
    if ((d.kind === 'point' || d.kind === 'move' || d.kind === 'box' || d.kind === 'pin' || d.kind === 'corner') && !moved) return; // a plain click only selects
    const action = editFor(d, raw, e);
    if (!action) return;
    if (!map.dispatch(action)) return;
    if (action.type === 'addShape') map.setSelection(action.id);
    else if (action.type === 'addHole') map.setSelection(action.shapeId);
    else if (action.type === 'duplicateShapes') map.selectMany(action.ids);
  };

  /** Double-click: on a point removes it, on a side adds one there. */
  const onDoubleClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (map.tool !== 'select' || !map.loaded || cornersMode) return;
    const picked = pick(pointerAt(e), map.show, selection(), reach());
    if (picked.kind === 'point') {
      if (map.dispatch({ type: 'removePoint', shapeId: picked.shapeId, ring: picked.ring, index: picked.index })) map.setSelection(picked.shapeId);
    } else if (picked.kind === 'side') {
      if (map.dispatch({ type: 'insertPoint', shapeId: picked.shapeId, ring: picked.ring, side: picked.index, t: picked.t })) map.setSelection(picked.shapeId, picked.index + 1, picked.ring);
    }
  };

  /** Changing tool abandons an open Pen outline; choosing the Pen again keeps it. */
  const chooseTool = (tool: MapTool) => { if (tool === 'pen' && penRef.current) return; setPen(null); setHover(null); map.setTool(tool); };

  // The Details panel or the Sound & MIDI panel; the meters run only while the second is open.
  const [inspectorTab, setInspectorTab] = useState<'details' | 'react'>('details');
  useEffect(() => { map.setReactivityPanel(inspectorTab === 'react'); }, [inspectorTab]);

  // Shortcuts work from anywhere in Map, unless the key press belongs to a text box.
  const onKeyDown = (e: globalThis.KeyboardEvent) => {
    if (menu || looksOpen) return; // the open menu, or the look browser, handles its own keys
    const target = e.target as HTMLElement | null;
    // Delete, Backspace, Tab and Enter act on shapes only while the stage has focus (or nothing does), never from a button.
    const onStage = !target || target === document.body || !!target.closest?.('.map-stage');
    // While a Pen outline is open, Backspace takes back its last point and Escape abandons it.
    if (penRef.current && onStage && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      const p = penRef.current;
      setPen(p.points.length > 1 ? { ...p, points: p.points.slice(0, -1) } : null);
      return;
    }
    const action = shortcutFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, onStage, target });
    if (!action) return;
    const shape = map.show.shapes.find(s => s.id === map.selectedId) ?? null;
    // In Stage corners only the corner keys, Escape, undo and redo act: the shapes cannot be grabbed in this mode.
    if (cornersMode && !['arrow', 'next-corner', 'previous-corner', 'deselect', 'undo', 'redo'].includes(action)) return;
    switch (action) {
      case 'scene': { const scene = map.show.scenes[Number(e.key) - 1]; if (scene) { e.preventDefault(); map.switchScene(scene.id); } break; }
      case 'tap': e.preventDefault(); map.startEngine(); map.engine?.tap(); break;
      case 'undo': e.preventDefault(); map.undo(); break;
      case 'redo': e.preventDefault(); map.redo(); break;
      case 'select': case 'rectangle': case 'triangle': case 'ellipse': case 'pen': chooseTool(action); break;
      case 'close': if (penRef.current) { e.preventDefault(); closePen(); } break;
      case 'deselect': if (cornersMode) { setCornersMode(false); clearDrag(); } else if (penRef.current) { setPen(null); setHover(null); } else map.setSelection(null); break;
      case 'select-all': e.preventDefault(); map.selectMany(map.show.shapes.filter(s => isShapeShown(map.show, s)).map(s => s.id)); break;
      case 'group': e.preventDefault(); act.group(); break;
      case 'ungroup': e.preventDefault(); act.ungroup(shape?.groupId ?? null); break;
      case 'duplicate': if (map.selectedIds.length) { e.preventDefault(); act.duplicate(); } break;
      case 'delete': if (map.selectedIds.length) { e.preventDefault(); act.remove(); } break;
      case 'next-corner': case 'previous-corner': {
        // In Stage corners, Tab steps between the four corners for the arrow keys.
        if (cornersMode) { e.preventDefault(); setCornerIndex(i => (i + (action === 'next-corner' ? 1 : 3)) % 4); break; }
        if (!shape) return;
        e.preventDefault();
        // Every point of the shape in one sequence: its outline, then each hole.
        const all = [shape.points, ...shape.holes].flatMap((ring, r) => ring.map((_, i) => ({ ring: r - 1, index: i })));
        const at = map.selectedIndex === null ? -1 : all.findIndex(p => p.ring === map.selectedRing && p.index === map.selectedIndex);
        const next = action === 'next-corner' ? all[(at + 1) % all.length] : all[at <= 0 ? all.length - 1 : at - 1];
        map.setSelection(shape.id, next.index, next.ring);
        break;
      }
      case 'arrow': {
        if (cornersMode) {
          const step = ARROWS[e.key], q = stageCornerPoints(map.show)[cornerIndex];
          if (!step) return;
          e.preventDefault();
          const size = e.shiftKey ? 10 : 1;
          map.dispatch({ type: 'moveStageCorner', index: cornerIndex, to: { x: q.x + step[0] * size / STAGE_SIZE.width, y: q.y + step[1] * size / STAGE_SIZE.height } });
          break;
        }
        const step = ARROWS[e.key];
        if (!step || !map.selectedIds.length) return;
        e.preventDefault();
        const size = e.shiftKey ? 10 : 1;
        if (shape && map.selectedIndex !== null && map.selectedIds.length === 1) map.dispatch({ type: 'nudgePoint', shapeId: shape.id, ring: map.selectedRing, index: map.selectedIndex, dxPx: step[0] * size, dyPx: step[1] * size, joined: map.snap });
        else map.dispatch({ type: 'moveShapes', shapeIds: act.selected(), dx: step[0] * size / STAGE_SIZE.width, dy: step[1] * size / STAGE_SIZE.height });
        break;
      }
    }
  };
  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const listener = (e: globalThis.KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => setInspectorNote(null), [map.selectedId, map.selectedIndex]);

  const focusName = () => requestAnimationFrame(() => {
    const field = document.querySelector<HTMLInputElement>('.map-inspector input[aria-label="Name"]');
    field?.focus(); field?.select();
  });
  const openGrid = () => requestAnimationFrame(() => {
    const details = document.querySelector<HTMLDetailsElement>('.map-grid-tool');
    if (details) { details.open = true; details.querySelector<HTMLInputElement>('input')?.focus(); }
  });
  const openMenu = (x: number, y: number, shapeId: string | null) => {
    clearDrag();
    // Right-clicking a shape outside the selection picks it; inside the selection keeps the selection.
    if (shapeId && !map.selectedIds.includes(shapeId)) map.setSelection(shapeId);
    setMenu({ x, y, shapeId });
  };
  const onStageMenu = (e: MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!map.loaded || cornersMode) return;
    const at = stageFromPointer(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
    // The topmost visible shape under the pointer, as a left click would pick.
    const hit = [...map.show.shapes].reverse().find(s => isShapeShown(map.show, s) && hitShape(at, s.points, s.holes));
    openMenu(e.clientX, e.clientY, hit?.id ?? null);
  };
  const menuEntries = (shapeId: string | null): MenuEntry[] => {
    const index = shapeId ? map.show.shapes.findIndex(s => s.id === shapeId) : -1;
    const shape = index >= 0 ? map.show.shapes[index] : null;
    if (!shape) return [
      ...TOOLS.map(t => ({ kind: 'item', label: t.tool === 'select' ? 'Select and move' : `Draw: ${t.label}`, shortcut: t.key, checked: map.tool === t.tool, onSelect: () => chooseTool(t.tool) }) as const),
      { kind: 'separator' },
      { kind: 'item', label: 'Test grid', checked: map.testGrid, onSelect: () => map.setTestGrid(!map.testGrid) },
      { kind: 'item', label: 'Blackout', checked: map.blackout, onSelect: () => map.setBlackout(!map.blackout) },
      { kind: 'item', label: 'Snap', checked: map.snap, onSelect: () => map.setSnap(!map.snap) },
      { kind: 'item', label: map.show.photo ? 'Change the room photo…' : 'Add a photo of the room…', onSelect: () => photoInput.current?.click() },
      ...(map.selectedIds.length ? [{ kind: 'separator' } as const, { kind: 'item', label: 'Deselect', shortcut: 'Esc', onSelect: () => map.setSelection(null) } as const] : []),
    ];
    const ids = map.selectedIds.includes(shape.id) ? act.selected() : [shape.id];
    const locked = ids.some(id => { const s = map.show.shapes.find(x => x.id === id); return !!s && isShapeLocked(map.show, s); });
    const single = ids.length === 1;
    const last = map.show.shapes.length - 1;
    const reorder = (to: 'front' | 'back' | 'forward' | 'backward') => () => map.dispatch({ type: 'reorder', shapeId: shape.id, to });
    return [
      { kind: 'item', label: single ? 'Duplicate' : `Duplicate ${ids.length} shapes`, shortcut: '⌘D', onSelect: () => act.duplicate(ids) },
      ...(single && shape.sourceId ? [
        { kind: 'item', label: 'Vary', disabled: locked, onSelect: () => map.dispatch({ type: 'varySource', sourceId: shape.sourceId!, entropy: Math.floor(Math.random() * 1e6) }) } as const,
        ...(onEditInStudio ? [{ kind: 'item', label: 'Edit in Studio', disabled: locked, onSelect: () => onEditInStudio(shape.sourceId!, shape.id) } as const] : []),
      ] : []),
      { kind: 'item', label: locked ? 'Delete (unlock first)' : single ? 'Delete' : `Delete ${ids.length} shapes`, shortcut: '⌫', danger: true, disabled: locked, onSelect: () => act.remove(ids) },
      { kind: 'separator' },
      { kind: 'item', label: 'Flip left to right', disabled: locked, onSelect: () => act.flip('vertical', ids) },
      { kind: 'item', label: 'Flip top to bottom', disabled: locked, onSelect: () => act.flip('horizontal', ids) },
      { kind: 'item', label: 'Mirror copy, left to right', onSelect: () => act.mirror('vertical', ids) },
      { kind: 'item', label: 'Mirror copy, top to bottom', onSelect: () => act.mirror('horizontal', ids) },
      ...(single ? [{ kind: 'item', label: 'Make a grid…', disabled: locked, onSelect: openGrid } as const] : []),
      ...(single ? [
        { kind: 'separator' } as const,
        ...([['fit', 'Fit'], ['pin', 'Pin in perspective'], ['across-group', 'Across group'], ['across-stage', 'Across stage']] as const).map(([kind, label]) =>
          ({ kind: 'item', label, checked: shape.placement.kind === kind, disabled: locked, onSelect: () => map.dispatch({ type: 'setPlacement', shapeId: shape.id, placement: { kind } }) }) as const),
        { kind: 'item', label: 'Share with…', disabled: locked || shape.blocker || !map.show.shapes.some(s => s !== shape && s.sourceId !== null && s.sourceId !== shape.sourceId), onSelect: () => requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('.map-inspector select[aria-label="Share with"]')?.focus()) } as const,
        ...(shape.sourceId && map.show.shapes.some(s => s !== shape && s.sourceId === shape.sourceId) ? [{ kind: 'item', label: 'Make separate', disabled: locked, onSelect: () => map.dispatch({ type: 'makeSeparate', shapeId: shape.id, sourceId: newSourceId() }) } as const] : []),
      ] : []),
      { kind: 'separator' },
      { kind: 'item', label: 'Group', shortcut: '⌘G', disabled: locked, onSelect: () => act.group(ids) },
      ...(shape.groupId ? [{ kind: 'item', label: 'Ungroup', shortcut: '⇧⌘G', disabled: locked, onSelect: () => act.ungroup(shape.groupId) } as const] : []),
      { kind: 'item', label: 'Bring to front', disabled: locked || !single || index === last, onSelect: reorder('front') },
      { kind: 'item', label: 'Bring forward', disabled: locked || !single || index === last, onSelect: reorder('forward') },
      { kind: 'item', label: 'Send backward', disabled: locked || !single || index === 0, onSelect: reorder('backward') },
      { kind: 'item', label: 'Send to back', disabled: locked || !single || index === 0, onSelect: reorder('back') },
      { kind: 'separator' },
      ...(single ? [
        { kind: 'swatches', label: 'Colour', colours: COLOURS, current: shape.colour, disabled: locked, onPick: (colour: string) => map.dispatch({ type: 'setColour', shapeId: shape.id, colour }) } as const,
        { kind: 'item', label: 'Rename…', disabled: locked, onSelect: focusName } as const,
        { kind: 'item', label: 'Blocker', checked: shape.blocker, disabled: locked, onSelect: () => map.dispatch({ type: 'setBlocker', shapeId: shape.id, blocker: !shape.blocker }) } as const,
        { kind: 'separator' } as const,
        { kind: 'item', label: 'Locked', checked: shape.locked, onSelect: () => map.dispatch({ type: 'setLocked', shapeId: shape.id, locked: !shape.locked }) } as const,
        { kind: 'item', label: 'Shown', checked: shape.visible, onSelect: () => map.dispatch({ type: 'setVisible', shapeId: shape.id, visible: !shape.visible }) } as const,
        { kind: 'item', label: 'Solo', checked: map.solo.shapes.includes(shape.id), onSelect: () => act.toggleSolo(shape.id) } as const,
        { kind: 'item', label: 'Identify on the projector', disabled: !map.outputOpen || !shape.visible, onSelect: map.identify } as const,
      ] : []),
    ];
  };

  /** Only a real change is an undo step (and a save). */
  const setPhotoOpacity = (opacity: number) => { if (map.show.photo && opacity !== map.show.photo.opacity) map.dispatch({ type: 'setPhotoOpacity', opacity }); };
  const choosePhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = await photoFromFile(file);
      if (map.dispatch({ type: 'setPhoto', photo: { data, opacity: map.show.photo?.opacity ?? 0.5 } })) map.setPhotoShown(true);
    } catch { setInspectorNote('That picture could not be opened. Use a JPEG or PNG photo.'); }
  };

  const reason = dragNote ?? (map.lastRefusal ? (map.lastRefusal.endsWith('…') ? map.lastRefusal : `Not applied: ${reasonText(map.lastRefusal)}`) : null);
  // How the wall is keeping up, from its report once a second.
  const wall = map.wallState;
  const wallText = wall ? `Showing on the projector · ${wall.fps} fps${wall.level ? ` · instruments drawn at ${Math.round(GOVERNOR_SCALES[wall.level] * 100)} %${wall.level === 3 ? ', every other frame' : ''}` : ''}` : 'Showing on the projector';
  const failing = wall?.failing[0] ? `An instrument could not start, so its shape plays its colour: ${wall.failing[0].reason}` : null;
  const penHint = pen ? `Pen: ${pen.points.length} point${pen.points.length === 1 ? '' : 's'}${pen.hole ? ' (a hole)' : ''} · click the first point or press Enter to close · Backspace takes back a point · Esc abandons` : null;
  const cornersHint = cornersMode ? `Stage corners: drag a numbered corner, or use the arrow keys on corner ${cornerIndex + 1} (Shift for 10 pixels, Tab for the next corner). This screen stays flat; the projector bends.` : null;
  const status = reason ?? inspectorNote ?? map.saveError ?? map.sendWarning ?? failing ?? map.notice ?? cornersHint ?? penHint ?? (map.outputOpen ? wallText : map.loaded ? 'Ready' : 'Loading…');
  const soloOn = map.solo.shapes.length + map.solo.groups.length > 0;
  // The browser follows the single selected shape; it closes when there is none, or a Blocker or locked shape is picked.
  // Several shapes playing one instrument count as that one instrument: the browser changes it through the first of them.
  const sharedSelection = map.selectedIds.length > 1 && (() => { const first = map.show.shapes.find(s => s.id === map.selectedId); return !!first?.sourceId && map.selectedIds.every(id => map.show.shapes.find(s => s.id === id)?.sourceId === first.sourceId); })();
  const lookShape = map.selectedIds.length === 1 || sharedSelection ? map.show.shapes.find(s => s.id === map.selectedId && !s.blocker && !isShapeLocked(map.show, s)) ?? null : null;
  /** What the shape plays, as the browser names it: a preset's id when its instrument is still that one-layer preset. */
  const currentLook = (shape: typeof lookShape & {}) => {
    if (!shape.sourceId) return shape.fill;
    const project = map.show.sources.find(s => s.id === shape.sourceId)?.project;
    const preset = project && project.layers.length === 1 ? PRESETS.find(p => p.name === project.name) : undefined;
    return preset ? `preset:${preset.id}` : '';
  };

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
      <button className={`text-button live-toggle ${cornersMode ? 'on' : ''}`} aria-pressed={cornersMode} title="Fix a projector that was nudged: drag the four numbered corners (or use the arrow keys) until the picture lands where it did" onClick={() => { setCornersMode(!cornersMode); clearDrag(); }}>Stage corners</button>
      {(cornersMode || map.show.stageCorners) && <button className="text-button" disabled={!map.show.stageCorners} title="Put the stage corners back at the projector's corners" onClick={() => map.dispatch({ type: 'setStageCorners', corners: null })}>Reset corners</button>}
      {soloOn && <button className="text-button live-toggle on" title="Only soloed shapes are shown, on the projector too · click to show everything" onClick={() => map.setSolo({ shapes: [], groups: [] })}>Solo on · Clear</button>}
      <button className="text-button" disabled={!map.selectedId || !map.desktop} title="Flash the selected shape on the projector" onClick={map.identify}>Identify</button>
      <button className="text-button" disabled={!map.canUndo} title="Undo · ⌘Z" onClick={map.undo}>Undo</button>
      <button className="text-button" disabled={!map.canRedo} title="Redo · ⇧⌘Z" onClick={map.redo}>Redo</button>
    </div></header>
    <div className="map-body">
      <aside className="live-column map-shapes" aria-label="Shapes">
        <div className="map-list-head"><h2>Shapes <span className="muted-text">{map.show.shapes.length || ''}</span></h2>
          <button className="map-icon" disabled={!map.selectedIds.length} aria-label="Group selected shapes" title="Put the selected shapes in a folder · ⌘G" onClick={() => act.group()}><MapIcon name="folderPlus" size={16} /></button></div>
        {map.show.shapes.length === 0 && <p className="muted-text">No shapes yet. Add a photo of the room to trace over (Room photo, or drop one on the stage), then pick a drawing tool above the stage.</p>}
        <MapShapeList map={map} onMenu={(e, id) => openMenu(e.clientX, e.clientY, id)} />
      </aside>
      <div className="map-centre">
        <div className="map-tools" role="toolbar" aria-label="Tools">
          {TOOLS.map(t => <button key={t.tool} className="text-button" aria-pressed={map.tool === t.tool} title={`${t.title} · ${t.key}`} onClick={() => chooseTool(t.tool)}>{t.label}</button>)}
          <button className="text-button map-photo-button" disabled={!map.loaded} title="A photograph of the room or object you are mapping, to trace over. Only on this screen: it never reaches the projector. You can also drop a picture on the stage." onClick={() => photoInput.current?.click()}>{map.show.photo ? 'Room photo ✓' : 'Room photo…'}</button>
          <span className="muted-text map-tool-hint">{map.tool === 'select' ? 'Alt-drag copies · double-click a side to add a point' : map.tool === 'pen' ? 'Alt on the first click inside the selected shape cuts a hole' : 'Alt-drag inside the selected shape cuts a hole'}</span>
        </div>
        <main className="map-stage" tabIndex={0} aria-label="Stage area" style={{ cursor: map.tool === 'select' && !cornersMode ? 'default' : 'crosshair', touchAction: 'none' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={e => finishDrag(e, true)} onPointerCancel={e => finishDrag(e, false)} onLostPointerCapture={e => { if (drag.current) finishDrag(e, false); }} onPointerLeave={() => setHover(null)}
          onDragOver={e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) e.preventDefault(); }}
          onDrop={e => { e.preventDefault(); const file = [...e.dataTransfer.files].find(f => /^image\/(jpeg|png)$/.test(f.type)); if (file) void choosePhoto(file); else setInspectorNote('Drop a JPEG or PNG photo of the room.'); }}><canvas ref={canvas} aria-label="Stage" data-wall={map.outputOpen && map.wallPicture ? 'picture' : 'local'}
          onDoubleClick={onDoubleClick} onContextMenu={onStageMenu} width={STAGE_SIZE.width} height={STAGE_SIZE.height} />
          <canvas ref={handles} className="map-handles" aria-hidden="true" /></main>
        <div className="map-stage-bar">
          <label className="map-check" title="Points join other shapes' points and sides, and the stage's edges and centre. Corners on the same spot move together. Hold Ctrl to switch it off for a moment.">
            <input type="checkbox" aria-label="Snap" checked={map.snap} onChange={e => map.setSnap(e.target.checked)} />Snap</label>
          <span className="map-bar-gap" />
          <span className="muted-text">Room photo (this screen only)</span>
          <button className="text-button" disabled={!map.loaded} title="A photograph of the scene to trace over. It never reaches the projector." onClick={() => photoInput.current?.click()}>{map.show.photo ? 'Change…' : 'Choose…'}</button>
          <input ref={photoInput} type="file" accept="image/jpeg,image/png" hidden aria-label="Photo file" onChange={e => { void choosePhoto(e.target.files?.[0]); e.target.value = ''; }} />
          {map.show.photo && <>
            <label className="map-check"><input type="checkbox" aria-label="Show photo" checked={map.photoShown} onChange={e => map.setPhotoShown(e.target.checked)} />Shown</label>
            <label className="map-inline-range">Opacity<input aria-label="Photo opacity" type="range" min={0.1} max={1} step={0.05} defaultValue={map.show.photo.opacity} key={map.show.photo.opacity}
              onPointerUp={e => setPhotoOpacity(Number(e.currentTarget.value))} onKeyUp={e => setPhotoOpacity(Number(e.currentTarget.value))} /></label>
            <button className="text-button" onClick={() => map.dispatch({ type: 'setPhoto', photo: null })}>Remove photo</button>
          </>}
        </div>
        <MapScenes map={map} />
      </div>
      <aside className="live-column map-inspector" aria-label={inspectorTab === 'details' ? 'Details' : 'Sound and MIDI'}>
        <div className="map-inspector-tabs" role="tablist">
          <button role="tab" aria-selected={inspectorTab === 'details'} onClick={() => setInspectorTab('details')}>Details</button>
          <button role="tab" aria-selected={inspectorTab === 'react'} onClick={() => setInspectorTab('react')}>Sound &amp; MIDI{map.show.links.length + map.show.triggers.length ? <small> {map.show.links.length + map.show.triggers.length}</small> : null}</button>
        </div>
        {inspectorTab === 'details'
          ? <MapDetails map={map} onEditInStudio={onEditInStudio} setNote={setInspectorNote} onOpenLooks={() => setLooksOpen(o => !o)} linked={linkedChanges} setLinked={setLinkedChanges} />
          : <MapReactivity map={map} />}
      </aside>
    </div>
    <footer className="map-status" role="status">{status}</footer>
    {looksOpen && lookShape && <MapLookBrowser current={currentLook(lookShape)} colour={lookShape.colour} onPick={value => act.play(lookShape.id, value, sharedSelection || linkedChanges)} onClose={() => setLooksOpen(false)} />}
    {menu && <MapMenu x={menu.x} y={menu.y} label={menu.shapeId ? 'Shape' : 'Stage'} entries={menuEntries(menu.shapeId)} onClose={() => setMenu(null)} />}
  </section>;
}
