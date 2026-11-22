/**
 * The Finish controls of a layer, in Studio's groups: Layer mix, Color finish, Tonal finishing, Glow, Print screen,
 * Flat colour & outlines, Time displacement and Feedback. Studio's Finish tab and Map's Finish part both draw these.
 * Optional parts show only once switched on, as in Studio, so a layer never lists every setting at once.
 */
import type { ReactNode } from 'react';
import { FINISH_KEYS, TOON_KEYS, FEEDBACK_KEYS, SLIT_KEYS, GLOW_KEYS, PRINT_KEYS } from '../core/finishing';
import { SLIT_SHAPES, supportsSlitScan } from '../rendering/slitscan';
import { supportsFeedback } from '../rendering/feedback';
import { supportsGlow } from '../rendering/bloom';
import { supportsPrint } from '../rendering/print-screen';
import type { Layer, ParameterDefinition } from '../shared/types';
import { ChoiceParameter, Parameter } from './LayerControls';

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
  return <section className="control-section"><h3>Print screen</h3><p className="muted-text">Halftone dots, line screens and ordered dither, sized in pixels of a 1080-line frame. Loops close exactly.</p>
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
  </section>;
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
}

export function FinishSections({ layer, definitions, edit, animate, onStart, onEnd, extra, readOnly }: FinishProps) {
  const p = layer.params, mod = layer.modulations;
  const set = (key: string, n: number) => edit(l => ({ ...l, params: { ...l.params, [key]: n } }));
  /** One slider. Settings that choose among whole steps (step 1) have no wave. */
  const row = (d: ParameterDefinition, steps = false) => <Parameter key={d.key} definition={d} value={p[d.key] ?? d.default} animated={!!mod[d.key]} readOnly={readOnly?.(d) ?? false}
    onChange={n => set(d.key, n)} onAnimate={animate && !(steps && d.step === 1) ? () => animate(d.key) : undefined} extra={extra?.(d)} onStart={onStart} onEnd={onEnd} />;
  const choice = (label: string, options: string[], key: string) => <ChoiceParameter label={label} name={label} options={options} value={p[key] ?? 0} onChange={n => set(key, n)} />;
  const opacity: ParameterDefinition = { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: .01, default: 1, section: 'Material' };
  const echoOn = (p.echo ?? 0) > 0 || !!mod.echo;
  return <>
    <section className="control-section"><h3>Layer mix</h3>
      <Parameter definition={opacity} value={layer.opacity} animated={!!mod.opacity} readOnly={readOnly?.(opacity) ?? false} onChange={n => edit(l => ({ ...l, opacity: n }))} onAnimate={animate ? () => animate('opacity') : undefined} onStart={onStart} onEnd={onEnd} />
      <label className="stacked-label">Blending<select aria-label="Blending" value={layer.blend} onChange={e => edit(l => ({ ...l, blend: e.target.value as Layer['blend'] }))}><option value="normal">Normal</option><option value="screen">Screen</option><option value="multiply">Multiply</option><option value="add">Light add</option><option value="source">Colour from below</option></select></label></section>
    <section className="control-section"><h3>Color finish</h3>{definitions.filter(d => ['saturation', 'hue', 'exposure'].includes(d.key)).map(d => row(d))}</section>
    <section className="control-section"><h3>Tonal finishing</h3><p className="muted-text">Shape luminance and colour while preserving transparency.</p>
      {definitions.filter(d => FINISH_KEYS.includes(d.key) && !TOON_KEYS.includes(d.key) && !FEEDBACK_KEYS.includes(d.key) && !SLIT_KEYS.includes(d.key) && !GLOW_KEYS.includes(d.key) && !PRINT_KEYS.includes(d.key)).map(d => row(d))}</section>
    {supportsGlow(layer) && <section className="control-section"><h3>Glow</h3><p className="muted-text">Bright areas spill soft light. Loops close exactly; adds a few blur passes per glowing layer.</p>
      {definitions.filter(d => GLOW_KEYS.includes(d.key) && (d.key === 'glowMix' || (p.glowMix ?? 0) > 0 || !!mod.glowMix)).map(d => row(d, true))}</section>}
    {supportsPrint(layer) && <PrintScreenSection layer={layer} definitions={definitions} edit={edit} animate={animate} onStart={onStart} onEnd={onEnd} extra={extra} readOnly={readOnly} />}
    <section className="control-section"><h3>Flat colour &amp; outlines</h3><p className="muted-text">Hard palette bands and contour lines. For the cleanest edges, lower the source's Relief and Softness.</p>
      {definitions.filter(d => TOON_KEYS.includes(d.key) && (d.key === 'toonMix' || (p.toonMix ?? 0) > 0) && (d.key !== 'toonOutlineColor' || (p.toonOutline ?? 0) > 0)).map(d => row(d, true))}</section>
    {supportsSlitScan(layer) && <section className="control-section"><h3>Time displacement</h3><p className="muted-text">Parts of the frame show the source as it was some frames ago. Loops close exactly; each slice renders the source once more.</p>
      {definitions.filter(d => SLIT_KEYS.includes(d.key) && d.key !== 'slitShape' && (d.key === 'slitShift' || (p.slitShift ?? 0) !== 0 || !!mod.slitShift) && (d.key !== 'slitBlocks' || p.slitShape === 4)).map(d => row(d, true))}
      {((p.slitShift ?? 0) !== 0 || !!mod.slitShift) && <ChoiceParameter label="Delay map" name="Delay map" options={SLIT_SHAPES} value={p.slitShape ?? 0} onChange={n => set('slitShape', n)} />}</section>}
    {supportsFeedback(layer) && <section className="control-section"><h3>Feedback</h3><p className="muted-text">Each frame keeps a faded, moved echo of the last. Loops close exactly; exports warm up before the first frame.</p>
      {definitions.filter(d => FEEDBACK_KEYS.includes(d.key) && d.key !== 'echoBlend' && d.key !== 'echoStreakAxis' && (!['echoRound', 'echoSquare', 'echoEdge'].includes(d.key) || (p.echoFrame ?? 0) > 0 || (p.echoWindow ?? 0) > 0) && (d.key === 'echo' || (p.echo ?? 0) > 0 || !!mod.echo)).map(d => row(d))}
      {echoOn && choice('Echo blend', ['Mix', 'Behind source', 'Brighter'], 'echoBlend')}
      {echoOn && (p.echoStreak ?? 0) > 0 && choice('Streak direction', ['Radial', 'Box'], 'echoStreakAxis')}</section>}
  </>;
}
