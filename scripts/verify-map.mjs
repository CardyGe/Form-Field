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

// The look browser and the Details panel's folding sections (Map UI pass).
const playLook = async (page, value) => {
  await openSection(page, 'effect');
  await page.getByRole('button', { name: 'Change look' }).click();
  await page.locator(`[data-look="${value}"]`).click();
  // A person presses Escape well after the click; pressed within milliseconds it can arrive before the page settles.
  await new Promise(r => setTimeout(r, 150));
  await page.keyboard.press('Escape');
  // If the key was lost, the panel's own close button.
  await page.locator('.look-browser').waitFor({ state: 'detached', timeout: 2000 }).catch(async () => {
    await page.getByRole('button', { name: 'Close looks' }).click();
    await page.locator('.look-browser').waitFor({ state: 'detached' });
  });
};
// Details has Shape, Effect and Sound tabs: a section opens its tab first ('effect' and 'reacts' are tabs of their own).
const openSection = async (page, id) => {
  const tab = { reacts: /^Sound/, effect: /^Effect$/, live: /^Effect$/ }[id] ?? /^Shape$/;
  const button = page.getByRole('tablist', { name: 'Shape panels' }).getByRole('tab', { name: tab });
  if (await button.count()) await button.click();
  await page.evaluate(id => { const d = document.querySelector(`details[data-section="${id}"]`); if (d && !d.open) d.open = true; }, id);
};


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/map');
const userData = path.join(out, 'user-data');
await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });

const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
// Stage 6: a 2 s test clip (moving test pattern) and a red test picture, made with ffmpeg.
const { execFileSync } = await import('node:child_process');
// The system's ffmpeg has the test-pattern generators; the app's bundled one is cut down to what export needs.
const ffmpeg = (() => { try { execFileSync('ffmpeg', ['-hide_banner', '-filters'], { stdio: 'pipe' }); return 'ffmpeg'; } catch { return path.join(root, 'build/media/ffmpeg'); } })();
const CLIP = path.join(out, 'test-loop.mp4'), MOVED = path.join(out, 'test-loop-moved.mp4'), PICTURE = path.join(out, 'test-red.png');
await fs.mkdir(out, { recursive: true });
await fs.rm(MOVED, { force: true });
execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', CLIP]);
execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', PICTURE]);
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
// The app's file dialogs are answered with whatever the next check sets.
await app.evaluate(({ dialog }) => { globalThis.__nextPick = null; dialog.showOpenDialog = async () => globalThis.__nextPick ? { canceled: false, filePaths: [globalThis.__nextPick] } : { canceled: true, filePaths: [] }; });
const nextPick = file => app.evaluate((_e, f) => { globalThis.__nextPick = f; }, file);
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

  await check('a new rectangle shows its grid pattern, then its colour inside the box and black outside', async () => {
    await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
    const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    assert.ok(rect.width > 200 && rect.height > 100, `stage canvas is ${rect.width} x ${rect.height}`);
    const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
    await studio.mouse.move(...at(BOX.x0, BOX.y0)); await studio.mouse.down();
    await studio.mouse.move(...at(.4, .4), { steps: 6 }); await studio.mouse.move(...at(BOX.x1, BOX.y1), { steps: 6 }); await studio.mouse.up();
    await studio.getByRole('button', { name: 'Select', exact: true }).click();
    // A new shape shows its grid pattern: bold centre lines in its colour, dim between the lines, black outside.
    let g;
    const centre = [(BOX.x0 + BOX.x1) / 2, (BOX.y0 + BOX.y1) / 2];
    // Probes about two projector pixels apart across the shape, 100 px below the middle (clear of the centre line and the name).
    const row = Array.from({ length: 300 }, (_, i) => [BOX.x0 + .01 + i * (BOX.x1 - BOX.x0 - .02) / 299, centre[1] + 100 / 1080]);
    // The centre point is on the bold vertical centre line, below the name.
    for (let i = 0; i < 30; i++) { g = await sample(output, [[centre[0], centre[1] + 100 / 1080], [.1, .1], ...row]); if (near(g.colours[0], RED, 40)) break; await sleep(100); }
    assert.ok(near(g.colours[0], RED, 40), `the centre of a new shape is rgb(${g.colours[0]}), not its colour`);
    assert.ok(near(g.colours[1], BLACK), 'outside the new shape is black');
    const lit = g.colours.slice(2).filter(c => c[0] > 150).length, dim = g.colours.slice(2).filter(c => c[0] < 120 && c[0] > 15).length;
    assert.ok(lit >= 5 && dim >= 200, `grid pattern: ${lit} probes on a line, ${dim} dim between lines`);
    await fs.writeFile(path.join(out, 'output-grid-pattern.png'), Buffer.from(g.png, 'base64'));
    // The rest of the checks use a plain colour.
    await playLook(studio, 'colour');
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
    await openSection(studio, 'shape');
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
    await playLook(studio, 'preset:porcelain-shutters');
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
    await playLook(studio, 'preset:salt-mandala');
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 2, null, { timeout: 10000 });
    const before = (await wallStats()).prepares;
    await studio.getByRole('button', { name: 'Vary', exact: true }).click();
    // The change reaches the wall: prepared again, or (settings that can follow sound) taken in place.
    const adjustedBefore = (await wallStats()).adjusted ?? 0;
    await output.waitForFunction(([n, a]) => Object.values(window.__mapStats.prepares).reduce((x, y) => x + y, 0) > n || (window.__mapStats.adjusted ?? 0) > a, [Object.values(before).reduce((a, b) => a + b, 0), adjustedBefore], { timeout: 10000 })
      .catch(async () => { throw new Error(`the wall never took the change: before ${JSON.stringify(before)} adjusted ${adjustedBefore}; now ${JSON.stringify(await wallStats())}`); });
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
    // The change reaches the wall: prepared again, or (settings that can follow sound) taken in place.
    const adjustedAt = (await wallStats()).adjusted ?? 0;
    await output.waitForFunction(([n, a]) => Object.values(window.__mapStats.prepares).reduce((x, y) => x + y, 0) > n || (window.__mapStats.adjusted ?? 0) > a, [Object.values(before).reduce((a, b) => a + b, 0), adjustedAt], { timeout: 10000 })
      .catch(async () => { throw new Error(`the Studio edit never reached the wall: before ${JSON.stringify(before)} adjusted ${adjustedAt}; now ${JSON.stringify(await wallStats())}`); });
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
  /** The selected shape plays its plain colour, not the grid pattern new shapes start with. */
  const asColour = () => playLook(studio, 'colour');

  await check('an ellipse projects a round shape; a hole cut with Alt is black on the wall, and Undo takes it away', async () => {
    await clearStage();
    await tool('Ellipse');
    await dragOn([.2, .2], [.5, .6]);
    await tool('Select'); await asColour();
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
    await tool('Select'); await asColour();
    assert.equal(await shapeCount(), 1);
    // x .862 at y .32 is outside the straight side at x .85 but inside the curve, which reaches about x .872 there.
    await wallUntil([[.7, .35], [.862, .32], [.885, .32]], c => coloured(c[0]) && coloured(c[1]) && near(c[2], BLACK), 'curved side');
    // For review by eye: the curve point chosen, with its handles.
    await clickOn([.7, .35]); await clickOn([.85, .2]); await sleep(300);
    await studio.screenshot({ path: path.join(out, 'operator-pen.png') });
  });

  await check('a Blocker blacks out the shape beneath it on the wall', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.1, .1], [.5, .5]); await asColour();
    await tool('Rectangle'); await dragOn([.3, .3], [.6, .6]);
    await tool('Select');
    await openSection(studio, 'effect');
    await studio.getByLabel('Blocker', { exact: true }).check();
    await wallUntil([[.2, .2], [.4, .4], [.55, .55]], c => coloured(c[0]) && near(c[1], BLACK) && near(c[2], BLACK), 'blocker');
  });

  await check('soft edge fades to dark at the outline; a border brings the outline back', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.6, .6]);
    await tool('Select'); await asColour();
    const slider = async (label, value) => { await openSection(studio, 'edge'); const s = studio.getByLabel(label, { exact: true }); await s.fill(String(value)); await s.dispatchEvent('pointerup'); };
    await slider('Soft edge', 80);
    // 6 px inside the left side, the fade has barely begun; the middle is full colour.
    const [edge, middle] = await wallUntil([[.2 + 6 / 1920, .4], [.4, .4]], c => coloured(c[1]) && c[0].reduce((a, b) => a + b) < c[1].reduce((a, b) => a + b) / 3, 'soft edge');
    assert.ok(coloured(middle) && !coloured(edge) || edge.reduce((a, b) => a + b) < middle.reduce((a, b) => a + b) / 3);
    await slider('Border', 16);
    await wallUntil([[.2 + 6 / 1920, .4], [.4, .4]], c => near(c[0], c[1], 40), 'border');
  });

  await check('Solo shows only the soloed shape on the wall; a hidden group hides its members', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.1, .1], [.3, .3]); await asColour();
    await tool('Rectangle'); await dragOn([.5, .5], [.7, .7]); await asColour();
    await tool('Select');
    const names = await studio.locator('.map-shape-list li .map-row-name').allTextContents();
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
    // The point's position is in the Shape tab.
    await openSection(studio, 'shape');
    const x = Number(await studio.getByLabel('X', { exact: true }).inputValue()), y = Number(await studio.getByLabel('Y', { exact: true }).inputValue());
    assert.ok(Math.abs(x - .22 * 1920) <= 3 && Math.abs(y - .08 * 1080) <= 3, `the joined corner is at ${x}, ${y}`);
    void at;
  });

  await check('Make a grid: a 2 x 2 grid projects four cells with a gap between them, in a group', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.6, .6]);
    await tool('Select'); await asColour();
    await openSection(studio, 'shape');
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

  // ---- Stage 4: placement ----
  const placement = async value => { await openSection(studio, 'placement'); await studio.getByLabel('Placement', { exact: true }).selectOption(value); };

  await check('Pin: a trapezoid’s grid pattern bunches up towards its narrow side, as a grid on an angled surface does', async () => {
    await clearStage();
    await tool('Pen');
    for (const p of [[.4, .2], [.6, .2], [.75, .8], [.25, .8]]) await clickOn(p);
    await focusStage(); await studio.keyboard.press('Enter');
    await tool('Select');
    const column = Array.from({ length: 400 }, (_, i) => [.515, .205 + i * (.79 - .205) / 399]);
    /** Centres of the lit horizontal lines down the column, in stage fractions. */
    const lines = colours => {
      const lit = colours.map(c => c[0] > 180), centres = [];
      for (let i = 0; i < lit.length; i++) if (lit[i] && !lit[i - 1]) { let j = i; while (lit[j + 1]) j++; centres.push(column[(i + j) >> 1][1]); }
      return centres;
    };
    const gaps = ys => ys.slice(1).map((y, i) => y - ys[i]);
    let fit;
    for (let i = 0; i < 30; i++) { fit = lines((await sample(output, column)).colours); if (fit.length >= 4) break; await sleep(100); }
    await placement('pin');
    let pin, g;
    for (let i = 0; i < 30; i++) { await sleep(100); pin = lines((await sample(output, column)).colours); g = gaps(pin); if (pin.length >= 3 && g[0] < g.at(-1) * .8) break; }
    assert.ok(pin.length >= 3, `only ${pin.length} lines found on the pinned shape`);
    assert.ok(g[0] < g.at(-1) * .8, `pinned gaps ${g.map(v => (v * 1080).toFixed(0)).join(', ')} px do not narrow towards the top (fit: ${gaps(fit).map(v => (v * 1080).toFixed(0)).join(', ')})`);
    const fg = gaps(fit);
    assert.ok(fg[0] > fg.at(-1) * .8, `fit gaps already narrow: ${fg.map(v => (v * 1080).toFixed(0)).join(', ')}`);
  });

  await check('Across stage with a shared instrument: two neighbouring shapes show one continuous picture, played once', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.1, .3], [.3, .6]);
    await tool('Select');
    await playLook(studio, 'preset:porcelain-shutters');
    await placement('across-stage');
    await tool('Rectangle'); await dragOn([.3 + 3 / 1920, .3], [.5, .6]);
    await tool('Select');
    const names = await studio.locator('.map-shape-list li .map-row-name').allTextContents();
    await openSection(studio, 'effect');
    await studio.getByLabel('Share with', { exact: true }).selectOption({ label: names[0] });
    await placement('across-stage');
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 1, null, { timeout: 15000 });
    await sleep(1200);
    // Pixels a few pixels either side of the shared edge, down its length: one picture, so they nearly match.
    const pairs = Array.from({ length: 12 }, (_, i) => [[.3 - 4 / 1920, .32 + i * .022], [.3 + 8 / 1920, .32 + i * .022]]).flat();
    const s = await sample(output, pairs);
    let close = 0;
    for (let i = 0; i < s.colours.length; i += 2) if (near(s.colours[i], s.colours[i + 1], 40)) close++;
    assert.ok(close >= 9, `only ${close} of 12 pairs match across the edge`);
    assert.ok(s.colours.some(c => !near(c, BLACK, 30)), 'the picture is black');
  });

  await check('Brightness at 50 % halves a shape’s colour on the wall', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.5, .5]);
    await tool('Select'); await asColour();
    const [full] = await wallUntil([[.35, .35]], c => coloured(c[0]), 'full');
    await openSection(studio, 'look');
    const b = studio.getByLabel('Brightness', { exact: true }); await b.fill('0.5'); await b.dispatchEvent('pointerup');
    const [half] = await wallUntil([[.35, .35]], c => Math.abs(c[0][0] - full[0] / 2) <= 12, 'half brightness');
    assert.ok(Math.abs(half[0] - full[0] / 2) <= 12, `${half} against ${full}`);
  });

  await check('Stage corners bend the projector’s picture; Blackout stays black; this screen stays flat; Reset brings it back', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([0, 0], [.4, .4]);
    await tool('Select'); await asColour();
    await wallUntil([[.02, .02]], c => coloured(c[0]), 'before');
    await studio.getByRole('button', { name: 'Stage corners', exact: true }).click();
    await dragOn([0, 0], [.1, .1]);
    await wallUntil([[.02, .02], [.18, .18]], c => near(c[0], BLACK) && coloured(c[1]), 'corner moved');
    // The operator screen keeps the stage flat: its preview of the wall is taken before the corners bend it.
    let flat;
    for (let i = 0; i < 30; i++) { flat = await operatorAt(stage, .02, .2); if (!near(flat, BLACK, 40)) break; await sleep(100); }
    assert.ok(!near(flat, BLACK, 40), `the operator screen is rgb(${flat}) where the flat stage has the shape`);
    await studio.getByRole('button', { name: 'Blackout', exact: true }).click();
    await wallUntil([[.02, .02], [.18, .18], [.5, .5]], c => c.every(x => near(x, BLACK, 2)), 'blackout');
    await studio.getByRole('button', { name: 'Blackout', exact: true }).click();
    await studio.getByRole('button', { name: 'Reset corners', exact: true }).click();
    await wallUntil([[.02, .02]], c => coloured(c[0]), 'after reset');
    await studio.getByRole('button', { name: 'Stage corners', exact: true }).click();
  });

  await check('a shape against the stage’s corner keeps its scale handle, beside the stage, where it can be grabbed', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.7, .7], [1, 1]);
    await tool('Select'); await asColour();
    await clickOn([.85, .85]);
    await wallUntil([[.97, .97]], c => coloured(c[0]), 'shape in the corner');
    const r = await stage.evaluate(c => { const b = c.getBoundingClientRect(); return { right: b.right, bottom: b.bottom }; });
    // The bottom-right handle sits 14 screen pixels out from the corner: outside the stage itself.
    const handle = await studio.evaluate(({ x, y }) => {
      const layer = document.querySelector('.map-handles'), b = layer.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      return Array.from(layer.getContext('2d').getImageData(Math.round((x - b.left) * dpr), Math.round((y - b.top) * dpr), 1, 1).data.slice(0, 3));
    }, { x: r.right + 14, y: r.bottom + 14 });
    assert.ok(handle[0] > 200 && handle[1] > 150 && handle[2] < 80, `the handle beside the stage is rgb(${handle}), not drawn`);
    const at = await geo();
    await studio.mouse.move(r.right + 14, r.bottom + 14); await studio.mouse.down();
    await studio.mouse.move(...at(.85, .85), { steps: 8 }); await studio.mouse.up();
    await wallUntil([[.97, .97], [.75, .75]], c => near(c[0], BLACK) && coloured(c[1]), 'shrunk by its handle');
  });

  await check('a square playing an instrument, split into a grid, plays one picture running across its cells', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.6, .6]);
    await tool('Select');
    await playLook(studio, 'preset:porcelain-shutters');
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 1, null, { timeout: 15000 });
    await sleep(800);
    // Frozen, the square's picture holds still: split into cells, the cells together must show exactly that picture.
    const freeze = studio.getByRole('button', { name: 'Freeze', exact: true });
    await freeze.click(); await sleep(400);
    const points = Array.from({ length: 64 }, (_, i) => [.21 + (i % 8) * .054, .21 + Math.floor(i / 8) * .054]);
    const before = await sample(output, points);
    await openSection(studio, 'shape');
    await studio.locator('.map-grid-tool summary').click();
    assert.equal(await studio.getByLabel('One picture across the cells', { exact: true }).isChecked(), true);
    await studio.getByLabel('Grid gap', { exact: true }).fill('0');
    await studio.getByRole('button', { name: 'Make grid', exact: true }).click();
    await studio.locator('.map-group-row').waitFor();
    assert.equal(await shapeCount(), 4);
    await sleep(600);
    const after = await sample(output, points);
    await fs.writeFile(path.join(out, 'output-grid-across.png'), Buffer.from(after.png, 'base64'));
    await freeze.click();
    assert.equal(Object.keys(await output.evaluate(() => window.__mapStats.prepares)).length, 1, 'the cells play one instrument');
    const same = before.colours.filter((c, i) => near(c, after.colours[i], 24)).length;
    assert.ok(same >= 60, `only ${same} of 64 points show the same picture after the split`);
    assert.ok(after.colours.filter(c => !near(c, BLACK, 30)).length >= 40, 'the grid is mostly black');
  });

  await check('a grid playing one instrument is one instrument: a new look on one cell changes every cell', async () => {
    // Follows the grid check above: four cells sharing one instrument.
    assert.equal(await shapeCount(), 4);
    // The whole grid is selected after Make grid: that is the group view; one cell is picked on its own here.
    await focusStage(); await studio.keyboard.press('Escape');
    await clickOn([.3, .3]);
    await openSection(studio, 'effect');
    assert.equal(await studio.getByLabel('Change all linked shapes', { exact: true }).isChecked(), true);
    await playLook(studio, 'preset:salt-mandala');
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 1 && Object.values(window.__mapStats.prepares)[0] >= 2, null, { timeout: 15000 });
    const names = await studio.locator('.map-shape-list li.member .map-row-plays').allTextContents();
    assert.deepEqual(names, ['Hot Mandala', 'Hot Mandala', 'Hot Mandala', 'Hot Mandala']);
    // With "Change all" off, a cell gets a look of its own.
    await openSection(studio, 'effect');
    await studio.getByLabel('Change all linked shapes', { exact: true }).uncheck();
    await playLook(studio, 'preset:porcelain-shutters');
    const after = await studio.locator('.map-shape-list li.member .map-row-plays').allTextContents();
    assert.equal(after.filter(n => n === 'Hot Mandala').length, 3);
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 2, null, { timeout: 15000 });
    // Back on, from a cell still linked to the others.
    await focusStage(); await studio.keyboard.press('Escape');
    await clickOn([.5, .5]);
    await openSection(studio, 'effect');
    await studio.getByLabel('Change all linked shapes', { exact: true }).check();
  });

  // Stage 5: scenes, sound and MIDI.
  const sceneButtons = () => studio.getByRole('toolbar', { name: 'Scenes' }).locator('.map-scene');
  const currentScene = () => studio.getByRole('toolbar', { name: 'Scenes' }).locator('.map-scene[aria-pressed="true"]').textContent();
  const react = (fn, arg) => studio.evaluate(([fn, arg]) => window.__studioTest.react[fn](arg), [fn, arg]);
  const reactReady = () => studio.waitForFunction(() => !!window.__studioTest?.react, null, { timeout: 5000 });

  await check('scenes: keys 1 and 2 switch between a full and a half-bright shape, fading on the wall without a black frame', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.5, .5]);
    await tool('Select'); await asColour();
    await wallUntil([[.35, .35]], c => near(c[0], RED, 30), 'full colour');
    const add = studio.getByRole('button', { name: '+ Scene' });
    await add.click(); await add.click();
    assert.equal(await sceneButtons().count(), 2);
    assert.match(await currentScene(), /Scene 2/);
    await openSection(studio, 'look');
    const b = studio.getByLabel('Brightness', { exact: true }); await b.fill('0.5'); await b.dispatchEvent('pointerup');
    const [half] = await wallUntil([[.35, .35]], c => Math.abs(c[0][0] - 128) <= 14, 'half brightness in scene 2');
    await focusStage(); await studio.keyboard.press('1');
    // A two-second fade: sampled through it, the shape is never black and ends at full colour.
    const during = [];
    for (let i = 0; i < 12; i++) { during.push((await sample(output, [[.35, .35]])).colours[0][0]); await sleep(120); }
    assert.ok(during.every(r => r > 90), `a dark frame during the fade: ${during.join(', ')}`);
    await wallUntil([[.35, .35]], c => near(c[0], RED, 30), 'scene 1 at full colour');
    assert.ok(during.some(r => r > half[0] + 10 && r < 245) || during.at(-1) >= 245, `no fade seen: ${during.join(', ')}`);
    assert.match(await currentScene(), /Scene 1/);
    await focusStage(); await studio.keyboard.press('2');
    await wallUntil([[.35, .35]], c => Math.abs(c[0][0] - 128) <= 14, 'back to half in scene 2');
  });

  await check('sound: with the test beat, Pulse on the beat makes the shape brighten and dim on the wall', async () => {
    await openSection(studio, 'reacts');
    await studio.getByLabel('Add a reaction', { exact: true }).selectOption('pulse');
    await reactReady();
    await react('testBeat', true);
    const reds = [];
    for (let i = 0; i < 40; i++) { reds.push((await sample(output, [[.35, .35]])).colours[0][0]); await sleep(60); }
    const pulse = await studio.evaluate(() => window.__studioTest.react.signals()['beat.pulse']);
    assert.ok(Math.max(...reds) - Math.min(...reds) > 30, `the wall did not pulse: red ${Math.min(...reds)} to ${Math.max(...reds)} (beat ${pulse})`);
    assert.ok(Math.min(...reds) > 60, `the pulse went dark: ${Math.min(...reds)}`);
    await react('testBeat', false);
  });

  await check('MIDI: Learn on the Brightness slider takes a control; turning it sets the shape’s brightness on the wall', async () => {
    await openSection(studio, 'look');
    await studio.getByLabel('React to… Brightness', { exact: true }).click();
    await studio.getByRole('menuitem', { name: /MIDI: Learn/ }).click();
    await studio.getByRole('menuitem', { name: 'Move a control…' }).waitFor({ timeout: 3000 });
    await react('midi', [0xb0, 7, 0]);
    await wallUntil([[.35, .35]], c => c[0][0] < 30, 'control 7 at 0 (dark)');
    await react('midi', [0xb0, 7, 127]);
    await wallUntil([[.35, .35]], c => c[0][0] > 240, 'control 7 at full (bright)');
    const lit = await studio.locator('.react-to.on').count();
    assert.ok(lit >= 1, 'the ∿ beside Brightness is not lit');
  });

  await check('a MIDI note learned for a trigger switches to the next scene', async () => {
    await studio.getByRole('button', { name: 'Show-wide sound and triggers' }).click();
    await studio.getByRole('button', { name: '+ Trigger' }).click();
    const row = studio.locator('.react-trigger').last();
    await row.getByLabel('When', { exact: true }).selectOption('on');
    await row.getByRole('button', { name: 'Learn' }).click();
    await react('midi', [0x90, 60, 100]);
    await studio.waitForFunction(() => [...document.querySelectorAll('.react-trigger select[aria-label="Goes on"] option:checked')].some(o => /note 60/.test(o.textContent)), null, { timeout: 3000 })
      .catch(async () => { throw new Error(`the note was not learned: ${await row.getByLabel('Goes on', { exact: true }).inputValue()}`); });
    // A person lets go of the key, and presses it again a moment later: each is seen in its own frame.
    await react('midi', [0x80, 60, 0]); await sleep(200);
    const before = await currentScene();
    await react('midi', [0x90, 60, 100]);
    await studio.waitForFunction(b => document.querySelector('.map-scene[aria-pressed="true"]')?.textContent !== b, before, { timeout: 3000 })
      .catch(async () => { throw new Error(`still on ${before}; triggers: ${JSON.stringify(await studio.evaluate(() => [...document.querySelectorAll('.react-trigger select')].map(s => s.value)))}`); });
    assert.notEqual(await currentScene(), before);
    await react('midi', [0x80, 60, 0]);
    await studio.getByRole('button', { name: 'Show-wide sound and triggers' }).click();
  });

  // Live in Map: a shape plays the Live screen's look, from the test pattern here.
  const liveStats = () => output.evaluate(() => window.__mapStats?.live ?? null);
  const liveTestPattern = async () => {
    await openSection(studio, 'live');
    await studio.getByLabel('Live camera', { exact: true }).selectOption({ label: 'Test pattern' });
    // A white ground, so Live's picture is never dark where nothing has been painted yet.
    await studio.getByLabel('Ground', { exact: true }).selectOption('1');
  };

  await check('a shape playing Live shows Live on the wall, never black while it starts', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.5, .5]);
    await tool('Select'); await asColour();
    await wallUntil([[.35, .35]], c => near(c[0], RED, 30), 'its colour first');
    await playLook(studio, 'live');
    await liveTestPattern();
    const seen = [];
    for (let i = 0; i < 80; i++) {
      const c = (await sample(output, [[.35, .35]])).colours[0];
      seen.push(c);
      if (!near(c, RED, 30) && (await liveStats())?.running) break;
      await sleep(100);
    }
    assert.ok(seen.every(c => !near(c, BLACK, 20)), `a black frame while Live started: ${seen.map(c => `rgb(${c})`).join(' ')}`);
    assert.ok(!near(seen.at(-1), RED, 30), `the shape still shows its colour: Live never came (${JSON.stringify(await liveStats())})`);
    assert.equal(await studio.locator('.map-shape-list li .map-row-plays').first().textContent(), 'Live');
  });

  await check('two shapes Across stage playing Live show one continuous picture, with one Live drawn', async () => {
    await placement('across-stage');
    await tool('Rectangle'); await dragOn([.5 + 3 / 1920, .2], [.8, .5]);
    await tool('Select');
    const names = await studio.locator('.map-shape-list li .map-row-name').allTextContents();
    await openSection(studio, 'effect');
    await studio.getByLabel('Share with', { exact: true }).selectOption({ label: names[0] });
    await placement('across-stage');
    await sleep(1500);
    // Live's brush texture is fine-grained: pairs only 7 px apart (just across the 3 px gap), and a wider tolerance.
    // Two separate pictures would differ far more: the left shape would show the picture's right edge, the right its left.
    const pairs = Array.from({ length: 24 }, (_, i) => [[.5 - 2 / 1920, .22 + i * .011], [.5 + 5 / 1920, .22 + i * .011]]).flat();
    const s = await sample(output, pairs);
    let close = 0;
    for (let i = 0; i < s.colours.length; i += 2) if (near(s.colours[i], s.colours[i + 1], 60)) close++;
    assert.ok(close >= 16, `only ${close} of 24 pairs match across the edge`);
    assert.equal((await liveStats())?.running, true);
  });

  await check('a scene switches a shape from an instrument to Live and back, with a crossfade and no black frame', async () => {
    const before = await sceneButtons().count();
    const add = studio.getByRole('button', { name: '+ Scene' });
    await add.click();                       // this scene: Live on both shapes
    await add.click();                       // the next: the first shape plays an instrument
    await focusStage(); await studio.keyboard.press('Escape');
    await clickOn([.35, .35]);
    await playLook(studio, 'preset:porcelain-shutters');
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length >= 1, null, { timeout: 15000 });
    await sleep(1500);
    await sceneButtons().nth(before).click();  // back to Live
    // A black frame blacks out the whole shape; one point can fall on dark artwork (the instrument's black shutters).
    const spots = [[.25, .25], [.3, .4], [.35, .35], [.4, .3], [.45, .45], [.28, .45], [.45, .27]];
    const during = [];
    for (let i = 0; i < 25; i++) { during.push((await sample(output, spots)).colours); await sleep(100); }
    const black = during.findIndex(frame => frame.every(c => near(c, BLACK, 20)));
    assert.ok(black < 0, `a black frame switching to Live, sample ${black}: ${JSON.stringify(during[black])}`);
    assert.equal(await studio.locator('.map-shape-list li .map-row-plays').first().textContent(), 'Live');
    await sceneButtons().nth(before + 1).click();
    await studio.waitForFunction(() => document.querySelector('.map-shape-list li .map-row-plays')?.textContent !== 'Live', null, { timeout: 5000 });
    await sceneButtons().nth(before).click();
  });

  await check('∿ on a slider in the Live card, with the test beat, moves the look on the wall; a slider moved there reaches the wall', async () => {
    await focusStage(); await studio.keyboard.press('Escape');
    await clickOn([.35, .35]);
    await openSection(studio, 'live');
    await studio.getByLabel('React to… Spread', { exact: true }).click();
    await studio.getByRole('menuitem', { name: 'Beat', exact: true }).click();
    await reactReady();
    await react('testBeat', true);
    await output.waitForFunction(() => !!window.__studioTest?.liveDrawn, null, { timeout: 5000 });
    const values = [];
    for (let i = 0; i < 30; i++) { values.push(await output.evaluate(() => window.__studioTest.liveDrawn().paint.spread)); await sleep(60); }
    assert.ok(Math.max(...values) - Math.min(...values) > 0.02, `Spread on the wall did not move with the beat: ${values.map(v => v.toFixed(3)).join(', ')}`);
    await react('testBeat', false);
    const response = studio.getByLabel('Movement response', { exact: true });
    await response.fill('2.5');
    await output.waitForFunction(() => Math.abs(window.__studioTest.liveDrawn().paint.response - 2.5) < 0.01, null, { timeout: 5000 });
  });

  await check('switching the Live look mid-show (Paint to Smoke) keeps Live on the wall, never the shape’s own colour', async () => {
    await openSection(studio, 'live');
    await wallUntil([[.35, .35]], c => !near(c[0], RED, 30), 'Live before the switch');
    await studio.getByLabel('Look', { exact: true }).selectOption('smoke');
    const during = [];
    for (let i = 0; i < 30; i++) { during.push((await sample(output, [[.35, .35]])).colours[0]); await sleep(100); }
    assert.ok(during.every(c => !near(c, RED, 30)), `the shape fell back to its colour while Smoke started: ${during.map(c => `rgb(${c})`).join(' ')}`);
    assert.equal((await liveStats())?.running, true);
    await studio.getByLabel('Look', { exact: true }).selectOption('paint');
  });

  await check('with nothing using Live, the wall lets Live (and its camera) go', async () => {
    // Deleting the shapes takes them out of every scene too.
    await clearStage();
    await output.waitForFunction(() => window.__mapStats?.live === null, null, { timeout: 5000 })
      .catch(async () => { throw new Error(`Live still runs: ${JSON.stringify(await liveStats())}`); });
  });

  // Map sound pass: the Effect tab's own settings, its ∿, the Show popover and the strip.
  const effectSlider = () => studio.locator('.map-effect-settings .parameter:has(details.react-to) input[type="range"]').first();
  await check('an Effect-tab slider moved with the output open changes the effect without preparing it again, as one undo step', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.5, .5]);
    await tool('Select');
    await playLook(studio, 'preset:porcelain-shutters');
    await output.waitForFunction(() => Object.values(window.__mapStats?.prepares ?? {}).some(n => n >= 1), null, { timeout: 15000 });
    await sleep(1500);
    const prepares = await output.evaluate(() => JSON.stringify(window.__mapStats.prepares));
    await openSection(studio, 'effect');
    const slider = effectSlider();
    const label = await slider.getAttribute('aria-label'), start = await slider.inputValue();
    const min = Number(await slider.getAttribute('min')), max = Number(await slider.getAttribute('max'));
    const adjustedBefore = (await wallStats()).adjusted ?? 0;
    // A real drag with the mouse: one gesture, so one undo step however many values it passes through.
    const box = await slider.boundingBox();
    await studio.mouse.move(box.x + 4, box.y + box.height / 2); await studio.mouse.down();
    for (let i = 1; i <= 8; i++) { await studio.mouse.move(box.x + 4 + (box.width - 8) * i / 9, box.y + box.height / 2); await sleep(40); }
    await studio.mouse.up();
    assert.notEqual(await slider.inputValue(), start, `${label} did not move`);
    await sleep(2500);
    assert.equal(await output.evaluate(() => JSON.stringify(window.__mapStats.prepares)), prepares, 'the effect was prepared again');
    assert.ok(((await wallStats()).adjusted ?? 0) > adjustedBefore, 'the wall never took the new setting');
    await studio.getByRole('button', { name: 'Undo', exact: true }).click();
    await studio.waitForFunction(([l, v]) => document.querySelector(`.map-effect-settings input[type="range"][aria-label="${l}"]`)?.value === v, [label, start], { timeout: 3000 })
      .catch(async () => { throw new Error(`one Undo left ${label} at ${await effectSlider().inputValue()}, not ${start}`); });
  });

  await check('∿ on an Effect setting, with the test beat, moves that setting on the wall', async () => {
    await openSection(studio, 'effect');
    const row = studio.locator('.map-effect-settings .parameter:has(details.react-to)').first();
    await row.locator('details.react-to > summary').click();
    await studio.getByRole('menuitem', { name: 'Bass', exact: true }).click();
    await reactReady();
    await react('testBeat', true);
    const seen = new Set();
    for (let i = 0; i < 8; i++) { const l = await output.evaluate(() => window.__mapStats?.linked ?? {}); Object.values(l).forEach(v => seen.add(v.toFixed(3))); await sleep(700); }
    await react('testBeat', false);
    assert.ok(seen.size >= 2, `the linked setting did not move on the wall: ${[...seen].join(', ')}`);
    assert.ok(await studio.locator('.map-shape-list .map-row-reacts').count() >= 1, 'the shape list does not mark the shape as reacting');
  });

  await check('a setting that only changes by restarting has its ∿ greyed, with the reason', async () => {
    await openSection(studio, 'effect');
    const greyed = studio.locator('.map-effect-settings .react-to.disabled[aria-label*="restarts the effect"]');
    assert.ok(await greyed.count() >= 1, 'no greyed ∿ with the restarts note');
  });

  await check('Show lists the triggers', async () => {
    await studio.getByRole('button', { name: 'Show-wide sound and triggers' }).click();
    await studio.getByRole('dialog', { name: 'Show-wide sound and triggers' }).waitFor();
    assert.ok(await studio.locator('.map-show-pop .react-trigger').count() >= 1, 'the trigger made earlier is not listed');
    await studio.keyboard.press('Escape');
    await studio.getByRole('dialog', { name: 'Show-wide sound and triggers' }).waitFor({ state: 'detached', timeout: 2000 });
  });

  await check('the sound strip keeps the input, meters and scenes on screen at 1280 wide', async () => {
    await studio.setViewportSize({ width: 1280, height: 800 });
    await sleep(400);
    for (const name of ['Sound input', 'Sound levels', 'Scenes']) {
      const box = await studio.getByLabel(name, { exact: true }).first().boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 800, `${name} is off screen: ${JSON.stringify(box)}`);
    }
    await studio.setViewportSize({ width: 1500, height: 900 });
    await sleep(300);
  });

  // ---- Stage 6: pictures and videos ----
  const videoStats = () => output.evaluate(() => window.__mapStats?.videos ?? {});
  const shapeHash = () => output.evaluate(() => { const c = document.querySelector('canvas'), o = new OffscreenCanvas(c.width, c.height), x = o.getContext('2d'); x.drawImage(c, 0, 0); let h = 0, dark = 0;
    for (let i = 0; i < 30; i++) for (let j = 0; j < 16; j++) { const d = x.getImageData(Math.floor(c.width * (.22 + i * .009)), Math.floor(c.height * (.22 + j * .022)), 1, 1).data; h = (h * 31 + d[0] + d[1] * 7 + d[2] * 13) >>> 0; if (d[0] + d[1] + d[2] < 20) dark++; }
    return { h, dark }; });
  const pickLook = async value => { await openSection(studio, 'effect'); await studio.getByRole('button', { name: 'Change look' }).click(); await studio.locator(`[data-look="${value}"]`).click(); };

  await check('an image tile plays a chosen picture in a shape on the wall', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.5, .5]);
    await tool('Select'); await asColour();
    const chooser = studio.waitForEvent('filechooser');
    await pickLook('image');
    await (await chooser).setFiles(PICTURE);
    await studio.getByRole('button', { name: 'Close looks' }).click().catch(() => {});
    await wallUntil([[.35, .35]], c => c[0][0] > 200 && c[0][1] < 40 && c[0][2] < 40 && !near(c[0], RED, 15), 'the red picture');
    assert.match(await studio.locator('.map-shape-list li .map-row-plays').first().textContent(), /^Image · test-red\.png/);
  });

  await check('a video plays in two shapes from one player, and moves; Freeze holds it and unfreezing resumes it', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.5, .5]);
    await tool('Select');
    await nextPick(CLIP);
    await pickLook('video');
    await studio.getByRole('button', { name: 'Close looks' }).click().catch(() => {});
    await tool('Rectangle'); await dragOn([.55, .2], [.8, .5]);
    await tool('Select');
    const names = await studio.locator('.map-shape-list li .map-row-name').allTextContents();
    await openSection(studio, 'effect');
    await studio.getByLabel('Share with', { exact: true }).selectOption({ label: names[0] });
    await output.waitForFunction(() => Object.values(window.__mapStats?.videos ?? {}).some(v => v.state === 'playing'), null, { timeout: 15000 });
    assert.equal(Object.keys(await videoStats()).length, 1, 'one player for both shapes');
    const a = await shapeHash(); await sleep(400); const b = await shapeHash();
    assert.notEqual(a.h, b.h, 'the video is not moving on the wall');
    await studio.getByRole('button', { name: 'Freeze', exact: true }).click();
    await sleep(500); const f1 = await shapeHash(); await sleep(600); const f2 = await shapeHash();
    assert.equal(f1.h, f2.h, 'Freeze did not hold the video');
    await studio.getByRole('button', { name: 'Freeze', exact: true }).click();
    await sleep(600); const f3 = await shapeHash();
    assert.notEqual(f3.h, f2.h, 'the video did not resume after Freeze');
  });

  await check('Loop with the tempo, with the test beat, fits the clip to the beats', async () => {
    await openSection(studio, 'effect');
    await reactReady().catch(async () => { await studio.getByRole('button', { name: /Turn on sound and MIDI|Choose a sound input/ }).first().click().catch(() => {}); await reactReady(); });
    await react('testBeat', true);
    await studio.getByLabel('Video loop with the tempo', { exact: true }).selectOption('4');
    await output.waitForFunction(() => Object.values(window.__mapStats?.videos ?? {}).some(v => v.playsAs !== null), null, { timeout: 10000 })
      .catch(async () => { throw new Error(`no tempo loop: ${JSON.stringify(await videoStats())}`); });
    await react('testBeat', false);
    await studio.getByLabel('Video loop with the tempo', { exact: true }).selectOption('');
  });

  await check('a video moved on disk falls back to the shape’s fill with a note, never black; Find… brings it back', async () => {
    await fs.rename(CLIP, MOVED);
    // The output reopened (as after a restart) loads every video afresh, and finds this one gone.
    const closed = output.waitForEvent('close', { timeout: 10000 });
    await studio.getByRole('button', { name: 'Close output' }).click();
    await closed;
    const opened = app.waitForEvent('window', { timeout: 15000 });
    await studio.getByRole('button', { name: 'Open output' }).click();
    output = await opened;
    output.on('pageerror', e => errors.push(String(e)));
    await output.waitForURL(/#map-output/);
    await output.waitForFunction(() => Object.values(window.__mapStats?.videos ?? {}).some(v => v.state === 'missing'), null, { timeout: 15000 })
      .catch(async () => { throw new Error(`the moved file was not noticed: ${JSON.stringify(await videoStats())}`); });
    const hash = await shapeHash();
    assert.ok(hash.dark < 400, `the wall went black: ${hash.dark} of 480 samples dark`);
    await openSection(studio, 'effect');
    await studio.waitForFunction(() => /can’t be found/.test(document.querySelector('.map-video-panel [role=status]')?.textContent ?? ''), null, { timeout: 5000 });
    await nextPick(MOVED);
    await studio.getByRole('button', { name: 'Find…' }).click();
    await output.waitForFunction(() => { const v = Object.values(window.__mapStats?.videos ?? {}); return v.length > 0 && v.every(x => x.state === 'playing'); }, null, { timeout: 15000 })
      .catch(async () => { throw new Error(`Find… did not bring it back: ${JSON.stringify(await videoStats())}`); });
    assert.match(await studio.locator('.map-video-name').textContent(), /test-loop-moved\.mp4/);
  });

  // ---- Stage 7: wild options ----
  const prepared = () => output.evaluate(() => Object.values(window.__mapStats?.prepares ?? {}).reduce((a, b) => a + b, 0));
  const slide = async (label, value) => { const s = studio.getByLabel(label, { exact: true }); await s.fill(String(value)); await s.dispatchEvent('pointerup'); };

  await check('a border run lights only part of the border, and the lit part goes round', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.6, .6]);
    await tool('Select'); await asColour();
    await openSection(studio, 'edge');
    await slide('Border', 16);
    await studio.getByLabel('Border colour', { exact: true }).selectOption('fixed');
    await studio.getByLabel('Border hex', { exact: true }).fill('#ffffff');
    await studio.getByLabel('Border run', { exact: true }).selectOption('laps');
    await slide('Run speed', 60);
    // Sixteen places 6 px inside the outline, four on each side.
    const ix = 6 / 1920, iy = 6 / 1080, along = [.25, .35, .45, .55];
    const points = [...along.map(x => [x, .2 + iy]), ...along.map(y => [.6 - ix, y]), ...along.map(x => [x, .6 - iy]), ...along.map(y => [.2 + ix, y])];
    const white = c => c[0] > 200 && c[1] > 200 && c[2] > 200;
    const lit = new Set(); let most = 0;
    for (let i = 0; i < 24; i++) {
      const { colours } = await sample(output, points);
      const now = colours.map((c, k) => white(c) ? k : -1).filter(k => k >= 0);
      now.forEach(k => lit.add(k)); most = Math.max(most, now.length);
      assert.ok(colours.every(coloured), 'a border run made part of the shape black');
      // Uneven gaps: with a fixed gap, a busy machine can make every sample land at the same point of the lap.
      await sleep(40 + Math.random() * 160);
    }
    assert.ok(most < 12, `most of the border was lit at once (${most} of 16)`);
    assert.ok(lit.size >= 10, `the lit part did not go round: only ${lit.size} of 16 places were ever lit`);
    await studio.getByLabel('Border run', { exact: true }).selectOption('');
    await wallUntil(points, c => c.every(white), 'the whole border back when the run is off');
  });

  await check('stagger: the cells of a grid playing one picture show it at different moments, never black', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.6, .6]);
    await tool('Select');
    await playLook(studio, 'preset:porcelain-shutters');
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 1, null, { timeout: 15000 });
    await openSection(studio, 'shape');
    await studio.locator('.map-grid-tool summary').click();
    await studio.getByLabel('Grid gap', { exact: true }).fill('0');
    await studio.getByRole('button', { name: 'Make grid', exact: true }).click();
    await studio.locator('.map-group-row').waitFor();
    await sleep(800);
    // Each cell shows the whole picture (Fit): the same places in every cell then match while nothing is staggered.
    const cells = studio.locator('.map-shape-list li:not(.map-group-row)');
    for (let i = 0; i < 4; i++) { await cells.nth(i).click(); await openSection(studio, 'placement'); await studio.getByLabel('Placement', { exact: true }).selectOption('fit'); }
    await sleep(800);
    const inCell = [[.04, .05], [.1, .15], [.15, .08], [.08, .12], [.13, .17], [.06, .16]];
    const places = [[0, 0], [.2, 0], [0, .2], [.2, .2]].flatMap(([ox, oy]) => inCell.map(([x, y]) => [.2 + ox + x, .2 + oy + y]));
    // The effect rests between moves, so the cells are watched for about four seconds.
    let lastCellMoved = 0, lastCell = null;
    const broken = async () => { let most = 0; for (let i = 0; i < 30; i++) { const { colours } = await sample(output, places); const cell = colours.slice(18).join(); if (lastCell !== null && cell !== lastCell) lastCellMoved++; lastCell = cell; let n = 0; for (let k = 6; k < colours.length; k++) if (!near(colours[k], colours[k % 6], 40)) n++; most = Math.max(most, n); await sleep(120); } return most; };
    const before = await broken();
    await studio.locator('.map-group-row').click();
    await openSection(studio, 'group');
    await slide('Stagger', 1);
    await output.waitForFunction(() => (window.__mapStats?.delayed ?? 0) === 3 && window.__mapStats.staggered === 1, null, { timeout: 5000 });
    await sleep(1200);
    lastCellMoved = 0; lastCell = null;
    const after = await broken();
    assert.ok(lastCellMoved >= 3, `the most delayed cell stood still (${lastCellMoved} changes in about four seconds)`);
    assert.ok(before <= 3, `the cells did not match before Stagger: ${before} of 18 places differ`);
    assert.ok(after >= before + 4, `the cells did not show different moments with Stagger on: ${before} → ${after} of 18 places differ`);
    await wallUntil([[.3, .3], [.5, .3], [.3, .5], [.5, .5]], c => c.every(coloured), 'every cell shows its picture');
    await slide('Stagger', 0);
    await output.waitForFunction(() => (window.__mapStats?.delayed ?? 0) === 0 && window.__mapStats.staggered === 0, null, { timeout: 5000 });
  });

  await check('Vary each and Palette shift give each cell its own copy, each one undo step', async () => {
    // The grid from the last check: four cells playing one instrument.
    await openSection(studio, 'group');
    await studio.getByRole('button', { name: 'Vary each', exact: true }).click();
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 4, null, { timeout: 15000 });
    await studio.getByRole('button', { name: 'Undo', exact: true }).click();
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 1, null, { timeout: 15000 });
    await openSection(studio, 'group');
    await studio.getByRole('button', { name: 'Palette shift', exact: true }).click();
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 4, null, { timeout: 15000 });
    await wallUntil([[.3, .3], [.5, .3], [.3, .5], [.5, .5]], c => c.every(coloured), 'every cell shows its copy');
    await studio.getByRole('button', { name: 'Undo', exact: true }).click();
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 1, null, { timeout: 15000 });
  });

  await check('Follow the outline: switching it on, and moving a corner, gives the effect its new shape, never black', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.6, .6]);
    await tool('Select');
    await playLook(studio, 'preset:porcelain-shutters');
    await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 1, null, { timeout: 15000 });
    await sleep(500);
    const start = await prepared();
    await openSection(studio, 'effect');
    // Every way of following leaves part of the shape showing the effect.
    const grid = []; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) grid.push([.22 + i * .07, .22 + j * .07]);
    let count = start;
    for (const mode of ['obstacle', 'edge', 'emitter']) {
      await openSection(studio, 'effect');
      await studio.getByLabel("Follow the shape's outline", { exact: true }).selectOption(mode);
      await output.waitForFunction(n => Object.values(window.__mapStats.prepares).reduce((a, b) => a + b, 0) > n, count, { timeout: 10000 });
      count = await prepared();
      await sleep(600);
      // Trace edges draws a thin line along the smaller copy of the outline (65 % of the shape, about its middle: .27 to .53).
      const ring = []; for (const t of [.31, .36, .4, .44, .49]) ring.push([.27, t], [.53, t], [t, .27], [t, .53]);
      const places = mode === 'edge' ? ring : grid;
      let most = 0;
      for (let i = 0; i < 10; i++) { const { colours } = await sample(output, places); most = Math.max(most, colours.filter(coloured).length); await sleep(150); }
      assert.ok(most >= 4, `${mode}: only ${most} of ${places.length} places in the shape show anything`);
      await fs.writeFile(path.join(out, `output-follow-${mode}.png`), Buffer.from((await sample(output, [])).png, 'base64'));
    }
    await wallUntil([[.4, .4]], c => c.every(coloured), 'the effect after following');
    const followed = await prepared();
    await dragOn([.6, .6], [.66, .64]);
    await output.waitForFunction(n => Object.values(window.__mapStats.prepares).reduce((a, b) => a + b, 0) > n, followed, { timeout: 10000 });
    for (let i = 0; i < 6; i++) { const { colours } = await sample(output, [[.4, .4]]); assert.ok(coloured(colours[0]), 'black while following a moved corner'); await sleep(100); }
    await openSection(studio, 'effect');
    await studio.getByLabel("Follow the shape's outline", { exact: true }).selectOption('');
  });

  await check('auto-advance moves to the other scene on its own with the test beat, and waits while Freeze is on', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.5, .5]);
    await tool('Select'); await asColour();
    const add = studio.getByRole('button', { name: '+ Scene' });
    while (await sceneButtons().count() < 2) await add.click();
    await reactReady();
    await react('testBeat', true);
    await studio.getByLabel('Scene auto-advance', { exact: true }).selectOption('bars:4');
    const first = await currentScene();
    await studio.waitForFunction(was => document.querySelector('.map-scenes .map-scene[aria-pressed="true"]')?.textContent !== was, first, { timeout: 25000 });
    const freeze = studio.getByRole('button', { name: 'Freeze', exact: true });
    await freeze.click();
    const held = await currentScene();
    await sleep(10000); // longer than four bars at 120 BPM
    assert.equal(await currentScene(), held, 'auto-advance moved on while Freeze was on');
    await freeze.click();
    await studio.waitForFunction(was => document.querySelector('.map-scenes .map-scene[aria-pressed="true"]')?.textContent !== was, held, { timeout: 25000 });
    await studio.getByLabel('Scene auto-advance', { exact: true }).selectOption('');
    await react('testBeat', false);
  });

  await check('Finish in the Effect tab shows Studio’s groups, and Opacity there dims the effect on the wall', async () => {
    await clearStage();
    await tool('Rectangle'); await dragOn([.2, .2], [.6, .6]);
    await tool('Select');
    await playLook(studio, 'preset:porcelain-shutters');
    await openSection(studio, 'effect');
    const settings = studio.locator('.map-effect-settings');
    await studio.locator('.map-effect-parts').getByRole('button', { name: 'Finish', exact: true }).click();
    const heads = await settings.locator('.control-section h3').allInnerTexts();
    for (const h of ['Layer mix', 'Color finish', 'Tonal finishing']) assert.ok(heads.includes(h), `Finish has no "${h}" group (${heads.join(', ')})`);
    // Optional groups (Glow, Print screen, Feedback and the rest) are not all listed at once.
    assert.ok(await settings.locator('.parameter').count() < 30, 'Finish lists every setting at once');
    const brightness = async () => (await sample(output, [[.25, .25], [.4, .4], [.55, .55], [.3, .5], [.5, .3]])).colours.flat().reduce((a, b) => a + b, 0);
    await sleep(1500);
    const before = await brightness();
    await slide('Opacity', 0.2);
    await sleep(1500);
    const after = await brightness();
    assert.ok(after < before * 0.7, `Opacity 0.2 left the wall at ${after} of ${before}`);
    await studio.locator('.map-effect-parts').getByRole('button', { name: 'Settings', exact: true }).click();
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

  await check('Live: Glow on the beat moves the look’s setting with the test beat; the saved setting stays as set', async () => {
    await studio.getByRole('region', { name: 'Map' }).getByRole('button', { name: 'Live', exact: true }).click();
    const liveRegion = studio.getByRole('region', { name: 'Live' });
    await liveRegion.waitFor();
    await studio.getByLabel('Source', { exact: true }).selectOption({ label: 'Test pattern' });
    // Live in Map: a slider moved in Map's Live card is the Live screen's own setting.
    await studio.waitForFunction(() => document.querySelector('input[aria-label="Movement response"]')?.value === '2.5', null, { timeout: 5000 })
      .catch(async () => { throw new Error(`the Live screen shows ${await studio.getByLabel('Movement response', { exact: true }).inputValue()}, not the 2.5 set in Map`); });
    await studio.locator('details.live-react > summary').click();
    await studio.getByRole('button', { name: 'Glow on the beat' }).click();
    await reactReady();
    await react('testBeat', true);
    await studio.waitForFunction(() => !!window.__studioTest?.liveDrawn, null, { timeout: 5000 });
    const values = [];
    for (let i = 0; i < 30; i++) { values.push(await studio.evaluate(() => window.__studioTest.liveDrawn().paint.spread)); await sleep(60); }
    const set = await studio.getByLabel('Spread', { exact: true }).inputValue().catch(() => null);
    assert.ok(Math.max(...values) - Math.min(...values) > 0.02, `Spread did not move with the beat: ${values.map(v => v.toFixed(3)).join(', ')}`);
    if (set !== null) assert.ok(values.some(v => Math.abs(v - Number(set)) > 0.01) && Number.isFinite(Number(set)), 'the slider follows the link');
    await react('testBeat', false);
    await liveRegion.getByRole('button', { name: 'Map', exact: true }).click();
    await studio.getByRole('region', { name: 'Map' }).waitFor();
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
