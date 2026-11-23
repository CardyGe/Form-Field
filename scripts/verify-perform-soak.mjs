// A measured soak of Perform: the real app, the real service and the real wall window, playing a set built on the
// Perform screen, with Rehearse feeding it the synthetic 128 BPM fixture. Audio is muted.
// Run: npm run test:perform:soak   or, after a build: node scripts/verify-perform-soak.mjs --minutes 2 --out <folder>
// Uses a throwaway user-data folder under work/perform-soak/, deleted afterwards. Writes progress.log and results.json.
//
// Launch error is measured on the wall, from its own pixels. For every cut, the first animation frame due at or after
// the launch's atMs is the ideal frame. Each frame around it is read back from the stage at 96 x 54 and the zone is
// compared with its picture before and after the launch. The error is how many frames after the ideal frame the zone
// first (and for two frames running) looks like the new picture. Read-back runs only from 250 ms before a launch to
// 750 ms after it, so it does not weigh on the frame rate of the rest of the show.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { writeLongWav } from './make-perform-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const MINUTES = Number(option('--minutes', 30));
const out = path.resolve(option('--out', path.join(root, 'work/perform-soak')));
const work = path.join(root, 'work/perform-soak');
const userData = path.join(work, 'user-data');
const SCENES = 8, ZONES = 8, VIDEO_ZONE = 6, CEILING_ZONE = 7, BARS_PER_SCENE = 8;
// Fixed before the first run. Memory is judged after a warm-up, as a straight-line trend for each process.
const WARM_UP_MIN = Math.min(5, MINUTES * .25), MAX_TREND_MB_PER_MIN = 2, MAX_MEDIAN_ERROR_FRAMES = 1;
const RESTART_AT_MIN = Math.max(MINUTES - 3, MINUTES * .6);
const BOXES = Array.from({ length: ZONES }, (_, i) => { const c = i % 4, r = i >> 2; return { x0: .02 + c * .245, y0: .05 + r * .47, x1: .02 + c * .245 + .225, y1: .05 + r * .47 + .42 }; });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (test, ms, what) => { const end = Date.now() + ms; for (;;) { if (await test()) return; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(60); } };
const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
const round = (v, n = 2) => v === null || v === undefined ? null : +v.toFixed(n);
const slope = points => { // Least squares, in y per x.
  if (points.length < 2) return 0;
  const mx = points.reduce((a, p) => a + p[0], 0) / points.length, my = points.reduce((a, p) => a + p[1], 0) / points.length;
  const under = points.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  return under ? points.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / under : 0;
};

await fs.mkdir(out, { recursive: true });
await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });
const logFile = path.join(out, 'progress.log');
await fs.writeFile(logFile, '');
const say = async line => { const text = `${new Date().toISOString()} ${line}`; console.log(text); await fs.appendFile(logFile, `${text}\n`); };

/** Runs in the wall page: frame times, the governor, every launch from the wall's own messages, and lost contexts. */
function installProbe({ boxes }) {
  const W = 96, H = 54, CAPTURE_BEFORE = 250, CAPTURE_AFTER = 750;
  const small = new OffscreenCanvas(W, H), reader = small.getContext('2d', { willReadFrequently: true });
  const stage = document.querySelector('canvas');
  const soak = window.__soak = { intervals: new Float32Array(600000), probing: new Uint8Array(600000), long: [], stalls: [], skipped: {}, count: 0, minutes: [], levels: [], levelMs: [0, 0, 0, 0], lost: [], failing: {}, samples: [], deferred: [], unlanded: [], launches: 0, offsets: {}, made: 0, released: 0 };
  // A context given back on purpose (a look leaving the wall) is told apart from one the system took away.
  const given = new WeakSet(), wrapped = new WeakSet();
  const hook = proto => {
    const get = proto.getExtension;
    proto.getExtension = function (name) {
      const e = get.call(this, name);
      if (e && name === 'WEBGL_lose_context' && !wrapped.has(e)) {
        wrapped.add(e);
        const canvas = this.canvas, lose = e.loseContext.bind(e);
        e.loseContext = () => { given.add(canvas); soak.released++; lose(); };
      }
      return e;
    };
  };
  hook(WebGLRenderingContext.prototype); hook(WebGL2RenderingContext.prototype);
  const watch = (canvas, name) => canvas.addEventListener('webglcontextlost', () => { if (!given.has(canvas)) soak.lost.push({ name, atS: Math.round(performance.now() / 1000) }); });
  watch(stage, 'stage');
  const create = document.createElement.bind(document);
  window.__videos = [];
  document.createElement = (tag, ...rest) => { const made = create(tag, ...rest), t = String(tag).toLowerCase(); if (t === 'canvas') watch(made, `instrument ${++soak.made}`); if (t === 'video') window.__videos.push(made); return made; };

  const pending = new Map();
  let frames = [], frame = 0, last = null, stats = null, level = -1, minuteStart = 0, minuteFrames = 0, wasCapturing = false, prepared = {}, open = [];
  const recent = [];
  window.studio.map.onMessage(m => {
    if (m?.type === 'performEnd') { pending.clear(); return; }
    // The service also cancels a launch once it has landed, to clear it from the wall: only one that never landed was called off.
    if (m?.type === 'performCancel') { const r = pending.get(m.launchId); if (r && r.landed.size === 0) r.cancelled = true; return; }
    if (m?.type !== 'performLaunch') return;
    const l = m.launch, had = pending.get(l.id);
    for (const c of l.changes) if (c.sourceId) soak.offsets[c.sourceId] = c.phaseOffsetBeats;
    if (had) { had.atMs = l.atMs; had.cancelled = false; return; }
    soak.launches++;
    pending.set(l.id, { id: l.id, firstAt: l.atMs, atMs: l.atMs, barMs: l.barMs, landed: new Map(), cancelled: false, changes: l.changes.map(c => ({ zone: c.zone, kind: c.blend.kind, sourceId: c.sourceId })) });
  });
  const zonePixels = (px, b) => {
    const out = [];
    const x0 = Math.ceil((b.x0 + (b.x1 - b.x0) * .15) * W), x1 = Math.floor((b.x1 - (b.x1 - b.x0) * .15) * W), y0 = Math.ceil((b.y0 + (b.y1 - b.y0) * .15) * H), y1 = Math.floor((b.y1 - (b.y1 - b.y0) * .15) * H);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; out.push(px[i], px[i + 1], px[i + 2]); }
    return out;
  };
  const meanOf = lists => { const sum = new Float32Array(lists[0].length); for (const l of lists) for (let i = 0; i < l.length; i++) sum[i] += l[i]; return sum.map(v => v / lists.length); };
  const gap = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  /** How many frames after the ideal one the zone first shows the new picture, or null if the two pictures are too alike to tell. */
  const measure = (r, c, landedAt) => {
    const ideal = frames.find(f => f.t >= r.atMs);
    if (!ideal) { soak.skipped['no frame at the launch time'] = (soak.skipped['no frame at the launch time'] ?? 0) + 1; return null; }
    // The frames just after a scene lands can be slow, so the two reference pictures use the whole captured window.
    const box = boxes[c.zone], all = frames.filter(f => f.t >= r.atMs - CAPTURE_BEFORE && f.t <= r.atMs + CAPTURE_AFTER).map(f => ({ ...f, z: zonePixels(f.px, box) }));
    const before = all.filter(f => f.t < r.atMs - 8), after = all.filter(f => f.t >= landedAt + 120), over = all.filter(f => f.n >= ideal.n - 1); // One frame early is possible: a frame's timestamp is its start, and the wall reads the clock a moment later.
    if (before.length < 2 || after.length < 2) { const why = `too few frames (${before.length} before, ${after.length} after)`; soak.skipped[why] = (soak.skipped[why] ?? 0) + 1; return null; }
    const pre = meanOf(before.map(f => f.z)), post = meanOf(after.map(f => f.z)), apart = gap(pre, post);
    if (apart < 10) return { unclear: true };
    const looksNew = f => gap(f.z, post) < gap(f.z, pre);
    for (let i = 0; i < over.length - 1; i++) if (looksNew(over[i]) && looksNew(over[i + 1])) return { frames: over[i].n - ideal.n, ms: Math.round(over[i].t - r.atMs), logicFrames: (frames.find(f => f.t >= landedAt)?.n ?? ideal.n) - ideal.n, apart: Math.round(apart) };
    return { unclear: true };
  };
  const tick = ts => {
    requestAnimationFrame(tick);
    const t = performance.timeOrigin + ts;
    frame++;
    if (last !== null) {
      const d = ts - last;
      if (soak.count < soak.intervals.length) { soak.probing[soak.count] = wasCapturing ? 1 : 0; soak.intervals[soak.count++] = d; }
      if (level >= 0) soak.levelMs[level] += d;
      if (d > 50 && soak.long.length < 2000) soak.long.push({ atS: Math.round(ts / 1000), ms: Math.round(d), nearLaunch: wasCapturing });
      // A stall, with the looks that started being prepared just before it or in the next report after it.
      if (d >= 250 && soak.stalls.length < 400) { const stall = { atS: Math.round(ts / 1000), ms: Math.round(d), looks: recent.filter(x => ts - x.ts < 2500).flatMap(x => x.ids), reports: 2 }; soak.stalls.push(stall); open.push(stall); }
    }
    last = ts;
    if (!minuteStart) minuteStart = ts;
    minuteFrames++;
    if (ts - minuteStart >= 60000) { soak.minutes.push(round1(minuteFrames * 1000 / (ts - minuteStart))); minuteStart = ts; minuteFrames = 0; }
    const s = window.__mapStats;
    if (s && s !== stats) {
      stats = s;
      const fresh = Object.entries(s.prepares ?? {}).filter(([id, n]) => n > (prepared[id] ?? 0)).map(([id]) => id);
      prepared = s.prepares ?? {};
      if (fresh.length) { recent.push({ ts, ids: fresh }); while (recent.length > 24) recent.shift(); }
      for (const stall of open) { stall.looks.push(...fresh); stall.reports--; }
      open = open.filter(x => x.reports > 0);
      if (s.level !== level) { level = s.level; soak.levels.push({ atS: Math.round(performance.now() / 1000), level }); }
      for (const f of s.failing ?? []) soak.failing[`${f.id}: ${f.reason}`] = (soak.failing[`${f.id}: ${f.reason}`] ?? 0) + 1;
      for (const l of s.landed ?? []) { const r = pending.get(l.launchId); if (r) for (const z of l.zones) if (!r.landed.has(z)) r.landed.set(z, t); }
    }
    let capture = false;
    for (const r of pending.values()) if (t >= r.atMs - CAPTURE_BEFORE && t <= r.atMs + CAPTURE_AFTER) capture = true;
    wasCapturing = capture;
    if (capture) { reader.drawImage(stage, 0, 0, W, H); frames.push({ n: frame, t, px: reader.getImageData(0, 0, W, H).data }); }
    for (const r of [...pending.values()]) {
      const allIn = r.changes.every(c => r.landed.has(c.zone));
      if (!(allIn && t > r.atMs + CAPTURE_AFTER) && t <= r.firstAt + r.barMs * 3) continue;
      pending.delete(r.id);
      if (r.cancelled) continue;
      for (const c of r.changes) {
        const at = r.landed.get(c.zone);
        if (at === undefined) { soak.unlanded.push({ id: r.id, zone: c.zone }); continue; }
        if (at - r.firstAt > r.barMs / 2) { soak.deferred.push({ id: r.id, zone: c.zone, lateMs: Math.round(at - r.firstAt) }); continue; }
        if (c.kind !== 'cut' || c.sourceId === null) continue;
        const m = measure(r, c, at);
        if (m) soak.samples.push({ zone: c.zone, ...m });
      }
    }
    if (frames.length) { const keep = Math.min(t - 1200, ...[...pending.values()].map(r => r.atMs - CAPTURE_BEFORE)); while (frames.length && frames[0].t < keep) frames.shift(); }
  };
  const round1 = v => Math.round(v * 10) / 10;
  requestAnimationFrame(tick);
}

/** Runs in the studio page: presses the next scene's row one beat or so before every eighth bar, as an operator would. */
function installScheduler({ scenes, barsPerScene }) {
  const s = window.__schedule = { on: false, row: 0, last: null, presses: 0 };
  setInterval(() => {
    if (!s.on) return;
    const v = window.__studioTest.perform();
    if (!v.running || !v.controls.ready) return;
    const c = v.clock, beat = c.anchorBeat + (performance.timeOrigin + performance.now() - c.anchorMs) * c.bpm / 60000;
    const every = barsPerScene * 4, target = c.barOffset + Math.ceil((beat - c.barOffset) / every) * every;
    if (target === s.last || target - beat > 1.5 || target - beat < .25) return;
    document.querySelector(`[data-row="${s.row}"] .pf-scene`)?.click();
    s.last = target; s.presses++; s.row = (s.row + 1) % scenes;
  }, 25);
}

const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const errors = [], record = { minutes: MINUTES, stage: '1920 x 1080', scenes: SCENES, zones: ZONES, barsPerScene: BARS_PER_SCENE, material: {} };
const note = (where, text) => { errors.push({ where, text: String(text).slice(0, 400), atS: Math.round((Date.now() - began) / 1000) }); void say(`ERROR ${where}: ${String(text).slice(0, 200)}`); };
const began = Date.now();
const mixDir = await fs.mkdtemp(path.join(os.tmpdir(), 'form-field-soak-'));
// So a window behind another still runs at full speed. Both windows must keep drawing while nobody is looking at them.
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`, '--mute-audio', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'], env });
let failed = false, closing = false;

try {
  const studio = await app.firstWindow();
  studio.on('pageerror', e => note('studio', e));
  studio.on('console', m => { if (m.type() === 'error') note('studio console', m.text()); });
  studio.on('crash', () => note('studio', 'crashed'));
  await studio.setViewportSize({ width: 1512, height: 982 }).catch(() => {});
  await studio.getByLabel('Project name', { exact: true }).waitFor();
  await sleep(1200);
  const go = async name => { const over = studio.locator('.live-shell'); await ((await over.count()) ? over : studio).getByRole('button', { name, exact: true }).first().click(); };
  const view = () => studio.evaluate(() => window.__studioTest.perform());

  // ---- The room: eight shapes, drawn in Map ----
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
  const closeLooks = async () => { const b = studio.getByRole('button', { name: 'Close looks' }); if (await b.count()) await b.click(); };
  for (let z = 0; z < ZONES; z++) {
    await studio.getByRole('button', { name: `Choose the place for zone ${z + 1}` }).click();
    await studio.getByRole('menuitem', { name: `Shape ${z + 1}`, exact: true }).click();
  }
  for (let r = 0; r < SCENES; r++) await studio.getByRole('button', { name: 'Add scene' }).click();
  await studio.locator(`[data-cell="${SCENES - 1}-0"]`).waitFor();
  await studio.evaluate(() => document.querySelector('[data-cell="0-0"]').click());
  await studio.locator('[data-pf-look^="preset:"]').first().waitFor();
  const presets = await studio.evaluate(() => [...document.querySelectorAll('[data-pf-look^="preset:"]')].map(b => b.dataset.pfLook));
  const place = async (row, zone, look) => {
    await studio.evaluate(([r, z]) => document.querySelector(`[data-cell="${r}-${z}"]`).click(), [row, zone]);
    await studio.locator(`[data-pf-look="${look}"]`).waitFor();
    await studio.evaluate(l => document.querySelector(`[data-pf-look="${l}"]`).click(), look);
    await studio.locator(`[data-cell="${row}-${zone}"][data-filled="true"]`).waitFor({ timeout: 4000 });
  };
  // A different look in each cell of the six room zones, stepping through the whole list so every kind of instrument is in.
  const used = [];
  let pick = 0;
  const nextLook = () => { const look = presets[(pick++ * 7) % presets.length]; used.push(look); return look; };
  for (let r = 0; r < SCENES; r++) for (let z = 0; z < 6; z++) await place(r, z, nextLook());
  for (let r = 0; r < SCENES; r += 2) await place(r, CEILING_ZONE, nextLook());
  await closeLooks();
  const chooseIn = async (row, zone, name) => { await cell(row, zone).click({ button: 'right' }); await studio.getByRole('menuitemradio', { name, exact: true }).click(); };
  for (let r = 0; r < SCENES; r += 2) {
    await chooseIn(r, CEILING_ZONE, 'Dissolve 8');
    await studio.locator(`[data-row="${r}"] .pf-scene`).click({ button: 'right' });
    await studio.locator('[role^="menuitem"]', { hasText: 'Include ceiling' }).click();
  }
  // The locked video: a 2 s clip as a 4-beat loop, the same clip in every scene, so it plays through every scene change.
  const clip = path.join(work, 'soak-loop.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '5', '-movflags', '+faststart', clip]);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, clip);
  await place(0, VIDEO_ZONE, 'video');
  await closeLooks();
  await chooseIn(0, VIDEO_ZONE, '4 beats');
  for (let r = 1; r < SCENES; r++) { await cell(0, VIDEO_ZONE).dragTo(cell(r, VIDEO_ZONE)); await studio.locator(`[data-cell="${r}-${VIDEO_ZONE}"][data-filled="true"]`).waitFor({ timeout: 3000 }); }
  const built = await studio.evaluate(() => { const s = window.__studioTest.performSet(); return { clips: s.clips.length, live: s.clips.filter(c => c.name === 'Live').length, videoId: s.clips.find(c => c.sourceId.startsWith('video-'))?.sourceId, videos: s.clips.filter(c => c.sourceId.startsWith('video-')).length, ceilingRows: s.scenes.filter(x => x.includeProtected).length, dissolves: s.clips.filter(c => c.blend?.kind === 'dissolve').length }; });
  record.material = { ...built, instrumentKinds: new Set(used.map(l => l.split(':')[1])).size };
  await say(`set built: ${JSON.stringify(record.material)}`);
  if (built.live !== 0 || built.videos !== 1 || built.ceilingRows !== 4 || built.dissolves !== 4) throw new Error(`the set is not the one intended: ${JSON.stringify(built)}`);

  // ---- The wall and the mix ----
  const opened = app.waitForEvent('window', { timeout: 15000 });
  await studio.getByRole('button', { name: 'Open projector' }).click();
  const wall = await opened;
  await wall.waitForURL(/#map-output/);
  await wall.waitForSelector('canvas');
  wall.on('pageerror', e => note('wall', e));
  wall.on('console', m => { if (m.type() === 'error') note('wall console', m.text()); });
  wall.on('crash', () => note('wall', 'crashed'));
  wall.on('close', () => { if (!closing) note('wall', 'the wall window closed'); });
  await studio.getByRole('button', { name: 'Close projector' }).waitFor({ timeout: 10000 });
  await wall.evaluate(installProbe, { boxes: BOXES });
  await studio.evaluate(installScheduler, { scenes: SCENES, barsPerScene: BARS_PER_SCENE });

  const mix = path.join(mixDir, 'soak-mix.wav');
  await writeLongWav(mix, MINUTES + 6);
  await studio.locator('input[aria-label="Rehearsal file"]').setInputFiles(mix);
  await until(async () => (await studio.evaluate(() => window.__studioTest.react.audio())).label === 'Rehearsal', 30000, 'the mix to play');

  const control = e => studio.evaluate(x => window.__studioTest.performControl(x), e);
  const startShow = async () => {
    await studio.getByRole('button', { name: 'Start show' }).click();
    await studio.getByRole('button', { name: 'End show' }).waitFor({ timeout: 5000 });
    await until(async () => { const c = (await view()).clock; return c.state === 'locked' && Math.abs(c.bpm - 128) <= 1; }, 30000, 'the clock to lock at 128');
    await studio.getByRole('button', { name: 'Send All' }).click();
    await until(async () => (await view()).controls.ready, 2000, 'Send All');
    for (let z = 0; z < ZONES; z++) await control({ kind: 'fader', strip: z, value: 1 });
    await control({ kind: 'master', value: 1 });
    await studio.evaluate(() => { const s = window.__schedule; s.row = 0; s.last = null; s.on = true; });
  };
  await startShow();
  await until(async () => (await view()).launcher.sceneIndex === 0, 40000, 'the first scene to land');
  await say('first scene landed');

  // ---- The run ----
  const t0 = Date.now(), minutesIn = () => (Date.now() - t0) / 60000;
  const memory = [], videoChecks = [];
  const sampleMemory = async () => {
    const m = await app.evaluate(({ app: a, BrowserWindow }) => {
      const pidOf = test => BrowserWindow.getAllWindows().find(w => test(w.webContents.getURL()))?.webContents.getOSProcessId();
      const wallPid = pidOf(u => u.includes('#map-output')), studioPid = pidOf(u => !u.includes('#map-output'));
      const list = a.getAppMetrics(), mb = p => p ? Math.round(p.memory.workingSetSize / 1024) : null;
      return { studio: mb(list.find(p => p.pid === studioPid)), wall: mb(list.find(p => p.pid === wallPid)), gpu: mb(list.find(p => p.type === 'GPU')), total: Math.round(list.reduce((s, p) => s + p.memory.workingSetSize, 0) / 1024) };
    });
    const heap = page => page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576)).catch(() => null);
    memory.push({ min: round(minutesIn()), ...m, studioHeap: await heap(studio), wallHeap: await heap(wall) });
  };
  /** The video's playback, and how far it is from where the beat says a locked loop should be (0 to 0.5 of a loop). */
  const checkVideo = async pace => {
    const c = (await view()).clock;
    const r = await wall.evaluate(({ c, id, pace }) => {
      const v = window.__videos.filter(x => x.currentSrc).at(-1);
      if (!v) return null;
      const now = performance.timeOrigin + performance.now(), beat = c.anchorBeat + (now - c.anchorMs) * c.bpm / 60000, offset = window.__soak.offsets[id] ?? 0;
      const want = (((beat - offset) * pace / 4) % 1 + 1) % 1, d = Math.abs(v.currentTime / v.duration - want);
      return { rate: +v.playbackRate.toFixed(3), off: +Math.min(d, 1 - d).toFixed(3), paused: v.paused };
    }, { c, id: built.videoId, pace });
    videoChecks.push({ min: round(minutesIn()), pace, ...r });
  };
  const SPEEDS = [{ knob: 1, pace: 2 }, { knob: .5, pace: 1 }, { knob: 0, pace: .5 }, { knob: .5, pace: 1 }];
  let step = 0, nextStep = .5, nextMemory = 0, nextLog = 0, restarted = false;
  while (minutesIn() < MINUTES) {
    const m = minutesIn();
    if (m >= nextMemory) { await sampleMemory(); nextMemory += 1 / 3; }
    if (!restarted && m >= nextStep && m < RESTART_AT_MIN - .25) {
      const s = SPEEDS[step++ % SPEEDS.length];
      await control({ kind: 'knob', strip: VIDEO_ZONE, knob: 0, value: s.knob });
      await sleep(1400);
      await checkVideo(s.pace);
      nextStep += .5;
    }
    if (!restarted && m >= RESTART_AT_MIN) {
      restarted = true;
      // End show with the locked loop at 2x, then a fresh Start show.
      await studio.evaluate(() => { window.__schedule.on = false; });
      await until(async () => (await view()).launcher.queue.length === 0, 20000, 'the queue to empty before End show');
      await control({ kind: 'knob', strip: VIDEO_ZONE, knob: 0, value: 1 });
      await sleep(2500);
      await checkVideo(2);
      const before = videoChecks.at(-1);
      await studio.getByRole('button', { name: 'End show' }).click();
      await studio.getByRole('button', { name: 'End show now' }).click();
      await until(async () => !(await view()).running, 3000, 'the show to end');
      await sleep(6000);
      const litAfterEnd = await wall.evaluate(() => { const c = document.querySelector('canvas'), o = new OffscreenCanvas(96, 54), x = o.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0, 96, 54); const d = x.getImageData(0, 0, 96, 54).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) n++; return n / (96 * 54); });
      await startShow();
      await until(async () => (await view()).launcher.sceneIndex === 0, 40000, 'the first scene to land after the fresh Start show');
      await sleep(2500);
      await checkVideo(1);
      record.restart = { atMin: round(RESTART_AT_MIN), videoAt2xBeforeEnd: before, litShareAfterEnd: round(litAfterEnd, 3), videoAfterFreshStart: videoChecks.at(-1) };
      await say(`End show at 2x and fresh Start show done: ${JSON.stringify(record.restart)}`);
    }
    if (m >= nextLog) {
      const s = await wall.evaluate(() => ({ fps: window.__mapStats?.fps, level: window.__mapStats?.level, launches: window.__soak.launches, samples: window.__soak.samples.length, deferred: window.__soak.deferred.length, lost: window.__soak.lost.length }));
      await say(`${m.toFixed(1)} min ${JSON.stringify(s)} mem ${JSON.stringify(memory.at(-1))} errors ${errors.length}`);
      nextLog += 1;
    }
    await sleep(500);
  }
  await sampleMemory();
  await studio.evaluate(() => { window.__schedule.on = false; });

  // ---- The results ----
  const raw = await wall.evaluate(() => { const s = window.__soak; return { intervals: Array.from(s.intervals.subarray(0, s.count)), probing: Array.from(s.probing.subarray(0, s.count)), long: s.long, stalls: s.stalls, skipped: s.skipped, minutes: s.minutes, levels: s.levels, levelMs: s.levelMs, lost: s.lost, failing: s.failing, samples: s.samples, deferred: s.deferred, unlanded: s.unlanded, launches: s.launches, made: s.made, released: s.released }; });
  const presses = await studio.evaluate(() => window.__schedule.presses);
  const sorted = Float64Array.from(raw.intervals).sort();
  const worst1 = sorted.subarray(Math.floor(sorted.length * .99));
  const measured = raw.samples.filter(s => !s.unclear), errorsSorted = measured.map(s => Math.abs(s.frames)).sort((a, b) => a - b), msSorted = measured.map(s => s.ms).sort((a, b) => a - b);
  const histogram = {};
  for (const s of measured) histogram[s.frames] = (histogram[s.frames] ?? 0) + 1;
  const warm = memory.filter(p => p.min >= WARM_UP_MIN), trend = key => round(slope(warm.filter(p => p[key] !== null).map(p => [p.min, p[key]])));
  const first = warm[0], last = memory.at(-1);
  // 1% low: the average rate of the slowest 1% of frames. Also given without the frames the launch probe reads back.
  const onePercentLow = list => { const s = Float64Array.from(list).sort(), w = s.subarray(Math.floor(s.length * .99)); return round(1000 / (w.reduce((a, b) => a + b, 0) / w.length), 1); };
  const unprobed = raw.intervals.filter((_, i) => !raw.probing[i]), unprobedSorted = Float64Array.from(unprobed).sort();
  const longNear = raw.long.filter(l => l.nearLaunch).length;
  record.frameRate = { frames: raw.intervals.length, medianFps: round(1000 / quantile(sorted, .5), 1), onePercentLowFps: round(1000 / (worst1.reduce((a, b) => a + b, 0) / worst1.length), 1), longestFrameMs: round(sorted.at(-1), 1), withoutProbeFrames: { frames: unprobed.length, medianFps: round(1000 / quantile(unprobedSorted, .5), 1), onePercentLowFps: onePercentLow(unprobed) }, framesOver50ms: raw.long.length, framesOver50msNearALaunch: longNear, longFrames: raw.long.slice(0, 200), perMinuteFps: raw.minutes };
  record.launchError = { howMeasured: 'wall pixels at 96 x 54, first frame showing the new picture against the first frame due at or after atMs', cutZoneLandings: raw.samples.length, measured: measured.length, tooAlikeToMeasure: raw.samples.length - measured.length, medianAbsFrames: quantile(errorsSorted, .5), p95AbsFrames: quantile(errorsSorted, .95), maxAbsFrames: errorsSorted.at(-1) ?? null, medianMs: quantile(msSorted, .5), p95Ms: quantile(msSorted, .95), framesHistogram: histogram };
  record.launchError.skipped = raw.skipped;
  const names = await studio.evaluate(() => Object.fromEntries(window.__studioTest.performSet().clips.map(c => [c.sourceId, c.name])));
  record.stalls = raw.stalls.map(s => ({ atS: s.atS, ms: s.ms, looks: [...new Set(s.looks)].map(id => names[id] ?? id) }));
  record.governor = { changes: raw.levels, secondsAtLevel: raw.levelMs.map(v => Math.round(v / 1000)) };
  record.launches = { scenePresses: presses, wallLaunches: raw.launches, deferred: raw.deferred.length, deferredDetail: raw.deferred.slice(0, 40), neverLanded: raw.unlanded.length, neverLandedDetail: raw.unlanded.slice(0, 40) };
  record.contexts = { lost: raw.lost.length, detail: raw.lost.slice(0, 40), instrumentContextsMade: raw.made, givenBackOnPurpose: raw.released };
  record.failingSources = raw.failing;
  record.memoryMB = { warmUpMinutes: WARM_UP_MIN, start: memory[0], afterWarmUp: first, end: last, trendMBPerMinAfterWarmUp: { studio: trend('studio'), wall: trend('wall'), gpu: trend('gpu'), total: trend('total'), studioHeap: trend('studioHeap'), wallHeap: trend('wallHeap') }, samples: memory };
  record.video = { checks: videoChecks, largestOffGrid: Math.max(...videoChecks.map(v => v.off ?? 1)) };
  record.errors = errors;
  const t = record.memoryMB.trendMBPerMinAfterWarmUp;
  record.pass = {
    noErrors: errors.length === 0 && Object.keys(raw.failing).length === 0,
    noLostContexts: raw.lost.length === 0,
    medianLaunchErrorAtMostOneFrame: measured.length > 0 && quantile(errorsSorted, .5) <= MAX_MEDIAN_ERROR_FRAMES,
    memoryStable: ['studio', 'wall', 'gpu'].every(k => t[k] <= MAX_TREND_MB_PER_MIN),
    everyLaunchLanded: raw.unlanded.length === 0,
  };
  failed = Object.values(record.pass).some(v => !v);
} catch (error) {
  failed = true;
  record.stopped = String(error.stack || error).split('\n').slice(0, 4).join(' | ');
  record.errors = errors;
  await say(`STOPPED ${record.stopped}`);
} finally {
  closing = true;
  await app.close().catch(() => {});
  await fs.rm(mixDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(userData, { recursive: true, force: true }).catch(() => {});
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(record, null, 1));
  const { memoryMB, ...brief } = record;
  await say(JSON.stringify({ ...brief, frameRate: brief.frameRate && { ...brief.frameRate, perMinuteFps: undefined, longFrames: undefined }, video: brief.video && { largestOffGrid: brief.video.largestOffGrid }, memory: memoryMB && { start: memoryMB.start, end: memoryMB.end, trend: memoryMB.trendMBPerMinAfterWarmUp } }));
  await say(failed ? 'PERFORM SOAK FAILED' : 'PERFORM SOAK PASSED');
  process.exitCode = failed ? 1 : 0;
}
