/** Shape actions shared by the right-click menu, the keyboard and the Details panel. */
import type { useMap } from './useMap';
import { selectionBox } from '../map/gestures';
import { scaleAbout } from '../map/outline';

type Map = ReturnType<typeof useMap>;

const stamp = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const newId = () => `shape-${stamp()}`;
export const newSourceId = () => `source-${stamp()}`;
export const newGroupId = () => `group-${stamp()}`;
export const randomSeed = () => Math.floor(Math.random() * 1e6);
const several = (n: number, make: () => string) => Array.from({ length: n }, make);

export function mapActions(map: Map) {
  /** The selected shapes in list order. */
  const selected = () => map.show.shapes.filter(s => map.selectedIds.includes(s.id)).map(s => s.id);
  return {
    selected,
    /** Copies, 20 projector pixels away; the copies become the selection. */
    duplicate(ids = selected()) {
      if (!ids.length) return;
      const copies = several(ids.length, newId);
      if (map.dispatch({ type: 'duplicateShapes', shapeIds: ids, ids: copies, sourceIds: several(ids.length, newSourceId) })) map.selectMany(copies);
    },
    remove(ids = selected()) {
      if (ids.length && map.dispatch({ type: 'deleteShapes', shapeIds: ids })) map.setSelection(null);
    },
    /** Turned over about the selection's own centre: left to right, or top to bottom. */
    flip(axis: 'vertical' | 'horizontal', ids = selected()) {
      const box = selectionBox(map.show, ids);
      if (!box) return;
      const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      map.dispatch({ type: 'transformShapes', shapeIds: ids, matrix: axis === 'vertical' ? scaleAbout(centre, -1, 1) : scaleAbout(centre, 1, -1) });
    },
    /** Mirrored copies across the stage's centre line. */
    mirror(axis: 'vertical' | 'horizontal', ids = selected()) {
      if (!ids.length) return;
      const copies = several(ids.length, newId);
      if (map.dispatch({ type: 'mirrorShapes', shapeIds: ids, axis, ids: copies, sourceIds: several(ids.length, newSourceId) })) map.selectMany(copies);
    },
    group(ids = selected()) {
      if (ids.length) map.dispatch({ type: 'group', shapeIds: ids, groupId: newGroupId(), name: '' });
    },
    ungroup(groupId: string | null) {
      if (groupId) map.dispatch({ type: 'ungroup', groupId });
    },
    makeGrid(shapeId: string, rows: number, cols: number, gapPx: number, spread = false) {
      const n = rows * cols;
      const ids = several(n, newId);
      if (map.dispatch({ type: 'makeGrid', shapeId, rows, cols, gapPx, ids, sourceIds: several(n, newSourceId), groupId: newGroupId(), spread })) map.selectMany(ids);
    },
    toggleSolo(shapeId: string) {
      const s = map.solo;
      map.setSolo({ ...s, shapes: s.shapes.includes(shapeId) ? s.shapes.filter(id => id !== shapeId) : [...s.shapes, shapeId] });
    },
  };
}
