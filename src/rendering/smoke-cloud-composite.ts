import { FINISH_PARAMETERS } from '../core/finishing';
import type { Layer } from '../shared/types';

/** Drawing one premultiplied layer over another: what the full compositor does for an untouched layer. */
export const plainOverFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uBelow, uSource;
void main() {
  vec4 top=texture2D(uSource,vUv), below=texture2D(uBelow,vUv);
  gl_FragColor=vec4(below.rgb*(1.-top.a)+top.rgb,top.a+below.a*(1.-top.a));
}`;

/** True when the full compositor would only draw this Smoke Cloud over what is beneath it. */
export function compositesPlainly(layer: Layer, tiling: boolean): boolean {
  const p = layer.params, t = layer.transform;
  return layer.kind === 'smokecloud' && !tiling && layer.opacity === 1 && layer.blend === 'normal' && layer.mask.kind === 'none'
    && t.x === 0 && t.y === 0 && t.scale === 1 && t.rotation === 0
    && (p.saturation ?? 1) === 1 && (p.hue ?? 0) === 0 && (p.exposure ?? 1) === 1 && !p.glow
    && FINISH_PARAMETERS.every(d => (p[d.key] ?? d.default) === d.default);
}
