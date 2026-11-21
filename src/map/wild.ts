/**
 * Map stage 7, the wild options: the rules behind them, kept apart from drawing so they can be tested.
 */
import type { BorderRun, CurvePoint, Point, ShowDocument } from './show';
import { flatten } from './outline';
import { ringPx } from './draw';
import type { Project } from '../shared/types';
import { isInstrument } from '../core/instruments';
import { isSimplePolygon } from '../core/surface-layout';

/** A group's shapes in list order (the order the shape list shows them). */
const members = (show: Pick<ShowDocument, 'shapes'>, groupId: string) => show.shapes.filter(s => s.groupId === groupId);

/** Stagger: each shape's delay, in list order, from 0 for the first to the group's stagger for the last. */
export function staggerDelays(show: Pick<ShowDocument, 'shapes' | 'groups'>, groupId: string): Map<string, number> {
  const list = members(show, groupId), stagger = show.groups.find(g => g.id === groupId)?.stagger ?? 0;
  return new Map(list.map((s, i) => [s.id, list.length > 1 ? stagger * i / (list.length - 1) : 0]));
}

/** Chase: where each shape's border run starts in the lap, 0..1, in list order. */
export function chaseOffsets(show: Pick<ShowDocument, 'shapes'>, groupId: string): Map<string, number> {
  const list = members(show, groupId);
  return new Map(list.map((s, i) => [s.id, list.length ? i / list.length : 0]));
}

/** The palette turned `steps` colours further round. */
export function rotatePalette(palette: string[], steps: number): string[] {
  const n = palette.length;
  if (!n) return [];
  const k = ((steps % n) + n) % n;
  return [...palette.slice(k), ...palette.slice(0, k)];
}

/**
 * Outline drives the instrument: the shape's outline as an instrument's surface polygon. Curves are followed, then
 * the least significant corners are dropped (the smallest triangle each makes with its neighbours) until at most
 * `max` remain. Coordinates are the picture box's 0..1, y up, as Studio's surface uses.
 */
export function outlinePolygon(points: CurvePoint[], box: { x: number; y: number; w: number; h: number }, max = 12): { x: number; y: number }[] {
  let ring: Point[] = flatten(points);
  const area = (a: Point, b: Point, c: Point) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  while (ring.length > max) {
    let worst = 0, least = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = area(ring[(i + ring.length - 1) % ring.length], ring[i], ring[(i + 1) % ring.length]);
      if (a < least) { least = a; worst = i; }
    }
    ring = ring.filter((_, i) => i !== worst);
  }
  const w = box.w || 1, h = box.h || 1;
  return ring.map(p => ({ x: Math.min(1, Math.max(0, (p.x - box.x) / w)), y: Math.min(1, Math.max(0, 1 - (p.y - box.y) / h)) }));
}

/** Scene auto-advance: the scene to go to next, or null when there is nowhere to go. Random never repeats. */
export function nextAutoScene(show: Pick<ShowDocument, 'scenes' | 'autoAdvance'>, current: string | null, random: () => number): string | null {
  const scenes = show.scenes;
  if (scenes.length < 2) return null;
  const at = scenes.findIndex(s => s.id === current);
  if (show.autoAdvance?.order === 'random') {
    const others = scenes.filter(s => s.id !== current);
    return others[Math.min(others.length - 1, Math.floor(random() * others.length))].id;
  }
  return scenes[(at + 1) % scenes.length].id;
}

/** Whether auto-advance is due, after `elapsedS` seconds or `bars` bars of the tempo since the last change. */
export function autoAdvanceDue(setting: ShowDocument['autoAdvance'], elapsedS: number, bars: number): boolean {
  if (!setting) return false;
  return setting.unit === 'bars' ? bars >= setting.every : elapsedS >= setting.every;
}

/** Border runs: where the run's head is round the outline, 0..1. With the tempo when it has beats and a clock is running; otherwise laps a minute. */
export function runHead(run: BorderRun, seconds: number, beat: number | null, offset: number): number {
  const laps = run.beats && beat !== null ? beat / run.beats : seconds * run.lapsPerMinute / 60;
  const h = laps + offset;
  return h - Math.floor(h);
}

/** Chase: shape i of n runs i/n of a lap behind the first, so the light passes along the list in order. */
export const chaseHead = (run: BorderRun, seconds: number, beat: number | null, lag: number): number => runHead(run, seconds, beat, -lag);

/** The outline (stage fractions) as straight pieces in stage pixels, closed. */
const piecesPx = (ring: CurvePoint[]): Point[] => flatten(ringPx(ring), 32);

/** The outline's length in stage pixels, curves measured along their path. */
export function outlineLength(ring: CurvePoint[]): number {
  const pts = piecesPx(ring);
  let total = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; total += Math.hypot(b.x - a.x, b.y - a.y); }
  return total;
}

/** Points every `step` stage pixels round the outline, each with its position along it (0..1 by distance). */
export function runSamples(ring: CurvePoint[], step: number): { x: number; y: number; t: number }[] {
  // One way round for every shape (clockwise on the wall), whichever way its outline was drawn.
  let pts = piecesPx(ring), twice = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; twice += a.x * b.y - b.x * a.y; }
  if (twice < 0) pts = [pts[0], ...pts.slice(1).reverse()];
  const total = outlineLength(ring), out: { x: number; y: number; t: number }[] = [];
  if (!(total > 0) || !(step > 0)) return out;
  let along = 0, next = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b.x - a.x, b.y - a.y);
    while (next < along + len && next < total) {
      const f = (next - along) / len;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, t: next / total });
      next += step;
    }
    along += len;
  }
  return out;
}

/**
 * Outline drives the instrument: the composition as played, its instrument layers given the outline as their surface.
 * The saved composition is never changed. An outline that would not make a usable surface plays the composition as saved.
 */
export function withSurface(project: Project, polygon: { x: number; y: number }[], role: 'obstacle' | 'emitter' | 'edge'): Project {
  if (polygon.length < 3 || !isSimplePolygon(polygon) || !project.layers.some(l => isInstrument(l.kind))) return project;
  return {
    ...project,
    schemaVersion: 2,
    layers: project.layers.map(l => isInstrument(l.kind) ? { ...l, surface: { source: 'polygon' as const, role, influence: l.surface?.influence || 1, points: polygon.map(p => ({ ...p })) } } : l),
  };
}

/** Whether two compositions differ only in their layers' surfaces (Outline drives): no reason to start an evolving one again. */
export function onlySurfaceDiffers(a: Project, b: Project): boolean {
  const strip = (p: Project) => JSON.stringify({ ...p, schemaVersion: 0, layers: p.layers.map(({ surface: _s, ...l }) => l) });
  return strip(a) === strip(b);
}
