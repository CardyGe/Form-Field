import type { Project } from '../shared/types';
import type { Point, ShowDocument, WireShow } from './show';

export type MapMessage =
  | { type: 'show'; show: WireShow }
  /** One source's composition, sent once per revision. */
  | { type: 'source'; id: string; revision: number; project: Project }
  | { type: 'blackout'; on: boolean }
  | { type: 'testGrid'; on: boolean }
  | { type: 'freeze'; on: boolean }
  | { type: 'identify'; shapeId: string | null }
  | { type: 'crosshair'; point: Point | null; shapeId: string | null };

/**
 * Map's own limit, larger than Live's 16 KB settings cap: the largest valid show (64 shapes of 32 corners,
 * names and ids at their limits) is about 110 KB, so a valid show is never refused. Tested.
 */
export const MAP_MESSAGE_LIMIT = 256 * 1024;
/** A composition can hold images of up to 20 MB (Studio's MAX_ASSET_BYTES), so its message has its own limit. */
export const SOURCE_MESSAGE_LIMIT = 24 * 1024 * 1024;

/** Four decimal places of a stage fraction: 0.2 projector pixels at 1920 wide. */
const WIRE_PLACES = 1e4;
const roundForWire = (value: number) => Math.round(value * WIRE_PLACES) / WIRE_PLACES;

/**
 * The show as sent to the wall: corners rounded to four decimal places, which keeps each message small, and the
 * sources without their compositions (those travel once per revision, see sourcesToSend).
 * Used on the send path only; the show the editor holds and saves keeps full precision.
 */
export function toWire(show: ShowDocument): WireShow {
  return {
    format: show.format, version: show.version, stage: show.stage,
    shapes: show.shapes.map(shape => ({ ...shape, points: shape.points.map(p => ({ x: roundForWire(p.x), y: roundForWire(p.y) })) })),
    sources: show.sources.map(({ id, kind, speed, revision }) => ({ id, kind, speed, revision })),
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
    default: return false;
  }
}
