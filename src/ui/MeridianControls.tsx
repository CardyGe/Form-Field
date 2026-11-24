/** Meridian's control surface: macros, moves, seed bank and A/B on top, every deep parameter in lockable groups below. */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { Layer, ParameterDefinition } from '../shared/types';
import { ChoiceParameter, Icon, Parameter } from './LayerControls';
import { MACRO_KEYS, MERIDIAN_GROUPS, MERIDIAN_PARAMETERS, motionIgnored } from '../meridian/parameters';
import { musicStatus } from '../meridian/music-status';
import { EVOLVE_INACTIVE, applyLockedVariation, applyMorph, captureMorph, filterParameters, MARK_HINT, markApplies, MAX_STORED_SEED, MERIDIAN_CHOICES, PANEL_PARAMETERS, performanceShortcut, KeyHolds, recallSeed, SEED_SLOTS, storeSeed, toggleGroupLock, type MoveKey, type PerformanceAction } from '../meridian/panel';
import { heldMoves } from '../meridian/held-moves';
import { assertImportableImage, MAX_IMPORT_SIDE, meridianMark } from '../core/project';
import './meridian.css';
import { InstallationControls } from './InstallationControls';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const definition = (key: string) => MERIDIAN_PARAMETERS.find(d => d.key === key)!;
const MACROS = MACRO_KEYS.map(definition);
const MACRO_NAMES: Record<string, string> = { macroOrder: 'Chaos' };
/** Within this distance of centre a fader rests on "as designed". Shift passes straight through. */
const CENTRE_DETENT = .025;
const PADS: readonly { action: MoveKey; label: string; hint?: string; connected?: boolean }[] = [
  { action: 'moveNext', label: 'Next', hint: 'N' }, { action: 'moveHold', label: 'Hold', hint: 'H' },
  { action: 'moveDrop', label: 'Drop', hint: 'D' }, { action: 'moveCollapse', label: 'Collapse', hint: 'C' },
  { action: 'moveMutate', label: 'Mutate', hint: 'M', connected: true }, { action: 'moveReseed', label: 'Reseed', hint: 'R', connected: true },
  { action: 'moveBurst', label: 'Burst' },
];

export interface MeridianPerformance { pressed: ReadonlySet<PerformanceAction>; press: (action: PerformanceAction) => void; release: (action: PerformanceAction) => void }

/**
 * Plays the moves, from buttons and keys. It lives in App so the keys still work in focus mode and on every tab.
 * Press and release go to `heldMoves`, not the Project, so playing never prepares, autosaves or enters Undo.
 * Mutate, Reseed and Recall are real edits and also act on the layer at once.
 */
export function useMeridianPerformance({ layer, enabled, edit, notify }: {
  layer: Layer | undefined; enabled: boolean; edit: (change: (l: Layer) => Layer, id: string) => void; notify: (message: string) => void;
}): MeridianPerformance {
  const [pressed, setPressed] = useState<ReadonlySet<PerformanceAction>>(() => new Set());
  const held = useRef(new Set<PerformanceAction>());
  const keys = useRef(new KeyHolds());
  const latest = useRef({ layer, edit, notify });
  latest.current = { layer, edit, notify };
  const layerId = layer?.kind === 'meridian' ? layer.id : undefined;

  const press = useCallback((action: PerformanceAction) => {
    const { layer, edit, notify } = latest.current;
    if (!layer || layer.kind !== 'meridian' || held.current.has(action)) return;
    const recallSlot = action.startsWith('recall:') ? Number(action.slice(7)) : -1;
    if (recallSlot >= 0 && !layer.params[`seedSlot${recallSlot}`]) { notify(`Seed slot ${recallSlot + 1} is empty.`); return; }
    held.current.add(action); setPressed(new Set(held.current));
    if (action === 'moveMutate') edit(l => applyLockedVariation(l, crypto.getRandomValues(new Uint32Array(1))[0], 'mutate'), layer.id);
    if (action === 'moveReseed') {
      if (layer.meridian?.locks.includes('Score')) notify('Score is locked, so Reseed keeps this seed.');
      else edit(l => applyLockedVariation(l, 1 + crypto.getRandomValues(new Uint32Array(1))[0] % MAX_STORED_SEED, 'reseed'), layer.id);
    }
    if (recallSlot >= 0) {
      edit(l => recallSeed(l, recallSlot), layer.id);
      heldMoves.set(layer.id, 'moveRecall', recallSlot + 1);
    } else heldMoves.set(layer.id, action, 1);
  }, []);
  const release = useCallback((action: PerformanceAction) => {
    if (!held.current.delete(action)) return;
    setPressed(new Set(held.current));
    const id = latest.current.layer?.id;
    if (id) heldMoves.set(id, action.startsWith('recall:') ? 'moveRecall' : action, 0);
  }, []);

  useEffect(() => {
    if (!enabled || !layerId) return;
    // macOS does not deliver a letter's keyup while Cmd is down, so Cmd lets go of every held key.
    const releaseKeys = () => { for (const action of keys.current.clear()) release(action); };
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Meta') { releaseKeys(); return; }
      const action = performanceShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLInputElement | null });
      if (!action) return;
      e.preventDefault();
      if (e.repeat) return;
      keys.current.down(e.code, action);
      press(action);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Meta') { releaseKeys(); return; }
      const action = keys.current.up(e.code);
      if (action) release(action);
    };
    const releaseAll = () => { keys.current.clear(); for (const action of [...held.current]) release(action); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', releaseAll);
      keys.current.clear(); held.current.clear();
      heldMoves.clear(layerId);
      setPressed(new Set());
    };
  }, [enabled, layerId, press, release]);
  return { pressed, press, release };
}

/** A vertical fader. It moves from where it is, so grabbing it on stage never makes the picture jump. */
function MacroFader({ d, value, onChange, onStart, onEnd }: { d: ParameterDefinition; value: number; onChange: (n: number) => void; onStart: () => void; onEnd: () => void }) {
  const drag = useRef<{ y: number; raw: number } | null>(null);
  const name = MACRO_NAMES[d.key] ?? d.label;
  const percent = clamp(value, 0, 1) * 100;
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const height = e.currentTarget.getBoundingClientRect().height;
    drag.current.raw = clamp(drag.current.raw + (drag.current.y - e.clientY) / height * (e.shiftKey ? .1 : 1), 0, 1);
    drag.current.y = e.clientY;
    const raw = drag.current.raw;
    const next = !e.shiftKey && Math.abs(raw - .5) < CENTRE_DETENT ? .5 : Number(raw.toFixed(e.shiftKey ? 3 : 2));
    if (next !== value) onChange(next);
  };
  const finish = () => { if (drag.current) { drag.current = null; onEnd(); } };
  return <div className="m-macro">
    <div className="m-fader" role="slider" tabIndex={0} aria-label={name} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}
      title={`${name}: ${d.description}\nDrag to move · Shift for fine control · double-click to centre`}
      style={{ '--level': `${percent}%`, '--from': `${Math.min(percent, 50)}%`, '--to': `${Math.max(percent, 50)}%` } as CSSProperties}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus(); drag.current = { y: e.clientY, raw: value }; onStart(); }}
      onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onDoubleClick={() => { if (value !== d.default) onChange(d.default); }}
      onKeyDown={e => {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault(); onStart();
        const by = (e.shiftKey ? .001 : .01) * (['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : -1);
        onChange(Number(clamp(value + by, 0, 1).toFixed(3)));
      }} onKeyUp={onEnd}>
      <i className="m-fader-fill" /><i className="m-fader-centre" /><i className="m-fader-cap" />
    </div>
    <span className="m-macro-name">{name}</span>
    <span className="m-macro-value">{Math.round(percent)}</span>
  </div>;
}

const EVOLVE_MOVES: Partial<Record<MoveKey, string>> = {
  moveNext: 'Glides to the next form.', moveHold: 'Holds the current form for as long as it is held.', moveDrop: 'Swells the hero and the light.',
  moveCollapse: 'Gathers the structure inward while held, then lets it open again.', moveMutate: 'Varies the drawing, gliding to the new values.', moveReseed: 'Glides to a new composition.', moveBurst: 'Sends a ripple of light outward.',
};

function MovePad({ action, label, hint, connected, evolve, performance }: { action: MoveKey; label: string; hint?: string; connected?: boolean; evolve: boolean; performance: MeridianPerformance }) {
  const d = definition(action), down = performance.pressed.has(action);
  const title = `${label}${hint ? ` · ${hint}` : ''}\n${evolve ? EVOLVE_MOVES[action] : connected ? d.description : 'Playback does not follow this move yet.'}`;
  return <button className={`m-pad ${down ? 'is-down' : ''}`} aria-pressed={down} title={title}
    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); performance.press(action); }}
    onPointerUp={() => performance.release(action)} onPointerCancel={() => performance.release(action)} onLostPointerCapture={() => performance.release(action)}
    onClick={e => { if (e.detail === 0) { performance.press(action); performance.release(action); } }}>
    <span>{label}</span>{hint && <kbd>{hint}</kbd>}
  </button>;
}

function SeedBank({ layer, edit, performance, notify }: { layer: Layer; edit: (change: (l: Layer) => Layer) => void; performance: MeridianPerformance; notify: (message: string) => void }) {
  const store = (slot: number) => {
    const next = storeSeed(layer, slot);
    if (next === layer) { notify(layer.params.seed ? `Seed slots hold seeds up to ${MAX_STORED_SEED}.` : 'Seed 0 cannot be stored.'); return; }
    edit(l => storeSeed(l, slot));
  };
  return <div className="m-bank" role="group" aria-label="Seed bank">{Array.from({ length: SEED_SLOTS }, (_, slot) => {
    const action: PerformanceAction = `recall:${slot}`, seed = layer.params[`seedSlot${slot}`] ?? 0;
    const active = !!seed && seed === layer.params.seed;
    return <button key={slot} aria-label={seed ? `Recall seed ${seed} from slot ${slot + 1}` : `Store seed in slot ${slot + 1}`}
      className={`m-slot ${seed ? 'is-filled' : ''} ${active ? 'is-active' : ''} ${performance.pressed.has(action) ? 'is-down' : ''}`}
      title={seed ? `Slot ${slot + 1}: seed ${seed}\nClick or press ${slot + 1} to recall · Shift-click to overwrite` : `Slot ${slot + 1} is empty\nClick to store the current seed`}
      onPointerDown={e => {
        if (e.shiftKey || !seed) { store(slot); return; }
        e.currentTarget.setPointerCapture(e.pointerId); performance.press(action);
      }} onPointerUp={() => performance.release(action)} onPointerCancel={() => performance.release(action)} onLostPointerCapture={() => performance.release(action)}
      onClick={e => { if (e.detail !== 0) return; if (seed) { performance.press(action); performance.release(action); } else store(slot); }}>{slot + 1}</button>;
  })}</div>;
}

function Morph({ layer, edit, onStart, onEnd }: { layer: Layer; edit: (change: (l: Layer) => Layer) => void; onStart: () => void; onEnd: () => void }) {
  const amount = layer.meridian?.morphAmount ?? 0;
  const ready = !!layer.meridian?.morphA && !!layer.meridian.morphB;
  const capture = (side: 'morphA' | 'morphB') => <button className={`m-capture ${layer.meridian?.[side] ? 'is-filled' : ''}`} aria-label={`Capture ${side === 'morphA' ? 'A' : 'B'}`} title={`Capture the current look as ${side === 'morphA' ? 'A' : 'B'}`} onClick={() => edit(l => captureMorph(l, side))}>{side === 'morphA' ? 'A' : 'B'}</button>;
  return <div className="m-morph">{capture('morphA')}
    <input type="range" aria-label="Morph between A and B" min={0} max={1} step={.01} value={amount} disabled={!ready} style={{ '--fill': `${amount * 100}%` } as CSSProperties}
      title={ready ? 'Crossfade from A to B · locked groups stay put' : 'Capture A and B to crossfade between them'}
      onPointerDown={onStart} onPointerUp={onEnd} onPointerCancel={onEnd} onKeyUp={onEnd}
      onKeyDown={e => { if (e.key.startsWith('Arrow')) onStart(); }}
      onChange={e => { const next = Number(e.target.value); edit(l => applyMorph(l, next)); }} />
    {capture('morphB')}</div>;
}

function SeedField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const d = definition('seed'), [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = draft.trim() ? Number(draft) : NaN;
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    const next = clamp(Math.round(n), d.min, d.max);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  // The caption's click would focus the field, which would take the keyboard away from the performance keys.
  return <label className="m-seed" title={`${d.description}\nDouble-click the label to reset`}><span onClick={e => e.preventDefault()} onDoubleClick={() => { if (value !== d.default) onChange(d.default); }}>Seed</span><input aria-label="Meridian seed" type="number" min={d.min} max={d.max} step={1} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setDraft(String(value)); } }} /></label>;
}

/** Reads a user's PNG through the same checks as any imported image. */
async function readMark(file: File): Promise<NonNullable<NonNullable<Layer['meridian']>['mark']>> {
  assertImportableImage(file);
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Image could not be read.')); reader.readAsDataURL(file); });
  const mark = meridianMark(dataUrl);
  if (mark.width > MAX_IMPORT_SIDE || mark.height > MAX_IMPORT_SIDE) throw new Error('Images must be no larger than 8192 pixels on either side.');
  await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(); image.onerror = () => reject(new Error('Image could not be decoded.')); image.src = dataUrl; });
  return mark;
}

/** Off until a PNG is imported. Pulse and Dense only: Evolve never draws it, so there it shows only a stored Mark, to remove. */
function MarkControl({ layer, edit, notify }: { layer: Layer; edit: (change: (l: Layer) => Layer) => void; notify: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null), mark = layer.meridian?.mark;
  const choose = async (file: File | undefined) => {
    if (!file) return;
    try {
      const next = await readMark(file);
      edit(l => ({ ...l, meridian: { locks: [], ...l.meridian, mark: next } }));
    } catch (e) { notify(e instanceof Error ? e.message.replace(/^Invalid project: mark /, 'This Mark ') : 'The Mark could not be imported.'); }
  };
  const remove = () => edit(l => { const { mark: _removed, ...state } = l.meridian ?? { locks: [] }; return { ...l, meridian: state }; });
  const applies = markApplies(layer);
  if (!applies && !mark) return null;
  return <>
    <div className="m-heading" title={MARK_HINT}><span>Mark</span><small>{applies ? (mark ? `${mark.width} × ${mark.height}` : 'Off') : 'Pulse and Dense only'}</small></div>
    <input ref={input} hidden type="file" accept="image/png" aria-label="Mark PNG file" onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
    <div className="m-mark-row">
      {applies && <button className={`m-capture m-mark ${mark ? 'is-filled' : ''}`} title={MARK_HINT} onClick={() => input.current?.click()}>{mark ? 'Replace PNG' : 'Import PNG'}</button>}
      {mark && <button className="m-capture m-mark" title="Turn the Mark off" onClick={remove}>Remove</button>}
    </div>
  </>;
}

/** Which engine, and the controls that belong to it. */
function PulseStrip({ layer, setParam, onStart, onEnd }: { layer: Layer; setParam: (key: string, value: number) => void; onStart: () => void; onEnd: () => void }) {
  const style = Math.round(layer.params.scoreStyle ?? 2), looping = (layer.params.scoreLoopPhrase ?? 0) >= .5, holding = (layer.params.scoreHoldShape ?? 0) >= .5;
  const evolution = layer.params.scoreEvolution ?? .5;
  const number = (key: string, label: string, enabled: boolean) => {
    const d = definition(key);
    return <label className="m-pulse-field" title={d.description}><span>{label}</span><input type="number" aria-label={d.label} min={d.min} max={d.max} step={1} disabled={!enabled} value={layer.params[key] ?? d.default}
      onChange={e => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) setParam(key, clamp(Math.round(n), d.min, d.max)); }} /></label>;
  };
  return <section className="m-block m-pulse" aria-label="Engine">
    <div className="m-pulse-style" role="group" aria-label="Style">
      {([[2, 'Evolve'], [0, 'Pulse'], [1, 'Dense']] as const).map(([value, name]) => <button key={name} className={style === value ? 'is-on' : ''} aria-pressed={style === value} title={definition('scoreStyle').description} onClick={() => setParam('scoreStyle', value)}>{name}</button>)}
    </div>
    {number('scoreBpm', 'BPM', style !== 1)}
    {style === 2 ? <>
      <label className="m-evolution" title={definition('scoreEvolution').description}><span>Evolution</span>
        <input type="range" aria-label="Evolution" min={0} max={1} step={.01} value={evolution} disabled={holding} style={{ '--fill': `${evolution * 100}%` } as CSSProperties}
          onPointerDown={onStart} onPointerUp={onEnd} onPointerCancel={onEnd} onKeyDown={e => { if (e.key.startsWith('Arrow')) onStart(); }} onKeyUp={onEnd} onChange={e => setParam('scoreEvolution', Number(e.target.value))} />
      </label>
      <button className={`m-pulse-loop ${holding ? 'is-on' : ''}`} aria-pressed={holding} title={definition('scoreHoldShape').description} onClick={() => setParam('scoreHoldShape', holding ? 0 : 1)}>Hold shape</button>
    </> : <>
      {number('scorePulseBars', 'Bars', style === 0)}
      <button className={`m-pulse-loop ${looping ? 'is-on' : ''}`} aria-pressed={looping} disabled={style !== 0} title={definition('scoreLoopPhrase').description} onClick={() => setParam('scoreLoopPhrase', looping ? 0 : 1)}>Loop phrase</button>
      <p className="m-style-note" role="note">{style === 0 ? 'Pulse' : 'Dense'} is not checked for flashing in this preview or in exports. On a Map wall or the Live output, the wall's flash limiter covers it.</p>
    </>}
  </section>;
}

const STATUS_NAMES = { locked: 'Locked to the music', holding: 'Holding the last tempo', free: 'Free · no music heard' } as const;

/** Where the sound comes from, and whether the piece is following it. Exports never use this. */
function MusicBlock({ slot }: { slot: ReactNode }) {
  const [shown, setShown] = useState({ status: musicStatus.status, bpm: musicStatus.bpm });
  useEffect(() => {
    const timer = window.setInterval(() => setShown(now => now.status === musicStatus.status && Math.round(now.bpm) === Math.round(musicStatus.bpm) ? now : { status: musicStatus.status, bpm: musicStatus.bpm }), 250);
    return () => window.clearInterval(timer);
  }, []);
  return <section className="m-block m-music" aria-label="Music">
    <div className="m-heading"><span>Music</span><small role="status">{STATUS_NAMES[shown.status]}{shown.status === 'free' ? '' : ` · ${Math.round(shown.bpm)} BPM`}</small></div>
    {slot}
    <p className="m-music-note">Music moves the light in the preview. Exports stay as composed.</p>
  </section>;
}

/** Turning the guard off takes a second, deliberate press. */
function FlashGuardControl({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [asking, setAsking] = useState(false), on = value >= .5;
  if (!on) return <div className="m-guard is-off"><strong>Flash guard is off</strong><button className="m-capture" onClick={() => onChange(1)}>Turn on</button></div>;
  if (asking) return <div className="m-guard" role="alertdialog" aria-label="Turn off Flash guard?"><span>Large bright flashes will no longer be limited. This can harm people with photosensitive epilepsy.</span>
    <button className="m-capture" onClick={() => setAsking(false)}>Keep on</button><button className="m-capture" onClick={() => { setAsking(false); onChange(0); }}>Turn off</button></div>;
  return <div className="m-guard"><span>Flash guard on</span><button className="m-capture" onClick={() => setAsking(true)}>Turn off…</button></div>;
}

export function MeridianControls({ layer, edit, performance, notify, onAnimateKey, onStart, onEnd, queued, soundSlot }: {
  soundSlot?: ReactNode;
  layer: Layer; edit: (change: (l: Layer) => Layer) => void; performance: MeridianPerformance; notify: (message: string) => void;
  onAnimateKey?: (key: string) => void; onStart: () => void; onEnd: () => void;
  /** Structural keys waiting for the next phrase. The Conductor supplies this; nothing is queued without it. */
  queued?: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState(''), [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const searching = query.trim().length > 0;
  const groups = filterParameters(PANEL_PARAMETERS, query);
  const locks = layer.meridian?.locks ?? [], evolve = Math.round(layer.params.scoreStyle ?? 2) === 2;
  const setParam = (key: string, value: number) => edit(l => ({ ...l, params: { ...l.params, [key]: value } }));
  const toggle = (group: string) => setOpen(now => { const next = new Set(now); if (!next.delete(group)) next.add(group); return next; });
  const control = (d: ParameterDefinition) => {
    const value = layer.params[d.key] ?? d.default, choices = MERIDIAN_CHOICES[d.key];
    const unused = evolve && EVOLVE_INACTIVE.includes(d.key);
    const body = d.key === 'safetyFlashGuard' ? <FlashGuardControl value={value} onChange={n => setParam(d.key, n)} /> : d.key === 'seed' ? <SeedField value={value} onChange={n => setParam('seed', n)} />
      : choices ? <ChoiceParameter label={d.label} name={d.label} options={[...choices]} value={value} resetTo={d.default} onChange={n => setParam(d.key, n)} />
      : <Parameter definition={d} value={value} animated={!!layer.modulations[d.key]} onChange={n => setParam(d.key, n)} onAnimate={!onAnimateKey || d.step === 1 || d.structural || motionIgnored(layer, d.key) ? undefined : () => onAnimateKey(d.key)} onStart={onStart} onEnd={onEnd} />;
    return <div className={`m-param ${unused ? 'is-unused' : ''}`} key={d.key} title={unused ? 'Not used by Evolve' : undefined}>{unused && <span className="m-unused">Not in Evolve</span>}{queued?.has(d.key) && <span className="m-next">Next phrase</span>}{body}</div>;
  };
  return <div className="meridian-controls">
    <section className="m-block" aria-label="Macros"><div className="m-macros">{MACROS.map(d => <MacroFader key={d.key} d={d} value={layer.params[d.key] ?? d.default} onChange={n => setParam(d.key, n)} onStart={onStart} onEnd={onEnd} />)}</div></section>
    <PulseStrip layer={layer} setParam={setParam} onStart={onStart} onEnd={onEnd} />
    <section className="m-block" aria-label="Moves"><div className="m-pads">{PADS.map(pad => <MovePad key={pad.action} {...pad} evolve={Math.round(layer.params.scoreStyle ?? 2) === 2} performance={performance} />)}</div></section>
    <section className="m-block" aria-label="Seeds and morph">
      <div className="m-heading"><span>Seeds</span><small>{layer.params.seed}</small></div>
      <SeedBank layer={layer} edit={edit} performance={performance} notify={notify} />
      <div className="m-heading"><span>Morph</span></div>
      <Morph layer={layer} edit={edit} onStart={onStart} onEnd={onEnd} />
      <MarkControl layer={layer} edit={edit} notify={notify} />
    </section>
    {evolve && soundSlot && <MusicBlock slot={soundSlot} />}
    {evolve && <section className="m-block" aria-label="Installation"><InstallationControls surface="map" /></section>}
    <label className="m-search"><Icon name="search" size={14} /><input type="search" aria-label="Search parameters" placeholder={`Search ${PANEL_PARAMETERS.length} parameters`} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }} /></label>
    <div className="m-groups">
      {MERIDIAN_GROUPS.filter(group => groups.has(group)).map(group => {
        const expanded = searching || open.has(group), locked = locks.includes(group);
        return <section className={`m-group ${locked ? 'is-locked' : ''}`} key={group}>
          <div className="m-group-head">
            <button className="m-group-toggle" aria-expanded={expanded} onClick={() => toggle(group)} disabled={searching}><Icon name={expanded ? 'down' : 'arrow'} size={12} /><span>{group}</span><small>{groups.get(group)!.length}</small></button>
            <button className="m-lock" aria-pressed={locked} aria-label={`${locked ? 'Unlock' : 'Lock'} ${group}`} title={locked ? `${group} is locked: Mutate and Reseed leave it alone` : `Lock ${group} against Mutate and Reseed`} onClick={() => edit(l => toggleGroupLock(l, group))}><Icon name={locked ? 'lock' : 'unlock'} size={13} /></button>
          </div>
          {expanded && <div className="m-group-body">{groups.get(group)!.map(control)}</div>}
        </section>;
      })}
      {!groups.size && <p className="m-empty">No parameters match “{query}”.</p>}
    </div>
  </div>;
}
