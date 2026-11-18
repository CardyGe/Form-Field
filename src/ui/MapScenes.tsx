/**
 * The scene bar under the stage: one button per scene (keys 1 to 9), + to keep the stage as it is now as a new scene,
 * and the fade time. Right-click a scene to rename it, give it its own fade, or delete it.
 */
import { useState } from 'react';
import type { useMap } from './useMap';
import MapMenu, { type MenuEntry } from './MapMenu';
import { newItemId } from './mapActions';
import { FADE_RANGE, MAX_SCENES } from '../map/scenes';
import { MAX_NAME_LENGTH } from '../map/show';

type Map = ReturnType<typeof useMap>;
const FADES = [0, 0.5, 1, 2, 4, 8, 15, 30];
const seconds = (s: number) => s === 0 ? 'Cut' : `${s} s`;

export default function MapScenes({ map }: { map: Map }) {
  const show = map.show;
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const add = () => {
    const n = show.scenes.length + 1;
    map.dispatch({ type: 'addScene', sceneId: newItemId('scene'), name: `Scene ${n}` });
  };
  const entries = (id: string): MenuEntry[] => {
    const scene = show.scenes.find(s => s.id === id);
    if (!scene) return [];
    return [
      { kind: 'item', label: 'Rename', onSelect: () => setRenaming(id) },
      { kind: 'separator' },
      { kind: 'item', label: `Fade: as the show (${seconds(show.sceneFade)})`, checked: scene.fadeSeconds === null, onSelect: () => map.dispatch({ type: 'setSceneFade', sceneId: id, seconds: null }) },
      ...FADES.map((f): MenuEntry => ({ kind: 'item', label: `Fade: ${seconds(f)}`, checked: scene.fadeSeconds === f, onSelect: () => map.dispatch({ type: 'setSceneFade', sceneId: id, seconds: f }) })),
      { kind: 'separator' },
      { kind: 'item', label: 'Delete scene', danger: true, onSelect: () => map.dispatch({ type: 'deleteScene', sceneId: id }) },
    ];
  };
  const rename = (id: string, text: string) => {
    setRenaming(null);
    const name = text.trim(), scene = show.scenes.find(s => s.id === id);
    if (name && scene && name !== scene.name) map.dispatch({ type: 'renameScene', sceneId: id, name });
  };
  return <div className="map-scenes" role="toolbar" aria-label="Scenes">
    <span className="muted-text">Scenes</span>
    {show.scenes.map((scene, i) => renaming === scene.id
      ? <input key={scene.id} autoFocus aria-label="Scene name" className="map-scene-name" defaultValue={scene.name} maxLength={MAX_NAME_LENGTH}
          onBlur={e => rename(scene.id, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }} />
      : <button key={scene.id} className="text-button map-scene" aria-pressed={show.sceneId === scene.id}
          title={`${i < 9 ? `Key ${i + 1} · ` : ''}fade ${seconds(scene.fadeSeconds ?? show.sceneFade)} · right-click to rename, set its fade or delete`}
          onClick={() => map.switchScene(scene.id)}
          onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, id: scene.id }); }}>
          {i < 9 && <kbd>{i + 1}</kbd>}{scene.name}</button>)}
    <button className="text-button" disabled={show.scenes.length >= MAX_SCENES} title={show.scenes.length ? 'Keep the stage as it is now as a new scene' : 'Keep the stage as it is now as scene 1; change it, then + again for scene 2'} onClick={add}>+ Scene</button>
    {show.scenes.length > 0 && <label className="map-inline-range">Fade<select aria-label="Scene fade" value={show.sceneFade} onChange={e => map.dispatch({ type: 'setSceneFade', sceneId: null, seconds: Math.min(FADE_RANGE.max, Number(e.target.value)) })}>
      {(FADES.includes(show.sceneFade) ? FADES : [...FADES, show.sceneFade].sort((a, b) => a - b)).map(f => <option key={f} value={f}>{seconds(f)}</option>)}</select></label>}
    {menu && <MapMenu x={menu.x} y={menu.y} label="Scene" entries={entries(menu.id)} onClose={() => setMenu(null)} />}
  </div>;
}
