import type { ReactNode } from 'react';
import { CRT_KEYS, DATABEND_KEYS, DROP_KEYS, JPEG_KEYS, VHS_KEYS } from '../core/finishing';
import { CRT_BEZELS, CRT_MASKS, DATABEND_AXES, DATABEND_MODES, DROP_FILLS, signalControlVisible } from '../rendering/signal';
import { ChoiceParameter, Parameter } from './LayerControls';
import type { WarpSectionProps } from './WarpSections';

/** Stepped choices. Outside the screen and Dropout fill are choices, not sliders. */
const CHOICES: Record<string, string[]> = {
  dropFill: DROP_FILLS,
  crtMask: CRT_MASKS,
  crtBezel: CRT_BEZELS,
  databendMode: DATABEND_MODES,
  databendAxis: DATABEND_AXES,
};

/** Only continuous controls can be animated: whole counts (step 1 or more, such as Block changes per loop) must stay whole to close the loop. */
export const signalAnimatable = (d: { step: number }) => d.step < 1;

function Section({ keys, layer, definitions, edit, animate, onStart, onEnd, extra, readOnly, children }: WarpSectionProps & { keys: string[]; children?: ReactNode }) {
  const set = (key: string, n: number) => edit(l => ({ ...l, params: { ...l.params, [key]: n } }));
  return <>
    {keys.filter(key => signalControlVisible(layer, key)).map(key => {
      const d = definitions.find(item => item.key === key);
      if (!d) return null;
      const value = layer.params[key] ?? d.default, options = CHOICES[key];
      if (options) return <ChoiceParameter key={key} label={d.label} name={d.label} options={options} value={value} disabled={readOnly?.(d) ?? false} onChange={n => set(key, n)} />;
      return <Parameter key={key} definition={d} value={value} animated={!!layer.modulations[key]} readOnly={readOnly?.(d) ?? false} onChange={n => set(key, n)} onAnimate={animate && signalAnimatable(d) ? () => animate(key) : undefined} extra={extra?.(d)} onStart={onStart} onEnd={onEnd} />;
    })}
    {children}
  </>;
}

export function VhsSection(props: WarpSectionProps) { return <Section {...props} keys={VHS_KEYS} />; }
export function DropoutSection(props: WarpSectionProps) { return <Section {...props} keys={DROP_KEYS} />; }
export function CrtSection(props: WarpSectionProps) { return <Section {...props} keys={CRT_KEYS} />; }
export function JpegSection(props: WarpSectionProps) { return <Section {...props} keys={JPEG_KEYS} />; }
export function DatabendSection(props: WarpSectionProps) { return <Section {...props} keys={DATABEND_KEYS} />; }
