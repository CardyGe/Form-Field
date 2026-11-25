/**
 * Ink patterns for Oil, grown by reaction-diffusion.
 *
 * Paint pressed under glass and pulled apart breaks into fingers (a lifted
 * Hele-Shaw cell). Gray-Scott reaction-diffusion forms the same families of
 * shape: even-width mazes, round holes and stripes that line up with a stretch.
 * They are grown once per seed on the GPU into a tile that wraps on all sides,
 * so every frame only reads the finished tile and loops stay exact.
 *
 * Tile channels (each a chemical concentration, ink where it is above ~0.2):
 *   r  maze     even-width branching lines
 *   g  threads  the same process with faster diffusion along x, so it forms
 *               stripes along x; sampled rotated to follow the drag
 *   b  holes    a network with round holes; inverted it reads as foam cells
 * Cell size varies smoothly across the tile, as it does in real paint.
 */
import * as THREE from 'three';
import { ProgramsCompiling } from './program-gate';

export const OIL_PATTERN_SIZE = 512;
/** Steps until the patterns settle into stable shapes. */
export const OIL_PATTERN_STEPS = 5000;
/** How many of those steps one frame takes while a look is being made ready during a show. */
const OIL_STEPS_PER_FRAME = 40;
/** Concentration that separates ink from paint. */
export const OIL_INK_LEVEL = .2;
const MAX_TILES = 4;

const common = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uSize, uSeed, uPair;
const float TAU = 6.28318530718;
float wave(vec2 p, vec2 k, float s) { return sin(TAU * dot(p, k) + s); }
// A smooth field that wraps on the tile: integer frequencies only.
float field(vec2 p, float s) {
  return (wave(p, vec2(1., 2.), s) + wave(p, vec2(-2., 1.), s * 1.7 + 1.)
    + .6 * wave(p, vec2(3., -1.), s * 2.3 + 2.) + .5 * wave(p, vec2(2., 3.), s * 3.1 + 4.)) / 3.1;
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031 + uSeed * .0137); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

const seedFragment = /* glsl */`${common}
void main() {
  vec2 cell = floor(vUv * uSize);
  float a = hash(cell + uPair * 101.), b = hash(cell + uPair * 101. + 17.);
  vec2 s1 = a < .02 ? vec2(.5, 1.) : vec2(1., 0.);
  vec2 s2 = b < .02 ? vec2(.5, 1.) : vec2(1., 0.);
  gl_FragColor = vec4(s1, s2);
}`;

// One explicit Gray-Scott step for two systems stored as (A, B, A, B).
const stepFragment = /* glsl */`${common}
uniform sampler2D uState;
vec2 react(vec2 c, vec2 lap, float scale, float f, float k) {
  float abb = c.x * c.y * c.y;
  return clamp(c + vec2(.2, .1) * scale * lap + vec2(-abb + f * (1. - c.x), abb - (k + f) * c.y), 0., 1.);
}
void main() {
  vec2 t = vec2(1. / uSize);
  vec4 c = texture2D(uState, vUv);
  vec4 xx = texture2D(uState, vUv - vec2(t.x, 0.)) + texture2D(uState, vUv + vec2(t.x, 0.)) - 2. * c;
  vec4 yy = texture2D(uState, vUv - vec2(0., t.y)) + texture2D(uState, vUv + vec2(0., t.y)) - 2. * c;
  // Cell size varies across the tile (diffusion scale .4..1 gives ~.63..1 size).
  float scale = mix(.4, 1., .5 + .5 * field(vUv, uSeed * .013 + uPair * 3.));
  if (uPair < .5) {
    // Maze, and threads that stripe along x.
    gl_FragColor = vec4(react(c.xy, (xx + yy).xy, scale, .029, .057),
      react(c.zw, (xx + .3 * yy).zw, 1., .029, .057));
  } else {
    // Holes; the second slot is unused.
    gl_FragColor = vec4(react(c.xy, (xx + yy).xy, scale, .039, .058), 1., 0.);
  }
}`;

const packFragment = /* glsl */`${common}
uniform sampler2D uFirst, uSecond;
void main() {
  vec4 a = texture2D(uFirst, vUv), b = texture2D(uSecond, vUv);
  gl_FragColor = vec4(a.y, a.w, b.y, 1.);
}`;

const vertex = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

function simTarget(type: THREE.TextureDataType, filter: THREE.MagnificationTextureFilter): THREE.WebGLRenderTarget {
  const result = new THREE.WebGLRenderTarget(OIL_PATTERN_SIZE, OIL_PATTERN_SIZE, {
    type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    minFilter: filter, magFilter: filter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    generateMipmaps: false,
  });
  result.texture.colorSpace = THREE.NoColorSpace;
  return result;
}

/** Grows and caches the ink tile for one seed at a time. */
export class OilPatternBaker {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly seedMaterial: THREE.ShaderMaterial;
  private readonly stepMaterial: THREE.ShaderMaterial;
  private readonly packMaterial: THREE.ShaderMaterial;
  /** Finished tiles by seed, most recently used last. */
  private readonly tiles = new Map<number, THREE.WebGLRenderTarget>();
  /** Milliseconds the last bake took to submit, for diagnostics. */
  lastBakeMs = 0;
  /** A bake under way, kept between frames while it is paced. */
  private baking: { seed: number; pairs: THREE.WebGLRenderTarget[][]; result: THREE.WebGLRenderTarget; seeded: number; step: number; pair: number } | null = null;
  private dropBake(): void {
    if (!this.baking) return;
    for (const [a, b] of this.baking.pairs) { a.dispose(); b.dispose(); }
    this.baking.result.dispose();
    this.baking = null;
  }

  /** `paced`: whether to spread a bake over frames (a look being made ready during a show) rather than finish it at once. */
  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly paced: () => boolean = () => false) {
    const uniforms = { uSize: { value: OIL_PATTERN_SIZE }, uSeed: { value: 0 }, uPair: { value: 0 } };
    const make = (fragmentShader: string, extra: Record<string, THREE.IUniform> = {}) => new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader, uniforms: { ...uniforms, ...extra },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
    this.seedMaterial = make(seedFragment);
    this.stepMaterial = make(stepFragment, { uState: { value: null } });
    this.packMaterial = make(packFragment, { uFirst: { value: null }, uSecond: { value: null } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.seedMaterial);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** The finished tile for this seed, growing it first if needed. */
  texture(seed: number): THREE.Texture {
    const cached = this.tiles.get(seed);
    if (cached) { this.tiles.delete(seed); this.tiles.set(seed, cached); return cached.texture; }
    const started = performance.now();
    const previous = this.renderer.getRenderTarget();
    if (this.baking && this.baking.seed !== seed) this.dropBake();
    const bake = this.baking ??= { seed, pairs: [0, 1].map(() => [simTarget(THREE.FloatType, THREE.NearestFilter), simTarget(THREE.FloatType, THREE.NearestFilter)]), result: simTarget(THREE.HalfFloatType, THREE.LinearFilter), seeded: 0, step: 0, pair: 0 };
    const { pairs, result } = bake;
    for (const material of [this.seedMaterial, this.stepMaterial, this.packMaterial]) material.uniforms.uSeed.value = seed % 9973;
    const draw = (material: THREE.ShaderMaterial, output: THREE.WebGLRenderTarget) => {
      this.quad.material = material;
      this.renderer.setRenderTarget(output);
      this.renderer.render(this.scene, this.camera);
    };
    // Each draw is counted only once it has been made, so a bake that is postponed carries on exactly where it stopped.
    try {
      for (; bake.seeded < 2; bake.seeded++) { this.seedMaterial.uniforms.uPair.value = bake.seeded; draw(this.seedMaterial, pairs[bake.seeded][0]); }
      const stopAt = this.paced() ? Math.min(OIL_PATTERN_STEPS, bake.step + OIL_STEPS_PER_FRAME) : OIL_PATTERN_STEPS;
      while (bake.step < stopAt) {
        const [from, to] = bake.step % 2 === 0 ? pairs[bake.pair] : [pairs[bake.pair][1], pairs[bake.pair][0]];
        this.stepMaterial.uniforms.uPair.value = bake.pair;
        this.stepMaterial.uniforms.uState.value = from.texture;
        draw(this.stepMaterial, to);
        if (++bake.pair === 2) { bake.pair = 0; bake.step++; }
      }
      if (bake.step < OIL_PATTERN_STEPS) throw new ProgramsCompiling();
      const finalIndex = OIL_PATTERN_STEPS % 2;
      this.packMaterial.uniforms.uFirst.value = pairs[0][finalIndex].texture;
      this.packMaterial.uniforms.uSecond.value = pairs[1][finalIndex].texture;
      draw(this.packMaterial, result);
    } finally {
      this.renderer.setRenderTarget(previous);
    }
    for (const [a, b] of pairs) { a.dispose(); b.dispose(); }
    this.baking = null;
    this.tiles.set(seed, result);
    // A few layers with different seeds can share the cache without regrowing.
    while (this.tiles.size > MAX_TILES) {
      const [oldest, tile] = this.tiles.entries().next().value!;
      tile.dispose(); this.tiles.delete(oldest);
    }
    this.lastBakeMs = performance.now() - started;
    return result.texture;
  }

  /** Reads the tile back (r, g, b per texel as floats), for tests and tuning. */
  read(seed: number): Float32Array {
    const tile = this.tiles.get(seed) ?? (this.texture(seed), this.tiles.get(seed)!);
    const bytes = new Uint16Array(OIL_PATTERN_SIZE * OIL_PATTERN_SIZE * 4);
    this.renderer.readRenderTargetPixels(tile, 0, 0, OIL_PATTERN_SIZE, OIL_PATTERN_SIZE, bytes);
    return Float32Array.from(bytes, THREE.DataUtils.fromHalfFloat);
  }

  release(): void { this.dropBake(); for (const tile of this.tiles.values()) tile.dispose(); this.tiles.clear(); }

  dispose(): void {
    this.release();
    this.seedMaterial.dispose(); this.stepMaterial.dispose(); this.packMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
