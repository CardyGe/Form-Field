/**
 * Map stage 7, the wild options: the rules behind them, kept apart from drawing so they can be tested.
 */
import type { CurvePoint, Point, ShowDocument } from './show';
import { flatten } from './outline';

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
