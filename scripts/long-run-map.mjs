// The stage 5 long run: a three-scene show with sound reactions runs for two hours on the output window, a trigger
// moving to the next scene every 16 beats of the test beat. The wall is sampled four times a second: it must never
// show a black frame (every sample black) while shapes are lit, and it must keep up.
// Run: npm run build && node scripts/long-run-map.mjs [--minutes 120]
// Uses a throwaway user-data folder under work/map-long/. Prints a summary and writes work/map-long/results.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/map-long');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const MINUTES = arg('--minutes', 120);
// --heavy: eight shapes, every one playing an instrument in every scene and reacting (instrument settings too), two
// instruments looping with the tempo, and the scene changing every bar (4 beats).
const HEAVY = process.argv.includes('--heavy');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const playLook = async (page, value) => {
  await page.getByRole('button', { name: 'Change look' }).click();
  await page.locator(`[data-look="${value}"]`).click();
  await sleep(150);
  await page.keyboard.press('Escape');
  await page.locator('.look-browser').waitFor({ state: 'detached', timeout: 2000 }).catch(async () => {
    await page.getByRole('button', { name: 'Close looks' }).click();
    await page.locator('.look-browser').waitFor({ state: 'detached' });
  });
};
const openSection = (page, id) => page.evaluate(id => { const d = document.querySelector(`details[data-section="${id}"]`); if (d && !d.open) d.open = true; }, id);

const userData = path.join(out, 'user-data');
await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });
const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
const errors = [];
let summary, finished = false;
// What happens in the main process, in case a window goes: a crashed page, a display coming and going.
await app.evaluate(({ app, screen, BrowserWindow }) => {
  globalThis.__longRun = [];
  const note = text => globalThis.__longRun.push(`${new Date().toISOString().slice(11, 19)} ${text}`);
  app.on('render-process-gone', (_e, contents, details) => note(`page gone: ${contents.getURL().split('#')[1] ?? 'studio'} ${details.reason} ${details.exitCode}`));
  app.on('child-process-gone', (_e, details) => note(`process gone: ${details.type} ${details.reason} ${details.exitCode}`));
  for (const e of ['display-added', 'display-removed']) screen.on(e, (_x, d) => note(`${e} ${d.id}`));
  // Who closes a window: a call to close() leaves its stack; a click on the window's own close button leaves none.
  const close = BrowserWindow.prototype.close;
  BrowserWindow.prototype.close = function () { note(`close() on ${this.webContents?.getURL().split('#')[1] ?? 'studio'}: ${new Error().stack.split('\n').slice(2, 7).map(l => l.trim()).join(' | ')}`); return close.call(this); };
  app.on('browser-window-created', (_e, w) => {
    const url = () => w.webContents.getURL().split('#')[1] ?? 'studio';
    w.on('close', () => note(`close event on ${url()}`));
    w.webContents.on('before-input-event', (_x, input) => { if (input.type === 'keyDown') note(`key ${input.key} in ${url()}`); });
    w.on('blur', () => note(`blur ${url()}`));
  });
});
const mainNotes = () => app.evaluate(() => globalThis.__longRun ?? []).catch(() => ['(app gone)']);
try {
  const studio = await app.firstWindow();
  studio.on('pageerror', e => errors.push(`studio: ${e}`));
  const consoleLines = [];
  studio.on('console', m => { if (consoleLines.length < 200) consoleLines.push(`${new Date().toISOString().slice(11, 19)} ${m.type()} ${m.text().slice(0, 300)}`); });
  globalThis.__studioState = async () => ({ console: consoleLines.slice(-30), url: studio.url(), mapRegion: await studio.locator('[aria-label="Map"][role="region"]').count().catch(() => -1), mode: await studio.evaluate(() => [...document.querySelectorAll('.mode-switch button[aria-pressed="true"]')].map(b => b.textContent)).catch(e => String(e)), heapMB: await studio.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0).catch(() => -1) });
  await studio.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await studio.getByRole('button', { name: 'Map', exact: true }).click();
  const stage = studio.getByLabel('Stage', { exact: true });
  await stage.waitFor();
  await studio.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; });
  const opened = app.waitForEvent('window', { timeout: 15000 });
  await studio.getByRole('button', { name: 'Open output' }).click();
  const output = await opened;
  output.on('pageerror', e => errors.push(`wall: ${e}`));
  output.on('crash', () => errors.push('wall: crashed'));
  // A close before the run is over is a failure; the one at the end is the script closing the app.
  output.on('close', () => { if (!finished) errors.push(`wall: closed at ${new Date().toISOString().slice(11, 19)}`); });
  await output.waitForURL(/#map-output/);

  const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
  const draw = async (x0, y0, x1, y1) => {
    await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await studio.mouse.move(...at(x0, y0)); await studio.mouse.down(); await studio.mouse.move(...at(x1, y1), { steps: 4 }); await studio.mouse.up();
  };
  // Four shapes; each scene plays them differently.
  const boxes = HEAVY
    ? Array.from({ length: 8 }, (_, i) => { const c = i % 4, r = Math.floor(i / 4); return [.02 + c * .245, .04 + r * .48, .23 + c * .245, .46 + r * .48]; })
    : [[.05, .08, .45, .45], [.55, .08, .95, .45], [.05, .55, .45, .92], [.55, .55, .95, .92]];
  for (const b of boxes) await draw(...b);
  const pick = async i => { await studio.getByRole('button', { name: 'Select', exact: true }).click(); await studio.mouse.click(...at((boxes[i][0] + boxes[i][2]) / 2, (boxes[i][1] + boxes[i][3]) / 2)); };
  const HEAVY_SETS = [['prismatic-fold', 'pearl-organism', 'ivory-coral', 'acid-slide'], ['salt-mandala', 'porcelain-shutters', 'rapid-cuts', 'prismatic-fold'], ['acid-slide', 'ivory-coral', 'pearl-organism', 'salt-mandala']];
  const looks = HEAVY ? HEAVY_SETS.map(set => Array.from({ length: 8 }, (_, i) => `preset:${set[(i + (i >> 2)) % 4]}`)) : [
    ['preset:ivory-coral', 'preset:salt-mandala', 'preset:porcelain-shutters', 'colour'],
    ['preset:prismatic-fold', 'colour', 'preset:acid-slide', 'preset:pearl-organism'],
    ['colour', 'preset:rapid-cuts', 'grid', 'preset:ivory-coral'],
  ];
  // The stage as it is belongs to the scene on: scene 1 is kept, then each new scene is added and given its looks.
  const addScene = () => studio.getByRole('button', { name: '+ Scene' }).click();
  for (let scene = 0; scene < 3; scene++) {
    if (scene > 0) await addScene();
    for (let i = 0; i < boxes.length; i++) { await pick(i); await playLook(studio, looks[scene][i]); }
    if (scene === 0) await addScene();
  }
  const reactions = HEAVY ? ['pulse', 'bass-zoom', 'highs-flicker', 'instrument-bass', 'breathe', 'instrument-bass', 'pulse', 'bass-zoom'] : ['pulse', 'bass-zoom', 'highs-flicker', 'breathe'];
  for (let i = 0; i < reactions.length; i++) { await pick(i); await openSection(studio, 'reacts'); await studio.getByLabel('Add a reaction', { exact: true }).selectOption(reactions[i]); }
  await studio.getByRole('tab', { name: /Sound & MIDI/ }).click();
  if (HEAVY) for (const i of [0, 5]) { await pick(i); await studio.getByRole('tab', { name: 'Details' }).click(); await studio.getByLabel('Loop with the tempo', { exact: true }).selectOption('4'); }
  await studio.getByRole('tab', { name: /Sound & MIDI/ }).click();
  await studio.getByRole('button', { name: '+ Trigger' }).click(); // every 16 beats: next scene
  if (HEAVY) await studio.locator('.react-trigger').last().getByLabel('Every', { exact: true }).selectOption('4');
  await studio.waitForFunction(() => !!window.__studioTest?.react, null, { timeout: 5000 });
  await studio.evaluate(() => window.__studioTest.react.testBeat(true));
  await sleep(8000);

  // Every frame on the wall is timed: how many take longer than a 60 Hz frame, and the longest.
  await output.evaluate(() => {
    const f = window.__longFrames = { n: 0, over: 0, worst: 0 };
    let last = performance.now();
    const tick = now => { const d = now - last; last = now; f.n++; if (d > 16.7) f.over++; if (d > f.worst) f.worst = d; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const started = Date.now(), end = started + MINUTES * 60 * 1000;
  let samples = 0, black = 0, scenesSeen = new Set(), worstFps = Infinity, levels = new Set(), last = '';
  const blackAt = [];
  while (Date.now() < end) {
    const s = await output.evaluate(() => {
      const c = document.querySelector('canvas'), copy = new OffscreenCanvas(96, 54), x = copy.getContext('2d', { willReadFrequently: true });
      x.drawImage(c, 0, 0, 96, 54);
      const d = x.getImageData(0, 0, 96, 54).data; let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
      return { lit, fps: window.__mapStats?.fps ?? 0, level: window.__mapStats?.level ?? 0, failing: (window.__mapStats?.failing ?? []).length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, frames: { ...window.__longFrames, worst: Math.round(window.__longFrames?.worst ?? 0) } };
    });
    samples++;
    if (s.lit === 0) { black++; blackAt.push(Math.round((Date.now() - started) / 1000)); }
    if (s.fps) worstFps = Math.min(worstFps, s.fps);
    levels.add(s.level);
    if (samples % 40 === 0) {
      const now = await studio.locator('.map-scene[aria-pressed="true"]').textContent().catch(() => '?');
      scenesSeen.add(now);
      const minute = Math.floor((Date.now() - started) / 60000);
      const line = `${minute} min · ${samples} samples · ${black} black · scene ${now} · fps ${s.fps} · level ${s.level} · failing ${s.failing} · wall heap ${s.heap} MB · frames over 16.7 ms ${s.frames.over} of ${s.frames.n}, worst ${s.frames.worst} ms`;
      if (line.split(' · ')[0] !== last) { console.log(line); last = line.split(' · ')[0]; }
    }
    await sleep(250);
  }
  finished = true;
  const memory = await output.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  const frames = await output.evaluate(() => ({ ...window.__longFrames, worst: Math.round(window.__longFrames.worst) }));
  summary = { heavy: HEAVY, frames, main: await mainNotes(), minutes: MINUTES, samples, blackFrames: black, blackAt: blackAt.slice(0, 20), scenesSeen: [...scenesSeen], worstFpsReported: worstFps, governorLevels: [...levels], wallHeapMB: memory, errors };
} catch (error) {
  summary = { failed: String(error.stack || error), errors, main: await mainNotes(), studio: await globalThis.__studioState?.().catch(e => String(e)) };
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.blackFrames || summary.errors?.length || summary.failed) { process.exitCode = 1; console.log('LONG RUN FAILED'); } else console.log('LONG RUN PASSED');
