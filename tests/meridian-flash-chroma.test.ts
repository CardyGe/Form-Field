import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject } from '../src/core/project';
import { evaluateLayer } from '../src/core/timeline';
import { FlashGuard } from '../src/meridian/flash-guard';
import { PRIMITIVE } from '../src/meridian/types';
import type { DisplayList } from '../src/meridian/display-list';
import { MeridianRenderer, type MeridianRuntime } from '../src/rendering/MeridianRenderer';
import type { Layer, Project } from '../src/shared/types';

/** Judged by the resolve shader's own arithmetic on a known rectangle, never by the guard's measurement. */
const TAU = Math.PI * 2, W = 640, H = 360, FRAMES = 120, ALPHA = 0.9, COVER = 0.74;
const FLAT = { structureZoom: 1, outputSafeMargin: 0, structureRotation: 0, structureEllipse: 0, structureTilt: 0, structureCentreX: 0, structureCentreY: 0, lightExposure: 1, lightVignette: 0, macroHeat: 0.5, colourPalette: 0, colourFringe: 0, lightBackgroundLift: 0, outputBlackLevel: 0 };
type Hooked = { prepareEvolve(l: Layer, p: number, w: number, h: number, r: MeridianRuntime | undefined, e: { list: DisplayList }): void; evolveView: Record<string, number>; layerSaturation?: (l: Layer) => number };

function shade(ink: readonly number[], contrast: number, saturation: number, scale: number): [number, number, number] {
  const c = ink.map(v => (1 - Math.exp(-ALPHA * v * 1.02)) ** (1.14 * contrast)), grey = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const out = c.map(v => Math.max(0, grey + (v - grey) * saturation) * scale);
  return [out[0], out[1], out[2]];
}

function play(key: string, low: number, high: number, cycles: number, palette: string, ink: readonly number[], guard = 1) {
  const layer = createLayer('meridian'); layer.id = 'g0';
  Object.assign(layer.params, { scoreStyle: 2, safetyFlashGuard: guard }, FLAT);
  layer.palette = Array.from({ length: 6 }, (_, i) => (i === 5 ? '#000000' : palette));
  if (cycles) layer.modulations[key] = { kind: 'pulse', cycles, phase: 0, amount: 1, points: [], range: { min: low, max: high } } as never;
  const project: Project = { ...createProject(), layers: [layer], duration: 2, fps: { num: 60, den: 1 }, background: '#000000' };
  const r = new MeridianRenderer(), hooked = r as unknown as Hooked, real = hooked.prepareEvolve.bind(r), width = COVER * W / H;
  hooked.prepareEvolve = (l, phase, w, h, runtime, entry) => {
    real(l, phase, w, h, runtime, entry); Object.assign(hooked.evolveView, FLAT);
    const e = evaluateLayer(l, phase).params; hooked.evolveView[key] = e[key];
    entry.list.clear(); entry.list.push(PRIMITIVE.segment, -width / 2, 0, width / 2, 0, 1, -1, 0, 0, ALPHA, 0, 0);
  };
  const lum: number[] = [], red: number[] = [], gains: number[] = [];
  for (let lap = 0; lap < 3; lap++) for (let f = 0; f < FRAMES; f++) {
    const phase = f / FRAMES * TAU;
    r.beginComposition(project, phase, W, H, 2, true, {});
    const p = evaluateLayer(layer, phase).params, gain = r.layerGain(layer), limit = hooked.layerSaturation?.(layer) ?? Infinity;
    const [R, G, B] = shade(ink, p.lightContrast ?? 1, Math.min(p.colourSaturation ?? 1, limit), gain);
    lum.push(0.2126 * R + 0.7152 * G + 0.0722 * B); red.push(R / Math.max(1e-6, R + G + B) >= 0.8 ? R - G - B : 0); gains.push(gain);
  }
  return { lum: worst(lum, 0.1), red: worst(red, 0.0625), low: Math.min(...gains), freeSaturation: (hooked.layerSaturation?.(layer) ?? Infinity) >= 1 };
}

function worst(v: readonly number[], step: number): number {
  const turns: number[] = []; let anchor = v[0], way = 0;
  v.forEach((x, i) => { if (way === 1 && x > anchor) anchor = x; if (way === -1 && x < anchor) anchor = x; if (way >= 0 && x <= anchor - step) { way = -1; anchor = x; turns.push(i); } else if (way <= 0 && x >= anchor + step) { way = 1; anchor = x; turns.push(i); } });
  let most = 0; for (let i = 0; i < turns.length; i++) { let n = 0; for (let k = i; k < turns.length && turns[k] < turns[i] + 60; k++) n++; most = Math.max(most, n); }
  return most;
}

const RED = [1, 0, 0], WHITE = [1, 1, 1];

test('N9: a 5 Hz Motion pulse on Saturation over a red picture is limited in export', () => {
  assert.ok(play('colourSaturation', 0, 1, 10, '#ff0000', RED, 0).red >= 8, 'the unguarded picture must swing');
  const on = play('colourSaturation', 0, 1, 10, '#ff0000', RED);
  assert.ok(on.red <= 2, `${on.red} saturated-red changes in a second`);
});

test('N9: a 5 Hz Motion pulse on Contrast is limited in export', () => {
  assert.ok(play('lightContrast', 0.5, 2, 10, '#ffffff', WHITE, 0).lum >= 8, 'the unguarded picture must swing');
  const on = play('lightContrast', 0.5, 2, 10, '#ffffff', WHITE);
  assert.ok(on.lum <= 6, `${on.lum} changes in a second`);
});

test('N9: steady red, and a slow Saturation pulse, are left exactly alone', () => {
  const steady = play('colourSaturation', 0, 1, 0, '#ff0000', RED);
  assert.equal(steady.low, 1); assert.ok(steady.freeSaturation);
  const slow = play('colourSaturation', 0, 1, 2, '#ff0000', RED);
  assert.equal(slow.low, 1); assert.ok(slow.freeSaturation, 'a 1 Hz pulse is within the red limit');
});

test('N10: fast anti-phase strobes stay within the limit in every second from the first frame', () => {
  const params = { safetyFlashGuard: 1, safetyMaxFlashes: 3, safetyRedLimit: 0.5, safetyFullField: 0.5 }, n = 1296;
  for (const [hz, fps] of [[10, 30], [12, 60], [15, 60], [15, 120], [15, 144], [10, 60]]) {
    const guard = new FlashGuard(), cells = { count: n, guarded: new Float32Array(n), fixed: new Float32Array(n), red: new Float32Array(n) };
    const anchor = new Float32Array(n), way = new Int8Array(n), events: number[] = [];
    for (let f = 0; f < fps * 4; f++) {
      const t = f / fps, a = Math.sin(TAU * hz * t + 0.4) >= 0 ? 0.9 : 0, b = 0.9 - a;
      cells.guarded.fill(a, 0, 520); cells.guarded.fill(b, 520, 1040); cells.guarded.fill(0, 1040);
      const g = guard.step(1 / fps, cells, params); let up = 0, down = 0;
      for (let i = 0; i < n; i++) {
        const v = cells.guarded[i] * g;
        if (!f) { anchor[i] = v; continue; }
        if (way[i] === 1 && v > anchor[i]) anchor[i] = v; if (way[i] === -1 && v < anchor[i]) anchor[i] = v;
        if (way[i] >= 0 && v <= anchor[i] - 0.1) { way[i] = -1; anchor[i] = v; down++; } else if (way[i] <= 0 && v >= anchor[i] + 0.1) { way[i] = 1; anchor[i] = v; up++; }
      }
      if (Math.max(up, down) / n > 0.25) events.push(t);
    }
    let most = 0; for (let i = 0; i < events.length; i++) { let c = 0; for (let k = i; k < events.length && events[k] < events[i] + 1; k++) c++; most = Math.max(most, c); }
    assert.ok(most <= 6, `${hz} Hz at ${fps} fps: ${most} changes in the worst second`);
  }
});
