import type { ReactNode } from 'react';
import type { Layer, ParameterDefinition } from '../shared/types';
import { LIQUID_KEYS, LUMA_WARP_KEYS, MIRROR_KEYS, POLAR_KEYS, WARP_KEYS } from '../core/finishing';
import { LIQUID_STYLES, LUMA_CHANNELS, LUMA_MODES, LUMA_SOURCES, MIRROR_MODES, POLAR_MODES, WARP_FIELDS, warpControlVisible } from '../rendering/warp';
import { ChoiceParameter, Parameter } from './LayerControls';

export interface WarpSectionProps {
  layer: Layer;
  definitions: ParameterDefinition[];
  edit: (change: (layer: Layer) => Layer) => void;
  /** Studio jumps to the Motion tab; Map leaves this out and shows its own control through `extra`. */
  animate?: (key: string) => void;
  onStart: () => void;
  onEnd: () => void;
  extra?: (d: ParameterDefinition) => ReactNode;
  readOnly?: (d: ParameterDefinition) => boolean;
  /** Whether a visible layer sits under this one. Left out where that is not known. */
  hasLayerBelow?: boolean;
}

/** Stepped choices. Numeric steppers such as Flow steps and Warp points stay sliders. */
const CHOICES: Record<string, string[]> = {
  bendField: WARP_FIELDS,
  liquidStyle: LIQUID_STYLES,
  lumaWarpSource: LUMA_SOURCES,
  lumaWarpChannel: LUMA_CHANNELS,
  lumaWarpMode: LUMA_MODES,
  polarMode: POLAR_MODES,
  mirrorMode: MIRROR_MODES,
};

function Section({ keys, layer, definitions, edit, animate, onStart, onEnd, extra, readOnly, children }: WarpSectionProps & { keys: string[]; children?: ReactNode }) {
  const set = (key: string, n: number) => edit(l => ({ ...l, params: { ...l.params, [key]: n } }));
  return <>
    {keys.filter(key => warpControlVisible(layer, key)).map(key => {
      const d = definitions.find(item => item.key === key);
      if (!d) return null;
      const value = layer.params[key] ?? d.default, options = CHOICES[key];
      if (options) return <ChoiceParameter key={key} label={d.label} name={d.label} options={options} value={value} disabled={readOnly?.(d) ?? false} onChange={n => set(key, n)} />;
      return <Parameter key={key} definition={d} value={value} animated={!!layer.modulations[key]} readOnly={readOnly?.(d) ?? false} onChange={n => set(key, n)} onAnimate={animate && d.step !== 1 ? () => animate(key) : undefined} extra={extra?.(d)} onStart={onStart} onEnd={onEnd} />;
    })}
    {children}
  </>;
}

export function WarpSection(props: WarpSectionProps) { return <Section {...props} keys={WARP_KEYS} />; }
export function LiquidSection(props: WarpSectionProps) { return <Section {...props} keys={LIQUID_KEYS} />; }
export function PolarSection(props: WarpSectionProps) { return <Section {...props} keys={POLAR_KEYS} />; }
export function MirrorSection(props: WarpSectionProps) { return <Section {...props} keys={MIRROR_KEYS} />; }
export function LumaWarpSection(props: WarpSectionProps) {
  const { layer, hasLayerBelow } = props;
  const alone = hasLayerBelow === false && Math.round(layer.params.lumaWarpSource ?? 0) === 1 && ((layer.params.lumaWarpAmount ?? 0) > 0 || !!layer.modulations.lumaWarpAmount);
  return <Section {...props} keys={LUMA_WARP_KEYS}>{alone && <p className="muted-text">There is no layer below this one, so nothing moves.</p>}</Section>;
}
