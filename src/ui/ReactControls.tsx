/**
 * The sound and MIDI controls shared by Map and Live: the devices with their meters, the tempo with Tap, one row per
 * link, and the small "React to…" button beside a slider.
 */
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { MeterStore } from '../react/meter';
import type { ReactivityEngine } from '../react/engine';
import { listAudioInputs, TEST_TONE } from '../react/audio';
import { BPM_RANGE, type TempoSource } from '../react/tempo';
import { SOUND_SIGNALS, signalLabel, type Signals } from '../react/signals';
import type { Link } from '../react/links';
import { startLearning, stopLearning, stopLearningFor, useLearning } from './react-learn';

/** Re-renders when the engine's devices, status or preferences change. */
function useEngine(engine: ReactivityEngine | null): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => engine ? engine.onChange(bump) : undefined, [engine]);
}

const TEMPO_LABELS: Record<TempoSource, string> = { beat: 'Follow the beat', tap: 'Tap', midi: 'MIDI clock', fixed: 'Fixed' };

function audioLine(engine: ReactivityEngine): string {
  const s = engine.audio.status;
  switch (s.state) {
    case 'off': return 'Not listening';
    case 'starting': return 'Starting…';
    case 'on': return `Listening · ${s.label}`;
    case 'refused': return 'Microphone access is off. Allow Form & Field in System Settings › Privacy & Security › Microphone.';
    case 'lost': return 'The sound input was disconnected. Reconnect it or choose another.';
    case 'missing': return 'That sound input is not connected. Choose another.';
    case 'failed': return `Sound could not start: ${s.reason}`;
  }
}

function Meter({ label, value }: { label: string; value: number }) {
  return <div className="react-meter" title={label}><span>{label}</span><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} /></div>;
}

/** The sound input, MIDI and tempo, with meters. With no engine yet, a single button starts it. */
export function ReactDevices({ engine, meter, onStart }: { engine: ReactivityEngine | null; meter: MeterStore; onStart: () => void }) {
  useEngine(engine);
  // Only this part re-renders with the meters.
  const signals: Signals = useSyncExternalStore(meter.subscribe, meter.get);
  const [inputs, setInputs] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!engine) return;
    const refresh = () => void listAudioInputs().then(setInputs);
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    const off = engine.onChange(refresh);
    return () => { navigator.mediaDevices?.removeEventListener?.('devicechange', refresh); off(); };
  }, [engine]);
  if (!engine) return <div className="react-devices"><p className="muted-text">Sound and MIDI are off until something uses them.</p>
    <button className="text-button" onClick={onStart}>Turn on sound and MIDI</button></div>;
  const p = engine.prefs, midi = engine.midi.status;
  const audioOk = engine.audio.status.state === 'on' || engine.audio.status.state === 'off' || engine.audio.status.state === 'starting';
  const beat = Math.floor(signals['tempo.beat'] ?? 0) % 4, bpm = signals['tempo.bpm'] ?? p.bpm;
  const midiActive = performance.now() - engine.midi.lastMessage < 250;
  return <div className="react-devices">
    <label className="map-field">Sound input<select aria-label="Sound input" value={p.audioDevice ?? ''} onChange={e => engine.setPrefs({ audioDevice: e.target.value || null })}>
      <option value="">Off</option>
      {inputs.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
      {p.audioDevice && p.audioDevice !== TEST_TONE && !inputs.some(i => i.id === p.audioDevice) && <option value={p.audioDevice}>Saved input</option>}
      <option value={TEST_TONE}>Test beat</option>
    </select></label>
    <p className={`react-status ${audioOk ? '' : 'warn'}`} role="status">{audioLine(engine)}</p>
    <div className="react-meters" aria-label="Sound levels">
      <Meter label="Bass" value={signals['audio.bass'] ?? 0} /><Meter label="Mids" value={signals['audio.mids'] ?? 0} />
      <Meter label="Highs" value={signals['audio.highs'] ?? 0} /><Meter label="Level" value={signals['audio.level'] ?? 0} />
      <Meter label="Beat" value={signals['beat.pulse'] ?? 0} />
    </div>
    <label className="map-check"><input type="checkbox" aria-label="MIDI controllers" checked={p.midi} onChange={e => engine.setPrefs({ midi: e.target.checked })} />MIDI controllers
      <i className={`react-light ${midiActive ? 'on' : ''}`} title="Lights when a MIDI message arrives" /></label>
    {p.midi && <p className={`react-status ${midi.state === 'unavailable' ? 'warn' : ''}`}>{midi.state === 'on' ? (midi.devices.length ? midi.devices.join(', ') : 'No MIDI device connected') : midi.state === 'unavailable' ? `MIDI is unavailable: ${midi.reason}` : 'Starting…'}</p>}
    <div className="react-tempo">
      <label className="map-field">Tempo<select aria-label="Tempo source" value={p.tempo} onChange={e => engine.setPrefs({ tempo: e.target.value as TempoSource })}>
        {(Object.keys(TEMPO_LABELS) as TempoSource[]).map(k => <option key={k} value={k}>{TEMPO_LABELS[k]}</option>)}</select></label>
      {p.tempo === 'fixed'
        ? <label className="map-field">BPM<input aria-label="BPM" className="narrow" type="number" min={BPM_RANGE.min} max={BPM_RANGE.max} defaultValue={Math.round(p.bpm)} key={p.bpm}
            onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v)) engine.setPrefs({ bpm: Math.min(BPM_RANGE.max, Math.max(BPM_RANGE.min, v)) }); }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
        : <output className="react-bpm" aria-label="BPM">{Math.round(bpm)} BPM</output>}
      <button className="text-button" title="Tap on the beat · B" onClick={() => engine.tap()}>Tap</button>
      <span className="react-beats" aria-hidden="true">{[0, 1, 2, 3].map(i => <i key={i} className={i === beat ? 'on' : ''} />)}</span>
    </div>
  </div>;
}

/** What a link or trigger listens to: the sound signals, MIDI heard so far, or Learn. */
export function InputSelect({ value, engine, learnKey, onChange, label = 'Listens to', extra = [] }: { value: string; engine: ReactivityEngine | null; learnKey: string; onChange: (input: string) => void; label?: string; extra?: [string, string][] }) {
  const learning = useLearning() === learnKey;
  useEffect(() => () => stopLearningFor(learnKey), [learnKey]);
  const heard = engine ? Object.keys(engine.midi.values).sort() : [];
  const options: [string, string][] = [...extra, ...SOUND_SIGNALS.map(([k, l]) => [k, l] as [string, string]), ...heard.map(k => [k, signalLabel(k)] as [string, string])];
  if (!options.some(([k]) => k === value)) options.push([value, signalLabel(value)]);
  return <div className="react-input">
    <label className="map-field">{label}<select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    <button className={`text-button ${learning ? 'live-toggle on' : ''}`} disabled={!engine} title="Move a control or press a note on your MIDI controller"
      onClick={() => { if (!engine) return; if (learning) stopLearning(); else startLearning(engine, learnKey, onChange); }}>{learning ? 'Move a control…' : 'Learn'}</button>
  </div>;
}

/** A slider that commits once, on release. */
function Range({ label, value, min, max, step, shown, onCommit }: { label: string; value: number; min: number; max: number; step: number; shown: (v: number) => string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const commit = () => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null); };
  const v = draft ?? value;
  return <label className="map-field">{label} · {shown(v)}<input aria-label={label} type="range" min={min} max={max} step={step} value={v}
    onChange={e => setDraft(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /></label>;
}

/** One link: what it listens to, what it moves, how much and how smoothly. */
export function LinkRow({ link, targetLabel, targets, engine, onChange, onRemove }: { link: Link; targetLabel: string; targets?: { target: string; label: string }[]; engine: ReactivityEngine | null; onChange: (change: Partial<Omit<Link, 'id'>>) => void; onRemove: () => void }) {
  const pct = (v: number) => `${Math.round(v * 100)} %`, ms = (v: number) => `${Math.round(v)} ms`;
  return <details className="react-link" data-link={link.id}>
    <summary>
      <input type="checkbox" aria-label={`${link.name || 'Link'} on`} checked={link.on} onClick={e => e.stopPropagation()} onChange={e => onChange({ on: e.target.checked })} />
      <span className="react-link-name"><strong>{signalLabel(link.input)}</strong> → {targetLabel}</span>
      <button className="map-icon" aria-label="Remove link" title="Remove" onClick={e => { e.preventDefault(); onRemove(); }}>×</button>
    </summary>
    <div className="react-link-body">
      <InputSelect value={link.input} engine={engine} learnKey={`link:${link.id}`} onChange={input => onChange({ input })} />
      {targets && <label className="map-field">Moves<select aria-label="Moves" value={link.target} onChange={e => onChange({ target: e.target.value })}>
        {!targets.some(t => t.target === link.target) && <option value={link.target}>{targetLabel}</option>}
        {targets.map(t => <option key={t.target} value={t.target}>{t.label}</option>)}</select></label>}
      <label className="map-field">How<select aria-label="How" value={link.mode} onChange={e => onChange({ mode: e.target.value === 'control' ? 'control' : 'modulate' })}>
        <option value="modulate">Adds to the setting</option><option value="control">Sets it, from low to high</option></select></label>
      {link.mode === 'modulate'
        ? <Range label="Amount" value={link.amount} min={-1} max={1} step={0.01} shown={pct} onCommit={amount => onChange({ amount })} />
        : <><Range label="Low" value={link.low} min={0} max={1} step={0.01} shown={pct} onCommit={low => onChange({ low })} />
          <Range label="High" value={link.high} min={0} max={1} step={0.01} shown={pct} onCommit={high => onChange({ high })} /></>}
      <Range label="Rise" value={link.attackMs} min={0} max={2000} step={10} shown={ms} onCommit={attackMs => onChange({ attackMs })} />
      <Range label="Fall" value={link.releaseMs} min={0} max={2000} step={10} shown={ms} onCommit={releaseMs => onChange({ releaseMs })} />
    </div>
  </details>;
}

/**
 * The small button beside a slider: React to the bass, mids, highs, level, the beat, or a MIDI control (Learn).
 * Lit when something already drives the setting; then it also offers to stop.
 */
export function ReactTo({ label, target, linked, engine, disabled = false, onStart, onAdd, onStop }: { label: string; target: string; linked: number; engine: ReactivityEngine | null; disabled?: boolean; onStart: () => ReactivityEngine | void; onAdd: (input: string) => void; onStop: () => void }) {
  const box = useRef<HTMLDetailsElement>(null);
  const learnKey = `react-to:${target}`;
  const learning = useLearning() === learnKey;
  // Closing the menu, by any means, stops a Learn it started: nothing waits unseen for a knob to turn.
  const close = () => { if (box.current) box.current.open = false; stopLearningFor(learnKey); };
  useEffect(() => () => stopLearningFor(learnKey), [learnKey]);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (box.current?.open && !box.current.contains(e.target as Node)) close(); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, []);
  if (disabled) return <span className={`react-to disabled ${linked ? 'on' : ''}`} title={`${label} is locked`} aria-hidden="true"><span className="react-to-icon">∿</span></span>;
  return <details ref={box} className={`react-to ${linked ? 'on' : ''}`} onToggle={e => { if (!e.currentTarget.open) stopLearningFor(learnKey); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
    <summary aria-label={`React to… ${label}`} title={linked ? `${label}: driven by sound or MIDI` : `Make ${label} react to sound or MIDI`}>∿{linked > 1 ? linked : ''}</summary>
    <div className="react-to-menu" role="menu">
      {SOUND_SIGNALS.filter(([k]) => k !== 'tempo.phase').map(([k, l]) => <button key={k} role="menuitem" className="text-button" onClick={() => { onStart(); onAdd(k); close(); }}>{l}</button>)}
      <button role="menuitem" className={`text-button ${learning ? 'live-toggle on' : ''}`}
        onClick={() => { const e = onStart() ?? engine; if (!e) return; if (learning) stopLearning(); else startLearning(e, learnKey, input => { onAdd(input); close(); }); }}>{learning ? 'Move a control…' : 'MIDI: Learn'}</button>
      {linked > 0 && <button role="menuitem" className="text-button danger-button" onClick={() => { onStop(); close(); }}>Stop reacting</button>}
    </div>
  </details>;
}

/** Defaults for a link added from a slider: modulate for sound, control (follow the knob) for MIDI. */
export function linkFor(id: string, input: string, target: string, name: string): Link {
  const midi = input.startsWith('midi.');
  return { id, input, target, mode: midi ? 'control' : 'modulate', amount: input === 'beat.pulse' ? 0.35 : 0.3, low: 0, high: 1,
    attackMs: input === 'beat.pulse' ? 0 : 20, releaseMs: input === 'beat.pulse' ? 150 : 200, on: true, name };
}
