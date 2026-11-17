/**
 * Map show document: the shapes drawn on the stage. validateShow repairs a
 * damaged or outdated file field by field, so the Map always opens.
 */
import { isValidOutline } from './geometry';

export interface Point { x: number; y: number }
export interface Shape { id: string; name: string; points: Point[]; colour: string; visible: boolean; locked: boolean }
export interface ShowDocument { format: 'formshow'; version: 1; stage: { width: number; height: number }; shapes: Shape[] }

export const MAX_SHAPES = 64;
export const MAX_POINTS = 32;
export const STAGE_SIZE = { width: 1920, height: 1080 };
/** The smallest outline the Map accepts: one projector pixel of area, in stage fractions. */
export const MIN_OUTLINE_AREA = 1 / (1920 * 1080);

export function createShow(): ShowDocument {
  return { format: 'formshow', version: 1, stage: { ...STAGE_SIZE }, shapes: [] };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A point with a missing or non-finite coordinate cannot be repaired: null. */
function validatePoint(value: unknown): { point: Point; repaired: boolean } | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null;
  const cx = Math.min(1, Math.max(0, x)), cy = Math.min(1, Math.max(0, y));
  return { point: { x: cx, y: cy }, repaired: cx !== x || cy !== y };
}

export function validateShow(value: unknown): { show: ShowDocument; repaired: boolean } {
  const show = createShow();
  if (!isRecord(value)) return { show, repaired: true };
  let repaired = value.format !== 'formshow' || value.version !== 1;
  if (!isRecord(value.stage) || value.stage.width !== STAGE_SIZE.width || value.stage.height !== STAGE_SIZE.height) repaired = true;
  if (!Array.isArray(value.shapes)) return { show, repaired: true };
  if (value.shapes.length > MAX_SHAPES) repaired = true;

  const seen = new Set<string>();
  for (const raw of value.shapes.slice(0, MAX_SHAPES)) {
    if (!isRecord(raw) || !Array.isArray(raw.points)) { repaired = true; continue; }
    if (raw.points.length > MAX_POINTS) repaired = true;
    const points: Point[] = [];
    let bad = false;
    for (const p of raw.points.slice(0, MAX_POINTS)) {
      const r = validatePoint(p);
      if (!r) { bad = true; break; }
      if (r.repaired) repaired = true;
      points.push(r.point);
    }
    if (bad || points.length < 3) { repaired = true; continue; }
    // An outline the editor would refuse (crossing, collapsed) is left out rather than sent to the wall.
    if (!isValidOutline(points).ok) { repaired = true; continue; }

    let id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : '';
    if (id === '' || seen.has(id)) { id = crypto.randomUUID(); repaired = true; }
    seen.add(id);
    const colourOk = typeof raw.colour === 'string' && /^#[0-9a-f]{6}$/i.test(raw.colour);
    const name = typeof raw.name === 'string' ? raw.name : `Shape ${show.shapes.length + 1}`;
    const visible = typeof raw.visible === 'boolean' ? raw.visible : true;
    const locked = typeof raw.locked === 'boolean' ? raw.locked : false;
    if (!colourOk || name !== raw.name || visible !== raw.visible || locked !== raw.locked) repaired = true;
    show.shapes.push({ id, name, points, colour: colourOk ? raw.colour as string : '#ffffff', visible, locked });
  }
  return { show, repaired };
}
