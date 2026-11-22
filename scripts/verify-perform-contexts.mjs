// Real Electron check of Perform's renderer budget on the projector window: 24 instrument sources plus the stage
// (25 graphics contexts) must all stay alive. Chromium keeps 16 by default and silently stops the oldest, which is the
// projector's own stage; the app starts with --max-active-webgl-contexts=32 so that cannot happen.
// Then a short Perform run on the same wall: arm, launch with blends, performance values, and End show.
// Run: npm run build && node scripts/verify-perform-contexts.mjs [--seconds 60]
// Uses a throwaway user-data folder under work/perform-contexts/. Writes work/perform-contexts/results.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/perform-contexts');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const SECONDS = arg('--seconds', 60);
const SOURCES = 24;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const userData = path.join(out, 'user-data');
await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });
const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });

const results = [], errors = [], record = {};
const check = async (name, run) => {
  try { await run(); results.push(`ok    ${name}`); }
  catch (error) { results.push(`FAIL  ${name}\n      ${String(error.message).split('\n')[0]}`); process.exitCode = 1; }
};

// What the studio sends the wall is kept, so the check can build its own show from real messages; and the check can
// send the wall messages of its own, exactly as the studio's would arrive.
await app.evaluate(({ ipcMain }) => { globalThis.__sent = []; ipcMain.on('studio:map:send', (_event, message) => { if (message?.type === 'show' || message?.type === 'source') globalThis.__sent.push(message); }); });
const toWall = messages => app.evaluate(({ BrowserWindow }, list) => {
  const wall = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#map-output'));
  for (const message of list) wall.webContents.send('studio:map:message', message);
}, messages);

try {
  const studio = await app.firstWindow();
  studio.on('pageerror', e => errors.push(`studio: ${e}`));
  await studio.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await studio.getByLabel('Project name', { exact: true }).waitFor();
  await sleep(1500);
  await studio.getByRole('button', { name: 'Map', exact: true }).click();
  const stage = studio.getByLabel('Stage', { exact: true });
  await stage.waitFor();
  await studio.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; });
  const opened = app.waitForEvent('window', { timeout: 15000 });
  await studio.getByRole('button', { name: 'Open output' }).click();
  const wall = await opened;
  wall.on('pageerror', e => errors.push(`wall: ${e}`));
  wall.on('crash', () => errors.push('wall: crashed'));
  await wall.waitForURL(/#map-output/);
  await wall.waitForSelector('canvas');

  // Every canvas the wall makes from now on is an instrument's; a lost graphics context on any of them, or on the
  // stage, is counted. Nothing in this check lets a source go on purpose until the Perform part.
  await wall.evaluate(() => {
    const seen = window.__contexts = { made: 0, lost: [], canvases: [] };
    const watch = (canvas, name) => { seen.canvases.push({ canvas, name }); canvas.addEventListener('webglcontextlost', () => seen.lost.push(`${name} at ${Math.round(performance.now())} ms`)); };
    watch(document.querySelector('canvas'), 'stage');
    const create = document.createElement.bind(document);
    document.createElement = (tag, ...rest) => { const made = create(tag, ...rest); if (String(tag).toLowerCase() === 'canvas') watch(made, `instrument ${++seen.made}`); return made; };
  });
  const wallState = () => wall.evaluate(() => {
    const c = document.querySelector('canvas'), copy = new OffscreenCanvas(96, 54), x = copy.getContext('2d', { willReadFrequently: true });
    x.drawImage(c, 0, 0, 96, 54);
    const d = x.getImageData(0, 0, 96, 54).data; let lit = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; if (v > 30) lit++; sum += v; }
    const s = window.__mapStats ?? {}, seen = window.__contexts;
    // A context that was stopped without its event being heard still says so when asked.
    const dead = seen.canvases.filter(({ canvas }) => { const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl'); return !gl || gl.isContextLost(); }).map(e => e.name);
    return { lit, sum, lost: [...seen.lost], dead, made: seen.made, stageLost: s.contextLost === true, prepared: Object.keys(s.prepares ?? {}).length, failing: s.failing ?? [], fps: s.fps ?? 0, level: s.level ?? 0, armed: s.armed ?? null };
  });

  // One shape playing an instrument, made as Greg would make it; the other 23 are copies of what the studio sent.
  const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
  await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await studio.mouse.move(...at(.02, .03)); await studio.mouse.down(); await studio.mouse.move(...at(.1, .1), { steps: 4 }); await studio.mouse.move(...at(.16, .24), { steps: 4 }); await studio.mouse.up();
  await studio.getByRole('button', { name: 'Select', exact: true }).click();
  const effect = studio.getByRole('tablist', { name: 'Shape panels' }).getByRole('tab', { name: /^Effect$/ });
  if (await effect.count()) await effect.click();
  await studio.evaluate(() => { const d = document.querySelector('details[data-section="effect"]'); if (d && !d.open) d.open = true; });
  await studio.getByRole('button', { name: 'Change look' }).click();
  await studio.locator('[data-look="preset:salt-mandala"]').click();
  await sleep(150);
  await studio.keyboard.press('Escape');
  await studio.locator('.look-browser').waitFor({ state: 'detached', timeout: 2000 }).catch(async () => {
    await studio.getByRole('button', { name: 'Close looks' }).click();
    await studio.locator('.look-browser').waitFor({ state: 'detached' });
  });
  await wall.waitForFunction(() => Object.keys(window.__mapStats?.prepares ?? {}).length === 1, null, { timeout: 15000 });
  await sleep(1500);

  const sent = await app.evaluate(() => globalThis.__sent);
  const baseShow = sent.filter(m => m.type === 'show').at(-1).show;
  const baseShape = baseShow.shapes.find(s => s.sourceId), baseSource = baseShow.sources.find(s => s.id === baseShape.sourceId);
  const baseProject = sent.filter(m => m.type === 'source' && m.id === baseSource.id).at(-1).project;
  const xs = baseShape.points.map(p => p.x), ys = baseShape.points.map(p => p.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  // Six across and four down; the first cell is the shape Greg made, left as it is.
  const cell = i => ({ x: .02 + (i % 6) * .162, y: .03 + Math.floor(i / 6) * .24, w: .14, h: .21 });
  const shapes = [], sources = [], sourceMessages = [];
  for (let i = 0; i < SOURCES; i++) {
    if (i === 0) { shapes.push(baseShape); sources.push(baseSource); continue; }
    const c = cell(i), id = `ctx-source-${i}`;
    shapes.push({ ...baseShape, id: `ctx-shape-${i}`, name: `Context ${i}`, sourceId: id, groupId: null, points: baseShape.points.map(p => ({ x: c.x + (p.x - box.x) / box.w * c.w, y: c.y + (p.y - box.y) / box.h * c.h })) });
    sources.push({ ...baseSource, id, revision: 1 });
    sourceMessages.push({ type: 'source', id, revision: 1, project: baseProject });
  }
  const show = { ...baseShow, shapes, sources, groups: baseShow.groups ?? [], links: [], clipSourceIds: [] };
  await toWall([{ type: 'show', show }, ...sourceMessages]);

  await check(`the wall starts ${SOURCES} instrument sources beside the stage`, async () => {
    await wall.waitForFunction(n => Object.keys(window.__mapStats?.prepares ?? {}).length === n, SOURCES, { timeout: 30000 });
    const s = await wallState();
    assert.equal(s.made, SOURCES, `the wall made ${s.made} instrument canvases`);
  });

  let first, last, worst = { lost: [], dead: [], blackSamples: 0, failing: [], fewest: SOURCES };
  await check(`no graphics context is lost over ${SECONDS} seconds, and the stage still draws`, async () => {
    await sleep(3000);
    first = await wallState();
    const end = Date.now() + SECONDS * 1000;
    let moved = 0, before = first;
    while (Date.now() < end) {
      await sleep(1000);
      last = await wallState();
      if (last.lit === 0) worst.blackSamples++;
      if (last.sum !== before.sum) moved++;
      worst.fewest = Math.min(worst.fewest, last.prepared);
      if (last.failing.length) worst.failing = last.failing;
      before = last;
    }
    worst.lost = last.lost; worst.dead = last.dead;
    record.contexts = { seconds: SECONDS, made: last.made, lost: last.lost, dead: last.dead, stageLost: last.stageLost, blackSamples: worst.blackSamples, movedSamples: moved, failing: worst.failing, fewestSources: worst.fewest, fps: last.fps, level: last.level };
    assert.deepEqual(last.lost, [], `contexts lost: ${last.lost.slice(0, 6).join('; ')}${last.lost.length > 6 ? ` … ${last.lost.length} in all` : ''}`);
    assert.deepEqual(last.dead, [], `contexts no longer alive: ${last.dead.join(', ')}`);
    assert.equal(last.stageLost, false, 'the stage lost its graphics context');
    assert.deepEqual(worst.failing, [], `the wall reports failing sources: ${JSON.stringify(worst.failing).slice(0, 200)}`);
    assert.equal(worst.fewest, SOURCES, `only ${worst.fewest} sources stayed up`);
    assert.equal(worst.blackSamples, 0, `the stage was black in ${worst.blackSamples} samples`);
    assert.ok(last.lit > 500, `the stage is lit in only ${last.lit} of 5184 samples`);
    assert.ok(moved > SECONDS / 2, `the stage picture moved in only ${moved} of ${SECONDS} samples`);
  });

  // ---- Perform on the same wall: the first eight shapes are the eight zones, and the 24 sources are the clips. ----
  const lostBefore = (await wallState()).lost.length;
  const zoneOf = i => ({ shapeIds: [shapes[i].id], sourceId: null, launched: false });
  const src = i => sources[i].id;
  // The studio hears the wall's reports through the app's own checks: what arrives here is what Perform will get.
  await studio.evaluate(() => { window.__wallStates = []; window.studio.map.onState(s => { if (s.landed || s.armed) window.__wallStates.push({ armed: s.armed ?? null, landed: s.landed ?? [] }); }); });
  const landedOf = async id => (await studio.evaluate(() => window.__wallStates)).flatMap(s => s.landed).filter(l => l.launchId === id);
  const armedNow = async () => (await studio.evaluate(() => window.__wallStates)).at(-1)?.armed ?? [];
  const until = async (test, ms, what) => { const end = Date.now() + ms; for (;;) { if (await test()) return; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(50); } };
  const wallNow = () => wall.evaluate(() => performance.timeOrigin + performance.now());
  // Every frame of the wall while sampling is on: how much of the stage is lit, and a small picture of three zones.
  const inset = r => ({ x: r.x + r.w * .1, y: r.y + r.h * .1, w: r.w * .8, h: r.h * .8 });
  await wall.evaluate(zones => {
    const c = document.querySelector('canvas');
    const small = new OffscreenCanvas(48, 27), sx = small.getContext('2d', { willReadFrequently: true });
    const thumbs = zones.map(() => new OffscreenCanvas(16, 12).getContext('2d', { willReadFrequently: true }));
    window.__frames = []; window.__sampling = false;
    const tick = () => {
      requestAnimationFrame(tick);
      if (!window.__sampling) return;
      sx.drawImage(c, 0, 0, 48, 27);
      const d = sx.getImageData(0, 0, 48, 27).data; let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
      const z = zones.map((r, i) => {
        thumbs[i].drawImage(c, r.x * c.width, r.y * c.height, r.w * c.width, r.h * c.height, 0, 0, 16, 12);
        const t = thumbs[i].getImageData(0, 0, 16, 12).data, out = [];
        for (let k = 0; k < t.length; k += 4) out.push(t[k], t[k + 1], t[k + 2]);
        return out;
      });
      window.__frames.push({ at: performance.timeOrigin + performance.now(), lit, z });
    };
    requestAnimationFrame(tick);
  }, [inset(box), inset(cell(1)), inset(cell(2)), inset(cell(3))]);
  const sampling = on => wall.evaluate(on => { window.__sampling = on; if (on) window.__frames = []; }, on);
  const frames = () => wall.evaluate(() => window.__frames.splice(0));
  const mean = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  const level = (f, zone) => mean(f.z[zone]);
  const levelBetween = (list, zone, from, to) => mean(list.filter(f => f.at >= from && f.at <= to).map(f => level(f, zone)));
  const delta = (a, b, zone) => mean(a.z[zone].map((v, i) => Math.abs(v - b.z[zone][i])));
  const channels = (list, zone) => [0, 1, 2].map(c => mean(list.map(f => mean(f.z[zone].filter((_, i) => i % 3 === c)))));
  const picture = async name => { const png = await wall.evaluate(async () => { const c = document.querySelector('canvas'), copy = new OffscreenCanvas(960, 540); copy.getContext('2d').drawImage(c, 0, 0, 960, 540); const bytes = new Uint8Array(await (await copy.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }); await fs.writeFile(path.join(out, name), Buffer.from(png, 'base64')); };
  const cut = { kind: 'cut', durationMs: 0 };
  const change = (zone, sourceId, blend) => ({ zone, sourceId, shapeIds: [shapes[zone].id], blend, phaseOffsetBeats: 0 });
  const valuesOf = (master, zone0 = {}) => ({ type: 'performValues', values: { master, zones: Array.from({ length: 8 }, (_, i) => ({ brightness: 1, hueDeg: 0, speed: 1, ...(i === 0 ? zone0 : {}) })) } });
  record.perform = {};

  await check('Perform starts black, and gives back the renderers Map was using', async () => {
    await toWall([{ type: 'performStart', zones: Array.from({ length: 8 }, (_, i) => zoneOf(i)) }]);
    await sleep(1500);
    const s = await wallState();
    assert.equal(s.lit, 0, `${s.lit} samples are still lit`);
    assert.equal(s.stageLost, false, 'the stage lost its graphics context');
    assert.equal(s.prepared, 0, `${s.prepared} sources still have a renderer`);
  });

  await check('armed looks are made ready without reaching the wall, and the studio is told', async () => {
    await toWall([{ type: 'performArm', sourceIds: [src(8), src(9)] }]);
    await until(async () => { const a = await armedNow(); return a.includes(src(8)) && a.includes(src(9)); }, 15000, 'both armed looks to be ready');
    await sleep(500);
    const s = await wallState();
    assert.equal(s.lit, 0, 'an armed look reached the wall');
    assert.equal(s.prepared, 2, `${s.prepared} sources have a renderer, not the 2 armed`);
  });

  await check('a launch lands on its time: a cut at once, a fade over its own length', async () => {
    await sampling(true);
    const at = await wallNow() + 500;
    await toWall([{ type: 'performLaunch', launch: { id: 'L1', atMs: at, barMs: 2000, changes: [change(0, src(8), cut), change(1, src(9), { kind: 'fade', durationMs: 2000 })] } }]);
    await sleep(3400);
    const list = await frames();
    assert.deepEqual(await landedOf('L1'), [{ launchId: 'L1', zones: [0, 1] }]);
    const first = list.find(f => level(f, 0) > 4);
    assert.ok(first, 'zone 1 never lit');
    record.perform.cutLateMs = Math.round(first.at - at);
    assert.ok(first.at - at > -20 && first.at - at < 80, `the cut showed ${Math.round(first.at - at)} ms from its time`);
    const steady0 = levelBetween(list, 0, at + 2200, at + 2800), steady1 = levelBetween(list, 1, at + 2200, at + 2800);
    assert.ok(level(first, 0) > steady0 * .6, `the cut began at ${level(first, 0).toFixed(1)} of ${steady0.toFixed(1)}`);
    const early = levelBetween(list, 1, at + 400, at + 600) / steady1, late = levelBetween(list, 1, at + 1400, at + 1600) / steady1;
    record.perform.fade = { early: +early.toFixed(2), late: +late.toFixed(2) };
    assert.ok(early > .08 && early < .5 && late > .5 && late < 1.05 && late > early, `a quarter of the way the fade is at ${early.toFixed(2)}, three quarters at ${late.toFixed(2)}`);
    await picture('perform-launched.png');
  });

  await check('a look that is not ready leaves its zone alone, and lands on a later bar once it is', async () => {
    await sampling(true);
    await toWall([{ type: 'performLaunch', launch: { id: 'L2', atMs: await wallNow() + 200, barMs: 1000, changes: [change(2, src(10), cut)] } }]);
    await sleep(1800);
    const list = await frames();
    assert.deepEqual(await landedOf('L2'), [], 'it was reported as landed before it was ready');
    assert.ok(Math.max(...list.map(f => level(f, 2))) < 2, 'the zone changed');
    await toWall([{ type: 'performArm', sourceIds: [src(10)] }]);
    await until(async () => (await landedOf('L2')).length > 0, 15000, 'the launch to land');
    assert.deepEqual(await landedOf('L2'), [{ launchId: 'L2', zones: [2] }]);
    await sleep(300);
    await sampling(true); await sleep(300);
    assert.ok(mean((await frames()).map(f => level(f, 2))) > 4, 'the zone is still dark after landing');
  });

  await check('a Stop in the middle of a blend fades the mix on the wall to black, with no jump', async () => {
    await sampling(true);
    await sleep(600);
    const at = await wallNow() + 300, stop = at + 1000;
    await toWall([
      { type: 'performLaunch', launch: { id: 'L3', atMs: at, barMs: 2000, changes: [change(1, src(8), { kind: 'fade', durationMs: 2000 })] } },
      { type: 'performLaunch', launch: { id: 'L4', atMs: stop, barMs: 2000, changes: [change(1, null, { kind: 'fade', durationMs: 1000 })] } },
    ]);
    await sleep(1300 + 500);
    await picture('perform-stop-mid-blend.png');
    await sleep(1000);
    const list = await frames();
    assert.deepEqual(await landedOf('L3'), [{ launchId: 'L3', zones: [1] }]);
    assert.deepEqual(await landedOf('L4'), [{ launchId: 'L4', zones: [1] }]);
    const deltas = list.slice(1).map((f, i) => ({ at: f.at, d: delta(list[i], f, 1) }));
    const usual = deltas.filter(x => x.at < at - 50).map(x => x.d).sort((a, b) => a - b);
    const p95 = usual[Math.floor(usual.length * .95)] ?? 0;
    const around = t => Math.max(...deltas.filter(x => x.at > t - 40 && x.at < t + 80).map(x => x.d));
    record.perform.jump = { usual: +p95.toFixed(2), atBlend: +around(at).toFixed(2), atStop: +around(stop).toFixed(2), before: +levelBetween(list, 1, stop - 150, stop - 20).toFixed(1), after: +levelBetween(list, 1, stop + 20, stop + 150).toFixed(1) };
    const allowed = Math.max(p95 * 3, 4);
    assert.ok(around(at) <= allowed, `the picture jumped by ${around(at).toFixed(1)} when the blend began (usually ${p95.toFixed(1)} a frame)`);
    assert.ok(around(stop) <= allowed, `the picture jumped by ${around(stop).toFixed(1)} when the Stop landed (usually ${p95.toFixed(1)} a frame)`);
    assert.ok(levelBetween(list, 1, stop - 150, stop - 20) > 4, 'the zone was dark before the Stop');
    const half = levelBetween(list, 1, stop + 450, stop + 550) / levelBetween(list, 1, stop - 150, stop - 20);
    assert.ok(half > .25 && half < .8, `half way through the Stop the zone is at ${half.toFixed(2)} of where it was`);
    assert.ok(levelBetween(list, 1, stop + 1200, stop + 1700) < 1.5, 'the zone did not reach black');
  });

  await check('a dip goes through black at its halfway point', async () => {
    await sampling(true);
    await sleep(500);
    const at = await wallNow() + 300;
    await toWall([{ type: 'performLaunch', launch: { id: 'L5', atMs: at, barMs: 2000, changes: [change(0, src(10), { kind: 'dip', durationMs: 1600 })] } }]);
    await sleep(2600);
    const list = await frames();
    assert.deepEqual(await landedOf('L5'), [{ launchId: 'L5', zones: [0] }]);
    const before = levelBetween(list, 0, at - 400, at - 50), middle = levelBetween(list, 0, at + 760, at + 840), after = levelBetween(list, 0, at + 1800, at + 2200);
    record.perform.dip = { before: +before.toFixed(1), middle: +middle.toFixed(1), after: +after.toFixed(1) };
    assert.ok(middle < before * .15 && after > before * .5, `before ${before.toFixed(1)}, at the middle ${middle.toFixed(1)}, after ${after.toFixed(1)}`);
  });

  await check('a zone launched with the look its shape plays in Map still fades up from black', async () => {
    await toWall([{ type: 'performArm', sourceIds: [src(3)] }]);
    await until(async () => (await armedNow()).includes(src(3)), 15000, 'the armed look to be ready');
    await sampling(true);
    const at = await wallNow() + 300;
    await toWall([{ type: 'performLaunch', launch: { id: 'L6', atMs: at, barMs: 2000, changes: [change(3, src(3), { kind: 'fade', durationMs: 1600 })] } }]);
    await sleep(2600);
    const list = await frames();
    assert.deepEqual(await landedOf('L6'), [{ launchId: 'L6', zones: [3] }]);
    const early = levelBetween(list, 3, at + 350, at + 450) / levelBetween(list, 3, at + 1800, at + 2200);
    record.perform.fadeUp = +early.toFixed(2);
    assert.ok(early > .1 && early < .45, `a quarter of the way up the zone is at ${early.toFixed(2)}`);
  });

  await check('master, brightness and hue change the picture; values out of range are held inside it', async () => {
    const zone = async (ms = 700) => { await sleep(300); await sampling(true); await sleep(ms); return frames(); };
    const plain = await zone();
    await toWall([valuesOf(.5)]);
    const halved = await zone();
    const ratio = mean(halved.map(f => level(f, 0))) / mean(plain.map(f => level(f, 0)));
    assert.ok(ratio > .35 && ratio < .65, `at master 0.5 the zone is at ${ratio.toFixed(2)} of its level`);
    await toWall([valuesOf(1, { brightness: 0 })]);
    const dark = await zone();
    assert.ok(mean(dark.map(f => level(f, 0))) < 1.5 && mean(dark.map(f => level(f, 2))) > 4, 'brightness 0 on zone 1 did not darken it alone');
    await toWall([valuesOf(1, { hueDeg: 120 })]);
    const turned = await zone();
    await picture('perform-hue.png');
    const a = channels(plain, 0), b = channels(turned, 0), spread = Math.max(...a) - Math.min(...a);
    record.perform.hue = { plain: a.map(v => +v.toFixed(1)), turned: b.map(v => +v.toFixed(1)) };
    // A third of a turn moves red to green, green to blue and blue to red.
    const asTurned = Math.hypot(b[0] - a[2], b[1] - a[0], b[2] - a[1]), asPlain = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    assert.ok(spread > 6, `the look is too grey to show a hue turn (channels ${a.map(v => v.toFixed(1)).join(', ')})`);
    assert.ok(asTurned < asPlain, `channels ${a.map(v => v.toFixed(1)).join(', ')} became ${b.map(v => v.toFixed(1)).join(', ')}`);
    await toWall([valuesOf(7, { brightness: 99, hueDeg: 1e9, speed: -5 })]);
    const wild = await zone();
    const s = await wallState();
    assert.ok(s.lit > 0 && !s.stageLost, 'the stage stopped drawing');
    assert.ok(mean(wild.map(f => level(f, 2))) < mean(plain.map(f => level(f, 2))) * 1.3, 'a master above 1 made the wall brighter');
    await toWall([valuesOf(1)]);
  });

  await check('End show hands the wall back to Map without a black frame', async () => {
    await sleep(300);
    await sampling(true);
    await sleep(300);
    await toWall([{ type: 'performEnd' }]);
    await sleep(4000);
    const list = await frames();
    assert.equal(list.filter(f => f.lit === 0).length, 0, 'the wall was black on the way back');
    await wall.waitForFunction(n => Object.keys(window.__mapStats?.prepares ?? {}).length === n, SOURCES, { timeout: 20000 });
    const s = await wallState();
    record.perform.end = { frames: list.length, fewestLit: Math.min(...list.map(f => f.lit)), lit: s.lit };
    assert.equal(s.armed, null, 'the wall still reports armed looks');
    assert.ok(s.lit > 500, `the Map show is lit in only ${s.lit} samples`);
    await picture('perform-ended.png');
  });

  await check('the stage kept its graphics context through the Perform run', async () => {
    const s = await wallState();
    record.perform.released = s.lost.length - lostBefore;
    assert.equal(s.stageLost, false, 'the stage lost its graphics context');
    assert.ok(!s.lost.some(l => l.startsWith('stage')) && !s.dead.includes('stage'), 'the stage context was lost');
    assert.deepEqual(s.failing, [], `the wall reports failing sources: ${JSON.stringify(s.failing).slice(0, 200)}`);
  });
} catch (error) {
  results.push(`FAIL  the check could not finish\n      ${String(error.stack || error).split('\n').slice(0, 3).join(' | ')}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
if (errors.length) { results.push(`FAIL  page errors\n      ${errors.slice(0, 5).join(' | ')}`); process.exitCode = 1; }
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ results, record, errors }, null, 2));
console.log(results.join('\n'));
console.log(JSON.stringify(record));
console.log(process.exitCode ? 'PERFORM CONTEXT CHECK FAILED' : 'PERFORM CONTEXT CHECK PASSED');
