/**
 * Studio's own controls for one layer's settings, shared by Studio's inspector and Map's Effect tab, so the two always
 * show the same settings, with the same ranges, steps, grouping and visibility.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Layer, LayerKind, ParameterDefinition } from '../shared/types';
import { applyPreset, EMBER_PALETTES, FRACTAL_FAMILIES, FRACTAL_VARIANTS, visibleParameterDefinitions, SCOPE_MODES, SUPER8_MODES } from '../core/project';
import { FINISH_KEYS } from '../core/finishing';
import { INSTRUMENTS, isInstrument } from '../core/instruments';
import { GRAPHIC_FAMILIES, GRAPHIC_VARIANTS, GRAPHIC_LOOKS } from '../core/graphics';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const patterns: Partial<Record<LayerKind, string[]>> = {
  surface: ['Bands', 'Contours', 'Drips', 'Fusion'],
  fractal: FRACTAL_FAMILIES,
};
export const surfaceVariants = [['Flow', 'Braids', 'Ribbons'], ['Terrace', 'Ripples', 'Vortex'], ['Melt', 'Beads', 'Strands'], ['Portal', 'Twin Portals', 'Lens']];
export const sculptureForms = ['Shell', 'Bloom', 'Ribbon', 'Knot'];
export const coloringModes = ['Palette', 'Duotone', 'Contours'];
export const mirrorModes = ['Original', 'Flip horizontal', 'Flip vertical', 'Flip both'];
export const gradingKeys = ['saturation', 'hue', 'exposure',...FINISH_KEYS];
export const graphicChoiceKeys = ['profile', 'fill', 'sweep', 'corners'];
export const choiceKeys = ['scopeMode','simulationQuality','flowMode','inkMode','reliefMode','phrase','style', 'variant', 'form', 'quality', 'radial', 'colorMode', 'mirror', 'substrate', 'mode', 'gateMode', 'autoTravel', 'seed'];
export const super8ControlGroups: [string, string[]][] = [
  ['Paint geometry', ['scale', 'steps', 'coverage', 'erosion', 'rotation']],
  ['Paint texture', ['texture', 'textureScale', 'roughness', 'bleed', 'emulsion']],
  ['Film motion & feedback', ['travel', 'cycles', 'filmFps', 'feedback', 'feedbackSpacing', 'feedbackZoom', 'feedbackRotation']],
  ['Rolling shutter', ['rollAmount', 'rollBands', 'rollOrigin', 'rollSmear']],
  ['Projector transport', ['pullDown', 'shutter', 'shutterBlades', 'reelLoops', 'weave', 'flicker', 'frameLines']],
  ['Film gate', ['gateInset', 'gateRoundness', 'sprockets']],
  ['Film wear', ['scratches', 'grain', 'dust', 'hair']],
  ['Projector lens', ['lensSoftness', 'halation', 'vignette', 'lightLeak', 'colorFade']],
];
export const super8PaletteLabels = ['Paint 1', 'Paint 2', 'Paint 3', 'Paint 4', 'Ink', 'Paper'];
export const scopePaletteLabels = ['Line', 'Halo', 'Bloom', 'Hot core', 'Second line', 'Unused'];
export const liquidPaletteLabels = ['Rim', 'Body', 'Mid', 'Hot', 'Wash', 'Ground'];
export const oilPaletteLabels = ['Paint', 'Secondary paint', 'Ink', 'Substrate', 'Shadow tint', 'Rim tint'];
export const oilFineControls = ['lensAspect', 'deformation', 'lensDepth', 'cellComplexity', 'dispersion', 'lift', 'filaments', 'softness', 'lightAngle', 'shadow', 'grain'];
export const secondaryShapeControls: Partial<Record<LayerKind, string[]>> = {
  surface: ['rotation', 'density', 'stretch', 'turbulence', 'centerX', 'centerY'],
  graphic: ['stretch', 'orientation', 'centerX', 'centerY'],
  sculpture: ['lobes', 'thickness', 'stretch', 'curl', 'foldFrequency', 'asymmetry', 'ridgeScale'],
};

export function ChoiceParameter({ label, name, options, value, onChange, disabled, resetTo }: { label: string; name: string; options: string[]; value: number; onChange: (n: number) => void; disabled?: boolean; /** Double-clicking the label returns to this value. */ resetTo?: number }) {
  // The label's click would focus the dropdown, which would then take the keyboard away from the performance keys.
  const caption = resetTo === undefined ? label : <span title="Double-click to reset" onClick={e => e.preventDefault()} onDoubleClick={() => { if (!disabled && Math.round(value) !== resetTo) onChange(resetTo); }}>{label}</span>;
  return <label className="stacked-label">{caption}<select aria-label={name} disabled={disabled} value={Math.round(value)} onChange={e => onChange(Number(e.target.value))}>{options.map((option, index) => <option key={index} value={index}>{option}</option>)}</select></label>;
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" />, pause: <><path d="M8 5v14M16 5v14" /></>,
    plus: <path d="M12 5v14M5 12h14" />, close: <path d="m6 6 12 12M18 6 6 18" />,
    save: <><path d="M5 3h12l4 4v14H3V3h2ZM7 3v6h9V3M7 21v-8h10v8" /></>,
    folder: <path d="M3 7V4h6l2 3h10v13H3V7Zm0 3h18" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
    undo: <path d="m8 4-5 5 5 5M3 9h10c8 0 8 11 0 11h-3" />, redo: <path d="m16 4 5 5-5 5m5-5H11c-8 0-8 11 0 11h3" />,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="m3 3 18 18M9 5.4A10 10 0 0 1 12 5c6 0 10 7 10 7a20 20 0 0 1-3 3.8M6 7c-2.5 2-4 5-4 5s4 7 10 7a12 12 0 0 0 5-1.2" /></>,
    layers: <><path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5" /></>,
    surface: <><path d="M3 5c6-6 12 6 18 0M3 12c6-6 12 6 18 0M3 19c6-6 12 6 18 0" /></>,
    sculpture: <><path d="M12 2c8 0 10 7 6 11s1 8-6 9S2 16 6 11 4 2 12 2Z" /><path d="M12 3c-4 6 6 9 0 18" /></>,
    fractal: <><path d="m12 2 9 5v10l-9 5-9-5V7Z" /><path d="m12 6 5 3v6l-5 3-5-3V9Zm0 4 2 2-2 2-2-2Z" /></>,
    super8: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18M3 16h18M7 4v4m5-4v4m5-4v4M7 16v4m5-4v4m5-4v4M7 14h3v-2h3v-2h4" /></>,
    oil: <><path d="M12 2C9 7 4 10 4 15a8 8 0 0 0 16 0c0-5-5-8-8-13Z" /><path d="M8 15a4 4 0 0 0 4 4" /><circle cx="14" cy="12" r="2" /></>,
    liquid: <><circle cx="9" cy="9" r="6" /><circle cx="17.5" cy="16.5" r="3.5" /><circle cx="7" cy="19" r="2" /><circle cx="18" cy="6" r="1.5" /></>,
    scope: <><circle cx="12" cy="12" r="9" /><path d="M3 12c3-8 6-8 9 0s6 8 9 0" /></>,
    smokecloud: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" /><path d="M4 5c2 1 2 3 1 4M20 19c-2-1-2-3-1-4M19 4c-1 2-3 2-4 1M5 20c1-2 3-2 4-1" /></>,
    meridian: <><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" /></>,
    graphic: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 3v4m9 5h-4m-5 9v-4M3 12h4" /></>,
    livingink: <><circle cx="8" cy="8" r="4"/><circle cx="16" cy="15" r="5"/></>,
    relief: <><path d="m3 6 7-3v15l-7 3Zm11 0 7-3v15l-7 3Z"/></>,
    resonance: <><circle cx="12" cy="12" r="9"/><path d="M5 5c14 0 0 14 14 14M19 5C5 5 19 19 5 19"/></>,
    glitchtunnel: <><rect x="3" y="3" width="18" height="18" rx="3"/><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10.5 10.5h3v3h-3zM3 12h4M17 12h4"/></>,
    texturecuts: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h6V3M15 21v-6h6M9 9l6 6M12 3v4M3 15h4"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 6-6 4 4 3-3 5 5" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
    wave: <path d="M2 12c4-13 6-13 10 0s6 13 10 0" />,
    unlock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4" /></>,
    shuffle: <><path d="M3 6h3c6 0 6 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-1 4-3m4-6c1-2 2-3 4-3h3m-4-4 4 4-4 4" /></>,
    library: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M12 8h5M12 12h5"/></>,
    inspector: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M6 8h6M6 12h4"/></>,
    focus: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>,
    settings: <><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
    check: <path d="m4 12 5 5L20 6" />, arrow: <path d="m9 5 7 7-7 7" />,
    up: <path d="m6 15 6-6 6 6" />, down: <path d="m6 9 6 6 6-6" />,
    grid: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h18M12 3v18" /></>,
    reset: <><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v.1" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.info}</svg>;
}

export function Parameter({ definition: d, value, animated, onChange, onAnimate, onStart, onEnd, extra, readOnly = false }: { definition: ParameterDefinition; value: number; animated: boolean; onChange: (n: number) => void; onAnimate?: () => void; onStart: () => void; onEnd: () => void; extra?: ReactNode; readOnly?: boolean }) {
  const percent = (value - d.min) / (d.max - d.min) * 100;
  // Fine control works in tenths of a slider step, so values show one more decimal place.
  const fineStep = d.step === 1 ? 1 : d.step / 10;
  const precision = Math.min(7, Math.max(0, Math.ceil(-Math.log10(fineStep))));
  // The slider itself steps in fineStep so fine values are representable; ordinary drags and keys still land on d.step.
  const snapTo = (n: number, step: number) => clamp(Number((d.min + Math.round((n - d.min) / step) * step).toFixed(7)), d.min, d.max);
  const snapFine = (n: number) => snapTo(n, fineStep);
  const fine = useRef<{ x: number; value: number } | null>(null), latest = useRef(value);
  latest.current = value;
  const reset = () => { if (value !== d.default) onChange(d.default); };
  const formatted = String(Number(value.toFixed(precision)));
  const [draft, setDraft] = useState(formatted), editing = useRef(false), cancelled = useRef(false), dirty = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(formatted); }, [formatted]);
  const commit = () => {
    editing.current = false;
    if (cancelled.current || !dirty.current) { cancelled.current = false; dirty.current = false; setDraft(formatted); return; }
    dirty.current = false;
    const n = draft.trim() ? Number(draft) : NaN;
    if (!Number.isFinite(n)) { setDraft(formatted); return; }
    const next = clamp(d.step === 1 ? Math.round(n) : n, d.min, d.max);
    setDraft(String(Number(next.toFixed(precision))));
    if (next !== value) onChange(next);
  };
  return <div className={`parameter${d.step < 0.001 ? ' precise-parameter' : ''}`}><div className="parameter-label"><label title={`${d.description ? `${d.label}: ${d.description}` : d.label}\nDouble-click to reset`} htmlFor={`parameter-${d.key}`} onDoubleClick={reset}>{d.label}</label><div><button className="parameter-reset" aria-label={`Reset ${d.label}`} title={`Reset ${d.label}`} disabled={value===d.default} onClick={()=>onChange(d.default)}>↺</button>{extra}{onAnimate && <button className={`mod-button ${animated ? 'active' : ''}`} onClick={onAnimate} title={`Animate ${d.label}`} aria-pressed={animated}><Icon name="wave" size={14} /></button>}<input aria-label={`${d.label} value`} disabled={readOnly} type="number" min={d.min} max={d.max} step={d.step} value={draft} onFocus={() => { editing.current = true; dirty.current = false; }} onChange={e => { dirty.current = true; setDraft(e.target.value); }} onBlur={commit} onKeyDown={e => { if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); } else if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && ['s', 'o'].includes(e.key.toLowerCase()))) e.currentTarget.blur(); }} /></div></div><input id={`parameter-${d.key}`} aria-label={d.label} disabled={readOnly} type="range" min={d.min} max={d.max} step={fineStep} value={value} style={{ '--fill': `${percent}%` } as CSSProperties} title="Double-click to reset · hold Shift for fine control"
    onPointerDown={() => { fine.current = null; onStart(); }}
    onPointerMove={e => {
      // Holding Shift during a drag moves the value at a tenth of the pointer's speed, from where Shift went down.
      if (!(e.buttons & 1) || !e.shiftKey) { fine.current = null; return; }
      if (!fine.current) { fine.current = { x: e.clientX, value: latest.current }; return; }
      const next = snapFine(fine.current.value + (e.clientX - fine.current.x) / e.currentTarget.getBoundingClientRect().width * (d.max - d.min) * .1);
      if (next !== latest.current) onChange(next);
    }}
    onPointerUp={() => { fine.current = null; onEnd(); }} onPointerCancel={() => { fine.current = null; onEnd(); }}
    onDoubleClick={reset}
    onKeyDown={e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); onStart();
      const by = e.shiftKey ? fineStep : d.step;
      onChange(snapFine(value + (['ArrowRight', 'ArrowUp'].includes(e.key) ? by : -by)));
    }}
    onKeyUp={onEnd} onChange={e => { if (!fine.current) onChange(snapTo(Number(e.target.value), d.step)); }} /></div>;
}

/**
 * The Shape tab of Studio's layer inspector: the choices, then the setting groups in Studio's order and folding, then
 * the finish settings and palette. Studio passes its image panel, surface editor and smoke audio input as slots.
 * paramExtra: shown beside a setting's label (Map's ∿). readOnly: a setting that cannot be moved here.
 */
export function LayerShapeControls({ locked = false, layer: selected, edit, onAnimateKey, onStart, onEnd, seed, duration, notify, oilFine, setOilFine, imageSlot, surfaceSlot, scopeAudioSlot, parametersSlot, paramExtra, readOnly }: {
  layer: Layer; edit: (change: (l: Layer) => Layer) => void; onAnimateKey?: (key: string) => void; onStart: () => void; onEnd: () => void;
  seed: number; duration: number; notify: (message: string) => void; oilFine: boolean; setOilFine: (change: (on: boolean) => boolean) => void;
  imageSlot?: ReactNode; surfaceSlot?: ReactNode; scopeAudioSlot?: ReactNode;
  /** Replaces the setting groups and the seed row with an instrument's own surface. */
  parametersSlot?: ReactNode;
  paramExtra?: (d: ParameterDefinition) => ReactNode; readOnly?: (d: ParameterDefinition) => boolean;
  /** Map: a locked shape's effect. Every control in it is disabled, choices and swatches too. */
  locked?: boolean;
}) {
  const definitions = visibleParameterDefinitions(selected);
  const scopeMode = definitions.find(d => d.key === 'scopeMode');
  const scopeLocked = scopeMode && readOnly?.(scopeMode);
  const isEmber = selected.kind === 'scope' && selected.params.scopeMode === 1;
  const emberScheme = isEmber ? EMBER_PALETTES.find(look => look.palette.every((colour, i) => colour === selected.palette[i]))?.id ?? '' : '';
  const scopeSwatch = (i: number) => isEmber && i === 5 ? 'Smoke tint' : scopePaletteLabels[i];
  const controlGroups = selected.kind === 'super8'
    ? super8ControlGroups.filter(([title]) => title !== 'Film gate' || selected.params.gateMode > 0)
      .map(([title, keys]) => ({ title, defs: keys.map(key => definitions.find(d => d.key === key)!).filter(d => d.key !== 'sprockets' || selected.params.gateMode === 2) }))
    : (['Shape', 'Motion', 'Material', 'Camera'] as const).map(title => ({ title, defs: definitions.filter(d => d.section === title) }));
  return <fieldset className="layer-controls" disabled={locked}>
        {patterns[selected.kind] && <div className="field-group"><label>{selected.kind === 'fractal' ? 'Fractal family' : 'Pattern'}</label><div className="pattern-picker">{patterns[selected.kind]!.map((label, i) => <button key={i} aria-pressed={Math.round(selected.params.style ?? 0) === i} className={Math.round(selected.params.style ?? 0) === i ? 'active' : ''} onClick={() => edit(l => ({ ...l, params: { ...l.params, style: i } }))}>{label}</button>)}</div></div>}
        {isInstrument(selected.kind) && <div className="projection-help"><p>{INSTRUMENTS.find(i=>i.kind===selected.kind)!.description}. Pattern scale reveals more of the field. Field background controls transparent gaps.</p>{selected.kind==='livingink' && <p>Growth family and Branching prepare a seeded chemical pattern. Playback animates its flow and pigment without simulation warm-up.</p>}</div>}
        {selected.kind === 'graphic' && <div className="graphic-options"><ChoiceParameter label="Pattern family" name="Graphic family" options={GRAPHIC_FAMILIES} value={selected.params.style} onChange={style => edit(l => applyPreset(l, GRAPHIC_LOOKS.find(look => look.params.style === style)!.id))} /><ChoiceParameter label="Starting look" name="Graphic look" options={GRAPHIC_VARIANTS[Math.round(selected.params.style)]} value={selected.params.variant} onChange={variant => edit(l => applyPreset(l, GRAPHIC_LOOKS.find(look => look.params.style === l.params.style && look.params.variant === variant)!.id))} />{selected.params.style === 2 && <><ChoiceParameter label="Tile finish" name="Tile finish" options={['Solid', 'Hollow outlines', 'Nested contours']} value={selected.params.fill} onChange={fill => edit(l => ({...l, params:{...l.params,fill}}))} /><ChoiceParameter label="Wave layout" name="Tile wave layout" options={['Still', 'Linear sweep', 'Radial ripple']} value={selected.params.sweep} onChange={sweep => edit(l => ({...l, params:{...l.params,sweep}}))} /></>}{selected.params.style === 3 && <ChoiceParameter label="Shape profile" name="Spiral shape profile" options={['Circle','Line','Triangle','Square','Pentagon','Hexagon','Heptagon','Octagon','Nonagon','Decagon']} value={selected.params.profile} onChange={profile => edit(l => ({...l, params:{...l.params,profile}}))} />}{selected.params.style === 4 && <ChoiceParameter label="Path corners" name="Path corners" options={['Square','Round','Soft bevel']} value={selected.params.corners} onChange={corners => edit(l => ({...l, params:{...l.params,corners}}))} />}<p>All patterns share the layer mix, masks and loop controls. Set Pattern background to zero for transparent gaps.</p></div>}
        {selected.kind === 'surface' && <ChoiceParameter label="Variant" name="Surface variant" options={surfaceVariants[Math.round(selected.params.style ?? 0)]} value={selected.params.variant} onChange={variant => edit(l => ({ ...l, params: { ...l.params, variant } }))} />}
        {selected.kind === 'sculpture' && <ChoiceParameter label="Form" name="Sculpture form" options={sculptureForms} value={selected.params.form} onChange={form => edit(l => ({ ...l, params: { ...l.params, form } }))} />}
        {selected.kind === 'fractal' && <div className="fractal-options"><label className="stacked-label">Variant<select aria-label="Fractal variant" value={Math.round(selected.params.variant ?? 0)} onChange={e => edit(l => ({ ...l, params: { ...l.params, variant: Number(e.target.value) } }))}>{FRACTAL_VARIANTS[Math.round(selected.params.style ?? 0)].map((label, value) => <option key={value} value={value}>{label}</option>)}</select></label><>{Math.round(selected.params.style ?? 0) === 2 && <label className="stacked-label">Radial fold<select aria-label="Mandelbox radial fold" value={Math.round(selected.params.radial ?? 0)} onChange={e => edit(l => ({ ...l, params: { ...l.params, radial: Number(e.target.value) } }))}><option value="0">Off</option><option value="1">On</option></select></label>}</><label className="stacked-label">Render quality<select aria-label="Fractal render quality" value={Math.round(selected.params.quality ?? 2)} onChange={e => edit(l => ({ ...l, params: { ...l.params, quality: Number(e.target.value) } }))}><option value="0">Draft</option><option value="1">Standard</option><option value="2">High</option></select></label><p>Quality sets the export sampling. Preview uses a lighter render.</p></div>}
        {selected.kind === 'fractal' && selected.params.style === 3 && <ChoiceParameter label="Travel mode" name="Fractal travel mode" options={['Manual', 'Loop']} value={selected.params.autoTravel} onChange={autoTravel => edit(l => ({ ...l, params: { ...l.params, autoTravel } }))} />}
        {selected.kind === 'fractal' && <ChoiceParameter label="Coloring" name="Fractal coloring" options={coloringModes} value={selected.params.colorMode} onChange={colorMode => edit(l => ({ ...l, params: { ...l.params, colorMode } }))} />}
        {scopeMode && <ChoiceParameter label="Oscilloscope mode" name="Oscilloscope mode" options={SCOPE_MODES} value={selected.params.scopeMode ?? 0} disabled={scopeLocked}
          onChange={scopeMode => edit(l => ({ ...l, params: { ...l.params, scopeMode } }))} />}
        {isEmber && scopeAudioSlot}
        {selected.kind === 'super8' && <div className="super8-options"><ChoiceParameter label="Mode" name="Super 8 mode" options={SUPER8_MODES} value={selected.params.mode} onChange={mode => edit(l => ({ ...l, params: { ...l.params, mode } }))} /><ChoiceParameter label="Substrate" name="Super 8 substrate" options={['Transparent cutout', 'Painted paper']} value={selected.params.substrate} onChange={substrate => edit(l => ({ ...l, params: { ...l.params, substrate } }))} /><ChoiceParameter label="Projector view" name="Super 8 projector view" options={['Full canvas', 'Rounded gate', 'Film strip']} value={selected.params.gateMode} onChange={gateMode => edit(l => ({ ...l, params: { ...l.params, gateMode } }))} /><p>Paint holds at the film frame rate. Frame advance and shutter move between exposures. Reel turns scroll the strip; Full canvas fills the output without a border.</p></div>}
        {isInstrument(selected.kind) && selected.params.reliefMode !== 2 && <ChoiceParameter label="Motion phrase" name="Motion phrase" options={['Steady travel','Gather and release','Drift and settle']} value={selected.params.phrase} onChange={phrase=>edit(l=>({...l,params:{...l.params,phrase}}))}/>}
        {selected.kind === 'livingink' && <>{selected.params.inkMode===2&&<ChoiceParameter label="Chemical resolution" name="Chemical resolution" options={['128 × 128','256 × 256','384 × 384']} value={selected.params.simulationQuality} onChange={simulationQuality=>edit(l=>({...l,params:{...l.params,simulationQuality}}))}/>}<ChoiceParameter label="Pigment motion" name="Pigment motion" options={['Prepared growth','Flowing pigment loop','Evolving chemistry']} value={selected.params.inkMode} onChange={inkMode=>{if(inkMode===2&&duration>60){notify('Shorten the clip to 60 seconds before enabling evolving chemistry.');return;}if(inkMode===2&&selected.modulations.scale){notify('Remove Pattern scale animation before enabling evolving chemistry.');return;}edit(l=>({...l,params:{...l.params,inkMode}}));}}/>{selected.params.inkMode===2&&<p className="motion-help">{(selected.params.loopReturn??0)>0?'Evolving chemistry grows through the loop, then recedes back to its seeds over the Loop return share, so it loops seamlessly.':'Evolving chemistry develops through this clip and stops at the end. Raise Loop return to make it loop.'} Growth and transport settings re-prepare its fixed simulation.</p>}</>}
        {selected.kind === 'relief' && <ChoiceParameter label="Relief construction" name="Relief construction" options={['Shaded field','Hinged solids','Concertina sheet']} value={selected.params.reliefMode} onChange={reliefMode=>edit(l=>({...l,params:{...l.params,reliefMode}}))}/>}
        {selected.kind === 'livingink' && <ChoiceParameter label="Growth family" name="Ink growth family" options={['Seeded cells','Fingerprints','Coral labyrinth','Cellular lace']} value={selected.params.pattern} onChange={pattern=>edit(l=>({...l,params:{...l.params,pattern}}))}/>}
        {selected.kind === 'relief' && selected.params.reliefMode !== 2 && <ChoiceParameter label="Hinge axis" name="Relief hinge axis" options={['Vertical','Horizontal','Diagonal']} value={selected.params.axis} onChange={axis=>edit(l=>({...l,params:{...l.params,axis}}))}/>}
        {selected.kind === 'oil' && <div className="oil-options"><ChoiceParameter label="Render quality" name="Oil render quality" options={['Draft', 'Standard', 'High']} value={selected.params.quality} onChange={quality => edit(l => ({ ...l, params: { ...l.params, quality } }))} /><ChoiceParameter label="Substrate" name="Oil substrate" options={['Transparent cutout', 'Colored substrate']} value={selected.params.substrate} onChange={substrate => edit(l => ({ ...l, params: { ...l.params, substrate } }))} />{selected.params.substrate === 0 && <p>Transparency keeps the glass tint and reflections.</p>}<button className="oil-fine-button" aria-expanded={oilFine} onClick={() => setOilFine(value => !value)}>{oilFine ? 'Hide fine tuning' : 'Show fine tuning'}<Icon name={oilFine ? 'up' : 'down'} size={13} /></button>{oilFine && <p>Organic shape softens the dome. Lens depth changes its bulge. Cell complexity adds branching; Color separation adds colored edges.</p>}</div>}
        {imageSlot}
        {parametersSlot ?? controlGroups.map(({ title, defs: groupDefs }) => { const defs = groupDefs.filter(d => !choiceKeys.includes(d.key) && !(selected.kind === 'livingink' && d.key === 'pattern') && !(selected.kind === 'relief' && d.key === 'axis') && !(selected.kind === 'graphic' && graphicChoiceKeys.includes(d.key)) && !gradingKeys.includes(d.key) && (selected.kind !== 'oil' || oilFine || !oilFineControls.includes(d.key))).map(d => ({ ...d, advanced: d.advanced || secondaryShapeControls[selected.kind]?.includes(d.key) })); if (!defs.length) return null; return <details className="control-section inspector-section" key={`${selected.kind}-${title}`} open={title === 'Shape' || title === 'Paint geometry' || selected.kind === 'fractal' && title === 'Motion'}><summary>{title}<span>{defs.length}</span></summary>{defs.filter(d=>!d.advanced).map(d => <Parameter key={d.key} definition={d} value={selected.params[d.key] ?? d.default} animated={!!selected.modulations[d.key]} onChange={n => edit(l => ({ ...l, params: { ...l.params, [d.key]: n } }))} onAnimate={!onAnimateKey || d.step === 1 || d.preparation || d.structural ? undefined : () => onAnimateKey(d.key)} extra={paramExtra?.(d)} readOnly={readOnly?.(d)} onStart={onStart} onEnd={onEnd} />)}{defs.some(d=>d.advanced)&&<details className="advanced-controls"><summary>Advanced {title.toLowerCase()}<span>{defs.filter(d=>d.advanced).length}</span></summary>{defs.filter(d=>d.advanced).map(d=><Parameter key={d.key} definition={d} value={selected.params[d.key]??d.default} animated={!!selected.modulations[d.key]} onChange={n=>edit(l=>({...l,params:{...l.params,[d.key]:n}}))} onAnimate={!onAnimateKey||d.step===1||d.preparation||d.structural?undefined:()=>onAnimateKey(d.key)} extra={paramExtra?.(d)} readOnly={readOnly?.(d)} onStart={onStart} onEnd={onEnd}/>)}</details>}</details>; })}
        {surfaceSlot}
        {selected.kind !== 'image' && <section className="control-section"><h3>Palette</h3>{isEmber && <label className="stacked-label">Colour scheme<select aria-label="Ember colour scheme" value={emberScheme} disabled={scopeLocked}
          onChange={e => { const look = EMBER_PALETTES.find(item => item.id === e.target.value); if (look) edit(l => ({ ...l, palette: [...look.palette] })); }}>
          <option value="" disabled>Custom</option>{EMBER_PALETTES.map(look => <option value={look.id} key={look.id}>{look.name}</option>)}
        </select></label>}<div className="palette-editor">{selected.palette.map((color, i) => selected.kind === 'sculpture' && i !== 0 && i !== 2 ? null : <label key={i} style={{ background: color }} title={selected.kind === 'sculpture' ? (i === 0 ? 'Base color' : 'Sheen color') : selected.kind === 'oil' ? oilPaletteLabels[i] : selected.kind === 'liquid' ? liquidPaletteLabels[i] : selected.kind === 'scope' ? scopeSwatch(i) : selected.kind === 'super8' ? super8PaletteLabels[i] : `Color ${i + 1}`}><input aria-label={selected.kind === 'sculpture' ? (i === 0 ? 'Base color' : 'Sheen color') : selected.kind === 'oil' ? oilPaletteLabels[i] : selected.kind === 'liquid' ? liquidPaletteLabels[i] : selected.kind === 'scope' ? scopeSwatch(i) : selected.kind === 'super8' ? super8PaletteLabels[i] : `Palette color ${i + 1}`} type="color" value={color} onChange={e => edit(l => ({ ...l, palette: l.palette.map((c, j) => i === j ? e.target.value : c) }))} /></label>)}</div>{!parametersSlot && <div className="seed-row"><label>Seed<input aria-label="Layer seed" type="number" min="0" max="4294967295" value={selected.params.seed ?? seed} onChange={e => edit(l => ({ ...l, params: { ...l.params, seed: clamp(Math.round(Number(e.target.value)), 0, 4294967295) } }))} /></label><button className="icon-button" title="Next seed" onClick={() => edit(l => ({ ...l, params: { ...l.params, seed: ((l.params.seed ?? 1) + 1) >>> 0 } }))}><Icon name="shuffle" size={15} /></button></div>}</section>}
  </fieldset>;
}
