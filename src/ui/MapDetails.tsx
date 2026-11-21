import { useEffect, useRef, useState } from 'react';
import type { useMap } from './useMap';
import { mapActions, newSourceId, randomSeed } from './mapActions';
import { kindArt } from './kindArt';
import { LookPreviews } from './lookPreviews';
import { parsePixelField } from '../map/geometry';
import { isCurved } from '../map/outline';
import { shouldCommit } from '../map/keys';
import type { Shape } from '../map/show';
import { BORDER_MAX, BRIGHTNESS_MAX, GLOW_MAX, MAX_NAME_LENGTH, SOFT_EDGE_MAX, SPEED_RANGE, STAGE_SIZE, ZOOM_RANGE, isShapeLocked, type Placement, type PlacementKind } from '../map/show';
import { ownCornersPinnable } from '../map/placement';
import { REACTIONS, reactionLinks, reactsLabel, targetRange, type Reaction } from '../map/targets';
import { LIVE_SOURCE_ID, RUN_LAPS, RUN_LENGTH, STAGGER_MAX, TEMPO_SYNC_BEATS, isVideoId, type FollowOutline, type Group } from '../map/show';
import { isInstrument } from '../core/instruments';
import MapLiveCard from './MapLiveCard';
import MapVideoPanel from './MapVideoPanel';
import MapEffectTab from './MapEffectTab';
import MapSoundTab from './MapSoundTab';
import { LOOK_LABELS } from '../live/settings';
import { ReactTo, linkFor } from './ReactControls';
import { newItemId } from './mapActions';
import { signalLabel } from '../react/signals';
import { PRESETS } from '../core/project';
import { KIND_LABELS } from '../core/library';
import { ACID_DRIP, CANDY, CYAN_YELLOW, ELECTRIC, HOT_SIGNAL, LIME_VIOLET, NEON_STRATA, POP_PORTAL, POUR, SOLAR } from '../core/palettes';

type Map = ReturnType<typeof useMap>;

/** The Library, grouped as Studio groups it. */
const LIBRARY = Object.entries(PRESETS.reduce<Record<string, typeof PRESETS>>((groups, preset) => {
  (groups[preset.kind] ??= []).push(preset);
  return groups;
}, {})).map(([kind, presets]) => ({ label: KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind, presets }));
const PALETTES: [string, string[]][] = [
  ['Neon strata', NEON_STRATA], ['Acid drip', ACID_DRIP], ['Pop portal', POP_PORTAL], ['Hot signal', HOT_SIGNAL], ['Lime violet', LIME_VIOLET],
  ['Electric', ELECTRIC], ['Candy', CANDY], ['Solar', SOLAR], ['Cyan yellow', CYAN_YELLOW], ['Pour', POUR],
];
/** Tints for evening out surfaces: none, warm, cool, and a few stronger ones. */
const TINTS: [string, string][] = [['None', '#ffffff'], ['Warm', '#ffe2c4'], ['Cool', '#d6e6ff'], ['Rose', '#ffd0dc'], ['Green', '#d8ffd0'], ['Dim amber', '#ffc070']];
const paletteName = (palette: string[]) => PALETTES.find(([, colours]) => colours.join() === palette.join())?.[0] ?? '';

/** A text box that keeps its own draft and hands it over on blur or Enter. */
export function CommitField({ label, value, onCommit, narrow, maxLength, disabled }: { label: string; value: string; onCommit: (text: string) => void; narrow?: boolean; maxLength?: number; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const start = useRef(value); // the text shown when the box was focused
  useEffect(() => { setDraft(value); start.current = value; }, [value]);
  const commit = () => {
    const changed = shouldCommit(start.current, draft);
    if (changed) onCommit(draft);
    setDraft(value); start.current = value;
  };
  return <label className="map-field">{label}<input aria-label={label} className={narrow ? 'narrow' : ''} maxLength={maxLength} value={draft} disabled={disabled} onFocus={() => { start.current = value; }} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} /></label>;
}

/** A slider that shows its value while it moves and commits once, when let go: one undo step per change. */
function SliderField({ label, value, min, max, step, unit, disabled, onCommit, format, react }: { label: string; value: number; min: number; max: number; step: number; unit?: string; disabled?: boolean; onCommit: (value: number) => void; format?: (v: number) => string; react?: { map: Map; target: string } }) {
  const [draft, setDraft] = useState<number | null>(null);
  const commit = () => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null); };
  const shown = draft ?? value;
  const field = <label className="map-field">{label} · {format ? format(shown) : `${Math.round(shown)}${unit ?? ''}`}
    <input aria-label={label} type="range" min={min} max={max} step={step} value={shown} disabled={disabled}
      onChange={e => setDraft(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /></label>;
  return react ? <div className="map-react-field">{field}<ReactButton map={react.map} target={react.target} label={label} disabled={disabled} /></div> : field;
}

/** ∿ beside a slider: make that setting react to sound or MIDI, or stop it reacting. */
function ReactButton({ map, target, label, disabled }: { map: Map; target: string; label: string; disabled?: boolean }) {
  const links = map.show.links.filter(l => l.target === target);
  return <ReactTo label={label} target={target} linked={links.length} engine={map.engine} disabled={disabled} onStart={map.startEngine}
    onAdd={input => map.dispatch({ type: 'addLink', link: linkFor(newItemId('link'), input, target, '') })}
    onStop={() => map.dispatch({ type: 'removeLinks', target })} />;
}

/** The Details tab last chosen, kept while the app is open. */
let lastTab: 'shape' | 'effect' | 'sound' = 'shape';

/** The Details panel: the selected shape's name, colour, what it plays, its edge, shape tools and its chosen point. */
export default function MapDetails({ map, onEditInStudio, setNote, onOpenLooks, linked, setLinked, liveStatus = null, videoStatus = {} }: { videoStatus?: Record<string, { state: string; playsAs: number | null }>; liveStatus?: { running: boolean; state: string } | null; map: Map; onEditInStudio?: (sourceId: string, shapeId: string) => void; setNote: (text: string | null) => void; onOpenLooks: () => void; linked: boolean; setLinked: (on: boolean) => void }) {
  const act = mapActions(map);
  const [tab, setTab] = useState<'shape' | 'effect' | 'sound'>(lastTab);
  const chooseTab = (t: 'shape' | 'effect' | 'sound') => { lastTab = t; setTab(t); };
  const [grid, setGrid] = useState({ rows: '2', cols: '2', gap: '0', spread: true });
  const many = map.selectedIds.length > 1;
  const shape = map.show.shapes.find(s => s.id === map.selectedId) ?? null;
  const locked = shape ? isShapeLocked(map.show, shape) : false;
  const source = shape?.sourceId ? map.show.sources.find(s => s.id === shape.sourceId) ?? null : null;
  const group = shape?.groupId ? map.show.groups.find(g => g.id === shape.groupId) ?? null : null;
  const ring = shape && map.selectedIndex !== null ? (map.selectedRing < 0 ? shape.points : shape.holes[map.selectedRing]) : null;
  const point = ring && map.selectedIndex !== null ? ring[map.selectedIndex] ?? null : null;
  // Shapes playing this shape's instrument, and other shapes whose instrument it could share.
  const sharers = source ? map.show.shapes.filter(s => s.sourceId === source.id) : [];
  const playing = shape ? map.show.shapes.filter(s => s.id !== shape.id && s.sourceId !== null && s.sourceId !== shape.sourceId) : [];
  const place = shape?.placement ?? { kind: 'fit' as PlacementKind, zoom: 1, offset: { x: 0, y: 0 }, turn: 0, pin: null };
  const setPlacement = (change: Partial<Placement>) => { if (shape) map.dispatch({ type: 'setPlacement', shapeId: shape.id, placement: change }); };

  if (many) {
    const ids = act.selected();
    const anyLocked = map.show.shapes.some(s => ids.includes(s.id) && isShapeLocked(map.show, s));
    // Several shapes playing one instrument are that one instrument: its card, as for a single shape.
    const first = map.show.shapes.find(s => s.id === map.selectedId);
    const one = !!first?.sourceId && ids.every(id => map.show.shapes.find(s => s.id === id)?.sourceId === first.sourceId);
    return <>
      <p>{ids.length} shapes selected{one ? ', one instrument' : ''}</p>
      {one && first && <ContentCard setNote={setNote} map={map} shape={first} locked={anyLocked} onOpenLooks={onOpenLooks} onEditInStudio={onEditInStudio} linked setLinked={() => {}} whole />}
      <p className="muted-text">Drag any of them to move them all; drag the box corners to scale, the round handle to turn. Shift-click a shape to add or remove it.</p>
      <div className="map-toggles"><button className="text-button" disabled={anyLocked} title="Put these shapes in a folder · ⌘G" onClick={() => act.group(ids)}>Group</button>
        <button className="text-button" title="Copy these shapes · ⌘D" onClick={() => act.duplicate(ids)}>Duplicate</button>
        <button className="text-button danger-button" disabled={anyLocked} onClick={() => act.remove(ids)}>Delete shapes</button></div>
      <ShapeTools act={act} ids={ids} locked={anyLocked} />
      {(() => { const g = first?.groupId ? map.show.groups.find(x => x.id === first.groupId) : undefined; return g && ids.every(id => map.show.shapes.find(s => s.id === id)?.groupId === g.id) ? <GroupCard map={map} group={g} /> : null; })()}
    </>;
  }
  if (!shape) return <p className="muted-text">Pick a shape to see its details. Shift-click or drag a box on the stage to pick several.</p>;

  const reacts = reactsLabel(map.show, shape.id);
  const commitName = (text: string) => { const name = text.trim(); if (name && name !== shape.name) map.dispatch({ type: 'rename', shapeId: shape.id, name }); };
  const commitColour = (text: string) => {
    const colour = text.trim();
    if (!/^#[0-9a-f]{6}$/i.test(colour)) { setNote('Colour must look like #rrggbb'); return; }
    setNote(null);
    if (colour !== shape.colour) map.dispatch({ type: 'setColour', shapeId: shape.id, colour });
  };
  const choosePlays = (value: string) => {
    if (value === 'colour' || value === 'grid') map.dispatch({ type: 'setContent', shapeId: shape.id, content: { kind: value } });
    else if (value.startsWith('preset:')) map.dispatch({ type: 'setContent', shapeId: shape.id, content: { kind: 'preset', presetId: value.slice('preset:'.length), sourceId: newSourceId(), seed: randomSeed() } });
  };
  const commitPosition = (axis: 'x' | 'y', text: string) => {
    if (!point || map.selectedIndex === null) return;
    const px = parsePixelField(text, { min: 0, max: axis === 'x' ? STAGE_SIZE.width : STAGE_SIZE.height });
    if (px === null) return;
    const to = axis === 'x' ? { x: px / STAGE_SIZE.width, y: point.y } : { x: point.x, y: px / STAGE_SIZE.height };
    if (to.x === point.x && to.y === point.y) return;
    map.dispatch({ type: 'movePoint', shapeId: shape.id, ring: map.selectedRing, index: map.selectedIndex, to, joined: map.snap });
  };
  const border = shape.border;
  const borderMode = border.colour === 'shape' || border.colour === 'palette' ? border.colour : 'fixed';
  const setBorder = (changes: Partial<typeof border>) => map.dispatch({ type: 'setBorder', shapeId: shape.id, border: { ...border, ...changes } });
  const gridReady = shape.points.length === 4 && !shape.points.some(isCurved) && shape.holes.length === 0;
  const makeGrid = () => {
    const rows = Number(grid.rows), cols = Number(grid.cols), gap = Number(grid.gap);
    if (![rows, cols].every(n => Number.isInteger(n) && n >= 1 && n <= 16) || rows * cols < 2) { setNote('A grid needs 1 to 16 rows and columns, and at least two cells'); return; }
    if (!Number.isFinite(gap) || gap < 0) { setNote('The gap must be a number of pixels, 0 or more'); return; }
    setNote(null);
    act.makeGrid(shape.id, rows, cols, gap, grid.spread);
  };

  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const placeLabel = { fit: 'Fit', pin: 'Pin', 'across-group': 'Across group', 'across-stage': 'Across stage' }[place.kind];
  const edgeSummary = [shape.softEdge ? `soft ${Math.round(shape.softEdge)} px` : '', border.width ? `border ${Math.round(border.width)} px${border.run ? ', running' : ''}` : ''].filter(Boolean).join(' · ') || 'none';

  return <>
    <div className="map-detail-head">
      <label className="map-colour" title="The shape's colour"><input type="color" aria-label="Colour" value={shape.colour} disabled={locked} onChange={e => commitColour(e.target.value)} /></label>
      <CommitField label="Name" value={shape.name} onCommit={commitName} maxLength={MAX_NAME_LENGTH} />
    </div>
    {group && <div className="map-group-line"><span className="muted-text">In</span>
      <CommitField label="Group name" value={group.name} maxLength={MAX_NAME_LENGTH} disabled={group.locked} onCommit={text => { const name = text.trim(); if (name && name !== group.name) map.dispatch({ type: 'renameGroup', groupId: group.id, name }); }} />
      <button className="text-button" disabled={group.locked} title="Dissolve this group; its shapes stay · ⇧⌘G" onClick={() => act.ungroup(group.id)}>Ungroup</button></div>}


    <div className="map-inspector-tabs" role="tablist" aria-label="Shape panels">
      {(['shape', 'effect', 'sound'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => chooseTab(t)}>
        {t === 'shape' ? 'Shape' : t === 'effect' ? 'Effect' : <>Sound{reacts ? <small> {reacts}</small> : null}</>}</button>)}
    </div>
    {tab === 'shape' && <>
    {point && map.selectedIndex !== null && <div className="map-point">
      <h3>{map.selectedRing >= 0 ? `Hole ${map.selectedRing + 1}, ${isCurved(point) ? 'curve point' : 'corner'}` : isCurved(point) ? 'Curve point' : 'Corner'} {map.selectedIndex + 1}</h3>
      <div className="map-xy">
        <CommitField label="X" value={String(Math.round(point.x * STAGE_SIZE.width))} onCommit={t => commitPosition('x', t)} narrow disabled={locked} />
        <CommitField label="Y" value={String(Math.round(point.y * STAGE_SIZE.height))} onCommit={t => commitPosition('y', t)} narrow disabled={locked} />
      </div>
      <div className="map-toggles">
        <button className="text-button" disabled={locked} title="Alt-click a point to switch it" onClick={() => map.dispatch({ type: 'setCurve', shapeId: shape.id, ring: map.selectedRing, index: map.selectedIndex!, curved: !isCurved(point) })}>{isCurved(point) ? 'Make corner' : 'Make curve'}</button>
        <button className="text-button" disabled={locked} title="Double-click a point to remove it" onClick={() => { if (map.dispatch({ type: 'removePoint', shapeId: shape.id, ring: map.selectedRing, index: map.selectedIndex! })) map.setSelection(shape.id); }}>Remove point</button>
      </div>
    </div>}

    {!shape.blocker && <Section id="placement" title="Placement" summary={placeLabel}>
      <label className="map-field">Picture<select aria-label="Placement" value={place.kind} disabled={locked} onChange={e => setPlacement({ kind: e.target.value as PlacementKind })}>
        <option value="fit">Fit: fills the shape</option>
        <option value="pin">Pin: in perspective on four corners</option>
        <option value="across-group">Across group: one picture over the group</option>
        <option value="across-stage">Across stage: one picture over the stage</option>
      </select></label>
      {place.kind === 'pin' && <p className="muted-text">{shape.placement.pin && !ownCornersPinnable(shape) ? 'Drag the four diamond handles on the stage onto the surface’s corners.' : 'The picture is laid on this shape’s four corners in perspective: drag the corners onto the surface’s corners.'}</p>}
      {place.kind === 'across-group' && !group && <p className="muted-text">This shape is in no group, so its picture spreads over the whole stage.</p>}
      {place.kind !== 'pin' && <>
        <SliderField key={`zoom-${shape.id}`} label="Zoom" value={place.zoom} min={ZOOM_RANGE.min} max={ZOOM_RANGE.max} step={0.01} disabled={locked} format={pct} onCommit={zoom => setPlacement({ zoom })} react={{ map, target: `shape.${shape.id}.zoom` }} />
        <SliderField key={`movex-${shape.id}`} label="Move across" value={place.offset.x * STAGE_SIZE.width} min={-STAGE_SIZE.width / 2} max={STAGE_SIZE.width / 2} step={1} unit=" px" disabled={locked} onCommit={x => setPlacement({ offset: { x: x / STAGE_SIZE.width, y: place.offset.y } })} react={{ map, target: `shape.${shape.id}.movex` }} />
        <SliderField key={`movey-${shape.id}`} label="Move up and down" value={place.offset.y * STAGE_SIZE.height} min={-STAGE_SIZE.height / 2} max={STAGE_SIZE.height / 2} step={1} unit=" px" disabled={locked} onCommit={y => setPlacement({ offset: { x: place.offset.x, y: y / STAGE_SIZE.height } })} react={{ map, target: `shape.${shape.id}.movey` }} />
        <SliderField key={`turn-${shape.id}`} label="Turn" value={place.turn} min={-180} max={180} step={1} unit="°" disabled={locked} onCommit={turn => setPlacement({ turn })} react={{ map, target: `shape.${shape.id}.turn` }} />
      </>}
      <div className="map-toggles">
        {place.kind !== 'pin' && <button className="text-button" disabled={locked || (place.zoom === 1 && place.turn === 0 && place.offset.x === 0 && place.offset.y === 0)} onClick={() => setPlacement({ zoom: 1, turn: 0, offset: { x: 0, y: 0 } })}>Reset picture</button>}
        {place.kind === 'pin' && shape.placement.pin && !ownCornersPinnable(shape) && <button className="text-button" disabled={locked} title="Put the four handles back at the shape's box" onClick={() => setPlacement({ pin: null })}>Reset pin</button>}
      </div>
    </Section>}

    {!shape.blocker && <Section id="look" title="Look" summary={<>{pct(shape.brightness)} {shape.tint !== '#ffffff' && <i className="map-dot" style={{ background: shape.tint }} />}</>}>
      <SliderField key={`bright-${shape.id}`} label="Brightness" value={shape.brightness} min={0} max={BRIGHTNESS_MAX} step={0.01} disabled={locked} format={pct} onCommit={brightness => map.dispatch({ type: 'setLook', shapeId: shape.id, brightness })} react={{ map, target: `shape.${shape.id}.brightness` }} />
      <div className="map-field">Tint<div className="map-tints" role="group" aria-label="Tint">{TINTS.map(([name, colour]) =>
        <button key={colour} type="button" className="map-tint" aria-pressed={shape.tint === colour} aria-label={`Tint ${name}`} title={name} disabled={locked} style={{ background: colour }}
          onClick={() => map.dispatch({ type: 'setLook', shapeId: shape.id, tint: colour })} />)}
        <label className="map-tint custom" title="Any tint"><input type="color" aria-label="Tint colour" value={shape.tint} disabled={locked} onChange={e => map.dispatch({ type: 'setLook', shapeId: shape.id, tint: e.target.value.toLowerCase() })} /></label></div></div>
    </Section>}

    {group && <GroupCard map={map} group={group} />}

    <Section id="edge" title="Edge" summary={edgeSummary}>
      <SliderField key={`soft-${shape.id}`} label="Soft edge" value={shape.softEdge} min={0} max={SOFT_EDGE_MAX} step={1} unit=" px" disabled={locked} onCommit={px => map.dispatch({ type: 'setSoftEdge', shapeId: shape.id, px })} />
      {!shape.blocker && <>
        <SliderField key={`border-${shape.id}`} label="Border" value={border.width} min={0} max={BORDER_MAX} step={1} unit=" px" disabled={locked} onCommit={width => setBorder({ width })} />
        {border.width > 0 && <>
          <label className="map-field">Border colour<select aria-label="Border colour" value={borderMode} disabled={locked}
            onChange={e => setBorder({ colour: e.target.value === 'fixed' ? shape.colour : e.target.value })}>
            <option value="shape">Shape colour</option>
            <option value="palette">Instrument palette</option>
            <option value="fixed">Fixed colour</option>
          </select></label>
          {borderMode === 'fixed' && <label className="map-field">Border fixed colour<input type="color" aria-label="Border hex" value={border.colour} disabled={locked} onChange={e => setBorder({ colour: e.target.value.toLowerCase() })} /></label>}
          <SliderField key={`glow-${shape.id}`} label="Glow" value={border.glow} min={0} max={GLOW_MAX} step={1} unit=" px" disabled={locked} onCommit={glow => setBorder({ glow })} />
          <BorderRunFields map={map} shape={shape} locked={locked} />
        </>}
      </>}
    </Section>

    <Section id="shape" title="Shape" summary={[shape.visible ? '' : 'hidden', shape.locked ? 'locked' : ''].filter(Boolean).join(' · ')}>
      <div className="map-toggles">
        <button className="text-button" aria-pressed={shape.visible} onClick={() => map.dispatch({ type: 'setVisible', shapeId: shape.id, visible: !shape.visible })}>{shape.visible ? 'Shown' : 'Hidden'}</button>
        <button className="text-button" aria-pressed={shape.locked} onClick={() => map.dispatch({ type: 'setLocked', shapeId: shape.id, locked: !shape.locked })}>{shape.locked ? 'Locked' : 'Unlocked'}</button>
        <button className="text-button" title="Copy this shape · ⌘D, or Alt-drag it" onClick={() => act.duplicate([shape.id])}>Duplicate</button>
      </div>
      <ShapeTools act={act} ids={[shape.id]} locked={locked} />
      <details className="map-grid-tool">
        <summary>Make a grid</summary>
        {gridReady ? <>
          <p className="muted-text">Splits this shape into rows and columns of separate shapes, in a group, following its perspective.</p>
          <div className="map-grid-fields">
            <label className="map-field">Rows<input aria-label="Grid rows" type="number" min={1} max={16} value={grid.rows} onChange={e => setGrid({ ...grid, rows: e.target.value })} /></label>
            <label className="map-field">Columns<input aria-label="Grid columns" type="number" min={1} max={16} value={grid.cols} onChange={e => setGrid({ ...grid, cols: e.target.value })} /></label>
            <label className="map-field">Gap px<input aria-label="Grid gap" type="number" min={0} max={100} value={grid.gap} onChange={e => setGrid({ ...grid, gap: e.target.value })} /></label>
          </div>
          <label className="map-check" title="On: every cell plays this shape's instrument, laid across the whole grid, so the picture runs from cell to cell. Off: each cell gets its own copy to change on its own.">
            <input type="checkbox" aria-label="One picture across the cells" checked={grid.spread} onChange={e => setGrid({ ...grid, spread: e.target.checked })} />One picture across the cells</label>
          <button className="text-button" disabled={locked} onClick={makeGrid}>Make grid</button>
        </> : <p className="muted-text">Only a shape with four corners, no curves and no holes can be made into a grid.</p>}
      </details>
      <button className="text-button danger-button" disabled={locked} title={locked ? 'Unlock the shape to delete it' : 'Delete this shape · ⌫'} onClick={() => act.remove([shape.id])}>Delete shape</button>
    </Section>
    {!point && <p className="muted-text map-hint">Click a point on the stage to set its exact position. Double-click a side to add a point.</p>}
    </>}
    {tab === 'effect' && <>
      <ContentCard setNote={setNote} map={map} shape={shape} locked={locked} onOpenLooks={onOpenLooks} onEditInStudio={onEditInStudio} linked={linked} setLinked={setLinked} />
      {!shape.blocker && !shape.sourceId && <p className="muted-text">Choose an effect first: Change… above. Its settings, and what can react to sound, show here.</p>}
      {!shape.blocker && shape.sourceId === LIVE_SOURCE_ID && <MapLiveCard map={map} locked={locked} onError={text => setNote(text)} localStatus={liveStatus} />}
      {!shape.blocker && isVideoId(shape.sourceId) && <MapVideoPanel map={map} shape={shape} locked={locked} status={videoStatus[shape.sourceId] ?? null} />}
      {!shape.blocker && shape.sourceId && shape.sourceId !== LIVE_SOURCE_ID && !isVideoId(shape.sourceId) && <MapEffectTab key={shape.id} map={map} shape={shape} locked={locked} linked={linked} setNote={setNote} />}
    </>}
    {tab === 'sound' && <MapSoundTab map={map} shape={shape} locked={locked} setNote={setNote} />}
  </>;
}

/**
 * What a shape plays, as one card: a picture and name, Change…, Vary, Edit in Studio, palette, speed, sharing and Blocker.
 * Shapes sharing an instrument are one instrument: the card says so, and a change of look reaches them all unless
 * "Change all" is unticked.
 */
function ContentCard({ map, shape, locked, onOpenLooks, onEditInStudio, linked, setLinked, whole = false, setNote }: { map: Map; shape: Shape; locked: boolean; onOpenLooks: () => void; onEditInStudio?: (sourceId: string, shapeId: string) => void; linked: boolean; setLinked: (on: boolean) => void; whole?: boolean; setNote?: (text: string | null) => void }) {
  const source = shape.sourceId ? map.show.sources.find(s => s.id === shape.sourceId) ?? null : null;
  // Shapes playing the same thing (an instrument, or Live) are one: a new look reaches them all.
  const sharers = shape.sourceId ? map.show.shapes.filter(s => s.sourceId === shape.sourceId) : [];
  const isLive = shape.sourceId === LIVE_SOURCE_ID;
  const playing = map.show.shapes.filter(s => s.id !== shape.id && s.sourceId !== null && s.sourceId !== shape.sourceId);
  const video = isVideoId(shape.sourceId) ? map.show.videos.find(v => v.id === shape.sourceId) : undefined;
  const image = source?.project.layers.length === 1 && source.project.layers[0].kind === 'image' ? source.project.layers[0].image : undefined;
  const presetId = source?.project.layers.length === 1 ? PRESETS.find(p => p.name === source.project.name)?.id : undefined;
  const thumb = image ? image.dataUrl : presetId ? LookPreviews.known(presetId) ?? kindArt(PRESETS.find(p => p.id === presetId)!.kind) : source ? kindArt(source.project.layers[0]?.kind ?? '') : undefined;
  const playsName = shape.blocker ? 'Blocker' : isLive ? 'Live' : video ? `Video · ${video.name}` : image ? `Image · ${image.name}` : source ? source.project.name : shape.fill === 'grid' ? 'Grid pattern' : 'Its colour';
  return <div className="map-content-card">
      <div className="map-content-top">
        <span className={`map-content-thumb ${shape.blocker ? 'blocker' : isLive ? 'live' : video ? 'video' : !source ? (shape.fill === 'grid' ? 'grid' : 'colour') : ''}`} style={{ ['--shape-colour' as string]: shape.colour }}>{thumb && !shape.blocker && <img src={thumb} alt="" />}</span>
        <div className="map-content-name"><strong>{playsName}</strong>
          {sharers.length > 1 && <small>{isLive ? 'Live' : 'One instrument'} across {sharers.length} shapes</small>}</div>
      </div>
      <div className="map-toggles">
        <button className="text-button" data-opens-looks disabled={locked || shape.blocker} aria-label="Change look" title="Choose what this shape plays" onClick={onOpenLooks}>Change…</button>
        {source && <button className="text-button" disabled={locked} title="A new variation of this instrument" onClick={() => map.dispatch({ type: 'varySource', sourceId: source.id, entropy: randomSeed() })}>Vary</button>}
        {source && onEditInStudio && <button className="text-button" disabled={locked} title="Every control, in Studio; changes show on the projector as you make them" onClick={() => onEditInStudio(source.id, shape.id)}>Edit in Studio</button>}
      </div>
      {sharers.length > 1 && !whole && <label className="map-check" title="On: a new look, colour or grid pattern changes every linked shape. Off: only this one (it gets its own).">
        <input type="checkbox" aria-label="Change all linked shapes" checked={linked} onChange={e => setLinked(e.target.checked)} />Change all {sharers.length} linked shapes</label>}
      {source && !shape.blocker && <>
        <label className="map-field">Palette<select aria-label="Palette" value={paletteName(source.project.layers[0]?.palette ?? [])} disabled={locked}
          onChange={e => { const found = PALETTES.find(([name]) => name === e.target.value); if (found) map.dispatch({ type: 'setSourcePalette', sourceId: source.id, palette: found[1] }); }}>
          <option value="" disabled>As made</option>
          {PALETTES.map(([name]) => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <SliderField key={`speed-${source.id}`} label="Speed" value={source.speed} min={SPEED_RANGE.min} max={SPEED_RANGE.max} step={0.05} disabled={locked || source.tempoSync !== null} format={v => `${v.toFixed(2)}×`}
          onCommit={speed => map.dispatch({ type: 'setSourceSpeed', sourceId: source.id, speed })} react={{ map, target: `source.${source.id}.speed` }} />
        <label className="map-field">Loop with the tempo<select aria-label="Loop with the tempo" value={source.tempoSync ?? ''} disabled={locked} title="Off: the instrument runs at its own speed. A number: one loop of it every that many beats of the tempo."
          onChange={e => { map.startEngine(); map.dispatch({ type: 'setTempoSync', sourceId: source.id, beats: e.target.value ? Number(e.target.value) : null }); }}>
          <option value="">Off</option>{TEMPO_SYNC_BEATS.map(n => <option key={n} value={n}>Every {n} {n === 1 ? 'beat' : 'beats'}</option>)}</select></label>
        {source.project.layers.some(l => isInstrument(l.kind)) && <label className="map-field">Follow the shape's outline<select aria-label="Follow the shape's outline" value={source.followOutline ?? ''} disabled={locked || sharers.some(s => isShapeLocked(map.show, s))}
          title="The effect takes a smaller copy of the shape's outline, in its middle, as its own shape: flowing around it, growing from inside it, or tracing its edges. The saved effect is not changed."
          onChange={e => map.dispatch({ type: 'setFollowOutline', sourceId: source.id, mode: (e.target.value || null) as FollowOutline | null })}>
          <option value="">Off</option><option value="obstacle">Flow around</option><option value="emitter">Grow from inside</option><option value="edge">Trace edges</option></select></label>}
        {sharers.length > 1 && !whole && <button className="text-button" disabled={locked} title="Unlink: give this shape its own copy of the instrument, to change on its own" onClick={() => { const made = mapActions(map).separate(shape.id); if (made?.left) setNote?.(`${made.left} of the effect's reactions stayed with the other shapes: the show has as many reactions as it can hold`); }}>Make separate</button>}
      </>}
      {!shape.blocker && !whole && playing.length > 0 && <label className="map-field">Share with<select aria-label="Share with" value="" disabled={locked}
        onChange={e => { if (e.target.value) map.dispatch({ type: 'shareSource', shapeId: shape.id, withShapeId: e.target.value }); }}>
        <option value="">Play another shape's instrument…</option>
        {playing.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>}
      {!whole && <label className="map-check"><input type="checkbox" aria-label="Blocker" checked={shape.blocker} disabled={locked} onChange={e => map.dispatch({ type: 'setBlocker', shapeId: shape.id, blocker: e.target.checked })} />Blocker
        <small className="muted-text">blacks out what is beneath</small></label>}
    </div>;
}

/** Which sections are open, kept while the app is open (and between launches, where the browser allows). */
const openSections = new Set<string>((() => { try { return JSON.parse(localStorage.getItem('map-open-sections') ?? '[]') as string[]; } catch { return []; } })());

/** A folding section of the Details panel; closed, it shows a one-line summary. */
function Section({ id, title, summary, children }: { id: string; title: string; summary: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(openSections.has(id));
  return <details className="map-section" data-section={id} open={open} onToggle={e => {
    const now = e.currentTarget.open;
    if (now === open) return;
    setOpen(now);
    if (now) openSections.add(id); else openSections.delete(id);
    try { localStorage.setItem('map-open-sections', JSON.stringify([...openSections])); } catch { /* remembered for this session only */ }
  }}>
    <summary><span>{title}</span><span className="map-section-summary">{summary}</span></summary>
    <div className="map-section-body">{children}</div>
  </details>;
}

function ShapeTools({ act, ids, locked }: { act: ReturnType<typeof mapActions>; ids: string[]; locked: boolean }) {
  return <>
    <div className="map-toggles">
      <button className="text-button" disabled={locked} title="Turn over, left to right" onClick={() => act.flip('vertical', ids)}>Flip ↔</button>
      <button className="text-button" disabled={locked} title="Turn over, top to bottom" onClick={() => act.flip('horizontal', ids)}>Flip ↕</button>
    </div>
    <div className="map-toggles">
      <button className="text-button" title="A mirrored copy on the other side of the stage, left to right" onClick={() => act.mirror('vertical', ids)}>Mirror copy ↔</button>
      <button className="text-button" title="A mirrored copy on the other side of the stage, top to bottom" onClick={() => act.mirror('horizontal', ids)}>Mirror copy ↕</button>
    </div>
  </>;
}

/** Border run: a light travelling round the outline, by laps a minute or with the tempo; the border shows only its lit part. */
function BorderRunFields({ map, shape, locked }: { map: Map; shape: Shape; locked: boolean }) {
  const run = shape.border.run ?? null;
  const set = (next: typeof run) => map.dispatch({ type: 'setBorderRun', shapeId: shape.id, run: next });
  const mode = !run ? '' : run.beats ? 'tempo' : 'laps';
  return <>
    <label className="map-field">Border run<select aria-label="Border run" value={mode} disabled={locked} title="A light travelling round the outline; the border shows only its lit part"
      onChange={e => {
        const v = e.target.value, base = run ?? { lapsPerMinute: 20, beats: null, length: 0.2 };
        if (v === 'tempo') map.startEngine();
        set(v === '' ? null : { ...base, beats: v === 'tempo' ? base.beats ?? 4 : null });
      }}>
      <option value="">Off</option><option value="laps">Laps a minute</option><option value="tempo">With the tempo</option></select></label>
    {run && !run.beats && <SliderField key={`laps-${shape.id}`} label="Run speed" value={run.lapsPerMinute} min={RUN_LAPS.min} max={RUN_LAPS.max} step={1} unit=" a minute" disabled={locked} onCommit={lapsPerMinute => set({ ...run, lapsPerMinute })} />}
    {run?.beats && <label className="map-field">Run lap<select aria-label="Run lap" value={run.beats} disabled={locked} onChange={e => set({ ...run, beats: Number(e.target.value) })}>
      {TEMPO_SYNC_BEATS.map(n => <option key={n} value={n}>Every {n} {n === 1 ? 'beat' : 'beats'}</option>)}</select></label>}
    {run && <SliderField key={`runlen-${shape.id}`} label="Run length" value={run.length} min={RUN_LENGTH.min} max={RUN_LENGTH.max} step={0.01} disabled={locked} format={v => `${Math.round(v * 100)} %`} onCommit={length => set({ ...run, length })} />}
  </>;
}

/** A group's own options: Stagger, Chase, and giving each shape its own copy (Vary each, Palette shift). */
function GroupCard({ map, group }: { map: Map; group: Group }) {
  const members = map.show.shapes.filter(s => s.groupId === group.id);
  const playing = members.filter(s => s.sourceId && map.show.sources.some(src => src.id === s.sourceId));
  const runs = members.some(s => s.border.width > 0 && s.border.run);
  // The editor refuses group changes while the group or any of its shapes is locked.
  const locked = group.locked || members.some(s => isShapeLocked(map.show, s));
  const summary = [group.stagger ? `stagger ${group.stagger.toFixed(2)} s` : '', group.chase ? 'chase' : ''].filter(Boolean).join(' · ') || `${members.length} shapes`;
  return <Section id="group" title={`Group · ${group.name}`} summary={summary}>
    <SliderField key={`stagger-${group.id}`} label="Stagger" value={group.stagger ?? 0} min={0} max={STAGGER_MAX} step={0.05} disabled={locked} format={v => v ? `${v.toFixed(2)} s` : 'Off'}
      onCommit={seconds => map.dispatch({ type: 'setGroupStagger', groupId: group.id, seconds })} />
    <p className="muted-text">Each shape, in list order, shows what it plays a little later than the one before; the last is this far behind.</p>
    <label className="map-check" title={runs ? 'Each shape\'s border run starts a step further round, so the light chases from shape to shape' : 'Give the shapes a border run (Edge) to chase'}>
      <input type="checkbox" aria-label="Chase" checked={!!group.chase} disabled={locked} onChange={e => map.dispatch({ type: 'setGroupChase', groupId: group.id, on: e.target.checked })} />Chase<small className="muted-text">border runs follow on from shape to shape</small></label>
    <div className="map-toggles">
      <button className="text-button" disabled={locked || !playing.length} title="Give every shape in the group its own copy of what it plays, each varied differently"
        onClick={() => map.dispatch({ type: 'varyEach', groupId: group.id, sourceIds: playing.map(() => newSourceId()), entropy: randomSeed() })}>Vary each</button>
      <button className="text-button" disabled={locked || !playing.length} title="Give every shape its own copy, its colours turned one step further round than the shape before"
        onClick={() => map.dispatch({ type: 'paletteShift', groupId: group.id, sourceIds: playing.map(() => newSourceId()) })}>Palette shift</button>
    </div>
  </Section>;
}
