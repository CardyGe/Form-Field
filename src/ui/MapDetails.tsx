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
function SliderField({ label, value, min, max, step, unit, disabled, onCommit, format }: { label: string; value: number; min: number; max: number; step: number; unit?: string; disabled?: boolean; onCommit: (value: number) => void; format?: (v: number) => string }) {
  const [draft, setDraft] = useState<number | null>(null);
  const commit = () => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null); };
  const shown = draft ?? value;
  return <label className="map-field">{label} · {format ? format(shown) : `${Math.round(shown)}${unit ?? ''}`}
    <input aria-label={label} type="range" min={min} max={max} step={step} value={shown} disabled={disabled}
      onChange={e => setDraft(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /></label>;
}

/** The Details panel: the selected shape's name, colour, what it plays, its edge, shape tools and its chosen point. */
export default function MapDetails({ map, onEditInStudio, setNote, onOpenLooks, linked, setLinked }: { map: Map; onEditInStudio?: (sourceId: string, shapeId: string) => void; setNote: (text: string | null) => void; onOpenLooks: () => void; linked: boolean; setLinked: (on: boolean) => void }) {
  const act = mapActions(map);
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
      {one && first && <ContentCard map={map} shape={first} locked={anyLocked} onOpenLooks={onOpenLooks} onEditInStudio={onEditInStudio} linked setLinked={() => {}} whole />}
      <p className="muted-text">Drag any of them to move them all; drag the box corners to scale, the round handle to turn. Shift-click a shape to add or remove it.</p>
      <div className="map-toggles"><button className="text-button" disabled={anyLocked} title="Put these shapes in a folder · ⌘G" onClick={() => act.group(ids)}>Group</button>
        <button className="text-button" title="Copy these shapes · ⌘D" onClick={() => act.duplicate(ids)}>Duplicate</button>
        <button className="text-button danger-button" disabled={anyLocked} onClick={() => act.remove(ids)}>Delete shapes</button></div>
      <ShapeTools act={act} ids={ids} locked={anyLocked} />
    </>;
  }
  if (!shape) return <p className="muted-text">Pick a shape to see its details. Shift-click or drag a box on the stage to pick several.</p>;

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
  const edgeSummary = [shape.softEdge ? `soft ${Math.round(shape.softEdge)} px` : '', border.width ? `border ${Math.round(border.width)} px` : ''].filter(Boolean).join(' · ') || 'none';

  return <>
    <div className="map-detail-head">
      <label className="map-colour" title="The shape's colour"><input type="color" aria-label="Colour" value={shape.colour} disabled={locked} onChange={e => commitColour(e.target.value)} /></label>
      <CommitField label="Name" value={shape.name} onCommit={commitName} maxLength={MAX_NAME_LENGTH} />
    </div>
    {group && <div className="map-group-line"><span className="muted-text">In</span>
      <CommitField label="Group name" value={group.name} maxLength={MAX_NAME_LENGTH} disabled={group.locked} onCommit={text => { const name = text.trim(); if (name && name !== group.name) map.dispatch({ type: 'renameGroup', groupId: group.id, name }); }} />
      <button className="text-button" disabled={group.locked} title="Dissolve this group; its shapes stay · ⇧⌘G" onClick={() => act.ungroup(group.id)}>Ungroup</button></div>}

    <ContentCard map={map} shape={shape} locked={locked} onOpenLooks={onOpenLooks} onEditInStudio={onEditInStudio} linked={linked} setLinked={setLinked} />

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
        <SliderField key={`zoom-${shape.id}`} label="Zoom" value={place.zoom} min={ZOOM_RANGE.min} max={ZOOM_RANGE.max} step={0.01} disabled={locked} format={pct} onCommit={zoom => setPlacement({ zoom })} />
        <SliderField key={`movex-${shape.id}`} label="Move across" value={place.offset.x * STAGE_SIZE.width} min={-STAGE_SIZE.width / 2} max={STAGE_SIZE.width / 2} step={1} unit=" px" disabled={locked} onCommit={x => setPlacement({ offset: { x: x / STAGE_SIZE.width, y: place.offset.y } })} />
        <SliderField key={`movey-${shape.id}`} label="Move up and down" value={place.offset.y * STAGE_SIZE.height} min={-STAGE_SIZE.height / 2} max={STAGE_SIZE.height / 2} step={1} unit=" px" disabled={locked} onCommit={y => setPlacement({ offset: { x: place.offset.x, y: y / STAGE_SIZE.height } })} />
        <SliderField key={`turn-${shape.id}`} label="Turn" value={place.turn} min={-180} max={180} step={1} unit="°" disabled={locked} onCommit={turn => setPlacement({ turn })} />
      </>}
      <div className="map-toggles">
        {place.kind !== 'pin' && <button className="text-button" disabled={locked || (place.zoom === 1 && place.turn === 0 && place.offset.x === 0 && place.offset.y === 0)} onClick={() => setPlacement({ zoom: 1, turn: 0, offset: { x: 0, y: 0 } })}>Reset picture</button>}
        {place.kind === 'pin' && shape.placement.pin && !ownCornersPinnable(shape) && <button className="text-button" disabled={locked} title="Put the four handles back at the shape's box" onClick={() => setPlacement({ pin: null })}>Reset pin</button>}
      </div>
    </Section>}

    {!shape.blocker && <Section id="look" title="Look" summary={<>{pct(shape.brightness)} {shape.tint !== '#ffffff' && <i className="map-dot" style={{ background: shape.tint }} />}</>}>
      <SliderField key={`bright-${shape.id}`} label="Brightness" value={shape.brightness} min={0} max={BRIGHTNESS_MAX} step={0.01} disabled={locked} format={pct} onCommit={brightness => map.dispatch({ type: 'setLook', shapeId: shape.id, brightness })} />
      <div className="map-field">Tint<div className="map-tints" role="group" aria-label="Tint">{TINTS.map(([name, colour]) =>
        <button key={colour} type="button" className="map-tint" aria-pressed={shape.tint === colour} aria-label={`Tint ${name}`} title={name} disabled={locked} style={{ background: colour }}
          onClick={() => map.dispatch({ type: 'setLook', shapeId: shape.id, tint: colour })} />)}
        <label className="map-tint custom" title="Any tint"><input type="color" aria-label="Tint colour" value={shape.tint} disabled={locked} onChange={e => map.dispatch({ type: 'setLook', shapeId: shape.id, tint: e.target.value.toLowerCase() })} /></label></div></div>
    </Section>}

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
  </>;
}

/**
 * What a shape plays, as one card: a picture and name, Change…, Vary, Edit in Studio, palette, speed, sharing and Blocker.
 * Shapes sharing an instrument are one instrument: the card says so, and a change of look reaches them all unless
 * "Change all" is unticked.
 */
function ContentCard({ map, shape, locked, onOpenLooks, onEditInStudio, linked, setLinked, whole = false }: { map: Map; shape: Shape; locked: boolean; onOpenLooks: () => void; onEditInStudio?: (sourceId: string, shapeId: string) => void; linked: boolean; setLinked: (on: boolean) => void; whole?: boolean }) {
  const source = shape.sourceId ? map.show.sources.find(s => s.id === shape.sourceId) ?? null : null;
  const sharers = source ? map.show.shapes.filter(s => s.sourceId === source.id) : [];
  const playing = map.show.shapes.filter(s => s.id !== shape.id && s.sourceId !== null && s.sourceId !== shape.sourceId);
  const presetId = source?.project.layers.length === 1 ? PRESETS.find(p => p.name === source.project.name)?.id : undefined;
  const thumb = presetId ? LookPreviews.known(presetId) ?? kindArt(PRESETS.find(p => p.id === presetId)!.kind) : source ? kindArt(source.project.layers[0]?.kind ?? '') : undefined;
  const playsName = shape.blocker ? 'Blocker' : source ? source.project.name : shape.fill === 'grid' ? 'Grid pattern' : 'Its colour';
  return <div className="map-content-card">
      <div className="map-content-top">
        <span className={`map-content-thumb ${shape.blocker ? 'blocker' : !source ? (shape.fill === 'grid' ? 'grid' : 'colour') : ''}`} style={{ ['--shape-colour' as string]: shape.colour }}>{thumb && !shape.blocker && <img src={thumb} alt="" />}</span>
        <div className="map-content-name"><strong>{playsName}</strong>
          {sharers.length > 1 && <small>One instrument across {sharers.length} shapes</small>}</div>
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
        <SliderField key={`speed-${source.id}`} label="Speed" value={source.speed} min={SPEED_RANGE.min} max={SPEED_RANGE.max} step={0.05} disabled={locked} format={v => `${v.toFixed(2)}×`}
          onCommit={speed => map.dispatch({ type: 'setSourceSpeed', sourceId: source.id, speed })} />
        {sharers.length > 1 && !whole && <button className="text-button" disabled={locked} title="Unlink: give this shape its own copy of the instrument, to change on its own" onClick={() => map.dispatch({ type: 'makeSeparate', shapeId: shape.id, sourceId: newSourceId() })}>Make separate</button>}
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
