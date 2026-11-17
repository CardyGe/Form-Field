import { useState, type MouseEvent } from 'react';
import type { useMap } from './useMap';
import type { Shape } from '../map/show';

type Map = ReturnType<typeof useMap>;

/** The list as items: an ungrouped shape, or a group with its members (which always sit together). */
function items(shapes: Shape[]): ({ kind: 'shape'; shape: Shape } | { kind: 'group'; groupId: string; members: Shape[] })[] {
  const out: ({ kind: 'shape'; shape: Shape } | { kind: 'group'; groupId: string; members: Shape[] })[] = [];
  for (const shape of shapes) {
    const last = out[out.length - 1];
    if (shape.groupId === null) out.push({ kind: 'shape', shape });
    else if (last?.kind === 'group' && last.groupId === shape.groupId) last.members.push(shape);
    else out.push({ kind: 'group', groupId: shape.groupId, members: [shape] });
  }
  return out;
}

/**
 * The shapes, as a single list: groups are folders with their members indented below them. Clicking a name selects;
 * Shift-click adds to the selection; clicking a group selects its members. Shown, Locked and Solo for each.
 */
export default function MapShapeList({ map, onMenu }: { map: Map; onMenu: (e: MouseEvent, shapeId: string) => void }) {
  // Which folders are closed: for this screen only.
  const [closed, setClosed] = useState<string[]>([]);
  const select = (e: MouseEvent, ids: string[]) => {
    if (e.shiftKey) {
      const all = ids.every(id => map.selectedIds.includes(id));
      map.selectMany(all ? map.selectedIds.filter(id => !ids.includes(id)) : [...map.selectedIds, ...ids.filter(id => !map.selectedIds.includes(id))]);
    } else if (ids.length === 1) map.setSelection(ids[0]);
    else map.selectMany(ids);
  };
  const soloShape = (id: string) => map.setSolo({ ...map.solo, shapes: map.solo.shapes.includes(id) ? map.solo.shapes.filter(s => s !== id) : [...map.solo.shapes, id] });
  const soloGroup = (id: string) => map.setSolo({ ...map.solo, groups: map.solo.groups.includes(id) ? map.solo.groups.filter(g => g !== id) : [...map.solo.groups, id] });

  const shapeRow = (shape: Shape, member: boolean) => <li key={shape.id} className={`${map.selectedIds.includes(shape.id) ? 'selected' : ''} ${member ? 'map-member' : ''}`}
    onContextMenu={e => { e.preventDefault(); if (map.loaded) onMenu(e, shape.id); }}>
    <button className="map-shape-name" aria-pressed={map.selectedIds.includes(shape.id)} title={shape.blocker ? 'Blocker: blacks out everything beneath it' : undefined} onClick={e => select(e, [shape.id])}>
      <span className={`map-swatch ${shape.blocker ? 'blocker' : ''}`} style={{ background: shape.blocker ? undefined : shape.colour }} />{shape.name}</button>
    <button className="text-button" aria-pressed={shape.visible} aria-label={`${shape.visible ? 'Hide' : 'Show'} ${shape.name}`} onClick={() => map.dispatch({ type: 'setVisible', shapeId: shape.id, visible: !shape.visible })}>{shape.visible ? 'Shown' : 'Hidden'}</button>
    <button className="text-button" aria-pressed={shape.locked} aria-label={`${shape.locked ? 'Unlock' : 'Lock'} ${shape.name}`} onClick={() => map.dispatch({ type: 'setLocked', shapeId: shape.id, locked: !shape.locked })}>{shape.locked ? 'Locked' : 'Unlocked'}</button>
    <button className="text-button" aria-pressed={map.solo.shapes.includes(shape.id)} aria-label={`Solo ${shape.name}`} title="Show only soloed shapes, on the projector too" onClick={() => soloShape(shape.id)}>Solo</button>
  </li>;

  return <ul className="map-shape-list">{items(map.show.shapes).flatMap(item => {
    if (item.kind === 'shape') return [shapeRow(item.shape, false)];
    const group = map.show.groups.find(g => g.id === item.groupId);
    if (!group) return item.members.map(m => shapeRow(m, false));
    const open = !closed.includes(group.id);
    const ids = item.members.map(m => m.id);
    const allSelected = ids.every(id => map.selectedIds.includes(id));
    return [
      <li key={`group-${group.id}`} className={`map-group-row ${allSelected ? 'selected' : ''}`} onContextMenu={e => { e.preventDefault(); if (map.loaded) onMenu(e, ids[0]); }}>
        <button className="map-folder" aria-expanded={open} aria-label={`${open ? 'Close' : 'Open'} ${group.name}`} onClick={() => setClosed(c => open ? [...c, group.id] : c.filter(g => g !== group.id))}>{open ? '▾' : '▸'}</button>
        <button className="map-shape-name" aria-pressed={allSelected} title="Select every shape in this group" onClick={e => select(e, ids)}>{group.name} <span className="muted-text">({ids.length})</span></button>
        <button className="text-button" aria-pressed={group.visible} aria-label={`${group.visible ? 'Hide' : 'Show'} group ${group.name}`} onClick={() => map.dispatch({ type: 'setGroupVisible', groupId: group.id, visible: !group.visible })}>{group.visible ? 'Shown' : 'Hidden'}</button>
        <button className="text-button" aria-pressed={group.locked} aria-label={`${group.locked ? 'Unlock' : 'Lock'} group ${group.name}`} onClick={() => map.dispatch({ type: 'setGroupLocked', groupId: group.id, locked: !group.locked })}>{group.locked ? 'Locked' : 'Unlocked'}</button>
        <button className="text-button" aria-pressed={map.solo.groups.includes(group.id)} aria-label={`Solo group ${group.name}`} title="Show only soloed shapes, on the projector too" onClick={() => soloGroup(group.id)}>Solo</button>
      </li>,
      ...(open ? item.members.map(m => shapeRow(m, true)) : []),
    ];
  })}</ul>;
}
