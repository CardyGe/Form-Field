/**
 * A grid fluid solver on the GPU, after Pavel Dobryakov's WebGL Fluid Simulation
 * (https://github.com/PavelDoGreat/WebGL-Fluid-Simulation, MIT licence, Copyright (c) 2017
 * Pavel Dobryakov). The pass structure follows his; the code is written for this renderer.
 *
 * Velocity is in grid cells per second. Each step: curl → vorticity confinement and
 * buoyancy → divergence → pressure (Jacobi) → gradient subtract → advect velocity → advect dye.
 */
import * as THREE from 'three';
import type { Pair, Passes } from './passes';

const advect = /* glsl */`
uniform sampler2D uVelocity, uSource; uniform vec2 uGridTexel; uniform float uStep, uKeep;
void main() {
  vec2 from = vUv - uStep * texture2D(uVelocity, vUv).xy * uGridTexel;
  gl_FragColor = texture2D(uSource, from) * uKeep;
}`;
const curl = /* glsl */`
uniform sampler2D uVelocity; uniform vec2 uTexel;
void main() {
  float l = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.)).y, r = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.)).y;
  float b = texture2D(uVelocity, vUv - vec2(0., uTexel.y)).x, t = texture2D(uVelocity, vUv + vec2(0., uTexel.y)).x;
  gl_FragColor = vec4(.5 * ((r - l) - (t - b)), 0., 0., 1.);
}`;
const vorticity = /* glsl */`
uniform sampler2D uVelocity, uCurl, uDye; uniform vec2 uTexel; uniform float uCurlAmount, uStep, uBuoyancy;
void main() {
  float l = texture2D(uCurl, vUv - vec2(uTexel.x, 0.)).x, r = texture2D(uCurl, vUv + vec2(uTexel.x, 0.)).x;
  float b = texture2D(uCurl, vUv - vec2(0., uTexel.y)).x, t = texture2D(uCurl, vUv + vec2(0., uTexel.y)).x;
  float c = texture2D(uCurl, vUv).x;
  vec2 force = .5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
  force /= length(force) + 1e-4;
  force *= uCurlAmount * c; force.y *= -1.;
  vec2 v = texture2D(uVelocity, vUv).xy + force * uStep;
  // Smoke rises in proportion to how dense it is.
  v.y += uBuoyancy * dot(texture2D(uDye, vUv).rgb, vec3(.2126, .7152, .0722)) * uStep;
  gl_FragColor = vec4(clamp(v, vec2(-1000.), vec2(1000.)), 0., 1.);
}`;
const divergence = /* glsl */`
uniform sampler2D uVelocity; uniform vec2 uTexel;
void main() {
  vec2 c = texture2D(uVelocity, vUv).xy;
  float l = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.)).x, r = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.)).x;
  float b = texture2D(uVelocity, vUv - vec2(0., uTexel.y)).y, t = texture2D(uVelocity, vUv + vec2(0., uTexel.y)).y;
  // Solid walls at the edges of the picture.
  if (vUv.x - uTexel.x < 0.) l = -c.x; if (vUv.x + uTexel.x > 1.) r = -c.x;
  if (vUv.y - uTexel.y < 0.) b = -c.y; if (vUv.y + uTexel.y > 1.) t = -c.y;
  gl_FragColor = vec4(.5 * (r - l + t - b), 0., 0., 1.);
}`;
const scale = /* glsl */`uniform sampler2D uSource; uniform float uAmount; void main() { gl_FragColor = texture2D(uSource, vUv) * uAmount; }`;
const pressure = /* glsl */`
uniform sampler2D uPressure, uDivergence; uniform vec2 uTexel;
void main() {
  float l = texture2D(uPressure, vUv - vec2(uTexel.x, 0.)).x, r = texture2D(uPressure, vUv + vec2(uTexel.x, 0.)).x;
  float b = texture2D(uPressure, vUv - vec2(0., uTexel.y)).x, t = texture2D(uPressure, vUv + vec2(0., uTexel.y)).x;
  gl_FragColor = vec4((l + r + b + t - texture2D(uDivergence, vUv).x) * .25, 0., 0., 1.);
}`;
const gradient = /* glsl */`
uniform sampler2D uPressure, uVelocity; uniform vec2 uTexel;
void main() {
  float l = texture2D(uPressure, vUv - vec2(uTexel.x, 0.)).x, r = texture2D(uPressure, vUv + vec2(uTexel.x, 0.)).x;
  float b = texture2D(uPressure, vUv - vec2(0., uTexel.y)).x, t = texture2D(uPressure, vUv + vec2(0., uTexel.y)).x;
  gl_FragColor = vec4(texture2D(uVelocity, vUv).xy - vec2(r - l, t - b), 0., 1.);
}`;
const zero = /* glsl */`void main() { gl_FragColor = vec4(0.); }`;

/** What is left after `seconds` of something that keeps 5% after `life` seconds. */
const keep = (seconds: number, life: number) => Math.exp(-3 * seconds / Math.max(1e-3, life));

export class Fluid {
  private readonly velocityPair: Pair;
  private readonly dyePair: Pair;
  private readonly pressurePair: Pair;
  private readonly curlTarget: THREE.WebGLRenderTarget;
  private readonly divergenceTarget: THREE.WebGLRenderTarget;
  private readonly m: Record<'advect' | 'curl' | 'vorticity' | 'divergence' | 'scale' | 'pressure' | 'gradient' | 'zero', THREE.ShaderMaterial>;
  private readonly gridTexel: THREE.Vector2;

  constructor(private readonly passes: Passes, readonly grid: [number, number], dye: [number, number], private readonly pressureIterations = 20) {
    this.velocityPair = passes.pair(...grid);
    this.dyePair = passes.pair(...dye);
    this.pressurePair = passes.pair(...grid, { nearest: true });
    this.curlTarget = passes.target(...grid, { nearest: true });
    this.divergenceTarget = passes.target(...grid, { nearest: true });
    this.gridTexel = new THREE.Vector2(1 / grid[0], 1 / grid[1]);
    const texel = { value: this.gridTexel };
    this.m = {
      advect: passes.material(advect, { uVelocity: { value: null }, uSource: { value: null }, uGridTexel: texel, uStep: { value: 0 }, uKeep: { value: 1 } }),
      curl: passes.material(curl, { uVelocity: { value: null }, uTexel: texel }),
      vorticity: passes.material(vorticity, { uVelocity: { value: null }, uCurl: { value: null }, uDye: { value: null }, uTexel: texel, uCurlAmount: { value: 30 }, uStep: { value: 0 }, uBuoyancy: { value: 0 } }),
      divergence: passes.material(divergence, { uVelocity: { value: null }, uTexel: texel }),
      scale: passes.material(scale, { uSource: { value: null }, uAmount: { value: .8 } }),
      pressure: passes.material(pressure, { uPressure: { value: null }, uDivergence: { value: null }, uTexel: texel }),
      gradient: passes.material(gradient, { uPressure: { value: null }, uVelocity: { value: null }, uTexel: texel }),
      zero: passes.material(zero, {}),
    };
    this.clear();
  }

  get velocity(): THREE.Texture { return this.velocityPair.read.texture; }
  get dye(): THREE.Texture { return this.dyePair.read.texture; }

  /** Runs a caller's pass over velocity or dye. The pass reads the current values from `uCurrent` and writes the new ones. */
  inject(into: 'velocity' | 'dye', material: THREE.ShaderMaterial): void {
    const pair = into === 'velocity' ? this.velocityPair : this.dyePair;
    material.uniforms.uCurrent.value = pair.read.texture;
    this.passes.draw(material, pair.write); pair.swap();
  }

  /**
   * One simulation step. `curl` is the vorticity amount (Pavel's default is 30); lives are the seconds
   * after which 5% is left; `buoyancy` is upward acceleration in cells/s² per unit of dye brightness.
   */
  step(seconds: number, curlAmount: number, velocityLife: number, dyeLife: number, buoyancy: number): void {
    if (seconds <= 0) return;
    const { m, passes } = this;
    m.curl.uniforms.uVelocity.value = this.velocity; passes.draw(m.curl, this.curlTarget);
    const v = m.vorticity.uniforms;
    v.uVelocity.value = this.velocity; v.uCurl.value = this.curlTarget.texture; v.uDye.value = this.dye;
    v.uCurlAmount.value = curlAmount; v.uStep.value = seconds; v.uBuoyancy.value = buoyancy;
    passes.draw(m.vorticity, this.velocityPair.write); this.velocityPair.swap();
    m.divergence.uniforms.uVelocity.value = this.velocity; passes.draw(m.divergence, this.divergenceTarget);
    m.scale.uniforms.uSource.value = this.pressurePair.read.texture; m.scale.uniforms.uAmount.value = .8;
    passes.draw(m.scale, this.pressurePair.write); this.pressurePair.swap();
    m.pressure.uniforms.uDivergence.value = this.divergenceTarget.texture;
    for (let i = 0; i < this.pressureIterations; i++) {
      m.pressure.uniforms.uPressure.value = this.pressurePair.read.texture;
      passes.draw(m.pressure, this.pressurePair.write); this.pressurePair.swap();
    }
    m.gradient.uniforms.uPressure.value = this.pressurePair.read.texture; m.gradient.uniforms.uVelocity.value = this.velocity;
    passes.draw(m.gradient, this.velocityPair.write); this.velocityPair.swap();
    const a = m.advect.uniforms;
    a.uVelocity.value = this.velocity; a.uSource.value = this.velocity; a.uStep.value = seconds; a.uKeep.value = keep(seconds, velocityLife);
    passes.draw(m.advect, this.velocityPair.write); this.velocityPair.swap();
    a.uVelocity.value = this.velocity; a.uSource.value = this.dye; a.uKeep.value = keep(seconds, dyeLife);
    passes.draw(m.advect, this.dyePair.write); this.dyePair.swap();
  }

  resizeDye(width: number, height: number): void { this.dyePair.setSize(width, height); this.clear(); }

  clear(): void {
    for (const target of [this.velocityPair.read, this.velocityPair.write, this.dyePair.read, this.dyePair.write, this.pressurePair.read, this.pressurePair.write])
      this.passes.draw(this.m.zero, target);
  }

  dispose(): void {
    for (const item of [this.velocityPair, this.dyePair, this.pressurePair, this.curlTarget, this.divergenceTarget, ...Object.values(this.m)]) item.dispose();
  }
}
