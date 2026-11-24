// Soak test for Meridian on a Map wall, as an installation runs it.
// Run: npm run build && node scripts/soak-meridian.mjs --hours 12
//
// The real app starts with Installation mode on and a saved show (Evolve on four mapped shapes, three sources, the wall limiter
// on), so it must restore that show onto the wall and start the autopilot by itself. The test beat plays the whole time, and a
// Drop, Hold or Reseed is pressed through the show's MIDI links every 20 seconds. Each minute one row goes to
// work/meridian/soak-<date>.csv: frame rate, longest frame, JS heap, renderer and graphics memory, governor and limiter state,
// autopilot changes and faults. The system is kept awake while it runs.
//
// Exits non-zero on any unrecovered fault (a crash, a page error, a wall fault lasting two minutes, the limiter failing, or the
// show standing still), or, for runs over an hour, sustained memory growth of more than 10% after the first hour.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const hours = Number(arg('--hours') ?? 1);
if (!(hours > 0) || hours > 72) { console.error('Give --hours between 0 and 72, for example --hours 12.'); process.exit(2); }
const minutes = Math.max(1, Math.round(hours * 60));
const out = path.join(root, 'work/meridian');
const userData = path.join(out, 'soak-user-data');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const csvFile = path.join(out, `soak-${stamp}.csv`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = text => console.log(`[soak ${new Date().toISOString().slice(11, 19)}] ${text}`);

// Keep the Mac awake (display and system) for as long as this process lives.
const awake = process.platform === 'darwin' ? spawn('caffeinate', ['-dims', '-w', String(process.pid)], { stdio: 'ignore' }) : null;

await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });
// The show the installation restores: the Map checks' Evolve show, written as the Map's own autosave.
execFileSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'scripts/meridian-map-show.ts'), out]);
await fs.copyFile(path.join(out, 'meridian-calm.formshow'), path.join(userData, 'map-autosave.formshow'));
await fs.writeFile(path.join(userData, 'installation.json'), JSON.stringify({ on: true, surface: 'map', autopilot: true, everyBeats: 16, display: null }));

const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
let finished = false;
const faults = [];
const fault = text => { faults.push(`${new Date().toISOString()} ${text}`); log(`FAULT ${text}`); };
app.process().on('exit', code => { if (!finished) fault(`the app exited (${code})`); });
const rows = [];
const header = ['minute', 'elapsed_s', 'fps', 'longest_frame_ms', 'p99_frame_ms', 'frames_over_25ms', 'wall_cpu_ms', 'output_heap_mb', 'studio_heap_mb', 'renderer_mb', 'gpu_mb', 'total_mb', 'quality_level', 'quality_reduced', 'limiter_on', 'limiting', 'autopilot_changes', 'moves_pressed', 'meridian_records', 'evolve_frames', 'faults'];
await fs.writeFile(csvFile, header.join(',') + '\n');

let exitCode = 0, summary = {};
try {
  const studio = await app.firstWindow();
  studio.on('pageerror', e => fault(`studio page error: ${String(e).slice(0, 200)}`));
  studio.on('crash', () => fault('the studio window crashed'));
  await studio.getByText('Export engine ready', { exact: true }).waitFor({ timeout: 60000 });
  log('studio ready; waiting for Installation to open the wall');
  const isWall = w => /#map-output/.test(w.url());
  const wall = app.windows().find(isWall) ?? await app.waitForEvent('window', { predicate: isWall, timeout: 30000 }).catch(async error => {
    await studio.screenshot({ path: path.join(out, 'soak-no-wall.png') }).catch(() => {});
    throw new Error(`Installation did not open the wall (mode: ${await studio.evaluate(() => document.querySelector('.mode-switch [aria-pressed=true]')?.textContent).catch(() => '?')}): ${error.message}`);
  });
  wall.on('pageerror', e => fault(`wall page error: ${String(e).slice(0, 200)}`));
  wall.on('crash', () => fault('the wall window crashed'));
  wall.on('close', () => { if (!finished) fault('the wall window closed'); });
  await wall.waitForSelector('canvas');
  const stats = () => wall.evaluate(() => window.__mapStats ?? null);
  const until = Date.now() + 30000;
  let s = null;
  while (Date.now() < until) { s = await stats(); if (s?.meridian && Object.keys(s.meridian).length >= 3 && Object.values(s.meridian).every(m => m.frames > 10)) break; await sleep(500); }
  if (!s?.meridian || Object.keys(s.meridian).length < 3) throw new Error(`the restored show is not playing on the wall: ${JSON.stringify(s)}`);
  log(`the installation restored the show: ${Object.keys(s.meridian).length} Meridian sources on the wall`);
  await studio.waitForFunction(() => !!window.__studioTest?.react, null, { timeout: 15000 });
  await studio.evaluate(() => window.__studioTest.react.testBeat(true));

  // Frame gaps on the wall, every display frame.
  await wall.evaluate(() => {
    const gaps = []; let last = performance.now();
    const tick = now => { gaps.push(now - last); last = now; if (gaps.length > 20000) gaps.splice(0, 10000); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__soakGaps = () => { const g = gaps.splice(0); g.sort((a, b) => a - b); const sum = g.reduce((a, b) => a + b, 0);
      return { fps: g.length ? 1000 * g.length / sum : 0, longest: g.at(-1) ?? 0, p99: g[Math.floor(g.length * .99)] ?? 0, over25: g.filter(x => x > 25).length }; };
  });
  const probeFrame = async () => { await sleep(200); return wall.evaluate(() => window.__mapProbeFrame?.() ?? null); };
  const frameCosts = { start: await probeFrame() };
  await wall.evaluate(() => window.__soakGaps());

  // Moves, as a performer would press them: Drop, Hold (held a beat), Reseed, through the show's MIDI links.
  let pressed = 0;
  const NOTES = [60, 62, 64];
  const mover = setInterval(() => {
    const note = NOTES[pressed % NOTES.length]; pressed++;
    void studio.evaluate(note => { window.__studioTest.react.midi([0x90, note, 127]); setTimeout(() => window.__studioTest.react.midi([0x80, note, 0]), 450); }, note).catch(() => {});
  }, 20000);

  const started = Date.now();
  let wallFaultMinutes = 0, lastFrames = -1, stillMinutes = 0;
  for (let minute = 1; minute <= minutes; minute++) {
    await sleep(Math.max(0, started + minute * 60000 - Date.now()));
    const gaps = await wall.evaluate(() => window.__soakGaps());
    const st = await stats();
    const heap = page => page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0).catch(() => 0);
    const [outputHeap, studioHeap] = await Promise.all([heap(wall), heap(studio)]);
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(m => ({ type: m.type, kb: m.memory?.workingSetSize ?? 0 })));
    const mb = type => metrics.filter(m => m.type === type).reduce((a, m) => a + m.kb, 0) / 1024;
    const meridian = Object.values(st?.meridian ?? {});
    const evolveFrames = meridian.reduce((a, m) => a + (m.frames ?? 0), 0);
    const minuteFaults = [];
    if (st?.failing?.length) minuteFaults.push(...st.failing.map(f => `${f.id}: ${f.reason}`));
    if (st?.contextLost) minuteFaults.push('the wall context is lost');
    if (st?.flashGuard?.failed) minuteFaults.push(`limiter failed: ${st.flashGuard.failed}`);
    if (!st?.flashGuard?.on) minuteFaults.push('the limiter is not on');
    wallFaultMinutes = minuteFaults.length ? wallFaultMinutes + 1 : 0;
    if (wallFaultMinutes >= 2) fault(`a wall fault lasted two minutes: ${minuteFaults.join('; ')}`);
    stillMinutes = evolveFrames === lastFrames ? stillMinutes + 1 : 0; lastFrames = evolveFrames;
    if (stillMinutes >= 1) fault('Meridian stood still for a minute');
    const row = { minute, elapsed_s: Math.round((Date.now() - started) / 1000), fps: +gaps.fps.toFixed(1), longest_frame_ms: +gaps.longest.toFixed(1), p99_frame_ms: +gaps.p99.toFixed(1), frames_over_25ms: gaps.over25,
      wall_cpu_ms: st?.cpuMs ?? '', output_heap_mb: +outputHeap.toFixed(1), studio_heap_mb: +studioHeap.toFixed(1), renderer_mb: +mb('Tab').toFixed(1), gpu_mb: +mb('GPU').toFixed(1),
      total_mb: +(metrics.reduce((a, m) => a + m.kb, 0) / 1024).toFixed(1), quality_level: +(st?.meridianQuality?.level ?? 0).toFixed(2), quality_reduced: st?.meridianQuality?.reduced ? 1 : 0,
      limiter_on: st?.flashGuard?.on ? 1 : 0, limiting: st?.flashGuard?.limiting ? 1 : 0, autopilot_changes: meridian.reduce((a, m) => a + (m.autopilotChanges ?? 0), 0), moves_pressed: pressed,
      meridian_records: st?.meridianRecords ?? '', evolve_frames: evolveFrames, faults: `"${minuteFaults.join('; ').replace(/"/g, "'")}"` };
    rows.push(row);
    await fs.appendFile(csvFile, header.map(k => row[k]).join(',') + '\n');
    log(`minute ${minute}/${minutes}: ${row.fps} fps, longest ${row.longest_frame_ms} ms, heap ${row.output_heap_mb}/${row.studio_heap_mb} MB, renderers ${row.renderer_mb} MB, GPU ${row.gpu_mb} MB, quality ${row.quality_level}, autopilot ${row.autopilot_changes}${minuteFaults.length ? `, faults: ${minuteFaults.join('; ')}` : ''}`);
    // The probe stalls the wall for a moment on purpose, so its frames are left out of the next minute's gaps.
    if (minute === Math.round(minutes / 2)) { frameCosts.middle = await probeFrame(); await wall.evaluate(() => window.__soakGaps()); }
  }
  clearInterval(mover);
  frameCosts.end = await probeFrame();

  // Memory: after the first hour, the last quarter of the run against the minutes just after the first hour.
  const memory = r => r.renderer_mb + r.gpu_mb;
  const mean = list => list.reduce((a, r) => a + memory(r), 0) / Math.max(1, list.length);
  let growth = null, judged = false;
  if (rows.length >= 75) {
    const base = rows.filter(r => r.minute > 60 && r.minute <= 70), tail = rows.slice(-Math.max(10, Math.floor(rows.length / 4)));
    growth = mean(tail) / mean(base) - 1; judged = true;
    if (growth > .1) fault(`memory grew ${(growth * 100).toFixed(1)}% after the first hour`);
  } else if (rows.length >= 4) growth = mean(rows.slice(-3)) / mean(rows.slice(1, 4)) - 1;
  const fpsList = rows.map(r => r.fps);
  summary = { csv: path.relative(root, csvFile), minutes: rows.length, fps: { mean: +(fpsList.reduce((a, b) => a + b, 0) / fpsList.length).toFixed(1), lowest: Math.min(...fpsList) },
    longestFrameMs: Math.max(...rows.map(r => r.longest_frame_ms)), wallCpuMs: rows.at(-1)?.wall_cpu_ms, frameCosts,
    memoryMb: { first: +memory(rows[0]).toFixed(1), last: +memory(rows.at(-1)).toFixed(1), growth: growth === null ? null : +(growth * 100).toFixed(1) + '%', judged },
    heapMb: { output: [rows[0].output_heap_mb, rows.at(-1).output_heap_mb], studio: [rows[0].studio_heap_mb, rows.at(-1).studio_heap_mb] },
    qualityReducedMinutes: rows.filter(r => r.quality_reduced).length, autopilotChanges: rows.at(-1).autopilot_changes, movesPressed: pressed,
    meridianRecords: [rows[0].meridian_records, rows.at(-1).meridian_records], faults };
} catch (error) {
  fault(`the soak could not run: ${String(error.stack || error).split('\n').slice(0, 4).join(' | ')}`);
} finally {
  finished = true;
  await app.close().catch(() => {});
  awake?.kill();
}
exitCode = faults.length ? 1 : 0;
console.log(JSON.stringify(summary, null, 2));
console.log(exitCode ? `SOAK FAILED (${faults.length} fault${faults.length === 1 ? '' : 's'})` : 'SOAK PASSED');
process.exit(exitCode);
