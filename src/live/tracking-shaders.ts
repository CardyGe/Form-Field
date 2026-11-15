/** Shaders for movement tracking. GLSL ES 1.00, run through Passes.material. */
import { BOX_EDGE } from './maths';

/** The source fitted to 16:9 by cropping, mirrored when asked. */
export const cameraFragment = /* glsl */`
uniform sampler2D uImage; uniform float uMirror; uniform vec2 uCrop;
void main() {
  vec2 uv = vec2(mix(vUv.x, 1. - vUv.x, uMirror), vUv.y);
  gl_FragColor = vec4(texture2D(uImage, (uv - .5) * uCrop + .5).rgb, 1.);
}`;

/**
 * Movement between two camera frames, by local least squares on brightness
 * gradients (Lucas–Kanade) over a 5 × 5 window. rg: movement in uv per camera
 * frame. b: how much changed, 0..1. Everything is multiplied by the soft
 * interaction box, so outside the box is exactly zero.
 */
export const flowFragment = /* glsl */`
uniform sampler2D uNow, uBefore; uniform float uNoise, uSensitivity; uniform vec4 uBox;
const vec2 PX = vec2(1. / 640., 1. / 360.);
float lum(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
float now(vec2 p) { return lum(texture2D(uNow, p).rgb); }
float before(vec2 p) { return lum(texture2D(uBefore, p).rgb); }
float box(vec2 p) {
  return smoothstep(uBox.x, uBox.x + ${BOX_EDGE}, p.x) * (1. - smoothstep(uBox.y - ${BOX_EDGE}, uBox.y, p.x))
    * smoothstep(uBox.z, uBox.z + ${BOX_EDGE}, p.y) * (1. - smoothstep(uBox.w - ${BOX_EDGE}, uBox.w, p.y));
}
void main() {
  float a = 0., b = 0., c = 0., d = 0., e = 0., motion = 0.;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 p = vUv + vec2(float(x), float(y)) * PX * 2.;
    float gx = (now(p + vec2(PX.x, 0.)) - now(p - vec2(PX.x, 0.))) * .5;
    float gy = (now(p + vec2(0., PX.y)) - now(p - vec2(0., PX.y))) * .5;
    float gt = now(p) - before(p);
    gt = sign(gt) * max(0., abs(gt) - uNoise);
    a += gx * gx; b += gx * gy; c += gy * gy; d += gx * gt; e += gy * gt; motion += abs(gt);
  }
  float det = (a + .002) * (c + .002) - b * b;
  vec2 flow = vec2(-(c + .002) * d + b * e, b * d - (a + .002) * e) / max(det, 1e-6) * PX;
  flow = clamp(flow, vec2(-.025), vec2(.025));
  gl_FragColor = vec4(flow, clamp(motion * .4 * uSensitivity, 0., 1.), 1.) * box(vUv);
}`;

export const smoothFragment = /* glsl */`
uniform sampler2D uOld, uNew;
void main() { gl_FragColor = mix(texture2D(uOld, vUv), texture2D(uNew, vUv), .6); }`;

/** Operator setup view: the camera, dimmed, with movement drawn over it and the box outlined. */
export const trackingViewFragment = /* glsl */`
uniform sampler2D uCamera, uFlow; uniform vec4 uBox;
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.); }
void main() {
  vec3 camera = texture2D(uCamera, vUv).rgb;
  vec3 flow = texture2D(uFlow, vUv).rgb;
  vec3 c = camera * .55 + hue(atan(flow.y, flow.x) / 6.2831853) * flow.b;
  vec2 inside = step(uBox.xz, vUv) * step(vUv, uBox.yw);
  float within = inside.x * inside.y;
  vec2 edge = min(abs(vUv - uBox.xz), abs(vUv - uBox.yw));
  float line = within * (1. - step(.003, min(edge.x * 16. / 9., edge.y)));
  c = mix(c * mix(.35, 1., within), vec3(.2, 1., .45), line);
  gl_FragColor = vec4(c, 1.);
}`;
