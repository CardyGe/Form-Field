// Person finding in the packaged app: Multiclass loads in its worker from file://, returns masks,
// nothing goes out to the network, and Live keeps its frame rate.
// Run: npm run package && node scripts/verify-live-people.mjs [path/to/Form & Field.app] [--performance]
// --performance: Smoke at 1920 × 1080 with Multiclass running on the fake camera for 120 s (LIVE_PERF_SECONDS to change),
// written to work/live-people/<run>/performance.json.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd(), out = path.join(root, 'work/live-people', new Date().toISOString().replace(/[:.]/g, '-'));
const performanceRun = process.argv.includes('--performance');
const bundle = path.resolve(process.argv.slice(2).find(a => !a.startsWith('--')) || 'work/release/mac-arm64/Form & Field.app');
const profile = path.join(out, 'profile');
await fs.mkdir(profile, { recursive: true });
// Smoke chosen before launch, so person finding starts as soon as Live opens.
await fs.writeFile(path.join(profile, 'live-settings.json'), JSON.stringify({ version: 1, look: 'smoke' }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ executablePath: path.join(bundle, 'Contents/MacOS/Form & Field'),
  args: [`--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], env });
const page = await app.firstWindow(); page.setDefaultTimeout(20000);
const requests = [], blocked = [], errors = [];
page.on('request', r => requests.push(r.url()));
page.on('console', m => { const t = m.text(); if (/Content Security Policy/.test(t) && /connect/i.test(t)) blocked.push(t.slice(0, 160)); else if (m.type() === 'error') errors.push(t.slice(0, 300)); });
page.on('pageerror', e => errors.push(String(e)));
const checks = [];
const check = async (name, run) => { await run(); checks.push(name); console.log('PASS ' + name); };
try {
  await page.getByText('Export engine ready', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByText(/^Camera running/).waitFor();
  await check('Multiclass loads in its worker and returns masks', async () => {
    let state;
    for (let i = 0; i < 60; i++) { state = await page.evaluate(() => window.__studioTest?.livePeople?.()); if (state?.masks >= 5 || state?.status?.state === 'failed') break; await page.waitForTimeout(250); }
    console.log('      ', JSON.stringify(state));
    assert.notEqual(state?.status?.state, 'failed', state?.status?.reason);
    assert.ok(state.masks >= 5, `only ${state?.masks} masks`); assert.equal(state.ready, true);
  });
  await check('Live keeps its frame rate while people are found', async () => {
    await page.waitForTimeout(3000);
    const fps = Number((await page.locator('.live-fps').textContent())?.match(/\d+/)?.[0]);
    assert.ok(fps >= 55, `${fps} fps`);
  });
  await check('nothing leaves the computer', async () => {
    const outside = requests.filter(url => !/^(file|blob|data|devtools):/.test(url));
    assert.deepEqual(outside, []);
    if (blocked.length) console.log(`       ${blocked.length} outgoing request(s) were blocked by the security policy (MediaPipe usage logging)`);
  });
  await check('no page errors', async () => assert.deepEqual(errors, []));
  if (performanceRun) {
    const seconds = Number(process.env.LIVE_PERF_SECONDS) || 120;
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1920, 1080); w.show(); });
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__studioTest.liveFrames.mark());
    await page.waitForTimeout(seconds * 1000);
    const frames = await page.evaluate(() => window.__studioTest.liveFrames.read()), people = await page.evaluate(() => window.__studioTest.livePeople());
    const canvas = await page.getByLabel('Live preview', { exact: true }).evaluate(c => [c.width, c.height]);
    const result = { seconds, canvas, ...frames, people };
    await fs.writeFile(path.join(out, 'performance.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await app.close().catch(() => {});
}
console.log(`${checks.length} person-finding checks passed.`);
