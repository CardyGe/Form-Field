import {
  BORDER_MAX, GLOW_MAX, MAX_GROUPS, MAX_NAME_LENGTH, MAX_SHAPES, MAX_SOURCES, MAX_SOURCE_LAYERS, PHOTO_TEXT_LIMIT, SOFT_EDGE_MAX, SPEED_RANGE, STAGE_SIZE,
  BRIGHTNESS_MAX, ZOOM_RANGE, MAX_LINKS, MAX_TRIGGERS, TEMPO_SYNC_BEATS, playedBy, readLink, readTrigger, cleanName, isShapeLocked, normaliseGroups, shapeExtras,
  type Border, type Placement, type CurvePoint, type Photo, type Point, type Ring, type Shape, type ShowDocument, type Source, LIVE_SOURCE_ID,
  IMAGE_FILE_LIMIT, IMAGE_SHOW_LIMIT, MAX_VIDEOS, dataUrlBytes, imageBytes, isVideoId, isVideoPath,
} from './show';
import { clampToStage, nudge, rectangleFromDrag } from './geometry';
import { gridCells, insertPoint, isCurved, moveHandle, removePoint, setCurve, shapeValidity, transformRing, type Matrix } from './outline';
import { joinedAnchors } from './snap';
import { capture, withState, MAX_SCENES, FADE_RANGE } from './scenes';
import { parseTarget, reactionLinks, type Reaction } from './targets';
import type { Link, Trigger } from '../react/links';
import { isPinnable } from './homography';
import { ownCornersPinnable, pinCorners } from './placement';
/** Pin handles at the corners of the shape's box, in stage fractions. */
const boxPin = (shape: Shape): Point[] => pinCorners({ ...shape, points: shape.points.length === 4 ? [...shape.points, shape.points[0]] : shape.points, placement: { ...shape.placement, pin: null } }).map(q => ({ x: q.x / STAGE_SIZE.width, y: q.y / STAGE_SIZE.height }));
import { PRESETS, applyPreset, createLayer, createProject, readParameterDefinitions, validateProject, varyLayer } from '../core/project';
import type { Project } from '../shared/types';

/** ring: which outline of a shape a point belongs to. Missing or -1 is the shape's own outline; 0 and up are its holes. */
type RingRef = { ring?: number };

export type EditAction =
  | { type: 'addRectangle'; id: string; a: Point; b: Point; colour: string }
  /** Any new shape: rectangle, triangle, ellipse or a Pen outline. It shows the grid pattern until told otherwise. */
  | { type: 'addShape'; id: string; points: CurvePoint[]; colour: string; name?: string; fill?: 'colour' | 'grid' }
  | { type: 'addHole'; shapeId: string; points: CurvePoint[] }
  /** joined: corners of other shapes on the same spot move with this one. */
  | ({ type: 'movePoint'; shapeId: string; index: number; to: Point; joined?: boolean } & RingRef)
  | ({ type: 'nudgePoint'; shapeId: string; index: number; dxPx: number; dyPx: number; joined?: boolean } & RingRef)
  | ({ type: 'insertPoint'; shapeId: string; side: number; t: number } & RingRef)
  | ({ type: 'removePoint'; shapeId: string; index: number } & RingRef)
  | ({ type: 'setCurve'; shapeId: string; index: number; curved: boolean } & RingRef)
  | ({ type: 'moveHandle'; shapeId: string; index: number; which: 'in' | 'out'; to: Point; mirror: boolean } & RingRef)
  | { type: 'moveShape'; shapeId: string; dx: number; dy: number }   // fractions
  | { type: 'moveShapes'; shapeIds: string[]; dx: number; dy: number }
  /** Scale, turn or flip, in projector pixels. */
  | { type: 'transformShapes'; shapeIds: string[]; matrix: Matrix }
  | { type: 'rename'; shapeId: string; name: string }
  | { type: 'setColour'; shapeId: string; colour: string }
  | { type: 'setVisible'; shapeId: string; visible: boolean }
  | { type: 'setLocked'; shapeId: string; locked: boolean }
  | { type: 'delete'; shapeId: string }
  | { type: 'deleteShapes'; shapeIds: string[] }
  /** sourceId: the copy's own source, needed when the shape plays an instrument. */
  | { type: 'duplicate'; shapeId: string; id: string; sourceId?: string }
  /** ids and sourceIds line up with shapeIds. offset: where the copies go (an Alt-drag); otherwise 20 projector pixels away. */
  | { type: 'duplicateShapes'; shapeIds: string[]; ids: string[]; sourceIds: string[]; offset?: { dx: number; dy: number } }
  /** Mirrored copies across the stage's centre line: vertical mirrors left and right, horizontal top and bottom. */
  | { type: 'mirrorShapes'; shapeIds: string[]; axis: 'vertical' | 'horizontal'; ids: string[]; sourceIds: string[] }
  /** spread: the cells share the shape's own instrument, laid across the grid (Across group), so one picture runs through them all. */
  | { type: 'makeGrid'; shapeId: string; rows: number; cols: number; gapPx: number; ids: string[]; sourceIds: string[]; groupId: string; spread?: boolean }
  | { type: 'reorder'; shapeId: string; to: 'front' | 'back' | 'forward' | 'backward' }
  | { type: 'group'; shapeIds: string[]; groupId: string; name: string }
  | { type: 'ungroup'; groupId: string }
  | { type: 'renameGroup'; groupId: string; name: string }
  | { type: 'setGroupVisible'; groupId: string; visible: boolean }
  | { type: 'setGroupLocked'; groupId: string; locked: boolean }
  | { type: 'reorderGroup'; groupId: string; to: 'front' | 'back' | 'forward' | 'backward' }
  | { type: 'setBlocker'; shapeId: string; blocker: boolean }
  | { type: 'setSoftEdge'; shapeId: string; px: number }
  | { type: 'setBorder'; shapeId: string; border: Border }
  | { type: 'setPhoto'; photo: Photo | null }
  | { type: 'setPhotoOpacity'; opacity: number }
  /** What a shape plays: its own colour, or a Library preset in a new source of its own. */
  /**
   * linked (the default): when the shape shares its instrument with others, they are one instrument and all change;
   * false changes this shape only (a new look gets an instrument of its own).
   */
  | { type: 'setContent'; shapeId: string; content: ({ kind: 'colour' } | { kind: 'grid' } | { kind: 'live' } | { kind: 'preset'; presetId: string; sourceId: string; seed: number }
    | { kind: 'image'; sourceId: string; image: { name: string; dataUrl: string; width: number; height: number } }
    | { kind: 'video'; videoId: string; path: string; name: string }) & { linked?: boolean } }
  | { type: 'varySource'; sourceId: string; entropy: number }
  | { type: 'setSourcePalette'; sourceId: string; palette: string[] }
  | { type: 'setSourceSpeed'; sourceId: string; speed: number }
  | { type: 'setSourceProject'; sourceId: string; project: Project }
  /** Stage 4: where the picture sits, its pin handles, sharing an instrument, look, and the stage corners. */
  | { type: 'setPlacement'; shapeId: string; placement: Partial<Placement> }
  | { type: 'movePin'; shapeId: string; index: number; to: Point }
  | { type: 'shareSource'; shapeId: string; withShapeId: string }
  | { type: 'makeSeparate'; shapeId: string; sourceId: string }
  /** Find…: every video that played `path` plays `to` from now on. */
  | { type: 'relinkVideo'; path: string; to: string; name: string }
  /** Map's Effect tab: some of one layer's settings, each kept inside its own range. */
  | { type: 'setSourceLayer'; sourceId: string; layer: number; params: Record<string, number> }
  | { type: 'setLook'; shapeId: string; brightness?: number; tint?: string }
  | { type: 'setStageCorners'; corners: Point[] | null }
  /** Stage 5: scenes. Adding one takes in the live state; switching keeps the live scene, then brings the other back. */
  | { type: 'addScene'; sceneId: string; name: string }
  | { type: 'renameScene'; sceneId: string; name: string }
  | { type: 'deleteScene'; sceneId: string }
  /** sceneId null: the show's own fade time. seconds null (for a scene): use the show's. */
  | { type: 'setSceneFade'; sceneId: string | null; seconds: number | null }
  | { type: 'switchScene'; sceneId: string }
  /** Stage 5: what sound, the beat, tempo and MIDI drive. */
  | { type: 'addLink'; link: Link }
  | { type: 'updateLink'; linkId: string; change: Partial<Omit<Link, 'id'>> }
  | { type: 'removeLink'; linkId: string }
  /** Every link driving one setting, as one undo step (Stop reacting). */
  | { type: 'removeLinks'; target: string }
  | { type: 'addTrigger'; trigger: Trigger }
  | { type: 'updateTrigger'; triggerId: string; change: Partial<Omit<Trigger, 'id'>> }
  | { type: 'removeTrigger'; triggerId: string }
  | { type: 'addReaction'; reaction: Reaction; shapeId: string; ids: string[] }
  | { type: 'setTempoSync'; sourceId: string; beats: number | null }
  | { type: 'moveStageCorner'; index: number; to: Point };

export type EditResult = { ok: true; show: ShowDocument } | { ok: false; reason: string };

const refuse = (reason: string): EditResult => ({ ok: false, reason });

function nextName(show: ShowDocument): string {
  const names = new Set(show.shapes.map(s => s.name));
  let n = show.shapes.length + 1;
  while (names.has(`Shape ${n}`)) n++;
  return `Shape ${n}`;
}
function nextGroupName(show: ShowDocument): string {
  const names = new Set(show.groups.map(g => g.name));
  let n = show.groups.length + 1;
  while (names.has(`Group ${n}`)) n++;
  return `Group ${n}`;
}

const COPY_STEP = { x: 20 / STAGE_SIZE.width, y: 20 / STAGE_SIZE.height }; // 20 projector pixels

/** "Name copy", shortened so it stays within the name limit. */
const copyName = (name: string) => `${name.slice(0, MAX_NAME_LENGTH - ' copy'.length)} copy`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A ring copied point by point, handles included, so nothing is shared with the caller. */
const copyRing = (ring: CurvePoint[]): Ring => ring.map(p => {
  const q: CurvePoint = { ...clampToStage(p) };
  if (p.in) q.in = { x: p.in.x, y: p.in.y };
  if (p.out) q.out = { x: p.out.x, y: p.out.y };
  return q;
});
/** Every anchor of a shape, its holes included. */
const anchors = (shape: Shape): Point[] => [...shape.points, ...shape.holes.flat()];
/** A ring moved by a fraction of the stage; handles move with their points. */
const shiftRing = (ring: Ring, dx: number, dy: number): Ring => ring.map(p => ({ ...p, ...clampToStage({ x: p.x + dx, y: p.y + dy }) }));
const shiftShape = (shape: Shape, dx: number, dy: number) => {
  shape.points = shiftRing(shape.points, dx, dy); shape.holes = shape.holes.map(h => shiftRing(h, dx, dy));
  // A stored pin moves with its shape (it may reach past the stage, so it is not clamped).
  if (shape.placement.pin) shape.placement.pin = shape.placement.pin.map(p => ({ x: p.x + dx, y: p.y + dy }));
};

/** How far a set of shapes may move by (dx, dy) so no anchor leaves the stage: the whole amount, limited at the edge. */
function limitMove(shapes: Shape[], dx: number, dy: number): { dx: number; dy: number } {
  const pts = shapes.flatMap(anchors);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { dx: Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), dx)), dy: Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), dy)) };
}
/** The copy step: 20 projector pixels down and right, or up and left on an axis where that would leave the stage. */
function copyStep(shapes: Shape[]): { dx: number; dy: number } {
  const pts = shapes.flatMap(anchors);
  const step = (values: number[], size: number) => Math.max(...values) + size <= 1 ? size : Math.min(...values) - size >= 0 ? -size : 0;
  return { dx: step(pts.map(p => p.x), COPY_STEP.x), dy: step(pts.map(p => p.y), COPY_STEP.y) };
}

const VARY_STRENGTH = 0.5;
const NO_LOCKS = { palette: false, structure: false, motion: false, material: false };
const HEX = /^#[0-9a-f]{6}$/i;
const PHOTO = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const MAX_GRID_SIDE = 16;

/** Sources no shape plays any more are dropped. */
const dropUnplayed = (show: ShowDocument) => { show.sources = show.sources.filter(src => playedBy(show, src.id)); show.videos = show.videos.filter(v => playedBy(show, v.id)); };

/** A one-layer composition of a picture (Studio's image layer, cover fit), as a file would load it; null if it is not valid. */
export function imageComposition(image: { name: string; dataUrl: string; width: number; height: number }): Project | null {
  const project = createProject();
  const layer = { ...createLayer('image'), name: cleanName(image.name).slice(0, 60) || 'Image', image: { name: cleanName(image.name).slice(0, 120) || 'image', dataUrl: image.dataUrl, width: image.width, height: image.height, fit: 'cover' as const } };
  try { return validateProject({ ...project, name: layer.name, background: '#000000', layers: [layer] }); } catch { return null; }
}

/** A one-layer composition of a Library preset, in the canonical form a file would load as. */
export function presetComposition(presetId: string, seed: number): Project | null {
  const preset = PRESETS.find(p => p.id === presetId);
  if (!preset) return null;
  const project = createProject();
  const layer = applyPreset(createLayer(preset.kind), preset.id);
  layer.params.seed = seed;
  Object.assign(project, { name: preset.name, seed, layers: [layer] });
  if (preset.kind === 'scope' && preset.params.scopeMode === 1) {
    project.background = '#000000';
    project.transparent = true;
  }
  return validateProject(project);
}

/** Changes to a source itself. Refused while any shape playing it is locked. */
function stageSource(next: ShowDocument, action: Extract<EditAction, { sourceId: string; type: 'varySource' | 'setSourcePalette' | 'setSourceSpeed' | 'setSourceProject' | 'setSourceLayer' }>): Staged {
  // A video has a speed and nothing else a composition has.
  if (isVideoId(action.sourceId)) {
    const v = next.videos.findIndex(x => x.id === action.sourceId);
    if (v < 0 || action.type !== 'setSourceSpeed') return { reason: 'not-found' };
    if (next.shapes.some(s => s.sourceId === action.sourceId && isShapeLocked(next, s))) return { reason: 'locked' };
    const speed = Number.isFinite(action.speed) ? clamp(action.speed, SPEED_RANGE.min, SPEED_RANGE.max) : 1;
    next.videos = next.videos.map((x, n) => n === v ? { ...x, speed } : x);
    return { show: next, touched: [] };
  }
  const i = next.sources.findIndex(s => s.id === action.sourceId);
  if (i < 0) return { reason: 'not-found' };
  if (next.shapes.some(s => s.sourceId === action.sourceId && isShapeLocked(next, s))) return { reason: 'locked' };
  if (action.type === 'setSourceLayer') {
    const layer = next.sources[i].project.layers[action.layer];
    if (!layer || !Number.isInteger(action.layer)) return { reason: 'not-found' };
    const defs = readParameterDefinitions(layer.kind), params = { ...layer.params };
    for (const [key, raw] of Object.entries(action.params)) {
      // The seed is every layer's, not one of its definitions: a whole number, as Studio keeps it.
      if (key === 'seed') { if (!Number.isFinite(raw)) return { reason: 'bad-setting' }; params.seed = clamp(Math.round(raw), 0, 4294967295); continue; }
      const d = defs.find(x => x.key === key);
      if (!d || !Number.isFinite(raw)) return { reason: 'bad-setting' };
      const v = clamp(raw, d.min, d.max);
      params[key] = d.step >= 1 ? Math.round(v) : v;
    }
    const project = { ...next.sources[i].project, layers: next.sources[i].project.layers.map((l, n) => n === action.layer ? { ...l, params } : l) };
    next.sources[i] = { ...next.sources[i], project, revision: next.sources[i].revision + 1 };
    return { show: next, touched: [] };
  }
  const source = next.sources[i];
  // Sources are never changed in place: undo snapshots share them.
  const replace = (changes: Partial<Source>): Staged => { next.sources[i] = { ...source, ...changes }; return { show: next, touched: [] }; };
  switch (action.type) {
    case 'setSourceSpeed': {
      const speed = Number.isFinite(action.speed) ? clamp(action.speed, SPEED_RANGE.min, SPEED_RANGE.max) : 1;
      return replace({ speed }); // the composition is unchanged, so its revision stays
    }
    case 'varySource': {
      const project = structuredClone(source.project);
      project.layers = project.layers.map((layer, n) => varyLayer(layer, VARY_STRENGTH, NO_LOCKS, action.entropy + n));
      return replace({ project, revision: source.revision + 1 });
    }
    case 'setSourcePalette': {
      if (action.palette.length < 2 || action.palette.length > 8 || !action.palette.every(c => HEX.test(c))) return { reason: 'bad-palette' };
      const project = structuredClone(source.project);
      project.layers = project.layers.map(layer => ({ ...layer, palette: [...action.palette] }));
      return replace({ project, revision: source.revision + 1 });
    }
    case 'setSourceProject': {
      // Said plainly before the full check, which would only call it unreadable.
      const layers = (action.project as { layers?: unknown }).layers;
      if (Array.isArray(layers) && layers.length > MAX_SOURCE_LAYERS) return { reason: 'too-many-layers' };
      let project: Project;
      try { project = validateProject(action.project); } catch { return { reason: 'bad-composition' }; }
      if (project.layers.length > MAX_SOURCE_LAYERS) return { reason: 'too-many-layers' };
      return replace({ project, revision: source.revision + 1 });
    }
  }
}

/** The edited copy and the shapes whose outlines must be checked, or why the edit cannot be made at all. */
type Staged = { show: ShowDocument; touched: Shape[] } | { reason: string };

/**
 * Copies of shapes, each placed right after its original (so a copy stays in its original's group), with its own
 * source when the original plays one. `place` gives each copy's points.
 */
function addCopies(next: ShowDocument, originals: Shape[], ids: string[], sourceIds: (string | undefined)[], place: (shape: Shape) => Pick<Shape, 'points' | 'holes' | 'placement'>, name: (shape: Shape) => string): Staged {
  if (ids.length !== originals.length) return { reason: 'not-found' };
  if (next.shapes.length + originals.length > MAX_SHAPES) return { reason: 'too-many-shapes' };
  const taken = new Set([...next.shapes.map(s => s.id), ...next.sources.map(s => s.id)]);
  if (new Set(ids).size !== ids.length || ids.some(id => next.shapes.some(s => s.id === id))) return { reason: 'duplicate-id' };
  const copies: Shape[] = [];
  for (const [n, shape] of originals.entries()) {
    const copy: Shape = { ...structuredClone(shape), ...place(shape), id: ids[n], name: name(shape), visible: true, locked: false };
    // The copy gets its own source, so from here on its settings are its own.
    // A copy of a Live shape plays Live: there is only one.
    if (shape.sourceId !== null && shape.sourceId !== LIVE_SOURCE_ID) {
      const original = next.sources.find(s => s.id === shape.sourceId);
      const sourceId = sourceIds[n];
      if (!sourceId) return { reason: 'needs-source-id' };
      if (taken.has(sourceId)) return { reason: 'duplicate-id' };
      if (next.sources.length >= MAX_SOURCES) return { reason: 'too-many-sources' };
      taken.add(sourceId);
      if (original) { next.sources.push({ ...original, id: sourceId, revision: 0 }); copy.sourceId = sourceId; }
      else copy.sourceId = null;
    }
    // A locked group takes no new members: the copy goes just after the group, on its own.
    const group = shape.groupId === null ? undefined : next.groups.find(g => g.id === shape.groupId);
    if (group?.locked) {
      copy.groupId = null;
      let end = next.shapes.indexOf(shape);
      while (end + 1 < next.shapes.length && next.shapes[end + 1].groupId === group.id) end++;
      next.shapes.splice(end + 1, 0, copy);
    } else next.shapes.splice(next.shapes.indexOf(shape) + 1, 0, copy);
    copies.push(copy);
  }
  return { show: next, touched: copies };
}

/** The shape's placement with its stored pin (if any) moved by `move`. */
const movedPin = (shape: Shape, move: (p: Point) => Point): Placement => ({ ...shape.placement, pin: shape.placement.pin && shape.placement.pin.map(move) });

/** The list as items: an ungrouped shape, or a whole group's block of members. */
function blocks(shapes: Shape[]): Shape[][] {
  const out: Shape[][] = [];
  for (const shape of shapes) {
    const last = out[out.length - 1];
    if (shape.groupId !== null && last && last[0].groupId === shape.groupId) last.push(shape);
    else out.push([shape]);
  }
  return out;
}
/** Moves one item of a list to the front, back, one forward or one back. At the edge already, nothing moves. */
function moveItem<T>(items: T[], at: number, to: 'front' | 'back' | 'forward' | 'backward'): T[] {
  const out = [...items];
  const [item] = out.splice(at, 1);
  const index = to === 'front' ? out.length : to === 'back' ? 0 : to === 'forward' ? Math.min(out.length, at + 1) : Math.max(0, at - 1);
  out.splice(index, 0, item);
  return out;
}

const ringOf = (shape: Shape, ring: number | undefined): Ring | undefined => ring === undefined || ring < 0 ? shape.points : shape.holes[ring];
function setRing(shape: Shape, ring: number | undefined, points: Ring): void {
  if (ring === undefined || ring < 0) shape.points = points;
  else shape.holes[ring] = points;
}

/** Makes the change on a copy, without checking outlines. The input is never changed. */
function stage(show: ShowDocument, action: EditAction): Staged {
  // Shapes are copied; sources are shared and replaced, never changed in place, so a drag stays cheap
  // even when a composition holds large images. The photo is shared too.
  const next: ShowDocument = { ...show, shapes: structuredClone(show.shapes), sources: [...show.sources], groups: show.groups.map(g => ({ ...g })) };
  const find = (id: string) => next.shapes.find(s => s.id === id);
  /** Several shapes by id, in list order; a reason when any is missing or locked. */
  const many = (ids: string[], allowLocked = false): Shape[] | { reason: string } => {
    const wanted = new Set(ids);
    const found = next.shapes.filter(s => wanted.has(s.id));
    if (!ids.length || found.length !== wanted.size) return { reason: 'not-found' };
    if (!allowLocked && found.some(s => isShapeLocked(next, s))) return { reason: 'locked' };
    return found;
  };
  const done = (touched: Shape[] = []): Staged => ({ show: next, touched });

  switch (action.type) {
    case 'varySource': case 'setSourcePalette': case 'setSourceSpeed': case 'setSourceProject': case 'setSourceLayer': return stageSource(next, action);
    case 'addRectangle': return stage(show, { type: 'addShape', id: action.id, points: rectangleFromDrag(clampToStage(action.a), clampToStage(action.b)), colour: action.colour });
    case 'addShape': {
      if (next.shapes.length >= MAX_SHAPES) return { reason: 'too-many-shapes' };
      if (find(action.id)) return { reason: 'duplicate-id' };
      const name = cleanName(action.name ?? '').slice(0, MAX_NAME_LENGTH) || nextName(next);
      const shape: Shape = { id: action.id, name, points: copyRing(action.points), colour: action.colour, visible: true, locked: false, sourceId: null, ...shapeExtras(), fill: action.fill ?? 'grid' };
      next.shapes.push(shape);
      return done([shape]);
    }
    case 'setPhoto': {
      if (action.photo !== null && (typeof action.photo.data !== 'string' || action.photo.data.length > PHOTO_TEXT_LIMIT || !PHOTO.test(action.photo.data))) return { reason: 'bad-photo' };
      next.photo = action.photo && { data: action.photo.data, opacity: clamp(Number.isFinite(action.photo.opacity) ? action.photo.opacity : .5, 0, 1) };
      return done();
    }
    case 'addScene': case 'renameScene': case 'deleteScene': case 'setSceneFade': case 'switchScene': return stageScene(next, action, show);
    case 'addLink': case 'updateLink': {
      const old = action.type === 'updateLink' ? next.links.find(l => l.id === action.linkId) : undefined;
      if (action.type === 'updateLink' && !old) return { reason: 'not-found' };
      if (action.type === 'addLink' && (next.links.length >= MAX_LINKS)) return { reason: 'too-many-links' };
      if (action.type === 'addLink' && next.links.some(l => l.id === action.link.id)) return { reason: 'duplicate-id' };
      // A locked shape (or an instrument a locked shape plays) cannot be made to move.
      if (targetLocked(next, action.type === 'addLink' ? action.link.target : action.change.target ?? '')) return { reason: 'locked' };
      const link = readLink(action.type === 'addLink' ? action.link : { ...old, ...action.change, id: old!.id }, next);
      if (!link) return { reason: 'bad-target' };
      next.links = action.type === 'addLink' ? [...next.links, link] : next.links.map(l => l.id === link.id ? link : l);
      return done();
    }
    case 'removeLinks': {
      if (!next.links.some(l => l.target === action.target)) return { reason: 'not-found' };
      next.links = next.links.filter(l => l.target !== action.target);
      return done();
    }
    case 'removeLink': {
      if (!next.links.some(l => l.id === action.linkId)) return { reason: 'not-found' };
      next.links = next.links.filter(l => l.id !== action.linkId);
      return done();
    }
    case 'addTrigger': case 'updateTrigger': {
      const old = action.type === 'updateTrigger' ? next.triggers.find(t => t.id === action.triggerId) : undefined;
      if (action.type === 'updateTrigger' && !old) return { reason: 'not-found' };
      if (action.type === 'addTrigger' && next.triggers.length >= MAX_TRIGGERS) return { reason: 'too-many-triggers' };
      if (action.type === 'addTrigger' && next.triggers.some(t => t.id === action.trigger.id)) return { reason: 'duplicate-id' };
      const trigger = readTrigger(action.type === 'addTrigger' ? action.trigger : { ...old, ...action.change, id: old!.id }, next);
      if (!trigger) return { reason: 'bad-target' };
      next.triggers = action.type === 'addTrigger' ? [...next.triggers, trigger] : next.triggers.map(t => t.id === trigger.id ? trigger : t);
      return done();
    }
    case 'removeTrigger': {
      if (!next.triggers.some(t => t.id === action.triggerId)) return { reason: 'not-found' };
      next.triggers = next.triggers.filter(t => t.id !== action.triggerId);
      return done();
    }
    case 'addReaction': {
      const links = reactionLinks(next, action.reaction, action.shapeId, action.ids);
      if (typeof links === 'string') return { reason: links };
      if (next.links.length + links.length > MAX_LINKS) return { reason: 'too-many-links' };
      if (links.some(l => next.links.some(x => x.id === l.id))) return { reason: 'duplicate-id' };
      if (links.some(l => targetLocked(next, l.target))) return { reason: 'locked' };
      next.links = [...next.links, ...links];
      return done();
    }
    case 'relinkVideo': {
      if (!isVideoPath(action.to)) return { reason: 'not-a-video' };
      if (!next.videos.some(v => v.path === action.path)) return { reason: 'not-found' };
      next.videos = next.videos.map(v => v.path === action.path ? { ...v, path: action.to, name: cleanName(action.name).slice(0, 120) || v.name } : v);
      return { show: next, touched: [] };
    }
    case 'setTempoSync': {
      if (isVideoId(action.sourceId)) {
        const v = next.videos.findIndex(x => x.id === action.sourceId);
        if (v < 0) return { reason: 'not-found' };
        if (action.beats !== null && !TEMPO_SYNC_BEATS.includes(action.beats)) return { reason: 'bad-tempo' };
        if (next.shapes.some(s => s.sourceId === action.sourceId && isShapeLocked(next, s))) return { reason: 'locked' };
        next.videos = next.videos.map((x, n) => n === v ? { ...x, tempoSync: action.beats } : x);
        return { show: next, touched: [] };
      }
      const i = next.sources.findIndex(s => s.id === action.sourceId);
      if (i < 0) return { reason: 'not-found' };
      if (action.beats !== null && !TEMPO_SYNC_BEATS.includes(action.beats)) return { reason: 'bad-tempo' };
      if (next.shapes.some(s => s.sourceId === action.sourceId && isShapeLocked(next, s))) return { reason: 'locked' };
      next.sources[i] = { ...next.sources[i], tempoSync: action.beats };
      return done();
    }
    case 'setStageCorners': {
      if (action.corners === null) { next.stageCorners = null; return done(); }
      if (action.corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < -0.5 || p.x > 1.5 || p.y < -0.5 || p.y > 1.5)) return { reason: 'corners-outside' };
      const px = action.corners.map(p => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height }));
      if (action.corners.length !== 4 || !isPinnable(px).ok) return { reason: 'corners-folded' };
      next.stageCorners = action.corners.map(p => ({ x: p.x, y: p.y }));
      return done();
    }
    case 'moveStageCorner': {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > 3 || !Number.isFinite(action.to.x) || !Number.isFinite(action.to.y)) return { reason: 'not-found' };
      const corners = (next.stageCorners ?? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]).map(p => ({ ...p }));
      // A nudged projector may need a corner a little past the stage.
      corners[action.index] = { x: clamp(action.to.x, -0.5, 1.5), y: clamp(action.to.y, -0.5, 1.5) };
      if (!isPinnable(corners.map(p => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height }))).ok) return { reason: 'corners-folded' };
      next.stageCorners = corners;
      return done();
    }
    case 'setPhotoOpacity': {
      if (!next.photo) return { reason: 'not-found' };
      next.photo = { ...next.photo, opacity: clamp(Number.isFinite(action.opacity) ? action.opacity : .5, 0, 1) };
      return done();
    }
    case 'moveShapes': {
      const shapes = many(action.shapeIds);
      if ('reason' in shapes) return shapes;
      // Shift by the whole requested amount, limited so no point leaves the stage.
      const { dx, dy } = limitMove(shapes, action.dx, action.dy);
      shapes.forEach(s => shiftShape(s, dx, dy));
      return done(shapes);
    }
    case 'transformShapes': {
      const shapes = many(action.shapeIds);
      if ('reason' in shapes) return shapes;
      for (const s of shapes) {
        s.points = transformRing(s.points, action.matrix); s.holes = s.holes.map(h => transformRing(h, action.matrix));
        if (s.placement.pin) s.placement.pin = transformRing(s.placement.pin, action.matrix).map(p => ({ x: p.x, y: p.y }));
      }
      return done(shapes);
    }
    case 'deleteShapes': {
      const shapes = many(action.shapeIds);
      if ('reason' in shapes) return shapes;
      next.shapes = next.shapes.filter(s => !shapes.includes(s));
      dropUnplayed(next);
      return { show: normaliseGroups(next), touched: [] };
    }
    case 'duplicate': {
      const shape = find(action.shapeId);
      if (!shape) return { reason: 'not-found' };
      const { dx, dy } = copyStep([shape]);
      return addCopies(next, [shape], [action.id], [action.sourceId], s => ({ points: shiftRing(s.points, dx, dy), holes: s.holes.map(h => shiftRing(h, dx, dy)), placement: movedPin(s, p => ({ x: p.x + dx, y: p.y + dy })) }), s => copyName(s.name));
    }
    case 'duplicateShapes': {
      // A copy leaves the original untouched, so locked shapes can be copied; the copies start unlocked.
      const shapes = many(action.shapeIds, true);
      if ('reason' in shapes) return shapes;
      const order = shapes.map(s => action.shapeIds.indexOf(s.id));
      const { dx, dy } = action.offset ? limitMove(shapes, action.offset.dx, action.offset.dy) : copyStep(shapes);
      return addCopies(next, shapes, order.map(i => action.ids[i]), order.map(i => action.sourceIds[i]), s => ({ points: shiftRing(s.points, dx, dy), holes: s.holes.map(h => shiftRing(h, dx, dy)), placement: movedPin(s, p => ({ x: p.x + dx, y: p.y + dy })) }), s => copyName(s.name));
    }
    case 'mirrorShapes': {
      const shapes = many(action.shapeIds, true);
      if ('reason' in shapes) return shapes;
      const order = shapes.map(s => action.shapeIds.indexOf(s.id));
      const { width: W, height: H } = STAGE_SIZE;
      const m: Matrix = action.axis === 'vertical' ? [-1, 0, 0, 1, W, 0] : [1, 0, 0, -1, 0, H];
      return addCopies(next, shapes, order.map(i => action.ids[i]), order.map(i => action.sourceIds[i]), s => ({ points: transformRing(s.points, m), holes: s.holes.map(h => transformRing(h, m)), placement: movedPin(s, p => { const [q] = transformRing([p], m); return { x: q.x, y: q.y }; }) }), s => copyName(s.name));
    }
    case 'makeGrid': return stageGrid(next, action);
    case 'group': {
      const shapes = many(action.shapeIds);
      if ('reason' in shapes) return shapes;
      if (next.groups.some(g => g.id === action.groupId)) return { reason: 'duplicate-id' };
      if (next.groups.length >= MAX_GROUPS) return { reason: 'too-many-groups' };
      if (action.name.length > MAX_NAME_LENGTH) return { reason: 'name-too-long' };
      next.groups.push({ id: action.groupId, name: cleanName(action.name).trim() || nextGroupName(next), visible: true, locked: false });
      // Members come together at the place of the first of them; a shape leaves any group it was in.
      shapes.forEach(s => { s.groupId = action.groupId; });
      return { show: normaliseGroups(next), touched: [] };
    }
    case 'ungroup': case 'renameGroup': case 'setGroupVisible': case 'setGroupLocked': case 'reorderGroup': {
      const group = next.groups.find(g => g.id === action.groupId);
      if (!group) return { reason: 'not-found' };
      if (action.type === 'setGroupVisible') { group.visible = action.visible; return done(); }
      if (action.type === 'setGroupLocked') { group.locked = action.locked; return done(); }
      if (group.locked) return { reason: 'locked' };
      if (action.type === 'renameGroup') {
        if (action.name.length > MAX_NAME_LENGTH) return { reason: 'name-too-long' };
        group.name = cleanName(action.name); return done();
      }
      if (action.type === 'ungroup') {
        next.shapes.forEach(s => { if (s.groupId === group.id) s.groupId = null; });
        next.groups = next.groups.filter(g => g !== group);
        return done();
      }
      const items = blocks(next.shapes);
      const at = items.findIndex(b => b[0].groupId === group.id);
      if (at < 0) return { reason: 'not-found' };
      next.shapes = moveItem(items, at, action.to).flat();
      return done();
    }
  }

  const shape = find(action.shapeId);
  if (!shape) return { reason: 'not-found' };

  if (action.type === 'setVisible') { shape.visible = action.visible; return done(); }
  if (action.type === 'setLocked') { shape.locked = action.locked; return done(); }

  // Lock protects everything else, deleting included; a locked group locks its members.
  if (isShapeLocked(next, shape)) return { reason: 'locked' };

  switch (action.type) {
    case 'delete': next.shapes = next.shapes.filter(s => s !== shape); dropUnplayed(next); return { show: normaliseGroups(next), touched: [] };
    case 'setContent': {
      const content = action.content;
      // Shapes sharing this shape's instrument are one instrument: a change reaches them all, unless asked otherwise.
      const linked = content.linked !== false && shape.sourceId !== null ? next.shapes.filter(s => s.sourceId === shape.sourceId) : [shape];
      if (linked.some(s => isShapeLocked(next, s))) return { reason: 'locked' };
      if (content.kind === 'colour' || content.kind === 'grid') { for (const s of linked) { s.sourceId = null; s.fill = content.kind; } dropUnplayed(next); return done(); }
      // A picture of Greg's own: a one-layer image composition, stored in the show. The same picture is stored once.
      if (content.kind === 'image') {
        if (shape.blocker) return { reason: 'blocker' };
        const bytes = dataUrlBytes(content.image.dataUrl);
        if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(content.image.dataUrl)) return { reason: 'bad-image' };
        if (bytes > IMAGE_FILE_LIMIT) return { reason: 'image-too-large' };
        const same = next.sources.find(s => s.project.layers.length === 1 && s.project.layers[0].image?.dataUrl === content.image.dataUrl);
        let id = same?.id;
        if (!id) {
          if (imageBytes(next) + bytes > IMAGE_SHOW_LIMIT) return { reason: 'images-over-budget' };
          if (content.sourceId === LIVE_SOURCE_ID || isVideoId(content.sourceId) || next.sources.some(s => s.id === content.sourceId)) return { reason: 'duplicate-id' };
          const project = imageComposition(content.image);
          if (!project) return { reason: 'bad-image' };
          next.sources.push({ id: content.sourceId, kind: 'instrument', project, speed: 1, revision: 0, tempoSync: null });
          id = content.sourceId;
        }
        for (const s of linked) s.sourceId = id;
        dropUnplayed(next);
        if (next.sources.length > MAX_SOURCES) return { reason: 'too-many-sources' };
        return done();
      }
      // A video of Greg's own, left on disk: shapes name it by its id.
      if (content.kind === 'video') {
        if (shape.blocker) return { reason: 'blocker' };
        if (!isVideoPath(content.path)) return { reason: 'not-a-video' };
        if (!isVideoId(content.videoId) || next.videos.some(v => v.id === content.videoId)) return { reason: 'duplicate-id' };
        const stays = next.videos.filter(v => !linked.every(s => s.sourceId === v.id) || playedBy({ shapes: next.shapes.filter(s => !linked.includes(s)), scenes: next.scenes }, v.id));
        if (stays.length >= MAX_VIDEOS) return { reason: 'too-many-videos' };
        next.videos = [...next.videos, { id: content.videoId, path: content.path, name: cleanName(content.name).slice(0, 120), speed: 1, tempoSync: null }];
        for (const s of linked) s.sourceId = content.videoId;
        dropUnplayed(next);
        return done();
      }
      // Live: the Live screen's one look. Every linked shape plays it; it is no source of the show's.
      if (content.kind === 'live') {
        if (shape.blocker) return { reason: 'blocker' };
        if (linked.every(s => s.sourceId === LIVE_SOURCE_ID)) return { show, touched: [] };
        for (const s of linked) s.sourceId = LIVE_SOURCE_ID;
        dropUnplayed(next);
        return done();
      }
      if (linked.length > 1 && shape.sourceId !== LIVE_SOURCE_ID) {
        if (shape.blocker) return { reason: 'blocker' };
        const project = presetComposition(content.presetId, content.seed);
        if (!project) return { reason: 'unknown-preset' };
        const i = next.sources.findIndex(s => s.id === shape.sourceId);
        // The shared instrument takes the new look in place, so every linked shape plays it (and fades to it).
        next.sources[i] = { ...next.sources[i], project, revision: next.sources[i].revision + 1 };
        return done();
      }
      if (shape.blocker) return { reason: 'blocker' };
      if (content.sourceId === LIVE_SOURCE_ID || next.sources.some(s => s.id === content.sourceId)) return { reason: 'duplicate-id' };
      const project = presetComposition(content.presetId, content.seed);
      if (!project) return { reason: 'unknown-preset' };
      const old = shape.sourceId;
      // Live is no source of the show's, so leaving it frees no room.
      const oldGoes = old !== null && old !== LIVE_SOURCE_ID && !playedBy({ shapes: next.shapes.filter(s => s !== shape), scenes: next.scenes }, old);
      if (next.sources.length - (oldGoes ? 1 : 0) >= MAX_SOURCES) return { reason: 'too-many-sources' };
      next.sources.push({ id: content.sourceId, kind: 'instrument', project, speed: 1, revision: 0, tempoSync: null });
      // Several shapes on Live take the new look together, as one new instrument.
      for (const s of linked) s.sourceId = content.sourceId;
      dropUnplayed(next);
      return done();
    }
    case 'rename':
      if (action.name.length > MAX_NAME_LENGTH) return { reason: 'name-too-long' };
      shape.name = cleanName(action.name); return done();
    case 'setColour': shape.colour = action.colour; return done();
    case 'setPlacement': {
      const p = { ...shape.placement, ...action.placement };
      const finite = (v: number, fallback: number) => Number.isFinite(v) ? v : fallback;
      const placement: Placement = {
        kind: ['fit', 'pin', 'across-group', 'across-stage'].includes(p.kind) ? p.kind : 'fit',
        zoom: clamp(finite(p.zoom, 1), ZOOM_RANGE.min, ZOOM_RANGE.max),
        offset: { x: clamp(finite(p.offset?.x, 0), -1, 1), y: clamp(finite(p.offset?.y, 0), -1, 1) },
        turn: clamp(finite(p.turn, 0), -180, 180),
        pin: p.pin ? p.pin.map(q => ({ x: q.x, y: q.y })) : null,
      };
      // Choosing Pin on a shape without four points starts its handles at its box's corners; four points use their own.
      if (ownCornersPinnable(shape)) placement.pin = null;
      else if (placement.kind === 'pin' && (!placement.pin || !isPinnable(placement.pin.map(q => ({ x: q.x * STAGE_SIZE.width, y: q.y * STAGE_SIZE.height }))).ok)) placement.pin = boxPin(shape);
      shape.placement = placement;
      return done([shape]);
    }
    case 'movePin': {
      if (shape.placement.kind !== 'pin') return { reason: 'not-pinned' };
      if (!shape.placement.pin || ownCornersPinnable(shape)) return { reason: 'pin-own-corners' };
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > 3 || !Number.isFinite(action.to.x) || !Number.isFinite(action.to.y)) return { reason: 'not-found' };
      const pin = shape.placement.pin.map(q => ({ ...q }));
      pin[action.index] = { x: clamp(action.to.x, -0.5, 1.5), y: clamp(action.to.y, -0.5, 1.5) };
      shape.placement = { ...shape.placement, pin };
      return done([shape]);
    }
    case 'shareSource': {
      if (shape.blocker) return { reason: 'blocker' };
      const other = next.shapes.find(s => s.id === action.withShapeId);
      if (!other) return { reason: 'not-found' };
      if (other.sourceId === null) return { reason: 'nothing-to-share' };
      if (other.sourceId === shape.sourceId) return { show, touched: [] };
      shape.sourceId = other.sourceId;
      dropUnplayed(next);
      return done();
    }
    case 'makeSeparate': {
      // A video: this shape gets its own copy, its own player, speed and tempo loop.
      if (isVideoId(shape.sourceId)) {
        const v = next.videos.find(x => x.id === shape.sourceId)!;
        if (!next.shapes.some(s => s !== shape && s.sourceId === v.id)) return { show, touched: [] };
        const id = isVideoId(action.sourceId) ? action.sourceId : `video-${action.sourceId}`;
        if (next.videos.some(x => x.id === id)) return { reason: 'duplicate-id' };
        if (next.videos.length >= MAX_VIDEOS) return { reason: 'too-many-videos' };
        next.videos = [...next.videos, { ...v, id }];
        shape.sourceId = id;
        const from = `source.${v.id}.`, room = MAX_LINKS - next.links.length;
        next.links = [...next.links, ...next.links.filter(l => l.target.startsWith(from)).slice(0, Math.max(0, room)).map(l => ({ ...l, id: `${l.id}~${id}`.slice(0, 64), target: `source.${id}.${l.target.slice(from.length)}` }))];
        return done();
      }
      const source = shape.sourceId ? next.sources.find(src => src.id === shape.sourceId) : undefined;
      // The only player of its instrument is already separate: nothing changes.
      if (!source || !next.shapes.some(s => s !== shape && s.sourceId === source.id)) return { show, touched: [] };
      if (next.sources.some(src => src.id === action.sourceId) || next.shapes.some(s => s.id === action.sourceId)) return { reason: 'duplicate-id' };
      if (next.sources.length >= MAX_SOURCES) return { reason: 'too-many-sources' };
      next.sources.push({ ...source, id: action.sourceId, revision: 0 });
      shape.sourceId = action.sourceId;
      // The effect's reactions come with the copy, as far as the link limit allows.
      const from = `source.${source.id}.`, room = MAX_LINKS - next.links.length;
      const copies = next.links.filter(l => l.target.startsWith(from)).slice(0, Math.max(0, room))
        .map(l => ({ ...l, id: `${l.id}~${action.sourceId}`.slice(0, 64), target: `source.${action.sourceId}.${l.target.slice(from.length)}` }));
      next.links = [...next.links, ...copies.filter(c => !next.links.some(l => l.id === c.id))];
      return done();
    }
    case 'setLook': {
      if (action.tint !== undefined && !HEX.test(action.tint)) return { reason: 'bad-colour' };
      if (action.brightness !== undefined) shape.brightness = clamp(Number.isFinite(action.brightness) ? action.brightness : 1, 0, BRIGHTNESS_MAX);
      if (action.tint !== undefined) shape.tint = action.tint;
      return done();
    }
    case 'setBlocker':
      shape.blocker = action.blocker;
      if (action.blocker) { shape.sourceId = null; dropUnplayed(next); }
      return done();
    case 'setSoftEdge': shape.softEdge = clamp(Number.isFinite(action.px) ? action.px : 0, 0, SOFT_EDGE_MAX); return done();
    case 'setBorder': {
      const { width, colour, glow } = action.border;
      if (colour !== 'shape' && colour !== 'palette' && !HEX.test(colour)) return { reason: 'bad-colour' };
      shape.border = { width: clamp(Number.isFinite(width) ? width : 0, 0, BORDER_MAX), colour, glow: clamp(Number.isFinite(glow) ? glow : 0, 0, GLOW_MAX) };
      return done();
    }
    case 'reorder': {
      // Later in the list is drawn on top. A grouped shape moves within its group; an ungrouped one steps over whole groups.
      const items = blocks(next.shapes);
      if (shape.groupId !== null) {
        const b = items.find(block => block.includes(shape))!;
        const moved = moveItem(b, b.indexOf(shape), action.to);
        next.shapes = items.map(block => block === b ? moved : block).flat();
      } else next.shapes = moveItem(items, items.findIndex(block => block[0] === shape), action.to).flat();
      return done();
    }
    case 'addHole':
      shape.holes.push(copyRing(action.points));
      return done([shape]);
    case 'moveShape': {
      const { dx, dy } = limitMove([shape], action.dx, action.dy);
      shiftShape(shape, dx, dy);
      return done([shape]);
    }
    case 'movePoint': case 'nudgePoint': {
      const ring = ringOf(shape, action.ring);
      if (!ring || !Number.isInteger(action.index) || action.index < 0 || action.index >= ring.length) return { reason: 'not-found' };
      const from = ring[action.index];
      const to = action.type === 'movePoint' ? clampToStage(action.to) : nudge(from, action.dxPx, action.dyPx);
      const touched = [shape];
      // Joined corners: every unlocked corner of another shape on the same spot moves by the same amount.
      if (action.joined) for (const j of joinedAnchors(show, shape.id, from)) {
        const other = find(j.shapeId)!;
        if (isShapeLocked(next, other)) continue;
        const otherRing = ringOf(other, j.ring)!;
        const p = otherRing[j.index];
        // Corners exactly on the same spot land exactly on the new one; nearly there, they keep their tiny offset.
        const same = p.x === from.x && p.y === from.y;
        otherRing[j.index] = { ...p, ...(same ? to : clampToStage({ x: p.x + to.x - from.x, y: p.y + to.y - from.y })) };
        if (!touched.includes(other)) touched.push(other);
      }
      ring[action.index] = { ...from, ...to };
      return done(touched);
    }
    case 'insertPoint': case 'removePoint': case 'setCurve': case 'moveHandle': {
      const ring = ringOf(shape, action.ring);
      if (!ring) return { reason: 'not-found' };
      const index = action.type === 'insertPoint' ? action.side : action.index;
      if (!Number.isInteger(index) || index < 0 || index >= ring.length) return { reason: 'not-found' };
      if (action.type === 'insertPoint') setRing(shape, action.ring, insertPoint(ring, index, clamp(action.t, 0, 1)));
      else if (action.type === 'setCurve') setRing(shape, action.ring, setCurve(ring, index, action.curved));
      else if (action.type === 'moveHandle') setRing(shape, action.ring, moveHandle(ring, index, action.which, action.to, action.mirror));
      // A hole that would be left with fewer than three points goes away whole; an outline cannot.
      else if (action.ring !== undefined && action.ring >= 0 && ring.length <= 3) shape.holes.splice(action.ring, 1);
      else setRing(shape, action.ring, removePoint(ring, index));
      return done([shape]);
    }
  }
}

/** The cells replace the shape, in a new group named after it (or its own group), each with its own copy of its instrument. */
function stageGrid(next: ShowDocument, action: Extract<EditAction, { type: 'makeGrid' }>): Staged {
  const shape = next.shapes.find(s => s.id === action.shapeId);
  if (!shape) return { reason: 'not-found' };
  if (isShapeLocked(next, shape)) return { reason: 'locked' };
  const { rows, cols } = action;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > MAX_GRID_SIDE || cols > MAX_GRID_SIDE || rows * cols < 2) return { reason: 'bad-grid' };
  if (shape.points.length !== 4 || shape.points.some(isCurved) || shape.holes.length) return { reason: 'not-four-corners' };
  const count = rows * cols;
  if (action.ids.length !== count || new Set(action.ids).size !== count) return { reason: 'bad-grid' };
  if (next.shapes.length - 1 + count > MAX_SHAPES) return { reason: 'too-many-shapes' };
  const taken = new Set([...next.shapes.filter(s => s !== shape).map(s => s.id), ...next.sources.map(s => s.id)]);
  if (action.ids.some(id => taken.has(id))) return { reason: 'duplicate-id' };
  const source = shape.sourceId ? next.sources.find(s => s.id === shape.sourceId) : undefined;
  if (source && !action.spread) {
    if (action.sourceIds.length !== count || new Set(action.sourceIds).size !== count || action.sourceIds.some(id => taken.has(id) || action.ids.includes(id))) return { reason: 'duplicate-id' };
    const sharedElsewhere = playedBy({ shapes: next.shapes.filter(s => s !== shape), scenes: next.scenes }, source.id);
    if (next.sources.length - (sharedElsewhere ? 0 : 1) + count > MAX_SOURCES) return { reason: 'too-many-sources' };
  }
  let groupId = shape.groupId;
  if (groupId === null) {
    if (next.groups.some(g => g.id === action.groupId)) return { reason: 'duplicate-id' };
    if (next.groups.length >= MAX_GROUPS) return { reason: 'too-many-groups' };
    next.groups.push({ id: action.groupId, name: shape.name, visible: true, locked: false });
    groupId = action.groupId;
  }
  const cells = gridCells(shape.points, rows, cols, Math.max(0, Number.isFinite(action.gapPx) ? action.gapPx : 0));
  if (!cells) return { reason: 'collapsed' };
  const base = shape.name.slice(0, MAX_NAME_LENGTH - String(count).length - 1);
  const made: Shape[] = cells.map((points, k) => ({
    ...structuredClone(shape), id: action.ids[k], name: `${base} ${k + 1}`, points, holes: [], groupId, locked: false, visible: true,
    placement: { ...shape.placement, pin: null },
    sourceId: shape.sourceId === LIVE_SOURCE_ID ? LIVE_SOURCE_ID : source ? (action.spread ? source.id : action.sourceIds[k]) : null,
    ...(action.spread ? { placement: { ...shape.placement, kind: 'across-group' as const, pin: null } } : {}),
  }));
  if (source && !action.spread) next.sources.push(...action.sourceIds.map(id => ({ ...source, id, revision: 0 })));
  next.shapes.splice(next.shapes.indexOf(shape), 1, ...made);
  dropUnplayed(next);
  return { show: normaliseGroups(next), touched: made };
}

/**
 * A shape brought back by a scene keeps its Pin only if its corners can carry the picture now (its outline may have been
 * edited since): four corners that cannot get handles at the box, and failing that it plays Fit.
 */
function pinnable(shape: Shape): Shape {
  if (shape.placement.kind !== 'pin' || isPinnable(pinCorners(shape)).ok) return shape;
  const boxed: Shape = { ...shape, placement: { ...shape.placement, pin: boxPin(shape) } };
  return isPinnable(pinCorners(boxed)).ok ? boxed : { ...shape, placement: { ...shape.placement, kind: 'fit' } };
}

/** Scene edits. The shapes on screen are the live scene, so it is written back before another is brought in. */
function stageScene(next: ShowDocument, action: Extract<EditAction, { type: 'addScene' | 'renameScene' | 'deleteScene' | 'setSceneFade' | 'switchScene' }>, original: ShowDocument): Staged {
  const keepLive = () => { if (next.sceneId) next.scenes = next.scenes.map(sc => sc.id === next.sceneId ? { ...sc, shapes: capture(next.shapes) } : sc); };
  if (action.type === 'setSceneFade' && action.sceneId === null) {
    if (action.seconds === null || !Number.isFinite(action.seconds)) return { reason: 'bad-fade' };
    const fade = clamp(action.seconds, FADE_RANGE.min, FADE_RANGE.max);
    if (fade === original.sceneFade) return { show: original, touched: [] };
    next.sceneFade = fade;
    return { show: next, touched: [] };
  }
  if (action.type === 'addScene') {
    if (next.scenes.length >= MAX_SCENES) return { reason: 'too-many-scenes' };
    if (next.scenes.some(s => s.id === action.sceneId)) return { reason: 'duplicate-id' };
    keepLive();
    const name = cleanName(action.name).trim().slice(0, MAX_NAME_LENGTH) || `Scene ${next.scenes.length + 1}`;
    next.scenes = [...next.scenes, { id: action.sceneId, name, fadeSeconds: null, shapes: capture(next.shapes) }];
    next.sceneId = action.sceneId;
    return { show: next, touched: [] };
  }
  const scene = next.scenes.find(s => s.id === action.sceneId);
  if (!scene) return { reason: 'not-found' };
  switch (action.type) {
    case 'renameScene': {
      const name = cleanName(action.name).trim();
      if (!name || name.length > MAX_NAME_LENGTH) return { reason: 'name-too-long' };
      if (name === scene.name) return { show: original, touched: [] };
      next.scenes = next.scenes.map(s => s === scene ? { ...s, name } : s);
      return { show: next, touched: [] };
    }
    case 'setSceneFade': {
      const fadeSeconds = action.seconds === null || !Number.isFinite(action.seconds) ? null : clamp(action.seconds, FADE_RANGE.min, FADE_RANGE.max);
      if (fadeSeconds === scene.fadeSeconds) return { show: original, touched: [] };
      next.scenes = next.scenes.map(s => s === scene ? { ...s, fadeSeconds } : s);
      return { show: next, touched: [] };
    }
    case 'deleteScene':
      // The live scene going leaves the shapes as they are, with no scene live.
      next.scenes = next.scenes.filter(s => s !== scene);
      if (next.sceneId === scene.id) next.sceneId = null;
      dropUnplayed(next);
      return { show: next, touched: [] };
    case 'switchScene': {
      if (next.sceneId === scene.id) return { show: original, touched: [] };
      keepLive();
      const target = next.scenes.find(s => s.id === scene.id)!;
      // A locked shape keeps its state; a shape the scene has never seen keeps its own.
      next.shapes = next.shapes.map(sh => isShapeLocked(next, sh) ? sh : pinnable(withState(sh, target.shapes[sh.id])));
      for (const sh of next.shapes) if (sh.sourceId !== null && sh.sourceId !== LIVE_SOURCE_ID && !next.sources.some(src => src.id === sh.sourceId) && !next.videos.some(v => v.id === sh.sourceId)) sh.sourceId = null;
      next.sceneId = scene.id;
      return { show: next, touched: [] };
    }
  }
}

/**
 * After every edit: scenes forget shapes that have gone, and links and triggers that name something gone are dropped.
 * The same show comes back when nothing needed tidying.
 */
/** True when the target is a locked shape, or an instrument a locked shape plays. */
function targetLocked(show: ShowDocument, target: string): boolean {
  const t = parseTarget(target);
  if (!t) return false;
  return t.kind === 'shape' ? show.shapes.some(s => s.id === t.shapeId && isShapeLocked(show, s)) : show.shapes.some(s => s.sourceId === t.sourceId && isShapeLocked(show, s));
}

function tidy(show: ShowDocument): ShowDocument {
  const ids = new Set(show.shapes.map(s => s.id));
  const scenesOk = show.scenes.every(sc => Object.keys(sc.shapes).every(id => ids.has(id)));
  const scenes = scenesOk ? show.scenes : show.scenes.map(sc => ({ ...sc, shapes: Object.fromEntries(Object.entries(sc.shapes).filter(([id]) => ids.has(id))) }));
  const base = scenesOk ? show : { ...show, scenes };
  const sources = base.sources.filter(src => playedBy(base, src.id)), videos = base.videos.filter(v => playedBy(base, v.id));
  const withSources = sources.length === base.sources.length && videos.length === base.videos.length ? base : { ...base, sources, videos };
  const links = withSources.links.filter(l => readLink(l, withSources));
  // A trigger whose scene or instrument has gone is kept, switched off and set to Next scene, for the operator to see.
  let changedTriggers = false;
  const triggers = withSources.triggers.flatMap(t => {
    if (readTrigger(t, withSources)) return [t];
    const kept = readTrigger({ ...t, action: { kind: 'next-scene' }, on: false }, withSources);
    changedTriggers = true;
    return kept ? [kept] : [];
  });
  if (links.length === withSources.links.length && !changedTriggers) return withSources;
  return { ...withSources, links, triggers };
}

/** A pinned shape's four corners must be able to carry its picture: convex and not flat. */
function pinValidity(shape: Shape): { ok: true } | { ok: false; reason: string } {
  if (shape.placement.kind !== 'pin') return { ok: true };
  return isPinnable(pinCorners(shape));
}

/** Applies one action to a copy of the show. The input is never changed. */
export function applyEdit(show: ShowDocument, action: EditAction): EditResult {
  const staged = stage(show, action);
  if ('reason' in staged) return refuse(staged.reason);
  for (const shape of staged.touched) {
    // A pinned shape uses its own corners while it has four points; gaining or losing one gives it pin handles at its box, or takes them away.
    if (shape.placement.kind === 'pin') {
      const before = show.shapes.find(s => s.id === shape.id);
      if (ownCornersPinnable(shape)) shape.placement = { ...shape.placement, pin: null };
      // Folding the four corners a shape was pinned by is refused, in red; any other change of points gives it handles at its box.
      else if (shape.points.length === 4 && before && before.points.length === 4 && before.placement.kind === 'pin' && ownCornersPinnable(before)) return refuse('pin-folded');
      else if (!shape.placement.pin) shape.placement = { ...shape.placement, pin: boxPin(shape) };
    }
    const valid = shapeValidity(shape.points, shape.holes);
    if (!valid.ok) return refuse(valid.reason);
    // A stored pin may reach half a stage past the edge, as the show file keeps it, never further.
    if (shape.placement.pin?.some(q => q.x < -0.5 || q.x > 1.5 || q.y < -0.5 || q.y > 1.5)) return refuse('pin-outside');
    const pin = pinValidity(shape);
    if (!pin.ok) return refuse(pin.reason);
  }
  return { ok: true, show: staged.show === show ? show : tidy(staged.show) };
}

/**
 * The show an edit would leave, even when an outline would be refused, so the operator screen can draw the refused
 * outlines in red. Null when the edit is refused for any other reason, or changes no outline.
 */
export function attemptEdit(show: ShowDocument, action: EditAction): { show: ShowDocument; shapeId: string; shapeIds: string[] } | null {
  const staged = stage(show, action);
  if ('reason' in staged || !staged.touched.length) return null;
  return { show: staged.show, shapeId: staged.touched[0].id, shapeIds: staged.touched.map(s => s.id) };
}
