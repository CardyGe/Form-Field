/** Perform: Import Map scenes. A one-time copy: one row per Map scene from what each zone's first shape plays. Pure; Map is untouched. */
import { LIVE_SOURCE_ID, type ShowDocument } from '../map/show';
import { capture, type SceneState } from '../map/scenes';
import { zoneShapes } from './resolve';
import { MAX_PERFORM_SCENES, ZONE_COUNT, type Clip, type PerformanceSet, type Scene } from './types';

/**
 * The set with Map's scenes added after any rows it already has, up to 16. Clips reuse sources already in the show,
 * so the 64-source limit cannot be passed, and a look shared by several zones or scenes shares one clip.
 * `id` gives each new row and clip its id.
 */
export function importMapScenes(show: ShowDocument, id: () => string): PerformanceSet {
  const set = show.performance;
  const room = MAX_PERFORM_SCENES - set.scenes.length;
  const firsts = zoneShapes(set.zones, show.shapes).map(ids => ids[0] ?? null);
  if (room <= 0 || show.scenes.length === 0 || firsts.every(f => f === null)) return set;

  const known = new Set([LIVE_SOURCE_ID, ...show.sources.map(s => s.id), ...show.videos.map(v => v.id)]);
  const clips: Clip[] = [...set.clips];
  const clipFor = (sourceId: string, name: string): string => {
    const have = clips.find(c => c.sourceId === sourceId);
    if (have) return have.id;
    const clip: Clip = { id: id(), name: name.slice(0, 40), sourceId, hueOffset: 0, blend: null, audioBand: 'level' };
    clips.push(clip);
    return clip.id;
  };

  const scenes: Scene[] = [...set.scenes];
  for (const mapScene of show.scenes.slice(0, room)) {
    // The scene on screen is the shapes as they are now; a saved copy of it may be out of date.
    const states: Record<string, SceneState> = mapScene.id === show.sceneId ? capture(show.shapes) : mapScene.shapes;
    const cells = Array.from({ length: ZONE_COUNT }, (_, zone): string | null => {
      const shapeId = firsts[zone];
      const sourceId = shapeId ? states[shapeId]?.sourceId ?? null : null;
      if (!shapeId || !sourceId || !known.has(sourceId)) return null;
      return clipFor(sourceId, show.shapes.find(s => s.id === shapeId)?.name ?? 'Clip');
    });
    const ceiling = set.zones.some((z, i) => z.protected && cells[i] !== null);
    scenes.push({ id: id(), name: mapScene.name.slice(0, 40), cells, includeProtected: ceiling, follow: null });
  }
  return { ...set, scenes, clips };
}
