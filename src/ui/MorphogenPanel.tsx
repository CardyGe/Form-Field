/** Morphogen's controls, built from its parameter table. Choices are dropdowns; everything continuous can follow sound or MIDI. */
import type { LiveSettings } from '../live/settings';
import { MORPH_CONTROLS, type MorphControl, type MorphKey, type MorphSection } from '../morphogen/params';
import { MORPH_PALETTES } from '../morphogen/palettes';
import { Slider, type ReactFor } from './LiveLookControls';

const CHOICES: Partial<Record<MorphKey, readonly string[]>> = {
  fieldType: ['Radial', 'Spiral', 'Swirl', 'Parallel', 'Two poles', 'Organic curl'],
  formType: ['None', 'Disc', 'Ring', 'Soft blob'],
  palette: MORPH_PALETTES.map(p => p.name),
  quality: ['Fast', 'Balanced', 'Fine'],
};
const SECTIONS: MorphSection[] = ['Pattern', 'Flow', 'Forms', 'Motion', 'Relief', 'Material', 'Iridescence', 'Colour', 'Finish', 'System'];
const OPEN: MorphSection[] = ['Pattern', 'Motion'];

export function MorphogenPanel({ s, update, reactFor }: { s: LiveSettings; update: (change: (value: LiveSettings) => LiveSettings) => void; reactFor: ReactFor }) {
  const set = (key: MorphKey, value: number) => update(v => ({ ...v, morphogen: { ...v.morphogen, [key]: value } }));
  const control = (c: MorphControl) => {
    const choices = CHOICES[c.key];
    if (choices) return <label key={c.key} className="stacked-label" title={c.description}>{c.label}<select aria-label={c.label} value={s.morphogen[c.key]} onChange={e => set(c.key, Number(e.target.value))}>
      {choices.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>;
    return <Slider key={c.key} label={c.label} value={s.morphogen[c.key]} min={c.min} max={c.max} step={c.step} onChange={value => set(c.key, value)}
      react={c.step < 1 ? reactFor(`live.morphogen.${c.key}`) : undefined} />;
  };
  return <>
    <p className="live-note">A living stripe pattern that grows by itself. Sound and movement in the room can push it.</p>
    {SECTIONS.map(section => <details key={section} open={OPEN.includes(section)}><summary>{section}</summary>{MORPH_CONTROLS.filter(c => c.section === section).map(control)}</details>)}
  </>;
}
