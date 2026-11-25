/** Perform: which shapes each zone owns, and the overlay a running show puts over the Map show. Never edits the saved show. */
import { isShapeShown, isVideoId, LIVE_SOURCE_ID, type Group, type Shape } from '../map/show';
import type { Zone } from './types';

/** The shape ids each zone owns. A shape belongs to the first zone claiming it; a deleted or empty target owns nothing. */
export function zoneShapes(zones: readonly Zone[], shapes: readonly Shape[]): string[][] {
  const claimed = new Set<string>();
  return zones.map(zone => {
    const t = zone.target;
    if (!t) return [];
    const ids = shapes
      .filter(s => (t.kind === 'group' ? s.groupId === t.id : s.id === t.id) && !claimed.has(s.id))
      .map(s => s.id);
    for (const id of ids) claimed.add(id);
    return ids;
  });
}

/** What one zone is doing now: the shapes it owns, the source it plays (null is black), and whether anything has been launched into it. */
export interface ZonePicture { shapeIds: string[]; sourceId: string | null; launched: boolean }

/** The show as the wall should draw it: zones play their sources, everything else is hidden. Blockers are left as they are. Returns a copy. */
export function overlayShow<T extends { shapes: Shape[]; groups: Group[] }>(show: T, zones: readonly ZonePicture[]): T {
  const owner = new Map<string, ZonePicture>();
  for (const z of zones) for (const id of z.shapeIds) if (!owner.has(id)) owner.set(id, z);
  const shapes = show.shapes.map((s): Shape => {
    if (s.blocker) return isShapeShown(show, s) === s.visible ? s : { ...s, visible: isShapeShown(show, s) };
    const z = owner.get(s.id);
    if (!z || !z.launched) return { ...s, visible: false };
    if (z.sourceId === null) return { ...s, visible: true, sourceId: null, colour: '#000000', fill: 'colour', border: { ...s.border, width: 0, run: null } };
    // Whenever the look cannot play (lost, over the limit, not ready, no composition) the wall draws the shape's own
    // fill: during a show that is black, never Map's colour or test grid. The border keeps the colour it had in Map.
    const ownColour = s.border.colour === 'shape' || (s.border.colour === 'palette' && (z.sourceId === LIVE_SOURCE_ID || isVideoId(z.sourceId)));
    return { ...s, visible: true, sourceId: z.sourceId, colour: '#000000', fill: 'colour', border: ownColour ? { ...s.border, colour: s.colour } : s.border };
  });
  // Groups are forced visible so a group hidden in Map cannot darken a launched zone; blockers above already carry their own effective visibility.
  return { ...show, shapes, groups: show.groups.map(g => ({ ...g, visible: true })) };
}

/** Sources that more than one launched zone plays: source id to the zone indexes sharing it. */
export function linkedZones(zones: readonly ZonePicture[]): Map<string, number[]> {
  const all = new Map<string, number[]>();
  zones.forEach((z, i) => { if (z.launched && z.sourceId !== null) all.set(z.sourceId, [...(all.get(z.sourceId) ?? []), i]); });
  for (const [id, list] of all) if (list.length < 2) all.delete(id);
  return all;
}
