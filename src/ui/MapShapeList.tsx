import { useState, type MouseEvent } from 'react';
import type { useMap } from './useMap';
import MapIcon from './mapIcons';
import { LIVE_SOURCE_ID, type Shape } from '../map/show';
import { reactsLabel } from '../map/targets';

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

/** Folders closed on this screen, kept while the app is open. */
const closedFolders = new Set<string>();

/**
 * The shapes as one compact list: a row per shape (colour, name, what it plays) with Shown, Lock and Solo as small
 * icons that show on hover, or stay when they are not at rest; groups are folders with their members below.
 * Clicking a name selects; Shift-click adds to the selection; clicking a folder selects its members.
 */
export default function MapShapeList({ map, onMenu }: { map: Map; onMenu: (e: MouseEvent, shapeId: string) => void }) {
  const [, redraw] = useState(0);
  const select = (e: MouseEvent, ids: string[]) => {
    if (e.shiftKey) {
      const all = ids.every(id => map.selectedIds.includes(id));
      map.selectMany(all ? map.selectedIds.filter(id => !ids.includes(id)) : [...map.selectedIds, ...ids.filter(id => !map.selectedIds.includes(id))]);
    } else if (ids.length === 1) map.setSelection(ids[0]);
    else map.selectMany(ids);
  };
  const soloShape = (id: string) => map.setSolo({ ...map.solo, shapes: map.solo.shapes.includes(id) ? map.solo.shapes.filter(s => s !== id) : [...map.solo.shapes, id] });
  const soloGroup = (id: string) => map.setSolo({ ...map.solo, groups: map.solo.groups.includes(id) ? map.solo.groups.filter(g => g !== id) : [...map.solo.groups, id] });
  /** What a shape plays, in a word or two. */
  const plays = (shape: Shape) => shape.blocker ? 'Blocker' : shape.sourceId === LIVE_SOURCE_ID ? 'Live' : shape.sourceId ? map.show.sources.find(s => s.id === shape.sourceId)?.project.name ?? '' : shape.fill === 'grid' ? 'Grid' : 'Colour';
  const toggles = (label: string, shown: boolean, locked: boolean, soloed: boolean, on: { show: () => void; lock: () => void; solo: () => void }) => <span className="map-row-icons">
    <button className={`map-icon ${!shown ? 'set' : ''}`} aria-pressed={shown} aria-label={`${shown ? 'Hide' : 'Show'} ${label}`} title={shown ? 'Shown · click to hide' : 'Hidden · click to show'} onClick={on.show}><MapIcon name={shown ? 'eye' : 'eyeOff'} /></button>
    <button className={`map-icon ${locked ? 'set' : ''}`} aria-pressed={locked} aria-label={`${locked ? 'Unlock' : 'Lock'} ${label}`} title={locked ? 'Locked · click to unlock' : 'Click to lock'} onClick={on.lock}><MapIcon name={locked ? 'lock' : 'unlock'} /></button>
    <button className={`map-icon ${soloed ? 'set solo' : ''}`} aria-pressed={soloed} aria-label={`Solo ${label}`} title="Solo: show only soloed shapes, on the projector too" onClick={on.solo}><MapIcon name="solo" /></button>
  </span>;

  const shapeRow = (shape: Shape, member: boolean) => <li key={shape.id} className={`map-row ${map.selectedIds.includes(shape.id) ? 'selected' : ''} ${member ? 'member' : ''} ${shape.visible ? '' : 'hidden'}`}
    onContextMenu={e => { e.preventDefault(); if (map.loaded) onMenu(e, shape.id); }}>
    <button className="map-shape-name" aria-pressed={map.selectedIds.includes(shape.id)} aria-label={shape.name} title={shape.blocker ? 'Blocker: blacks out everything beneath it' : undefined} onClick={e => select(e, [shape.id])}>
      <span className={`map-swatch ${shape.blocker ? 'blocker' : ''}`} style={{ background: shape.blocker ? undefined : shape.colour }} /><span className="map-row-name">{shape.name}</span>
      <span className="map-row-plays">{plays(shape)}</span>{reactsLabel(map.show, shape.id) && <span className="map-row-reacts" title="Reacts to sound or MIDI">{reactsLabel(map.show, shape.id)}</span>}</button>
    {toggles(shape.name, shape.visible, shape.locked, map.solo.shapes.includes(shape.id), {
      show: () => map.dispatch({ type: 'setVisible', shapeId: shape.id, visible: !shape.visible }),
      lock: () => map.dispatch({ type: 'setLocked', shapeId: shape.id, locked: !shape.locked }),
      solo: () => soloShape(shape.id),
    })}
  </li>;

  return <ul className="map-shape-list">{items(map.show.shapes).flatMap(item => {
    if (item.kind === 'shape') return [shapeRow(item.shape, false)];
    const group = map.show.groups.find(g => g.id === item.groupId);
    if (!group) return item.members.map(m => shapeRow(m, false));
    const open = !closedFolders.has(group.id);
    const ids = item.members.map(m => m.id);
    const allSelected = ids.every(id => map.selectedIds.includes(id));
    // A group whose shapes all play one instrument shows it, as one instrument.
    const firstSource = item.members[0].sourceId;
    const shared = firstSource && item.members.every(m => m.sourceId === firstSource) ? (firstSource === LIVE_SOURCE_ID ? 'Live' : map.show.sources.find(s => s.id === firstSource)?.project.name ?? null) : null;
    return [
      <li key={`group-${group.id}`} className={`map-row map-group-row ${allSelected ? 'selected' : ''} ${group.visible ? '' : 'hidden'}`} onContextMenu={e => { e.preventDefault(); if (map.loaded) onMenu(e, ids[0]); }}>
        <button className="map-folder" aria-expanded={open} aria-label={`${open ? 'Close' : 'Open'} ${group.name}`} onClick={() => { if (open) closedFolders.add(group.id); else closedFolders.delete(group.id); redraw(n => n + 1); }}><MapIcon name={open ? 'chevronDown' : 'chevronRight'} size={12} /></button>
        <button className="map-shape-name" aria-pressed={allSelected} title="Select every shape in this group" onClick={e => select(e, ids)}>
          <MapIcon name="folder" size={13} /><span className="map-row-name">{group.name} <span className="map-row-count">{ids.length}</span></span>
          {shared && <span className="map-row-plays" title="One instrument across this group">{shared}</span>}</button>
        {toggles(`group ${group.name}`, group.visible, group.locked, map.solo.groups.includes(group.id), {
          show: () => map.dispatch({ type: 'setGroupVisible', groupId: group.id, visible: !group.visible }),
          lock: () => map.dispatch({ type: 'setGroupLocked', groupId: group.id, locked: !group.locked }),
          solo: () => soloGroup(group.id),
        })}
      </li>,
      ...(open ? item.members.map(m => shapeRow(m, true)) : []),
    ];
  })}</ul>;
}
