/**
 * The Finish tab of a layer: a short list of the effects in use, a browser to add more, and one effect's controls at
 * a time. Studio's Finish tab and Map's Finish part both draw it.
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { TOON_KEYS, FEEDBACK_KEYS, GLOW_KEYS } from '../core/finishing';
import { SLIT_MODES, SLIT_SHAPES, slitControlVisible } from '../rendering/slitscan';
import { FINISH_GROUPS, pickerEffects, addFinishEffect, finishEffectOn, finishEffectsFor, finishRackEffects, finishSummary, hasPower, powerLocked, resetFinishEffect, toggleFinishEffect, type FinishEffect, type FinishGroup } from './finish-rack';
import { FINISH_THUMBS } from './finish-thumbs';
import type { Layer, ParameterDefinition } from '../shared/types';
import { ChoiceParameter, Parameter } from './LayerControls';
import { LiquidSection, LumaWarpSection, MirrorSection, PolarSection, WarpSection } from './WarpSections';
import { ColourSplitSection, GradientMapSection, ColourBalanceSection, KeySection } from './ColourSections';

const SLIT_MODE_HELP = ['Each part of the frame lags by its own delay, set by the delay map.', 'Every slice is layered on top, the newest strongest, so motion leaves fading echoes.', 'Median keeps the middle value of the slices, so moving things drop out and still things stay.', 'Keeps the darkest value of the slices, so dark shapes leave trails.', 'Keeps the brightest value of the slices, so bright shapes leave trails.'];

const PRINT_CHOICES: Record<string, string[]> = {
  printType: ['Dots', 'Lines', 'Dither'],
  printDot: ['Round', 'Classic', 'Diamond', 'Square'],
  printMatrix: ['2×2', '4×4', '8×8'],
  printColour: ['Layer colour', 'Palette ink', 'RGB light', 'CMYK ink'],
  printArea: ['Everywhere', 'Edges only', 'Away from edges'],
};
const PRINT_GROUPS: [string, string[]][] = [
  ['Screen', ['printMix', 'printType', 'printSize', 'printAngle', 'printDot', 'printMatrix', 'printScroll']],
  ['Tone', ['printFloor', 'printCeiling', 'printMax', 'printGain', 'printSoft', 'printInvert']],
  ['Colour', ['printColour', 'printInk', 'printPaper']],
  ['Where it prints', ['printArea', 'printEdgeWidth', 'printEdgeSense', 'printEdgeFeather']],
];
/** Whether a print control applies, given the layer's other print choices. */
function printControlShown(layer: Layer, key: string): boolean {
  const p = layer.params, type = Math.round(p.printType ?? 0), colour = Math.round(p.printColour ?? 0);
  if (key === 'printMix') return true;
  if (!((p.printMix ?? 0) > 0 || !!layer.modulations.printMix)) return false;
  if (key === 'printDot') return type === 0;
  if (key === 'printMatrix') return type === 2;
  if (key === 'printInk') return colour === 1;
  if (key === 'printInvert') return colour < 2;
  if (key.startsWith('printEdge')) return Math.round(p.printArea ?? 0) > 0;
  return true;
}
export function PrintScreenSection({ layer, definitions, edit, animate, onStart, onEnd, extra, readOnly }: FinishProps) {
  const set = (key: string, n: number) => edit(l => ({ ...l, params: { ...l.params, [key]: n } }));
  const on = (layer.params.printMix ?? 0) > 0 || !!layer.modulations.printMix;
  return <>
    {PRINT_GROUPS.map(([group, keys]) => {
      const shown = keys.filter(key => printControlShown(layer, key));
      if (!shown.length) return null;
      return <div key={group}>{on && <h4 className="control-subheading">{group}</h4>}{shown.map(key => {
        const d = definitions.find(item => item.key === key);
        if (!d) return null;
        if (PRINT_CHOICES[key]) return <ChoiceParameter key={key} label={d.label} name={d.label} options={PRINT_CHOICES[key]} value={layer.params[key] ?? d.default} onChange={n => set(key, n)} />;
        return <Parameter key={key} definition={d} value={layer.params[key] ?? d.default} animated={!!layer.modulations[key]} readOnly={readOnly?.(d) ?? false} onChange={n => set(key, n)} onAnimate={animate && d.step !== 1 ? () => animate(key) : undefined} extra={extra?.(d)} onStart={onStart} onEnd={onEnd} />;
      })}</div>;
    })}
  </>;
}

export interface FinishProps {
  layer: Layer;
  definitions: ParameterDefinition[];
  edit: (change: (layer: Layer) => Layer) => void;
  /** Studio: jump to the Motion tab for this setting. Map leaves it out and shows its own control through `extra`. */
  animate?: (key: string) => void;
  onStart: () => void;
  onEnd: () => void;
  extra?: (d: ParameterDefinition) => ReactNode;
  readOnly?: (d: ParameterDefinition) => boolean;
  /** Whether a visible layer sits under this one; Luma Warp says so when it is driven by a layer that is not there. */
  hasLayerBelow?: boolean;
  /** Studio's layer settings (Transform, Mask, Output, Background), listed under the effects. */
  layerPanels?: FinishPanel[];
  /** The open row, when the parent keeps it across tab changes. */
  open?: string | null;
  onOpen?: (id: string | null) => void;
}

export interface FinishPanel { id: string; label: string; summary?: string; on?: boolean; content: ReactNode }

/** Feedback has the most settings, so they sit in four short parts under its amount. */
const FEEDBACK_PARTS: [string, string[]][] = [
  ['Move', ['echoZoom', 'echoRotate', 'echoDriftX', 'echoDriftY', 'echoCentreX', 'echoCentreY', 'echoTiltX', 'echoTiltY', 'echoLens']],
  ['Frame', ['echoFrame', 'echoWindow', 'echoRound', 'echoSquare', 'echoEdge']],
  ['Colour', ['echoHue', 'echoColourDrift', 'echoPunch', 'echoCrush', 'echoKeep', 'echoBlend']],
  ['Damage', ['echoMelt', 'echoStreak', 'echoStreakAxis', 'echoBlock', 'echoSlip', 'echoEvents', 'echoPixel']],
];

/** Per-layer list state for this session. It outlives the panel, which unmounts on every tab change. */
const addedEffects = new Map<string, Set<string>>();
const storedAmounts = new Map<string, Record<string, number>>();
const ADD_VIEW = 'add-effect';

const Chevron = ({ back = false }: { back?: boolean }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={back ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} /></svg>;

export function FinishSections({ layer, definitions, edit, animate, onStart, onEnd, extra, readOnly, hasLayerBelow, layerPanels = [], open: openProp, onOpen }: FinishProps) {
  const p = layer.params, mod = layer.modulations;
  const [ownOpen, setOwnOpen] = useState<string | null>(null);
  const requested = openProp === undefined ? ownOpen : openProp;
  const setOpen = (id: string | null) => { setOwnOpen(id); onOpen?.(id); };
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<FinishGroup | 'All'>('All');
  const root = useRef<HTMLDivElement>(null);
  const [feedbackPart, setFeedbackPart] = useState('Move');
  const available = finishEffectsFor(layer, definitions);
  const added = addedEffects.get(layer.id) ?? new Set<string>();
  const effects = finishRackEffects(layer, definitions, added);
  const picking = requested === ADD_VIEW;
  // The group filter starts at All each time the picker opens.
  useEffect(() => { if (!picking) setGroup('All'); }, [picking]);
  const effect = effects.find(item => item.id === requested);
  const panel = layerPanels.find(item => item.id === requested);
  const openId = effect?.id ?? panel?.id ?? null;
  const order = [...effects.map(item => item.id), ...layerPanels.map(item => item.id)];
  const labelOf = (id: string) => effects.find(item => item.id === id)?.label ?? layerPanels.find(item => item.id === id)?.label ?? '';
  // A newly opened effect starts at its first control.
  useEffect(() => {
    for (let node = root.current?.parentElement; node; node = node.parentElement) if (/auto|scroll/.test(getComputedStyle(node).overflowY)) { node.scrollTop = 0; break; }
  }, [openId, picking]);
  const set = (key: string, n: number) => edit(l => ({ ...l, params: { ...l.params, [key]: n } }));
  /** One slider. Settings that choose among whole steps (step 1) have no wave. */
  const row = (d: ParameterDefinition, steps = false) => <Parameter key={d.key} definition={d} value={p[d.key] ?? d.default} animated={!!mod[d.key]} readOnly={readOnly?.(d) ?? false}
    onChange={n => set(d.key, n)} onAnimate={animate && !(steps && d.step === 1) ? () => animate(d.key) : undefined} extra={extra?.(d)} onStart={onStart} onEnd={onEnd} />;
  const choice = (label: string, options: string[], key: string) => <ChoiceParameter label={label} name={label} options={options} value={p[key] ?? 0} onChange={n => set(key, n)} />;
  const opacity: ParameterDefinition = { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: .01, default: 1, section: 'Material' };
  const echoOn = (p.echo ?? 0) > 0 || !!mod.echo;
  const sectionProps = { layer, definitions, edit, animate, onStart, onEnd, extra, readOnly, hasLayerBelow };
  const slitChoice = (key: string, label: string, options: string[]) => slitControlVisible(layer, key) && <ChoiceParameter key={key} label={label} name={label} options={options} value={p[key] ?? 0} onChange={n => set(key, n)} />;
  const slitRows = (keys: string[]) => definitions.filter(d => keys.includes(d.key) && slitControlVisible(layer, d.key)).map(d => row(d, true));
  const slitMode = Math.round(p.slitMode ?? 0);
  const blocked = (item: FinishEffect, keys: string[]) => keys.some(key => { const d = definitions.find(x => x.key === key); return !!d && (readOnly?.(d) ?? false); }) || (keys === item.keys ? false : powerLocked(layer, item));
  const toggle = (item: FinishEffect) => {
    const id = layer.id + ':' + item.id, result = toggleFinishEffect(layer, item, definitions, storedAmounts.get(id));
    if (result.stored) storedAmounts.set(id, result.stored); else storedAmounts.delete(id);
    keep(item.id);
    onStart(); edit(() => result.layer); onEnd();
  };
  const keep = (id: string) => { const next = addedEffects.get(layer.id) ?? new Set<string>(); next.add(id); addedEffects.set(layer.id, next); };
  const pick = (item: FinishEffect) => {
    if (!effects.includes(item)) {
      const id = layer.id + ':' + item.id, result = addFinishEffect(layer, item, definitions, storedAmounts.get(id));
      storedAmounts.delete(id); keep(item.id);
      if (result.layer !== layer) { onStart(); edit(() => result.layer); onEnd(); }
    }
    setSearch(''); setOpen(item.id);
  };
  const remove = (item: FinishEffect) => {
    addedEffects.get(layer.id)?.delete(item.id); storedAmounts.delete(layer.id + ':' + item.id);
    onStart(); edit(l => resetFinishEffect(l, item, definitions)); onEnd();
    setOpen(null); refresh();
  };
  const powerSwitch = (item: FinishEffect) => {
    if (!hasPower(item)) return <span className="finish-switch-space" />;
    const on = finishEffectOn(layer, item, definitions), locked = blocked(item, Object.keys(item.power));
    return <button type="button" role="switch" aria-checked={on} aria-label={item.label + ' on'} className="finish-switch" disabled={locked} title={powerLocked(layer, item) ? 'Animated. Change it in Motion.' : on ? 'Turn off and keep the settings' : 'Turn on'} onClick={() => toggle(item)}><span /></button>;
  };
  const body = (id: string) => {
    switch (id) {
      case 'colour': return definitions.filter(d => ['saturation', 'hue', 'exposure'].includes(d.key)).map(d => row(d));
      case 'tone': return definitions.filter(d => effects.find(item => item.id === 'tone')!.keys.includes(d.key)).map(d => row(d));
      case 'balance': return <ColourBalanceSection {...sectionProps} />;
      case 'gradient': return <GradientMapSection {...sectionProps} />;
      case 'key': return <KeySection {...sectionProps} />;
      case 'split': return <ColourSplitSection {...sectionProps} />;
      case 'warp': return <WarpSection {...sectionProps} />;
      case 'liquid': return <LiquidSection {...sectionProps} />;
      case 'lumaWarp': return <LumaWarpSection {...sectionProps} />;
      case 'polar': return <PolarSection {...sectionProps} />;
      case 'mirror': return <MirrorSection {...sectionProps} />;
      case 'print': return <PrintScreenSection {...sectionProps} />;
      case 'glow': return <>{definitions.filter(d => GLOW_KEYS.includes(d.key) && (d.key === 'glowMix' || (p.glowMix ?? 0) > 0 || !!mod.glowMix) && ((d.key !== 'glowStreakAngle' && d.key !== 'glowStreakShape') || (p.glowStreak ?? 0) > 0 || !!mod.glowStreak) && d.key !== 'glowStreakShape').map(d => row(d, true))}
        {((p.glowMix ?? 0) > 0 || !!mod.glowMix) && ((p.glowStreak ?? 0) > 0 || !!mod.glowStreak) && choice('Streak shape', ['Line', 'Cross'], 'glowStreakShape')}</>;
      case 'flat': return definitions.filter(d => TOON_KEYS.includes(d.key) && (d.key === 'toonMix' || (p.toonMix ?? 0) > 0) && (d.key !== 'toonOutlineColor' || (p.toonOutline ?? 0) > 0)).map(d => row(d, true));
      case 'time': return <>{slitRows(['slitShift', 'slitSpan'])}
        {slitChoice('slitMode', 'Time mode', SLIT_MODES)}
        {slitControlVisible(layer, 'slitMode') && <p className="muted-text">{SLIT_MODE_HELP[slitMode] ?? SLIT_MODE_HELP[0]}</p>}
        {slitChoice('slitDirection', 'Direction', ['Past', 'Future'])}
        {slitChoice('slitShape', 'Delay map', SLIT_SHAPES)}
        {slitRows(['slitSlices'])}
        {slitControlVisible(layer, 'slitSlices') && slitMode === 2 && <p className="muted-text">Median uses at most nine slices and always an odd number, so a Time slices setting above nine is capped at nine.</p>}
        {slitRows(['slitSmooth', 'slitBlocks', 'slitScroll', 'slitTwist', 'slitZoom', 'slitChroma', 'slitDecay', 'slitReach'])}</>;
      case 'feedback': {
        const shown = (d: ParameterDefinition) => FEEDBACK_KEYS.includes(d.key) && d.key !== 'echoBlend' && d.key !== 'echoStreakAxis' && (!['echoRound', 'echoSquare', 'echoEdge'].includes(d.key) || (p.echoFrame ?? 0) > 0 || (p.echoWindow ?? 0) > 0);
        const keys = FEEDBACK_PARTS.find(([name]) => name === feedbackPart)![1];
        return <>{definitions.filter(d => d.key === 'echo').map(d => row(d))}
          {echoOn && <><div className="finish-parts" role="group" aria-label="Feedback settings">{FEEDBACK_PARTS.map(([name]) => <button type="button" key={name} aria-pressed={feedbackPart === name} onClick={() => setFeedbackPart(name)}>{name}</button>)}</div>
            {definitions.filter(d => shown(d) && keys.includes(d.key)).map(d => row(d))}
            {keys.includes('echoBlend') && choice('Echo blend', ['Mix', 'Behind source', 'Brighter'], 'echoBlend')}
            {keys.includes('echoStreakAxis') && (p.echoStreak ?? 0) > 0 && choice('Streak direction', ['Radial', 'Box'], 'echoStreakAxis')}</>}</>;
      }
      default: return null;
    }
  };
  const rowFor = (id: string, label: string, summary: string, on: boolean, control: ReactNode) => <div key={id} className={'finish-row' + (on ? ' on' : '')}>
    <button type="button" className="finish-row-open" aria-label={label + ' settings'} onClick={() => setOpen(id)}><i aria-hidden="true" /><span>{label}</span><small>{summary}</small><Chevron /></button>{control}</div>;

  if (picking) {
    const groups = FINISH_GROUPS.filter(name => available.some(item => item.group === name));
    // A group this layer does not have falls back to All, so a layer switch never shows a false empty state.
    const effectiveGroup = group !== 'All' && groups.includes(group) ? group : 'All';
    const found = pickerEffects(available, effectiveGroup, search);
    const closePicker = () => { setSearch(''); setOpen(null); };
    const cannotAdd = (item: FinishEffect) => !effects.includes(item) && hasPower(item) && blocked(item, Object.keys(item.power));
    return <div ref={root} className="finish-picker" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); closePicker(); } }}>
      <div className="finish-detail-head">
        <div className="finish-detail-nav"><button type="button" className="finish-back" onClick={closePicker}><Chevron back />All finishes</button></div>
        <div className="finish-detail-title"><h3>Add effect</h3></div>
        <input className="finish-search" type="search" aria-label="Search effects" placeholder="Search effects" autoFocus value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && found[0] && !cannotAdd(found[0])) { e.preventDefault(); pick(found[0]); } }} />
      </div>
      <div className="finish-parts finish-groups" role="group" aria-label="Effect groups">{['All', ...groups].map(name => <button type="button" key={name} aria-pressed={effectiveGroup === name} onMouseDown={e => e.preventDefault()} onClick={() => setGroup(name as FinishGroup | 'All')}>{name}</button>)}</div>
      {FINISH_GROUPS.map(name => { const items = found.filter(item => item.group === name); return items.length > 0 && <section key={name} className="finish-picker-group"><h3>{name}</h3><div>
        {items.map(item => { const inUse = effects.includes(item); return <button type="button" key={item.id} className={inUse ? 'in-use' : ''} aria-label={(inUse ? 'Open ' : 'Add ') + item.label} title={item.description} disabled={cannotAdd(item)} onClick={() => pick(item)}><img src={FINISH_THUMBS[item.id]} alt="" /><span>{item.label}</span>{inUse && <small>Added</small>}</button>; })}
      </div></section>; })}
      {found.length === 0 && <p className="muted-text">No effects match that search.</p>}
    </div>;
  }
  if (openId) {
    const index = order.indexOf(openId), previous = order[(index - 1 + order.length) % order.length], next = order[(index + 1) % order.length];
    const active = effects.filter(item => item.id !== openId && finishEffectOn(layer, item, definitions));
    return <div ref={root} className="finish-detail" onKeyDown={e => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement && e.target.type !== 'range')) { e.stopPropagation(); setOpen(null); } }}>
      <div className="finish-detail-head">
        <div className="finish-detail-nav">
          <button type="button" className="finish-back" onClick={() => setOpen(null)}><Chevron back />All finishes</button>
          <button type="button" className="finish-step" aria-label={'Previous: ' + labelOf(previous)} title={labelOf(previous)} onClick={() => setOpen(previous)}><Chevron back /></button>
          <button type="button" className="finish-step" aria-label={'Next: ' + labelOf(next)} title={labelOf(next)} onClick={() => setOpen(next)}><Chevron /></button>
        </div>
        <div className="finish-detail-title"><h3>{effect?.label ?? panel!.label}</h3>
          {effect && <button type="button" className="finish-reset" disabled={blocked(effect, effect.keys)} onClick={() => { keep(effect.id); onStart(); edit(l => resetFinishEffect(l, effect, definitions)); onEnd(); storedAmounts.delete(layer.id + ':' + effect.id); }}>Reset</button>}
          {effect && <button type="button" className="finish-reset" disabled={blocked(effect, effect.keys)} onClick={() => remove(effect)}>Remove</button>}
          {effect && hasPower(effect) && powerSwitch(effect)}
        </div>
        {active.length > 0 && <div className="finish-hop" role="group" aria-label="Effects that are on">{active.map(item => <button type="button" key={item.id} onClick={() => setOpen(item.id)}>{item.label}</button>)}</div>}
      </div>
      {effect && <p className="muted-text finish-copy">{effect.description}</p>}
      <div className="finish-detail-body">{effect ? body(effect.id) : panel!.content}</div>
    </div>;
  }
  const activeCount = effects.filter(item => finishEffectOn(layer, item, definitions)).length;
  return <div ref={root} className="finish-list">
    <section className="control-section finish-mix"><h3>Layer mix</h3>
      <Parameter definition={opacity} value={layer.opacity} animated={!!mod.opacity} readOnly={readOnly?.(opacity) ?? false} onChange={n => edit(l => ({ ...l, opacity: n }))} onAnimate={animate ? () => animate('opacity') : undefined} onStart={onStart} onEnd={onEnd} />
      <label className="finish-blend">Blending<select aria-label="Blending" value={layer.blend} onChange={e => edit(l => ({ ...l, blend: e.target.value as Layer['blend'] }))}><option value="normal">Normal</option><option value="screen">Screen</option><option value="multiply">Multiply</option><option value="add">Light add</option><option value="source">Colour from below</option></select></label></section>
    <div className="finish-effects-head"><h3>Effects{activeCount > 0 && <small>{activeCount} on</small>}</h3><button type="button" className="finish-add" onClick={() => setOpen(ADD_VIEW)}><span aria-hidden="true">+</span>Add effect</button></div>
    {effects.length ? <section className="finish-group">{effects.map(item => rowFor(item.id, item.label, finishSummary(layer, item, definitions), finishEffectOn(layer, item, definitions), powerSwitch(item)))}</section>
      : <p className="finish-empty">No effects yet. Add one to start building a look.</p>}
    {layerPanels.length > 0 && <section className="finish-group"><h3>Layer</h3>{layerPanels.map(item => rowFor(item.id, item.label, item.summary ?? '', !!item.on, <span className="finish-switch-space" />))}</section>}
  </div>;
}
