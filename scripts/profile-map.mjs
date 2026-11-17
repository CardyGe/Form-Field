// Performance audit for Map: per-process CPU and memory (Electron app metrics) and CPU profiles of the output and
// operator windows, in three situations: heavy mix with the output open, the same show playing on the operator screen
// (output closed), and an idle colour-only show with the output open.
// Run: npx vite build --minify false && node scripts/profile-map.mjs   (an unminified build keeps function names readable)
// Writes work/map-profile/<scenario>-<window>.cpuprofile and work/map-profile/summary.json, and prints a summary.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/map-profile');
const HEAVY = ['prismatic-fold', 'pearl-organism', 'ivory-coral', 'acid-slide'];
const SECONDS = 12, WARMUP = 4;
const sleep = ms => new Promise(r => setTimeout(r, ms));
await fs.mkdir(out, { recursive: true });

/** Self time per function, from a CPU profile, grouped by name and file; plus the share that is idle, GC and program. */
function summarise(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i] ?? 0) / 1000;
    total += dt;
    const f = byId.get(id).callFrame;
    const file = f.url ? f.url.split('/').pop().replace(/-[A-Za-z0-9_-]{8}\.js$/, '.js') : '';
    const key = `${f.functionName || '(anonymous)'}${file ? ` · ${file}:${f.lineNumber + 1}` : ''}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  });
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([fn, ms]) => ({ fn, ms: Math.round(ms), share: +(ms / total * 100).toFixed(1) }));
  const share = name => +(((self.get(name) ?? 0) / total) * 100).toFixed(1);
  return { totalMs: Math.round(total), idle: share('(idle)'), gc: share('(garbage collector)'), program: share('(program)'), top };
}

async function scenario(name, { presets, outputOpen, colourOnly }) {
  const userData = path.join(out, `user-data-${name}`);
  await fs.rm(userData, { recursive: true, force: true });
  await fs.mkdir(userData, { recursive: true });
  const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
  const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
  try {
    const studio = await app.firstWindow();
    await studio.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
    await studio.getByRole('button', { name: 'Map', exact: true }).click();
    const stage = studio.getByLabel('Stage', { exact: true });
    await stage.waitFor();
    await studio.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; });
    const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
    for (let i = 0; i < 8; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
      await studio.mouse.move(...at(0.03 + col * 0.24, 0.05 + row * 0.47)); await studio.mouse.down();
      await studio.mouse.move(...at(0.24 + col * 0.24, 0.47 + row * 0.47), { steps: 4 }); await studio.mouse.up();
      if (!colourOnly) await studio.getByLabel('Plays').selectOption(`preset:${presets[i % 4]}`);
    }
    await studio.getByRole('button', { name: 'Select', exact: true }).click();
    await studio.mouse.click(...at(0.99, 0.99)); // nothing selected: no handles or crosshair
    let output = null;
    if (outputOpen) {
      const opened = app.waitForEvent('window', { timeout: 15000 });
      await studio.getByRole('button', { name: 'Open output' }).click();
      output = await opened;
      await output.waitForURL(/#map-output/);
      if (!colourOnly) await output.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 8, null, { timeout: 30000 });
    }
    await sleep(WARMUP * 1000);

    // Profiles of both windows over the same seconds, and per-process metrics once a second.
    const pages = [['operator', studio], ...(output ? [['output', output]] : [])];
    const sessions = [];
    for (const [label, page] of pages) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
      sessions.push([label, cdp]);
    }
    const metrics = [];
    for (let s = 0; s < SECONDS; s++) {
      await sleep(1000);
      metrics.push(await app.evaluate(({ app }) => app.getAppMetrics().map(m => ({ type: m.type, name: m.name ?? m.serviceName ?? '', pid: m.pid, cpu: m.cpu.percentCPUUsage, memoryMB: Math.round(m.memory.workingSetSize / 1024) }))));
    }
    const profiles = {};
    for (const [label, cdp] of sessions) {
      const { profile } = await cdp.send('Profiler.stop');
      await fs.writeFile(path.join(out, `${name}-${label}.cpuprofile`), JSON.stringify(profile));
      profiles[label] = summarise(profile);
    }
    // Average CPU per process kind over the window; renderer processes told apart by which window they draw.
    const pids = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ pid: w.webContents.getOSProcessId(), url: w.webContents.getURL() })));
    const label = m => m.type === 'Tab' ? (pids.find(p => p.pid === m.pid)?.url.includes('map-output') ? 'output window' : 'operator window') : m.type;
    const cpu = {}, memory = {};
    for (const sample of metrics) for (const m of sample) { const k = label(m); cpu[k] = (cpu[k] ?? 0) + m.cpu / metrics.length; memory[k] = Math.max(memory[k] ?? 0, m.memoryMB); }
    const stats = output ? await output.evaluate(() => window.__mapStats) : null;
    return { cpuPercent: Object.fromEntries(Object.entries(cpu).map(([k, v]) => [k, Math.round(v)])), memoryMB: memory, wall: stats && { fps: stats.fps, level: stats.level, failing: stats.failing.length }, profiles };
  } finally { await app.close().catch(() => {}); }
}

const summary = {
  heavyOutputOpen: await scenario('heavy-output', { presets: HEAVY, outputOpen: true }),
  heavyOperatorOnly: await scenario('heavy-operator', { presets: HEAVY, outputOpen: false }),
  idleColourOnly: await scenario('idle-colour', { presets: HEAVY, outputOpen: true, colourOnly: true }),
};
await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
for (const [name, r] of Object.entries(summary)) {
  console.log(`\n=== ${name}  CPU % ${JSON.stringify(r.cpuPercent)}  memory MB ${JSON.stringify(r.memoryMB)}  wall ${JSON.stringify(r.wall)}`);
  for (const [win, p] of Object.entries(r.profiles)) {
    console.log(`  ${win}: busy ${(100 - p.idle).toFixed(1)} % (gc ${p.gc} %, program ${p.program} %)`);
    for (const t of p.top.filter(t => !t.fn.startsWith('(idle)')).slice(0, 10)) console.log(`    ${String(t.share).padStart(5)} %  ${t.fn}`);
  }
}
