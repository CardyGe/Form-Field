// Real Electron check of the Perform screen, end to end: a three-zone show built through the screen itself, played
// from the on-screen controller on to a real wall window.
// Run: npm run test:perform   (builds first). Uses a throwaway user-data folder under work/perform/.
// Writes work/perform/perform-empty.png and work/perform/perform-playing.png (1512 x 982) for review by eye.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/perform');
const userData = path.join(out, 'user-data');
const shots = process.env.PERFORM_SHOTS || out;
await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });
await fs.mkdir(shots, { recursive: true });

const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
const results = [], errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
const check = async (name, run) => {
  try { await run(); results.push(`ok    ${name}`); }
  catch (error) { failed = true; results.push(`FAIL  ${name}\n      ${String(error.message).split('\n')[0]}`); process.exitCode = 1; }
};
const until = async (test, ms, what) => {
  const end = Date.now() + ms;
  for (;;) { if (await test()) return; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(60); }
};

// The four shapes, as fractions of the stage. The fourth belongs to no zone.
const BOXES = [{ x0: .05, y0: .15, x1: .25, y1: .6 }, { x0: .3, y0: .15, x1: .5, y1: .6 }, { x0: .55, y0: .15, x1: .75, y1: .6 }, { x0: .8, y0: .15, x1: .95, y1: .6 }];
/** How much of each box is lit on the wall, from 0 to 1. */
const litIn = (wall, boxes = BOXES) => wall.evaluate(list => {
  const c = document.querySelector('canvas'), copy = new OffscreenCanvas(192, 108), x = copy.getContext('2d', { willReadFrequently: true });
  x.drawImage(c, 0, 0, 192, 108);
  const d = x.getImageData(0, 0, 192, 108).data;
  return list.map(b => {
    let lit = 0, all = 0;
    for (let py = Math.ceil(b.y0 * 108) + 1; py < Math.floor(b.y1 * 108) - 1; py++) for (let px = Math.ceil(b.x0 * 192) + 1; px < Math.floor(b.x1 * 192) - 1; px++) {
      const i = (py * 192 + px) * 4; all++;
      if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
    }
    return lit / all;
  });
}, boxes);
const LIT = .05;
const allBlack = async wall => (await litIn(wall)).every(v => v < .005);
const view = studio => studio.evaluate(() => window.__studioTest.perform());
/** Each zone's average colour on the wall, over a dozen frames so a moving look averages out. */
const zoneColours = async wall => {
  const frames = [];
  for (let i = 0; i < 12; i++) { frames.push(await wall.evaluate(list => {
    const c = document.querySelector('canvas'), copy = new OffscreenCanvas(192, 108), x = copy.getContext('2d', { willReadFrequently: true });
    x.drawImage(c, 0, 0, 192, 108);
    const d = x.getImageData(0, 0, 192, 108).data;
    return list.map(b => {
      const sum = [0, 0, 0]; let n = 0;
      for (let py = Math.ceil(b.y0 * 108) + 1; py < Math.floor(b.y1 * 108) - 1; py++) for (let px = Math.ceil(b.x0 * 192) + 1; px < Math.floor(b.x1 * 192) - 1; px++) { const i = (py * 192 + px) * 4; sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; n++; }
      return sum.map(v => v / n);
    });
  }, BOXES.slice(0, 3))); await sleep(50); }
  return [0, 1, 2].map(z => [0, 1, 2].map(ch => frames.reduce((a, f) => a + f[z][ch], 0) / frames.length));
};

try {
  const studio = await app.firstWindow();
  studio.on('pageerror', e => errors.push(`studio: ${e}`));
  await studio.setViewportSize({ width: 1512, height: 982 }).catch(() => {});
  await studio.getByLabel('Project name', { exact: true }).waitFor();
  await sleep(1200);
  // Map and Perform draw over Studio with their own copy of the section switch.
  const go = async name => {
    const over = studio.locator('.live-shell');
    await ((await over.count()) ? over : studio).getByRole('button', { name, exact: true }).first().click();
  };

  await check('Perform opens from the section switch, and shows an empty set plainly', async () => {
    await go('Perform');
    await studio.getByRole('region', { name: 'Perform' }).waitFor({ timeout: 5000 });
    await studio.getByRole('button', { name: 'Add scene' }).waitFor();
    await studio.screenshot({ path: path.join(shots, 'perform-empty.png') });
  });

  // ---- The room, drawn in Map ----
  await go('Map');
  const stage = studio.getByLabel('Stage', { exact: true });
  await stage.waitFor();
  const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
  for (const b of BOXES) {
    await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await studio.mouse.move(...at(b.x0, b.y0)); await studio.mouse.down();
    await studio.mouse.move(...at((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2), { steps: 4 }); await studio.mouse.move(...at(b.x1, b.y1), { steps: 4 }); await studio.mouse.up();
  }
  await studio.getByRole('button', { name: 'Select', exact: true }).click();
  await sleep(700);
  await go('Perform');
  await studio.getByRole('region', { name: 'Perform' }).waitFor();

  // ---- The set, built on the Perform screen ----
  const cell = (row, zone) => studio.locator(`[data-cell="${row}-${zone}"]`);
  const place = async (row, zone, look) => {
    await cell(row, zone).click();
    await studio.locator(`[data-pf-look="${look}"]`).click();
    await studio.locator(`[data-cell="${row}-${zone}"][data-filled="true"]`).waitFor({ timeout: 4000 });
  };
  await check('zones are assigned from Map, scenes added and clips placed', async () => {
    for (let z = 0; z < 3; z++) {
      await studio.getByRole('button', { name: `Choose the place for zone ${z + 1}` }).click();
      await studio.getByRole('menuitem', { name: `Shape ${z + 1}`, exact: true }).click();
    }
    await studio.getByRole('button', { name: 'Add scene' }).click();
    await place(0, 0, 'preset:salt-mandala');
    await studio.getByRole('button', { name: 'Close looks' }).click();
    await studio.screenshot({ path: path.join(shots, 'perform-1-scene.png') });
    const big = await cell(0, 0).boundingBox();
    assert.ok(big.height >= 100, `one scene's row is only ${big.height}px tall`);
    await studio.getByRole('button', { name: 'Add scene' }).click();
    // A steady look on zone 2, so the per-zone pixel comparison below can really fail.
    await place(0, 1, 'preset:salt-mandala');
    await place(0, 2, 'preset:salt-mandala');
    await place(1, 0, 'preset:porcelain-shutters');
    await studio.screenshot({ path: path.join(shots, 'perform-looks.png') });
    const master = await studio.getByRole('slider', { name: 'Master', exact: true }).boundingBox(), looks = await studio.getByRole('complementary', { name: 'Looks' }).boundingBox();
    assert.ok(looks.y + looks.height <= master.y, 'the look list covers the controller');
    await studio.getByRole('button', { name: 'Close looks' }).click();
  });

  await check('dragging a filled cell on to another links the same clip', async () => {
    await cell(0, 0).dragTo(cell(1, 2));
    await studio.locator('[data-cell="1-2"][data-filled="true"]').waitFor({ timeout: 3000 });
    const set = await studio.evaluate(() => window.__studioTest.performSet());
    assert.equal(set.scenes[1].cells[2], set.scenes[0].cells[0]);
    await cell(1, 2).click({ button: 'right' });
    await studio.getByRole('menuitem', { name: 'Clear' }).click();
    await studio.locator('[data-cell="1-2"][data-filled="false"]').waitFor({ timeout: 3000 });
  });

  await check('a look drags from the list on to a cell', async () => {
    await cell(1, 1).click();
    await studio.locator('[data-pf-look="preset:salt-mandala"]').dragTo(cell(1, 1));
    await studio.locator('[data-cell="1-1"][data-filled="true"]').waitFor({ timeout: 3000 });
    await studio.getByRole('button', { name: 'Close looks' }).click();
    await cell(1, 1).click({ button: 'right' });
    await studio.getByRole('menuitem', { name: 'Clear' }).click();
    await studio.locator('[data-cell="1-1"][data-filled="false"]').waitFor({ timeout: 3000 });
    await studio.getByRole('button', { name: 'Close looks' }).click().catch(() => {});
  });
  await check('the right-click menu sets a blend, timing and audio band', async () => {
    const clipAt = () => studio.evaluate(() => { const s = window.__studioTest.performSet(); return s.clips.find(c => c.id === s.scenes[0].cells[1]); });
    for (const name of ['Fade 2', '4 beats', 'Bass']) {
      await cell(0, 1).click({ button: 'right' });
      await studio.getByRole('menuitemradio', { name, exact: true }).click();
    }
    const clip = await clipAt();
    assert.deepEqual(clip.blend, { kind: 'fade', bars: 2 });
    assert.equal(clip.audioBand, 'bass');
    await cell(0, 1).click({ button: 'right' });
    assert.equal(await studio.getByRole('menuitemradio', { name: '4 beats', exact: true }).getAttribute('aria-checked'), 'true');
    // Back to Free: a fast locked loop would make this zone too restless for the per-zone pixel comparison.
    await studio.getByRole('menuitemradio', { name: 'Free', exact: true }).click();
  });
  await check('Duplicate and edit opens an independent copy in Studio, and comes back', async () => {
    const before = await studio.evaluate(() => { const s = window.__studioTest.performSet(); return s.clips.find(c => c.id === s.scenes[0].cells[1]); });
    await cell(0, 1).click({ button: 'right' });
    await studio.getByRole('menuitem', { name: 'Duplicate and edit' }).click();
    await studio.getByRole('button', { name: 'Back to Perform' }).click({ timeout: 5000 });
    await studio.getByRole('region', { name: 'Perform' }).waitFor();
    const after = await studio.evaluate(() => { const s = window.__studioTest.performSet(); return s.clips.find(c => c.id === s.scenes[0].cells[1]); });
    assert.notEqual(after.sourceId, before.sourceId);
    assert.match(after.name, /copy$/);
  });
  await check('the sound input opens from the status row', async () => {
    await studio.getByRole('button', { name: /^AUDIO/ }).click();
    await studio.getByRole('complementary', { name: 'Sound input' }).waitFor({ timeout: 3000 });
    await studio.getByRole('button', { name: 'Close sound input' }).click();
  });

  let wall;
  const openWall = async () => {
    const opened = app.waitForEvent('window', { timeout: 15000 });
    await studio.getByRole('button', { name: 'Open projector' }).click();
    const w = await opened;
    await w.waitForURL(/#map-output/);
    await w.waitForSelector('canvas');
    w.on('pageerror', e => errors.push(`wall: ${e}`));
    await studio.getByRole('button', { name: 'Close projector' }).waitFor({ timeout: 10000 });
    return w;
  };
  wall = await openWall();
  // Left on in Map: neither may carry into a show unseen.
  await go('Map');
  await studio.locator('.live-shell').getByRole('button', { name: 'Test grid' }).click();
  await studio.locator('.live-shell').getByRole('button', { name: 'Freeze' }).click();
  await go('Perform');
  await studio.getByRole('button', { name: 'Start show' }).click();
  await studio.getByRole('button', { name: 'End show' }).waitFor({ timeout: 5000 });
  await check('Start show clears Test grid and Freeze, and says so', async () => {
    await studio.getByText('Test grid and Freeze turned off for the show').waitFor({ timeout: 2000 });
    assert.equal(await studio.getByRole('button', { name: /turn off$/ }).count(), 0);
  });
  await studio.evaluate(() => window.__studioTest.react.testBeat(true));
  const setRange = async (label, value) => studio.getByRole('slider', { name: label, exact: true }).fill(String(value));

  await check('the wall is black before Send All, even with the faders up', async () => {
    await setRange('Master', 1);
    for (let z = 1; z <= 3; z++) await setRange(`Fader ${z}`, 1);
    await sleep(900);
    assert.ok(await allBlack(wall), `lit: ${await litIn(wall)}`);
  });
  await check('a Send All cut off by losing focus does not count as finished', async () => {
    await studio.keyboard.down('Backslash');
    await studio.evaluate(() => window.dispatchEvent(new Event('blur')));
    await studio.keyboard.up('Backslash');
    await sleep(100);
    assert.equal((await view(studio)).controls.ready, false);
  });
  await check('the wall is still black after Send All, until Bank ▶', async () => {
    await studio.getByRole('button', { name: 'Send All' }).click();
    await until(async () => (await view(studio)).controls.ready, 2000, 'Send All');
    await sleep(900);
    assert.ok(await allBlack(wall), `lit: ${await litIn(wall)}`);
  });
  await check('Bank ▶ lands the first scene on the bar', async () => {
    await until(async () => (await view(studio)).armed.length >= 1, 15000, 'the first scene to arm');
    await studio.getByRole('button', { name: 'Bank next' }).click();
    const queued = (await view(studio)).launcher.queue[0];
    assert.ok(queued, 'nothing was queued');
    assert.equal(queued.beat % 4, (await view(studio)).clock.barOffset % 4, 'the launch is not on a bar');
    await studio.locator('[data-cell="0-0"][data-state="queued"]').waitFor({ timeout: 1500 }).catch(() => {});
    await until(async () => (await view(studio)).launcher.sceneIndex === 0, 12000, 'the scene to land');
    await until(async () => (await litIn(wall)).slice(0, 3).every(v => v > LIT), 8000, 'the three zones to light');
  });
  await check('a shape in no zone is black on the wall', async () => {
    const lit = await litIn(wall);
    assert.ok(lit[3] < .005, `the unassigned shape is lit: ${lit[3]}`);
  });
  await studio.screenshot({ path: path.join(shots, 'perform-playing.png') });

  await check('Amber changes one zone only', async () => {
    const before = (await view(studio)).launcher.playing;
    // No audio reaction, so a zone's brightness does not pulse. How far each look drifts by itself over the same wait is measured first.
    for (let strip = 1; strip <= 3; strip++) {
      await studio.getByRole('slider', { name: `Strip ${strip} Audio`, exact: true }).focus();
      for (let i = 0; i < 11; i++) await studio.keyboard.press('ArrowDown');
    }
    await studio.evaluate(() => document.activeElement?.blur());
    // Zone 2's clip was given a two-bar fade above: it must have finished arriving before its drift is measured.
    await sleep(4500);
    const distance = (a, b) => a.map((c, i) => Math.hypot(c[0] - b[i][0], c[1] - b[i][1], c[2] - b[i][2]));
    const drift0 = await zoneColours(wall);
    await sleep(2600);
    const drift = distance(drift0, await zoneColours(wall));
    const colourBefore = await zoneColours(wall);
    await studio.getByRole('button', { name: 'Amber 1', exact: true }).click();
    await studio.locator('[data-state="queued"]').first().waitFor({ timeout: 1500 });
    await studio.screenshot({ path: path.join(shots, 'perform-queued.png') });
    await until(async () => (await view(studio)).launcher.playing[0] !== before[0], 12000, 'zone 1 to change');
    const after = (await view(studio)).launcher.playing;
    assert.deepEqual(after.slice(1), before.slice(1));
    await until(async () => (await litIn(wall))[0] > LIT, 6000, 'zone 1 to stay lit');
    const lit = await litIn(wall);
    assert.ok(lit[1] > LIT && lit[2] > LIT, `other zones: ${lit}`);
    // The one-bar fade finishes, then each zone's own pixels are compared: only zone 1 has become a different picture.
    await sleep(2600);
    const colourAfter = await zoneColours(wall);
    const moved = distance(colourBefore, colourAfter);
    const said = `zone colour change ${moved.map(v => v.toFixed(1))}; drift alone ${drift.map(v => v.toFixed(1))}`;
    console.log(said);
    assert.ok(moved[0] > 10 && moved[0] > 2 * drift[0], said);
    for (const z of [1, 2]) {
      assert.ok(drift[z] < 8, `zone ${z + 1} is too restless for this comparison to mean anything: ${said}`);
      assert.ok(moved[z] < 12, `zone ${z + 1} changed: ${said}`);
    }
  });
  await check('during a show a click plays: a cell, then a scene, and nothing on screen moves', async () => {
    const place = async () => JSON.stringify([await cell(0, 0).boundingBox(), await cell(1, 0).boundingBox(), await studio.getByRole('button', { name: 'Amber 1', exact: true }).boundingBox()]);
    const layout = await place();
    const a = await cell(0, 0).boundingBox(), amber = await studio.getByRole('button', { name: 'Amber 1', exact: true }).boundingBox();
    assert.ok(Math.abs(a.x - amber.x) < 8, `the grid is out of line with the strips: ${a.x} against ${amber.x}`);
    const clipA = await studio.evaluate(() => window.__studioTest.performSet().scenes[0].cells[0]);
    await cell(0, 0).click();
    assert.equal(await studio.getByRole('complementary', { name: 'Looks' }).count(), 0, 'a click during a show opened the look list');
    await until(async () => (await view(studio)).launcher.playing[0] === clipA, 12000, 'the clicked cell to land');
    assert.equal(await place(), layout, 'the layout moved');
    await studio.locator('.pf-scene', { hasText: 'Scene 2' }).click();
    await until(async () => (await view(studio)).launcher.sceneIndex === 1, 12000, 'the clicked scene to land');
    assert.equal(await place(), layout, 'the layout moved');
  });
  await check('during a show a press with slight mouse movement still launches, and never overwrites a cell', async () => {
    const setBefore = await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet().scenes));
    const clipAt = row => studio.evaluate(r => window.__studioTest.performSet().scenes[r].cells[0], row);
    const rows = [await clipAt(0), await clipAt(1)];
    assert.equal(await cell(0, 0).getAttribute('draggable'), 'false', 'a cell can be dragged during a show');
    for (const d of [3, 8, 12]) {
      const playing = (await view(studio)).launcher.playing[0], row = rows[0] === playing ? 1 : 0, box = await cell(row, 0).boundingBox();
      // Pressed near the cell's edge and released past it, over the other row.
      const x = box.x + box.width / 2, y = row === 0 ? box.y + box.height - 2 : box.y + 2;
      await studio.mouse.move(x, y); await studio.mouse.down();
      await studio.mouse.move(x + d / 2, y + (row === 0 ? d : -d), { steps: 4 }); await studio.mouse.up();
      await until(async () => { const v = await view(studio); return v.launcher.playing[0] === rows[row] || v.launcher.queue.some(l => l.changes.some(c => c.zone === 0 && c.clipId === rows[row])); }, 1000, `the ${d}px press to launch`);
      await until(async () => (await view(studio)).launcher.playing[0] === rows[row], 12000, `the ${d}px press to land`);
    }
    assert.equal(await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet().scenes)), setBefore, 'a cell was overwritten');
  });
  await check('+ Scene is off during a show and says why', async () => {
    const before = await studio.locator('[data-row]').count();
    const add = studio.getByRole('button', { name: 'Add scene' });
    assert.equal(await add.getAttribute('aria-disabled'), 'true');
    await add.click({ force: true });
    await studio.getByText('End the show to add a scene.').waitFor({ timeout: 1500 });
    assert.equal(await studio.locator('[data-row]').count(), before);
  });
  await check('closing the sound input menu with Escape gives the keyboard back', async () => {
    await studio.getByRole('button', { name: /^AUDIO/ }).click();
    const select = studio.locator('.pf-sound select').first();
    await select.waitFor({ timeout: 3000 });
    await select.focus();
    await studio.keyboard.press('Escape');
    assert.equal(await studio.evaluate(() => document.activeElement?.tagName), 'BODY');
    await studio.keyboard.down('Shift');
    await until(async () => (await view(studio)).shift, 1000, 'the keyboard to work');
    await studio.keyboard.up('Shift');
    await until(async () => !(await view(studio)).shift, 1000, 'Shift to release');
    await studio.getByRole('button', { name: 'Close sound input' }).click();
  });
  await check('an open right-click menu keeps its focus while the show plays', async () => {
    await cell(0, 1).click({ button: 'right' });
    await studio.getByRole('menuitemradio', { name: 'Bass', exact: true }).focus();
    await sleep(600);
    assert.equal(await studio.evaluate(() => document.activeElement?.textContent), 'Bass');
    await studio.keyboard.press('Escape');
  });
  await check('right mouse on a controller button does nothing', async () => {
    const queued = (await view(studio)).launcher.queue.length;
    await studio.getByRole('button', { name: 'Amber 3', exact: true }).click({ button: 'right' });
    await sleep(150);
    assert.equal((await view(studio)).launcher.queue.length, queued);
  });
  await check('Freeze or Test grid turned on during a show is shown in the status row', async () => {
    await go('Map');
    await studio.locator('.live-shell').getByRole('button', { name: 'Freeze' }).click();
    await go('Perform');
    const flag = studio.getByRole('button', { name: 'Frozen: turn off' });
    await flag.waitFor({ timeout: 2000 });
    await flag.click();
    await flag.waitFor({ state: 'detached', timeout: 2000 });
  });
  await check('the Launch menu gives the keyboard back when it closes, chosen or not', async () => {
    const shiftWorks = async () => {
      await studio.keyboard.down('Shift');
      await until(async () => (await view(studio)).shift, 1000, 'the keyboard to work');
      await studio.keyboard.up('Shift');
      await until(async () => !(await view(studio)).shift, 1000, 'Shift to release');
    };
    const launch = studio.getByRole('button', { name: 'Launch timing' });
    await launch.click();
    await studio.keyboard.press('Escape');
    await shiftWorks();
    await launch.click();
    await studio.getByRole('menuitemcheckbox', { name: '1 bar' }).click();
    await shiftWorks();
  });
  await check('undo cannot pull a playing clip out from under the show', async () => {
    const before = await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet()));
    await studio.getByRole('button', { name: 'Undo', exact: true }).click();
    await studio.getByText(/^That undo would/).first().waitFor({ timeout: 2000 });
    assert.equal(await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet())), before);
  });
  await check('Map scene edits are paused with a plain note during a show', async () => {
    await go('Map');
    await studio.getByText('Map scenes are paused').first().waitFor({ timeout: 3000 });
    assert.ok(await studio.getByRole('button', { name: '+ Scene' }).isDisabled());
  });
  await check('Live cannot take the projector from a running show, and says why', async () => {
    await go('Live');
    const open = studio.locator('.live-shell').getByRole('button', { name: 'Open output' });
    await open.waitFor({ timeout: 5000 });
    await studio.waitForFunction(() => { const b = [...document.querySelectorAll('.live-shell button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; }, null, { timeout: 8000 });
    await open.click();
    await studio.getByText('A Perform show is using the projector').waitFor({ timeout: 3000 });
    assert.ok(!wall.isClosed(), 'the wall closed');
    await studio.getByRole('button', { name: 'Dismiss error' }).click();
  });
  await check('moving to Map and Studio and back leaves the wall open and playing', async () => {
    await go('Map');
    await go('Studio');
    await sleep(500);
    assert.ok(!wall.isClosed(), 'the wall closed');
    await go('Perform');
    await studio.getByRole('region', { name: 'Perform' }).waitFor();
    assert.equal((await view(studio)).running, true);
    await until(async () => (await litIn(wall)).slice(0, 3).every(v => v > LIT), 4000, 'the picture');
  });
  await check('keyboard: Shift + 1 is Solo + Amber, and Shift is released when the window loses focus', async () => {
    await studio.locator('.pf-grid').click({ position: { x: 2, y: 2 } }).catch(() => {});
    const back = (await view(studio)).launcher.previous[0];
    assert.ok(back, 'zone 1 has no previous clip');
    await studio.keyboard.down('Shift');
    await until(async () => (await view(studio)).shift, 1000, 'Solo');
    await studio.keyboard.press('Digit1');
    await until(async () => (await view(studio)).launcher.queue.some(l => l.changes.some(c => c.zone === 0 && c.clipId === back)), 1000, 'Solo + Amber to queue the previous clip');
    await studio.evaluate(() => window.dispatchEvent(new Event('blur')));
    await until(async () => !(await view(studio)).shift, 1000, 'Solo to release');
    await studio.keyboard.up('Shift');
  });
  await check('on-screen Solo latches, so one mouse can reach the shifted controls', async () => {
    const solo = studio.getByRole('button', { name: 'Solo', exact: true });
    await solo.click();
    await until(async () => (await view(studio)).shift, 1000, 'Solo on');
    await studio.getByRole('button', { name: 'Bank back' }).getByText('This is the 1').waitFor({ timeout: 1000 });
    await solo.click();
    await until(async () => !(await view(studio)).shift, 1000, 'Solo off');
  });
  await check('the clock reaches LOCKED on a steady beat', async () => {
    await until(async () => (await view(studio)).clock.state === 'locked', 30000, `LOCKED (still ${(await view(studio)).clock.state})`);
  });
  await check('Master at 0 is black', async () => {
    await setRange('Master', 0);
    await until(() => allBlack(wall), 3000, 'black');
    await setRange('Master', 1);
    await until(async () => (await litIn(wall)).slice(0, 3).every(v => v > LIT), 4000, 'the picture to return');
  });
  await check('closing and reopening the wall restores the picture', async () => {
    await studio.getByRole('button', { name: 'Close projector' }).click();
    await studio.getByRole('button', { name: 'Open projector' }).waitFor({ timeout: 5000 });
    wall = await openWall();
    await until(async () => (await litIn(wall)).slice(0, 3).every(v => v > LIT), 15000, 'the picture on the new wall');
    assert.ok((await litIn(wall))[3] < .005, 'the unassigned shape is lit on the new wall');
  });
  // ---- Clip drafts: zone 3 plays one steady look, and Hide layer changes it plainly ----
  const crossfades = () => wall.evaluate(() => window.__mapStats?.crossfades ?? 0);
  const colourGap = (a, b) => Math.hypot(a[2][0] - b[2][0], a[2][1] - b[2][1], a[2][2] - b[2][2]);
  const stillLit = colours => colours[2][0] + colours[2][1] + colours[2][2] > 150;
  /** What the wall has done to zone 3's source: prepared it again, or adjusted a playing effect. Reported once a second. */
  const wallWork = async () => {
    const id = await studio.evaluate(() => { const v = window.__studioTest.perform(), s = window.__studioTest.performSet(); return s.clips.find(c => c.id === v.launcher.playing[2])?.sourceId; });
    return wall.evaluate(source => JSON.stringify([window.__mapStats?.prepares?.[source], window.__mapStats?.adjusted]), id);
  };
  // The layer list starts collapsed, which hides its eye buttons.
  const toggleLayer = async () => {
    const expand = studio.getByRole('button', { name: 'Expand layer list' });
    if (await expand.count()) await expand.click();
    await studio.getByTitle(/^(Hide|Show) layer$/).first().click();
  };
  const openDraft = async (zone = 2) => {
    const row = await studio.evaluate(z => { const v = window.__studioTest.perform(), s = window.__studioTest.performSet(); return s.scenes.findIndex(r => r.cells[z] === v.launcher.playing[z]); }, zone);
    await cell(row, zone).click({ button: 'right' });
    await studio.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await studio.getByRole('button', { name: 'Apply to show' }).waitFor({ timeout: 5000 });
  };
  await check('a draft leaves the wall alone, and the controller keeps working while it is open', async () => {
    const fades = await crossfades(), work = await wallWork(), setBefore = await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet()));
    await openDraft();
    await toggleLayer();
    await sleep(1400);
    // This look moves by itself, so its colour cannot prove stillness. The wall's own count of work on the source can,
    // and a hidden layer that leaked would turn the zone almost black.
    const during = await zoneColours(wall);
    console.log(`draft: zone 3 colour sum ${(during[2][0] + during[2][1] + during[2][2]).toFixed(0)} while its layer is hidden in the draft`);
    assert.ok(stillLit(during), 'the hidden layer reached the wall during a draft');
    assert.equal(await wallWork(), work, 'the wall worked on the source during a draft');
    assert.equal(await crossfades(), fades);
    assert.equal(await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet())), setBefore);
    // Typing in a Studio field never reaches the controller.
    const queued = (await view(studio)).launcher.queue.length;
    const name = studio.getByLabel('Project name', { exact: true });
    await name.click();
    await studio.keyboard.type('1q[');
    await studio.keyboard.press('Escape');
    assert.equal((await view(studio)).launcher.queue.length, queued, 'typing in Studio launched something');
    assert.equal((await view(studio)).shift, false);
    // The controller's own path into the show, as MIDI takes it.
    const playing = (await view(studio)).launcher.playing[0];
    await studio.evaluate(() => { const c = window.__studioTest.performControl; c({ kind: 'amber', strip: 0, down: true }); c({ kind: 'amber', strip: 0, down: false }); });
    await until(async () => (await view(studio)).launcher.playing[0] !== playing, 12000, 'the controller to change zone 1 during a draft');
  });
  await check('Discard leaves the show as it was and goes back to Perform', async () => {
    const setBefore = await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet())), fades = await crossfades();
    await studio.getByRole('button', { name: 'Discard' }).click();
    await studio.getByRole('region', { name: 'Perform' }).waitFor({ timeout: 3000 });
    await sleep(600);
    assert.equal(await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet())), setBefore);
    assert.equal(await crossfades(), fades);
  });
  await check('Apply to show crossfades the wall once, and undoing it is refused', async () => {
    const fades = await crossfades(), before = await zoneColours(wall), work = await wallWork();
    await openDraft();
    await toggleLayer();
    await sleep(1400);
    assert.ok(stillLit(await zoneColours(wall)), 'the hidden layer reached the wall before Apply');
    assert.equal(await wallWork(), work, 'the wall worked on the source before Apply');
    await studio.getByRole('button', { name: 'Apply to show' }).click();
    await studio.getByRole('region', { name: 'Perform' }).waitFor({ timeout: 3000 });
    await until(async () => await crossfades() === fades + 1, 5000, 'one crossfade on the wall');
    await sleep(700);
    const after = await zoneColours(wall), gap = colourGap(before, after);
    console.log(`apply: zone 3 colour moved ${gap.toFixed(1)}`);
    assert.ok(gap > 10, `the wall did not take the new look: ${gap.toFixed(1)}`);
    assert.equal(await crossfades(), fades + 1, 'more than one crossfade');
    await studio.getByRole('button', { name: 'Undo', exact: true }).click();
    await studio.getByText('That undo would change the running picture').first().waitFor({ timeout: 2000 });
    await sleep(600);
    assert.ok(colourGap(after, await zoneColours(wall)) < 8, 'the refused undo changed the wall');
  });
  await check('a look that cannot start: the old one keeps playing, the show goes back, and the draft is kept', async () => {
    // Passes the file checks, but no browser can decode it.
    const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b; };
    const header = Buffer.alloc(13); header.writeUInt32BE(4, 0); header.writeUInt32BE(4, 4); header[8] = 8; header[9] = 6;
    const bad = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', Buffer.from([1, 2, 3, 4])), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
    const setBefore = await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet())), undoBefore = await studio.getByRole('button', { name: 'Undo', exact: true }).isEnabled();
    await openDraft(1);
    await studio.evaluate(url => window.__studioTest.studioDraft.edit(p => ({ ...p, layers: p.layers.map(l => ({ ...l, mask: { kind: 'image', softness: .1, invert: false, size: 1, dataUrl: url } })) })), bad);
    await studio.getByRole('button', { name: 'Apply to show' }).click();
    await studio.getByText('The new look could not start. The old one is still playing.').waitFor({ timeout: 8000 });
    await studio.getByRole('button', { name: 'Back to draft' }).waitFor({ timeout: 3000 });
    for (let i = 0; i < 8; i++) { assert.ok((await litIn(wall))[1] > LIT, 'the zone lost its picture'); await sleep(150); }
    await until(() => wall.evaluate(() => (window.__mapStats?.failing ?? []).length === 0), 4000, 'the wall to be back on the old look');
    assert.equal(await studio.locator('.error-toast').count(), 0, 'a lasting error covers the controller');
    assert.equal(await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet())), setBefore);
    assert.equal(await studio.getByRole('button', { name: 'Undo', exact: true }).isEnabled(), undoBefore);
    await studio.getByRole('button', { name: 'Back to draft' }).click();
    await studio.getByRole('button', { name: 'Apply to show' }).waitFor({ timeout: 3000 });
    assert.equal(await studio.evaluate(() => window.__studioTest.studioDraft.get().layers[0].mask.dataUrl), bad, 'the draft lost its content');
    await studio.getByRole('button', { name: 'Discard' }).click();
    await studio.getByRole('region', { name: 'Perform' }).waitFor({ timeout: 3000 });
  });
  await check('Duplicate and edit during a show adds nothing until Apply, so Discard leaves the set as it was', async () => {
    const setBefore = await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet()));
    await cell(0, 1).click({ button: 'right' });
    await studio.getByRole('menuitem', { name: 'Duplicate and edit' }).click();
    await studio.getByRole('button', { name: 'Apply to show' }).waitFor({ timeout: 5000 });
    assert.equal(await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet())), setBefore, 'the copy was made before Apply');
    await studio.getByRole('button', { name: 'Discard' }).click();
    await studio.getByRole('region', { name: 'Perform' }).waitFor({ timeout: 3000 });
    assert.equal(await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet())), setBefore);
  });
  await check('End show with a draft open keeps the draft, says so, and applies nothing', async () => {
    await openDraft();
    await toggleLayer();
    await go('Perform');
    await studio.getByRole('button', { name: 'Back to draft' }).waitFor({ timeout: 3000 });
    const setBefore = await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet())), fades = await crossfades();
    await studio.getByRole('button', { name: 'End show' }).click();
    await studio.getByRole('button', { name: 'End show now' }).click();
    await until(async () => !(await view(studio)).running, 3000, 'the show to end');
    await studio.getByRole('button', { name: 'Back to draft' }).click();
    await studio.getByText('The show has ended').waitFor({ timeout: 3000 });
    assert.equal(await studio.evaluate(() => JSON.stringify(window.__studioTest.performSet())), setBefore);
    assert.equal(await crossfades(), fades, 'End show applied the draft');
    await studio.getByRole('button', { name: 'Discard' }).click();
    await studio.getByRole('region', { name: 'Perform' }).waitFor({ timeout: 3000 });
    await studio.getByRole('button', { name: 'Start show' }).click();
    await studio.getByRole('button', { name: 'Send All' }).click();
    await until(async () => (await view(studio)).controls.ready, 2000, 'Send All');
    await studio.getByRole('button', { name: 'Bank next' }).click();
    await until(async () => (await view(studio)).launcher.sceneIndex === 0, 12000, 'the show to play again');
  });
  await check('ending the show asks first, then the wall stays open with Map\'s own picture', async () => {
    await studio.getByRole('button', { name: 'End show' }).click();
    await studio.getByRole('button', { name: 'Keep playing' }).click();
    assert.equal((await view(studio)).running, true, 'Keep playing ended the show');
    await studio.getByRole('button', { name: 'End show' }).click();
    await studio.getByRole('button', { name: 'End show now' }).click();
    await until(async () => !(await view(studio)).running, 3000, 'the show to end');
    await until(async () => (await litIn(wall))[3] > LIT, 8000, 'the unassigned shape to return');
    await go('Studio');
    await sleep(500);
    assert.ok(!wall.isClosed(), 'the wall closed when leaving Perform after the show');
  });
  await check('Map\'s scene bar works again', async () => {
    await go('Map');
    const add = studio.getByRole('button', { name: '+ Scene' });
    await add.waitFor();
    assert.ok(await add.isEnabled());
    await add.click();
    await add.click();
    await studio.getByRole('button', { name: /Scene 1$/ }).click();
    await until(() => studio.getByRole('button', { name: /Scene 1$/ }).getAttribute('aria-pressed').then(v => v === 'true'), 2000, 'scene 1');
  });
  await check('4 and 16 scenes fit at 1512 x 982 without overlapping', async () => {
    await go('Perform');
    await studio.getByRole('region', { name: 'Perform' }).waitFor();
    const add = studio.getByRole('button', { name: 'Add scene' });
    const rowsFit = async n => {
      await studio.locator(`[data-cell="${n - 1}-0"]`).waitFor({ timeout: 2000 });
      const fit = await studio.evaluate(() => {
        const list = document.querySelector('.pf-rows'), box = list.getBoundingClientRect();
        const rows = [...list.querySelectorAll('[data-row]')].map(r => r.getBoundingClientRect());
        return { inside: rows.every(r => r.top >= box.top - 1 && r.bottom <= box.bottom + 1), apart: rows.every((r, i) => !i || r.top >= rows[i - 1].bottom), height: rows[0].height, spare: list.clientHeight - list.scrollHeight };
      });
      assert.ok(fit.inside && fit.apart && fit.spare >= 0, `${n} scenes: ${JSON.stringify(fit)}`);
      return fit.height;
    };
    while (await studio.locator('[data-row]').count() < 4) await add.click();
    const four = await rowsFit(4);
    await studio.screenshot({ path: path.join(shots, 'perform-4-scenes.png') });
    while (await studio.locator('[data-row]').count() < 16) await add.click();
    const sixteen = await rowsFit(16);
    await studio.screenshot({ path: path.join(shots, 'perform-16-scenes.png') });
    assert.ok(four > sixteen, 'rows do not compact as scenes are added');
    assert.ok(sixteen >= 26, `16 rows are only ${sixteen}px tall`);
  });
  await check('on a short window the queued row is scrolled into view', async () => {
    await studio.setViewportSize({ width: 1512, height: 640 });
    await studio.getByRole('button', { name: 'Start show' }).click();
    await studio.getByRole('button', { name: 'Send All' }).click();
    await studio.evaluate(() => { document.querySelector('.pf-rows').scrollTop = 0; document.activeElement?.blur(); });
    for (let i = 0; i < 15; i++) await studio.keyboard.press('BracketRight');
    await studio.locator('.pf-scene.queued').waitFor({ timeout: 2000 });
    await until(() => studio.evaluate(() => {
      const list = document.querySelector('.pf-rows').getBoundingClientRect(), row = document.querySelector('.pf-scene.queued').getBoundingClientRect();
      return row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
    }), 1500, 'the queued row to be in view');
    await studio.getByRole('button', { name: 'End show' }).click();
    await studio.getByRole('button', { name: 'End show now' }).click();
    await studio.setViewportSize({ width: 1512, height: 982 });
  });
  await check('End, Start, End within the handover keeps a show-only clip until the last handover is over', async () => {
    const clips = () => studio.evaluate(() => window.__studioTest.performSet().clips.length);
    const end = async () => { await studio.getByRole('button', { name: 'End show' }).click(); await studio.getByRole('button', { name: 'End show now' }).click(); await until(async () => !(await view(studio)).running, 2000, 'the show to end'); };
    await studio.getByRole('button', { name: 'Start show' }).click();
    await studio.getByRole('button', { name: 'Send All' }).click();
    await studio.locator('[data-row="0"] .pf-scene').click();
    await until(async () => (await view(studio)).launcher.sceneIndex === 0, 12000, 'scene 1 to land');
    await cell(0, 2).click({ button: 'right' });
    await studio.getByRole('menuitem', { name: 'Clear' }).click();
    await studio.locator('[data-cell="0-2"][data-filled="false"]').waitFor({ timeout: 2000 });
    const held = await clips();
    await end();
    const firstEnd = Date.now();
    await sleep(600);
    await studio.getByRole('button', { name: 'Start show' }).click();
    await studio.getByRole('button', { name: 'End show' }).waitFor();
    await sleep(600);
    await end();
    const secondEnd = Date.now();
    await sleep(Math.max(0, firstEnd + 3300 - Date.now()));
    assert.ok(Date.now() < secondEnd + 2900, 'the check ran too slowly to prove anything');
    assert.equal(await clips(), held, 'the first End show\'s timer removed a clip during the second handover');
    await until(async () => await clips() === held - 1, secondEnd + 4500 - Date.now(), 'the clip to go after the last handover');
  });
  await check('no page errors', async () => assert.deepEqual(errors, []));
} catch (error) {
  failed = true; process.exitCode = 1;
  results.push(`FAIL  the check stopped early\n      ${String(error.message).split('\n')[0]}`);
} finally {
  console.log(results.join('\n'));
  console.log(failed ? 'PERFORM CHECK FAILED' : 'PERFORM CHECK PASSED');
  await app.close().catch(() => {});
}
