/**
 * The scene bar under the stage: one button per scene (keys 1 to 9), + to keep the stage as it is now as a new scene,
 * and the fade time. Right-click a scene to rename it, give it its own fade, or delete it.
 */
import { useState } from 'react';
import type { useMap } from './useMap';
import MapMenu, { type MenuEntry } from './MapMenu';
import { newItemId } from './mapActions';
import { FADE_RANGE, MAX_SCENES } from '../map/scenes';
import { AUTO_BARS, AUTO_SECONDS, MAX_NAME_LENGTH, type AutoAdvance } from '../map/show';

type Map = ReturnType<typeof useMap>;
const FADES = [0, 0.5, 1, 2, 4, 8, 15, 30];
const seconds = (s: number) => s === 0 ? 'Cut' : `${s} s`;
/** Auto-advance choices: every so many seconds or bars of the tempo. */
const AUTO_CHOICES: { label: string; every: number; unit: AutoAdvance['unit'] }[] = [
  ...[10, 30, 60, 120, 300].map(n => ({ label: n < 60 ? `${n} s` : `${n / 60} min`, every: n, unit: 'seconds' as const })),
  ...[4, 8, 16, 32].map(n => ({ label: `${n} bars`, every: n, unit: 'bars' as const })),
];
const autoKey = (a: { every: number; unit: string }) => `${a.unit}:${a.every}`;

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
    {(show.scenes.length > 1 || show.autoAdvance) && <AutoAdvanceField map={map} />}
    {menu && <MapMenu x={menu.x} y={menu.y} label="Scene" entries={entries(menu.id)} onClose={() => setMenu(null)} />}
  </div>;
}

/** Scene auto-advance: Off, or every so many seconds or bars, to the next scene or a random other one. Paused by Freeze and Blackout. */
function AutoAdvanceField({ map }: { map: Map }) {
  const auto = map.show.autoAdvance ?? null;
  const set = (next: AutoAdvance | null) => { if (next?.unit === 'bars') map.startEngine(); map.dispatch({ type: 'setAutoAdvance', autoAdvance: next }); };
  const inRange = (a: AutoAdvance) => a.unit === 'bars' ? a.every >= AUTO_BARS.min && a.every <= AUTO_BARS.max : a.every >= AUTO_SECONDS.min && a.every <= AUTO_SECONDS.max;
  const choices = auto && !AUTO_CHOICES.some(c => autoKey(c) === autoKey(auto)) && inRange(auto) ? [...AUTO_CHOICES, { label: auto.unit === 'bars' ? `${auto.every} bars` : `${auto.every} s`, every: auto.every, unit: auto.unit }] : AUTO_CHOICES;
  return <>
    <label className="map-inline-range" title="Moves to another scene on its own; Freeze and Blackout pause it">Auto<select aria-label="Scene auto-advance" value={auto ? autoKey(auto) : ''}
      onChange={e => { const c = choices.find(x => autoKey(x) === e.target.value); set(c ? { every: c.every, unit: c.unit, order: auto?.order ?? 'next' } : null); }}>
      <option value="">Off</option>{choices.map(c => <option key={autoKey(c)} value={autoKey(c)}>Every {c.label}</option>)}</select></label>
    {auto && <label className="map-inline-range">Order<select aria-label="Auto-advance order" value={auto.order} onChange={e => set({ ...auto, order: e.target.value as AutoAdvance['order'] })}>
      <option value="next">In order</option><option value="random">Random</option></select></label>}
  </>;
}
