import type { Layer, ParameterDefinition } from '../shared/types';
import { SPLIT_KEYS, GRADIENT_KEYS, GRADE_KEYS, KEY_KEYS } from '../core/finishing';
import { GRADIENT_PALETTES, SPLIT_ORDERS, SPLIT_SHAPES, balanceControlVisible, gradientControlVisible, keyControlVisible, splitControlVisible } from '../rendering/colour-lens';
import { ChoiceParameter, Parameter } from './LayerControls';

interface SectionProps {
  layer: Layer;
  definitions: ParameterDefinition[];
  edit: (change: (layer: Layer) => Layer) => void;
  animate: (key: string) => void;
  onStart: () => void;
  onEnd: () => void;
}

const SWATCHES = ['Colour 1', 'Colour 2', 'Colour 3', 'Colour 4', 'Colour 5', 'Colour 6'];
const OFF_ON = ['Off', 'On'];

/** Stepped choices; their option lists start at `base` (the swatch choices start at 1). */
const CHOICES: Record<string, { options: string[]; base?: number }> = {
  splitShape: { options: SPLIT_SHAPES },
  splitOrder: { options: SPLIT_ORDERS },
  gradPalette: { options: GRADIENT_PALETTES.map(p => p.name) },
  gradKeep: { options: OFF_ON },
  keyMode: { options: ['Brightness', 'Hue'] },
  keyInvert: { options: OFF_ON },
  gradeShadowColour: { options: SWATCHES, base: 1 },
  gradeHighlightColour: { options: SWATCHES, base: 1 },
};

function Section({ title, copy, keys, visible, layer, definitions, edit, animate, onStart, onEnd }: SectionProps & { title: string; copy: string; keys: string[]; visible: (layer: Layer, key: string) => boolean }) {
  const set = (key: string, n: number) => edit(l => ({ ...l, params: { ...l.params, [key]: n } }));
  return <section className="control-section"><h3>{title}</h3><p className="muted-text">{copy}</p>
    {keys.filter(key => visible(layer, key)).map(key => {
      const d = definitions.find(item => item.key === key);
      if (!d) return null;
      const value = layer.params[key] ?? d.default, choice = CHOICES[key];
      if (choice) {
        const base = choice.base ?? 0;
        return <ChoiceParameter key={key} label={d.label} name={d.label} options={choice.options} value={value - base} onChange={n => set(key, n + base)} />;
      }
      return <Parameter key={key} definition={d} value={value} animated={!!layer.modulations[key]} onChange={n => set(key, n)} onAnimate={d.step === 1 ? undefined : () => animate(key)} onStart={onStart} onEnd={onEnd} />;
    })}
  </section>;
}

export function ColourSplitSection(props: SectionProps) {
  return <Section {...props} title="Colour split" copy="Pulls colour apart along edges, lenses or waves. Loops close exactly." keys={SPLIT_KEYS} visible={splitControlVisible} />;
}
export function GradientMapSection(props: SectionProps) {
  return <Section {...props} title="Gradient map" copy="Recolours the layer by brightness using a palette." keys={GRADIENT_KEYS} visible={gradientControlVisible} />;
}
export function ColourBalanceSection(props: SectionProps) {
  return <Section {...props} title="Colour balance" copy="Warms, cools and tints the layer, with separate shadow and highlight colour." keys={GRADE_KEYS} visible={balanceControlVisible} />;
}
export function KeySection(props: SectionProps) {
  return <Section {...props} title="Key" copy="Cuts the layer out by brightness or colour." keys={KEY_KEYS} visible={keyControlVisible} />;
}
