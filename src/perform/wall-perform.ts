/** Perform on the wall: the pure rules for when a launch lands. The compositor draws the result. Never edits the saved show. */
import type { MapMessage } from '../map/messages';
import type { ZonePicture } from './resolve';
import type { BlendKind } from './types';

export interface WallChange { zone: number; sourceId: string | null; shapeIds: string[]; blend: { kind: BlendKind; durationMs: number }; phaseOffsetBeats: number }
export interface WallLaunch { id: string; atMs: number; barMs: number; changes: WallChange[] }
export interface PerformValues { master: number; zones: { brightness: number; hueDeg: number; speed: number }[] }
export interface WallPerform { active: boolean; zones: ZonePicture[]; armed: string[]; launches: WallLaunch[]; values: PerformValues | null; phaseOffsets: Record<string, number> }

export const initialWallPerform = (): WallPerform => ({ active: false, zones: [], armed: [], launches: [], values: null, phaseOffsets: {} });

/** The next Perform state for a message. Until a show starts, only performStart does anything, so a late message cannot wake the overlay. */
export function applyPerformMessage(p: WallPerform, m: MapMessage): WallPerform {
  if (m.type === 'performStart') return { ...initialWallPerform(), active: true, zones: m.zones };
  if (!p.active) return p;
  switch (m.type) {
    case 'performEnd': return initialWallPerform();
    case 'performArm': return { ...p, armed: m.sourceIds };
    // A launch with a known id replaces it and counts as the newest press.
    case 'performLaunch': return { ...p, launches: [...p.launches.filter(l => l.id !== m.launch.id), m.launch] };
    case 'performCancel': return p.launches.some(l => l.id === m.launchId) ? { ...p, launches: p.launches.filter(l => l.id !== m.launchId) } : p;
    case 'performValues': return { ...p, values: m.values };
    default: return p;
  }
}

/** The first bar line after now on this launch's own grid, however long the wall stalled. */
const nextBar = (l: WallLaunch, nowMs: number) => l.atMs + (Math.floor((nowMs - l.atMs) / l.barMs) + 1) * l.barMs;

/**
 * Lands whatever is due. A source that is not ready waits a bar without holding up the other zones. `changed` means the
 * picture changed; a launch with nothing to change is still reported, so the launcher can move on.
 */
export function stepWallPerform(p: WallPerform, nowMs: number, ready: (sourceId: string) => boolean): { perform: WallPerform; changed: boolean; landed: { launchId: string; zones: number[] }[]; blends: Map<string, { kind: BlendKind; durationMs: number }> } {
  const landed: { launchId: string; zones: number[] }[] = [];
  const blends = new Map<string, { kind: BlendKind; durationMs: number }>();
  const due = p.active ? p.launches.filter(l => l.atMs <= nowMs).sort((a, b) => a.atMs - b.atMs) : [];
  if (due.length === 0) return { perform: p, changed: false, landed, blends };

  const zones = [...p.zones];
  let queue = [...p.launches];
  let offsets = p.phaseOffsets;
  let changed = false;
  for (const { id } of due) {
    const index = queue.findIndex(l => l.id === id);
    const launch = queue[index];
    const landing = launch.changes.filter(c => c.sourceId === null || ready(c.sourceId));
    const waiting = launch.changes.filter(c => !landing.includes(c));
    for (const c of landing) {
      zones[c.zone] = { shapeIds: c.shapeIds, sourceId: c.sourceId, launched: true };
      for (const shapeId of c.shapeIds) blends.set(shapeId, c.blend);
      // A computed key, so a source id such as __proto__ stays an ordinary entry.
      if (c.sourceId !== null) offsets = { ...offsets, [c.sourceId]: c.phaseOffsetBeats };
      changed = true;
    }
    if (landing.length > 0 || launch.changes.length === 0) landed.push({ launchId: id, zones: landing.map(c => c.zone) });
    const rest = waiting.length > 0 ? [{ ...launch, atMs: nextBar(launch, nowMs), changes: waiting }] : [];
    // Older presses still waiting on a zone that just landed are out of date. Their launch stays, so it is still reported.
    const older = queue.slice(0, index).map(l => l.changes.some(c => landing.some(n => n.zone === c.zone))
      ? { ...l, changes: l.changes.filter(c => !landing.some(n => n.zone === c.zone)) } : l);
    queue = [...older, ...rest, ...queue.slice(index + 1)];
  }

  // Only the sources still on the wall keep a phase offset.
  const playing = new Set(zones.map(z => z.sourceId));
  const phaseOffsets = Object.fromEntries(Object.entries(offsets).filter(([id]) => playing.has(id)));
  return { perform: { ...p, zones, launches: queue, phaseOffsets }, changed, landed, blends };
}
