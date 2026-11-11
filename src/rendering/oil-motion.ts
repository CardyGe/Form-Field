import type { Layer } from '../shared/types';
import { evaluateLayer } from '../core/timeline';

const TAU = Math.PI * 2;
export const OIL_WAKE_SAMPLES = 10;
const wrap = (phase: number) => ((phase % TAU) + TAU) % TAU;

/** Closed transforms in units of canvas height. No accumulated state or wall clock. */
export function oilKinematics(layer: Layer, phase: number) {
  const p = layer.params;
  const angle = wrap(phase) * p.cycles;
  const seed = (p.seed % 997) / 997 * TAU;
  const travel = p.travel;
  const slideX = travel * (.65 * Math.sin(angle + seed) + .18 * Math.sin(2 * angle - .4));
  const slideY = travel * (.55 * Math.cos(angle + .7 + seed) + .12 * Math.sin(3 * angle + seed));
  const rotation = p.relativeRotation * Math.sin(angle + seed + .5);
  const x = .025 + travel * .24 * Math.sin(angle - .4);
  const y = travel * .18 * Math.cos(2 * angle + .6);
  const lift = p.lift * Math.pow(.5 + .5 * Math.sin(angle - .8), 4);
  return { slideX, slideY, rotation, x, y, radius: p.lensSize,
    aspect: p.lensAspect, angle: -.12 + rotation * .35, presence: 1 - lift };
}

export function oilMotion(original: Layer, phase: number) {
  const wrapped = wrap(phase);
  const current = evaluateLayer(original, wrapped);
  const state = oilKinematics(current, wrapped);
  // Compute relative velocity in the sheet's coordinates, including its rotation.
  const inSheet = (at: number) => {
    const k = oilKinematics(evaluateLayer(original, wrap(at)), at);
    const c = Math.cos(k.rotation), s = Math.sin(k.rotation);
    const x = k.x - k.slideX, y = k.y - k.slideY;
    return [c * x + s * y, -s * x + c * y];
  };
  const before = inSheet(wrapped - .001), after = inSheet(wrapped + .001);
  const vx = (after[0] - before[0]) / .002, vy = (after[1] - before[1]) / .002;
  const speed = Math.hypot(vx, vy);
  const direction = speed > 1e-8 ? [vx / speed, vy / speed] : [1, 0];
  const wake = [];
  for (let i = 0; i < OIL_WAKE_SAMPLES; i++) {
    // Evaluate modulations at the historical phase, not at the current frame.
    const at = wrap(wrapped - i * (.065 + .09 * current.params.drag) / current.params.cycles);
    const historical = oilKinematics(evaluateLayer(original, at), at);
    // A footprint stays in its material sheet as the sheet slides away.
    const c = Math.cos(historical.rotation), s = Math.sin(historical.rotation);
    const dx = historical.x - historical.slideX, dy = historical.y - historical.slideY;
    wake.push([c * dx + s * dy, -s * dx + c * dy, historical.radius,
      Math.exp(-i * .22) * (i === 0 ? 1 : current.params.drag)]);
  }
  return { ...state, direction, strain: current.params.drag * Math.min(speed * 2, 1), wake };
}
