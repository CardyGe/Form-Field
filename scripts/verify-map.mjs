// Real Electron check of the Map section: draw, project, refusal (red on the operator screen), the wall's picture
// on the operator screen, Lock, keys from buttons, blackout, Escape, and coming back to Map.
// Run: npm run test:map   (builds first). Uses a throwaway user-data folder under work/map/.
// Writes work/map/output-rectangle.png and work/map/output-blackout.png for review by eye.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/map');
const userData = path.join(out, 'user-data');
await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });

const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
const results = [];
const check = async (name, run) => {
  try { await run(); results.push(`ok    ${name}`); }
  catch (error) { results.push(`FAIL  ${name}\n      ${String(error.message).split('\n')[0]}`); process.exitCode = 1; }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

// Sample the output canvas (same task as the copy). Returns rgb at fractions, plus the whole picture as a PNG.
const sample = (page, fractions) => page.evaluate(async fractions => {
  const canvas = document.querySelector('canvas'), copy = new OffscreenCanvas(canvas.width, canvas.height), context = copy.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, 0, 0);
  const at = ([fx, fy]) => Array.from(context.getImageData(Math.floor(fx * canvas.width), Math.floor(fy * canvas.height), 1, 1).data.slice(0, 3));
  const colours = fractions.map(at);
  const grid = []; for (let i = 0; i < 24; i++) for (let j = 0; j < 14; j++) grid.push(at([(i + .5) / 24, (j + .5) / 14]));
  const bytes = new Uint8Array(await (await copy.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { colours, grid, png: btoa(s), size: [canvas.width, canvas.height] };
}, fractions);
const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
// Pixels of the operator screen's refusal red (#ff0000), told apart from the shape colour #ff3b30 by green and blue.
const refusalRed = stage => stage.evaluate(c => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 220 && d[i + 1] < 25 && d[i + 2] < 25) n++;
  return n;
});
const operatorAt = (stage, fx, fy) => stage.evaluate((c, [fx, fy]) => Array.from(c.getContext('2d').getImageData(Math.floor(fx * c.width), Math.floor(fy * c.height), 1, 1).data.slice(0, 3)), [fx, fy]);
const RED = [0xff, 0x3b, 0x30], BLACK = [0, 0, 0];
/** How many of the 24 x 14 grid samples differ between two pictures: the wall is moving when this is above zero. */
const changed = (a, b, tol = 3) => a.grid.filter((c, i) => !near(c, b.grid[i], tol)).length;
const BOX = { x0: .25, y0: .25, x1: .6, y1: .6 };
const INSIDE = [[.3, .3], [.425, .425], [.55, .55], [.3, .55], [.55, .3]];
const OUTSIDE = [[.1, .1], [.15, .5], [.8, .8], [.425, .1], [.425, .85], [.9, .4], [.425, .7]];

try {
  const studio = await app.firstWindow();
  studio.on('pageerror', e => errors.push(String(e)));
  await studio.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await studio.getByRole('button', { name: 'Map', exact: true }).click();
  await studio.getByRole('region', { name: 'Map' }).waitFor();
  const stage = studio.getByLabel('Stage', { exact: true });
  await stage.waitFor();
  await studio.getByRole('button', { name: 'Open output' }).waitFor();
  await studio.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; });

  let output;
  await check('Open output shows a second window at #map-output', async () => {
    const opened = app.waitForEvent('window', { timeout: 15000 });
    await studio.getByRole('button', { name: 'Open output' }).click();
    output = await opened;
    await output.waitForURL(/#map-output/);
    await output.waitForSelector('canvas');
    await studio.getByRole('button', { name: 'Close output' }).waitFor({ timeout: 10000 });
    output.on('pageerror', e => errors.push(String(e)));
  });

  await check('a drawn rectangle projects its colour inside the box and black outside', async () => {
    await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
    const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    assert.ok(rect.width > 200 && rect.height > 100, `stage canvas is ${rect.width} x ${rect.height}`);
    const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
    await studio.mouse.move(...at(BOX.x0, BOX.y0)); await studio.mouse.down();
    await studio.mouse.move(...at(.4, .4), { steps: 6 }); await studio.mouse.move(...at(BOX.x1, BOX.y1), { steps: 6 }); await studio.mouse.up();
    await studio.getByRole('button', { name: 'Select', exact: true }).click();
    let s;
    for (let i = 0; i < 30; i++) { s = await sample(output, [...INSIDE, ...OUTSIDE]); if (near(s.colours[0], RED)) break; await sleep(100); }
    assert.deepEqual(s.size, [1920, 1080]);
    s.colours.slice(0, INSIDE.length).forEach((c, i) => assert.ok(near(c, RED), `inside ${INSIDE[i]} is rgb(${c})`));
    s.colours.slice(INSIDE.length).forEach((c, i) => assert.ok(near(c, BLACK), `outside ${OUTSIDE[i]} is rgb(${c})`));
    // Not vacuous: the inside colour differs from the black background by a wide margin.
    assert.ok(!near(s.colours[0], BLACK, 100));
    await fs.writeFile(path.join(out, 'output-rectangle.png'), Buffer.from(s.png, 'base64'));
  });

  await check('a crossing outline is refused: output keeps the last valid rectangle, operator says why', async () => {
    const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
    // Top-left corner dragged past the bottom-left edge's far side: the outline becomes a bowtie.
    await studio.mouse.move(...at(BOX.x0, BOX.y0)); await studio.mouse.down();
    let redDuring;
    try {
      await studio.mouse.move(...at(.4, .3), { steps: 6 }); await studio.mouse.move(...at(.7, .4), { steps: 6 });
      await studio.getByText(/Outline crosses itself/).first().waitFor({ timeout: 5000 });
      // The operator screen draws the refused outline in red while the drag is held...
      redDuring = await refusalRed(stage);
    } finally { await studio.mouse.up(); } // a failed check must not leave the button held for the next one
    assert.ok(redDuring > 300, `only ${redDuring} red pixels on the operator screen during the refused drag`);
    await studio.getByText(/Outline crosses itself/).first().waitFor({ timeout: 5000 });
    await sleep(400);
    // ...and stops when it is let go.
    const redAfter = await refusalRed(stage);
    assert.ok(redAfter < redDuring / 4, `${redAfter} red pixels remain after release (${redDuring} during)`);
    const s = await sample(output, [...INSIDE, ...OUTSIDE]);
    s.colours.slice(0, INSIDE.length).forEach((c, i) => assert.ok(near(c, RED), `inside ${INSIDE[i]} is rgb(${c}) after refusal`));
    s.colours.slice(INSIDE.length).forEach((c, i) => assert.ok(near(c, BLACK), `outside ${OUTSIDE[i]} is rgb(${c}) after refusal`));
    // The refused spot (top right of the old box, where the bowtie would have painted) stays black.
    assert.ok(near((await sample(output, [[.68, .42]])).colours[0], BLACK));
  });

  await check("the operator screen shows the wall's own picture behind the outlines", async () => {
    await studio.waitForFunction(() => document.querySelector('canvas[aria-label="Stage"]')?.dataset.wall === 'picture', null, { timeout: 10000 });
    // Inside the rectangle the operator screen draws only an outline, so red there can only come from the wall's picture.
    let inside;
    for (let i = 0; i < 30; i++) { inside = await operatorAt(stage, .425, .425); if (near(inside, RED, 40)) break; await sleep(100); }
    assert.ok(near(inside, RED, 40), `operator screen inside the shape is rgb(${inside})`);
  });

  await check('Lock stops Delete; Backspace from a button deletes nothing; names stop at 40 characters', async () => {
    const shapes = () => studio.getByRole('list').locator('li').count();
    assert.equal(await shapes(), 1);
    assert.equal(await studio.getByLabel('Name', { exact: true }).getAttribute('maxlength'), '40');
    await studio.getByRole('button', { name: 'Lock Shape 1' }).click();
    const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    await studio.mouse.click(rect.left + .425 * rect.width, rect.top + .425 * rect.height); // focus the stage, keep the shape selected
    await studio.keyboard.press('Delete');
    await studio.getByText(/That shape is locked/).first().waitFor({ timeout: 5000 });
    assert.equal(await shapes(), 1, 'a locked shape was deleted');
    await studio.getByRole('button', { name: 'Unlock Shape 1' }).click();
    // Focus is now on a button: Backspace must not delete the selected shape.
    await studio.keyboard.press('Backspace');
    await sleep(300);
    assert.equal(await shapes(), 1, 'Backspace from a button deleted the shape');
  });

  await check('right-click menu: Duplicate, Send to back, Escape, Delete; ⌘D and the Delete shape button', async () => {
    const items = () => studio.getByRole('list').locator('li');
    const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const inside = [rect.left + .425 * rect.width, rect.top + .425 * rect.height];
    const menu = studio.getByRole('menu');
    await studio.mouse.click(...inside, { button: 'right' });
    await menu.waitFor();
    assert.equal(await menu.getAttribute('aria-label'), 'Shape');
    await studio.screenshot({ path: path.join(out, 'operator-menu.png') });
    await menu.getByRole('menuitem', { name: /^Duplicate/ }).click();
    await menu.waitFor({ state: 'detached' });
    assert.equal(await items().count(), 2);
    assert.match(await items().nth(1).textContent(), /Shape 1 copy/);
    // From the Shapes list: the copy goes to the back.
    await items().nth(1).click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Send to back' }).click();
    assert.match(await items().nth(0).textContent(), /copy/);
    // Escape closes the menu and does nothing else.
    await studio.mouse.click(...inside, { button: 'right' });
    await menu.waitFor();
    await studio.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    assert.equal(await items().count(), 2);
    // Delete from the menu removes the copy; the original stays.
    await items().nth(0).click({ button: 'right' });
    await menu.getByRole('menuitem', { name: /^Delete/ }).click();
    assert.equal(await items().count(), 1);
    assert.doesNotMatch(await items().nth(0).textContent(), /copy/);
    // ⌘D copies the selected shape; the Details panel's Delete shape button removes the copy.
    await studio.getByRole('button', { name: 'Shape 1', exact: true }).click();
    await studio.keyboard.press(process.platform === 'darwin' ? 'Meta+d' : 'Control+d');
    await studio.waitForFunction(() => document.querySelectorAll('.map-shape-list li').length === 2);
    await studio.getByRole('button', { name: 'Delete shape' }).click();
    assert.equal(await items().count(), 1);
    // Right-clicking empty stage gives the stage menu.
    await studio.mouse.click(rect.left + .9 * rect.width, rect.top + .9 * rect.height, { button: 'right' });
    await menu.waitFor();
    assert.equal(await menu.getAttribute('aria-label'), 'Stage');
    await studio.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
  });

  await check('Blackout turns the whole output black', async () => {
    await studio.getByRole('button', { name: 'Blackout', exact: true }).click();
    let s;
    for (let i = 0; i < 30; i++) { s = await sample(output, []); if (s.grid.every(c => near(c, BLACK, 4))) break; await sleep(100); }
    assert.equal(s.grid.length, 24 * 14);
    const bad = s.grid.filter(c => !near(c, BLACK, 4));
    assert.equal(bad.length, 0, `${bad.length} grid pixels are not black, e.g. rgb(${bad[0]})`);
    await fs.writeFile(path.join(out, 'output-blackout.png'), Buffer.from(s.png, 'base64'));
    // Not vacuous: switching blackout off brings the red back.
    await studio.getByRole('button', { name: 'Blackout', exact: true }).click();
    let back;
    for (let i = 0; i < 30; i++) { back = await sample(output, [[.425, .425]]); if (near(back.colours[0], RED)) break; await sleep(100); }
    assert.ok(near(back.colours[0], RED), `after Blackout off the inside is rgb(${back.colours[0]})`);
  });

  const wallStats = () => output.evaluate(() => window.__mapStats);
  const insideFirst = [.425, .425];
  await check('a shape plays an instrument on the wall: moving inside, black outside, never a black frame while it starts', async () => {
    await studio.getByRole('button', { name: 'Shape 1', exact: true }).click();
    await studio.getByLabel('Plays').selectOption('preset:porcelain-shutters');
    // From the moment of the change, the inside of the shape is never black: red until the instrument is ready, then the instrument.
    const seen = [];
    for (let i = 0; i < 40; i++) { seen.push((await sample(output, [insideFirst])).colours[0]); await sleep(40); }
    const black = seen.filter(c => near(c, BLACK, 6));
    assert.equal(black.length, 0, `${black.length} of ${seen.length} samples were black while the instrument started`);
    // Now it plays: the picture inside changes over time and is not the shape's flat red; outside stays black.
    const a = await sample(output, [insideFirst, [.3, .3], [.55, .5], ...OUTSIDE]);
    await sleep(1500);
    const b = await sample(output, [insideFirst, [.3, .3], [.55, .5]]);
    assert.ok(changed(a, b) > 0, `the wall did not change in 1.5 s: ${JSON.stringify(a.colours.slice(0, 3))}`);
    assert.ok(a.colours.slice(0, 3).some(c => !near(c, RED, 30)), 'inside is still the flat shape colour');
    a.colours.slice(3).forEach((c, i) => assert.ok(near(c, BLACK), `outside ${OUTSIDE[i]} is rgb(${c})`));
    const stats = await wallStats();
    assert.equal(Object.keys(stats.prepares).length, 1);
    assert.deepEqual(stats.failing, []);
    await fs.writeFile(path.join(out, 'output-instrument.png'), Buffer.from(a.png, 'base64'));
  });

  await check('a second instrument; varying it never re-prepares the first, and Freeze holds the picture', async () => {
    await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
    const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
    await studio.mouse.move(...at(.68, .1)); await studio.mouse.down(); await studio.mouse.move(...at(.9, .22), { steps: 6 }); await studio.mouse.up();
    await studio.getByRole('button', { name: 'Select', exact: true }).click();
    await studio.getByLabel('Plays').selectOption('preset:salt-mandala');
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 2, null, { timeout: 10000 });
    const before = (await wallStats()).prepares;
    await studio.getByRole('button', { name: 'Vary', exact: true }).click();
    await output.waitForFunction(n => Object.values(window.__mapStats.prepares).reduce((a, b) => a + b, 0) > n, Object.values(before).reduce((a, b) => a + b, 0), { timeout: 10000 });
    const after = (await wallStats()).prepares;
    const firstId = Object.keys(before).find(id => before[id] === after[id]);
    assert.ok(firstId, `every source was prepared again: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    assert.equal(Object.keys(after).filter(id => after[id] !== before[id]).length, 1, 'more than one source was prepared again');
    // Freeze: the picture holds; unfreeze: it moves again.
    await studio.getByRole('button', { name: 'Freeze', exact: true }).click();
    await sleep(300);
    const f1 = await sample(output, []);
    await sleep(1000);
    const f2 = await sample(output, []);
    assert.equal(changed(f1, f2, 2), 0, 'the frozen picture changed');
    await studio.getByRole('button', { name: 'Freeze', exact: true }).click();
    await sleep(1500);
    const f3 = await sample(output, []);
    assert.ok(changed(f2, f3) > 0, 'the picture did not move again after Freeze was turned off');
  });

  await check('Escape in the output window closes it', async () => {
    const closed = output.waitForEvent('close', { timeout: 10000 });
    // The operator would click the projector window; here the window is focused directly.
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().includes('map-output')); w?.show(); w?.focus(); w?.webContents.focus(); });
    await sleep(300);
    // The window may go away while the key press is still being acknowledged.
    await output.keyboard.press('Escape').catch(() => {});
    await closed;
    await studio.getByRole('button', { name: 'Open output' }).waitFor({ timeout: 10000 });
    assert.ok(!app.windows().some(w => /#map-output/.test(w.url())));
  });

  await check('leaving Map and coming back keeps the shapes and the undo history', async () => {
    // The hidden Studio header has its own mode switch, so the button is taken from the Map screen.
    const shapesBefore = await studio.getByRole('list').locator('li').count();
    await studio.getByRole('region', { name: 'Map' }).getByRole('button', { name: 'Studio', exact: true }).click();
    await studio.getByRole('region', { name: 'Map' }).waitFor({ state: 'detached', timeout: 5000 });
    await studio.getByRole('button', { name: 'Map', exact: true }).click();
    await studio.getByRole('region', { name: 'Map' }).waitFor();
    assert.equal(await studio.getByRole('list').locator('li').count(), shapesBefore);
    const undo = studio.getByRole('button', { name: 'Undo', exact: true });
    assert.equal(await undo.isDisabled(), false, 'Undo is disabled after coming back to Map');
  });

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} catch (error) {
  results.push(`FAIL  setup\n      ${String(error.stack || error).split('\n').slice(0, 3).join(' | ')}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  console.log(results.join('\n'));
  console.log(process.exitCode ? 'MAP CHECK FAILED' : 'MAP CHECK PASSED');
  console.log(`PNGs: ${path.join(out, 'output-rectangle.png')}, ${path.join(out, 'output-blackout.png')}`);
}
