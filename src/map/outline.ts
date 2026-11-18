/**
 * Outline maths for shapes with curved sides and holes. Points are stage fractions (0..1, origin top-left);
 * anything about lengths or angles is worked out in projector pixels, since the stage is not square.
 *
 * A side from point A to point B is a cubic curve with control points A + A.out and B + B.in; when both handles
 * are missing (or of no length) it is a straight line. Curves are checked and drawn as CURVE_STEPS straight pieces.
 */
// show.ts imports from geometry.ts, which imports this module: nothing from show.ts is read while this module loads.
import { MAX_POINTS, MIN_OUTLINE_AREA, STAGE_SIZE, type CurvePoint, type Handle, type Point, type Ring } from './show';

export const CURVE_STEPS = 16;
export const MAX_HOLES = 8;
/** Two corners closer than this are the same corner; the outline has collapsed there. */
const SAME_POINT = 1e-9;
/** The handle lengths that draw a quarter circle with one cubic curve. */
const KAPPA = 0.5522847498;

export type OutlineReason = 'crossing' | 'collapsed' | 'too-few' | 'too-many' | 'outside' | 'hole-outside' | 'holes-overlap' | 'too-many-holes';
export type Validity = { ok: true } | { ok: false; reason: OutlineReason };
/** A 2D transform in projector pixels, as Canvas writes it: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

const W = () => STAGE_SIZE.width;
const H = () => STAGE_SIZE.height;
const toPx = (p: Point): Point => ({ x: p.x * W(), y: p.y * H() });
const fromPx = (p: Point): Point => ({ x: p.x / W(), y: p.y / H() });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const isNonZero = (h: Handle | undefined): h is Handle => !!h && (h.x !== 0 || h.y !== 0);
/** The point without handles. */
const anchor = (p: CurvePoint): Point => ({ x: p.x, y: p.y });
/** A point with only the handles that have length. */
function withHandles(p: Point, h: { in?: Handle; out?: Handle }): CurvePoint {
  const out: CurvePoint = { x: p.x, y: p.y };
  if (isNonZero(h.in)) out.in = { x: h.in.x, y: h.in.y };
  if (isNonZero(h.out)) out.out = { x: h.out.x, y: h.out.y };
  return out;
}

export const isCurved = (p: CurvePoint): boolean => isNonZero(p.in) || isNonZero(p.out);
/** Whether the side from point i to the next is a curve. */
const sideCurved = (ring: Ring, i: number) => isNonZero(ring[i].out) || isNonZero(ring[(i + 1) % ring.length].in);
/** The four control points of side i. */
function sideControls(ring: Ring, i: number): [Point, Point, Point, Point] {
  const a = ring[i], b = ring[(i + 1) % ring.length];
  return [anchor(a), add(a, a.out ?? { x: 0, y: 0 }), add(b, b.in ?? { x: 0, y: 0 }), anchor(b)];
}
function cubic([p0, p1, p2, p3]: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** The ring as straight pieces: corners as they are, each curved side in `steps` pieces. */
export function flatten(ring: Ring, steps = CURVE_STEPS): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    out.push(anchor(ring[i]));
    if (!sideCurved(ring, i)) continue;
    const controls = sideControls(ring, i);
    for (let k = 1; k < steps; k++) out.push(cubic(controls, k / steps));
  }
  return out;
}

export function ringBounds(rings: Ring[]): { x0: number; y0: number; x1: number; y1: number } {
  const pts = rings.flatMap(r => flatten(r));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// ---- Validity -------------------------------------------------------------------------------------------------

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const overlap =
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  return overlap && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}
/** Non-neighbouring sides of one closed polyline that meet. */
function selfCrossing(points: Point[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segmentsMeet(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
  }
  return false;
}
/** Any side of one closed polyline meeting any side of another. */
function ringsMeet(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    if (segmentsMeet(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  }
  return false;
}
export function polygonArea(points: Point[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; twice += a.x * b.y - b.x * a.y; }
  return Math.abs(twice) / 2;
}
export function pointInPolygon(point: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const finitePoint = (p: Point | undefined) => !p || (Number.isFinite(p.x) && Number.isFinite(p.y));
/** A handle reaches at most one stage width or height from its point, as the show file stores it. */
const handleFits = (h: Handle | undefined) => !h || (Math.abs(h.x) <= 1 && Math.abs(h.y) <= 1);

/** One ring on its own: the same rules for every point count, checked on the flattened curve. */
function ringValidity(ring: Ring): Validity {
  if (ring.length < 3) return { ok: false, reason: 'too-few' };
  if (ring.some(p => !finitePoint(p) || !finitePoint(p.in) || !finitePoint(p.out) || !handleFits(p.in) || !handleFits(p.out) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return { ok: false, reason: 'outside' };
  if (ring.some((a, i) => { const b = ring[(i + 1) % ring.length]; return Math.hypot(a.x - b.x, a.y - b.y) < SAME_POINT; })) return { ok: false, reason: 'collapsed' };
  const flat = flatten(ring);
  if (selfCrossing(flat)) return { ok: false, reason: 'crossing' };
  if (polygonArea(flat) < MIN_OUTLINE_AREA) return { ok: false, reason: 'collapsed' };
  return { ok: true };
}

/**
 * Whether a shape's outline and holes can be drawn. Anchors stay on the stage (a curve may bulge past its edge);
 * nothing crosses; each hole lies wholly inside the outline without touching it, and outside every other hole.
 */
export function shapeValidity(outline: Ring, holes: Ring[]): Validity {
  if (holes.length > MAX_HOLES) return { ok: false, reason: 'too-many-holes' };
  if (outline.length < 3) return { ok: false, reason: 'too-few' };
  if (outline.length + holes.reduce((n, h) => n + h.length, 0) > MAX_POINTS) return { ok: false, reason: 'too-many' };
  const own = ringValidity(outline);
  if (!own.ok) return own;
  const flatOuter = flatten(outline);
  const flatHoles: Point[][] = [];
  for (const hole of holes) {
    const valid = ringValidity(hole);
    if (!valid.ok) return valid;
    const flat = flatten(hole);
    if (ringsMeet(flat, flatOuter) || !pointInPolygon(flat[0], flatOuter)) return { ok: false, reason: 'hole-outside' };
    for (const other of flatHoles) {
      if (ringsMeet(flat, other) || pointInPolygon(flat[0], other) || pointInPolygon(other[0], flat)) return { ok: false, reason: 'holes-overlap' };
    }
    flatHoles.push(flat);
  }
  return { ok: true };
}

/** Inside the outline and not in any hole. */
export function hitShape(at: Point, outline: Ring, holes: Ring[]): boolean {
  return pointInPolygon(at, flatten(outline)) && !holes.some(h => pointInPolygon(at, flatten(h)));
}

/** The side nearest to a point: its index, how far along it (0..1), and the distance in projector pixels. */
export function nearestSide(at: Point, ring: Ring): { index: number; t: number; distance: number } {
  const p = toPx(at);
  let best = { index: 0, t: 0, distance: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const curved = sideCurved(ring, i), controls = sideControls(ring, i), pieces = curved ? CURVE_STEPS : 1;
    for (let k = 0; k < pieces; k++) {
      const a = toPx(cubic(controls, k / pieces)), b = toPx(cubic(controls, (k + 1) / pieces));
      const d = sub(b, a), len2 = d.x * d.x + d.y * d.y;
      const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / len2));
      const distance = Math.hypot(p.x - (a.x + d.x * u), p.y - (a.y + d.y * u));
      if (distance < best.distance) best = { index: i, t: (k + u) / pieces, distance };
    }
  }
  return best;
}

// ---- Editing points -------------------------------------------------------------------------------------------

/** A new point on side `side`, `t` of the way along. A curved side is split so the outline keeps its shape. */
export function insertPoint(ring: Ring, side: number, t: number): Ring {
  const i = side, j = (side + 1) % ring.length;
  const out = ring.map(p => ({ ...p }));
  let point: CurvePoint;
  if (!sideCurved(ring, i)) point = lerp(anchor(ring[i]), anchor(ring[j]), t);
  else {
    const [p0, p1, p2, p3] = sideControls(ring, i);
    const p01 = lerp(p0, p1, t), p12 = lerp(p1, p2, t), p23 = lerp(p2, p3, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), m = lerp(p012, p123, t);
    out[i] = withHandles(ring[i], { in: ring[i].in, out: sub(p01, p0) });
    out[j] = withHandles(ring[j], { in: sub(p23, p3), out: ring[j].out });
    point = withHandles(m, { in: sub(p012, m), out: sub(p123, m) });
  }
  out.splice(i + 1, 0, point);
  return out;
}

export function removePoint(ring: Ring, index: number): Ring {
  return ring.filter((_, i) => i !== index);
}

/** A curve point gets smooth handles along the line through its neighbours, a third of the way to each. */
export function setCurve(ring: Ring, index: number, curved: boolean): Ring {
  return ring.map((p, i) => {
    if (i !== index) return p;
    if (!curved) return anchor(p);
    const prev = toPx(ring[(i - 1 + ring.length) % ring.length]), next = toPx(ring[(i + 1) % ring.length]), here = toPx(p);
    let dir = sub(next, prev);
    const len = Math.hypot(dir.x, dir.y);
    dir = len === 0 ? { x: 1, y: 0 } : { x: dir.x / len, y: dir.y / len };
    const back = Math.hypot(here.x - prev.x, here.y - prev.y) / 3, ahead = Math.hypot(next.x - here.x, next.y - here.y) / 3;
    return withHandles(p, { in: fromPx({ x: -dir.x * back, y: -dir.y * back }), out: fromPx({ x: dir.x * ahead, y: dir.y * ahead }) });
  });
}

const clampHandle = (h: Handle): Handle => ({ x: Math.min(1, Math.max(-1, h.x)), y: Math.min(1, Math.max(-1, h.y)) });

/**
 * Moves one handle's end to `to`. With `mirror`, the other handle turns to point the opposite way and keeps its
 * own length (or takes this one's, if it had none), so the curve stays smooth through the point.
 */
export function moveHandle(ring: Ring, index: number, which: 'in' | 'out', to: Point, mirror: boolean): Ring {
  return ring.map((p, i) => {
    if (i !== index) return p;
    const handle = clampHandle(sub(to, p));
    const other = which === 'in' ? 'out' : 'in';
    const next: { in?: Handle; out?: Handle } = { in: p.in, out: p.out, [which]: handle };
    const hp = toPx(handle), length = Math.hypot(hp.x, hp.y);
    if (mirror && length > 0) {
      const existing = p[other];
      const keep = isNonZero(existing) ? Math.hypot(toPx(existing).x, toPx(existing).y) : length;
      next[other] = clampHandle(fromPx({ x: -hp.x / length * keep, y: -hp.y / length * keep }));
    }
    return withHandles(p, next);
  });
}

// ---- New shapes -----------------------------------------------------------------------------------------------

const box = (a: Point, b: Point) => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });

/** Four curve points, clockwise from the top, drawing the ellipse that fills the box. */
export function ellipseRing(a: Point, b: Point): Ring {
  const { x0, y0, x1, y1 } = box(a, b);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, kx = (x1 - x0) / 2 * KAPPA, ky = (y1 - y0) / 2 * KAPPA;
  return [
    { x: cx, y: y0, in: { x: -kx, y: 0 }, out: { x: kx, y: 0 } },
    { x: x1, y: cy, in: { x: 0, y: -ky }, out: { x: 0, y: ky } },
    { x: cx, y: y1, in: { x: kx, y: 0 }, out: { x: -kx, y: 0 } },
    { x: x0, y: cy, in: { x: 0, y: ky }, out: { x: 0, y: -ky } },
  ];
}

/** Three corners: the tip at the top centre of the box, then clockwise. */
export function triangleRing(a: Point, b: Point): Ring {
  const { x0, y0, x1, y1 } = box(a, b);
  return [{ x: (x0 + x1) / 2, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/** `b` moved so the box from `a` is square in projector pixels (the longer side wins), kept on the stage. */
export function squareBox(a: Point, b: Point): Point {
  const d = sub(toPx(b), toPx(a));
  const side = Math.max(Math.abs(d.x), Math.abs(d.y));
  const p = fromPx({ x: a.x * W() + Math.sign(d.x || 1) * side, y: a.y * H() + Math.sign(d.y || 1) * side });
  return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
}

// ---- Transforms -----------------------------------------------------------------------------------------------

export const scaleAbout = (pivot: Point, sx: number, sy: number): Matrix => [sx, 0, 0, sy, pivot.x - sx * pivot.x, pivot.y - sy * pivot.y];
export function rotateAbout(pivot: Point, radians: number): Matrix {
  const c = Math.cos(radians), s = Math.sin(radians);
  return [c, s, -s, c, pivot.x - c * pivot.x + s * pivot.y, pivot.y - s * pivot.x - c * pivot.y];
}
const applyLinear = (m: Matrix, v: Point): Point => ({ x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y });

/** The ring moved by a transform in projector pixels; handles turn and scale with it. Not clamped: the caller checks. */
export function transformRing(ring: Ring, m: Matrix): Ring {
  return ring.map(p => {
    const q = applyLinear(m, toPx(p));
    const moved = fromPx({ x: q.x + m[4], y: q.y + m[5] });
    const handle = (h: Handle | undefined) => h && fromPx(applyLinear(m, toPx(h)));
    return withHandles(moved, { in: handle(p.in), out: handle(p.out) });
  });
}

// ---- Make a grid ----------------------------------------------------------------------------------------------

/** The four corners starting from the top-left one, clockwise on screen. */
export function orderQuad(quad: Point[]): Point[] {
  let q = quad.map(anchor);
  let twice = 0;
  for (let i = 0; i < 4; i++) { const a = toPx(q[i]), b = toPx(q[(i + 1) % 4]); twice += a.x * b.y - b.x * a.y; }
  if (twice < 0) q = q.reverse();
  const start = q.reduce((best, p, i) => (toPx(p).x + toPx(p).y < toPx(q[best]).x + toPx(q[best]).y ? i : best), 0);
  return [...q.slice(start), ...q.slice(0, start)];
}
const round = (v: number) => Math.round(v * 1e12) / 1e12;

/**
 * Rows × columns of four-corner cells following the shape's own perspective (bilinear), row by row from the top-left,
 * with `gapPx` projector pixels between neighbouring cells and none at the outer edge. Null when the gaps leave no cell.
 */
export function gridCells(quad: Point[], rows: number, cols: number, gapPx: number): Point[][] | null {
  const [q0, q1, q2, q3] = orderQuad(quad);
  const dist = (a: Point, b: Point) => Math.hypot(toPx(a).x - toPx(b).x, toPx(a).y - toPx(b).y);
  const width = (dist(q0, q1) + dist(q3, q2)) / 2, height = (dist(q0, q3) + dist(q1, q2)) / 2;
  const du = width > 0 ? gapPx / 2 / width : 0, dv = height > 0 ? gapPx / 2 / height : 0;
  const at = (u: number, v: number) => { const p = lerp(lerp(q0, q1, u), lerp(q3, q2, u), v); return { x: round(p.x), y: round(p.y) }; };
  const cells: Point[][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u0 = c / cols + (c > 0 ? du : 0), u1 = (c + 1) / cols - (c < cols - 1 ? du : 0);
    const v0 = r / rows + (r > 0 ? dv : 0), v1 = (r + 1) / rows - (r < rows - 1 ? dv : 0);
    if (u1 <= u0 || v1 <= v0) return null;
    cells.push([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]);
  }
  return cells;
}
