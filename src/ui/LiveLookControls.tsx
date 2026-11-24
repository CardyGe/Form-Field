/**
 * Live's look controls, shared by the Live screen and Map's Live card: the look, each look's sliders (each with ∿),
 * palettes and starts; and the Sound & MIDI part (devices, reactions, links). Both screens edit the same settings.
 */
import { type ComponentProps } from 'react';
import { LinkRow, ReactDevices, ReactTo, linkFor } from './ReactControls';
import { LIVE_REACTIONS, MAX_LIVE_LINKS, liveReactionLinks, liveTargetOptions, liveTargetRange, type LiveReaction } from '../live/modulate';
import { newItemId } from './mapActions';
import { LINKS_BUDGET, LOOK_LABELS, RELIEF_CONTROLS, RELIEF_SIZES, RELIEF_SURFACES, RELIEF_MOTIONS, RELIEF_FINISHES, RELIEF_PRESETS, type ReliefSettings, type LookKind, PAINT_CONTROLS, SIGNAL_CONTROLS, SIGNAL_STARTS, SMOKE_CONTROLS, SMOKE_STARTS, type LiveSettings, type SignalKey } from '../live/settings';
import { RELIEF_PALETTES, validateReliefPalette } from '../live/relief-palettes';
import { rampHex } from '../live/colour';
import type { ReactivityEngine } from '../react/engine';
import type { MeterStore } from '../react/meter';
import { ACID_DRIP, CANDY, CYAN_YELLOW, ELECTRIC, HOT_SIGNAL, LIME_VIOLET, NEON_STRATA, POP_PORTAL, SOLAR } from '../core/palettes';
import { MeridianLiveControls } from './MeridianLiveControls';

const POSE_CONTROLS: SignalKey[] = ['poseEcho', 'poseCount', 'poseSpacing', 'poseFill'];
const PALETTES: [string, string[]][] = [['Hot Signal', HOT_SIGNAL], ['Neon Strata', NEON_STRATA], ['Acid Drip', ACID_DRIP], ['Pop Portal', POP_PORTAL],
  ['Lime Violet', LIME_VIOLET], ['Electric', ELECTRIC], ['Candy', CANDY], ['Solar', SOLAR], ['Cyan Yellow', CYAN_YELLOW]];

type Update = (change: (value: LiveSettings) => LiveSettings) => void;
export type ReactFor = (target: string) => Omit<ComponentProps<typeof ReactTo>, 'label'>;

export function Slider({ label, value, min, max, step, unit = '', shown, disabled = false, onChange, react }: { label: string; value: number; min: number; max: number; step: number; unit?: string; shown?: string; disabled?: boolean; onChange: (value: number) => void; react?: Omit<ComponentProps<typeof ReactTo>, 'label'> }) {
  const field = <label className="live-control"><span>{label}<output>{shown ?? `${step >= 1 ? value : value.toFixed(2)}${unit}`}</output></span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} /></label>;
  return react ? <div className="live-react-field">{field}<ReactTo label={label} {...react} disabled={disabled || react.disabled} /></div> : field;
}

/** Live's links: kept in its settings, so they are saved with them and reach wherever Live is drawn. */
export function liveLinks(s: LiveSettings, update: Update, engine: ReactivityEngine | null, onStart: () => ReactivityEngine | void, onError: (message: string) => void) {
  // Links must fit the settings' size limit; a change that would not is refused with a note rather than losing a link.
  const setLinks = (change: (links: LiveSettings['links']) => LiveSettings['links']) => {
    const next = change(s.links);
    if (JSON.stringify(next).length > LINKS_BUDGET || next.length > MAX_LIVE_LINKS) { onError('Live has as many links as it can hold. Remove one to add another.'); return; }
    update(v => ({ ...v, links: change(v.links) }));
  };
  const reactFor: ReactFor = (target: string) => {
    const linked = s.links.filter(l => l.target === target);
    return { target, linked: linked.length, engine, onStart,
      onAdd: (input: string) => setLinks(links => [...links, linkFor(newItemId('link'), input, target, '')]),
      onStop: () => setLinks(links => links.filter(l => l.target !== target)) };
  };
  const addReaction = (reaction: LiveReaction) => { onStart(); setLinks(links => [...links, ...liveReactionLinks(s, reaction, [newItemId('link')])]); };
  return { setLinks, reactFor, addReaction };
}

/** The look and its controls. onView: the look changed (the Live screen goes back to the artwork view). */
export function LiveLookControls({ s, update, reactFor, onView = () => {}, onClear }: { s: LiveSettings; update: Update; reactFor: ReactFor; onView?: () => void; onClear: () => void }) {
  const set = (change: Partial<LiveSettings>) => update(v => ({ ...v, ...change }));
  const paletteName = PALETTES.find(([, colours]) => colours.join() === s.palette.join())?.[0] ?? '';
  const signalPaletteName = PALETTES.find(([, colours]) => colours.join() === s.signal.palette.join())?.[0] ?? '';
  const smokePaletteName = PALETTES.find(([, colours]) => colours.join() === s.smoke.palette.join())?.[0] ?? '';
  const signal = s.look === 'signal', smoke = s.look === 'smoke';
  const setRelief = (change: Partial<ReliefSettings>) => update(v => ({ ...v, relief: { ...v.relief, ...change } }));
  const reliefPreset = RELIEF_PRESETS.find(p => (Object.keys(p.settings) as (keyof ReliefSettings)[]).every(k => p.settings[k] === s.relief[k]));
  const setSmoke = (change: Partial<LiveSettings['smoke']>) => update(v => ({ ...v, smoke: { ...v.smoke, ...change } }));
  const setSignal = (change: Partial<LiveSettings['signal']>) => update(v => ({ ...v, signal: { ...v.signal, ...change } }));
  return <>
        <label className="stacked-label">Look<select aria-label="Look" value={s.look} onChange={e => { onView(); set({ look: e.target.value as LookKind }); }}>{Object.entries(LOOK_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {s.look === 'relief' ? <>
          <label className="live-check"><input type="checkbox" checked={s.reliefPresence} onChange={e => {
            onView(); set({ reliefPresence: e.target.checked });
          }} />Body imprint
            <small>Stand still to see your shape. Sweep toward someone opposite you to meet in the middle.</small></label>
          <label className="stacked-label">Preset<select aria-label="Relief preset" value={reliefPreset?.name ?? ''} onChange={e => {
            const preset = RELIEF_PRESETS.find(p => p.name === e.target.value);
            if (preset) setRelief(preset.settings);
          }}>
            {!reliefPreset && <option value="">Custom</option>}
            {RELIEF_PRESETS.map(p => <option key={p.name}>{p.name}</option>)}
          </select></label>
          <label className="stacked-label">Surface<select aria-label="Surface" value={s.relief.surface} onChange={e => setRelief({ surface: e.target.value as ReliefSettings['surface'] })}>
            {Object.entries(RELIEF_SURFACES).map(([v, name]) => <option key={v} value={v}>{name}</option>)}
          </select></label>
          <label className="stacked-label">Element size<select aria-label="Element size" value={s.relief.size} onChange={e => setRelief({ size: e.target.value as ReliefSettings['size'] })}>
            {Object.entries(RELIEF_SIZES).map(([v, name]) => <option key={v} value={v}>{name}</option>)}
          </select></label>
          <label className="stacked-label">Motion<select aria-label="Motion" value={s.relief.motion} onChange={e => setRelief({ motion: e.target.value as ReliefSettings['motion'] })}>
            {Object.entries(RELIEF_MOTIONS).map(([v, name]) => <option key={v} value={v}>{name}</option>)}
          </select></label>
          <label className="stacked-label">Finish<select aria-label="Finish" value={s.relief.finish} onChange={e => setRelief({ finish: e.target.value as ReliefSettings['finish'] })}>
            {Object.entries(RELIEF_FINISHES).map(([v, name]) => <option key={v} value={v}>{name}</option>)}
          </select></label>
          <label className="stacked-label">Colour scheme<select aria-label="Colour scheme" value={s.reliefPalette} onChange={e => set({ reliefPalette: validateReliefPalette(e.target.value) })}>
            {Object.entries(RELIEF_PALETTES).map(([name, palette]) => <option key={name} value={name}>{palette.label}</option>)}
          </select></label>
          {s.reliefPalette !== 'material' && <div className="live-swatches" aria-hidden="true">
            {RELIEF_PALETTES[s.reliefPalette].colours.map((colour, i) => <i key={i} style={{ background: colour }} />)}
          </div>}
          {RELIEF_CONTROLS.map(c => <Slider key={c.key} label={c.label} value={s.relief[c.key]} min={c.min} max={c.max} step={c.step}
            unit={c.key === 'settle' ? ' s' : c.key === 'lightAngle' ? '°' : ''} onChange={value => setRelief({ [c.key]: value })} react={reactFor(`live.relief.${c.key}`)} />)}
        </> : signal ? <>
          <p className="live-note">Sweep an arm to leave coloured outlines of earlier poses. Hold still to build light, then move to release it.</p>
          <div className="live-starts" role="group" aria-label="Start from">{SIGNAL_STARTS.map(start =>
            <button key={start.label} className={`text-button ${Object.entries(start.values).every(([k, v]) => s.signal[k as keyof typeof start.values] === v) ? 'on' : ''}`} onClick={() => { setSignal({ ...start.values, hold: false }); onClear(); }}>{start.label}</button>)}</div>
          <label className="live-check"><input aria-label="Remove background" type="checkbox" checked={s.signal.removeBackground} onChange={e => setSignal({ removeBackground: e.target.checked })} />Remove background<small>Only people enter the artwork. The room stays black while detection loads.</small></label>
          <label className="live-check"><input aria-label="Keep still poses" type="checkbox" checked={s.signal.keepStill} onChange={e => setSignal({ keepStill: e.target.checked })} />Keep still poses<small>Standing still charges the artwork instead of making you disappear.</small></label>
          <label className="stacked-label">Palette<select aria-label="Palette" value={signalPaletteName} onChange={e => { const found = PALETTES.find(([name]) => name === e.target.value); if (found) setSignal({ palette: [...found[1]] }); }}>
            {!signalPaletteName && <option value="">Custom</option>}{PALETTES.map(([name]) => <option key={name}>{name}</option>)}</select></label>
          <div className="live-swatches">{rampHex(s.signal.palette).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
          <div role="group" aria-label="Pose history">
            {SIGNAL_CONTROLS.filter(c => POSE_CONTROLS.includes(c.key)).map(c => <Slider key={c.key}
              label={c.label} value={s.signal[c.key]} min={c.min} max={c.max} step={c.step}
              unit={c.key === 'poseSpacing' ? ' s' : ''}
              disabled={!s.signal.removeBackground || (c.key !== 'poseEcho' && s.signal.poseEcho === 0)}
              onChange={value => setSignal({ [c.key]: value })} react={reactFor(`live.signal.${c.key}`)} />)}
          </div>
          {SIGNAL_CONTROLS.filter(c => !POSE_CONTROLS.includes(c.key) && !['maskThreshold', 'maskSoftness', 'focus', 'blockSize', 'mix'].includes(c.key)).map(c => <Slider key={c.key}
            label={c.label} value={s.signal[c.key]} min={c.min} max={c.max} step={c.step}
            unit={['memorySeconds', 'chargeSeconds'].includes(c.key) ? ' s' : ''}
            onChange={value => setSignal({ [c.key]: value })} react={reactFor(`live.signal.${c.key}`)} />)}
          <details><summary>Cutout and detail</summary>{SIGNAL_CONTROLS.filter(c => ['maskThreshold','maskSoftness','focus','blockSize','mix'].includes(c.key)).map(c => <Slider key={c.key} label={c.label} value={s.signal[c.key]} min={c.min} max={c.max} step={c.step} onChange={value => setSignal({ [c.key]: value })} react={reactFor(`live.signal.${c.key}`)} />)}</details>
          <label className="live-check"><input aria-label="Hold frame memory" type="checkbox" checked={s.signal.hold} onChange={e => setSignal({ hold: e.target.checked })} />Hold frame memory<small>Stops new frames and poses from being captured. Movement still bends the frame memory.</small></label>
          <p className="live-note">Depth relief uses brightness as a depth map. Depth focus chooses the brightness plane that stays in place.</p>
        </> : s.look === 'meridian' ? <MeridianLiveControls s={s} update={update} reactFor={reactFor} />
        : smoke ? <>
          <p className="live-note">People are made of smoke. Moving tears it off them.</p>
          <div className="live-starts" role="group" aria-label="Start from">{SMOKE_STARTS.map(start =>
            <button key={start.id} className={`text-button ${Object.entries(start.values).every(([k, v]) => s.smoke[k as keyof typeof start.values] === v) ? 'on' : ''}`} onClick={() => setSmoke({ ...start.values })}>{start.label}</button>)}</div>
          {SMOKE_CONTROLS.map(c => c.key === 'lifeSeconds' ? <div key={c.key}>
            <Slider label={c.label} value={s.smoke.lifeSeconds} min={c.min} max={c.max} step={c.step} unit=" s" shown={s.smoke.forever ? 'Forever' : undefined} disabled={s.smoke.forever} onChange={value => setSmoke({ lifeSeconds: value })} />
            <label className="live-check"><input aria-label="Forever" type="checkbox" checked={s.smoke.forever} onChange={e => setSmoke({ forever: e.target.checked })} />Forever
              <small>Smoke never fades and stays in the picture: people move it around. Turn Emit down once it is full; Clear empties it.</small></label>
          </div> : <Slider key={c.key} label={c.label} value={s.smoke[c.key]} min={c.min} max={c.max} step={c.step} onChange={value => setSmoke({ [c.key]: value })} react={reactFor(`live.smoke.${c.key}`)} />)}
          <label className="stacked-label">Palette<select aria-label="Palette" value={smokePaletteName} onChange={e => { const found = PALETTES.find(([name]) => name === e.target.value); if (found) setSmoke({ palette: [...found[1]] }); }}>
            {!smokePaletteName && <option value="">Custom</option>}{PALETTES.map(([name]) => <option key={name}>{name}</option>)}</select></label>
          <div className="live-swatches" title="Darkest to brightest, as people are coloured">{rampHex(s.smoke.palette).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
        </> : <>
          <p className="live-note">Movement lays down paint. Standing still lets it fade.</p>
          {PAINT_CONTROLS.filter(c => c.key !== 'ground').map(c => <Slider key={c.key} label={c.label} value={s.paint[c.key]} min={c.min} max={c.max} step={c.step} unit={c.key === 'fadeSeconds' ? ' s' : ''}
            onChange={value => update(v => ({ ...v, paint: { ...v.paint, [c.key]: value } }))} react={reactFor(`live.paint.${c.key}`)} />)}
          <label className="stacked-label">Palette<select aria-label="Palette" value={paletteName} onChange={e => { const found = PALETTES.find(([name]) => name === e.target.value); if (found) set({ palette: [...found[1]] }); }}>
            {!paletteName && <option value="">Custom</option>}{PALETTES.map(([name]) => <option key={name}>{name}</option>)}</select></label>
          <div className="live-swatches">{s.palette.slice(0, 5).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
          <label className="stacked-label">Ground<select aria-label="Ground" value={s.paint.ground >= .5 ? 1 : 0} onChange={e => update(v => ({ ...v, paint: { ...v.paint, ground: Number(e.target.value) } }))}><option value={0}>Black</option><option value={1}>White</option></select></label>
        </>}
  </>;
}

/** Sound & MIDI for Live: the devices and meters, the ready-made reactions, and every link. */
export function LiveReactSection({ s, links, engine, meter, onStart }: { s: LiveSettings; links: ReturnType<typeof liveLinks>; engine: ReactivityEngine | null; meter: MeterStore; onStart: () => ReactivityEngine | void }) {
  const { setLinks, addReaction } = links;
  return <>
          <ReactDevices engine={engine} meter={meter} onStart={onStart} />
          <div className="live-starts" role="group" aria-label="Reactions">{(Object.keys(LIVE_REACTIONS) as LiveReaction[]).map(r =>
            <button key={r} className="text-button" title={`Adds a link for ${LOOK_LABELS[s.look]}; adjust it below`} onClick={() => addReaction(r)}>{LIVE_REACTIONS[r].label}</button>)}</div>
          {s.links.map(link => <LinkRow key={link.id} link={link} engine={engine} targets={liveTargetOptions(s.look)} targetLabel={liveTargetRange(link.target)?.label ?? 'Missing'}
            onChange={change => setLinks(links => links.map(l => l.id === link.id ? { ...l, ...change } : l))} onRemove={() => setLinks(links => links.filter(l => l.id !== link.id))} />)}
          {!s.links.length && <p className="live-note">Nothing reacts yet. Use ∿ beside a slider, or a reaction above.</p>}
  </>;
}
