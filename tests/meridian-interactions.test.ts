import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayList, STRIDE } from '../src/meridian/display-list';
import { advanceEvolve, createEvolveTransport, evaluateEvolve, type EvolveMoves } from '../src/meridian/evolve';
import { MERIDIAN_DEFAULTS } from '../src/meridian/parameters';
import { PRIMITIVE } from '../src/meridian/types';
import type { Body } from '../src/meridian/bodies';
import { GRID_HEIGHT, GRID_WIDTH } from '../src/meridian/bodies';
import { Interactions, LIVE_CAPACITY, LIVE_DEFAULTS, LIVE_SLOTS, LATTICE_COLS, LATTICE_ROWS, HERO_INDEX, type InteractionFrame, type PresenceField } from '../src/meridian/interactions';

const FPS = 60, DT = 1 / FPS, LOOP = 60, SEED = 1729, ASPECT = 16 / 9;
const MAX_MOVE = 0.012, MAX_ALPHA = 0.08;
const idle: EvolveMoves = { next: false, hold: false, drop: false, collapse: false, burst: false };

function body(id: number, x: number, y: number, extra: Partial<Body> = {}): Body {
  return { id, x, y, vx: 0, vy: 0, size: 0.5, energy: 0.1, stillness: 0, age: 5, presence: 1, ...extra };
}
/** A presence grid with each body drawn as an upright ellipse, the way the camera would see them. */
function field(bodies: readonly Body[]): PresenceField {
  const data = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4);
  for (const b of bodies) for (let r = 0; r < GRID_HEIGHT; r++) for (let c = 0; c < GRID_WIDTH; c++) {
    const dx = ((c + 0.5) / GRID_WIDTH - b.x) / (b.size * 0.14), dy = ((r + 0.5) / GRID_HEIGHT - b.y) / (b.size * 0.5);
    if (dx * dx + dy * dy <= 1) data[(r * GRID_WIDTH + c) * 4] = 255;
  }
  return { data, width: GRID_WIDTH, height: GRID_HEIGHT, stride: 4 };
}
/** Where a camera uv lands in the structure, in frame heights from the centre. */
const place = (u: number, v: number) => ({ x: (u - 0.5) * ASPECT, y: v - 0.5 });

/** Evolve, then the interactions on top of it, one 60 fps frame at a time. */
class Rig {
  readonly transport = createEvolveTransport();
  readonly list = new DisplayList(LIVE_CAPACITY);
  readonly live = new Interactions();
  readonly params: Record<string, number>;
  readonly view: Record<string, number> = {};
  t = 0; beats = 0.3; bpm = 120;
  constructor(extra: Record<string, number> = {}) { this.params = { ...MERIDIAN_DEFAULTS, ...LIVE_DEFAULTS, ...extra }; }
  step(bodies: readonly Body[], options: { presence?: PresenceField | null; cameraLost?: boolean; movementOnly?: boolean } = {}): InteractionFrame {
    this.t += DT; this.beats += DT * this.bpm / 60;
    const clock = advanceEvolve(this.transport, (this.t / LOOP) * Math.PI * 2, LOOP, DT, SEED, this.params, idle);
    Object.assign(this.view, this.params, this.transport.values);
    evaluateEvolve(SEED, clock, this.view, this.list);
    return this.live.update(bodies, { aspect: ASPECT, beats: this.beats, bpm: this.bpm, time: this.t, presence: options.presence === undefined ? field(bodies) : options.presence, cameraLost: options.cameraLost === true, movementOnly: options.movementOnly === true }, this.params, DT, this.list);
  }
  run(seconds: number, bodies: readonly Body[] | ((t: number) => readonly Body[]), options: { presence?: PresenceField | null; cameraLost?: boolean; movementOnly?: boolean } = {}): InteractionFrame {
    let frame!: InteractionFrame;
    for (let i = 0; i < Math.round(seconds * FPS); i++) frame = this.step(typeof bodies === 'function' ? bodies(this.t) : bodies, options);
    return frame;
  }
  mark(index: number) {
    const d = this.list.data, at = index * STRIDE;
    return { kind: d[at], x: d[at + 1], y: d[at + 2], p0: d[at + 3], p1: d[at + 4], p2: d[at + 5], width: d[at + 6], glow: d[at + 7], colour: d[at + 8], alpha: d[at + 9] };
  }
}

test('Orbit: a ring system gently drifts toward each person', () => {
  const rig = new Rig(), person = body(1, 0.8, 0.5), target = place(0.8, 0.5);
  rig.step([person]);
  const first = rig.mark(LIVE_SLOTS.orbit);
  assert.equal(first.kind, PRIMITIVE.ring);
  assert.ok(Math.hypot(first.x - target.x, first.y - target.y) > 0.4, 'it does not appear on the person at once');
  assert.ok(first.alpha < 0.1, `it fades in (${first.alpha})`);
  rig.run(3, [person]);
  const ring = rig.mark(LIVE_SLOTS.orbit);
  assert.ok(ring.alpha > 0.4, `alpha ${ring.alpha}`);
  assert.ok(Math.hypot(ring.x - target.x, ring.y - target.y) < 0.03, `centre ${ring.x},${ring.y}`);
  assert.ok(ring.p0 > 0.08 && ring.p0 < 0.4, `radius ${ring.p0}`);
  // The structure's own voices lean toward the person too.
  const alone = new Rig(); alone.run(3.02, []);
  let leaned = 0, count = 0;
  for (let i = 0; i < LIVE_SLOTS.base; i++) { const a = rig.mark(i), b = alone.mark(i); if (a.kind !== PRIMITIVE.arc || b.alpha < 0.05) continue; leaned += a.x - b.x; count++; }
  assert.ok(count > 0 && leaned / count > 0.005, `voices leaned ${leaned / Math.max(1, count)}`);
  // When the person leaves, their rings fade rather than vanish.
  rig.step([]);
  assert.ok(rig.mark(LIVE_SLOTS.orbit).alpha > ring.alpha - MAX_ALPHA - 1e-6);
  rig.run(2, []);
  assert.ok(rig.mark(LIVE_SLOTS.orbit).alpha < 0.02);
});

test('Constellation: two near people are linked, far people are not', () => {
  const near = new Rig(), far = new Rig();
  const a = near.run(3, [body(1, 0.4, 0.5), body(2, 0.62, 0.5)]);
  const b = far.run(3, [body(1, 0.08, 0.5), body(2, 0.92, 0.5)]);
  assert.equal(a.links, 1); assert.equal(b.links, 0);
  const link = near.mark(LIVE_SLOTS.links);
  assert.equal(link.kind, PRIMITIVE.segment);
  assert.ok(link.alpha > 0.25, `near link alpha ${link.alpha}`);
  assert.ok(far.mark(LIVE_SLOTS.links).alpha < 0.01);
  // The link runs from one person toward the other.
  const from = place(0.4, 0.5), to = place(0.62, 0.5);
  assert.ok(link.x > from.x && link.p0 < to.x && link.p0 > link.x, `${link.x} -> ${link.p0}`);
});

test('Merge: close people draw their structures together, with hysteresis', () => {
  const rig = new Rig({ liveMergeDistance: 0.25 });
  const apart = (gap: number) => [body(1, 0.5 - gap / ASPECT / 2, 0.5), body(2, 0.5 + gap / ASPECT / 2, 0.5)];
  let frame = rig.run(2, apart(0.6));
  assert.equal(frame.merges, 0);
  frame = rig.run(2.5, apart(0.2));
  assert.equal(frame.merges, 1);
  const ring = rig.mark(LIVE_SLOTS.merge);
  assert.ok(ring.alpha > 0.25 && ring.p0 > 0.15, `merged ring alpha ${ring.alpha} radius ${ring.p0}`);
  // The two orbits are pulled toward each other.
  const left = rig.mark(LIVE_SLOTS.orbit), right = rig.mark(LIVE_SLOTS.orbit + LIVE_SLOTS.orbitMarks);
  assert.ok(Math.abs(left.x - right.x) < 0.2 * 0.95, `orbits ${left.x} ${right.x}`);
  // Hovering about the threshold does not flicker between merged and apart.
  let changes = 0, was = frame.merges;
  for (let i = 0; i < 240; i++) {
    frame = rig.step(apart(0.25 * (1.1 + 0.25 * Math.sin(i / 8))));
    if (frame.merges !== was) changes++;
    was = frame.merges;
  }
  assert.equal(changes, 0);
  frame = rig.run(1, apart(0.6));
  assert.equal(frame.merges, 0);
});

test('Throw: fast motion sends spokes and a ripple of light along the motion', () => {
  const rig = new Rig();
  rig.run(2, [body(1, 0.5, 0.5)]);
  const fast = body(1, 0.5, 0.5, { vx: 0.9, energy: 0.85 });
  let frame = rig.step([fast]);
  assert.equal(frame.throws, 1);
  rig.run(0.25, [fast]);
  frame = rig.step([fast]);
  assert.equal(frame.throws, 1, 'one throw for one swing');
  let lit = 0;
  for (let s = 0; s < LIVE_SLOTS.throwMarks - 1; s++) {
    const spoke = rig.mark(LIVE_SLOTS.throws + s);
    assert.equal(spoke.kind, PRIMITIVE.segment);
    if (spoke.alpha > 0.2) { lit++; assert.ok(spoke.p0 > spoke.x + 0.02, `spoke points along the motion: ${spoke.x} -> ${spoke.p0}`); }
  }
  assert.ok(lit >= 3, `${lit} spokes lit`);
  const ripple = rig.mark(LIVE_SLOTS.throws + LIVE_SLOTS.throwMarks - 1);
  assert.equal(ripple.kind, PRIMITIVE.arc);
  const facing = ripple.p1 + ripple.p2 / 2;
  assert.ok(ripple.alpha > 0.1 && Math.abs(Math.atan2(Math.sin(facing), Math.cos(facing))) < 0.3, `ripple faces ${facing}`);
  // A slow walk throws nothing.
  const calm = new Rig();
  assert.equal(calm.run(3, [body(1, 0.5, 0.5, { vx: 0.1, energy: 0.4 })]).throws, 0);
});

test('Charge and Release: stillness swells the hero, sudden movement releases a bloom once', () => {
  const still = new Rig({ liveChargeSeconds: 2 }), empty = new Rig({ liveChargeSeconds: 2 });
  const standing = (t: number) => [body(1, 0.5, 0.5, { stillness: t, energy: 0.02 })];
  let frame = still.run(3, standing);
  empty.run(3, standing);
  assert.ok(frame.charge > 0.9, `charge ${frame.charge}`);
  const hero = still.mark(HERO_INDEX), plain = new Rig({ liveChargeSeconds: 2 });
  plain.run(3, []);
  assert.ok(hero.glow > plain.mark(HERO_INDEX).glow + 0.2, `hero glow ${hero.glow} vs ${plain.mark(HERO_INDEX).glow}`);
  assert.ok(Math.abs(hero.width) > Math.abs(plain.mark(HERO_INDEX).width) * 1.3, 'the hero line swells');
  const fill = still.mark(LIVE_SLOTS.orbit + LIVE_SLOTS.orbitMarks - 1);
  assert.equal(fill.kind, PRIMITIVE.arc);
  assert.ok(fill.p2 > Math.PI * 1.6 && fill.alpha > 0.3, `charge ring sweep ${fill.p2} alpha ${fill.alpha}`);
  assert.equal(frame.releases, 0);
  // A burst of movement: one bloom, however long the movement goes on.
  frame = still.run(3, [body(1, 0.5, 0.5, { vx: 0.3, energy: 0.9 })]);
  assert.equal(frame.releases, 1);
  assert.ok(frame.charge < 0.2, `charge after release ${frame.charge}`);
  // The bloom is light that spreads from where they stood.
  const bloomRig = new Rig({ liveChargeSeconds: 2, liveBeatSnap: 0 });
  bloomRig.run(3, standing);
  bloomRig.run(0.3, [body(1, 0.5, 0.5, { vx: 0.3, energy: 0.9 })]);
  const bloom = bloomRig.mark(LIVE_SLOTS.blooms);
  assert.equal(bloom.kind, PRIMITIVE.ring);
  assert.ok(bloom.alpha > 0.3 && bloom.glow > 0.3, `bloom alpha ${bloom.alpha} glow ${bloom.glow}`);
  assert.ok(Math.hypot(bloom.x, bloom.y) < 0.05);
});

test('Conduct: shared energy gently raises Evolution and light, requests one Drop, then waits', () => {
  const rig = new Rig({ liveCrowdThreshold: 0.45 });
  const crowd = [body(1, 0.2, 0.5), body(2, 0.4, 0.5), body(3, 0.6, 0.5), body(4, 0.8, 0.5)].map(b => ({ ...b, energy: 0.85 }));
  let drops = 0, frame!: InteractionFrame, firstLift = -1;
  for (let i = 0; i < 6 * FPS; i++) { frame = rig.step(crowd); if (frame.requestDrop) drops++; if (i === 1) firstLift = frame.evolutionLift; }
  assert.equal(drops, 1);
  assert.ok(frame.crowdEnergy > 0.7, `crowd ${frame.crowdEnergy}`);
  assert.ok(frame.evolutionLift > 0.3 && frame.lightLift > 0.2, `lift ${frame.evolutionLift} ${frame.lightLift}`);
  assert.ok(firstLift < 0.05, 'the lift is gentle, not a jump');
  for (let i = 0; i < 10 * FPS; i++) if (rig.step(crowd).requestDrop) drops++;
  assert.equal(drops, 1, 'cooling down');
  for (let i = 0; i < 12 * FPS; i++) if (rig.step(crowd).requestDrop) drops++;
  assert.equal(drops, 2, 'again after the cooldown');
  // One busy person is not a crowd.
  const solo = new Rig();
  let soloDrops = 0;
  for (let i = 0; i < 6 * FPS; i++) if (solo.step([crowd[0]]).requestDrop) soloDrops++;
  assert.equal(soloDrops, 0);
});

test('Lattice: nodes glow inside a silhouette and leave a fading wake', () => {
  const rig = new Rig({ liveWake: 1.5 });
  const person = body(1, 0.5, 0.5);
  rig.run(1.5, [person]);
  const at = (u: number, v: number) => LIVE_SLOTS.lattice + Math.floor(v * LATTICE_ROWS) * LATTICE_COLS + Math.floor(u * LATTICE_COLS);
  const inside = rig.mark(at(0.5, 0.5)), outside = rig.mark(at(0.15, 0.5));
  assert.equal(inside.kind, PRIMITIVE.dot);
  assert.ok(inside.alpha > 0.25, `inside ${inside.alpha}`);
  assert.ok(outside.alpha < 0.01, `outside ${outside.alpha}`);
  let lit = 0;
  for (let k = 0; k < LATTICE_COLS * LATTICE_ROWS; k++) if (rig.mark(LIVE_SLOTS.lattice + k).alpha > 0.2) lit++;
  assert.ok(lit >= 12, `${lit} nodes trace the silhouette`);
  // They walk on: the wake fades over the wake time.
  rig.run(0.5, [body(1, 0.9, 0.5)]);
  const wake = rig.mark(at(0.5, 0.5)).alpha;
  assert.ok(wake > 0.05 && wake < inside.alpha, `wake ${wake}`);
  rig.run(4, [body(1, 0.9, 0.5)]);
  assert.ok(rig.mark(at(0.5, 0.5)).alpha < 0.02);
});

test('Attract: with nobody present a slow inviting form fades in, and out when someone enters', () => {
  const rig = new Rig();
  let frame = rig.run(0.3, []);
  assert.ok(frame.attract < 0.3);
  frame = rig.run(2.7, []);
  assert.ok(frame.attract > 0.9, `attract ${frame.attract}`);
  let shown = 0;
  for (let k = 0; k < LIVE_SLOTS.attractMarks; k++) shown = Math.max(shown, rig.mark(LIVE_SLOTS.attract + k).alpha);
  assert.ok(shown > 0.05, `attract rings ${shown}`);
  frame = rig.run(1.5, [body(1, 0.5, 0.5)]);
  assert.ok(frame.attract < 0.1, `attract with someone there ${frame.attract}`);
  // The camera going away eases into Attract within two seconds, though bodies were last seen.
  frame = rig.run(2, [body(1, 0.5, 0.5)], { cameraLost: true });
  assert.ok(frame.attract > 0.9, `camera lost attract ${frame.attract}`);
});

test('Beat snap: large consequences land on the beat, a Throw stays immediate', () => {
  for (const snap of [1, 0]) {
    const rig = new Rig({ liveBeatSnap: snap, liveChargeSeconds: 1 });
    rig.bpm = 60;
    rig.run(2, t => [body(1, 0.5, 0.5, { stillness: t, energy: 0.02 })]);
    // Half way through a beat, they move.
    rig.beats = Math.floor(rig.beats) + 0.3;
    const moving = [body(1, 0.5, 0.5, { vx: 1.2, energy: 0.9 })];
    let frame = rig.step(moving);
    assert.equal(frame.throws, 1, 'the throw is immediate');
    let spoke = 0;
    for (let s = 0; s < LIVE_SLOTS.throwMarks - 1; s++) spoke = Math.max(spoke, rig.mark(LIVE_SLOTS.throws + s).alpha);
    assert.ok(spoke > 0.03, `spokes on the first frame: ${spoke}`);
    if (snap === 0) { assert.equal(frame.releases, 1, 'free: the release lands at once'); continue; }
    assert.equal(frame.releases, 0, 'snapped: the release waits');
    let landed = -1;
    for (let i = 0; i < 60 && landed < 0; i++) { frame = rig.step(moving); if (frame.releases === 1) landed = rig.beats; }
    assert.ok(landed > 0, 'it lands');
    assert.ok(landed - Math.floor(landed) < 0.05, `on the beat: ${landed}`);
  }
});

test('eight people stay within capacity, and influence glides within the motion limits', () => {
  const rig = new Rig();
  const crowd = (t: number) => Array.from({ length: 8 }, (_, i) => body(i + 1, 0.1 + i * 0.11 + 0.05 * Math.sin(t * 2 + i), 0.3 + 0.4 * ((i * 7) % 3) / 2, { vx: 0.1 * Math.cos(t * 2 + i), energy: 0.5 + 0.4 * Math.sin(t + i), stillness: i % 3 === 0 ? t : 0 }));
  let last: Float32Array | null = null, moved = 0, faded = 0;
  for (let i = 0; i < 20 * FPS; i++) {
    const t = i * DT;
    // Every two seconds someone vanishes and reappears elsewhere, the hardest case for gliding.
    const people = crowd(t).map(b => (Math.floor(t / 2) % 2 === 1 && b.id === 3 ? { ...b, x: 0.9 - b.x } : b));
    rig.step(people);
    assert.equal(rig.list.dropped, 0);
    assert.ok(rig.list.count <= LIVE_CAPACITY);
    const d = rig.list.data;
    if (last) for (let k = 0; k < rig.list.count; k++) {
      const at = k * STRIDE, seen = Math.max(d[at + 9], last[at + 9]);
      faded = Math.max(faded, Math.abs(d[at + 9] - last[at + 9]));
      if (seen <= 0.04 || Math.min(d[at + 9], last[at + 9]) < 0.012) continue;
      moved = Math.max(moved, endMove(last, d, at));
    }
    last = d.slice(0, rig.list.count * STRIDE);
  }
  assert.ok(moved <= MAX_MOVE + 1e-6, `largest move ${moved} frame heights in a frame`);
  assert.ok(faded <= MAX_ALPHA + 1e-6, `largest light change ${faded} in a frame`);
});

test('reset forgets everyone', () => {
  const rig = new Rig();
  rig.run(2, [body(1, 0.3, 0.5)]);
  rig.live.reset();
  const frame = rig.step([]);
  assert.equal(frame.links, 0); assert.equal(frame.throws, 0); assert.equal(frame.releases, 0);
  assert.ok(rig.mark(LIVE_SLOTS.orbit).alpha === 0);
});

/** How far either end of a mark moved between two frames, in frame heights. */
function endMove(a: Float32Array, b: Float32Array, at: number): number {
  const ends = (d: Float32Array, out: number[]) => {
    const kind = d[at];
    if (kind === PRIMITIVE.arc) { const r = d[at + 3], s = d[at + 4], e = s + d[at + 5]; out[0] = d[at + 1] + Math.cos(s) * r; out[1] = d[at + 2] + Math.sin(s) * r; out[2] = d[at + 1] + Math.cos(e) * r; out[3] = d[at + 2] + Math.sin(e) * r; }
    else if (kind === PRIMITIVE.segment) { out[0] = d[at + 1]; out[1] = d[at + 2]; out[2] = d[at + 3]; out[3] = d[at + 4]; }
    else { const r = kind === PRIMITIVE.ring ? d[at + 3] : 0; out[0] = d[at + 1] + r; out[1] = d[at + 2]; out[2] = d[at + 1] - r; out[3] = d[at + 2]; }
  };
  const p: number[] = [0, 0, 0, 0], q: number[] = [0, 0, 0, 0];
  ends(a, p); ends(b, q);
  return Math.max(Math.hypot(p[0] - q[0], p[1] - q[1]), Math.hypot(p[2] - q[2], p[3] - q[3]));
}

/** Follows every mark between frames: the largest move and light change seen. */
function watcher(rig: Rig) {
  let last: Float32Array | null = null;
  const seen = { moved: 0, faded: 0 };
  return { seen, look() {
    const d = rig.list.data;
    if (last) for (let k = 0; k < rig.list.count; k++) {
      const at = k * STRIDE;
      seen.faded = Math.max(seen.faded, Math.abs(d[at + 9] - last[at + 9]));
      if (Math.max(d[at + 9], last[at + 9]) <= 0.04 || Math.min(d[at + 9], last[at + 9]) < 0.012) continue;
      seen.moved = Math.max(seen.moved, endMove(last, d, at));
    }
    last = d.slice(0, rig.list.count * STRIDE);
  } };
}

test('a newcomer never inherits a departed person\'s charge', () => {
  const rig = new Rig({ liveChargeSeconds: 1, liveBeatSnap: 0 });
  // A full room: eight people, the first standing still until charged.
  const others = Array.from({ length: 7 }, (_, i) => body(i + 2, 0.2 + i * 0.1, 0.3 + (i % 2) * 0.4, { energy: 0.1 }));
  let frame = rig.run(2.5, t => [body(1, 0.1, 0.5, { stillness: t, energy: 0.02 }), ...others]);
  assert.ok(frame.charge > 0.9);
  // They leave, and at once someone new takes their place and moves suddenly, while the old ring is still fading.
  rig.step(others);
  frame = rig.run(2, [body(9, 0.12, 0.5, { vx: 0.3, energy: 0.9, stillness: 0 }), ...others]);
  assert.equal(frame.releases, 0, 'no bloom they never charged');
  assert.ok(frame.charge < 0.05, `charge ${frame.charge}`);
});

test('Clear forgets people but lets every mark fade within the limits', () => {
  const rig = new Rig({ liveChargeSeconds: 1 });
  const crowd = (t: number) => [body(1, 0.3, 0.5, { stillness: t, energy: 0.02 }), body(2, 0.45, 0.5), body(3, 0.7, 0.4, { vx: 0.2, energy: 0.5 })];
  rig.run(3, crowd);
  const w = watcher(rig);
  w.look();
  rig.live.forget();
  for (let i = 0; i < 3 * FPS; i++) { rig.step(i < 90 ? [] : []); w.look(); }
  assert.ok(w.seen.moved <= MAX_MOVE + 1e-6, `moved ${w.seen.moved}`);
  assert.ok(w.seen.faded <= MAX_ALPHA + 1e-6, `light changed ${w.seen.faded}`);
  assert.ok(rig.mark(LIVE_SLOTS.orbit).alpha < 0.02, 'and the rings have gone');
  // People still there after Clear are found again, gliding in.
  const again = new Rig(); again.run(2, [body(1, 0.3, 0.5)]);
  const w2 = watcher(again); w2.look(); again.live.forget();
  for (let i = 0; i < 2 * FPS; i++) { again.step([body(7, 0.3, 0.5)]); w2.look(); }
  assert.ok(w2.seen.moved <= MAX_MOVE + 1e-6 && w2.seen.faded <= MAX_ALPHA + 1e-6, JSON.stringify(w2.seen));
});

test('movement only: no Throw and no Release, while rings still follow people', () => {
  const rig = new Rig({ liveChargeSeconds: 1, liveBeatSnap: 0 });
  rig.run(2, t => [body(1, 0.5, 0.5, { stillness: t, energy: 0.02 })], { movementOnly: true });
  const frame = rig.run(2, [body(1, 0.5, 0.5, { vx: 1.4, energy: 0.95 })], { movementOnly: true });
  assert.equal(frame.throws, 0); assert.equal(frame.releases, 0);
  assert.ok(rig.mark(LIVE_SLOTS.orbit).alpha > 0.3, 'the ring is still there');
});
