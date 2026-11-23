/** Editing the Perform grid. Pure: each function returns a new set, and a clip still playing or queued is never dropped. */
import { MAX_PERFORM_SCENES, ZONE_COUNT, type Clip, type PerformanceSet, type Zone } from './types';

/** Clips no cell names are dropped, unless the running show still needs them. */
export function dropUnusedClips(set: PerformanceSet, keep: readonly string[] = []): PerformanceSet {
  const used = new Set([...keep, ...set.scenes.flatMap(s => s.cells).filter((c): c is string => c !== null)]);
  return { ...set, clips: set.clips.filter(c => used.has(c.id)) };
}

export function addRow(set: PerformanceSet, id: string): PerformanceSet {
  if (set.scenes.length >= MAX_PERFORM_SCENES) return set;
  return { ...set, scenes: [...set.scenes, { id, name: `Scene ${set.scenes.length + 1}`, cells: Array(ZONE_COUNT).fill(null), includeProtected: false, follow: null }] };
}

export function removeRow(set: PerformanceSet, row: number, keep: readonly string[] = []): PerformanceSet {
  const gone = set.scenes[row]?.id;
  // A scene that followed the removed row has nowhere to go.
  const scenes = set.scenes.filter((_, i) => i !== row).map(s => s.follow?.to === gone ? { ...s, follow: null } : s);
  return dropUnusedClips({ ...set, scenes }, keep);
}

export function changeRow(set: PerformanceSet, row: number, change: { name?: string; includeProtected?: boolean }): PerformanceSet {
  return { ...set, scenes: set.scenes.map((s, i) => i === row ? { ...s, ...change } : s) };
}

/** Puts a clip already in the set into a cell (a link), or empties the cell with null. */
export function setCell(set: PerformanceSet, row: number, zone: number, clipId: string | null, keep: readonly string[] = []): PerformanceSet {
  const scenes = set.scenes.map((s, i) => i === row ? { ...s, cells: s.cells.map((c, z) => z === zone ? clipId : c) } : s);
  return dropUnusedClips({ ...set, scenes }, keep);
}

/** A new clip, placed in a cell. */
export function placeClip(set: PerformanceSet, row: number, zone: number, clip: Clip, keep: readonly string[] = []): PerformanceSet {
  return setCell({ ...set, clips: [...set.clips, clip] }, row, zone, clip.id, keep);
}

export function changeClip(set: PerformanceSet, clipId: string, change: Partial<Pick<Clip, 'blend' | 'audioBand' | 'name'>>): PerformanceSet {
  return { ...set, clips: set.clips.map(c => c.id === clipId ? { ...c, ...change } : c) };
}

export function assignZone(set: PerformanceSet, zone: number, target: Zone['target'], name?: string): PerformanceSet {
  return { ...set, zones: set.zones.map((z, i) => i === zone ? { ...z, target, name: name ?? z.name } : z) };
}

/** Zones offered from Map's groups in order. A group called Ceiling goes to the last strip. */
export function zonesFromGroups(set: PerformanceSet, groups: readonly { id: string; name: string }[]): PerformanceSet {
  const isCeiling = (g: { name: string }) => g.name.trim().toLowerCase() === 'ceiling';
  const ceiling = groups.find(isCeiling), room = groups.filter(g => !isCeiling(g)).slice(0, ZONE_COUNT - 1);
  const zones = set.zones.map((z, i) => {
    const g = i === ZONE_COUNT - 1 ? ceiling : room[i];
    return g ? { ...z, name: g.name, target: { kind: 'group' as const, id: g.id } } : z;
  });
  return { ...set, zones };
}
