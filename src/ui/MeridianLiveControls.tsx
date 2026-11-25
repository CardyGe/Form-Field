/**
 * Meridian's Live controls: start from a Studio look, the moves, the macros it shares with the Studio, the interaction mix,
 * how people are read and how the camera lines up with the picture. Every slider can be linked to sound or MIDI with ∿.
 */
import { MERIDIAN_LIVE_CONTROLS, MERIDIAN_LIVE_LOOKS, meridianFromStudioLook, type LiveSettings, type MeridianLiveKey } from '../live/settings';
import { Slider, type ReactFor } from './LiveLookControls';

type Update = (change: (value: LiveSettings) => LiveSettings) => void;
const MOMENTARY: { key: MeridianLiveKey; label: string; title: string }[] = [
  { key: 'moveNext', label: 'Next', title: 'Glide on to the next form' },
  { key: 'moveDrop', label: 'Drop', title: 'Swell the hero and the light' },
  { key: 'moveBurst', label: 'Ripple', title: 'Send a ripple of light through the rings' },
  { key: 'moveCollapse', label: 'Gather', title: 'Draw the structure in while held' },
];
const group = (name: string) => MERIDIAN_LIVE_CONTROLS.filter(c => c.group === name);

export function MeridianLiveControls({ s, update, reactFor }: { s: LiveSettings; update: Update; reactFor: ReactFor }) {
  const m = s.meridian;
  const set = (change: Partial<LiveSettings['meridian']>) => update(v => ({ ...v, meridian: { ...v.meridian, ...change } }));
  const slider = (key: MeridianLiveKey) => {
    const c = MERIDIAN_LIVE_CONTROLS.find(x => x.key === key)!;
    return <Slider key={c.key} label={c.label} value={m[c.key]} min={c.min} max={c.max} step={c.step} unit={['liveChargeSeconds', 'liveWake'].includes(c.key) ? ' s' : ''}
      onChange={value => set({ [c.key]: value })} react={reactFor(`live.meridian.${c.key}`)} />;
  };
  const look = MERIDIAN_LIVE_LOOKS.find(l => l.id === m.preset);
  return <>
    <p className="live-note">Walk in and a ring follows you. Stand still to charge it, then move suddenly to release it. Stand near someone to link up; move together to lift the whole piece.</p>
    <p className="live-note">Point the camera at the people, not at the projection, the screen or the lighting rig. Until people are found, Meridian works from movement alone, and moving light it can see may be taken for a person.</p>
    <label className="stacked-label">Load from Studio preset<select aria-label="Load from Studio preset" value={look?.id ?? ''} onChange={e => update(v => meridianFromStudioLook(v, e.target.value))}>
      {!look && <option value="">Custom</option>}
      {MERIDIAN_LIVE_LOOKS.map(l => <option key={l.id} value={l.id} title={l.description}>{l.name}</option>)}
    </select></label>
    <div className="live-swatches" aria-hidden="true">{m.palette.slice(0, 5).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
    <div className="live-starts meridian-moves" role="group" aria-label="Moves">
      {MOMENTARY.map(move => <button key={move.key} type="button" className={`text-button ${m[move.key] >= .5 ? 'on' : ''}`} title={move.title}
        onPointerDown={() => set({ [move.key]: 1 })} onPointerUp={() => set({ [move.key]: 0 })} onPointerLeave={() => { if (m[move.key] >= .5) set({ [move.key]: 0 }); }}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') set({ [move.key]: 1 }); }} onKeyUp={() => set({ [move.key]: 0 })}>{move.label}</button>)}
      <button type="button" className={`text-button ${m.moveHold >= .5 ? 'on' : ''}`} aria-pressed={m.moveHold >= .5} title="Stay on this form until pressed again" onClick={() => set({ moveHold: m.moveHold >= .5 ? 0 : 1 })}>Hold form</button>
    </div>
    <label className="live-check"><input aria-label="Follow the music" type="checkbox" checked={m.liveMusic >= .5} onChange={e => set({ liveMusic: e.target.checked ? 1 : 0 })} />Follow the music
      <small>The beat and the sound come from Sound &amp; MIDI. Large changes can land on the beat.</small></label>
    <div role="group" aria-label="Macros">{group('Macros').filter(c => c.key !== 'colourPalette').map(c => slider(c.key))}</div>
    <h3>Interaction mix</h3>
    <div role="group" aria-label="Interaction mix">{group('Mix').map(c => slider(c.key))}</div>
    <details><summary>People</summary>{group('People').map(c => slider(c.key))}</details>
    <details><summary>Line up the camera</summary>
      <p className="live-note">Slide and scale where people appear until their rings sit on them.</p>
      {group('Alignment').map(c => slider(c.key))}</details>
  </>;
}
