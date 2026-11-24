// The real app: test beat through the Meridian panel, hitches from Mutate, Reseed and Recall, and the Flash guard confirmation.
// Run: npm run build && node scripts/meridian-music-app-check.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), stage = path.join(root, 'work/meridian/music-stage');
const profile = path.join(stage, `app-profile-${Date.now()}`);
await fs.mkdir(profile, { recursive: true });
const entry = path.join(stage, 'app-check.cjs');
await fs.writeFile(entry, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const real = await electron.launch({ args: [entry], env });
try {
  const ui = await real.firstWindow(), errors = [];
  ui.setDefaultTimeout(45000);
  ui.on('pageerror', e => errors.push(String(e)));
  await real.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
  await ui.getByText('Export engine ready', { exact: true }).waitFor();
  await ui.getByRole('button', { name: 'Open library', exact: true }).click();
  await ui.getByRole('button', { name: 'Add Meridian', exact: true }).click();
  const close = ui.getByRole('button', { name: 'Close library', exact: true });
  if (await close.isVisible()) await close.click();
  await ui.getByRole('button', { name: 'Store seed in slot 1' }).click();
  await ui.evaluate(() => document.activeElement?.blur());

  // Counts what the preview canvas actually drew in each animation frame.
  await ui.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="Composition preview"]'), gl = canvas.getContext('webgl2'), s = window.__hitch = { draws: 0, frames: [], on: false };
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) { const original = gl[name].bind(gl); gl[name] = (...args) => { s.draws++; return original(...args); }; }
    let last = performance.now();
    const loop = now => { if (s.on) s.frames.push([now - last, s.draws]); s.draws = 0; last = now; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  const measure = async key => {
    await ui.evaluate(() => { window.__hitch.frames = []; window.__hitch.on = true; });
    for (let i = 0; i < 12; i++) { if (key) await ui.keyboard.press(key); await ui.waitForTimeout(350); }
    return ui.evaluate(() => {
      const s = window.__hitch; s.on = false;
      const gaps = s.frames.map(f => f[0]).sort((a, b) => a - b);
      return { frames: s.frames.length, undrawn: s.frames.filter(f => f[1] === 0).length, medianMs: +gaps[gaps.length >> 1].toFixed(1), worstMs: +gaps[gaps.length - 1].toFixed(1), over25ms: gaps.filter(g => g > 25).length };
    });
  };
  const hitch = { idle: await measure(null), mutate: await measure('m'), reseed: await measure('r'), recall: await measure('1') };

  // The panel's own input choice, then the app's test beat.
  await ui.getByRole('button', { name: 'Choose a sound input' }).click();
  await ui.waitForFunction(() => !!window.__studioTest?.react);
  await ui.evaluate(() => window.__studioTest.react.testBeat(true));
  const music = ui.getByRole('region', { name: 'Music' }).getByRole('status').first();
  await ui.waitForFunction(() => /Locked/.test(document.querySelector('[aria-label="Music"] [role=status]')?.textContent ?? ''), null, { timeout: 20000 });
  await ui.waitForTimeout(6000);
  const locked = await music.textContent();
  const shots = [];
  for (let i = 0; i < 6; i++) { shots.push(path.join(stage, `app-beat-${i}.png`)); await ui.locator('canvas[aria-label="Composition preview"]').screenshot({ path: shots[i] }); await ui.waitForTimeout(83); }
  const withMusic = await measure(null);
  await ui.evaluate(() => window.__studioTest.react.testBeat(false));
  await ui.waitForFunction(() => /Holding/.test(document.querySelector('[aria-label="Music"] [role=status]')?.textContent ?? ''), null, { timeout: 8000 });
  const afterStop = await music.textContent();

  // Flash guard: one press only asks; the warning stays until it is back on.
  await ui.getByRole('button', { name: /^Safety/ }).click();
  await ui.getByRole('button', { name: 'Turn off…' }).click();
  const warnBefore = await ui.locator('.m-flash-warning').count();
  await ui.getByRole('button', { name: 'Keep on' }).click();
  const keptOn = await ui.getByRole('button', { name: 'Turn off…' }).count();
  await ui.getByRole('button', { name: 'Turn off…' }).click();
  await ui.getByRole('button', { name: 'Turn off', exact: true }).click();
  await ui.locator('.m-flash-warning').waitFor();
  const warnWhenOff = await ui.locator('.m-flash-warning').count();
  await ui.getByRole('button', { name: 'Turn on' }).click();
  await ui.waitForTimeout(200);
  const warnAfter = await ui.locator('.m-flash-warning').count();
  console.log(JSON.stringify({ hitch, locked, withMusic, afterStop, guard: { warnBefore, keptOn, warnWhenOff, warnAfter }, errors, shots }, null, 1));
} finally { await real.close(); }
