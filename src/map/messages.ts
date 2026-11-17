import type { Point, ShowDocument } from './show';

export type MapMessage =
  | { type: 'show'; show: ShowDocument }
  | { type: 'blackout'; on: boolean }
  | { type: 'testGrid'; on: boolean }
  | { type: 'identify'; shapeId: string | null }
  | { type: 'crosshair'; point: Point | null; shapeId: string | null };

export const MAP_MESSAGE_LIMIT = 16 * 1024;

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const small = (value: unknown): boolean => { try { const text = JSON.stringify(value); return typeof text === 'string' && text.length < MAP_MESSAGE_LIMIT; } catch { return false; } };
const idOrNull = (value: unknown) => value === null || typeof value === 'string';

/** Checks the envelope and size only. The show's geometry is validateShow's job. */
export function acceptMapMessage(value: unknown): value is MapMessage {
  if (!plain(value) || !small(value)) return false;
  switch (value.type) {
    case 'show': return plain(value.show);
    case 'blackout':
    case 'testGrid': return typeof value.on === 'boolean';
    case 'identify': return idOrNull(value.shapeId);
    case 'crosshair': return idOrNull(value.shapeId) && (value.point === null || (plain(value.point) && typeof value.point.x === 'number' && typeof value.point.y === 'number'));
    default: return false;
  }
}
