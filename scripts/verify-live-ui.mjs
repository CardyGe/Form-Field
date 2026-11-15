// The Live section in the real desktop app, with Chromium's fake camera.
// Run after a build: node scripts/verify-live-ui.mjs
// The artwork window opens as an ordinary window here (STUDIO_LIVE_TEST_WINDOW) so the run does not take over the screen.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd(), out = path.join(root, 'work/live-ui', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(out, { recursive: true });
const profile = path.join(out, 'profile');
const wrapper = async (name, access) => {
  const file = path.join(out, `${name}.cjs`);
  await fs.writeFile(file, `const {app,systemPreferences}=require('electron');app.setPath('userData',${JSON.stringify(profile)});
app.commandLine.appendSwitch('use-fake-device-for-media-stream');${access === 'granted' ? "app.commandLine.appendSwitch('use-fake-ui-for-media-stream');" : ''}
systemPreferences.getMediaAccessStatus=()=>${JSON.stringify(access)};systemPreferences.askForMediaAccess=async()=>${access === 'granted'};
require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
  return file;
};
const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const checks = [];
let errors = [];
async function launch(access = 'granted') {
  const app = await electron.launch({ args: [await wrapper(access, access)], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.getByText('Export engine ready', { exact: true }).waitFor();
  return { app, page };
}
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
// Share of pixels in a screenshot of `locator` brighter than `floor` (0..255) in any channel.
async function lit(page, locator, floor = 24) {
  // Inset by a few pixels so the frame around the picture is not counted.
  const box = await locator.boundingBox();
  const png = (await locator.page().screenshot({ clip: { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 } })).toString('base64');
  return page.evaluate(async ([png, floor]) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data; let count = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) > floor) count++;
    return count / (data.length / 4);
  }, [png, floor]);
}
async function until(read, accept, what, tries = 60) { let value; for (let i = 0; i < tries; i++) { value = await read(); if (accept(value)) return value; await new Promise(r => setTimeout(r, 250)); } throw new Error(`${what}: last value ${value}`); }
const live = page => page.getByRole('region', { name: 'Live', exact: true });
const preview = page => page.getByLabel('Live preview', { exact: true });

let { app, page } = await launch();
try {
  // The studio autosaves shortly after starting; wait for that so there is a project to compare with.
  const project = await until(() => page.evaluate(() => window.studio.loadAutosave()), v => !!v?.layers?.length, 'the studio never autosaved');
  await check('Live opens, finds the camera and paints from its movement', async () => {
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await live(page).waitFor();
    await page.getByText(/^Camera running/).waitFor();
    await until(() => lit(page, preview(page)), v => v > .003, 'preview stayed dark');
    await page.screenshot({ path: path.join(out, 'live.png') });
  });
  await check('Show tracking shows the camera on the operator screen', async () => {
    await page.getByLabel('Show tracking', { exact: true }).check();
    await until(() => lit(page, preview(page)), v => v > .5, 'tracking view stayed dark');
    await page.screenshot({ path: path.join(out, 'tracking.png') });
    await page.getByLabel('Show tracking', { exact: true }).uncheck();
  });
  await check('Blackout hides the picture and Clear wipes it', async () => {
    await page.getByRole('button', { name: 'Blackout', exact: true }).click();
    await until(() => lit(page, preview(page), 2), v => v === 0, 'blackout was not black');
    await page.getByRole('button', { name: 'Blackout', exact: true }).click();
    await until(() => lit(page, preview(page)), v => v > .003, 'picture did not return');
    await page.getByLabel('Movement response', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await until(() => lit(page, preview(page), 2), v => v === 0, 'clear left paint');
    await page.getByLabel('Movement response', { exact: true }).fill('1');
  });
  await check('Open output shows the artwork in a second window and the preview follows it', async () => {
    const opened = app.waitForEvent('window');
    await page.getByRole('button', { name: 'Open output', exact: true }).click();
    const output = await opened;
    await output.waitForLoadState();
    assert.equal(new URL(output.url()).hash, '#live-output');
    await page.getByRole('button', { name: 'Close output', exact: true }).waitFor();
    await until(() => lit(output, output.locator('canvas')), v => v > .003, 'artwork window stayed dark');
    assert.equal(await output.locator('button, input, select, video').count(), 0);
    await until(() => lit(page, page.getByAltText('Output preview', { exact: true })), v => v > .003, 'operator preview stayed dark');
    assert.equal(await page.getByLabel('Show tracking', { exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Blackout', exact: true }).click();
    await until(() => lit(output, output.locator('canvas'), 2), v => v === 0, 'blackout did not reach the output');
    await page.getByRole('button', { name: 'Blackout', exact: true }).click();
    await output.keyboard.press('Escape').catch(() => {}); // the window closes on key down, before the key comes back up
    await page.getByRole('button', { name: 'Open output', exact: true }).waitFor();
    await until(() => lit(page, preview(page)), v => v > .003, 'operator renderer did not restart');
    assert.equal(app.windows().length, 1);
  });
  await check('Settings persist and the studio project is untouched', async () => {
    await page.getByLabel('Fade time', { exact: true }).fill('12');
    await page.getByLabel('Mirror', { exact: true }).uncheck();
    await until(() => page.evaluate(() => window.studio.live.loadSettings()), v => v?.paint?.fadeSeconds === 12 && v.mirror === false, 'settings were not saved');
    await live(page).getByRole('button', { name: 'Studio', exact: true }).click();
    await live(page).waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.studio.loadAutosave()), project);
    await app.close();
    ({ app, page } = await launch());
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await until(() => page.getByLabel('Fade time', { exact: true }).inputValue(), v => v === '12', 'saved fade time was not restored');
    assert.equal(await page.getByLabel('Mirror', { exact: true }).isChecked(), false);
  });
  await check('A damaged settings file starts Live with defaults', async () => {
    await app.close();
    await fs.writeFile(path.join(profile, 'live-settings.json'), '{oops');
    ({ app, page } = await launch());
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await page.getByText(/^Camera running/).waitFor();
    assert.equal(await page.getByLabel('Fade time', { exact: true }).inputValue(), '30');
  });
  await check('No page errors with the camera allowed', async () => assert.deepEqual(errors, []));
  await check('Refused camera access explains where to allow it and offers other sources', async () => {
    await app.close();
    ({ app, page } = await launch('denied'));
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await page.getByText('Camera access is off. Allow Form & Field in System Settings › Privacy & Security › Camera, then reopen the app.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Use a video file', exact: true }).waitFor();
    await page.getByLabel('Source', { exact: true }).selectOption({ label: 'Test pattern' });
    await until(() => lit(page, preview(page)), v => v > .01, 'test pattern did not paint');
    await live(page).getByRole('button', { name: 'Studio', exact: true }).click();
    await page.getByLabel('Composition preview', { exact: true }).waitFor();
  });
} finally {
  await app.close().catch(() => {});
}
console.log(`${checks.length} Live checks passed. Screenshots: ${path.relative(root, out)}`);
