// Real Electron/WebGL checks for the signal path finishes: VHS and Dropout so far.
// Run: node scripts/verify-signal-path.mjs --baseline=<checkout of the commit before them> [--only=neutral,vhs,drop,signal]
// --only takes comma-separated name prefixes. Each check prints one PASS or FAIL
// line, and any failure makes the exit code non-zero. Output goes to work/signal-path.
// (scripts/verify-signal.mjs is Signal Melt's GPU runner, a different feature.)
//
// To add a check, add an entry to CHECKS: `run` receives the helpers below and
// returns { ok, detail }. Code passed to `page.evaluate` runs in the renderer
// and reaches the page helpers through `window.sq`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = option('baseline');
const only = option('only')?.split(',').map(s => s.trim()).filter(Boolean);
const out = path.join(root, 'work/signal-path');
// Presets allowed to render under .5% lit. None today; add one only with the reason beside it.
const BLANK_PRESETS = [];

const needsBaseline = () => baseline ? null : { ok: false, detail: 'needs --baseline=<checkout>' };
const loopVerdict = (r, limit = .1) => ({
  ok: r.literal && r.seam < limit,
  detail: `0/TAU ${r.literal ? 'match' : 'differ'}, seam ${r.seam.toFixed(4)} (limit ${limit})`,
});
const NO_VHS = 'VHS does not change the render. ';
const NO_DROP = 'Dropout does not change the render. ';
// One VHS control at a time: everything else off, so each check sees only its own control.
const VHS_ALONE = { vhsAmount: 1, vhsTracking: 0, vhsBleed: 0, vhsNoise: 0, vhsHeadSwitch: 0, vhsAge: 0, vhsRoll: 0 };

const CHECKS = [
  {
    name: 'neutral',
    // Every control at its default: one preset of every kind, plus an Image layer, against the older checkout.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      const r = await page.evaluate(async () => {
        const q = window.sq, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [], blank = [];
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
    name: 'vhs-tracking',
    // Tracking wobble alone. Each output row must be the plain row moved sideways (to the nearest whole pixel, with the
    // edge pixel repeating where the row runs out), within 2/255, and rows must not all move alike.
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq, W = 960, H = 540;
        const plain = await q.px(q.exact(q.project([q.smooth()]))), shifted = await q.px(q.exact(q.project([q.smooth({ ...alone, vhsTracking: .8 })])));
        let worst = 0, moved = 0;
        const shifts = new Set();
        for (let y = 0; y < H; y++) {
          let best = Infinity, bestShift = 0;
          for (let s = -400; s <= 400; s++) {
            let err = 0;
            for (let x = 0; x < W && err < best; x++) {
              const a = (y * W + x) * 4, b = (y * W + Math.min(W - 1, Math.max(0, x - s))) * 4;
              for (let k = 0; k < 3; k++) err = Math.max(err, Math.abs(shifted[a + k] - plain[b + k]));
            }
            if (err < best) { best = err; bestShift = s; }
          }
          worst = Math.max(worst, best); shifts.add(bestShift); if (bestShift !== 0) moved++;
        }
        return { worst, distinct: shifts.size, moved: moved / H, change: q.difference(plain, shifted) };
      }, VHS_ALONE);
      const ok = r.worst <= 2 && r.distinct >= 20 && r.moved > .5;
      return { ok, detail: `${r.change < .1 ? NO_VHS : ''}worst row after its best shift ${r.worst}/255 (limit 2); ${r.distinct} different shifts (at least 20); ${(r.moved * 100).toFixed(1)}% of rows moved (over 50%)` };
    },
  },
  {
    name: 'vhs-bleed',
    // A red half and a blue half, rendered at 1920x1080 so pixels are 1080-line pixels. Colour bleed 1 must carry each
    // colour at least 8 pixels past the edge, while the brightness edge (the midpoint of linear luma) stays within 2.
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq, W = 1920, H = 1080, y = 540;
        const edge = await q.redBlue();
        const plain = await q.px(q.exact(q.project([edge()])), .9, W, H), bled = await q.px(q.exact(q.project([edge({ ...alone, vhsBleed: 1 })])), .9, W, H);
        const at = (d, x) => { const i = (y * W + x) * 4; return [q.toLinear(d[i]), q.toLinear(d[i + 1]), q.toLinear(d[i + 2])]; };
        const luma = c => .299 * c[0] + .587 * c[1] + .114 * c[2];
        // How far the other colour reaches past the edge: the farthest pixel holding over 5% of it, the lesser side.
        const reach = d => {
          let red = 0, blue = 0;
          for (let x = 0; x < W / 2; x++) { const c = at(d, x); if (c[2] / (c[0] + c[2] + 1e-6) > .05) { blue = W / 2 - x; break; } }
          for (let x = W - 1; x >= W / 2; x--) { const c = at(d, x); if (c[0] / (c[0] + c[2] + 1e-6) > .05) { red = x - W / 2 + 1; break; } }
          return Math.min(red, blue);
        };
        const crossing = d => {
          const mid = (luma(at(d, 600)) + luma(at(d, 1320))) / 2;
          for (let x = 600; x < 1320; x++) if (luma(at(d, x)) >= mid && luma(at(d, x + 1)) < mid) return x + .5;
          return NaN;
        };
        return { plainReach: reach(plain), reach: reach(bled), plainEdge: crossing(plain), edge: crossing(bled), change: q.difference(plain, bled) };
      }, VHS_ALONE);
      const ok = r.reach >= 8 && Math.abs(r.edge - r.plainEdge) <= 2 && r.plainReach < 4;
      return { ok, detail: `${r.change < .1 ? NO_VHS : ''}colour reaches ${r.reach} px past the edge (at least 8; plain ${r.plainReach}); brightness edge at ${r.edge} against plain ${r.plainEdge} (within 2 px)` };
    },
  },
  {
    name: 'vhs-head',
    // Head switching .5 alone: a torn strip at the bottom 4% of the frame tall (21.6 rows of 540), nothing torn above.
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq, W = 960, H = 540, rows = [];
        const plain = await q.px(q.exact(q.project([q.smooth()]))), torn = await q.px(q.exact(q.project([q.smooth({ ...alone, vhsHeadSwitch: .5 })])));
        for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) s += Math.abs(torn[(y * W + x) * 4 + k] - plain[(y * W + x) * 4 + k]); rows.push(s / (W * 3)); }
        const first = rows.findIndex(v => v > 1);
        const strip = first < 0 ? 0 : H - first, inStrip = first < 0 ? 0 : rows.slice(first).filter(v => v > 1).length;
        const above = first < 0 ? 0 : Math.max(0, ...rows.slice(0, first));
        return { strip, inStrip, above, change: q.difference(plain, torn) };
      }, VHS_ALONE);
      const share = r.strip / 540;
      const ok = Math.abs(share - .04) <= .01 && r.inStrip >= r.strip * .9 && r.above <= .5;
      return { ok, detail: `${r.change < .1 ? NO_VHS : ''}torn strip ${r.strip} rows, ${(share * 100).toFixed(2)}% of the frame (4 ± 1%); ${r.inStrip} of them torn (over 90%); largest row change above it ${r.above.toFixed(3)} (limit .5)` };
    },
  },
  {
    name: 'vhs-roll',
    // Rolling bar 2 alone, at 24 frames across the loop: the bar's centre (the row-weighted circular mean of the change
    // from plain) must move steadily one way and travel exactly two frame heights per loop.
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq, W = 480, H = 270, N = 24, centres = [], peaks = [];
        const plain = await q.px(q.exact(q.project([q.smooth()])), .9, W, H);
        for (let i = 0; i < N; i++) {
          const d = await q.px(q.exact(q.project([q.smooth({ ...alone, vhsRoll: 2 })])), i * Math.PI * 2 / N, W, H);
          let cx = 0, cy = 0, peak = 0;
          for (let y = 0; y < H; y++) {
            let s = 0; for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) s += Math.abs(d[(y * W + x) * 4 + k] - plain[(y * W + x) * 4 + k]);
            s /= W * 3; peak = Math.max(peak, s);
            const a = (y + .5) / H * Math.PI * 2; cx += s * Math.cos(a); cy += s * Math.sin(a);
          }
          centres.push(((Math.atan2(cy, cx) / (Math.PI * 2)) % 1 + 1) % 1); peaks.push(peak);
        }
        const steps = centres.map((c, i) => { let s = centres[(i + 1) % N] - c; s -= Math.round(s); return s; });
        return { travel: steps.reduce((a, b) => a + b, 0), least: Math.min(...steps), most: Math.max(...steps), faintest: Math.min(...peaks) };
      }, VHS_ALONE);
      const ok = Math.abs(Math.abs(r.travel) - 2) < .02 && r.faintest > 2 && Math.sign(r.least) === Math.sign(r.most) && r.least !== 0;
      return { ok, detail: `${r.faintest <= 2 ? 'No rolling bar. ' : ''}travel ${r.travel.toFixed(4)} frame heights per loop (2 ± .02); steps ${r.least.toFixed(4)} to ${r.most.toFixed(4)} (one way); faintest bar ${r.faintest.toFixed(2)} (over 2)` };
    },
  },
  {
    name: 'vhs-age',
    // Tape age 1 against Tape age 0, nothing else on: less saturation (max - min of each pixel) and warmer (red minus blue).
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq;
        const measure = d => { let sat = 0, warm = 0; const n = d.length / 4; for (let i = 0; i < d.length; i += 4) { sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); warm += d[i] - d[i + 2]; } return { sat: sat / n, warm: warm / n }; };
        const young = await q.px(q.exact(q.project([q.smooth({ ...alone, vhsAge: 0 })]))), old = await q.px(q.exact(q.project([q.smooth({ ...alone, vhsAge: 1 })])));
        return { young: measure(young), old: measure(old) };
      }, VHS_ALONE);
      const ok = r.old.sat < r.young.sat * .9 && r.old.warm > r.young.warm + 3;
      return { ok, detail: `${r.old.sat === r.young.sat ? NO_VHS : ''}saturation ${r.young.sat.toFixed(2)} to ${r.old.sat.toFixed(2)} (at least 10% less); red minus blue ${r.young.warm.toFixed(2)} to ${r.old.warm.toFixed(2)} (at least 3 warmer)` };
    },
  },
  {
    name: 'vhs-alpha',
    // A soft-edged layer with every VHS control up: wherever the transparent export has no coverage, the export over
    // black must be exactly black, at three frames. Inside coverage the noise and tears must show. Rows move by
    // fractions of a pixel, so a pixel beside coverage can hold alpha too small for a byte while its light still
    // shows over black; no coverage therefore means no alpha in the pixel and its two neighbours along the row.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, rough = { vhsAmount: 1, vhsTracking: .8, vhsBleed: 1, vhsNoise: 1, vhsHeadSwitch: 1, vhsAge: 1, vhsRoll: 2 };
        let leaks = 0, empty = 0, inside = 0;
        for (const phase of [.9, 2.3, 4.4]) {
          const alpha = await q.px(q.exact(q.project([q.soft(rough)], true)), phase), over = await q.px(q.exact(q.project([q.soft(rough)])), phase);
          const plain = await q.px(q.exact(q.project([q.soft()])), phase);
          for (let i = 0; i < alpha.length; i += 4) {
            const x = (i / 4) % 960, clear = alpha[i + 3] === 0 && (x === 0 || alpha[i - 1] === 0) && (x === 959 || alpha[i + 7] === 0);
            if (clear) { empty++; if (over[i] || over[i + 1] || over[i + 2]) leaks++; }
            else if (alpha[i + 3] > 0 && Math.abs(over[i] - plain[i]) + Math.abs(over[i + 1] - plain[i + 1]) + Math.abs(over[i + 2] - plain[i + 2]) > 24) inside++;
          }
        }
        return { leaks, empty, inside };
      });
      const ok = r.leaks === 0 && r.empty > 100000 && r.inside > 1000;
      return { ok, detail: `${r.inside <= 1000 ? NO_VHS : ''}${r.leaks} lit pixels of ${r.empty} with no coverage (limit 0); ${r.inside} changed pixels inside coverage (over 1000)` };
    },
  },
  {
    name: 'drop-events',
    // A 120-frame loop, read at 192x108 with 4 bands of 27 rows. Chance .5 must drop bands in 50 ± 10% of frames, each
    // dropped band black throughout; the Noise fill must drop the same bands as grey noise; and Burst length 3 must
    // make every run of dropped frames, counted around the loop, at least 3 long, with one run crossing the seam.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, W = 192, H = 108, N = 120, bands = 4, rows = H / bands;
        const scene = params => q.loop120(q.exact(q.project([q.smooth({ dropAmount: 1, dropBands: bands, ...params })])));
        const at = f => f * Math.PI * 2 / N;
        // Per band: 'black', 'noise' (grey, spread out) or 'plain'.
        const classify = d => Array.from({ length: bands }, (_, b) => {
          let most = 0, grey = true, sum = 0, sq = 0, n = 0;
          for (let y = b * rows; y < (b + 1) * rows; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4; most = Math.max(most, d[i], d[i + 1], d[i + 2]);
            if (Math.abs(d[i] - d[i + 1]) > 1 || Math.abs(d[i + 1] - d[i + 2]) > 1) grey = false;
            sum += d[i]; sq += d[i] * d[i]; n++;
          }
          const spread = Math.sqrt(sq / n - (sum / n) ** 2);
          return most <= 1 ? 'black' : grey && spread > 20 ? 'noise' : 'plain';
        });
        let dropped = 0, black = 0, noiseMatch = 0, noiseMiss = 0;
        for (let f = 0; f < N; f++) {
          const a = classify(await q.px(scene({ dropChance: .5, dropFill: 0 }), at(f), W, H)), b = classify(await q.px(scene({ dropChance: .5, dropFill: 1 }), at(f), W, H));
          if (a.includes('black')) dropped++;
          a.forEach((c, i) => { if (c === 'black') black++; if ((c === 'black' && b[i] === 'noise') || (c === 'plain' && b[i] === 'plain')) noiseMatch++; else noiseMiss++; });
        }
        // Burst length 3: try seeds until a run crosses the seam, so wrapping is proven.
        let runs = null, seed = 0;
        for (; seed < 12 && !runs; seed++) {
          const burst = scene({ dropChance: .15, dropFill: 0, dropBurst: 3, seed });
          const on = async f => classify(await q.px(burst, at(f), W, H)).includes('black');
          if (!(await on(N - 1)) || !(await on(0))) continue;
          const active = []; for (let f = 0; f < N; f++) active.push(await on(f));
          if (active.every(Boolean)) continue;
          const start = active.findIndex(v => !v); runs = []; let length = 0;
          for (let k = 1; k <= N; k++) { const v = active[(start + k) % N]; if (v) length++; else if (length) { runs.push(length); length = 0; } }
        }
        return { share: dropped / N, black, noiseMatch, noiseMiss, runs, seed: seed - 1 };
      });
      const shortest = r.runs ? Math.min(...r.runs) : 0;
      const ok = Math.abs(r.share - .5) <= .1 && r.noiseMiss === 0 && !!r.runs && r.runs.length >= 2 && shortest >= 3;
      return { ok, detail: `${r.black === 0 ? NO_DROP : ''}bands dropped in ${(r.share * 100).toFixed(1)}% of 120 frames (50 ± 10); ${r.black} black bands; Noise fill: ${r.noiseMatch} bands as expected, ${r.noiseMiss} not (limit 0); burst 3: ${r.runs ? `seed ${r.seed}, runs ${r.runs.join(',')} (each at least 3, one across the seam)` : 'no run across the seam in 12 seeds'}` };
    },
  },
  {
    name: 'drop-hold',
    // Hold line, 6 bands of 90 rows at 960x540: each band is either the plain picture, or every row of it equals the
    // row just above it (the last row before the dropped run; row 0 for the top band).
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, W = 960, H = 540, N = 120, bands = 6, rows = H / bands;
        const plain = await q.px(q.loop120(q.exact(q.project([q.smooth()]))));
        const rowTo = (d, y, e, src) => { let m = 0; for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(d[(y * W + x) * 4 + k] - e[(src * W + x) * 4 + k])); return m; };
        let held = 0, kept = 0, wrong = 0;
        for (let f = 0; f < 30; f++) {
          const d = await q.px(q.loop120(q.exact(q.project([q.smooth({ dropAmount: 1, dropChance: .5, dropBands: bands, dropFill: 2 })]))), f * Math.PI * 2 / N);
          for (let b = 0; b < bands; b++) {
            const top = b * rows, src = Math.max(0, top - 1);
            let plainBand = 0, heldBand = 0;
            for (let y = top; y < top + rows; y++) { plainBand = Math.max(plainBand, rowTo(d, y, plain, y)); heldBand = Math.max(heldBand, rowTo(d, y, d, src)); }
            if (plainBand <= 2) kept++; else if (heldBand <= 2) held++; else wrong++;
          }
        }
        return { held, kept, wrong };
      });
      const ok = r.held >= 10 && r.wrong === 0;
      return { ok, detail: `${r.held === 0 ? NO_DROP : ''}${r.held} held bands, ${r.kept} plain, ${r.wrong} neither (limit 0) over 30 frames` };
    },
  },
  {
    name: 'signal-loop',
    // VHS, Dropout and both, on a moving source, through the shared loop and seam helper. Each must change the render.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, rows = [], plain = await q.px(q.project([q.moving()]), 0);
        const vhs = { vhsAmount: 1, vhsRoll: 2, vhsNoise: .6 }, drop = { dropAmount: 1, dropChance: .5, dropBurst: 3, dropFill: 1 };
        for (const [name, params] of [['VHS', vhs], ['Dropout', drop], ['both', { ...vhs, ...drop }]]) {
          const p = q.project([q.moving(params)]);
          rows.push({ name, ...(await q.loop(p)), change: q.difference(plain, await q.px(p, 0)) });
        }
        return rows;
      });
      const verdicts = r.map(row => ({ ...loopVerdict(row), moved: row.change > .5 }));
      return { ok: verdicts.every(v => v.ok && v.moved), detail: r.map((row, i) => `${row.name}: ${verdicts[i].moved ? '' : 'no change, '}${verdicts[i].detail}`).join('; ') };
    },
  },
  {
    name: 'signal-seek',
    // Frame 60 drawn directly, then after frames 90 and 10: the same bytes.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, total = 300, phase = f => f * Math.PI * 2 / total;
        const p = q.project([q.moving({ vhsAmount: 1, vhsRoll: 1, dropAmount: 1, dropChance: .5, dropBurst: 4, dropFill: 1 })]);
        const direct = await q.shot(p, phase(60));
        await q.shot(p, phase(90)); await q.shot(p, phase(10));
        const plain = await q.px(q.project([q.moving()]), phase(60));
        return { same: q.same(direct, await q.shot(p, phase(60))), change: q.difference(plain, await q.pixels(direct)) };
      });
      return { ok: r.same && r.change > .5, detail: `${r.change <= .5 ? NO_VHS : ''}after seeking ${r.same ? 'byte-identical' : 'DIFFERS'}; change from plain ${r.change.toFixed(2)}` };
    },
  },
  {
    name: 'signal-scale',
    // The same settings for a 960 preview and a 3840 export, the export averaged down 4x4 in linear light.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.sq, rows = [];
        const plain = await q.px(q.exact(q.project([q.smooth()])));
        for (const [name, params] of [['VHS defaults', { vhsAmount: 1, vhsRoll: 1 }], ['VHS rough', { vhsAmount: 1, vhsTracking: .8, vhsBleed: 1, vhsNoise: .6, vhsHeadSwitch: .6, vhsAge: .6, vhsRoll: 1 }], ['Dropout', { dropAmount: 1, dropChance: .6, dropFill: 2 }], ['both', { vhsAmount: 1, dropAmount: 1, dropChance: .6 }]]) {
          const p = q.exact(q.project([q.smooth(params)]));
          const small = await q.px(p, .9, 960, 540), big = await q.px(p, .9, 3840, 2160);
          rows.push({ name, mean: q.difference(small, q.linearDown(big, 960, 540, 4)), change: q.difference(small, plain) });
        }
        return rows;
      });
      const ok = rows.every(r => r.mean < 3 && r.change > 1);
      return { ok, detail: `${rows.some(r => r.change <= 1) ? NO_VHS : ''}${rows.map(r => `${r.name}: ${r.mean.toFixed(3)} (moved ${r.change.toFixed(2)})`).join(', ')} (limit 3/255)` };
    },
  },
  {
    name: 'signal-engage',
    // An amount of .001 is all but plain; an amount of 1 is not.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, plain = await q.px(q.exact(q.project([q.smooth()])));
        const vhs = { vhsTracking: .8, vhsNoise: 1, vhsHeadSwitch: 1, vhsRoll: 2 }, drop = { dropChance: 1, dropFill: 1 };
        const diff = async params => q.difference(plain, await q.px(q.exact(q.project([q.smooth(params)]))));
        return { vhs: await diff({ ...vhs, vhsAmount: .001 }), drop: await diff({ ...drop, dropAmount: .001 }), vhsFull: await diff({ ...vhs, vhsAmount: 1 }), dropFull: await diff({ ...drop, dropAmount: 1 }) };
      });
      const ok = r.vhs < 1 && r.drop < 1 && r.vhsFull > 1 && r.dropFull > 1;
      return { ok, detail: `${r.vhsFull <= 1 ? NO_VHS : ''}${r.dropFull <= 1 ? NO_DROP : ''}at .001: VHS ${r.vhs.toFixed(4)}, Dropout ${r.drop.toFixed(4)} (limit 1/255); at 1: VHS ${r.vhsFull.toFixed(2)}, Dropout ${r.dropFull.toFixed(2)} (over 1)` };
    },
  },
];

const selected = only ? CHECKS.filter(c => only.some(prefix => c.name.startsWith(prefix))) : CHECKS;
if (!selected.length) { console.error(`No check matches --only=${only.join(',')}. Checks: ${CHECKS.map(c => c.name).join(', ')}`); process.exit(2); }

await fs.mkdir(out, { recursive: true });
const bundle = (dir, file, extra = '') => build({
  stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';
export {encodePNG} from './src/rendering/png';${extra}`, resolveDir: dir, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, file),
  nodePaths: [path.join(root, 'node_modules')], logLevel: 'silent',
});
await bundle(root, 'renderer.js');
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
    // Gentle everywhere, kept under full brightness.
    const smoothUrl = await dataUrl(960, 540, (x, y) => [
      Math.round(128 + 90 * Math.sin(3.1 * x + .4)), Math.round(128 + 90 * Math.cos(4.3 * y - .7)), Math.round(128 + 70 * Math.sin(2.2 * x + 3.7 * y)), 255,
    ]);
    const image = (url, params, name, width = 960, height = 540) => {
      const l = m.createLayer('image'); l.id = `${name}-proof`; Object.assign(l.params, params);
      l.image = { name: `${name}.png`, dataUrl: url, width, height, fit: 'contain' };
      return l;
    };
    const smooth = (params = {}) => image(smoothUrl, params, 'smooth');
    // (200, 120, 60), opaque to x 300 of 960, fading to nothing at x 500.
    const softUrl = await dataUrl(960, 540, x => { const at = (x + 960 / 540 / 2) * 540; return [200, 120, 60, Math.round(255 * Math.min(1, Math.max(0, (500 - at) / 200)))]; });
    const soft = (params = {}) => image(softUrl, params, 'soft');
    // Pure red over the left half, pure blue over the right, at 1920x1080 so a 1080-line render maps 1:1.
    let redBlueUrl = null;
    const redBlue = async () => {
      redBlueUrl ??= await dataUrl(1920, 1080, x => x < 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
      return (params = {}) => image(redBlueUrl, params, 'red-blue', 1920, 1080);
    };
    // An animated source that closes its loop.
    const moving = (params = {}) => { const l = m.applyPreset(m.createLayer('surface'), m.PRESETS.find(p => p.kind === 'surface').id); l.id = 'moving-proof'; Object.assign(l.params, params); return l; };
    const project = (layers, transparent = false) => { const p = m.createProject(); p.id = 'signal-proof'; p.layers = layers; p.background = '#000000'; p.transparent = transparent; return p; };
    // A 4-second loop at 30 fps: 120 frames.
    const loop120 = p => { p.duration = 4; return p; };
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
    window.sq = { m, old, renderer, tinyUrl, urlOf, image, smooth, soft, redBlue, moving, project, loop120, exact, pixels, shot, px, difference, same, loop, litShare, toLinear, linearDown };
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
