// Real Electron check: does the wall get darker per shape as more shapes play the same bright look?
// Run: npm run test:wall   (builds first). Looks to play: node scripts/verify-wall-brightness.mjs [look...] (default oil and meridian).
// Uses a throwaway user-data folder under work/wall-brightness/; never the real app data.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/wall-brightness');
const userData = path.join(out, 'user-data');
await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });
const kinds = process.argv.slice(2).length ? process.argv.slice(2) : ['oil', 'meridian'];
for (const kind of kinds) execFileSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'scripts/wall-brightness-show.ts'), out, kind]);

const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
await app.evaluate(({ dialog }) => { globalThis.__nextPick = null; dialog.showOpenDialog = async () => globalThis.__nextPick ? { canceled: false, filePaths: [globalThis.__nextPick] } : { canceled: true, filePaths: [] }; });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Mean linear light inside the first shape's box, and over the whole wall, every animation frame for `ms`.
const film = (output, ms) => output.evaluate(async ms => {
  const c = document.querySelector('canvas'), w = 192, h = 108, o = new OffscreenCanvas(w, h), x = o.getContext('2d', { willReadFrequently: true });
  const lin = Float32Array.from({ length: 256 }, (_, i) => { const v = i / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  const first = [], whole = [], started = performance.now(), gains = [];
  await new Promise(done => { const tick = now => {
    x.drawImage(c, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
    let a = 0, an = 0, all = 0;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4, l = .2126 * lin[d[i]] + .7152 * lin[d[i + 1]] + .0722 * lin[d[i + 2]];
      all += l; if (px >= .05 * w && px < .31 * w && py >= .21 * h && py < .79 * h) { a += l; an++; }
    }
    first.push(a / an); whole.push(all / (w * h)); gains.push(window.__mapStats?.wallLimiter?.gain ?? null);
    if (now - started < ms) requestAnimationFrame(tick); else done();
  }; requestAnimationFrame(tick); });
  const mean = v => v.reduce((s, x) => s + x, 0) / v.length;
  const s = window.__mapStats;
  return { firstShape: +mean(first).toFixed(4), wall: +mean(whole).toFixed(4), minGain: Math.min(...gains.filter(g => g !== null)), meanGain: +mean(gains.filter(g => g !== null)).toFixed(3), level: s?.level, fps: s?.fps, wallLimiter: s?.wallLimiter, flashGuard: s?.flashGuard };
}, ms);

const results = [];
try {
  const studio = await app.firstWindow();
  await studio.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  studio.on('dialog', d => d.accept());
  await studio.getByLabel('Project name', { exact: true }).waitFor();
  await sleep(1500);
  await studio.getByRole('button', { name: 'Map', exact: true }).click();
  await studio.getByRole('region', { name: 'Map' }).waitFor();
  await studio.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; });
  const opened = app.waitForEvent('window', { timeout: 15000 });
  await studio.getByRole('button', { name: 'Open output' }).click();
  const output = await opened;
  await output.waitForURL(/#map-output/);
  await output.waitForSelector('canvas');
  await output.waitForFunction(() => !!window.__mapWallLimiter, null, { timeout: 10000 });

  const open = async (kind, n) => {
    await app.evaluate((_e, f) => { globalThis.__nextPick = f; }, path.join(out, `wall-${kind}-${n}.formshow`));
    await studio.getByTitle('Open a show file; it replaces the shapes here').click();
    await studio.waitForFunction(n => document.querySelectorAll('.map-shape-list li:not(.map-group-row)').length === n, n, { timeout: 8000 });
  };
  // Every look compiles once before anything is measured, so a first show still starting up is not read as dark.
  for (const kind of kinds) { await open(kind, 3); await sleep(3000); }
  for (const kind of [...kinds, 'white']) for (const limiter of [true, false]) for (let n = 1; n <= 3; n++) {
    await output.evaluate(on => window.__mapWallLimiter(on), limiter);
    await open(kind, n);
    await sleep(2500);
    const r = await film(output, 4000);
    const row = { kind, limiter, shapes: n, ...r };
    if (process.env.SHOTS) await output.screenshot({ path: path.join(out, `wall-${kind}-${n}-${limiter ? 'limited' : 'free'}.png`) });
    results.push(row);
    console.log(JSON.stringify(row));
  }
  await output.evaluate(() => window.__mapWallLimiter(true));
  // The check: with the limiter on, adding shapes playing the same steady look never darkens the first shape,
  // and the limiter never steps in, because nothing on the wall flashes.
  const failures = [];
  for (const kind of [...kinds, 'white']) {
    const one = results.find(r => r.kind === kind && r.limiter && r.shapes === 1);
    for (const r of results.filter(r => r.kind === kind && r.limiter)) {
      if (r.minGain < .95) failures.push(`${kind} on ${r.shapes} shape(s): the wall flash limiter dimmed the wall to ${r.minGain.toFixed(2)}`);
      if (r.firstShape < one.firstShape * .75) failures.push(`${kind} on ${r.shapes} shape(s): the first shape fell from ${one.firstShape} to ${r.firstShape}`);
    }
  }
  const white = results.find(r => r.kind === 'white' && r.limiter && r.shapes === 1);
  if (white.firstShape < .99) failures.push(`one white shape is no longer full white (${white.firstShape})`);
  console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'ok    the wall keeps its brightness as shapes are added');
  if (failures.length) process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  await app.close();
}
