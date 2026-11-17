/**
 * Map show document: the shapes drawn on the stage. validateShow repairs a
 * damaged or outdated file field by field, so the Map always opens.
 */
import { isValidOutline } from './geometry';
import { validateProject } from '../core/project';
import type { Project } from '../shared/types';

export interface Point { x: number; y: number }
/** sourceId: the instrument source the shape plays, or null when it plays its own colour. */
export interface Shape { id: string; name: string; points: Point[]; colour: string; visible: boolean; locked: boolean; sourceId: string | null }
/** A Studio composition playing in one or more shapes. revision goes up with every change, so the wall knows what it has. */
export interface InstrumentSource { id: string; kind: 'instrument'; project: Project; speed: number; revision: number }
export type Source = InstrumentSource;
export interface ShowDocument { format: 'formshow'; version: 2; stage: { width: number; height: number }; shapes: Shape[]; sources: Source[] }
/** A source as the wall first hears of it: everything but the composition, which travels in its own message. */
export interface WireSource { id: string; kind: 'instrument'; speed: number; revision: number }
/** The show as sent to the wall. */
export interface WireShow { format: 'formshow'; version: 2; stage: { width: number; height: number }; shapes: Shape[]; sources: WireSource[] }

export const MAX_SHAPES = 64;
export const MAX_POINTS = 32;
export const STAGE_SIZE = { width: 1920, height: 1080 };
/** Names and ids are limited so the largest valid show always fits in one message to the wall. */
export const MAX_NAME_LENGTH = 40;
export const MAX_ID_LENGTH = 64;
export const MAX_SOURCES = 64;
/** Studio's own limit on layers in a composition. */
export const MAX_SOURCE_LAYERS = 4;
/** How fast a source plays: 1 is as designed. */
export const SPEED_RANGE = { min: 0.1, max: 4 };
/** The smallest outline the Map accepts: one projector pixel of area, in stage fractions. */
export const MIN_OUTLINE_AREA = 1 / (1920 * 1080);

export function createShow(): ShowDocument {
  return { format: 'formshow', version: 2, stage: { ...STAGE_SIZE }, shapes: [], sources: [] };
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
  const read = readShapes(value);
  const show = createShow();
  show.shapes = read.shapes;
  let repaired = read.repaired;
  if (!isRecord(value) || !read.ok) return { show, repaired };

  // Sources: each composition is checked as Studio checks a file. A source that cannot be read is left out,
  // and its shapes play their colour; so do shapes that name a source the file does not have.
  const sources = new Map<string, Source>();
  if (Array.isArray(value.sources)) {
    for (const raw of value.sources) {
      if (sources.size >= MAX_SOURCES) { repaired = true; break; }
      const checked = validateSource(raw);
      if (!checked || sources.has(checked.source.id)) { repaired = true; continue; }
      if (checked.repaired) repaired = true;
      sources.set(checked.source.id, checked.source);
    }
  } else if (value.sources !== undefined) repaired = true;
  if (linkSources(show.shapes, sources)) repaired = true;
  show.sources = [...sources.values()].filter(source => show.shapes.some(s => s.sourceId === source.id));
  if (show.sources.length !== sources.size) repaired = true;
  return { show, repaired };
}

/**
 * The show as the wall receives it: shapes checked as in a file, sources without their compositions.
 * Anything unreadable is left out, as validateShow does.
 */
export function validateWireShow(value: unknown): WireShow {
  const read = readShapes(value);
  const sources = new Map<string, WireSource>();
  if (isRecord(value) && read.ok && Array.isArray(value.sources)) {
    for (const raw of value.sources) {
      if (sources.size >= MAX_SOURCES) break;
      if (!isRecord(raw) || raw.kind !== 'instrument' || typeof raw.id !== 'string' || raw.id === '' || raw.id.length > MAX_ID_LENGTH || sources.has(raw.id)) continue;
      sources.set(raw.id, { id: raw.id, kind: 'instrument', speed: readSpeed(raw.speed).speed, revision: readRevision(raw.revision) });
    }
  }
  const shapes = read.shapes;
  linkSources(shapes, sources);
  return { format: 'formshow', version: 2, stage: { ...STAGE_SIZE }, shapes, sources: [...sources.values()].filter(source => shapes.some(s => s.sourceId === source.id)) };
}

/** Shapes that name a source the show does not have play their colour. True when any had to. */
function linkSources(shapes: Shape[], sources: Map<string, unknown>): boolean {
  let changed = false;
  for (const shape of shapes) if (shape.sourceId !== null && !sources.has(shape.sourceId)) { shape.sourceId = null; changed = true; }
  return changed;
}

const readSpeed = (value: unknown): { speed: number; repaired: boolean } => {
  const finite = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  const speed = Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, finite));
  return { speed, repaired: speed !== value };
};
const readRevision = (value: unknown): number => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

/** The shapes of a show file, checked field by field. ok is false when the file has no shape list at all. */
function readShapes(value: unknown): { shapes: Shape[]; repaired: boolean; ok: boolean } {
  const show = createShow();
  if (!isRecord(value)) return { shapes: [], repaired: true, ok: false };
  // Version 1 shows (stage 1) had no sources: they open as all-colour shows, which is not a repair.
  let repaired = value.format !== 'formshow' || (value.version !== 1 && value.version !== 2);
  if (!isRecord(value.stage) || value.stage.width !== STAGE_SIZE.width || value.stage.height !== STAGE_SIZE.height) repaired = true;
  if (!Array.isArray(value.shapes)) return { shapes: [], repaired: true, ok: false };
  if (value.shapes.length > MAX_SHAPES) repaired = true;

  const seen = new Set<string>();
  for (const raw of value.shapes.slice(0, MAX_SHAPES)) {
    if (!isRecord(raw) || !Array.isArray(raw.points)) { repaired = true; continue; }
    // Too many corners: left out whole. Cutting the list would silently change the outline.
    if (raw.points.length > MAX_POINTS) { repaired = true; continue; }
    const points: Point[] = [];
    let bad = false;
    for (const p of raw.points) {
      const r = validatePoint(p);
      if (!r) { bad = true; break; }
      if (r.repaired) repaired = true;
      points.push(r.point);
    }
    if (bad || points.length < 3) { repaired = true; continue; }
    // An outline the editor would refuse (crossing, collapsed) is left out rather than sent to the wall.
    if (!isValidOutline(points).ok) { repaired = true; continue; }

    let id = typeof raw.id === 'string' && raw.id !== '' && raw.id.length <= MAX_ID_LENGTH ? raw.id : '';
    if (id === '' || seen.has(id)) { id = crypto.randomUUID(); repaired = true; }
    seen.add(id);
    const colourOk = typeof raw.colour === 'string' && /^#[0-9a-f]{6}$/i.test(raw.colour);
    const name = typeof raw.name === 'string' ? raw.name.slice(0, MAX_NAME_LENGTH) : `Shape ${show.shapes.length + 1}`;
    const visible = typeof raw.visible === 'boolean' ? raw.visible : true;
    const locked = typeof raw.locked === 'boolean' ? raw.locked : false;
    if (!colourOk || name !== raw.name || visible !== raw.visible || locked !== raw.locked) repaired = true;
    const sourceId = typeof raw.sourceId === 'string' ? raw.sourceId : null;
    show.shapes.push({ id, name, points, colour: colourOk ? raw.colour as string : '#ffffff', visible, locked, sourceId });
  }
  return { shapes: show.shapes, repaired, ok: true };
}

function validateSource(value: unknown): { source: Source; repaired: boolean } | null {
  if (!isRecord(value) || value.kind !== 'instrument' || typeof value.id !== 'string' || value.id === '' || value.id.length > MAX_ID_LENGTH) return null;
  let project: Project;
  try { project = validateProject(value.project); } catch { return null; }
  if (project.layers.length > MAX_SOURCE_LAYERS) return null;
  const { speed, repaired: speedRepaired } = readSpeed(value.speed);
  const revision = readRevision(value.revision);
  return { source: { id: value.id, kind: 'instrument', project, speed, revision }, repaired: speedRepaired || revision !== value.revision };
}
