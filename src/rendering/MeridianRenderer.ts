import * as THREE from 'three';
import type { Layer } from '../shared/types';
import { compose } from '../meridian/composer';
import { DisplayList, STRIDE } from '../meridian/display-list';
import { evaluate, positionAt, type PhrasePosition } from '../meridian/evaluate';
import { applyMacros } from '../meridian/macros';
import { MERIDIAN_DEFAULTS, MERIDIAN_PARAMETERS } from '../meridian/parameters';
import { PRIMITIVE, type PerformanceState, type Score } from '../meridian/types';
import { BLOOM_HEIGHTS, BloomPyramid, lightTarget } from './bloom';
import { CURVE_SIDES, curveVertex, lightFragment, markVertex, resolveFragment, tearFragment } from './meridian-shaders';
import { fullscreenVertex } from './shaders';
import { sourceViewMatrix } from './source-view';

type Draw = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => void;
export interface MeridianRuntime {
  list?: DisplayList; signals?: Readonly<Record<string, number>>; dt?: number;
  /** The layer's values before animation. Structural values come from here, so a saved animation cannot rebuild the Score each frame. */
  structure?: Readonly<Record<string, number>>;
  /** Output frames in one loop at the project's frame rate. A tear holds for whole frames of this count. */
  loopFrames?: number;
}

const TAU = Math.PI * 2;
const CAPACITY = 20000;
const BEATS_PER_BAR = 4;
const GHOSTS = 5;
const GHOST_BEATS = 0.09; // How far back the last echo reaches at Trail length 1.
const SCORE_CACHE = 16;
const DEFAULT_LOOP_FRAMES = 300; // The default 10 second, 30 fps loop, for a draw with no project behind it.
const FALLBACK_PALETTE = ['#e8f1ff', '#ff6a2a', '#35d0ff', '#ffffff', '#ff9a5a', '#04050a'];
/** Colour schemes: base, accent, second accent, hero core, halo, ground. Palette 0 is the layer's own swatches. */
const SCHEMES: readonly (readonly string[])[] = [
  FALLBACK_PALETTE,
  ['#f4f7ff', '#ff2d55', '#7a5cff', '#ffffff', '#ff3d6e', '#050308'],
  ['#d8fff4', '#00ffc2', '#2a8bff', '#ffffff', '#16e6c0', '#010607'],
  ['#fff1dc', '#ffb000', '#ff4a00', '#fffbe8', '#ff7a18', '#070402'],
  ['#ece6ff', '#b45cff', '#ff3fd0', '#ffffff', '#9a4dff', '#05030b'],
  ['#e6f6ff', '#2fb4ff', '#c8ff2e', '#ffffff', '#1f8cff', '#01040a'],
  ['#ffffff', '#ffffff', '#9aa4b8', '#ffffff', '#c8d4ea', '#030304'],
  ['#ffe9f2', '#ff5fa2', '#ffd23f', '#ffffff', '#ff4d8d', '#080306'],
];
const STRUCTURAL = MERIDIAN_PARAMETERS.filter(d => d.structural).map(d => d.key);
const ALL_KEYS = MERIDIAN_PARAMETERS.map(d => d.key);
const BLOOM_UNIFORMS = BLOOM_HEIGHTS.map((_, i) => `uBloom${i}`);

interface CachedScore { signature: Float64Array; score: Score; used: number }

function strip(sides: number): THREE.BufferGeometry {
  const positions: number[] = [], index: number[] = [];
  for (let i = 0; i <= sides; i++) positions.push(i / sides, -1, 0, i / sides, 1, 0);
  for (let i = 0; i < sides; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);
  return geometry;
}

/** One instance buffer. Only the part in use is uploaded, through a single range that is reused every frame. */
class Instances {
  readonly data = new Float32Array(CAPACITY * STRIDE);
  readonly buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
  readonly geometry = new THREE.InstancedBufferGeometry();
  count = 0;
  constructor(shape: THREE.BufferGeometry) {
    this.geometry.setAttribute('position', shape.getAttribute('position'));
    this.geometry.setIndex(shape.getIndex());
    this.geometry.setAttribute('aHead', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    this.geometry.setAttribute('aTail', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    this.geometry.setAttribute('aInk', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    this.geometry.instanceCount = 0;
    this.buffer.addUpdateRange(0, 0);
    this.buffer.clearUpdateRanges = () => undefined; // three clears ranges after each upload; this one is kept.
  }
  commit(): void {
    this.geometry.instanceCount = this.count;
    this.buffer.updateRanges[0].count = this.count * STRIDE;
    if (this.count > 0) this.buffer.needsUpdate = true;
  }
  dispose(): void { this.geometry.dispose(); }
}

/**
 * Meridian's picture.
 * 1. Light. Every mark is one instance with an analytic edge, added into a half-float target, so crossings burn.
 * 2. Glow. The same instances, weighted by each mark's own glow, go into a smaller target and through the bloom
 *    pyramid. The hero carries almost all of it, so thin lines stay razor sharp beside a burning ring.
 * 3. Resolve. Roll-off per channel, fringe, grade, ground. Output is premultiplied.
 * 4. Tear. Only while one is under way: the resolved picture is broken up, from the Score and the position alone.
 */
export class MeridianRenderer {
  private readonly curves = new Instances(strip(CURVE_SIDES));
  private readonly marks = new Instances(strip(1));
  private readonly list = new DisplayList(CAPACITY);
  private readonly ghost = new DisplayList(CAPACITY);
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly light = lightTarget();
  private readonly glow = lightTarget();
  private readonly untorn = lightTarget();
  private readonly bloom = new BloomPyramid();
  private readonly view = new THREE.Matrix3();
  private readonly identity = new THREE.Matrix3();
  private readonly live: Record<string, number> = { ...MERIDIAN_DEFAULTS };
  private readonly position: PhrasePosition = { progress: 0, state: 'seed', stateProgress: 0, beat: 0 };
  private readonly ghostPosition: PhrasePosition = { progress: 0, state: 'seed', stateProgress: 0, beat: 0 };
  private readonly perf: PerformanceState = { hold: false, tension: 0, burst: 0, forcedState: null };
  private readonly scores: CachedScore[] = [];
  private readonly signature = new Float64Array(STRUCTURAL.length + 1);
  private readonly swatches = Array.from({ length: 6 }, () => new THREE.Color());
  private readonly peakSwatches = Array.from({ length: 6 }, () => new THREE.Color());
  private readonly parsed: (string | undefined)[] = new Array(6).fill(undefined);
  private parsedPeak = -1;
  private readonly hsl = { h: 0, s: 0, l: 0 };
  private readonly mixed = new THREE.Color();
  private clock = 0;
  private tearAmount = 0;
  private readonly shared = {
    uInverse: { value: new THREE.Matrix3() }, uShape: { value: new THREE.Matrix2() }, uField: { value: new THREE.Vector2(1, 1) }, uCentre: { value: new THREE.Vector2() },
    uTilt: { value: 0 }, uPixel: { value: 1 / 1080 }, uMinWidth: { value: 1.5 }, uEdge: { value: 1 }, uHaloReach: { value: 8 }, uRes: { value: 1 }, uByRadius: { value: 0 }, uPeak: { value: 0 },
    uInks: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
    uCore: { value: 1 }, uLineGlow: { value: .5 }, uGlowPass: { value: 0 }, uHot: { value: new THREE.Color() }, uHalo: { value: new THREE.Color() },
  };
  private readonly curveMaterial = this.lightMaterial(curveVertex);
  private readonly markMaterial = this.lightMaterial(markVertex);
  private readonly resolve = new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex, fragmentShader: resolveFragment,
    uniforms: {
      uLight: { value: null }, ...Object.fromEntries(BLOOM_UNIFORMS.map(name => [name, { value: null }])),
      uWeights: { value: [0, 0, 0, 0, 0] }, uGround: { value: new THREE.Color() }, uCentre: { value: new THREE.Vector2(.5, .5) },
      uAspect: { value: 1 }, uFringe: { value: 0 }, uExposure: { value: 1 }, uContrast: { value: 1 }, uSaturation: { value: 1 },
      uVignette: { value: 0 }, uLift: { value: 0 }, uBlack: { value: 0 }, uTransparent: { value: 0 },
    },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  private readonly tear = new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex, fragmentShader: tearFragment,
    uniforms: {
      uImage: { value: null }, uInks: this.shared.uInks, uNoise: { value: new THREE.Vector4() }, uGrid: { value: new THREE.Vector2(1, 1) },
      uSlip: { value: new THREE.Vector2() }, uCentre: { value: new THREE.Vector2(.5, .5) }, uTear: { value: 0 }, uDrive: { value: 1 }, uAspect: { value: 1 },
      uSplit: { value: 0 }, uBands: { value: 0 }, uPosterise: { value: 0 }, uRadial: { value: 0 }, uSpread: { value: 0 }, uShred: { value: 0 },
      uGround: this.resolve.uniforms.uGround, uLift: { value: 0 }, uBlack: { value: 0 }, uTransparent: { value: 0 },
    },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });

  constructor() {
    for (const [instances, material] of [[this.curves, this.curveMaterial], [this.marks, this.markMaterial]] as const) {
      const mesh = new THREE.Mesh(instances.geometry, material);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
  }

  private lightMaterial(vertexShader: string): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader, fragmentShader: lightFragment, uniforms: this.shared,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, transparent: true,
    });
  }

  /** The Score for a seed and the current structural values. Composes only when one of them changes. */
  private scoreFor(seed: number, params: Readonly<Record<string, number>>): Score {
    const signature = this.signature;
    signature[0] = seed;
    for (let i = 0; i < STRUCTURAL.length; i++) signature[i + 1] = STRUCTURAL[i] === 'seed' ? 0 : params[STRUCTURAL[i]];
    this.clock++;
    let oldest = 0;
    for (let i = 0; i < this.scores.length; i++) {
      const entry = this.scores[i];
      let same = true;
      for (let k = 0; same && k < signature.length; k++) same = entry.signature[k] === signature[k];
      if (same) { entry.used = this.clock; return entry.score; }
      if (entry.used < this.scores[oldest].used) oldest = i;
    }
    const score = compose(seed, params);
    const entry: CachedScore = { signature: signature.slice(), score, used: this.clock };
    if (this.scores.length < SCORE_CACHE) this.scores.push(entry); else this.scores[oldest] = entry;
    return score;
  }

  draw(renderer: THREE.WebGLRenderer, layer: Layer, phase: number, width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw, runtime?: MeridianRuntime): void {
    const live = this.live, source = layer.params;
    for (let i = 0; i < ALL_KEYS.length; i++) {
      const value = source[ALL_KEYS[i]];
      live[ALL_KEYS[i]] = Number.isFinite(value) ? value : MERIDIAN_DEFAULTS[ALL_KEYS[i]];
    }
    const structure = runtime?.structure;
    if (structure) for (let i = 0; i < STRUCTURAL.length; i++) {
      const value = structure[STRUCTURAL[i]];
      live[STRUCTURAL[i]] = Number.isFinite(value) ? value : MERIDIAN_DEFAULTS[STRUCTURAL[i]];
    }
    applyMacros(source, live);

    // The loop holds whole phrases; each takes the next seed, and its point becomes the next one's Seed.
    const repeat = Math.max(1, Math.round(live.scoreRepeat));
    const turn = Number.isFinite(phase) ? ((phase / TAU) % 1 + 1) % 1 : 0;
    const along = (phase >= TAU ? 1 - 1e-9 : turn) * repeat;
    const phrase = Math.min(repeat - 1, Math.floor(along));
    const score = this.scoreFor(((live.seed >>> 0) + phrase) >>> 0, live);
    const beats = score.bars * BEATS_PER_BAR;
    const position = positionAt(score, (along - phrase) * beats, BEATS_PER_BAR, this.position);
    this.perf.tension = Math.max(0, (live.macroTension - .5) * 2);

    let list = runtime?.list;
    if (!list) {
      list = this.list;
      evaluate(score, position, this.perf, live, list);
      this.appendGhosts(score, live, position.beat, list);
    }
    const ends = score.stateEnds, peak = smoothRange(position.progress, ends[3], ends[3] + (ends[4] - ends[3]) * .2) * (1 - smoothRange(position.progress, ends[4], ends[5]));
    const loopFrames = Math.max(1, Math.round(runtime?.loopFrames ?? DEFAULT_LOOP_FRAMES));
    const frame = Math.min(loopFrames - 1, Math.floor(along / repeat * loopFrames + 1e-6));
    this.tearAmount = this.prepareTear(score, position.progress, frame, loopFrames / repeat, phrase, live);
    sourceViewMatrix(layer.transform, width / height, this.view);
    this.renderList(renderer, list, live, layer.palette, this.view.invert(), layer.transform.scale, position.progress, peak, width, height, target, draw);
  }

  /**
   * How torn this moment is, 0 to 1, and the pattern it shows. It cuts in at the start of Peak, holds, and Recovery
   * sets how far it trails into Collapse. Holds are counted in output frames from the first frame of Peak, and each
   * reads the envelope at its midpoint, so amount and pattern stay exactly still for Hold frames. The first hold reads
   * no later than the end of the plateau, so a hold longer than the whole tear still shows it at full strength.
   */
  private prepareTear(score: Score, progress: number, frame: number, phraseFrames: number, phrase: number, p: Readonly<Record<string, number>>): number {
    const glitch = read(p, 'glitchAmount'), ends = score.stateEnds, peakLength = ends[4] - ends[3];
    const firstFrame = Math.ceil((phrase + ends[3]) * phraseFrames - 1e-6);
    if (glitch <= 0 || frame < firstFrame || progress >= ends[5]) return 0;
    const hold = Math.max(1, Math.round(read(p, 'glitchHoldFrames')));
    const step = Math.floor((frame - firstFrame) / hold);
    const middle = (firstFrame + (step + .5) * hold) / phraseFrames - phrase;
    const releases = ends[4] - peakLength * .45;
    const held = step === 0 ? Math.min(middle, releases) : middle;
    const recovery = read(p, 'glitchRecovery');
    const settled = ends[4] + (ends[5] - ends[4]) * .7 * (1 - recovery);
    const shape = smoothRange(held, ends[3], ends[3] + peakLength * .1) * (1 - smoothRange(held, releases, settled));
    const amount = Math.min(1, glitch * shape);
    if (amount <= 0) return 0;
    const u = this.tear.uniforms, seed = (score.seed ^ Math.imul(Math.round(read(p, 'glitchSeed')), 0x9e3779b1)) >>> 0;
    (u.uNoise.value as THREE.Vector4).set(tearNoise(seed, step, 1), tearNoise(seed, step, 2), tearNoise(seed, step, 3), tearNoise(seed, step, 4));
    u.uDrive.value = 1 + .6 * Math.max(0, glitch - 1);
    (u.uSlip.value as THREE.Vector2).set(read(p, 'glitchSlipH'), read(p, 'glitchSlipV'));
    u.uSplit.value = read(p, 'glitchRgbSplit');
    u.uBands.value = read(p, 'glitchScanBands');
    u.uPosterise.value = read(p, 'glitchPosterise');
    u.uRadial.value = read(p, 'glitchRadialTear');
    u.uSpread.value = read(p, 'glitchSpread');
    u.uShred.value = read(p, 'glitchColourShred');
    return amount;
  }

  /** Afterglow: earlier moments of the phrase, drawn fainter into the same frame. Exact at any frame, in any order. */
  private appendGhosts(score: Score, params: Readonly<Record<string, number>>, beat: number, list: DisplayList): void {
    const afterglow = params.lightAfterglow, trail = params.lightTrailLength;
    if (afterglow <= 0 || trail <= 0) return;
    const ghost = this.ghost, position = this.ghostPosition;
    for (let k = 1; k <= GHOSTS; k++) {
      const then = beat - (k / GHOSTS) * trail * GHOST_BEATS * score.bars;
      if (then <= 0) break;
      positionAt(score, then, BEATS_PER_BAR, position);
      evaluate(score, position, this.perf, params, ghost);
      const fade = afterglow * .26 * (1 - (k - 1) / GHOSTS) ** 2;
      for (let i = 0; i < ghost.count && list.count < CAPACITY; i++) {
        const d = ghost.data, at = i * STRIDE;
        // The surviving point would only brighten itself, so echoes keep to the structure.
        if (d[at] === PRIMITIVE.dot && d[at + 3] > .0055 && Math.hypot(d[at + 1], d[at + 2]) < 1e-6) continue;
        list.push(d[at], d[at + 1], d[at + 2], d[at + 3], d[at + 4], d[at + 5], d[at + 6], d[at + 7] * .4, d[at + 8], d[at + 9] * fade, d[at + 10], d[at + 11]);
      }
    }
  }

  /** Draws a ready-made list with no phrase behind it. Live input and the checks use this. */
  drawList(renderer: THREE.WebGLRenderer, list: DisplayList, params: Readonly<Record<string, number>>, palette: readonly string[], width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw): void {
    this.tearAmount = 0;
    this.renderList(renderer, list, params, palette, this.identity, 1, 0, 0, width, height, target, draw);
  }

  private renderList(renderer: THREE.WebGLRenderer, list: DisplayList, p: Readonly<Record<string, number>>, palette: readonly string[], inverse: THREE.Matrix3, viewScale: number, progress: number, peak: number, width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw): void {
    this.partition(list);
    const u = this.shared, aspect = width / height;

    // Structure: the frame the whole design is placed in.
    const zoom = read(p, 'structureZoom') * (1 - 2 * read(p, 'outputSafeMargin'));
    const angle = read(p, 'structureRotation') * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const tilt = read(p, 'structureTilt'), squash = (1 - read(p, 'structureEllipse') * .6) * (1 - tilt * .62);
    (u.uShape.value as THREE.Matrix2).set(cos * zoom, -sin * zoom * squash, sin * zoom, cos * zoom * squash);
    (u.uCentre.value as THREE.Vector2).set(read(p, 'structureCentreX') * aspect, read(p, 'structureCentreY'));
    (u.uField.value as THREE.Vector2).set(aspect, 1);
    (u.uInverse.value as THREE.Matrix3).copy(inverse);
    u.uTilt.value = tilt;
    u.uPixel.value = 1 / (height * Math.max(viewScale, .05) * Math.max(zoom * Math.min(1, squash), .05));
    u.uMinWidth.value = read(p, 'outputMinLineWidth');
    u.uEdge.value = read(p, 'outputAntiAlias');
    u.uCore.value = read(p, 'lightCore');
    u.uLineGlow.value = read(p, 'lightLineGlow');
    u.uHaloReach.value = 4 + 9 * Math.min(1, read(p, 'lightLineGlow'));
    u.uByRadius.value = read(p, 'colourByRadius');
    u.uPeak.value = peak;
    this.setColours(p, palette, progress, peak);

    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.mixed);
    renderer.setClearColor(0x000000, 0);

    u.uGlowPass.value = 0; u.uRes.value = 1;
    if (this.light.width !== width || this.light.height !== height) this.light.setSize(width, height);
    renderer.setRenderTarget(this.light);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    const glowWidth = Math.max(2, Math.round(width / 2)), glowHeight = Math.max(2, Math.round(height / 2));
    u.uGlowPass.value = 1; u.uRes.value = .5;
    if (this.glow.width !== glowWidth || this.glow.height !== glowHeight) this.glow.setSize(glowWidth, glowHeight);
    renderer.setRenderTarget(this.glow);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(this.mixed, clearAlpha);

    const levels = this.bloom.render(this.glow.texture, glowWidth, glowHeight, draw);
    const r = this.resolve.uniforms;
    r.uLight.value = this.light.texture;
    for (let i = 0; i < levels.length; i++) r[BLOOM_UNIFORMS[i]].value = levels[i];
    // Bloom size moves the glow from the tight levels to the wide ones; the hero's halo size pushes it further.
    const size = Math.min(1, Math.max(0, read(p, 'lightBloomSize') + (read(p, 'heroHaloSize') - 1) * .4));
    const amount = read(p, 'lightBloomAmount') * 3 * (1 + .8 * peak), weights = r.uWeights.value as number[];
    for (let i = 0; i < weights.length; i++) {
      const t = i / (weights.length - 1);
      weights[i] = amount * ((1 - size) * (1 - t) * (1 - t) + size * (.3 + .3 * t) * (1 - .55 * t));
    }
    (r.uCentre.value as THREE.Vector2).set(.5 + read(p, 'structureCentreX'), .5 + read(p, 'structureCentreY'));
    r.uAspect.value = aspect;
    r.uFringe.value = read(p, 'colourFringe');
    r.uExposure.value = read(p, 'lightExposure') * (1 + .55 * peak);
    r.uContrast.value = 1.14 * read(p, 'lightContrast');
    r.uSaturation.value = read(p, 'colourSaturation');
    r.uVignette.value = read(p, 'lightVignette');
    r.uLift.value = read(p, 'lightBackgroundLift');
    r.uBlack.value = read(p, 'outputBlackLevel');
    r.uTransparent.value = read(p, 'outputTransparent') >= .5 ? 1 : 0;
    if (this.tearAmount <= 0) { draw(this.resolve, target); return; }
    if (this.untorn.width !== width || this.untorn.height !== height) this.untorn.setSize(width, height);
    draw(this.resolve, this.untorn);
    const t = this.tear.uniforms, rows = 1 / (.018 + .2 * read(p, 'glitchBlockSize') ** 1.5);
    t.uImage.value = this.untorn.texture;
    t.uTear.value = this.tearAmount;
    t.uAspect.value = aspect;
    t.uLift.value = r.uLift.value;
    t.uBlack.value = r.uBlack.value;
    t.uTransparent.value = r.uTransparent.value;
    (t.uGrid.value as THREE.Vector2).set(rows * aspect / read(p, 'glitchBlockAspect'), rows);
    (t.uCentre.value as THREE.Vector2).copy(r.uCentre.value as THREE.Vector2);
    draw(this.tear, target);
  }

  /** Splits the list between the ring strip and the plain quad, so a dot never pays for a ring's geometry. */
  private partition(list: DisplayList): void {
    const data = list.data, curves = this.curves.data, marks = this.marks.data;
    let c = 0, m = 0;
    for (let i = 0; i < list.count; i++) {
      const from = i * STRIDE, curve = data[from] <= PRIMITIVE.arc, into = curve ? curves : marks, at = (curve ? c++ : m++) * STRIDE;
      for (let k = 0; k < STRIDE; k++) into[at + k] = data[from + k];
    }
    this.curves.count = c; this.marks.count = m;
    this.curves.commit(); this.marks.commit();
  }

  private setColours(p: Readonly<Record<string, number>>, palette: readonly string[], progress: number, peak: number): void {
    const scheme = Math.round(p.colourPalette ?? 0);
    const main = scheme > 0 ? SCHEMES[Math.min(scheme, SCHEMES.length - 1)] : palette;
    for (let i = 0; i < 6; i++) {
      const hex = main[i] ?? FALLBACK_PALETTE[i];
      if (this.parsed[i] !== hex) { this.swatches[i].set(hex); this.parsed[i] = hex; }
    }
    const peakScheme = Math.round(p.colourPeakPalette ?? 0);
    if (peakScheme !== this.parsedPeak) {
      this.parsedPeak = peakScheme;
      if (peakScheme > 0) for (let i = 0; i < 6; i++) this.peakSwatches[i].set(SCHEMES[Math.min(peakScheme, SCHEMES.length - 1)][i]);
    }
    const u = this.shared, inks = u.uInks.value;
    const base = clampIndex(p.colourBase, 0), accent = clampIndex(p.colourAccent, 1), second = accent === 2 ? 1 : 2;
    const mono = (p.outputMono ?? 0) >= .5;
    this.ink(inks[0], base, peakScheme, peak, p, progress);
    this.ink(inks[1], mono ? base : accent, peakScheme, peak, p, progress);
    this.ink(inks[2], mono ? base : second, peakScheme, peak, p, progress);
    this.ink(u.uHot.value, 3, peakScheme, peak, p, progress);
    this.ink(u.uHalo.value, mono ? base : 4, peakScheme, peak, p, progress);
    (this.resolve.uniforms.uGround.value as THREE.Color).copy(this.swatches[5]);
  }

  private ink(out: THREE.Color, index: number, peakScheme: number, peak: number, p: Readonly<Record<string, number>>, progress: number): void {
    out.copy(this.swatches[index]);
    if (peakScheme > 0) out.lerp(this.peakSwatches[index], peak);
    const drift = p.colourHueDrift ?? 0;
    if (drift > 0) {
      out.getHSL(this.hsl);
      out.setHSL((this.hsl.h + drift * progress * .5) % 1, this.hsl.s, this.hsl.l);
    }
  }

  dispose(): void {
    this.curves.dispose(); this.marks.dispose();
    this.curveMaterial.dispose(); this.markMaterial.dispose(); this.resolve.dispose(); this.tear.dispose();
    this.light.dispose(); this.glow.dispose(); this.untorn.dispose(); this.bloom.dispose();
  }
}

function read(p: Readonly<Record<string, number>>, key: string): number {
  const v = p[key];
  return Number.isFinite(v) ? v : MERIDIAN_DEFAULTS[key];
}

function clampIndex(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(5, Math.round(value as number))) : fallback;
}

/** A repeatable value in 0 to 97 for one step of one tear. */
function tearNoise(seed: number, step: number, salt: number): number {
  let hash = Math.imul(seed ^ Math.imul(step + 1, 0x85ebca6b), 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  return (((hash ^ (hash >>> 13)) >>> 0) / 4294967296) * 97;
}

function smoothRange(value: number, start: number, end: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / Math.max(end - start, 1e-6)));
  return t * t * (3 - 2 * t);
}
