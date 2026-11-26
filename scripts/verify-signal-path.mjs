// Real Electron/WebGL checks for the signal path finishes: VHS, Dropout and CRT so far.
// Run: node scripts/verify-signal-path.mjs --baseline=<checkout of the commit before them> [--only=neutral,vhs,drop,signal,crt]
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
const NO_CRT = 'CRT does not change the render. ';
// CRT with every control neutral: a flat screen, no lines, mask or corners, Transparent outside, brightness 1.
const CRT_ALONE = { crtAmount: 1, crtCurve: 0, crtLines: 480, crtLineDepth: 0, crtMask: 0, crtMaskSize: 3, crtCorners: 0, crtBezel: 0, crtBrightness: 1 };
// 160 lines stay over 2.25 preview pixels apart across the curved screen; finer ones fade flat on the preview by
// design, where an export averaged down would alias them instead.
const CRT_ROUGH = { crtAmount: 1, crtCurve: .4, crtLines: 160, crtLineDepth: 1, crtMask: 2, crtMaskSize: 6, crtCorners: 1, crtBezel: 1 };

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
    // Tracking wobble alone. Rows move by whole output pixels, so each output row must be the plain row moved sideways
    // (the edge pixel repeating where the row runs out), within 2/255, and rows must not all move alike.
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
    // black must be exactly black, at three frames. Inside coverage the noise and tears must show.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, rough = { vhsAmount: 1, vhsTracking: .8, vhsBleed: 1, vhsNoise: 1, vhsHeadSwitch: 1, vhsAge: 1, vhsRoll: 2 };
        let leaks = 0, empty = 0, inside = 0;
        for (const phase of [.9, 2.3, 4.4]) {
          const alpha = await q.px(q.exact(q.project([q.soft(rough)], true)), phase), over = await q.px(q.exact(q.project([q.soft(rough)])), phase);
          const plain = await q.px(q.exact(q.project([q.soft()])), phase);
          for (let i = 0; i < alpha.length; i += 4) {
            if (alpha[i + 3] === 0) { empty++; if (over[i] || over[i + 1] || over[i + 2]) leaks++; }
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
    name: 'signal-cost',
    // Report only: GPU time of a 1920x1080 and a 3840x2160 frame with VHS (Colour bleed 0, .5 and 1) and Dropout Hold line, against plain.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        // Reading a pixel back waits for the GPU to finish every queued draw.
        const q = window.sq, gl = q.renderer.renderer.getContext(), rows = [], one = new Uint8Array(4);
        const sync = () => { q.renderer.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); };
        for (const [name, params] of [['plain', {}], ['VHS bleed 0', { vhsAmount: 1, vhsBleed: 0 }], ['VHS bleed .5 (default)', { vhsAmount: 1 }], ['VHS bleed 1', { vhsAmount: 1, vhsBleed: 1 }], ['Dropout Hold line, 20 bands, burst 8', { dropAmount: 1, dropChance: .5, dropFill: 2, dropBands: 20, dropBurst: 8 }]]) {
          const p = q.project([q.smooth(params)]);
          await q.renderer.prepare(p);
          const ms = [];
          for (const [W, H] of [[1920, 1080], [3840, 2160]]) {
            for (let i = 0; i < 3; i++) q.renderer.render(p, .9, W, H);
            sync();
            const start = performance.now();
            for (let i = 0; i < 10; i++) q.renderer.render(p, .9 + i * .01, W, H);
            sync();
            ms.push((performance.now() - start) / 10);
          }
          rows.push({ name, ms });
        }
        return rows;
      });
      return { ok: true, detail: `report only, ms per frame at 1080p / 4K: ${rows.map(r => `${r.name} ${r.ms.map(v => v.toFixed(1)).join(' / ')}`).join(', ')}` };
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
  {
    name: 'crt-curve',
    // Screen curve .3, every other CRT control neutral. (1) The shader's barrel matches crtCurve in signal.ts: a source
    // holding its own uv in half float goes through the CRT stage and is read back in float at nine points. (2) A
    // straight white line across the top third bows outward: its row is nearest the top in the middle. (3) The centre
    // pixel is unchanged. (4) Outside the curved screen a Transparent bezel is alpha 0, a Black one is opaque black
    // where the layer has coverage and alpha 0 where it has none. (5) The screen edge takes one output pixel: along the
    // middle half of the rows, each crossing of the right edge has one or two partly covered pixels, one on average.
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq, W = 960, H = 540, curve = { ...alone, crtCurve: .3 };
        const pin = await q.uvPin(curve, W, H, [[.5, .5], [.3, .4], [.7, .62], [.2, .8], [.85, .3], [.6, .15], [.12, .5], [.5, .9], [.42, .66]]);
        const line = await q.px(q.exact(q.project([q.line(curve)])));
        // The line's brightest row in a column, counted from the top (the read-back pixels start at the bottom row).
        const rowAt = x => { let best = -1, most = 0; for (let y = 0; y < H; y++) { const v = line[(y * W + x) * 4]; if (v > most) { most = v; best = H - 1 - y; } } return best; };
        const rows = [rowAt(480), rowAt(320), rowAt(200)];
        const plain = await q.px(q.exact(q.project([q.smooth()]))), bent = await q.px(q.exact(q.project([q.smooth(curve)])));
        let centre = 0;
        for (const [x, y] of [[479, 269], [480, 270]]) for (let k = 0; k < 4; k++) centre = Math.max(centre, Math.abs(plain[(y * W + x) * 4 + k] - bent[(y * W + x) * 4 + k]));
        const at = (d, x, y) => Array.from(d.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
        const clear = await q.px(q.exact(q.project([q.smooth({ ...curve, crtBezel: 0 })], true)));
        const black = await q.px(q.exact(q.project([q.smooth({ ...curve, crtBezel: 1 })], true)));
        const softBlack = await q.px(q.exact(q.project([q.soft({ ...curve, crtBezel: 1 })], true)));
        const edges = await q.px(q.exact(q.project([q.white({ ...curve, crtBezel: 0 })], true)));
        let most = 0, total = 0, counted = 0;
        for (let y = Math.round(H / 4); y < Math.round(H * 3 / 4); y++) {
          let partial = 0;
          for (let x = W / 2; x < W; x++) { const a = edges[(y * W + x) * 4 + 3]; if (a > 2 && a < 253) partial++; }
          most = Math.max(most, partial); total += partial; counted++;
        }
        return {
          pin, rows, centre, clear: at(clear, 0, 0), black: at(black, 0, 0), softLeft: at(softBlack, 0, 0), softRight: at(softBlack, W - 1, 0),
          edgeMost: most, edgeMean: total / counted, change: q.difference(plain, bent),
        };
      }, CRT_ALONE);
      const bows = r.rows[0] < r.rows[1] && r.rows[1] < r.rows[2] && r.rows[2] - r.rows[0] >= 5;
      const bezel = r.clear[3] === 0 && r.black[3] === 255 && r.black[0] + r.black[1] + r.black[2] === 0 && r.softLeft[3] === 255 && r.softLeft[0] + r.softLeft[1] + r.softLeft[2] === 0 && r.softRight[3] === 0;
      const edge = r.edgeMost <= 2 && r.edgeMean >= .7 && r.edgeMean <= 1.5;
      const ok = r.pin.worst < 1.5e-3 && bows && r.centre <= 1 && bezel && edge;
      return { ok, detail: `${r.change < .1 ? NO_CRT : ''}shader against crtCurve: worst ${r.pin.worst.toExponential(2)} over ${r.pin.points} points (limit 1.5e-3); line rows at x 480/320/200: ${r.rows.join('/')} (rising toward the middle, by at least 5); centre change ${r.centre}/255 (limit 1); corner Transparent ${r.clear.join(',')}, Black ${r.black.join(',')}, soft layer Black left ${r.softLeft.join(',')} right ${r.softRight.join(',')}; partly covered edge pixels per row ${r.edgeMean.toFixed(2)} mean, ${r.edgeMost} most (.7 to 1.5, at most 2)` };
    },
  },
  {
    name: 'crt-lines',
    // A white field, flat screen, no mask or corners. Scan lines 240 at depth 1: the strongest ripple down the frame,
    // from a DFT of the row means in linear light, must be 240 cycles per frame height at 960x540 and at 3840x2160.
    // Depth 0 must leave every row the same.
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq, out = {};
        const strongest = (d, W, H) => {
          const rows = new Float64Array(H);
          for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += q.toLinear(d[(y * W + x) * 4 + 1]); rows[y] = s / W; }
          let best = 0, size = 0, mean = rows.reduce((a, b) => a + b, 0) / H;
          for (let k = 1; k <= H / 2; k++) {
            let re = 0, im = 0;
            for (let y = 0; y < H; y++) { const a = Math.PI * 2 * k * y / H; re += (rows[y] - mean) * Math.cos(a); im -= (rows[y] - mean) * Math.sin(a); }
            const m = Math.hypot(re, im) * 2 / H;
            if (m > size) { size = m; best = k; }
          }
          return { cycles: best, ripple: size / mean };
        };
        for (const [W, H] of [[960, 540], [3840, 2160]]) out[W] = strongest(await q.px(q.exact(q.project([q.white({ ...alone, crtLines: 240, crtLineDepth: 1 })])), .9, W, H), W, H);
        const flat = await q.px(q.exact(q.project([q.white({ ...alone, crtLines: 240, crtLineDepth: 0 })])));
        let low = 255, high = 0;
        for (let y = 0; y < 540; y++) { let s = 0; for (let x = 0; x < 960; x++) s += flat[(y * 960 + x) * 4 + 1]; s /= 960; low = Math.min(low, s); high = Math.max(high, s); }
        out.flat = high - low;
        return out;
      }, CRT_ALONE);
      const ok = r[960].cycles === 240 && r[3840].cycles === 240 && r[960].ripple > .1 && r[3840].ripple > .1 && r.flat <= 1;
      return { ok, detail: `strongest ripple at 960x540: ${r[960].cycles} cycles (size ${(r[960].ripple * 100).toFixed(1)}% of the mean), at 3840x2160: ${r[3840].cycles} cycles (${(r[3840].ripple * 100).toFixed(1)}%) (240, over 10%); depth 0 row spread ${r.flat.toFixed(3)}/255 (limit 1)` };
    },
  },
  {
    name: 'crt-mask',
    // A white field at 1920x1080 (1080-line pixels), flat screen, Mask size 6, CRT brightness .5 so the mask's peaks
    // stay in range. Stripes, Slots and Dots each differ from None and from each other by over 1/255. Stripes splits
    // the middle row into columns where red, green or blue is at least 1.5 times each other channel in linear light, each
    // colour in at least 20% of columns, and rows 300 and 700 match it. Each mask keeps the white field's mean light
    // (linear, all channels) within 2% of None.
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq, W = 1920, H = 1080, shots = [];
        for (let mask = 0; mask < 4; mask++) shots.push(await q.px(q.exact(q.project([q.white({ ...alone, crtMask: mask, crtMaskSize: 6, crtBrightness: .5 })])), .9, W, H));
        const pairs = [];
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) pairs.push(q.difference(shots[a], shots[b]));
        const stripes = shots[1], share = [0, 0, 0];
        for (let x = 0; x < W; x++) {
          const i = (540 * W + x) * 4, c = [0, 1, 2].map(k => q.toLinear(stripes[i + k]));
          for (let k = 0; k < 3; k++) if (c[k] >= 1.5 * c[(k + 1) % 3] && c[k] >= 1.5 * c[(k + 2) % 3]) share[k]++;
        }
        let rowsDiffer = 0;
        for (const y of [300, 700]) for (let x = 0; x < W * 4; x++) rowsDiffer = Math.max(rowsDiffer, Math.abs(stripes[y * W * 4 + x] - stripes[540 * W * 4 + x]));
        const mean = d => { let s = 0; for (let i = 0; i < d.length; i += 4) s += q.toLinear(d[i]) + q.toLinear(d[i + 1]) + q.toLinear(d[i + 2]); return s / (d.length / 4 * 3); };
        const means = shots.map(mean);
        return { pairs, share: share.map(s => s / W), rowsDiffer, means };
      }, CRT_ALONE);
      const kept = r.means.slice(1).map(v => v / r.means[0]);
      const ok = r.pairs.every(d => d > 1) && r.share.every(s => s >= .2) && r.rowsDiffer <= 1 && kept.every(k => Math.abs(k - 1) <= .02);
      return { ok, detail: `${r.pairs[0] <= 1 ? NO_CRT : ''}differences None/Stripes/Slots/Dots pairwise ${r.pairs.map(d => d.toFixed(2)).join(', ')} (each over 1); Stripes columns red/green/blue ${r.share.map(s => `${(s * 100).toFixed(1)}%`).join('/')} (each at least 20%); rows 300 and 700 against 540: ${r.rowsDiffer}/255 (limit 1); mean light against None ${kept.map(k => k.toFixed(4)).join('/')} (1 ± .02)` };
    },
  },
  {
    name: 'crt-mask-default',
    // Stripes at every other CRT default (Mask size 5, brightness 1.3, 480 lines at depth .5) on a white field, read back
    // in float from the CRT stage at 960x540 (the preview, a cell of 2.5 pixels), 1920x1080 and 3840x2160, so display
    // clipping cannot hide the mask. Along a row at a line's middle and a row at a gap between lines, at least 15% of
    // columns each have red, green or blue at least 1.4 times each other channel, at all sizes: at least one clear
    // single-colour pixel per colour in every 5- or 2.5-pixel cell (the pixels between are two-colour mixes), at every
    // light level. At 960 the scan lines average flat, so both rows are the same.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, out = [];
        for (const [W, H] of [[960, 540], [1920, 1080], [3840, 2160]]) {
          const f = await q.floatFrame(q.project([q.white({ crtAmount: 1, crtCurve: 0, crtCorners: 0 })]), W, H);
          // Row means, to find a line's middle (the brightest row) and a gap (the darkest) near the frame's middle.
          let bright = -1, dark = -1, most = -Infinity, least = Infinity;
          for (let y = H / 2 - 8; y < H / 2 + 8; y++) { let s = 0; for (let x = 0; x < W; x++) s += f[(y * W + x) * 4 + 1]; if (s > most) { most = s; bright = y; } if (s < least) { least = s; dark = y; } }
          for (const y of [bright, dark]) {
            const share = [0, 0, 0];
            for (let x = 0; x < W; x++) {
              const i = (y * W + x) * 4, c = [f[i], f[i + 1], f[i + 2]];
              for (let k = 0; k < 3; k++) if (c[k] >= 1.4 * c[(k + 1) % 3] && c[k] >= 1.4 * c[(k + 2) % 3]) share[k]++;
            }
            out.push({ size: W, row: y === bright ? 'line' : 'gap', share: share.map(v => v / W) });
          }
        }
        return out;
      });
      const ok = r.every(row => row.share.every(v => v >= .15));
      return { ok, detail: r.map(row => `${row.size} ${row.row}: R/G/B ${row.share.map(v => `${(v * 100).toFixed(1)}%`).join('/')}`).join('; ') + ' (each at least 15%, dominant at least 1.4x)' };
    },
  },
  {
    name: 'crt-mask-fine',
    // Each mask at Mask size 3 on a 960x540 preview (1.5 output pixels a cell, under the 2-pixel limit), on a white
    // field with brightness .5 and nothing else: no beat pattern, every channel along the middle row within 1/255, and
    // the same mean light as None within 1%.
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq, W = 960, rows = [];
        const mean = d => { let s = 0; for (let i = 0; i < d.length; i += 4) s += q.toLinear(d[i]) + q.toLinear(d[i + 1]) + q.toLinear(d[i + 2]); return s / (d.length / 4 * 3); };
        const none = mean(await q.px(q.exact(q.project([q.white({ ...alone, crtMask: 0, crtBrightness: .5 })]))));
        for (const mask of [1, 2, 3]) {
          const d = await q.px(q.exact(q.project([q.white({ ...alone, crtMask: mask, crtMaskSize: 3, crtBrightness: .5 })])));
          let spread = 0;
          for (let k = 0; k < 3; k++) { let low = 255, high = 0; for (let x = 0; x < W; x++) { const v = d[(270 * W + x) * 4 + k]; low = Math.min(low, v); high = Math.max(high, v); } spread = Math.max(spread, high - low); }
          rows.push({ mask, spread, kept: mean(d) / none });
        }
        return rows;
      }, CRT_ALONE);
      const ok = r.every(row => row.spread <= 1 && Math.abs(row.kept - 1) <= .01);
      return { ok, detail: r.map(row => `${['', 'Stripes', 'Slots', 'Dots'][row.mask]}: row spread ${row.spread}/255, mean ${row.kept.toFixed(4)} of None`).join('; ') + ' (spread at most 1, mean 1 ± .01)' };
    },
  },
  {
    name: 'crt-glow',
    // CRT brightness 2 on a white field at 1920x1080, read back in float from the CRT stage: the peak must be over 1.5. A small
    // white square with Glow amount 1: the light in a ring outside the square must be over 1.2 times as bright with
    // CRT brightness 2 as with 1.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, W = 960, H = 540;
        // At 1080 lines, where the default 480 scan lines are resolved rather than averaged flat.
        const f = await q.floatFrame(q.project([q.white({ crtAmount: 1, crtBrightness: 2 })]), 1920, 1080);
        let peak = 0; for (let i = 0; i < f.length; i += 4) peak = Math.max(peak, f[i], f[i + 1], f[i + 2]);
        const ring = d => {
          let s = 0, n = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const r = Math.max(Math.abs(x + .5 - W / 2), Math.abs(y + .5 - H / 2)) / H;
            if (r > .13 && r < .25) { const i = (y * W + x) * 4; s += q.toLinear(d[i]) + q.toLinear(d[i + 1]) + q.toLinear(d[i + 2]); n++; }
          }
          return s / n;
        };
        const glow = { crtAmount: 1, glowMix: 1 };
        const one = ring(await q.px(q.exact(q.project([q.square({ ...glow, crtBrightness: 1 })])))), two = ring(await q.px(q.exact(q.project([q.square({ ...glow, crtBrightness: 2 })]))));
        return { peak, one, two };
      });
      const ok = r.peak > 1.5 && r.one > 0 && r.two > r.one * 1.2;
      return { ok, detail: `peak ${r.peak.toFixed(3)} at CRT brightness 2 (over 1.5); glow ring ${r.one.toFixed(4)} at brightness 1, ${r.two.toFixed(4)} at 2 (over 1.2 times)` };
    },
  },
  {
    name: 'crt-corners',
    // A white field, flat screen, no lines or mask. Dark corners 1 against 0, in linear light: the four 5% corner boxes
    // at least 50% darker, the middle 10% box under 5% darker.
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq, W = 960, H = 540;
        const lit = (d, x0, y0, w, h) => { let s = 0; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) s += q.toLinear(d[(y * W + x) * 4 + 1]); return s / (w * h); };
        const off = await q.px(q.exact(q.project([q.white({ ...alone, crtCorners: 0 })]))), on = await q.px(q.exact(q.project([q.white({ ...alone, crtCorners: 1 })])));
        const cw = W * .05, ch = H * .05 | 0, boxes = [[0, 0], [W - cw, 0], [0, H - ch], [W - cw, H - ch]];
        const corners = boxes.map(([x, y]) => 1 - lit(on, x, y, cw, ch) / lit(off, x, y, cw, ch));
        const centre = 1 - lit(on, W * .45, H * .45 | 0, W * .1, H * .1 | 0) / lit(off, W * .45, H * .45 | 0, W * .1, H * .1 | 0);
        return { corners, centre };
      }, CRT_ALONE);
      const ok = r.corners.every(c => c >= .5) && r.centre < .05;
      return { ok, detail: `${r.corners.every(c => c < .01) ? NO_CRT : ''}corners darker by ${r.corners.map(c => `${(c * 100).toFixed(1)}%`).join(', ')} (at least 50%); centre by ${(r.centre * 100).toFixed(2)}% (under 5%)` };
    },
  },
  {
    name: 'crt-scale',
    // The same settings for a 960 preview and a 3840 export, the export averaged down 4x4 in linear light. Every mask
    // cell here is at least 2.5 preview pixels (the default Mask size 5, or 6): finer masks fade flat on the preview by
    // design (crt-mask-fine), where an export averaged down would alias them instead.
    run: async ({ page }) => {
      const rows = await page.evaluate(async rough => {
        const q = window.sq, rows = [];
        const plain = await q.px(q.exact(q.project([q.smooth()])));
        for (const [name, params] of [['CRT defaults', { crtAmount: 1 }], ['CRT rough', rough], ['CRT Dots', { crtAmount: 1, crtMask: 3 }]]) {
          const p = q.exact(q.project([q.smooth(params)]));
          const small = await q.px(p, .9, 960, 540), big = await q.px(p, .9, 3840, 2160);
          rows.push({ name, mean: q.difference(small, q.linearDown(big, 960, 540, 4)), change: q.difference(small, plain) });
        }
        return rows;
      }, CRT_ROUGH);
      const ok = rows.every(r => r.mean < 3 && r.change > 1);
      return { ok, detail: `${rows.some(r => r.change <= 1) ? NO_CRT : ''}${rows.map(r => `${r.name}: ${r.mean.toFixed(3)} (moved ${r.change.toFixed(2)})`).join(', ')} (limit 3/255)` };
    },
  },
  {
    name: 'crt-engage',
    // An amount of .001 is all but plain; an amount of 1 is not.
    run: async ({ page }) => {
      const r = await page.evaluate(async rough => {
        const q = window.sq, plain = await q.px(q.exact(q.project([q.smooth()])));
        const diff = async params => q.difference(plain, await q.px(q.exact(q.project([q.smooth(params)]))));
        return { low: await diff({ ...rough, crtAmount: .001 }), full: await diff({ ...rough, crtAmount: 1 }) };
      }, CRT_ROUGH);
      const ok = r.low < 1 && r.full > 1;
      return { ok, detail: `${r.full <= 1 ? NO_CRT : ''}at .001: ${r.low.toFixed(4)} (limit 1/255); at 1: ${r.full.toFixed(2)} (over 1)` };
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
await bundle(root, 'renderer.js', `\nexport {crtCurve} from './src/rendering/signal';\nexport * as THREE from 'three';`);
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
    const whiteUrl = await dataUrl(960, 540, () => [255, 255, 255, 255]);
    const white = (params = {}) => image(whiteUrl, params, 'white');
    // A white line 2% of the frame tall across the top third (rows 103 to 113 of 540), on black.
    const lineUrl = await dataUrl(960, 540, (x, y) => Math.abs(y + .3) < .01 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
    const line = (params = {}) => image(lineUrl, params, 'line');
    // A white square a fifth of the frame tall in the middle, nothing around it.
    const squareUrl = await dataUrl(960, 540, (x, y) => Math.max(Math.abs(x), Math.abs(y)) < .1 ? [255, 255, 255, 255] : [0, 0, 0, 0]);
    const square = (params = {}) => image(squareUrl, params, 'square');
    // The signal pass's last target in float, bottom row first: with one stage on, that stage's output.
    const readTarget = (output, W, H) => {
      const gl = renderer.renderer.getContext(), data = new Float32Array(W * H * 4);
      renderer.renderer.setRenderTarget(output); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, data); renderer.renderer.setRenderTarget(null);
      return data;
    };
    const floatFrame = async (p, W, H, phase = .9) => { await renderer.prepare(p); renderer.render(p, phase, W, H); return readTarget(renderer.signalTargets[0], W, H); };
    // A half-float source holding its own uv in red and green, through the CRT stage alone: at each point, how far the
    // shader's source position is from crtCurve in signal.ts at that pixel's centre.
    const uvPin = async (params, W, H, points) => {
      const T = m.THREE, layer = m.createLayer('image'); Object.assign(layer.params, params);
      const half = new Uint16Array(W * H * 4), one = T.DataUtils.toHalfFloat(1);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = (j * W + i) * 4; half[k] = T.DataUtils.toHalfFloat((i + .5) / W); half[k + 1] = T.DataUtils.toHalfFloat((j + .5) / H); half[k + 3] = one; }
      const source = new T.DataTexture(half, W, H, T.RGBAFormat, T.HalfFloatType);
      source.minFilter = source.magFilter = T.LinearFilter; source.needsUpdate = true;
      renderer.signalSource(layer, layer, source, .9, W, H);
      const data = readTarget(renderer.signalTargets[0], W, H);
      source.dispose();
      let worst = 0;
      for (const [u, v] of points) {
        const i = Math.floor(u * W), j = Math.floor(v * H), k = (j * W + i) * 4;
        const [x, y] = m.crtCurve([(i + .5) / W, (j + .5) / H], params.crtCurve, W / H);
        worst = Math.max(worst, Math.abs(data[k] - x), Math.abs(data[k + 1] - y));
      }
      return { worst, points: points.length };
    };
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
    window.sq = { m, old, renderer, tinyUrl, urlOf, image, smooth, white, line, square, floatFrame, uvPin, soft, redBlue, moving, project, loop120, exact, pixels, shot, px, difference, same, loop, litShare, toLinear, linearDown };
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
