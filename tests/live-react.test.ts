import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLiveSettings, validateLiveSettings } from '../src/live/settings';
import { liveTargetRange, LiveModulator, LIVE_REACTIONS, liveReactionLinks } from '../src/live/modulate';
import type { Link } from '../src/react/links';

const link = (over: Partial<Link>): Link => ({ id: 'l', input: 'audio.bass', target: 'live.smoke.density', mode: 'modulate', amount: 0.5, low: 0, high: 1, attackMs: 0, releaseMs: 0, on: true, name: '', ...over });

test('Live targets are the looks’ sliders and sensitivity, with their own ranges', () => {
  assert.ok(liveTargetRange('live.smoke.density'));
  assert.ok(liveTargetRange('live.sensitivity'));
  assert.equal(liveTargetRange('live.smoke.nonsense'), null);
  assert.equal(liveTargetRange('shape.a.brightness'), null);
});

test('links in Live settings round-trip; bad ones are dropped; older settings have none', () => {
  const s = defaultLiveSettings();
  assert.deepEqual(s.links, []);
  s.links = [link({})];
  assert.deepEqual(validateLiveSettings(JSON.parse(JSON.stringify(s))).links, s.links);
  assert.deepEqual(validateLiveSettings({ ...s, links: [link({ target: 'live.paint.nope' }), 'x'] }).links, []);
  const old = { ...JSON.parse(JSON.stringify(s)) }; delete old.links;
  assert.deepEqual(validateLiveSettings(old).links, []);
});

test('links change a copy of the settings for drawing; the settings stay as set; no links, the same object', () => {
  const s = defaultLiveSettings();
  const m = new LiveModulator();
  assert.equal(m.apply(s, { 'audio.bass': 1 }, 1 / 60), s);
  s.links = [link({ amount: 1 })];
  const out = m.apply(s, { 'audio.bass': 1 }, 1 / 60);
  assert.notEqual(out, s);
  assert.ok(out.smoke.density > s.smoke.density);
  assert.equal(validateLiveSettings(s).smoke.density, s.smoke.density);
});

test('ready-made Live reactions make ordinary links for the look on screen', () => {
  const s = defaultLiveSettings(); s.look = 'smoke';
  for (const r of Object.keys(LIVE_REACTIONS) as (keyof typeof LIVE_REACTIONS)[]) {
    const links = liveReactionLinks(s, r, ['x']);
    assert.ok(Array.isArray(links) && links.every(l => liveTargetRange(l.target)), r);
  }
});
