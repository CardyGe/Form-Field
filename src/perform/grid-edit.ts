/** Editing the Perform grid. Pure: each function returns a new set, and a clip still playing or queued is never dropped. */
import { playedBy, type ShowDocument } from '../map/show';
import { MAX_PERFORM_SCENES, ZONE_COUNT, type Clip, type PerformanceSet, type Zone } from './types';

/**
 * The show as a file must hold it: without clips kept only because a running show was still playing them, or their
 * sources. The same show comes back when there are none.
 */
export function savedShow(show: ShowDocument): ShowDocument {
  const performance = dropUnusedClips(show.performance);
  if (performance.clips.length === show.performance.clips.length) return show;
  const next = { ...show, performance };
  return { ...next, sources: next.sources.filter(s => playedBy(next, s.id)), videos: next.videos.filter(v => playedBy(next, v.id)) };
}

export type HistoryBlock = 'scenes' | 'layout' | 'picture' | 'playing';
const sceneBar = (s: ShowDocument) => JSON.stringify([s.sceneId, s.sceneFade, s.autoAdvance ?? null, s.scenes.map(sc => [sc.id, sc.name, sc.fadeSeconds])]);
const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether a running show must refuse an undo or redo from `now` to `target`. Only a change to the Perform set may pass:
 * anything else would reach the wall. Sources and videos may come and go only with clips the show is not using.
 */
export function historyBlock(now: ShowDocument, target: ShowDocument, inUse: readonly string[]): HistoryBlock | null {
  if (sceneBar(now) !== sceneBar(target)) return 'scenes';
  const keys = new Set([...Object.keys(now), ...Object.keys(target)] as (keyof ShowDocument)[]);
  for (const key of ['performance', 'sources', 'videos'] as const) keys.delete(key);
  for (const key of keys) if (!sameValue(now[key], target[key])) return 'picture';
  for (const s of now.sources) {
    const t = target.sources.find(x => x.id === s.id);
    if (t && t !== s && (t.project !== s.project || t.revision !== s.revision || t.speed !== s.speed || t.tempoSync !== s.tempoSync)) return 'picture';
  }
  for (const v of now.videos) {
    const t = target.videos.find(x => x.id === v.id);
    if (t && !sameValue(t, v)) return 'picture';
  }
  // The launcher counts rows by position, and the wall was told each zone's shapes.
  const layout = (s: ShowDocument) => JSON.stringify([s.performance.zones, s.performance.scenes.map(sc => sc.id)]);
  if (layout(now) !== layout(target)) return 'layout';
  const source = (s: ShowDocument, id: string) => s.performance.clips.find(c => c.id === id)?.sourceId;
  return inUse.some(id => source(target, id) !== source(now, id)) ? 'playing' : null;
}

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
