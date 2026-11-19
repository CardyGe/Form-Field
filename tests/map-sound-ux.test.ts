// Map sound pass: what can react, which links a shape shows, and when an effect has to be prepared again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, type EditAction } from '../src/map/editor';
import { createShow, type CurvePoint, type ShowDocument } from '../src/map/show';
import { reactable, shapeLinks, offScreenLinks, linkInUse, reactsLabel } from '../src/map/targets';
import { needsPrepare } from '../src/map/playout';
import { initialMapState, mapReducer } from '../src/map/state';
import { PRESETS, readParameterDefinitions, visibleParameterDefinitions } from '../src/core/project';
import type { Link } from '../src/react/links';
import type { ParameterDefinition, Project } from '../src/shared/types';

const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ok = (show: ShowDocument, action: EditAction): ShowDocument => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const shapeOf = (show: ShowDocument, id: string) => show.shapes.find(s => s.id === id)!;
const link = (id: string, target: string, input = 'audio.bass'): Link => ({ id, input, target, mode: 'modulate', amount: .3, low: 0, high: 1, attackMs: 0, releaseMs: 100, on: true, name: '' });
const def = (over: Partial<ParameterDefinition>): ParameterDefinition => ({ key: 'drift', label: 'Drift', min: 0, max: 1, step: .01, default: .5, section: 'Motion', ...over });
/** a and b share instrument sa (preset), c plays its colour. */
const base = (presetId = 'porcelain-shutters') => {
  let show = ok(ok(ok(createShow(), { type: 'addShape', id: 'a', points: sq(.1, .1, .3, .3), colour: '#ff0000' }), { type: 'addShape', id: 'b', points: sq(.4, .1, .6, .3), colour: '#00ff00' }), { type: 'addShape', id: 'c', points: sq(.7, .1, .9, .3), colour: '#0000ff' });
  show = ok(show, { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId, sourceId: 'sa', seed: 1, linked: false } });
  return ok(show, { type: 'shareSource', shapeId: 'b', withShapeId: 'a' });
};
/** A number setting of the layer that can follow sound. */
const reactableKey = (project: Project) => visibleParameterDefinitions(project.layers[0]).find(d => reactable(d).ok && typeof project.layers[0].params[d.key] === 'number')!;

test('only numbers that can follow sound are reactable', () => {
  assert.deepEqual(reactable(def({ preparation: true })), { ok: false, why: 'restarts' });
  assert.deepEqual(reactable(def({ key: 'seed' })), { ok: false, why: 'restarts' });
  assert.deepEqual(reactable(def({ step: 1 })), { ok: false, why: 'restarts' });
  assert.deepEqual(reactable(def({})), { ok: true });
});

test('a shape shows its own links and its effect’s, not other shapes’', () => {
  let show = base();
  const d = reactableKey(show.sources[0].project);
  show = ok(show, { type: 'addLink', link: link('own', 'shape.a.brightness') });
  show = ok(show, { type: 'addLink', link: link('fx', `source.sa.param.0.${d.key}`) });
  show = ok(show, { type: 'addLink', link: link('other', 'shape.b.zoom') });
  assert.deepEqual(shapeLinks(show, 'a').map(l => l.id).sort(), ['fx', 'own']);
  assert.deepEqual(shapeLinks(show, 'b').map(l => l.id).sort(), ['fx', 'other'], 'b plays the same effect');
  assert.deepEqual(shapeLinks(show, 'c'), []);
  assert.equal(reactsLabel(show, 'a'), '∿2');
  assert.equal(reactsLabel(show, 'c'), '');
});

test('links on an effect only a scene off screen plays are listed as off screen', () => {
  let show = ok(base(), { type: 'addScene', sceneId: 's1', name: 'One' });
  show = ok(show, { type: 'addLink', link: link('fx', 'source.sa.speed') });
  show = ok(show, { type: 'addScene', sceneId: 's2', name: 'Two' });
  show = ok(ok(show, { type: 'setContent', shapeId: 'a', content: { kind: 'colour' } }), { type: 'setContent', shapeId: 'b', content: { kind: 'colour' } });
  assert.ok(show.sources.some(s => s.id === 'sa'), 'scene 1 keeps the effect');
  assert.deepEqual(offScreenLinks(show).map(l => l.id), ['fx']);
  assert.deepEqual(offScreenLinks(ok(show, { type: 'switchScene', sceneId: 's1' })), []);
});

test('a link on a setting hidden after a Style change is not in use, and is kept', () => {
  // A preset whose kind shows a setting for one style and hides it for another.
  let found: { presetId: string; key: string; hideWith: number } | null = null;
  for (const p of PRESETS) {
    const layer = { kind: p.kind, params: {} } as never;
    for (const style of [0, 1, 2, 3]) {
      const shown = visibleParameterDefinitions({ ...(layer as object), kind: p.kind, params: { style } } as never).map(d => d.key);
      const other = visibleParameterDefinitions({ ...(layer as object), kind: p.kind, params: { style: style === 0 ? 1 : 0 } } as never).map(d => d.key);
      const key = shown.find(k => !other.includes(k) && readParameterDefinitions(p.kind).some(d => d.key === k && reactable(d).ok));
      if (key) { found = { presetId: p.id, key, hideWith: style === 0 ? 1 : 0 }; break; }
    }
    if (found) break;
  }
  assert.ok(found, 'some effect hides a setting by style');
  let show = base(found!.presetId);
  const layer = show.sources[0].project.layers[0];
  const shownStyle = found!.hideWith === 0 ? 1 : 0;
  show = ok(show, { type: 'setSourceLayer', sourceId: 'sa', layer: 0, params: { style: shownStyle } });
  show = ok(show, { type: 'addLink', link: link('l', `source.sa.param.0.${found!.key}`) });
  assert.equal(linkInUse(show, show.links[0]), true);
  show = ok(show, { type: 'setSourceLayer', sourceId: 'sa', layer: 0, params: { style: found!.hideWith } });
  assert.equal(show.links.length, 1, 'kept');
  assert.equal(linkInUse(show, show.links[0]), false);
  assert.ok(layer);
});

test('changing a reactable number needs no preparing; a preparation setting, a choice or a new layer does', () => {
  const show = base();
  const before = show.sources[0].project, d = reactableKey(before);
  const mid = (d.min + d.max) / 2;
  const changed = (params: Record<string, number>, layers = before.layers) => ({ ...before, layers: layers.map((l, i) => i === 0 ? { ...l, params: { ...l.params, ...params } } : l) });
  assert.equal(needsPrepare(before, changed({ [d.key]: before.layers[0].params[d.key] === mid ? d.min : mid })), false);
  assert.equal(needsPrepare(before, changed({ seed: 99 })), true);
  assert.equal(needsPrepare(before, changed({ style: (before.layers[0].params.style ?? 0) + 1 })), true);
  assert.equal(needsPrepare(before, { ...before, layers: [...before.layers, { ...before.layers[0], id: 'extra' }] }), true);
  const prep = PRESETS.find(p => readParameterDefinitions(p.kind).some(x => x.preparation));
  if (prep) {
    const s2 = base(prep.id), p2 = s2.sources[0].project, pd = readParameterDefinitions(p2.layers[0].kind).find(x => x.preparation)!;
    assert.equal(needsPrepare(p2, { ...p2, layers: [{ ...p2.layers[0], params: { ...p2.layers[0].params, [pd.key]: pd.max } }] }), p2.layers[0].params[pd.key] !== pd.max);
  }
});

test('setSourceLayer clamps to the definition and bumps the revision; one drag merged under one key is one undo step', () => {
  const show = base();
  const d = reactableKey(show.sources[0].project);
  const after = ok(show, { type: 'setSourceLayer', sourceId: 'sa', layer: 0, params: { [d.key]: d.max + 100 } });
  assert.equal(after.sources[0].project.layers[0].params[d.key], d.max);
  assert.equal(after.sources[0].revision, show.sources[0].revision + 1);
  let state = initialMapState(show);
  for (let i = 0; i < 20; i++) state = mapReducer(state, { type: 'edit', action: { type: 'setSourceLayer', sourceId: 'sa', layer: 0, params: { [d.key]: d.min + (d.max - d.min) * i / 20 } }, merge: `param-sa-0-${d.key}` });
  assert.equal(state.past.length, 1);
  assert.deepEqual(applyEdit(show, { type: 'setSourceLayer', sourceId: 'sa', layer: 3, params: { [d.key]: d.min } }), { ok: false, reason: 'not-found' });
});

test('Make separate copies the effect’s links to the new copy; past 64 links, the rest are left', () => {
  let show = base();
  show = ok(show, { type: 'addLink', link: link('fx', 'source.sa.speed') });
  show = ok(show, { type: 'addLink', link: link('own', 'shape.a.brightness') });
  const sep = ok(show, { type: 'makeSeparate', shapeId: 'a', sourceId: 'sa2' });
  assert.equal(shapeOf(sep, 'a').sourceId, 'sa2');
  assert.deepEqual(sep.links.filter(l => l.target === 'source.sa2.speed').length, 1, 'copied');
  assert.deepEqual(sep.links.filter(l => l.target === 'source.sa.speed').length, 1, 'the others keep theirs');
  assert.equal(new Set(sep.links.map(l => l.id)).size, sep.links.length, 'ids stay unique');
  // 63 links on the effect: only one more fits.
  let full = base();
  for (let i = 0; i < 63; i++) full = ok(full, { type: 'addLink', link: link(`f${i}`, 'source.sa.speed') });
  const capped = ok(full, { type: 'makeSeparate', shapeId: 'a', sourceId: 'sa2' });
  assert.equal(capped.links.length, 64);
  assert.equal(capped.links.filter(l => l.target === 'source.sa2.speed').length, 1);
});

test('final review: Seed can be changed from the Effect tab, as in Studio', () => {
  const show = base();
  const after = ok(show, { type: 'setSourceLayer', sourceId: 'sa', layer: 0, params: { seed: 1234.6 } });
  assert.equal(after.sources[0].project.layers[0].params.seed, 1235);
  assert.equal(ok(show, { type: 'setSourceLayer', sourceId: 'sa', layer: 0, params: { seed: -5 } }).sources[0].project.layers[0].params.seed, 0);
});

test('final review: a setting that only the visible rules mark as restarting (Living Ink scale in evolving chemistry) prepares again', () => {
  const ink = PRESETS.find(p => p.kind === 'livingink');
  assert.ok(ink, 'a Living Ink preset');
  const show = base(ink!.id), p = show.sources[0].project;
  const evolving = { ...p, layers: [{ ...p.layers[0], params: { ...p.layers[0].params, inkMode: 2 } }] };
  const d = visibleParameterDefinitions(evolving.layers[0]).find(x => x.key === 'scale');
  assert.equal(d?.preparation, true, 'scale restarts in evolving chemistry');
  const scaled = { ...evolving, layers: [{ ...evolving.layers[0], params: { ...evolving.layers[0].params, scale: ((evolving.layers[0].params as Record<string, number>).scale ?? 1) * 1.1 } }] };
  assert.equal(needsPrepare(evolving, scaled), true);
});

test('final review: edits outside a drag are separate undo steps; one drag is one', async () => {
  const { EditGrouper } = await import('../src/map/undo-group');
  const g = new EditGrouper();
  const a = g.key('drift'), b = g.key('drift');
  assert.notEqual(a, b, 'two clicks of reset, or two typed values, are two steps');
  g.begin();
  const c = g.key('drift'), d = g.key('drift');
  assert.equal(c, d, 'one drag is one step');
  g.end();
  assert.notEqual(g.key('drift'), c, 'the next drag is its own step');
  const h = new EditGrouper();
  assert.notEqual(h.key('drift'), a, 'a new panel never reuses an old key');
});

test('final review: a layer’s Opacity changes in place, never preparing the effect again', () => {
  const p = base().sources[0].project;
  assert.equal(needsPrepare(p, { ...p, layers: [{ ...p.layers[0], opacity: 0.4 }] }), false);
});

test('later: on an effect with several layers, a reaction’s label names its layer', async () => {
  const { targetRange } = await import('../src/map/targets');
  const show = base();
  const p = show.sources[0].project, d = reactableKey(p);
  const two = ok(show, { type: 'setSourceProject', sourceId: 'sa', project: { ...p, layers: [p.layers[0], { ...p.layers[0], id: 'second' }] } });
  assert.equal(targetRange(two, `source.sa.param.1.${d.key}`)?.label, `${p.name}, layer 2 · ${d.label}`);
  assert.equal(targetRange(show, `source.sa.param.0.${d.key}`)?.label, `${p.name} · ${d.label}`, 'one layer: no layer named');
});

test('later: the first edit with Change all off (its own copy, then the change) is one undo step', () => {
  const show = base();
  const d = reactableKey(show.sources[0].project);
  let state = initialMapState(show);
  state = mapReducer(state, { type: 'edit', action: { type: 'makeSeparate', shapeId: 'a', sourceId: 'own' }, merge: 'k1' });
  state = mapReducer(state, { type: 'edit', action: { type: 'setSourceLayer', sourceId: 'own', layer: 0, params: { [d.key]: d.min } }, merge: 'k1' });
  assert.equal(state.past.length, 1);
  state = mapReducer(state, { type: 'undo' });
  assert.equal(shapeOf(state.show, 'a').sourceId, 'sa', 'one Undo puts both back');
});

test('later: reactions left behind at the 64-link limit are counted, for a note', async () => {
  const { linksLeftBehind } = await import('../src/map/targets');
  let full = base();
  for (let i = 0; i < 63; i++) full = ok(full, { type: 'addLink', link: link(`f${i}`, 'source.sa.speed') });
  const after = ok(full, { type: 'makeSeparate', shapeId: 'a', sourceId: 'sa2' });
  assert.equal(linksLeftBehind(full, after, 'sa', 'sa2'), 62);
  assert.equal(linksLeftBehind(base(), ok(base(), { type: 'makeSeparate', shapeId: 'a', sourceId: 'sa2' }), 'sa', 'sa2'), 0);
});

test('later: holding an arrow key (many key-downs, one key-up) is one undo step', async () => {
  const { EditGrouper } = await import('../src/map/undo-group');
  const g = new EditGrouper();
  g.begin(); const a = g.key('x'); g.begin(); const b = g.key('x'); g.begin(); const c = g.key('x');
  assert.equal(a, b); assert.equal(b, c);
  g.end();
  assert.notEqual(g.key('x'), a);
});
