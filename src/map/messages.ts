import type { Project } from '../shared/types';
import type { CurvePoint, Point, ShowDocument, WireShow } from './show';
import { shapeValidity } from './outline';
import { acceptSignals, type Signals } from '../react/signals';
import { ownCornersPinnable } from './placement';

export type MapMessage =
  | { type: 'show'; show: WireShow }
  /** One source's composition, sent once per revision. */
  | { type: 'source'; id: string; revision: number; project: Project }
  | { type: 'blackout'; on: boolean }
  | { type: 'testGrid'; on: boolean }
  | { type: 'freeze'; on: boolean }
  | { type: 'identify'; shapeId: string | null }
  | { type: 'crosshair'; point: Point | null; shapeId: string | null }
  /** Only these shapes reach the wall; none means no solo. Not saved. */
  | { type: 'solo'; ids: string[] }
  /** What sound, the beat, tempo and MIDI are doing, once a frame while something reacts. */
  | { type: 'signals'; signals: Signals }
  /** The next show change is a scene switch: its crossfade takes this long. */
  | { type: 'fade'; ms: number };

/**
 * Map's own limit, larger than Live's 16 KB settings cap: the largest valid show (64 shapes of 32 curve points with
 * both handles, names, ids and groups at their limits) is about 360 KB at full precision, so a valid show is never
 * refused. Tested.
 */
export const MAP_MESSAGE_LIMIT = 512 * 1024;
/** A frame of signals is small; anything larger is refused. */
export const SIGNALS_LIMIT = 16 * 1024;
/**
 * A composition can hold up to four layers, each with an image and a mask of up to 20 MB (Studio's MAX_ASSET_BYTES),
 * stored as text about a third larger: so its message has its own, much larger limit.
 */
export const SOURCE_MESSAGE_LIMIT = 256 * 1024 * 1024;

/** Four decimal places of a stage fraction: 0.2 projector pixels at 1920 wide. */
const WIRE_PLACES = 1e4;
const roundForWire = (value: number) => Math.round(value * WIRE_PLACES) / WIRE_PLACES;
const roundPoint = (p: CurvePoint): CurvePoint => {
  const q: CurvePoint = { x: roundForWire(p.x), y: roundForWire(p.y) };
  if (p.in) q.in = { x: roundForWire(p.in.x), y: roundForWire(p.in.y) };
  if (p.out) q.out = { x: roundForWire(p.out.x), y: roundForWire(p.out.y) };
  return q;
};

/**
 * The show as sent to the wall: corners rounded to four decimal places, which keeps each message small, and the
 * sources without their compositions (those travel once per revision, see sourcesToSend).
 * Used on the send path only; the show the editor holds and saves keeps full precision.
 */
export function toWire(show: ShowDocument): WireShow {
  return {
    format: show.format, version: show.version, stage: show.stage,
    shapes: show.shapes.map(shape => {
      const rounded = { ...shape, points: shape.points.map(roundPoint), holes: shape.holes.map(h => h.map(roundPoint)) };
      // Rounding moves points by up to 0.1 projector pixels; a shape that would then touch itself goes as it is.
      return shapeValidity(rounded.points, rounded.holes).ok && ownCornersPinnable(rounded) === ownCornersPinnable(shape) ? rounded : shape;
    }),
    sources: show.sources.map(({ id, kind, speed, revision, tempoSync }) => ({ id, kind, speed, revision, tempoSync })),
    links: show.links,
    groups: show.groups,
    // Not rounded: a pinnable quad at the edge of the rules could round to one that is not.
    stageCorners: show.stageCorners,
  };
}

/**
 * The composition messages an output still needs, given the revisions it has already been sent.
 * Pure: returns the record to keep. A new output starts from an empty record, so it is sent everything.
 */
export function sourcesToSend(show: ShowDocument, sent: ReadonlyMap<string, number>): { messages: MapMessage[]; sent: Map<string, number> } {
  const messages: MapMessage[] = [];
  const next = new Map<string, number>();
  for (const source of show.sources) {
    if (sent.get(source.id) !== source.revision) messages.push({ type: 'source', id: source.id, revision: source.revision, project: source.project });
    next.set(source.id, source.revision);
  }
  return { messages, sent: next };
}

// A copy of this check runs in the main process (electron/map.cjs); tests/map-messages.test.ts keeps the two in step.
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const within = (value: unknown, limit: number): boolean => { try { const text = JSON.stringify(value); return typeof text === 'string' && text.length < limit; } catch { return false; } };
const idOrNull = (value: unknown) => value === null || typeof value === 'string';
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/** Checks the envelope and size only. The show's geometry and a composition's contents are checked where they are used. */
export function acceptMapMessage(value: unknown): value is MapMessage {
  if (!plain(value)) return false;
  if (!within(value, value.type === 'source' ? SOURCE_MESSAGE_LIMIT : MAP_MESSAGE_LIMIT)) return false;
  switch (value.type) {
    case 'show': return plain(value.show);
    case 'source': return typeof value.id === 'string' && value.id !== '' && Number.isInteger(value.revision) && (value.revision as number) >= 0 && plain(value.project);
    case 'blackout':
    case 'testGrid':
    case 'freeze': return typeof value.on === 'boolean';
    case 'identify': return idOrNull(value.shapeId);
    case 'crosshair': return idOrNull(value.shapeId) && (value.point === null || (plain(value.point) && finite(value.point.x) && finite(value.point.y)));
    case 'solo': return Array.isArray(value.ids) && value.ids.every(id => typeof id === 'string');
    case 'signals': return within(value, SIGNALS_LIMIT) && acceptSignals(value.signals);
    case 'fade': return finite(value.ms) && (value.ms as number) >= 0 && (value.ms as number) <= 30000;
    default: return false;
  }
}
