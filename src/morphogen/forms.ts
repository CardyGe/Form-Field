import type { MorphParams } from './params';

/** Where the form is now. Two unrelated slow waves make a wander that never visibly repeats and stays in the picture. */
export function formAt(params: MorphParams, time: number): { x: number; y: number; radius: number; type: number } {
  const reach = params.orbit * .32;
  const x = params.formX + reach * (Math.sin(time * .19) * .7 + Math.sin(time * .083 + 1.3) * .3);
  const y = params.formY + reach * (Math.cos(time * .157) * .7 + Math.sin(time * .067 + 4.1) * .3);
  return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), radius: params.formSize, type: params.formType };
}
