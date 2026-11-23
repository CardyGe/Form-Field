/** A clickable copy of the MIDImix. Every control goes through the same control events the hardware will send. */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { ControlEvent } from '../perform/controls';
import { beatAt } from '../perform/timing';
import type { PerformView } from '../perform/service';
import { ZONE_COUNT, type PerformanceSet } from '../perform/types';
import { LIVE_SOURCE_ID } from '../map/show';

const KNOBS = ['Speed', 'Colour', 'Audio'] as const;
const CEILING_KNOBS = ['Drift', 'Colour', 'Breath'] as const;
const SWEEP = 270;

function Knob({ label, short, value, inactive, onChange }: { label: string; short: string; value: number; inactive: boolean; onChange: (v: number) => void }) {
  const drag = useRef<{ y: number; from: number } | null>(null);
  const set = (v: number) => onChange(Math.min(1, Math.max(0, v)));
  const move = (e: PointerEvent<HTMLDivElement>) => { if (drag.current) set(drag.current.from + (drag.current.y - e.clientY) / 140); };
  const key = (e: KeyboardEvent) => {
    const step = { ArrowUp: .05, ArrowRight: .05, ArrowDown: -.05, ArrowLeft: -.05 }[e.key];
    if (step) { e.preventDefault(); e.stopPropagation(); set(value + step); }
  };
  return <div className={`pf-knob ${inactive ? 'inactive' : ''}`} title={inactive ? `${short} does nothing on a Live look` : `${short} · drag up or down · double-click for centre`}>
    <div className="pf-knob-dial" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(value.toFixed(2))}
      style={{ ['--turn' as string]: `${(value - .5) * SWEEP}deg` }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, from: value }; }}
      onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => set(.5)} onKeyDown={key}><i /></div>
    <span>{short}</span>
  </div>;
}

function Hold({ label, text, className, event, id, press, release }: { label: string; text: string; className: string; event: ControlEvent; id: string; press: (e: ControlEvent) => void; release: (id: string) => void }) {
  return <button type="button" aria-label={label} className={className}
    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); press(event); }}
    onPointerUp={() => release(id)} onPointerCancel={() => release(id)} onLostPointerCapture={() => release(id)}
    onKeyDown={e => { if ((e.key === 'Enter') && !e.repeat) { e.stopPropagation(); press(event); } }}
    onKeyUp={e => { if (e.key === 'Enter') { e.stopPropagation(); release(id); } }}>{text}</button>;
}

export default function ControllerSurface({ view, set, held, press, release, control, sendAll }: {
  view: PerformView; set: PerformanceSet; held: ReadonlySet<string>;
  press: (e: ControlEvent) => void; release: (id: string) => void; control: (e: ControlEvent) => void; sendAll: () => void;
}) {
  const { controls, launcher, clock, running, shift } = view;
  const beat = beatAt(clock, performance.timeOrigin + performance.now());
  const onBeat = running && ((beat % 1) + 1) % 1 < .3;
  const queuedZones = new Set(launcher.queue.flatMap(l => l.changes.map(c => c.zone)));
  const sourceOf = (zone: number) => set.clips.find(c => c.id === launcher.playing[zone])?.sourceId;
  return <div className={`pf-controller ${running ? '' : 'idle'}`} role="group" aria-label="MIDImix">
    {Array.from({ length: ZONE_COUNT }, (_, strip) => {
      const names = strip === ZONE_COUNT - 1 ? CEILING_KNOBS : KNOBS;
      const amber = queuedZones.has(strip) ? 'flash' : launcher.playing[strip] !== null ? 'on' : '';
      const red = held.has(`red-${strip}`) ? 'on' : strip === 0 && onBeat ? 'beat' : '';
      return <div className="pf-strip" key={strip}>
        <div className="pf-knobs">{names.map((short, k) => <Knob key={short} short={short} label={`Strip ${strip + 1} ${short}`} value={controls.knobs[strip][k]}
          inactive={k === 0 && sourceOf(strip) === LIVE_SOURCE_ID} onChange={value => control({ kind: 'knob', strip, knob: k as 0 | 1 | 2, value })} />)}</div>
        <div className="pf-strip-lower">
          <div className="pf-buttons">
            <Hold label={`Amber ${strip + 1}`} text={shift ? 'Back' : 'Next'} className={`pf-btn amber ${amber}`} event={{ kind: 'amber', strip, down: true }} id={`amber-${strip}`} press={press} release={release} />
            <Hold label={`Red ${strip + 1}`} text={shift ? 'Stop' : strip === ZONE_COUNT - 1 ? 'Bloom' : 'Burst'} className={`pf-btn red ${red}`} event={{ kind: 'red', strip, down: true }} id={`red-${strip}`} press={press} release={release} />
          </div>
          <input className="pf-fader" type="range" min={0} max={1} step={.01} aria-label={`Fader ${strip + 1}`} value={controls.faders[strip]}
            onChange={e => control({ kind: 'fader', strip, value: Number(e.target.value) })} />
        </div>
      </div>;
    })}
    <div className="pf-strip pf-master-strip">
      <div className="pf-master-keys">
        <Hold label="Bank back" text={shift ? 'This is the 1' : 'Bank ◀'} className="pf-btn bank" event={{ kind: 'bankBack', down: true }} id="bankBack" press={press} release={release} />
        <Hold label="Bank next" text={shift ? 'Launch now' : 'Bank ▶'} className="pf-btn bank" event={{ kind: 'bankNext', down: true }} id="bankNext" press={press} release={release} />
        {/* One mouse cannot hold Solo and press another control, so on screen Solo stays on until it is clicked again. */}
        <button type="button" aria-label="Solo" aria-pressed={shift} className={`pf-btn solo ${shift ? 'on' : ''}`} title="Click to latch · or hold Shift" onClick={() => { if (held.has('solo')) release('solo'); else press({ kind: 'solo', down: true }); }}>{shift ? 'Solo on' : 'Solo · Shift'}</button>
        <button type="button" className={`pf-btn sendall ${running && !controls.ready ? 'attention' : ''}`} disabled={!running} onClick={sendAll}>Send All</button>
      </div>
      <label className="pf-master-fader"><span>Master</span>
        <input className="pf-fader" type="range" min={0} max={1} step={.01} aria-label="Master" value={controls.master} onChange={e => control({ kind: 'master', value: Number(e.target.value) })} />
      </label>
    </div>
  </div>;
}
