// A measured soak of Perform: the real app, the real service and the real wall window, playing a set built on the
// Perform screen, with Rehearse feeding it the synthetic 128 BPM fixture. Audio is muted.
// Run: npm run test:perform:soak   or, after a build: node scripts/verify-perform-soak.mjs --minutes 2 --out <folder>
// Uses a throwaway user-data folder under work/perform-soak/, deleted afterwards. Writes progress.log and results.json.
//
// Launch error is measured on the wall, for every landing. The wall's report of a landing is caught through a setter on
// __mapStats as it is made, after that frame has been drawn, so its time is the end of the landing frame. The ideal frame
// is the first whose callbacks began at or after the launch's atMs (when the wall reads the clock). A landing's error is
// its frame minus the ideal frame, and its time is the end of that frame minus atMs, so a stall counts in full.
// Pixels confirm it: the stage is read back at 96 x 54 around each launch, for as long as a stall needs, and the error
// by picture is how many frames after the ideal one the zone first shows the new picture for two frames running.
// Every zone of every launch ends as landed, deferred, called off, ended by End show, or unresolved.
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
// A stall is a gap of 250 ms or more between wall frames. None after the first full pass through the set; at most 500 ms in it.
const STALL_MS = 250, FIRST_PASS_LIMIT_MS = 500;
// Reported, not a pass criterion: how a performer's jump to a far-away scene, one beat ahead, lands.
const JUMP_EVERY_MIN = Math.max(2.5, MINUTES / 8);
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

/** Runs in the wall page: frame times, the governor, every launch from the wall's own messages and reports, and lost contexts. */
function installProbe({ boxes, rowOf }) {
  const W = 96, H = 54, CAPTURE_BEFORE = 250, CAPTURE_AFTER = 750, MIN_FRAMES_AFTER = 4;
  const small = new OffscreenCanvas(W, H), reader = small.getContext('2d', { willReadFrequently: true });
  const stage = document.querySelector('canvas');
  const soak = window.__soak = { intervals: new Float32Array(600000), probing: new Uint8Array(600000), over100: [], over50: 0, over50NearLaunch: 0, row: null, zoneLog: [], stalls: [], count: 0, minutes: [], levels: [], levelMs: [0, 0, 0, 0], lost: [], failing: {}, landings: [], outcomes: { landed: 0, deferred: 0, cancelled: 0, endedByShow: 0, unresolved: 0 }, deferred: [], unresolved: [], launches: 0, offsets: {}, made: 0, released: 0, reports: 0, showOn: false, firstPassEndsAt: null, sceneLandings: 0 };
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

  // Each frame's number and the moment its first callback began, which is when the wall reads the clock to land launches.
  const clock = () => performance.timeOrigin + performance.now();
  let frame = 0, frameTs = null;
  const starts = [];
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => raf(ts => {
    if (ts !== frameTs) { frameTs = ts; frame++; starts.push({ n: frame, at: clock() }); if (starts.length > 2400) starts.splice(0, 600); }
    callback(ts);
  });

  // How much of a stall the page's own thread was busy for: little means the wait was outside the page.
  soak.longTasks = [];
  new PerformanceObserver(list => { for (const e of list.getEntries()) { soak.longTasks.push({ start: e.startTime, ms: e.duration }); if (soak.longTasks.length > 4000) soak.longTasks.splice(0, 1000); for (const st of soak.stalls) st.pageBusyMs = Math.round((st.pageBusyMs ?? 0) + Math.max(0, Math.min(st.atMs, e.startTime + e.duration) - Math.max(st.from, e.startTime))); } }).observe({ entryTypes: ['longtask'] });
  const pending = new Map();
  // Every report the wall makes, through a setter, so that two in one frame cannot hide a landing. The wall reports after it has drawn the frame.
  let stats = null, level = -1;
  Object.defineProperty(window, '__mapStats', { configurable: true, get: () => stats, set: s => {
    stats = s;
    soak.reports++;
    if (!s) return;
    if (s.level !== level) { level = s.level; soak.levels.push({ atS: Math.round(performance.now() / 1000), level }); }
    for (const f of s.failing ?? []) soak.failing[`${f.id}: ${f.reason}`] = (soak.failing[`${f.id}: ${f.reason}`] ?? 0) + 1;
    const drawnAt = clock();
    for (const l of s.landed ?? []) {
      const r = pending.get(l.launchId);
      if (!r) continue;
      for (const z of l.zones) if (!r.landed.has(z)) r.landed.set(z, { at: drawnAt, frame, atMs: r.atMs });
      // Which scene is on the wall, so a slow frame can be put down to it.
      const row = r.changes.map(c => rowOf[c.sourceId]).find(v => v !== undefined);
      if (r.scene && l.zones.length && row !== undefined) soak.row = row;
      if (r.scene && !r.counted) { r.counted = true; if (++soak.sceneLandings === soak.firstPassScenes + 1) soak.firstPassEndsAt = performance.now(); }
    }
  } });

  let frames = [], last = null, minuteStart = 0, minuteFrames = 0, wasCapturing = false;
  window.studio.map.onMessage(m => {
    if (m?.type === 'performEnd') { for (const r of [...pending.values()]) settle(r, true); return; }
    // The service also cancels a launch once it has landed, to clear it from the wall. Whatever has not landed by the time it is settled was called off.
    if (m?.type === 'performCancel') { const r = pending.get(m.launchId); if (r) r.cancelled = true; return; }
    if (m?.type !== 'performLaunch') return;
    const l = m.launch, had = pending.get(l.id);
    for (const c of l.changes) if (c.sourceId) soak.offsets[c.sourceId] = c.phaseOffsetBeats;
    if (had) { had.atMs = l.atMs; had.cancelled = false; return; }
    soak.launches++;
    pending.set(l.id, { id: l.id, firstAt: l.atMs, atMs: l.atMs, barMs: l.barMs, landed: new Map(), cancelled: false, scene: l.changes.length > 1, changes: l.changes.map(c => ({ zone: c.zone, kind: c.blend.kind, sourceId: c.sourceId })) });
  });
  const zonePixels = (px, b) => {
    const out = [];
    const x0 = Math.ceil((b.x0 + (b.x1 - b.x0) * .15) * W), x1 = Math.floor((b.x1 - (b.x1 - b.x0) * .15) * W), y0 = Math.ceil((b.y0 + (b.y1 - b.y0) * .15) * H), y1 = Math.floor((b.y1 - (b.y1 - b.y0) * .15) * H);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; out.push(px[i], px[i + 1], px[i + 2]); }
    return out;
  };
  const meanOf = lists => { const sum = new Float32Array(lists[0].length); for (const l of lists) for (let i = 0; i < l.length; i++) sum[i] += l[i]; return sum.map(v => v / lists.length); };
  const gap = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  /** The first frame whose picture of the zone is the new one, or a reason it cannot be told. */
  const firstNewPicture = (r, c, landing, ideal) => {
    const box = boxes[c.zone], all = frames.filter(f => f.px && f.t >= r.atMs - CAPTURE_BEFORE).map(f => ({ ...f, z: zonePixels(f.px, box) }));
    const before = all.filter(f => f.n < ideal), after = all.filter(f => f.n > landing.frame).slice(0, 8); // The frames just after: a moving look soon drifts from its first picture.
    if (before.length < 2 || after.length < 2) return { why: 'too few frames' };
    const pre = meanOf(before.map(f => f.z)), post = meanOf(after.map(f => f.z));
    if (gap(pre, post) < 10) return { why: 'pictures too alike' };
    const over = all.filter(f => f.n >= ideal), looksNew = f => gap(f.z, post) < gap(f.z, pre);
    for (let i = 0; i < over.length - 1; i++) if (looksNew(over[i]) && looksNew(over[i + 1])) return { frames: over[i].n - ideal };
    return { why: 'never clearly the new picture' };
  };
  /** Every zone of every launch ends as landed, deferred, called off, ended by End show, or unresolved. */
  function settle(r, ended = false) {
    pending.delete(r.id);
    for (const c of r.changes) {
      const landing = r.landed.get(c.zone);
      if (!landing) {
        const outcome = ended ? 'endedByShow' : r.cancelled ? 'cancelled' : 'unresolved';
        soak.outcomes[outcome]++;
        if (outcome === 'unresolved') soak.unresolved.push({ id: r.id, zone: c.zone });
        continue;
      }
      const late = landing.at - r.firstAt;
      soak.zoneLog.push({ id: r.id, zone: c.zone, lateMs: Math.round(late), deferred: late > r.barMs / 2 });
      if (late > r.barMs / 2) { soak.outcomes.deferred++; soak.deferred.push({ id: r.id, zone: c.zone, lateMs: Math.round(late) }); continue; }
      soak.outcomes.landed++;
      if (c.kind !== 'cut' || c.sourceId === null) continue;
      // The time it was due when it landed: what is left of a launch can be moved on afterwards.
      const ideal = starts.find(s => s.at >= landing.atMs)?.n ?? landing.frame, seen = firstNewPicture({ atMs: landing.atMs }, c, landing, ideal);
      soak.landings.push({ zone: c.zone, landingFrames: landing.frame - ideal, drawnMs: Math.round(landing.at - landing.atMs), pixelFrames: seen.frames ?? null, why: seen.why ?? null });
    }
  }
  const tick = ts => {
    raf(tick);
    const t = clock();
    if (last !== null) {
      const d = ts - last;
      if (soak.count < soak.intervals.length) { soak.probing[soak.count] = wasCapturing ? 1 : 0; soak.intervals[soak.count++] = d; }
      if (level >= 0) soak.levelMs[level] += d;
      if (d > 50) { soak.over50++; if (wasCapturing) soak.over50NearLaunch++; }
      if (d > 100) soak.over100.push({ atS: Math.round(ts / 1000), ms: Math.round(d), scene: soak.row, nearLaunch: wasCapturing });
      if (d >= 250 && soak.showOn) soak.stalls.push({ atMs: ts, atS: Math.round(ts / 1000), ms: Math.round(d), scene: soak.row, firstPass: soak.firstPassEndsAt === null || ts < soak.firstPassEndsAt, from: ts - d });
    }
    last = ts;
    if (!minuteStart) minuteStart = ts;
    minuteFrames++;
    if (ts - minuteStart >= 60000) { soak.minutes.push(Math.round(minuteFrames * 10000 / (ts - minuteStart)) / 10); minuteStart = ts; minuteFrames = 0; }
    // Kept until enough frames have followed the landing, however long a stall made them.
    let capture = false;
    for (const r of pending.values()) {
      const lastIn = Math.max(0, ...[...r.landed.values()].map(l => l.frame));
      if (t >= r.atMs - CAPTURE_BEFORE && (t <= r.atMs + CAPTURE_AFTER || !r.changes.every(c => r.landed.has(c.zone)) || frame < lastIn + MIN_FRAMES_AFTER)) capture = true;
    }
    wasCapturing = capture;
    // Taken without waiting: a synchronous read-back would itself hold the wall up behind the graphics process.
    if (capture) {
      const entry = { n: frame, t, px: null };
      frames.push(entry);
      createImageBitmap(stage, { resizeWidth: W, resizeHeight: H, resizeQuality: 'low' }).then(bitmap => { reader.drawImage(bitmap, 0, 0); bitmap.close(); entry.px = reader.getImageData(0, 0, W, H).data; }).catch(() => { entry.failed = true; });
    }
    for (const r of [...pending.values()]) {
      const allIn = r.changes.every(c => r.landed.has(c.zone)), lastIn = Math.max(0, ...[...r.landed.values()].map(l => l.frame));
      const picturesIn = !frames.some(f => !f.px && !f.failed);
      if ((allIn && picturesIn && t > r.atMs + CAPTURE_AFTER && frame >= lastIn + MIN_FRAMES_AFTER) || t > r.firstAt + r.barMs * 3) settle(r);
    }
    soak.pending = pending.size;
    if (frames.length) { const keep = Math.min(t - 1200, ...[...pending.values()].map(r => r.atMs - CAPTURE_BEFORE)); while (frames.length && frames[0].t < keep) frames.shift(); }
  };
  raf(tick);
}

/**
 * Runs in the studio page: presses the next scene's row one beat or so before every eighth bar, as an operator would.
 * A cold jump instead presses a scene three rows further on, one beat ahead, with no warning for the wall.
 */
function installScheduler({ scenes, barsPerScene }) {
  const s = window.__schedule = { on: false, row: 0, last: null, presses: 0, lateAndShownWaiting: 0, jumpNext: false, jumps: [] };
  setInterval(() => {
    if (!s.on) return;
    const v = window.__studioTest.perform();
    if (!v.running || !v.controls.ready) return;
    // What the operator's grid is told: a queued look that is not ready shows as Loading on its own cell.
    if (v.launcher.queue.some(l => l.atMs < performance.timeOrigin + performance.now()) && v.waiting.length) s.lateAndShownWaiting++;
    const c = v.clock, beat = c.anchorBeat + (performance.timeOrigin + performance.now() - c.anchorMs) * c.bpm / 60000;
    const every = barsPerScene * 4, target = c.barOffset + Math.ceil((beat - c.barOffset) / every) * every;
    const jump = s.jumpNext;
    if (target === s.last || target - beat > (jump ? 1 : 1.5) || target - beat < .25) return;
    const row = jump ? (s.row + 3) % scenes : s.row;
    document.querySelector(`[data-row="${row}"] .pf-scene`)?.click();
    if (jump) { s.jumpNext = false; s.jumps.push({ row, id: window.__studioTest.perform().launcher.queue.find(l => l.sceneIndex === row)?.id ?? null }); }
    s.last = target; s.presses++; s.row = (row + 1) % scenes;
  }, 25);
}

const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const errors = [], record = { minutes: MINUTES, stage: '1920 x 1080', scenes: SCENES, zones: ZONES, barsPerScene: BARS_PER_SCENE, material: {} };
const note = (where, text) => { errors.push({ where, text: String(text).slice(0, 400), atS: Math.round((Date.now() - began) / 1000) }); void say(`ERROR ${where}: ${String(text).slice(0, 200)}`); };
const began = Date.now();
const mixDir = await fs.mkdtemp(path.join(os.tmpdir(), 'form-field-soak-'));
// So a window behind another still runs at full speed. Both windows must keep drawing while nobody is looking at them.
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`, '--mute-audio', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--enable-precise-memory-info'], env });
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
  const rowOf = await studio.evaluate(() => { const set = window.__studioTest.performSet(), out = {}; set.scenes.forEach((scene, row) => scene.cells.forEach(id => { const source = set.clips.find(c => c.id === id)?.sourceId; if (source && !source.startsWith('video-')) out[source] = row; })); return out; });
  await wall.evaluate(installProbe, { boxes: BOXES, rowOf });
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
  await wall.evaluate(n => { window.__soak.showOn = true; window.__soak.firstPassScenes = n; }, SCENES);
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
  let step = 0, nextStep = .5, nextMemory = 0, nextLog = 0, restarted = false, nextJump = JUMP_EVERY_MIN;
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
    if (!restarted && m >= nextJump && m < RESTART_AT_MIN - .5) { await studio.evaluate(() => { window.__schedule.jumpNext = true; }); nextJump += JUMP_EVERY_MIN; }
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
      const s = await wall.evaluate(() => ({ fps: window.__mapStats?.fps, level: window.__mapStats?.level, launches: window.__soak.launches, landings: window.__soak.landings.length, stalls: window.__soak.stalls.length, deferred: window.__soak.deferred.length, lost: window.__soak.lost.length }));
      await say(`${m.toFixed(1)} min ${JSON.stringify(s)} mem ${JSON.stringify(memory.at(-1))} errors ${errors.length}`);
      nextLog += 1;
    }
    await sleep(500);
  }
  await sampleMemory();
  await studio.evaluate(() => { window.__schedule.on = false; });
  // The last launch is followed to its end, so that every launch pressed is in the count.
  await until(() => wall.evaluate(() => window.__soak.pending === 0), 45000, 'the last launches to settle');

  // ---- The results ----
  const raw = await wall.evaluate(() => { const s = window.__soak; return { intervals: Array.from(s.intervals.subarray(0, s.count)), probing: Array.from(s.probing.subarray(0, s.count)), over100: s.over100, over50: s.over50, over50NearLaunch: s.over50NearLaunch, zoneLog: s.zoneLog, stalls: s.stalls, minutes: s.minutes, levels: s.levels, levelMs: s.levelMs, lost: s.lost, failing: s.failing, landings: s.landings, outcomes: s.outcomes, deferred: s.deferred, unresolved: s.unresolved, launches: s.launches, made: s.made, released: s.released, reports: s.reports, firstPassEndsAt: s.firstPassEndsAt }; });
  const presses = await studio.evaluate(() => window.__schedule.presses);
  const sorted = Float64Array.from(raw.intervals).sort();
  const worst1 = sorted.subarray(Math.floor(sorted.length * .99));
  // 1% low: the average rate of the slowest 1% of frames. Also given without the frames the launch probe reads back.
  const onePercentLow = list => { const s = Float64Array.from(list).sort(), w = s.subarray(Math.floor(s.length * .99)); return round(1000 / (w.reduce((a, b) => a + b, 0) / w.length), 1); };
  const byScene = list => { const out = {}; for (const f of list) { const k = f.scene === null ? 'before the first scene' : `scene ${f.scene + 1}`, e = out[k] ??= { frames: 0, totalMs: 0, maxMs: 0 }; e.frames++; e.totalMs += f.ms; e.maxMs = Math.max(e.maxMs, f.ms); } return out; };
  const unprobed = raw.intervals.filter((_, i) => !raw.probing[i]), unprobedSorted = Float64Array.from(unprobed).sort();
  record.frameRate = { frames: raw.intervals.length, medianFps: round(1000 / quantile(sorted, .5), 1), onePercentLowFps: round(1000 / (worst1.reduce((a, b) => a + b, 0) / worst1.length), 1), longestFrameMs: round(sorted.at(-1), 1), withoutProbeFrames: { frames: unprobed.length, medianFps: round(1000 / quantile(unprobedSorted, .5), 1), onePercentLowFps: onePercentLow(unprobed) }, framesOver50ms: raw.over50, framesOver50msNearALaunch: raw.over50NearLaunch, framesOver100ms: raw.over100.length, over100msByScene: byScene(raw.over100), longFrames: raw.over100, perMinuteFps: raw.minutes };
  const count = list => { const out = {}; for (const v of list) out[v] = (out[v] ?? 0) + 1; return out; };
  const abs = list => list.map(Math.abs).sort((a, b) => a - b), landed = raw.landings, frameErrors = abs(landed.map(l => l.pixelFrames ?? l.landingFrames)), drawn = landed.map(l => l.drawnMs).sort((a, b) => a - b), byPicture = landed.filter(l => l.pixelFrames !== null);
  record.launchError = { howMeasured: 'every landing: frame of the wall report minus the first frame begun at or after atMs, confirmed from wall pixels where the two pictures differ; time is the end of the landing frame minus atMs', cutLandings: landed.length, confirmedByPixels: byPicture.length, notConfirmedByPixels: count(landed.filter(l => l.pixelFrames === null).map(l => l.why)), medianAbsFrames: quantile(frameErrors, .5), p95AbsFrames: quantile(frameErrors, .95), maxAbsFrames: frameErrors.at(-1) ?? null, framesHistogram: count(landed.map(l => l.pixelFrames ?? l.landingFrames)), landingFramesHistogram: count(landed.map(l => l.landingFrames)), medianDrawnMs: quantile(drawn, .5), p95DrawnMs: quantile(drawn, .95), maxDrawnMs: drawn.at(-1) ?? null };
  const firstPass = raw.stalls.filter(s => s.firstPass), later = raw.stalls.filter(s => !s.firstPass);
  record.stalls = { limitAfterFirstPassMs: STALL_MS, firstPassLimitMs: FIRST_PASS_LIMIT_MS, firstPassEnded: raw.firstPassEndsAt !== null, firstPass: { count: firstPass.length, maxMs: firstPass.length ? Math.max(...firstPass.map(s => s.ms)) : 0, list: firstPass.map(s => ({ atS: s.atS, ms: s.ms, scene: s.scene === null ? null : s.scene + 1, pageBusyMs: s.pageBusyMs ?? 0 })) }, afterFirstPass: { count: later.length, maxMs: later.length ? Math.max(...later.map(s => s.ms)) : 0, list: later.map(s => ({ atS: s.atS, ms: s.ms, scene: s.scene === null ? null : s.scene + 1, pageBusyMs: s.pageBusyMs ?? 0 })) } };
  const warm = memory.filter(p => p.min >= WARM_UP_MIN), trend = key => round(slope(warm.filter(p => p[key] !== null).map(p => [p.min, p[key]])));
  const first = warm[0], last = memory.at(-1);
  record.governor = { changes: raw.levels, secondsAtLevel: raw.levelMs.map(v => Math.round(v / 1000)) };
  record.launches = { scenePresses: presses, checksWhileADeferredLookShowedAsWaiting: await studio.evaluate(() => window.__schedule.lateAndShownWaiting), wallLaunches: raw.launches, wallReports: raw.reports, zones: raw.outcomes, deferredLaunches: new Set(raw.deferred.map(d => d.id.replace(':ceiling', ''))).size, maxDeferredLateMs: raw.deferred.length ? Math.max(...raw.deferred.map(d => d.lateMs)) : 0, medianDeferredLateMs: quantile(raw.deferred.map(d => d.lateMs).sort((a, b) => a - b), .5), deferredDetail: raw.deferred, unresolvedDetail: raw.unresolved };
  const jumps = await studio.evaluate(() => window.__schedule.jumps);
  const jumpDetail = jumps.map(j => { const zones = raw.zoneLog.filter(z => j.id !== null && z.id.replace(':ceiling', '') === j.id), late = zones.filter(z => z.deferred); return { row: j.row + 1, zones: zones.length, lateZones: late.length, maxLateMs: late.length ? Math.max(...late.map(z => z.lateMs)) : 0 }; });
  record.coldJumps = { reportedNotAPassCriterion: true, how: 'a scene three rows past the next one, pressed about one beat before the bar', jumps: jumpDetail.length, zones: jumpDetail.reduce((a, j) => a + j.zones, 0), lateZones: jumpDetail.reduce((a, j) => a + j.lateZones, 0), maxLateMs: jumpDetail.length ? Math.max(...jumpDetail.map(j => j.maxLateMs)) : 0, detail: jumpDetail };
  record.contexts = { lost: raw.lost.length, detail: raw.lost.slice(0, 40), instrumentContextsMade: raw.made, givenBackOnPurpose: raw.released };
  record.failingSources = raw.failing;
  record.memoryMB = { warmUpMinutes: WARM_UP_MIN, start: memory[0], afterWarmUp: first, end: last, trendMBPerMinAfterWarmUp: { studio: trend('studio'), wall: trend('wall'), gpu: trend('gpu'), total: trend('total'), studioHeap: trend('studioHeap'), wallHeap: trend('wallHeap') }, samples: memory };
  record.video = { checks: videoChecks, largestOffGrid: Math.max(...videoChecks.map(v => v.off ?? 1)) };
  record.errors = errors;
  const t = record.memoryMB.trendMBPerMinAfterWarmUp;
  record.pass = {
    noErrors: errors.length === 0 && Object.keys(raw.failing).length === 0,
    noLostContexts: raw.lost.length === 0,
    medianLaunchErrorAtMostOneFrame: landed.length > 0 && quantile(frameErrors, .5) <= MAX_MEDIAN_ERROR_FRAMES,
    memoryStable: ['studio', 'wall', 'gpu'].every(k => t[k] <= MAX_TREND_MB_PER_MIN),
    everyLaunchAccountedFor: raw.outcomes.unresolved === 0,
    firstPassStallsWithinLimit: raw.firstPassEndsAt !== null && record.stalls.firstPass.maxMs <= FIRST_PASS_LIMIT_MS,
    noStallsAfterFirstPass: record.stalls.afterFirstPass.count === 0,
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
