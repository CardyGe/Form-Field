/**
 * Kaleidoscope: folds a picture through mirror symmetry.
 *
 * The fold is the one in src/core/symmetry.ts (tested there): translate to the
 * nearest lattice point, then fold by the point group D_k. It carries the
 * fold's linear part M, a rotation or reflection, so the texture footprint at
 * the folded point is M times the screen derivative of the unfolded point.
 * The unfolded point is smooth, so its derivatives are too, and mip selection
 * has no spike along fold lines.
 *
 * Inputs: a built-in line pattern, an imported image, or the layers below.
 * Images and the layers below are sampled with mirrored repeat, which is
 * continuous, so reaching outside the picture never adds a seam.
 * Output is associated (premultiplied) linear colour, like every source.
 */
import * as THREE from 'three';
import { fullscreenVertex } from './shaders';
import { sourceViewGLSL } from './source-view';
import type { Layer } from '../shared/types';

const TAU = Math.PI * 2;

export const kaleidoscopeFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
${sourceViewGLSL}
uniform sampler2D uInput;
uniform float uInputKind;          // 0 built-in pattern, 1 texture, -1 nothing to show
uniform float uPremultiply;        // 1 for straight-alpha inputs (images)
uniform mat3 uInside;              // folded point -> input uv
uniform float uAspect, uGroup, uSegments, uCell, uCellAspect, uZoom, uAngle;
uniform vec3 uPalette[6];
uniform float uDensity, uLineWidth, uMotifScale, uMotifPhase;
const float PI = 3.14159265359;
const float SQRT3 = 1.7320508076;

mat2 gFold;

// D_n about the origin, mirrors at angles 0 and PI/n. Result in the wedge [0, PI/n].
vec2 dihedral(vec2 p, float n) {
  float wedge = PI / n;
  float angle = atan(p.y, p.x);
  float turn = -2. * wedge * floor(angle / (2. * wedge));
  float c = cos(turn), s = sin(turn);
  mat2 m = mat2(c, s, -s, c);
  if (angle + turn > wedge) {
    float c2 = cos(2. * wedge), s2 = sin(2. * wedge);
    m = mat2(c2, s2, s2, -c2) * m;
  }
  gFold = m * gFold;
  return m * p;
}

vec2 reduceRect(vec2 p, vec2 period) { return p - period * floor(p / period + .5); }

// Nearest point of the hexagonal lattice a1 = s(sqrt3/2, 1/2), a2 = s(0, 1), subtracted.
vec2 reduceHex(vec2 p, float s) {
  float u = p.x / (s * SQRT3 * .5);
  float v = (p.y - u * s * .5) / s;
  vec2 base = floor(vec2(u, v));
  vec2 best = p; float distance = 1e30;
  for (int i = 0; i < 4; i++) {
    vec2 ab = base + vec2(float(i - 2 * (i / 2)), float(i / 2));
    vec2 d = p - vec2(ab.x * s * SQRT3 * .5, ab.x * s * .5 + ab.y * s);
    float dd = dot(d, d);
    if (dd < distance) { distance = dd; best = d; }
  }
  return best;
}

vec2 foldPoint(vec2 p) {
  gFold = mat2(1.);
  if (uGroup < .5) return dihedral(p, uSegments);
  if (uGroup < 1.5) return dihedral(reduceRect(p, 2. * uCell * vec2(uCellAspect, 1.)), 2.);
  if (uGroup < 2.5) return dihedral(reduceHex(p, uCell * SQRT3), 3.);
  if (uGroup < 3.5) return dihedral(reduceRect(p, vec2(2. * uCell)), 4.);
  return dihedral(reduceHex(p, uCell * SQRT3), 6.);
}

// Coverage of the stripes fract(t) < duty over the footprint [t - w/2, t + w/2]: an exact box filter.
float stripeIntegral(float t, float duty) { return floor(t) * duty + min(fract(t), duty); }
float stripes(float t, float duty, float w) {
  if (w < 1e-5) return step(fract(t), duty);
  return clamp((stripeIntegral(t + w * .5, duty) - stripeIntegral(t - w * .5, duty)) / w, 0., 1.);
}

// Line field: parallel lines across the folded cell, each line a palette colour, on palette colour 6.
vec4 lineField(vec2 q, float footprint) {
  vec2 direction = vec2(.9387, .3448);
  float t = dot(q, direction) * uDensity / uMotifScale - uMotifPhase;
  float coverage = stripes(t, uLineWidth, footprint * uDensity / uMotifScale);
  int index = int(mod(floor(t), 5.));
  vec3 ink = uPalette[0];
  for (int i = 1; i < 5; i++) if (i == index) ink = uPalette[i];
  return vec4(mix(uPalette[5], ink, coverage), 1.);
}

void main() {
  vec2 p = (sourceUV(vUv) - .5) * vec2(uAspect, 1.);
  float c = cos(uAngle), s = sin(uAngle);
  p = mat2(c, -s, s, c) * p / uZoom;
  // The unfolded point is smooth, so these derivatives are exact everywhere.
  vec2 dx = dFdx(p), dy = dFdy(p);
  vec2 q = foldPoint(p);
  if (uInputKind < -.5) { gl_FragColor = vec4(0.); return; }
  if (uInputKind < .5) { gl_FragColor = lineField(q, max(length(dx), length(dy))); return; }
  vec2 uv = (uInside * vec3(q, 1.)).xy;
  mat2 toUV = mat2(uInside) * gFold;
  vec4 color = textureGrad(uInput, uv, toUV * dx, toUV * dy);
  gl_FragColor = uPremultiply > .5 ? vec4(color.rgb * color.a, color.a) : color;
}
`;

const copyFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
void main() { gl_FragColor = texture2D(uImage, vUv); }
`;

/** Settings the renderer reads from a layer, with the fallbacks it uses when a value is missing. */
const value = (layer: Layer, key: string, fallback: number) => Number.isFinite(layer.params[key]) ? layer.params[key] : fallback;

/** Uniform values for one frame; separate from GL so they can be tested. */
export function kaleidoscopeSettings(layer: Layer, phase: number, inputAspect: number): {
  group: number; segments: number; cell: number; cellAspect: number; zoom: number; angle: number;
  density: number; lineWidth: number; motifScale: number; motifPhase: number; inside: THREE.Matrix3;
} {
  const cycles = Math.max(1, Math.round(value(layer, 'cycles', 1)));
  const local = phase * cycles;
  const group = Math.round(value(layer, 'group', 0)), cell = value(layer, 'cell', .25);
  // Whole turns per cycle and a circular drift, so the loop closes exactly.
  const angle = value(layer, 'angle', 0) + Math.round(value(layer, 'spin', 0)) * local;
  const insideAngle = value(layer, 'insideAngle', 0) + Math.round(value(layer, 'insideTurns', 0)) * local;
  const scale = value(layer, 'insideScale', 1), drift = value(layer, 'drift', .2) * .25;
  const ox = value(layer, 'insideX', 0) * .5 + drift * Math.cos(local), oy = value(layer, 'insideY', 0) * .5 + drift * Math.sin(local);
  // uv = 0.5 + A·(R(-insideAngle)·q / scale + offset), A = diag(1/inputAspect, 1).
  const c = Math.cos(insideAngle), s = Math.sin(insideAngle), ax = 1 / inputAspect;
  const inside = new THREE.Matrix3().set(
    ax * c / scale, ax * s / scale, .5 + ax * ox,
    -s / scale, c / scale, .5 + oy,
    0, 0, 1);
  return {
    group, segments: Math.round(value(layer, 'segments', 6)), cell, cellAspect: value(layer, 'cellAspect', 1),
    zoom: value(layer, 'zoom', 1), angle,
    density: value(layer, 'density', 3), lineWidth: value(layer, 'lineWidth', .5),
    motifScale: group === 0 ? .5 : cell, motifPhase: local / TAU, inside,
  };
}

/** A texture input is either straight alpha (an image) or already premultiplied (the layers below). */
export type KaleidoscopeInput = { kind: 'motif' } | { kind: 'texture'; texture: THREE.Texture; aspect: number; straight: boolean } | { kind: 'none' };

export class KaleidoscopeSource {
  readonly material: THREE.ShaderMaterial;
  private readonly copy: THREE.ShaderMaterial;
  /** A mipmapped, mirrored-repeat copy of the layers below, made only while a layer reads them. */
  private below: THREE.WebGLRenderTarget | null = null;

  constructor(viewUniforms: Record<string, THREE.IUniform>, palette: readonly string[]) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex, fragmentShader: kaleidoscopeFragment,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
      uniforms: {
        ...viewUniforms,
        uInput: { value: null }, uInputKind: { value: 0 }, uPremultiply: { value: 0 }, uInside: { value: new THREE.Matrix3() },
        uAspect: { value: 1 }, uGroup: { value: 0 }, uSegments: { value: 6 }, uCell: { value: .25 }, uCellAspect: { value: 1 },
        uZoom: { value: 1 }, uAngle: { value: 0 },
        uPalette: { value: palette.map(hex => new THREE.Color(hex)) },
        uDensity: { value: 3 }, uLineWidth: { value: .5 }, uMotifScale: { value: .5 }, uMotifPhase: { value: 0 },
      },
    });
    this.copy = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex, fragmentShader: copyFragment, uniforms: { uImage: { value: null } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
  }

  /**
   * The layers below as an input: copied once into a mipmapped target so a
   * minified fold samples a filtered picture rather than aliasing.
   */
  belowInput(texture: THREE.Texture, width: number, height: number, draw: (m: THREE.ShaderMaterial, t: THREE.WebGLRenderTarget) => void): KaleidoscopeInput {
    if (!this.below) {
      this.below = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
        wrapS: THREE.MirroredRepeatWrapping, wrapT: THREE.MirroredRepeatWrapping, anisotropy: 8,
      });
      this.below.texture.colorSpace = THREE.LinearSRGBColorSpace;
    } else if (this.below.width !== width || this.below.height !== height) this.below.setSize(width, height);
    this.copy.uniforms.uImage.value = texture;
    draw(this.copy, this.below);
    return { kind: 'texture', texture: this.below.texture, aspect: width / height, straight: false };
  }

  /** Sets every uniform for this frame. The caller draws `material`. */
  bind(layer: Layer, phase: number, aspect: number, input: KaleidoscopeInput): void {
    const u = this.material.uniforms;
    const settings = kaleidoscopeSettings(layer, phase, input.kind === 'texture' ? input.aspect : 1);
    u.uInputKind.value = input.kind === 'motif' ? 0 : input.kind === 'texture' ? 1 : -1;
    u.uInput.value = input.kind === 'texture' ? input.texture : null;
    u.uPremultiply.value = input.kind === 'texture' && input.straight ? 1 : 0;
    (u.uInside.value as THREE.Matrix3).copy(settings.inside);
    u.uAspect.value = aspect;
    u.uGroup.value = settings.group; u.uSegments.value = settings.segments;
    u.uCell.value = settings.cell; u.uCellAspect.value = settings.cellAspect;
    u.uZoom.value = settings.zoom; u.uAngle.value = settings.angle;
    u.uDensity.value = settings.density; u.uLineWidth.value = settings.lineWidth;
    u.uMotifScale.value = settings.motifScale; u.uMotifPhase.value = settings.motifPhase;
    const colors = u.uPalette.value as THREE.Color[];
    for (let i = 0; i < 6; i++) colors[i].set(layer.palette[i] ?? '#000000');
  }

  /** Lets the layers-below copy go when no visible Kaleidoscope reads it. */
  releaseBelow(): void { this.below?.dispose(); this.below = null; }

  dispose(): void { this.releaseBelow(); this.material.dispose(); this.copy.dispose(); }
}
