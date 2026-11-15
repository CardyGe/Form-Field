import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject, validateProject } from '../src/core/project';
import { reconcileTile, tileBlockers, tilePeriod, tileRate, tileWave, TAU } from '../src/core/tile-edges';

test('tileEdges is optional and round-trips', () => {
  const p = createProject();
  assert.equal('tileEdges' in validateProject(structuredClone(p)), false);
  assert.equal(validateProject({ ...structuredClone(p), tileEdges: true }).tileEdges, true);
  assert.throws(() => validateProject({ ...structuredClone(p), tileEdges: 'yes' }));
});

test('tilePeriod at defaults is aspect × scale by scale', () => {
  const l = createLayer('surface'); l.params.scale = 4;
  const t = tilePeriod(l, 16 / 9);
  assert.ok(Math.abs(t.x - 64 / 9) < 1e-9 && Math.abs(t.y - 4) < 1e-9);
});
test('tilePeriod swaps axes at 90°', () => {
  const l = createLayer('surface'); l.params.scale = 4; l.params.rotation = Math.PI / 2 - .2; // snaps to 90°
  const t = tilePeriod(l, 9 / 16);
  assert.ok(Math.abs(t.x - 4) < 1e-9 && Math.abs(t.y - 4 * 9 / 16) < 1e-9);
});
test('tilePeriod follows layer zoom and stretch', () => {
  const l = createLayer('surface'); l.params.scale = 4; l.params.stretch = 4; l.transform.scale = 2;
  const t = tilePeriod(l, 1);
  assert.ok(Math.abs(t.x - 4) < 1e-9 && Math.abs(t.y - 1) < 1e-9); // ×2 and ÷2 from stretch, ÷2 from zoom
});
test('tileWave never returns zero waves', () => {
  assert.equal(tileWave(1.35, 0), 1.35);
  assert.ok(Math.abs(tileWave(.01, 3) - TAU / 3) < 1e-12);
  const k = tileWave(1.35, 64 / 9); assert.ok(Number.isInteger(Math.round(k * 64 / 9 / TAU)) && Math.abs(k * 64 / 9 / TAU - Math.round(k * 64 / 9 / TAU)) < 1e-9);
});
test('tileRate rounds to whole cycles and may reach zero', () => {
  assert.equal(tileRate(.035, 4), 0);
  assert.equal(tileRate(.47, 4), .5);
});
test('blockers name the layer and the reason', () => {
  const p = createProject(); const l = createLayer('surface'); l.name = 'Couch'; p.layers = [l];
  l.params.style = 0; l.params.variant = 0; l.mask.kind = 'none'; l.params.echo = 0; l.params.delaySpread = 0; l.params.pause = 0;
  assert.deepEqual(tileBlockers(p), []);
  l.params.style = 1; assert.deepEqual(tileBlockers(p), ["Couch: the Contours style can't tile."]);
  l.params.style = 2; l.params.variant = 0; assert.deepEqual(tileBlockers(p), ["Couch: the Melt style can't tile."]);
  l.params.variant = 1; l.mask.kind = 'circle'; assert.deepEqual(tileBlockers(p), ['Couch has a mask.']);
  l.mask.kind = 'none'; l.params.delaySpread = .2; assert.deepEqual(tileBlockers(p), ["Couch: Delay spread and Pause can't tile."]);
  l.params.delaySpread = 0; l.params.echo = 1; assert.deepEqual(tileBlockers(p), ["Couch: Feedback can't tile."]);
  l.params.echo = 0;
  const msg = "Couch: animated Scale, Direction, Stretch, Density, layer size or layer rotation can't tile.";
  for (const key of ['scale', 'rotation', 'stretch', 'density', 'transform.scale', 'transform.rotation']) {
    l.modulations = { [key]: { kind: 'sine', cycles: 1, phase: 0, amount: .5, points: [] } }; assert.deepEqual(tileBlockers(p), [msg], key);
  }
  l.modulations = { 'transform.x': { kind: 'sine', cycles: 1, phase: 0, amount: .5, points: [] } }; assert.deepEqual(tileBlockers(p), []);
  l.modulations = {}; l.params.echo = 1;
  const g = createLayer('glitchtunnel'); g.name = 'Tunnel'; p.layers = [g];
  assert.deepEqual(tileBlockers(p), ["Tunnel: this instrument can't tile yet."]);
  g.visible = false; assert.deepEqual(tileBlockers(p), []);
});

test('reconcileTile turns tiling off and names the blocker', () => {
  const p = createProject(); const l = createLayer('surface'); l.name = 'Seat'; p.layers = [l]; p.tileEdges = true;
  assert.deepEqual(reconcileTile(p), { project: p, message: null });
  l.params.echo = 1;
  const r = reconcileTile(p);
  assert.equal(r.project.tileEdges, false);
  assert.equal(r.message, "Tile edges turned off. Seat: Feedback can't tile.");
});

test('reconcileTile leaves a project alone when tiling is off or unset', () => {
  const p = createProject(); const l = createLayer('surface'); l.params.echo = 1; p.layers = [l];
  assert.deepEqual(reconcileTile(p), { project: p, message: null });
  p.tileEdges = false;
  assert.equal(reconcileTile(p).project, p);
  assert.equal(reconcileTile(p).message, null);
});
