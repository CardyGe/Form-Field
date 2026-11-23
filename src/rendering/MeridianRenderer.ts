import * as THREE from 'three';
import { evaluateLayer, frameCount, phaseAtFrame } from '../core/timeline';
import type { Layer, Project } from '../shared/types';
import { compose } from '../meridian/composer';
import { DisplayList, STRIDE } from '../meridian/display-list';
import { evaluate, positionAt, type PhrasePosition } from '../meridian/evaluate';
import { Conductor } from '../meridian/conductor';
import { advanceEvolve, applyEvolveLight, createEvolveClock, createEvolveTransport, evaluateEvolve, EVOLVE_ELEMENTS, evolveScheme, exactEvolveClock, GLITCH_SHARDS, SCORE_STYLE_EVOLVE, type EvolveClock, type EvolveTransport } from '../meridian/evolve';
import { FlashGuard, guardLoopCells } from '../meridian/flash-guard';
import { heldMoves } from '../meridian/held-moves';
import { applyMacros } from '../meridian/macros';
import { markFromOutput, type MarkPlacement } from '../meridian/mark-placement';
import { LightGrid, type LightPlacement, type LightTone, type ToneCurve } from '../meridian/light-measure';
import { LinkedOverrides, MoveRouter, type LinkedEdit } from '../meridian/moves';
import { MusicLight } from '../meridian/music-light';
import { musicStatus } from '../meridian/music-status';
import { applyLockedVariation, MAX_STORED_SEED } from '../meridian/panel';
import { MERIDIAN_DEFAULTS, MERIDIAN_PARAMETERS } from '../meridian/parameters';
import { advanceTransport, applyPulseLight, createTransport, evaluatePulse, exactClock, isPulse, pulseRestStart, pulseScheme, type PulseClock, type PulseTransport } from '../meridian/pulse';
import { MERIDIAN_SCHEMES, SEED_SCHEME } from '../meridian/schemes';
import { PRIMITIVE, type PerformanceState, type Score, type ScoreForm } from '../meridian/types';
import { BLOOM_HEIGHTS, BloomPyramid, lightTarget } from './bloom';
import { CURVE_SIDES, curveVertex, lightFragment, markFragment, markVertex, resolveFragment, tearFragment } from './meridian-shaders';
import { fullscreenVertex } from './shaders';
import { frameAtPhase } from './feedback';
import { slitActive } from './slitscan';
import { sourceViewMatrix } from './source-view';

type Draw = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => void;
export interface MeridianRuntime {
  list?: DisplayList; signals?: Readonly<Record<string, number>>; dt?: number;
  /** The layer's values before animation. Structural values come from here, so a saved animation cannot rebuild the Score each frame. */
  structure?: Readonly<Record<string, number>>;
  /** Output frames in one loop at the project's frame rate. A tear holds for whole frames of this count. */
  loopFrames?: number;
  /** The layer's imported Mark, once it has loaded. */
  mark?: { texture: THREE.Texture; width: number; height: number } | null;
  /** True in the interactive preview: Pulse then runs from real tempo instead of the project's loop. */
  live?: boolean;
  /** The project's length in seconds. */
  duration?: number;
  /** The tempo comes from MIDI, tap or a fixed number rather than from the sound. */
  externalTempo?: boolean;
}

const TAU = Math.PI * 2;
const CAPACITY = 20000;
const BEATS_PER_BAR = 4;
const GHOSTS = 5;
const GHOST_BEATS = 0.09; // How far back the last echo reaches at Trail length 1.
const SCORE_CACHE = 16;
const DEFAULT_LOOP_FRAMES = 300; // The default 10 second, 30 fps loop, for a draw with no project behind it.
const FALLBACK_PALETTE = ['#e8f1ff', '#ff6a2a', '#35d0ff', '#ffffff', '#ff9a5a', '#04050a'];
const PULSE_GROUND = '#08070b'; // Accents change with the phrase; the black does not.
const TEAR_BURST_HOLDS = 3; // Holds in one burst of the tear.
const MARK_HEIGHT = .3; // The Mark's height as a share of the frame.
const MARK_IN = .4;    // Share of Rest over which the point opens into the Mark.
const MARK_OUT = .22;  // Share of Rest over which it closes back to the point.
const STRUCTURAL = MERIDIAN_PARAMETERS.filter(d => d.structural).map(d => d.key);
const ALL_KEYS = MERIDIAN_PARAMETERS.map(d => d.key);
const BLOOM_UNIFORMS = BLOOM_HEIGHTS.map((_, i) => `uBloom${i}`);

/** One layer's live performance: its clock, its light, and what linked moves have changed for this session only. */
interface EvolveLive {
  conductor: Conductor; light: MusicLight; router: MoveRouter; overrides: LinkedOverrides; baseSeed: number; presses: number;
  readonly input: { dt: number; signals: Readonly<Record<string, number>>; params: Readonly<Record<string, number>>; externalTempo: boolean };
}
/** One Evolve layer's picture for this composition frame, drawn once and measured before anything reaches the screen. */
interface EvolveEntry { readonly list: DisplayList; stamp: number; phase: number; seed: number; scheme: number; area: number; red: number; gain: number; saturation: number }
const EXPORT_TABLES = 8;
const isEvolveLayer = (layer: Layer): boolean => layer.visible && layer.kind === 'meridian' && Math.round(layer.params.scoreStyle ?? SCORE_STYLE_EVOLVE) === SCORE_STYLE_EVOLVE;
const NO_SIGNALS: Readonly<Record<string, number>> = Object.freeze({});

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
    uCore: { value: 1 }, uLineGlow: { value: .5 }, uGlowPass: { value: 0 }, uOwnGlow: { value: 0 }, uHot: { value: new THREE.Color() }, uHalo: { value: new THREE.Color() },
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
  private readonly markPass = new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex, fragmentShader: markFragment,
    uniforms: { uImage: { value: null }, uMark: { value: null }, uMarkFrom: { value: new THREE.Matrix3() }, uAlpha: { value: 0 } },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  private markAlpha = 0;
  private readonly markMatrix = new Float64Array(9);
  private readonly markPlacement: MarkPlacement = { view: this.view.elements, aspect: 1, zoom: 1, rotation: 0, centreX: 0, centreY: 0, width: 1, height: 1 };
  private form: ScoreForm | undefined;
  private pulseSeededScheme: number | undefined;
  private readonly transports = new Map<string, PulseTransport>();
  private readonly pulseClock: PulseClock = { phrase: 0, tick: 0, frac: 0, ticks: 128, tickSeconds: .06 };
  private readonly evolveTransports = new Map<string, EvolveTransport>();
  private readonly evolveExact = new Map<string, EvolveClock>();
  private readonly evolveMoves = { next: false, hold: false, drop: false, collapse: false, burst: false };
  private readonly evolveView: Record<string, number> = {};
  private readonly evolveWalls = new Map<string, number>();
  private readonly evolveLive = new Map<string, EvolveLive>();
  private readonly evolveEntries = new Map<string, EvolveEntry>();
  private readonly sampleEntry: EvolveEntry = this.createEntry();
  private readonly sampleRuntime: MeridianRuntime = { live: false };
  private readonly evaluated = new Map<string, Layer>();
  private readonly flashGuard = new FlashGuard();
  private readonly guardSettings: Record<string, number> = { safetyFlashGuard: 0, safetyMaxFlashes: 3, safetyRedLimit: 1, safetyFullField: 1 };
  private readonly exportTables = new Map<string, { gains: Float32Array; saturation: number }>();
  private readonly toneNow: Record<string, number> = {};
  private readonly toneBase: Record<string, number> = {};
  private readonly lightTone: LightTone = { opacity: 1, inks: new Float32Array(9), ground: new Float32Array(3), now: { exposure: 1, contrast: 1, saturation: 1, boost: 1, black: 0, lift: 0 }, base: { exposure: 1, contrast: 1, saturation: 1, boost: 1, black: 0, lift: 0 } };
  private saturationLimit = Infinity;
  private guardSaturation = Infinity;
  private readonly lightGrid = new LightGrid();
  private readonly placement: LightPlacement = { aspect: 1, a: 1, b: 0, c: 0, d: 1, x: 0, y: 0, level: 1, pixel: 1 / 1080, minWidth: 1.5 };
  private readonly measureView = new THREE.Matrix3();
  private compositionStamp = 0;
  private lastComposition: number | null = null;

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

  private loadLive(layer: Layer, structure: Readonly<Record<string, number>> | undefined): void {
    const live = this.live, source = layer.params;
    for (let i = 0; i < ALL_KEYS.length; i++) {
      const value = source[ALL_KEYS[i]];
      live[ALL_KEYS[i]] = Number.isFinite(value) ? value : MERIDIAN_DEFAULTS[ALL_KEYS[i]];
    }
    if (structure) for (let i = 0; i < STRUCTURAL.length; i++) {
      const value = structure[STRUCTURAL[i]];
      live[STRUCTURAL[i]] = Number.isFinite(value) ? value : MERIDIAN_DEFAULTS[STRUCTURAL[i]];
    }
  }

  draw(renderer: THREE.WebGLRenderer, layer: Layer, phase: number, width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw, runtime?: MeridianRuntime): void {
    const live = this.live, source = layer.params;
    this.loadLive(layer, runtime?.structure);
    if (Math.round(live.scoreStyle) === SCORE_STYLE_EVOLVE) { this.drawEvolve(renderer, layer, phase, width, height, target, draw, runtime); return; }
    if (isPulse(live)) { this.drawPulse(renderer, layer, phase, width, height, target, draw, runtime); return; }
    this.pulseSeededScheme = undefined;
    this.shared.uOwnGlow.value = 0;
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
    this.form = score.form;
    sourceViewMatrix(layer.transform, width / height, this.view);
    this.view.invert();
    this.prepareMark(runtime?.mark, position.progress, ends[5], live, width / height);
    this.renderList(renderer, list, live, layer.palette, this.view, layer.transform.scale, position.progress, peak, width, height, target, draw);
  }

  private createEntry(): EvolveEntry {
    return { list: new DisplayList(EVOLVE_ELEMENTS + GLITCH_SHARDS), stamp: -1, phase: 0, seed: 0, scheme: 0, area: 0, red: 0, gain: 1, saturation: Infinity };
  }

  private entryFor(id: string): EvolveEntry {
    let entry = this.evolveEntries.get(id);
    if (!entry) { entry = this.createEntry(); this.evolveEntries.set(id, entry); }
    return entry;
  }

  /**
   * Before any layer is drawn: every Evolve layer's picture for this frame is made and measured, so one Flash Guard budget
   * judges the composition. An export reads a table of the whole loop instead, so no frame depends on render order.
   */
  beginComposition(project: Project, phase: number, width: number, height: number, duration: number, exporting: boolean, runtime: MeridianRuntime): void {
    this.compositionStamp++;
    this.evaluated.clear();
    const settings = this.guardSettings;
    settings.safetyFlashGuard = 0; settings.safetyMaxFlashes = 3; settings.safetyRedLimit = 1; settings.safetyFullField = 1;
    let count = 0;
    for (let i = 0; i < project.layers.length; i++) {
      const original = project.layers[i];
      if (!isEvolveLayer(original)) continue;
      this.evaluated.set(original.id, evaluateLayer(original, phase));
      count++;
      const p = original.params;
      if (read(p, 'safetyFlashGuard') >= .5) {
        settings.safetyFlashGuard = 1;
        settings.safetyMaxFlashes = Math.min(settings.safetyMaxFlashes, read(p, 'safetyMaxFlashes'));
        settings.safetyRedLimit = Math.min(settings.safetyRedLimit, read(p, 'safetyRedLimit'));
        settings.safetyFullField = Math.min(settings.safetyFullField, read(p, 'safetyFullField'));
      }
    }
    if (!count) { this.lastComposition = null; return; }
    let gain = 1;
    this.guardSaturation = Infinity;
    if (exporting) gain = settings.safetyFlashGuard ? this.exportGain(project, phase, width, height, duration) : 1;
    else {
      this.lightGrid.reset(width / height);
      for (let i = 0; i < project.layers.length; i++) {
        const original = project.layers[i];
        if (!isEvolveLayer(original)) continue;
        const layer = this.evaluated.get(original.id)!, entry = this.entryFor(original.id);
        runtime.structure = original.params; runtime.live = !slitActive(original); runtime.duration = duration;
        this.loadLive(layer, original.params);
        this.prepareEvolve(layer, phase, width, height, runtime, entry);
        entry.stamp = this.compositionStamp; entry.phase = phase;
        this.measureEntry(layer, entry, width, height, read(original.params, 'safetyFlashGuard') >= .5, original.params);
      }
      this.lightGrid.finish();
      const now = performance.now(), dt = this.lastComposition === null ? 1 / 60 : Math.min(.25, Math.max(0, (now - this.lastComposition) / 1000));
      this.lastComposition = now;
      gain = this.flashGuard.step(dt, this.lightGrid, settings);
      this.guardSaturation = this.flashGuard.saturationLimit;
    }
    for (let i = 0; i < project.layers.length; i++) {
      const original = project.layers[i];
      if (isEvolveLayer(original)) { const entry = this.entryFor(original.id); const guarded = read(original.params, 'safetyFlashGuard') >= .5; entry.gain = guarded ? gain : 1; entry.saturation = guarded ? this.guardSaturation : Infinity; if (exporting) entry.stamp = this.compositionStamp; }
    }
  }

  /** This frame's evaluated layer, already made for the composition, so it is not evaluated twice. */
  evaluatedFor(original: Layer): Layer | undefined { return this.evaluated.get(original.id); }

  /** What Flash Guard allows this layer's light to be, this frame. Lines stay where they are; only their light is lowered. */
  layerGain(original: Layer): number {
    const entry = this.evolveEntries.get(original.id);
    return entry && entry.stamp === this.compositionStamp && isEvolveLayer(original) ? entry.gain : 1;
  }

  /** The highest saturation Flash Guard allows this layer this frame, so saturated red cannot flash without a change of luminance. */
  layerSaturation(original: Layer): number {
    const entry = this.evolveEntries.get(original.id);
    return entry && entry.stamp === this.compositionStamp && isEvolveLayer(original) ? entry.saturation : Infinity;
  }

  /** A project was loaded: what linked moves changed in the last one must not carry over. */
  resetPerformance(): void {
    this.evolveLive.clear();
    this.flashGuard.reset();
    this.lastComposition = null;
  }

  private exportGain(project: Project, phase: number, width: number, height: number, duration: number): number {
    const total = frameCount(project), evolve = project.layers.filter(isEvolveLayer);
    const key = JSON.stringify([total, project.fps, width / height, duration, this.guardSettings, evolve.map(l => [l.params, l.modulations, l.transform, l.opacity, l.palette])]);
    let table = this.exportTables.get(key);
    if (!table) {
      const fps = project.fps.num / project.fps.den, grid = this.lightGrid, sample = (frame: number) => {
        const at = phaseAtFrame(frame, total);
        grid.reset(width / height);
        for (let i = 0; i < evolve.length; i++) {
          const original = evolve[i], layer = evaluateLayer(original, at), runtime = this.sampleRuntime, entry = this.sampleEntry;
          runtime.structure = original.params; runtime.duration = duration;
          this.loadLive(layer, original.params); this.prepareEvolve(layer, at, width, height, runtime, entry); this.measureEntry(layer, entry, width, height, read(original.params, 'safetyFlashGuard') >= .5, original.params);
        }
        grid.finish();
        return grid;
      };
      const result = { saturation: Infinity };
      table = { gains: guardLoopCells(sample, total, fps, this.guardSettings, result), saturation: result.saturation };
      if (this.exportTables.size >= EXPORT_TABLES) this.exportTables.delete(this.exportTables.keys().next().value as string);
      this.exportTables.set(key, table);
    }
    const wrapped = ((phase % TAU) + TAU) % TAU;
    this.guardSaturation = table.saturation;
    return table.gains[frameAtPhase(wrapped, total) % total];
  }

  /** Adds the layer's own marks to the light grid, through its own placement, opacity and colours. */
  private measureEntry(layer: Layer, entry: EvolveEntry, width: number, height: number, guarded: boolean, saved: Readonly<Record<string, number>> = layer.params): void {
    const p = this.evolveView, aspect = width / height, place = this.placement;
    const zoom = read(p, 'structureZoom') * (1 - 2 * read(p, 'outputSafeMargin')), angle = read(p, 'structureRotation') * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const squash = (1 - read(p, 'structureEllipse') * .6) * (1 - read(p, 'structureTilt') * .62);
    const s00 = cos * zoom, s01 = -sin * zoom * squash, s10 = sin * zoom, s11 = cos * zoom * squash, cx = read(p, 'structureCentreX'), cy = read(p, 'structureCentreY');
    const m = sourceViewMatrix(layer.transform, aspect, this.measureView).invert().elements;
    const u0 = m[0] * (cx + .5) + m[3] * (cy + .5) + m[6], v0 = m[1] * (cx + .5) + m[4] * (cy + .5) + m[7];
    place.aspect = aspect;
    place.a = (m[0] * s00 / aspect + m[3] * s10) * aspect; place.b = (m[0] * s01 / aspect + m[3] * s11) * aspect;
    place.c = m[1] * s00 / aspect + m[4] * s10; place.d = m[1] * s01 / aspect + m[4] * s11;
    place.x = (u0 - .5) * aspect; place.y = v0 - .5;
    place.level = read(p, 'lightExposure') * Math.max(0, layer.opacity);
    place.pixel = 1 / (height * Math.max(layer.transform.scale, .05) * Math.max(zoom * Math.min(1, squash), .05));
    place.minWidth = read(p, 'outputMinLineWidth');
    this.form = undefined;
    this.pulseSeededScheme = evolveScheme(entry.scheme);
    this.setColours(this.live, layer.palette, 0, 0);
    entry.red = this.redShare(p);
    const tone = this.lightTone, inks = this.shared.uInks.value as THREE.Color[], ground = this.resolve.uniforms.uGround.value as THREE.Color;
    for (let i = 0; i < 3; i++) { tone.inks[i * 3] = inks[i].r; tone.inks[i * 3 + 1] = inks[i].g; tone.inks[i * 3 + 2] = inks[i].b; }
    tone.ground[0] = ground.r; tone.ground[1] = ground.g; tone.ground[2] = ground.b; tone.opacity = layer.opacity;
    this.toneCurve(p, this.toneNow, tone.now); this.toneCurve(saved, this.toneBase, tone.base);
    entry.area = this.lightGrid.addLayer(entry.list, place, entry.red, guarded, tone);
  }

  /** The values the resolve pass will use for these parameters, including what Heat does to them. */
  private toneCurve(source: Readonly<Record<string, number>>, scratch: Record<string, number>, out: ToneCurve): void {
    scratch.outputMinLineWidth = 1.5;
    applyEvolveLight(source, scratch);
    out.exposure = scratch.lightExposure; out.contrast = 1.14 * scratch.lightContrast; out.saturation = scratch.colourSaturation;
    out.boost = 1.02 + .06 * scratch.lightCore + .25 * scratch.lightLineGlow + .3 * scratch.lightBloomAmount;
    out.black = read(source, 'outputBlackLevel'); out.lift = read(source, 'lightBackgroundLift');
  }

  /** Moves this layer's clock on and draws its list. Runs once per composition frame. */
  private prepareEvolve(layer: Layer, phase: number, width: number, height: number, runtime: MeridianRuntime | undefined, entry: EvolveEntry): void {
    const live = this.live, duration = runtime?.duration ?? DEFAULT_LOOP_FRAMES / 30, structure = runtime?.structure ?? layer.params;
    let seed = live.seed >>> 0;
    const performer = runtime?.live ? this.evolvePerformer(layer, seed) : null;
    if (performer) { performer.overrides.apply(structure, live); if (performer.overrides.seed !== null) seed = performer.overrides.seed; }
    const view = Object.assign(this.evolveView, live), list = runtime?.list;
    let scheme = seed;
    if (runtime?.live && performer) {
      let transport = this.evolveTransports.get(layer.id);
      if (!transport) { transport = createEvolveTransport(); this.evolveTransports.set(layer.id, transport); }
      const now = performance.now(), last = this.evolveWalls.get(layer.id), wall = last === undefined ? 0 : (now - last) / 1000;
      this.evolveWalls.set(layer.id, now);
      if (wall > .25) transport.lastPhase = null; // Back after a gap, such as another style: carry on from here rather than leaping.
      const moves = this.evolveMoves, edit = performer.router.read(heldMoves, layer.id, layer.params, moves);
      if (edit.kind !== 'none') {
        this.applyLinkedEdit(performer, edit, layer, structure, seed);
        performer.overrides.apply(structure, live);
        Object.assign(view, live);
        if (performer.overrides.seed !== null) seed = performer.overrides.seed;
      }
      const input = performer.input;
      input.dt = Math.min(wall, .25); input.signals = runtime.signals ?? NO_SIGNALS; input.params = live; input.externalTempo = runtime.externalTempo === true;
      const frame = performer.conductor.update(input);
      performer.light.update(frame, live, input.dt, transport.clock.music);
      musicStatus.status = frame.status; musicStatus.bpm = frame.bpm;
      transport.clock.aspect = width / height;
      const clock = advanceEvolve(transport, phase, duration, wall, seed, live, moves);
      Object.assign(view, transport.values);
      if (!list) evaluateEvolve(seed, clock, view, entry.list);
      scheme = clock.schemeSeed;
    } else {
      this.exactView(view, runtime);
      let exact = this.evolveExact.get(layer.id);
      if (!exact) { exact = createEvolveClock(); this.evolveExact.set(layer.id, exact); }
      exact.aspect = width / height;
      const clock = exactEvolveClock(phase, duration, view, exact);
      if (!list) evaluateEvolve(seed, clock, view, entry.list);
    }
    entry.seed = seed; entry.scheme = scheme;
  }

  /** An animated Speed, Evolution or ring rotation would change how many turns the closed path makes, so the saved values set it. */
  private exactView(view: Record<string, number>, runtime: MeridianRuntime | undefined): void {
    const live = this.live;
    view.macroSpeed = runtime?.structure?.macroSpeed ?? live.macroSpeed;
    view.scoreEvolution = runtime?.structure?.scoreEvolution ?? live.scoreEvolution;
    view.ringRotationSpeed = runtime?.structure?.ringRotationSpeed ?? live.ringRotationSpeed;
    view.ringCounterRotation = runtime?.structure?.ringCounterRotation ?? live.ringCounterRotation;
  }

  /** Evolve: free-running and eased in the preview, an exact closed path in an export. It has no Rest, so the Mark stays off. */
  private drawEvolve(renderer: THREE.WebGLRenderer, layer: Layer, phase: number, width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw, runtime?: MeridianRuntime): void {
    const live = this.live, entry = this.entryFor(layer.id);
    if (runtime?.live && !runtime.list && entry.stamp === this.compositionStamp && entry.phase === phase) {
      // Already moved on and drawn for this frame; only the values the light needs are read back.
      this.evolveLive.get(layer.id)?.overrides.apply(runtime.structure ?? layer.params, live);
      Object.assign(this.evolveView, live);
      const transport = this.evolveTransports.get(layer.id);
      if (transport) Object.assign(this.evolveView, transport.values);
    } else this.prepareEvolve(layer, phase, width, height, runtime, entry);
    const view = this.evolveView, list = runtime?.list ?? entry.list;
    applyEvolveLight(view, live);
    this.tearAmount = 0;
    this.markAlpha = 0;
    this.form = undefined;
    this.pulseSeededScheme = evolveScheme(entry.scheme);
    this.shared.uOwnGlow.value = 1;
    sourceViewMatrix(layer.transform, width / height, this.view);
    this.view.invert();
    this.saturationLimit = entry.stamp === this.compositionStamp ? entry.saturation : Infinity;
    this.renderList(renderer, list, live, layer.palette, this.view, layer.transform.scale, 0, 0, width, height, target, draw);
    this.saturationLimit = Infinity;
  }

  private evolvePerformer(layer: Layer, seed: number): EvolveLive {
    let state = this.evolveLive.get(layer.id);
    if (!state) { state = { conductor: new Conductor(), light: new MusicLight(), router: new MoveRouter(), overrides: new LinkedOverrides(), baseSeed: seed, presses: 0, input: { dt: 0, signals: NO_SIGNALS, params: this.live, externalTempo: false } }; this.evolveLive.set(layer.id, state); }
    if (state.baseSeed !== seed) { state.baseSeed = seed; state.overrides.seed = null; } // The performer chose a seed, which replaces a linked one.
    return state;
  }

  /** A linked Mutate, Reseed or Recall lasts for this session and never edits the show. */
  private applyLinkedEdit(state: EvolveLive, edit: LinkedEdit, layer: Layer, structure: Readonly<Record<string, number>>, seed: number): void {
    state.presses++;
    const picked = (Math.imul(seed ^ 0x51ed270b, 0x9e3779b1) + Math.imul(state.presses, 0x85ebca6b)) >>> 0;
    if (edit.kind === 'reseed' && !layer.meridian?.locks.includes('Score')) state.overrides.seed = 1 + picked % MAX_STORED_SEED;
    else if (edit.kind === 'recall') { const stored = layer.params[`seedSlot${edit.slot}`]; if (stored) state.overrides.seed = stored >>> 0; }
    else if (edit.kind === 'mutate') {
      const current = { ...structure };
      state.overrides.apply(structure, current);
      state.overrides.mutated(structure, applyLockedVariation({ ...layer, params: current }, picked, 'mutate').params);
    }
  }

  /** How saturated a red the current inks are, 0 to 1. */
  private redShare(p: Readonly<Record<string, number>>): number {
    const inks = this.shared.uInks.value;
    let red = 0;
    for (let i = 0; i < inks.length; i++) red = Math.max(red, inks[i].r - Math.max(inks[i].g, inks[i].b));
    return Math.min(1, red * Math.min(1, read(p, 'colourSaturation')));
  }

  /** Pulse: the sequencer draws the picture and carries its own brief, local tears, so the full-frame tear stays off. */
  private drawPulse(renderer: THREE.WebGLRenderer, layer: Layer, phase: number, width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw, runtime?: MeridianRuntime): void {
    const live = this.live, seed = live.seed >>> 0, duration = runtime?.duration ?? DEFAULT_LOOP_FRAMES / 30;
    applyPulseLight(layer.params, live);
    let clock: PulseClock;
    if (runtime?.live) {
      let transport = this.transports.get(layer.id);
      if (!transport) { transport = createTransport(); this.transports.set(layer.id, transport); }
      clock = advanceTransport(transport, phase, duration, live, this.pulseClock);
    } else clock = exactClock(Number.isFinite(phase) ? phase / TAU : 0, duration, live, this.pulseClock);
    let list = runtime?.list;
    if (!list) { list = this.list; evaluatePulse(seed, clock, live, list); }
    this.tearAmount = 0;
    this.form = undefined;
    this.pulseSeededScheme = pulseScheme(seed, clock);
    this.shared.uOwnGlow.value = 1;
    const progress = (clock.tick + clock.frac) / clock.ticks;
    sourceViewMatrix(layer.transform, width / height, this.view);
    this.view.invert();
    this.prepareMark(runtime?.mark, progress, pulseRestStart(seed, clock), live, width / height);
    this.renderList(renderer, list, live, layer.palette, this.view, layer.transform.scale, progress, 0, width, height, target, draw);
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
    const seed = (score.seed ^ Math.imul(Math.round(read(p, 'glitchSeed')), 0x9e3779b1)) >>> 0;
    // The tear comes in bursts: the first always lands, then runs of holds alternate between rips and a nearly clean picture.
    const burst = tearNoise(seed, Math.floor(step / TEAR_BURST_HOLDS), 5) / 97;
    const gate = step < TEAR_BURST_HOLDS ? .55 : burst < .42 ? .08 : burst < .8 ? .28 : .6;
    const amount = Math.min(1, glitch * shape * gate);
    if (amount <= 0) return 0;
    const u = this.tear.uniforms;
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

  /** The Mark opens from the final point early in Rest and closes back into it before the next Seed. */
  private prepareMark(mark: MeridianRuntime['mark'], progress: number, restStart: number, p: Readonly<Record<string, number>>, aspect: number): void {
    const rest = Math.max(1 - restStart, 1e-6), into = (progress - restStart) / rest;
    this.markAlpha = mark && into > 0 ? smoothRange(into, 0, MARK_IN) * (1 - smoothRange(into, 1 - MARK_OUT, 1)) : 0;
    if (!mark || this.markAlpha <= 0) return;
    const u = this.markPass.uniforms, grow = .86 + .14 * smoothRange(into, 0, MARK_IN), place = this.markPlacement;
    u.uMark.value = mark.texture;
    u.uAlpha.value = this.markAlpha;
    place.aspect = aspect;
    place.zoom = read(p, 'structureZoom') * (1 - 2 * read(p, 'outputSafeMargin'));
    place.rotation = read(p, 'structureRotation') * Math.PI / 180;
    place.centreX = read(p, 'structureCentreX');
    place.centreY = read(p, 'structureCentreY');
    place.height = MARK_HEIGHT * grow;
    place.width = place.height * (mark.width / mark.height);
    markFromOutput(place, this.markMatrix);
    (u.uMarkFrom.value as THREE.Matrix3).fromArray(this.markMatrix);
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
        if (d[at + 6] < 0 && d[at] !== PRIMITIVE.ring) continue; // A heavy band would smear across the frame; the hero's whole ring may echo.
        list.push(d[at], d[at + 1], d[at + 2], d[at + 3], d[at + 4], d[at + 5], d[at + 6], d[at + 7] * .4, d[at + 8], d[at + 9] * fade, d[at + 10], d[at + 11]);
      }
    }
  }

  /** Draws a ready-made list with no phrase behind it. Live input and the checks use this. */
  drawList(renderer: THREE.WebGLRenderer, list: DisplayList, params: Readonly<Record<string, number>>, palette: readonly string[], width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw): void {
    this.tearAmount = 0;
    this.markAlpha = 0;
    this.form = undefined;
    this.pulseSeededScheme = undefined;
    this.shared.uOwnGlow.value = 0;
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
    r.uSaturation.value = Math.min(read(p, 'colourSaturation'), this.saturationLimit);
    r.uVignette.value = read(p, 'lightVignette');
    r.uLift.value = read(p, 'lightBackgroundLift');
    r.uBlack.value = read(p, 'outputBlackLevel');
    r.uTransparent.value = read(p, 'outputTransparent') >= .5 ? 1 : 0;
    if (this.tearAmount <= 0 && this.markAlpha <= 0) { draw(this.resolve, target); return; }
    if (this.untorn.width !== width || this.untorn.height !== height) this.untorn.setSize(width, height);
    draw(this.resolve, this.untorn);
    if (this.tearAmount <= 0) {
      this.markPass.uniforms.uImage.value = this.untorn.texture;
      draw(this.markPass, target);
      return;
    }
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
    const seeded = this.form?.scheme ?? this.pulseSeededScheme;
    const scheme = this.schemeIndex(p.colourPalette, seeded);
    const main = scheme > 0 ? MERIDIAN_SCHEMES[scheme - 1].swatches : palette;
    for (let i = 0; i < 6; i++) {
      const hex = main[i] ?? FALLBACK_PALETTE[i];
      if (this.parsed[i] !== hex) { this.swatches[i].set(hex); this.parsed[i] = hex; }
    }
    const peakScheme = this.pulseSeededScheme !== undefined ? 0 : this.schemeIndex(p.colourPeakPalette, this.form?.peakScheme);
    if (peakScheme !== this.parsedPeak) {
      this.parsedPeak = peakScheme;
      if (peakScheme > 0) for (let i = 0; i < 6; i++) this.peakSwatches[i].set(MERIDIAN_SCHEMES[peakScheme - 1].swatches[i]);
    }
    const u = this.shared, inks = u.uInks.value;
    const base = clampIndex(p.colourBase, 0), accent = clampIndex(p.colourAccent, 1), second = accent === 2 ? 1 : 2;
    const mono = (p.outputMono ?? 0) >= .5;
    this.ink(inks[0], base, peakScheme, peak, p, progress);
    this.ink(inks[1], mono ? base : accent, peakScheme, peak, p, progress);
    this.ink(inks[2], mono ? base : second, peakScheme, peak, p, progress);
    this.ink(u.uHot.value, 3, peakScheme, peak, p, progress);
    this.ink(u.uHalo.value, mono ? base : 4, peakScheme, peak, p, progress);
    // A seeded Pulse phrase borrows only its accents: the lines stay white.
    if (this.pulseSeededScheme !== undefined && Math.round(p.colourPalette ?? 0) === SEED_SCHEME) { inks[0].setRGB(1, 1, 1); if (mono) { inks[1].setRGB(1, 1, 1); inks[2].setRGB(1, 1, 1); } (u.uHot.value as THREE.Color).setRGB(1, 1, 1); (u.uHalo.value as THREE.Color).setRGB(1, 1, 1); }
    (this.resolve.uniforms.uGround.value as THREE.Color).copy(this.swatches[5]);
    if (this.pulseSeededScheme !== undefined && Math.round(p.colourPalette ?? 0) === SEED_SCHEME) (this.resolve.uniforms.uGround.value as THREE.Color).set(PULSE_GROUND);
  }

  /** A Palette value as a scheme number. Seed chooses takes the composition's own; with no composition it means none. */
  private schemeIndex(value: number | undefined, seeded: number | undefined): number {
    const index = Math.max(0, Math.min(SEED_SCHEME, Math.round(value ?? 0)));
    return index === SEED_SCHEME ? seeded ?? 0 : index;
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
    this.curveMaterial.dispose(); this.markMaterial.dispose(); this.resolve.dispose(); this.tear.dispose(); this.markPass.dispose();
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
