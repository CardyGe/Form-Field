// Real Electron/WebGL checks for the signal path finishes: VHS, Dropout, CRT, JPEG damage and Databend, and the whole-branch proof.
// Run: node scripts/verify-signal-path.mjs --baseline=<checkout of the commit before them> [--only=neutral,vhs,drop,signal,crt,jpeg,bend,all-presets,old-file,stack,sheet,preview-cost]
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
// --current=<checkout> builds the "current" side from another checkout, so --baseline can be compared with itself (all-presets only).
const current = option('current');
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
const NO_JPEG = 'JPEG damage does not change the render. ';
const JPEG_ROUGH = { jpegAmount: 1, jpegQuality: 0, jpegChroma: 1, jpegGlitch: .3, jpegGlitchSwaps: 4 };
const NO_BEND = 'Databend does not change the render. ';
const BEND_MODES = ['Echo', 'Comb', 'Fold', 'Stutter', 'Corrupt'];
// Databend Echo with nothing else: no channel split.
const ECHO = { databendAmount: 1, databendMode: 0, databendSplit: 0 };
const BEND_AXES = ['Across', 'Down', 'Wrap'];

// Whole-branch proof: sheets, the old file and the preview cost.
const proof = path.join(root, 'work/signal-proof');
const SHEET_KINDS = ['surface', 'fractal', 'liquid', 'image'];
// Sheet gates. Each choice keeps at least this share of plain's mean brightness on every layer kind, over three phases.
const SHEET_LEAST = { CRT: .6, 'JPEG damage': .6, all: .4 };
// A stage gone black: under 5% of pixels lit on any phase, or a mean under 2/255.
const SHEET_LIT_LEAST = .05;
// A choice that differs from plain: mean change over 1/255 on 120x68 thumbnails, over three phases.
const SHEET_CHANGE_LEAST = 1;
// Each choice at full amount, every other control at its default, except Dropout chance .5 so a dropout shows on the
// sheet's three phases (at the default .15 most frames are plain).
const SHEET_GROUPS = [
  ['VHS', [['Amount .4', { vhsAmount: .4 }], ['Defaults', { vhsAmount: 1 }], ['Heavy', { vhsAmount: 1, vhsTracking: .9, vhsBleed: 1, vhsNoise: .8, vhsHeadSwitch: 1, vhsAge: .8, vhsRoll: 1 }]]],
  ['Dropout', ['Black', 'Noise', 'Hold line'].map((name, i) => [name, { dropAmount: 1, dropChance: .5, dropFill: i }])],
  ['CRT', ['None', 'Stripes', 'Slots', 'Dots'].map((name, i) => [name, { crtAmount: 1, crtMask: i }])],
  ['JPEG damage', [['Quality 0', { jpegAmount: 1, jpegQuality: 0 }], ['Quality .2 (default)', { jpegAmount: 1 }], ['Quality .35', { jpegAmount: 1, jpegQuality: .35 }]]],
  ['Databend', BEND_MODES.map((name, i) => [`${name} Wrap`, { databendAmount: 1, databendMode: i }])],
  ['Databend direction', BEND_MODES.flatMap((name, i) => i === 2 ? [] : [0, 1].map(axis => [`${name} ${BEND_AXES[axis]}`, { databendAmount: 1, databendMode: i, databendAxis: axis }]))],
];
// All five signal effects with LED wall, Warp, Split, Gradient, Glow, Feedback and Time.
const STACK = {
  databendAmount: 1, databendMode: 0, jpegAmount: .8, vhsAmount: 1, vhsRoll: 1, dropAmount: 1, dropChance: .6, dropFill: 1, crtAmount: 1,
  ledAmount: 1, ledSize: 12, bendAmount: .2, bendField: 1, splitAmount: 6, gradMix: .6, glowMix: .6, echo: .6, slitShift: .5,
};
const ALL_FIVE = { vhsAmount: 1, dropAmount: 1, crtAmount: 1, jpegAmount: 1, databendAmount: 1 };
const COST_CASES = [
  ['Plain', {}],
  ['VHS (defaults)', { vhsAmount: 1 }], ['VHS Colour bleed 1', { vhsAmount: 1, vhsBleed: 1 }],
  ['Dropout (defaults)', { dropAmount: 1 }], ['Dropout Hold line, 20 bands, burst 8', { dropAmount: 1, dropFill: 2, dropBands: 20, dropBurst: 8 }],
  ['CRT (defaults)', { crtAmount: 1 }], ['CRT Dots, 1080 lines, curve .5', { crtAmount: 1, crtMask: 3, crtLines: 1080, crtCurve: .5 }],
  ['JPEG damage (defaults)', { jpegAmount: 1 }], ['JPEG damage Block 4', { jpegAmount: 1, jpegBlock: 4 }],
  ['Databend Echo (defaults)', { databendAmount: 1 }], ['Databend Echo Repeats 8 Split 1', { databendAmount: 1, databendRepeats: 8, databendSplit: 1 }],
  ['All five (defaults)', ALL_FIVE],
  ['All five, heaviest', { ...ALL_FIVE, vhsBleed: 1, jpegBlock: 4, databendRepeats: 8, databendSplit: 1 }],
];
const COST_SIZES = [[1280, 720], [1920, 1080], [3840, 2160]];

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
    // Report only: GPU time of a 1920x1080 and a 3840x2160 frame with VHS (Colour bleed 0, .5 and 1), Dropout Hold line
    // and JPEG damage (defaults, the smallest and largest blocks, rough), against plain.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        // Reading a pixel back waits for the GPU to finish every queued draw.
        const q = window.sq, gl = q.renderer.renderer.getContext(), rows = [], one = new Uint8Array(4);
        const sync = () => { q.renderer.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); };
        for (const [name, params] of [['plain', {}], ['VHS bleed 0', { vhsAmount: 1, vhsBleed: 0 }], ['VHS bleed .5 (default)', { vhsAmount: 1 }], ['VHS bleed 1', { vhsAmount: 1, vhsBleed: 1 }], ['Dropout Hold line, 20 bands, burst 8', { dropAmount: 1, dropChance: .5, dropFill: 2, dropBands: 20, dropBurst: 8 }], ['JPEG defaults', { jpegAmount: 1 }], ['JPEG Block 4', { jpegAmount: 1, jpegBlock: 4 }], ['JPEG Block 64', { jpegAmount: 1, jpegBlock: 64 }], ['JPEG rough', { jpegAmount: 1, jpegQuality: 0, jpegChroma: 1, jpegGlitch: .3 }]]) {
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
    // straight white line across the bottom third bows outward like a barrel: it is farthest from the frame's middle
    // row in the middle of the screen and comes nearer toward the sides, by at least 5 rows. (3) The centre
    // pixel is unchanged. (4) Outside the curved screen a Transparent bezel is alpha 0, a Black one is opaque black
    // where the layer has coverage and alpha 0 where it has none. (5) The screen edge takes one output pixel: along the
    // middle half of the rows, each crossing of the right edge has one or two partly covered pixels, one on average.
    run: async ({ page }) => {
      const r = await page.evaluate(async alone => {
        const q = window.sq, W = 960, H = 540, curve = { ...alone, crtCurve: .3 };
        const pin = await q.uvPin(curve, W, H, [[.5, .5], [.3, .4], [.7, .62], [.2, .8], [.85, .3], [.6, .15], [.12, .5], [.5, .9], [.42, .66]]);
        const line = await q.px(q.exact(q.project([q.line(curve)])));
        // The line's brightest row in a column, counted from the top (exported rows start at the top), and how far it
        // sits from the frame's middle row.
        const rowAt = x => { let best = -1, most = 0; for (let y = 0; y < H; y++) { const v = line[(y * W + x) * 4]; if (v > most) { most = v; best = y; } } return best; };
        const rows = [rowAt(480), rowAt(320), rowAt(200)], apart = rows.map(y => Math.abs(y + .5 - H / 2));
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
          pin, rows, apart, centre, clear: at(clear, 0, 0), black: at(black, 0, 0), softLeft: at(softBlack, 0, 0), softRight: at(softBlack, W - 1, 0),
          edgeMost: most, edgeMean: total / counted, change: q.difference(plain, bent),
        };
      }, CRT_ALONE);
      const bows = r.apart[0] > r.apart[1] && r.apart[1] > r.apart[2] && r.apart[0] - r.apart[2] >= 5;
      const bezel = r.clear[3] === 0 && r.black[3] === 255 && r.black[0] + r.black[1] + r.black[2] === 0 && r.softLeft[3] === 255 && r.softLeft[0] + r.softLeft[1] + r.softLeft[2] === 0 && r.softRight[3] === 0;
      const edge = r.edgeMost <= 2 && r.edgeMean >= .7 && r.edgeMean <= 1.5;
      const ok = r.pin.worst < 1.5e-3 && bows && r.centre <= 1 && bezel && edge;
      return { ok, detail: `${r.change < .1 ? NO_CRT : ''}shader against crtCurve: worst ${r.pin.worst.toExponential(2)} over ${r.pin.points} points (limit 1.5e-3); line rows at x 480/320/200: ${r.rows.join('/')}, ${r.apart.join('/')} from the middle row (farthest in the middle, by at least 5); centre change ${r.centre}/255 (limit 1); corner Transparent ${r.clear.join(',')}, Black ${r.black.join(',')}, soft layer Black left ${r.softLeft.join(',')} right ${r.softRight.join(',')}; partly covered edge pixels per row ${r.edgeMean.toFixed(2)} mean, ${r.edgeMost} most (.7 to 1.5, at most 2)` };
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
  {
    name: 'jpeg-blocks',
    // Waves of brightness and colour at Quality 0, Colour damage 1, read back in float from the JPEG stage (the export's dither would
    // hide flat blocks). The step in brightness (sRGB-encoded, 0..255) between neighbouring pixels along rows and
    // columns, averaged: at block edges, every Block size 1080-line pixels from the frame's top-left, it must be over
    // 4/255 and over 4 times the step inside blocks, at 1920x1080 with Block size 8 (8 output pixels) and at 960x540
    // with Block size 12 (6). At Quality 1 every channel of the export must be within 4/255 of plain at 960x540.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, out = [];
        const encode = v => 255 * (v <= .0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - .055);
        const steps = (f, W, H, B) => {
          const Y = new Float32Array(W * H);
          for (let i = 0; i < W * H; i++) Y[i] = .299 * encode(f[i * 4]) + .587 * encode(f[i * 4 + 1]) + .114 * encode(f[i * 4 + 2]);
          let edge = 0, ne = 0, inner = 0, ni = 0;
          const add = (v, isEdge) => { if (isEdge) { edge += v; ne++; } else { inner += v; ni++; } };
          // Float rows start at the bottom: row y is H - 1 - y from the top.
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = y * W + x, top = H - 1 - y;
            if (x + 1 < W) add(Math.abs(Y[i + 1] - Y[i]), (x + 1) % B === 0);
            if (top + 1 < H) add(Math.abs(Y[i - W] - Y[i]), (top + 1) % B === 0);
          }
          return { edge: edge / ne, inner: inner / ni };
        };
        for (const [W, H, block] of [[1920, 1080, 8], [960, 540, 12]]) {
          const f = await q.floatFrame(q.project([q.waves({ jpegAmount: 1, jpegQuality: 0, jpegChroma: 1, jpegBlock: block })]), W, H);
          out.push({ W, block, ...steps(f, W, H, block * H / 1080) });
        }
        const plain = await q.px(q.exact(q.project([q.waves()]))), fine = await q.px(q.exact(q.project([q.waves({ jpegAmount: 1, jpegQuality: 1 })])));
        let worst = 0; for (let i = 0; i < plain.length; i++) worst = Math.max(worst, Math.abs(plain[i] - fine[i]));
        return { out, worst };
      });
      const ok = r.out.every(o => o.edge > 4 && o.edge > 4 * o.inner) && r.worst <= 4;
      return { ok, detail: `${r.out.every(o => o.edge < .01) ? NO_JPEG : ''}${r.out.map(o => `${o.W} Block ${o.block}: edge step ${o.edge.toFixed(3)}, inside ${o.inner.toFixed(3)}`).join('; ')} (edge over 4 and over 4x inside); Quality 1 worst ${r.worst}/255 (limit 4)` };
    },
  },
  {
    name: 'jpeg-colour',
    // A picture of flat 8-pixel blocks of random colour at 1920x1080 (Block size 8), Quality 0. Over each 2x2 group of
    // blocks (a 16-pixel colour block from the top-left), how far each block's mean colour difference (sRGB Cb, Cr) and
    // brightness (Y) sit from the group's mean, against plain. Colour damage 1: colour spread under 25% of plain, so
    // colour is shared across 2-block areas, and brightness spread over 80%. Colour damage 0: colour spread over 80%.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, W = 1920, H = 1080, B = 8, blocky = await q.blocky();
        const spread = d => {
          const mean = (bx, by) => {
            let y = 0, cb = 0, cr = 0;
            for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
              // Exported rows start at the top.
              const k = ((by * B + j) * W + bx * B + i) * 4, R = d[k], G = d[k + 1], Bl = d[k + 2], L = .299 * R + .587 * G + .114 * Bl;
              y += L; cb += .5643 * (Bl - L); cr += .7133 * (R - L);
            }
            return [y / 64, cb / 64, cr / 64];
          };
          let luma = 0, colour = 0, n = 0;
          for (let gy = 0; gy + 1 < H / B; gy += 2) for (let gx = 0; gx + 1 < W / B; gx += 2) {
            const m = [mean(gx, gy), mean(gx + 1, gy), mean(gx, gy + 1), mean(gx + 1, gy + 1)];
            const c = [0, 1, 2].map(k => m.reduce((s, v) => s + v[k], 0) / 4);
            for (const v of m) { luma += Math.abs(v[0] - c[0]); colour += Math.hypot(v[1] - c[1], v[2] - c[2]); n++; }
          }
          return { luma: luma / n, colour: colour / n };
        };
        const plain = spread(await q.px(q.exact(q.project([blocky()])), .9, W, H));
        const smeared = spread(await q.px(q.exact(q.project([blocky({ jpegAmount: 1, jpegQuality: 0, jpegChroma: 1 })])), .9, W, H));
        const kept = spread(await q.px(q.exact(q.project([blocky({ jpegAmount: 1, jpegQuality: 0, jpegChroma: 0 })])), .9, W, H));
        return { colour: smeared.colour / plain.colour, luma: smeared.luma / plain.luma, keptColour: kept.colour / plain.colour };
      });
      const ok = r.colour < .25 && r.luma > .8 && r.keptColour > .8;
      return { ok, detail: `${r.colour > .99 && r.luma > .99 ? NO_JPEG : ''}Colour damage 1: colour spread ${(r.colour * 100).toFixed(1)}% of plain (under 25%), brightness ${(r.luma * 100).toFixed(1)}% (over 80%); Colour damage 0: colour spread ${(r.keptColour * 100).toFixed(1)}% (over 80%)` };
    },
  },
  {
    name: 'jpeg-hdr',
    // A half-float picture of grey .2 with a 40-pixel square of 4.0 in the middle, through JPEG damage alone at Quality 0
    // and read back in float: the square's mean brightness must stay over 3, and the grey around it must stay under 1.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, T = q.m.THREE, W = 960, H = 540, layer = q.m.createLayer('image');
        Object.assign(layer.params, { jpegAmount: 1, jpegQuality: 0 });
        const half = new Uint16Array(W * H * 4), inside = (i, j) => Math.abs(i + .5 - W / 2) < 20 && Math.abs(j + .5 - H / 2) < 20;
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const v = T.DataUtils.toHalfFloat(inside(i, j) ? 4 : .2), k = (j * W + i) * 4; half[k] = half[k + 1] = half[k + 2] = v; half[k + 3] = T.DataUtils.toHalfFloat(1); }
        const source = new T.DataTexture(half, W, H, T.RGBAFormat, T.HalfFloatType);
        source.minFilter = source.magFilter = T.LinearFilter; source.needsUpdate = true;
        q.renderer.signalSource(layer, layer, source, .9, W, H);
        const f = q.readTarget(q.renderer.signalTargets[0], W, H);
        source.dispose();
        let square = 0, n = 0, around = 0;
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          const k = (j * W + i) * 4, y = .2126 * f[k] + .7152 * f[k + 1] + .0722 * f[k + 2];
          if (inside(i, j)) { square += y; n++; } else if (!inside(i - 16, j) && !inside(i + 16, j) && !inside(i, j - 16) && !inside(i, j + 16)) around = Math.max(around, y);
        }
        return { square: square / n, around };
      });
      const ok = r.square > 3 && r.around < 1;
      return { ok, detail: `square mean ${r.square.toFixed(3)} (over 3); brightest grey away from it ${r.around.toFixed(3)} (under 1)` };
    },
  },
  {
    name: 'jpeg-glitch',
    // Random-colour blocks at Quality 1, Colour damage 0. (1) At 1920x1080, Broken blocks .3 against 0: 30 ± 8% of the
    // 8-pixel blocks change. (2) Over a 120-frame loop at 480x270 (Block size 16), the picture changes on exactly 4 frames
    // with 4 changes per loop, and on none with 0 changes or with Broken blocks 0. (3) A moving source closes its loop.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, W = 1920, H = 1080, B = 8, blocky = await q.blocky(), base = { jpegAmount: 1, jpegQuality: 1, jpegChroma: 0 };
        const whole = await q.px(q.exact(q.project([blocky({ ...base, jpegGlitch: 0 })])), .9, W, H), broken = await q.px(q.exact(q.project([blocky({ ...base, jpegGlitch: .3 })])), .9, W, H);
        let changed = 0, blocks = 0;
        for (let by = 0; by < H / B; by++) for (let bx = 0; bx < W / B; bx++) {
          let s = 0;
          for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) { const k = ((by * B + j) * W + bx * B + i) * 4; for (let c = 0; c < 3; c++) s += Math.abs(whole[k + c] - broken[k + c]); }
          blocks++; if (s / (B * B * 3) > 3) changed++;
        }
        const changes = async params => {
          const p = q.loop120(q.exact(q.project([blocky({ ...base, jpegBlock: 16, ...params })]))), N = 120, frames = [];
          for (let f = 0; f < N; f++) frames.push(await q.shot(p, f * Math.PI * 2 / N, 480, 270));
          let n = 0; for (let f = 0; f < N; f++) if (!q.same(frames[f], frames[(f + N - 1) % N])) n++;
          return n;
        };
        const four = await changes({ jpegGlitch: .3, jpegGlitchSwaps: 4 }), none = await changes({ jpegGlitch: .3, jpegGlitchSwaps: 0 }), off = await changes({ jpegGlitch: 0, jpegGlitchSwaps: 4 });
        const seam = await q.loop(q.project([q.moving({ jpegAmount: 1, jpegGlitch: .3, jpegGlitchSwaps: 4 })]));
        return { share: changed / blocks, four, none, off, seam };
      });
      const loop = loopVerdict(r.seam);
      const ok = Math.abs(r.share - .3) <= .08 && r.four === 4 && r.none === 0 && r.off === 0 && loop.ok;
      return { ok, detail: `${r.share === 0 ? NO_JPEG : ''}${(r.share * 100).toFixed(1)}% of blocks broken (30 ± 8); changes per 120-frame loop: ${r.four} with 4 per loop (exactly 4), ${r.none} with 0, ${r.off} with Broken blocks 0 (none); moving source ${loop.detail}` };
    },
  },
  {
    name: 'jpeg-alpha',
    // The soft layer (straight colour 200, 120, 60, fading to nothing) with the rough settings, at three frames: wherever
    // the transparent export has no coverage the export over black is exactly black, and wherever it has coverage of at
    // least 8/255 no straight channel passes 200 + 4. Inside coverage the damage must show (a flat colour only shows
    // the broken blocks, so the mean change over the frame need only pass .2/255).
    run: async ({ page }) => {
      const r = await page.evaluate(async rough => {
        const q = window.sq, settings = { ...rough, jpegQuality: .2, jpegChroma: .5 };
        let leaks = 0, empty = 0, most = 0, plainMost = 0;
        const plainAlpha = await q.px(q.exact(q.project([q.soft()], true)));
        for (let i = 0; i < plainAlpha.length; i += 4) if (plainAlpha[i + 3] >= 8) plainMost = Math.max(plainMost, plainAlpha[i], plainAlpha[i + 1], plainAlpha[i + 2]);
        for (const phase of [.9, 2.3, 4.4]) {
          const alpha = await q.px(q.exact(q.project([q.soft(settings)], true)), phase), over = await q.px(q.exact(q.project([q.soft(settings)])), phase);
          for (let i = 0; i < alpha.length; i += 4) {
            if (alpha[i + 3] === 0) { empty++; if (over[i] || over[i + 1] || over[i + 2]) leaks++; }
            else if (alpha[i + 3] >= 8) most = Math.max(most, alpha[i], alpha[i + 1], alpha[i + 2]);
          }
        }
        const plainOver = await q.px(q.exact(q.project([q.soft()]))), damaged = await q.px(q.exact(q.project([q.soft(settings)])));
        return { leaks, empty, most, plainMost, change: q.difference(plainOver, damaged) };
      }, JPEG_ROUGH);
      const ok = r.leaks === 0 && r.empty > 100000 && r.most <= 204 && r.change > .2;
      return { ok, detail: `${r.change <= .2 ? NO_JPEG : ''}${r.leaks} lit pixels of ${r.empty} with no coverage (limit 0); brightest straight channel ${r.most} (plain ${r.plainMost}, limit 204); change ${r.change.toFixed(2)}` };
    },
  },
  {
    name: 'jpeg-scale',
    // The same settings for a 960 preview and a 3840 export, the export averaged down 4x4 in linear light, on the smooth
    // picture (which JPEG damage moves only a little) and on the random-colour blocks.
    run: async ({ page }) => {
      const rows = await page.evaluate(async rough => {
        const q = window.sq, rows = [], blocky = await q.blocky();
        for (const [name, source] of [['smooth', q.smooth], ['blocks', blocky]]) {
          const plain = await q.px(q.exact(q.project([source()])));
          for (const [label, params] of [['defaults', { jpegAmount: 1 }], ['rough', rough], ['Block 24', { jpegAmount: 1, jpegBlock: 24, jpegQuality: 0 }], ['Block 4', { jpegAmount: 1, jpegBlock: 4, jpegQuality: 0 }]]) {
            const p = q.exact(q.project([source(params)]));
            const small = await q.px(p, .9, 960, 540), big = await q.px(p, .9, 3840, 2160);
            rows.push({ name: `${name} ${label}`, mean: q.difference(small, q.linearDown(big, 960, 540, 4)), change: q.difference(small, plain) });
          }
        }
        return rows;
      }, JPEG_ROUGH);
      const ok = rows.every(r => r.mean < 3 && r.change > .5);
      return { ok, detail: `${rows.some(r => r.change <= .5) ? NO_JPEG : ''}${rows.map(r => `${r.name}: ${r.mean.toFixed(3)} (moved ${r.change.toFixed(2)})`).join(', ')} (limit 3/255, moved over .5)` };
    },
  },
  {
    name: 'jpeg-cost',
    // Report only: for Block 8 (default) and Block 4 at 960x540, 1920x1080 and 3840x2160, GPU ms per frame against
    // plain and the memory the JPEG targets hold after that size alone (two half-float channels, 4 bytes a texel).
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.sq, gl = q.renderer.renderer.getContext(), one = new Uint8Array(4), rows = [];
        const sync = () => { q.renderer.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); };
        const time = async (p, W, H) => {
          await q.renderer.prepare(p);
          for (let i = 0; i < 3; i++) q.renderer.render(p, .9, W, H);
          sync(); const start = performance.now();
          for (let i = 0; i < 10; i++) q.renderer.render(p, .9 + i * .01, W, H);
          sync(); return (performance.now() - start) / 10;
        };
        const held = () => { const t = q.renderer.jpegTargets; return t ? [...t.grid, t.columns].reduce((s, rt) => s + rt.width * rt.height * 4, 0) / 2 ** 20 : 0; };
        for (const [W, H] of [[960, 540], [1920, 1080], [3840, 2160]]) {
          const plain = await time(q.project([q.smooth()]), W, H);
          for (const block of [8, 4]) {
            q.renderer.releaseJpeg();
            const ms = await time(q.project([q.smooth({ jpegAmount: 1, jpegBlock: block })]), W, H);
            rows.push(`${W} Block ${block}: +${(ms - plain).toFixed(1)} ms, ${held().toFixed(0)} MB`);
          }
        }
        return rows;
      });
      return { ok: true, detail: `report only: ${rows.join('; ')}` };
    },
  },
  {
    name: 'jpeg-shrink',
    // The JPEG targets follow the frame: after a 3840x2160 frame at Block 4, two 960x540 frames at the defaults (the
    // targets shrink at the start of a frame, against what the frame before needed) leave them holding no more than
    // twice what a 960x540 frame at the defaults holds alone.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq;
        const held = () => { const t = q.renderer.jpegTargets; return t ? [...t.grid, t.columns].reduce((s, rt) => s + rt.width * rt.height * 4, 0) / 2 ** 20 : 0; };
        const frame = async (params, W, H) => { const p = q.project([q.smooth(params)]); await q.renderer.prepare(p); q.renderer.render(p, .9, W, H); };
        q.renderer.releaseJpeg();
        await frame({ jpegAmount: 1 }, 960, 540); const alone = held();
        await frame({ jpegAmount: 1, jpegBlock: 4 }, 3840, 2160); const big = held();
        await frame({ jpegAmount: 1 }, 960, 540); await frame({ jpegAmount: 1 }, 960, 540);
        return { alone, big, after: held() };
      });
      const ok = r.after > 0 && r.after <= 2 * r.alone;
      return { ok, detail: `960 defaults alone ${r.alone.toFixed(1)} MB; after a 4K Block 4 frame (${r.big.toFixed(1)} MB) and two 960 frames ${r.after.toFixed(1)} MB (at most ${(2 * r.alone).toFixed(1)})` };
    },
  },
  {
    name: 'jpeg-shared',
    // Two JPEG layers in one 3840x2160 frame, Block 4 below and Block 64 above (the soft layer: opaque on the left,
    // empty on the right), share the targets. After the first frame, 5 more frames reallocate them 0 times. Where the
    // top layer is empty the frame matches the bottom layer alone, and where it is opaque the top layer alone, within
    // 1/255.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, W = 3840, H = 2160;
        const sizes = () => { const t = q.renderer.jpegTargets; return t ? [...t.grid, t.columns].map(rt => `${rt.width}x${rt.height}`).join(' ') : ''; };
        const bottom = () => q.smooth({ jpegAmount: 1, jpegBlock: 4, jpegQuality: 0 }), top = () => { const l = q.soft({ jpegAmount: 1, jpegBlock: 64, jpegQuality: 0 }); l.id = 'soft-top'; return l; };
        const both = q.exact(q.project([bottom(), top()]));
        await q.renderer.prepare(both);
        q.renderer.render(both, .9, W, H);
        let changes = 0, last = sizes();
        // Reallocations are counted by the renderer; a size change between frames counts too.
        const before = q.renderer.jpegReallocations ?? 0;
        for (let i = 0; i < 5; i++) { q.renderer.render(both, .9, W, H); const now = sizes(); if (now !== last) changes++; last = now; }
        const reallocated = (q.renderer.jpegReallocations ?? 0) - before + changes;
        const w = 960, h = 540, pair = await q.px(both, .9, w, h);
        const lower = await q.px(q.exact(q.project([bottom()])), .9, w, h), upper = await q.px(q.exact(q.project([top()])), .9, w, h);
        const soft = await q.px(q.exact(q.project([q.soft()], true)), .9, w, h);
        let worstLower = 0, worstUpper = 0, nLower = 0, nUpper = 0;
        for (let i = 0; i < pair.length; i += 4) {
          const a = soft[i + 3], against = a === 0 ? lower : a === 255 ? upper : null;
          if (!against) continue;
          let d = 0; for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(pair[i + k] - against[i + k]));
          if (a === 0) { worstLower = Math.max(worstLower, d); nLower++; } else { worstUpper = Math.max(worstUpper, d); nUpper++; }
        }
        return { reallocated, worstLower, worstUpper, nLower, nUpper };
      });
      const ok = r.reallocated === 0 && r.worstLower <= 1 && r.worstUpper <= 1 && r.nLower > 1000 && r.nUpper > 1000;
      return { ok, detail: `${r.reallocated} reallocations over 5 frames after the first (limit 0); bottom layer alone ${r.worstLower}/255 over ${r.nLower} pixels, top layer alone ${r.worstUpper}/255 over ${r.nUpper} (limit 1)` };
    },
  },
  {
    name: 'jpeg-engage',
    // An amount of .001 is all but plain; an amount of 1 is not.
    run: async ({ page }) => {
      const r = await page.evaluate(async rough => {
        const q = window.sq, plain = await q.px(q.exact(q.project([q.smooth()])));
        const diff = async params => q.difference(plain, await q.px(q.exact(q.project([q.smooth(params)]))));
        return { low: await diff({ ...rough, jpegAmount: .001 }), full: await diff({ ...rough, jpegAmount: 1 }) };
      }, JPEG_ROUGH);
      const ok = r.low < 1 && r.full > 1;
      return { ok, detail: `${r.full <= 1 ? NO_JPEG : ''}at .001: ${r.low.toFixed(4)} (limit 1/255); at 1: ${r.full.toFixed(2)} (over 1)` };
    },
  },
  {
    name: 'bend-modes',
    // Each mode at its defaults on the smooth picture at 960x540: each changes the render by over 1/255 and each pair
    // of modes differs by over 1/255.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, plain = await q.px(q.exact(q.project([q.smooth()]))), shots = [];
        for (let mode = 0; mode < 5; mode++) shots.push(await q.px(q.exact(q.project([q.smooth({ databendAmount: 1, databendMode: mode })]))));
        const pairs = [];
        for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) pairs.push([a, b, q.difference(shots[a], shots[b])]);
        return { change: shots.map(d => q.difference(plain, d)), pairs };
      });
      const ok = r.change.every(c => c > 1) && r.pairs.every(p => p[2] > 1);
      return { ok, detail: `${r.change.every(c => c < .01) ? NO_BEND : ''}change from plain ${r.change.map((c, i) => `${BEND_MODES[i]} ${c.toFixed(2)}`).join(', ')} (each over 1); least pair ${(() => { const p = r.pairs.reduce((a, b) => b[2] < a[2] ? b : a); return `${BEND_MODES[p[0]]}/${BEND_MODES[p[1]]} ${p[2].toFixed(2)}`; })()} (over 1)` };
    },
  },
  {
    name: 'bend-echo',
    // A 4x4 dot of light 1 on black at 1920x1080 (1080-line pixels), Echo Across, Distance 100, Repeats 3, Feedback .5,
    // read back in float from the Databend stage. The light in a box around Distance, 2 and 3 times Distance to the
    // right of the dot each holds .45 to .55 of the one before (the dot's own box first), a box at 4 times holds none,
    // and the copies stay on the dot's rows.
    run: async ({ page }) => {
      const r = await page.evaluate(async echo => {
        const q = window.sq, W = 1920, H = 1080, D = 100, x0 = 400, y0 = 500;
        const f = q.bendFloat({ ...echo, databendAxis: 0, databendDistance: D, databendRepeats: 3, databendFeedback: .5 }, W, H, (x, y) => x >= x0 && x < x0 + 4 && y >= y0 && y < y0 + 4 ? [1, 1, 1, 1] : [0, 0, 0, 1]);
        const box = (cx, rows = [y0 - 3, y0 + 7]) => { let s = 0; for (let y = rows[0]; y < rows[1]; y++) for (let x = cx - 6; x < cx + 10; x++) s += f.at(x, y)[1]; return s; };
        const boxes = [0, 1, 2, 3, 4].map(k => box(x0 + k * D));
        // Light off the dot's rows, anywhere in the frame.
        let total = 0, onRows = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f.at(x, y)[1]; total += v; if (y >= y0 && y < y0 + 4) onRows += v; }
        return { boxes, ratios: [1, 2, 3].map(k => boxes[k] / boxes[k - 1]), off: total - onRows };
      }, ECHO);
      const ok = r.ratios.every(v => v >= .45 && v <= .55) && r.boxes[4] < 1e-3 && r.off < 1e-3 && r.boxes[1] > .1;
      return { ok, detail: `${r.boxes[1] < 1e-3 ? NO_BEND : ''}light at 0/1/2/3/4 Distances ${r.boxes.map(v => v.toFixed(3)).join('/')}; each copy against the one before ${r.ratios.map(v => v.toFixed(3)).join('/')} (.45 to .55); at 4 Distances ${r.boxes[4].toFixed(4)} (none); off the dot's rows ${r.off.toFixed(4)} (none)` };
    },
  },
  {
    name: 'bend-wrap',
    // A 4x4 dot 40 pixels from the right edge at 1920x1080, Echo with Repeats 1 and Distance 100. In Wrap the copy
    // reappears at the start of the next row: its light centre is 60 pixels from the left edge (100 - 40) and one row
    // lower than the dot. Across, it is lost past the edge: no light outside the dot's own box.
    run: async ({ page }) => {
      const r = await page.evaluate(async echo => {
        const q = window.sq, W = 1920, H = 1080, x0 = W - 40, y0 = 500;
        const dot = (x, y) => x >= x0 && x < x0 + 4 && y >= y0 && y < y0 + 4 ? [1, 1, 1, 1] : [0, 0, 0, 1];
        const out = {};
        for (const [name, axis] of [['wrap', 2], ['across', 0]]) {
          const f = q.bendFloat({ ...echo, databendAxis: axis, databendDistance: 100, databendRepeats: 1, databendFeedback: .5 }, W, H, dot);
          let s = 0, sx = 0, sy = 0, away = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const v = f.at(x, y)[1];
            if (x >= x0 - 2 && x < x0 + 6 && y >= y0 - 2 && y < y0 + 6) continue;
            away += v; s += v; sx += v * (x + .5); sy += v * (y + .5);
          }
          out[name] = { away, x: sx / s, y: sy / s };
        }
        return out;
      }, ECHO);
      const w = r.wrap, dotY = 502;
      const ok = Math.abs(w.x - 62) <= 1 && Math.abs(w.y - (dotY + 1)) <= .25 && w.away > .5 && r.across.away < 1e-3;
      return { ok, detail: `${w.away < 1e-3 ? NO_BEND : ''}Wrap: copy's light ${w.away.toFixed(3)} centred at x ${w.x.toFixed(2)}, y ${w.y.toFixed(2)} (x 62 ± 1, y ${dotY + 1} ± .25, the dot's centre at x ${1920 - 38}, y ${dotY}); Across: light away from the dot ${r.across.away.toFixed(4)} (none)` };
    },
  },
  {
    name: 'bend-split',
    // The Echo dot with Repeats 1 and Distance 100 at 1920x1080: with Channel split 1 the copy's red, green and blue light
    // centres sit apart along the row, red nearest the dot and blue farthest, each at least 10 pixels from the next;
    // with Channel split 0 within .5 of each other.
    run: async ({ page }) => {
      const r = await page.evaluate(async echo => {
        const q = window.sq, W = 1920, H = 1080, x0 = 400, y0 = 500, out = {};
        for (const split of [0, 1]) {
          const f = q.bendFloat({ ...echo, databendAxis: 0, databendDistance: 100, databendRepeats: 1, databendSplit: split }, W, H, (x, y) => x >= x0 && x < x0 + 4 && y >= y0 && y < y0 + 4 ? [1, 1, 1, 1] : [0, 0, 0, 1]);
          out[split] = [0, 1, 2].map(k => { let s = 0, sx = 0; for (let y = y0; y < y0 + 4; y++) for (let x = x0 + 20; x < x0 + 200; x++) { const v = f.at(x, y)[k]; s += v; sx += v * (x + .5); } return sx / s; });
        }
        return out;
      }, ECHO);
      const [red, green, blue] = r[1], gaps = [green - red, blue - green];
      const ok = gaps.every(g => g >= 10) && Math.max(...r[0]) - Math.min(...r[0]) <= .5;
      return { ok, detail: `split 1: red/green/blue centres at x ${r[1].map(v => v.toFixed(1)).join('/')} (each at least 10 past the one before); split 0: ${r[0].map(v => v.toFixed(1)).join('/')} (within .5)` };
    },
  },
  {
    name: 'bend-hdr',
    // A half-float picture of grey .2 with a 40-pixel square of 4.0 in the middle, read back in float from the Databend
    // stage. Fold (Depth .7) and Corrupt (Depth .5) each keep the square's mean brightness over 3, and change the grey.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, W = 960, H = 540, inside = (x, y) => Math.abs(x + .5 - W / 2) < 20 && Math.abs(y + .5 - H / 2) < 20, out = [];
        for (const [name, params] of [['Fold', { databendMode: 2, databendDepth: .7 }], ['Corrupt', { databendMode: 4, databendDepth: .5 }]]) {
          const f = q.bendFloat({ databendAmount: 1, ...params }, W, H, (x, y) => inside(x, y) ? [4, 4, 4, 1] : [.2, .2, .2, 1]);
          let square = 0, n = 0, grey = 0, m = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const c = f.at(x, y), v = .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
            if (inside(x, y)) { square += v; n++; } else if (x < 100) { grey += Math.abs(v - .2); m++; }
          }
          out.push({ name, square: square / n, grey: grey / m });
        }
        return out;
      });
      const ok = r.every(row => row.square > 3 && row.grey > .01);
      return { ok, detail: r.map(row => `${row.name}: square mean ${row.square.toFixed(3)} (over 3), grey moved ${row.grey.toFixed(4)} on average (over .01)`).join('; ') };
    },
  },
  {
    name: 'bend-loop',
    // Comb and Stutter with Cycles 2 on a moving source: each changes the render, closes its loop across the seam and
    // repeats after a seek. On the still smooth picture over a 120-frame loop, Stutter changes on exactly 4 frames (2 x Cycles 2) and
    // Comb returns to its frame 0 picture at frame 60 (two whole cycles), away from it at frame 30.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, rows = [], plain = await q.px(q.project([q.moving()]), .9), total = 120, at = f => f * Math.PI * 2 / total;
        for (const [name, mode] of [['Comb', 1], ['Stutter', 3]]) {
          const params = { databendAmount: 1, databendMode: mode, databendCycles: 2, databendDepth: .8 };
          const p = q.project([q.moving(params)]);
          const seam = await q.loop(p);
          const direct = await q.shot(p, at(60)); await q.shot(p, at(90)); await q.shot(p, at(10));
          const still = q.loop120(q.exact(q.project([q.smooth(params)])));
          const frames = []; for (let f = 0; f < total; f++) frames.push(await q.shot(still, at(f), 480, 270));
          let changes = 0; for (let f = 0; f < total; f++) if (!q.same(frames[f], frames[(f + total - 1) % total])) changes++;
          const px = await Promise.all([0, 30, 60].map(f => q.pixels(frames[f])));
          rows.push({ name, ...seam, seek: q.same(direct, await q.shot(p, at(60))), change: q.difference(plain, await q.px(p, .9)), changes, half: q.difference(px[0], px[2]), quarter: q.difference(px[0], px[1]) });
        }
        return rows;
      });
      const [comb, stutter] = r;
      const verdicts = r.map(row => loopVerdict(row));
      const ok = verdicts.every(v => v.ok) && r.every(row => row.seek && row.change > .5) && stutter.changes === 4 && comb.half < .05 && comb.quarter > .5;
      return { ok, detail: `${r.map((row, i) => `${row.name}: ${row.change <= .5 ? 'no change, ' : ''}${verdicts[i].detail}, after seeking ${row.seek ? 'byte-identical' : 'DIFFERS'}`).join('; ')}; still picture: Stutter changes on ${stutter.changes} of 120 frames (exactly 4, two times Cycles); Comb frame 60 against 0 ${comb.half.toFixed(3)} (under .05), frame 30 ${comb.quarter.toFixed(3)} (over .5)` };
    },
  },
  {
    name: 'bend-alpha',
    // Straight colour (1, .6, .3) under coverage fading from 1 at the left to nothing at x 600 of 960, read back in float
    // from the Databend stage, each mode with Channel split 1 and Depth .8. Light never leaves coverage: no channel
    // over alpha + .002, and none lit where alpha is 0. Fold and Corrupt keep alpha within .002; Echo, Comb and Stutter
    // carry it with the colour, so coverage moves.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, W = 960, H = 540, rows = [];
        const cover = x => Math.min(1, Math.max(0, (600 - x - .5) / 300 + Math.sin(x * .05) * .1));
        for (let mode = 0; mode < 5; mode++) {
          const f = q.bendFloat({ databendAmount: 1, databendMode: mode, databendSplit: 1, databendDepth: .8, databendDistance: 60 }, W, H, x => { const a = cover(x); return [a, .6 * a, .3 * a, a]; });
          let over = 0, lit = 0, empty = 0, moved = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const c = f.at(x, y);
            over = Math.max(over, c[0] - c[3], c[1] - c[3], c[2] - c[3]);
            if (c[3] === 0) { empty++; if (c[0] || c[1] || c[2]) lit++; }
            moved = Math.max(moved, Math.abs(c[3] - cover(x)));
          }
          rows.push({ over, lit, empty, moved });
        }
        return rows;
      });
      const keeps = [false, false, true, false, true];
      const ok = r.every((row, i) => row.over <= .002 && row.lit === 0 && row.empty > 10000 && (keeps[i] ? row.moved <= .002 : row.moved > .05));
      return { ok, detail: r.map((row, i) => `${BEND_MODES[i]}: light over alpha by ${row.over.toFixed(4)} at most (limit .002), ${row.lit} lit of ${row.empty} empty, alpha moved ${row.moved.toFixed(3)} (${keeps[i] ? 'at most .002' : 'over .05'})`).join('; ') };
    },
  },
  {
    name: 'bend-scale',
    // The same settings for a 960 preview and a 3840 export, the export averaged down 4x4 in linear light: every mode at
    // its defaults (Wrap), and Across, Down, split and fine variants. Distance is in 1080-line pixels, so they match.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.sq, rows = [];
        const plain = await q.px(q.exact(q.project([q.smooth()])));
        const on = { databendAmount: 1 };
        const cases = [
          ['Echo', { ...on, databendMode: 0 }], ['Comb', { ...on, databendMode: 1 }], ['Fold', { ...on, databendMode: 2 }], ['Stutter', { ...on, databendMode: 3 }], ['Corrupt', { ...on, databendMode: 4 }],
          ['Echo Across, Distance 37.5, Repeats 8', { ...on, databendMode: 0, databendAxis: 0, databendDistance: 37.5, databendRepeats: 8, databendSplit: 1 }],
          ['Comb Down', { ...on, databendMode: 1, databendAxis: 1, databendDepth: 1 }],
          ['Stutter Down, Distance 24', { ...on, databendMode: 3, databendAxis: 1, databendDistance: 24, databendDepth: .8, databendSplit: 1 }],
          // Grains and runs finer than a preview pixel: they barely move a smooth picture (Stutter), so they need only
          // move it over .1, but they must not alias.
          ['Stutter Wrap, Distance 1.5', { ...on, databendMode: 3, databendDistance: 1.5, databendDepth: 1 }, .1],
          ['Corrupt Distance 1', { ...on, databendMode: 4, databendDistance: 1, databendDepth: .3 }],
          ['Corrupt Across, Distance 2.5, split 1', { ...on, databendMode: 4, databendAxis: 0, databendDistance: 2.5, databendSplit: 1 }],
        ];
        for (const [name, params, least = .5] of cases) {
          const p = q.exact(q.project([q.smooth(params)]));
          const small = await q.px(p, .9, 960, 540), big = await q.px(p, .9, 3840, 2160);
          rows.push({ name, least, mean: q.difference(small, q.linearDown(big, 960, 540, 4)), change: q.difference(small, plain) });
        }
        return rows;
      });
      const ok = rows.every(r => r.mean < 3 && r.change > r.least);
      return { ok, detail: `${rows.some(r => r.change <= r.least) ? NO_BEND : ''}${rows.map(r => `${r.name}: ${r.mean.toFixed(3)} (moved ${r.change.toFixed(2)})`).join(', ')} (limit 3/255, moved over .5, or .1 where marked)` };
    },
  },
  {
    name: 'bend-cost',
    // Report only: GPU ms per frame added over plain at 960x540, 1920x1080 and 3840x2160 for each mode at its defaults
    // and the heaviest settings (Echo and Comb with Repeats 8 and Channel split 1).
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.sq, gl = q.renderer.renderer.getContext(), one = new Uint8Array(4), rows = [];
        const sync = () => { q.renderer.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); };
        const time = async (p, W, H) => {
          await q.renderer.prepare(p);
          for (let i = 0; i < 3; i++) q.renderer.render(p, .9, W, H);
          sync(); const start = performance.now();
          for (let i = 0; i < 10; i++) q.renderer.render(p, .9 + i * .01, W, H);
          sync(); return (performance.now() - start) / 10;
        };
        const cases = [['Echo', { databendMode: 0 }], ['Comb', { databendMode: 1 }], ['Fold', { databendMode: 2 }], ['Stutter', { databendMode: 3 }], ['Corrupt', { databendMode: 4 }],
          ['Echo Repeats 8 split 1', { databendMode: 0, databendRepeats: 8, databendSplit: 1 }], ['Comb Repeats 8 split 1', { databendMode: 1, databendRepeats: 8, databendSplit: 1 }]];
        for (const [W, H] of [[960, 540], [1920, 1080], [3840, 2160]]) {
          const plain = await time(q.project([q.smooth()]), W, H);
          const parts = [];
          for (const [name, params] of cases) parts.push(`${name} +${((await time(q.project([q.smooth({ databendAmount: 1, ...params })]), W, H)) - plain).toFixed(1)}`);
          rows.push(`${W} plain ${plain.toFixed(1)} ms: ${parts.join(', ')}`);
        }
        return rows;
      });
      return { ok: true, detail: `report only: ${rows.join('; ')}` };
    },
  },
  {
    name: 'bend-engage',
    // An amount of .001 is all but plain in every mode; an amount of 1 is not.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.sq, plain = await q.px(q.exact(q.project([q.smooth()]))), rows = [];
        const diff = async params => q.difference(plain, await q.px(q.exact(q.project([q.smooth(params)]))));
        for (let mode = 0; mode < 5; mode++) {
          const rough = { databendMode: mode, databendDepth: 1, databendSplit: 1, databendRepeats: 8, databendFeedback: .9 };
          rows.push({ low: await diff({ ...rough, databendAmount: .001 }), full: await diff({ ...rough, databendAmount: 1 }) });
        }
        return rows;
      });
      const ok = r.every(row => row.low < 1 && row.full > 1);
      return { ok, detail: `${r.every(row => row.full < .01) ? NO_BEND : ''}${r.map((row, i) => `${BEND_MODES[i]} ${row.low.toFixed(4)} at .001, ${row.full.toFixed(2)} at 1`).join('; ')} (limit 1/255 at .001, over 1 at 1)` };
    },
  },
  {
    name: 'all-presets-neutral',
    // Every preset in the older checkout, at one phase, byte for byte against the same preset now, and none blank.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      const r = await page.evaluate(async () => {
        const q = window.sq, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [], blank = [];
        const current = new Set(q.m.PRESETS.map(p => p.id));
        const make = (m, preset) => { const l = m.applyPreset(m.createLayer(preset.kind), preset.id); l.id = 'preset-proof'; const p = m.createProject(); p.id = 'preset-proof'; p.layers = [l]; p.background = '#000000'; return p; };
        let compared = 0, lowest = 1;
        for (const preset of q.old.PRESETS) {
          if (!current.has(preset.id)) continue;
          const now = make(q.m, preset), then = make(q.old, preset);
          await q.renderer.prepare(now); await before.prepare(then);
          const a = await q.renderer.exportPNG(now, .9, 960, 540);
          if (!q.same(a, await before.exportPNG(then, .9, 960, 540))) changed.push(preset.id);
          const share = q.litShare(await q.pixels(a)); lowest = Math.min(lowest, share); if (share < .005) blank.push(preset.id);
          compared++;
        }
        before.dispose();
        return { total: q.old.PRESETS.length, now: current.size, compared, missing: q.old.PRESETS.map(p => p.id).filter(id => !current.has(id)), changed, blank, lowest };
      });
      const unexpected = r.blank.filter(id => !BLANK_PRESETS.includes(id));
      const ok = r.compared === r.total && r.compared > 0 && !r.changed.length && !r.missing.length && !unexpected.length;
      return { ok, detail: `${r.compared} of ${r.total} baseline presets compared at phase .9, 960x540 (${r.now} presets now); ${r.changed.length ? `changed: ${r.changed.join(', ')}` : 'all byte-identical'}${r.missing.length ? `; missing now: ${r.missing.join(', ')}` : ''}; lowest lit share ${(r.lowest * 100).toFixed(2)}% (limit .5%); blank: ${r.blank.join(', ') || 'none'}` };
    },
  },
  {
    name: 'old-file',
    // A project written by the older build's own code, with LED wall, Characters, Tiles, Warp, Liquid, Luma Warp,
    // Polar and Mirror on, goes to disk, is read back and opens in both builds. The file holds no signal keys; opening
    // it fills them in at their defaults, and every render matches the older build's byte for byte.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      await fs.mkdir(proof, { recursive: true });
      const file = path.join(proof, 'baseline-project.formfield');
      const saved = await page.evaluate(() => {
        const q = window.sq, o = q.old, p = o.createProject();
        const add = (kind, finish, extra = {}) => {
          const preset = o.PRESETS.find(x => x.kind === kind);
          let l = preset ? o.applyPreset(o.createLayer(kind), preset.id) : o.createLayer(kind);
          if (kind === 'image') l.image = { name: 'tiny.png', dataUrl: q.tinyUrl, width: 64, height: 36, fit: 'contain' };
          l = o.applyFinish(l, finish); Object.assign(l, extra); return l;
        };
        p.id = 'old-file-proof'; p.name = 'Baseline project'; p.background = '#000000';
        p.layers = [add('surface', 'finish-tunnel'), add('fractal', 'finish-terraces', { opacity: .7, blend: 'screen' }), add('liquid', 'finish-soft-glow', { opacity: .6, blend: 'screen' }), add('image', 'finish-halftone', { opacity: .5 })];
        const looks = [
          { ledAmount: 1, ledSize: 12, bendAmount: .2, bendField: 1 },
          { charAmount: .6, charSize: 18, liquidAmount: .25, lumaWarpAmount: .15 },
          { tileAmount: 1, tileStyle: 1, tileSize: 22, polarAmount: .6 },
          { tileAmount: .8, tileSize: 16, mirrorAmount: 1, mirrorMode: 1 },
        ];
        p.layers.forEach((l, i) => Object.assign(l.params, looks[i]));
        return JSON.stringify(o.validateProject(p), null, 2);
      });
      await fs.writeFile(file, saved);
      const text = await fs.readFile(file, 'utf8');
      const r = await page.evaluate(async text => {
        const q = window.sq, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [], blank = [], offDefault = [];
        const raw = JSON.parse(text), now = q.m.validateProject(JSON.parse(text)), then = q.old.validateProject(JSON.parse(text));
        const signalKeys = new Set([...q.m.VHS_KEYS, ...q.m.DROP_KEYS, ...q.m.CRT_KEYS, ...q.m.JPEG_KEYS, ...q.m.DATABEND_KEYS]);
        let added = 0, compared = 0, lowest = 1, signalInFile = 0, signalOpened = 0, tilesOn = 0, warpsOn = 0;
        raw.layers.forEach(l => {
          for (const key of Object.keys(l.params)) if (signalKeys.has(key)) signalInFile++;
          for (const key of ['ledAmount', 'charAmount', 'tileAmount']) if ((l.params[key] ?? 0) > 0) tilesOn++;
          for (const key of ['bendAmount', 'liquidAmount', 'lumaWarpAmount', 'polarAmount', 'mirrorAmount']) if ((l.params[key] ?? 0) > 0) warpsOn++;
        });
        now.layers.forEach((l, i) => {
          const defs = q.m.parameterDefinitions(l.kind);
          for (const key of Object.keys(l.params)) {
            if (signalKeys.has(key)) signalOpened++;
            if (!(key in raw.layers[i].params)) { added++; const d = defs.find(x => x.key === key); if (!d || l.params[key] !== d.default) offDefault.push(`${l.kind}.${key}`); }
          }
        });
        const scenes = [['all layers', p => p], ...now.layers.map((l, i) => [l.kind, p => ({ ...p, layers: [p.layers[i]] })])];
        for (const [name, pick] of scenes) {
          const a = pick(now), b = pick(then);
          await q.renderer.prepare(a); await before.prepare(b);
          for (const phase of [0, 2.1, 4.2]) {
            compared++;
            const shot = await q.renderer.exportPNG(a, phase, 960, 540);
            if (!q.same(shot, await before.exportPNG(b, phase, 960, 540))) changed.push(`${name}@${phase}`);
            const share = q.litShare(await q.pixels(shot)); lowest = Math.min(lowest, share); if (share < .005) blank.push(`${name}@${phase}`);
          }
        }
        before.dispose();
        return { schema: raw.schemaVersion, savedSchema: now.schemaVersion, kinds: now.layers.map(l => l.kind), added, offDefault, compared, changed, blank, lowest, signalInFile, signalOpened, tilesOn, warpsOn };
      }, text);
      const ok = r.compared === 15 && !r.blank.length && !r.changed.length && !r.offDefault.length && r.added > 0 && r.signalInFile === 0 && r.signalOpened > 0 && r.tilesOn === 4 && r.warpsOn === 5 && r.savedSchema === r.schema;
      return { ok, detail: `${path.relative(root, file)}: schema ${r.schema} in the file, ${r.savedSchema} once opened, layers ${r.kinds.join(', ')}; ${r.tilesOn} tile finishes and ${r.warpsOn} warps on in the file (want 4: LED wall, Characters and two Tiles; and 5); ${r.signalInFile} signal keys in the file, ${r.signalOpened} once opened; ${r.added} new keys filled in, ${r.offDefault.length} off default${r.offDefault.length ? ` (${r.offDefault.slice(0, 8).join(', ')})` : ''}; ${r.compared} renders ${r.changed.length ? `changed: ${r.changed.join(', ')}` : 'byte-identical'}; lowest lit share ${(r.lowest * 100).toFixed(2)}% (limit .5%); blank: ${r.blank.join(', ') || 'none'}` };
    },
  },
  {
    name: 'stack',
    // All five signal effects with LED wall, Warp, Split, Gradient, Glow, Feedback and Time on one Surface layer:
    // non-blank, the same bytes after seeking away and back, and taking out any one effect changes the render at one
    // of three phases (a render that ignored it would not change).
    run: async ({ page }) => {
      const r = await page.evaluate(async full => {
        const q = window.sq, phases = [.9, 3.3, 5.1];
        const make = params => q.project([q.base('surface', params)]);
        const firsts = [];
        for (const phase of phases) firsts.push(await q.shot(make(full), phase));
        const again = await q.shot(make(full), phases[0]);
        const inert = [];
        for (const key of Object.keys(full)) {
          if (!/Amount$|^echo$|^slitShift$|Mix$/.test(key)) continue;
          let same = true;
          for (let i = 0; i < phases.length && same; i++) same = q.same(firsts[i], await q.shot(make({ ...full, [key]: 0 }), phases[i]));
          if (same) inert.push(key);
        }
        const lit = await Promise.all(firsts.map(async b => q.litShare(await q.pixels(b))));
        return { same: q.same(firsts[0], again), lit: Math.min(...lit), inert, effects: Object.keys(full).filter(k => /Amount$|^echo$|^slitShift$|Mix$/.test(k)).length };
      }, STACK);
      const ok = r.same && r.lit > .05 && !r.inert.length && r.effects === 12;
      return { ok, detail: `${r.effects} effects on (want 12); seek ${r.same ? 'byte-identical' : 'DIFFERS'}; least lit share ${(r.lit * 100).toFixed(1)}% over 3 phases (over 5%); effects with no effect in the stack: ${r.inert.join(', ') || 'none'}` };
    },
  },
  {
    name: 'sheet',
    // Contact sheets for judging by eye: one per effect and layer kind, three phases, plus 1:1 crops of a 1080 frame and
    // the eye-review sheets. Gates: every choice keeps at least SHEET_LEAST of plain's brightness, no stage goes black
    // (SHEET_LIT_LEAST), and every choice differs from plain by over SHEET_CHANGE_LEAST.
    run: async ({ page }) => {
      await fs.mkdir(proof, { recursive: true });
      const metrics = []; let written = 0;
      const save = async sheets => { for (const sheet of sheets) { await fs.writeFile(path.join(proof, sheet.name), Buffer.from(sheet.data, 'base64')); written++; } };
      for (const kind of SHEET_KINDS) {
        const r = await page.evaluate(async ([groups, kind]) => {
          const q = window.sq, { b64, label } = q, W = 400, H = 225, TAU = Math.PI * 2, phases = [0, TAU / 3, 2 * TAU / 3], sheets = [], metrics = [];
          const thumb = async bytes => {
            const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
            const c = new OffscreenCanvas(120, 68), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bitmap, 0, 0, 120, 68);
            return { bitmap, data: x.getImageData(0, 0, 120, 68).data };
          };
          const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; return s / (a.length / 4); };
          const mean = d => { let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4); };
          const plainThumbs = [], plainFull = [];
          for (let col = 0; col < 3; col++) { const bytes = await q.shot(q.project([q.base(kind)]), phases[col], 960, 540); plainThumbs.push((await thumb(bytes)).data); plainFull.push(mean(await q.pixels(bytes))); }
          for (const [effect, types] of groups) {
            const rows = [['Plain', {}], ...types], sheet = new OffscreenCanvas(W * 3, H * rows.length), x = sheet.getContext('2d');
            x.fillStyle = '#000'; x.fillRect(0, 0, sheet.width, sheet.height);
            for (let row = 0; row < rows.length; row++) {
              const [name, params] = rows[row], project = q.project([q.base(kind, params)]), shots = [], full = [], lit = [];
              for (let col = 0; col < 3; col++) {
                const bytes = await q.shot(project, phases[col], 960, 540), t = await thumb(bytes), d = await q.pixels(bytes);
                shots.push(t.data); full.push(mean(d)); lit.push(q.litShare(d));
                x.drawImage(t.bitmap, col * W, row * H, W, H); label(x, `${name} ${col + 1}/3`, col * W, row * H);
              }
              if (!row) continue;
              metrics.push({ kind, effect, type: name, brightness: full.reduce((a, v) => a + v, 0) / 3, plainBrightness: plainFull.reduce((a, v) => a + v, 0) / 3, leastLit: Math.min(...lit), leastMean: Math.min(...full), acrossLoop: (diff(shots[0], shots[1]) + diff(shots[1], shots[2]) + diff(shots[2], shots[0])) / 3, fromPlain: shots.reduce((a, v, i) => a + diff(v, plainThumbs[i]), 0) / 3 });
            }
            sheets.push({ name: `sheet-${kind}-${effect.toLowerCase().replace(/ /g, '-')}.png`, data: await b64(await sheet.convertToBlob({ type: 'image/png' })) });
          }
          const looks = groups.flatMap(([effect, types]) => types.map(([name, params]) => [`${effect}: ${name}`, params]));
          const crop = new OffscreenCanvas(480 * 4, 270 * Math.ceil(looks.length / 4)), c = crop.getContext('2d');
          for (let i = 0; i < looks.length; i++) {
            const bitmap = await createImageBitmap(new Blob([await q.shot(q.project([q.base(kind, looks[i][1])]), phases[1], 1920, 1080)], { type: 'image/png' }));
            const X = (i % 4) * 480, Y = (i >> 2) * 270; c.drawImage(bitmap, 720, 405, 480, 270, X, Y, 480, 270); label(c, looks[i][0], X, Y);
          }
          sheets.push({ name: `crop-1080-${kind}.png`, data: await b64(await crop.convertToBlob({ type: 'image/png' })) });
          return { sheets, metrics };
        }, [SHEET_GROUPS, kind]);
        await save(r.sheets);
        for (const m of r.metrics) m.share = m.brightness / m.plainBrightness;
        metrics.push(...r.metrics);
      }
      // Eye-review sheets for the open items: report only.
      const eye = await page.evaluate(async () => {
        const q = window.sq, { b64, label } = q, TAU = Math.PI * 2, sheets = [];
        const bitmapOf = async bytes => createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        // (1) CRT at a 960 preview, 1:1 and shown 2x so single pixels can be judged, at the defaults and each mask.
        {
          const looks = [['CRT defaults (Stripes, size 5)', { crtAmount: 1 }], ['CRT Slots', { crtAmount: 1, crtMask: 2 }], ['CRT Dots', { crtAmount: 1, crtMask: 3 }], ['CRT no mask', { crtAmount: 1, crtMask: 0 }]];
          const s = new OffscreenCanvas(960, 540 * looks.length), x = s.getContext('2d'); x.imageSmoothingEnabled = false;
          for (let i = 0; i < looks.length; i++) {
            const b = await bitmapOf(await q.shot(q.project([q.base('surface', looks[i][1])]), TAU / 3, 960, 540));
            x.drawImage(b, 0, 0, 960, 540, 0, i * 540, 960, 540); x.drawImage(b, 360, 200, 240, 135, 480, i * 540 + 270, 480, 270); label(x, `${looks[i][0]}, 960 preview (inset 2x)`, 0, i * 540, 420);
          }
          sheets.push({ name: 'eye-crt-960.png', data: await b64(await s.convertToBlob({ type: 'image/png' })) });
        }
        // (2) JPEG Quality on a smooth gradient and on the poster, 1:1 crops of a 1080 frame.
        {
          const looks = [['Plain', {}], ['Quality 0', { jpegAmount: 1, jpegQuality: 0 }], ['Quality .2 (default)', { jpegAmount: 1 }], ['Quality .5', { jpegAmount: 1, jpegQuality: .5 }]];
          const s = new OffscreenCanvas(480 * looks.length, 270 * 2), x = s.getContext('2d');
          for (let i = 0; i < looks.length; i++) {
            for (const [row, layer] of [[0, q.gradient(looks[i][1])], [1, q.base('image', looks[i][1])]]) {
              const b = await bitmapOf(await q.shot(q.project([layer]), .9, 1920, 1080));
              x.drawImage(b, 720, 405, 480, 270, i * 480, row * 270, 480, 270); label(x, `${looks[i][0]} ${row ? 'poster' : 'gradient'}`, i * 480, row * 270);
            }
          }
          sheets.push({ name: 'eye-jpeg-gradient.png', data: await b64(await s.convertToBlob({ type: 'image/png' })) });
        }
        // (3) Databend Corrupt at Depth .25 (default), .5 and 1, at Split 0 and 1, on Surface, at 960x540.
        {
          const looks = [['Plain', {}], ['Corrupt Depth .25 (default)', { databendAmount: 1, databendMode: 4 }], ['Corrupt Depth .5', { databendAmount: 1, databendMode: 4, databendDepth: .5 }], ['Corrupt Depth 1', { databendAmount: 1, databendMode: 4, databendDepth: 1 }],
            ['Corrupt Split 0', { databendAmount: 1, databendMode: 4, databendSplit: 0 }], ['Corrupt Split 1', { databendAmount: 1, databendMode: 4, databendSplit: 1 }]];
          const s = new OffscreenCanvas(480 * 3, 270 * 4), x = s.getContext('2d');
          for (let i = 0; i < looks.length; i++) for (const [k, kind] of [[0, 'surface'], [1, 'image']]) {
            const b = await bitmapOf(await q.shot(q.project([q.base(kind, looks[i][1])]), TAU / 3, 960, 540));
            const X = (i % 3) * 480, Y = (Math.floor(i / 3) * 2 + k) * 270; x.drawImage(b, X, Y, 480, 270); label(x, `${looks[i][0]} ${kind}`, X, Y, 300);
          }
          sheets.push({ name: 'eye-databend-corrupt.png', data: await b64(await s.convertToBlob({ type: 'image/png' })) });
        }
        // (4) VHS at its defaults on every kind at 960x540, full frame.
        {
          const kinds = ['surface', 'fractal', 'liquid', 'image'], s = new OffscreenCanvas(960 * 2, 540 * 4), x = s.getContext('2d');
          for (let i = 0; i < kinds.length; i++) for (const [col, params] of [[0, {}], [1, { vhsAmount: 1 }]]) {
            const b = await bitmapOf(await q.shot(q.project([q.base(kinds[i], params)]), TAU / 3, 960, 540));
            x.drawImage(b, col * 960, i * 540); label(x, `${kinds[i]} ${col ? 'VHS defaults' : 'plain'}`, col * 960, i * 540);
          }
          sheets.push({ name: 'eye-vhs-defaults.png', data: await b64(await s.convertToBlob({ type: 'image/png' })) });
        }
        // (5) Torn VHS rows on hard edges: the 960 preview against a 3840 export averaged down 4x4 in linear light, and
        // their difference times 4, on the poster with Tracking wobble .8.
        {
          const p = q.exact(q.project([q.base('image', { vhsAmount: 1, vhsTracking: .8 })]));
          const small = await q.px(p, .9, 960, 540), big = q.linearDown(await q.px(p, .9, 3840, 2160), 960, 540, 4);
          const img = (fn) => { const d = new ImageData(960, 540); for (let y = 0; y < 540; y++) for (let x2 = 0; x2 < 960; x2++) { const src = (y * 960 + x2) * 4, dst = (y * 960 + x2) * 4; for (let k = 0; k < 3; k++) d.data[dst + k] = fn(src + k); d.data[dst + 3] = 255; } return d; };
          let worst = 0, sum = 0, over8 = 0;
          for (let i = 0; i < small.length; i += 4) { let m = 0; for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(small[i + k] - big[i + k])); worst = Math.max(worst, m); sum += m; if (m > 8) over8++; }
          const s = new OffscreenCanvas(960, 540 * 3), x = s.getContext('2d');
          x.putImageData(img(i => small[i]), 0, 0); x.putImageData(img(i => Math.round(big[i])), 0, 540); x.putImageData(img(i => Math.min(255, 4 * Math.abs(small[i] - big[i]))), 0, 1080);
          label(x, 'VHS tracking .8, 960 preview', 0, 0, 300); label(x, '3840 export, averaged down 4x4', 0, 540, 300); label(x, 'difference x4', 0, 1080, 300);
          sheets.push({ name: 'eye-vhs-torn-rows.png', data: await b64(await s.convertToBlob({ type: 'image/png' })) });
          return { sheets, torn: { worst, mean: sum / (small.length / 4), over8: over8 / (small.length / 4) } };
        }
      });
      await save(eye.sheets);
      await fs.writeFile(path.join(proof, 'sheet-metrics.json'), JSON.stringify({ looks: metrics, tornRows: eye.torn }, null, 2));
      const types = SHEET_GROUPS.reduce((a, [, t]) => a + t.length, 0), expected = SHEET_KINDS.length * (SHEET_GROUPS.length + 1) + eye.sheets.length;
      const least = m => SHEET_LEAST[m.effect] ?? SHEET_LEAST.all;
      const flat = metrics.filter(m => m.fromPlain <= SHEET_CHANGE_LEAST), dim = metrics.filter(m => m.share < least(m)), black = metrics.filter(m => m.leastLit < SHEET_LIT_LEAST || m.leastMean < 2);
      const name = m => `${m.effect} ${m.type} on ${m.kind}`;
      const lowest = effect => Math.min(...metrics.filter(m => m.effect === effect).map(m => m.share));
      const ok = written === expected && metrics.length === types * SHEET_KINDS.length && !flat.length && !dim.length && !black.length;
      return { ok, detail: `${written} sheets, ${metrics.length} choice and layer pairs in ${path.relative(root, proof)}; no visible change from plain (${SHEET_CHANGE_LEAST}/255 or less): ${flat.map(m => `${name(m)} ${m.fromPlain.toFixed(2)}`).join(', ') || 'none'}; brightness against plain, lowest ${SHEET_GROUPS.map(([effect]) => `${effect} ${(lowest(effect) * 100).toFixed(1)}%`).join(', ')} (limits CRT and JPEG damage ${SHEET_LEAST.CRT * 100}%, others ${SHEET_LEAST.all * 100}%), too dim: ${dim.map(m => `${name(m)} ${(m.share * 100).toFixed(1)}%`).join(', ') || 'none'}; black stages (lit share under ${SHEET_LIT_LEAST * 100}% on a phase, or a mean under 2/255): ${black.map(name).join(', ') || 'none'}; torn VHS rows, preview against export averaged down (report only): worst ${eye.torn.worst.toFixed(1)}/255, mean ${eye.torn.mean.toFixed(3)}, ${(eye.torn.over8 * 100).toFixed(3)}% of pixels over 8` };
    },
  },
  {
    name: 'preview-cost',
    // A report, not a gate. The mean frame time on a Surface layer for each effect at its defaults and at its heaviest
    // common setting, and all five together, at three sizes. Each frame is forced to finish on the GPU, so the time is
    // the real draw. Every case runs in each round, so warm-up and drift land on all of them alike; the first round
    // only warms, and the median of the other rounds is reported.
    run: async ({ page }) => {
      const rows = await page.evaluate(async ([cases, sizes]) => {
        const q = window.sq, canvas = document.createElement('canvas'), R = new q.m.StudioRenderer(canvas), gl = R.renderer.getContext(), ROUNDS = 4, pixel = new Uint8Array(4), rows = [];
        const median = list => [...list].sort((a, b) => a - b)[list.length >> 1];
        try {
          for (const [w, h] of sizes) {
            const FRAMES = w > 2000 ? 30 : 60, WARM = 8, times = cases.map(() => []);
            for (let round = 0; round < ROUNDS; round++) for (let c = 0; c < cases.length; c++) {
              const p = q.project([q.base('surface', cases[c][1])]); await R.prepare(p);
              let total = 0;
              for (let f = 0; f < WARM + FRAMES; f++) {
                const start = performance.now();
                R.render(p, f / (WARM + FRAMES) * Math.PI * 2, w, h); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                if (f >= WARM) total += performance.now() - start;
              }
              if (round) times[c].push(total / FRAMES);
            }
            cases.forEach(([name], c) => rows.push({ size: `${w}x${h}`, frames: FRAMES, name, ms: median(times[c]), low: Math.min(...times[c]), high: Math.max(...times[c]) }));
          }
        } finally { R.dispose(); }
        return rows;
      }, [COST_CASES, COST_SIZES]);
      await fs.mkdir(proof, { recursive: true });
      await fs.writeFile(path.join(proof, 'preview-cost.json'), JSON.stringify(rows, null, 2));
      const text = COST_SIZES.map(([w, h]) => {
        const set = rows.filter(r => r.size === `${w}x${h}`), plain = set[0].ms;
        return `${w}x${h} (median of 3 rounds of ${set[0].frames} frames): Plain ${plain.toFixed(2)} ms (${set[0].low.toFixed(2)} to ${set[0].high.toFixed(2)}); ${set.slice(1).map(r => `${r.name} ${r.ms.toFixed(2)} (${r.ms >= plain ? '+' : ''}${(r.ms - plain).toFixed(2)})`).join(', ')}`;
      }).join(' | ');
      return { ok: rows.length === COST_CASES.length * COST_SIZES.length, detail: `Surface, report only. ${text}` };
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
await bundle(current ? path.resolve(current) : root, 'renderer.js', current ? `\nexport * as THREE from 'three';\nexport {applyFinish,validateProject} from './src/core/project';` : `\nexport {crtCurve} from './src/rendering/signal';\nexport * as THREE from 'three';\nexport {applyFinish,validateProject,parameterDefinitions} from './src/core/project';\nexport {VHS_KEYS,DROP_KEYS,CRT_KEYS,JPEG_KEYS,DATABEND_KEYS} from './src/core/finishing';`);
if (baseline) await bundle(path.resolve(baseline), 'baseline.js', `\nexport {applyFinish,validateProject} from './src/core/project';`);
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
    // A test picture from pixel(x, y), both in frame heights from the middle. encodePNG takes rows bottom first, as
    // WebGL reads them back, so y runs up from the bottom: y = -.3 is in the bottom third.
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
    // A white line 2% of the frame tall across the bottom third (rows 427 to 436 of 540 from the top), on black.
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
    // A half-float picture from pixel(x, y), in pixels with y from the top, through the signal pass alone and read back
    // in float: at(x, y), y from the top, is the last stage's output (with Databend alone, Databend's).
    const bendFloat = (params, W, H, pixel) => {
      const T = m.THREE, layer = m.createLayer('image'); Object.assign(layer.params, params);
      const half = new Uint16Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = pixel(x, y), k = ((H - 1 - y) * W + x) * 4; for (let i = 0; i < 4; i++) half[k + i] = T.DataUtils.toHalfFloat(c[i]); }
      const source = new T.DataTexture(half, W, H, T.RGBAFormat, T.HalfFloatType);
      source.minFilter = source.magFilter = T.LinearFilter; source.needsUpdate = true;
      renderer.signalSource(layer, layer, source, .9, W, H);
      const data = readTarget(renderer.signalTargets[0], W, H);
      source.dispose();
      return { at: (x, y) => { const k = ((H - 1 - y) * W + x) * 4; return [data[k], data[k + 1], data[k + 2], data[k + 3]]; } };
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
    // Brightness and colour waves about 120 1080-line pixels long, steep enough that flattened blocks step clearly.
    const wavesUrl = await dataUrl(960, 540, (x, y) => [
      Math.round(128 + 100 * Math.sin(x * 57 + .3)), Math.round(128 + 100 * Math.sin(y * 48 - .8)), Math.round(128 + 90 * Math.sin((x + y) * 40)), 255,
    ]);
    const waves = (params = {}) => image(wavesUrl, params, 'waves');
    // Flat blocks of random colour, 8 pixels of a 1080-line frame each (1080 is 135 blocks, so they line up from the
    // top as from the bottom), at 1920x1080.
    let blockyUrl = null;
    const blocky = async () => {
      blockyUrl ??= await dataUrl(1920, 1080, (x, y) => {
        const bx = Math.floor((x + 1920 / 1080 / 2) * 1080 / 8), by = Math.floor((y + .5) * 1080 / 8);
        let h = (bx * 73856093 ^ by * 19349663) >>> 0;
        const next = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h >>> 24; };
        // Brightness 70..185 and colour difference within 35 either way: in range however neighbours' colours mix.
        next(); const Y = 70 + next() * 115 / 255, cb = (next() - 127.5) * 70 / 255, cr = (next() - 127.5) * 70 / 255;
        const R = Y + 1.402 * cr, B = Y + 1.772 * cb;
        return [Math.round(R), Math.round((Y - .299 * R - .114 * B) / .587), Math.round(B), 255];
      });
      return (params = {}) => image(blockyUrl, params, 'blocky', 1920, 1080);
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
    // A neon poster with thin dark rings, for the sheets' Image rows.
    const NEON = [[255, 0, 120], [255, 200, 0], [0, 230, 120], [0, 150, 255], [170, 0, 255], [255, 70, 0]];
    const posterUrl = await dataUrl(960, 540, (x, y) => {
      if (Math.abs(Math.sin(Math.hypot(x, y) * 14)) < .1) return [8, 8, 12, 255];
      const c = NEON[((Math.floor(3 * (x + .9) + 2 * Math.sin(3 * y)) % 6) + 6) % 6];
      return [c[0], c[1], c[2], 255];
    });
    // The first preset of a kind, or the poster for Image, with these params.
    const base = (kind, params = {}) => {
      if (kind === 'image') return image(posterUrl, params, 'poster');
      const l = m.applyPreset(m.createLayer(kind), m.PRESETS.find(p => p.kind === kind).id); l.id = `${kind}-proof`; Object.assign(l.params, params); return l;
    };
    // A soft diagonal gradient from deep blue to orange, for judging blocks on smooth tone.
    const gradientUrl = await dataUrl(1920, 1080, (x, y) => { const t = Math.min(1, Math.max(0, (x + .9) / 1.8 * .7 + (y + .5) * .3)); return [Math.round(20 + 220 * t), Math.round(40 + 90 * t), Math.round(160 - 120 * t), 255]; });
    const gradient = (params = {}) => image(gradientUrl, params, 'gradient', 1920, 1080);
    // Sheets: a PNG blob as base64, and a caption box.
    const b64 = async blob => { const u = new Uint8Array(await blob.arrayBuffer()); let t = ''; for (let i = 0; i < u.length; i += 8192) t += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(t); };
    const label = (x, text, X, Y, w = 220) => { x.font = '600 15px sans-serif'; x.fillStyle = 'rgba(0,0,0,.7)'; x.fillRect(X, Y, w, 22); x.fillStyle = '#fff'; x.fillText(text, X + 5, Y + 16); };
    window.sq = { m, old, renderer, tinyUrl, urlOf, image, base, gradient, b64, label, smooth, white, line, square, readTarget, floatFrame, uvPin, bendFloat, soft, redBlue, blocky, waves, moving, project, loop120, exact, pixels, shot, px, difference, same, loop, litShare, toLinear, linearDown };
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
