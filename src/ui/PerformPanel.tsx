/** The Perform screen: status, the clip grid and the on-screen MIDImix. It plays the set; it never changes Map's shapes or scenes. */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import './perform.css';
import { REHEARSAL, REHEARSAL_PAUSED } from '../react/audio';
import { reactivityIfStarted } from '../react/engine';
import { PRESETS } from '../core/project';
import { KIND_LABELS } from '../core/library';
import { LIVE_SOURCE_ID, isVideoId, type ShowDocument } from '../map/show';
import { presetComposition, type EditAction } from '../map/editor';
import { checkSet } from '../perform/check-set';
import { importMapScenes } from '../perform/import-scenes';
import { addRow, assignZone, changeClip, changeRow, clipsInUse, placeClip, removeRow, setCell, zonesFromGroups } from '../perform/grid-edit';
import type { PerformView } from '../perform/service';
import { beatAt } from '../perform/timing';
import { BEATS_PER_BAR, MAX_PERFORM_SCENES, type Clip, type PerformanceSet, type Quantize } from '../perform/types';
import ControllerSurface from './ControllerSurface';
import { kindArt } from './kindArt';
import MapMenu, { type MenuEntry } from './MapMenu';
import { newSourceId, randomSeed } from './mapActions';
import PerformGrid, { LOOK_DRAG, type GridActions } from './PerformGrid';
import { ReactDevices } from './ReactControls';
import { startPerformShow, useMap, type ClipCopy } from './useMap';
import { keysBelongElsewhere, usePerform } from './usePerform';

const QUANTIZE: { value: Quantize; label: string }[] = [{ value: '1/4', label: '1 beat' }, { value: '1/2', label: '2 beats' }, { value: '1bar', label: '1 bar' }, { value: '2bar', label: '2 bars' }, { value: '4bar', label: '4 bars' }];
const LOOKS = [
  { value: 'live', name: 'Live', group: 'Your own', art: undefined as string | undefined },
  { value: 'video', name: 'Video…', group: 'Your own', art: undefined as string | undefined },
  ...PRESETS.map(p => ({ value: `preset:${p.id}`, name: p.name, group: KIND_LABELS[p.kind] ?? p.kind, art: kindArt(p.kind) })),
];
const FULL = 'The set is full. It can hold 64 looks, so clear one you no longer use.';
const REFUSALS: Record<string, string> = { 'too-many-sources': FULL, 'too-many-videos': 'The set is full. It can hold 16 videos, so clear one you no longer use.', 'not-a-video': 'That file is not a video this app can play.' };
const stamp = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const newClip = (name: string, sourceId: string): Clip => ({ id: `clip-${stamp()}`, name: name.slice(0, 40), sourceId, hueOffset: 0, blend: null, audioBand: 'level' });

/** The next thing to do or the next thing coming, in one line that can be read from a metre away. */
function nextLine(view: PerformView, set: PerformanceSet, canStart: boolean): { text: string; urgent: boolean } {
  if (!view.running) return { text: canStart ? 'Ready. Press Start show.' : 'Add a scene with a clip to start.', urgent: false };
  if (!view.controls.ready) return { text: 'Press SEND ALL to read the controls', urgent: true };
  const { queue, sceneIndex } = view.launcher, now = beatAt(view.clock, performance.timeOrigin + performance.now());
  const beatsTo = (beat: number) => { const n = Math.max(0, Math.ceil(beat - now)); return `${n} beat${n === 1 ? '' : 's'}`; };
  const scene = queue.find(l => l.sceneIndex !== null);
  if (scene) return { text: `NEXT: ${set.scenes[scene.sceneIndex!]?.name ?? 'Scene'} in ${beatsTo(scene.beat)}`, urgent: false };
  if (queue[0]) return { text: `NEXT: ${set.zones[queue[0].changes[0]?.zone]?.name ?? 'Zone'} in ${beatsTo(queue[0].beat)}`, urgent: false };
  if (sceneIndex < 0) return { text: 'Press BANK ▶ to launch the first scene', urgent: true };
  if (view.controls.master === 0) return { text: 'Master is down: the room is black', urgent: true };
  const up = set.scenes[sceneIndex + 1];
  return { text: up ? `Up next: ${up.name}` : 'Last scene', urgent: false };
}

const audioWord = (a: PerformView['audio']) => a.state === 'on' ? (a.label === REHEARSAL ? 'rehearsal' : a.label === REHEARSAL_PAUSED ? 'paused' : 'on') : a.state === 'starting' ? 'starting' : a.state === 'off' ? 'off' : a.state === 'refused' ? 'not allowed' : 'lost';
const audioTone = (a: PerformView['audio']) => a.state === 'on' ? 'good' : a.state === 'off' || a.state === 'starting' ? 'quiet' : 'bad';

export default function PerformPanel({ header, onError, onEditClip, onCopyClip, draftName, onOpenDraft }: { header: ReactNode; onError: (message: string) => void; onEditClip: (sourceId: string, name: string) => void; onCopyClip: (copy: ClipCopy) => void; /** A clip draft left open in Studio. */ draftName: string | null; onOpenDraft: () => void }) {
  const map = useMap(onError);
  const perform = usePerform();
  const { view, service } = perform;
  const set = map.show.performance;
  const [looksOpen, setLooksOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ row: number; zone: number } | null>(null);
  const [zoneMenu, setZoneMenu] = useState<{ x: number; y: number; zone: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [launchMenu, setLaunchMenu] = useState<{ x: number; y: number } | null>(null);
  const closeLaunchMenu = useCallback(() => setLaunchMenu(null), []);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string) => { setNote(text); if (noteTimer.current) clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(null), 6000); }, []);
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);
  // Rehearsal lives in the engine, so it is still there after a trip to another section.
  const [, soundChanged] = useReducer((n: number) => n + 1, 0);
  const soundEngine = map.engine ?? reactivityIfStarted();
  useEffect(() => soundEngine ? soundEngine.onChange(soundChanged) : undefined, [soundEngine]);
  const rehearsal = soundEngine?.audio.rehearsal ?? null;
  const shownAudio = rehearsal && soundEngine ? soundEngine.audio.status : view.audio;
  const mixPicker = useRef<HTMLInputElement>(null);
  /** The file is read into memory here and goes no further than the audio engine. */
  const playMix = async (file: File) => {
    try { await map.startEngine().rehearse(await file.arrayBuffer()); }
    catch { say('That file could not be played as audio. The sound input is unchanged.'); }
  };
  const stopRehearsal = async () => {
    if (!soundEngine) return;
    await soundEngine.rehearse(null);
    if (['lost', 'missing', 'failed', 'refused'].includes(soundEngine.audio.status.state)) say(`Your sound input is not available. ${service.running ? 'The show keeps running on the held tempo.' : 'Check it is plugged in, or choose another.'}`);
  };
  useEffect(() => { window.__studioTest = { ...window.__studioTest, performSet: () => map.currentShow().performance }; }, [map.currentShow]);
  useEffect(() => { map.setReactivityPanel(soundOpen); if (soundOpen) map.startEngine(); return () => map.setReactivityPanel(false); }, [soundOpen]);
  // Grid edits undo here, as Map's do there. A step the running show cannot take says why.
  useEffect(() => { if (map.lastRefusal && /^(That undo|Map scenes|End the Perform)/.test(map.lastRefusal)) say(map.lastRefusal); }, [map.lastRefusal, say]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.code !== 'KeyZ' || keysBelongElsewhere(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) map.redo(); else map.undo();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [map.undo, map.redo]);

  /** What the running show still needs, so an edit can never pull a clip out from under it. */
  const inUse = () => clipsInUse(service.view().launcher);
  const apply = (action: EditAction) => {
    const ok = map.dispatch(action);
    if (!ok) say(REFUSALS[map.currentRefusal() ?? ''] ?? 'That change could not be made.');
    return ok;
  };
  const edit = (next: PerformanceSet) => apply({ type: 'setPerformance', performance: next });
  const current = () => map.currentShow().performance;

  const fillCell = (row: number, zone: number, look: string) => {
    const base = current();
    if (look === 'live') { edit(placeClip(base, row, zone, newClip('Live', LIVE_SOURCE_ID), inUse())); return; }
    if (look === 'video') {
      void window.studio?.map?.chooseVideo().then(file => {
        if (!file) return;
        const videoId = `video-${stamp()}`;
        apply({ type: 'addClipVideo', videoId, path: file.path, name: file.name, performance: placeClip(current(), row, zone, newClip(file.name, videoId), inUse()) });
      });
      return;
    }
    const preset = PRESETS.find(p => `preset:${p.id}` === look);
    const project = preset && presetComposition(preset.id, randomSeed());
    if (!preset || !project) return;
    const sourceId = newSourceId();
    apply({ type: 'addClipSource', sourceId, project, performance: placeClip(base, row, zone, newClip(preset.name, sourceId), inUse()) });
  };
  /** One draft at a time, so a second edit can never replace one that has not been applied. */
  const draftInTheWay = () => { if (draftName !== null) say(`Apply or discard the draft of ${draftName} first.`); return draftName !== null; };
  const editClip = (row: number, zone: number) => {
    const base = current(), clip = base.clips.find(c => c.id === base.scenes[row]?.cells[zone]);
    if (!clip || clip.sourceId === LIVE_SOURCE_ID || isVideoId(clip.sourceId) || draftInTheWay()) return;
    onEditClip(clip.sourceId, clip.name);
  };
  const duplicate = (row: number, zone: number) => {
    const base = current(), clipId = base.scenes[row]?.cells[zone], clip = base.clips.find(c => c.id === clipId), show = map.currentShow();
    if (!clip || clip.sourceId === LIVE_SOURCE_ID) return;
    if (!isVideoId(clip.sourceId) && draftInTheWay()) return;
    const name = `${clip.name.slice(0, 35)} copy`;
    if (isVideoId(clip.sourceId)) {
      const video = show.videos.find(v => v.id === clip.sourceId);
      if (!video) return;
      const videoId = `video-${stamp()}`, copy = { ...newClip(name, videoId), hueOffset: clip.hueOffset, blend: clip.blend, audioBand: clip.audioBand };
      apply({ type: 'addClipVideo', videoId, path: video.path, name: video.name, speed: video.speed, tempoSync: video.tempoSync, performance: placeClip(base, row, zone, copy, inUse()) });
      return;
    }
    const source = show.sources.find(s => s.id === clip.sourceId);
    if (!source) return;
    const sourceId = newSourceId(), copy = { ...newClip(name, sourceId), hueOffset: clip.hueOffset, blend: clip.blend, audioBand: clip.audioBand };
    // During a show the copy is made at Apply, so a Discard leaves the show exactly as it was.
    if (service.running) { onCopyClip({ fromSourceId: source.id, sourceId, clip: copy, row, zone }); return; }
    if (!apply({ type: 'addClipSource', sourceId, project: structuredClone(source.project), speed: source.speed, tempoSync: source.tempoSync, performance: placeClip(base, row, zone, copy, inUse()) })) return;
    onEditClip(sourceId, name);
  };

  const actions: GridActions = {
    dropLook: fillCell,
    linkClip: (row, zone, clipId) => { edit(setCell(current(), row, zone, clipId, inUse())); },
    clear: (row, zone) => { edit(setCell(current(), row, zone, null, inUse())); },
    duplicate,
    editClip,
    setBlend: (clipId, blend) => { edit(changeClip(current(), clipId, { blend })); },
    setBand: (clipId, audioBand) => { edit(changeClip(current(), clipId, { audioBand })); },
    setTiming: (sourceId, beats) => { apply({ type: 'setTempoSync', sourceId, beats }); },
    addScene: () => { if (service.running) say('End the show to add a scene.'); else edit(addRow(current(), `pscene-${stamp()}`)); },
    removeScene: row => { if (service.running) say('End the show before deleting a scene.'); else edit(removeRow(current(), row)); },
    renameScene: (row, name) => { edit(changeRow(current(), row, { name })); },
    setIncludeCeiling: (row, includeProtected) => { edit(changeRow(current(), row, { includeProtected })); },
    chooseZone: (zone, x, y) => { if (service.running) say('Zones stay as they are during a show. End the show to change them.'); else setZoneMenu({ x, y, zone }); },
    clickCell: (row, zone) => {
      if (!service.running) { setSelected({ row, zone }); setLooksOpen(true); return; }
      if (!current().scenes[row]?.cells[zone]) return;
      if (service.view().controls.ready) service.action({ type: 'launchCell', row, zone }); else say('Press Send All first.');
    },
    clickScene: row => {
      if (!service.running) return;
      if (service.view().controls.ready) service.action({ type: 'launchScene', row }); else say('Press Send All first.');
    },
    fillCell: (row, zone) => { setSelected({ row, zone }); setLooksOpen(true); },
  };
  const zoneEntries = (zone: number): MenuEntry[] => {
    const show: ShowDocument = map.show, target = set.zones[zone].target;
    // A place belongs to one zone: a second zone on it would stay dark.
    const takenBy = (kind: 'group' | 'shape', id: string) => set.zones.findIndex((z, i) => i !== zone && z.target?.kind === kind && z.target.id === id);
    const named = (name: string, other: number) => other >= 0 ? `${name} (zone ${other + 1})` : name;
    const groups = show.groups.map((g): MenuEntry => ({ kind: 'item', label: named(g.name, takenBy('group', g.id)), disabled: takenBy('group', g.id) >= 0, checked: target?.kind === 'group' && target.id === g.id, onSelect: () => { edit(assignZone(current(), zone, { kind: 'group', id: g.id }, g.name)); } }));
    const shapes = show.shapes.filter(s => !s.blocker && s.groupId === null).map((s): MenuEntry => ({ kind: 'item', label: named(s.name, takenBy('shape', s.id)), disabled: takenBy('shape', s.id) >= 0, onSelect: () => { edit(assignZone(current(), zone, { kind: 'shape', id: s.id }, s.name)); } }));
    return [
      ...groups, ...(groups.length && shapes.length ? [{ kind: 'separator' } as MenuEntry] : []), ...shapes,
      ...(groups.length + shapes.length === 0 ? [{ kind: 'item', label: 'Draw shapes in Map first', disabled: true, onSelect: () => {} } as MenuEntry] : []),
      { kind: 'separator' },
      { kind: 'item', label: 'Use Map groups in order', disabled: !show.groups.length, onSelect: () => { edit(zonesFromGroups(current(), show.groups)); } },
      { kind: 'item', label: 'No place', disabled: !target, onSelect: () => { edit(assignZone(current(), zone, null)); } },
    ];
  };

  /** A show never inherits Map's Test grid or Freeze unseen. The look list closes so the whole grid is there to play. */
  const startShow = () => {
    const cleared = [map.testGrid ? 'Test grid' : '', map.freeze ? 'Freeze' : ''].filter(Boolean);
    if (map.testGrid) map.setTestGrid(false);
    if (map.freeze) map.setFreeze(false);
    setLooksOpen(false);
    startPerformShow();
    if (cleared.length) say(`${cleared.join(' and ')} turned off for the show.`);
  };
  /** A one-time copy of Map's scenes into new rows. Map stays as it is, and it is one undo step. */
  const importScenes = () => {
    if (service.running) { say('End the show to import Map scenes.'); return; }
    const show = map.currentShow(), before = show.performance, mapScenes = show.scenes.length;
    if (mapScenes === 0) { say('Map has no scenes to import.'); return; }
    if (!before.zones.some(z => z.target)) { say('Give a zone a place first, so there is something to copy.'); return; }
    const next = importMapScenes(show, () => `p${stamp()}`);
    const added = next.scenes.length - before.scenes.length;
    if (added <= 0) { say(`The set already has ${MAX_PERFORM_SCENES} scenes, so none were imported.`); return; }
    if (!edit(next)) return;
    const skipped = mapScenes - added;
    const fresh = next.scenes.slice(before.scenes.length), ceilingClip = fresh.some(sc => sc.cells.some((c, z) => c !== null && next.zones[z].protected));
    say(`Imported ${added} Map scene${added === 1 ? '' : 's'}${skipped > 0 ? `; ${skipped} skipped because the set holds ${MAX_PERFORM_SCENES}` : ''}.${ceilingClip ? ' Imported scenes leave the ceiling alone until you switch it on for the scene.' : ''}`);
  };
  const timed = useMemo(() => Object.fromEntries(set.clips.filter(c => view.prepareMs[c.sourceId] !== undefined).map(c => [c.id, view.prepareMs[c.sourceId]])), [set.clips, view.prepareMs]);
  const canStart = map.loaded && set.scenes.some(s => s.cells.some(c => c !== null));
  const line = nextLine(view, set, canStart);
  const shownLooks = useMemo(() => { const q = query.trim().toLowerCase(); return LOOKS.filter(l => !q || `${l.name} ${l.group}`.toLowerCase().includes(q)); }, [query]);
  const stateWord = view.clock.state.toUpperCase();
  const beatInBar = view.running ? ((Math.floor(beatAt(view.clock, performance.timeOrigin + performance.now()) - view.clock.barOffset) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR : -1;
  const midiWord = view.midi === 'connected' ? 'on' : view.midi === 'lost' ? 'lost' : 'on screen';
  const fps = map.wallState?.fps;

  return <section className="live-shell pf-shell" role="region" aria-label="Perform">
    <header className="app-header">{header}
      <div className="pf-health">
        <button type="button" className="pf-head-btn" aria-expanded={checkOpen} title="List anything likely to go wrong. Changes nothing." onClick={() => setCheckOpen(o => !o)}>Check Set</button>
        <button type="button" className="pf-head-btn" disabled={view.running} title={view.running ? 'End the show to import Map scenes' : "Copy Map's scenes into new rows. Map stays as it is."} onClick={importScenes}>Import Map scenes</button>
        <button type="button" className="pf-head-btn" disabled={!map.canUndo} title="Undo a grid edit · ⌘Z" onClick={map.undo}>Undo</button>
        <button type="button" className="pf-head-btn" disabled={!map.canRedo} title="Redo · ⇧⌘Z" onClick={map.redo}>Redo</button>
        <span className={`pf-pill ${map.outputOpen ? 'good' : 'quiet'}`}><i />WALL {map.outputOpen ? (fps ? `${fps} fps` : 'open') : 'closed'}</span>
        <span className={`pf-pill ${view.midi === 'lost' ? 'bad' : view.midi === 'connected' ? 'good' : 'quiet'}`}><i />MIDImix {midiWord}</span>
        <button type="button" className={`pf-pill ${audioTone(shownAudio)}`} aria-expanded={soundOpen} title="Choose the sound input" onClick={() => setSoundOpen(o => !o)}><i />AUDIO {audioWord(shownAudio)}</button>
        {map.outputOpen
          ? <button type="button" className="pf-head-btn" onClick={map.closeOutput}>Close projector</button>
          : <button type="button" className="pf-head-btn" disabled={!map.desktop || map.display === null} onClick={() => void map.openOutput()}>Open projector</button>}
      </div>
    </header>
    <div className="pf-status">
      <div className="pf-tempo">
        <strong>{view.running ? view.clock.bpm.toFixed(1) : '---'}</strong><span>BPM</span>
        <span className="pf-beats" aria-hidden>{[0, 1, 2, 3].map(i => <i key={i} className={i === beatInBar ? 'on' : ''} />)}</span>
        <span className={`pf-lock ${view.clock.state}`} title="The clock's best guess. If launches land wrong, press Tap in time, then Follow.">{view.running ? stateWord : 'STOPPED'}</span>
      </div>
      {/* Not a native select: one would keep the keyboard after closing, and the controller keys would silently stop. */}
      <div className="pf-launch">Launch<button type="button" aria-label="Launch timing" aria-haspopup="menu" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setLaunchMenu({ x: r.left, y: r.bottom + 4 }); }}>{QUANTIZE.find(q => q.value === set.launchQuantize)?.label} ▾</button></div>
      <div className={`pf-next ${line.urgent ? 'urgent' : ''}`} role="status">{line.text}</div>
      {(map.freeze || map.testGrid) && <div className="pf-flags">
        {map.freeze && <button type="button" aria-label="Frozen: turn off" onClick={() => map.setFreeze(false)}>FROZEN ✕</button>}
        {map.testGrid && <button type="button" aria-label="Test grid: turn off" onClick={() => map.setTestGrid(false)}>TEST GRID ✕</button>}
      </div>}
      <div className="pf-clock-keys">
        <button type="button" className="pf-key" disabled={!view.running} title="Space" onClick={() => service.action({ type: 'tap' })}>Tap</button>
        <button type="button" className={`pf-key ${view.running && view.clock.state === 'manual' ? 'attention' : ''}`} disabled={!view.running} title="F · go back to following the music" onClick={() => service.action({ type: 'follow' })}>Follow</button>
        <button type="button" className="pf-key one" disabled={!view.running} title="Press exactly on the real downbeat · Solo + Bank ◀" onClick={() => service.action({ type: 'downbeat' })}>This is the 1</button>
      </div>
      <div className="pf-show-keys">
        <button type="button" className={`pf-key black ${map.blackout ? 'on' : ''}`} aria-pressed={map.blackout} onClick={() => map.setBlackout(!map.blackout)}>Black</button>
        {view.running
          ? <button type="button" className="pf-key end" onClick={() => setConfirming(true)}>End show</button>
          : <button type="button" className="pf-key start" disabled={!canStart} title={canStart ? 'Start the show. The room stays black until Send All and Bank ▶.' : 'Add a scene with a clip first'} onClick={startShow}>Start show</button>}
      </div>
    </div>
    {/* Always there at one height, so a note appearing never moves the grid during a show. */}
    <div className="pf-notice-row">
      <div className="pf-notices" role="status" title={[note, ...view.notices].filter(Boolean).join('\n')}>
        {draftName !== null && <span>Draft of {draftName} is open <button type="button" className="pf-head-btn" onClick={onOpenDraft}>Back to draft</button></span>}
        {note && <span>{note}</span>}
        {view.stuck.length > 0 && <span className="bad"><i className="pf-dot-red" />{view.stuck.length === 1 ? 'A look is' : `${view.stuck.length} looks are`} too heavy to get ready. The zone keeps its current look.</span>}
        {view.notices.map(n => <span key={n} className="bad">{n}</span>)}
      </div>
      <div className="pf-rehearse" role="group" aria-label="Rehearsal">
        <input ref={mixPicker} type="file" hidden accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.aif,.aiff,.ogg" aria-label="Rehearsal file"
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void playMix(file); }} />
        {rehearsal
          ? <>
            <button type="button" className="pf-head-btn" aria-label={rehearsal === 'paused' ? 'Play rehearsal' : 'Pause rehearsal'} onClick={e => { e.currentTarget.blur(); soundEngine?.audio.pauseFile(rehearsal === 'playing'); }}>{rehearsal === 'paused' ? 'Play' : 'Pause'}</button>
            <button type="button" className="pf-head-btn" aria-label="Stop rehearsal" title="Stop and go back to the chosen sound input" onClick={e => { e.currentTarget.blur(); void stopRehearsal(); }}>Stop</button>
            <button type="button" className="pf-head-btn" title="Play a different recorded mix" onClick={e => { e.currentTarget.blur(); mixPicker.current?.click(); }}>Change mix</button>
          </>
          : <button type="button" className="pf-head-btn" title="Practise with a recorded mix. It plays to the speakers and is never saved." onClick={e => { e.currentTarget.blur(); mixPicker.current?.click(); }}>Rehearse</button>}
      </div>
    </div>
    <div className="pf-main">
      {/* The list sits beside the grid, so every cell stays reachable and the controller is never covered during a show. */}
      <div className="pf-grid-area">
        <PerformGrid set={set} show={map.show} view={view} selected={selected} actions={actions} />
        {looksOpen && <aside className={`pf-looks ${selected && selected.zone >= 4 ? 'left' : ''}`} aria-label="Looks">
          <div className="pf-looks-head"><strong>{selected ? `${set.scenes[selected.row]?.name ?? 'Scene'} · ${set.zones[selected.zone].name}` : 'Looks'}</strong>
            <button type="button" className="pf-head-btn" aria-label="Close looks" onClick={() => setLooksOpen(false)}>Close</button></div>
          <input type="search" aria-label="Search looks" placeholder="Search looks…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.stopPropagation()} />
          <p>{view.running ? 'Click to fill the chosen cell.' : 'Click to fill the chosen cell, or drag on to any cell.'}</p>
          <div className="pf-look-list">{shownLooks.map(l => <button key={l.value} type="button" draggable={!view.running} data-pf-look={l.value} className="pf-look"
            onDragStart={e => { e.dataTransfer.setData(LOOK_DRAG, l.value); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => { if (selected) fillCell(selected.row, selected.zone, l.value); else say('Click a cell first.'); }}>
            <span className="pf-look-art">{l.art && <img src={l.art} alt="" />}</span><span><b>{l.name}</b><small>{l.group}</small></span></button>)}</div>
        </aside>}
      </div>
      <ControllerSurface view={view} set={set} held={perform.held} press={perform.press} release={perform.release} control={e => service.control(e)} sendAll={perform.sendAll} />
    </div>
    {launchMenu && <MapMenu x={launchMenu.x} y={launchMenu.y} label="Launch timing" onClose={closeLaunchMenu} entries={QUANTIZE.map((q): MenuEntry => ({ kind: 'item', label: q.label, checked: set.launchQuantize === q.value, onSelect: () => { edit({ ...current(), launchQuantize: q.value }); } }))} />}
    {soundOpen && <aside className="pf-sound" aria-label="Sound input" data-controller-keys onChange={e => (e.target as HTMLElement).blur()}
      onKeyDown={e => { if (e.key === 'Escape' && (e.target as HTMLElement).tagName === 'SELECT') (e.target as HTMLElement).blur(); }}
      onKeyUp={e => { if (e.key === 'Escape' && (e.target as HTMLElement).tagName === 'SELECT') (e.target as HTMLElement).blur(); }}>
      <div className="pf-looks-head"><strong>Sound input</strong><button type="button" className="pf-head-btn" aria-label="Close sound input" onClick={() => setSoundOpen(false)}>Close</button></div>
      <ReactDevices audioOnly engine={map.engine} meter={map.signals} onStart={() => map.startEngine()} />
    </aside>}
    {checkOpen && <aside className="pf-sound pf-check" aria-label="Check Set" data-controller-keys>
      <div className="pf-looks-head"><strong>Check Set</strong><button type="button" className="pf-head-btn" aria-label="Close Check Set" onClick={() => setCheckOpen(false)}>Close</button></div>
      <ul>{checkSet(map.show, { bpm: view.running ? view.clock.bpm : undefined, prepareMs: timed }).map((r, i) => <li key={i} className={r.level}><b>{r.level === 'error' ? 'Problem' : 'Check'}</b> {r.message}</li>)}</ul>
    </aside>}
    {zoneMenu && <MapMenu x={zoneMenu.x} y={zoneMenu.y} label={`Place for zone ${zoneMenu.zone + 1}`} entries={zoneEntries(zoneMenu.zone)} onClose={() => setZoneMenu(null)} />}
    {confirming && <div className="pf-confirm" role="dialog" aria-modal="true" aria-label="End the show?" onKeyDown={e => { if (e.key === 'Escape') setConfirming(false); }}>
      <div><h2>End the show?</h2><p>The projector stays on and goes back to Map's picture.</p>
        <div className="pf-confirm-keys"><button type="button" autoFocus className="pf-key" onClick={() => setConfirming(false)}>Keep playing</button>
          <button type="button" className="pf-key end" onClick={() => { perform.endShow(); setConfirming(false); }}>End show now</button></div></div>
    </div>}
  </section>;
}
