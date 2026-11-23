import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLiveSettings, usesCamera, usesPeople, validateLiveSettings } from '../src/live/settings';
import { LIVE_REACTIONS, liveReactionLinks, liveTargetOptions, liveTargetRange, LiveModulator } from '../src/live/modulate';
import { LIVE_SETTINGS_LIMIT } from '../src/map/messages';
import { liveReadiness } from '../src/map/liveReady';
import { defaultMorphParams } from '../src/morphogen/params';
import type { SourceState } from '../src/live/source';
import type { Link } from '../src/react/links';

const waiting = { file: false, needsPeople: false, peopleLoading: false, drawnSinceRunning: 0, hasPicture: false };

test('old settings gain valid Morphogen values and keep their look', () => {
  const old = defaultLiveSettings() as unknown as Record<string, unknown>;
  delete old.morphogen;
  old.look = 'smoke';
  const v = validateLiveSettings(old);
  assert.equal(v.look, 'smoke');
  assert.deepEqual(v.morphogen, defaultMorphParams());
});

test('Morphogen survives being saved and loaded as the chosen look', () => {
  const v = validateLiveSettings({ ...defaultLiveSettings(), look: 'morphogen', morphogen: { ...defaultMorphParams(), drive: .5 } });
  assert.equal(v.look, 'morphogen');
  assert.equal(v.morphogen.drive, .5);
});

test('damaged Morphogen values are repaired without touching Signal', () => {
  const start = defaultLiveSettings();
  const v = validateLiveSettings({ ...start, signal: { ...start.signal, halo: .31 }, morphogen: { wavelength: 'bad', depth: 99 } });
  assert.equal(v.morphogen.wavelength, 12);
  assert.equal(v.morphogen.depth, 2);
  assert.equal(v.signal.halo, .31);
});

test('live.morphogen.drive is a link target with its control range', () => {
  const r = liveTargetRange('live.morphogen.drive');
  assert.ok(r);
  assert.equal(r.min, .05);
  assert.equal(r.max, .7);
  assert.equal(r.label, 'Morphogen · Drive');
});

test('whole-number choices cannot be driven by sound', () => {
  for (const key of ['seed', 'palette', 'fieldType', 'formType', 'quality']) assert.equal(liveTargetRange(`live.morphogen.${key}`), null, key);
  assert.ok(!liveTargetOptions('morphogen').some(o => o.target === 'live.morphogen.palette'));
});

test('a link drives Morphogen on a copy of the settings', () => {
  const link: Link = { id: 'l', input: 'audio.bass', target: 'live.morphogen.surge', mode: 'modulate', amount: .5, low: 0, high: 1, attackMs: 0, releaseMs: 0, on: true, name: '' };
  const s = { ...defaultLiveSettings(), look: 'morphogen' as const, links: [link] };
  const out = new LiveModulator().apply(s, { 'audio.bass': 1 }, 1 / 60);
  assert.ok(out.morphogen.surge > s.morphogen.surge);
  assert.equal(s.morphogen.surge, defaultMorphParams().surge);
});

test('ready-made reactions have Morphogen targets', () => {
  const s = { ...defaultLiveSettings(), look: 'morphogen' as const };
  for (const reaction of Object.keys(LIVE_REACTIONS) as (keyof typeof LIVE_REACTIONS)[]) assert.ok(liveTargetRange(liveReactionLinks(s, reaction, ['x'])[0].target));
});

test('Morphogen needs neither a camera nor person-finding', () => {
  const s = { ...defaultLiveSettings(), look: 'morphogen' as const };
  assert.equal(usesCamera(s), false);
  assert.equal(usesPeople(s), false);
  assert.equal(usesCamera(defaultLiveSettings()), true);
});

test('Morphogen plays with no camera', () => {
  for (const state of [{ status: 'none' }, { status: 'refused' }, { status: 'lost' }, { status: 'starting' }, { status: 'idle' }] as SourceState[])
    assert.equal(liveReadiness(state, { ...waiting, needsCamera: false }), 'play', state.status);
  assert.equal(liveReadiness({ status: 'none' }, { ...waiting, file: true, needsCamera: false }), 'play');
});

test('camera looks still cannot play with no camera', () => {
  assert.equal(liveReadiness({ status: 'none' }, { ...waiting, needsCamera: true }), 'cannot');
  assert.equal(liveReadiness({ status: 'none' }, waiting), 'cannot');
});

test('settings with Morphogen fit the Live message', () => {
  assert.ok(JSON.stringify({ ...defaultLiveSettings(), look: 'morphogen' }).length < LIVE_SETTINGS_LIMIT);
});
