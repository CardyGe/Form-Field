/** Shape actions shared by the right-click menu, the keyboard and the Details panel. */
import type { useMap } from './useMap';
import { selectionBox } from '../map/gestures';
import { scaleAbout } from '../map/outline';
import { linksLeftBehind } from '../map/targets';

type Map = ReturnType<typeof useMap>;

const stamp = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const newId = () => `shape-${stamp()}`;
export const newSourceId = () => `source-${stamp()}`;
export const newGroupId = () => `group-${stamp()}`;
export const newItemId = (kind: 'link' | 'trigger' | 'scene') => `${kind}-${stamp()}`;
export const randomSeed = () => Math.floor(Math.random() * 1e6);

/** Stage 6: a PNG or JPEG picked by Greg, read as a data URL with its size; null when cancelled or unreadable. */
export function pickImage(): Promise<{ name: string; dataUrl: string; width: number; height: number } | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const dataUrl = String(reader.result), img = new Image();
        img.onload = () => resolve({ name: file.name, dataUrl, width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}
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
    /** What a shape plays: 'grid', 'colour', 'live' or 'preset:<id>'. linked: shapes sharing its instrument change with it. */
    /**
     * Make separate: this shape gets its own copy of its effect, with the effect's reactions as far as the link limit
     * allows. Returns the new effect's id and how many reactions stayed behind (for a note), or null when refused.
     */
    separate(shapeId: string, merge?: string): { id: string; left: number } | null {
      const before = map.show, from = before.shapes.find(s => s.id === shapeId)?.sourceId, id = newSourceId();
      if (!from || !map.dispatch({ type: 'makeSeparate', shapeId, sourceId: id }, merge)) return null;
      return { id, left: linksLeftBehind(before, map.currentShow(), from, id) };
    },
    play(shapeId: string, value: string, linked = true) {
      if (value === 'image') { void pickImage().then(image => { if (image) map.dispatch({ type: 'setContent', shapeId, content: { kind: 'image', sourceId: newSourceId(), image, linked } }); }); return; }
      if (value === 'video') { void window.studio?.map?.chooseVideo().then(file => { if (file) map.dispatch({ type: 'setContent', shapeId, content: { kind: 'video', videoId: `video-${stamp()}`, path: file.path, name: file.name, linked } }); }); return; }
      if (value === 'colour' || value === 'grid' || value === 'live') map.dispatch({ type: 'setContent', shapeId, content: { kind: value, linked } });
      else if (value.startsWith('preset:')) map.dispatch({ type: 'setContent', shapeId, content: { kind: 'preset', presetId: value.slice('preset:'.length), sourceId: newSourceId(), seed: randomSeed(), linked } });
    },
    toggleSolo(shapeId: string) {
      const s = map.solo;
      map.setSolo({ ...s, shapes: s.shapes.includes(shapeId) ? s.shapes.filter(id => id !== shapeId) : [...s.shapes, shapeId] });
    },
  };
}
