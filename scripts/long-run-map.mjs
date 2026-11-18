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
let summary;
try {
  const studio = await app.firstWindow();
  studio.on('pageerror', e => errors.push(`studio: ${e}`));
  await studio.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await studio.getByRole('button', { name: 'Map', exact: true }).click();
  const stage = studio.getByLabel('Stage', { exact: true });
  await stage.waitFor();
  await studio.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; });
  const opened = app.waitForEvent('window', { timeout: 15000 });
  await studio.getByRole('button', { name: 'Open output' }).click();
  const output = await opened;
  output.on('pageerror', e => errors.push(`wall: ${e}`));
  await output.waitForURL(/#map-output/);

  const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
  const draw = async (x0, y0, x1, y1) => {
    await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await studio.mouse.move(...at(x0, y0)); await studio.mouse.down(); await studio.mouse.move(...at(x1, y1), { steps: 4 }); await studio.mouse.up();
  };
  // Four shapes; each scene plays them differently.
  const boxes = [[.05, .08, .45, .45], [.55, .08, .95, .45], [.05, .55, .45, .92], [.55, .55, .95, .92]];
  for (const b of boxes) await draw(...b);
  const pick = async i => { await studio.getByRole('button', { name: 'Select', exact: true }).click(); await studio.mouse.click(...at((boxes[i][0] + boxes[i][2]) / 2, (boxes[i][1] + boxes[i][3]) / 2)); };
  const looks = [
    ['preset:ivory-coral', 'preset:salt-mandala', 'preset:porcelain-shutters', 'colour'],
    ['preset:prismatic-fold', 'colour', 'preset:acid-slide', 'preset:pearl-organism'],
    ['colour', 'preset:rapid-cuts', 'grid', 'preset:ivory-coral'],
  ];
  // The stage as it is belongs to the scene on: scene 1 is kept, then each new scene is added and given its looks.
  const addScene = () => studio.getByRole('button', { name: '+ Scene' }).click();
  for (let scene = 0; scene < 3; scene++) {
    if (scene > 0) await addScene();
    for (let i = 0; i < 4; i++) { await pick(i); await playLook(studio, looks[scene][i]); }
    if (scene === 0) await addScene();
  }
  const reactions = ['pulse', 'bass-zoom', 'highs-flicker', 'breathe'];
  for (let i = 0; i < 4; i++) { await pick(i); await openSection(studio, 'reacts'); await studio.getByLabel('Add a reaction', { exact: true }).selectOption(reactions[i]); }
  await studio.getByRole('tab', { name: /Sound & MIDI/ }).click();
  await studio.getByRole('button', { name: '+ Trigger' }).click(); // every 16 beats: next scene
  await studio.waitForFunction(() => !!window.__studioTest?.react, null, { timeout: 5000 });
  await studio.evaluate(() => window.__studioTest.react.testBeat(true));
  await sleep(8000);

  const started = Date.now(), end = started + MINUTES * 60 * 1000;
  let samples = 0, black = 0, scenesSeen = new Set(), worstFps = Infinity, levels = new Set(), last = '';
  const blackAt = [];
  while (Date.now() < end) {
    const s = await output.evaluate(() => {
      const c = document.querySelector('canvas'), copy = new OffscreenCanvas(96, 54), x = copy.getContext('2d', { willReadFrequently: true });
      x.drawImage(c, 0, 0, 96, 54);
      const d = x.getImageData(0, 0, 96, 54).data; let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
      return { lit, fps: window.__mapStats?.fps ?? 0, level: window.__mapStats?.level ?? 0, failing: (window.__mapStats?.failing ?? []).length };
    });
    samples++;
    if (s.lit === 0) { black++; blackAt.push(Math.round((Date.now() - started) / 1000)); }
    if (s.fps) worstFps = Math.min(worstFps, s.fps);
    levels.add(s.level);
    if (samples % 40 === 0) {
      const now = await studio.locator('.map-scene[aria-pressed="true"]').textContent().catch(() => '?');
      scenesSeen.add(now);
      const minute = Math.floor((Date.now() - started) / 60000);
      const line = `${minute} min · ${samples} samples · ${black} black · scene ${now} · fps ${s.fps} · level ${s.level} · failing ${s.failing}`;
      if (minute % 5 === 0 && line.split(' · ')[0] !== last) { console.log(line); last = line.split(' · ')[0]; }
    }
    await sleep(250);
  }
  const memory = await output.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  summary = { minutes: MINUTES, samples, blackFrames: black, blackAt: blackAt.slice(0, 20), scenesSeen: [...scenesSeen], worstFpsReported: worstFps, governorLevels: [...levels], wallHeapMB: memory, errors };
} catch (error) {
  summary = { failed: String(error.stack || error), errors };
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.blackFrames || summary.errors?.length || summary.failed) { process.exitCode = 1; console.log('LONG RUN FAILED'); } else console.log('LONG RUN PASSED');
