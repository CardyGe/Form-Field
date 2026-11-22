// Real Electron/WebGL checks for the Colour and Time finishes.
// Run: node scripts/verify-colour-time.mjs --baseline=<checkout of the commit before them> [--only=neutral,split]
// --only takes comma-separated name prefixes. Each check prints one PASS or FAIL
// line, and any failure makes the exit code non-zero. Output goes to work/colour-time.
//
// To add a check, add an entry to CHECKS: `run` receives the helpers below and
// returns { ok, detail }. Code passed to `page.evaluate` runs in the renderer
// and reaches the page helpers through `window.ct`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = option('baseline');
const only = option('only')?.split(',').map(s => s.trim()).filter(Boolean);
const out = path.join(root, 'work/colour-time');
const TAU = Math.PI * 2;
const SHAPES = ['Straight', 'Lens', 'Edges', 'Wave'];
const STAT_MODES = [['Echo', 1], ['Median', 2], ['Darkest', 3], ['Brightest', 4]];

/** Fails a check that needs the older checkout, rather than letting it pass unseen. */
const needsBaseline = () => baseline ? null : { ok: false, detail: 'needs --baseline=<checkout>' };

/** Reads the result of the page helper `ct.loop`: the literal wrap and the seam. */
const loopVerdict = (r, limit = .1) => ({
  ok: r.literal && r.seam < limit,
  detail: `phase 0 and TAU ${r.literal ? 'match byte for byte' : 'differ'}; seam (TAU - 1e-4 against 0) mean ${r.seam.toFixed(4)} (limit ${limit})`,
});

const CHECKS = [
  {
    name: 'neutral',
    // Every control at its default: one preset of every kind against the older checkout.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      const result = await page.evaluate(async () => {
        const q = window.ct, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [];
        // Image layers have no presets, so they use a small generated picture.
        const kinds = [...new Set(q.old.PRESETS.map(p => p.kind)), 'image'];
        const make = (m, kind) => {
          const l = kind === 'image' ? m.createLayer('image') : m.applyPreset(m.createLayer(kind), m.PRESETS.find(p => p.kind === kind).id);
          if (kind === 'image') l.image = { name: 'tiny.png', dataUrl: q.tinyUrl, width: 64, height: 36, fit: 'contain' };
          l.id = 'neutral-proof';
          const p = m.createProject(); p.id = 'neutral-proof'; p.layers = [l]; p.background = '#000000';
          return p;
        };
        for (const kind of kinds) {
          const now = make(q.m, kind), then = make(q.old, kind);
          await q.renderer.prepare(now); await before.prepare(then);
          const a = await q.renderer.exportPNG(now, .9, 960, 540), b = await before.exportPNG(then, .9, 960, 540);
          if (!q.same(a, b)) changed.push(kind);
        }
        before.dispose();
        return { kinds: kinds.length, changed };
      });
      return { ok: result.changed.length === 0, detail: result.changed.length ? `changed: ${result.changed.join(', ')}` : `${result.kinds} kinds byte-identical` };
    },
  },
  {
    name: 'split-grey',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, px = await q.px(q.project([q.grey({ splitAmount: 12, splitSamples: 9 })]));
        let rg = 0, gb = 0;
        for (let i = 0; i < px.length; i += 4) { rg += Math.abs(px[i] - px[i + 1]); gb += Math.abs(px[i + 1] - px[i + 2]); }
        return { rg: rg / (px.length / 4), gb: gb / (px.length / 4) };
      });
      return { ok: r.rg < 1 && r.gb < 1, detail: `mean |R-G| ${r.rg.toFixed(3)}, |G-B| ${r.gb.toFixed(3)} (limit 1)` };
    },
  },
  {
    name: 'split-alpha',
    // Gated with exact highlights, which show what the pass wrote. The default soft
    // highlight curve is measured and printed too: it lifts a channel when another
    // channel of the same pixel drops, so it is not a measure of the pass alone.
    run: async ({ page }) => {
      const measure = highlights => page.evaluate(async ([shapes, highlights]) => {
        const q = window.ct, W = 960, H = 540;
        const scene = params => { const p = q.project([q.soft(params)], true); p.highlights = highlights; return p; };
        const plain = await q.px(scene({}));
        // Half the split distance at this size, plus one pixel for filtering.
        const reach = Math.ceil(32 / 1080 * H / 2) + 1;
        const area = new Uint32Array((W + 1) * (H + 1));
        let brightest = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, covered = plain[i + 3] > 0 ? 1 : 0;
          if (covered) brightest = Math.max(brightest, plain[i], plain[i + 1], plain[i + 2]);
          area[(y + 1) * (W + 1) + x + 1] = covered + area[y * (W + 1) + x + 1] + area[(y + 1) * (W + 1) + x] - area[y * (W + 1) + x];
        }
        const anyNear = (x, y) => {
          const x0 = Math.max(0, x - reach), x1 = Math.min(W, x + reach + 1), y0 = Math.max(0, y - reach), y1 = Math.min(H, y + reach + 1);
          return area[y1 * (W + 1) + x1] - area[y0 * (W + 1) + x1] - area[y1 * (W + 1) + x0] + area[y0 * (W + 1) + x0] > 0;
        };
        const rows = [];
        for (let shape = 0; shape < shapes.length; shape++) {
          const px = await q.px(scene({ splitAmount: 32, splitShape: shape, splitSamples: 9, splitThreshold: 0 }));
          let leaked = 0, over = 0, worst = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4, a = px[i + 3];
            if (a > 0 && !anyNear(x, y)) leaked++;
            if (a > 0 && a < 255) { const excess = Math.max(px[i], px[i + 1], px[i + 2]) - brightest; worst = Math.max(worst, excess); if (excess > 2) over++; }
          }
          rows.push({ shape: shapes[shape], moved: q.difference(plain, px), leaked, over, worst });
        }
        return { brightest, rows };
      }, [SHAPES, highlights]);
      const exact = await measure('exact'), soft = await measure('soft');
      const bad = exact.rows.filter(r => r.moved === 0 || r.leaked || r.over);
      const text = exact.rows.map(r => `${r.shape} moved ${r.moved.toFixed(3)} leaked ${r.leaked} over ${r.over} worst +${r.worst}`).join('; ');
      const curve = soft.rows.map(r => `${r.shape} leaked ${r.leaked} worst +${r.worst}`).join(', ');
      const none = exact.rows.some(r => r.moved === 0) ? 'Split has no effect on the render. ' : '';
      return { ok: bad.length === 0 && soft.rows.every(r => r.leaked === 0), detail: `${none}exact: peak ${exact.brightest}; ${text} | soft curve (not gated on brightness): peak ${soft.brightest}; ${curve}` };
    },
  },
  {
    name: 'split-scale',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, plain = await q.px(q.project([q.soft()], true)), rows = [];
        for (let shape = 0; shape < 4; shape++) {
          const p = () => q.project([q.soft({ splitAmount: 32, splitSamples: 9, splitShape: shape, splitThreshold: .05 })], true);
          const small = await q.px(p()), big = await q.px(p(), .9, 1920, 1080);
          const reduced = new Uint8ClampedArray(small.length);
          for (let y = 0; y < 540; y++) for (let x = 0; x < 960; x++) for (let c = 0; c < 4; c++) {
            const at = (X, Y) => big[(Y * 1920 + X) * 4 + c];
            reduced[(y * 960 + x) * 4 + c] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
          }
          rows.push({ difference: q.difference(small, reduced), moved: q.difference(plain, small) });
        }
        return rows;
      });
      const none = r.some(row => row.moved === 0) ? 'Split has no effect on the render. ' : '';
      const text = r.map((row, i) => `${SHAPES[i]} ${row.difference.toFixed(3)}`).join(', ');
      return { ok: r.every(row => row.moved > 0 && row.difference < 2), detail: `${none}mean difference ${text} (limit 2)` };
    },
  },
  {
    name: 'split-engage',
    // A barely-on Split must look like the plain layer, on black and on transparency.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.ct, rows = [];
        const kinds = [...new Set(q.m.PRESETS.map(p => p.kind)), 'image'];
        const make = (kind, params) => kind === 'image' ? q.soft(params) : q.layer(kind, q.m.PRESETS.find(p => p.kind === kind).id, params);
        // The two kinds with the most over-range light are also held at other phases.
        const jobs = kinds.flatMap(kind => (['sculpture', 'livingink'].includes(kind) ? [0, .9, 2.5, 5] : [.9]).map(phase => ({ kind, phase })));
        for (const { kind, phase } of jobs) for (const transparent of [false, true]) {
          const a = await q.px(q.project([make(kind, {})], transparent), phase), b = await q.px(q.project([make(kind, { splitAmount: .001 })], transparent), phase);
          let sum = 0, worst = 0, at = 0;
          for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > worst) { worst = d; at = i; } }
          const i = at - at % 4;
          rows.push({ kind, phase, transparent, mean: sum / a.length, worst, x: (i / 4) % 960, y: Math.floor(i / 4 / 960), channel: 'RGBA'[at % 4], plain: [...a.subarray(i, i + 4)], split: [...b.subarray(i, i + 4)] });
        }
        return rows;
      });
      const bad = rows.filter(r => r.mean >= 1 || r.worst >= 4);
      const top = rows.reduce((a, b) => b.worst > a.worst ? b : a), high = rows.reduce((a, b) => b.mean > a.mean ? b : a);
      const name = r => `${r.kind}@${r.phase}${r.transparent ? '/transparent' : ''}`;
      const cause = r => `${name(r)} mean ${r.mean.toFixed(3)} worst ${r.worst} at (${r.x},${r.y}) ${r.channel} plain ${r.plain} split ${r.split}`;
      return { ok: bad.length === 0, detail: bad.length ? `${bad.length}/${rows.length} over limit: ${bad.map(cause).join(' | ')}` : `${rows.length} renders; highest mean ${high.mean.toFixed(3)} (${name(high)}), worst ${top.worst} (${name(top)}) (limits 1 and 4)` };
    },
  },
  {
    name: 'split-tile',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct;
        const tiled = params => { const p = q.project([q.layer('surface', null, params)]); p.tileEdges = true; return p; };
        const plain = await q.px(tiled({})), W = 960, H = 540, rows = [];
        for (let shape = 0; shape < 4; shape++) {
          const px = await q.px(tiled({ splitAmount: 12, splitSamples: 9, splitShape: shape, splitThreshold: .02 }));
          const columns = (a, b) => { let sum = 0; for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) sum += Math.abs(px[(y * W + a) * 4 + c] - px[(y * W + b) * 4 + c]); return sum / (H * 3); };
          // Eight interior pairs, so one busy column cannot set the limit.
          let interior = 0; for (let k = 1; k <= 8; k++) { const x = Math.round(k * W / 9); interior += columns(x, x + 1); }
          rows.push({ seam: columns(W - 1, 0), interior: interior / 8, moved: q.difference(plain, px) });
        }
        return rows;
      });
      const none = r.some(row => row.moved === 0) ? 'Split has no effect on the render. ' : '';
      const text = r.map((row, i) => `${SHAPES[i]} seam ${row.seam.toFixed(3)} interior ${row.interior.toFixed(3)} moved ${row.moved.toFixed(3)}`).join('; ');
      return { ok: r.every(row => row.moved > 0 && row.seam <= row.interior * 1.25), detail: `${none}${text} (limit 1.25x)` };
    },
  },
  {
    name: 'split-loop',
    // Travel 1.5 is deliberately not whole: the renderer must round it, or the seam opens.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, p = q.project([q.soft({ splitAmount: 32, splitShape: 3, splitSamples: 9, splitTravel: 1.5 })], true);
        const plain = await q.shot(q.project([q.soft()], true), 0);
        return { ...await q.loop(p), moved: !q.same(await q.shot(p, 0), plain) };
      });
      const loop = loopVerdict(r);
      return { ok: r.moved && loop.ok, detail: `${r.moved ? '' : 'Split has no effect on the render. '}${loop.detail}` };
    },
  },
  {
    name: 'split-order',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => q.project([q.layer('surface', null, params)]);
        const plain = await q.px(scene({})), bgr = await q.px(scene({ splitOrder: 5 }));
        let error = 0; for (let i = 0; i < plain.length; i += 4) error += Math.abs(bgr[i] - plain[i + 2]) + Math.abs(bgr[i + 2] - plain[i]);
        return { error: error / (plain.length / 2), moved: q.difference(plain, bgr) };
      });
      return { ok: r.moved > 0 && r.error === 0, detail: `BGR swaps red and blue with mean error ${r.error.toFixed(3)} (must be 0), moved ${r.moved.toFixed(3)}` };
    },
  },
  {
    name: 'split-blocks',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => q.project([q.layer('surface', null, params)]), blocks = chance => scene({ splitOrder: 5, splitBlocks: 8, splitChance: chance });
        const plain = await q.px(scene({})), bgr = await q.px(scene({ splitOrder: 5 }));
        const none = await q.px(blocks(0)), all = await q.px(blocks(1)), half = await q.px(blocks(.5));
        let kept = 0;
        for (let i = 0; i < plain.length; i += 4) if (Math.abs(half[i] - plain[i]) + Math.abs(half[i + 2] - plain[i + 2]) <= Math.abs(half[i] - bgr[i]) + Math.abs(half[i + 2] - bgr[i + 2])) kept++;
        return { chance0: q.difference(none, plain), chance1: q.difference(all, bgr), kept: kept / (plain.length / 4) };
      });
      return { ok: r.chance0 === 0 && r.chance1 === 0 && r.kept > .3 && r.kept < .7, detail: `chance 0 differs from plain by ${r.chance0.toFixed(3)}, chance 1 from full swap by ${r.chance1.toFixed(3)} (both must be 0); chance .5 keeps ${(r.kept * 100).toFixed(1)}% (limit 30-70%)` };
    },
  },
  {
    name: 'split-graphic',
    run: async ({ page }) => {
      const same = await page.evaluate(async () => {
        const q = window.ct, id = q.m.PRESETS.find(p => p.kind === 'graphic').id;
        return q.same(await q.shot(q.project([q.layer('graphic', id)])), await q.shot(q.project([q.layer('graphic', id, { splitAmount: 32, splitOrder: 3 })])));
      });
      return { ok: same, detail: same ? 'a graphic layer ignores Split and order byte for byte' : 'a graphic layer responds to Split' };
    },
  },
  {
    name: 'gradient-map',
    // A black-to-white ramp through Neon: the dark end is the first stop, the bright end the last.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, p = q.project([q.ramp({ gradMix: 1, gradPalette: 1 })]); p.highlights = 'exact';
        const px = await q.px(p), at = (x, y) => [...px.subarray((y * 960 + x) * 4, (y * 960 + x) * 4 + 3)];
        return { dark: at(0, 270), bright: at(959, 270) };
      });
      const dark = [13, 0, 51], bright = [255, 230, 77];
      const miss = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      const a = miss(r.dark, dark), b = miss(r.bright, bright);
      return { ok: a <= 3 && b <= 3, detail: `dark end ${r.dark} (want #0d0033, off by ${a}), bright end ${r.bright} (want #ffe64d, off by ${b}) (limit 3)` };
    },
  },
  {
    name: 'gradient-alpha',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => q.project([q.soft(params)], true);
        const plain = await q.px(scene({})), mapped = await q.px(scene({ gradMix: 1, gradPalette: 1 }));
        let worst = 0; for (let i = 3; i < plain.length; i += 4) worst = Math.max(worst, Math.abs(plain[i] - mapped[i]));
        return { worst, moved: q.difference(plain, mapped) };
      });
      return { ok: r.moved > 0 && r.worst <= 1, detail: `${r.moved > 0 ? '' : 'Gradient Map has no effect on the render. '}alpha differs from the unmapped layer by at most ${r.worst} (limit 1)` };
    },
  },
  {
    name: 'gradient-loop',
    // Cycles 1.5 is deliberately not whole: the renderer must round it, or the seam opens.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = cycles => q.project([q.ramp({ gradMix: 1, gradPalette: 1, gradCycles: cycles, gradOffset: .2 })], true);
        const plain = await q.shot(q.project([q.ramp()], true), 0);
        return { whole: await q.loop(scene(3)), rounded: await q.loop(scene(1.5)), moved: !q.same(await q.shot(scene(3), 0), plain) };
      });
      const whole = loopVerdict(r.whole), rounded = loopVerdict(r.rounded);
      return { ok: r.moved && whole.ok && rounded.ok, detail: `${r.moved ? '' : 'Gradient Map has no effect on the render. '}cycles 3: ${whole.detail}; cycles 1.5: ${rounded.detail}` };
    },
  },
  {
    name: 'gradient-engage',
    // A barely-on map must look like the plain layer.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => q.project([q.soft(params)]);
        const a = await q.px(scene({})), b = await q.px(scene({ gradMix: .001, gradPalette: 1 })), full = await q.px(scene({ gradMix: 1, gradPalette: 1 }));
        let sum = 0, worst = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; worst = Math.max(worst, d); }
        return { mean: sum / a.length, worst, moved: q.difference(a, full) };
      });
      return { ok: r.moved > 0 && r.mean < 1 && r.worst < 4, detail: `${r.moved > 0 ? '' : 'Gradient Map has no effect on the render. '}mean ${r.mean.toFixed(3)}, worst ${r.worst} (limits 1 and 4)` };
    },
  },
  {
    name: 'gradient-echo',
    // The map colours the output once. If it entered the echo history it would compound.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, total = Math.round(q.m.createProject().duration * q.m.createProject().fps.num / q.m.createProject().fps.den);
        const phase = frame => frame * Math.PI * 2 / total;
        const scene = mix => { const p = q.project([q.ramp({ echo: .9, echoZoom: .96, echoDriftX: .01, gradMix: mix, gradPalette: 1 })], true); p.highlights = 'exact'; return p; };
        const first = await q.px(scene(1), phase(60));
        await q.px(scene(1), phase(90)); await q.px(scene(1), phase(10));
        const second = await q.px(scene(1), phase(60));
        const plain = await q.px(scene(0), phase(60));
        const decode = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
        const encode = v => 255 * (v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - .055);
        const stops = q.gradientStops(1, []).map(h => [1, 3, 5].map(i => decode(parseInt(h.slice(i, i + 2), 16))));
        const copy = new Uint8ClampedArray(plain.length);
        let judged = 0;
        for (let i = 0; i < plain.length; i += 4) {
          copy[i + 3] = plain[i + 3];
          // Pixels at least half covered, where straight colour is well resolved in 8 bits.
          if (plain[i + 3] < 128) { copy.set(first.subarray(i, i + 3), i); continue; }
          judged++;
          const c = [0, 1, 2].map(k => decode(plain[i + k])), luma = .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
          const t = q.gradientTone(luma, .5) * (stops.length - 1), seg = Math.min(stops.length - 2, Math.floor(t)), f = t - seg, s = f * f * (3 - 2 * f);
          for (let k = 0; k < 3; k++) copy[i + k] = Math.round(encode((stops[seg][k] * (1 - s) + stops[seg + 1][k] * s) * Math.max(luma, 1)));
        }
        let worst = 0, sum = 0; for (let i = 0; i < copy.length; i++) { const d = Math.abs(copy[i] - first[i]); worst = Math.max(worst, d); sum += d; }
        return { judged, identical: q.same(first, second), worst, mean: sum / copy.length, moved: q.difference(plain, first) };
      });
      return { ok: r.identical && r.moved > 0 && r.judged > 1000 && r.worst <= 4, detail: `${r.moved > 0 ? '' : 'Gradient Map has no effect on the render. '}two seek orders ${r.identical ? 'byte-identical' : 'differ'}; against a CPU map of the unmapped layer: worst ${r.worst}, mean ${r.mean.toFixed(3)} over ${r.judged} pixels at least half covered (limit 4)` };
    },
  },
  {
    name: 'glow-neutral',
    // The existing Glow, spread and streak at zero, must match the older checkout byte for byte.
    // Spread must also change a render, so the check cannot pass on a Glow that ignores it.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      const r = await page.evaluate(async () => {
        const q = window.ct, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [];
        const glow = { glowMix: .8, glowThreshold: .1, glowSize: .6 };
        const jobs = [['soft', () => q.project([q.soft(glow)], true)], ['surface', () => q.project([q.layer('surface', null, glow)])],
          ['sculpture', () => q.project([q.layer('sculpture', q.m.PRESETS.find(p => p.kind === 'sculpture').id, glow)])]];
        for (const [name, make] of jobs) {
          const now = make(), then = JSON.parse(JSON.stringify(now));
          await q.renderer.prepare(now); await before.prepare(then);
          if (!q.same(await q.renderer.exportPNG(now, .9, 960, 540), await before.exportPNG(then, .9, 960, 540))) changed.push(name);
        }
        before.dispose();
        const plain = await q.px(q.project([q.soft(glow)], true)), spread = await q.px(q.project([q.soft({ ...glow, glowSpread: 1 })], true));
        return { jobs: jobs.length, changed, spread: q.difference(plain, spread) };
      });
      return { ok: r.changed.length === 0 && r.spread > 0, detail: `${r.spread > 0 ? '' : 'Colour spread has no effect on the render. '}${r.changed.length ? `changed: ${r.changed.join(', ')}` : `${r.jobs} glows byte-identical`}; spread 1 moves the render by ${r.spread.toFixed(3)}` };
    },
  },
  {
    name: 'streak-scale',
    // Both shapes, along and across the frame, at 960 and 1920 wide.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, glow = { glowMix: .6, glowThreshold: .1, glowSize: .3 }, rows = [];
        const scene = params => q.project([q.soft({ ...glow, ...params })], true);
        const plain = await q.px(scene({}));
        for (const [name, params] of [['soft', { glowStreak: 1.5 }], ['cross 30deg', { glowStreak: 1.5, glowStreakShape: 1, glowStreakAngle: 30 }]]) {
          const small = await q.px(scene(params)), big = await q.px(scene(params), .9, 1920, 1080);
          const reduced = new Uint8ClampedArray(small.length);
          for (let y = 0; y < 540; y++) for (let x = 0; x < 960; x++) for (let c = 0; c < 4; c++) {
            const at = (X, Y) => big[(Y * 1920 + X) * 4 + c];
            reduced[(y * 960 + x) * 4 + c] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
          }
          rows.push({ name, difference: q.difference(small, reduced), moved: q.difference(plain, small) });
        }
        return rows;
      });
      const none = r.some(row => row.moved < .05) ? 'Streak has no visible effect on the render. ' : '';
      return { ok: r.every(row => row.moved >= .05 && row.difference < 2), detail: `${none}${r.map(row => `${row.name} scale difference ${row.difference.toFixed(3)} moved ${row.moved.toFixed(3)}`).join('; ')} (limit 2, moved at least 0.05)` };
    },
  },
  {
    name: 'streak-tile',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, W = 960, H = 540, rows = [];
        const tiled = params => { const p = q.project([q.layer('surface', null, { glowMix: .6, glowThreshold: .02, glowSize: .3, ...params })]); p.tileEdges = true; return p; };
        const plain = await q.px(tiled({}));
        for (const [name, params] of [['soft', { glowStreak: 1.5 }], ['cross', { glowStreak: 1.5, glowStreakShape: 1, glowStreakAngle: 20 }]]) {
          const px = await q.px(tiled(params));
          const columns = (a, b) => { let sum = 0; for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) sum += Math.abs(px[(y * W + a) * 4 + c] - px[(y * W + b) * 4 + c]); return sum / (H * 3); };
          let interior = 0; for (let k = 1; k <= 8; k++) { const x = Math.round(k * W / 9); interior += columns(x, x + 1); }
          rows.push({ name, seam: columns(W - 1, 0), interior: interior / 8, moved: q.difference(plain, px) });
        }
        return rows;
      });
      const none = r.some(row => row.moved < .05) ? 'Streak has no visible effect on the render. ' : '';
      return { ok: r.every(row => row.moved >= .05 && row.seam <= row.interior * 1.25), detail: `${none}${r.map(row => `${row.name} seam ${row.seam.toFixed(3)} interior ${row.interior.toFixed(3)} moved ${row.moved.toFixed(3)}`).join('; ')} (limit 1.25x, moved at least 0.05)` };
    },
  },
  {
    name: 'streak-engage',
    // A barely-on Glow must not leave a full-strength streak behind.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = glowMix => q.project([q.soft({ glowStreak: 1, glowMix, glowThreshold: .1, glowSize: .3 })]);
        const a = await q.px(scene(0)), b = await q.px(scene(.001)), full = await q.px(scene(1));
        let sum = 0, worst = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; worst = Math.max(worst, d); }
        return { mean: sum / a.length, worst, moved: q.difference(a, full) };
      });
      return { ok: r.moved >= .05 && r.mean < 1 && r.worst < 4, detail: `${r.moved >= .05 ? '' : 'Streak has no visible effect on the render. '}glow .001 against plain: mean ${r.mean.toFixed(3)}, worst ${r.worst} (limits 1 and 4); glow 1 moves it by ${r.moved.toFixed(3)}` };
    },
  },
  {
    name: 'grade-grey',
    // Grey ignores a channel swap, so Channel order 1 runs the lens pass without changing it.
    // Every grade and key control is moved off its default except the amounts, so a tint or
    // key that leaks in at zero strength would show.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => { const p = q.project([q.grey(params)]); p.highlights = 'exact'; return p; };
        const plain = await q.px(scene({})), zero = await q.px(scene({ splitOrder: 1, gradeShadowColour: 3, gradeHighlightColour: 5, keyMode: 1, keyLow: .6, keyHigh: .7, keyInvert: 1 }));
        let worst = 0; for (let i = 0; i < plain.length; i++) worst = Math.max(worst, Math.abs(plain[i] - zero[i]));
        // A control that cannot move the render would make this check meaningless.
        const warm = await q.px(scene({ splitOrder: 1, gradeTint: .5 }));
        return { worst, moved: q.difference(plain, warm) };
      });
      return { ok: r.worst <= 1 && r.moved > 0, detail: `${r.moved > 0 ? '' : 'Tint has no effect on the render. '}zero tints and a closed key differ from the plain grey by at most ${r.worst} (limit 1)` };
    },
  },
  {
    name: 'grade-temperature',
    // Warmer: red up, blue down. Brightness is compared in linear light and brought back to 8 bits.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => { const p = q.project([q.grey(params)]); p.highlights = 'exact'; return p; };
        const decode = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
        const encode = v => 255 * (v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - .055);
        const at = async params => { const px = await q.px(scene(params)), i = (270 * 960 + 480) * 4; return [...px.subarray(i, i + 3)]; };
        const luma = c => encode(.2126 * decode(c[0]) + .7152 * decode(c[1]) + .0722 * decode(c[2]));
        const plain = await at({}), warm = await at({ gradeTemperature: .6 }), cool = await at({ gradeTemperature: -.6 });
        // Tint moves the heavily weighted green channel, so it shows a brightness error that temperature alone would hide.
        const magenta = await at({ gradeTint: 1 }), green = await at({ gradeTint: -1 });
        return { plain, warm, cool, dWarm: Math.abs(luma(warm) - luma(plain)), dCool: Math.abs(luma(cool) - luma(plain)), magenta, green, dMagenta: Math.abs(luma(magenta) - luma(plain)), dGreen: Math.abs(luma(green) - luma(plain)) };
      });
      const ok = r.warm[0] > r.warm[2] + 10 && r.cool[2] > r.cool[0] + 10 && r.dWarm <= 2 && r.dCool <= 2 &&
        r.magenta[1] < r.magenta[0] - 5 && r.green[1] > r.green[0] + 5 && r.dMagenta <= 2 && r.dGreen <= 2;
      return { ok, detail: `plain ${r.plain}, warm ${r.warm} (red must lead blue), cool ${r.cool} (blue must lead red); tint +1 ${r.magenta} and -1 ${r.green} (green must fall, then rise); luma change ${r.dWarm.toFixed(2)}, ${r.dCool.toFixed(2)}, ${r.dMagenta.toFixed(2)}, ${r.dGreen.toFixed(2)} (limit 2/255)` };
    },
  },
  {
    name: 'grade-tone',
    // On a ramp the shadow tint takes the dark end and the highlight tint the bright end.
    // Shadow colour 1 and highlight colour 2 are the layer's cyan and green swatches.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => { const p = q.project([q.ramp(params)]); p.highlights = 'exact'; return p; };
        const at = (px, x) => [...px.subarray((270 * 960 + x) * 4, (270 * 960 + x) * 4 + 3)];
        const plain = await q.px(scene({})), shadow = await q.px(scene({ gradeShadowTint: 1 })), highlight = await q.px(scene({ gradeHighlightTint: 1 }));
        const gap = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
        return { dark: at(shadow, 96), darkPlain: at(plain, 96), brightOfShadow: gap(at(shadow, 940), at(plain, 940)),
          bright: at(highlight, 864), darkOfHighlight: gap(at(highlight, 96), at(plain, 96)) };
      });
      const ok = r.dark[2] > r.dark[0] + 15 && r.bright[1] > r.bright[0] + 15 && r.bright[1] > r.bright[2] + 15 && r.brightOfShadow <= 2 && r.darkOfHighlight <= 2;
      return { ok, detail: `dark end with shadow tint ${r.dark} (plain ${r.darkPlain}; blue must lead red), bright end with highlight tint ${r.bright} (green must lead); the other end moves by ${r.brightOfShadow} and ${r.darkOfHighlight} (limit 2)` };
    },
  },
  {
    name: 'grade-engage',
    // A barely-on grade must look like the plain layer, and a full one must change it.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => q.project([q.soft(params)]);
        const a = await q.px(scene({})), b = await q.px(scene({ gradeTemperature: .001, gradeTint: .001, gradeShadowTint: .001, gradeHighlightTint: .001 }));
        const full = await q.px(scene({ gradeTemperature: 1, gradeTint: 1, gradeShadowTint: 1, gradeHighlightTint: 1 }));
        let sum = 0, worst = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; worst = Math.max(worst, d); }
        return { mean: sum / a.length, worst, moved: q.difference(a, full) };
      });
      return { ok: r.moved >= 1 && r.mean < 1 && r.worst < 4, detail: `${r.moved >= 1 ? '' : 'Grading has no visible effect on the render. '}amount .001 against plain: mean ${r.mean.toFixed(3)}, worst ${r.worst} (limits 1 and 4); amount 1 moves it by ${r.moved.toFixed(3)}` };
    },
  },
  {
    name: 'key-alpha',
    // A ramp keyed at .5: clear below, untouched above, and across the soft edge the straight colour
    // stays the plain colour, which a key that only changed coverage would brighten.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => { const p = q.project([q.ramp(params)], true); p.highlights = 'exact'; return p; };
        const plain = await q.px(scene({})), keyed = await q.px(scene({ keyMix: 1, keyLow: .5, keyHigh: 1, keySoftness: .1 }));
        const y = 270 * 960 * 4; let below = 0, above = 0, fringe = 0, feathered = 0;
        for (let x = 0; x < 960; x++) {
          const i = y + x * 4, v = x / 960;
          if (v < .42) below = Math.max(below, keyed[i + 3]);
          else if (v > .58) for (let c = 0; c < 4; c++) above = Math.max(above, Math.abs(keyed[i + c] - plain[i + c]));
          else if (keyed[i + 3] >= 128) for (let c = 0; c < 3; c++) fringe = Math.max(fringe, Math.abs(keyed[i + c] - plain[i + c]));
          if (keyed[i + 3] > 20 && keyed[i + 3] < 235) feathered++;
        }
        return { below, above, fringe, feathered };
      });
      return { ok: r.below <= 2 && r.above <= 2 && r.fringe <= 3 && r.feathered > 10, detail: `${r.feathered > 10 ? '' : 'The key has no soft edge. '}alpha below the key at most ${r.below} (limit 2); above it differs from plain by at most ${r.above} (limit 2); straight colour in the soft edge differs from plain by at most ${r.fringe} (limit 3); ${r.feathered} feathered columns` };
    },
  },
  {
    name: 'key-hue',
    // Seven bars: red, green, blue, yellow, cyan, magenta, grey. Only green survives a green key.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => { const p = q.project([q.bars(params)], true); p.highlights = 'exact'; return p; };
        const plain = await q.px(scene({})), keyed = await q.px(scene({ keyMix: 1, keyMode: 1, keyHue: 120, keyHueRange: 40 }));
        const bar = k => (270 * 960 + Math.round((k + .5) * 960 / 7)) * 4;
        const alpha = [0, 1, 2, 3, 4, 5, 6].map(k => keyed[bar(k) + 3]);
        let colour = 0; for (let c = 0; c < 3; c++) colour = Math.max(colour, Math.abs(keyed[bar(1) + c] - plain[bar(1) + c]));
        return { alpha, colour };
      });
      const ok = r.alpha[1] >= 253 && r.alpha.filter((_, k) => k !== 1).every(a => a <= 2) && r.colour <= 2;
      return { ok, detail: `bar alpha (red, green, blue, yellow, cyan, magenta, grey) ${r.alpha}: only green may stay opaque; its colour differs from plain by ${r.colour} (limit 2)` };
    },
  },
  {
    name: 'key-engage',
    // A barely-on key must look like the plain layer, and a full one must change it.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, scene = params => q.project([q.soft(params)]);
        const a = await q.px(scene({})), b = await q.px(scene({ keyMix: .001, keyLow: .5 })), full = await q.px(scene({ keyMix: 1, keyLow: .5 }));
        let sum = 0, worst = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; worst = Math.max(worst, d); }
        return { mean: sum / a.length, worst, moved: q.difference(a, full) };
      });
      return { ok: r.moved >= 1 && r.mean < 1 && r.worst < 4, detail: `${r.moved >= 1 ? '' : 'Key has no visible effect on the render. '}amount .001 against plain: mean ${r.mean.toFixed(3)}, worst ${r.worst} (limits 1 and 4); amount 1 moves it by ${r.moved.toFixed(3)}` };
    },
  },
  {
    name: 'time-neutral',
    // The three existing time looks, on a moving layer, against the older checkout.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      const r = await page.evaluate(async () => {
        const q = window.ct, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [];
        const looks = { terraces: { slitShift: 1, slitSpan: 60, slitShape: 0, slitSlices: 9 }, blocks: { slitShift: 1, slitSpan: 90, slitShape: 4, slitSlices: 8, slitBlocks: 5 }, rings: { slitShift: 1, slitSpan: 60, slitShape: 2, slitSlices: 16, slitSmooth: 1, slitScroll: 1 } };
        const plain = await q.px(q.project([q.layer('surface')]));
        let moved = Infinity;
        for (const [name, params] of Object.entries(looks)) {
          const make = m => { const l = m.createLayer('surface'); Object.assign(l.params, params); l.id = 'surface-proof'; const p = m.createProject(); p.id = 'colour-proof'; p.layers = [l]; p.background = '#000000'; return p; };
          const now = make(q.m), then = make(q.old);
          await q.renderer.prepare(now); await before.prepare(then);
          const a = await q.renderer.exportPNG(now, .9, 960, 540), b = await before.exportPNG(then, .9, 960, 540);
          if (!q.same(a, b)) changed.push(name);
          moved = Math.min(moved, q.difference(plain, await q.pixels(a)));
        }
        before.dispose();
        return { changed, moved };
      });
      return { ok: !r.changed.length && r.moved > 0, detail: `${r.changed.length ? `changed: ${r.changed.join(', ')}` : '3 time looks byte-identical'}; smallest change from the plain layer ${r.moved.toFixed(3)}` };
    },
  },
  {
    name: 'time-looks',
    // The five Task 10 looks, applied as the library applies them, on a Surface layer: each must differ visibly from the plain layer.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, plain = await q.px(q.project([q.layer('surface')]), .9), rows = [];
        for (const id of ['finish-time-vortex', 'finish-ghost-median', 'finish-long-exposure', 'finish-premonition', 'finish-brightness-time']) {
          const l = q.m.applyFinish(q.m.createLayer('surface'), id);
          rows.push({ id, moved: q.difference(plain, await q.px(q.project([l]), .9)) });
        }
        return rows;
      });
      return { ok: r.every(x => x.moved > .01), detail: r.map(x => `${x.id.slice(7)} ${x.moved.toFixed(3)}`).join(', ') + ' (mean difference from the plain layer, limit 0.01)' };
    },
  },
  {
    name: 'time-brightness',
    // Black and white plateaus joined by ramps, moving half a period between the two phases.
    // Where the frame is white now it must show now; where it is black, the full delay.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, P = Math.PI / 2, Q = 0;
        const scene = params => { const p = q.project([q.stripes(params)]); p.highlights = 'exact'; return p; };
        const look = { slitShift: 1, slitSpan: 75, slitSlices: 12 };
        const now = await q.px(scene({}), P), then = await q.px(scene({}), Q);
        const rows = await q.px(scene({ ...look, slitShape: 0 }), P), mapped = await q.px(scene({ ...look, slitShape: 5 }), P);
        const y = 270 * 960 * 4, at = (px, x) => px[y + x * 4];
        const flat = (x, test) => { for (let k = -6; k <= 6; k++) if (!test(at(now, x + k))) return false; return true; };
        let bright = 0, dark = 0, brightError = 0, darkError = 0, otherPhase = 0;
        for (let x = 200; x < 760; x++) {
          if (flat(x, v => v >= 253)) { bright++; brightError = Math.max(brightError, Math.abs(at(mapped, x) - at(now, x))); }
          else if (flat(x, v => v <= 2)) { dark++; darkError = Math.max(darkError, Math.abs(at(mapped, x) - at(then, x))); if (at(then, x) >= 253) otherPhase++; }
        }
        return { fromRows: q.difference(rows, mapped), bright, dark, brightError, darkError, otherPhase };
      });
      const ok = r.fromRows > 1 && r.bright > 50 && r.dark > 50 && r.otherPhase > 50 && r.brightError <= 2 && r.darkError <= 2;
      return { ok, detail: `differs from Rows by ${r.fromRows.toFixed(3)}; ${r.bright} bright pixels off the current phase by ${r.brightError}, ${r.dark} dark pixels off the full delay by ${r.darkError} (limit 2); ${r.otherPhase} dark pixels show a bright earlier phase` };
    },
  },
  {
    name: 'time-bands',
    // Every band must show exactly one of the two delays, and neighbours the other one.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, P = Math.PI / 2, Q = 0;
        const scene = params => { const p = q.project([q.stripes(params)]); p.highlights = 'exact'; return p; };
        const now = await q.px(scene({}), P), then = await q.px(scene({}), Q);
        const out = await q.px(scene({ slitShift: 1, slitSpan: 75, slitSlices: 12, slitShape: 6, slitBlocks: 8 }), P);
        const off = (a, y) => { let sum = 0; for (let x = 200; x < 760; x++) sum += Math.abs(out[(y * 960 + x) * 4] - a[(y * 960 + x) * 4]); return sum / 560; };
        return Array.from({ length: 8 }, (_, k) => { const y = Math.round((k + .5) * 540 / 8); return { now: off(now, y), then: off(then, y) }; });
      });
      const states = r.map(b => b.now <= 1 && b.then > 20 ? 'N' : b.then <= 1 && b.now > 20 ? 'D' : '?');
      const ok = !states.includes('?') && states.every((s, i) => !i || s !== states[i - 1]);
      return { ok, detail: `bands ${states.join('')} (N now, D full delay, must alternate); largest error ${Math.max(...r.map(b => Math.min(b.now, b.then))).toFixed(3)} (limit 1)` };
    },
  },
  {
    name: 'time-vortex',
    // Map scroll is in the look so the seam comparison also covers the sweeping map.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, look = { slitShift: 1, slitSpan: 60, slitShape: 2, slitSlices: 16, slitSmooth: 1, slitScroll: 1 };
        const scene = params => q.project([q.layer('surface', null, { ...look, ...params })]);
        return { moved: q.difference(await q.px(scene({})), await q.px(scene({ slitTwist: .5 }))), loop: await q.loop(scene({ slitTwist: .5 })) };
      });
      const loop = loopVerdict(r.loop);
      return { ok: r.moved > 1 && loop.ok, detail: `Twist .5 moves Rings by ${r.moved.toFixed(3)} (at least 1); ${loop.detail}` };
    },
  },
  {
    name: 'time-future',
    // Future at P is the same set of moments as Past at P + S with the map reversed.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, P = .9, S = 40, total = 300, look = { slitSpan: S, slitShape: 4, slitBlocks: 6, slitSlices: 12, slitSmooth: 0 };
        const scene = params => q.project([q.layer('surface', null, { ...look, ...params })]);
        const future = await q.px(scene({ slitShift: 1, slitDirection: 1 }), P);
        const past = await q.px(scene({ slitShift: -1 }), P + Math.PI * 2 * S / total);
        const forward = await q.px(scene({ slitShift: 1 }), P);
        let worst = 0, over = 0; for (let i = 0; i < future.length; i++) { const d = Math.abs(future[i] - past[i]); worst = Math.max(worst, d); if (d > 1) over++; }
        return { worst, over, fromPast: q.difference(future, forward), loop: await q.loop(scene({ slitShift: 1, slitDirection: 1 })) };
      });
      const loop = loopVerdict(r.loop);
      return { ok: r.worst <= 1 && r.fromPast > 1 && loop.ok, detail: `Future against reversed Past: worst ${r.worst}, ${r.over} values over 1 (limit 1); Future differs from Past at the same phase by ${r.fromPast.toFixed(3)}; ${loop.detail}` };
    },
  },
  {
    name: 'time-seek',
    // Every new input at once, so a leftover driver or colour bound would show.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, phase = f => f * Math.PI * 2 / 300;
        const p = q.project([q.layer('surface', null, { slitShift: 1, slitSpan: 40, slitShape: 5, slitSlices: 6, slitTwist: .4, slitZoom: .2, slitChroma: .6 })]);
        const direct = await q.shot(p, phase(40));
        let last; for (let f = 0; f <= 40; f++) last = await q.shot(p, phase(f));
        return { same: q.same(direct, last), moved: q.difference(await q.pixels(direct), await q.px(q.project([q.layer('surface')]), phase(40))) };
      });
      return { ok: r.same && r.moved > 1, detail: `frame 40 directly and after frames 0 to 40 ${r.same ? 'byte-identical' : 'differ'}; look moves the plain layer by ${r.moved.toFixed(3)}` };
    },
  },
  {
    name: 'time-engage',
    // At .001 the mean and worst limits are held on a smooth moving layer, because a sub-pixel
    // move of a hard edge changes that pixel a lot however correct the warp is.
    // At 1e-6 (Twist 1e-7), on every preset of every kind that takes Time displacement:
    // - The time pass's own output may not change any linear value by more than 1/255, or by
    //   two half-float steps for over-range light, which cannot store a finer difference.
    // - Colour lag and Zoom may not change a finished 8-bit value by more than 1. Two stages
    //   after the pass turn any non-zero change into a hard flip, so layers using them are
    //   held to the first limit only: Flat colour snaps to a band, and Feedback compounds it.
    //   Twist is also held to the first limit, at 1e-7: at 1e-6 it still moves the corners
    //   .0035 pixels, a real displacement that sharp edges and the sRGB curve near black enlarge.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, R = q.renderer, rings = { slitShift: 1, slitSpan: 60, slitShape: 2, slitSlices: 12 };
        const presets = q.m.PRESETS.filter(p => q.m.supportsSlitScan(q.layer(p.kind, p.id)));
        const sources = [['wave', false, params => q.wave(params)], ['soft', true, params => q.soft(params)],
          ...presets.map(p => [`${p.kind}/${p.id}`, false, params => q.layer(p.kind, p.id, params)])];
        const half = v => { const e = (v >> 10) & 31, f = v & 1023, s = v >> 15 ? -1 : 1; return e === 31 ? (f ? NaN : s * Infinity) : e === 0 ? s * f / 1024 / 16384 : s * (1 + f / 1024) * 2 ** (e - 15); };
        const pass = () => { const rt = R.slitTargets[0], d = new Uint16Array(rt.width * rt.height * 4); R.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, d); return Float32Array.from(d, half); };
        // Measured in units of the limit: 1/255, or two half-float steps where light is so far
        // over range that the target cannot store a finer difference.
        const passChange = (a, b) => { let most = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]), v = Math.max(Math.abs(a[i]), Math.abs(b[i])), step = v > 0 ? 2 ** (Math.floor(Math.log2(v)) - 10) : 0; most = Number.isNaN(d) ? Infinity : Math.max(most, d / Math.max(1 / 255, 2 * step)); } return most; };
        const compare = (a, b) => {
          let sum = 0, worst = 0, pixels = 0;
          for (let i = 0; i < a.length; i += 4) { let most = 0; for (let k = 0; k < 4; k++) { const d = Math.abs(a[i + k] - b[i + k]); sum += d; most = Math.max(most, d); } worst = Math.max(worst, most); if (most > 1) pixels++; }
          return { mean: sum / a.length, worst, pixels };
        };
        const rows = [];
        for (const [name, transparent, make] of sources) {
          const render = params => q.px(q.project([make({ ...rings, ...params })], transparent));
          const base = await render({}), basePass = pass(), l = make({});
          const amplified = (l.params.toonMix ?? 0) > 0 || q.m.feedbackActive(l);
          for (const [key, large] of [['slitTwist', .5], ['slitZoom', .5], ['slitChroma', 1]]) {
            const out = await render({ [key]: key === 'slitTwist' ? 1e-7 : 1e-6 });
            const row = { name, key, amplified, passChange: passChange(basePass, pass()), tiny: compare(base, out) };
            if (name === 'wave') { row.small = compare(base, await render({ [key]: .001 })); row.moved = q.difference(base, await render({ [key]: large })); }
            rows.push(row);
          }
        }
        return rows;
      });
      const within = c => c.mean < 1 && c.worst < 4;
      const finished = row => row.key !== 'slitTwist' && !row.amplified;
      const failed = row => row.passChange > 1 || (finished(row) && row.tiny.pixels > 0) || (row.name === 'wave' && (!within(row.small) || row.moved < 1));
      const bad = r.filter(failed);
      const figure = c => `mean ${c.mean.toFixed(3)} worst ${c.worst}`;
      const wave = r.filter(row => row.name === 'wave').map(row => `${row.key} ${figure(row.small)} moved ${row.moved.toFixed(3)}`).join('; ');
      const held = r.filter(finished).length, top = Math.max(...r.map(row => row.passChange));
      const list = bad.slice(0, 10).map(row => `${row.name} ${row.key}: time pass ${row.passChange.toFixed(3)} of limit, ${row.tiny.pixels} finished pixels, worst ${row.tiny.worst}`).join('; ');
      return { ok: !bad.length, detail: `${r.length / 3} sources; smooth layer at .001: ${wave} (limits 1 and 4); at 1e-6 (Twist 1e-7): time pass change at most ${top.toFixed(3)} of its limit (1/255, or two half-float steps for over-range light); ${held} Colour lag and Zoom renders checked to 1/255 after finishing, ${bad.length} failed${list ? ` | ${list}` : ''}` };
    },
  },
  {
    name: 'time-driver',
    // The Brightness driver is half the current slice size in preview and export,
    // exists only once Brightness is used, and is released with the renderer.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
        const R = new q.m.StudioRenderer(canvas), look = { slitShift: 1, slitSpan: 30, slitSlices: 12 };
        const scene = shape => q.project([q.layer('surface', null, { ...look, slitShape: shape })]);
        const rings = scene(2), bright = scene(5);
        await R.prepare(rings); await R.exportPNG(rings, .9, 960, 540);
        const lazy = R.slitDriverTarget === null;
        await R.prepare(bright); R.render(bright, .9, 960, 540);
        const size = t => [t.width, t.height];
        const slice = size(R.sliceSource), previewDriver = size(R.slitDriverTarget);
        await R.exportPNG(bright, .9, 960, 540);
        const exportDriver = size(R.slitDriverTarget), driver = R.slitDriverTarget;
        let disposed = false; driver.addEventListener('dispose', () => { disposed = true; });
        R.dispose();
        return { lazy, slice, previewDriver, exportDriver, disposed, cleared: R.slitDriverTarget === null };
      });
      const half = r.slice.map(v => Math.max(1, Math.round(v / 2)));
      const ok = r.lazy && r.slice[0] < 960 && r.previewDriver.every((v, i) => v === half[i]) && r.exportDriver[0] === 480 && r.exportDriver[1] === 270 && r.disposed && r.cleared;
      return { ok, detail: `unused until Brightness: ${r.lazy}; preview slices ${r.slice.join('x')}, driver ${r.previewDriver.join('x')} (want ${half.join('x')}); export driver ${r.exportDriver.join('x')} (want 480x270); disposed ${r.disposed && r.cleared}` };
    },
  },
  {
    name: 'time-lag-fringe',
    // A soft, moving, single-colour layer: Colour lag must not push straight colour past
    // that colour anywhere, or leave colour where no slice has coverage.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, slide = { kind: 'sine', cycles: 1, phase: 0, amount: 1, points: [], range: { min: -.2, max: .2 } };
        const scene = params => { const l = q.soft({ slitShift: 1, slitSpan: 75, slitShape: 0, slitSlices: 12, slitSmooth: 1, ...params }); l.modulations['transform.x'] = slide; const p = q.project([l], true); p.highlights = 'exact'; return p; };
        const plain = await q.px(scene({})), lag = await q.px(scene({ slitChroma: 1 })), colour = [176, 96, 48];
        let over = 0, worst = 0, leaked = 0, judged = 0;
        for (let i = 0; i < lag.length; i += 4) {
          if (lag[i + 3] === 0 && (lag[i] || lag[i + 1] || lag[i + 2])) leaked++;
          if (lag[i + 3] < 32) continue;
          judged++;
          for (let c = 0; c < 3; c++) { const excess = lag[i + c] - colour[c]; worst = Math.max(worst, excess); if (excess > 3) over++; }
        }
        return { moved: q.difference(plain, lag), over, worst, leaked, judged };
      });
      return { ok: r.moved > 0 && r.judged > 1000 && !r.over && !r.leaked, detail: `Colour lag moves the layer by ${r.moved.toFixed(3)}; ${r.over} values over the layer colour, worst +${r.worst} (limit 3) across ${r.judged} covered pixels; ${r.leaked} colour pixels without coverage` };
    },
  },
  {
    name: 'stats-order',
    // Three frames of hard colour bars moving across the frame. Each mode must match the same
    // three exported frames combined on the CPU: Median, Darkest and Brightest commute with the
    // output curve, and Echo is compared after decoding to linear light.
    run: async ({ page }) => {
      const r = await page.evaluate(async MODES => {
        const q = window.ct, P = .7, span = 60, first = q.project([q.bars()]);
        const total = Math.round(first.duration * first.fps.num / first.fps.den);
        // Scaled up so the bars cover the frame at every slice: full coverage needs no colour bound.
        const scene = params => { const l = q.bars(params); l.transform.scale = 1.8; l.modulations['transform.x'] = q.slide(.2); const p = q.project([l]); p.highlights = 'exact'; return p; };
        const frames = []; for (let i = 0; i < 3; i++) frames.push(await q.px(scene({}), P - Math.PI * 2 * (span * i / 2) / total));
        const decode = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
        const encode = v => 255 * (v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - .055);
        const weights = [1, .5, .25].map(v => v / 1.75);
        const expected = {
          1: v => encode(v.reduce((sum, x, i) => sum + decode(x) * weights[i], 0)),
          2: v => q.m.medianOf(v), 3: v => Math.min(...v), 4: v => Math.max(...v),
        };
        let distinct = 0;
        for (let i = 0; i < frames[0].length; i++) if (i % 4 !== 3 && new Set(frames.map(f => f[i])).size === 3) distinct++;
        const rows = [];
        for (const [name, mode] of MODES) {
          const out = await q.px(scene({ slitShift: 1, slitSpan: span, slitSlices: 3, slitMode: mode, slitDecay: .5 }), P);
          let worst = 0, over = 0;
          for (let i = 0; i < out.length; i++) {
            if (i % 4 === 3) continue;
            const d = Math.abs(out[i] - expected[mode]([frames[0][i], frames[1][i], frames[2][i]]));
            worst = Math.max(worst, d); if (d > 2) over++;
          }
          // Colour reach .4 of three slices: red remembers one, green two, blue all three.
          const reached = await q.px(scene({ slitShift: 1, slitSpan: span, slitSlices: 3, slitMode: mode, slitDecay: .5, slitReach: .4 }), P);
          const partial = (v, n) => {
            const kept = v.slice(0, n);
            if (mode === 1) { const w = [1, .5, .25].slice(0, n), sum = w.reduce((a, b) => a + b); return encode(kept.reduce((t, x, i) => t + decode(x) * w[i] / sum, 0)); }
            if (mode === 2) return n === 2 ? encode((decode(kept[0]) + decode(kept[1])) / 2) : q.m.medianOf(kept);
            return mode === 3 ? Math.min(...kept) : Math.max(...kept);
          };
          let reachWorst = 0, reachOver = 0;
          for (let i = 0; i < reached.length; i++) {
            if (i % 4 === 3) continue;
            const d = Math.abs(reached[i] - partial([frames[0][i], frames[1][i], frames[2][i]], i % 4 + 1));
            reachWorst = Math.max(reachWorst, d); if (d > 2) reachOver++;
          }
          rows.push({ name, worst, over, reachWorst, reachOver, moved: q.difference(frames[0], out) });
        }
        return { distinct, rows };
      }, STAT_MODES);
      const ok = r.distinct > 1000 && r.rows.every(row => row.over === 0 && row.reachOver === 0 && row.moved > 0);
      return { ok, detail: `${r.distinct} values differ across all three frames; ${r.rows.map(row => `${row.name} worst ${row.worst.toFixed(2)}, ${row.over} over, reach .4 worst ${row.reachWorst.toFixed(2)}, ${row.reachOver} over, moved ${row.moved.toFixed(3)}`).join('; ')} (limit 2/255 against the CPU)` };
    },
  },
  {
    name: 'stats-alpha',
    // A soft moving layer with channels that remember different spans. Coverage and colour are
    // judged against the plain frames of every slice, so a fringe has nowhere to hide.
    run: async ({ page }) => {
      const r = await page.evaluate(async MODES => {
        const q = window.ct, P = 1.3, span = 75, slices = 9, first = q.project([q.soft()], true);
        const total = Math.round(first.duration * first.fps.num / first.fps.den);
        // No frame mask: the mask follows the current moment, so a plain frame of an older slice
        // would not show the coverage that slice brings to this one.
        const scene = params => { const l = q.soft(params); l.mask = { ...l.mask, kind: 'none' }; l.modulations['transform.x'] = q.slide(.2); const p = q.project([l], true); p.highlights = 'exact'; return p; };
        const covered = new Uint8Array(960 * 540), faint = new Uint8Array(960 * 540), brightest = [0, 0, 0], R = q.renderer, alphas = [];
        const half = v => { const e = (v >> 10) & 31, f = v & 1023; return e === 0 ? f / 1024 / 16384 : (1 + f / 1024) * 2 ** (e - 15); };
        let alphaMismatch = 0;
        for (let k = 0; k < slices; k++) {
          const at = P - Math.PI * 2 * (span * k / (slices - 1)) / total, frame = scene({}), px = await q.px(frame, at);
          alphas.push(Uint8Array.from({ length: 960 * 540 }, (_, n) => px[n * 4 + 3]));
          for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) { covered[i / 4] = 1; for (let c = 0; c < 3; c++) brightest[c] = Math.max(brightest[c], px[i + c]); }
          // The exact alpha of this slice. A sample at or below .001 is light with no coverage,
          // which the HDR ruling lets through unbounded, so its pixels are counted separately.
          const rt = R.renderOutput(frame, at, 960, 540), exact = new Uint16Array(960 * 540 * 4);
          R.renderer.readRenderTargetPixels(rt, 0, 0, 960, 540, exact); R.renderer.setRenderTarget(null);
          // The float target's rows run the opposite way to the exported PNG's.
          for (let n = 0; n < faint.length; n++) {
            const a = half(exact[((539 - Math.floor(n / 960)) * 960 + n % 960) * 4 + 3]);
            if (Math.abs(a * 255 - px[n * 4 + 3]) > 1) alphaMismatch++;
            if (a > 0 && a <= .001) faint[n] = 1;
          }
        }
        const plain = await q.px(scene({}), P), rows = [];
        for (const [name, mode] of MODES) {
          const out = await q.px(scene({ slitShift: 1, slitSpan: span, slitSlices: slices, slitMode: mode, slitReach: .4, slitDecay: .7 }), P);
          // Alpha always combines every slice, whatever each colour remembers.
          const echo = Array.from({ length: slices }, (_, k) => .7 ** k), echoSum = echo.reduce((a, b) => a + b);
          let alphaWorst = 0;
          for (let n = 0; n < alphas[0].length; n++) {
            const v = alphas.map(a => a[n]);
            const want = mode === 1 ? v.reduce((t, x, k) => t + x * echo[k] / echoSum, 0) : mode === 2 ? q.m.medianOf(v) : mode === 3 ? Math.min(...v) : Math.max(...v);
            alphaWorst = Math.max(alphaWorst, Math.abs(out[n * 4 + 3] - want));
          }
          let leaked = 0, over = 0, worst = -255, judged = 0, faintOver = 0, faintWorst = 0;
          for (let i = 0; i < out.length; i += 4) {
            if (!covered[i / 4] && (out[i + 3] || out[i] || out[i + 1] || out[i + 2])) leaked++;
            if (!out[i + 3]) continue;
            const light = faint[i / 4];
            if (!light) judged++;
            for (let c = 0; c < 3; c++) {
              const excess = out[i + c] - brightest[c];
              if (light) { faintWorst = Math.max(faintWorst, excess); if (excess > 2) faintOver++; }
              else { worst = Math.max(worst, excess); if (excess > 2) over++; }
            }
          }
          rows.push({ name, leaked, over, worst, judged, faintOver, faintWorst, alphaWorst, moved: q.difference(plain, out) });
        }
        return { brightest, rows, alphaMismatch, faint: faint.reduce((a, b) => a + b, 0) };
      }, STAT_MODES);
      const ok = r.alphaMismatch === 0 && r.rows.every(row => row.moved > 0 && row.judged > 1000 && !row.leaked && !row.over && row.alphaWorst <= 2);
      return { ok, detail: `brightest source ${r.brightest}; ${r.rows.map(row => `${row.name} leaked ${row.leaked}, over ${row.over}, worst +${row.worst}, alpha off the CPU by ${row.alphaWorst.toFixed(2)}, moved ${row.moved.toFixed(3)}`).join('; ')} (limits +2 and 2); exempt by the HDR ruling: ${r.faint} pixels with a slice at alpha .001 or below, over limit ${r.rows.map(row => `${row.name} ${row.faintOver} (worst +${row.faintWorst})`).join(', ')}; exact alpha mismatches ${r.alphaMismatch}` };
    },
  },
  {
    name: 'stats-loop',
    run: async ({ page }) => {
      const rows = await page.evaluate(async MODES => {
        const q = window.ct, rows = [], plain = await q.shot(q.project([q.layer('surface')]), 0);
        for (const [name, mode] of MODES) {
          const p = q.project([q.layer('surface', null, { slitShift: 1, slitSpan: 60, slitSlices: 7, slitMode: mode, slitReach: .5 })]);
          rows.push({ name, moved: !q.same(await q.shot(p, 0), plain), ...await q.loop(p) });
        }
        return rows;
      }, STAT_MODES);
      const ok = rows.every(row => row.moved && loopVerdict(row).ok);
      return { ok, detail: rows.map(row => `${row.name}${row.moved ? '' : ' has no effect'}: ${loopVerdict(row).detail}`).join('; ') };
    },
  },
  {
    name: 'stats-zero',
    // Shift is animated through exactly 0 at phase 0, where every slice is the current moment.
    run: async ({ page }) => {
      const rows = await page.evaluate(async MODES => {
        const q = window.ct, rows = [], sweep = { kind: 'sine', cycles: 1, phase: 0, amount: 1, points: [], range: { min: -1, max: 1 } };
        const sources = [['surface', false, params => q.layer('surface', null, params)],
          ['soft', true, params => { const l = q.soft(params); l.modulations['transform.x'] = q.slide(.2); return l; }]];
        for (const [source, transparent, make] of sources) {
          const plain = await q.px(q.project([make({})], transparent), 0), later = await q.px(q.project([make({})], transparent), 1.2);
          for (const [name, mode] of MODES) {
            const scene = () => { const l = make({ slitShift: 0, slitSpan: 60, slitSlices: 7, slitMode: mode, slitReach: .4 }); l.modulations.slitShift = structuredClone(sweep); return q.project([l], transparent); };
            const at = await q.px(scene(), 0), away = await q.px(scene(), 1.2);
            let worst = 0; for (let i = 0; i < at.length; i++) worst = Math.max(worst, Math.abs(at[i] - plain[i]));
            rows.push({ source, name, worst, moved: q.difference(later, away) });
          }
        }
        return rows;
      }, STAT_MODES);
      const ok = rows.every(row => row.worst <= 1 && row.moved > 0);
      return { ok, detail: rows.map(row => `${row.source} ${row.name} worst ${row.worst}, moved ${row.moved.toFixed(3)}`).join('; ') + ' (limit 1/255 at shift 0)' };
    },
  },
  {
    name: 'stats-4k',
    // A full 4K Median, then a render whose nine slices exceed the 768 MiB budget, in a fresh renderer.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, canvas = document.createElement('canvas'), R = new q.m.StudioRenderer(canvas), gl = R.renderer.getContext();
        const p = q.project([q.layer('surface', null, { slitShift: 1, slitSpan: 30, slitSlices: 9, slitMode: 2 })]);
        const bytes = t => t.width * t.height * t.depth * 8;
        try {
          await R.prepare(p); while (gl.getError());
          const png = await R.exportPNG(p, .9, 3840, 2160), error = gl.getError();
          const view = new DataView(png.buffer, png.byteOffset), size = [view.getUint32(16), view.getUint32(20)];
          const image = await q.pixels(png); let sum = 0; for (let i = 0; i < image.length; i += 4) sum += image[i] + image[i + 1] + image[i + 2];
          const full = { width: R.medianTarget.width, height: R.medianTarget.height, depth: R.medianTarget.depth, bytes: bytes(R.medianTarget) };
          const W = 5120, H = 2880, limit = R.maxTargetSize;
          if (W > limit || H > limit) return { error, size, mean: sum / image.length, full, limit, over: null };
          await R.exportPNG(p, .9, W, H);
          const over = { width: R.medianTarget.width, height: R.medianTarget.height, depth: R.medianTarget.depth, bytes: bytes(R.medianTarget), asked: W * H * 9 * 8, want: q.m.medianTargetSize(W, H, 9), error: gl.getError() };
          return { error, size, mean: sum / image.length, full, limit, over };
        } finally { R.dispose(); }
      });
      const MiB = v => `${(v / 1024 / 1024).toFixed(1)} MiB`, budget = 768 * 1024 * 1024;
      const base = r.error === 0 && r.size[0] === 3840 && r.size[1] === 2160 && r.mean > 1 && r.full.bytes <= budget && r.full.width === 3840 && r.full.depth === 9;
      if (!r.over) return { ok: false, detail: `4K Median ${base ? 'ok' : 'failed'} at ${MiB(r.full.bytes)}; the over-budget render needs 5120x2880 and this GPU allows ${r.limit}, so scaling was not proven` };
      const scaled = r.over.error === 0 && r.over.asked > budget && r.over.bytes <= budget && r.over.width === r.over.want.width && r.over.height === r.over.want.height && r.over.width < 5120;
      return { ok: base && scaled, detail: `4K PNG ${r.size.join('x')}, GL error ${r.error}, Median target ${r.full.width}x${r.full.height}x${r.full.depth} = ${MiB(r.full.bytes)}; 5120x2880 would need ${MiB(r.over.asked)}, allocated ${r.over.width}x${r.over.height}x${r.over.depth} = ${MiB(r.over.bytes)} (budget 768 MiB), GL error ${r.over.error}` };
    },
  },
  {
    name: 'stats-supersampled',
    // 2x supersampled 4K Median. A GPU that cannot hold that size reports SKIP, never PASS.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, canvas = document.createElement('canvas'), R = new q.m.StudioRenderer(canvas), gl = R.renderer.getContext();
        const p = q.project([q.layer('surface', null, { slitShift: 1, slitSpan: 30, slitSlices: 9, slitMode: 2 })]);
        try {
          if (7680 > R.maxTargetSize || 4320 > R.maxTargetSize) return { skipped: true, limit: R.maxTargetSize };
          await R.prepare(p); while (gl.getError());
          const png = await R.exportPNG(p, .9, 3840, 2160, 2), error = gl.getError(), view = new DataView(png.buffer, png.byteOffset);
          const t = R.medianTarget;
          return { error, size: [view.getUint32(16), view.getUint32(20)], target: [t.width, t.height, t.depth], want: q.m.medianTargetSize(7680, 4320, 9), bytes: t.width * t.height * t.depth * 8, limit: R.maxTargetSize };
        } finally { R.dispose(); }
      });
      if (r.skipped) return { ok: true, skipped: true, detail: `2x 4K needs 7680x4320 and this GPU allows ${r.limit}` };
      const ok = r.error === 0 && r.size[0] === 3840 && r.size[1] === 2160 && r.target[0] === r.want.width && r.target[1] === r.want.height && r.target[2] === 9 && r.bytes <= 768 * 1024 * 1024;
      return { ok, detail: `PNG ${r.size.join('x')}, GL error ${r.error}, Median target ${r.target.join('x')} (want ${r.want.width}x${r.want.height}x9) = ${(r.bytes / 1024 / 1024).toFixed(1)} MiB (budget 768), GPU limit ${r.limit}` };
    },
  },
  {
    name: 'stats-memory',
    // Statistical modes allocate no Brightness or Colour lag targets, and every optional target
    // is released on the first frame no visible layer needs it, and by dispose().
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, canvas = document.createElement('canvas'), R = new q.m.StudioRenderer(canvas);
        try {
        const frame = async (...layers) => { const p = q.project(layers); await R.prepare(p); await R.exportPNG(p, .9, 320, 180); };
        const slit = params => q.layer('surface', null, { slitShift: 1, slitSpan: 30, slitSlices: 5, ...params });
        const keys = ['medianTarget', 'statBoundTarget', 'statLightTarget', 'lensTarget', 'slitBoundTarget', 'slitLagTarget', 'slitDriverTarget'];
        const held = () => keys.filter(k => R[k]);
        const watch = () => { const seen = new Set(); for (const k of keys) if (R[k]) { const name = k; R[k].addEventListener('dispose', () => seen.add(name)); } return seen; };
        const out = {}, gl = R.renderer.getContext();
        // The live preview draws smaller slices through the same path.
        const preview = [];
        for (const mode of [1, 2, 3, 4]) { const p = q.project([slit({ slitMode: mode, slitReach: .4 })]); await R.prepare(p); while (gl.getError()); R.render(p, .9, 960, 540); preview.push(gl.getError()); }
        out.preview = preview;
        // The Median array holds the slices in use: three take a third of the memory of nine.
        const sized = async slices => { const p = q.project([slit({ slitMode: 2, slitSlices: slices })]); await R.prepare(p); await R.exportPNG(p, .9, 5120, 2880); const t = R.medianTarget; return { width: t.width, height: t.height, depth: t.depth, bytes: t.width * t.height * t.depth * 8 }; };
        out.three = await sized(3);
        let reallocated = 0; R.medianTarget.addEventListener('dispose', () => { reallocated++; });
        await sized(3); out.repeat = reallocated;
        out.nine = await sized(9); out.changed = reallocated; out.nineWant = q.m.medianTargetSize(5120, 2880, 9);
        // Median layers of different lengths share one array, sized once for the whole frame.
        const median = slices => slit({ slitMode: 2, slitSlices: slices });
        const changing = (base = 5) => { const l = median(base); l.modulations.slitSlices = { kind: 'sine', cycles: 1, phase: 0, amount: 1, points: [], range: { min: 3, max: 9 } }; return l; };
        const steady = async (layers, draw, phases) => {
          const p = q.project(layers); await R.prepare(p); await draw(p, phases[0]);
          const t = R.medianTarget; let count = 0; const on = () => { count++; }; t.addEventListener('dispose', on);
          for (const phase of phases.slice(1)) await draw(p, phase);
          t.removeEventListener('dispose', on);
          return { reallocated: count, kept: t === R.medianTarget, depth: t.depth };
        };
        const previewDraw = (p, phase) => R.render(p, phase, 960, 540), exportDraw = (p, phase) => R.exportPNG(p, phase, 960, 540);
        out.shared = [
          ['preview', await steady([median(3), median(9)], previewDraw, [.9, 1.1, 1.3])], ['export', await steady([median(3), median(9)], exportDraw, [.9, 1.1, 1.3])],
          ['modulated preview', await steady([median(3), changing()], previewDraw, [.3, 1.5, 3, 4.5])], ['modulated export', await steady([median(3), changing()], exportDraw, [.3, 1.5, 3, 4.5])],
        ];
        // Nine slices now can be three later, which draw largest: the array must already fit them.
        const roomy = q.project([changing(9)]); await R.prepare(roomy); R.render(roomy, 4.7, 960, 540); out.modulatedWidth = R.medianTarget.width;
        // A shorter Median layer sharing the array must not change how a longer one samples it.
        const linear = () => { const t = R.linearOutput, d = new Uint16Array(t.width * t.height * 4); R.renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, d); return d; };
        const alone = q.project([median(9)]); await R.prepare(alone); R.render(alone, .9, 960, 540); const single = linear();
        const paired = q.project([median(3), median(9)]); await R.prepare(paired); R.render(paired, .9, 960, 540); const both = linear();
        out.samplingOff = 0; for (let i = 0; i < single.length; i++) if (single[i] !== both[i]) out.samplingOff++;
        await frame(q.layer('surface'));
        await frame(slit({ slitMode: 1, slitShape: 5, slitChroma: 1 })); out.echo = held();
        await frame(slit({ slitMode: 3, slitShape: 5, slitChroma: 1, slitReach: .4 })); out.reach = held();
        await frame(slit({ slitMode: 2, slitShape: 5, slitChroma: 1, slitReach: .4 })); out.median = held();
        await frame(slit({ slitShape: 5, slitChroma: 1, gradMix: 1, gradPalette: 1 })); out.delay = held();
        const hidden = slit({ slitMode: 2 }); hidden.visible = false;
        await frame(slit({ slitMode: 2, slitReach: .4 }), slit({ slitMode: 1, slitReach: .4 }), slit({ slitShape: 5, slitChroma: 1, gradMix: 1, gradPalette: 1 })); out.all = held();
        const released = watch();
        await frame(q.layer('surface'), hidden); out.after = held(); out.released = [...released];
        await frame(slit({ slitMode: 2, slitReach: .4 }), slit({ slitMode: 1, slitReach: .4 }), slit({ slitShape: 5, slitChroma: 1, gradMix: 1, gradPalette: 1 }));
        const closed = watch(); R.dispose(); out.closed = [...closed]; out.left = held();
        return { ...out, keys };
        } finally { R.dispose(); }
      });
      const same = (a, b) => [...a].sort().join() === [...b].sort().join();
      const array = t => `${t.width}x${t.height}x${t.depth} = ${(t.bytes / 1024 / 1024).toFixed(1)} MiB`;
      const sizing = r.three.width === 5120 && r.three.height === 2880 && r.three.depth === 3 && r.repeat === 0 && r.changed > 0 &&
        r.nine.depth === 9 && r.nine.width === r.nineWant.width && r.nine.height === r.nineWant.height && r.nine.width < 5120 && r.nine.bytes <= 768 * 1024 * 1024;
      const shared = r.shared.every(([, row]) => row.reallocated === 0 && row.kept && row.depth === 9) && r.samplingOff === 0 && r.modulatedWidth === 480;
      const ok = sizing && shared && r.preview.every(e => e === 0) && same(r.echo, []) && same(r.reach, ['statBoundTarget', 'statLightTarget']) && same(r.median, ['medianTarget']) &&
        same(r.delay, ['lensTarget', 'slitBoundTarget', 'slitLagTarget', 'slitDriverTarget']) && same(r.all, r.keys) && !r.after.length && same(r.released, r.keys) && same(r.closed, r.keys) && !r.left.length;
      return { ok, detail: `5120x2880 Median: 3 slices ${array(r.three)}, same again reallocates ${r.repeat} times, 9 slices ${array(r.nine)} (budget 768 MiB); shared array reallocations ${r.shared.map(([name, row]) => `${name} ${row.reallocated} (depth ${row.depth})`).join(', ')}; values changed by sharing ${r.samplingOff}; modulated slices keep a ${r.modulatedWidth}-wide preview array (want 480); preview GL errors ${r.preview}; Echo holds [${r.echo}]; Darkest with reach [${r.reach}]; Median [${r.median}]; delay map [${r.delay}]; all in use ${r.all.length}/${r.keys.length}; after they stop [${r.after}], released ${r.released.length}; dispose released ${r.closed.length}, left [${r.left}]` };
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
await bundle(root, 'renderer.js', `\nexport {gradientTone,gradientStops} from './src/rendering/colour-lens';\nexport {applyFinish} from './src/core/project';\nexport {supportsSlitScan,medianOf,medianTargetSize} from './src/rendering/slitscan';\nexport {feedbackActive} from './src/rendering/feedback';`);
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
    const dataUrl = async (w, h, pixel) => {
      const bytes = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bytes.set(pixel((x + .5) / h - w / h / 2, (y + .5) / h - .5), (y * w + x) * 4);
      const png = await m.encodePNG(bytes, w, h); let text = '';
      for (let i = 0; i < png.length; i += 8192) text += String.fromCharCode(...png.subarray(i, i + 8192));
      return `data:image/png;base64,${btoa(text)}`;
    };
    const TWO_PI = Math.PI * 2;
    const ramp = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // One colour, below full brightness, so any brightening at the edge shows.
    // A soft halo around a hard-edged block, which gives the Edges shape something to find.
    const softUrl = await dataUrl(960, 540, (x, y) => {
      const halo = .6 * (1 - ramp(.2, .34, Math.hypot(x, y))), block = Math.abs(x) < .1 && Math.abs(y) < .1 ? 1 : 0;
      return [176, 96, 48, Math.round(255 * Math.max(halo, block))];
    });
    const greyUrl = await dataUrl(64, 36, () => [128, 128, 128, 255]);
    const tinyUrl = await dataUrl(64, 36, (x, y) => [Math.round(255 * (x + .9) / 1.8), Math.round(255 * (y + .5)), 90, Math.round(255 * (1 - ramp(.25, .48, Math.hypot(x, y))))]);
    const image = (url, params, name) => {
      const l = m.createLayer('image'); l.id = `${name}-proof`; Object.assign(l.params, params);
      l.image = { name: `${name}.png`, dataUrl: url, width: 960, height: 540, fit: 'contain' };
      return l;
    };
    const soft = (params = {}) => { const l = image(softUrl, params, 'soft'); l.mask = { ...l.mask, kind: 'circle', size: .9, softness: .2 }; return l; };
    const rampUrl = await dataUrl(960, 540, x => { const v = Math.round(255 * (x + 960 / 540 / 2) / (960 / 540)); return [v, v, v, 255]; });
    const rampLayer = (params = {}) => image(rampUrl, params, 'ramp');
    const grey = (params = {}) => image(greyUrl, params, 'grey');
    const colourBars = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255], [128, 128, 128]];
    const barsUrl = await dataUrl(960, 540, x => [...colourBars[Math.min(6, Math.floor((x + 960 / 540 / 2) / (960 / 540) * 7))], 255]);
    const bars = (params = {}) => image(barsUrl, params, 'bars');
    // Period 240: black plateau, ramp up, white plateau, ramp down. Slides 120 pixels, half a
    // period, between phase 0 and a quarter of the loop, so black and white trade places.
    const stripesUrl = await dataUrl(960, 540, x => {
      const t = (((x + 960 / 540 / 2) * 540) % 240 + 240) % 240;
      const v = Math.round(255 * (t < 100 ? 0 : t < 120 ? (t - 100) / 20 : t < 220 ? 1 : (240 - t) / 20));
      return [v, v, v, 255];
    });
    const stripes = (params = {}) => {
      const l = image(stripesUrl, params, 'stripes');
      l.modulations['transform.x'] = { kind: 'sine', cycles: 1, phase: 0, amount: 1, points: [], range: { min: -.125, max: .125 } };
      return l;
    };
    // Gentle and periodic, so a small warp cannot move any pixel far in value.
    const waveUrl = await dataUrl(960, 540, (x, y) => {
      const v = Math.round(255 * (.5 + .1 * Math.cos(TWO_PI * x * 540 / 960) + .1 * Math.cos(TWO_PI * y)));
      return [v, v, v, 255];
    });
    const wave = (params = {}) => {
      const l = image(waveUrl, { repeat: 2, ...params }, 'wave');
      l.modulations['transform.x'] = { kind: 'sine', cycles: 1, phase: 0, amount: 1, points: [], range: { min: -.125, max: .125 } };
      return l;
    };
    const slide = reach => ({ kind: 'sine', cycles: 1, phase: 0, amount: 1, points: [], range: { min: -reach, max: reach } });
    const layer = (kind, preset, params = {}) => { const l = preset ? m.applyPreset(m.createLayer(kind), preset) : m.createLayer(kind); Object.assign(l.params, params); l.id = `${kind}-proof`; return l; };
    const project = (layers, transparent = false) => { const p = m.createProject(); p.id = 'colour-proof'; p.layers = layers; p.background = '#000000'; p.transparent = transparent; return p; };
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
    // The renderer wraps phase, so 0 against TAU alone proves nothing: the seam
    // comparison is what catches motion that does not close. Read with loopVerdict.
    const loop = async p => {
      const start = await shot(p, 0), wrapped = await shot(p, Math.PI * 2), before = await shot(p, Math.PI * 2 - 1e-4);
      return { literal: same(start, wrapped), seam: difference(await pixels(start), await pixels(before)) };
    };
    window.ct = { m, old, tinyUrl, renderer, slide, layer, soft, grey, bars, stripes, wave, ramp: rampLayer, gradientTone: m.gradientTone, gradientStops: m.gradientStops, project, pixels, shot, px, difference, same, loop };
  }, !!baseline);

  for (const check of selected) {
    errors.length = 0;
    let result;
    try { result = await check.run({ page, baseline, out }); }
    catch (error) { result = { ok: false, detail: String(error?.message ?? error).split('\n')[0] }; }
    if (errors.length) result = { ok: false, detail: `${result.detail}; page error: ${errors[0].slice(0, 300)}` };
    results.push({ name: check.name, ...result });
    console.log(`${!result.ok ? 'FAIL' : result.skipped ? 'SKIP' : 'PASS'} ${check.name}: ${result.detail}`);
  }
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
  await app.close();
}
const failed = results.filter(r => !r.ok).length;
const skipped = results.filter(r => r.ok && r.skipped).length;
console.log(`${results.length - failed - skipped} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
if (failed || results.length !== selected.length) process.exitCode = 1;
