import {FINISH_KEYS, TOON_KEYS, FEEDBACK_KEYS, SLIT_KEYS, GLOW_KEYS, PRINT_KEYS} from '../core/finishing';
import { SLIT_SHAPES, supportsSlitScan } from '../rendering/slitscan';
import { supportsFeedback } from '../rendering/feedback';
import { supportsGlow } from '../rendering/bloom';
import { supportsPrint } from '../rendering/print-screen';
import { INSTRUMENTS, isInstrument, PROJECTION_LOOK_IDS } from '../core/instruments';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject, type ReactNode } from 'react';
import type { ExportFormat, Supersample, ExportJob, ExportProgress, Layer, LayerKind, Modulation, ParameterDefinition, Project, StudioStatus } from '../shared/types';
import { applyPreset, createLayer, createProject, parameterDefinitions, PRESETS, validateProject, varyLayer, visibleParameterDefinitions, SUPER8_MODES, FLAT_LOOK_IDS, FINISH_LOOKS, applyFinish, finishSupported } from '../core/project';
import { frameCount, phaseAtFrame, sampleModulation } from '../core/timeline';
import { isEvolving } from '../core/playback';
import { SurfaceEditor } from './SurfaceEditor';
import { GRAPHIC_FAMILIES, GRAPHIC_VARIANTS, GRAPHIC_LOOKS } from '../core/graphics';
import graphicThumb from './assets/graphics.png';
import surfaceThumb from './assets/surface.png';
import sculptureThumb from './assets/sculpture.png';
import fractalThumb from './assets/fractal.png';
import oilThumb from './assets/oil.png';
import liquidThumb from './assets/liquid.png';
import scopeThumb from './assets/scope.png';
import super8Thumb from './assets/super8.png';
import { StudioRenderer } from '../rendering/StudioRenderer';
import { Preview } from './Preview';
import { reconcileTile, tileBlockers } from '../core/tile-edges';
import { useWorkspace } from './useWorkspace';
import LivePanel from './LivePanel';
import { KIND_LABELS } from '../core/library';
import { beginStudioEdit, endStudioEdit, onStudioWallWarning, studioEdit } from './useMap';
import { projectForStudioSave, stashStudio, type ShapeEdit } from './studio-edit';
import MapPanel from './MapPanel';
import { sameCanvasValues } from '../core/canvas-interaction';

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const uid = () => crypto.randomUUID();
const resolutions = ['3840x2160', '4096x2160', '3840x2400', '2160x3840', '2160x2160', '1920x1200', '1920x1080', '960x540'];
const rates = ['24/1', '25/1', '30/1', '50/1', '60/1', '30000/1001', '60000/1001'];
const actualDuration = (p: Project) => frameCount(p) * p.fps.den / p.fps.num;
const kindLabels = KIND_LABELS;
const patterns: Partial<Record<LayerKind, string[]>> = {
  surface: ['Bands', 'Contours', 'Drips', 'Fusion'],
  fractal: ['Kaleidoscope', 'Julia Bloom', 'Mandelbox'],
};
const fractalVariants = [['Lace', 'Petals', 'Weave'], ['Classic', 'Radial', 'Spiral'], ['Architecture', 'Sphere Fold', 'Lattice']];
const surfaceVariants = [['Flow', 'Braids', 'Ribbons'], ['Terrace', 'Ripples', 'Vortex'], ['Melt', 'Beads', 'Strands'], ['Portal', 'Twin Portals', 'Lens']];
const sculptureForms = ['Shell', 'Bloom', 'Ribbon', 'Knot'];
const coloringModes = ['Palette', 'Duotone', 'Contours'];
const mirrorModes = ['Original', 'Flip horizontal', 'Flip vertical', 'Flip both'];
const gradingKeys = ['saturation', 'hue', 'exposure',...FINISH_KEYS];
const graphicChoiceKeys = ['profile', 'fill', 'sweep', 'corners'];
const choiceKeys = ['simulationQuality','flowMode','inkMode','reliefMode','phrase','style', 'variant', 'form', 'quality', 'radial', 'colorMode', 'mirror', 'substrate', 'mode', 'gateMode', 'seed'];
const super8ControlGroups: [string, string[]][] = [
  ['Paint geometry', ['scale', 'steps', 'coverage', 'erosion', 'rotation']],
  ['Paint texture', ['texture', 'textureScale', 'roughness', 'bleed', 'emulsion']],
  ['Film motion & feedback', ['travel', 'cycles', 'filmFps', 'feedback', 'feedbackSpacing', 'feedbackZoom', 'feedbackRotation']],
  ['Rolling shutter', ['rollAmount', 'rollBands', 'rollOrigin', 'rollSmear']],
  ['Projector transport', ['pullDown', 'shutter', 'shutterBlades', 'reelLoops', 'weave', 'flicker', 'frameLines']],
  ['Film gate', ['gateInset', 'gateRoundness', 'sprockets']],
  ['Film wear', ['scratches', 'grain', 'dust', 'hair']],
  ['Projector lens', ['lensSoftness', 'halation', 'vignette', 'lightLeak', 'colorFade']],
];
const super8PaletteLabels = ['Paint 1', 'Paint 2', 'Paint 3', 'Paint 4', 'Ink', 'Paper'];
const scopePaletteLabels = ['Line', 'Halo', 'Bloom', 'Hot core', 'Second line', 'Unused'];
const liquidPaletteLabels = ['Rim', 'Body', 'Mid', 'Hot', 'Wash', 'Ground'];
const oilPaletteLabels = ['Paint', 'Secondary paint', 'Ink', 'Substrate', 'Shadow tint', 'Rim tint'];
const oilFineControls = ['lensAspect', 'deformation', 'lensDepth', 'cellComplexity', 'dispersion', 'lift', 'filaments', 'softness', 'lightAngle', 'shadow', 'grain'];
const secondaryShapeControls: Partial<Record<LayerKind, string[]>> = {
  surface: ['rotation', 'density', 'stretch', 'turbulence', 'centerX', 'centerY'],
  graphic: ['stretch', 'orientation', 'centerX', 'centerY'],
  sculpture: ['lobes', 'thickness', 'stretch', 'curl', 'foldFrequency', 'asymmetry', 'ridgeScale'],
};

function ChoiceParameter({ label, name, options, value, onChange }: { label: string; name: string; options: string[]; value: number; onChange: (n: number) => void }) {
  return <label className="stacked-label">{label}<select aria-label={name} value={Math.round(value)} onChange={e => onChange(Number(e.target.value))}>{options.map((option, index) => <option key={index} value={index}>{option}</option>)}</select></label>;
}

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
function PrintScreenSection({ layer, definitions, edit, animate, onStart, onEnd }: { layer: Layer; definitions: ParameterDefinition[]; edit: (change: (layer: Layer) => Layer) => void; animate: (key: string) => void; onStart: () => void; onEnd: () => void }) {
  const set = (key: string, n: number) => edit(l => ({ ...l, params: { ...l.params, [key]: n } }));
  const on = (layer.params.printMix ?? 0) > 0 || !!layer.modulations.printMix;
  return <section className="control-section"><h3>Print screen</h3><p className="muted-text">Halftone dots, line screens and ordered dither, sized in pixels of a 1080-line frame. Loops close exactly.</p>
    {PRINT_GROUPS.map(([group, keys]) => {
      const shown = keys.filter(key => printControlShown(layer, key));
      if (!shown.length) return null;
      return <div key={group}>{on && <h4 className="control-subheading">{group}</h4>}{shown.map(key => {
        const d = definitions.find(item => item.key === key);
        if (!d) return null;
        if (PRINT_CHOICES[key]) return <ChoiceParameter key={key} label={d.label} name={d.label} options={PRINT_CHOICES[key]} value={layer.params[key] ?? d.default} onChange={n => set(key, n)} />;
        return <Parameter key={key} definition={d} value={layer.params[key] ?? d.default} animated={!!layer.modulations[key]} onChange={n => set(key, n)} onAnimate={d.step === 1 ? undefined : () => animate(key)} onStart={onStart} onEnd={onEnd} />;
      })}</div>;
    })}
  </section>;
}

function lookCaption(preset: typeof PRESETS[number]): string {
  const style = Math.round(preset.params.style ?? 0), variant = Math.round(preset.params.variant ?? 0);
  if (isInstrument(preset.kind)) return preset.description;
  if (preset.kind === 'surface') return `${patterns.surface![style]} · ${surfaceVariants[style][variant]}`;
  if (preset.kind === 'super8') return SUPER8_MODES[Math.round(preset.params.mode)];
  if (preset.kind === 'graphic') return `${GRAPHIC_FAMILIES[style]} · ${GRAPHIC_VARIANTS[style][variant] ?? 'Custom'}`;
  if (preset.kind === 'oil') return 'Paint · glass · cellular ink';
  if (preset.kind === 'liquid') return 'Oil droplets · dye · projector';
  if (preset.kind === 'scope') return 'Glowing line · signal · beam';
  if (preset.kind === 'fractal') return `${patterns.fractal![style]} · ${fractalVariants[style][variant]}`;
  return `${sculptureForms[Math.round(preset.params.form ?? 0)]} · Sculpture`;
}

function EditableName({ value, label, maxLength, onCommit }: { value: string; label: string; maxLength: number; onCommit: (s: string) => void }) {
  const [draft, setDraft] = useState(value), cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return <input aria-label={label} value={draft} maxLength={maxLength} onChange={e => setDraft(e.target.value)} onBlur={() => { if (cancelled.current) { cancelled.current = false; setDraft(value); return; } const next = draft.trim() || value; setDraft(next); if (next !== value) onCommit(next); }} onKeyDown={e => { if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); } else if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && ['s', 'o'].includes(e.key.toLowerCase()))) e.currentTarget.blur(); }} />;
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
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

function ExportDialog({ busy, onClose, children }: { busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby="export-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>{children}</dialog>;
}

function Notices({ message, error, onDismiss }: { message: string; error: string; onDismiss: () => void }) {
  return <>
    {message && <div className="toast" role="status"><Icon name="check" size={16} />{message}</div>}
    {error && <div className="error-toast" role="alert"><Icon name="info" size={18} /><div><strong>Error</strong><p>{error}</p></div><button className="icon-button" onClick={onDismiss} aria-label="Dismiss error"><Icon name="close" size={16} /></button></div>}
  </>;
}


function Transport({ project, phase, playing, onPlaying, onDuration, children }: { project: Project; phase: RefObject<number>; playing: boolean; onPlaying: () => void; onDuration: (n: number) => void; children?: ReactNode }) {
  const [shown, setShown] = useState(0);
  useEffect(() => { const timer = setInterval(() => setShown(phase.current / TAU), 80); return () => clearInterval(timer); }, [phase]);
  return <div className="transport">
    <div className="transport-controls"><button className="play-button" onClick={onPlaying} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} /></button><button className="icon-button" title="Return to start" onClick={() => { phase.current = 0; setShown(0); }}><Icon name="reset" size={16} /></button><span className="time-readout">{(shown * actualDuration(project)).toFixed(2)}<span> / {actualDuration(project).toFixed(2)} s</span></span></div>
    <div className="scrub-wrap"><div className="scrub-ticks">{[0, .25, .5, .75, 1].map(t => <span key={t}>{(t * actualDuration(project)).toFixed(1)}</span>)}</div><input aria-label="Timeline position" className="timeline-scrub" type="range" min="0" max=".999999" step=".0001" value={shown} onChange={e => { phase.current = Number(e.target.value) * TAU; setShown(Number(e.target.value)); }} /><div className="loop-label"><span>{isEvolving(project) ? 'Evolving clip' : 'Loop'}</span><span>{frameCount(project)} frames</span></div></div>
    <label className="duration-control">Duration <span><input aria-label={isEvolving(project)?'Clip duration':'Loop duration'} type="number" min="1" max="60" step="1" value={project.duration} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1 && n <= 60) onDuration(n); }} />s</span></label>{children}
  </div>;
}

function Parameter({ definition: d, value, animated, onChange, onAnimate, onStart, onEnd }: { definition: ParameterDefinition; value: number; animated: boolean; onChange: (n: number) => void; onAnimate?: () => void; onStart: () => void; onEnd: () => void }) {
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
  return <div className={`parameter${d.step < 0.001 ? ' precise-parameter' : ''}`}><div className="parameter-label"><label title={`${d.description ? `${d.label}: ${d.description}` : d.label}\nDouble-click to reset`} htmlFor={`parameter-${d.key}`} onDoubleClick={reset}>{d.label}</label><div><button className="parameter-reset" aria-label={`Reset ${d.label}`} title={`Reset ${d.label}`} disabled={value===d.default} onClick={()=>onChange(d.default)}>↺</button>{onAnimate && <button className={`mod-button ${animated ? 'active' : ''}`} onClick={onAnimate} title={`Animate ${d.label}`} aria-pressed={animated}><Icon name="wave" size={14} /></button>}<input aria-label={`${d.label} value`} type="number" min={d.min} max={d.max} step={d.step} value={draft} onFocus={() => { editing.current = true; dirty.current = false; }} onChange={e => { dirty.current = true; setDraft(e.target.value); }} onBlur={commit} onKeyDown={e => { if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); } else if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && ['s', 'o'].includes(e.key.toLowerCase()))) e.currentTarget.blur(); }} /></div></div><input id={`parameter-${d.key}`} aria-label={d.label} type="range" min={d.min} max={d.max} step={fineStep} value={value} style={{ '--fill': `${percent}%` } as CSSProperties} title="Double-click to reset · hold Shift for fine control"
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

function KeyframeCurve({ mod, onChange, onStart, onEnd }: { mod: Modulation; onChange: (m: Modulation) => void; onStart: () => void; onEnd: () => void }) {
  const dragging = useRef<number | null>(null);
  const points = mod.points;
  const curve = { ...mod, cycles: 1, phase: 0 };
  const line = Array.from({ length: 129 }, (_, i) => `${i ? 'L' : 'M'} ${i / 128 * 260 + 10} ${66 - sampleModulation(curve, i / 128 * TAU, 0) * 47}`).join(' ');
  return <div className="keyframe-editor"><svg viewBox="0 0 280 132" role="group" aria-label="Loop keyframe values" onPointerMove={e => {
    if (dragging.current === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const value = clamp((66 - (e.clientY - rect.top) / rect.height * 132) / 47, -1, 1);
    onChange({ ...mod, points: points.map((p, i) => i === dragging.current ? { ...p, value } : p) });
  }} onPointerUp={() => { dragging.current = null; onEnd(); }} onPointerCancel={() => { dragging.current = null; onEnd(); }}>
    <path d="M10 19h260M10 66h260M10 113h260M10 10v112M75 10v112M140 10v112M205 10v112M270 10v112" className="curve-grid" />
    <path d={line} className="curve-path" />
    {points.map((p, i) => <g key={i}><circle className="keyframe-hit" cx={p.time * 260 + 10} cy={66 - p.value * 47} r="22" tabIndex={0} role="slider" aria-label={`Keyframe ${i + 1}`} aria-valuemin={-1} aria-valuemax={1} aria-valuenow={p.value} onKeyDown={e => {
      if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); onStart();
      const value = e.key === 'Home' ? -1 : e.key === 'End' ? 1 : clamp(p.value + (['ArrowUp', 'ArrowRight'].includes(e.key) ? .05 : -.05), -1, 1);
      onChange({ ...mod, points: points.map((point, index) => index === i ? { ...point, value: Number(value.toFixed(2)) } : point) });
      onEnd();
    }} onPointerDown={e => { onStart(); dragging.current = i; e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId); }} /><circle className="keyframe-dot" cx={p.time * 260 + 10} cy={66 - p.value * 47} r="5" aria-hidden="true" /></g>)}
  </svg><p>Drag keys or use arrow keys to adjust their values.</p></div>;
}

const defaultMod = (kind: Modulation['kind']): Modulation => ({ kind, cycles: 1, phase: 0, amount: .22, points: [{ time: 0, value: 0 }, { time: .25, value: 1 }, { time: .5, value: 0 }, { time: .75, value: -1 }] });

const instrumentThumbnails = import.meta.glob<string>('./assets/instruments/*.png', { eager: true, query: '?url', import: 'default' });
const projectionThumbnails = import.meta.glob<string>('./assets/projection/*.png', { eager: true, query: '?url', import: 'default' });
const startingLooks:Partial<Record<LayerKind,string>>={livingink:'tidal-pigment',relief:'breathing-facade'};
const instrumentCatalogue = [
  { kind: 'surface', name: 'Surface', caption: '4 patterns · 12 variants', image: surfaceThumb, label: 'Add surface' },
  { kind: 'sculpture', name: 'Sculpture', caption: 'Shell · bloom · ribbon · knot', image: sculptureThumb, label: 'Add sculpture' },
  { kind: 'fractal', name: 'Fractals', caption: 'Kaleidoscope · Julia · Mandelbox', image: fractalThumb, label: 'Add fractal' },
  { kind: 'super8', name: 'Super 8 Paint', caption: 'Paint · moving film · projector', image: super8Thumb, label: 'Add Super 8 Paint' },
  { kind: 'oil', name: 'Oil Slides', caption: 'Paint · glass · cellular ink', image: oilThumb, label: 'Add oil slides' },
  { kind: 'liquid', name: 'Liquid Light', caption: 'Oil droplets · dye · projector', image: liquidThumb, label: 'Add liquid light' },
  { kind: 'scope', name: 'Oscilloscope', caption: 'Glowing line · signal · beam', image: scopeThumb, label: 'Add oscilloscope' },
  { kind: 'graphic', name: 'Graphic Patterns', caption: 'Waves · circles · tiles · paths', image: graphicThumb, label: 'Add graphic patterns' },
  ...INSTRUMENTS.map(info => ({ kind: info.kind, name: info.name, caption: info.description, image: projectionThumbnails[`./assets/projection/${startingLooks[info.kind]}.png`]??instrumentThumbnails[`./assets/instruments/${info.kind}.png`], label: `Add ${info.name}` })),
] satisfies {kind: LayerKind; name: string; caption: string; image: string; label: string}[];


export default function App() {
  const workspace = useWorkspace();
  const [librarySearch, setLibrarySearch] = useState('');
  const libraryQuery = librarySearch.trim().toLowerCase();
  const [project, setProject] = useState<Project>(createProject);
  const startupTask = useRef<Promise<void>>(Promise.resolve()), autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectRef = useRef(project), history = useRef<Project[]>([]), future = useRef<Project[]>([]), gesture = useRef(false);
  const [tiledView, setTiledView] = useState(false), [historyRevision, setHistoryRevision] = useState(0), [selectedId, setSelectedId] = useState(project.layers[0]?.id ?? '');
  const [tab, setTab] = useState<'Shape' | 'Motion' | 'Finish'>('Shape'), [libraryTab, setLibraryTab] = useState<'Instruments' | 'Presets'>('Instruments');
  const [presetFilter, setPresetFilter] = useState('selected');
  const [oilFine, setOilFine] = useState(false);
  const [variationStrength, setVariationStrength] = useState(.35);
  const randomizeEffect = (id: string) => {
    const entropy = crypto.getRandomValues(new Uint32Array(1))[0];
    const layer = projectRef.current.layers.find(l => l.id === id);
    if (!layer) return;
    const next = varyLayer(layer, variationStrength, locks, entropy);
    setSelectedId(id);
    if (JSON.stringify(next) === JSON.stringify(layer)) {
      notify('Available controls are locked or animated. Unlock a Keep category to vary this effect.');
      return;
    }
    editLayer(() => next, id);
  };
  const [playing, setPlaying] = useState(true), phase = useRef(0), rendererRef = useRef<StudioRenderer | null>(null);
  /** Live is a separate screen over the studio; the studio pauses underneath it. */
  const [mode, setMode] = useState<'studio' | 'live' | 'map'>('studio');
  /** A Map shape's composition being edited here. Studio's own project is set aside meanwhile, and saved, not this one. */
  const [shapeEdit, setShapeEdit] = useState<ShapeEdit | null>(null);
  const shapeEditRef = useRef<ShapeEdit | null>(null);
  const [checker, setChecker] = useState(true), [message, setMessage] = useState(''), [error, setError] = useState(''), [saved, setSaved] = useState('Ready');
  const [ready, setReady] = useState(false), [status, setStatus] = useState<StudioStatus | null>(null), [locks, setLocks] = useState({ palette: true, structure: false, motion: true, material: false });
  const [modKey, setModKey] = useState('warp'), [exportOpen, setExportOpen] = useState(false), [jobs, setJobs] = useState<ExportJob[]>([]);
  const [format, setFormat] = useState<ExportFormat>('prores4444'), [outputDir, setOutputDir] = useState(''), [resolution, setResolution] = useState('3840x2160'), [exportRate, setExportRate] = useState('30/1'), [exportAlpha, setExportAlpha] = useState(true), [supersample, setSupersample] = useState<Supersample>(1);
  const [progress, setProgress] = useState<ExportProgress | null>(null), [exporting, setExporting] = useState(false), [stillBusy, setStillBusy] = useState(false);
  const cancel = useRef(false), activeJob = useRef<string | null>(null), imageInput = useRef<HTMLInputElement>(null), maskInput = useRef<HTMLInputElement>(null);
  // ProRes 4444 and PNG carry optional alpha; HAP Alpha always does; ProRes 422, HAP and HAP Q never do.
  const alphaOptional = format === 'prores4444' || format === 'png';
  const exportTransparent = format === 'hapalpha' || (alphaOptional && exportAlpha);
  const selected = project.layers.find(l => l.id === selectedId) ?? project.layers[0];
  const allDefinitions = selected ? parameterDefinitions(selected.kind) : [];
  const definitions = selected ? visibleParameterDefinitions(selected) : [];
  const controlGroups = selected?.kind === 'super8'
    ? super8ControlGroups.filter(([title]) => title !== 'Film gate' || selected.params.gateMode > 0)
      .map(([title, keys]) => ({ title, defs: keys.map(key => definitions.find(d => d.key === key)!).filter(d => d.key !== 'sprockets' || selected.params.gateMode === 2) }))
    : (['Shape', 'Motion', 'Material', 'Camera'] as const).map(title => ({ title, defs: definitions.filter(d => d.section === title) }));
  const selectedModKey = modKey === 'opacity' || modKey.startsWith('transform.') || definitions.some(d => d.key === modKey && d.step !== 1 && !d.preparation) || (selected?.modulations[modKey] && allDefinitions.some(d => d.key === modKey && d.step !== 1 && !d.preparation)) ? modKey : definitions.find(d => d.step !== 1 && !d.preparation)?.key ?? 'opacity';
  const modulation = selected?.modulations[selectedModKey];
  const effectivePresetFilter = presetFilter === 'selected' ? selected?.kind === 'surface' || selected?.kind === 'fractal' || selected?.kind === 'graphic' ? `${selected.kind}-${Math.round(selected.params.style ?? 0)}` : selected?.kind === 'sculpture' ? `sculpture-${Math.round(selected.params.form ?? 0)}` : selected && ['oil', 'liquid', 'scope', 'super8'].includes(selected.kind) ? selected.kind : selected && isInstrument(selected.kind) ? selected.kind : 'all' : presetFilter;
  const visiblePresets = PRESETS.filter(preset => effectivePresetFilter === 'projection' && PROJECTION_LOOK_IDS.includes(preset.id) || effectivePresetFilter === 'flat' && FLAT_LOOK_IDS.includes(preset.id) || effectivePresetFilter === 'all' || preset.kind === effectivePresetFilter || `${preset.kind}-${preset.kind === 'sculpture' ? preset.params.form : preset.params.style}` === effectivePresetFilter);
  const searchedFinishes = FINISH_LOOKS.filter(f => `${f.name} ${f.description}`.toLowerCase().includes(libraryQuery));
  const searchedPresets = visiblePresets.filter(p => `${p.name} ${p.description} ${kindLabels[p.kind]}`.toLowerCase().includes(libraryQuery));
  const searchedInstruments = instrumentCatalogue.filter(i => `${i.name} ${i.caption}`.toLowerCase().includes(libraryQuery));
  const [exportNum, exportDen] = exportRate.split('/').map(Number);
  const exportFrames = frameCount({ duration: project.duration, fps: { num: exportNum, den: exportDen } });
  const exportSeconds = exportFrames * exportDen / exportNum;
  void historyRevision;

  const reportError = useCallback((s: string) => setError(s.replace(/^Error: /, '')), []);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((s: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setMessage(s); noticeTimer.current = setTimeout(() => setMessage(''), 4500);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
  const replace = useCallback((requested: Project, record = true) => {
    const { project: next, message } = reconcileTile(requested);
    if (message) notify(message);
    if (record && !gesture.current) { history.current.push(projectRef.current); history.current = history.current.slice(-80); future.current = []; }
    projectRef.current = next; setProject(next); setHistoryRevision(n => n + 1);
    // Editing a Map shape: every change goes to the shape (and the wall) at once.
    if (shapeEditRef.current) { const refused = studioEdit(next); if (refused) notify(`Map could not take that change: ${refused}.`); }
  }, [notify]);
  const edit = (fn: (p: Project) => Project) => replace(fn(projectRef.current));
  const editLayer = (fn: (l: Layer) => Layer, id = selected?.id) => { if (id) edit(p => { const layers=p.layers.map(l=>{if(l.id!==id)return l;const next=fn(l);if(next.surface?.source==='mask'&&next.mask.kind!=='image')delete next.surface;return next;}); return {...p,schemaVersion:layers.some(l=>l.surface||Object.values(l.modulations).some(m=>m.range))?2:p.schemaVersion,layers}; }); };
  const beginGesture = () => { if (!gesture.current) { history.current.push(projectRef.current); history.current = history.current.slice(-80); future.current = []; gesture.current = true; } };
  const endGesture = () => { gesture.current = false; setHistoryRevision(n => n + 1); };
  const undo = () => { const prev = history.current.pop(); if (prev) { future.current.push(projectRef.current); replace(prev, false); } };
  const redo = () => { const next = future.current.pop(); if (next) { history.current.push(projectRef.current); replace(next, false); } };
  const [filePath, setFilePath] = useState('');
  const fileName = filePath.split('/').pop() ?? '';
  const save = async (saveAs = false) => { try {
    const snapshot = validateProject(projectRef.current);
    if (window.studio) { const result = await window.studio.saveProject(snapshot, saveAs); if (!result.canceled) { setFilePath(result.path ?? ''); notify(result.path ? `Saved to ${result.path.split('/').pop()}.` : 'Project saved.'); } }
    else { download(new TextEncoder().encode(JSON.stringify(projectRef.current, null, 2)), `${projectRef.current.name}.formfield`, 'application/json'); notify('Project downloaded.'); }
  } catch (e) { reportError(String(e)); } };
  // Recorded like any edit, so Undo brings the previous composition back.
  const newProject = async () => { try {
    const next = createProject();
    replace(next); setSelectedId(next.layers[0]?.id ?? ''); phase.current = 0; setFilePath('');
    await window.studio?.forgetProjectPath();
    notify('New composition. Undo brings the previous one back.');
  } catch (e) { reportError(String(e)); } };
  const open = async () => { try {
    if (window.studio) { const result = await window.studio.openProject(); if (result.project) { const next = validateProject(result.project); replace(next); setSelectedId(next.layers[0]?.id ?? ''); phase.current = 0; setFilePath(result.path ?? ''); } }
    else { const input = document.createElement('input'); input.type = 'file'; input.accept = '.formfield,.json'; input.onchange = async () => { try { const file = input.files?.[0]; if (file) { const next = validateProject(JSON.parse(await file.text())); replace(next); setSelectedId(next.layers[0]?.id ?? ''); phase.current = 0; } } catch (e) { reportError(String(e)); } }; input.click(); }
  } catch (e) { reportError(String(e)); } };

  useEffect(() => { let alive = true; startupTask.current = (async () => {
    try {
      if (window.studio) {
        const [info, restored, existing] = await Promise.allSettled([window.studio.getStatus(), window.studio.loadAutosave(), window.studio.listJobs()]);
        if (!alive) return;
        const issues: string[] = [];
        if (info.status === 'fulfilled') { setStatus(info.value); setOutputDir(info.value.defaultExportDir); } else issues.push(`Export engine: ${String(info.reason)}`);
        if (existing.status === 'fulfilled') setJobs(existing.value); else issues.push(`Export recovery: ${String(existing.reason)}`);
        if (restored.status === 'fulfilled') {
          // Not while a Map shape is being edited: the restored project is Studio's own, not the shape's.
          if (restored.value && history.current.length === 0 && !shapeEditRef.current) {
            try { const next = validateProject(restored.value); replace(next, false); setSelectedId(next.layers[0]?.id ?? ''); }
            catch (error) { issues.push(`Project recovery: ${String(error)}. The previous autosave is retained in the application recovery folder.`); }
          }
        } else issues.push(`Project recovery: ${String(restored.reason)}. The previous autosave is retained in the application recovery folder.`);
        if (issues.length) reportError(issues.join('\n'));
      } else {
        const text = localStorage.getItem('formfield-autosave');
        if (text && history.current.length === 0) { const next = validateProject(JSON.parse(text)); if (alive) { replace(next, false); setSelectedId(next.layers[0]?.id ?? ''); } }
      }
    } catch (e) { if (alive) reportError(`Recovery: ${String(e)}`); }
    finally { if (alive) setReady(true); }
  })(); return () => { alive = false; }; }, [replace, reportError]);
  useEffect(() => {
    // While a Map shape is edited, Studio's own project is set aside and unchanged: nothing to autosave.
    if (!ready || shapeEditRef.current) return; setSaved('Saving…');
    const timer = setTimeout(() => {
      const task = Promise.resolve().then(() => { const snapshot = validateProject(project); return window.studio ? window.studio.saveAutosave(snapshot) : localStorage.setItem('formfield-autosave', JSON.stringify(snapshot)); });
      void task.then(() => setSaved('Autosaved')).catch(() => setSaved('Save project to keep changes'));
    }, 700);
    autosaveTimer.current = timer;
    return () => { clearTimeout(timer); if (autosaveTimer.current === timer) autosaveTimer.current = null; };
  }, [project, ready]);
  useEffect(() => {
    const release = () => endGesture(); window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    return () => { window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (exportOpen || mode !== 'studio') return;
      const command = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape' && workspace.library.current?.matches(':popover-open')) {
        e.preventDefault(); workspace.library.current.hidePopover(); workspace.libraryButton.current?.focus(); return;
      }
      if (e.key === 'Escape' && workspace.variation.current?.matches(':popover-open')) {
        e.preventDefault(); workspace.variation.current.hidePopover(); workspace.variationButton.current?.focus(); return;
      }
      const target = e.target as HTMLElement;
      const editing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable;
      if (!command && !e.altKey && !editing && !e.repeat) {
        const key = e.key.toLowerCase();
        if (key === 'f') { e.preventDefault(); workspace.toggleFocus(); return; }
        if (key === 'b') { e.preventDefault(); workspace.library.current?.togglePopover(); return; }
        if (key === 'l' && !workspace.focusMode) { e.preventDefault(); workspace.toggleLayers(); return; }
        if (key === 'i' && !workspace.focusMode) { e.preventDefault(); workspace.toggleInspector(); return; }
        if (e.key === 'Escape' && workspace.focusMode && !workspace.libraryOpen && !workspace.variationOpen) { e.preventDefault(); workspace.setFocusMode(false); workspace.focusButton.current?.focus(); return; }
      }
      if (command && ['s', 'n', 'o'].includes(e.key.toLowerCase()) && shapeEditRef.current) { e.preventDefault(); notify('Go back to Map first: this composition belongs to a shape.'); }
      else if (command && e.key.toLowerCase() === 's') { e.preventDefault(); void save(e.shiftKey); }
      else if (command && e.key.toLowerCase() === 'n' && !exporting) { e.preventDefault(); void newProject(); }
      else if (command && e.key.toLowerCase() === 'o') { e.preventDefault(); void open(); }
      else if (command && e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes((e.target as HTMLElement).tagName)) { e.preventDefault(); setPlaying(v => !v); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => { if (exportOpen) workspace.closePopovers(); }, [exportOpen]);
  useEffect(() => { setResolution(`${project.width}x${project.height}`); setExportRate(`${project.fps.num}/${project.fps.den}`); }, [project.width, project.height, project.fps.num, project.fps.den]);
  useEffect(() => window.studio?.onBeforeClose(async () => {
    await startupTask.current;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    (document.activeElement as HTMLElement | null)?.blur();
    await window.studio!.saveAutosave(validateProject(projectForStudioSave(projectRef.current, shapeEditRef.current)));
  }), []);

  useEffect(() => { onStudioWallWarning(text => notify(`Map: ${text}.`)); return () => onStudioWallWarning(null); }, [notify]);
  /** Opens a Map shape's composition in Studio, setting Studio's own project, history and file aside. */
  const editShapeInStudio = (sourceId: string, shapeId: string) => {
    if (shapeEditRef.current) return;
    // Studio must have restored its own project first, or the restore could land on the shape's composition.
    if (!ready) { notify('Studio is still opening. Try again in a moment.'); return; }
    // Studio's own latest change is saved before it is set aside.
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
    const own = validateProject(projectRef.current);
    const begun = beginStudioEdit(sourceId, shapeId);
    if (!begun) return;
    void (window.studio ? window.studio.saveAutosave(own) : Promise.resolve(localStorage.setItem('formfield-autosave', JSON.stringify(own))))
      .then(() => setSaved('Autosaved')).catch(() => setSaved('Save project to keep changes'));
    const edit: ShapeEdit = { sourceId, shapeName: begun.shapeName, stash: stashStudio({ project: projectRef.current, history: history.current, future: future.current, filePath, selectedId, phase: phase.current }) };
    shapeEditRef.current = edit; setShapeEdit(edit);
    history.current = []; future.current = [];
    // Shown without being recorded: opening the composition is not an edit to it.
    projectRef.current = begun.project; setProject(begun.project); setHistoryRevision(n => n + 1);
    setSelectedId(begun.project.layers[0]?.id ?? ''); phase.current = 0; setFilePath('');
    workspace.closePopovers(); setExportOpen(false); setMode('studio');
  };
  /** Back from editing a Map shape: Studio's own project, history and file return as they were. */
  const finishShapeEdit = (to: 'studio' | 'live' | 'map') => {
    const edit = shapeEditRef.current;
    if (!edit) { setMode(to); return; }
    endStudioEdit();
    shapeEditRef.current = null; setShapeEdit(null);
    history.current = edit.stash.history; future.current = edit.stash.future;
    projectRef.current = edit.stash.project; setProject(edit.stash.project); setHistoryRevision(n => n + 1);
    setSelectedId(edit.stash.selectedId); phase.current = edit.stash.phase; setFilePath(edit.stash.filePath);
    // Going to Live instead of Map: the Map wall that stayed open for the edit closes, as leaving Map does.
    if (to !== 'map') void window.studio?.map?.closeOutput().catch(() => {});
    setMode(to);
  };
  useEffect(() => window.studio?.onExportProgress(p => { if (p.jobId === activeJob.current) setProgress(p); }), []);

  const addLayer = (kind: LayerKind) => {
    if (projectRef.current.layers.length >= 4) { notify('This composition already has four layers.'); return; }
    if (kind === 'image') { imageInput.current?.click(); return; }
    const layer = startingLooks[kind]?applyPreset(createLayer(kind),startingLooks[kind]!):createLayer(kind); if(isInstrument(kind)&&!startingLooks[kind]){layer.params.organic=.65;layer.params.motion=.55;} edit(p => ({ ...p, layers: [...p.layers, layer] })); setSelectedId(layer.id); setTab('Shape'); workspace.library.current?.hidePopover();
  };
  const moveLayer = (index: number, direction: number) => edit(p => {
    const to = index + direction; if (to < 0 || to >= p.layers.length) return p;
    const layers = [...p.layers]; [layers[index], layers[to]] = [layers[to], layers[index]]; return { ...p, layers };
  });
  const importImage = async (file: File | undefined, asMask = false) => {
    if (!file) return;
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Choose a PNG or JPEG image.');
      if (file.size > 12 * 1024 * 1024) throw new Error('Choose an image smaller than 12 MB.');
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Image could not be read.')); reader.readAsDataURL(file); });
      const image = await new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Image could not be decoded.')); image.src = dataUrl; });
      if (image.naturalWidth > 8192 || image.naturalHeight > 8192) throw new Error('Images must be no larger than 8192 pixels on either side.');
      if (asMask) { const next = { ...projectRef.current, layers: projectRef.current.layers.map(l => l.id === selected?.id ? { ...l, mask: { ...l.mask, kind: 'image' as const, dataUrl } } : l) }; replace(validateProject(next)); }
      else { if (projectRef.current.layers.length >= 4) throw new Error('Remove a layer before importing another image.'); const layer = createLayer('image'); layer.name = (file.name.replace(/\.[^.]+$/, '') || 'Imported image').slice(0, 60); layer.image = { name: file.name.slice(0, 240), dataUrl, width: image.naturalWidth, height: image.naturalHeight, fit: 'contain' }; replace(validateProject({ ...projectRef.current, layers: [...projectRef.current.layers, layer] })); setSelectedId(layer.id); }
    } catch (e) { reportError(String(e)); }
  };
  const changeMod = (mod: Modulation | undefined) => editLayer(l => { const modulations = { ...l.modulations }; if (mod) modulations[selectedModKey] = mod; else delete modulations[selectedModKey]; return { ...l, modulations }; });
  const still = async () => {
    setStillBusy(true);
    let engine: StudioRenderer | undefined;
    try {
      engine = new StudioRenderer(document.createElement('canvas'));
      const [width, height] = resolution.split('x').map(Number);
      const snapshot = validateProject(structuredClone(projectRef.current));
      snapshot.width = width; snapshot.height = height; snapshot.transparent = exportTransparent;
      const bytes = await engine.exportPNG(snapshot, phase.current, width, height, supersample);
      const name = `${slug(snapshot.name)}-${width}x${height}.png`;
      if (window.studio) { const result = await window.studio.saveStill(bytes, name); if (!result.canceled) notify('PNG saved.'); }
      else download(bytes, name, 'image/png');
    } catch (e) { reportError(String(e)); } finally { engine?.dispose(); setStillBusy(false); }
  };
  const runJob = async (job: ExportJob) => {
    if (!window.studio) return;
    const bridge = window.studio, exportCanvas = document.createElement('canvas');
    let engine: StudioRenderer | undefined;
    cancel.current = false; activeJob.current = job.id; setExporting(true); setPlaying(false);
    const completed = new Set(job.completedFrames);
    setProgress({ jobId: job.id, status: 'rendering', rendered: completed.size, total: job.totalFrames, message: 'Preparing artwork…' });
    try {
      engine = new StudioRenderer(exportCanvas);
      const snapshot = structuredClone(job.request.project); snapshot.transparent = true;
      await engine.prepare(snapshot);
      for (let i = 0; i < job.totalFrames; i++) {
        if (cancel.current) break;
        if (completed.has(i)) continue;
        const bytes = await engine.exportEXR(snapshot, phaseAtFrame(i, job.totalFrames), job.request.width, job.request.height, job.request.supersample ?? 1);
        if (cancel.current) break;
        await bridge.writeFrame(job.id, i, bytes); completed.add(i);
        setProgress({ jobId: job.id, status: 'rendering', rendered: completed.size, total: job.totalFrames, message: `Rendering frame ${i + 1} of ${job.totalFrames}` });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (!cancel.current) {
        setProgress({ jobId: job.id, status: 'encoding', rendered: job.totalFrames, total: job.totalFrames, message: 'Encoding high-precision frames…' });
        const result = await bridge.finishExport(job.id);
        setProgress({ jobId: job.id, status: result.status, rendered: job.totalFrames, total: job.totalFrames, outputPath: result.outputPath, seam: result.seam, edges: result.edges, message: 'Export verified and ready.' });
        notify((result.seam?.status === 'seam' ? 'Export complete, but the loop has a visible seam.' : 'Export complete.') + (result.edges?.status === 'seam' ? ' The tile edges show a seam.' : ''));
      }
    } catch (e) {
      if (!cancel.current) {
        try { await bridge.cancelExport(job.id); } catch { /* Retain the original render failure. */ }
        reportError(String(e)); setProgress(p => p ? { ...p, status: 'failed', message: String(e), error: String(e) } : null);
      }
    } finally {
      if (cancel.current) setProgress(p => p ? { ...p, status: 'cancelled', message: 'Export stopped. Completed frames are saved.' } : null);
      engine?.dispose(); activeJob.current = null; setExporting(false);
      try { setJobs(await bridge.listJobs()); } catch { /* Export result remains visible. */ }
    }
  };
  const startExport = async () => {
    if (!window.studio) { reportError('Open the desktop app to render a movie or image sequence. PNG stills also work in this browser preview.'); return; }
    try {
      const [width, height] = resolution.split('x').map(Number), [num, den] = exportRate.split('/').map(Number);
      const snapshot = validateProject(structuredClone(projectRef.current)); snapshot.width = width; snapshot.height = height; snapshot.fps = { num, den };
      const total = frameCount(snapshot);
      const job = await window.studio.beginExport({ project: snapshot, format, outputDir: outputDir || undefined, width, height, fps: { num, den }, frameCount: total, transparent: exportTransparent, supersample, background: project.background });
      await runJob(job);
    } catch (e) { reportError(String(e)); }
  };

  const modeSwitch = <><div className="brand"><div className="brand-mark">f<span>f</span></div><div>Form <span>&</span> Field</div></div>
    <div className="mode-switch" role="group" aria-label="Section"><button aria-pressed={mode === 'studio'} onClick={() => setMode('studio')}>Studio</button><button aria-pressed={mode === 'live'} disabled={exporting} title={exporting ? 'Live is available when the export has finished' : 'Live camera to projector'} onClick={() => { workspace.closePopovers(); setExportOpen(false); finishShapeEdit('live'); }}>Live</button><button aria-pressed={mode === 'map'} disabled={exporting} title={exporting ? 'Map is available when the export has finished' : 'Map shapes onto the projector'} onClick={() => { workspace.closePopovers(); setExportOpen(false); finishShapeEdit('map'); }}>Map</button></div></>;
  return <div className={`studio-shell ${workspace.layersExpanded ? 'layers-expanded' : 'layers-collapsed'} ${workspace.inspectorOpen ? '' : 'inspector-hidden'} ${workspace.focusMode ? 'focus-preview' : ''}`}>
    <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg" onChange={e => { void importImage(e.target.files?.[0]); e.target.value = ''; }} />
    <input ref={maskInput} hidden type="file" accept="image/png,image/jpeg" onChange={e => { void importImage(e.target.files?.[0], true); e.target.value = ''; }} />
    <header className="app-header" inert={mode !== 'studio'}>{modeSwitch}
      {shapeEdit && <div className="shape-edit-bar" role="status">Editing <strong>{shapeEdit.shapeName}</strong> from Map · changes show on the projector<button className="primary-button" onClick={() => finishShapeEdit('map')}>Back to Map</button></div>}
      <div className="project-title"><EditableName label="Project name" value={project.name} maxLength={80} onCommit={name => edit(p => ({ ...p, name }))} />{fileName && <span className="project-file" title={filePath}>{fileName}</span>}<span role="status" className={saved === 'Save project to keep changes' ? 'save-failed' : ''}>{saved}</span></div>
      <div className="header-actions"><button className="icon-button" title="Undo · ⌘Z" disabled={!history.current.length} onClick={undo}><Icon name="undo" /></button><button className="icon-button" title="Redo · ⇧⌘Z" disabled={!future.current.length} onClick={redo}><Icon name="redo" /></button><span className="divider" /><button className="text-button" title="New composition · ⌘N" disabled={exporting || !!shapeEdit} onClick={() => void newProject()}><Icon name="plus" size={16} />New</button><button className="text-button" title="Open · ⌘O" disabled={!!shapeEdit} onClick={() => void open()}><Icon name="folder" size={16} />Open</button><button className="text-button" title={fileName ? `Save to ${fileName} · ⌘S\nShift-click or ⇧⌘S to save as a new file` : 'Save · ⌘S'} disabled={!!shapeEdit} onClick={e => void save(e.shiftKey)}><Icon name="save" size={16} />Save</button><button className="primary-button" disabled={!!shapeEdit} title={shapeEdit ? 'Go back to Map to export your own composition' : undefined} onClick={e => { e.currentTarget.focus(); setExportOpen(true); }}><Icon name="download" size={16} />Export</button></div>
    </header>

    <main className="workspace" inert={mode !== 'studio'}>
    <aside id="library-drawer" className="library-drawer" popover="auto" ref={workspace.library} onToggle={e => { const opened=e.currentTarget.matches(':popover-open'); workspace.setLibraryOpen(opened); if(opened) e.currentTarget.querySelector<HTMLInputElement>('input[type="search"]')?.focus(); }} aria-label="Library" onKeyDown={e => { if(e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); workspace.library.current?.hidePopover(); workspace.libraryButton.current?.focus(); } }}>
      <div className="drawer-heading"><strong>Library</strong><button className="icon-button" aria-label="Close library" popoverTarget="library-drawer" popoverTargetAction="hide"><Icon name="close" size={16} /></button></div>
      <label className="library-search"><Icon name="search" size={15} /><input type="search" autoFocus aria-label="Search library" placeholder="Search instruments and looks…" value={librarySearch} onChange={e=>setLibrarySearch(e.target.value)} /></label>
      <div className="tab-switch library-tabs">{(['Instruments', 'Presets'] as const).map(t => <button key={t} aria-pressed={libraryTab === t} className={libraryTab === t ? 'active' : ''} onClick={() => setLibraryTab(t)}>{t}</button>)}</div>
      <div className="library-content">{libraryTab === 'Instruments' ? <div className="instrument-list">{searchedInstruments.map(info => <button key={info.kind} aria-label={info.label} className="instrument-card" onClick={() => addLayer(info.kind)}><img className="instrument-art" src={info.image} alt="" /><div className="instrument-info"><div><strong>{info.name}</strong><small>{info.caption}</small></div><Icon name="plus" size={14} /></div></button>)}{!searchedInstruments.length && <p className="empty-note">No instruments match “{librarySearch}”.</p>}<button className="import-button" onClick={() => addLayer('image')}><Icon name="image" size={16} /><span>Import image<small>PNG / JPEG</small></span></button></div> : <><label className="stacked-label preset-filter">Filter<select aria-label="Preset library filter" value={presetFilter} onChange={e => setPresetFilter(e.target.value)}><option value="selected">Current selection</option><option value="all">All presets</option><option value="projection">Projection motion · {PROJECTION_LOOK_IDS.length} studies</option><option value="flat">Flat colour &amp; outlines · {FLAT_LOOK_IDS.length} looks</option><option value="finish">Finishes for any layer · {FINISH_LOOKS.length - 1} looks</option><optgroup label="Surfaces"><option value="surface">All surfaces</option>{patterns.surface!.map((label, index) => <option key={index} value={`surface-${index}`}>{label}</option>)}</optgroup><optgroup label="Sculptures"><option value="sculpture">All sculptures</option>{sculptureForms.map((label, index) => <option key={index} value={`sculpture-${index}`}>{label}</option>)}</optgroup><optgroup label="Fractals"><option value="fractal">All fractals</option><option value="fractal-0">Kaleidoscopes</option><option value="fractal-1">Julia blooms</option><option value="fractal-2">Mandelbox worlds</option></optgroup><optgroup label="Graphic Patterns"><option value="graphic">All graphic patterns</option>{GRAPHIC_FAMILIES.map((label, index) => <option key={index} value={`graphic-${index}`}>{label}</option>)}</optgroup><optgroup label="Light, material & space">{INSTRUMENTS.map(i=><option key={i.kind} value={i.kind}>{i.name}</option>)}</optgroup><option value="oil">Oil Slides</option><option value="liquid">Liquid Light</option><option value="scope">Oscilloscope</option><option value="super8">Super 8 Paint</option></select></label><div className="preset-list">{presetFilter === 'finish' ? searchedFinishes.map(finish => <button key={finish.id} className="preset-card finish-card" disabled={!selected || !finishSupported(selected, finish.id)} onClick={() => { if (selected && finishSupported(selected, finish.id)) editLayer(l => applyFinish(l, finish.id)); }}><strong>{finish.name}</strong><span>{finish.description}</span></button>) : searchedPresets.map(preset => <button key={preset.id} className="preset-card" onClick={() => {
        if(preset.params.inkMode===2&&project.duration>60){notify('Shorten the clip to 60 seconds before selecting evolving chemistry.');return;}
        // Flat looks are authored as exact palette colour; soft highlight roll-off would dull them.
        if ((preset.params.toonMix ?? 0) > 0 && project.highlights !== 'exact') { edit(p => ({ ...p, highlights: 'exact' })); notify('Exact colour turned on for flat palette colour. Change it under Finish → Output.'); }
        if (selected && selected.kind === preset.kind) editLayer(l => applyPreset(l, preset.id));
        else if (project.layers.length < 4) { const layer = applyPreset(createLayer(preset.kind), preset.id); edit(p => ({ ...p, layers: [...p.layers, layer] })); setSelectedId(layer.id); }
        else notify('Select a matching instrument or remove a layer first.');
      }}>{PROJECTION_LOOK_IDS.includes(preset.id) && <img className="signature-thumbnail" src={projectionThumbnails[`./assets/projection/${preset.id}.png`]} alt="" loading="lazy" />}<div className="preset-swatches">{preset.palette.map((c, i) => <i key={i} style={{ background: c }} />)}</div><strong>{preset.name}</strong><span>{lookCaption(preset)}</span></button>)}</div></>}</div>
      {libraryTab === 'Presets' && presetFilter === 'finish' && (!selected || !finishSupported(selected)) && <p className="library-empty">Finishes apply to the selected layer. Graphic Patterns and evolving Ink cannot take them.</p>}{libraryTab === 'Presets' && (presetFilter === 'finish' ? !searchedFinishes.length : !searchedPresets.length) && <p className="library-empty">No looks match this search and filter.</p>}
    </aside>
    <aside className="left-panel" id="layer-panel" aria-label="Composition layers">
      <div className="layers-heading"><div><Icon name="layers" size={15} /><span className="layer-heading-label">Layers</span><span>{project.layers.length}/4</span></div><button className="icon-button" title="Add instrument" aria-label="Add instrument" popoverTarget="library-drawer"><Icon name="plus" size={16} /></button></div>
      <div className="layer-list">{[...project.layers].reverse().map((layer, reversedIndex) => { const index = project.layers.length - reversedIndex - 1; return <div key={layer.id} className={`layer-row ${selected?.id === layer.id ? 'selected' : ''} ${layer.visible ? '' : 'layer-is-hidden'}`} onClick={() => setSelectedId(layer.id)}><button className="layer-visibility" title={layer.visible ? 'Hide layer' : 'Show layer'} onClick={e => { e.stopPropagation(); editLayer(l => ({ ...l, visible: !l.visible }), layer.id); }}><Icon name={layer.visible ? 'eye' : 'eyeOff'} size={15} /></button><button className="layer-select" title={layer.visible ? layer.name : `${layer.name} · Hidden`} aria-description={layer.visible ? 'Visible layer' : 'Hidden layer'} aria-label={`Select ${layer.name}`} aria-pressed={selected?.id === layer.id} onClick={() => setSelectedId(layer.id)}><span className={`layer-glyph ${layer.kind}`}><Icon name={layer.kind} size={18} /></span><div className="layer-name"><strong>{layer.name}</strong><small>{layer.blend} · {Math.round(layer.opacity * 100)}%</small></div></button><button className="icon-button layer-randomize" title={`Randomize ${layer.name}`} aria-label={`Randomize ${layer.name}`} onClick={e => { e.stopPropagation(); randomizeEffect(layer.id); }}><Icon name="shuffle" size={14} /></button><div className="layer-order"><button title="Move layer forward" disabled={index === project.layers.length - 1} onClick={e => { e.stopPropagation(); moveLayer(index, 1); }}><Icon name="up" size={12} /></button><button title="Move layer backward" disabled={index === 0} onClick={e => { e.stopPropagation(); moveLayer(index, -1); }}><Icon name="down" size={12} /></button></div></div>; })}</div>
      <button className="layer-panel-toggle" onClick={workspace.toggleLayers} title={workspace.layersExpanded ? 'Collapse layer list · L' : 'Expand layer list · L'} aria-label={workspace.layersExpanded ? 'Collapse layer list' : 'Expand layer list'}><Icon name="layers" size={16}/>{workspace.layersExpanded && <span>Collapse</span>}</button>
    </aside>

    <section className="center-panel"><div className="viewer-toolbar">
      <div className="workspace-tools"><button ref={workspace.libraryButton} className={`workspace-tool ${workspace.libraryOpen ? 'active' : ''}`} aria-label="Open library" aria-expanded={workspace.libraryOpen} aria-controls="library-drawer" popoverTarget="library-drawer" title="Library · B"><Icon name="library" size={16}/><span>Library</span></button><button ref={workspace.layersButton} className={`workspace-tool ${workspace.layersExpanded ? 'active' : ''}`} aria-label="Toggle layer list" aria-expanded={workspace.layersExpanded} aria-controls="layer-panel" onClick={workspace.toggleLayers} disabled={workspace.focusMode} title="Layers · L"><Icon name="layers" size={16}/></button><span className="viewer-meta">{project.width} × {project.height}<span> · {Number((project.fps.num / project.fps.den).toFixed(2))} fps</span></span></div>
      <div className="viewer-options"><span className="live-badge"><i />{exporting ? 'Exporting' : playing ? 'Playing' : 'Paused'}</span><button className={checker ? 'selected-tool' : ''} title="Toggle transparency checker" aria-pressed={checker} onClick={() => setChecker(v => !v)}><Icon name="grid" size={15} /></button><button ref={workspace.inspectorButton} className={`workspace-tool ${workspace.inspectorOpen && !workspace.focusMode ? 'active' : ''}`} aria-label="Toggle inspector" aria-expanded={workspace.inspectorOpen && !workspace.focusMode} aria-controls="inspector-panel" onClick={workspace.toggleInspector} disabled={workspace.focusMode} title="Inspector · I"><Icon name="inspector" size={16}/></button><button ref={workspace.focusButton} className="workspace-tool focus-toggle" aria-label={workspace.focusMode ? 'Exit focus mode' : 'Focus preview'} aria-pressed={workspace.focusMode} onClick={workspace.toggleFocus} title={workspace.focusMode ? 'Exit focus · F or Esc' : 'Focus preview · F'}><Icon name="focus" size={16}/><span>{workspace.focusMode ? 'Exit focus' : 'Focus'}</span></button></div>
    </div>
      <div className="preview-stage"><Preview tiled={tiledView && !!project.tileEdges} project={project} playing={playing && !exporting && mode === 'studio'} phase={phase} rendererRef={rendererRef} onError={reportError} onEnded={()=>setPlaying(false)} checker={checker} layer={selected} locks={locks} blocked={exporting || exportOpen || !ready} onChange={(layer, record) => {
        const current = projectRef.current;
        const before = current.layers.find(l => l.id === layer.id);
        if (before && !sameCanvasValues(before, layer)) replace({ ...current, layers: current.layers.map(l => l.id === layer.id ? layer : l) }, record);
      }} onVary={randomizeEffect} onNotice={notify} />{project.tileEdges && <label className="checkbox-row tiled-view"><input type="checkbox" aria-label="Tiled view" checked={tiledView} onChange={e => setTiledView(e.target.checked)} />Tiled view (2 × 2 preview, not saved or exported)</label>}</div>
      <Transport project={project} phase={phase} playing={playing} onPlaying={() => {if(isEvolving(project)&&phase.current>=TAU){phase.current=0;setPlaying(true);}else setPlaying(v=>!v);}} onDuration={n => edit(p => ({ ...p, duration: n }))}>
        <div className="variation-actions"><button className="variation-button" aria-label="Randomize effect" title="Coherent variations within this effect; respects Keep locks" disabled={!selected} onClick={() => { if (selected) randomizeEffect(selected.id); }}><Icon name="shuffle" size={14} />Vary</button><button className="icon-button variation-settings-toggle" ref={workspace.variationButton} aria-label="Variation settings" aria-expanded={workspace.variationOpen} aria-controls="variation-settings" popoverTarget="variation-settings" title="Variation amount and Keep locks"><Icon name="settings" size={16}/></button></div>
        <div id="variation-settings" className="variation-settings" popover="auto" ref={workspace.variation} onToggle={e=>workspace.setVariationOpen(e.currentTarget.matches(':popover-open'))}>
          <div className="drawer-heading"><strong>Variation</strong><button className="icon-button" aria-label="Close variation settings" popoverTarget="variation-settings" popoverTargetAction="hide"><Icon name="close" size={16}/></button></div>
          <label className="variation-strength"><span>Amount</span><select aria-label="Variation amount" value={variationStrength} onChange={e => setVariationStrength(Number(e.target.value))}><option value="0.35">Subtle</option><option value="0.65">Balanced</option><option value="1">Bold</option></select></label>
          <span className="variation-label" id="variation-lock-label">Keep unchanged</span><div className="lock-controls" role="group" aria-labelledby="variation-lock-label">{(['palette', 'structure', 'motion', 'material'] as const).map(key => <button key={key} title={`${locks[key] ? 'Unlock' : 'Lock'} ${key}`} aria-pressed={locks[key]} className={locks[key] ? 'locked' : ''} onClick={() => setLocks(v => ({ ...v, [key]: !v[key] }))}><Icon name={locks[key] ? 'lock' : 'unlock'} size={13} />{key}</button>)}</div>
        </div>
      </Transport>
    </section>

    <aside className="right-panel" id="inspector-panel" aria-label="Layer inspector">{selected ? <>
      <div className="inspector-title"><span className="eyebrow">Selected layer</span><div><Icon name={selected.kind} size={20} /><EditableName label="Layer name" value={selected.name} maxLength={60} onCommit={name => editLayer(l => ({ ...l, name }))} /><button className="icon-button" title="Duplicate layer" disabled={project.layers.length >= 4} onClick={() => { const copy = structuredClone(selected); copy.id = uid(); copy.name = `${copy.name.slice(0, 54)} copy`; edit(p => ({ ...p, layers: [...p.layers, copy] })); setSelectedId(copy.id); }}><Icon name="copy" size={15} /></button><button className="icon-button" title="Delete layer" disabled={project.layers.length <= 1} onClick={() => { const layers = project.layers.filter(l => l.id !== selected.id); edit(p => ({ ...p, layers })); setSelectedId(layers.at(-1)?.id ?? ''); }}><Icon name="trash" size={15} /></button></div></div>
      <div className="tab-switch inspector-tabs">{(['Shape', 'Motion', 'Finish'] as const).map(t => <button key={t} aria-pressed={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="inspector-content">{tab === 'Shape' ? <>
        {patterns[selected.kind] && <div className="field-group"><label>{selected.kind === 'fractal' ? 'Fractal family' : 'Pattern'}</label><div className={`pattern-picker${selected.kind === 'fractal' ? ' fractal-patterns' : ''}`}>{patterns[selected.kind]!.map((label, i) => <button key={i} aria-pressed={Math.round(selected.params.style ?? 0) === i} className={Math.round(selected.params.style ?? 0) === i ? 'active' : ''} onClick={() => editLayer(l => ({ ...l, params: { ...l.params, style: i } }))}>{label}</button>)}</div></div>}
        {isInstrument(selected.kind) && <div className="projection-help"><p>{INSTRUMENTS.find(i=>i.kind===selected.kind)!.description}. Pattern scale reveals more of the field. Field background controls transparent gaps.</p>{selected.kind==='livingink' && <p>Growth family and Branching prepare a seeded chemical pattern. Playback animates its flow and pigment without simulation warm-up.</p>}</div>}
        {selected.kind === 'graphic' && <div className="graphic-options"><ChoiceParameter label="Pattern family" name="Graphic family" options={GRAPHIC_FAMILIES} value={selected.params.style} onChange={style => editLayer(l => applyPreset(l, GRAPHIC_LOOKS.find(look => look.params.style === style)!.id))} /><ChoiceParameter label="Starting look" name="Graphic look" options={GRAPHIC_VARIANTS[Math.round(selected.params.style)]} value={selected.params.variant} onChange={variant => editLayer(l => applyPreset(l, GRAPHIC_LOOKS.find(look => look.params.style === l.params.style && look.params.variant === variant)!.id))} />{selected.params.style === 2 && <><ChoiceParameter label="Tile finish" name="Tile finish" options={['Solid', 'Hollow outlines', 'Nested contours']} value={selected.params.fill} onChange={fill => editLayer(l => ({...l, params:{...l.params,fill}}))} /><ChoiceParameter label="Wave layout" name="Tile wave layout" options={['Still', 'Linear sweep', 'Radial ripple']} value={selected.params.sweep} onChange={sweep => editLayer(l => ({...l, params:{...l.params,sweep}}))} /></>}{selected.params.style === 3 && <ChoiceParameter label="Shape profile" name="Spiral shape profile" options={['Circle','Line','Triangle','Square','Pentagon','Hexagon','Heptagon','Octagon','Nonagon','Decagon']} value={selected.params.profile} onChange={profile => editLayer(l => ({...l, params:{...l.params,profile}}))} />}{selected.params.style === 4 && <ChoiceParameter label="Path corners" name="Path corners" options={['Square','Round','Soft bevel']} value={selected.params.corners} onChange={corners => editLayer(l => ({...l, params:{...l.params,corners}}))} />}<p>All patterns share the layer mix, masks and loop controls. Set Pattern background to zero for transparent gaps.</p></div>}
        {selected.kind === 'surface' && <ChoiceParameter label="Variant" name="Surface variant" options={surfaceVariants[Math.round(selected.params.style ?? 0)]} value={selected.params.variant} onChange={variant => editLayer(l => ({ ...l, params: { ...l.params, variant } }))} />}
        {selected.kind === 'sculpture' && <ChoiceParameter label="Form" name="Sculpture form" options={sculptureForms} value={selected.params.form} onChange={form => editLayer(l => ({ ...l, params: { ...l.params, form } }))} />}
        {selected.kind === 'fractal' && <div className="fractal-options"><label className="stacked-label">Variant<select aria-label="Fractal variant" value={Math.round(selected.params.variant ?? 0)} onChange={e => editLayer(l => ({ ...l, params: { ...l.params, variant: Number(e.target.value) } }))}>{fractalVariants[Math.round(selected.params.style ?? 0)].map((label, value) => <option key={value} value={value}>{label}</option>)}</select></label><>{Math.round(selected.params.style ?? 0) === 2 && <label className="stacked-label">Radial fold<select aria-label="Mandelbox radial fold" value={Math.round(selected.params.radial ?? 0)} onChange={e => editLayer(l => ({ ...l, params: { ...l.params, radial: Number(e.target.value) } }))}><option value="0">Off</option><option value="1">On</option></select></label>}</><label className="stacked-label">Render quality<select aria-label="Fractal render quality" value={Math.round(selected.params.quality ?? 2)} onChange={e => editLayer(l => ({ ...l, params: { ...l.params, quality: Number(e.target.value) } }))}><option value="0">Draft</option><option value="1">Standard</option><option value="2">High</option></select></label><p>Quality affects preview and export.</p></div>}
        {selected.kind === 'fractal' && <ChoiceParameter label="Coloring" name="Fractal coloring" options={coloringModes} value={selected.params.colorMode} onChange={colorMode => editLayer(l => ({ ...l, params: { ...l.params, colorMode } }))} />}
        {selected.kind === 'super8' && <div className="super8-options"><ChoiceParameter label="Mode" name="Super 8 mode" options={SUPER8_MODES} value={selected.params.mode} onChange={mode => editLayer(l => ({ ...l, params: { ...l.params, mode } }))} /><ChoiceParameter label="Substrate" name="Super 8 substrate" options={['Transparent cutout', 'Painted paper']} value={selected.params.substrate} onChange={substrate => editLayer(l => ({ ...l, params: { ...l.params, substrate } }))} /><ChoiceParameter label="Projector view" name="Super 8 projector view" options={['Full canvas', 'Rounded gate', 'Film strip']} value={selected.params.gateMode} onChange={gateMode => editLayer(l => ({ ...l, params: { ...l.params, gateMode } }))} /><p>Paint holds at the film frame rate. Frame advance and shutter move between exposures. Reel turns scroll the strip; Full canvas fills the output without a border.</p></div>}
        {isInstrument(selected.kind) && <ChoiceParameter label="Motion phrase" name="Motion phrase" options={['Steady travel','Gather and release','Drift and settle']} value={selected.params.phrase} onChange={phrase=>editLayer(l=>({...l,params:{...l.params,phrase}}))}/>}
        {selected.kind === 'livingink' && <>{selected.params.inkMode===2&&<ChoiceParameter label="Chemical resolution" name="Chemical resolution" options={['128 × 128','256 × 256','384 × 384']} value={selected.params.simulationQuality} onChange={simulationQuality=>editLayer(l=>({...l,params:{...l.params,simulationQuality}}))}/>}<ChoiceParameter label="Pigment motion" name="Pigment motion" options={['Prepared growth','Flowing pigment loop','Evolving chemistry']} value={selected.params.inkMode} onChange={inkMode=>{if(inkMode===2&&project.duration>60){notify('Shorten the clip to 60 seconds before enabling evolving chemistry.');return;}if(inkMode===2&&selected.modulations.scale){notify('Remove Pattern scale animation before enabling evolving chemistry.');return;}editLayer(l=>({...l,params:{...l.params,inkMode}}));}}/>{selected.params.inkMode===2&&<p className="motion-help">{(selected.params.loopReturn??0)>0?'Evolving chemistry grows through the loop, then recedes back to its seeds over the Loop return share, so it loops seamlessly.':'Evolving chemistry develops through this clip and stops at the end. Raise Loop return to make it loop.'} Growth and transport settings re-prepare its fixed simulation.</p>}</>}
        {selected.kind === 'relief' && <ChoiceParameter label="Relief construction" name="Relief construction" options={['Shaded field','Hinged solids']} value={selected.params.reliefMode} onChange={reliefMode=>editLayer(l=>({...l,params:{...l.params,reliefMode}}))}/>}
        {selected.kind === 'livingink' && <ChoiceParameter label="Growth family" name="Ink growth family" options={['Seeded cells','Fingerprints','Coral labyrinth','Cellular lace']} value={selected.params.pattern} onChange={pattern=>editLayer(l=>({...l,params:{...l.params,pattern}}))}/>}
        {selected.kind === 'relief' && <ChoiceParameter label="Hinge axis" name="Relief hinge axis" options={['Vertical','Horizontal','Diagonal']} value={selected.params.axis} onChange={axis=>editLayer(l=>({...l,params:{...l.params,axis}}))}/>}
        {selected.kind === 'oil' && <div className="oil-options"><ChoiceParameter label="Render quality" name="Oil render quality" options={['Draft', 'Standard', 'High']} value={selected.params.quality} onChange={quality => editLayer(l => ({ ...l, params: { ...l.params, quality } }))} /><ChoiceParameter label="Substrate" name="Oil substrate" options={['Transparent cutout', 'Colored substrate']} value={selected.params.substrate} onChange={substrate => editLayer(l => ({ ...l, params: { ...l.params, substrate } }))} />{selected.params.substrate === 0 && <p>Transparency keeps the glass tint and reflections.</p>}<button className="oil-fine-button" aria-expanded={oilFine} onClick={() => setOilFine(value => !value)}>{oilFine ? 'Hide fine tuning' : 'Show fine tuning'}<Icon name={oilFine ? 'up' : 'down'} size={13} /></button>{oilFine && <p>Organic shape softens the dome. Lens depth changes its bulge. Cell complexity adds branching; Color separation adds colored edges.</p>}</div>}
        {selected.kind === 'image' && <div className="image-settings">{selected.image ? <img src={selected.image.dataUrl} alt={selected.image.name} /> : <p>Import a PNG or JPEG to begin.</p>}<label>Image fit<select aria-label="Image fit" value={selected.image?.fit ?? 'contain'} onChange={e => editLayer(l => ({ ...l, image: l.image ? { ...l.image, fit: e.target.value as 'contain' | 'cover' } : undefined }))}><option value="contain">Contain</option><option value="cover">Cover</option></select></label><ChoiceParameter label="Mirror" name="Image mirror" options={mirrorModes} value={selected.params.mirror} onChange={mirror => editLayer(l => ({ ...l, params: { ...l.params, mirror } }))} /></div>}
        {controlGroups.map(({ title, defs: groupDefs }) => { const defs = groupDefs.filter(d => !choiceKeys.includes(d.key) && !(selected.kind === 'livingink' && d.key === 'pattern') && !(selected.kind === 'relief' && d.key === 'axis') && !(selected.kind === 'graphic' && graphicChoiceKeys.includes(d.key)) && !gradingKeys.includes(d.key) && (selected.kind !== 'oil' || oilFine || !oilFineControls.includes(d.key))).map(d => ({ ...d, advanced: d.advanced || secondaryShapeControls[selected.kind]?.includes(d.key) })); if (!defs.length) return null; return <details className="control-section inspector-section" key={`${selected.kind}-${title}`} open={title === 'Shape' || title === 'Paint geometry'}><summary>{title}<span>{defs.length}</span></summary>{defs.filter(d=>!d.advanced).map(d => <Parameter key={d.key} definition={d} value={selected.params[d.key] ?? d.default} animated={!!selected.modulations[d.key]} onChange={n => editLayer(l => ({ ...l, params: { ...l.params, [d.key]: n } }))} onAnimate={d.step === 1 || d.preparation ? undefined : () => { setModKey(d.key); setTab('Motion'); }} onStart={beginGesture} onEnd={endGesture} />)}{defs.some(d=>d.advanced)&&<details className="advanced-controls"><summary>Advanced {title.toLowerCase()}<span>{defs.filter(d=>d.advanced).length}</span></summary>{defs.filter(d=>d.advanced).map(d=><Parameter key={d.key} definition={d} value={selected.params[d.key]??d.default} animated={!!selected.modulations[d.key]} onChange={n=>editLayer(l=>({...l,params:{...l.params,[d.key]:n}}))} onAnimate={d.step===1||d.preparation?undefined:()=>{setModKey(d.key);setTab('Motion');}} onStart={beginGesture} onEnd={endGesture}/>)}</details>}</details>; })}
        {isInstrument(selected.kind)&&<SurfaceEditor layer={selected} onChange={surface=>editLayer(l=>{const next={...l};if(surface)next.surface=surface;else delete next.surface;return next;})} onStart={beginGesture} onEnd={endGesture}/>}
        {selected.kind !== 'image' && <section className="control-section"><h3>Palette</h3><div className="palette-editor">{selected.palette.map((color, i) => selected.kind === 'sculpture' && i !== 0 && i !== 2 ? null : <label key={i} style={{ background: color }} title={selected.kind === 'sculpture' ? (i === 0 ? 'Base color' : 'Sheen color') : selected.kind === 'oil' ? oilPaletteLabels[i] : selected.kind === 'liquid' ? liquidPaletteLabels[i] : selected.kind === 'scope' ? scopePaletteLabels[i] : selected.kind === 'super8' ? super8PaletteLabels[i] : `Color ${i + 1}`}><input aria-label={selected.kind === 'sculpture' ? (i === 0 ? 'Base color' : 'Sheen color') : selected.kind === 'oil' ? oilPaletteLabels[i] : selected.kind === 'liquid' ? liquidPaletteLabels[i] : selected.kind === 'scope' ? scopePaletteLabels[i] : selected.kind === 'super8' ? super8PaletteLabels[i] : `Palette color ${i + 1}`} type="color" value={color} onChange={e => editLayer(l => ({ ...l, palette: l.palette.map((c, j) => i === j ? e.target.value : c) }))} /></label>)}</div><div className="seed-row"><label>Seed<input aria-label="Layer seed" type="number" min="0" max="4294967295" value={selected.params.seed ?? project.seed} onChange={e => editLayer(l => ({ ...l, params: { ...l.params, seed: clamp(Math.round(Number(e.target.value)), 0, 4294967295) } }))} /></label><button className="icon-button" title="Next seed" onClick={() => editLayer(l => ({ ...l, params: { ...l.params, seed: ((l.params.seed ?? 1) + 1) >>> 0 } }))}><Icon name="shuffle" size={15} /></button></div></section>}
      </> : tab === 'Motion' ? <>
        <p className="motion-help">Animate a parameter over the {isEvolving(project)?'clip':'loop'}.</p>
        <label className="stacked-label">Parameter<select aria-label="Motion parameter" value={selectedModKey} onChange={e => setModKey(e.target.value)}>{definitions.filter(d => d.step !== 1 && !d.preparation).map(d => <option key={d.key} value={d.key}>{d.label}</option>)}{!definitions.some(d => d.key === selectedModKey) && allDefinitions.some(d => d.key === selectedModKey) && <option value={selectedModKey}>{allDefinitions.find(d => d.key === selectedModKey)!.label} · other family</option>}<option value="opacity">Layer opacity</option><optgroup label="Layer transform"><option value="transform.x">Horizontal</option><option value="transform.y">Vertical</option><option value="transform.scale">Size</option><option value="transform.rotation">Rotation</option></optgroup></select></label>
        <label className="stacked-label">Motion source<select aria-label="Motion source" value={modulation?.kind ?? 'off'} onChange={e => changeMod(e.target.value === 'off' ? undefined : { ...(modulation ?? defaultMod(e.target.value as Modulation['kind'])), kind: e.target.value as Modulation['kind'] })}><option value="off">Off</option><option value="sine">Sine</option><option value="pulse">Pulse</option><option value="noise">Smooth noise</option><option value="keyframes">Keyframes</option></select></label>
        {modulation ? <>{!modulation.range&&<Parameter definition={{ key: 'amount', label: 'Depth', min: 0, max: 1, step: .01, default: .2, section: 'Motion' }} value={modulation.amount} animated={false} onChange={n => changeMod({ ...modulation, amount: n })} onStart={beginGesture} onEnd={endGesture} />}<Parameter definition={{ key: 'cycles', label: 'Cycles per loop', min: 1, max: 8, step: 1, default: 1, section: 'Motion' }} value={modulation.cycles} animated={false} onChange={n => changeMod({ ...modulation, cycles: n })} onStart={beginGesture} onEnd={endGesture} /><Parameter definition={{ key: 'phase', label: 'Phase offset', min: 0, max: 1, step: .01, default: 0, section: 'Motion' }} value={modulation.phase} animated={false} onChange={n => changeMod({ ...modulation, phase: n })} onStart={beginGesture} onEnd={endGesture} />{modulation.kind === 'keyframes' && <KeyframeCurve mod={modulation} onChange={changeMod} onStart={beginGesture} onEnd={endGesture} />}<button className="wide-button" onClick={() => changeMod(undefined)}>Remove animation</button></> : <div className="empty-note"><Icon name="wave" size={28} /><p>Choose a motion source.</p></div>}
        {modulation && <section className="control-section"><label className="stacked-label">Animation range<select aria-label="Animation range" value={modulation.range?'endpoints':'offset'} onChange={e=>{if(e.target.value==='offset'){const {range,...rest}=modulation;changeMod(rest);}else{const d=allDefinitions.find(d=>d.key===selectedModKey),bounds=d?[d.min,d.max]:selectedModKey==='opacity'?[0,1]:selectedModKey==='transform.scale'?[.05,8]:selectedModKey==='transform.rotation'?[-TAU,TAU]:[-2,2];changeMod({...modulation,range:{min:bounds[0],max:bounds[1]}});}}}><option value="offset">Offset from base</option><option value="endpoints">Smooth between endpoints</option></select></label>{modulation.range&&<div className="endpoint-controls">{(['min','max'] as const).map(key=><label key={key}>{key==='min'?'Lower endpoint':'Upper endpoint'}<input type="number" aria-label={key==='min'?'Lower endpoint':'Upper endpoint'} step="any" value={modulation.range![key]} onChange={e=>{const n=Number(e.target.value),d=allDefinitions.find(d=>d.key===selectedModKey),bounds=d?[d.min,d.max]:selectedModKey==='opacity'?[0,1]:selectedModKey==='transform.scale'?[.05,8]:selectedModKey==='transform.rotation'?[-TAU,TAU]:[-2,2];if(Number.isFinite(n)&&n>=bounds[0]&&n<=bounds[1]&&(key==='min'?n<modulation.range!.max:n>modulation.range!.min))changeMod({...modulation,range:{...modulation.range!,[key]:n}});}}/></label>)}</div>}<p className="motion-help">Endpoints define the full movement without clipping at the control limits. Depth applies to offset routes.</p></section>}
        <section className="control-section"><h3>Active routes</h3>{Object.entries(selected.modulations).length ? Object.entries(selected.modulations).map(([key, mod]) => <button className="route-row" key={key} onClick={() => setModKey(key)}><Icon name="wave" size={15} /><span>{allDefinitions.find(d => d.key === key)?.label ?? key}</span><small>{mod.kind} · {mod.cycles}×</small></button>) : <p className="muted-text">No parameter animations.</p>}</section>
      </> : <>
        <section className="control-section"><h3>Layer mix</h3><Parameter definition={{ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: .01, default: 1, section: 'Material' }} value={selected.opacity} animated={!!selected.modulations.opacity} onChange={n => editLayer(l => ({ ...l, opacity: n }))} onAnimate={() => { setModKey('opacity'); setTab('Motion'); }} onStart={beginGesture} onEnd={endGesture} /><label className="stacked-label">Blending<select value={selected.blend} onChange={e => editLayer(l => ({ ...l, blend: e.target.value as Layer['blend'] }))}><option value="normal">Normal</option><option value="screen">Screen</option><option value="multiply">Multiply</option><option value="add">Light add</option><option value="source">Colour from below</option></select></label></section>
        <section className="control-section"><h3>Color finish</h3>{definitions.filter(d => ['saturation','hue','exposure'].includes(d.key)).map(d => <Parameter key={d.key} definition={d} value={selected.params[d.key] ?? d.default} animated={!!selected.modulations[d.key]} onChange={n => editLayer(l => ({ ...l, params: { ...l.params, [d.key]: n } }))} onAnimate={() => { setModKey(d.key); setTab('Motion'); }} onStart={beginGesture} onEnd={endGesture} />)}</section>
        <section className="control-section"><h3>Tonal finishing</h3><p className="muted-text">Shape luminance and colour while preserving transparency.</p>{definitions.filter(d=>FINISH_KEYS.includes(d.key)&&!TOON_KEYS.includes(d.key)&&!FEEDBACK_KEYS.includes(d.key)&&!SLIT_KEYS.includes(d.key)&&!GLOW_KEYS.includes(d.key)&&!PRINT_KEYS.includes(d.key)).map(d=><Parameter key={d.key} definition={d} value={selected.params[d.key]} animated={!!selected.modulations[d.key]} onChange={n=>editLayer(l=>({...l,params:{...l.params,[d.key]:n}}))} onAnimate={()=>{setModKey(d.key);setTab('Motion');}} onStart={beginGesture} onEnd={endGesture}/>)}</section>
        {supportsGlow(selected) && <section className="control-section"><h3>Glow</h3><p className="muted-text">Bright areas spill soft light. Loops close exactly; adds a few blur passes per glowing layer.</p>{definitions.filter(d=>GLOW_KEYS.includes(d.key)&&(d.key==='glowMix'||(selected.params.glowMix??0)>0||!!selected.modulations.glowMix)).map(d=><Parameter key={d.key} definition={d} value={selected.params[d.key]} animated={!!selected.modulations[d.key]} onChange={n=>editLayer(l=>({...l,params:{...l.params,[d.key]:n}}))} onAnimate={d.step===1?undefined:()=>{setModKey(d.key);setTab('Motion');}} onStart={beginGesture} onEnd={endGesture}/>)}</section>}
        {supportsPrint(selected) && <PrintScreenSection layer={selected} definitions={definitions} edit={editLayer} animate={key=>{setModKey(key);setTab('Motion');}} onStart={beginGesture} onEnd={endGesture}/>}
        <section className="control-section"><h3>Flat colour &amp; outlines</h3><p className="muted-text">Hard palette bands and contour lines. For the cleanest edges, lower the source's Relief and Softness.</p>{definitions.filter(d=>TOON_KEYS.includes(d.key)&&(d.key==='toonMix'||(selected.params.toonMix??0)>0)&&(d.key!=='toonOutlineColor'||(selected.params.toonOutline??0)>0)).map(d=><Parameter key={d.key} definition={d} value={selected.params[d.key]} animated={!!selected.modulations[d.key]} onChange={n=>editLayer(l=>({...l,params:{...l.params,[d.key]:n}}))} onAnimate={d.step===1?undefined:()=>{setModKey(d.key);setTab('Motion');}} onStart={beginGesture} onEnd={endGesture}/>)}</section>
        {supportsSlitScan(selected) && <section className="control-section"><h3>Time displacement</h3><p className="muted-text">Parts of the frame show the source as it was some frames ago. Loops close exactly; each slice renders the source once more.</p>{definitions.filter(d=>SLIT_KEYS.includes(d.key)&&d.key!=='slitShape'&&(d.key==='slitShift'||(selected.params.slitShift??0)!==0||!!selected.modulations.slitShift)&&(d.key!=='slitBlocks'||selected.params.slitShape===4)).map(d=><Parameter key={d.key} definition={d} value={selected.params[d.key]} animated={!!selected.modulations[d.key]} onChange={n=>editLayer(l=>({...l,params:{...l.params,[d.key]:n}}))} onAnimate={d.step===1?undefined:()=>{setModKey(d.key);setTab('Motion');}} onStart={beginGesture} onEnd={endGesture}/>)}{((selected.params.slitShift??0)!==0||!!selected.modulations.slitShift)&&<ChoiceParameter label="Delay map" name="Delay map" options={SLIT_SHAPES} value={selected.params.slitShape??0} onChange={slitShape=>editLayer(l=>({...l,params:{...l.params,slitShape}}))}/>}</section>}
        {supportsFeedback(selected) && <section className="control-section"><h3>Feedback</h3><p className="muted-text">Each frame keeps a faded, moved echo of the last. Loops close exactly; exports warm up before the first frame.</p>{definitions.filter(d=>FEEDBACK_KEYS.includes(d.key)&&d.key!=='echoBlend'&&d.key!=='echoStreakAxis'&&(!['echoRound','echoSquare','echoEdge'].includes(d.key)||(selected.params.echoFrame??0)>0||(selected.params.echoWindow??0)>0)&&(d.key==='echo'||(selected.params.echo??0)>0||!!selected.modulations.echo)).map(d=><Parameter key={d.key} definition={d} value={selected.params[d.key]} animated={!!selected.modulations[d.key]} onChange={n=>editLayer(l=>({...l,params:{...l.params,[d.key]:n}}))} onAnimate={()=>{setModKey(d.key);setTab('Motion');}} onStart={beginGesture} onEnd={endGesture}/>)}{((selected.params.echo??0)>0||!!selected.modulations.echo)&&<ChoiceParameter label="Echo blend" name="Echo blend" options={['Mix','Behind source','Brighter']} value={selected.params.echoBlend??0} onChange={echoBlend=>editLayer(l=>({...l,params:{...l.params,echoBlend}}))}/>}{((selected.params.echo??0)>0||!!selected.modulations.echo)&&(selected.params.echoStreak??0)>0&&<ChoiceParameter label="Streak direction" name="Streak direction" options={['Radial','Box']} value={selected.params.echoStreakAxis??0} onChange={echoStreakAxis=>editLayer(l=>({...l,params:{...l.params,echoStreakAxis}}))}/>}</section>}
        <section className="control-section"><h3>Transform</h3>{([{ key: 'x', label: 'Horizontal', min: -2, max: 2, step: .01, default: 0 }, { key: 'y', label: 'Vertical', min: -2, max: 2, step: .01, default: 0 }, { key: 'scale', label: 'Size', min: .05, max: 8, step: .01, default: 1 }, { key: 'rotation', label: 'Rotation', min: -Math.PI, max: Math.PI, step: .01, default: 0 }] as const).map(d => <Parameter key={d.key} definition={{ ...d, section: 'Shape' }} value={selected.transform[d.key]} animated={!!selected.modulations[`transform.${d.key}`]} onChange={n => editLayer(l => ({ ...l, transform: { ...l.transform, [d.key]: n } }))} onAnimate={() => { setModKey(`transform.${d.key}`); setTab('Motion'); }} onStart={beginGesture} onEnd={endGesture} />)}</section>
        <section className="control-section"><h3>Mask</h3><label className="stacked-label">Mask shape<select value={selected.mask.kind} onChange={e => { const kind = e.target.value as Layer['mask']['kind']; if (kind === 'image' && !selected.mask.dataUrl) maskInput.current?.click(); else editLayer(l => ({ ...l, mask: { kind, softness: l.mask.softness, invert: l.mask.invert, size: l.mask.size, ...(kind === 'image' ? { dataUrl: l.mask.dataUrl } : {}) } })); }}><option value="none">None</option><option value="circle">Circle</option><option value="rectangle">Rectangle</option><option value="image">Imported image</option></select></label>{selected.mask.kind !== 'none' && <><Parameter definition={{ key: 'size', label: 'Mask size', min: .05, max: 2, step: .01, default: 1, section: 'Shape' }} value={selected.mask.size} animated={false} onChange={n => editLayer(l => ({ ...l, mask: { ...l.mask, size: n } }))} onStart={beginGesture} onEnd={endGesture} /><Parameter definition={{ key: 'softness', label: 'Feather', min: 0, max: 1, step: .01, default: .1, section: 'Shape' }} value={selected.mask.softness} animated={false} onChange={n => editLayer(l => ({ ...l, mask: { ...l.mask, softness: n } }))} onStart={beginGesture} onEnd={endGesture} /><label className="checkbox-row"><input type="checkbox" checked={selected.mask.invert} onChange={e => editLayer(l => ({ ...l, mask: { ...l.mask, invert: e.target.checked } }))} />Invert mask</label>{selected.mask.kind === 'image' && <button className="wide-button" onClick={() => maskInput.current?.click()}>Replace mask image</button>}</>}</section>
        <section className="control-section"><h3>Output</h3><label className="checkbox-row"><input type="checkbox" aria-label="Exact colour" checked={project.highlights === 'exact'} onChange={e => edit(p => ({ ...p, highlights: e.target.checked ? 'exact' : 'soft' }))} />Exact colour (no highlight roll-off)</label><p className="muted-text">Keeps palette colours at their exact values. Turn off for lit 3D and glowing sources, whose highlights then roll off softly.</p>{(() => { const blockers = tileBlockers(project); return <><label className="checkbox-row"><input type="checkbox" aria-label="Tile edges" checked={!!project.tileEdges} disabled={blockers.length > 0} onChange={e => edit(p => { const { tileEdges: _off, ...rest } = p; return e.target.checked ? { ...rest, tileEdges: true } : rest; })} />Tile edges</label><p className="muted-text">The exported clip repeats seamlessly side by side and top to bottom, for mapping copies onto neighbouring surfaces.</p>{blockers.map((b, i) => <p key={i} className="muted-text">{b}</p>)}</>; })()}</section>
        <section className="control-section"><h3>Composition background</h3><label className="checkbox-row"><input type="checkbox" checked={project.transparent} onChange={e => edit(p => ({ ...p, transparent: e.target.checked }))} />Transparent background</label><label className="background-color">Background color<input aria-label="Background color" type="color" value={project.background} onChange={e => edit(p => ({ ...p, background: e.target.value }))} /></label></section>
      </>}</div>
    </> : <div className="empty-inspector"><Icon name="layers" size={32} /><h2>No layers</h2><p>Add an instrument or image to begin.</p><button className="secondary-button" onClick={() => addLayer('surface')}>Add surface</button></div>}</aside>
    </main>
    {mode === 'live' && <LivePanel header={modeSwitch} onError={reportError} />}
    {mode === 'map' && <MapPanel header={modeSwitch} onError={reportError} onEditInStudio={editShapeInStudio} />}

    <footer className="app-footer" inert={mode !== 'studio'}><span className="workspace-shortcuts"><kbd>F</kbd> focus <kbd>B</kbd> library <kbd>L</kbd> layers <kbd>I</kbd> inspector</span><span className="footer-status"><span className={status && (!status.ffmpeg || !status.ffprobe) ? 'engine-unavailable' : ''}>{status?.ffmpeg && status.ffprobe ? 'Export engine ready' : status ? 'Export engine unavailable' : 'Movies and sequences require the desktop app'}</span><span className="build-label" title={`Commit ${__FORM_FIELD_BUILD__.commit}${__FORM_FIELD_BUILD__.modified ? ' with uncommitted changes' : ''} · built ${new Date(__FORM_FIELD_BUILD__.date).toLocaleString()}`}>v{__FORM_FIELD_BUILD__.version} · build {__FORM_FIELD_BUILD__.build}{__FORM_FIELD_BUILD__.modified ? '+' : ''}</span></span></footer>
    {!exportOpen && <Notices message={message} error={error} onDismiss={() => setError('')} />}

    {exportOpen && <ExportDialog busy={exporting} onClose={() => setExportOpen(false)}><section className="export-modal"><Notices message={message} error={error} onDismiss={() => setError('')} /><div className="modal-title"><div><h2 id="export-heading">Export</h2></div><button className="icon-button" disabled={exporting} onClick={() => setExportOpen(false)} aria-label="Close export"><Icon name="close" /></button></div>
      <div className="export-grid"><label className="stacked-label">Resolution<select aria-label="Export resolution" value={resolution} disabled={exporting} onChange={e => { const [width, height] = e.target.value.split('x').map(Number); setResolution(e.target.value); edit(p => ({ ...p, width, height })); }}>{!resolutions.includes(resolution) && <option value={resolution}>Current canvas · {resolution.replace('x', ' × ')}</option>}<option value="3840x2160">4K UHD · 3840 × 2160</option><option value="4096x2160">DCI 4K projector · 4096 × 2160</option><option value="3840x2400">4K WUXGA projector · 3840 × 2400</option><option value="2160x3840">4K portrait · 2160 × 3840</option><option value="2160x2160">Square · 2160 × 2160</option><option value="1920x1200">WUXGA projector · 1920 × 1200</option><option value="1920x1080">HD draft · 1920 × 1080</option><option value="960x540">Small draft · 960 × 540</option></select></label><label className="stacked-label">Frame rate<select aria-label="Export frame rate" value={exportRate} disabled={exporting} onChange={e => { const [num, den] = e.target.value.split('/').map(Number); setExportRate(e.target.value); edit(p => ({ ...p, fps: { num, den } })); }}>{!rates.includes(exportRate) && <option value={exportRate}>Current · {(exportNum / exportDen).toFixed(3)} FPS</option>}{[['24/1', '24'], ['25/1', '25'], ['30/1', '30'], ['50/1', '50'], ['60/1', '60'], ['30000/1001', '29.97'], ['60000/1001', '59.94']].map(([v, label]) => <option key={v} value={v}>{label} FPS</option>)}</select></label></div>
      <label className="stacked-label">Delivery format<select aria-label="Delivery format" value={format} disabled={exporting} onChange={e => setFormat(e.target.value as ExportFormat)}><optgroup label="Mastering"><option value="prores4444">ProRes 4444 (.mov)</option><option value="prores422">ProRes 422 HQ (.mov)</option><option value="png">PNG sequence (16-bit)</option></optgroup><optgroup label="Projection playback (GPU decode)"><option value="hapq" disabled={status?.hap === false}>HAP Q (.mov) · best quality</option><option value="hap" disabled={status?.hap === false}>HAP (.mov) · smallest</option><option value="hapalpha" disabled={status?.hap === false}>HAP Alpha (.mov) · transparent</option></optgroup></select></label>
      <label className="stacked-label">Anti-aliasing<select aria-label="Supersampling" value={supersample} disabled={exporting} onChange={e => setSupersample(Number(e.target.value) as Supersample)}><option value={1}>Off · fastest</option><option value={2}>2× supersampling · final delivery</option><option value={3}>3× supersampling · finest lines (HD and below)</option></select></label>
      <div className="export-alpha"><label className="checkbox-row"><input type="checkbox" disabled={exporting || !alphaOptional} checked={exportTransparent} onChange={e => setExportAlpha(e.target.checked)} />Transparent output</label><span>{exportSeconds.toFixed(3).replace(/\.?0+$/, '')}s · {exportFrames} frames · {project.layers.length} {project.layers.length === 1 ? 'layer' : 'layers'}</span></div>
      <label className="stacked-label">Destination<div className="destination"><input aria-label="Export destination" value={outputDir} disabled={exporting} onChange={e => setOutputDir(e.target.value)} placeholder="Choose a local folder" /><button className="icon-button" disabled={exporting || !window.studio} onClick={async () => { const dir = await window.studio?.chooseExportDirectory(); if (dir) setOutputDir(dir); }} title="Choose export folder"><Icon name="folder" size={18} /></button></div></label>
      {(!window.studio || (status && (!status.ffmpeg || !status.ffprobe))) && <p className="export-unavailable">{window.studio ? 'Export engine unavailable. Restart the app and try again.' : 'Open the desktop app to export movies and sequences. You can save a PNG here.'}</p>}
      <div className="export-note"><Icon name="info" size={17} /><p>Completed frames stay on disk so you can resume a stopped export.</p></div>
      {progress && <div className="export-progress"><div><strong>{progress.status === 'complete' ? 'Export complete' : ['failed', 'cancelled', 'interrupted'].includes(progress.status) ? 'Export stopped' : progress.status === 'rendering' ? 'Rendering frames' : progress.status === 'verifying' ? 'Verifying output' : 'Encoding movie'}</strong><span>{progress.rendered} / {progress.total}</span></div><progress aria-label="Export progress" max={progress.total} value={progress.rendered} /><p>{progress.message ?? progress.error}</p>{progress.seam && <p className={`seam-report ${progress.seam.status}`} role={progress.seam.status === 'seam' ? 'alert' : undefined}>{progress.seam.summary}</p>}{progress.edges && <p className={`seam-report ${progress.edges.status}`} role={progress.edges.status === 'seam' ? 'alert' : undefined}>{progress.edges.summary}</p>}{progress.outputPath && <button className="wide-button" onClick={() => void window.studio?.revealPath(progress.outputPath!)}>Show exported media <span>↗</span></button>}</div>}
      <div className="export-actions"><button className="secondary-button" disabled={exporting || stillBusy} onClick={() => void still()}><Icon name="image" size={16} />{stillBusy ? 'Rendering still…' : 'Save PNG still'}</button>{exporting ? <button className="secondary-button danger" onClick={async () => { cancel.current = true; try { if (activeJob.current) await window.studio?.cancelExport(activeJob.current); } catch (e) { reportError(String(e)); } }}>Stop safely</button> : <button className="primary-button" onClick={() => void startExport()} disabled={stillBusy || !window.studio || !status || !status.ffmpeg || !status.ffprobe}><Icon name="download" size={16} />{isEvolving(project)?'Render clip':'Render loop'}</button>}</div>
      {jobs.some(j => ['interrupted', 'cancelled', 'failed'].includes(j.status)) && <div className="recoverable-jobs"><h3>Recoverable jobs</h3>{jobs.filter(j => ['interrupted', 'cancelled', 'failed'].includes(j.status)).slice(0, 3).map(job => <div key={job.id}><span>{job.request.project.name}<small>{job.completedFrames.length}/{job.totalFrames} frames · {job.status}</small></span><button disabled={exporting} onClick={async () => { try { const resumed = await window.studio!.resumeExport(job.id); await runJob(resumed); } catch (e) { reportError(String(e)); } }}>Resume <Icon name="arrow" size={13} /></button></div>)}</div>}
    </section></ExportDialog>}
  </div>;
}

function slug(name: string) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'composition'; }
function download(bytes: Uint8Array, name: string, type: string) { const buffer = new Uint8Array(bytes).buffer; const url = URL.createObjectURL(new Blob([buffer], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
