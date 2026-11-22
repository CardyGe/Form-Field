import test from 'node:test';
import assert from 'node:assert/strict';
import { Modulator, withParams, tempoPhase } from '../src/map/modulate';
import { applyEdit, type EditAction } from '../src/map/editor';
import { createShow, type CurvePoint, type ShowDocument } from '../src/map/show';
import { reactionLinks, targetOptions, targetRange } from '../src/map/targets';
import type { Link } from '../src/react/links';

const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ok = (show: ShowDocument, action: EditAction): ShowDocument => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const base = () => ok(ok(createShow(), { type: 'addShape', id: 'a', points: sq(.1, .1, .4, .4), colour: '#ff0000' }), { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId: 'sa', seed: 1 } });
const link = (over: Partial<Link>): Link => ({ id: 'l', input: 'audio.bass', target: 'shape.a.brightness', mode: 'modulate', amount: 0.5, low: 0, high: 1, attackMs: 0, releaseMs: 0, on: true, name: '', ...over });
const projects = (show: ShowDocument) => new Map(show.sources.map(s => [s.id, s.project]));

test('with no links the show is drawn as it is, the same objects', () => {
  const show = base(), m = new Modulator();
  const out = m.apply(show, projects(show), { 'audio.bass': 1 }, 1 / 60);
  assert.equal(out.show, show);
  assert.equal(out.params.size, 0);
});

test('shape links change brightness, opacity and placement for drawing only', () => {
  let show = ok(base(), { type: 'addLink', link: link({}) });
  show = ok(show, { type: 'addLink', link: link({ id: 'o', target: 'shape.a.opacity', amount: -1 }) });
  show = ok(show, { type: 'addLink', link: link({ id: 'z', target: 'shape.a.zoom', amount: 0.25 }) });
  const out = new Modulator().apply(show, projects(show), { 'audio.bass': 1 }, 1 / 60);
  const a = out.show.shapes[0];
  assert.equal(a.brightness, 2);
  assert.equal(out.opacity.get('a'), 0);
  assert.ok(Math.abs(a.placement.zoom - (1 + 0.25 * 3.75)) < 1e-9);
  assert.equal(show.shapes[0].brightness, 1, 'the show itself is untouched');
  // Other shapes stay the same objects.
  const quiet = new Modulator().apply(show, projects(show), {}, 1 / 60);
  assert.equal(quiet.show.shapes[0].brightness, 1);
});

test('instrument settings and speed are changed on a copy, for drawing', () => {
  const show0 = base();
  const key = Object.keys(show0.sources[0].project.layers[0].params).find(k => k === 'motion') ?? Object.keys(show0.sources[0].project.layers[0].params)[0];
  let show = ok(show0, { type: 'addLink', link: link({ target: `source.sa.param.0.${key}`, mode: 'control', low: 0, high: 1 }) });
  show = ok(show, { type: 'addLink', link: link({ id: 's', target: 'source.sa.speed', mode: 'control', low: 1, high: 1 }) });
  const out = new Modulator().apply(show, projects(show), { 'audio.bass': 1 }, 1 / 60);
  const overrides = out.params.get('sa')!;
  assert.equal(overrides.length, 1);
  const project = withParams(show.sources[0].project, overrides);
  assert.notEqual(project, show.sources[0].project);
  assert.equal(project.layers[0].id, show.sources[0].project.layers[0].id, 'the same layers, so the renderer keeps their history');
  assert.equal(project.layers[0].params[key], overrides[0].value);
  assert.equal(out.speed.get('sa'), 4);
});

test('tempo sync: the loop position follows the beats of the clock', () => {
  assert.equal(tempoPhase({ 'tempo.beat': 2, 'tempo.phase': 0 }, 4), Math.PI);
  assert.ok(Math.abs(tempoPhase({ 'tempo.beat': 5, 'tempo.phase': 0.5 }, 2)! - Math.PI * 0.75 * 2) < 1e-9);
  assert.equal(tempoPhase({}, 4), null);
});

test('a fade of no time is a cut, never 0 / 0', async () => {
  const { fadeAlpha } = await import('../src/map/playout');
  assert.equal(fadeAlpha(100, 100, 0), 1);
  assert.equal(fadeAlpha(100, 50, 0), 1);
  assert.equal(fadeAlpha(0, 200, 400), 0.5);
});

test('Map plays the Ember preset and routes bass, beat and MIDI to independent controls', () => {
  let show = ok(base(), { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId: 'ember-pulse', sourceId: 'ember', seed: 7 } });
  const target = (key: string) => `source.ember.param.0.${key}`;
  const targets = targetOptions(show).map(option => option.target);
  assert.ok(targets.includes(target('emberOpening')));
  for (const key of ['figure', 'scopeMode', 'emberPhrases']) assert.ok(!targets.includes(target(key)));
  assert.equal(targetRange(show, target('emberPhrases')), null);
  const bass = reactionLinks(show, 'instrument-bass', 'a', ['bass']);
  assert.ok(Array.isArray(bass));
  assert.equal(bass[0].target, target('emberOpening'));
  for (const l of [bass[0], link({ id: 'rings', input: 'beat.pulse', target: target('emberRings') }),
    link({ id: 'heat', input: 'midi.cc.1.4', target: target('emberHeat') }),
    link({ id: 'classic', target: target('sway') })]) {
    show = ok(show, { type: 'addLink', link: l });
  }
  const source = show.sources[0].project;
  assert.equal(source.background, '#000000');
  assert.equal(source.transparent, true);
  const modulator = new Modulator();
  const on = modulator.apply(show, projects(show), { 'audio.bass': 1, 'beat.pulse': 1, 'midi.cc.1.4': 1 }, 1);
  const overrides = on.params.get('ember')!;
  assert.deepEqual(overrides.map(param => param.key), ['emberOpening', 'emberRings', 'emberHeat']);
  const driven = withParams(source, overrides).layers[0].params;
  for (const key of ['emberOpening', 'emberRings', 'emberHeat']) assert.ok(driven[key] > source.layers[0].params[key]);
  const quiet = modulator.apply(show, projects(show), {}, 1);
  assert.deepEqual(withParams(source, quiet.params.get('ember')), source);
});
