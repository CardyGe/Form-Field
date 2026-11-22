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
await bundle(root, 'renderer.js', `\nexport {gradientTone,gradientStops} from './src/rendering/colour-lens';`);
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
    window.ct = { m, old, tinyUrl, renderer, layer, soft, grey, ramp: rampLayer, gradientTone: m.gradientTone, gradientStops: m.gradientStops, project, pixels, shot, px, difference, same, loop };
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
