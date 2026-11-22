/** Morphogen's controls, built from its parameter table. Choices are dropdowns; everything continuous can follow sound or MIDI. */
import type { LiveSettings } from '../live/settings';
import { MORPH_CONTROLS, type MorphControl, type MorphKey, type MorphSection } from '../morphogen/params';
import { MORPH_PALETTES } from '../morphogen/palettes';
import { MORPH_LOOKS } from '../morphogen/looks';
import { Slider, type ReactFor } from './LiveLookControls';

const CHOICES: Partial<Record<MorphKey, readonly string[]>> = {
  fieldType: ['Radial', 'Spiral', 'Swirl', 'Parallel', 'Two poles', 'Organic curl'],
  formType: ['None', 'Disc', 'Ring', 'Soft blob'],
  palette: MORPH_PALETTES.map(p => p.name),
  quality: ['Fast', 'Balanced', 'Fine'],
};
const SECTIONS: MorphSection[] = ['Macros', 'Pattern', 'Flow', 'Forms', 'Motion', 'Relief', 'Material', 'Iridescence', 'Colour', 'Finish', 'System'];
const OPEN: MorphSection[] = ['Macros'];

export function MorphogenPanel({ s, update, reactFor }: { s: LiveSettings; update: (change: (value: LiveSettings) => LiveSettings) => void; reactFor: ReactFor }) {
  const set = (key: MorphKey, value: number) => update(v => ({ ...v, morphogen: { ...v.morphogen, [key]: value } }));
  const cue = s.morphogenCue;
  const move = (change: Partial<LiveSettings['morphogenCue']>) => update(v => ({ ...v, morphogenCue: { ...v.morphogenCue, ...change } }));
  const chooseLook = (index: number) => update(v => ({ ...v, morphogen: { ...v.morphogen, ...MORPH_LOOKS[index].params }, morphogenCue: { ...v.morphogenCue, look: index, cue: v.morphogenCue.cue + 1 } }));
  const control = (c: MorphControl) => {
    const choices = CHOICES[c.key];
    if (choices) return <label key={c.key} className="stacked-label" title={c.description}>{c.label}<select aria-label={c.label} value={s.morphogen[c.key]} onChange={e => set(c.key, Number(e.target.value))}>
      {choices.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>;
    return <Slider key={c.key} label={c.label} value={s.morphogen[c.key]} min={c.min} max={c.max} step={c.step} onChange={value => set(c.key, value)}
      react={c.step < 1 ? reactFor(`live.morphogen.${c.key}`) : undefined} />;
  };
  return <>
    <p className="live-note">A living stripe pattern that grows by itself. Sound and movement in the room can push it.</p>
    <label className="stacked-label">Morph to look<select aria-label="Morph to look" value={cue.look} onChange={e => chooseLook(Number(e.target.value))}>
      {MORPH_LOOKS.map((look, i) => <option key={look.id} value={i}>{look.name}</option>)}</select></label>
    <Slider label="Morph time" value={cue.seconds} min={0} max={32} step={.5} unit=" s" onChange={seconds => move({ seconds })} />
    <div className="live-starts" role="group" aria-label="Performance moves">
      <button className={`text-button ${cue.hold ? 'on' : ''}`} aria-pressed={cue.hold} title="Stops growth while light and colour keep moving" onClick={() => move({ hold: !cue.hold })}>Hold</button>
      <button className="text-button" title="A nearby variation of this look" onClick={() => move({ mutate: cue.mutate + 1 })}>Mutate</button>
      <button className="text-button" title="Back to before the last Mutate" onClick={() => move({ undo: cue.undo + 1 })}>Undo</button>
      <button className="text-button" title="A burst of disorder that heals back into a pattern" onClick={() => move({ scramble: cue.scramble + 1 })}>Scramble</button>
    </div>
    {SECTIONS.map(section => <details key={section} open={OPEN.includes(section)}><summary>{section}</summary>{MORPH_CONTROLS.filter(c => c.section === section).map(control)}</details>)}
  </>;
}
