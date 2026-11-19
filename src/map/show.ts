/**
 * Map show document: the shapes drawn on the stage. validateShow repairs a
 * damaged or outdated file field by field, so the Map always opens.
 */
import { shapeValidity, MAX_HOLES } from './outline';
import { capture, MAX_SCENES, FADE_RANGE, type Scene, type SceneState } from './scenes';
import { targetRange, targetNamesKnown } from './targets';
import type { Link, Trigger, TriggerAction } from '../react/links';
import { isPinnable } from './homography';
import { ownCornersPinnable, pinCorners } from './placement';
import { ringBounds } from './outline';
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
export interface Shape {
  id: string; name: string; points: CurvePoint[]; colour: string; visible: boolean; locked: boolean; sourceId: string | null;
  holes: Ring[]; groupId: string | null; blocker: boolean; softEdge: number; border: Border; fill: 'colour' | 'grid';
  /** Where the picture sits in the shape (stage 4). brightness: 0 to 2; tint: multiplies the picture, white for none. */
  placement: Placement; brightness: number; tint: string;
}
/**
 * Fit: the shape's box, with zoom, offset (stage fractions) and turn (degrees). Pin: four corners in perspective;
 * pin null uses the shape's own four corners (or its box's). Across group / stage: the group's or stage's box.
 */
export type PlacementKind = 'fit' | 'pin' | 'across-group' | 'across-stage';
export interface Placement { kind: PlacementKind; zoom: number; offset: Point; turn: number; pin: Point[] | null }
/** A folder of shapes, one level deep. Hidden or locked, it hides or locks its members without changing their own settings. */
export interface Group { id: string; name: string; visible: boolean; locked: boolean }
/** A photograph to trace over, on the operator screen only: a JPEG or PNG as a data URL. */
export interface Photo { data: string; opacity: number }
/** A Studio composition playing in one or more shapes. revision goes up with every change, so the wall knows what it has. */
/** tempoSync: null plays at its own speed; a number of beats runs one loop in that many beats of the tempo clock. */
export interface InstrumentSource { id: string; kind: 'instrument'; project: Project; speed: number; revision: number; tempoSync: number | null }
export type Source = InstrumentSource;
/** stageCorners: where the stage's four corners go on the projector (to fix a nudged projector), or null for none. */
/** Stage 5: scenes (with the live one and the default fade in seconds), and the links and triggers sound and MIDI drive. */
/** Stage 6: a video file a shape plays, left where it is on disk. Its id begins `video-`; shapes name it as their sourceId. */
export interface VideoSource { id: string; path: string; name: string; speed: number; tempoSync: number | null }
export interface ShowDocument { format: 'formshow'; version: 7; stage: { width: number; height: number }; shapes: Shape[]; sources: Source[]; groups: Group[]; photo: Photo | null; stageCorners: Point[] | null; videos: VideoSource[];
  scenes: Scene[]; sceneId: string | null; sceneFade: number; links: Link[]; triggers: Trigger[] }
/** A source as the wall first hears of it: everything but the composition, which travels in its own message. */
export interface WireSource { id: string; kind: 'instrument'; speed: number; revision: number; tempoSync: number | null }
/** The show as sent to the wall: no compositions, and never the photo. */
export interface WireShow { format: 'formshow'; version: 7; stage: { width: number; height: number }; shapes: Shape[]; sources: WireSource[]; groups: Group[]; stageCorners: Point[] | null; links: Link[];
  /** The show plays Live somewhere (a shape, or a scene): the wall keeps Live's camera running. */
  usesLive: boolean;
  /** Stage 6: the videos shapes play, with their paths (the wall fetches them through the app). */
  videos: VideoSource[] }

/**
 * Live in Map: a shape that plays the Live screen's look names this as its sourceId. There is one Live, shared, and it
 * has no entry in `sources` (it has no composition). Version 6 and later.
 */
export const LIVE_SOURCE_ID = 'live';
/** True when a shape, or any scene, plays Live. */
export function usesLive(show: Pick<ShowDocument, 'shapes'> & { scenes?: Scene[] }): boolean {
  return playedBy(show, LIVE_SOURCE_ID);
}

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
export const MAX_LINKS = 64;
/** Stage 6: videos in a show, and pictures stored in it (by decoded size). */
export const MAX_VIDEOS = 16;
export const IMAGE_FILE_LIMIT = 8 * 1024 * 1024;
export const IMAGE_SHOW_LIMIT = 32 * 1024 * 1024;
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];
export const isVideoId = (id: string | null | undefined): id is string => !!id && id.startsWith('video-');
export const isVideoPath = (path: string) => typeof path === 'string' && VIDEO_EXTENSIONS.some(e => path.toLowerCase().endsWith(e));
/** The decoded size of a data URL's base64 payload. */
export const dataUrlBytes = (dataUrl: string) => { const i = dataUrl.indexOf(','); return i < 0 ? 0 : Math.floor((dataUrl.length - i - 1) * 3 / 4); };
/** The pictures stored in the show, by decoded size, each distinct picture counted once. */
export function imageBytes(show: Pick<ShowDocument, 'sources'>): number {
  const seen = new Set<string>();
  for (const s of show.sources) for (const l of s.project.layers) if (l.image?.dataUrl) seen.add(l.image.dataUrl);
  return [...seen].reduce((n, d) => n + dataUrlBytes(d), 0);
}

export const MAX_TRIGGERS = 32;
export const DEFAULT_SCENE_FADE = 2;
/** Loops an instrument can run in, in beats of the tempo clock. */
export const TEMPO_SYNC_BEATS = [1, 2, 4, 8, 16];
export const SOFT_EDGE_MAX = 200;
export const BORDER_MAX = 40;
export const GLOW_MAX = 40;
/** A photo is stored shrunk to the stage as a JPEG, well under this. */
export const PHOTO_TEXT_LIMIT = 8 * 1024 * 1024;
export const DEFAULT_BORDER: Border = { width: 0, colour: 'shape', glow: 0 };
/** The stage 3 fields of a new shape, at their defaults. */
export const DEFAULT_PLACEMENT: Placement = { kind: 'fit', zoom: 1, offset: { x: 0, y: 0 }, turn: 0, pin: null };
export const ZOOM_RANGE = { min: 0.25, max: 4 };
export const BRIGHTNESS_MAX = 2;
export const shapeExtras = (): Pick<Shape, 'holes' | 'groupId' | 'blocker' | 'softEdge' | 'border' | 'fill' | 'placement' | 'brightness' | 'tint'> =>
  ({ holes: [], groupId: null, blocker: false, softEdge: 0, border: { ...DEFAULT_BORDER }, fill: 'colour', placement: { ...DEFAULT_PLACEMENT, offset: { x: 0, y: 0 } }, brightness: 1, tint: '#ffffff' });

export function createShow(): ShowDocument {
  return { format: 'formshow', version: 7, stage: { ...STAGE_SIZE }, shapes: [], sources: [], groups: [], photo: null, stageCorners: null, scenes: [], sceneId: null, sceneFade: DEFAULT_SCENE_FADE, links: [], triggers: [], videos: [] };
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

/** Four points in stage fractions that can carry a picture (convex, not flat, in projector pixels), or null. */
function readQuad(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const pts: Point[] = [];
  for (const p of value) {
    if (!isRecord(p) || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    // Pins and stage corners may reach a little past the stage, never further.
    if (p.x < -0.5 || p.x > 1.5 || p.y < -0.5 || p.y > 1.5) return null;
    pts.push({ x: p.x, y: p.y });
  }
  return isPinnable(pts.map(p => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height }))).ok ? pts : null;
}
function readCorners(value: unknown): { corners: Point[] | null; repaired: boolean } {
  if (value === undefined || value === null) return { corners: null, repaired: false };
  // Stage corners may reach a little past the stage, as a nudged projector needs.
  const corners = readQuad(value);
  const inReach = corners?.every(p => p.x >= -0.5 && p.x <= 1.5 && p.y >= -0.5 && p.y <= 1.5) ? corners : null;
  return { corners: inReach, repaired: inReach === null };
}
const PLACEMENT_KINDS = ['fit', 'pin', 'across-group', 'across-stage'];
function readPlacement(value: unknown): { placement: Placement; repaired: boolean } {
  if (value === undefined) return { placement: { ...DEFAULT_PLACEMENT, offset: { x: 0, y: 0 } }, repaired: false };
  if (!isRecord(value)) return { placement: { ...DEFAULT_PLACEMENT, offset: { x: 0, y: 0 } }, repaired: true };
  const kind = (PLACEMENT_KINDS.includes(value.kind as string) ? value.kind : 'fit') as PlacementKind;
  const finite = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const zoom = Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, finite(value.zoom, 1)));
  const turn = Math.min(180, Math.max(-180, finite(value.turn, 0)));
  const offsetIn = isRecord(value.offset) ? value.offset : {};
  const offset = { x: Math.min(1, Math.max(-1, finite(offsetIn.x, 0))), y: Math.min(1, Math.max(-1, finite(offsetIn.y, 0))) };
  const pin = value.pin === null || value.pin === undefined ? null : readQuad(value.pin);
  const placement: Placement = { kind, zoom, offset, turn, pin };
  const repaired = kind !== value.kind || zoom !== value.zoom || turn !== value.turn || !isRecord(value.offset) || offset.x !== offsetIn.x || offset.y !== offsetIn.y || (value.pin !== null && value.pin !== undefined && pin === null);
  return { placement, repaired };
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
  let repaired = value.format !== 'formshow' || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5 && value.version !== 6 && value.version !== 7);
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
    const placement = readPlacement(raw.placement), brightness = clampNumber(raw.brightness, BRIGHTNESS_MAX, 1);
    const tintOk = raw.tint === undefined || (typeof raw.tint === 'string' && HEX.test(raw.tint));
    if (placement.repaired || brightness.repaired || !tintOk) repaired = true;
    // A Pin that cannot carry a picture would block every edit of the shape: it opens as Fit.
    if (placement.placement.kind === 'pin' && !isPinnable(pinCorners({ points, placement: placement.placement } as Shape)).ok) { placement.placement.kind = 'fit'; repaired = true; }
    // Four corners that cannot carry a picture, with no handles of their own: they get handles at the box, so the shape can still be edited.
    else if (placement.placement.kind === 'pin' && points.length === 4 && !ownCornersPinnable({ points } as Shape) && !placement.placement.pin) {
      const b = ringBounds([points]);
      placement.placement.pin = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
      repaired = true;
    }
    shapes.push({ id, name, points, colour: colourOk ? raw.colour as string : '#ffffff', visible, locked, sourceId, holes, groupId, blocker, softEdge: softEdge.value, border: border.border, fill,
      placement: placement.placement, brightness: brightness.value, tint: typeof raw.tint === 'string' && HEX.test(raw.tint) ? raw.tint : '#ffffff' });
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
  const corners = readCorners(value.stageCorners);
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
  // From version 6 a shape (or a scene) may play Live, which is no source of the file's.
  if (sources.has(LIVE_SOURCE_ID)) { sources.delete(LIVE_SOURCE_ID); repaired = true; }
  const known = new Map<string, unknown>(sources);
  if (value.version === 6 || value.version === 7) known.set(LIVE_SOURCE_ID, true);
  // Videos (version 7): each is known by its id, as a source is.
  const videos = readVideos(value.videos);
  if (videos.repaired) repaired = true;
  for (const v of videos.videos) known.set(v.id, true);
  if (linkSources(show.shapes, known)) repaired = true;
  // Scenes, then the instruments any shape or scene plays, then the links and triggers that name what is left.
  const scenes = readScenes(value, show, known);
  if (scenes.repaired) repaired = true;
  show.sources = [...sources.values()].filter(source => playedBy(show, source.id));
  if (show.sources.length !== sources.size) repaired = true;
  show.videos = videos.videos.filter(v => playedBy(show, v.id));
  if (show.videos.length !== videos.videos.length) repaired = true;
  const links = readLinks(value.links, show), triggers = readTriggers(value.triggers, show);
  show.links = links.links; show.triggers = triggers.triggers;
  if (links.repaired || triggers.repaired) repaired = true;
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
      sources.set(raw.id, { id: raw.id, kind: 'instrument', speed: readSpeed(raw.speed).speed, revision: readRevision(raw.revision), tempoSync: readTempoSync(raw.tempoSync).value });
    }
  }
  const shapes = read.shapes;
  const known = new Map<string, unknown>(sources);
  known.set(LIVE_SOURCE_ID, true);
  const videos = isRecord(value) ? readVideos(value.videos).videos : [];
  for (const v of videos) known.set(v.id, true);
  linkSources(shapes, known);
  const kept = [...sources.values()].filter(source => shapes.some(s => s.sourceId === source.id));
  return { format: 'formshow', version: 7, stage: { ...STAGE_SIZE }, shapes, sources: kept, groups: read.groups, stageCorners: isRecord(value) ? readCorners(value.stageCorners).corners : null,
    links: isRecord(value) ? readLinks(value.links, { shapes, sources: kept }, true).links : [],
    usesLive: (isRecord(value) && value.usesLive === true) || shapes.some(s => s.sourceId === LIVE_SOURCE_ID),
    videos };
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
  const sync = readTempoSync(value.tempoSync);
  return { source: { id: value.id, kind: 'instrument', project, speed, revision, tempoSync: sync.value }, repaired: speedRepaired || revision !== value.revision || sync.repaired };
}


// ---- Stage 5: scenes, links, triggers, tempo sync ----

/** Whether any shape, or any scene, plays a source: such a source stays in the show. */
export function playedBy(show: { shapes: Shape[]; scenes?: Scene[] }, sourceId: string): boolean {
  return show.shapes.some(s => s.sourceId === sourceId) || (show.scenes ?? []).some(sc => Object.values(sc.shapes).some(st => st.sourceId === sourceId));
}

function readTempoSync(value: unknown): { value: number | null; repaired: boolean } {
  if (value === undefined || value === null) return { value: null, repaired: false };
  return TEMPO_SYNC_BEATS.includes(value as number) ? { value: value as number, repaired: false } : { value: null, repaired: true };
}

function readSceneState(raw: unknown, sources: Map<string, unknown>, points: CurvePoint[]): { state: SceneState; repaired: boolean } | null {
  if (!isRecord(raw)) return null;
  const sourceId = typeof raw.sourceId === 'string' && sources.has(raw.sourceId) ? raw.sourceId : null;
  const lostSource = raw.sourceId !== null && raw.sourceId !== undefined && sourceId === null;
  const placement = readPlacement(raw.placement).placement;
  // A scene's Pin must fit the shape's outline as it is now, as on the stage.
  if (placement.kind === 'pin' && !isPinnable(pinCorners({ points, placement } as Shape)).ok) placement.kind = 'fit';
  return { repaired: lostSource, state: {
    sourceId, fill: raw.fill === 'grid' ? 'grid' : 'colour', placement,
    brightness: clampNumber(raw.brightness, BRIGHTNESS_MAX, 1).value, tint: typeof raw.tint === 'string' && HEX.test(raw.tint) ? raw.tint : '#ffffff',
    softEdge: clampNumber(raw.softEdge, SOFT_EDGE_MAX).value, border: readBorder(raw.border).border,
    visible: raw.visible !== false, blocker: raw.blocker === true,
  } };
}

/** Scenes field by field: shapes no longer in the show are left out of each scene; a scene with a bad id or name is dropped. */
function readScenes(value: Record<string, unknown>, show: ShowDocument, sources: Map<string, unknown>): { repaired: boolean } {
  let repaired = false;
  const fade = value.sceneFade === undefined ? DEFAULT_SCENE_FADE : value.sceneFade;
  show.sceneFade = typeof fade === 'number' && Number.isFinite(fade) ? Math.min(FADE_RANGE.max, Math.max(FADE_RANGE.min, fade)) : DEFAULT_SCENE_FADE;
  if (show.sceneFade !== fade) repaired = true;
  if (value.scenes === undefined) return { repaired };
  if (!Array.isArray(value.scenes)) return { repaired: true };
  const byId = new Map(show.shapes.map(s => [s.id, s]));
  for (const raw of value.scenes.slice(0, MAX_SCENES)) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '' || raw.id.length > MAX_ID_LENGTH || show.scenes.some(s => s.id === raw.id) || !isRecord(raw.shapes)) { repaired = true; continue; }
    const shapes: Record<string, SceneState> = {};
    for (const [id, st] of Object.entries(raw.shapes)) {
      const shape = byId.get(id), read = shape ? readSceneState(st, sources, shape.points) : null;
      if (read) { shapes[id] = read.state; if (read.repaired) repaired = true; } else repaired = true;
    }
    const name = typeof raw.name === 'string' ? cleanName(raw.name).slice(0, MAX_NAME_LENGTH) : `Scene ${show.scenes.length + 1}`;
    const f = raw.fadeSeconds;
    const fadeSeconds = typeof f === 'number' && Number.isFinite(f) ? Math.min(FADE_RANGE.max, Math.max(FADE_RANGE.min, f)) : null;
    if (name !== raw.name || (f !== null && f !== fadeSeconds)) repaired = true;
    show.scenes.push({ id: raw.id, name, fadeSeconds, shapes });
  }
  if (value.scenes.length > MAX_SCENES) repaired = true;
  show.sceneId = typeof value.sceneId === 'string' && show.scenes.some(s => s.id === value.sceneId) ? value.sceneId : null;
  if (value.sceneId !== undefined && value.sceneId !== null && show.sceneId === null) repaired = true;
  return { repaired };
}

const SIGNAL = /^[a-z]+(\.[a-z0-9]+){1,3}$/;
const num = (v: unknown, lo: number, hi: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** One link, checked; null when it cannot be read or names nothing in the show. */
export function readLink(raw: unknown, show: { shapes: Shape[]; sources: { id: string }[] }, wire = false): Link | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '' || raw.id.length > MAX_ID_LENGTH) return null;
  if (typeof raw.input !== 'string' || !SIGNAL.test(raw.input) || raw.input.length > 32 || typeof raw.target !== 'string') return null;
  if (wire ? !targetNamesKnown(show, raw.target) : !targetRange(show as Pick<ShowDocument, 'shapes' | 'sources'>, raw.target)) return null;
  return {
    id: raw.id, input: raw.input, target: raw.target, mode: raw.mode === 'control' ? 'control' : 'modulate',
    amount: num(raw.amount, -1, 1, 0.5), low: num(raw.low, 0, 1, 0), high: num(raw.high, 0, 1, 1),
    attackMs: num(raw.attackMs, 0, 5000, 20), releaseMs: num(raw.releaseMs, 0, 5000, 200), on: raw.on !== false,
    name: typeof raw.name === 'string' ? cleanName(raw.name).slice(0, MAX_NAME_LENGTH) : '',
  };
}
function readLinks(value: unknown, show: { shapes: Shape[]; sources: { id: string }[] }, wire = false): { links: Link[]; repaired: boolean } {
  if (value === undefined) return { links: [], repaired: false };
  if (!Array.isArray(value)) return { links: [], repaired: true };
  const links: Link[] = [];
  let repaired = value.length > MAX_LINKS;
  for (const raw of value.slice(0, MAX_LINKS)) {
    const l = readLink(raw, show, wire);
    if (!l || links.some(x => x.id === l.id)) { repaired = true; continue; }
    if (JSON.stringify(l) !== JSON.stringify(raw)) repaired = true;
    links.push(l);
  }
  return { links, repaired };
}

/** A trigger's action is valid when what it names is still in the show. */
export function actionValid(action: unknown, show: Pick<ShowDocument, 'scenes' | 'sources'>): action is TriggerAction {
  if (!isRecord(action)) return false;
  switch (action.kind) {
    case 'scene': return typeof action.sceneId === 'string' && show.scenes.some(s => s.id === action.sceneId);
    case 'vary': return typeof action.sourceId === 'string' && show.sources.some(s => s.id === action.sourceId);
    case 'next-scene': case 'previous-scene': case 'blackout': case 'freeze': case 'tap': return Object.keys(action).length === 1;
    default: return false;
  }
}
export function readTrigger(raw: unknown, show: Pick<ShowDocument, 'scenes' | 'sources'>): Trigger | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '' || raw.id.length > MAX_ID_LENGTH) return null;
  if (typeof raw.input !== 'string' || !SIGNAL.test(raw.input) || raw.input.length > 32 || !actionValid(raw.action, show)) return null;
  const when = raw.when === 'beats' ? 'beats' : 'on';
  // The action is rebuilt with only its own fields.
  const a = raw.action;
  const action: TriggerAction = a.kind === 'scene' ? { kind: 'scene', sceneId: a.sceneId } : a.kind === 'vary' ? { kind: 'vary', sourceId: a.sourceId } : { kind: a.kind };
  return { id: raw.id, input: raw.input, when, every: Math.round(num(raw.every, 1, 64, 1)), action, on: raw.on !== false };
}
function readTriggers(value: unknown, show: Pick<ShowDocument, 'scenes' | 'sources'>): { triggers: Trigger[]; repaired: boolean } {
  if (value === undefined) return { triggers: [], repaired: false };
  if (!Array.isArray(value)) return { triggers: [], repaired: true };
  const triggers: Trigger[] = [];
  let repaired = value.length > MAX_TRIGGERS;
  for (const raw of value.slice(0, MAX_TRIGGERS)) {
    const t = readTrigger(raw, show);
    if (!t || triggers.some(x => x.id === t.id)) { repaired = true; continue; }
    if (JSON.stringify(t) !== JSON.stringify(raw)) repaired = true;
    triggers.push(t);
  }
  return { triggers, repaired };
}
export { capture as captureScene };

/** A show file's videos, checked field by field: an unreadable one is left out (its shapes play their colour). */
function readVideos(value: unknown): { videos: VideoSource[]; repaired: boolean } {
  if (value === undefined) return { videos: [], repaired: false };
  if (!Array.isArray(value)) return { videos: [], repaired: true };
  const videos: VideoSource[] = [];
  let repaired = value.length > MAX_VIDEOS;
  for (const raw of value.slice(0, MAX_VIDEOS)) {
    if (!isRecord(raw) || !isVideoId(raw.id as string) || (raw.id as string).length > MAX_ID_LENGTH || typeof raw.path !== 'string' || !isVideoPath(raw.path) || videos.some(v => v.id === raw.id)) { repaired = true; continue; }
    const speed = readSpeed(raw.speed), sync = readTempoSync(raw.tempoSync);
    const name = typeof raw.name === 'string' ? cleanName(raw.name).slice(0, 120) : raw.path.split(/[\\/]/).pop() ?? 'Video';
    if (speed.repaired || sync.repaired || name !== raw.name) repaired = true;
    videos.push({ id: raw.id as string, path: raw.path, name, speed: speed.speed, tempoSync: sync.value });
  }
  return { videos, repaired };
}
