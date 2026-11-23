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
    await studio.getByRole('button', { name: 'Add scene' }).click();
    await place(0, 0, 'preset:salt-mandala');
    await place(0, 1, 'preset:porcelain-shutters');
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
    await studio.keyboard.press('Escape');
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
  await studio.getByRole('button', { name: 'Start show' }).click();
  await studio.getByRole('button', { name: 'End show' }).waitFor({ timeout: 5000 });
  await studio.evaluate(() => window.__studioTest.react.testBeat(true));
  const setRange = async (label, value) => studio.getByRole('slider', { name: label, exact: true }).fill(String(value));

  await check('the wall is black before Send All, even with the faders up', async () => {
    await setRange('Master', 1);
    for (let z = 1; z <= 3; z++) await setRange(`Fader ${z}`, 1);
    await sleep(900);
    assert.ok(await allBlack(wall), `lit: ${await litIn(wall)}`);
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
    await studio.getByRole('button', { name: 'Amber 1', exact: true }).click();
    await studio.locator('[data-state="queued"]').first().waitFor({ timeout: 1500 });
    await studio.screenshot({ path: path.join(shots, 'perform-queued.png') });
    await until(async () => (await view(studio)).launcher.playing[0] !== before[0], 12000, 'zone 1 to change');
    const after = (await view(studio)).launcher.playing;
    assert.deepEqual(after.slice(1), before.slice(1));
    await until(async () => (await litIn(wall))[0] > LIT, 6000, 'zone 1 to stay lit');
    const lit = await litIn(wall);
    assert.ok(lit[1] > LIT && lit[2] > LIT, `other zones: ${lit}`);
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
  await check('no page errors', async () => assert.deepEqual(errors, []));
} catch (error) {
  failed = true; process.exitCode = 1;
  results.push(`FAIL  the check stopped early\n      ${String(error.message).split('\n')[0]}`);
} finally {
  console.log(results.join('\n'));
  console.log(failed ? 'PERFORM CHECK FAILED' : 'PERFORM CHECK PASSED');
  await app.close().catch(() => {});
}
