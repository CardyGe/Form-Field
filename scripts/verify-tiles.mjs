// Real Electron/WebGL checks for the material tile finishes: LED wall, Characters and Tiles.
// Run: node scripts/verify-tiles.mjs --baseline=<checkout of the commit before them> [--only=neutral,cell,led,char,tile]
// --only takes comma-separated name prefixes. Each check prints one PASS or FAIL
// line, and any failure makes the exit code non-zero. Output goes to work/tiles.
//
// To add a check, add an entry to CHECKS: `run` receives the helpers below and
// returns { ok, detail }. Code passed to `page.evaluate` runs in the renderer
// and reaches the page helpers through `window.tq`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = option('baseline');
const only = option('only')?.split(',').map(s => s.trim()).filter(Boolean);
const out = path.join(root, 'work/tiles');
// Presets allowed to render under .5% lit. None today; add one only with the reason beside it.
const BLANK_PRESETS = [];
const SHAPES = ['Round', 'Square', 'Stripes'];

const needsBaseline = () => baseline ? null : { ok: false, detail: 'needs --baseline=<checkout>' };
const loopVerdict = (r, limit = .1) => ({
  ok: r.literal && r.seam < limit,
  detail: `0/TAU ${r.literal ? 'match' : 'differ'}, seam ${r.seam.toFixed(4)} (limit ${limit})`,
});
const NO_LED = 'LED wall does not change the render. ';
const NO_CHAR = 'Characters do not change the render. ';
const NO_TILE = 'Tiles do not change the render. ';
const STYLES = ['Mosaic', 'Brick', 'Beads'];

const CHECKS = [
  {
    name: 'neutral',
    // Every control at its default: one preset of every kind, plus an Image layer, against the older checkout.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      const r = await page.evaluate(async () => {
        const q = window.tq, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [], blank = [];
        const kinds = [...new Set(q.old.PRESETS.map(p => p.kind)), 'image'];
        const make = (m, kind) => {
          const l = kind === 'image' ? m.createLayer('image') : m.applyPreset(m.createLayer(kind), m.PRESETS.find(p => p.kind === kind).id);
          if (kind === 'image') l.image = { name: 'tiny.png', dataUrl: q.tinyUrl, width: 64, height: 36, fit: 'contain' };
          l.id = 'neutral-proof';
          const p = m.createProject(); p.id = 'neutral-proof'; p.layers = [l]; p.background = '#000000';
          return p;
        };
        let lowest = 1;
        for (const kind of kinds) {
          const now = make(q.m, kind), then = make(q.old, kind);
          await q.renderer.prepare(now); await before.prepare(then);
          const a = await q.renderer.exportPNG(now, .9, 960, 540), b = await before.exportPNG(then, .9, 960, 540);
          if (!q.same(a, b)) changed.push(kind);
          const share = q.litShare(await q.pixels(a)); lowest = Math.min(lowest, share);
          if (share < .005) blank.push(kind);
        }
        before.dispose();
        return { kinds: kinds.length, changed, blank, lowest };
      });
      const unexpected = r.blank.filter(k => !BLANK_PRESETS.includes(k));
      return { ok: r.changed.length === 0 && unexpected.length === 0, detail: `${r.changed.length ? `changed: ${r.changed.join(', ')}` : `${r.kinds} kinds byte-identical`}; lowest lit share ${(r.lowest * 100).toFixed(2)}% (limit .5%); blank: ${r.blank.join(', ') || 'none'}` };
    },
  },
  {
    name: 'cell-average',
    // A one-pixel checker in two premultiplied colours, with cell edges that fall between pixels.
    // Each cell must hold the exact area mean of the pixels inside it. Sampling the cell's centre gives
    // one of the two colours, a full half-swing off.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.tq, A = [.9, .2, .4, 1], B = [0, .3, .05, .5], rows = [];
        for (const [W, H, size] of [[960, 540, 7.3], [960, 540, 10], [960, 540, 23], [960, 540, 30], [1280, 720, 13.7], [3840, 2160, 10], [3840, 2160, 30]]) {
          const texture = q.texels((x, y) => (x + y) & 1 ? A : B, W, H), layer = q.smooth({ ledAmount: 1, ledSize: size });
          q.renderer.tileSource(layer, layer, texture, .9, W, H);
          const grid = q.m.cellGrid(W, H, size), cells = q.readHalf(q.renderer.tileCells, grid.cols, grid.rows);
          texture.dispose();
          let worst = 0;
          for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
            // Frame-fixed cells counted from the top; texel rows counted from the bottom.
            const x0 = Math.min(W, c * grid.cellUv[0] * W), x1 = Math.min(W, (c + 1) * grid.cellUv[0] * W);
            const y0 = Math.max(0, (1 - (r + 1) * grid.cellUv[1]) * H), y1 = Math.max(0, (1 - r * grid.cellUv[1]) * H);
            if (x1 <= x0 || y1 <= y0) continue;
            const sum = [0, 0, 0, 0]; let area = 0;
            for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
              const w = (Math.min(x1, x + 1) - Math.max(x0, x)) * (Math.min(y1, y + 1) - Math.max(y0, y)), v = (x + y) & 1 ? A : B;
              for (let k = 0; k < 4; k++) sum[k] += w * v[k];
              area += w;
            }
            const at = ((grid.rows - 1 - r) * grid.cols + c) * 4;
            for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(cells[at + k] - sum[k] / area));
          }
          rows.push({ W, H, size, cells: grid.cols * grid.rows, worst: worst * 255 });
        }
        return rows;
      });
      return { ok: rows.every(r => r.worst < 2), detail: `${rows.map(r => `${r.W}x${r.H} pitch ${r.size}: worst ${r.worst.toFixed(3)}/255 over ${r.cells} cells`).join('; ')} (limit 2/255)` };
    },
  },
  {
    name: 'led-shapes',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, plain = await q.px(q.project([q.smooth()])), shots = [];
        for (let s = 0; s < 3; s++) shots.push(await q.px(q.project([q.smooth({ ledAmount: 1, ledShape: s, ledSize: 20 })])));
        const moved = shots.map(s => q.difference(plain, s));
        let closest = Infinity;
        for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) closest = Math.min(closest, q.difference(shots[a], shots[b]));
        // Stripes on white: 15-pixel cells at 960x540, each with a red, a green and a blue bar, left to right.
        const W = 960, H = 540, white = await q.px(q.exact(q.project([q.white({ ledAmount: 1, ledShape: 2, ledSize: 30, ledDot: .8, ledBrightness: 1 })])));
        let row = 0, most = -1;
        for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += white[(y * W + x) * 4] + white[(y * W + x) * 4 + 1] + white[(y * W + x) * 4 + 2]; if (s > most) { most = s; row = y; } }
        const pure = (x, k) => { const i = (row * W + x) * 4; return [0, 1, 2].every(c => c === k ? white[i + c] > 200 : white[i + c] < 30); };
        let cells = 0, striped = 0;
        for (let c = 0; c < W / 15; c++) { cells++; if (pure(c * 15 + 2, 0) && pure(c * 15 + 7, 1) && pure(c * 15 + 12, 2)) striped++; }
        return { moved, closest, striped: striped / cells };
      });
      const ok = r.moved.every(v => v > 3) && r.closest > 1 && r.striped > .95;
      return { ok, detail: `${r.moved.some(v => v <= 3) ? NO_LED : ''}against plain ${r.moved.map((v, i) => `${SHAPES[i]} ${v.toFixed(2)}`).join(', ')} (limit 3); closest pair ${r.closest.toFixed(2)} (limit 1); white cells showing red, green and blue bars ${(r.striped * 100).toFixed(1)}% (limit 95%)` };
    },
  },
  {
    name: 'led-scale',
    // The same pitch rendered for a 960 preview and a 3840 export. The export is averaged down 4x4 in linear light.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.tq, rows = [];
        // Stripes triple each channel in its bar, so they run at brightness .5: light the display clips pixel by
        // pixel would make the two sizes differ for a reason that is not the LED wall's.
        for (const [shape, size] of [[0, 10], [1, 10], [2, 14], [0, 4], [1, 3]]) {
          const p = q.exact(q.project([q.smooth({ ledAmount: 1, ledShape: shape, ledSize: size, ledBrightness: shape === 2 ? .5 : 1 })]));
          const small = await q.px(p, .9, 960, 540), big = await q.px(p, .9, 3840, 2160);
          const down = q.linearDown(big, 960, 540, 4);
          rows.push({ shape, size, mean: q.difference(small, down), moved: q.difference(small, await q.px(q.exact(q.project([q.smooth()])))) });
        }
        return rows;
      });
      const ok = rows.every(r => r.mean < 2 && r.moved > 3);
      return { ok, detail: `${rows.some(r => r.moved <= 3) ? NO_LED : ''}${rows.map(r => `${SHAPES[r.shape]} pitch ${r.size}: ${r.mean.toFixed(3)}`).join(', ')} (limit 2/255)` };
    },
  },
  {
    name: 'led-gaps',
    // 10-pixel cells at 960x540, so every cell corner falls on a pixel edge in either row order.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 960, H = 540, led = { ledAmount: 1, ledSize: 20, ledDot: .75, ledBrightness: 1 };
        const zones = (px, test) => {
          const out = { gapLeft: 0, gapLeftOk: 0, gapRight: 0, gapRightOk: 0, lit: 0, litOk: 0 };
          for (let y = 0; y < H; y += 10) for (let x = 0; x < W; x += 10) {
            const g = (y * W + x) * 4, c = ((y + 5) * W + x + 5) * 4;
            if (x < 470) { out.gapLeft++; if (test.left(px, g)) out.gapLeftOk++; out.lit++; if (px[c + 3] === 255 && px[c] > 200) out.litOk++; }
            else if (x >= 490) { out.gapRight++; if (px[g + 3] === 0) out.gapRightOk++; }
          }
          return out;
        };
        const share = z => ({ left: z.gapLeftOk / z.gapLeft, right: z.gapRight ? z.gapRightOk / z.gapRight : 1, lit: z.litOk / z.lit });
        // Transparent gaps on a fully opaque layer.
        const opaque = await q.px(q.exact(q.project([q.white({ ...led, ledGaps: 0 })], true)));
        const clear = share(zones(opaque, { left: (px, i) => px[i + 3] === 0 }));
        let rightGaps = 0, rightClear = 0;
        for (let y = 0; y < H; y += 10) for (let x = 490; x < W; x += 10) { rightGaps++; if (opaque[(y * W + x) * 4 + 3] === 0) rightClear++; }
        // Black and palette gaps on a layer that covers only the left half of the frame.
        const black = share(zones(await q.px(q.exact(q.project([q.half({ ...led, ledGaps: 1 })], true))), { left: (px, i) => px[i + 3] === 255 && px[i] + px[i + 1] + px[i + 2] === 0 }));
        const layer = q.half({ ...led, ledGaps: 3 }), swatch = layer.palette[1];
        const want = [1, 3, 5].map(i => parseInt(swatch.slice(i, i + 2), 16));
        const colour = share(zones(await q.px(q.exact(q.project([layer], true))), { left: (px, i) => px[i + 3] === 255 && [0, 1, 2].every(k => Math.abs(px[i + k] - want[k]) <= 2) }));
        return { clear: { ...clear, right: rightClear / rightGaps }, black, colour, swatch };
      });
      const pct = v => `${(v * 100).toFixed(1)}%`;
      const ok = r.clear.left === 1 && r.clear.right === 1 && r.clear.lit === 1 && r.black.left === 1 && r.black.right === 1 && r.black.lit === 1 && r.colour.left === 1 && r.colour.right === 1 && r.colour.lit === 1;
      return { ok, detail: `${r.clear.lit < 1 ? NO_LED : ''}Transparent: gaps clear ${pct(Math.min(r.clear.left, r.clear.right))}, emitters solid ${pct(r.clear.lit)}; Black: covered gaps black ${pct(r.black.left)}, uncovered clear ${pct(r.black.right)}; Colour 2 (${r.swatch}): covered gaps that colour ${pct(r.colour.left)}, uncovered clear ${pct(r.colour.right)} (all must be 100%)` };
    },
  },
  {
    name: 'led-glow',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, led = { ledAmount: 1, ledSize: 16 };
        const glowOf = async bright => {
          const on = await q.px(q.project([q.smooth({ ...led, ledBrightness: bright, glowMix: .8 })]));
          const off = await q.px(q.project([q.smooth({ ...led, ledBrightness: bright })]));
          return q.difference(on, off);
        };
        const one = await glowOf(1), three = await glowOf(3);
        // Glow off: the LED pass's own linear output on a .8 grey source.
        const W = 480, H = 270, peak = [];
        for (const bright of [1, 3]) {
          const texture = q.texels(() => [.8, .8, .8, 1], W, H), layer = q.smooth({ ...led, ledBrightness: bright });
          q.renderer.tileSource(layer, layer, texture, .9, W, H);
          const values = q.readHalf(q.renderer.tileTarget, W, H);
          texture.dispose();
          let most = 0; for (let i = 0; i < values.length; i += 4) most = Math.max(most, values[i]);
          peak.push(most);
        }
        return { one, three, peak };
      });
      const ok = r.three > 2 * r.one && r.three > 2 && r.peak[1] > 2 && Math.abs(r.peak[0] - .8) < .02;
      return { ok, detail: `glow added at brightness 1: ${r.one.toFixed(2)}, at 3: ${r.three.toFixed(2)} (needs over twice and over 2); with Glow off the LED peak on .8 grey is ${r.peak[0].toFixed(3)} at brightness 1 and ${r.peak[1].toFixed(3)} at 3 (needs over 2, not clamped to 1)` };
    },
  },
  {
    name: 'led-dead',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 960, H = 540;
        const dark = async (dead, phase) => {
          const px = await q.px(q.exact(q.project([q.white({ ledAmount: 1, ledSize: 20, ledBrightness: 1, ledDead: dead })])), phase);
          const mask = [];
          for (let y = 5; y < H; y += 10) for (let x = 5; x < W; x += 10) mask.push(px[(y * W + x) * 4] < 40 ? 1 : 0);
          return mask;
        };
        const a = await dark(.05, .9), b = await dark(.05, 4), none = await dark(0, .9);
        const share = m => m.reduce((s, v) => s + v, 0) / m.length;
        return { share: share(a), none: share(none), same: a.every((v, i) => v === b[i]), cells: a.length };
      });
      const ok = Math.abs(r.share - .05) <= .015 && r.none === 0 && r.same;
      return { ok, detail: `${(r.share * 100).toFixed(2)}% of ${r.cells} emitters dark (limit 5 ± 1.5); none dark at 0: ${r.none === 0 ? 'yes' : `no, ${(r.none * 100).toFixed(2)}%`}; ${r.same ? 'the same ones' : 'different ones'} at another phase` };
    },
  },
  {
    name: 'led-loop',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, flicker = { ledAmount: 1, ledSize: 12, ledFlicker: .5 };
        const still = q.project([q.smooth(flicker)]), moving = q.project([q.moving(flicker)]);
        // On a still picture any change between frames is the flicker.
        const shimmer = q.difference(await q.px(still, 1), await q.px(still, 1.3));
        return { still: await q.loop(still), moving: await q.loop(moving), shimmer };
      });
      const a = loopVerdict(r.still), b = loopVerdict(r.moving);
      return { ok: a.ok && b.ok && r.shimmer > .5, detail: `${r.shimmer <= .5 ? 'Flicker does not change the render. ' : ''}still picture ${a.detail}; moving picture ${b.detail}; flicker between two frames ${r.shimmer.toFixed(2)} (over .5)` };
    },
  },
  {
    name: 'led-engage',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, plain = await q.px(q.project([q.smooth()]));
        return { tiny: q.difference(plain, await q.px(q.project([q.smooth({ ledAmount: .001, ledShape: 2, ledBrightness: 4 })]))), full: q.difference(plain, await q.px(q.project([q.smooth({ ledAmount: 1 })]))) };
      });
      return { ok: r.tiny < 1 && r.full > 3, detail: `${r.full <= 3 ? NO_LED : ''}amount .001 against plain ${r.tiny.toFixed(4)} (limit 1); amount 1 ${r.full.toFixed(2)} (over 3)` };
    },
  },
  {
    name: 'led-layers',
    // Two LED layers at different pitches share the cell target. The finer one is first, so the second uses part
    // of a larger target. Each half of the frame must match that layer rendered alone, and a second frame must not
    // resize the shared target.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 960, H = 540, fine = { ledAmount: 1, ledSize: 10 }, coarse = { ledAmount: 1, ledSize: 24, ledShape: 1 };
        const both = q.exact(q.project([q.smooth(fine), q.rightSmooth(coarse)]));
        const together = await q.px(both);
        const fineAlone = await q.px(q.exact(q.project([q.smooth(fine)])));
        const coarseAlone = await q.px(q.exact(q.project([q.rightSmooth(coarse)])));
        const region = (a, b, x0, x1) => { let sum = 0, n = 0; for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) for (let k = 0; k < 4; k++) { sum += Math.abs(a[(y * W + x) * 4 + k] - b[(y * W + x) * 4 + k]); n++; } return sum / n; };
        await q.shot(both, 1.2);
        const cells = q.renderer.tileCells, resize = cells.setSize;
        let resized = 0;
        cells.setSize = function (...args) { resized++; return resize.apply(this, args); };
        try { await q.shot(both, 1.5); await q.shot(both, 1.8); } finally { cells.setSize = resize; }
        return { left: region(together, fineAlone, 0, 470), right: region(together, coarseAlone, 490, W), resized, kept: q.renderer.tileCells === cells, distinct: region(fineAlone, coarseAlone, 490, W) };
      });
      const ok = r.left < .5 && r.right < .5 && r.distinct > 3 && r.resized === 0 && r.kept;
      return { ok, detail: `left half against the fine layer alone ${r.left.toFixed(3)}, right half against the coarse layer alone ${r.right.toFixed(3)} (limits .5; the two looks differ by ${r.distinct.toFixed(2)}); cell target resized ${r.resized} times over two more frames (limit 0)${r.kept ? '' : ', and replaced'}` };
    },
  },
  {
    name: 'led-history',
    // The LED wall reads the echo's result once. If it entered the history, each echo would be tiled again.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, total = Math.round(q.m.createProject().duration * q.m.createProject().fps.num / q.m.createProject().fps.den);
        const phase = frame => frame * Math.PI * 2 / total;
        const led = { ledAmount: 1, ledSize: 12, ledBrightness: 1 };
        const scene = params => q.exact(q.project([q.smooth({ echo: .9, echoZoom: .96, echoDriftX: .01, ...params })]));
        const direct = await q.shot(scene(led), phase(60));
        await q.shot(scene(led), phase(90)); await q.shot(scene(led), phase(10));
        const sought = await q.shot(scene(led), phase(60));
        const echoOnly = await q.shot(scene({}), phase(60));
        // The correct picture is the plain echo tiled once; the defect is that picture tiled again.
        const once = await q.shot(q.exact(q.project([q.image(q.urlOf(echoOnly), led, 'echo-once')])), phase(60));
        const twice = await q.shot(q.exact(q.project([q.image(q.urlOf(once), led, 'echo-twice')])), phase(60));
        const [a, b, c, d] = await Promise.all([direct, once, twice, echoOnly].map(q.pixels));
        return { same: q.same(direct, sought), toOnce: q.difference(a, b), toTwice: q.difference(a, c), moved: q.difference(a, d) };
      });
      const ok = r.same && r.moved > 1 && r.toOnce < 2 && r.toOnce < r.toTwice / 2;
      return { ok, detail: `${r.moved <= 1 ? NO_LED : ''}seek ${r.same ? 'byte-identical' : 'differs'}; against echo tiled once ${r.toOnce.toFixed(3)} (limit 2), tiled twice ${r.toTwice.toFixed(3)}, moved ${r.moved.toFixed(2)}` };
    },
  },
  {
    name: 'char-sets',
    // Each set must change the render. On a black-to-white ramp, each column of cells is matched to the glyph a flat
    // grey of that glyph's tone draws: columns must run from the empty glyph to the full one, in order, using every glyph.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, plain = await q.px(q.project([q.smooth()])), shots = [], sets = [];
        const W = 960, H = 540, size = 40, cell = 20, row = 10, cols = W / cell;
        const block = (px, c) => { const out = []; for (let y = row * cell; y < (row + 1) * cell; y++) for (let x = c * cell; x < (c + 1) * cell; x++) out.push(px[(y * W + x) * 4 + 3]); return out; };
        const far = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
        for (let s = 0; s < q.m.CHAR_SETS.length; s++) {
          shots.push(await q.px(q.project([q.smooth({ charAmount: 1, charSet: s })])));
          const ink = { charAmount: 1, charSet: s, charSize: size, charColour: 1, charInk: 1, charGaps: 0 };
          const n = Array.from(q.m.CHAR_SETS[s].glyphs).length, refs = [];
          for (let i = 0; i < n; i++) refs.push(block(await q.px(q.exact(q.project([await q.grey(i / (n - 1), ink)], true))), cols / 2));
          const ramp = await q.px(q.exact(q.project([q.ramp(ink)], true))), order = [];
          for (let c = 0; c < cols; c++) { const b = block(ramp, c); let best = 0; for (let i = 1; i < n; i++) if (far(b, refs[i]) < far(b, refs[best])) best = i; order.push(best); }
          const first = block(ramp, 0), last = block(ramp, cols - 1);
          sets.push({
            moved: q.difference(plain, shots[s]), n, order: [...new Set(order)].join(''),
            inOrder: order.every((v, i) => i === 0 || v >= order[i - 1]), every: new Set(order).size === n,
            empty: first.every(v => v === 0), full: far(last, refs[n - 1]) / last.length, refsInk: refs.map(b => b.filter(v => v > 128).length),
          });
        }
        let closest = Infinity;
        for (let a = 0; a < shots.length; a++) for (let b = a + 1; b < shots.length; b++) closest = Math.min(closest, q.difference(shots[a], shots[b]));
        return { sets, closest };
      });
      const names = ['Density', 'Blocks', 'Binary', 'Dots'];
      const ok = r.closest > 1 && r.sets.every(s => s.moved > 3 && s.inOrder && s.every && s.empty && s.full < 2 && s.order.startsWith('0') && s.order.endsWith(String(s.n - 1)));
      return { ok, detail: `${r.sets.some(s => s.moved <= 3) ? NO_CHAR : ''}${r.sets.map((s, i) => `${names[i]}: against plain ${s.moved.toFixed(2)}, ramp glyphs ${s.order} (${s.inOrder ? 'in order' : 'OUT OF ORDER'}, ${s.every ? 'all used' : 'some missing'}), first cell ${s.empty ? 'empty' : 'not empty'}, last cell off the full glyph by ${s.full.toFixed(2)}/255`).join('; ')}; closest pair of sets ${r.closest.toFixed(2)} (limit 1)` };
    },
  },
  {
    name: 'char-sharp',
    // White under '1' glyphs on black at a 3840-wide export. Along each row, pixels between dark (<10%) and lit
    // (>90%) are the edge; a blurred or stair-stepped glyph has wider edges.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 3840, H = 2160;
        const px = await q.px(q.exact(q.project([q.white({ charAmount: 1, charSize: 48, charSet: 2, charGaps: 1 })])), .9, W, H);
        const widths = [];
        for (let y = 0; y < H; y += 3) {
          let last = null, mids = 0;
          for (let x = 0; x < W; x++) {
            const v = px[(y * W + x) * 4], k = v < 26 ? 0 : v > 229 ? 2 : 1;
            if (k === 1) { mids++; continue; }
            if (last !== null && last !== k) widths.push(mids);
            last = k; mids = 0;
          }
        }
        widths.sort((a, b) => a - b);
        return { edges: widths.length, mean: widths.reduce((s, v) => s + v, 0) / Math.max(1, widths.length), p90: widths[Math.floor(widths.length * .9)] ?? 0 };
      });
      return { ok: r.edges > 1000 && r.mean <= 1.5, detail: `${r.edges} edges crossed, mean edge width ${r.mean.toFixed(3)} px (limit 1.5), 90th percentile ${r.p90} px` };
    },
  },
  {
    name: 'char-upright',
    // '1' glyphs at a 3840x2160 export with 64-pixel cells, one output pixel per stored glyph pixel. A cell's lit
    // pixels must match the stored glyph as drawn, not turned upside down or mirrored.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 3840, H = 2160, px = 64, atlas = q.m.buildGlyphAtlas(q.m.CHAR_SETS[2].glyphs, px);
        const shot = await q.px(q.exact(q.project([q.white({ charAmount: 1, charSize: 32, charSet: 2, charGaps: 1 })])), .9, W, H);
        const glyph = (x, y) => atlas.field[y * atlas.width + 2 * px + x] > .5;
        const score = flip => {
          let same = 0;
          for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
            const lit = shot[((10 * px + y) * W + 20 * px + x) * 4] > 128;
            if (lit === glyph(flip.x ? px - 1 - x : x, flip.y ? px - 1 - y : y)) same++;
          }
          return same / (px * px);
        };
        return { upright: score({}), upsideDown: score({ y: true }), mirrored: score({ x: true }) };
      });
      const ok = r.upright > .98 && r.upright > r.upsideDown + .02 && r.upright > r.mirrored + .02;
      return { ok, detail: `cell pixels matching the glyph as drawn ${(r.upright * 100).toFixed(1)}% (over 98%), upside down ${(r.upsideDown * 100).toFixed(1)}%, mirrored ${(r.mirrored * 100).toFixed(1)}%` };
    },
  },
  {
    name: 'char-scale',
    // The same character size for a 960 preview and a 3840 export, averaged down 4x4 in linear light.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.tq, rows = [];
        for (const [set, size] of [[0, 16], [0, 8], [1, 24], [3, 48], [2, 4]]) {
          const p = q.exact(q.project([q.smooth({ charAmount: 1, charSet: set, charSize: size })]));
          const small = await q.px(p, .9, 960, 540), big = await q.px(p, .9, 3840, 2160);
          rows.push({ set, size, mean: q.difference(small, q.linearDown(big, 960, 540, 4)), moved: q.difference(small, await q.px(q.exact(q.project([q.smooth()])))) });
        }
        return rows;
      });
      const names = ['Density', 'Blocks', 'Binary', 'Dots'];
      return { ok: rows.every(r => r.mean < 3 && r.moved > 3), detail: `${rows.some(r => r.moved <= 3) ? NO_CHAR : ''}${rows.map(r => `${names[r.set]} size ${r.size}: ${r.mean.toFixed(3)}`).join(', ')} (limit 3/255)` };
    },
  },
  {
    name: 'char-colour',
    // Transparent background, so glyph pixels carry their colour unmixed. Fully covered glyph pixels must hold their
    // cell's mean colour (Layer colour) or the chosen swatch (Palette ink).
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 960, H = 540, cell = 10, chars = { charAmount: 1, charSize: 20, charGaps: 0 };
        const plain = await q.px(q.exact(q.project([q.smooth()], true)));
        const toLinear = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
        const toByte = v => 255 * (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055);
        const mean = (cx, cy) => [0, 1, 2].map(k => { let s = 0; for (let y = cy * cell; y < (cy + 1) * cell; y++) for (let x = cx * cell; x < (cx + 1) * cell; x++) s += toLinear(plain[(y * W + x) * 4 + k]); return toByte(s / cell / cell); });
        const means = []; for (let cy = 0; cy < H / cell; cy++) for (let cx = 0; cx < W / cell; cx++) means.push(mean(cx, cy));
        const layer = await q.px(q.exact(q.project([q.smooth(chars)], true)));
        let solid = 0, kept = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4; if (layer[i + 3] < 250) continue;
          solid++; const want = means[Math.floor(y / cell) * (W / cell) + Math.floor(x / cell)];
          if ([0, 1, 2].every(k => Math.abs(layer[i + k] - want[k]) <= 3)) kept++;
        }
        const inkLayer = q.smooth({ ...chars, charColour: 1, charInk: 3 }), swatch = inkLayer.palette[2], target = [1, 3, 5].map(i => parseInt(swatch.slice(i, i + 2), 16));
        const ink = await q.px(q.exact(q.project([inkLayer], true)));
        let inked = 0, matched = 0;
        for (let i = 0; i < ink.length; i += 4) { if (ink[i + 3] < 250) continue; inked++; if ([0, 1, 2].every(k => Math.abs(ink[i + k] - target[k]) <= 2)) matched++; }
        return { solid, kept: kept / Math.max(1, solid), inked, matched: matched / Math.max(1, inked), swatch };
      });
      const pct = v => `${(v * 100).toFixed(2)}%`;
      const ok = r.solid > 1000 && r.kept >= .99 && r.inked > 1000 && r.matched >= .995;
      return { ok, detail: `${r.solid <= 1000 ? NO_CHAR : ''}Layer colour: ${pct(r.kept)} of ${r.solid} solid glyph pixels hold their cell's colour within 3/255 (limit 99%); Palette ink Colour 3 (${r.swatch}): ${pct(r.matched)} of ${r.inked} hold it within 2/255 (limit 99.5%)` };
    },
  },
  {
    name: 'char-swaps',
    // White under '@' glyphs: a cell that swaps shows another glyph. Eight swaps a loop, so slots are .785 wide,
    // centred on multiples of TAU/8: .6 and 1.0 share slot 1, 1.6 is slot 2 and 3.9 slot 5.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 960, H = 540, cell = 10, base = { charAmount: 1, charSize: 20, charGaps: 1 };
        const still = q.exact(q.project([q.white({ ...base, charSwaps: 8, charSwapChance: .2 })]));
        const none = await q.px(q.exact(q.project([q.white(base)])), .6);
        const changed = (a, b) => {
          let n = 0, total = 0;
          for (let cy = 0; cy < H / cell; cy++) for (let cx = 0; cx < W / cell; cx++) {
            total++;
            let moved = false;
            for (let y = cy * cell; y < (cy + 1) * cell && !moved; y++) for (let x = cx * cell; x < (cx + 1) * cell; x++) { const i = (y * W + x) * 4; if (Math.abs(a[i] - b[i]) > 40) { moved = true; break; } }
            if (moved) n++;
          }
          return n / total;
        };
        const a = await q.shot(still, .6), b = await q.shot(still, 1.0), c = await q.shot(still, 1.6), d = await q.shot(still, 3.9);
        const [pa, pc, pd] = await Promise.all([a, c, d].map(q.pixels));
        return { shares: [changed(none, pa), changed(none, pc), changed(none, pd)], held: q.same(a, b), between: changed(pa, pc), loop: await q.loop(still) };
      });
      const loop = loopVerdict(r.loop);
      const ok = r.shares.every(s => Math.abs(s - .2) <= .03) && r.held && r.between > .1 && loop.ok;
      return { ok, detail: `${r.shares.every(s => s === 0) ? 'Swaps do not change the render. ' : ''}glyphs swapped at three slots ${r.shares.map(s => `${(s * 100).toFixed(1)}%`).join(', ')} (limit 20 ± 3); ${r.held ? 'held' : 'NOT held'} within a slot; ${(r.between * 100).toFixed(1)}% of cells change between two slots (over 10%); ${loop.detail}` };
    },
  },
  {
    name: 'char-fonts',
    // Every glyph must draw something, and not the box the system draws for a character no font has.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, px = 64, missing = q.m.buildGlyphAtlas('\u{10FFFD}', px).field, bad = [];
        let count = 0;
        for (const set of q.m.CHAR_SETS) {
          const glyphs = Array.from(set.glyphs), atlas = q.m.buildGlyphAtlas(set.glyphs, px);
          glyphs.forEach((glyph, index) => {
            let ink = 0, off = 0;
            for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
              const v = atlas.field[y * atlas.width + index * px + x];
              if (v > .5) ink++;
              off += Math.abs(v - missing[y * px + x]);
            }
            count++;
            const blank = ink === 0, tofu = off / (px * px) < .01;
            if (glyph === ' ' ? !blank : blank || tofu) bad.push(`${set.name} '${glyph}'${blank ? ' empty' : ''}${tofu ? ' missing from the font' : ''}`);
          });
        }
        return { count, bad, missingInk: Array.from(missing).filter(v => v > .5).length };
      });
      return { ok: r.bad.length === 0, detail: `${r.count} glyphs, ${r.bad.length ? `wrong: ${r.bad.join(', ')}` : 'every glyph but the space draws, none as the missing-character box'} (the box covers ${r.missingInk} texels)` };
    },
  },
  {
    name: 'char-engage',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, plain = await q.px(q.project([q.smooth()]));
        return { tiny: q.difference(plain, await q.px(q.project([q.smooth({ charAmount: .001, charSet: 1, charGaps: 4 })]))), full: q.difference(plain, await q.px(q.project([q.smooth({ charAmount: 1 })]))) };
      });
      return { ok: r.tiny < 1 && r.full > 3, detail: `${r.full <= 3 ? NO_CHAR : ''}amount .001 against plain ${r.tiny.toFixed(4)} (limit 1); amount 1 ${r.full.toFixed(2)} (over 3)` };
    },
  },
  {
    name: 'char-stack',
    // LED wall then Characters, each mixed over the result so far, both from the plain layer's cells at their own
    // sizes. Characters at 1 hide the LEDs entirely; Characters at .001 leave the LED wall as it was.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, led = { ledAmount: 1, ledSize: 14 }, chars = { charAmount: 1, charSize: 22, charSet: 0 };
        const shot = params => q.px(q.exact(q.project([q.smooth(params)])));
        const ledAlone = await shot(led), charAlone = await shot(chars);
        return { over: q.difference(charAlone, await shot({ ...led, ...chars })), under: q.difference(ledAlone, await shot({ ...led, ...chars, charAmount: .001 })), distinct: q.difference(ledAlone, charAlone) };
      });
      const ok = r.over < .5 && r.under < 1 && r.distinct > 3;
      return { ok, detail: `LED and Characters at 1 against Characters alone ${r.over.toFixed(3)} (limit .5); Characters at .001 against LED alone ${r.under.toFixed(3)} (limit 1); the two looks differ by ${r.distinct.toFixed(2)}` };
    },
  },
  {
    name: 'tile-styles',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, plain = await q.px(q.project([q.smooth()])), shots = [];
        for (let s = 0; s < 3; s++) shots.push(await q.px(q.project([q.smooth({ tileAmount: 1, tileStyle: s, tileSize: 24 })])));
        const moved = shots.map(s => q.difference(plain, s));
        let closest = Infinity;
        for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) closest = Math.min(closest, q.difference(shots[a], shots[b]));
        return { moved, closest };
      });
      return { ok: r.moved.every(v => v > 3) && r.closest > 1, detail: `${r.moved.some(v => v <= 3) ? NO_TILE : ''}against plain ${r.moved.map((v, i) => `${STYLES[i]} ${v.toFixed(2)}`).join(', ')} (limit 3); closest pair ${r.closest.toFixed(2)} (limit 1)` };
    },
  },
  {
    name: 'tile-grout',
    // White under black grout, relief 0 so tiles stay white. 30-pixel tiles at 960x540, a whole number across the frame.
    // Grout share is measured in linear light, so pixels a tile edge crosses count by area.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.tq, rows = [];
        for (const style of [0, 1]) for (const grout of [0, .3]) {
          const px = await q.px(q.exact(q.project([q.white({ tileAmount: 1, tileStyle: style, tileSize: 60, tileGrout: grout, tileRelief: 0, tileJitter: 0, tileGaps: 1 })])));
          let dark = 0, light = 0, n = 0;
          for (let i = 0; i < px.length; i += 4) { n++; light += q.toLinear(px[i]); if (px[i] < 250) dark++; }
          rows.push({ style, grout, share: 1 - light / n, dark: dark / n });
        }
        return rows;
      });
      const ok = rows.every(r => r.grout === 0 ? r.dark === 0 : Math.abs(r.share - .51) <= .08);
      return { ok, detail: rows.map(r => `${STYLES[r.style]} width ${r.grout}: ${r.grout === 0 ? `${(r.dark * 100).toFixed(2)}% grout pixels (limit 0)` : `grout ${(r.share * 100).toFixed(1)}% (limit 51 ± 8)`}`).join('; ') };
    },
  },
  {
    name: 'tile-brick',
    // White Brick, 30-pixel bricks, black grout, relief 1, light from the right. Along a line through each row, the dark
    // grout columns of odd rows must sit half a brick from those of even rows. Around each brick's centre the stud's rim
    // must be lit on its right, shaded on its left diagonals (a square stud of the same size has no rim there), and
    // flat inside.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 960, H = 540, cell = 30, rows = H / cell;
        const px = await q.px(q.exact(q.project([q.white({ tileAmount: 1, tileStyle: 1, tileSize: 60, tileGrout: .2, tileRelief: 1, tileLight: 0, tileGaps: 1 })])));
        const at = (x, y) => px[(Math.floor(y) * W + Math.floor(x)) * 4];
        const phases = [];
        for (let row = 0; row < rows; row++) {
          let sx = 0, sy = 0;
          const y = row * cell + 8;
          for (let x = 0; x < W; x++) if (at(x, y) < 10) { const a = 2 * Math.PI * (x + .5) / cell; sx += Math.cos(a); sy += Math.sin(a); }
          phases.push(((Math.atan2(sy, sx) / (2 * Math.PI) * cell) % cell + cell) % cell);
        }
        const off = phases.map(p => { const d = ((p - phases[0]) % cell + cell) % cell; return Math.min(d, cell - d); });
        const wrong = off.filter((d, row) => Math.abs(d - (row % 2 ? cell / 2 : 0)) > 1).length;
        let bricks = 0, round = 0;
        const sample = (cx, cy, radius, angle) => at(cx + radius * Math.cos(angle), cy - radius * Math.sin(angle));
        for (let row = 1; row < rows - 1; row++) for (let k = 1; k < W / cell - 1; k++) {
          const cx = k * cell + (row % 2 ? 0 : cell / 2), cy = row * cell + cell / 2;
          const top = at(cx, cy), inner = [0, 1, 2, 3, 4, 5, 6, 7].map(i => sample(cx, cy, 5, i * Math.PI / 4));
          const lit = sample(cx, cy, 8, 0), shaded = [3, 5].map(i => sample(cx, cy, 8, i * Math.PI / 4));
          bricks++;
          if (lit > top + 10 && shaded.every(v => v < top - 20) && inner.every(v => Math.abs(v - top) <= 3)) round++;
        }
        return { phases: phases.map(p => p.toFixed(1)), wrong, round: round / bricks, bricks };
      });
      const ok = r.wrong === 0 && r.round >= .95;
      return { ok, detail: `grout phase by row ${r.phases.slice(0, 4).join(', ')}…, ${r.wrong} rows not offset as expected (limit 0); ${(r.round * 100).toFixed(1)}% of ${r.bricks} bricks show a round stud lit from the right (limit 95%)` };
    },
  },
  {
    name: 'tile-cells',
    // Brick cells: odd rows are offset by half a cell, so each odd-row cell must hold the exact area mean of the
    // offset footprint, not the unshifted grid cell.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.tq, rows = [];
        for (const [W, H, size] of [[960, 540, 20], [960, 540, 23.3], [1280, 720, 13.7]]) {
          const value = (x, y) => [x / W, (y % 7) / 7, ((3 * x + y) % 5) / 5, 1];
          const texture = q.texels(value, W, H), layer = q.smooth({ tileAmount: 1, tileStyle: 1, tileSize: size });
          q.renderer.tileSource(layer, layer, texture, .9, W, H);
          const grid = q.m.cellGrid(W, H, size), cols = grid.cols + 1, cells = q.readHalf(q.renderer.tileCells, cols, grid.rows);
          texture.dispose();
          let worst = 0;
          for (let r = 0; r < grid.rows; r++) for (let c = 0; c < cols; c++) {
            const shift = r % 2 ? .5 : 0;
            const x0 = Math.max(0, Math.min(W, (c - shift) * grid.cellUv[0] * W)), x1 = Math.max(0, Math.min(W, (c + 1 - shift) * grid.cellUv[0] * W));
            const y0 = Math.max(0, (1 - (r + 1) * grid.cellUv[1]) * H), y1 = Math.max(0, (1 - r * grid.cellUv[1]) * H);
            if (x1 <= x0 || y1 <= y0) continue;
            const sum = [0, 0, 0, 0]; let area = 0;
            for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
              const w = (Math.min(x1, x + 1) - Math.max(x0, x)) * (Math.min(y1, y + 1) - Math.max(y0, y)), v = value(x, y);
              for (let k = 0; k < 4; k++) sum[k] += w * v[k];
              area += w;
            }
            const at = ((grid.rows - 1 - r) * cols + c) * 4;
            for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(cells[at + k] - sum[k] / area));
          }
          rows.push({ W, H, size, worst: worst * 255 });
        }
        return rows;
      });
      return { ok: rows.every(r => r.worst < 2), detail: `${rows.map(r => `${r.W}x${r.H} size ${r.size}: worst ${r.worst.toFixed(3)}/255`).join('; ')} (limit 2/255)` };
    },
  },
  {
    name: 'tile-beads',
    // 30-pixel beads at 960x540: the centre of every cell is the hole, the ring at .31 of a cell is the bead.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 960, H = 540, cell = 30, beads = { tileAmount: 1, tileStyle: 2, tileSize: 60 };
        const clear = await q.px(q.exact(q.project([q.white({ ...beads, tileGaps: 0 })], true)));
        const black = await q.px(q.exact(q.project([q.white({ ...beads, tileGaps: 1 })], true)));
        let cells = 0, clearHole = 0, blackHole = 0, ring = 0;
        for (let cy = 0; cy < H / cell; cy++) for (let cx = 0; cx < W / cell; cx++) {
          const x = cx * cell + 15, y = cy * cell + 15, c = (y * W + x) * 4, b = (y * W + x + 9) * 4;
          cells++;
          if (clear[c + 3] === 0) clearHole++;
          if (black[c + 3] === 255 && black[c] + black[c + 1] + black[c + 2] === 0) blackHole++;
          if (clear[b + 3] === 255 && clear[b] > 100) ring++;
        }
        return { cells, clear: clearHole / cells, black: blackHole / cells, ring: ring / cells };
      });
      const pct = v => `${(v * 100).toFixed(1)}%`;
      return { ok: r.clear === 1 && r.black === 1 && r.ring === 1, detail: `${r.ring < 1 ? NO_TILE : ''}of ${r.cells} cells: transparent hole ${pct(r.clear)}, black hole with black grout ${pct(r.black)}, solid bead ring ${pct(r.ring)} (all must be 100%)` };
    },
  },
  {
    name: 'tile-light',
    // Grey Mosaic, 30-pixel regular tiles, relief 1. The bevel band 11 pixels right, left, above and below each tile's
    // centre. Light angle is in degrees, 0 from the right, counter-clockwise: 0 lights the right bevel, 180 the left,
    // 90 the top.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 960, H = 540, cell = 30, out = {};
        for (const light of [0, 180, 90]) {
          const px = await q.px(q.exact(q.project([await q.grey(.7, { tileAmount: 1, tileStyle: 0, tileSize: 60, tileGrout: .1, tileRelief: 1, tileJitter: 0, tileLight: light })])));
          const at = (x, y) => px[(y * W + x) * 4];
          let right = 0, left = 0, up = 0, down = 0, n = 0;
          for (let cy = 0; cy < H / cell; cy++) for (let cx = 0; cx < W / cell; cx++) {
            const x = cx * cell + 15, y = cy * cell + 15;
            right += at(x + 11, y); left += at(x - 12, y); up += at(x, y - 12); down += at(x, y + 11); n++;
          }
          out[light] = { right: right / n, left: left / n, up: up / n, down: down / n };
        }
        return out;
      });
      const a = r[0], b = r[180], c = r[90];
      const ok = a.right > a.left + 20 && b.left > b.right + 20 && c.up > c.down + 20;
      return { ok, detail: `at 0 right ${a.right.toFixed(1)} vs left ${a.left.toFixed(1)}; at 180 right ${b.right.toFixed(1)} vs left ${b.left.toFixed(1)}; at 90 top ${c.up.toFixed(1)} vs bottom ${c.down.toFixed(1)} (lit side must lead by over 20)` };
    },
  },
  {
    name: 'tile-jitter',
    // White Mosaic, 30-pixel tiles, black grout .15 wide. Pixels on the regular grid lines, away from corners, are grout
    // for a regular grid and often not for an uneven one.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, W = 960, H = 540, cell = 30;
        const params = jitter => ({ tileAmount: 1, tileStyle: 0, tileSize: 60, tileGrout: .15, tileRelief: 0, tileGaps: 1, tileJitter: jitter });
        const onLines = px => {
          let n = 0, dark = 0;
          for (let k = 1; k < W / cell; k++) for (let y = 0; y < H; y++) {
            if (y % cell < 10 || y % cell >= 20) continue;
            for (const x of [k * cell - 1, k * cell]) { n++; if (px[(y * W + x) * 4] < 10) dark++; }
          }
          return dark / n;
        };
        const even = await q.px(q.exact(q.project([q.white(params(0))])));
        const uneven = q.exact(q.project([q.white(params(.8))]));
        const a = await q.shot(uneven, .9), b = await q.shot(uneven, 3.4);
        return { even: onLines(even), uneven: onLines(await q.pixels(a)), stable: q.same(a, b) };
      });
      const pct = v => `${(v * 100).toFixed(1)}%`;
      return { ok: r.even > .95 && r.uneven < .75 && r.stable, detail: `grid-line pixels that are grout: irregularity 0 ${pct(r.even)} (over 95%), .8 ${pct(r.uneven)} (under 75%); .8 ${r.stable ? 'byte-identical' : 'DIFFERS'} at another phase` };
    },
  },
  {
    name: 'tile-alpha',
    // A layer coloured (200, 120, 60), opaque to x 300, fading to nothing at x 500. With 10-pixel tiles and grout wide
    // enough to hold whole pixels, nothing may show
    // two cells past the fade, grout must show inside it, and no straight colour may pass 200 by more than 2.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.tq, W = 960, H = 540, rows = [];
        for (const style of [0, 1, 2]) for (const gaps of [0, 1]) {
          const px = await q.px(q.exact(q.project([q.soft({ tileAmount: 1, tileStyle: style, tileSize: 20, tileGrout: .3, tileGaps: gaps, tileRelief: 1, tileJitter: 1 })], true)));
          let outside = 0, over = 0, worst = 0, grout = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4, a = px[i + 3];
            if (x >= 525 && a > 0) outside++;
            if (a >= 32) { const m = Math.max(px[i], px[i + 1], px[i + 2]); worst = Math.max(worst, m); if (m > 202) over++; }
            if (x < 280 && (gaps === 0 ? a === 0 : a === 255 && px[i] + px[i + 1] + px[i + 2] === 0)) grout++;
          }
          rows.push({ style, gaps, outside, over, worst, grout });
        }
        return rows;
      });
      const ok = rows.every(r => r.outside === 0 && r.over === 0 && r.grout > 1000);
      return { ok, detail: `${rows.every(r => r.grout === 0) ? NO_TILE : ''}${rows.map(r => `${STYLES[r.style]} ${r.gaps ? 'black' : 'clear'}: ${r.outside} pixels past the fade, brightest ${r.worst}, ${r.over} over 202, ${r.grout} grout pixels inside`).join('; ')} (limits 0, 0, over 1000)` };
    },
  },
  {
    name: 'tile-scale',
    // The same tile size for a 960 preview and a 3840 export, averaged down 4x4 in linear light.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.tq, rows = [];
        for (const [style, size] of [[0, 18], [1, 18], [2, 18], [0, 6], [1, 4], [2, 3]]) {
          const p = q.exact(q.project([q.smooth({ tileAmount: 1, tileStyle: style, tileSize: size })]));
          const small = await q.px(p, .9, 960, 540), big = await q.px(p, .9, 3840, 2160);
          rows.push({ style, size, mean: q.difference(small, q.linearDown(big, 960, 540, 4)), moved: q.difference(small, await q.px(q.exact(q.project([q.smooth()])))) });
        }
        return rows;
      });
      return { ok: rows.every(r => r.mean < 2 && r.moved > 3), detail: `${rows.some(r => r.moved <= 3) ? NO_TILE : ''}${rows.map(r => `${STYLES[r.style]} size ${r.size}: ${r.mean.toFixed(3)}`).join(', ')} (limit 2/255)` };
    },
  },
  {
    name: 'tile-engage',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, plain = await q.px(q.project([q.smooth()]));
        return { tiny: q.difference(plain, await q.px(q.project([q.smooth({ tileAmount: .001, tileStyle: 2, tileGaps: 4, tileRelief: 1 })]))), full: q.difference(plain, await q.px(q.project([q.smooth({ tileAmount: 1 })]))) };
      });
      return { ok: r.tiny < 1 && r.full > 3, detail: `${r.full <= 3 ? NO_TILE : ''}amount .001 against plain ${r.tiny.toFixed(4)} (limit 1); amount 1 ${r.full.toFixed(2)} (over 3)` };
    },
  },
  {
    name: 'tile-stack',
    // LED wall, then Characters, then Tiles, each from the plain layer's cells in its own region of the shared target.
    // Tiles at 1 hide the others; Tiles at .001 leave LED and Characters as they were.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.tq, under = { ledAmount: 1, ledSize: 14, charAmount: .6, charSize: 22 }, tiles = { tileAmount: 1, tileStyle: 1, tileSize: 26 };
        const shot = params => q.px(q.exact(q.project([q.smooth(params)])));
        const underAlone = await shot(under), tilesAlone = await shot(tiles);
        return { over: q.difference(tilesAlone, await shot({ ...under, ...tiles })), below: q.difference(underAlone, await shot({ ...under, ...tiles, tileAmount: .001 })), distinct: q.difference(underAlone, tilesAlone) };
      });
      const ok = r.over < .5 && r.below < 1 && r.distinct > 3;
      return { ok, detail: `all three with Tiles at 1 against Tiles alone ${r.over.toFixed(3)} (limit .5); Tiles at .001 against LED and Characters ${r.below.toFixed(3)} (limit 1); the two looks differ by ${r.distinct.toFixed(2)}` };
    },
  },
];

const selected = only ? CHECKS.filter(c => only.some(prefix => c.name.startsWith(prefix))) : CHECKS;
if (!selected.length) { console.error(`No check matches --only=${only.join(',')}. Checks: ${CHECKS.map(c => c.name).join(', ')}`); process.exit(2); }

await fs.mkdir(out, { recursive: true });
const bundle = (dir, file, extra = '') => build({
  stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';
export {encodePNG} from './src/rendering/png';
export {DataTexture,RGBAFormat,FloatType,LinearFilter} from 'three';${extra}`, resolveDir: dir, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, file),
  nodePaths: [path.join(root, 'node_modules')], logLevel: 'silent',
});
await bundle(root, 'renderer.js', `\nexport {cellGrid,CHAR_SETS} from './src/rendering/tiles';\nexport {buildGlyphAtlas} from './src/rendering/glyph-atlas';`);
if (baseline) await bundle(path.resolve(baseline), 'baseline.js');
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas id="a" width="960" height="540"></canvas><canvas id="b" width="960" height="540"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const results = [];
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.evaluate(async hasBaseline => {
    const m = await import('./renderer.js');
    const old = hasBaseline ? await import('./baseline.js') : null;
    const renderer = new m.StudioRenderer(document.querySelector('#a'));
    const urlOf = bytes => { const parts = []; for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192))); return `data:image/png;base64,${btoa(parts.join(''))}`; };
    const dataUrl = async (w, h, pixel) => {
      const bytes = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bytes.set(pixel((x + .5) / h - w / h / 2, (y + .5) / h - .5), (y * w + x) * 4);
      return urlOf(await m.encodePNG(bytes, w, h));
    };
    const ramp = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const tinyUrl = await dataUrl(64, 36, (x, y) => [Math.round(255 * (x + .9) / 1.8), Math.round(255 * (y + .5)), 90, Math.round(255 * (1 - ramp(.25, .48, Math.hypot(x, y))))]);
    // Gentle everywhere, kept under full brightness so a 1x LED never clips.
    const smoothUrl = await dataUrl(960, 540, (x, y) => [
      Math.round(128 + 90 * Math.sin(3.1 * x + .4)), Math.round(128 + 90 * Math.cos(4.3 * y - .7)), Math.round(128 + 70 * Math.sin(2.2 * x + 3.7 * y)), 255,
    ]);
    const whiteUrl = await dataUrl(960, 540, () => [255, 255, 255, 255]);
    // White over the left half of the frame, nothing over the right.
    const halfUrl = await dataUrl(960, 540, x => x < 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]);
    const image = (url, params, name, width = 960, height = 540) => {
      const l = m.createLayer('image'); l.id = `${name}-proof`; Object.assign(l.params, params);
      l.image = { name: `${name}.png`, dataUrl: url, width, height, fit: 'contain' };
      return l;
    };
    const smooth = (params = {}) => image(smoothUrl, params, 'smooth');
    const white = (params = {}) => image(whiteUrl, params, 'white');
    const half = (params = {}) => image(halfUrl, params, 'half');
    // The smooth picture over the right half of the frame only.
    const rightSmoothUrl = await dataUrl(960, 540, (x, y) => x < 0 ? [0, 0, 0, 0] : [Math.round(128 + 90 * Math.sin(3.1 * x + .4)), Math.round(128 + 90 * Math.cos(4.3 * y - .7)), Math.round(128 + 70 * Math.sin(2.2 * x + 3.7 * y)), 255]);
    const rightSmooth = (params = {}) => image(rightSmoothUrl, params, 'right-smooth');
    // (200, 120, 60), opaque to x 300 of 960, fading to nothing at x 500.
    const softUrl = await dataUrl(960, 540, x => { const at = (x + 960 / 540 / 2) * 540; return [200, 120, 60, Math.round(255 * Math.min(1, Math.max(0, (500 - at) / 200)))]; });
    const soft = (params = {}) => image(softUrl, params, 'soft');
    // Black at the left edge of the frame to white at the right, even in encoded values.
    const rampUrl = await dataUrl(960, 540, x => { const v = Math.round(255 * Math.min(1, Math.max(0, (x + 960 / 540 / 2) / (960 / 540)))); return [v, v, v, 255]; });
    const rampLayer = (params = {}) => image(rampUrl, params, 'ramp');
    // A flat grey whose encoded value is `value` (0-1). Small, since it is flat.
    const greys = new Map();
    const grey = async (value, params = {}) => {
      const v = Math.round(255 * value);
      if (!greys.has(v)) greys.set(v, await dataUrl(96, 54, () => [v, v, v, 255]));
      return image(greys.get(v), params, `grey-${v}`, 96, 54);
    };
    // An animated source that closes its loop.
    const moving = (params = {}) => { const l = m.applyPreset(m.createLayer('surface'), m.PRESETS.find(p => p.kind === 'surface').id); l.id = 'moving-proof'; Object.assign(l.params, params); return l; };
    const project = (layers, transparent = false) => { const p = m.createProject(); p.id = 'tiles-proof'; p.layers = layers; p.background = '#000000'; p.transparent = transparent; return p; };
    // Exact highlights: the display only clamps and encodes, so pixel values can be reasoned about.
    const exact = p => { p.highlights = 'exact'; return p; };
    const pixels = async bytes => {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('webgl2', { premultipliedAlpha: false });
      const texture = context.createTexture(), frame = context.createFramebuffer();
      context.bindTexture(context.TEXTURE_2D, texture);
      context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, bitmap);
      context.bindFramebuffer(context.FRAMEBUFFER, frame);
      context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, texture, 0);
      const data = new Uint8Array(bitmap.width * bitmap.height * 4);
      context.readPixels(0, 0, bitmap.width, bitmap.height, context.RGBA, context.UNSIGNED_BYTE, data);
      context.getExtension('WEBGL_lose_context')?.loseContext();
      return data;
    };
    const shot = async (p, phase = .9, width = 960, height = 540) => { await renderer.prepare(p); return renderer.exportPNG(p, phase, width, height); };
    const px = async (...args) => pixels(await shot(...args));
    const difference = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
    const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    // The renderer wraps phase, so 0 against TAU alone proves nothing: the seam catches motion that does not close.
    const loop = async p => {
      const start = await shot(p, 0), wrapped = await shot(p, Math.PI * 2), before = await shot(p, Math.PI * 2 - 1e-4);
      return { literal: same(start, wrapped), seam: difference(await pixels(start), await pixels(before)) };
    };
    const litShare = px => { let lit = 0; for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) > 8) lit++; return lit / (px.length / 4); };
    // An sRGB frame averaged down by a whole factor in linear light, then encoded again.
    const toLinear = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const toByte = v => 255 * (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055);
    const linearDown = (big, W, H, f) => {
      const reduced = new Float32Array(W * H * 4), table = Float32Array.from({ length: 256 }, (_, i) => toLinear(i));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) { const v = big[((y * f + b) * W * f + x * f + a) * 4 + c]; sum += c === 3 ? v : table[v]; }
        reduced[(y * W + x) * 4 + c] = c === 3 ? sum / (f * f) : toByte(sum / (f * f));
      }
      return reduced;
    };
    // A float picture fed straight to a pass, filtered like a real layer. Texel (x, y) counts rows from the bottom.
    const texels = (fill, W, H) => {
      const data = new Float32Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(fill(x, y), (y * W + x) * 4);
      const texture = new m.DataTexture(data, W, H, m.RGBAFormat, m.FloatType);
      texture.minFilter = texture.magFilter = m.LinearFilter; texture.needsUpdate = true;
      return texture;
    };
    const fromHalf = h => {
      const sign = h >> 15 ? -1 : 1, e = h >> 10 & 31, f = h & 1023;
      return e === 0 ? sign * f * 2 ** -24 : e === 31 ? (f ? NaN : sign * Infinity) : sign * (1 + f / 1024) * 2 ** (e - 15);
    };
    const readHalf = (target, W, H) => {
      if (!target) throw new Error('the tile pass made no target');
      const raw = new Uint16Array(W * H * 4);
      renderer.renderer.readRenderTargetPixels(target, 0, 0, W, H, raw);
      return Float32Array.from(raw, fromHalf);
    };
    window.tq = { m, old, renderer, tinyUrl, urlOf, image, smooth, white, half, rightSmooth, soft, toLinear, ramp: rampLayer, grey, moving, project, exact, pixels, shot, px, difference, same, loop, litShare, linearDown, texels, readHalf };
  }, !!baseline);

  for (const check of selected) {
    errors.length = 0;
    let result;
    try { result = await check.run({ page, baseline, out }); }
    catch (error) { result = { ok: false, detail: String(error?.message ?? error).split('\n')[0] }; }
    if (errors.length) result = { ok: false, detail: `${result.detail}; page error: ${errors[0].slice(0, 300)}` };
    results.push({ name: check.name, ...result });
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${check.name}: ${result.detail}`);
  }
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
  await app.close();
}
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
if (failed || results.length !== selected.length) process.exitCode = 1;
