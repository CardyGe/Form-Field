/** The hero of the Perform screen: one column per zone, one row per scene, with drag-to-place and a right-click menu. */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { PerformView } from '../perform/service';
import { linkedZones } from '../perform/resolve';
import { ZONE_COUNT, type Blend, type Clip, type PerformanceSet, type Scene } from '../perform/types';
import type { ShowDocument } from '../map/show';
import { LIVE_SOURCE_ID, isVideoId, TEMPO_SYNC_BEATS } from '../map/show';
import MapMenu, { type MenuEntry } from './MapMenu';

export const LOOK_DRAG = 'application/x-formfield-look';
const CLIP_DRAG = 'application/x-formfield-clip';

export type CellState = 'empty' | 'idle' | 'playing' | 'queued';
export interface GridActions {
  dropLook: (row: number, zone: number, look: string) => void;
  linkClip: (row: number, zone: number, clipId: string) => void;
  clear: (row: number, zone: number) => void;
  duplicate: (row: number, zone: number) => void;
  setBlend: (clipId: string, blend: Blend | null) => void;
  setBand: (clipId: string, band: Clip['audioBand']) => void;
  setTiming: (sourceId: string, beats: number | null) => void;
  addScene: () => void;
  removeScene: (row: number) => void;
  renameScene: (row: number, name: string) => void;
  setIncludeCeiling: (row: number, on: boolean) => void;
  chooseZone: (zone: number, x: number, y: number) => void;
  /** During a show a click plays; with no show it selects the cell to fill. */
  clickCell: (row: number, zone: number) => void;
  clickScene: (row: number) => void;
  /** Right-click on an empty cell: choose a look for it. */
  fillCell: (row: number, zone: number) => void;
}

const BLENDS: { label: string; blend: Blend | null; ceiling?: boolean }[] = [
  { label: 'Default', blend: null }, { label: 'Cut', blend: { kind: 'cut', bars: 0 } },
  ...[.5, 1, 2, 4, 8].map(bars => ({ label: `Fade ${bars === .5 ? '½' : bars}`, blend: { kind: 'fade' as const, bars } })),
  { label: 'Dip 1', blend: { kind: 'dip', bars: 1 } },
  ...[8, 16, 32].map(bars => ({ label: `Dissolve ${bars}`, blend: { kind: 'dissolve' as const, bars }, ceiling: true })),
];
const BANDS: { label: string; band: Clip['audioBand'] }[] = [{ label: 'Bass', band: 'bass' }, { label: 'Mids', band: 'mid' }, { label: 'Highs', band: 'high' }, { label: 'Level', band: 'level' }];
const sameBlend = (a: Blend | null, b: Blend | null) => a?.kind === b?.kind && a?.bars === b?.bars;

function CellMenu({ x, y, clip, zone, set, show, editable, actions, row, onClose }: { x: number; y: number; clip: Clip; zone: number; row: number; set: PerformanceSet; show: ShowDocument; editable: boolean; actions: GridActions; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });
  // Once, when it opens: the show redraws this menu many times a second, and that must never pull focus back.
  useEffect(() => {
    const b = box.current?.getBoundingClientRect();
    if (b) setAt({ left: Math.max(8, Math.min(x, innerWidth - b.width - 8)), top: Math.max(8, Math.min(y, innerHeight - b.height - 8)) });
    box.current?.querySelector('button')?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    addEventListener('pointerdown', outside, true); addEventListener('blur', onClose);
    return () => { removeEventListener('pointerdown', outside, true); removeEventListener('blur', onClose); };
  }, [onClose]);
  const timing = isVideoId(clip.sourceId) ? show.videos.find(v => v.id === clip.sourceId)?.tempoSync : show.sources.find(s => s.id === clip.sourceId)?.tempoSync;
  const isLive = clip.sourceId === LIVE_SOURCE_ID, others = set.clips.filter(c => c.id !== clip.id);
  const act = (fn: () => void) => { fn(); onClose(); };
  const chip = (label: string, on: boolean, fn: () => void) => <button key={label} type="button" role="menuitemradio" aria-checked={on} className={on ? 'on' : ''} onClick={() => act(fn)}>{label}</button>;
  return <div ref={box} className="pf-menu" role="menu" aria-label={`${clip.name} options`} style={at} onContextMenu={e => e.preventDefault()}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
    <strong>{clip.name}</strong>
    {!isLive && <button type="button" role="menuitem" onClick={() => act(() => actions.duplicate(row, zone))}>{editable ? 'Duplicate and edit' : 'Duplicate'}</button>}
    <h4>Blend</h4><div className="pf-chips">{BLENDS.filter(b => !b.ceiling || zone === ZONE_COUNT - 1).map(b => chip(b.label, sameBlend(clip.blend, b.blend), () => actions.setBlend(clip.id, b.blend)))}</div>
    {!isLive && <><h4>Timing</h4><div className="pf-chips">{chip('Free', !timing, () => actions.setTiming(clip.sourceId, null))}{TEMPO_SYNC_BEATS.map(n => chip(`${n} beat${n === 1 ? '' : 's'}`, timing === n, () => actions.setTiming(clip.sourceId, n)))}</div></>}
    <h4>Audio band</h4><div className="pf-chips">{BANDS.map(b => chip(b.label, clip.audioBand === b.band, () => actions.setBand(clip.id, b.band)))}</div>
    {others.length > 0 && <><h4>Link to</h4><div className="pf-chips">{others.slice(0, 12).map(c => <button key={c.id} type="button" role="menuitem" onClick={() => act(() => actions.linkClip(row, zone, c.id))}>{c.name}</button>)}</div></>}
    <button type="button" role="menuitem" className="danger" onClick={() => act(() => actions.clear(row, zone))}>Clear</button>
  </div>;
}

export default function PerformGrid({ set, show, view, selected, actions }: { set: PerformanceSet; show: ShowDocument; view: PerformView; selected: { row: number; zone: number } | null; actions: GridActions }) {
  const [menu, setMenu] = useState<{ x: number; y: number; row: number; zone: number } | null>(null);
  const [sceneMenu, setSceneMenu] = useState<{ x: number; y: number; row: number } | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []), closeSceneMenu = useCallback(() => setSceneMenu(null), []);
  const rowsBox = useRef<HTMLDivElement>(null), wheeled = useRef(-Infinity);
  // The row about to land, or else the one playing, stays in view. A deliberate scroll is left alone for a moment.
  const pinned = view.running ? view.launcher.queue.find(l => l.sceneIndex !== null)?.sceneIndex ?? (view.launcher.sceneIndex >= 0 ? view.launcher.sceneIndex : null) : null;
  useEffect(() => {
    const box = rowsBox.current, row = pinned === null ? null : box?.querySelector<HTMLElement>(`[data-row="${pinned}"]`);
    if (!box || !row || performance.now() - wheeled.current < 2000) return;
    const b = box.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top; else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  });
  const { launcher, running } = view;
  const clipOf = (id: string | null) => id === null ? undefined : set.clips.find(c => c.id === id);
  const queued = new Map(launcher.queue.flatMap(l => l.changes.map(c => [c.zone, c.clipId] as const)));
  const queuedRow = launcher.queue.find(l => l.sceneIndex !== null)?.sceneIndex ?? null;
  const pictures = launcher.playing.map((id, i) => ({ shapeIds: [] as string[], sourceId: clipOf(id)?.sourceId ?? null, launched: launcher.launched[i] }));
  const linked = linkedZones(pictures);
  /** A clip can sit on several rows: the mark goes on the row that launched it, or else its first. */
  const markRow = (zone: number, clipId: string | null, prefer: number | null) => {
    if (clipId === null) return -1;
    if (prefer !== null && set.scenes[prefer]?.cells[zone] === clipId) return prefer;
    return set.scenes.findIndex(s => s.cells[zone] === clipId);
  };
  const stateOf = (row: number, zone: number, clipId: string | null): CellState => {
    if (clipId === null) return 'empty';
    if (running && queued.has(zone) && queued.get(zone) === clipId && markRow(zone, clipId, queuedRow) === row) return 'queued';
    if (running && launcher.launched[zone] && launcher.playing[zone] === clipId && markRow(zone, clipId, launcher.sceneIndex) === row) return 'playing';
    return 'idle';
  };
  const readiness = (clip: Clip, state: CellState) => {
    if (!running || state === 'playing') return null;
    if (view.stuck.includes(clip.sourceId)) return { tone: 'red', text: 'Too heavy' };
    if (view.waiting.includes(clip.sourceId)) return { tone: 'amber', text: 'Loading' };
    if (view.armed.includes(clip.sourceId)) return { tone: 'green', text: 'Ready' };
    return null;
  };
  const drop = (e: DragEvent, row: number, zone: number) => {
    e.preventDefault(); setOver(null);
    const clipId = e.dataTransfer.getData(CLIP_DRAG), look = e.dataTransfer.getData(LOOK_DRAG);
    if (clipId) actions.linkClip(row, zone, clipId); else if (look) actions.dropLook(row, zone, look);
  };
  const sceneEntries = (row: number): MenuEntry[] => {
    const scene: Scene | undefined = set.scenes[row];
    if (!scene) return [];
    return [
      { kind: 'item', label: 'Rename', onSelect: () => setRenaming(row) },
      { kind: 'item', label: 'Include ceiling', checked: scene.includeProtected, onSelect: () => actions.setIncludeCeiling(row, !scene.includeProtected) },
      { kind: 'separator' },
      { kind: 'item', label: running ? 'Delete (after End show)' : 'Delete scene', danger: true, disabled: running, onSelect: () => actions.removeScene(row) },
    ];
  };
  const linkedWith = (zone: number) => { const id = pictures[zone].sourceId; return id ? (linked.get(id) ?? []).filter(z => z !== zone) : []; };
  return <div className="pf-grid" role="group" aria-label="Clips">
    <div className="pf-row pf-head">
      {set.zones.map((z, i) => {
        const shared = linkedWith(i);
        return <button key={z.id} type="button" className={`pf-zone ${z.target ? '' : 'unset'} ${launcher.playing[i] ? 'live' : ''}`} aria-label={`Choose the place for zone ${i + 1}`}
          title={z.target ? `${z.name}: click to choose another place` : 'Click to choose a Map group or shape'} onClick={e => actions.chooseZone(i, e.clientX, e.clientY)}>
          <b>{i + 1}</b><span>{z.name}</span>{shared.length > 0 && <em title={`Shares one picture with zone ${shared.map(n => n + 1).join(', ')}`}>⇄ {shared.map(n => n + 1).join(' ')}</em>}
        </button>;
      })}
      <div className="pf-zone pf-scenes-head">Scenes<button type="button" className="pf-add" aria-label="Add scene" title="Add a scene" disabled={set.scenes.length >= 16} onClick={actions.addScene}>+ Scene</button></div>
    </div>
    <div className="pf-rows" ref={rowsBox} data-density={set.scenes.length <= 4 ? 'large' : set.scenes.length <= 8 ? 'medium' : 'compact'} onWheel={() => { wheeled.current = performance.now(); }}>
      {set.scenes.map((scene, row) => <div className={`pf-row ${launcher.sceneIndex === row ? 'current' : ''}`} data-row={row} key={scene.id}>
        {scene.cells.map((clipId, zone) => {
          const clip = clipOf(clipId), state = stateOf(row, zone, clipId), ready = clip ? readiness(clip, state) : null, key = `${row}-${zone}`;
          return <button key={zone} type="button" data-cell={key} data-filled={clip ? 'true' : 'false'} data-state={state} draggable={!!clip}
            aria-label={`${scene.name}, ${set.zones[zone].name}: ${clip ? `${clip.name}${state === 'playing' ? ', playing' : state === 'queued' ? ', queued' : ''}` : 'empty'}`}
            className={`pf-cell ${state} ${selected?.row === row && selected.zone === zone ? 'selected' : ''} ${over === key ? 'over' : ''}`}
            onClick={() => actions.clickCell(row, zone)}
            onContextMenu={e => { e.preventDefault(); if (clip) setMenu({ x: e.clientX, y: e.clientY, row, zone }); else actions.fillCell(row, zone); }}
            onDragStart={e => { if (clip) { e.dataTransfer.setData(CLIP_DRAG, clip.id); e.dataTransfer.effectAllowed = 'copy'; } }}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(key); }} onDragLeave={() => setOver(o => o === key ? null : o)} onDrop={e => drop(e, row, zone)}>
            {clip ? <>
              <span className="pf-mark" aria-hidden>{state === 'playing' ? '▶' : state === 'queued' ? '◆' : ''}</span>
              <span className="pf-clip-name">{clip.name}</span>
              {ready && <span className={`pf-ready ${ready.tone}`}><i />{ready.tone === 'green' ? '' : ready.text}</span>}
            </> : <span className="pf-empty" aria-hidden>·</span>}
          </button>;
        })}
        {renaming === row
          ? <input autoFocus className="pf-scene-name" aria-label="Scene name" defaultValue={scene.name} maxLength={40}
              onBlur={e => { setRenaming(null); const name = e.target.value.trim(); if (name && name !== scene.name) actions.renameScene(row, name); }}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />
          : <button type="button" className={`pf-scene ${launcher.sceneIndex === row ? 'playing' : ''} ${queuedRow === row ? 'queued' : ''}`} title={running ? 'Click to launch this scene on the next boundary · right-click for options' : 'Right-click to rename, include the ceiling, or delete'}
              onClick={() => actions.clickScene(row)}
              onContextMenu={e => { e.preventDefault(); setSceneMenu({ x: e.clientX, y: e.clientY, row }); }} onDoubleClick={() => { if (!running) setRenaming(row); }}>
              <span className="pf-mark" aria-hidden>{queuedRow === row ? '◆' : launcher.sceneIndex === row ? '▶' : ''}</span>{scene.name}{scene.includeProtected && <small> +ceiling</small>}
            </button>}
      </div>)}
      {set.scenes.length === 0 && <p className="pf-empty-note">Add a scene, choose a place for each zone along the top, then click a cell and pick a look.</p>}
    </div>
    {menu && clipOf(set.scenes[menu.row]?.cells[menu.zone] ?? null) && <CellMenu {...menu} clip={clipOf(set.scenes[menu.row].cells[menu.zone])!} set={set} show={show} editable={!running} actions={actions} onClose={closeMenu} />}
    {sceneMenu && <MapMenu x={sceneMenu.x} y={sceneMenu.y} label="Scene" entries={sceneEntries(sceneMenu.row)} onClose={closeSceneMenu} />}
  </div>;
}
