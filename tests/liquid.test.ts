import test from 'node:test';
import assert from 'node:assert/strict';
import { packDroplets, liquidGap, LIQUID_TILE, LIQUID_BINS, LIQUID_SLOTS, LIQUID_MAX_RADIUS } from '../src/rendering/liquid-pack';
import { PRESETS, applyPreset, createLayer, createProject, parameterDefinitions, validateProject } from '../src/core/project';

const T = LIQUID_TILE;
const delta = (d: number) => d - T * Math.round(d / T);

test('liquid droplets never overlap, including across the tile edge', () => {
  for (const [seed, range, density] of [[1729, 16, .6], [7, 40, 1], [99, 4, .1]]) {
    const pack = packDroplets(seed, range, density), d = pack.droplets;
    assert.ok(pack.count > 50, `seed ${seed}: ${pack.count} droplets`);
    // Compare through a coarse grid so the check stays fast for thousands of droplets.
    const size = LIQUID_MAX_RADIUS * 2.2, cells = Math.floor(T / size), grid = new Map<number, number[]>();
    const cell = (v: number) => ((Math.floor(v / (T / cells)) % cells) + cells) % cells;
    for (let i = 0; i < pack.count; i++) {
      const key = cell(d[i * 4 + 1]) * cells + cell(d[i * 4]);
      grid.set(key, [...(grid.get(key) ?? []), i]);
    }
    for (let i = 0; i < pack.count; i++) {
      const x = d[i * 4], y = d[i * 4 + 1], r = d[i * 4 + 2];
      assert.ok(x >= 0 && x < T && y >= 0 && y < T && r > 0);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const key = ((cell(y) + oy + cells) % cells) * cells + (cell(x) + ox + cells) % cells;
        for (const j of grid.get(key) ?? []) {
          if (j <= i) continue;
          const distance = Math.hypot(delta(x - d[j * 4]), delta(y - d[j * 4 + 1]));
          assert.ok(distance >= r + d[j * 4 + 2] + 1e-6, `droplets ${i} and ${j} overlap (seed ${seed})`);
        }
      }
    }
  }
});

test('liquid droplet sizes span the requested range and fill the frame', () => {
  const pack = packDroplets(1729, 16, .6);
  let min = Infinity, max = 0;
  for (let i = 0; i < pack.count; i++) { const r = pack.droplets[i * 4 + 2]; min = Math.min(min, r); max = Math.max(max, r); }
  assert.ok(max > LIQUID_MAX_RADIUS * .85 && max <= LIQUID_MAX_RADIUS * 1.18 + 1e-6);
  assert.ok(max / min > 12, `range ${max / min}`);
  assert.ok(pack.coverage > .45 && pack.coverage < .85, `coverage ${pack.coverage}`);
  assert.ok(packDroplets(1729, 16, 1).coverage > packDroplets(1729, 16, .1).coverage + .1);
  assert.ok(liquidGap(.05, 1) < liquidGap(.05, 0));
});

test('liquid layout is repeatable and changes with the seed', () => {
  const a = packDroplets(5, 16, .6), b = packDroplets(5, 16, .6), c = packDroplets(6, 16, .6);
  assert.deepEqual(a.droplets, b.droplets);
  assert.notDeepEqual(Array.from(a.droplets.slice(0, 40)), Array.from(c.droplets.slice(0, 40)));
});

test('every bin lists each droplet that reaches into it', () => {
  const pack = packDroplets(1729, 16, .6), N = LIQUID_BINS, K = LIQUID_SLOTS, bin = T / N;
  assert.equal(pack.texture.length, N * K * N * 4);
  const listed = (bx: number, by: number, i: number) => {
    for (let s = 0; s < K; s++) {
      const at = (by * N * K + bx * K + s) * 4;
      if (pack.texture[at + 2] === 0) return false;
      if (pack.texture[at] === pack.droplets[i * 4] && pack.texture[at + 1] === pack.droplets[i * 4 + 1]) return true;
    }
    return false;
  };
  for (let i = 0; i < pack.count; i += 7) {
    const x = pack.droplets[i * 4], y = pack.droplets[i * 4 + 1], r = pack.droplets[i * 4 + 2];
    for (const [px, py] of [[x, y], [x + r, y], [x - r, y], [x, y + r], [x, y - r]]) {
      const bx = ((Math.floor(px / bin) % N) + N) % N, by = ((Math.floor(py / bin) % N) + N) % N;
      assert.ok(listed(bx, by, i), `droplet ${i} missing from bin ${bx},${by}`);
    }
  }
});

test('liquid is a registered family with usable defaults and presets', () => {
  const layer = createLayer('liquid');
  assert.equal(layer.name, 'Liquid Light');
  assert.equal(layer.palette.length, 6);
  for (const d of parameterDefinitions('liquid')) assert.ok(layer.params[d.key] >= d.min && layer.params[d.key] <= d.max, d.key);
  for (const key of ['sizeRange', 'density']) assert.equal(parameterDefinitions('liquid').find(d => d.key === key)!.preparation, true);
  const presets = PRESETS.filter(p => p.kind === 'liquid');
  assert.equal(presets.length, 6);
  for (const preset of presets) {
    const project = { ...createProject(), layers: [applyPreset(createLayer('liquid'), preset.id)] };
    assert.equal(validateProject(JSON.parse(JSON.stringify(project))).layers.length, 1, preset.id);
  }
});
