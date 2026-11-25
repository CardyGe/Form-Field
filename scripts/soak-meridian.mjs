// Soak test for Meridian on a Map wall, as an installation runs it.
// Run: npm run build && node scripts/soak-meridian.mjs --hours 12
//
// The real app starts with Installation mode on and a saved show (Evolve on four mapped shapes, three sources, the wall limiter
// on), so it must restore that show onto the wall and start the autopilot by itself. The test beat plays the whole time, and a
// Drop, Hold or Reseed is pressed through the show's MIDI links every 20 seconds. Each minute one row goes to
// work/meridian/soak-<date>.csv: frame rate, longest frame, JS heap, renderer and graphics memory, governor and limiter state,
// autopilot changes and faults. The system is kept awake while it runs.
//
// The wall is sampled every 5 seconds. Exits non-zero on any fault: a crash or page error; any Meridian source that stands
// still, disappears or starts again from scratch; an instrument the wall restarts; a wall fault seen in two samples running; the
// limiter off or failed. For runs of 100 minutes or more, memory is judged after the first hour by soak-rules.mjs (the final 30
// minutes against minutes 61–70, and the slope), for process memory, the phys_footprint that counts graphics memory, and JS heap.
//
// --fullscreen runs the wall as on the show: the real full-screen output on a second display (the main screen is never used),
// without the check window. The frame-cost probe needs the check window, so it is left out there.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { memoryVerdict, parseFootprint, sampleFaults } from './soak-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const hours = Number(arg('--hours') ?? 1);
if (!(hours > 0) || hours > 72) { console.error('Give --hours between 0 and 72, for example --hours 12.'); process.exit(2); }
const minutes = Math.max(1, Math.round(hours * 60));
const fullscreen = process.argv.includes('--fullscreen');
const SAMPLE_MS = 5000;
const out = path.join(root, 'work/meridian');
const userData = path.join(out, 'soak-user-data');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const csvFile = path.join(out, `soak-${stamp}.csv`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean2 = (list, value) => list.reduce((a, r) => a + value(r), 0) / Math.max(1, list.length);
const log = text => console.log(`[soak ${new Date().toISOString().slice(11, 19)}] ${text}`);

// Keep the Mac awake (display and system) for as long as this process lives.
const awake = process.platform === 'darwin' ? spawn('caffeinate', ['-dims', '-w', String(process.pid)], { stdio: 'ignore' }) : null;

await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });
// The show the installation restores: the Map checks' Evolve show, written as the Map's own autosave.
execFileSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'scripts/meridian-map-show.ts'), out]);
await fs.copyFile(path.join(out, 'meridian-calm.formshow'), path.join(userData, 'map-autosave.formshow'));
const env = fullscreen ? { ...process.env } : { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
// Installation never opens on the main screen. In the check window it must, so the main display's id is read first and saved.
let display = null;
if (!fullscreen) {
  const probe = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
  display = await probe.evaluate(({ screen }) => screen.getPrimaryDisplay().id);
  await probe.close();
}
await fs.writeFile(path.join(userData, 'installation.json'), JSON.stringify({ on: true, surface: 'map', autopilot: true, everyBeats: 16, display }));
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
const run = promisify(execFile);
/** phys_footprint in MB of each Electron process (it counts IOKit and IOSurface graphics memory), by process type. */
const footprints = async metrics => {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await run('/usr/bin/footprint', ['-f', 'bytes', ...metrics.flatMap(m => ['-p', String(m.pid)])], { maxBuffer: 8 << 20 });
    const byPid = new Map(parseFootprint(stdout).map(f => [f.pid, f.bytes / 1048576]));
    const sum = type => metrics.filter(m => !type || m.type === type).reduce((a, m) => a + (byPid.get(m.pid) ?? 0), 0);
    return { gpu: sum('GPU'), tabs: sum('Tab'), total: sum() };
  } catch { return null; }
};
let finished = false;
const faults = [];
const fault = text => { faults.push(`${new Date().toISOString()} ${text}`); log(`FAULT ${text}`); };
app.process().on('exit', code => { if (!finished) fault(`the app exited (${code})`); });
const rows = [];
const header = ['minute', 'elapsed_s', 'fps', 'longest_frame_ms', 'p99_frame_ms', 'frames_over_25ms', 'wall_cpu_ms', 'output_heap_mb', 'studio_heap_mb', 'renderer_mb', 'gpu_mb', 'total_mb', 'footprint_gpu_mb', 'footprint_total_mb', 'context_losses', 'restarts', 'quality_level', 'quality_reduced', 'limiter_on', 'limiting', 'autopilot_changes', 'moves_pressed', 'meridian_records', 'evolve_frames', 'faults'];
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
  let previous = await stats();
  for (let minute = 1; minute <= minutes; minute++) {
    // Every 5 seconds: each source must have moved on, none may disappear or restart, and no wall fault may last two samples.
    const minuteFaults = [];
    while (Date.now() < started + minute * 60000 - 100) {
      await sleep(Math.min(SAMPLE_MS, Math.max(0, started + minute * 60000 - Date.now())));
      const now = await stats();
      for (const f of sampleFaults(previous, now)) { fault(f); minuteFaults.push(f); }
      previous = now;
    }
    const gaps = await wall.evaluate(() => window.__soakGaps());
    const st = previous;
    const heap = page => page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0).catch(() => 0);
    const [outputHeap, studioHeap] = await Promise.all([heap(wall), heap(studio)]);
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(m => ({ pid: m.pid, type: m.type, kb: m.memory?.workingSetSize ?? 0 })));
    const mb = type => metrics.filter(m => m.type === type).reduce((a, m) => a + m.kb, 0) / 1024;
    const foot = await footprints(metrics);
    const meridian = Object.values(st?.meridian ?? {});
    const evolveFrames = meridian.reduce((a, m) => a + (m.frames ?? 0), 0);
    const row = { minute, elapsed_s: Math.round((Date.now() - started) / 1000), fps: +gaps.fps.toFixed(1), longest_frame_ms: +gaps.longest.toFixed(1), p99_frame_ms: +gaps.p99.toFixed(1), frames_over_25ms: gaps.over25,
      wall_cpu_ms: st?.cpuMs ?? '', output_heap_mb: +outputHeap.toFixed(1), studio_heap_mb: +studioHeap.toFixed(1), renderer_mb: +mb('Tab').toFixed(1), gpu_mb: +mb('GPU').toFixed(1),
      total_mb: +(metrics.reduce((a, m) => a + m.kb, 0) / 1024).toFixed(1), footprint_gpu_mb: foot ? +foot.gpu.toFixed(1) : '', footprint_total_mb: foot ? +foot.total.toFixed(1) : '',
      context_losses: st?.contextLosses ?? '', restarts: st?.restarts ?? '', quality_level: +(st?.meridianQuality?.level ?? 0).toFixed(2), quality_reduced: st?.meridianQuality?.reduced ? 1 : 0,
      limiter_on: st?.flashGuard?.on ? 1 : 0, limiting: st?.flashGuard?.limiting ? 1 : 0, autopilot_changes: meridian.reduce((a, m) => a + (m.autopilotChanges ?? 0), 0), moves_pressed: pressed,
      meridian_records: st?.meridianRecords ?? '', evolve_frames: evolveFrames, faults: `"${minuteFaults.join('; ').replace(/"/g, "'")}"` };
    rows.push(row);
    await fs.appendFile(csvFile, header.map(k => row[k]).join(',') + '\n');
    log(`minute ${minute}/${minutes}: ${row.fps} fps, longest ${row.longest_frame_ms} ms, heap ${row.output_heap_mb}/${row.studio_heap_mb} MB, renderers ${row.renderer_mb} MB, GPU ${row.gpu_mb} MB, footprint ${row.footprint_total_mb} MB (GPU ${row.footprint_gpu_mb}), quality ${row.quality_level}, autopilot ${row.autopilot_changes}${minuteFaults.length ? `, faults: ${minuteFaults.join('; ')}` : ''}`);
    // The probe stalls the wall for a moment on purpose, so its frames are left out of the next minute's gaps.
    if (minute === Math.round(minutes / 2)) { frameCosts.middle = await probeFrame(); await wall.evaluate(() => window.__soakGaps()); }
  }
  clearInterval(mover);
  frameCosts.end = await probeFrame();

  // Memory after the first hour: process memory, phys_footprint (graphics memory included) and JS heap, each on its own.
  const memory = r => r.renderer_mb + r.gpu_mb;
  const verdicts = {};
  for (const [name, value] of Object.entries({ process: memory, footprint: r => Number(r.footprint_total_mb) || 0, outputHeap: r => r.output_heap_mb, studioHeap: r => r.studio_heap_mb })) {
    const v = memoryVerdict(rows.map(r => ({ minute: r.minute, value: value(r) })));
    verdicts[name] = v.judged ? { growth: +(v.growth * 100).toFixed(1) + '%', slope: +(v.slopeGrowth * 100).toFixed(1) + '%', failed: v.failed } : 'not judged (under 100 minutes)';
    if (v.failed) fault(`${name} memory grew after the first hour: ${(v.growth * 100).toFixed(1)}% by the final 30 minutes, ${(v.slopeGrowth * 100).toFixed(1)}% by slope`);
  }
  const growth = rows.length >= 4 ? mean2(rows.slice(-3), memory) / mean2(rows.slice(1, 4), memory) - 1 : null;
  const fpsList = rows.map(r => r.fps);
  summary = { csv: path.relative(root, csvFile), minutes: rows.length, fps: { mean: +(fpsList.reduce((a, b) => a + b, 0) / fpsList.length).toFixed(1), lowest: Math.min(...fpsList) },
    longestFrameMs: Math.max(...rows.map(r => r.longest_frame_ms)), wallCpuMs: rows.at(-1)?.wall_cpu_ms, frameCosts,
    memoryMb: { first: +memory(rows[0]).toFixed(1), last: +memory(rows.at(-1)).toFixed(1), shortRunChange: growth === null ? null : +(growth * 100).toFixed(1) + '%', footprint: [rows[0].footprint_total_mb, rows.at(-1).footprint_total_mb], footprintGpu: [rows[0].footprint_gpu_mb, rows.at(-1).footprint_gpu_mb], verdicts },
    contextLosses: rows.at(-1).context_losses, restarts: rows.at(-1).restarts, mode: fullscreen ? 'full-screen output' : 'check window',
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
