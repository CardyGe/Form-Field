import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutFor } from '../src/map/keys';
import { targetOptions } from '../src/map/targets';
import { createShow } from '../src/map/show';

const key = (k: string, extra: Partial<{ metaKey: boolean; shiftKey: boolean; target: { tagName: string } }> = {}) =>
  shortcutFor({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: null, ...extra });

test('1 to 9 switch scenes and B taps the tempo, never from a text box', () => {
  assert.equal(key('1'), 'scene');
  assert.equal(key('9'), 'scene');
  assert.equal(key('0'), null);
  assert.equal(key('b'), 'tap');
  assert.equal(key('B'), 'tap');
  assert.equal(key('1', { target: { tagName: 'INPUT' } }), null);
  assert.equal(key('b', { metaKey: true }), null);
  assert.equal(key('t'), 'triangle', 'T stays the triangle');
});

test('the link target list names every shape setting and each instrument’s speed and settings', () => {
  assert.deepEqual(targetOptions(createShow()), []);
  const opts = targetOptions({ shapes: [{ id: 'a', name: 'Arch', sourceId: null } as never], sources: [] });
  assert.ok(opts.some(o => o.target === 'shape.a.brightness' && o.label === 'Arch · Brightness'));
  assert.ok(opts.some(o => o.target === 'shape.a.opacity'));
  assert.equal(opts.filter(o => o.target.startsWith('shape.a.')).length, 6);
});
