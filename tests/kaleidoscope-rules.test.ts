import test from 'node:test';
import assert from 'node:assert/strict';
import { FINISH_LOOKS, KALEIDOSCOPE_INPUT, applyFinish, createLayer, finishSupported, kaleidoscopeRouteHidden, varyLayer } from '../src/core/project';
import { canvasAxes } from '../src/core/canvas-interaction';
import { PARITY_RADII, parityAverage, parityCentres } from '../src/core/kaleidoscope-math';
import { evaluateLayer } from '../src/core/timeline';
import { feedbackGroundAlpha, kaleidoscopeUniforms } from '../src/rendering/kaleidoscope-glsl';
import { kaleidoscopeHidden } from '../src/ui/kaleidoscope-controls';
import type { Layer } from '../src/shared/types';

const TAU = Math.PI * 2;
const open = { palette: false, structure: false, motion: false, material: false };
const kLayer = (params: Record<string, number> = {}) => { const l = createLayer('kaleidoscope'); Object.assign(l.params, params); return l; };
const IDENTITY = ['input', 'group', 'motif', 'spiral', 'spiralA', 'spiralB', 'zoomCycles'];
const SOURCES = Object.values(KALEIDOSCOPE_INPUT);
const echoFinish = (id: string) => 'echo' in FINISH_LOOKS.find(f => f.id === id)!.params;

test('Vary keeps the Source and every identity control, for every source', () => {
  for (const input of SOURCES) for (const group of [0, 1, 4]) for (const spiral of [0, 1]) for (const strength of [.35, .5, 1]) {
    const layer = kLayer({ input, group, spiral, motif: 2, spiralA: 3, spiralB: -2, zoomCycles: 2, echo: input === KALEIDOSCOPE_INPUT.feedback ? .6 : 0 });
    for (let entropy = 0; entropy < 60; entropy++) {
      const varied = varyLayer(layer, strength, open, entropy * 7919 + 1);
      for (const key of IDENTITY) assert.equal(varied.params[key], layer.params[key], `${key}, input ${input}, strength ${strength}`);
      assert.equal(varied.params.echo, layer.params.echo);
    }
  }
});

test('Vary leaves controls that are hidden for this state alone', () => {
  const states: Record<string, number>[] = [{ group: 0 }, { group: 2 }, { spiral: 1 }, { input: 1 }, { input: 2 }, { input: 3, echo: .6 }];
  for (const params of states) {
    const layer = kLayer({ cell: 1.7, sectors: 9, spiralScale: 16, motifScale: 3.3, lineWidth: 2.2, ...params });
    const hidden = kaleidoscopeHidden(layer.params);
    for (let entropy = 1; entropy < 40; entropy++) {
      const varied = varyLayer(layer, 1, open, entropy * 104729);
      for (const key of hidden) assert.equal(varied.params[key], layer.params[key], `${key} with ${JSON.stringify(params)}`);
    }
  }
  const feedback = kLayer({ input: 3, echo: .6, echoZoom: 1.2, echoHue: 5 });
  const varied = varyLayer(feedback, 1, open, 99);
  assert.equal(varied.params.echoZoom, 1.2, 'echo settings do nothing on this source');
  assert.equal(varied.params.echoHue, 5);
});

test('a finish keeps Feedback on, and echo finishes are refused where they do nothing', () => {
  const feedback = kLayer({ input: KALEIDOSCOPE_INPUT.feedback, echo: .6 });
  feedback.modulations.echo = { kind: 'sine', cycles: 1, phase: 0, amount: .2, points: [] };
  for (const finish of FINISH_LOOKS) {
    if (echoFinish(finish.id)) {
      assert.equal(finishSupported(feedback, finish.id), false, finish.id);
      assert.throws(() => applyFinish(feedback, finish.id), /cannot be applied/);
      continue;
    }
    const next = applyFinish(feedback, finish.id);
    assert.equal(next.params.input, KALEIDOSCOPE_INPUT.feedback);
    assert.equal(next.params.echo, .6, finish.id);
    assert.deepEqual(next.modulations.echo, feedback.modulations.echo);
  }
  const below = kLayer({ input: KALEIDOSCOPE_INPUT.below, echo: .4 });
  for (const finish of FINISH_LOOKS) {
    if (echoFinish(finish.id)) { assert.equal(finishSupported(below, finish.id), false); continue; }
    assert.equal(applyFinish(below, finish.id).params.echo, .4, finish.id);
  }
});

test('echo finishes still work on the other Kaleidoscope sources and on other kinds', () => {
  for (const input of [KALEIDOSCOPE_INPUT.motif, KALEIDOSCOPE_INPUT.image]) {
    assert.equal(finishSupported(kLayer({ input }), 'finish-tunnel'), true);
    assert.equal(applyFinish(kLayer({ input }), 'finish-tunnel').params.echo, .95);
    assert.equal(applyFinish(kLayer({ input, echo: .5 }), 'finish-none').params.echo, 0);
  }
  const surface = createLayer('surface');
  assert.equal(applyFinish(surface, 'finish-tunnel').params.echo, .95);
  assert.equal(applyFinish(applyFinish(surface, 'finish-tunnel'), 'finish-none').params.echo, 0);
});

test('the Feedback ground fades continuously from opaque at Echo 0 to clear at Echo .05', () => {
  assert.equal(feedbackGroundAlpha(0), 1);
  assert.equal(feedbackGroundAlpha(.05), 0);
  assert.equal(feedbackGroundAlpha(.6), 0);
  assert.equal(feedbackGroundAlpha(NaN), 1);
  assert.ok(feedbackGroundAlpha(.001) > .99, 'no visible step just above zero');
  assert.ok(feedbackGroundAlpha(.049) < .01, 'no visible step just below the end');
  let last = feedbackGroundAlpha(0);
  for (let i = 1; i <= 5000; i++) {
    const now = feedbackGroundAlpha(i / 5000 * .06);
    assert.ok(now <= last, 'never rises');
    assert.ok(last - now < .001, 'no step');
    last = now;
  }
});

test('on a bright ground, the picture has no step around Echo 0, .001 and .05', () => {
  // One shaded pixel of open ground in its steady state: ground over the kept echo of itself.
  const bright = 1;
  const steady = (echo: number) => {
    const alpha = feedbackGroundAlpha(echo), gain = .97 * echo;
    let value = 0;
    for (let i = 0; i < 4000; i++) value = bright * alpha + (1 - alpha) * gain * value;
    return value;
  };
  assert.equal(steady(0), bright, 'Echo 0 is the opaque ground');
  for (const centre of [.001, .05]) {
    const delta = 1e-4;
    assert.ok(Math.abs(steady(centre + delta) - steady(centre - delta)) < .01, `step at ${centre}`);
  }
  assert.ok(Math.abs(steady(1e-4) - steady(0)) < .001, 'step leaving zero');
  for (let i = 0; i <= 200; i++) { const value = steady(i / 200); assert.ok(value >= 0 && value <= bright + 1e-9, 'energy stays bounded'); }
});

test('the ground uniform follows the echo and is finite', () => {
  assert.equal(kaleidoscopeUniforms(kLayer({ echo: 0 }), 0).uKFeedbackGround, 1);
  assert.equal(kaleidoscopeUniforms(kLayer({ echo: .5 }), 0).uKFeedbackGround, 0);
  assert.equal(kaleidoscopeUniforms(kLayer({ echo: NaN }), 0).uKFeedbackGround, 1);
});

test('circle parity keeps its tile coverage nearly constant through the loop', () => {
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < 720; i++) {
    const { coverage } = parityAverage(i / 720 * TAU);
    low = Math.min(low, coverage); high = Math.max(high, coverage);
  }
  assert.ok(high - low <= .03, `coverage swing ${(high - low).toFixed(4)}`);
});

test('circle parity still moves, and closes the loop', () => {
  const start = parityCentres(0);
  assert.deepEqual(parityCentres(TAU).map(v => +v.toFixed(10)), start.map(v => +v.toFixed(10)));
  for (let disc = 0; disc < 3; disc++) {
    let reach = 0;
    for (let i = 0; i < 180; i++) {
      const now = parityCentres(i / 180 * TAU);
      reach = Math.max(reach, Math.hypot(now[disc * 2] - start[disc * 2], now[disc * 2 + 1] - start[disc * 2 + 1]));
    }
    assert.ok(reach > .05, `disc ${disc} moves ${reach.toFixed(3)}`);
  }
});

test('circle parity average matches brute force at the new positions', () => {
  const n = 1400;
  for (const phase of [0, .7, 1.9, 3.3, 5.1]) {
    const centres = parityCentres(phase);
    let area = 0, ink = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x + .5) / n, v = (y + .5) / n;
      let parity = 0;
      for (let d = 0; d < 3; d++) {
        const dx = u - centres[d * 2], dy = v - centres[d * 2 + 1];
        if (Math.hypot(dx - Math.round(dx), dy - Math.round(dy)) < PARITY_RADII[d]) parity ^= 1;
      }
      if (parity) { area++; ink += .5 + .5 * Math.cos(TAU * (u + v)); }
    }
    const average = parityAverage(phase);
    assert.ok(Math.abs(average.coverage - area / (n * n)) < .002, `coverage at ${phase}`);
    assert.ok(Math.abs(average.ink - ink / (n * n)) < .002, `ink at ${phase}`);
  }
});

const animatedScale = (spiral: number, range = false) => {
  const layer = kLayer({ spiral, motifScale: 3 });
  layer.modulations.motifScale = { kind: 'sine', cycles: 1, phase: 0, amount: .4, points: [], ...(range ? { range: { min: 1, max: 6 } } : {}) };
  return layer;
};

test('while Spiral is on, the render uses the base Motif scale', () => {
  for (const range of [false, true]) {
    const layer = animatedScale(1, range);
    for (let i = 0; i < 64; i++) {
      const phase = i / 64 * TAU;
      assert.equal(evaluateLayer(layer, phase).params.motifScale, 3);
      assert.equal(kaleidoscopeUniforms(evaluateLayer(layer, phase), 0).uKMotifScale, 3);
    }
    assert.ok(layer.modulations.motifScale, 'the saved route stays');
  }
});

test('turning Spiral off restores the saved Motif scale motion', () => {
  for (const range of [false, true]) {
    const layer = animatedScale(0, range);
    assert.notEqual(evaluateLayer(layer, Math.PI / 2).params.motifScale, 3);
  }
  const held = animatedScale(1);
  const back: Layer = { ...held, params: { ...held.params, spiral: 0 } };
  assert.notEqual(evaluateLayer(back, Math.PI / 2).params.motifScale, 3);
});

test('the Motion route for Motif scale is hidden only while Spiral is on', () => {
  assert.equal(kaleidoscopeRouteHidden({ spiral: 1, group: 0, input: 0 }).has('motifScale'), true);
  assert.equal(kaleidoscopeRouteHidden({ spiral: 0, group: 0, input: 0 }).has('motifScale'), false);
  assert.equal(kaleidoscopeHidden({ spiral: 1, group: 0, input: 0 }).has('motifScale'), false, 'the slider stays');
});

test('Rosette ignores Repeat size and keeps the saved value', () => {
  for (const cell of [.5, 1, 2.5]) {
    assert.equal(kaleidoscopeUniforms(kLayer({ group: 0, cell }), .3).uKCell, 1);
    assert.equal(kaleidoscopeUniforms(kLayer({ group: 3, cell }), .3).uKCell, cell);
  }
  const layer = kLayer({ group: 0, cell: 2.5 });
  assert.equal(varyLayer(layer, 1, open, 5).params.cell, 2.5);
  assert.equal(kaleidoscopeUniforms({ ...layer, params: { ...layer.params, group: 2 } }, 0).uKCell, 2.5);
});

test('canvas axes never offer a control hidden for the current state', () => {
  const locks = { structure: false, material: false } as never;
  for (const input of SOURCES) for (const group of [0, 1, 2, 3, 4]) for (const spiral of [0, 1]) {
    const layer = kLayer({ input, group, spiral });
    const hidden = kaleidoscopeHidden(layer.params);
    const axes = canvasAxes(layer, locks);
    assert.ok(axes.length > 0);
    for (const axis of axes) assert.ok(!hidden.has(axis.key), `${axis.key}: input ${input}, group ${group}, spiral ${spiral}`);
  }
  assert.deepEqual(canvasAxes(kLayer({ group: 0 }), locks).map(axis => axis.key), ['twist', 'lens']);
  assert.deepEqual(canvasAxes(kLayer({ group: 3 }), locks).map(axis => axis.key), ['twist', 'lens']);
});
