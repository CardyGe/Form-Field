// Real Electron/WebGL checks for the Warp finishes.
// Run: node scripts/verify-warp.mjs --baseline=<checkout of the commit before them> [--only=neutral,warp]
// --only takes comma-separated name prefixes. Each check prints one PASS or FAIL
// line, and any failure makes the exit code non-zero. Output goes to work/warp.
//
// To add a check, add an entry to CHECKS: `run` receives the helpers below and
// returns { ok, detail }. Code passed to `page.evaluate` runs in the renderer
// and reaches the page helpers through `window.wq`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = option('baseline');
const only = option('only')?.split(',').map(s => s.trim()).filter(Boolean);
const out = path.join(root, 'work/warp');
const FIELDS = ['Waves', 'Noise', 'Ripple', 'Magnetic', 'Plasma'];
const STYLES = ['Swirl', 'Flow', 'Ridge', 'Vortex', 'Chaos'];
// A clamped edge repeats one source pixel along the push. The test picture never holds still this long.
const STREAK_LIMIT = 48;
// Measured on mirrored reads: at most .91x the unwarped edge colour. Clamped reads reach 1.47x on the mildest field.
const RIM_AREA_LIMIT = 1.25;

const needsBaseline = () => baseline ? null : { ok: false, detail: 'needs --baseline=<checkout>' };
const loopVerdict = (r, limit = .1) => ({
  ok: r.literal && r.seam < limit,
  detail: `0/TAU ${r.literal ? 'match' : 'differ'}, seam ${r.seam.toFixed(4)} (limit ${limit})`,
});
const NO_EFFECT = 'Warp does not change the render. ';
const NO_LIQUID = 'Liquid does not change the render. ';
const NO_LUMA = 'Luma Warp does not change the render. ';
const LUMA_MODES = ['Push', 'Edges', 'Contours'];
const LUMA_CHANNELS = ['Brightness', 'Red', 'Green', 'Blue', 'Saturation'];
const POLAR_NAMES = ['To circle', 'Unroll'];
const MIRROR_NAMES = ['Left-right', 'Top-bottom', 'Four-way', 'Kaleidoscope'];
const proof = path.join(root, 'work/warp-proof');
// Share of pixels with a hard break on a smooth picture. Chaos measured .064% with its ridge feedback at .35, .002% at .2.
const TEAR_LIMIT = .01;
const STRENGTH_SPREAD = 1.25;
// Presets allowed to render under .5% lit. None today; add one only with the reason beside it.
const BLANK_PRESETS = [];
const SHEET_KINDS = ['surface', 'fractal', 'liquid', 'image'];
// Each type at a working amount, every other control at its default.
const SHEET_GROUPS = [
  ['Warp', FIELDS.map((name, i) => [name, { bendAmount: .3, bendField: i }])],
  ['Liquid', STYLES.map((name, i) => [name, { liquidAmount: .4, liquidStyle: i }])],
  ['Luma Warp', LUMA_MODES.map((name, i) => [name, { lumaWarpAmount: .4, lumaWarpMode: i }])],
  ['Polar', POLAR_NAMES.map((name, i) => [name, { polarAmount: 1, polarMode: i }])],
  ['Mirror', MIRROR_NAMES.map((name, i) => [name, { mirrorAmount: 1, mirrorMode: i }])],
];
const STACK = { mirrorAmount: 1, mirrorMode: 3, polarAmount: .6, bendAmount: .2, bendField: 1, liquidAmount: .25, liquidStyle: 1, lumaWarpAmount: .2, echo: .6, slitShift: .5, splitAmount: 6, gradMix: .6, glowMix: .6, printMix: .5 };
const COST_CASES = [
  ['Plain', {}],
  ...SHEET_GROUPS.flatMap(([effect, types]) => types.map(([name, params]) => [`${effect} ${name}`, params])),
  ...MIRROR_NAMES.map((name, i) => [`Mirror ${name} at .5`, { mirrorAmount: .5, mirrorMode: i }]),
  ['Kaleidoscope + Warp (fold lines)', { mirrorAmount: 1, mirrorMode: 3, bendAmount: .3, bendField: 1 }],
  ['Kaleidoscope at .5 + Warp (fold lines)', { mirrorAmount: .5, mirrorMode: 3, bendAmount: .3, bendField: 1 }],
];
const lumaStageVerdict = r => ({
  ok: r.staged > 1 && r.dark > .1 && r.bright > .1 && r.self < .002 && r.selfBright > .3,
  detail: `${r.staged <= 1 ? 'The stage does not change the render. ' : ''}moved where the staged read is dark ${(r.self * 100).toFixed(3)}% (limit .2%), where bright ${(r.selfBright * 100).toFixed(1)}% (over 30%); picture is ${(r.dark * 100).toFixed(0)}% dark, ${(r.bright * 100).toFixed(0)}% bright (each over 10%)`,
});
const fringeStageVerdict = r => ({
  ok: r.alone < 1e-6 && r.stacked > .001 && r.off < .0005,
  detail: `fringe from the stage alone ${r.alone.toExponential(1)} (must be 0); stacked Warp fringe ${r.stacked.toFixed(4)} (over .001), off Warp's own movement by ${r.off.toFixed(5)} (limit .0005)`,
});

const CHECKS = [
  {
    name: 'neutral',
    // Every control at its default: one preset of every kind, plus an Image layer, against the older checkout.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      const r = await page.evaluate(async () => {
        const q = window.wq, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [];
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
      return { ok: r.changed.length === 0, detail: r.changed.length ? `changed: ${r.changed.join(', ')}` : `${r.kinds} kinds byte-identical` };
    },
  },
  {
    name: 'warp-types',
    run: async ({ page }) => {
      const r = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.rich()])), shots = [];
        for (let f = 0; f < count; f++) shots.push(await q.px(q.project([q.rich({ bendAmount: .25, bendField: f })])));
        const moved = shots.map(s => q.difference(plain, s));
        let closest = Infinity;
        for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) closest = Math.min(closest, q.difference(shots[a], shots[b]));
        return { moved, closest };
      }, FIELDS.length);
      const ok = r.moved.every(v => v > 3) && r.closest > 3;
      return { ok, detail: `${r.moved.some(v => v <= 3) ? NO_EFFECT : ''}moved ${r.moved.map((v, i) => `${FIELDS[i]} ${v.toFixed(2)}`).join(', ')}; closest pair ${r.closest.toFixed(2)} (limits 3)` };
    },
  },
  {
    name: 'warp-engage',
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.smooth()])), rows = [];
        for (let f = 0; f < count; f++) {
          const tiny = await q.px(q.project([q.smooth({ bendAmount: .0001, bendField: f, bendChroma: .5 })]));
          const full = await q.px(q.project([q.smooth({ bendAmount: .5, bendField: f })]));
          rows.push({ mean: q.difference(plain, tiny), moved: q.difference(plain, full) });
        }
        return rows;
      }, FIELDS.length);
      const ok = rows.every(r => r.mean < 1 && r.moved > 1);
      return { ok, detail: `${rows.some(r => r.moved <= 1) ? NO_EFFECT : ''}${rows.map((r, i) => `${FIELDS[i]} ${r.mean.toFixed(4)} (full ${r.moved.toFixed(2)})`).join(', ')} (limit 1)` };
    },
  },
  {
    name: 'warp-loop',
    // Cycles 1.5 is deliberately not whole: the renderer must round it, or the seam opens.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.shot(q.project([q.smooth()]), 0), rows = [];
        for (let f = 0; f < count; f++) {
          const p = q.project([q.smooth({ bendAmount: .3, bendField: f, bendCycles: 1.5, bendChroma: .3 })]);
          rows.push({ ...await q.loop(p), moved: !q.same(await q.shot(p, 0), plain) });
        }
        return rows;
      }, FIELDS.length);
      const verdicts = rows.map(r => loopVerdict(r));
      return { ok: rows.every((r, i) => r.moved && verdicts[i].ok), detail: `${rows.some(r => !r.moved) ? NO_EFFECT : ''}${verdicts.map((v, i) => `${FIELDS[i]} ${v.detail}`).join('; ')}` };
    },
  },
  {
    name: 'warp-scale',
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.rich()])), rows = [];
        for (let f = 0; f < count; f++) {
          // A busy picture, so a warp that moves by the wrong distance shows on every field.
          const p = () => q.project([q.rich({ bendAmount: .3, bendField: f, bendChroma: .3 })]);
          const small = await q.px(p()), big = await q.px(p(), .9, 1920, 1080);
          rows.push({ difference: q.difference(small, q.halved(big, 960, 540)), moved: q.difference(plain, small) });
        }
        return rows;
      }, FIELDS.length);
      return { ok: rows.every(r => r.moved > 1 && r.difference < 2), detail: `${rows.some(r => r.moved <= 1) ? NO_EFFECT : ''}${rows.map((r, i) => `${FIELDS[i]} ${r.difference.toFixed(3)}`).join(', ')} (limit 2)` };
    },
  },
  {
    name: 'warp-edge',
    // Amount 1 pushes far past the frame. The picture's outer two pixels are a colour found nowhere else, so
    // clamped reads show up as a spread of that colour; mirrored reads keep it to thin lines.
    run: async ({ page }) => {
      const rows = await page.evaluate(async ([count, limit]) => {
        const q = window.wq, W = 960, H = 540, scene = params => { const p = q.project([q.rimmed(params)], true); p.highlights = 'exact'; return p; };
        const plain = await q.px(scene({})), rows = [];
        const measure = px => q.edgeStats(px, W, H);
        const base = measure(plain);
        for (let f = 0; f < count; f++) {
          const px = await q.px(scene({ bendAmount: 1, bendField: f }));
          let gaps = 0; for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) gaps++;
          rows.push({ gaps, ...measure(px), moved: q.difference(plain, px), baseArea: base.area });
        }
        return rows;
      }, [FIELDS.length, STREAK_LIMIT]);
      const ok = rows.every(r => r.moved > 3 && r.gaps === 0 && r.longest < STREAK_LIMIT && r.area < r.baseArea * RIM_AREA_LIMIT && r.line < .5);
      return { ok, detail: `${rows.some(r => r.moved <= 3) ? NO_EFFECT : ''}edge colour covers ${(rows[0].baseArea * 100).toFixed(2)}% unwarped; ${rows.map((r, i) => `${FIELDS[i]} gaps ${r.gaps} edge ${(r.area * 100).toFixed(2)}% line ${(r.line * 100).toFixed(0)}% run ${r.longest}`).join(', ')} (limits ${RIM_AREA_LIMIT}x area, 50% of a line, run < ${STREAK_LIMIT})` };
    },
  },
  {
    name: 'warp-alpha',
    // Exact highlights show what the pass wrote; the soft curve lifts channels on its own.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, scene = params => { const p = q.project([q.soft(params)], true); p.highlights = 'exact'; return p; };
        const plain = await q.px(scene({})), rows = [];
        let brightest = 0;
        for (let i = 0; i < plain.length; i += 4) if (plain[i + 3] > 0) brightest = Math.max(brightest, plain[i], plain[i + 1], plain[i + 2]);
        for (let f = 0; f < count; f++) {
          const px = await q.px(scene({ bendAmount: .35, bendField: f, bendChroma: 1 }));
          let over = 0, worst = 0;
          for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) { const excess = Math.max(px[i], px[i + 1], px[i + 2]) - brightest; worst = Math.max(worst, excess); if (excess > 2) over++; }
          rows.push({ over, worst, moved: q.difference(plain, px), brightest });
        }
        return rows;
      }, FIELDS.length);
      return { ok: rows.every(r => r.moved > 1 && r.over === 0), detail: `${rows.some(r => r.moved <= 1) ? NO_EFFECT : ''}peak ${rows[0].brightest}; ${rows.map((r, i) => `${FIELDS[i]} over ${r.over} worst +${r.worst}`).join(', ')} (limit +2)` };
    },
  },
  {
    name: 'warp-sparkle',
    // The single-tap render swaps one shader constant on the live material, so no test path ships.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, W = 3840, H = 2160, url = await q.checkerUrl(W, H);
        const scene = phase => q.project([q.image(url, { bendAmount: .22, bendField: 1, bendScale: 7, bendDetail: 4, bendCycles: 1 }, 'checker', W, H)]);
        const plain = await q.shot(q.project([q.image(url, {}, 'checker', W, H)]), .9, W, H);
        const first = await q.shot(scene(), .9, W, H);
        if (q.same(plain, first)) return { moved: false };
        const energy = async () => {
          const phases = [.9, .92, .94, .96];
          let sum = 0, previous = await q.px(scene(), phases[0], W, H);
          for (const phase of phases.slice(1)) { const next = await q.px(scene(), phase, W, H); sum += q.highFrequency(previous, next, W, H); previous = next; }
          return sum / (phases.length - 1);
        };
        const filtered = await energy();
        const mat = q.renderer.warp, source = mat.fragmentShader, single = source.replace('const int WARP_TAPS = 4;', 'const int WARP_TAPS = 1;');
        if (single === source) throw new Error('WARP_TAPS constant not found');
        mat.fragmentShader = single; mat.needsUpdate = true;
        let tap;
        try { tap = await energy(); } finally { mat.fragmentShader = source; mat.needsUpdate = true; }
        return { moved: true, filtered, tap };
      });
      if (!r.moved) return { ok: false, detail: NO_EFFECT };
      return { ok: r.filtered < r.tap / 2, detail: `high-frequency change ${r.filtered.toFixed(3)} against single tap ${r.tap.toFixed(3)}, ratio ${(r.filtered / r.tap).toFixed(3)} (limit .5)` };
    },
  },
  {
    name: 'warp-fringe',
    // A fold is not fringe movement. The live shader gets a temporary whole mirror period added to the read
    // position: the picture lands in the same place, so any change means the fringe grew with the fold.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, mat = q.renderer.warp, rows = [];
        const scene = (f, chroma) => q.project([q.rich({ bendAmount: .2, bendField: f, bendChroma: chroma })]);
        const shots = [];
        for (let f = 0; f < count; f++) shots.push({ none: await q.px(scene(f, 0)), fringe: await q.px(scene(f, 1)) });
        const source = mat.fragmentShader, folded = source.replace('  return warped;\n}', '  return warped + vec2(2.);\n}');
        if (folded === source) throw new Error('warpedUv return not found');
        mat.fragmentShader = folded; mat.needsUpdate = true;
        try {
          for (let f = 0; f < count; f++) rows.push({ shift: q.difference(shots[f].fringe, await q.px(scene(f, 1))), fringe: q.difference(shots[f].none, shots[f].fringe) });
        } finally { mat.fragmentShader = source; mat.needsUpdate = true; }
        return rows;
      }, FIELDS.length);
      return { ok: rows.every(r => r.fringe > 1 && r.shift < 1), detail: `${rows.some(r => r.fringe <= 1) ? 'Colour fringe has no effect. ' : ''}${rows.map((r, i) => `${FIELDS[i]} fold changes ${r.shift.toFixed(3)} (fringe ${r.fringe.toFixed(2)})`).join(', ')} (limit 1)` };
    },
  },
  {
    name: 'warp-history',
    // The warp reads the echo's result once. If it entered the history, each echo would be bent again.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, total = Math.round(q.m.createProject().duration * q.m.createProject().fps.num / q.m.createProject().fps.den);
        const phase = frame => frame * Math.PI * 2 / total;
        const bend = { bendAmount: .12, bendField: 0, bendScale: 2, bendCycles: 0 };
        // Exact highlights, so reading a saved frame back as a picture does not apply the highlight curve twice.
        const exact = p => { p.highlights = 'exact'; return p; };
        const scene = params => exact(q.project([q.smooth({ echo: .9, echoZoom: .96, echoDriftX: .01, ...params })]));
        const direct = await q.shot(scene(bend), phase(60));
        await q.shot(scene(bend), phase(90)); await q.shot(scene(bend), phase(10));
        const sought = await q.shot(scene(bend), phase(60));
        const echoOnly = await q.shot(scene({}), phase(60));
        // The correct picture is the plain echo bent once; the defect is that picture bent again.
        const once = await q.shot(exact(q.project([q.image(q.urlOf(echoOnly), bend, 'echo-once')])), phase(60));
        const twice = await q.shot(exact(q.project([q.image(q.urlOf(once), bend, 'echo-twice')])), phase(60));
        const [a, b, c, d] = await Promise.all([direct, once, twice, echoOnly].map(q.pixels));
        return { same: q.same(direct, sought), toOnce: q.difference(a, b), toTwice: q.difference(a, c), moved: q.difference(a, d) };
      });
      const ok = r.same && r.moved > 1 && r.toOnce < 2 && r.toOnce < r.toTwice / 2;
      return { ok, detail: `${r.moved <= 1 ? NO_EFFECT : ''}seek ${r.same ? 'byte-identical' : 'differs'}; against echo bent once ${r.toOnce.toFixed(3)} (limit 2), bent twice ${r.toTwice.toFixed(3)}, moved ${r.moved.toFixed(2)}` };
    },
  },
  {
    name: 'liquid-styles',
    run: async ({ page }) => {
      const r = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.rich()])), shots = [];
        for (let s = 0; s < count; s++) shots.push(await q.px(q.project([q.rich({ liquidAmount: .3, liquidStyle: s })])));
        const moved = shots.map(x => q.difference(plain, x));
        let closest = Infinity;
        for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) closest = Math.min(closest, q.difference(shots[a], shots[b]));
        return { moved, closest };
      }, STYLES.length);
      const ok = r.moved.every(v => v > 3) && r.closest > 3;
      return { ok, detail: `${r.moved.some(v => v <= 3) ? NO_LIQUID : ''}moved ${r.moved.map((v, i) => `${STYLES[i]} ${v.toFixed(2)}`).join(', ')}; closest pair ${r.closest.toFixed(2)} (limits 3)` };
    },
  },
  {
    name: 'liquid-steps',
    // More steps follow the curved path more closely, so each extra step changes less.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, at = steps => q.px(q.project([q.smooth({ liquidAmount: .8, liquidSteps: steps })]));
        const [one, two, fifteen, sixteen] = [await at(1), await at(2), await at(15), await at(16)];
        return { far: q.difference(one, sixteen), early: q.difference(one, two), late: q.difference(fifteen, sixteen) };
      });
      // A quarter, not merely smaller: steps that each travel the full distance still shrink a little, and never settle.
      return { ok: r.far > 1 && r.late < r.early / 4, detail: `1 vs 16 ${r.far.toFixed(3)} (over 1); 1 vs 2 ${r.early.toFixed(3)}, 15 vs 16 ${r.late.toFixed(3)} (under a quarter of it)` };
    },
  },
  {
    name: 'liquid-area',
    // A field that pinches gathers some colours and loses others, so the picture's mean moves. Measured: these two
    // pictures shift by under 1 on Swirl and by 5 to 7 on the same field left unturned, which does pinch.
    // Large soft patches are no use here: their mean moves more from picture crossing the frame edge than from pinching.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, mean = px => { let sum = 0; for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3; return sum / (px.length / 4); };
        const shifts = [];
        for (const picture of [q.smooth, q.rich]) {
          const plain = mean(await q.px(q.project([picture()])));
          for (const phase of [.9, 2.4, 4.1]) shifts.push(Math.abs(mean(await q.px(q.project([picture({ liquidAmount: .5, liquidStyle: 0 })]), phase)) - plain));
        }
        const moved = q.difference(await q.px(q.project([q.smooth()])), await q.px(q.project([q.smooth({ liquidAmount: .5, liquidStyle: 0 })])));
        return { worst: Math.max(...shifts), moved };
      });
      return { ok: r.moved > 1 && r.worst <= 3, detail: `${r.moved <= 1 ? NO_LIQUID : ''}mean brightness shift ${r.worst.toFixed(3)} of 255 (limit 3), moved ${r.moved.toFixed(2)}` };
    },
  },
  {
    name: 'liquid-engage',
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.smooth()])), rows = [];
        for (let s = 0; s < count; s++) {
          const tiny = await q.px(q.project([q.smooth({ liquidAmount: .0001, liquidStyle: s, liquidChroma: .5, liquidTrail: .5 })]));
          const full = await q.px(q.project([q.smooth({ liquidAmount: .5, liquidStyle: s })]));
          rows.push({ mean: q.difference(plain, tiny), moved: q.difference(plain, full) });
        }
        return rows;
      }, STYLES.length);
      const ok = rows.every(r => r.mean < 1 && r.moved > 1);
      return { ok, detail: `${rows.some(r => r.moved <= 1) ? NO_LIQUID : ''}${rows.map((r, i) => `${STYLES[i]} ${r.mean.toFixed(4)} (full ${r.moved.toFixed(2)})`).join(', ')} (limit 1)` };
    },
  },
  {
    name: 'liquid-loop',
    // Cycles 1.5 is deliberately not whole: the renderer must round it, or the seam opens.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.shot(q.project([q.smooth()]), 0), rows = [];
        for (let s = 0; s < count; s++) {
          const p = q.project([q.smooth({ liquidAmount: .3, liquidStyle: s, liquidCycles: 1.5, liquidChroma: .3, liquidTrail: .5 })]);
          rows.push({ ...await q.loop(p), moved: !q.same(await q.shot(p, 0), plain) });
        }
        return rows;
      }, STYLES.length);
      const verdicts = rows.map(r => loopVerdict(r));
      return { ok: rows.every((r, i) => r.moved && verdicts[i].ok), detail: `${rows.some(r => !r.moved) ? NO_LIQUID : ''}${verdicts.map((v, i) => `${STYLES[i]} ${v.detail}`).join('; ')}` };
    },
  },
  {
    name: 'liquid-scale',
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.rich()])), rows = [];
        for (let s = 0; s < count; s++) {
          const p = () => q.project([q.rich({ liquidAmount: .3, liquidStyle: s, liquidChroma: .3, liquidTrail: .5 })]);
          const small = await q.px(p()), big = await q.px(p(), .9, 1920, 1080);
          rows.push({ difference: q.difference(small, q.halved(big, 960, 540)), moved: q.difference(plain, small) });
        }
        return rows;
      }, STYLES.length);
      return { ok: rows.every(r => r.moved > 1 && r.difference < 2), detail: `${rows.some(r => r.moved <= 1) ? NO_LIQUID : ''}${rows.map((r, i) => `${STYLES[i]} ${r.difference.toFixed(3)}`).join(', ')} (limit 2)` };
    },
  },
  {
    name: 'liquid-edge',
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, W = 960, H = 540, scene = params => { const p = q.project([q.rimmed(params)], true); p.highlights = 'exact'; return p; };
        const plain = await q.px(scene({})), base = q.edgeStats(plain, W, H), rows = [];
        for (let s = 0; s < count; s++) {
          const px = await q.px(scene({ liquidAmount: 1, liquidStyle: s, liquidSteps: 8 }));
          let gaps = 0; for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) gaps++;
          rows.push({ gaps, ...q.edgeStats(px, W, H), moved: q.difference(plain, px), baseArea: base.area });
        }
        return rows;
      }, STYLES.length);
      const ok = rows.every(r => r.moved > 3 && r.gaps === 0 && r.longest < STREAK_LIMIT && r.area < r.baseArea * RIM_AREA_LIMIT && r.line < .5);
      return { ok, detail: `${rows.some(r => r.moved <= 3) ? NO_LIQUID : ''}edge colour covers ${(rows[0].baseArea * 100).toFixed(2)}% unwarped; ${rows.map((r, i) => `${STYLES[i]} gaps ${r.gaps} edge ${(r.area * 100).toFixed(2)}% line ${(r.line * 100).toFixed(0)}% run ${r.longest}`).join(', ')} (limits ${RIM_AREA_LIMIT}x area, 50% of a line, run < ${STREAK_LIMIT})` };
    },
  },
  {
    name: 'liquid-trail',
    // A shorter run with the same step size stops exactly at a point of the path, so the trail must equal those
    // renders averaged with falling weights. Seven steps use every step; sixteen use eight spaced along the path.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540, amount = .5, falloff = .8, rows = [];
        const read = async params => { await q.shot(q.project([q.smooth({ liquidStyle: 1, ...params })]), .9, W, H); return q.linear(W, H); };
        const gap = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
        for (const steps of [7, 16]) {
          const stops = [], stride = steps / 7;
          for (let slot = 0; slot < 8; slot++) {
            const k = Math.floor(slot * stride + .5);
            stops.push(await read({ liquidAmount: k ? amount * k / steps : 1e-9, liquidSteps: Math.max(1, k) }));
          }
          const expected = new Float32Array(stops[0].length);
          let total = 0;
          stops.forEach((stop, slot) => { const w = falloff ** (7 - slot); total += w; for (let i = 0; i < stop.length; i++) expected[i] += stop[i] * w; });
          for (let i = 0; i < expected.length; i++) expected[i] /= total;
          const trail = await read({ liquidAmount: amount, liquidSteps: steps, liquidTrail: 1 });
          rows.push({ steps, error: gap(trail, expected), moved: gap(trail, stops[7]) });
        }
        // Trail belongs to Flow: on another style the control is hidden, so it must not change the picture.
        const other = await read({ liquidStyle: 0, liquidAmount: amount, liquidSteps: 7, liquidTrail: 1 });
        const otherPlain = await read({ liquidStyle: 0, liquidAmount: amount, liquidSteps: 7 });
        return { rows, hidden: gap(other, otherPlain) };
      });
      const ok = r => r.moved > .005 && r.error < r.moved / 10;
      return { ok: rows.rows.every(ok) && rows.hidden === 0, detail: `${rows.rows.some(r => r.moved <= .005) ? 'Trail has no effect. ' : ''}${rows.rows.map(r => `${r.steps} steps: against the weighted path ${r.error.toFixed(5)}, trail moved ${r.moved.toFixed(5)}`).join('; ')} (limit a tenth of that); on Swirl ${rows.hidden.toFixed(5)} (must be 0)` };
    },
  },
  {
    name: 'liquid-light',
    // Feeds the pass floats directly, with trail and fringe both on. Straight colour is the same over-range white
    // across a soft ramp, so the brightest straight colour read is 4 and anything above it was invented.
    // Over-range light must survive, and uncovered light must pass.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540, straight = [4, 4, 4];
        const params = { liquidAmount: .35, liquidStyle: 1, liquidTrail: 1, liquidChroma: 1, liquidSteps: 8 };
        const pass = fill => {
          const data = new Float32Array(W * H * 4);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(fill(x / W, y / H), (y * W + x) * 4);
          const texture = new q.m.DataTexture(data, W, H, q.m.RGBAFormat, q.m.FloatType); texture.needsUpdate = true;
          const layer = q.rich(params);
          q.renderer.warpSource(layer, layer, texture, texture, .9, W, H);
          const out = q.linear(W, H); texture.dispose();
          return out;
        };
        const covered = pass((u, v) => { const a = .5 + .5 * Math.sin(u * 40) * Math.cos(v * 23); return [straight[0] * a, straight[1] * a, straight[2] * a, a]; });
        let over = 0, peak = 0;
        for (let i = 0; i < covered.length; i += 4) {
          peak = Math.max(peak, covered[i]);
          if (covered[i + 3] > .01 && (covered[i] / covered[i + 3] > straight[0] * 1.01 || covered[i + 1] / covered[i + 3] > straight[1] * 1.01 || covered[i + 2] / covered[i + 3] > straight[2] * 1.01)) over++;
        }
        const light = pass(() => [.5, .25, .75, 0]);
        let lost = 0;
        for (let i = 0; i < light.length; i += 4) if (Math.abs(light[i] - .5) > .01 || Math.abs(light[i + 1] - .25) > .01 || Math.abs(light[i + 2] - .75) > .01 || light[i + 3] !== 0) lost++;
        return { over, peak, lost };
      });
      return { ok: r.over === 0 && r.peak > 3 && r.lost === 0, detail: `${r.over} pixels above the source's straight colour; peak ${r.peak.toFixed(2)} (over 3); uncovered light changed on ${r.lost} pixels` };
    },
  },
  {
    name: 'liquid-fringe',
    // Liquid moves almost nothing here while Warp moves a lot, so a fringe built on total movement would show.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, at = params => q.px(q.project([q.rich({ liquidStyle: 0, ...params })]));
        const own = q.difference(await at({ liquidAmount: .2 }), await at({ liquidAmount: .2, liquidChroma: 1 }));
        const bent = { bendAmount: .6, bendField: 1, liquidAmount: 1e-5 };
        const borrowed = q.difference(await at(bent), await at({ ...bent, liquidChroma: 1 }));
        return { own, borrowed };
      });
      return { ok: r.own > 1 && r.borrowed < .1, detail: `${r.own <= 1 ? 'Colour fringe has no effect. ' : ''}own movement ${r.own.toFixed(3)} (over 1); with Warp's movement only ${r.borrowed.toFixed(4)} (limit .1)` };
    },
  },
  {
    name: 'liquid-sparkle',
    // Same measure as warp-sparkle, on plain Swirl and on Flow's trail, whose tail reads are the cheap ones.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.wq, W = 3840, H = 2160, url = await q.checkerUrl(W, H), rows = [];
        const plain = await q.shot(q.project([q.image(url, {}, 'checker', W, H)]), .9, W, H);
        for (const look of [{ liquidStyle: 0 }, { liquidStyle: 1, liquidTrail: 1 }]) {
          const scene = () => q.project([q.image(url, { liquidAmount: .22, liquidScale: 7, liquidDetail: 4, liquidCycles: 1, ...look }, 'checker', W, H)]);
          if (q.same(plain, await q.shot(scene(), .9, W, H))) { rows.push({ moved: false }); continue; }
          const energy = async () => {
            const phases = [.9, .92, .94, .96];
            let sum = 0, previous = await q.px(scene(), phases[0], W, H);
            for (const phase of phases.slice(1)) { const next = await q.px(scene(), phase, W, H); sum += q.highFrequency(previous, next, W, H); previous = next; }
            return sum / (phases.length - 1);
          };
          const filtered = await energy();
          const mat = q.renderer.warp, source = mat.fragmentShader, single = source.replace('const int WARP_TAPS = 4;', 'const int WARP_TAPS = 1;');
          if (single === source) throw new Error('WARP_TAPS constant not found');
          mat.fragmentShader = single; mat.needsUpdate = true;
          let tap;
          try { tap = await energy(); } finally { mat.fragmentShader = source; mat.needsUpdate = true; }
          rows.push({ moved: true, filtered, tap });
        }
        return rows;
      });
      const names = ['Swirl', 'Flow with trail'];
      return { ok: rows.every(r => r.moved && r.filtered < r.tap / 2), detail: rows.map((r, i) => r.moved ? `${names[i]} ${r.filtered.toFixed(3)} against single tap ${r.tap.toFixed(3)}, ratio ${(r.filtered / r.tap).toFixed(3)}` : `${names[i]}: ${NO_LIQUID}`).join('; ') + ' (limit .5)' };
    },
  },
  {
    name: 'liquid-chaos',
    // Reads the current itself: Chaos must be the fed-back Ridge plus Vortex's Swirl and spiral, under the speed limit.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540, mat = q.renderer.warp, source = mat.fragmentShader;
        const probe = source.replace('gl_FragColor = vec4(covered + light, g.alpha);', `vec2 P = (vUv - .5) * vec2(uAspect, 1.);
  vec2 want = ridgeCurrent(P + ridgeCurrent(P) * .2 / uLiquidScale) + swirlCurrent(P) + spiralCurrent(P);
  if (length(want) > 1.) want = normalize(want);
  gl_FragColor = vec4(length(liquidCurrent(P) - want), length(want), 0., 1.);`);
        if (probe === source) throw new Error('warp output not found');
        mat.fragmentShader = probe; mat.needsUpdate = true;
        let d;
        try { await q.shot(q.project([q.smooth({ liquidAmount: .5, liquidStyle: 4 })]), .9, W, H); d = q.linear(W, H); }
        finally { mat.fragmentShader = source; mat.needsUpdate = true; }
        let worst = 0, speed = 0;
        for (let i = 0; i < d.length; i += 4) { worst = Math.max(worst, d[i]); speed += d[i + 1]; }
        return { worst, speed: speed / (W * H) };
      });
      return { ok: r.worst < .002 && r.speed > .1, detail: `largest gap from Ridge + Swirl + spiral ${r.worst.toFixed(5)} (limit .002), mean speed ${r.speed.toFixed(3)}` };
    },
  },
  {
    name: 'liquid-tear',
    // A smooth picture has no hard breaks of its own, so any that appear are tears.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540, rough = px => {
          let sum = 0, n = 0;
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const at = (X, Y) => px[(Y * W + X) * 4 + 1]; if (Math.abs(4 * at(x, y) - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1)) > 40) sum++; n++; }
          return sum / n * 100;
        };
        const style = async s => { let sum = 0; for (const phase of [0, 2.1, 4.2]) sum += rough(await q.px(q.project([q.smooth({ liquidAmount: .4, liquidStyle: s })]), phase)); return sum / 3; };
        return { swirl: await style(0), ridge: await style(2), chaos: await style(4) };
      });
      return { ok: r.chaos < TEAR_LIMIT && r.swirl < TEAR_LIMIT && r.ridge < TEAR_LIMIT, detail: `torn pixels on a smooth picture: Swirl ${r.swirl.toFixed(3)}%, Ridge ${r.ridge.toFixed(3)}%, Chaos ${r.chaos.toFixed(3)}% (limit ${TEAR_LIMIT}%)` };
    },
  },
  {
    name: 'liquid-soft-trail',
    // Two straight colours, 1 and 40, in wide bands under fine steep alpha stripes, fringe on. A barely-there trail
    // must not let the bright band on its path loosen the fringe bound for the whole pixel. The trail's own honest
    // share at .001 is about .001 * 40, so the limit is .1.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540;
        const data = new Float32Array(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const u = x / W, v = y / H, a = Math.min(1, Math.max(.02, .5 + 3 * Math.sin(u * 200) * Math.cos(v * 90))), c = Math.floor(u * 5) % 2 ? 40 : 1;
          data.set([c * a, c * a, c * a, a], (y * W + x) * 4);
        }
        const texture = new q.m.DataTexture(data, W, H, q.m.RGBAFormat, q.m.FloatType); texture.needsUpdate = true;
        const pass = trail => { const l = q.rich({ liquidAmount: .35, liquidStyle: 1, liquidChroma: 1, liquidSteps: 8, liquidTrail: trail }); q.renderer.warpSource(l, l, texture, texture, .9, W, H); return q.linear(W, H); };
        const off = pass(0), tiny = pass(.001), full = pass(1);
        texture.dispose();
        const worst = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
        return { jump: worst(off, tiny), full: worst(off, full) };
      });
      return { ok: r.jump < .1 && r.full > 1, detail: `largest change from Trail 0 to .001: ${r.jump.toFixed(4)} (limit .1); to Trail 1: ${r.full.toFixed(2)} (over 1)` };
    },
  },
  {
    name: 'luma-modes',
    run: async ({ page }) => {
      const r = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.rich()])), shots = [];
        for (let mode = 0; mode < count; mode++) shots.push(await q.px(q.project([q.rich({ lumaWarpAmount: .25, lumaWarpMode: mode })])));
        const moved = shots.map(s => q.difference(plain, s));
        let closest = Infinity;
        for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) closest = Math.min(closest, q.difference(shots[a], shots[b]));
        return { moved, closest };
      }, LUMA_MODES.length);
      const ok = r.moved.every(v => v > 3) && r.closest > 3;
      return { ok, detail: `${r.moved.some(v => v <= 3) ? NO_LUMA : ''}moved ${r.moved.map((v, i) => `${LUMA_MODES[i]} ${v.toFixed(2)}`).join(', ')}; closest pair ${r.closest.toFixed(2)} (limits 3)` };
    },
  },
  {
    name: 'luma-channels',
    run: async ({ page }) => {
      const r = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.bars()])), shots = [];
        for (let channel = 0; channel < count; channel++) shots.push(await q.px(q.project([q.bars({ lumaWarpAmount: .25, lumaWarpChannel: channel })])));
        const moved = shots.map(s => q.difference(plain, s));
        let closest = Infinity;
        for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) closest = Math.min(closest, q.difference(shots[a], shots[b]));
        return { moved, closest };
      }, LUMA_CHANNELS.length);
      const ok = r.moved.every(v => v > 1) && r.closest > 1;
      return { ok, detail: `${r.moved.some(v => v <= 1) ? NO_LUMA : ''}moved ${r.moved.map((v, i) => `${LUMA_CHANNELS[i]} ${v.toFixed(2)}`).join(', ')}; closest pair ${r.closest.toFixed(2)} (limits 1)` };
    },
  },
  {
    name: 'luma-below',
    // The top layer is opaque, so any change comes from its own pixels being moved by the shape underneath.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540, drive = { lumaWarpAmount: .3, lumaWarpSource: 1 };
        const plain = await q.px(q.project([q.disc(0), q.rich()]));
        const left = await q.px(q.project([q.disc(0), q.rich(drive)]));
        const right = await q.px(q.project([q.disc(.45), q.rich(drive)]));
        const zones = q.discZones(plain, left, W, H, 0);
        return { ...zones, changedBy: q.difference(left, right) };
      });
      const ok = r.inside > .5 && r.outside < .001 && r.changedBy > 1;
      return { ok, detail: `${r.inside <= .5 ? NO_LUMA : ''}changed inside the shape ${(r.inside * 100).toFixed(1)}% (over 50%), outside ${(r.outside * 100).toFixed(3)}% (limit .1%); moving the shape changes the top by ${r.changedBy.toFixed(2)} (over 1)` };
    },
  },
  {
    name: 'luma-moved',
    // The top layer is moved, scaled and turned, on an image and on a generated source. Its source is already in frame
    // coordinates, so the bend must stay on the shape's place on screen. The shape sits off-centre so any misread shows.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540, rows = [], transform = { x: .12, y: -.08, scale: 1.6, rotation: .5 };
        const place = l => { l.transform = { ...transform }; return l; };
        for (const [name, make] of [['image', q.rich], ['generated', q.moving]]) {
          const drive = () => { const l = place(make()); Object.assign(l.params, { lumaWarpAmount: .3, lumaWarpSource: 1 }); return l; };
          const still = await q.px(q.project([q.disc(.45), make()]));
          const plain = await q.px(q.project([q.disc(.45), place(make())]));
          const bent = await q.px(q.project([q.disc(.45), drive()]));
          rows.push({ name, placed: q.difference(still, plain), ...q.discZones(plain, bent, W, H, .45) });
        }
        return rows;
      });
      const ok = rows.every(r => r.placed > 1 && r.inside > .5 && r.outside < .001);
      return { ok, detail: rows.map(r => `${r.name}: transform moved the layer ${r.placed.toFixed(2)} (over 1), changed inside the shape ${(r.inside * 100).toFixed(1)}% (over 50%), outside ${(r.outside * 100).toFixed(3)}% (limit .1%)`).join('; ') };
    },
  },
  {
    name: 'luma-bottom',
    // A hidden layer draws nothing, so a layer above it is still the bottom of the picture.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, drive = { lumaWarpAmount: .6, lumaWarpSource: 1 };
        const plain = await q.px(q.project([q.rich()]));
        const alone = await q.px(q.project([q.rich(drive)]));
        const hidden = q.disc(0); hidden.visible = false;
        const over = await q.px(q.project([hidden, q.rich(drive)]));
        const control = await q.px(q.project([q.disc(0), q.rich(drive)]));
        return { alone: q.difference(plain, alone), over: q.difference(plain, over), control: q.difference(plain, control) };
      });
      return { ok: r.alone < 1 && r.over < 1 && r.control > 1, detail: `alone ${r.alone.toFixed(4)}, over a hidden layer ${r.over.toFixed(4)} (limit 1); with a real layer below ${r.control.toFixed(2)} (over 1)` };
    },
  },
  {
    name: 'luma-order',
    // The layer below animates. A top layer reading any other frame's composite would depend on what was drawn before.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, scene = () => q.project([q.moving(), q.rich({ lumaWarpAmount: .3, lumaWarpSource: 1 })]);
        await q.shot(scene(), .3); await q.shot(scene(), .6);
        const sequence = await q.shot(scene(), .9);
        await q.shot(scene(), 4.4);
        const sought = await q.shot(scene(), .9);
        const other = await q.shot(scene(), 2.2);
        const [a, b] = await Promise.all([sequence, other].map(q.pixels));
        return { same: q.same(sequence, sought), follows: q.difference(a, b) };
      });
      return { ok: r.same && r.follows > 1, detail: `after a seek ${r.same ? 'byte-identical' : 'differs'}; another frame differs by ${r.follows.toFixed(2)} (over 1)` };
    },
  },
  {
    name: 'luma-read',
    // Luma composes after Warp. This layer is read where Warp has already moved the pixel. The layer below is read at
    // the pixel itself, because it is not bent by this layer's Warp. Pixels with no driver must not move.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540, bend = { bendAmount: .35, bendField: 0, bendScale: 2 };
        const bentHalf = await q.px(q.project([q.halfRed(bend)]));
        const lumaHalf = await q.px(q.project([q.halfRed({ ...bend, lumaWarpAmount: .25, lumaWarpChannel: 1, lumaWarpSoft: 0 })]));
        let dark = 0, moved = 0, bright = 0, brightMoved = 0;
        for (let i = 0; i < bentHalf.length; i += 4) {
          const changed = Math.abs(bentHalf[i + 1] - lumaHalf[i + 1]) > 3;
          if (bentHalf[i] < 10) { dark++; if (changed) moved++; }
          else if (bentHalf[i] > 200) { bright++; if (changed) brightMoved++; }
        }
        const plain = await q.px(q.project([q.disc(0), q.rich(bend)]));
        const driven = await q.px(q.project([q.disc(0), q.rich({ ...bend, lumaWarpAmount: .3, lumaWarpSource: 1 })]));
        return { self: moved / dark, selfBright: brightMoved / bright, ...q.discZones(plain, driven, W, H, 0) };
      });
      const ok = r.self < .002 && r.selfBright > .3 && r.inside > .5 && r.outside < .001;
      return { ok, detail: `this layer: moved where the bent read is dark ${(r.self * 100).toFixed(3)}% (limit .2%), where bright ${(r.selfBright * 100).toFixed(1)}% (over 30%); layer below: inside the shape ${(r.inside * 100).toFixed(1)}% (over 50%), outside ${(r.outside * 100).toFixed(3)}% (limit .1%)` };
    },
  },
  {
    name: 'luma-driver',
    // The source is a ramp equal to its own height, so output minus height is exactly how far the pixel moved.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.wq, amount = .4, tone = v => v ** (1 / 2.2);
        const cases = [
          { name: 'half-covered white', below: [.5, .5, .5, .5], channel: 0, driver: .5 },
          { name: 'half-covered red, Red', below: [.5, 0, 0, .5], channel: 1, driver: .5 },
          { name: 'opaque linear .25', below: [.25, .25, .25, 1], channel: 0, driver: tone(.25) },
          { name: 'opaque blue, Saturation', below: [0, 0, .5, 1], channel: 4, driver: 1 },
          { name: 'uncovered light', below: [.8, .8, .8, 0], channel: 0, driver: 0 },
          { name: 'linear .25 over threshold .4', below: [.25, .25, .25, 1], channel: 0, threshold: .4, driver: (tone(.25) - .4) / .6 },
        ];
        return cases.map(c => {
          const moved = q.rampMove({ lumaWarpAmount: amount, lumaWarpSource: 1, lumaWarpChannel: c.channel, lumaWarpThreshold: c.threshold ?? 0, lumaWarpAngle: 90, lumaWarpSoft: 0 }, c.below);
          return { name: c.name, moved, want: amount * .5 * c.driver };
        });
      });
      return { ok: rows.every(r => Math.abs(r.moved - r.want) < .004), detail: `${rows.map(r => `${r.name} ${r.moved.toFixed(4)} (want ${r.want.toFixed(4)})`).join(', ')} (limit .004)` };
    },
  },
  {
    name: 'luma-soft',
    // A hard step in the layer below, white above mid-height. At softness 1 the blur reaches .03 of the frame height:
    // .04 away the driver is settled, and .02 away it is still partly blurred.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540, amount = .2;
        const out = q.feed({ lumaWarpAmount: amount, lumaWarpSource: 1, lumaWarpAngle: 90, lumaWarpSoft: 1 }, (u, v) => [v, v, v, 1], (u, v) => v > .5 ? [1, 1, 1, 1] : [0, 0, 0, 1]);
        const driver = offset => { const y = Math.round((.5 + offset) * H - .5), i = (y * W + (W >> 1)) * 4; return (out[i + 1] - (y + .5) / H) / (amount * .5); };
        return { far: driver(.04), near: driver(.02), under: driver(-.04) };
      });
      return { ok: r.far > .98 && r.near > .5 && r.near < .98 && Math.abs(r.under) < .02, detail: `driver .04 above the step ${r.far.toFixed(3)} (over .98), .02 above ${r.near.toFixed(3)} (between .5 and .98), .04 below ${r.under.toFixed(3)} (under .02)` };
    },
  },
  {
    name: 'luma-fringe',
    // Luma moves almost nothing here while Warp moves a lot, so a fringe built on total movement would show.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, at = params => q.px(q.project([q.rich(params)]));
        const own = q.difference(await at({ lumaWarpAmount: .2 }), await at({ lumaWarpAmount: .2, lumaWarpChroma: 1 }));
        const bent = { bendAmount: .6, bendField: 1, lumaWarpAmount: 1e-5 };
        const borrowed = q.difference(await at(bent), await at({ ...bent, lumaWarpChroma: 1 }));
        return { own, borrowed };
      });
      return { ok: r.own > 1 && r.borrowed < .1, detail: `${r.own <= 1 ? 'Colour fringe has no effect. ' : ''}own movement ${r.own.toFixed(3)} (over 1); with Warp's movement only ${r.borrowed.toFixed(4)} (limit .1)` };
    },
  },
  {
    name: 'luma-light',
    // Straight colour is the same over-range white across a soft ramp, so anything above 4 was invented by the fringe.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540, params = { lumaWarpAmount: .35, lumaWarpMode: 1, lumaWarpChroma: 1 };
        const covered = q.feed(params, (u, v) => { const a = .5 + .5 * Math.sin(u * 40) * Math.cos(v * 23); return [4 * a, 4 * a, 4 * a, a]; });
        let over = 0, peak = 0;
        for (let i = 0; i < covered.length; i += 4) {
          peak = Math.max(peak, covered[i]);
          if (covered[i + 3] > .01 && Math.max(covered[i], covered[i + 1], covered[i + 2]) / covered[i + 3] > 4 * 1.01) over++;
        }
        const light = q.feed(params, () => [.5, .25, .75, 0]);
        let lost = 0;
        for (let i = 0; i < light.length; i += 4) if (Math.abs(light[i] - .5) > .01 || Math.abs(light[i + 1] - .25) > .01 || Math.abs(light[i + 2] - .75) > .01 || light[i + 3] !== 0) lost++;
        return { over, peak, lost, size: W * H };
      });
      return { ok: r.over === 0 && r.peak > 3 && r.lost === 0, detail: `${r.over} pixels above the source's straight colour; peak ${r.peak.toFixed(2)} (over 3); uncovered light changed on ${r.lost} pixels` };
    },
  },
  {
    name: 'luma-engage',
    // Judged at the warp pass on a smooth source, in every mode and from both drivers, against the source itself:
    // measured against another Luma render, a jump present at every amount would cancel out.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, rows = [], fill = (u, v) => [.5 + .3 * Math.sin(3 * u + .4), .5 + .3 * Math.cos(4 * v - .7), .5 + .2 * Math.sin(2 * u + 3 * v), 1];
        const below = (u, v) => [.5 + .4 * Math.sin(5 * u), .5 + .4 * Math.cos(4 * v), .5, 1];
        const worst = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
        const W = 960, H = 540, zero = new Float32Array(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) zero.set(fill((x + .5) / W, (y + .5) / H), (y * W + x) * 4);
        for (let mode = 0; mode < count; mode++) for (const source of [0, 1]) {
          const base = { lumaWarpMode: mode, lumaWarpSource: source, lumaWarpChroma: .5 };
          const tiny = q.feed({ ...base, lumaWarpAmount: 1e-4 }, fill, below);
          const full = q.feed({ ...base, lumaWarpAmount: 1 }, fill, below);
          rows.push({ mode, source, tiny: worst(zero, tiny), full: worst(zero, full) });
        }
        return rows;
      }, LUMA_MODES.length);
      const ok = rows.every(r => r.tiny < .001 && r.full > .01);
      return { ok, detail: `${rows.some(r => r.full <= .01) ? NO_LUMA : ''}${rows.map(r => `${LUMA_MODES[r.mode]}/${r.source ? 'below' : 'this'} ${r.tiny.toFixed(6)} (full ${r.full.toFixed(3)})`).join(', ')} (limit .001)` };
    },
  },
  {
    name: 'luma-loop',
    // Luma has no motion of its own: it follows its driver, so the animated layer below must carry it round the loop.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.shot(q.project([q.moving(), q.smooth()]), 0), rows = [];
        for (let mode = 0; mode < count; mode++) {
          const p = q.project([q.moving(), q.smooth({ lumaWarpAmount: .3, lumaWarpSource: 1, lumaWarpMode: mode, lumaWarpChroma: .3 })]);
          rows.push({ ...await q.loop(p), moved: !q.same(await q.shot(p, 0), plain) });
        }
        return rows;
      }, LUMA_MODES.length);
      const verdicts = rows.map(r => loopVerdict(r));
      return { ok: rows.every((r, i) => r.moved && verdicts[i].ok), detail: `${rows.some(r => !r.moved) ? NO_LUMA : ''}${verdicts.map((v, i) => `${LUMA_MODES[i]} ${v.detail}`).join('; ')}` };
    },
  },
  {
    name: 'luma-scale',
    // The move itself is compared on the busy picture, in shares of frame height. Edges and Contours fold that picture
    // so tightly that a 1x frame cannot resolve it (1x against 2x 5.7, 2x against 4x 1.9, with the same move), so their
    // picture comparison uses the smooth source. Push is compared on the busy picture.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, W = 960, H = 540, mat = q.renderer.warp, source = mat.fragmentShader, rows = [];
        const probe = source.replace('gl_FragColor = vec4(covered + light, g.alpha);', 'gl_FragColor = vec4((warped - vUv) * vec2(uAspect, 1.), 0., 1.);');
        if (probe === source) throw new Error('warp output not found');
        const shrink = big => { const o = new Float32Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 2; c++) { const at = (X, Y) => big[(Y * 2 * W + X) * 4 + c]; o[(y * W + x) * 4 + c] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4; } return o; };
        for (let mode = 0; mode < count; mode++) {
          const picture = mode === 0 ? q.rich : q.smooth, params = { lumaWarpAmount: .3, lumaWarpMode: mode };
          // The smooth picture has gentle slopes, so Edges and Contours need the full amount to move it visibly.
          const shown = { ...params, lumaWarpAmount: mode === 0 ? .3 : 1 };
          const plain = await q.px(q.project([picture()]));
          const p = () => q.project([picture({ ...shown, lumaWarpChroma: .3 })]);
          const small = await q.px(p()), big = await q.px(p(), .9, W * 2, H * 2);
          const busy = () => q.project([q.rich(params)]);
          mat.fragmentShader = probe; mat.needsUpdate = true;
          let a, b;
          try { await q.shot(busy(), .9, W, H); a = q.linear(W, H); await q.shot(busy(), .9, W * 2, H * 2); b = shrink(q.linear(W * 2, H * 2)); }
          finally { mat.fragmentShader = source; mat.needsUpdate = true; }
          let gap = 0, size = 0;
          for (let i = 0; i < a.length; i += 4) { gap += Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]); size += Math.hypot(a[i], a[i + 1]); }
          rows.push({ difference: q.difference(small, q.halved(big, W, H)), moved: q.difference(plain, small), share: gap / size });
        }
        return rows;
      }, LUMA_MODES.length);
      return { ok: rows.every(r => r.moved > 1 && r.difference < 2 && r.share < .01), detail: `${rows.some(r => r.moved <= 1) ? NO_LUMA : ''}${rows.map((r, i) => `${LUMA_MODES[i]} picture ${r.difference.toFixed(3)}, move differs ${(r.share * 100).toFixed(2)}%`).join(', ')} (limits 2 and 1%)` };
    },
  },
  {
    name: 'luma-edge',
    // A diagonal push, because a push along one axis leaves the rim on the other axis exactly where it belongs.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, W = 960, H = 540, scene = params => { const p = q.project([q.rimmed(params)], true); p.highlights = 'exact'; return p; };
        const plain = await q.px(scene({})), base = q.edgeStats(plain, W, H), rows = [];
        for (let mode = 0; mode < count; mode++) {
          const px = await q.px(scene({ lumaWarpAmount: 1, lumaWarpMode: mode, lumaWarpAngle: 45 }));
          let gaps = 0; for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) gaps++;
          rows.push({ gaps, ...q.edgeStats(px, W, H), moved: q.difference(plain, px), baseArea: base.area });
        }
        return rows;
      }, LUMA_MODES.length);
      const ok = rows.every(r => r.moved > 3 && r.gaps === 0 && r.longest < STREAK_LIMIT && r.area < r.baseArea * RIM_AREA_LIMIT && r.line < .5);
      return { ok, detail: `${rows.some(r => r.moved <= 3) ? NO_LUMA : ''}edge colour covers ${(rows[0].baseArea * 100).toFixed(2)}% unwarped; ${rows.map((r, i) => `${LUMA_MODES[i]} gaps ${r.gaps} edge ${(r.area * 100).toFixed(2)}% line ${(r.line * 100).toFixed(0)}% run ${r.longest}`).join(', ')} (limits ${RIM_AREA_LIMIT}x area, 50% of a line, run < ${STREAK_LIMIT})` };
    },
  },
  {
    name: 'polar-modes',
    // The read position itself, so "between" is exact: amount .5 must be the midpoint of plain and full.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.wq, plain = await q.px(q.project([q.rich()])), rows = [], shots = [];
        for (const mode of [0, 1]) {
          const full = await q.px(q.project([q.rich({ polarAmount: 1, polarMode: mode })]));
          shots.push(full);
          const at = amount => q.probe('vec4(warped, 0., 1.)', { polarAmount: amount, polarMode: mode });
          const none = q.probe('vec4(vUv, 0., 1.)', { polarAmount: 1, polarMode: mode }), whole = at(1), half = at(.5);
          let gap = 0;
          for (let i = 0; i < half.length; i += 4) gap = Math.max(gap, Math.abs(half[i] - (none[i] + whole[i]) / 2), Math.abs(half[i + 1] - (none[i + 1] + whole[i + 1]) / 2));
          rows.push({ moved: q.difference(plain, full), gap });
        }
        return { rows, apart: q.difference(shots[0], shots[1]) };
      });
      const ok = rows.rows.every(r => r.moved > 3 && r.gap < .003) && rows.apart > 3;
      return { ok, detail: `${rows.rows.map((r, i) => `${POLAR_NAMES[i]} moved ${r.moved.toFixed(2)}, off the midpoint ${r.gap.toFixed(5)}`).join('; ')}; modes differ ${rows.apart.toFixed(2)} (limits 3 and .003)` };
    },
  },
  {
    name: 'polar-seam',
    // Twist bends the wrap into a spiral, so steps are taken across that path, on both lines where the angle folds.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.wq, rows = [];
        for (const [W, H] of [[960, 540], [720, 900]]) for (const polarTwist of [0, .5, -1.25]) for (const polarAmount of [1, .6]) {
          const px = await q.px(q.project([q.smooth({ polarAmount, polarTwist })]), .9, W, H);
          const moved = q.difference(px, await q.px(q.project([q.smooth()]), .9, W, H));
          const a = W / H, reach = Math.hypot(a / 2, .5), top = Math.min(a, 1) * .47;
          const read = (x, y, c) => {
            const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, at = (X, Y) => px[(Y * W + X) * 4 + c];
            return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
          };
          // d is pixels along the arc from the fold line at this radius. Screen rows run down, the pass's run up.
          const point = (r, line, d) => { const t = line - Math.PI * 2 * polarTwist * r / reach + d / (r * H); return [r * Math.sin(t) * H + W / 2 - .5, H / 2 - r * Math.cos(t) * H - .5]; };
          const step = (line, d) => {
            let sum = 0, n = 0;
            for (let r = .09; r < top; r += 1.5 / H) {
              const [x0, y0] = point(r, line, d), [x1, y1] = point(r, line, d + 1);
              for (let c = 0; c < 3; c++) sum += Math.abs(read(x0, y0, c) - read(x1, y1, c));
              n += 3;
            }
            return sum / n;
          };
          for (const line of [Math.PI, 0]) {
            const around = [-6.5, -5.5, -4.5, -3.5, 2.5, 3.5, 4.5, 5.5].map(d => step(line, d));
            rows.push({ W, H, polarTwist, polarAmount, line, moved, seam: step(line, -.5), near: around.reduce((x, y) => x + y) / around.length });
          }
        }
        return rows;
      });
      const worst = rows.reduce((a, r) => (r.seam / Math.max(r.near, .05) > a.seam / Math.max(a.near, .05) ? r : a));
      const ok = rows.every(r => r.moved > 1 && r.seam <= Math.max(r.near, .05) * 1.25);
      return { ok, detail: `${rows.some(r => r.moved <= 1) ? 'Polar does not change the render. ' : ''}${rows.length} paths; worst ${worst.W}x${worst.H} twist ${worst.polarTwist} amount ${worst.polarAmount}: step ${worst.seam.toFixed(3)} against neighbours ${worst.near.toFixed(3)} (limit 1.25x)` };
    },
  },
  {
    name: 'polar-engage',
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.wq, W = 960, H = 540, rows = [], zero = new Float32Array(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) zero.set(q.smoothFill((x + .5) / W, (y + .5) / H), (y * W + x) * 4);
        for (const mode of [0, 1]) {
          const tiny = q.feed({ polarAmount: 1e-4, polarMode: mode, polarTwist: 1 }, q.smoothFill);
          const full = q.feed({ polarAmount: 1, polarMode: mode }, q.smoothFill);
          rows.push({ tiny: q.worst(zero, tiny), full: q.worst(zero, full) });
        }
        return rows;
      });
      return { ok: rows.every(r => r.tiny < .001 && r.full > .01), detail: `${rows.map((r, i) => `${POLAR_NAMES[i]} ${r.tiny.toFixed(6)} (full ${r.full.toFixed(3)})`).join(', ')} (limit .001)` };
    },
  },
  {
    name: 'polar-shape',
    // The radius must be true distance in frame heights at any frame shape. Centre X is a share of frame height. Centre Y
    // must go the way a layer's Y does, measured from a real moved layer rather than assumed.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.wq, rows = [];
        for (const [W, H] of [[960, 540], [720, 900]]) for (const [cx, cy] of [[0, 0], [.2, .15]]) {
          const out = q.probe('vec4(warped, 0., 1.)', { polarAmount: 1, polarCentreX: cx, polarCentreY: cy }, W, H), a = W / H;
          const reach = Math.hypot(a / 2 + Math.abs(cx), .5 + Math.abs(cy));
          let radial = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const want = Math.hypot(((x + .5) / W - .5) * a - cx, (y + .5) / H - .5 + cy) / reach;
            radial = Math.max(radial, Math.abs(out[(y * W + x) * 4 + 1] - want));
          }
          // Bright along the foot of the picture, which wrapping gathers at the circle's centre.
          const px = await q.px(q.project([q.image(await q.headUrl(W, H), { polarAmount: 1, polarCentreX: cx, polarCentreY: cy }, `head-${W}`, W, H)]), .9, W, H);
          const moved = q.discLayer(0); moved.transform = { ...moved.transform, x: cx, y: cy };
          const placed = q.brightCentre(await q.px(q.project([moved]), .9, W, H), W, H, 128);
          const seen = q.brightCentre(px, W, H, 235);
          rows.push({ W, H, radial, dx: seen.x - cx, dy: seen.y - placed.y });
        }
        return rows;
      });
      const ok = rows.every(r => r.radial < .003 && Math.abs(r.dx) < .02 && Math.abs(r.dy) < .02);
      return { ok, detail: `${rows.map(r => `${r.W}x${r.H} radius off ${r.radial.toFixed(5)}, centre off ${r.dx.toFixed(3)},${r.dy.toFixed(3)}`).join('; ')} (limits .003 and .02)` };
    },
  },
  {
    name: 'polar-footprint',
    // An odd half-width puts the wrap line inside a 2x2 shading block, where a derivative of the folded coordinate is
    // wrong. The footprint across the wrap must match the columns either side of it.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.wq, W = 962, H = 542, rows = [];
        for (const polarAmount of [1, .6]) {
          const out = q.probe('vec4(footprint, 0., 1.)', { polarAmount }, W, H);
          const mid = W / 2 - 1;
          let worst = 0;
          for (let y = 12; y < H - 12; y++) {
            if (Math.abs(y - H / 2) < 40) continue;
            for (const c of [0, 1]) {
              const at = x => out[(y * W + x) * 4 + c];
              // Part way, the position has a true kink at the wrap, so each column is compared with its own side.
              for (const [x, near] of [[mid, (at(mid - 2) + at(mid - 3)) / 2], [mid + 1, (at(mid + 3) + at(mid + 4)) / 2]]) worst = Math.max(worst, Math.abs(at(x) - near) / Math.max(near, .05));
            }
          }
          rows.push({ polarAmount, worst });
        }
        return rows;
      });
      return { ok: rows.every(r => r.worst < .25), detail: `${rows.map(r => `amount ${r.polarAmount}: footprint at the wrap differs from its neighbours by ${(r.worst * 100).toFixed(1)}%`).join('; ')} (limit 25%)` };
    },
  },
  {
    name: 'polar-luma',
    // This layer's driver is read where Polar put the pixel. Red marks the right half of the source, so a pixel whose
    // Polar read is dark has no driver and must not move, wherever it sits on screen.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => q_lumaStage(window.wq, { polarAmount: 1 }));
      return lumaStageVerdict(r);
    },
  },
  {
    name: 'polar-fringe',
    // Polar's own movement is large and must add nothing. A Warp fringe on top is exactly Warp's own movement.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => q_fringeStage(window.wq, { polarAmount: 1 }));
      return fringeStageVerdict(r);
    },
  },
  {
    name: 'mirror-symmetry',
    // A busy picture for the flips, in a wide and a tall frame. A smooth one for the turn, which has to be resampled.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, flips = [], turns = [];
        for (const [W, H] of [[960, 540], [720, 900]]) {
          for (const [mode, h, v] of [[0, true, false], [1, false, true], [2, true, true]]) {
            const px = await q.px(q.project([q.rich({ mirrorAmount: 1, mirrorMode: mode })]), .9, W, H);
            const plain = await q.px(q.project([q.rich()]), .9, W, H);
            let worst = 0, kept = 0;
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
              const a = px[(y * W + x) * 4 + c];
              if (h) worst = Math.max(worst, Math.abs(a - px[(y * W + W - 1 - x) * 4 + c]));
              if (v) worst = Math.max(worst, Math.abs(a - px[((H - 1 - y) * W + x) * 4 + c]));
              // The left and top of the picture are the parts kept.
              if ((!h || x < W / 2 - 2) && (!v || y < H / 2 - 2)) kept = Math.max(kept, Math.abs(a - plain[(y * W + x) * 4 + c]));
            }
            flips.push({ W, H, mode, worst, kept, moved: q.difference(plain, px) });
          }
          const px = await q.px(q.project([q.smooth({ mirrorAmount: 1, mirrorMode: 3, mirrorSegments: 6 })]), .9, W, H);
          const plain = await q.px(q.project([q.smooth()]), .9, W, H);
          const side = Math.min(W, H), radius = side * .46, cos = Math.cos(Math.PI / 3), sin = Math.sin(Math.PI / 3);
          const read = (x, y, c) => {
            const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, at = (X, Y) => px[(Y * W + X) * 4 + c];
            return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
          };
          let worst = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const dx = x + .5 - W / 2, dy = y + .5 - H / 2;
            if (Math.hypot(dx, dy) > radius) continue;
            const tx = cos * dx - sin * dy + W / 2 - .5, ty = sin * dx + cos * dy + H / 2 - .5;
            for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(px[(y * W + x) * 4 + c] - read(tx, ty, c)));
          }
          turns.push({ W, H, worst, moved: q.difference(plain, px) });
        }
        return { flips, turns };
      });
      const ok = r.flips.every(f => f.worst <= 2 && f.kept <= 2 && f.moved > 1) && r.turns.every(t => t.worst <= 4 && t.moved > 1);
      return { ok, detail: `${r.flips.map(f => `${f.W}x${f.H} ${MIRROR_NAMES[f.mode]} ${f.worst} (kept side off ${f.kept})`).join(', ')} (limit 2); ${r.turns.map(t => `${t.W}x${t.H} Kaleidoscope turn ${t.worst.toFixed(2)}`).join(', ')} (limit 4)` };
    },
  },
  {
    name: 'mirror-turns',
    // 1.5 is deliberately not whole: the renderer must round it, or the seam opens.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, rows = [];
        for (let mode = 0; mode < count; mode++) for (const mirrorTurns of [2, 1.5]) {
          const p = q.project([q.smooth({ mirrorAmount: 1, mirrorMode: mode, mirrorTurns })]);
          const still = await q.shot(q.project([q.smooth({ mirrorAmount: 1, mirrorMode: mode })]), 1.1);
          rows.push({ mode, mirrorTurns, ...await q.loop(p), moved: !q.same(await q.shot(p, 1.1), still) });
        }
        return rows;
      }, MIRROR_NAMES.length);
      const verdicts = rows.map(r => loopVerdict(r));
      return { ok: rows.every((r, i) => r.moved && verdicts[i].ok), detail: `${rows.some(r => !r.moved) ? 'Turns do not move the mirror. ' : ''}${verdicts.map((v, i) => `${MIRROR_NAMES[rows[i].mode]} ${rows[i].mirrorTurns} turns ${v.detail}`).join('; ')}` };
    },
  },
  {
    name: 'mirror-engage',
    // Judged at the pass against the source. Half way must be the plain and mirrored pictures mixed evenly.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, W = 960, H = 540, rows = [], zero = new Float32Array(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) zero.set(q.smoothFill((x + .5) / W, (y + .5) / H), (y * W + x) * 4);
        for (let mode = 0; mode < count; mode++) {
          const tiny = q.feed({ mirrorAmount: 1e-4, mirrorMode: mode }, q.smoothFill);
          const full = q.feed({ mirrorAmount: 1, mirrorMode: mode }, q.smoothFill);
          const half = q.feed({ mirrorAmount: .5, mirrorMode: mode }, q.smoothFill);
          let mix = 0;
          for (let i = 0; i < half.length; i++) mix = Math.max(mix, Math.abs(half[i] - (zero[i] + full[i]) / 2));
          rows.push({ tiny: q.worst(zero, tiny), full: q.worst(zero, full), mix });
        }
        return rows;
      }, MIRROR_NAMES.length);
      return { ok: rows.every(r => r.tiny < .001 && r.full > .01 && r.mix < .002), detail: `${rows.map((r, i) => `${MIRROR_NAMES[i]} ${r.tiny.toFixed(6)} (full ${r.full.toFixed(3)}, off the even mix ${r.mix.toFixed(5)})`).join(', ')} (limits .001 and .002)` };
    },
  },
  {
    name: 'mirror-footprint',
    // A fold only reflects, so a pixel always covers the same area: the two footprint axes sum to at least 2 texels.
    // An odd half-size puts the fold inside a 2x2 shading block, where a derivative of the folded coordinate collapses.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, W = 962, H = 542, rows = [];
        for (let mode = 0; mode < count; mode++) for (const mirrorAngle of [0, 17]) {
          const out = q.probe('vec4(footprint, 0., 1.)', { mirrorAmount: 1, mirrorMode: mode, mirrorAngle }, W, H);
          let low = Infinity, collapsed = 0;
          for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
            if (Math.hypot(x + .5 - W / 2, y + .5 - H / 2) < 3) continue;
            const sum = out[(y * W + x) * 4] + out[(y * W + x) * 4 + 1];
            low = Math.min(low, sum); if (sum < 1.95) collapsed++;
          }
          rows.push({ mode, mirrorAngle, low, collapsed });
        }
        return rows;
      }, MIRROR_NAMES.length);
      return { ok: rows.every(r => r.collapsed === 0), detail: `${rows.map(r => `${MIRROR_NAMES[r.mode]} ${r.mirrorAngle}deg low ${r.low.toFixed(3)}, collapsed ${r.collapsed}`).join(', ')} (limit 1.95)` };
    },
  },
  {
    name: 'mirror-reach',
    // A reflection covers exactly one texel per pixel at every angle, so Mirror alone must never spread its reads.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, W = 962, H = 542, rows = [];
        for (let mode = 0; mode < count; mode++) for (const mirrorAngle of [0, 17, 22.5, 45, 67.5, 101, -33]) {
          const out = q.probe('vec4(tapReach(footprint) * uResolution, 0., 1.)', { mirrorAmount: 1, mirrorMode: mode, mirrorAngle }, W, H);
          let most = 0;
          for (let i = 0; i < out.length; i += 4) most = Math.max(most, out[i], out[i + 1]);
          rows.push({ mode, mirrorAngle, most });
        }
        return rows;
      }, MIRROR_NAMES.length);
      const worst = rows.reduce((a, r) => r.most > a.most ? r : a);
      return { ok: rows.every(r => r.most < .01), detail: `${rows.length} mode and angle pairs; widest spread ${worst.most.toFixed(4)} texels at ${MIRROR_NAMES[worst.mode]} ${worst.mirrorAngle}deg (limit .01)` };
    },
  },
  {
    name: 'mirror-sharp',
    // Fine detail at many orientations, so the kept and reflected sides hold the same amount of it. A reflected read
    // lands between texels and loses a little to one bilinear read; a spread of four reads loses far more.
    run: async ({ page }) => {
      const rows = await page.evaluate(async names => {
        const q = window.wq, W = 960, H = 540, rows = [];
        const fill = (u, v) => { const x = u * W, y = v * H; let t = 0; for (const [a, l] of [[.3, 5.3], [1.1, 6.1], [1.9, 5.7], [2.7, 6.7]]) t += Math.sin(Math.PI * 2 * (x * Math.cos(a) + y * Math.sin(a)) / l); const g = .5 + .1 * t; return [g, g, g, 1]; };
        const detail = (out, keep) => {
          let sum = 0, n = 0;
          for (let y = 12; y < H - 12; y++) for (let x = 12; x < W - 12; x++) {
            if (!keep(x, y)) continue;
            const at = (X, Y) => out[(Y * W + X) * 4 + 1];
            sum += Math.abs(4 * at(x, y) - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1)); n++;
          }
          return sum / n;
        };
        for (const mode of [0, 1]) for (const mirrorAngle of [22.5, 45, 17]) {
          const out = q.feed({ mirrorAmount: 1, mirrorMode: mode, mirrorAngle }, fill), t = mirrorAngle * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
          const signed = (x, y) => { const px = (x + .5 - W / 2), py = (y + .5 - H / 2), rx = c * px + s * py, ry = -s * px + c * py; return mode === 0 ? -rx : ry; };
          const kept = detail(out, (x, y) => signed(x, y) > 4), reflected = detail(out, (x, y) => signed(x, y) < -4);
          rows.push({ name: `${names[mode]} ${mirrorAngle}deg`, kept, reflected, ratio: reflected / kept });
        }
        const plain = q.feed({ polarAmount: 1e-9 }, fill), wedge = q.feed({ mirrorAmount: 1, mirrorMode: 3 }, fill), all = () => true;
        rows.push({ name: 'Kaleidoscope default', kept: detail(plain, all), reflected: detail(wedge, all), ratio: detail(wedge, all) / detail(plain, all) });
        return rows;
      }, MIRROR_NAMES);
      return { ok: rows.every(r => r.ratio > .88), detail: `${rows.map(r => `${r.name} ${r.ratio.toFixed(3)}`).join(', ')} (reflected detail over kept, limit .88)` };
    },
  },
  {
    name: 'mirror-stack-sparkle',
    // Strong Warp over a fold, with the fold inside a 2x2 block. Warp's own squeeze must still count on the fold line,
    // where a screen derivative of its move cancels between the two mirrored pixels.
    run: async ({ page }) => {
      const rows = await page.evaluate(async () => {
        const q = window.wq, W = 962, H = 542, rows = [], mid = W / 2 - 1;
        for (const look of [{ bendAmount: .5, bendField: 0, bendScale: 9, bendAngle: 0 }, { liquidAmount: .6, liquidStyle: 0, liquidScale: 9 }]) {
          const out = q.probe('vec4(footprint, 0., 1.)', { mirrorAmount: 1, mirrorMode: 0, ...look }, W, H);
          const wide = (x, y) => Math.max(out[(y * W + x) * 4], out[(y * W + x) * 4 + 1]);
          // The same measure on columns away from the fold shows how much the field itself varies over three pixels.
          const measure = column => {
            let under = 0, squeezed = 0;
            for (let y = 12; y < H - 12; y++) {
              const near = (wide(column - 2, y) + wide(column - 3, y)) / 2;
              if (near < 1.5) continue;
              squeezed++;
              if (wide(column, y) < near * .7) under++;
            }
            return { squeezed, share: under / Math.max(squeezed, 1) };
          };
          const fold = measure(mid), away = [-24, -48, -72, -96].map(d => measure(mid + d).share);
          rows.push({ ...fold, control: Math.max(...away) });
        }
        return rows;
      });
      return { ok: rows.every(r => r.squeezed > 40 && r.share < r.control + .05), detail: `${rows.map((r, i) => `${['Warp', 'Liquid'][i]}: ${r.squeezed} squeezed rows, ${(r.share * 100).toFixed(1)}% under-read at the fold, ${(r.control * 100).toFixed(1)}% on plain columns`).join('; ')} (limit: plain columns + 5 points)` };
    },
  },
  {
    name: 'mirror-luma',
    // The kept wedge straddles the middle of the source, so its picture holds both red and dark, each carried to new
    // places on screen. A driver read at the unfolded pixel would move the dark parts.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => q_lumaStage(window.wq, { mirrorAmount: 1, mirrorMode: 3, mirrorSegments: 5, mirrorAngle: 72 }));
      return lumaStageVerdict(r);
    },
  },
  {
    name: 'mirror-fringe',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => q_fringeStage(window.wq, { mirrorAmount: 1, mirrorMode: 3 }));
      return fringeStageVerdict(r);
    },
  },
  {
    name: 'mirror-full',
    // The plain read is poisoned with NaN, which survives a mix at weight 0. At amount 1 it must not run at all.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, mat = q.renderer.warp, source = mat.fragmentShader, marker = 'void picture(bool folded) {';
        const poisoned = source.replace(marker, `${marker}\n  if (!folded) { float none = uMirrorAmount - uMirrorAmount; gl_FragColor = vec4(none / none); return; }`);
        if (poisoned === source) throw new Error('picture() not found');
        const bad = out => { let n = 0; for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) n++; return n; };
        mat.fragmentShader = poisoned; mat.needsUpdate = true;
        let full, half;
        try { full = bad(q.feed({ mirrorAmount: 1, mirrorMode: 2 }, q.smoothFill)); half = bad(q.feed({ mirrorAmount: .5, mirrorMode: 2 }, q.smoothFill)); }
        finally { mat.fragmentShader = source; mat.needsUpdate = true; }
        return { full, half };
      });
      return { ok: r.full === 0 && r.half > 0, detail: `poisoned plain read shows on ${r.full} values at amount 1 (must be 0), ${r.half} at amount .5 (must show, or this check proves nothing)` };
    },
  },
  {
    name: 'mirror-light',
    // Over-range light across a soft ramp, Warp fringe on, part way through the crossfade. Nothing may exceed the
    // source's straight colour, over-range light must survive, and uncovered light must pass.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, params = { mirrorAmount: .5, mirrorMode: 3, bendAmount: .2, bendChroma: 1 };
        const ramp = (u, v) => { const a = .5 + .5 * Math.sin(u * 40) * Math.cos(v * 23); return [4 * a, 4 * a, 4 * a, a]; };
        const covered = q.feed(params, ramp), unmirrored = q.feed({ ...params, mirrorAmount: 0 }, ramp);
        const moved = q.worst(covered, unmirrored);
        let over = 0, peak = 0;
        for (let i = 0; i < covered.length; i += 4) {
          peak = Math.max(peak, covered[i]);
          if (covered[i + 3] > .01 && Math.max(covered[i], covered[i + 1], covered[i + 2]) / covered[i + 3] > 4 * 1.01) over++;
        }
        const light = q.feed(params, () => [.5, .25, .75, 0]);
        let lost = 0;
        for (let i = 0; i < light.length; i += 4) if (Math.abs(light[i] - .5) > .01 || Math.abs(light[i + 1] - .25) > .01 || Math.abs(light[i + 2] - .75) > .01 || light[i + 3] !== 0) lost++;
        return { over, peak, lost, moved };
      });
      return { ok: r.moved > .1 && r.over === 0 && r.peak > 3 && r.lost === 0, detail: `${r.moved <= .1 ? 'Mirror does not change the pass. ' : ''}${r.over} pixels above the source's straight colour; peak ${r.peak.toFixed(2)} (over 3); uncovered light changed on ${r.lost} pixels` };
    },
  },
  {
    name: 'warp-strength',
    // How far each Warp type actually pushes at one amount, read from the shader's own field.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.rich()])), rows = [];
        for (let f = 0; f < count; f++) {
          const params = { bendAmount: .3, bendField: f }, out = q.probe('vec4(length(bendField((readBase - .5) * vec2(uAspect, 1.))), 0., 0., 1.)', params);
          const sizes = []; for (let i = 0; i < out.length; i += 4) sizes.push(out[i]);
          sizes.sort((a, b) => a - b);
          rows.push({ mean: sizes.reduce((a, v) => a + v, 0) / sizes.length, p95: sizes[Math.floor(sizes.length * .95)], peak: sizes[sizes.length - 1], moved: q.difference(plain, await q.px(q.project([q.rich(params)]))) });
        }
        return rows;
      }, FIELDS.length);
      await fs.mkdir(proof, { recursive: true });
      await fs.writeFile(path.join(proof, 'warp-strength.json'), JSON.stringify(rows.map((r, i) => ({ type: FIELDS[i], ...r })), null, 2));
      const means = rows.map(r => r.mean), spread = Math.max(...means) / Math.min(...means);
      return { ok: rows.every(r => r.peak <= 1.001) && spread < STRENGTH_SPREAD, detail: `mean push differs by ${spread.toFixed(2)}x across types (limit ${STRENGTH_SPREAD}x; 3.77x before the per-type gains). Field length: ${rows.map((r, i) => `${FIELDS[i]} mean ${r.mean.toFixed(3)} p95 ${r.p95.toFixed(3)} peak ${r.peak.toFixed(3)} moved ${r.moved.toFixed(1)}`).join('; ')}` };
    },
  },
  {
    name: 'all-presets-neutral',
    // Every preset in the older checkout, at one phase, byte for byte against the same preset now.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      const r = await page.evaluate(async () => {
        const q = window.wq, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [], blank = [];
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
    // A project written by the older build's own code goes to disk, is read back, and opens in both.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      await fs.mkdir(proof, { recursive: true });
      const file = path.join(proof, 'baseline-project.formfield');
      const saved = await page.evaluate(() => {
        const q = window.wq, o = q.old, p = o.createProject();
        const add = (kind, finish, extra = {}) => {
          const preset = o.PRESETS.find(x => x.kind === kind);
          let l = preset ? o.applyPreset(o.createLayer(kind), preset.id) : o.createLayer(kind);
          if (kind === 'image') l.image = { name: 'tiny.png', dataUrl: q.tinyUrl, width: 64, height: 36, fit: 'contain' };
          l = o.applyFinish(l, finish); Object.assign(l, extra); return l;
        };
        p.id = 'old-file-proof'; p.name = 'Baseline project'; p.background = '#000000';
        p.layers = [add('surface', 'finish-tunnel'), add('fractal', 'finish-terraces', { opacity: .7, blend: 'screen' }), add('liquid', 'finish-soft-glow', { opacity: .6, blend: 'screen' }), add('image', 'finish-halftone', { opacity: .5 })];
        return JSON.stringify(o.validateProject(p), null, 2);
      });
      await fs.writeFile(file, saved);
      const text = await fs.readFile(file, 'utf8');
      const r = await page.evaluate(async text => {
        const q = window.wq, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [], blank = [], offDefault = [];
        const raw = JSON.parse(text), now = q.m.validateProject(JSON.parse(text)), then = q.old.validateProject(JSON.parse(text));
        let added = 0, compared = 0, lowest = 1, warpKeysInFile = 0;
        raw.layers.forEach(l => { for (const key of Object.keys(l.params)) if (/^(bend|liquid[A-Z]|lumaWarp|polar|mirror[A-Z])/.test(key)) warpKeysInFile++; });
        now.layers.forEach((l, i) => {
          const defs = q.m.parameterDefinitions(l.kind);
          for (const key of Object.keys(l.params)) if (!(key in raw.layers[i].params)) { added++; const d = defs.find(x => x.key === key); if (!d || l.params[key] !== d.default) offDefault.push(`${l.kind}.${key}`); }
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
        return { schema: raw.schemaVersion, savedSchema: now.schemaVersion, kinds: now.layers.map(l => l.kind), added, offDefault, compared, changed, blank, lowest, warpKeysInFile };
      }, text);
      // The file must hold no warp keys, or it is not an older file; opening it must fill them in at their defaults.
      const ok = r.compared === 15 && !r.blank.length && !r.changed.length && !r.offDefault.length && r.added > 0 && r.warpKeysInFile === 0 && r.savedSchema === r.schema;
      return { ok, detail: `${path.relative(root, file)}: schema ${r.schema} in the file, ${r.savedSchema} once opened, layers ${r.kinds.join(', ')}; ${r.warpKeysInFile} warp keys in the file; ${r.added} new keys filled in, ${r.offDefault.length} off default; ${r.compared} renders ${r.changed.length ? `changed: ${r.changed.join(', ')}` : 'byte-identical'}; lowest lit share ${(r.lowest * 100).toFixed(2)}% (limit .5%); blank: ${r.blank.join(', ') || 'none'}` };
    },
  },
  {
    name: 'stack',
    // Everything at once, then the same with each effect taken out: a render that ignored one would not change.
    run: async ({ page }) => {
      const r = await page.evaluate(async full => {
        const q = window.wq, phases = [.9, 3.3, 5.1];
        const repeat = async make => {
          const first = await q.shot(make(), phases[0]);
          await q.shot(make(), phases[1]); await q.shot(make(), phases[2]);
          return { first, same: q.same(first, await q.shot(make(), phases[0])) };
        };
        const one = params => q.project([q.moving(params)]);
        const two = params => { const low = q.base('surface'), top = q.base('fractal', params); low.id = 'stack-low'; top.id = 'stack-top'; top.blend = 'screen'; return q.project([low, top]); };
        const a = await repeat(() => one(full)), b = await repeat(() => two({ ...full, lumaWarpSource: 1 }));
        const [pa, pb] = await Promise.all([a.first, b.first].map(q.pixels));
        const inert = [];
        for (const key of Object.keys(full)) {
          if (!/Amount$|^echo$|^slitShift$|Mix$/.test(key)) continue;
          if (q.same(a.first, await q.shot(one({ ...full, [key]: 0 }), phases[0]))) inert.push(key);
        }
        const self = await q.shot(two({ ...full, lumaWarpSource: 0 }), phases[0]);
        return { oneSame: a.same, twoSame: b.same, oneLit: q.litShare(pa), twoLit: q.litShare(pb), inert, belowUsed: !q.same(self, b.first) };
      }, STACK);
      const ok = r.oneSame && r.twoSame && r.oneLit > .05 && r.twoLit > .05 && !r.inert.length && r.belowUsed;
      return { ok, detail: `one layer: seek ${r.oneSame ? 'byte-identical' : 'differs'}, lit ${(r.oneLit * 100).toFixed(1)}%; two layers with Layer below: seek ${r.twoSame ? 'byte-identical' : 'differs'}, lit ${(r.twoLit * 100).toFixed(1)}%, Layer below ${r.belowUsed ? 'changes the render' : 'has no effect'}; effects with no effect in the stack: ${r.inert.join(', ') || 'none'}` };
    },
  },
  {
    name: 'sheet',
    // Contact sheets for judging by eye: one per effect and layer kind, three phases, plus 1:1 crops of a 1080 frame.
    run: async ({ page }) => {
      await fs.mkdir(proof, { recursive: true });
      const metrics = []; let written = 0;
      for (const kind of SHEET_KINDS) {
        const r = await page.evaluate(async ([groups, kind]) => {
          const q = window.wq, W = 400, H = 225, TAU = Math.PI * 2, phases = [0, TAU / 3, 2 * TAU / 3], sheets = [], metrics = [];
          const thumb = async bytes => {
            const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
            const c = new OffscreenCanvas(120, 68), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bitmap, 0, 0, 120, 68);
            return { bitmap, data: x.getImageData(0, 0, 120, 68).data };
          };
          const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; return s / (a.length / 4); };
          const measure = d => { let lit = 0, sat = 0; for (let i = 0; i < d.length; i += 4) { const hi = Math.max(d[i], d[i + 1], d[i + 2]), lo = Math.min(d[i], d[i + 1], d[i + 2]); if (hi > 32) { lit++; sat += (hi - lo) / hi; } } return { lit: lit / (d.length / 4), sat: lit ? sat / lit : 0 }; };
          const b64 = async blob => { const u = new Uint8Array(await blob.arrayBuffer()); let t = ''; for (let i = 0; i < u.length; i += 8192) t += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(t); };
          const label = (x, text, X, Y) => { x.font = '600 15px sans-serif'; x.fillStyle = 'rgba(0,0,0,.7)'; x.fillRect(X, Y, 190, 22); x.fillStyle = '#fff'; x.fillText(text, X + 5, Y + 16); };
          const plainThumbs = [];
          for (let col = 0; col < 3; col++) plainThumbs.push((await thumb(await q.shot(q.project([q.base(kind)]), phases[col], 960, 540))).data);
          for (const [effect, types] of groups) {
            const rows = [['Plain', {}], ...types], sheet = new OffscreenCanvas(W * 3, H * rows.length), x = sheet.getContext('2d');
            x.fillStyle = '#000'; x.fillRect(0, 0, sheet.width, sheet.height);
            for (let row = 0; row < rows.length; row++) {
              const [name, params] = rows[row], project = q.project([q.base(kind, params)]), shots = [];
              for (let col = 0; col < 3; col++) {
                const t = await thumb(await q.shot(project, phases[col], 960, 540)); shots.push(t.data);
                x.drawImage(t.bitmap, col * W, row * H, W, H); label(x, `${name} ${col + 1}/3`, col * W, row * H);
              }
              if (!row) continue;
              const m = shots.map(measure);
              metrics.push({ kind, effect, type: name, lit: m.reduce((a, v) => a + v.lit, 0) / 3, saturation: m.reduce((a, v) => a + v.sat, 0) / 3, acrossLoop: (diff(shots[0], shots[1]) + diff(shots[1], shots[2]) + diff(shots[2], shots[0])) / 3, fromPlain: shots.reduce((a, v, i) => a + diff(v, plainThumbs[i]), 0) / 3 });
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
        for (const sheet of r.sheets) { await fs.writeFile(path.join(proof, sheet.name), Buffer.from(sheet.data, 'base64')); written++; }
        metrics.push(...r.metrics);
      }
      await fs.writeFile(path.join(proof, 'sheet-metrics.json'), JSON.stringify(metrics, null, 2));
      const types = SHEET_GROUPS.reduce((a, [, t]) => a + t.length, 0), expected = SHEET_KINDS.length * (SHEET_GROUPS.length + 1);
      const flat = metrics.filter(m => m.fromPlain < 1);
      return { ok: written === expected && metrics.length === types * SHEET_KINDS.length && !flat.length, detail: `${written} sheets, ${metrics.length} type and layer pairs in ${path.relative(root, proof)}; no visible change from plain: ${flat.map(m => `${m.effect} ${m.type} on ${m.kind}`).join(', ') || 'none'}` };
    },
  },
  {
    name: 'preview-cost',
    // A report, not a gate. Each frame is forced to finish on the GPU, so the time is the real draw.
    run: async ({ page }) => {
      const rows = await page.evaluate(async cases => {
        const q = window.wq, canvas = document.createElement('canvas'), R = new q.m.StudioRenderer(canvas), gl = R.renderer.getContext(), FRAMES = 60, WARM = 10, ROUNDS = 5, pixel = new Uint8Array(4);
        const times = cases.map(() => []);
        const median = list => [...list].sort((a, b) => a - b)[list.length >> 1];
        try {
          // Every case in each round, so warm-up and drift in the GPU's speed land on all of them alike.
          for (let round = 0; round < ROUNDS; round++) for (let c = 0; c < cases.length; c++) {
            const p = q.project([q.base('surface', cases[c][1])]); await R.prepare(p);
            let total = 0;
            for (let f = 0; f < WARM + FRAMES; f++) {
              const start = performance.now();
              R.render(p, f / (WARM + FRAMES) * Math.PI * 2, 1280, 720); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
              if (f >= WARM) total += performance.now() - start;
            }
            // The first round only warms the shaders.
            if (round) times[c].push(total / FRAMES);
          }
        } finally { R.dispose(); }
        return cases.map(([name], c) => ({ name, ms: median(times[c]), low: Math.min(...times[c]), high: Math.max(...times[c]) }));
      }, COST_CASES);
      await fs.mkdir(proof, { recursive: true });
      await fs.writeFile(path.join(proof, 'preview-cost.json'), JSON.stringify(rows, null, 2));
      const plain = rows[0].ms;
      return { ok: rows.length === COST_CASES.length, detail: `median of 4 rounds of 60 frames at 1280x720 on Surface (report only). Plain ${plain.toFixed(2)} ms (${rows[0].low.toFixed(2)} to ${rows[0].high.toFixed(2)}); ${rows.slice(1).map(r => `${r.name} ${r.ms.toFixed(2)} (${r.ms >= plain ? '+' : ''}${(r.ms - plain).toFixed(2)})`).join(', ')}` };
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
await bundle(root, 'renderer.js', `\nexport {applyFinish,validateProject,parameterDefinitions} from './src/core/project';`);
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
    const dataUrl = async (w, h, pixel) => {
      const bytes = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bytes.set(pixel((x + .5) / h - w / h / 2, (y + .5) / h - .5), (y * w + x) * 4);
      return urlOf(await m.encodePNG(bytes, w, h));
    };
    const ramp = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const softUrl = await dataUrl(960, 540, (x, y) => {
      const halo = .6 * (1 - ramp(.2, .34, Math.hypot(x, y))), block = Math.abs(x) < .1 && Math.abs(y) < .1 ? 1 : 0;
      return [176, 96, 48, Math.round(255 * Math.max(halo, block))];
    });
    const tinyUrl = await dataUrl(64, 36, (x, y) => [Math.round(255 * (x + .9) / 1.8), Math.round(255 * (y + .5)), 90, Math.round(255 * (1 - ramp(.25, .48, Math.hypot(x, y))))]);
    // Gentle everywhere, so a tiny warp cannot move a value far.
    const smoothUrl = await dataUrl(960, 540, (x, y) => [
      Math.round(128 + 90 * Math.sin(3.1 * x + .4)), Math.round(128 + 90 * Math.cos(4.3 * y - .7)), Math.round(128 + 70 * Math.sin(2.2 * x + 3.7 * y)), 255,
    ]);
    // Busy in both directions, so a repeated edge pixel stands out as a flat run.
    const richUrl = await dataUrl(960, 540, (x, y) => [
      Math.round(128 + 120 * Math.sin(83 * x + 31 * y)), Math.round(128 + 120 * Math.sin(67 * y - 29 * x + 1)), Math.round(128 + 120 * Math.sin(53 * (x + y) + 2)), 255,
    ]);
    // Busy, with green kept high inside, and a two-pixel magenta rim that nothing else can be mistaken for.
    const rimmedUrl = await dataUrl(960, 540, (x, y) => Math.abs(x) > 480 / 540 - 2 / 540 || Math.abs(y) > .5 - 2 / 540 ? [255, 0, 255, 255] : [
      Math.round(128 + 120 * Math.sin(83 * x + 31 * y)), Math.round(150 + 80 * Math.sin(67 * y - 29 * x + 1)), Math.round(128 + 120 * Math.sin(53 * (x + y) + 2)), 255,
    ]);
    const checkerUrl = async (w, h) => {
      const bytes = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = ((x >> 1) + (y >> 1)) & 1 ? 255 : 0, i = (y * w + x) * 4;
        bytes[i] = bytes[i + 1] = bytes[i + 2] = v; bytes[i + 3] = 255;
      }
      return urlOf(await m.encodePNG(bytes, w, h));
    };
    const image = (url, params, name, width = 960, height = 540) => {
      const l = m.createLayer('image'); l.id = `${name}-proof`; Object.assign(l.params, params);
      l.image = { name: `${name}.png`, dataUrl: url, width, height, fit: 'contain' };
      return l;
    };
    const soft = (params = {}) => { const l = image(softUrl, params, 'soft'); l.mask = { ...l.mask, kind: 'circle', size: .9, softness: .2 }; return l; };
    const smooth = (params = {}) => image(smoothUrl, params, 'smooth');
    const rich = (params = {}) => image(richUrl, params, 'rich');
    const rimmed = (params = {}) => image(rimmedUrl, params, 'rimmed');
    const project = (layers, transparent = false) => { const p = m.createProject(); p.id = 'warp-proof'; p.layers = layers; p.background = '#000000'; p.transparent = transparent; return p; };
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
    // Laplacian of the frame-to-frame change on the green channel, over a central crop.
    const highFrequency = (a, b, W, H) => {
      const x0 = W >> 3, x1 = W - x0, y0 = H >> 3, y1 = H - y0, d = (x, y) => a[(y * W + x) * 4 + 1] - b[(y * W + x) * 4 + 1];
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += Math.abs(4 * d(x, y) - d(x - 1, y) - d(x + 1, y) - d(x, y - 1) - d(x, y + 1)); n++; }
      return sum / n;
    };
    // The renderer wraps phase, so 0 against TAU alone proves nothing: the seam catches motion that does not close.
    const loop = async p => {
      const start = await shot(p, 0), wrapped = await shot(p, Math.PI * 2), before = await shot(p, Math.PI * 2 - 1e-4);
      return { literal: same(start, wrapped), seam: difference(await pixels(start), await pixels(before)) };
    };
    // A 2x frame averaged down to compare with a 1x frame.
    const halved = (big, W, H) => {
      const reduced = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
        const at = (X, Y) => big[(Y * 2 * W + X) * 4 + c];
        reduced[(y * W + x) * 4 + c] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
      }
      return reduced;
    };
    // How much of the magenta rim shows, on the fullest line, and the longest run of one repeated colour.
    const edgeStats = (px, W, H) => {
      const rim = i => px[i] > 200 && px[i + 1] < 40 && px[i + 2] > 200;
      let area = 0, line = 0, longest = 0;
      const walk = (outer, inner, at) => {
        for (let a = 0; a < outer; a++) {
          let hits = 0, run = 1, last = -1;
          for (let b = 0; b < inner; b++) {
            const i = at(a, b) * 4;
            if (rim(i)) { hits++; run = 1; last = -1; continue; }
            const key = px[i] | px[i + 1] << 8 | px[i + 2] << 16;
            run = key === last ? run + 1 : 1; last = key; longest = Math.max(longest, run);
          }
          line = Math.max(line, hits / inner);
        }
      };
      for (let i = 0; i < px.length; i += 4) if (rim(i)) area++;
      walk(H, W, (y, x) => y * W + x); walk(W, H, (x, y) => y * W + x);
      return { area: area / (W * H), line, longest };
    };
    // The warp pass's own output in linear light, before any later pass.
    const fromHalf = h => {
      const sign = h >> 15 ? -1 : 1, e = h >> 10 & 31, f = h & 1023;
      return e === 0 ? sign * f * 2 ** -24 : e === 31 ? (f ? NaN : sign * Infinity) : sign * (1 + f / 1024) * 2 ** (e - 15);
    };
    const linear = (W, H) => {
      const raw = new Uint16Array(W * H * 4);
      renderer.renderer.readRenderTargetPixels(renderer.warpTarget, 0, 0, W, H, raw);
      return Float32Array.from(raw, fromHalf);
    };
    // Six bars whose channels all differ, with fine detail so a move inside a bar shows.
    const BARS = [[220, 40, 40], [40, 220, 40], [40, 40, 220], [200, 200, 200], [90, 90, 90], [230, 200, 30]];
    const barsUrl = await dataUrl(960, 540, (x, y) => {
      const bar = BARS[Math.min(5, Math.floor((x + 480 / 540) / (960 / 540) * 6))], detail = .8 + .2 * Math.sin(70 * x + 40 * y);
      return [Math.round(bar[0] * detail), Math.round(bar[1] * detail), Math.round(bar[2] * detail), 255];
    });
    const bars = (params = {}) => image(barsUrl, params, 'bars');
    // Red marks the right half; green is busy everywhere, so a move shows even where red is flat.
    const halfRedUrl = await dataUrl(960, 540, (x, y) => [x > 0 ? 255 : 0, Math.round(128 + 120 * Math.sin(83 * x + 31 * y)), 0, 255]);
    const halfRed = (params = {}) => image(halfRedUrl, params, 'half-red');
    // A white disc on nothing, placed by its centre.
    const DISC_RADIUS = .2;
    const discUrls = new Map();
    for (const cx of [0, .45]) discUrls.set(cx, await dataUrl(960, 540, (x, y) => {
      const a = 1 - ramp(DISC_RADIUS - .004, DISC_RADIUS + .004, Math.hypot(x - cx, y));
      return [255, 255, 255, Math.round(255 * a)];
    }));
    const discLayer = (cx, params = {}) => image(discUrls.get(cx), params, `disc-${cx}`);
    // Changed pixels well inside the disc, and well outside it. The margin covers its soft rim and the driver's blur.
    const discZones = (a, b, W, H, cx) => {
      let inside = 0, insideChanged = 0, outside = 0, outsideChanged = 0;
      for (let py = 0; py < H; py++) for (let px_ = 0; px_ < W; px_++) {
        const r = Math.hypot((px_ + .5) / H - W / H / 2 - cx, (py + .5) / H - .5), i = (py * W + px_) * 4;
        const changed = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6;
        if (r < DISC_RADIUS - .02) { inside++; if (changed) insideChanged++; }
        else if (r > DISC_RADIUS + .03) { outside++; if (changed) outsideChanged++; }
      }
      return { inside: insideChanged / inside, outside: outsideChanged / outside };
    };
    // An animated source that closes its loop.
    const moving = (params = {}) => { const l = m.applyPreset(m.createLayer('surface'), m.PRESETS.find(p => p.kind === 'surface').id); l.id = 'moving-proof'; Object.assign(l.params, params); return l; };
    // Runs the warp pass alone on float pictures and returns its linear output.
    const floats = (fill, W, H) => {
      const data = new Float32Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(fill((x + .5) / W, (y + .5) / H), (y * W + x) * 4);
      const texture = new m.DataTexture(data, W, H, m.RGBAFormat, m.FloatType);
      // Filtered like a real layer, or a move smaller than a texel would change nothing and the engage check could not fail.
      texture.minFilter = texture.magFilter = m.LinearFilter; texture.needsUpdate = true;
      return texture;
    };
    const feed = (params, sourceFill, belowFill = () => [0, 0, 0, 0], W = 960, H = 540) => {
      const source = floats(sourceFill, W, H), under = floats(belowFill, W, H), layer = rich(params);
      renderer.warpSource(layer, layer, source, under, .9, W, H);
      const result = linear(W, H);
      source.dispose(); under.dispose();
      return result;
    };
    // Mean distance moved up the frame over a central crop, on a source whose value is its own height.
    const rampMove = (params, belowColour) => {
      const W = 960, H = 540, out = feed(params, (u, v) => [v, v, v, 1], () => belowColour, W, H);
      let sum = 0, n = 0;
      for (let y = H * .3 | 0; y < H * .6; y++) for (let x = W * .3 | 0; x < W * .7; x++) { sum += out[(y * W + x) * 4 + 1] - (y + .5) / H; n++; }
      return sum / n;
    };
    const smoothFill = (u, v) => [.5 + .3 * Math.sin(3 * u + .4), .5 + .3 * Math.cos(4 * v - .7), .5 + .2 * Math.sin(2 * u + 3 * v), 1];
    const worst = (a, b) => { let most = 0; for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i] - b[i])); return most; };
    // Runs the pass with its output replaced by a GLSL expression, to read a value the shader worked out.
    const probe = (expression, params, W = 960, H = 540, fill = smoothFill) => {
      const mat = renderer.warp, source = mat.fragmentShader, patched = source.replace('gl_FragColor = vec4(covered + light, g.alpha);', `gl_FragColor = ${expression};`);
      if (patched === source) throw new Error('warp output not found');
      mat.fragmentShader = patched; mat.needsUpdate = true;
      try { return feed(params, fill, undefined, W, H); } finally { mat.fragmentShader = source; mat.needsUpdate = true; }
    };
    // Bright at the foot of the picture, dark at its top, at the frame's own shape so it fills the frame.
    // These test pictures are written bottom row first.
    const headUrl = (W, H) => dataUrl(W, H, (x, y) => { const v = Math.round(255 * (.5 - y)); return [v, v, v, 255]; });
    // Where the bright part of a picture sits, in frame heights from the frame's centre.
    const brightCentre = (px, W, H, floor) => {
      let sum = 0, sx = 0, sy = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = px[(y * W + x) * 4]; if (v > floor) { sum += v; sx += v * x; sy += v * y; } }
      return { x: (sx / sum + .5 - W / 2) / H, y: (sy / sum + .5 - H / 2) / H };
    };
    // Luma on this layer, on top of an earlier stage: the driver must come from where that stage put the pixel.
    window.q_lumaStage = async (q, stage) => {
      const plain = await q.px(q.project([q.halfRed()]));
      const staged = await q.px(q.project([q.halfRed(stage)]));
      const driven = await q.px(q.project([q.halfRed({ ...stage, lumaWarpAmount: .25, lumaWarpChannel: 1, lumaWarpSoft: 0 })]));
      let dark = 0, moved = 0, bright = 0, brightMoved = 0;
      const W = 960, H = 540;
      // Dark means clear of the red edge by three pixels: a filtered read on the edge holds some driver, and every
      // wedge repeats that edge.
      const clear = (x, y) => { for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) { const X = x + a, Y = y + b; if (X >= 0 && Y >= 0 && X < W && Y < H && staged[(Y * W + X) * 4] >= 10) return false; } return true; };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, changed = Math.abs(staged[i + 1] - driven[i + 1]) > 3;
        if (staged[i] < 10) { if (clear(x, y)) { dark++; if (changed) moved++; } }
        else if (staged[i] > 200) { bright++; if (changed) brightMoved++; }
      }
      return { staged: q.difference(plain, staged), self: moved / Math.max(dark, 1), selfBright: brightMoved / Math.max(bright, 1), dark: dark / (staged.length / 4), bright: bright / (staged.length / 4) };
    };
    // The stage's fringe alone, then a Warp fringe on top measured against Warp's own move from the same position.
    window.q_fringeStage = (q, stage) => {
      const bend = { bendAmount: .3, bendField: 0, bendChroma: 1 };
      const alone = q.probe('vec4(length(warpFringe), 0., 0., 1.)', stage);
      const stacked = q.probe('vec4(length(warpFringe), length(warpFringe - bendField((readBase - .5) * vec2(uAspect, 1.)) * uBendAmount * .5 / vec2(uAspect, 1.) * uBendChroma * .08), 0., 1.)', { ...stage, ...bend });
      let most = 0, size = 0, off = 0;
      for (let i = 0; i < alone.length; i += 4) { most = Math.max(most, alone[i]); size = Math.max(size, stacked[i]); off = Math.max(off, stacked[i + 1]); }
      return { alone: most, stacked: size, off };
    };
    const litShare = px => { let lit = 0; for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) > 8) lit++; return lit / (px.length / 4); };
    // A made-up poster for the Image rows: flat neon bands broken by dark rings. Not real footage.
    const NEON = [[255, 0, 120], [255, 200, 0], [0, 230, 120], [0, 150, 255], [170, 0, 255], [255, 70, 0]];
    const posterUrl = await dataUrl(960, 540, (x, y) => {
      if (Math.abs(Math.sin(Math.hypot(x, y) * 14)) < .1) return [8, 8, 12, 255];
      const c = NEON[((Math.floor(3 * (x + .9) + 2 * Math.sin(3 * y)) % 6) + 6) % 6];
      return [c[0], c[1], c[2], 255];
    });
    // The first preset of a kind, or the poster for Image, with these finish params.
    const base = (kind, params = {}) => {
      if (kind === 'image') return image(posterUrl, params, 'poster');
      const l = m.applyPreset(m.createLayer(kind), m.PRESETS.find(p => p.kind === kind).id); l.id = `${kind}-proof`; Object.assign(l.params, params); return l;
    };
    window.wq = { litShare, base, smoothFill, worst, probe, headUrl, brightCentre, discLayer, m, old, tinyUrl, renderer, image, soft, smooth, rich, rimmed, bars, halfRed, disc: discLayer, discZones, moving, feed, rampMove, checkerUrl, urlOf, project, pixels, shot, px, difference, same, highFrequency, loop, halved, edgeStats, linear };
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
