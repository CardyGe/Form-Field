/**
 * Meridian Live's interactions: how people in the room move the living structure.
 *
 * Evolve keeps drawing its own slow structure. This adds to the same display list, as continuous influences rather than
 * events that cut: the structure's own rings lean toward people, every person is given a small ring system of their own,
 * and stillness, speed and closeness each change something a stranger can read at a glance.
 *
 *   Orbit          a ring system drifts out of the structure to each person, and follows them
 *   Constellation  a spoke links two people standing near each other
 *   Merge          people close together are drawn into one larger structure (with hysteresis)
 *   Throw          fast motion fires spokes and a ripple of light along the motion
 *   Charge         stillness fills a ring around the person and swells the hero
 *   Release        moving suddenly after charging releases one bloom of light
 *   Conduct        a moving crowd gently raises Evolution and light, and can ask for one Drop, then rests
 *   Lattice        a field of points lights up inside people's silhouettes and leaves a fading wake
 *   Attract        with nobody present, slow rings call people in
 *   Beat snap      the large consequences (bloom, Drop, ripple) can wait for the next beat; a Throw never waits
 *
 * Every mark keeps the structure's motion limits: no mark moves more than 1.2% of the frame height, or changes its light by
 * more than 0.08, in one 60 fps frame. A person's influence therefore glides however suddenly they move or are lost.
 * Pure: no three, DOM or React, and nothing is allocated per frame.
 */
import { STRIDE, type DisplayList } from './display-list';
import { ARC_SLOTS, EVOLVE_ELEMENTS, GLITCH_SHARDS, NODE_VOICES, RING_VOICES, SPOKE_VOICES } from './evolve';
import { PRIMITIVE } from './types';
import { MAX_BODIES, type Body } from './bodies';

export type LiveKey =
  | 'liveOrbit' | 'liveConstellation' | 'liveMerge' | 'liveThrow' | 'liveCharge' | 'liveLattice' | 'liveCrowd' | 'liveAttract'
  | 'liveMaxBodies' | 'liveFollow' | 'liveBodyScale' | 'liveLinkDistance' | 'liveMergeDistance' | 'liveThrowSensitivity'
  | 'liveChargeSeconds' | 'liveReleaseStrength' | 'liveCrowdThreshold' | 'liveSilhouette' | 'liveWake' | 'liveBeatSnap'
  | 'liveAlignX' | 'liveAlignY' | 'liveAlignScale';

export interface LiveParameter { key: LiveKey; label: string; min: number; max: number; step: number; default: number; group: 'Mix' | 'People' | 'Alignment'; description: string }

/** The interaction mix, then how people are read, then how the camera lines up with the picture. */
export const LIVE_PARAMETERS: readonly LiveParameter[] = [
  { key: 'liveOrbit', label: 'Orbit', min: 0, max: 1, step: 0.01, default: 0.8, group: 'Mix', description: 'A ring system drifts out to each person and follows them.' },
  { key: 'liveConstellation', label: 'Constellation', min: 0, max: 1, step: 0.01, default: 0.7, group: 'Mix', description: 'A spoke links people standing near each other.' },
  { key: 'liveMerge', label: 'Merge', min: 0, max: 1, step: 0.01, default: 0.7, group: 'Mix', description: 'People close together are drawn into one larger structure.' },
  { key: 'liveThrow', label: 'Throw', min: 0, max: 1, step: 0.01, default: 0.8, group: 'Mix', description: 'Fast movement fires spokes and a ripple of light along it.' },
  { key: 'liveCharge', label: 'Charge and release', min: 0, max: 1, step: 0.01, default: 0.8, group: 'Mix', description: 'Standing still fills a ring and swells the hero. Moving suddenly afterwards releases a bloom of light.' },
  { key: 'liveLattice', label: 'Lattice', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Mix', description: 'Points light up inside people and leave a fading wake.' },
  { key: 'liveCrowd', label: 'Conduct', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Mix', description: 'A crowd moving together raises Evolution and light, and can bring a Drop.' },
  { key: 'liveAttract', label: 'Attract', min: 0, max: 1, step: 0.01, default: 0.8, group: 'Mix', description: 'With nobody there, slow rings invite people in.' },
  { key: 'liveMaxBodies', label: 'Most people', min: 1, max: MAX_BODIES, step: 1, default: MAX_BODIES, group: 'People', description: 'The most people followed at once. The largest are kept.' },
  { key: 'liveFollow', label: 'Follow speed', min: 0, max: 1, step: 0.01, default: 0.5, group: 'People', description: 'How closely the rings keep up with people.' },
  { key: 'liveBodyScale', label: 'Ring size', min: 0.3, max: 2, step: 0.01, default: 1, group: 'People', description: 'The size of each person\'s ring system against their height.' },
  { key: 'liveLinkDistance', label: 'Link distance', min: 0.1, max: 1.2, step: 0.01, default: 0.6, group: 'People', description: 'How near two people must be to be linked, in frame heights.' },
  { key: 'liveMergeDistance', label: 'Merge distance', min: 0.05, max: 0.5, step: 0.01, default: 0.22, group: 'People', description: 'How near two people must be to merge, in frame heights.' },
  { key: 'liveThrowSensitivity', label: 'Throw sensitivity', min: 0.2, max: 3, step: 0.01, default: 1, group: 'People', description: 'Higher fires a Throw from slower movement.' },
  { key: 'liveChargeSeconds', label: 'Charge time', min: 0.5, max: 8, step: 0.1, default: 2.5, group: 'People', description: 'Seconds of stillness to charge fully.' },
  { key: 'liveReleaseStrength', label: 'Release strength', min: 0, max: 1, step: 0.01, default: 0.7, group: 'People', description: 'How large the bloom of a release is.' },
  { key: 'liveCrowdThreshold', label: 'Crowd threshold', min: 0.1, max: 1, step: 0.01, default: 0.45, group: 'People', description: 'How much the crowd must move together before it conducts.' },
  { key: 'liveSilhouette', label: 'Silhouette', min: 0, max: 1, step: 0.01, default: 0.7, group: 'People', description: 'How brightly the lattice draws people.' },
  { key: 'liveWake', label: 'Wake length', min: 0.2, max: 6, step: 0.1, default: 1.5, group: 'People', description: 'Seconds the lattice keeps glowing where someone has been.' },
  { key: 'liveBeatSnap', label: 'Beat snap', min: 0, max: 1, step: 0.01, default: 0.5, group: 'People', description: 'From free reaction at 0 to every large consequence landing on the next beat at 1.' },
  { key: 'liveAlignX', label: 'Camera left / right', min: -0.5, max: 0.5, step: 0.01, default: 0, group: 'Alignment', description: 'Slides where people appear, to line the camera up with the picture.' },
  { key: 'liveAlignY', label: 'Camera up / down', min: -0.5, max: 0.5, step: 0.01, default: 0, group: 'Alignment', description: 'Slides where people appear, up or down.' },
  { key: 'liveAlignScale', label: 'Camera scale', min: 0.5, max: 2, step: 0.01, default: 1, group: 'Alignment', description: 'Spreads or gathers where people appear.' },
];
export const LIVE_DEFAULTS: Readonly<Record<LiveKey, number>> = Object.freeze(Object.fromEntries(LIVE_PARAMETERS.map(p => [p.key, p.default])) as Record<LiveKey, number>);

/** The presence grid, as read back: R is presence. Row 0 at the bottom. */
export interface PresenceField { data: Uint8Array; width: number; height: number; stride: number }
export interface InteractionContext {
  /** The output's width over its height. */
  aspect: number;
  /** The Conductor's beat position and tempo. */
  beats: number; bpm: number;
  /** Seconds, for slow cycles only. */
  time: number;
  /** The last presence grid, for the lattice. Null: nobody is inside anything. */
  presence: PresenceField | null;
  /** No camera frames: everyone is treated as gone and Attract comes in quickly. */
  cameraLost: boolean;
  /** People are found from movement alone, which light or a projection in view can fake: no Throw and no Release. */
  movementOnly?: boolean;
}
export interface InteractionFrame {
  /** 0 to 1: how far Attract has come in. */
  attract: number;
  /** 0 to 1: how much the room moves together. */
  crowdEnergy: number;
  /** True on the one frame a Drop should start, and a room-wide ripple of light. */
  requestDrop: boolean; requestBurst: boolean;
  links: number; merges: number;
  /** Counted since reset. */
  releases: number; throws: number;
  /** The strongest charge in the room, 0 to 1. */
  charge: number;
  /** 0 to 1, eased: how much the crowd lifts Evolution and light. */
  evolutionLift: number; lightLift: number;
  /** People being followed. */
  bodies: number;
}

const TAU = Math.PI * 2;
const PX = 1 / 1080;
/** Where Evolve's marks end and the Live marks begin. Evolve's glitch shards may or may not be there, so their room is kept. */
const BASE = EVOLVE_ELEMENTS + GLITCH_SHARDS;
const SPOKE_LIST = RING_VOICES * ARC_SLOTS, NODE_LIST = SPOKE_LIST + SPOKE_VOICES * 2;
export const HERO_INDEX = NODE_LIST + NODE_VOICES;

const ORBIT_MARKS = 8;     // two rings, four turning arcs, a centre point and the charge ring
const PAIRS = (MAX_BODIES * (MAX_BODIES - 1)) / 2;
const LINK_MARKS = 2;      // the spoke and its middle point
const THROWS = 6, THROW_MARKS = 5;
const BLOOMS = 4, BLOOM_MARKS = 2;
export const LATTICE_COLS = 32, LATTICE_ROWS = 18;
const ATTRACT_MARKS = 3;
const ORBIT_AT = BASE, LINK_AT = ORBIT_AT + MAX_BODIES * ORBIT_MARKS, MERGE_AT = LINK_AT + PAIRS * LINK_MARKS, THROW_AT = MERGE_AT + PAIRS;
const BLOOM_AT = THROW_AT + THROWS * THROW_MARKS, LATTICE_AT = BLOOM_AT + BLOOMS * BLOOM_MARKS, ATTRACT_AT = LATTICE_AT + LATTICE_COLS * LATTICE_ROWS;
const END = ATTRACT_AT + ATTRACT_MARKS;
const OWN = END - BASE;
/** Display list capacity for Evolve with the Live marks. */
export const LIVE_CAPACITY = END;
export const LIVE_SLOTS = { base: BASE, orbit: ORBIT_AT, orbitMarks: ORBIT_MARKS, links: LINK_AT, merge: MERGE_AT, throws: THROW_AT, throwMarks: THROW_MARKS, blooms: BLOOM_AT, lattice: LATTICE_AT, attract: ATTRACT_AT, attractMarks: ATTRACT_MARKS } as const;

const MOVE_LIMIT = 0.0115;   // Frame heights per 60 fps frame, inside the structure's 1.2%.
const ALPHA_LIMIT = 0.075;   // Light per 60 fps frame, inside the structure's 0.08.
const LEAN_STEP = 0.004;     // The most a voice's lean may change in a frame.
const UNSEEN = 0.012;
const ORBIT_SHARE = 0.85;    // Share of the move limit an orbit may use, so the clamp seldom has to act.
const THROW_SPEED = 1.1;     // Frame heights per second, at sensitivity 1.
const THROW_COOLDOWN = 0.7;
const THROW_SECONDS = 1.1, BLOOM_SECONDS = 1.8;
const RELEASE_AT = 0.55;     // Charge needed for a release.
const CONDUCT_HOLD = 1.5, CONDUCT_COOLDOWN = 20;
const EMPTY_GRACE = 0.6;
const FAN = [-0.16, -0.05, 0.05, 0.16], FAN_LENGTH = [0.8, 1, 1, 0.8];
const PENDING = 8;
const KIND_BLOOM = 1, KIND_DROP = 2, KIND_BURST = 3;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const finite = (v: number | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const smooth = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const ease = (dt: number, tau: number): number => 1 - Math.exp(-dt / Math.max(1e-4, tau));
const toward = (from: number, to: number, most: number): number => from + clamp(to - from, -most, most);
const wrapAngle = (a: number): number => a - TAU * Math.round(a / TAU);

const PAIR_A = new Uint8Array(PAIRS), PAIR_B = new Uint8Array(PAIRS);
{ let k = 0; for (let a = 0; a < MAX_BODIES; a++) for (let b = a + 1; b < MAX_BODIES; b++) { PAIR_A[k] = a; PAIR_B[k] = b; k++; } }

/** Both ends of a mark, in frame heights. */
function endsOf(d: Float32Array, at: number, out: Float64Array): void {
  const kind = d[at];
  if (kind === PRIMITIVE.arc) {
    const r = d[at + 3], a = d[at + 4], b = a + d[at + 5];
    out[0] = d[at + 1] + Math.cos(a) * r; out[1] = d[at + 2] + Math.sin(a) * r; out[2] = d[at + 1] + Math.cos(b) * r; out[3] = d[at + 2] + Math.sin(b) * r;
  } else if (kind === PRIMITIVE.segment) { out[0] = d[at + 1]; out[1] = d[at + 2]; out[2] = d[at + 3]; out[3] = d[at + 4]; }
  else { const r = kind === PRIMITIVE.ring ? d[at + 3] : 0; out[0] = d[at + 1] + r; out[1] = d[at + 2]; out[2] = d[at + 1] - r; out[3] = d[at + 2]; }
}

export class Interactions {
  // People this frame, in structure units (frame heights from the centre, y up).
  private readonly px = new Float64Array(MAX_BODIES); private readonly py = new Float64Array(MAX_BODIES);
  private readonly pvx = new Float64Array(MAX_BODIES); private readonly pvy = new Float64Array(MAX_BODIES);
  // One orbit slot per person, kept by id, fading out after they leave.
  private readonly slotId = new Int32Array(MAX_BODIES).fill(-1);
  private readonly slotBody = new Int8Array(MAX_BODIES).fill(-1);
  private readonly ox = new Float64Array(MAX_BODIES); private readonly oy = new Float64Array(MAX_BODIES);
  private readonly or = new Float64Array(MAX_BODIES); private readonly oa = new Float64Array(MAX_BODIES);
  private readonly oturn = new Float64Array(MAX_BODIES); private readonly charge = new Float64Array(MAX_BODIES);
  private readonly cooldown = new Float64Array(MAX_BODIES); private readonly releaseLock = new Float64Array(MAX_BODIES);
  // Pairs: linked light, merged state and how far merged.
  private readonly linkAlpha = new Float64Array(PAIRS);
  private readonly merged = new Uint8Array(PAIRS);
  private readonly mergeAmount = new Float64Array(PAIRS);
  // Throws and blooms.
  private readonly tAge = new Float64Array(THROWS).fill(Infinity);
  private readonly tx = new Float64Array(THROWS); private readonly ty = new Float64Array(THROWS);
  private readonly tdx = new Float64Array(THROWS); private readonly tdy = new Float64Array(THROWS);
  private readonly tr = new Float64Array(THROWS); private readonly tStrength = new Float64Array(THROWS);
  private nextThrow = 0;
  private readonly bAge = new Float64Array(BLOOMS).fill(Infinity);
  private readonly bx = new Float64Array(BLOOMS); private readonly by = new Float64Array(BLOOMS);
  private readonly br = new Float64Array(BLOOMS); private readonly bStrength = new Float64Array(BLOOMS);
  private nextBloom = 0;
  // Large consequences waiting for the beat.
  private readonly qKind = new Uint8Array(PENDING); private readonly qBeat = new Float64Array(PENDING);
  private readonly qWait = new Float64Array(PENDING); private readonly qSlot = new Int8Array(PENDING);
  private readonly qStrength = new Float64Array(PENDING);
  // The lattice and Evolve's own nodes: how lit each still is.
  private readonly wake = new Float32Array(LATTICE_COLS * LATTICE_ROWS);
  private readonly inside = new Uint8Array(LATTICE_COLS * LATTICE_ROWS);
  private readonly nodeWake = new Float32Array(NODE_VOICES);
  private readonly nodeBoost = new Float32Array(NODE_VOICES);
  // Evolve's voices lean toward people, within what is left of each frame's move limit.
  private readonly leanX = new Float64Array(RING_VOICES); private readonly leanY = new Float64Array(RING_VOICES);
  private readonly voiceMove = new Float64Array(RING_VOICES);
  private readonly raw = new Float32Array(BASE * STRIDE);
  private readonly rawLast = new Float32Array(BASE * STRIDE);
  private rawPrimed = false;
  private readonly own = new Float32Array(OWN * STRIDE);
  private ownPrimed = false;
  private readonly a = new Float64Array(4); private readonly b = new Float64Array(4);
  private heroCharge = 0;
  private crowd = 0; private conductTime = 0; private conductCooldown = 0;
  private evolutionLift = 0; private lightLift = 0;
  private emptyTime = 0; private attract = 0;
  private releases = 0; private throws = 0;
  private readonly frame: InteractionFrame = { attract: 0, crowdEnergy: 0, requestDrop: false, requestBurst: false, links: 0, merges: 0, releases: 0, throws: 0, charge: 0, evolutionLift: 0, lightLift: 0, bodies: 0 };

  reset(): void {
    this.slotId.fill(-1); this.slotBody.fill(-1); this.oa.fill(0); this.charge.fill(0); this.cooldown.fill(0); this.releaseLock.fill(0);
    this.linkAlpha.fill(0); this.merged.fill(0); this.mergeAmount.fill(0); this.mergeShown.fill(0); this.crowding = 1;
    this.tAge.fill(Infinity); this.bAge.fill(Infinity); this.qKind.fill(0);
    this.wake.fill(0); this.inside.fill(0); this.nodeWake.fill(0); this.nodeBoost.fill(0);
    this.leanX.fill(0); this.leanY.fill(0);
    this.rawPrimed = false; this.ownPrimed = false;
    this.heroCharge = 0; this.crowd = 0; this.conductTime = 0; this.conductCooldown = 0; this.evolutionLift = 0; this.lightLift = 0;
    this.emptyTime = 0; this.attract = 0; this.releases = 0; this.throws = 0;
  }

  /**
   * One frame, after Evolve has drawn `out`. Bodies are in the camera's uv. Evolve's marks are leaned and lit in place, and
   * the Live marks are written after them at fixed places, so each mark can be followed from frame to frame.
   */
  update(bodies: readonly Body[], ctx: InteractionContext, params: Readonly<Record<string, number>>, dt: number, out: DisplayList): InteractionFrame {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0, frames = clamp(step * 60, 0, 2);
    this.P = params; this.listData = out.data; this.movementOnly = ctx.movementOnly === true;
    this.beats = finite(ctx.beats, 0); this.bpm = finite(ctx.bpm, 120); this.snap = this.v('liveBeatSnap');
    const aspect = finite(ctx.aspect, 16 / 9) > 0 ? finite(ctx.aspect, 16 / 9) : 16 / 9;
    const scale = this.v('liveAlignScale'), alignX = this.v('liveAlignX'), alignY = this.v('liveAlignY');
    const frame = this.frame;
    frame.requestDrop = false; frame.requestBurst = false;

    // Evolve's list, padded to its full length, so the Live marks always sit at the same places.
    const data = out.data, room = Math.floor(data.length / STRIDE);
    while (out.count < BASE && out.count < room) out.push(PRIMITIVE.dot, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    if (out.count > BASE) out.count = Math.min(out.count, BASE);
    const evolveCount = Math.min(out.count, BASE);
    this.raw.set(data.subarray(0, evolveCount * STRIDE));
    this.measureVoices(evolveCount);

    // People, in the structure's units.
    const most = Math.round(this.v('liveMaxBodies'));
    let count = 0;
    if (!ctx.cameraLost) for (let i = 0; i < bodies.length && count < most; i++) {
      const body = bodies[i];
      if (!(body.presence > 0)) continue;
      this.px[count] = ((body.x - 0.5) * scale + alignX) * aspect; this.py[count] = (body.y - 0.5) * scale + alignY;
      this.pvx[count] = body.vx * scale * aspect; this.pvy[count] = body.vy * scale;
      count++;
    }
    frame.bodies = count;
    this.assign(bodies, count, ctx.cameraLost);

    // Who is merged with whom, from where people actually are.
    const mergeDistance = this.v('liveMergeDistance');
    let merges = 0;
    for (let k = 0; k < PAIRS; k++) {
      const i = this.slotBody[PAIR_A[k]], j = this.slotBody[PAIR_B[k]];
      if (i < 0 || j < 0) { this.merged[k] = 0; }
      else {
        const d = Math.hypot(this.px[i] - this.px[j], this.py[i] - this.py[j]);
        if (!this.merged[k] && d < mergeDistance) this.merged[k] = 1;
        else if (this.merged[k] && d > mergeDistance * 1.5) this.merged[k] = 0;
      }
      if (this.merged[k]) merges++;
      this.mergeAmount[k] = toward(this.mergeAmount[k], this.merged[k] ? 1 : 0, step / 1.2);
    }
    frame.merges = merges;

    this.orbits(bodies, ctx, step, frames);
    const links = this.links(step);
    frame.links = links;
    this.conduct(bodies, step);
    this.queueFire(ctx, step);
    this.attractStep(count, ctx.cameraLost, step);
    this.lean(count, step, frames);
    this.lattice(ctx, aspect, scale, alignX, alignY, step, frames, evolveCount);
    this.applyToEvolve(ctx.time, evolveCount);

    // The Live marks.
    if (room >= END) {
      out.count = END;
      this.writeOrbits(data);
      this.writeLinks(data);
      this.writeThrows(data, step);
      this.writeBlooms(data, step);
      this.writeLattice(data, aspect);
      this.writeAttract(data, ctx.time);
      this.guardOwn(data, frames);
    }
    this.rawLast.set(this.raw.subarray(0, evolveCount * STRIDE));
    this.rawPrimed = evolveCount === BASE;

    frame.attract = this.attract; frame.crowdEnergy = this.crowd; frame.releases = this.releases; frame.throws = this.throws;
    frame.charge = this.heroCharge; frame.evolutionLift = this.evolutionLift; frame.lightLift = this.lightLift;
    return frame;
  }

  /** How far each of Evolve's ring voices moved on its own this frame, its nodes included. */
  private measureVoices(count: number): void {
    const move = this.voiceMove;
    move.fill(0);
    if (!this.rawPrimed || count < BASE) { move.fill(MOVE_LIMIT); return; }
    for (let v = 0; v < RING_VOICES; v++) for (let k = 0; k < ARC_SLOTS; k++) move[v] = Math.max(move[v], this.rawMove((v * ARC_SLOTS + k) * STRIDE));
    for (let n = 0; n < NODE_VOICES; n++) { const v = n % 4; move[v] = Math.max(move[v], this.rawMove((NODE_LIST + n) * STRIDE)); }
  }

  private rawMove(at: number): number {
    endsOf(this.rawLast, at, this.a); endsOf(this.raw, at, this.b);
    return Math.max(Math.hypot(this.a[0] - this.b[0], this.a[1] - this.b[1]), Math.hypot(this.a[2] - this.b[2], this.a[3] - this.b[3]));
  }

  /** Keeps each person's orbit slot by id. A new person takes a slot whose last ring has faded. */
  private assign(bodies: readonly Body[], count: number, lost: boolean): void {
    this.slotBody.fill(-1);
    if (lost) { this.slotId.fill(-1); return; }
    // People in this frame, in the order they were counted.
    let seen = 0;
    for (let i = 0; i < bodies.length && seen < count; i++) {
      const body = bodies[i];
      if (!(body.presence > 0)) continue;
      const index = seen++;
      let slot = -1;
      for (let s = 0; s < MAX_BODIES; s++) if (this.slotId[s] === body.id) { slot = s; break; }
      if (slot < 0) {
        let best = -1;
        for (let s = 0; s < MAX_BODIES; s++) if (this.slotId[s] < 0 && this.slotBody[s] < 0 && (best < 0 || this.oa[s] < this.oa[best])) best = s;
        if (best < 0) continue;
        slot = best;
        this.slotId[slot] = body.id;
        // A newcomer starts their own charge, whoever had the slot before.
        this.charge[slot] = 0; this.cooldown[slot] = 0; this.releaseLock[slot] = 0;
        // A new ring is born in the structure's centre and drifts out to the person. A ring still fading from someone who
        // has just left glides over to the newcomer from where it is, so nothing jumps.
        if (this.oa[slot] < UNSEEN) { this.ox[slot] = 0; this.oy[slot] = 0; this.or[slot] = 0.03; this.oturn[slot] = slot * 0.7; }
      }
      this.slotBody[slot] = index;
    }
    // A slot whose person has gone is free at once: its ring fades on its own, and a newcomer prefers the most faded slot.
    for (let s = 0; s < MAX_BODIES; s++) if (this.slotBody[s] < 0) this.slotId[s] = -1;
  }

  private orbits(bodies: readonly Body[], ctx: InteractionContext, step: number, frames: number): void {
    const follow = this.v('liveFollow'), bodyScale = this.v('liveBodyScale'), orbit = this.v('liveOrbit'), chargeOn = this.v('liveCharge');
    const chargeSeconds = this.v('liveChargeSeconds'), throwOn = this.v('liveThrow'), sensitivity = this.v('liveThrowSensitivity'), merge = this.v('liveMerge');
    const tau = 0.15 + (1 - follow) * 1.0, speed = MOVE_LIMIT * ORBIT_SHARE * frames;
    let strongest = 0;
    for (let s = 0; s < MAX_BODIES; s++) {
      const index = this.slotBody[s];
      this.cooldown[s] = Math.max(0, this.cooldown[s] - step);
      this.releaseLock[s] = Math.max(0, this.releaseLock[s] - step);
      if (index < 0) {
        this.oa[s] = Math.max(0, this.oa[s] - ALPHA_LIMIT * frames);
        this.charge[s] = Math.max(0, this.charge[s] - step / 1.5);
        continue;
      }
      const body = this.bodyAt(bodies, index);
      let tx = this.px[index], ty = this.py[index], grow = 0;
      // Merged partners pull each other's orbit toward the space between them.
      for (let k = 0; k < PAIRS; k++) {
        const amount = this.mergeAmount[k];
        if (amount <= 0) continue;
        const other = PAIR_A[k] === s ? PAIR_B[k] : PAIR_B[k] === s ? PAIR_A[k] : -1;
        if (other < 0 || this.slotBody[other] < 0) continue;
        const j = this.slotBody[other], pull = 0.35 * amount * merge;
        tx += (this.px[j] - this.px[index]) * pull; ty += (this.py[j] - this.py[index]) * pull;
        grow = Math.max(grow, amount * merge);
      }
      const k = ease(step, tau);
      this.ox[s] = toward(this.ox[s], this.ox[s] + (tx - this.ox[s]) * Math.max(k, 0.02), speed);
      this.oy[s] = toward(this.oy[s], this.oy[s] + (ty - this.oy[s]) * Math.max(k, 0.02), speed);
      // Charge: stillness fills it; movement without a release lets it drain.
      const stillness = body ? body.stillness : 0, presence = body ? clamp(body.presence, 0, 1) : 0;
      if (chargeOn > 0 && stillness > 0.5 && this.releaseLock[s] <= 0) this.charge[s] = Math.min(1, this.charge[s] + step / chargeSeconds);
      else if (stillness <= 0.5) this.charge[s] = Math.max(0, this.charge[s] - step / 1.5);
      const radius = clamp((body ? body.size : 0.4) * 0.28 * bodyScale, 0.035, 0.2) * (1 + 0.45 * grow) * (1 - 0.22 * this.charge[s] * chargeOn);
      this.or[s] = toward(this.or[s], this.or[s] + (radius - this.or[s]) * ease(step, 0.5), 0.004 * frames);
      this.oa[s] = toward(this.oa[s], 0.85 * orbit * presence, ALPHA_LIMIT * frames);
      this.oturn[s] += step * 0.35 * (1 + (body ? body.energy : 0));
      if (this.oturn[s] > TAU) this.oturn[s] -= TAU;
      if (!body) continue;
      const vx = this.pvx[index], vy = this.pvy[index], fast = Math.hypot(vx, vy), energy = body.energy;
      // Movement alone cannot tell a person from a beam of light or the projection, so nothing is fired from it.
      if (this.movementOnly) { strongest = Math.max(strongest, this.charge[s]); continue; }
      // Release: a sudden move after charging. It fires once: the charge is spent at once, whenever the bloom lands.
      if (chargeOn > 0 && this.charge[s] >= RELEASE_AT && (energy > 0.45 || fast > 0.6)) {
        this.queueAt(KIND_BLOOM, s, this.charge[s] * this.v('liveReleaseStrength'));
        this.charge[s] = 0; this.releaseLock[s] = 1;
      }
      // Throw: fast movement fires spokes at once.
      const threshold = THROW_SPEED / sensitivity;
      if (throwOn > 0 && fast > threshold && energy > 0.35 && this.cooldown[s] <= 0 && body.age > 0.3) {
        const t = this.nextThrow; this.nextThrow = (t + 1) % THROWS;
        this.tAge[t] = 0; this.tx[t] = this.px[index]; this.ty[t] = this.py[index]; this.tdx[t] = vx / fast; this.tdy[t] = vy / fast;
        this.tr[t] = Math.max(0.04, this.or[s]); this.tStrength[t] = clamp((fast / threshold - 1) * 1.2 + 0.5, 0.4, 1);
        this.cooldown[s] = THROW_COOLDOWN; this.throws++;
        this.queueAt(KIND_BURST, s, this.tStrength[t]);
      }
      strongest = Math.max(strongest, this.charge[s]);
    }
    this.heroCharge = toward(this.heroCharge, strongest, step / 0.6);
  }

  private bodyAt(bodies: readonly Body[], index: number): Body | null {
    let seen = 0;
    for (let i = 0; i < bodies.length; i++) { if (!(bodies[i].presence > 0)) continue; if (seen === index) return bodies[i]; seen++; }
    return null;
  }

  /**
   * In a crowd, every pair linked or merged is a web of lines. Each person keeps the links to their two nearest and one merge
   * ring with their nearest merged partner, so eight people read as a constellation, not a pile of circles.
   */
  private rankPairs(): void {
    let active = 0;
    for (let s = 0; s < MAX_BODIES; s++) if (this.slotBody[s] >= 0) active++;
    this.crowding = active > 2 ? Math.sqrt(2 / active) : 1;
    for (let k = 0; k < PAIRS; k++) {
      const s = PAIR_A[k], t = PAIR_B[k], d = Math.hypot(this.ox[s] - this.ox[t], this.oy[s] - this.oy[t]);
      let nearerS = 0, nearerT = 0, mergedS = true, mergedT = true;
      for (let j = 0; j < PAIRS; j++) {
        if (j === k || this.slotBody[PAIR_A[j]] < 0 || this.slotBody[PAIR_B[j]] < 0) continue;
        const e = Math.hypot(this.ox[PAIR_A[j]] - this.ox[PAIR_B[j]], this.oy[PAIR_A[j]] - this.oy[PAIR_B[j]]);
        const touchesS = PAIR_A[j] === s || PAIR_B[j] === s, touchesT = PAIR_A[j] === t || PAIR_B[j] === t;
        if (e < d) { if (touchesS) nearerS++; if (touchesT) nearerT++; }
        if (this.mergeAmount[j] > this.mergeAmount[k] || (this.mergeAmount[j] === this.mergeAmount[k] && e < d)) { if (touchesS) mergedS = false; if (touchesT) mergedT = false; }
      }
      this.linkKept[k] = nearerS < 2 || nearerT < 2 ? 1 : 0;
      this.mergeKept[k] = mergedS && mergedT ? 1 : 0;
    }
  }

  private crowding = 1;
  private movementOnly = false;

  /**
   * Clear: everyone is forgotten, along with what was waiting for the beat, but nothing is cut. Rings, links, wakes and the
   * structure's lean all fade and glide back within the usual limits, as if the room had emptied.
   */
  forget(): void {
    this.slotId.fill(-1); this.slotBody.fill(-1);
    this.charge.fill(0); this.cooldown.fill(0); this.releaseLock.fill(0);
    this.merged.fill(0); this.qKind.fill(0);
    this.conductTime = 0;
  }
  private readonly linkKept = new Uint8Array(PAIRS);
  private readonly mergeKept = new Uint8Array(PAIRS);
  private readonly mergeShown = new Float64Array(PAIRS);

  private links(step: number): number {
    const reach = this.v('liveLinkDistance'), on = this.v('liveConstellation');
    let links = 0;
    this.rankPairs();
    for (let k = 0; k < PAIRS; k++) {
      const s = PAIR_A[k], t = PAIR_B[k];
      let target = 0;
      this.mergeShown[k] = toward(this.mergeShown[k], this.mergeKept[k], step * 1.5);
      if (this.linkKept[k] && this.slotBody[s] >= 0 && this.slotBody[t] >= 0 && this.oa[s] > 0.02 && this.oa[t] > 0.02) {
        const d = Math.hypot(this.ox[s] - this.ox[t], this.oy[s] - this.oy[t]);
        target = on * smooth((reach - d) / (reach * 0.35)) * smooth((d - 0.03) / 0.05) * Math.min(this.oa[s], this.oa[t]) * (1 - 0.6 * this.mergeAmount[k]);
      }
      if (target > 0.05) links++;
      this.linkAlpha[k] = toward(this.linkAlpha[k], target, step * 2.5);
    }
    return links;
  }

  /** The crowd's shared energy: two or more people moving together. */
  private conduct(bodies: readonly Body[], step: number): void {
    let n = 0, sum = 0;
    for (let s = 0; s < MAX_BODIES; s++) {
      const index = this.slotBody[s];
      if (index < 0) continue;
      const body = this.bodyAt(bodies, index);
      if (!body || body.presence < 0.3) continue;
      n++; sum += clamp(body.energy, 0, 1) * clamp(body.presence, 0, 1);
    }
    const shared = n >= 2 ? sum / n : 0, threshold = this.v('liveCrowdThreshold'), on = this.v('liveCrowd');
    this.crowd += (shared - this.crowd) * ease(step, 0.6);
    this.conductCooldown = Math.max(0, this.conductCooldown - step);
    if (this.crowd > threshold) this.conductTime += step; else this.conductTime = Math.max(0, this.conductTime - step * 2);
    const lift = on * clamp((this.crowd - threshold * 0.5) / (threshold * 0.5), 0, 1);
    this.evolutionLift += (lift - this.evolutionLift) * ease(step, 3);
    this.lightLift += (lift - this.lightLift) * ease(step, 2);
    if (on > 0 && this.conductTime > CONDUCT_HOLD && this.conductCooldown <= 0) {
      this.conductCooldown = CONDUCT_COOLDOWN;
      this.queueAt(KIND_DROP, -1, 1);
    }
  }

  private beats = 0; private bpm = 120; private snap = 0.5;

  /** Holds a large consequence for the next beat, or lets it happen at once, by Beat snap. */
  private queueAt(kind: number, slot: number, strength: number): void {
    let at = -1;
    for (let i = 0; i < PENDING; i++) if (this.qKind[i] === 0) { at = i; break; }
    if (at < 0) return;
    const beatLength = 60 / clamp(this.bpm, 20, 400), toNext = (1 - (this.beats - Math.floor(this.beats))) * beatLength;
    this.qKind[at] = kind; this.qSlot[at] = slot; this.qStrength[at] = strength; this.qWait[at] = 0;
    this.qBeat[at] = this.snap > 0.02 && toNext <= this.snap * beatLength + 1e-6 ? Math.floor(this.beats) + 1 : -Infinity;
    if (this.qBeat[at] === -Infinity) this.fire(at);
  }

  private queueFire(ctx: InteractionContext, step: number): void {
    const beatLength = 60 / clamp(finite(ctx.bpm, 120), 20, 400);
    for (let i = 0; i < PENDING; i++) {
      if (this.qKind[i] === 0) continue;
      this.qWait[i] += step;
      if (this.beats >= this.qBeat[i] || this.qWait[i] > beatLength * 1.2 + 0.05) this.fire(i);
    }
  }

  private fire(i: number): void {
    const kind = this.qKind[i], slot = this.qSlot[i], strength = this.qStrength[i];
    this.qKind[i] = 0;
    if (kind === KIND_DROP) { this.frame.requestDrop = true; return; }
    this.frame.requestBurst = true;
    if (kind !== KIND_BLOOM) return;
    const b = this.nextBloom; this.nextBloom = (b + 1) % BLOOMS;
    this.bAge[b] = 0; this.bStrength[b] = strength;
    this.bx[b] = slot >= 0 ? this.ox[slot] : 0; this.by[b] = slot >= 0 ? this.oy[slot] : 0; this.br[b] = slot >= 0 ? Math.max(0.04, this.or[slot]) : 0.1;
    this.releases++;
  }

  private attractStep(count: number, lost: boolean, step: number): void {
    this.emptyTime = count === 0 || lost ? this.emptyTime + step : 0;
    const wanted = lost || (count === 0 && this.emptyTime > EMPTY_GRACE) ? 1 : 0;
    this.attract = toward(this.attract, wanted, step / (wanted > this.attract ? (lost ? 1 : 1.5) : 0.7));
  }

  /** Evolve's own rings lean toward the people near them, within what each voice has left of the frame's move limit. */
  private lean(count: number, step: number, frames: number): void {
    const data = this.raw, on = this.v('liveOrbit');
    for (let v = 0; v < RING_VOICES; v++) {
      const at = v * ARC_SLOTS * STRIDE, cx = data[at + 1], cy = data[at + 2];
      let wx = 0, wy = 0;
      for (let i = 0; i < count; i++) {
        const dx = this.px[i] - cx, dy = this.py[i] - cy, d = Math.hypot(dx, dy), w = 0.16 * on * Math.exp(-((d / 0.55) ** 2));
        wx += dx * w; wy += dy * w;
      }
      const size = Math.hypot(wx, wy);
      if (size > 0.1) { wx *= 0.1 / size; wy *= 0.1 / size; }
      const room = Math.max(0, Math.min(LEAN_STEP * frames, MOVE_LIMIT * frames - this.voiceMove[v]));
      const dx = wx - this.leanX[v], dy = wy - this.leanY[v], k = ease(step, 0.8), want = Math.hypot(dx, dy) * Math.max(k, 0.05);
      const go = want > 0 ? Math.min(want, room) / Math.hypot(dx, dy) : 0;
      this.leanX[v] += dx * go; this.leanY[v] += dy * go;
    }
  }

  /** The lattice's points and Evolve's nodes inside a silhouette light up, then fade over the wake time. */
  private lattice(ctx: InteractionContext, aspect: number, scale: number, alignX: number, alignY: number, step: number, frames: number, evolveCount: number): void {
    const wakeSeconds = this.v('liveWake'), on = this.v('liveLattice'), f = ctx.cameraLost ? null : ctx.presence;
    const decay = Math.exp(-3 * step / wakeSeconds), rise = step * 4;
    for (let j = 0; j < LATTICE_ROWS; j++) for (let i = 0; i < LATTICE_COLS; i++) {
      const k = j * LATTICE_COLS + i;
      this.inside[k] = this.presenceAt(f, ((i + 0.5) / LATTICE_COLS - 0.5) * aspect, (j + 0.5) / LATTICE_ROWS - 0.5, aspect, scale, alignX, alignY) ? 1 : 0;
      this.wake[k] = this.inside[k] ? Math.min(1, this.wake[k] + rise) : this.wake[k] * decay;
    }
    if (evolveCount < BASE) return;
    // Evolve's own nodes: brighter where someone stands, within the frame's light limit.
    const data = this.raw, last = this.rawLast;
    for (let n = 0; n < NODE_VOICES; n++) {
      const at = (NODE_LIST + n) * STRIDE, v = n % 4;
      const inside = data[at + 9] > 0.02 && this.presenceAt(f, data[at + 1] + this.leanX[v], data[at + 2] + this.leanY[v], aspect, scale, alignX, alignY);
      this.nodeWake[n] = inside ? Math.min(1, this.nodeWake[n] + rise) : this.nodeWake[n] * decay;
      const own = this.rawPrimed ? Math.abs(data[at + 9] - last[at + 9]) : 0, room = Math.max(0, ALPHA_LIMIT * frames - own);
      this.nodeBoost[n] = toward(this.nodeBoost[n], 0.6 * on * this.nodeWake[n], Math.min(room, ALPHA_LIMIT * frames * 0.5));
    }
  }

  /** Leans and lights Evolve's marks in place. */
  private applyToEvolve(time: number, evolveCount: number): void {
    if (evolveCount < BASE) return;
    // Applied to the list itself, which still holds what Evolve drew.
    const target = this.listData;
    if (!target) return;
    for (let v = 0; v < RING_VOICES; v++) {
      const lx = this.leanX[v], ly = this.leanY[v];
      if (lx === 0 && ly === 0) continue;
      for (let k = 0; k < ARC_SLOTS; k++) { const at = (v * ARC_SLOTS + k) * STRIDE; target[at + 1] += lx; target[at + 2] += ly; }
    }
    for (let n = 0; n < NODE_VOICES; n++) {
      const at = (NODE_LIST + n) * STRIDE, v = n % 4;
      target[at + 1] += this.leanX[v]; target[at + 2] += this.leanY[v];
      const boost = this.nodeBoost[n];
      if (boost > 0) { target[at + 9] = Math.min(1.5, target[at + 9] + boost * Math.max(0.4, target[at + 9] > 0.02 ? 1 : 0)); target[at + 7] += 0.3 * boost; }
    }
    // Charge swells and warms the hero, with a slow hum.
    const c = this.heroCharge * Math.min(1, this.v('liveCharge') * 1.25);
    if (c > 0) for (let h = 0; h < 2; h++) {
      const at = (HERO_INDEX + h) * STRIDE;
      target[at + 3] *= 1 + 0.08 * c;
      target[at + 6] *= 1 + 0.75 * c;
      target[at + 7] += 0.6 * c * (1 + 0.08 * Math.sin(time * TAU * 0.8));
    }
  }

  private listData: Float32Array | null = null;

  private put(data: Float32Array, index: number, kind: number, x: number, y: number, p0: number, p1: number, p2: number, width: number, glow: number, colour: number, alpha: number, seed: number): void {
    const at = index * STRIDE;
    data[at] = kind; data[at + 1] = x; data[at + 2] = y; data[at + 3] = p0; data[at + 4] = p1; data[at + 5] = p2;
    data[at + 6] = width; data[at + 7] = glow; data[at + 8] = colour; data[at + 9] = alpha > 0 ? alpha : 0; data[at + 10] = 0; data[at + 11] = seed;
  }

  private writeOrbits(data: Float32Array): void {
    const chargeOn = Math.min(1, this.v('liveCharge') * 1.25);
    for (let s = 0; s < MAX_BODIES; s++) {
      const at = ORBIT_AT + s * ORBIT_MARKS, a = this.oa[s], x = this.ox[s], y = this.oy[s], r = this.or[s], c = this.charge[s] * chargeOn, turn = this.oturn[s];
      this.put(data, at, PRIMITIVE.ring, x, y, r, 0, 0.5, -1.3 * PX, 0.1 + 0.25 * c, 0, a, 0.31 + s * 0.01);
      // In a crowd the outer rings and arcs step back, so each person keeps one clear ring.
      const outer = a * this.crowding;
      this.put(data, at + 1, PRIMITIVE.ring, x, y, r * 1.4, 0, 0.2, -0.9 * PX, 0.05, 0, outer * 0.45, 0.41 + s * 0.01);
      for (let q = 0; q < 4; q++) this.put(data, at + 2 + q, PRIMITIVE.arc, x, y, r * 1.75, wrapAngle(turn + q * TAU / 4), 0.8, -1 * PX, 0.06, 0.4, outer * 0.5, 0.5 + q * 0.03);
      this.put(data, at + 6, PRIMITIVE.dot, x, y, 0.0045, 0, 0, 0, 0.22, 0, a * 0.9, 0.62);
      const sweep = c * TAU;
      this.put(data, at + 7, PRIMITIVE.arc, x, y, r * 1.18, wrapAngle(Math.PI / 2 - sweep), Math.max(1e-4, sweep), -2 * PX, 0.2 + 0.45 * c, 1, a * (0.3 + 0.7 * c) * smooth(c / 0.05), 0.7);
    }
  }

  private writeLinks(data: Float32Array): void {
    const merge = this.v('liveMerge');
    for (let k = 0; k < PAIRS; k++) {
      const s = PAIR_A[k], t = PAIR_B[k], a = this.linkAlpha[k];
      const x0 = this.ox[s], y0 = this.oy[s], x1 = this.ox[t], y1 = this.oy[t], d = Math.hypot(x1 - x0, y1 - y0) || 1;
      const ux = (x1 - x0) / d, uy = (y1 - y0) / d, inset = Math.min(0.02, d * 0.2);
      this.put(data, LINK_AT + k * LINK_MARKS, PRIMITIVE.segment, x0 + ux * inset, y0 + uy * inset, x1 - ux * inset, y1 - uy * inset, 0, -1.1 * PX, 0.08, 0, a, 0.2 + k * 0.001);
      this.put(data, LINK_AT + k * LINK_MARKS + 1, PRIMITIVE.dot, (x0 + x1) / 2, (y0 + y1) / 2, 0.004, 0, 0, 0, 0.25, 1, a, 0.6);
      // A merged pair shares one larger ring around both.
      const m = this.mergeAmount[k] * this.mergeShown[k] * merge * Math.min(this.oa[s], this.oa[t]) * 0.8;
      this.put(data, MERGE_AT + k, PRIMITIVE.ring, (x0 + x1) / 2, (y0 + y1) / 2, d / 2 + Math.max(this.or[s], this.or[t]) * 1.1, 0, 0.6, -1.6 * PX, 0.18, 0, m, 0.33);
    }
  }

  private writeThrows(data: Float32Array, step: number): void {
    const on = this.v('liveThrow');
    for (let t = 0; t < THROWS; t++) {
      const age = this.tAge[t], at = THROW_AT + t * THROW_MARKS;
      const live = age < THROW_SECONDS, life = live ? age / THROW_SECONDS : 1, strength = this.tStrength[t];
      const a = live ? on * strength * (1 - life) ** 1.5 : 0;
      const reach = 0.28 + 0.25 * strength, head = this.tr[t] + reach * (1 - Math.exp(-age * 3.5)), tail = (0.09 + 0.05 * strength) * (1 - life);
      const angle = Math.atan2(this.tdy[t], this.tdx[t]);
      for (let q = 0; q < 4; q++) {
        const ang = angle + FAN[q], cx = Math.cos(ang), cy = Math.sin(ang), far = head * FAN_LENGTH[q], near = Math.max(this.tr[t] * 0.9, far - tail);
        this.put(data, at + q, PRIMITIVE.segment, this.tx[t] + cx * near, this.ty[t] + cy * near, this.tx[t] + cx * far, this.ty[t] + cy * far, 0, -1.3 * PX, 0.2 + 0.25 * strength, 1, live ? a : 0, 0.8);
      }
      const ripple = this.tr[t] + reach * 0.8 * (1 - Math.exp(-age * 2.5));
      this.put(data, at + 4, PRIMITIVE.arc, this.tx[t], this.ty[t], ripple, wrapAngle(angle - 0.55), 1.1, -1.4 * PX, 0.3, 0, live ? a * 0.6 : 0, 0.85);
      if (live) this.tAge[t] = age + step;
    }
  }

  private writeBlooms(data: Float32Array, step: number): void {
    for (let b = 0; b < BLOOMS; b++) {
      const age = this.bAge[b], at = BLOOM_AT + b * BLOOM_MARKS, live = age < BLOOM_SECONDS, life = live ? age / BLOOM_SECONDS : 1, s = this.bStrength[b];
      const a = live ? clamp(s * 1.3, 0, 1) * (1 - life) ** 2 * 0.9 : 0;
      const grow = (0.2 + 0.45 * s) * (1 - Math.exp(-age * 1.8)), lag = (0.2 + 0.45 * s) * (1 - Math.exp(-Math.max(0, age - 0.25) * 1.8)) * 0.7;
      this.put(data, at, PRIMITIVE.ring, this.bx[b], this.by[b], this.br[b] + grow, 0, 0.3, -2.2 * PX, 0.35 + 0.5 * s, 1, a, 0.9);
      this.put(data, at + 1, PRIMITIVE.ring, this.bx[b], this.by[b], this.br[b] + lag, 0, 0.7, -1.2 * PX, 0.25 + 0.3 * s, 0, a * 0.7, 0.92);
      if (live) this.bAge[b] = age + step;
    }
  }

  private writeLattice(data: Float32Array, aspect: number): void {
    const level = this.v('liveLattice') * this.v('liveSilhouette') * 0.9;
    for (let j = 0; j < LATTICE_ROWS; j++) for (let i = 0; i < LATTICE_COLS; i++) {
      const k = j * LATTICE_COLS + i, w = this.wake[k];
      this.put(data, LATTICE_AT + k, PRIMITIVE.dot, ((i + 0.5) / LATTICE_COLS - 0.5) * aspect, (j + 0.5) / LATTICE_ROWS - 0.5, 0.0032, 0, 0, 0, 0.15 * w, 2, level * w, (k % 97) / 97);
    }
  }

  private writeAttract(data: Float32Array, time: number): void {
    const level = this.v('liveAttract') * this.attract;
    for (let q = 0; q < ATTRACT_MARKS; q++) {
      const phase = ((time / 7 + q / ATTRACT_MARKS) % 1 + 1) % 1, wave = Math.sin(Math.PI * phase);
      this.put(data, ATTRACT_AT + q, PRIMITIVE.ring, 0, 0, 0.06 + 0.5 * phase, 0, 0.3, -1 * PX, 0.06, 0, level * 0.32 * wave * wave, 0.15 + q * 0.1);
    }
  }

  /** The Live marks keep the same limits as the structure: what would move or change light too fast this frame is held back. */
  private guardOwn(data: Float32Array, frames: number): void {
    const last = this.own, moveLimit = MOVE_LIMIT * frames, lightLimit = ALPHA_LIMIT * frames;
    if (!this.ownPrimed) { last.set(data.subarray(BASE * STRIDE, END * STRIDE)); this.ownPrimed = true; return; }
    for (let i = 0; i < OWN; i++) {
      const at = (BASE + i) * STRIDE, was = i * STRIDE, before = last[was + 9];
      data[at + 9] = toward(before, data[at + 9], lightLimit);
      if (before > UNSEEN && data[at + 9] > UNSEEN) {
        for (let pass = 0; pass < 2; pass++) {
          endsOf(last, was, this.a); endsOf(data, at, this.b);
          const moved = Math.max(Math.hypot(this.a[0] - this.b[0], this.a[1] - this.b[1]), Math.hypot(this.a[2] - this.b[2], this.a[3] - this.b[3]));
          if (moved <= moveLimit) break;
          const s = (moveLimit / moved) * 0.999, arc = data[at] === PRIMITIVE.arc;
          for (let f = 1; f <= 5; f++) {
            const delta = arc && f === 4 ? wrapAngle(data[at + f] - last[was + f]) : data[at + f] - last[was + f];
            data[at + f] = last[was + f] + delta * s;
          }
        }
      }
      for (let f = 0; f < STRIDE; f++) last[was + f] = data[at + f];
    }
  }

  private P: Readonly<Record<string, number>> = LIVE_DEFAULTS;
  /** A Live parameter this frame, clamped to its range. */
  private v(key: LiveKey): number { const d = LIVE_PARAMETERS_BY_KEY[key]; return clamp(finite(this.P[key], d.default), d.min, d.max); }

  private presenceAt(f: PresenceField | null, x: number, y: number, aspect: number, scale: number, alignX: number, alignY: number): boolean {
    if (!f) return false;
    const u = (x / aspect - alignX) / scale + 0.5, v = (y - alignY) / scale + 0.5;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    const c = Math.floor(u * f.width), r = Math.floor(v * f.height);
    return f.data[(r * f.width + c) * f.stride] >= 128;
  }
}

const LIVE_PARAMETERS_BY_KEY: Readonly<Record<LiveKey, LiveParameter>> = Object.fromEntries(LIVE_PARAMETERS.map(p => [p.key, p])) as Record<LiveKey, LiveParameter>;
