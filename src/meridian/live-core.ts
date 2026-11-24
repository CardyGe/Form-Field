/**
 * Meridian Live's frame-by-frame logic, without the graphics card: whether the camera is there, how people are found, the
 * bodies, the interactions, and the values Evolve draws with. The Live look (src/live/Meridian.ts) feeds it the presence grid
 * and calls `influence` from inside Evolve's own frame. Bodies and grids live only here, in memory, and are never kept.
 */
import { BodyTracker, GRID_HEIGHT, GRID_WIDTH, type Body } from './bodies';
import { Interactions, LIVE_DEFAULTS, type InteractionFrame, type PresenceField } from './interactions';
import type { DisplayList } from './display-list';
import { MERIDIAN_DEFAULTS } from './parameters';
import { MERIDIAN_LOOKS } from './presets';
import { SCORE_STYLE_EVOLVE } from './evolve';

/** Without a new camera frame for this long, the camera is lost. */
export const CAMERA_LOST_SECONDS = 0.5;
export const STATUS_CAMERA_LOST = 'Camera lost · attract';
export const STATUS_MOVEMENT_ONLY = 'Movement only';

export interface LiveFeedState {
  /** A new camera frame was analysed this display frame. */
  fresh: boolean;
  /** The people model is answering. */
  peopleReady: boolean;
  /** The people model could not start or broke. */
  peopleFailed: boolean;
}

/** People from the model, or, without it, recent movement. */
export type PresenceMode = 'people' | 'movement';

/** Values the Live look always draws with: the structure placed plainly in the frame, so people land where they are. */
const FIXED: Readonly<Record<string, number>> = {
  scoreStyle: SCORE_STYLE_EVOLVE, structureZoom: 1, structureCentreX: 0, structureCentreY: 0, structureRotation: 0, structureEllipse: 0, structureTilt: 0,
  outputSafeMargin: 0, outputTransparent: 0, safetyFlashGuard: 1,
};
const PASSED = ['macroDensity', 'macroTension', 'macroOrder', 'macroSpeed', 'macroWeight', 'macroHeat', 'macroScale', 'colourPalette', 'moveNext', 'moveHold', 'moveCollapse'] as const;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const finite = (v: number | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export class MeridianLiveCore {
  readonly tracker = new BodyTracker();
  readonly interactions = new Interactions();
  bodies: readonly Body[] = [];
  mode: PresenceMode = 'movement';
  cameraLost = true;
  frame: InteractionFrame = { attract: 0, crowdEnergy: 0, requestDrop: false, requestBurst: false, links: 0, merges: 0, releases: 0, throws: 0, charge: 0, evolutionLift: 0, lightLift: 0, bodies: 0 };
  private sinceFrame = Infinity;
  private readonly field: PresenceField = { data: new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4), width: GRID_WIDTH, height: GRID_HEIGHT, stride: 4 };
  private haveField = false;
  private readonly trackerSettings = { maxBodies: 8, followSpeed: 0.5, minSize: 0.006, movementOnly: false };
  private presetId: string | null | undefined;
  private preset: Readonly<Record<string, number>> = {};
  private drop = false; private burst = false;
  private readonly context = { aspect: 16 / 9, beats: 0, bpm: 124, time: 0, presence: null as PresenceField | null, cameraLost: true, movementOnly: false };

  /** What the operator sees under the picture. */
  get status(): string {
    if (this.cameraLost) return STATUS_CAMERA_LOST;
    const n = this.frame.bodies, who = n === 0 ? 'Nobody there · attract' : `${n} ${n === 1 ? 'person' : 'people'}`;
    return this.mode === 'movement' ? `${STATUS_MOVEMENT_ONLY} · ${who}` : who;
  }

  /** Clear: the room's memory goes (bodies, charges, what waits for the beat); the picture fades rather than cuts. */
  clear(): void {
    this.tracker.reset(); this.interactions.forget(); this.bodies = [];
    this.drop = false; this.burst = false;
  }

  reset(): void {
    this.tracker.reset(); this.interactions.reset(); this.bodies = [];
    this.sinceFrame = Infinity; this.cameraLost = true; this.haveField = false; this.drop = false; this.burst = false;
  }

  /** Each display frame, before the grid: is the camera there, and how are people found. */
  step(dt: number, feed: LiveFeedState): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.sinceFrame = feed.fresh ? 0 : this.sinceFrame + step;
    const lost = this.sinceFrame > CAMERA_LOST_SECONDS;
    if (lost && !this.cameraLost) { this.tracker.reset(); this.bodies = []; this.haveField = false; }
    this.cameraLost = lost;
    // A people model that has failed, or has not answered yet, leaves movement to find people.
    this.mode = feed.peopleReady && !feed.peopleFailed ? 'people' : 'movement';
  }

  /** A presence grid arrived (RGBA, row 0 at the bottom). `dt` is the time since the last one. */
  grid(data: Uint8Array, width: number, height: number, dt: number, values: Readonly<Record<string, number>>): void {
    if (this.cameraLost) return;
    const s = this.trackerSettings;
    s.maxBodies = Math.round(clamp(finite(values.liveMaxBodies, 8), 1, 8));
    s.followSpeed = clamp(finite(values.liveFollow, 0.5), 0, 1);
    s.movementOnly = this.mode === 'movement';
    this.bodies = this.tracker.update(data, width, height, dt, s);
    if (width === GRID_WIDTH && height === GRID_HEIGHT && data.length >= this.field.data.length) { this.field.data.set(data.subarray(0, this.field.data.length)); this.haveField = true; }
  }

  /**
   * The layer's values for this frame: the Studio look it started from, the Live values over it, the structure placed plainly,
   * what the crowd lifts, and the moves people and the operator have asked for. `out` is reused from frame to frame.
   */
  params(values: Readonly<Record<string, number>> & { seed?: number; preset?: string | null }, out: Record<string, number>): void {
    if (values.preset !== this.presetId) {
      this.presetId = values.preset;
      this.preset = MERIDIAN_LOOKS.find(l => l.id === values.preset)?.params ?? {};
      for (const key in MERIDIAN_DEFAULTS) out[key] = MERIDIAN_DEFAULTS[key];
      for (const key in this.preset) out[key] = this.preset[key];
    }
    for (const key in FIXED) out[key] = FIXED[key];
    for (let i = 0; i < PASSED.length; i++) { const key = PASSED[i]; out[key] = finite(values[key], MERIDIAN_DEFAULTS[key]); }
    for (const key in LIVE_DEFAULTS) out[key] = finite(values[key], LIVE_DEFAULTS[key as keyof typeof LIVE_DEFAULTS]);
    out.seed = finite(values.seed, MERIDIAN_DEFAULTS.seed);
    const f = this.frame, attract = f.attract * clamp(finite(values.liveAttract, 0.8), 0, 1);
    out.scoreEvolution = clamp(finite(values.scoreEvolution, 0.5) + 0.25 * f.evolutionLift + 0.12 * attract, 0, 1);
    out.lightExposure = finite(this.preset.lightExposure, MERIDIAN_DEFAULTS.lightExposure) * (1 + 0.15 * f.lightLift);
    out.moveDrop = this.drop || finite(values.moveDrop, 0) >= 0.5 ? 1 : 0;
    out.moveBurst = this.burst || finite(values.moveBurst, 0) >= 0.5 ? 1 : 0;
    this.drop = false; this.burst = false;
  }

  /** Called from inside Evolve's frame, once it has drawn: people move the structure. */
  influence(list: DisplayList, beats: number, bpm: number, aspect: number, time: number, dt: number, values: Readonly<Record<string, number>>): InteractionFrame {
    const c = this.context;
    c.aspect = aspect; c.beats = beats; c.bpm = bpm; c.time = time; c.cameraLost = this.cameraLost; c.movementOnly = this.mode === 'movement';
    c.presence = this.haveField && !this.cameraLost ? this.field : null;
    const frame = this.interactions.update(this.cameraLost ? NOBODY : this.bodies, c, values, dt, list);
    // The Drop and the room-wide ripple reach Evolve as moves on the next frame.
    if (frame.requestDrop) this.drop = true;
    if (frame.requestBurst) this.burst = true;
    this.frame = frame;
    return frame;
  }
}

const NOBODY: readonly Body[] = [];
