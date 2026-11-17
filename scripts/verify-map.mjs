// Real Electron check of the Map section: draw, project, refusal (red on the operator screen), the wall's picture
// on the operator screen, Lock, keys from buttons, blackout, instruments, Edit in Studio, the stage 3 drawing kit
// (ellipse, holes, Pen curves, Blocker, soft edge and border, solo and groups, joined corners, grids, Photo),
// Escape, and coming back to Map.
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
  // Studio's own composition, to check later that editing a shape in Studio never replaces it.
  const projectName = () => studio.getByLabel('Project name', { exact: true }).inputValue();
  await studio.getByLabel('Project name', { exact: true }).waitFor();
  await sleep(1500);
  const ownTitle = await projectName();
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
    // Some instruments rest between moves, so the wall is watched for up to 6 s.
    let moved = 0;
    for (let i = 0; i < 12 && !moved; i++) { await sleep(500); moved = changed(a, await sample(output, [])); }
    assert.ok(moved > 0, `the wall did not change in 6 s: ${JSON.stringify(a.colours.slice(0, 3))}`);
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

  await check('Edit in Studio: the shape\'s composition opens in Studio, changes reach the wall, Studio\'s own project is kept', async () => {
    await studio.getByRole('button', { name: 'Shape 1', exact: true }).click();
    await studio.getByRole('button', { name: 'Edit in Studio', exact: true }).click();
    await studio.locator('.shape-edit-bar').waitFor();
    await studio.screenshot({ path: path.join(out, 'studio-editing-shape.png') });
    const bar = await studio.locator('.shape-edit-bar').evaluate(e => ({ text: e.textContent, html: e.outerHTML.slice(0, 300), box: e.getBoundingClientRect().toJSON() }));
    assert.match(bar.text, /Editing Shape 1 from Map/, JSON.stringify(bar));
    assert.equal(await studio.getByRole('button', { name: /^Export/ }).isDisabled(), true, 'Export is offered while editing a shape');
    // The output stayed open while Map is not on screen.
    assert.ok(app.windows().some(w => /#map-output/.test(w.url())), 'the output closed when Studio opened');
    const before = (await wallStats()).prepares;
    await studio.getByRole('button', { name: 'Randomize effect' }).click();
    await output.waitForFunction(n => Object.values(window.__mapStats.prepares).reduce((a, b) => a + b, 0) > n, Object.values(before).reduce((a, b) => a + b, 0), { timeout: 10000 });
    // Studio's autosave still holds Studio's own project.
    await sleep(1200);
    const autosave = JSON.parse(await fs.readFile(path.join(userData, 'autosave.formfield'), 'utf8'));
    assert.equal(autosave.name, ownTitle, `Studio's autosave holds "${autosave.name}", not its own project "${ownTitle}"`);
    // While editing, Studio shows the shape's composition.
    assert.notEqual(await projectName(), ownTitle);
    await studio.locator('.shape-edit-bar').getByRole('button', { name: 'Back to Map' }).click();
    await studio.getByRole('region', { name: 'Map' }).waitFor();
    assert.equal(await studio.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), false);
  });

  // ---- Stage 3: the drawing kit ----
  const geo = async () => { const r = await stage.evaluate(c => { const b = c.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; }); return (fx, fy) => [r.left + fx * r.width, r.top + fy * r.height]; };
  const tool = name => studio.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true }).click();
  const focusStage = () => studio.locator('main.map-stage').focus();
  const dragOn = async (from, to, mods = []) => {
    const at = await geo();
    for (const m of mods) await studio.keyboard.down(m);
    try { await studio.mouse.move(...at(...from)); await studio.mouse.down(); await studio.mouse.move(...at(...to), { steps: 8 }); await studio.mouse.up(); }
    finally { for (const m of mods) await studio.keyboard.up(m); }
  };
  const clickOn = async (p, mods = []) => {
    const at = await geo();
    for (const m of mods) await studio.keyboard.down(m);
    try { await studio.mouse.click(...at(...p)); } finally { for (const m of mods) await studio.keyboard.up(m); }
  };
  /** Every shape selected and deleted, so each check starts from an empty stage. */
  const clearStage = async () => {
    await tool('Select'); await focusStage();
    await studio.keyboard.press('Meta+a'); await studio.keyboard.press('Backspace');
    await studio.waitForFunction(() => document.querySelectorAll('.map-shape-list li').length === 0, null, { timeout: 5000 });
  };
  const coloured = c => !near(c, BLACK, 60);
  /** Waits until the wall agrees with `test`, then returns its colours at `points`. */
  const wallUntil = async (points, test, what) => {
    let s;
    for (let i = 0; i < 40; i++) { s = await sample(output, points); if (test(s.colours)) return s.colours; await sleep(100); }
    throw new Error(`${what}: wall shows ${s.colours.map(c => `rgb(${c})`).join(', ')}`);
  };
  const shapeCount = () => studio.locator('.map-shape-list li:not(.map-group-row)').count();

  await check('an ellipse projects a round shape; a hole cut with Alt is black on the wall, and Undo takes it away', async () => {
    await clearStage();
    await tool('Ellipse');
    await dragOn([.2, .2], [.5, .6]);
    await tool('Select');
    // Centre coloured; the box's corners outside the ellipse black.
    await wallUntil([[.35, .4], [.21, .21], [.49, .59]], c => coloured(c[0]) && near(c[1], BLACK) && near(c[2], BLACK), 'ellipse');
    await tool('Rectangle');
    await dragOn([.3, .33], [.4, .47], ['Alt']);
    await tool('Select');
    await wallUntil([[.35, .4], [.25, .4]], c => near(c[0], BLACK) && coloured(c[1]), 'hole');
    assert.equal(await shapeCount(), 1, 'the hole is not a shape of its own');
    await focusStage(); await studio.keyboard.press('Meta+z');
    await wallUntil([[.35, .4]], c => coloured(c[0]), 'after undo');
  });

  await check('the Pen draws straight and curved sides: the curve bulges past the straight line on the wall', async () => {
    await clearStage();
    await tool('Pen');
    const at = await geo();
    await clickOn([.6, .2]);
    // Click and drag: a curve point with handles.
    await studio.mouse.move(...at(.85, .2)); await studio.mouse.down(); await studio.mouse.move(...at(.9, .3), { steps: 6 }); await studio.mouse.up();
    await clickOn([.85, .5]); await clickOn([.6, .5]);
    await focusStage(); await studio.keyboard.press('Enter');
    await tool('Select');
    assert.equal(await shapeCount(), 1);
    // x .862 at y .32 is outside the straight side at x .85 but inside the curve, which reaches about x .872 there.
    await wallUntil([[.7, .35], [.862, .32], [.885, .32]], c => coloured(c[0]) && coloured(c[1]) && near(c[2], BLACK), 'curved side');
    // For review by eye: the curve point chosen, with its handles.
    await clickOn([.7, .35]); await clickOn([.85, .2]); await sleep(300);
    await studio.screenshot({ path: path.join(out, 'operator-pen.png') });
  });

  await check('a Blocker blacks out the shape beneath it on the wall', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.1, .1], [.5, .5]);
    await tool('Rectangle'); await dragOn([.3, .3], [.6, .6]);
    await tool('Select');
    await studio.getByLabel('Blocker', { exact: true }).check();
    await wallUntil([[.2, .2], [.4, .4], [.55, .55]], c => coloured(c[0]) && near(c[1], BLACK) && near(c[2], BLACK), 'blocker');
  });

  await check('soft edge fades to dark at the outline; a border brings the outline back', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.6, .6]);
    await tool('Select');
    const slider = async (label, value) => { const s = studio.getByLabel(label, { exact: true }); await s.fill(String(value)); await s.dispatchEvent('pointerup'); };
    await slider('Soft edge', 80);
    // 6 px inside the left side, the fade has barely begun; the middle is full colour.
    const [edge, middle] = await wallUntil([[.2 + 6 / 1920, .4], [.4, .4]], c => coloured(c[1]) && c[0].reduce((a, b) => a + b) < c[1].reduce((a, b) => a + b) / 3, 'soft edge');
    assert.ok(coloured(middle) && !coloured(edge) || edge.reduce((a, b) => a + b) < middle.reduce((a, b) => a + b) / 3);
    await slider('Border', 16);
    await wallUntil([[.2 + 6 / 1920, .4], [.4, .4]], c => near(c[0], c[1], 40), 'border');
  });

  await check('Solo shows only the soloed shape on the wall; a hidden group hides its members', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.1, .1], [.3, .3]);
    await tool('Rectangle'); await dragOn([.5, .5], [.7, .7]);
    await tool('Select');
    const names = await studio.locator('.map-shape-list li .map-shape-name').allTextContents();
    await studio.getByRole('button', { name: `Solo ${names[0]}`, exact: true }).click();
    await wallUntil([[.2, .2], [.6, .6]], c => coloured(c[0]) && near(c[1], BLACK), 'solo');
    await studio.getByRole('button', { name: 'Solo on · Clear' }).click();
    await wallUntil([[.2, .2], [.6, .6]], c => coloured(c[0]) && coloured(c[1]), 'solo cleared');
    await focusStage(); await studio.keyboard.press('Meta+a'); await studio.keyboard.press('Meta+g');
    await studio.locator('.map-group-row').waitFor();
    await studio.getByRole('button', { name: /^Hide group / }).click();
    await wallUntil([[.2, .2], [.6, .6]], c => near(c[0], BLACK) && near(c[1], BLACK), 'hidden group');
    await studio.getByRole('button', { name: /^Show group / }).click();
    await wallUntil([[.2, .2], [.6, .6]], c => coloured(c[0]) && coloured(c[1]), 'group shown again');
  });

  await check('Snap: a corner drawn onto a neighbour’s corner joins it, and dragging one moves both', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.1, .1], [.2, .2]);
    // Started a few pixels from the first rectangle's top-right corner: it snaps onto it.
    const at = await geo();
    const near3 = (await stage.evaluate(c => c.getBoundingClientRect().width)) > 0 ? 3 / 1920 : 0;
    await tool('Rectangle'); await dragOn([.2 + near3, .1 + near3], [.3, .2]);
    await tool('Select');
    // Pick the first rectangle, then drag its top-right corner up and right.
    await clickOn([.15, .15]);
    await dragOn([.2, .1], [.22, .08]);
    // Pick the second rectangle and its top-left corner: it moved with the first.
    await clickOn([.27, .17]);
    await clickOn([.22, .08]);
    const x = Number(await studio.getByLabel('X', { exact: true }).inputValue()), y = Number(await studio.getByLabel('Y', { exact: true }).inputValue());
    assert.ok(Math.abs(x - .22 * 1920) <= 3 && Math.abs(y - .08 * 1080) <= 3, `the joined corner is at ${x}, ${y}`);
    void at;
  });

  await check('Make a grid: a 2 x 2 grid projects four cells with a gap between them, in a group', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.6, .6]);
    await tool('Select');
    await studio.locator('.map-grid-tool summary').click();
    await studio.getByLabel('Grid gap', { exact: true }).fill('60');
    await studio.getByRole('button', { name: 'Make grid', exact: true }).click();
    await studio.locator('.map-group-row').waitFor();
    assert.equal(await shapeCount(), 4);
    await wallUntil([[.3, .3], [.5, .3], [.3, .5], [.5, .5], [.4, .4]], c => c.slice(0, 4).every(coloured) && near(c[4], BLACK), 'grid');
    await sleep(300);
    await studio.screenshot({ path: path.join(out, 'operator-grid.png') });
  });

  await check('the Photo shows on this screen only, never on the wall', async () => {
    await clearStage();
    // A plain white picture, made in the page.
    const png = await studio.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 320, 180); return c.toDataURL('image/png').split(',')[1]; });
    const file = path.join(out, 'photo.png');
    await fs.writeFile(file, Buffer.from(png, 'base64'));
    await studio.getByLabel('Photo file').setInputFiles(file);
    await studio.getByLabel('Photo opacity').waitFor();
    let here;
    for (let i = 0; i < 30; i++) { here = await operatorAt(stage, .9, .9); if (!near(here, BLACK, 40)) break; await sleep(100); }
    assert.ok(!near(here, BLACK, 40), `operator screen with the photo is rgb(${here})`);
    await sleep(600);
    const wall = await sample(output, [[.9, .9], [.5, .5], [.1, .1]]);
    wall.colours.forEach(c => assert.ok(near(c, BLACK), `the wall shows rgb(${c}) with only a photo`));
    await studio.getByRole('button', { name: 'Remove photo' }).click();
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
    // Studio has its own composition back.
    await studio.getByRole('region', { name: 'Map' }).getByRole('button', { name: 'Studio', exact: true }).click();
    await studio.getByRole('region', { name: 'Map' }).waitFor({ state: 'detached' });
    assert.equal(await projectName(), ownTitle);
    await studio.getByRole('button', { name: 'Map', exact: true }).click();
  });

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} catch (error) {
  results.push(`FAIL  setup\n      ${String(error.stack || error).split('\n').slice(0, 3).join(' | ')}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  console.log(results.join('\n'));
  console.log(process.exitCode ? 'MAP CHECK FAILED' : 'MAP CHECK PASSED');
  console.log(`PNGs: ${['output-rectangle', 'output-blackout', 'operator-pen', 'operator-grid'].map(n => path.join(out, `${n}.png`)).join(', ')}`);
}
