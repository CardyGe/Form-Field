import type { Layer } from '../shared/types';
import { evaluateLayer } from '../core/timeline';

const TAU = Math.PI * 2;
export const SUPER8_HISTORY = 6;
const wrap = (value: number, period: number) => ((value % period) + period) % period;

/** A fixed film clock, independent of display/export FPS and render history. */
export function super8Clock(phase: number, duration: number, fps: number): { frame: number; frames: number; phase: number } {
  if (!Number.isFinite(phase) || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(fps) || fps < 1 || fps > 48) {
    throw new Error('Super 8 timing requires a finite phase, positive duration and a film rate between 1 and 48.');
  }
  const frames = Math.max(1, Math.round(duration * fps));
  // Stabilize exact frame boundaries after phase wrap and rational-rate conversion.
  const frame = Math.floor(wrap(phase, TAU) / TAU * frames + 1e-8) % frames;
  return { frame, frames, phase: frame * TAU / frames };
}

/** Continuous projector transport between held paint frames. Quantization removes
 * wrap roundoff, so a seek by a whole loop produces identical GPU uniforms. */
export function super8Transport(phase: number, duration: number, fps: number, advance: number, shutter: number, blades: number, reelLoops: number) {
  const clock = super8Clock(phase, duration, fps);
  const loop = Math.round(wrap(phase, TAU) / TAU * 1e10) / 1e10 % 1;
  const position = loop * clock.frames;
  const delta = position - clock.frame;
  const fraction = Math.abs(delta - Math.round(delta)) < 1e-5 ? 0 : Math.round(wrap(delta, 1) * 1e7) / 1e7 % 1;
  const smooth = (lo: number, hi: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
  };
  return {
    ...clock, fraction,
    pull: advance * (1 - smooth(0, .16, fraction)),
    light: 1 - shutter * smooth(.35, .85, Math.cos(TAU * fraction * blades)),
    roll: wrap(loop * reelLoops, 1), phase: loop * TAU,
    previousPhase: wrap(clock.frame - 1, clock.frames) * TAU / clock.frames,
  };
}

/** Reconstruct a bounded feedback trail, including historical Motion routes.
 * No persistent GPU state: seeking, stills, loops and resumed jobs agree.
 */
export function super8History(layer: Layer, phase: number, duration: number) {
  const clock = super8Clock(phase, duration, layer.params.filmFps);
  const spacing = layer.params.feedbackSpacing;
  return Array.from({ length: SUPER8_HISTORY }, (_, index) => {
    const frame = wrap(clock.frame - index * spacing, clock.frames);
    const samplePhase = frame * TAU / clock.frames;
    return { frame, phase: samplePhase, layer: evaluateLayer(layer, samplePhase) };
  });
}
