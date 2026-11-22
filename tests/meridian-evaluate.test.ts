import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compose } from '../src/meridian/composer';
import { DisplayList, STRIDE } from '../src/meridian/display-list';
import { evaluate, performedState, positionAt, type PhrasePosition } from '../src/meridian/evaluate';
import { COLLAPSE_STYLES, FORM_KINDS, PHRASE_STATES, PRIMITIVE, type CollapseStyle, type PerformanceState, type PhraseState, type Score, type ScoreElement } from '../src/meridian/types';

const PERF: PerformanceState = { hold: false, tension: 0, burst: 0, forcedState: null };
const BEATS_PER_BAR = 4;
const FIELD = { kind: 0, x: 1, y: 2, p0: 3, p1: 4, p2: 5, width: 6, glow: 7, colour: 8, alpha: 9, tear: 10, seed: 11 };

function at(score: Score, state: PhraseState, stateProgress: number): PhrasePosition {
  const index = PHRASE_STATES.indexOf(state);
  const start = index ? score.stateEnds[index - 1] : 0;
  const progress = start + (score.stateEnds[index] - start) * stateProgress;
  return positionAt(score, progress * score.bars * BEATS_PER_BAR);
}
function draw(score: Score, position: PhrasePosition, perf = PERF, params: Record<string, number> = {}, capacity?: number) {
  const list = new DisplayList(capacity);
  evaluate(score, position, perf, params, list);
  return list;
}
const field = (list: DisplayList, index: number, name: keyof typeof FIELD) => list.data[index * STRIDE + FIELD[name]];
const kinds = (list: DisplayList) => Array.from({ length: list.count }, (_, i) => field(list, i, 'kind'));
const lastBeat = (score: Score) => score.bars * BEATS_PER_BAR;
function element(group: ScoreElement['group'], radius: number, overrides: Partial<ScoreElement> = {}): ScoreElement {
  return { group, zone: 0, radius, angle: 0, length: group === 'ring' ? Math.PI * 2 : 0.01, weight: 1, colour: 0, enter: 0, exit: 0.8, slot: 0, shape: 'dot', ...overrides };
}
const synthetic = (elements: ScoreElement[]): Score => ({ seed: 1, symmetry: 4, bars: 8, stateEnds: [0.05, 0.2, 0.4, 0.55, 0.7, 0.85, 1], elements, rhythm: { ring: [true], spoke: [true], node: [true] }, quality: 0 });

test('evaluation is a pure function of its inputs', () => {
  const score = compose(11, {});
  for (const state of PHRASE_STATES) {
    const position = at(score, state, 0.5);
    assert.deepEqual(draw(score, position).data, draw(score, position).data, state);
  }
});

test('rest is almost empty and peak is full', () => {
  for (let seed = 0; seed < 50; seed++) {
    const score = compose(seed, {});
    const rest = draw(score, at(score, 'rest', 0.5));
    const build = draw(score, at(score, 'build', 0.9));
    const peak = draw(score, at(score, 'peak', 0.5));
    assert.ok(rest.count <= 3, `seed ${seed}: rest drew ${rest.count}`);
    assert.ok(peak.count > build.count * 0.8, `seed ${seed}`);
  }
});

/** The same composition with a chosen collapse, centred so a line through it can be measured. */
const withCollapse = (seed: number, collapse: CollapseStyle): Score => {
  const score = compose(seed, {});
  return { ...score, form: { ...score.form!, collapse, collapseAngle: 0, centreX: 0, centreY: 0, twinX: 0, twinY: 0, square: 0 } };
};

test('every collapse style, on every form, ends at one point', () => {
  for (const collapse of COLLAPSE_STYLES) for (let seed = 0; seed < FORM_KINDS.length; seed++) {
    const original = compose(seed, {});
    const score = { ...original, form: { ...original.form!, collapse } };
    const list = draw(score, at(score, 'collapse', 0.9995));
    assert.ok(list.count >= 1, `${collapse} ${seed}`);
    for (let i = 0; i < list.count; i++) {
      assert.ok(Math.hypot(field(list, i, 'x'), field(list, i, 'y')) < 0.01, `${collapse} ${seed} instance ${i} start`);
      if (field(list, i, 'kind') === PRIMITIVE.segment) assert.ok(Math.hypot(field(list, i, 'p0'), field(list, i, 'p1')) < 0.01, `${collapse} ${seed} instance ${i} end`);
      if (field(list, i, 'kind') === PRIMITIVE.ring || field(list, i, 'kind') === PRIMITIVE.arc) assert.ok(field(list, i, 'p0') < 0.01, `${collapse} ${seed} instance ${i} radius`);
    }
  }
});

test('the fold collapse passes through a line', () => {
  const score = withCollapse(5, 'fold');
  const list = draw(score, at(score, 'collapse', 0.8));
  let widest = 0;
  let tallest = 0;
  for (let i = 0; i < list.count; i++) {
    if (field(list, i, 'kind') !== PRIMITIVE.segment) continue;
    widest = Math.max(widest, Math.abs(field(list, i, 'x')), Math.abs(field(list, i, 'p0')));
    tallest = Math.max(tallest, Math.abs(field(list, i, 'y')), Math.abs(field(list, i, 'p1')));
  }
  assert.ok(widest > tallest * 4, `width ${widest}, height ${tallest}`);
});

test('the last frame of one phrase meets the next seed', () => {
  for (let seed = 0; seed < 20; seed++) {
    const score = compose(seed, {});
    const next = compose(seed + 1, {});
    const last = draw(score, positionAt(score, lastBeat(score)));
    const first = draw(next, positionAt(next, 0));
    assert.equal(last.count, 1, 'one surviving point');
    assert.equal(first.count, 1, 'one seed point');
    assert.equal(field(last, 0, 'kind'), PRIMITIVE.dot);
    assert.equal(field(first, 0, 'kind'), PRIMITIVE.dot);
    for (const name of ['x', 'y', 'p0', 'alpha'] as const) assert.ok(Math.abs(field(last, 0, name) - field(first, 0, name)) < 0.005, name);
  }
});

test('hold stays in charge', () => {
  const score = compose(3, {});
  const late = positionAt(score, 0.95 * lastBeat(score));
  assert.equal(late.state, 'rest');
  assert.equal(performedState(late, { ...PERF, forcedState: 'charge' }), 'charge');
  assert.equal(performedState(late, { ...PERF, hold: true }), 'charge');
  assert.equal(performedState(at(score, 'build', 0.5), { ...PERF, hold: true }), 'build');
  assert.ok(draw(score, late, { ...PERF, forcedState: 'charge' }).count > 10);
  assert.ok(draw(score, late, { ...PERF, hold: true }).count > 10);
});

test('capacity is never exceeded', () => {
  const crowd = Array.from({ length: 30000 }, (_, i) => element('node', 0.2, { angle: i / 100 }));
  const score = synthetic([element('hero', 0.3), element('ring', 0.4), element('spoke', 0.1), ...crowd]);
  const max = { ringWeight: 1e9, spokeWeight: 1e9, nodeSize: 1e9, heroWeight: 1e9, heroGlow: 1e9, glitchAmount: 1e9 };
  const list = draw(score, at(score, 'peak', 0.5), { hold: false, tension: 1e9, burst: 1e9, forcedState: null }, max);
  assert.equal(list.count, 20000);
  assert.ok(list.dropped > 0);
});

test('capacity drops nodes first, then ticks', () => {
  const nodes = Array.from({ length: 20 }, () => element('node', 0.2));
  const ticks = Array.from({ length: 20 }, () => element('tick', 0.25));
  const score = synthetic([...nodes, ...ticks, element('spoke', 0.1), element('ring', 0.4), element('hero', 0.3)]);
  const position = at(score, 'peak', 0.5);

  const noNodes = kinds(draw(score, position, PERF, {}, 23));
  assert.equal(noNodes.filter((kind) => kind === PRIMITIVE.dot).length, 0);
  assert.equal(noNodes.filter((kind) => kind === PRIMITIVE.segment).length, 21, 'the spoke and twenty ticks');
  assert.equal(noNodes.filter((kind) => kind === PRIMITIVE.ring).length, 2, 'ring and hero');

  const fewTicks = kinds(draw(score, position, PERF, {}, 4));
  assert.equal(fewTicks.filter((kind) => kind === PRIMITIVE.ring).length, 2);
  assert.equal(fewTicks.filter((kind) => kind === PRIMITIVE.segment).length, 2, 'the spoke survives with one tick');
});

test('nodes draw with the shape the composer chose', () => {
  const score = synthetic([element('node', 0.2, { shape: 'square' }), element('node', 0.25, { shape: 'dot' })]);
  assert.deepEqual(kinds(draw(score, at(score, 'peak', 0.5))).sort(), [PRIMITIVE.square, PRIMITIVE.dot].sort());
});

test('an empty score draws nothing and does not throw', () => {
  const score = { ...compose(1, {}), elements: [] };
  for (const state of PHRASE_STATES) assert.equal(draw(score, at(score, state, 0.5)).count, 0);
});

test('no value in the list is NaN at extreme params', () => {
  const score = compose(9, {});
  const keys = ['ringWeight', 'spokeWeight', 'nodeSize', 'heroWeight', 'heroGlow', 'glitchAmount'];
  for (const extreme of [NaN, Infinity, -Infinity, 1e308, -1e308, 0]) {
    const params = Object.fromEntries(keys.map((key) => [key, extreme]));
    const perf = { hold: false, tension: extreme, burst: extreme, forcedState: null };
    for (const state of PHRASE_STATES) {
      const position = { ...at(score, state, 0.5), beat: extreme };
      const list = draw(score, position, perf, params);
      for (let i = 0; i < list.count * STRIDE; i++) assert.ok(Number.isFinite(list.data[i]), `${state} ${extreme} value ${i}`);
    }
  }
});

test('positionAt survives bad clocks', () => {
  const score = compose(2, {});
  for (const beats of [NaN, -Infinity, -5]) assert.deepEqual(positionAt(score, beats), { progress: 0, state: 'seed', stateProgress: 0, beat: 0 });
  assert.equal(positionAt(score, Infinity).progress, 0);
  const end = positionAt(score, lastBeat(score) + 100);
  assert.equal(end.state, 'rest');
  assert.equal(end.stateProgress, 1);
});

test('the evaluator hot path has no allocating syntax', () => {
  const source = readFileSync(new URL('../src/meridian/evaluate.ts', import.meta.url), 'utf8');
  const hot = source.slice(source.indexOf('// HOT PATH')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(hot.includes('export function evaluate'));
  for (const pattern of [/\bnew\s/, /=>/, /[=(,:]\s*\[/, /[=(,]\s*\{/, /\.\.\./, /\.(map|filter|slice|concat|flatMap|reduce|forEach)\(/, /`/]) assert.equal(pattern.test(hot), false, String(pattern));
});

test('consecutive seeds walk through every form, and colour and collapse vary', () => {
  const scores = Array.from({ length: 64 }, (_, seed) => compose(seed, {}));
  assert.equal(new Set(scores.slice(0, FORM_KINDS.length).map((score) => score.form!.kind)).size, FORM_KINDS.length);
  assert.ok(new Set(scores.map((score) => score.form!.scheme)).size >= 6);
  assert.equal(new Set(scores.map((score) => score.form!.collapse)).size, COLLAPSE_STYLES.length);
});

test('square mix bends a ring and negative space clears marks, both from the parameters', () => {
  const score = compose(1, {});
  const position = at(score, 'build', 0.9);
  const plain = draw(score, position);
  assert.notDeepEqual(draw(score, position, PERF, { structureSquareMix: 1 }).data, plain.data);
  assert.ok(draw(score, position, PERF, { structureNegativeSpace: 1 }).count < plain.count);
  assert.ok(draw(score, position, PERF, { structureNegativeSpace: 0 }).count > plain.count);
});

test('Polar / square mix has its full range on a composed-square form', () => {
  const seed = FORM_KINDS.length - 1, score = compose(seed, {});
  assert.equal(score.form!.kind, 'cathedral');
  const position = at(score, 'build', 0.9);
  const shot = (mix: number) => draw(score, position, PERF, { structureSquareMix: mix });
  assert.notDeepEqual(shot(0.1).data, shot(1).data);
  assert.notDeepEqual(shot(0.5).data, shot(1).data);
  assert.deepEqual(shot(0).data, draw(score, position).data, 'zero is the composition as designed');
  assert.ok(kinds(shot(1)).includes(PRIMITIVE.ring), 'at the far end the square is round again');
});

/** One scale tick on a centred form, so its angle shows exactly how far the machine has turned. */
const oneTick = (seed: number): Score => {
  const score = compose(seed, {});
  const tick = element('tick', 0.3, { slot: 1, enter: 0, exit: 0.99, length: 0.05 });
  return { ...score, elements: [tick], form: { ...score.form!, centreX: 0, centreY: 0, twinX: 0, twinY: 0, square: 0 } };
};
const tickAngle = (score: Score, beat: number, beatsPerBar: number, params: Record<string, number>) => {
  const list = draw(score, positionAt(score, beat, beatsPerBar), PERF, { ringTickLength: 0.5, ringTicks: 0.5, ...params });
  return Math.atan2(field(list, 0, 'y'), field(list, 0, 'x'));
};
const turned = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

test('the ratchet clicks on whole beats, in any metre, and stops at Rotation speed 0', () => {
  for (let seed = 0; seed < 40; seed++) for (const beatsPerBar of [3, 4]) {
    const score = oneTick(seed), beats = score.bars * beatsPerBar;
    const first = Math.ceil(score.stateEnds[1] * beats), last = Math.floor(score.stateEnds[4] * beats) - 1;
    const notch = (Math.PI * 2) / (score.symmetry * 6);
    for (let beat = first; beat < last; beat++) {
      const angle = (at: number) => tickAngle(score, at, beatsPerBar, {});
      const click = turned(angle(beat), angle(beat + 0.3)), settled = turned(angle(beat + 0.4), angle(beat + 0.95));
      // The steady drift also turns the tick, so a click is what stands out above it.
      assert.ok(click > notch * 0.8, `seed ${seed} in ${beatsPerBar}: beat ${beat} turned ${click}, a notch is ${notch}`);
      assert.ok(settled < click, `seed ${seed} in ${beatsPerBar}: still clicking after beat ${beat} (${settled} after ${click})`);
    }
    const stopped = (at: number) => tickAngle(score, at, beatsPerBar, { ringRotationSpeed: 0 });
    assert.ok(turned(stopped(first), stopped(last)) < 1e-6, `seed ${seed} turned at speed 0`);
  }
});

test('the life marks answer their opacity controls and fade through the start of Collapse', () => {
  const score = compose(1, {}), peak = at(score, 'peak', 0.5);
  const off = { ringOpacity: 0, spokeOpacity: 0, nodeOpacity: 0 };
  const list = draw(score, peak, PERF, off);
  for (let i = 0; i < list.count; i++) {
    if (field(list, i, 'alpha') <= 0.001) continue;
    const hero = field(list, i, 'width') < 0, point = field(list, i, 'kind') === PRIMITIVE.dot && field(list, i, 'p0') > 0.0055;
    assert.ok(hero || point, `instance ${i} of kind ${field(list, i, 'kind')} stayed lit`);
  }
  const armLight = (position: PhrasePosition) => {
    const shown = draw(score, position);
    let most = 0;
    for (let i = 0; i < shown.count; i++) if (field(shown, i, 'width') === 2 && field(shown, i, 'colour') === 2) most = Math.max(most, field(shown, i, 'alpha'));
    return most;
  };
  const end = at(score, 'peak', 0.999), into = at(score, 'collapse', 0.05), gone = at(score, 'collapse', 0.5);
  assert.ok(armLight(end) > 0, 'the arm is lit at the end of Peak');
  assert.ok(armLight(into) > armLight(end) * 0.4, 'it does not cut out at the boundary');
  assert.equal(armLight(gone), 0, 'it has gone by the middle of Collapse');
});
