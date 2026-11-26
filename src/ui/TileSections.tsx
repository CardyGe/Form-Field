import type { ReactNode } from 'react';
import { CHAR_KEYS, LED_KEYS, TILE_KEYS } from '../core/finishing';
import { CHAR_SETS, GAP_FILLS, LED_SHAPES, TILE_STYLES, tileControlVisible } from '../rendering/tiles';
import { ChoiceParameter, Parameter } from './LayerControls';
import type { WarpSectionProps } from './WarpSections';

/** Stepped choices. Character ink and the swap count stay sliders. */
const CHOICES: Record<string, string[]> = {
  ledShape: LED_SHAPES,
  ledGaps: GAP_FILLS,
  charSet: CHAR_SETS.map(item => item.name),
  charColour: ['Layer colour', 'Palette ink'],
  charGaps: GAP_FILLS,
  tileStyle: TILE_STYLES,
  tileGaps: GAP_FILLS,
};

function Section({ keys, layer, definitions, edit, animate, onStart, onEnd, extra, readOnly, children }: WarpSectionProps & { keys: string[]; children?: ReactNode }) {
  const set = (key: string, n: number) => edit(l => ({ ...l, params: { ...l.params, [key]: n } }));
  return <>
    {keys.filter(key => tileControlVisible(layer, key)).map(key => {
      const d = definitions.find(item => item.key === key);
      if (!d) return null;
      const value = layer.params[key] ?? d.default, options = CHOICES[key];
      if (options) return <ChoiceParameter key={key} label={d.label} name={d.label} options={options} value={value} disabled={readOnly?.(d) ?? false} onChange={n => set(key, n)} />;
      return <Parameter key={key} definition={d} value={value} animated={!!layer.modulations[key]} readOnly={readOnly?.(d) ?? false} onChange={n => set(key, n)} onAnimate={animate && d.step !== 1 ? () => animate(key) : undefined} extra={extra?.(d)} onStart={onStart} onEnd={onEnd} />;
    })}
    {children}
  </>;
}

export function LedSection(props: WarpSectionProps) { return <Section {...props} keys={LED_KEYS} />; }
export function CharactersSection(props: WarpSectionProps) { return <Section {...props} keys={CHAR_KEYS} />; }
export function TilesSection(props: WarpSectionProps) { return <Section {...props} keys={TILE_KEYS} />; }
