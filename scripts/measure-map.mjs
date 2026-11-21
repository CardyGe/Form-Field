// Performance record for Map: eight shapes playing four instruments (two shapes each, each with its own source)
// on a 1920 × 1080 stage, measured in the output window for 30 s after a warm-up.
// Run: npm run build && node scripts/measure-map.mjs [--seconds 30] [--edges]
// --pins pins every shape to a skewed quad (stage 4).
// --edges gives every shape a 40 px soft edge and a 6 px border with an 8 px glow (stage 3).
// Uses a throwaway user-data folder under work/map-measure/. Prints a table and writes work/map-measure/results.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/map-measure');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const SECONDS = arg('--seconds', 30), WARMUP = 4;
const EDGES = process.argv.includes('--edges');
const PINS = process.argv.includes('--pins');
const MIXES = {
  medium: ['ivory-coral', 'porcelain-shutters', 'salt-mandala', 'rapid-cuts'],
  heavy: ['prismatic-fold', 'pearl-organism', 'ivory-coral', 'acid-slide'],
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = {};

for (const [mix, presets] of Object.entries(MIXES)) {
  const userData = path.join(out, `user-data-${mix}`);
  await fs.rm(userData, { recursive: true, force: true });
  await fs.mkdir(userData, { recursive: true });
  const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
  const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
  try {
    const studio = await app.firstWindow();
    await studio.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
    await studio.getByRole('button', { name: 'Map', exact: true }).click();
    const stage = studio.getByLabel('Stage', { exact: true });
    await stage.waitFor();
    await studio.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; });
    const opened = app.waitForEvent('window', { timeout: 15000 });
    await studio.getByRole('button', { name: 'Open output' }).click();
    const output = await opened;
    await output.waitForURL(/#map-output/);
    await studio.getByRole('button', { name: 'Close output' }).waitFor({ timeout: 10000 });

    // Eight shapes in a 4 × 2 grid covering most of the stage; two per instrument.
    const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
    for (let i = 0; i < 8; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
      await studio.mouse.move(...at(0.03 + col * 0.24, 0.05 + row * 0.47)); await studio.mouse.down();
      await studio.mouse.move(...at(0.24 + col * 0.24, 0.47 + row * 0.47), { steps: 4 }); await studio.mouse.up();
      await studio.getByLabel('Plays').selectOption(`preset:${presets[i % 4]}`);
      if (EDGES) {
        const slider = async (label, value) => { const el = studio.getByLabel(label, { exact: true }); await el.fill(String(value)); await el.dispatchEvent('pointerup'); };
        await slider('Soft edge', 40); await slider('Border', 6); await slider('Glow', 8);
      }
      if (PINS) {
        // Stage 4: every shape pinned to a slightly skewed quad, so each one takes the triangle grid.
        await studio.getByLabel('Picture placement', { exact: true }).selectOption('pin');
        const pin = async (label, px) => { const el = studio.getByLabel(label, { exact: true }); await el.fill(String(px)); await el.press('Enter'); };
        await pin('Pin bottom right X', Math.round((0.24 + col * 0.24) * 1920) - 40);
        await pin('Pin top left X', Math.round((0.03 + col * 0.24) * 1920) + 30);
      }
    }
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 8, null, { timeout: 30000 });
    await sleep(WARMUP * 1000);

    const edgeBuildsBefore = await output.evaluate(() => window.__mapStats?.edgeBuilds ?? 0);
    const record = await output.evaluate(async seconds => {
      const intervals = [], levels = [], fps = [];
      let last = performance.now();
      const end = last + seconds * 1000;
      await new Promise(resolve => {
        const tick = now => { intervals.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(); };
        requestAnimationFrame(tick);
        const every = setInterval(() => { const s = window.__mapStats; if (s) { levels.push(s.level); fps.push(s.fps); } if (performance.now() >= end) clearInterval(every); }, 1000);
      });
      return { intervals, levels, fps, failing: window.__mapStats?.failing ?? [], edgeBuilds: window.__mapStats?.edgeBuilds ?? 0 };
    }, SECONDS);
    const sorted = [...record.intervals].sort((a, b) => a - b);
    const pick = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    results[mix] = {
      presets, frames: sorted.length, seconds: SECONDS,
      medianMs: +pick(0.5).toFixed(2), p95Ms: +pick(0.95).toFixed(2), maxMs: +sorted.at(-1).toFixed(1),
      over16_7: record.intervals.filter(v => v > 16.7).length,
      fpsReported: record.fps, governorLevels: [...new Set(record.levels)], failing: record.failing,
      edges: EDGES, pins: PINS, edgeBuildsDuringRun: record.edgeBuilds - edgeBuildsBefore,
    };
  } finally { await app.close().catch(() => {}); }
}

await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, PINS ? 'results-pins.json' : EDGES ? 'results-edges.json' : 'results.json'), JSON.stringify(results, null, 2));
for (const [mix, r] of Object.entries(results)) {
  console.log(`${mix.padEnd(7)} ${r.presets.join(', ')}`);
  console.log(`        ${r.frames} frames in ${r.seconds} s · median ${r.medianMs} ms · p95 ${r.p95Ms} ms · max ${r.maxMs} ms · ${r.over16_7} frames over 16.7 ms · governor levels ${r.governorLevels.join(',')} · fps reported ${Math.min(...r.fpsReported)}–${Math.max(...r.fpsReported)} · failing ${r.failing.length}${r.edges ? ` · soft edges made during the run ${r.edgeBuildsDuringRun}` : ''}`);
}
