import { Matrix3 } from 'three';
import type { Layer } from '../shared/types';

/** Screen UV -> unbounded layer UV. Source generators see the real view rather
 * than a cropped screenshot which the compositor would have to scale/repeat. */
export function sourceViewMatrix(transform: Layer['transform'], aspect: number, out = new Matrix3()): Matrix3 {
  const c=Math.cos(transform.rotation),s=Math.sin(transform.rotation),scale=transform.scale;
  const a=c/scale,b=(-s/(scale*aspect))||0,d=s*aspect/scale,e=c/scale;
  return out.set(a,b,.5-a*(.5+transform.x)+b*(transform.y-.5),
    d,e,.5-d*(.5+transform.x)+e*(transform.y-.5),0,0,1);
}

/** How far an image spans its layer box on each axis. Contain leaves one axis under 1 and Cover takes one past it. */
export function imageFit(image: NonNullable<Layer['image']>, aspect: number): [number, number] {
  const imageAspect = image.width / image.height;
  let x = 1, y = 1;
  if (image.fit === 'contain') {
    if (imageAspect > aspect) y = aspect / imageAspect; else x = imageAspect / aspect;
  } else {
    if (imageAspect > aspect) x = imageAspect / aspect; else y = aspect / imageAspect;
  }
  return [x, y];
}

export const sourceViewGLSL = /* glsl */`
uniform mat3 uView, uViewInverse;
uniform float uViewScale;
vec2 sourceUV(vec2 uv) { return (uView*vec3(uv,1.)).xy; }
vec2 sourceScreenUV(vec2 uv) { return (uViewInverse*vec3(uv,1.)).xy; }
`;
