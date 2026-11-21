/**
 * Map show document: the shapes drawn on the stage. validateShow repairs a
 * damaged or outdated file field by field, so the Map always opens.
 */
import { shapeValidity, MAX_HOLES } from './outline';
import { quadUsable, clampBrightness } from './placement';
import { validateProject } from '../core/project';
import type { Project } from '../shared/types';

export interface Point { x: number; y: number }
/** A curve handle: an offset from its point, in stage fractions. */
export interface Handle { x: number; y: number }
/** A point of an outline. With no handles it is a corner; a side between two corners is straight. */
export interface CurvePoint extends Point { in?: Handle; out?: Handle }
/** A closed outline: a shape's own, or a hole in it. */
export type Ring = CurvePoint[];
/** How a border looks: drawn inside the outline, in projector pixels. colour: the shape's own, its instrument's first palette colour, or fixed. */
export interface Border { width: number; colour: 'shape' | 'palette' | string; glow: number }
/**
 * sourceId: the instrument source the shape plays, or null when it plays its own colour.
 * holes: outlines cut out of the shape. blocker: plays nothing and blacks out everything beneath it.
 * softEdge: projector pixels over which the content fades in from the outline.
 * fill: what a shape that plays no instrument shows: its plain colour, or a grid pattern in its colour (new shapes).
 */
/**
 * How the picture sits in the shape (stage 4). fit: fills the shape's box. pin: four stage corners take it with
 * perspective (pins are stage fractions, always four). group / stage: laid over the shape's group, or the whole
 * stage, so the shape is a window on to it.
 */
export type PlacementMode = 'fit' | 'pin' | 'group' | 'stage';
export interface Placement { mode: PlacementMode; pins: Point[] }
/** Brightness: a multiplier, 1 as designed. Tint: a colour mixed in by tintAmount (0 to 1); null for none. */
export interface Look { brightness: number; tint: string | null; tintAmount: number }
export interface Shape {
  id: string; name: string; points: CurvePoint[]; colour: string; visible: boolean; locked: boolean; sourceId: string | null;
  holes: Ring[]; groupId: string | null; blocker: boolean; softEdge: number; border: Border; fill: 'colour' | 'grid';
  placement: Placement; look: Look;
}
/** A folder of shapes, one level deep. Hidden or locked, it hides or locks its members without changing their own settings. */
export interface Group { id: string; name: string; visible: boolean; locked: boolean }
/** A photograph to trace over, on the operator screen only: a JPEG or PNG as a data URL. */
export interface Photo { data: string; opacity: number }
/** A Studio composition playing in one or more shapes. revision goes up with every change, so the wall knows what it has. */
export interface InstrumentSource { id: string; kind: 'instrument'; project: Project; speed: number; revision: number }
export type Source = InstrumentSource;
/**
 * The stage's four corners on the wall, as fractions of the output (stage 4). Moving them re-pins the whole stage when
 * the projector moves; the outlines stay where they are on the stage. Identity: the stage fills the output.
 */
export const IDENTITY_CORNERS: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
export interface ShowDocument { format: 'formshow'; version: 4; stage: { width: number; height: number }; shapes: Shape[]; sources: Source[]; groups: Group[]; photo: Photo | null; stageCorners: Point[] }
/** A source as the wall first hears of it: everything but the composition, which travels in its own message. */
export interface WireSource { id: string; kind: 'instrument'; speed: number; revision: number }
/** The show as sent to the wall: no compositions, and never the photo. */
export interface WireShow { format: 'formshow'; version: 4; stage: { width: number; height: number }; shapes: Shape[]; sources: WireSource[]; groups: Group[]; stageCorners: Point[] }

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
export { MAX_HOLES } from './outline';
export const MAX_GROUPS = 32;
export const SOFT_EDGE_MAX = 200;
export const BORDER_MAX = 40;
export const GLOW_MAX = 40;
/** A photo is stored shrunk to the stage as a JPEG, well under this. */
export const PHOTO_TEXT_LIMIT = 8 * 1024 * 1024;
export const DEFAULT_BORDER: Border = { width: 0, colour: 'shape', glow: 0 };
export const DEFAULT_LOOK: Look = { brightness: 1, tint: null, tintAmount: 0.5 };
export const DEFAULT_PLACEMENT: Placement = { mode: 'fit', pins: [] };
/** The stage 3 fields of a new shape, at their defaults. */
export const shapeExtras = (): Pick<Shape, 'holes' | 'groupId' | 'blocker' | 'softEdge' | 'border' | 'fill' | 'placement' | 'look'> => ({ holes: [], groupId: null, blocker: false, softEdge: 0, border: { ...DEFAULT_BORDER }, fill: 'colour', placement: { ...DEFAULT_PLACEMENT, pins: [] }, look: { ...DEFAULT_LOOK } });

export function createShow(): ShowDocument {
  return { format: 'formshow', version: 4, stage: { ...STAGE_SIZE }, shapes: [], sources: [], groups: [], photo: null, stageCorners: IDENTITY_CORNERS.map(p => ({ ...p })) };
}

/** Stage corners from a file: four finite points inside the output and forming a usable quad, else the identity. */
function readStageCorners(value: unknown): { corners: Point[]; repaired: boolean } {
  if (value === undefined) return { corners: IDENTITY_CORNERS.map(p => ({ ...p })), repaired: false };
  const ok = Array.isArray(value) && value.length === 4 && value.every(p => isRecord(p) && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!ok) return { corners: IDENTITY_CORNERS.map(p => ({ ...p })), repaired: true };
  const corners = (value as Record<string, number>[]).map(p => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }));
  const repaired = corners.some((c, i) => c.x !== (value as Record<string, number>[])[i].x || c.y !== (value as Record<string, number>[])[i].y);
  if (!quadUsable(corners, 0.01)) return { corners: IDENTITY_CORNERS.map(p => ({ ...p })), repaired: true };
  return { corners, repaired };
}

/** A placement from a file: an unknown mode is fit; pins that do not form a usable quad turn it back to fit. */
function readPlacement(value: unknown): { placement: Placement; repaired: boolean } {
  const fit = { placement: { mode: 'fit' as PlacementMode, pins: [] as Point[] }, repaired: true };
  if (value === undefined) return { placement: { mode: 'fit', pins: [] }, repaired: false };
  if (!isRecord(value) || !['fit', 'pin', 'group', 'stage'].includes(value.mode as string)) return fit;
  const mode = value.mode as PlacementMode;
  const pins: Point[] = [];
  if (Array.isArray(value.pins) && value.pins.length === 4 && value.pins.every(p => isRecord(p) && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y))) {
    for (const p of value.pins as Record<string, number>[]) pins.push({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) });
  }
  if (mode === 'pin' && !quadUsable(pins, MIN_OUTLINE_AREA)) return fit;
  return { placement: { mode, pins: mode === 'pin' ? pins : [] }, repaired: false };
}

/** A look from a file: brightness clamped, tint a valid colour or none. */
function readLook(value: unknown): { look: Look; repaired: boolean } {
  if (value === undefined) return { look: { ...DEFAULT_LOOK }, repaired: false };
  if (!isRecord(value)) return { look: { ...DEFAULT_LOOK }, repaired: true };
  const brightness = clampBrightness(typeof value.brightness === 'number' ? value.brightness : 1);
  const tintOk = value.tint === null || (typeof value.tint === 'string' && HEX.test(value.tint));
  const tint = tintOk ? value.tint as string | null : null;
  const amount = clampNumber(value.tintAmount, 1, 0.5);
  return { look: { brightness, tint, tintAmount: amount.value }, repaired: brightness !== value.brightness || !tintOk || amount.repaired };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A handle that is not two finite numbers is dropped (its point becomes a corner); one longer than the stage is cut to it. */
function readHandle(value: unknown): { handle: Handle | undefined; repaired: boolean } {
  if (value === undefined) return { handle: undefined, repaired: false };
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number' || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return { handle: undefined, repaired: true };
  const x = Math.min(1, Math.max(-1, value.x)), y = Math.min(1, Math.max(-1, value.y));
  if (x === 0 && y === 0) return { handle: undefined, repaired: false };
  return { handle: { x, y }, repaired: x !== value.x || y !== value.y };
}

/** A point with a missing or non-finite coordinate cannot be repaired: null. */
function validatePoint(value: unknown): { point: CurvePoint; repaired: boolean } | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null;
  const cx = Math.min(1, Math.max(0, x)), cy = Math.min(1, Math.max(0, y));
  const point: CurvePoint = { x: cx, y: cy };
  const hin = readHandle(value.in), hout = readHandle(value.out);
  if (hin.handle) point.in = hin.handle;
  if (hout.handle) point.out = hout.handle;
  return { point, repaired: cx !== x || cy !== y || hin.repaired || hout.repaired };
}

/** A ring of points, or null when any point cannot be read or there are too many. */
function readRing(value: unknown): { ring: Ring; repaired: boolean } | null {
  if (!Array.isArray(value) || value.length > MAX_POINTS) return null;
  const ring: Ring = [];
  let repaired = false;
  for (const p of value) {
    const r = validatePoint(p);
    if (!r) return null;
    if (r.repaired) repaired = true;
    ring.push(r.point);
  }
  return { ring, repaired };
}

const clampNumber = (value: unknown, max: number, fallback = 0): { value: number; repaired: boolean } => {
  if (value === undefined) return { value: fallback, repaired: false };
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback;
  return { value: n, repaired: n !== value };
};
const HEX = /^#[0-9a-f]{6}$/i;
/** Names never carry control characters: they would only make messages to the wall larger. */
export const cleanName = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, '');

function readBorder(value: unknown): { border: Border; repaired: boolean } {
  if (value === undefined) return { border: { ...DEFAULT_BORDER }, repaired: false };
  if (!isRecord(value)) return { border: { ...DEFAULT_BORDER }, repaired: true };
  const width = clampNumber(value.width, BORDER_MAX), glow = clampNumber(value.glow, GLOW_MAX);
  const colourOk = value.colour === 'shape' || value.colour === 'palette' || (typeof value.colour === 'string' && HEX.test(value.colour));
  return { border: { width: width.value, colour: colourOk ? value.colour as string : 'shape', glow: glow.value }, repaired: width.repaired || glow.repaired || !colourOk };
}

function readGroups(value: unknown): { groups: Group[]; repaired: boolean } {
  if (value === undefined) return { groups: [], repaired: false };
  if (!Array.isArray(value)) return { groups: [], repaired: true };
  const groups: Group[] = [];
  let repaired = value.length > MAX_GROUPS;
  for (const raw of value.slice(0, MAX_GROUPS)) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '' || raw.id.length > MAX_ID_LENGTH || groups.some(g => g.id === raw.id)) { repaired = true; continue; }
    const name = typeof raw.name === 'string' ? cleanName(raw.name).slice(0, MAX_NAME_LENGTH) : `Group ${groups.length + 1}`;
    const visible = typeof raw.visible === 'boolean' ? raw.visible : true;
    const locked = typeof raw.locked === 'boolean' ? raw.locked : false;
    if (name !== raw.name || visible !== raw.visible || locked !== raw.locked) repaired = true;
    groups.push({ id: raw.id, name, visible, locked });
  }
  return { groups, repaired };
}

function readPhoto(value: unknown): { photo: Photo | null; repaired: boolean } {
  if (value === undefined || value === null) return { photo: null, repaired: false };
  if (!isRecord(value) || typeof value.data !== 'string' || value.data.length > PHOTO_TEXT_LIMIT || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value.data)) return { photo: null, repaired: true };
  const opacity = clampNumber(value.opacity, 1, 0.5);
  return { photo: { data: value.data, opacity: opacity.value }, repaired: opacity.repaired };
}

/** Whether a shape is drawn: its own setting and its group's. */
export function isShapeShown(show: { groups: Group[] }, shape: Shape): boolean {
  if (!shape.visible) return false;
  return shape.groupId === null || show.groups.find(g => g.id === shape.groupId)?.visible !== false;
}
/** Whether a shape is protected from change: its own lock or its group's. */
export function isShapeLocked(show: { groups: Group[] }, shape: Shape): boolean {
  if (shape.locked) return true;
  return shape.groupId !== null && show.groups.find(g => g.id === shape.groupId)?.locked === true;
}

/**
 * The list keeps each group's members together, at the place of its first member, so the list is also the
 * stacking order. Shapes in no known group are ungrouped, and groups with no members are dropped. Pure.
 */
export function normaliseGroups<T extends { shapes: Shape[]; groups: Group[] }>(show: T): T {
  const known = new Set(show.groups.map(g => g.id));
  const shapes = show.shapes.map(s => s.groupId !== null && !known.has(s.groupId) ? { ...s, groupId: null } : s);
  const ordered: Shape[] = [];
  const placed = new Set<string>();
  for (const shape of shapes) {
    if (shape.groupId === null) { ordered.push(shape); continue; }
    if (placed.has(shape.groupId)) continue;
    placed.add(shape.groupId);
    ordered.push(...shapes.filter(s => s.groupId === shape.groupId));
  }
  const groups = show.groups.filter(g => placed.has(g.id));
  const same = ordered.every((s, i) => s === show.shapes[i]) && groups.length === show.groups.length;
  return same ? show : { ...show, shapes: ordered, groups };
}

/** The shapes and groups of a show file, checked field by field. ok is false when the file has no shape list at all. */
function readShapes(value: unknown): { shapes: Shape[]; groups: Group[]; repaired: boolean; ok: boolean } {
  if (!isRecord(value)) return { shapes: [], groups: [], repaired: true, ok: false };
  // Version 1 and 2 shows open with every later field at its default, which is not a repair.
  let repaired = value.format !== 'formshow' || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4);
  if (!isRecord(value.stage) || value.stage.width !== STAGE_SIZE.width || value.stage.height !== STAGE_SIZE.height) repaired = true;
  if (!Array.isArray(value.shapes)) return { shapes: [], groups: [], repaired: true, ok: false };
  if (value.shapes.length > MAX_SHAPES) repaired = true;
  const readG = readGroups(value.groups);
  if (readG.repaired) repaired = true;

  const shapes: Shape[] = [];
  const seen = new Set<string>();
  for (const raw of value.shapes.slice(0, MAX_SHAPES)) {
    if (!isRecord(raw)) { repaired = true; continue; }
    // Too many corners, or one that cannot be read: left out whole. Cutting the list would silently change the outline.
    const outline = readRing(raw.points);
    if (!outline || outline.ring.length < 3) { repaired = true; continue; }
    if (outline.repaired) repaired = true;
    const points = outline.ring;
    // An outline the editor would refuse (crossing, collapsed) is left out rather than sent to the wall.
    if (!shapeValidity(points, []).ok) { repaired = true; continue; }
    // Holes are kept one by one while the shape stays valid; one that does not fit is left out, the shape kept.
    const holes: Ring[] = [];
    if (raw.holes !== undefined && !Array.isArray(raw.holes)) repaired = true;
    for (const rawHole of Array.isArray(raw.holes) ? raw.holes : []) {
      const hole = readRing(rawHole);
      if (!hole || holes.length >= MAX_HOLES || !shapeValidity(points, [...holes, hole.ring]).ok) { repaired = true; continue; }
      if (hole.repaired) repaired = true;
      holes.push(hole.ring);
    }

    let id = typeof raw.id === 'string' && raw.id !== '' && raw.id.length <= MAX_ID_LENGTH ? raw.id : '';
    if (id === '' || seen.has(id)) { id = crypto.randomUUID(); repaired = true; }
    seen.add(id);
    const colourOk = typeof raw.colour === 'string' && HEX.test(raw.colour);
    const name = typeof raw.name === 'string' ? cleanName(raw.name).slice(0, MAX_NAME_LENGTH) : `Shape ${shapes.length + 1}`;
    const visible = typeof raw.visible === 'boolean' ? raw.visible : true;
    const locked = typeof raw.locked === 'boolean' ? raw.locked : false;
    if (!colourOk || name !== raw.name || visible !== raw.visible || locked !== raw.locked) repaired = true;
    const blocker = raw.blocker === true;
    if (raw.blocker !== undefined && typeof raw.blocker !== 'boolean') repaired = true;
    // A blocker plays nothing.
    let sourceId = typeof raw.sourceId === 'string' ? raw.sourceId : null;
    if (blocker && sourceId !== null) { sourceId = null; repaired = true; }
    const groupId = typeof raw.groupId === 'string' ? raw.groupId : null;
    if (raw.groupId !== undefined && raw.groupId !== null && groupId === null) repaired = true;
    const softEdge = clampNumber(raw.softEdge, SOFT_EDGE_MAX), border = readBorder(raw.border);
    if (softEdge.repaired || border.repaired) repaired = true;
    // Shapes from before the grid pattern keep their plain colour.
    const fill = raw.fill === 'grid' ? 'grid' : 'colour';
    if (raw.fill !== undefined && raw.fill !== 'grid' && raw.fill !== 'colour') repaired = true;
    const placement = readPlacement(raw.placement), look = readLook(raw.look);
    if (placement.repaired || look.repaired) repaired = true;
    shapes.push({ id, name, points, colour: colourOk ? raw.colour as string : '#ffffff', visible, locked, sourceId, holes, groupId, blocker, softEdge: softEdge.value, border: border.border, fill, placement: placement.placement, look: look.look });
  }
  const normal = normaliseGroups({ shapes, groups: readG.groups });
  if (normal.shapes !== shapes) repaired = true;
  return { shapes: normal.shapes, groups: normal.groups, repaired, ok: true };
}

export function validateShow(value: unknown): { show: ShowDocument; repaired: boolean } {
  const read = readShapes(value);
  const show = createShow();
  show.shapes = read.shapes;
  show.groups = read.groups;
  let repaired = read.repaired;
  if (!isRecord(value) || !read.ok) return { show, repaired };
  const photo = readPhoto(value.photo);
  show.photo = photo.photo;
  if (photo.repaired) repaired = true;
  const corners = readStageCorners(value.stageCorners);
  show.stageCorners = corners.corners;
  if (corners.repaired) repaired = true;

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
  return { format: 'formshow', version: 4, stage: { ...STAGE_SIZE }, shapes, sources: [...sources.values()].filter(source => shapes.some(s => s.sourceId === source.id)), groups: read.groups, stageCorners: isRecord(value) ? readStageCorners(value.stageCorners).corners : IDENTITY_CORNERS.map(p => ({ ...p })) };
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

function validateSource(value: unknown): { source: Source; repaired: boolean } | null {
  if (!isRecord(value) || value.kind !== 'instrument' || typeof value.id !== 'string' || value.id === '' || value.id.length > MAX_ID_LENGTH) return null;
  let project: Project;
  try { project = validateProject(value.project); } catch { return null; }
  if (project.layers.length > MAX_SOURCE_LAYERS) return null;
  const { speed, repaired: speedRepaired } = readSpeed(value.speed);
  const revision = readRevision(value.revision);
  return { source: { id: value.id, kind: 'instrument', project, speed, revision }, repaired: speedRepaired || revision !== value.revision };
}
