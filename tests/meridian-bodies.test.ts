import test from 'node:test';
import assert from 'node:assert/strict';
import { BodyTracker, GRID_HEIGHT, GRID_WIDTH, type Body, type BodySettings } from '../src/meridian/bodies';

const W = GRID_WIDTH, H = GRID_HEIGHT, DT = 1 / 30;
const SETTINGS: BodySettings = { maxBodies: 8, followSpeed: 0.5, minSize: 0.006 };

/** A grid of RG cells: person likelihood, movement. Row 0 is the bottom. */
const blank = () => new Uint8Array(W * H * 2);
/** A person-shaped ellipse centred at uv (x, y), `height` tall in uv, filled with presence and the given movement. */
function person(grid: Uint8Array, x: number, y: number, height = 0.5, move = 0, presence = 1): void {
  const ry = height / 2 * H, rx = height * 0.22 * W * (9 / 16) * 1.6;
  const cx = x * W, cy = y * H;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const dx = (c + 0.5 - cx) / rx, dy = (r + 0.5 - cy) / ry;
    if (dx * dx + dy * dy > 1) continue;
    const at = (r * W + c) * 2;
    grid[at] = Math.max(grid[at], Math.round(presence * 255));
    grid[at + 1] = Math.max(grid[at + 1], Math.round(move * 255));
  }
}
const scene = (people: { x: number; y: number; h?: number; move?: number }[]) => { const g = blank(); for (const p of people) person(g, p.x, p.y, p.h ?? 0.5, p.move ?? 0); return g; };
const byX = (bodies: readonly Body[]) => [...bodies].sort((a, b) => a.x - b.x);

test('finds two separate people', () => {
  const t = new BodyTracker();
  let bodies: readonly Body[] = [];
  for (let i = 0; i < 10; i++) bodies = t.update(scene([{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }]), W, H, DT, SETTINGS);
  assert.equal(bodies.length, 2);
  const [a, b] = byX(bodies);
  assert.ok(Math.abs(a.x - 0.25) < 0.03 && Math.abs(b.x - 0.75) < 0.03, `${a.x} ${b.x}`);
  assert.ok(Math.abs(a.y - 0.5) < 0.03);
  assert.notEqual(a.id, b.id);
  assert.ok(a.size > 0.35 && a.size < 0.65, `size ${a.size}`);
});

test('ids stay stable as people walk', () => {
  const t = new BodyTracker();
  let bodies: readonly Body[] = [];
  for (let i = 0; i < 5; i++) bodies = t.update(scene([{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }]), W, H, DT, SETTINGS);
  const [left, right] = byX(bodies).map(b => b.id);
  for (let i = 0; i < 90; i++) {
    const s = i / 90;
    bodies = t.update(scene([{ x: 0.2 + 0.15 * s, y: 0.5, move: 0.5 }, { x: 0.8 - 0.1 * s, y: 0.45, move: 0.5 }]), W, H, DT, SETTINGS);
    assert.equal(bodies.length, 2, `frame ${i}`);
    assert.deepEqual(byX(bodies).map(b => b.id), [left, right], `frame ${i}`);
  }
});

test('two people crossing keep their ids', () => {
  const t = new BodyTracker();
  const at = (i: number) => [{ x: 0.15 + i * 0.008, y: 0.5, move: 0.5 }, { x: 0.85 - i * 0.008, y: 0.5, move: 0.5 }];
  let bodies: readonly Body[] = [];
  for (let i = 0; i < 6; i++) bodies = t.update(scene(at(i)), W, H, DT, SETTINGS);
  const [walkingRight, walkingLeft] = byX(bodies).map(b => b.id);
  for (let i = 6; i < 90; i++) bodies = t.update(scene(at(i)), W, H, DT, SETTINGS);
  // After crossing, the one who walked right is now on the right.
  assert.equal(bodies.length, 2);
  const [nowLeft, nowRight] = byX(bodies);
  assert.equal(nowRight.id, walkingRight);
  assert.equal(nowLeft.id, walkingLeft);
});

test('a person briefly lost keeps their id', () => {
  const t = new BodyTracker();
  let bodies: readonly Body[] = [];
  for (let i = 0; i < 10; i++) bodies = t.update(scene([{ x: 0.4, y: 0.5 }]), W, H, DT, SETTINGS);
  const id = bodies[0].id;
  for (let i = 0; i < 15; i++) bodies = t.update(blank(), W, H, DT, SETTINGS); // half a second without a match
  assert.equal(bodies.length, 1, 'kept while briefly lost');
  for (let i = 0; i < 3; i++) bodies = t.update(scene([{ x: 0.42, y: 0.5 }]), W, H, DT, SETTINGS);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].id, id);
  // Gone for longer than 0.75 s, it is let go.
  for (let i = 0; i < 30; i++) bodies = t.update(blank(), W, H, DT, SETTINGS);
  assert.equal(bodies.length, 0);
});

test('noise specks make no bodies', () => {
  const t = new BodyTracker();
  let bodies: readonly Body[] = [];
  for (let frame = 0; frame < 60; frame++) {
    const g = blank();
    for (let k = 0; k < 25; k++) {
      // Specks of one to four cells, scattered differently every frame.
      const c = (frame * 37 + k * 53) % (W - 2), r = (frame * 11 + k * 29) % (H - 2), big = k % 3 === 0;
      for (const [dc, dr] of big ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]]) { const at = ((r + dr) * W + c + dc) * 2; g[at] = 255; g[at + 1] = 200; }
    }
    bodies = t.update(g, W, H, DT, SETTINGS);
    assert.equal(bodies.length, 0, `frame ${frame}`);
  }
});

test('never exceeds maxBodies, keeping the largest', () => {
  const t = new BodyTracker();
  // Ten people in two rows; three of them stand nearer the camera, so they look larger.
  const people = Array.from({ length: 10 }, (_, i) => ({ x: 0.1 + (i % 5) * 0.2, y: i < 5 ? 0.27 : 0.75, h: i === 2 || i === 7 ? 0.4 : i === 5 ? 0.33 : 0.22 }));
  const which = (bodies: readonly Body[]) => bodies.map(b => Math.round((b.x - 0.1) / 0.2) + (b.y > 0.5 ? 5 : 0)).sort((a, b) => a - b);
  let bodies: readonly Body[] = [];
  for (let i = 0; i < 10; i++) bodies = t.update(scene(people), W, H, DT, { ...SETTINGS, maxBodies: 3 });
  assert.equal(bodies.length, 3);
  assert.deepEqual(which(bodies), [2, 5, 7]);
  // Asking for fewer later lets the smallest go.
  bodies = t.update(scene(people), W, H, DT, { ...SETTINGS, maxBodies: 2 });
  assert.deepEqual(which(bodies), [2, 7]);
  for (let i = 0; i < 10; i++) bodies = t.update(scene(people), W, H, DT, SETTINGS);
  assert.ok(bodies.length <= 8);
});

test('a whole-frame lighting change or strobe creates no body or energy', () => {
  const t = new BodyTracker();
  let bodies: readonly Body[] = [];
  for (let i = 0; i < 20; i++) bodies = t.update(scene([{ x: 0.3, y: 0.5 }]), W, H, DT, SETTINGS);
  const before = bodies[0].energy;
  // A party strobe: every other frame the whole camera image changes, so movement lights everywhere and the people model flickers.
  for (let i = 0; i < 60; i++) {
    const g = scene([{ x: 0.3, y: 0.5 }]);
    if (i % 2 === 0) for (let k = 0; k < W * H; k++) { g[k * 2 + 1] = 230; g[k * 2] = Math.max(g[k * 2], 180); }
    bodies = t.update(g, W, H, DT, SETTINGS);
    if (i % 2 === 0) assert.equal(t.lightingEvent, true, `frame ${i}`);
    assert.equal(bodies.length, 1, `frame ${i}: no new body`);
    assert.ok(bodies[0].energy <= before + 1e-6, `frame ${i}: energy ${bodies[0].energy} rose from ${before}`);
  }
  // A single change of room lighting with nobody there makes no body either.
  const empty = new BodyTracker();
  const lit = blank(); for (let k = 0; k < W * H; k++) { lit[k * 2] = 200; lit[k * 2 + 1] = 255; }
  for (let i = 0; i < 3; i++) assert.equal(empty.update(i === 0 ? lit : blank(), W, H, DT, SETTINGS).length, 0);
  assert.equal(empty.update(lit, W, H, DT, SETTINGS).length, 0);
});

test('stillness rises when still and resets on movement', () => {
  const t = new BodyTracker();
  let bodies: readonly Body[] = [];
  for (let i = 0; i < 60; i++) bodies = t.update(scene([{ x: 0.5, y: 0.5, move: 0.03 }]), W, H, DT, SETTINGS);
  assert.ok(bodies[0].stillness > 1.5, `still for ${bodies[0].stillness} s after 2 s`);
  assert.ok(bodies[0].energy < 0.2, `energy ${bodies[0].energy}`);
  for (let i = 0; i < 4; i++) bodies = t.update(scene([{ x: 0.5, y: 0.5, move: 0.9 }]), W, H, DT, SETTINGS);
  assert.equal(bodies[0].stillness, 0);
  assert.ok(bodies[0].energy > 0.4, `energy ${bodies[0].energy} after moving`);
});

test('a person at the frame edge does not throw', () => {
  const t = new BodyTracker();
  let bodies: readonly Body[] = [], fastest = 0;
  // Standing at the left edge, half out of frame, swaying in and out of view: the visible part grows and shrinks quickly.
  for (let i = 0; i < 120; i++) {
    const x = 0.015 + 0.03 * Math.sin(i * 0.9);
    bodies = t.update(scene([{ x, y: 0.5 }]), W, H, DT, SETTINGS);
    if (bodies.length && i > 10) fastest = Math.max(fastest, Math.hypot(bodies[0].vx, bodies[0].vy));
  }
  assert.equal(bodies.length, 1);
  assert.ok(fastest < 0.25, `edge speed ${fastest} uv/s`);
  assert.ok(bodies[0].energy < 0.3, `edge energy ${bodies[0].energy}`);
});

test('a real walk reads as speed, and reset forgets everyone', () => {
  const t = new BodyTracker();
  let bodies: readonly Body[] = [];
  for (let i = 0; i < 40; i++) bodies = t.update(scene([{ x: 0.2 + i * 0.012, y: 0.5, move: 0.6 }]), W, H, DT, SETTINGS);
  assert.ok(Math.abs(bodies[0].vx - 0.36) < 0.08, `vx ${bodies[0].vx}`);
  t.reset();
  assert.equal(t.update(blank(), W, H, DT, SETTINGS).length, 0);
});

test('an RGBA grid reads the same as an RG grid', () => {
  const rg = scene([{ x: 0.3, y: 0.4 }]), rgba = new Uint8Array(W * H * 4);
  for (let k = 0; k < W * H; k++) { rgba[k * 4] = rg[k * 2]; rgba[k * 4 + 1] = rg[k * 2 + 1]; rgba[k * 4 + 3] = 255; }
  const a = new BodyTracker(), b = new BodyTracker();
  let x: readonly Body[] = [], y: readonly Body[] = [];
  for (let i = 0; i < 5; i++) { x = a.update(rg, W, H, DT, SETTINGS); y = b.update(rgba, W, H, DT, SETTINGS); }
  assert.equal(x.length, 1); assert.equal(y.length, 1);
  assert.ok(Math.abs(x[0].x - y[0].x) < 1e-9 && Math.abs(x[0].y - y[0].y) < 1e-9);
});

// --- Movement-only mode: party light and a projector in view must not become people ---
const MOVEMENT: BodySettings = { ...SETTINGS, movementOnly: true };
/** Lights cells along a line from (x0, y0) to (x1, y1) in uv, `thick` cells wide. */
function beam(grid: Uint8Array, x0: number, y0: number, x1: number, y1: number, thick = 2): void {
  const steps = 400;
  for (let s = 0; s <= steps; s++) {
    const x = (x0 + (x1 - x0) * s / steps) * W, y = (y0 + (y1 - y0) * s / steps) * H;
    for (let dy = 0; dy < thick; dy++) for (let dx = 0; dx < thick; dx++) {
      const c = Math.floor(x) + dx, r = Math.floor(y) + dy;
      if (c < 0 || r < 0 || c >= W || r >= H) continue;
      grid[(r * W + c) * 2] = 255; grid[(r * W + c) * 2 + 1] = 200;
    }
  }
}
/** A thin ring of light, `radius` cells across from its centre, like Meridian's own rings seen by the camera. */
function ring(grid: Uint8Array, cx: number, cy: number, radius: number, thick = 2): void {
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const d = Math.hypot(c + 0.5 - cx * W, r + 0.5 - cy * H);
    if (Math.abs(d - radius) <= thick / 2) { grid[(r * W + c) * 2] = 255; grid[(r * W + c) * 2 + 1] = 180; }
  }
}

test('movement only: sweeping narrow beams make no bodies', () => {
  const t = new BodyTracker();
  for (let i = 0; i < 600; i++) {
    const g = blank(), time = i * DT;
    // A moving head sweeping slowly across the room, a fast one crossing it, and an upright shaft drifting.
    beam(g, 0.1 + 0.3 * Math.sin(time * 0.4), 0, 0.5 + 0.3 * Math.sin(time * 0.4), 1);
    beam(g, (time * 0.9) % 1, 0, ((time * 0.9) % 1) + 0.25, 0.8);
    beam(g, 0.7 + 0.1 * Math.sin(time * 0.3), 0, 0.7 + 0.1 * Math.sin(time * 0.3), 1, 3);
    assert.equal(t.update(g, W, H, DT, MOVEMENT).length, 0, `frame ${i}`);
  }
});

test('movement only: a projected ring seen by the camera makes no body', () => {
  const t = new BodyTracker();
  for (let i = 0; i < 600; i++) {
    const g = blank(), time = i * DT;
    // Meridian's rings, drifting and breathing on the wall the camera can see.
    ring(g, 0.5 + 0.05 * Math.sin(time * 0.5), 0.5, 9 + 2 * Math.sin(time), 2);
    ring(g, 0.3, 0.45 + 0.03 * Math.sin(time * 0.7), 6, 2);
    assert.equal(t.update(g, W, H, DT, MOVEMENT).length, 0, `frame ${i}`);
  }
});

test('movement only: a person must stay a moment, with a steady size, before they are found', () => {
  const t = new BodyTracker();
  let bodies: readonly Body[] = [];
  for (let i = 0; i < 5; i++) bodies = t.update(scene([{ x: 0.4, y: 0.5, move: 0.5 }]), W, H, DT, MOVEMENT);
  assert.equal(bodies.length, 0, 'not at once');
  for (let i = 0; i < 25; i++) bodies = t.update(scene([{ x: 0.4 + i * 0.002, y: 0.5, move: 0.5 }]), W, H, DT, MOVEMENT);
  assert.equal(bodies.length, 1, 'found within a second');
  // A blob that keeps changing size is not a person.
  const flicker = new BodyTracker();
  for (let i = 0; i < 90; i++) assert.equal(flicker.update(scene([{ x: 0.6, y: 0.5, h: i % 2 ? 0.25 : 0.6, move: 0.5 }]), W, H, DT, MOVEMENT).length, 0, `frame ${i}`);
  // With the people model, people are found at once, as before.
  const model = new BodyTracker();
  assert.equal(model.update(scene([{ x: 0.4, y: 0.5 }]), W, H, DT, SETTINGS).length, 1);
});
