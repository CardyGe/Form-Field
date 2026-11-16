/**
 * People recoloured through a palette, like a gradient map: their brightness picks a colour
 * from the palette's five bright entries, sorted dark to light, and their brightness then
 * shades it, so faces keep their shape. Shared by Smoke and, later, Dust and Melt.
 */
import * as THREE from 'three';
import { paletteRamp } from './colour';

export const recolourGLSL = /* glsl */`
uniform vec3 uRamp[5]; uniform float uRampShift;
vec3 rampAt(float p) {
  p = clamp(p, 0., 1.) * 4.;
  int i = int(min(floor(p), 3.));
  return mix(uRamp[i], uRamp[i + 1], smoothstep(.15, .85, p - float(i)));
}
// camera: the camera colour as stored (sRGB values). time drives the colour drift; uRampShift is Colour change.
vec3 recolour(vec3 camera, vec2 uv, float time) {
  float luma = dot(camera, vec3(.299, .587, .114));
  float l = pow(smoothstep(.04, .85, luma), .8);
  vec3 c = rampAt(l + .12 * sin(time * uRampShift * .4 + uv.x * 3. + uv.y * 2.));
  return c * (.25 + .75 * l);
}`;

/** Sets uRamp and uRampShift for this palette and Colour change. */
export function setRamp(uniforms: Record<string, THREE.IUniform>, palette: string[], shift: number): void {
  const ramp = paletteRamp(palette);
  if (!Array.isArray(uniforms.uRamp.value) || uniforms.uRamp.value.length !== 5) uniforms.uRamp.value = ramp.map(() => new THREE.Vector3());
  (uniforms.uRamp.value as THREE.Vector3[]).forEach((v, i) => v.set(...ramp[i]));
  uniforms.uRampShift.value = shift;
}
