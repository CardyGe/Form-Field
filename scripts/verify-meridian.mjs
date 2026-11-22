// Real Electron/WebGL checks for the Meridian renderer. Saves stills and a contact sheet to work/meridian/.
// Run: node scripts/verify-meridian.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/meridian');
const stage = path.join(out, 'stage');
await fs.mkdir(stage, { recursive: true });
await build({ stdin: { contents: `export * as THREE from 'three';
export {StudioRenderer} from './src/rendering/StudioRenderer';
export {MeridianRenderer} from './src/rendering/MeridianRenderer';
export {createProject,createLayer} from './src/core/project';
export {frameCount,phaseAtFrame} from './src/core/timeline';
export {compose} from './src/meridian/composer';
export {DisplayList} from './src/meridian/display-list';
export {MERIDIAN_DEFAULTS,MERIDIAN_PARAMETERS} from './src/meridian/parameters';
export {PRIMITIVE} from './src/meridian/types';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(stage, 'renderer.js'), logLevel: 'silent' });
await fs.writeFile(path.join(stage, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas width="960" height="540"></canvas>');
await fs.writeFile(path.join(stage, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(stage, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(stage, 'index.html'))});});`);

const SEEDS = [1, 2, 3, 4, 5, 6];
// State index and how far through it the still is taken.
const STATES = { seed: [0, .6], draw: [1, .75], build: [2, .85], charge: [3, .6], peak: [4, .4], collapse: [5, .5], rest: [6, .5] };
const SHEET = ['draw', 'build', 'peak', 'collapse'];
const CHECKED = ['seed', 'build', 'peak', 'rest'];
const SWEPT_GROUPS = ['Score', 'Structure', 'Rings', 'Spokes', 'Nodes', 'Hero', 'Rhythm', 'Glitch', 'Light', 'Colour', 'Output', 'Safety', 'Reaction', 'Performance'];
// The dead-parameter check: every Meridian parameter must change the picture, or be named in one of these lists.
// PENDING and AWAITING_CONDUCTOR must both be empty by Task 11.
const PENDING = {
  Rhythm: ['rhythmRingHits', 'rhythmRingSteps', 'rhythmSpokeHits', 'rhythmSpokeSteps', 'rhythmNodeHits', 'rhythmNodeSteps', 'rhythmRotation', 'rhythmSwing', 'rhythmSubdivisionRamp', 'rhythmPolyrhythm', 'rhythmAccent', 'rhythmHumanise', 'rhythmPeakRate'],
  Reaction: ['reactionBass', 'reactionMids', 'reactionHighs', 'reactionBeat', 'reactionAttack', 'reactionRelease', 'reactionTempoMultiplier', 'reactionBeatSnap'],
  Safety: ['safetyFlashGuard', 'safetyMaxFlashes', 'safetyRedLimit', 'safetyFullField'],
  Structure: ['structureSquareMix', 'structureNegativeSpace'],
};
const AWAITING_CONDUCTOR = ['moveNext', 'moveHold', 'moveDrop', 'moveCollapse', 'moveMutate', 'moveReseed', 'moveBurst', 'moveRecall', 'scoreQuantise', 'scoreAutopilot'];
// These act on the layer rather than the frame; tests/meridian-panel.test.ts proves what they do.
const PROVEN_BY_PANEL_TESTS = ['scoreVariation', ...Array.from({ length: 8 }, (_, i) => `seedSlot${i}`)];
// These act only on top of another setting, so the sweep turns that setting on first rather than skipping them.
const SWEEP_NEEDS = {
  ringDashGap: { ringDashCount: 24 },       // There is no gap until a ring is cut into dashes.
  spokeTwinGap: { spokeTwinShare: 1 },      // Needs twin spokes; not every seed composes them.
  nodeChasePattern: { nodeChaseSpeed: 2 },  // A pattern only shows while the chase is moving.
  lightTrailLength: { lightAfterglow: 1 },  // Trails are drawn by the afterglow.
  lightAfterglow: { lightTrailLength: 1 },
  glitchPosterise: { glitchAmount: 2 },     // Bands of flat colour need a tear strong enough to cover lit structure.
};
// Parameters that cannot be shown to change pixels in this sweep. Each needs a reason.
const SWEEP_SKIPS = Object.fromEntries([...Object.values(PENDING).flat(), ...AWAITING_CONDUCTOR, ...PROVEN_BY_PANEL_TESTS].map(key => [key, true]));

/** The control surface in the real app: groups, search, keys, a macro on the picture, and the minimum window width. */
async function verifySurface(real, ui, qa, failures) {
  const size = async (width, height) => { await real.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]); await ui.waitForTimeout(400); };
  const blur = () => ui.evaluate(() => document.activeElement?.blur());
  const seedShown = async () => Number(await ui.locator('.m-heading small').first().textContent());
  const held = () => ui.locator('.m-pad.is-down').allTextContents();
  const result = {};
  await size(1600, 1000);
  result.groups = await ui.locator('.m-group').count();
  if (result.groups !== 13) failures.push(`the panel shows ${result.groups} of 13 groups`);

  const search = ui.getByRole('searchbox', { name: 'Search parameters' });
  await search.fill('failing screen');
  result.searchGroups = await ui.locator('.m-group').count();
  if (result.searchGroups !== 1 || !(await ui.getByText('Scan bands', { exact: true }).count())) failures.push('search did not find Scan bands by its description');
  await search.press('n');
  if ((await held()).length) failures.push('a move fired while typing in search');
  await search.fill('');

  await blur();
  await ui.keyboard.down('h');
  await ui.waitForTimeout(60);
  const holding = await held();
  await ui.keyboard.up('h');
  await ui.waitForTimeout(60);
  if (!holding.some(text => text.startsWith('Hold')) || (await held()).length) failures.push(`Hold did not press and release (${holding.join()})`);
  // A press is not an edit: the project does not change, so nothing prepares, pauses or autosaves.
  const status = ui.locator('.project-title [role=status]');
  await ui.waitForFunction(() => document.querySelector('.project-title [role=status]')?.textContent === 'Autosaved');
  const savedBefore = JSON.stringify(await ui.evaluate(() => window.studio.loadAutosave()));
  const statuses = new Set();
  await ui.keyboard.down('n');
  for (let i = 0; i < 6; i++) { statuses.add(await status.textContent()); await ui.waitForTimeout(20); }
  await ui.keyboard.up('n');
  for (let i = 0; i < 45; i++) { statuses.add(await status.textContent()); await ui.waitForTimeout(20); }
  const savedAfter = JSON.stringify(await ui.evaluate(() => window.studio.loadAutosave()));
  result.pressIsNotAnEdit = statuses.size === 1 && statuses.has('Autosaved') && savedBefore === savedAfter;
  if (!result.pressIsNotAnEdit) failures.push(`a move press changed the project (status: ${[...statuses].join(', ')})`);

  // Keys let go by physical key, whatever Shift or Cmd did meanwhile.
  await ui.keyboard.down('KeyH');
  await ui.keyboard.down('Meta');
  await ui.waitForTimeout(40);
  const afterMeta = await held();
  await ui.keyboard.up('Meta');
  await ui.keyboard.up('KeyH');
  if (afterMeta.length) failures.push('Hold stayed down after Cmd');

  await ui.getByRole('button', { name: 'Store seed in slot 1' }).click();
  await blur();
  const stored = await seedShown();
  await ui.keyboard.press('r');
  await ui.waitForTimeout(60);
  const reseeded = await seedShown();
  await ui.keyboard.press('1');
  await ui.waitForTimeout(60);
  const recalled = await seedShown();
  result.keys = { reseedChanged: reseeded !== stored, recallRestored: recalled === stored };
  if (reseeded === stored) failures.push('R did not change the seed');
  if (recalled !== stored) failures.push('1 did not recall the stored seed');

  await ui.keyboard.down('Digit1');
  await ui.waitForTimeout(40);
  const slotDown = await ui.locator('.m-slot.is-down').count();
  await ui.keyboard.down('Shift');
  await ui.keyboard.up('Digit1');
  await ui.keyboard.up('Shift');
  await ui.waitForTimeout(40);
  result.shiftRelease = slotDown === 1 && await ui.locator('.m-slot.is-down').count() === 0;
  if (!result.shiftRelease) failures.push('Recall 1 stuck after Shift changed its character');

  // Double-click on a label resets a choice and the seed.
  await ui.getByRole('button', { name: /^Score/ }).click();
  await ui.getByLabel('Meridian seed').fill('77');
  await ui.getByLabel('Meridian seed').press('Enter');
  await ui.locator('.m-seed span').dblclick();
  const seedReset = await ui.getByLabel('Meridian seed').inputValue();
  await ui.getByRole('button', { name: /^Rings/ }).click();
  const drawOn = ui.getByRole('combobox', { name: 'Draw-on style' });
  await drawOn.selectOption('2');
  await ui.locator('.stacked-label', { has: drawOn }).locator('span').dblclick();
  const choiceReset = await drawOn.inputValue();
  result.labelReset = seedReset === '1729' && choiceReset === '0';
  if (!result.labelReset) failures.push(`double-click reset failed (seed ${seedReset}, choice ${choiceReset})`);
  await ui.getByRole('button', { name: /^Rings/ }).click();
  await ui.getByRole('button', { name: /^Score/ }).click();
  await blur();

  await ui.getByRole('button', { name: 'Pause', exact: true }).click();
  await ui.getByRole('slider', { name: 'Timeline position' }).fill('0.55');
  await ui.waitForTimeout(400);
  const preview = ui.locator('.preview-stage canvas').first();
  const before = await preview.screenshot(), still = await preview.screenshot();
  const scale = ui.getByRole('slider', { name: 'Scale', exact: true });
  await scale.scrollIntoViewIfNeeded();
  const box = await scale.boundingBox();
  await ui.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ui.mouse.down();
  await ui.mouse.move(box.x + box.width / 2, box.y - 4, { steps: 6 });
  await ui.mouse.up();
  await ui.waitForTimeout(400);
  const after = await preview.screenshot();
  const [noise, moved] = await qa.evaluate(async ([a, b, c]) => {
    const pixels = async bytes => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' })), canvas = new OffscreenCanvas(320, 180), paint = canvas.getContext('2d', { willReadFrequently: true }); paint.drawImage(bitmap, 0, 0, 320, 180); return paint.getImageData(0, 0, 320, 180).data; };
    const apart = (x, y) => { let sum = 0; for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]); return sum / x.length; };
    const [one, two, three] = await Promise.all([pixels(a), pixels(b), pixels(c)]);
    return [apart(one, two), apart(one, three)];
  }, [Array.from(before), Array.from(still), Array.from(after)]);
  result.macro = { noise: +noise.toFixed(3), moved: +moved.toFixed(3) };
  if (!(moved > .2 && moved > noise * 3)) failures.push(`the Scale macro barely changes the picture (${moved.toFixed(3)} against ${noise.toFixed(3)})`);
  await scale.dblclick();
  // The morph slider keeps its place when the panel is rebuilt.
  await ui.getByRole('button', { name: 'Capture A' }).click();
  await ui.getByRole('slider', { name: 'Scale', exact: true }).focus();
  for (let i = 0; i < 20; i++) await ui.keyboard.press('ArrowUp');
  await ui.getByRole('button', { name: 'Capture B' }).click();
  const morphSlider = ui.getByRole('slider', { name: 'Morph between A and B' });
  await morphSlider.fill('0.7');
  await ui.getByRole('button', { name: 'Motion', exact: true }).click();
  await ui.getByRole('button', { name: 'Shape', exact: true }).click();
  const morphKept = await morphSlider.inputValue();
  const macroKept = await ui.getByRole('slider', { name: 'Scale', exact: true }).getAttribute('aria-valuenow');
  result.morphKept = morphKept === '0.7' && macroKept === '64';
  if (!result.morphKept) failures.push(`the morph lost its place (slider ${morphKept}, Scale ${macroKept})`);
  await morphSlider.fill('0');
  await ui.getByRole('button', { name: 'Play', exact: true }).click();

  await blur();
  await ui.locator('.inspector-content').evaluate(element => { element.scrollTop = 0; });
  await ui.waitForTimeout(300);
  await ui.locator('#inspector-panel').screenshot({ path: path.join(out, 'control-surface.png') });
  await size(960, 640);
  result.overflow = await ui.evaluate(() => ['.inspector-content', '.meridian-controls', '.m-macros', '.m-pads', '.m-bank', '.m-groups'].filter(selector => { const e = document.querySelector(selector); return e.scrollWidth > e.clientWidth; }).concat(document.documentElement.scrollWidth > innerWidth ? ['page'] : []));
  if (result.overflow.length) failures.push(`horizontal overflow at the minimum width: ${result.overflow.join(', ')}`);
  await size(1600, 1000);
  return result;
}

/** The real app: add Meridian from its card, let it play, and capture what is on the preview. */
async function verifyInApp(qa, failures) {
  const FRAMES = 12, profile = path.join(stage, `app-profile-${Date.now()}`);
  await fs.mkdir(profile, { recursive: true });
  const entry = path.join(stage, 'app.cjs');
  await fs.writeFile(entry, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
  const appEnv = { ...process.env }; delete appEnv.ELECTRON_RUN_AS_NODE; delete appEnv.STUDIO_DEV_URL;
  const real = await electron.launch({ args: [entry], env: appEnv });
  const ui = await real.firstWindow(), appErrors = [];
  ui.setDefaultTimeout(45000);
  ui.on('pageerror', e => appErrors.push(String(e)));
  ui.on('console', message => { if (message.type() === 'error') appErrors.push(message.text()); });
  try {
    await ui.getByText('Export engine ready', { exact: true }).waitFor();
    await ui.getByRole('button', { name: 'Open library', exact: true }).click();
    await ui.getByRole('button', { name: 'Add Meridian', exact: true }).click();
    const closeLibrary = ui.getByRole('button', { name: 'Close library', exact: true });
    if (await closeLibrary.isVisible()) await closeLibrary.click();
    let saved = null;
    for (let i = 0; i < 150 && !saved; i++) {
      const project = await ui.evaluate(() => window.studio.loadAutosave());
      if (project?.layers.some(layer => layer.kind === 'meridian')) saved = project;
      else await ui.waitForTimeout(100);
    }
    if (!saved) { failures.push('the Meridian card did not add a layer'); return { added: false }; }

    await ui.getByRole('button', { name: 'Shape', exact: true }).click();
    await ui.getByRole('button', { name: /^Rings/ }).click();
    await ui.getByRole('button', { name: /^Nodes/ }).click();
    const animateStructural = await ui.getByTitle('Animate Node density', { exact: true }).count();
    const animateLive = await ui.getByTitle('Animate Ring weight', { exact: true }).count();
    if (animateStructural !== 0) failures.push('Node density, a structural parameter, offers Animate');
    if (animateLive !== 1) failures.push('Ring weight no longer offers Animate');
    await ui.getByRole('button', { name: 'Motion', exact: true }).click();
    const motionOption = await ui.locator('select[aria-label="Motion parameter"] option[value="nodeDensity"]').count();
    const motionLive = await ui.locator('select[aria-label="Motion parameter"] option[value="ringWeight"]').count();
    if (motionLive !== 1) failures.push('the Motion panel lost Ring weight');
    await ui.getByRole('button', { name: 'Shape', exact: true }).click();
    if (motionOption !== 0) failures.push('the Motion panel offers Node density');
    const surface = await verifySurface(real, ui, qa, failures);

    // Across most of one loop, so the frames span the phrase.
    const gap = Math.min(800, Math.max(250, saved.duration * 1000 / FRAMES));
    const preview = ui.locator('.preview-stage canvas').first(), shots = [];
    for (let i = 0; i < FRAMES; i++) {
      shots.push(Array.from(await preview.screenshot()));
      await ui.waitForTimeout(gap);
    }
    const seen = await qa.evaluate(async ([shots, w, h, across]) => {
      const sheet = new OffscreenCanvas(across * w, Math.ceil(shots.length / across) * h), paint = sheet.getContext('2d', { willReadFrequently: true });
      const frames = [];
      for (let i = 0; i < shots.length; i++) {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(shots[i])], { type: 'image/png' }));
        const x = (i % across) * w, y = Math.floor(i / across) * h;
        paint.drawImage(bitmap, x, y, w, h);
        frames.push(paint.getImageData(x, y, w, h).data);
      }
      const lit = frames.map(f => { let n = 0; for (let i = 0; i < f.length; i += 4) if (f[i] + f[i + 1] + f[i + 2] > 120) n++; return n / (f.length / 4); });
      const moved = frames.slice(1).map((f, k) => { let sum = 0; for (let i = 0; i < f.length; i++) sum += Math.abs(f[i] - frames[k][i]); return sum / f.length; });
      const png = new Uint8Array(await (await sheet.convertToBlob({ type: 'image/png' })).arrayBuffer());
      return { lit, moved, png: Array.from(png) };
    }, [shots, 400, 225, 4]);
    await fs.writeFile(path.join(out, 'in-app-motion.png'), Buffer.from(seen.png));
    const litMost = Math.max(...seen.lit), changed = seen.moved.filter(value => value > .05).length;
    if (!(litMost > .005)) failures.push(`the Meridian layer does not draw in the app (lit ${litMost.toFixed(4)})`);
    if (changed < FRAMES / 2) failures.push(`the picture changed in only ${changed} of ${FRAMES - 1} steps`);
    if (appErrors.length) failures.push(`app console errors: ${appErrors.join(' | ').slice(0, 400)}`);
    return { added: true, surface, duration: saved.duration, animateStructural, animateLive, motionOption, motionLive, litMost: +litMost.toFixed(4), changedSteps: changed, of: FRAMES - 1 };
  } finally {
    await real.close();
  }
}

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(stage, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.evaluate(async () => {
    const m = await import('./renderer.js');
    const { THREE } = m;
    const studio = new m.StudioRenderer(document.querySelector('canvas'));
    const gl = studio.renderer;
    const meridian = new m.MeridianRenderer();
    const scene = new THREE.Scene(), camera = new THREE.Camera();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false; scene.add(quad);
    const draw = (material, target) => { quad.material = material; gl.setRenderTarget(target); gl.render(scene, camera); };
    const floatTarget = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const layerFor = seed => { const layer = m.createLayer('meridian'); layer.id = `meridian-${seed}`; layer.params.seed = seed; return layer; };
    const phaseOf = (seed, index, share) => {
      const ends = m.compose(seed, m.MERIDIAN_DEFAULTS).stateEnds, start = index ? ends[index - 1] : 0;
      return Math.PI * 2 * (start + (ends[index] - start) * share);
    };
    const read = (target, w, h) => { const data = new Float32Array(w * h * 4); gl.readRenderTargetPixels(target, 0, 0, w, h, data); gl.setRenderTarget(null); return data; };
    const measure = (seed, index, share) => {
      const w = 960, h = 540, target = floatTarget(w, h);
      meridian.draw(gl, layerFor(seed), phaseOf(seed, index, share), w, h, target, draw);
      const data = read(target, w, h); target.dispose();
      let sum = 0, nan = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (!Number.isFinite(data[i]) || !Number.isFinite(data[i + 1]) || !Number.isFinite(data[i + 2]) || !Number.isFinite(data[i + 3])) nan++;
        else sum += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
      }
      return { luma: sum / (w * h), nan };
    };
    // Light along a line through a ring, as a width: total light divided by the light of a solid line.
    const ringWidth = (lineWidth, w, h) => {
      const params = { ...m.MERIDIAN_DEFAULTS, lightBloomAmount: 0, lightLineGlow: 0, lightVignette: 0, colourFringe: 0, lightExposure: .25, lightCore: 0, outputMinLineWidth: .5 };
      const palette = ['#404040', '#404040', '#404040', '#404040', '#404040', '#000000'];
      const profile = width => {
        const list = new m.DisplayList(4), target = floatTarget(w, h);
        list.push(m.PRIMITIVE.ring, 0, 0, .31, 0, 0, width, 0, 0, 1, 0, 0);
        meridian.drawList(gl, list, params, palette, w, h, target, draw);
        const data = read(target, w, h); target.dispose();
        const row = Math.floor(h / 2) * w * 4;
        let total = 0, peak = 0;
        for (let x = Math.floor(w / 2); x < w; x++) { const v = data[row + x * 4 + 1]; total += v; peak = Math.max(peak, v); }
        return { total, peak };
      };
      const solid = profile(16);
      return profile(lineWidth).total / solid.peak;
    };
    // Whether moving a parameter from its default to either end changes any pixel, at the moments it can act.
    const sweep = (groups, needs, skips) => {
      const w = 320, h = 180, target = floatTarget(w, h), seed = 4, score = m.compose(seed, m.MERIDIAN_DEFAULTS);
      const firstRing = score.elements.filter(e => e.group === 'ring').reduce((a, b) => (b.enter < a ? b.enter : a), 1);
      const phases = [Math.PI * 2 * (firstRing + .016), phaseOf(seed, 1, .75), phaseOf(seed, 2, .85), phaseOf(seed, 4, .06), phaseOf(seed, 4, .4), phaseOf(seed, 5, .5)];
      const shot = (params, phase) => {
        const layer = layerFor(seed); Object.assign(layer.params, params);
        meridian.draw(gl, layer, phase, w, h, target, draw);
        return read(target, w, h);
      };
      const differs = (a, b) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-3) return true; return false; };
      const dead = [], swept = [];
      for (const d of m.MERIDIAN_PARAMETERS) {
        if (!groups.includes(d.group) || d.key in skips) continue;
        swept.push(d.key);
        const need = needs[d.key] ?? {};
        const acts = phases.some(phase => {
          const base = shot(need, phase);
          return [d.min, d.max].some(value => value !== d.default && differs(base, shot({ ...need, [d.key]: value }, phase)));
        });
        if (!acts) dead.push(d.key);
      }
      target.dispose();
      return { swept: swept.length, dead };
    };
    // An animated structural value must not rebuild the composition, and must not move it either.
    const structuralHold = async () => {
      const motion = { kind: 'sine', cycles: 1, phase: 0, amount: .4, points: [{ time: 0, value: 0 }, { time: 1, value: 0 }] };
      const projectWith = modulated => {
        const project = m.createProject(), layer = layerFor(4);
        if (modulated) for (const key of ['nodeDensity', 'latticeType', 'structureRadialRatio', 'scoreDraw']) layer.modulations[key] = { ...motion };
        project.layers = [layer]; project.background = '#000000'; return project;
      };
      const project = projectWith(true), plain = projectWith(false), phase = phaseOf(4, 4, .4);
      const same = (await studio.exportPNG(project, phase, 320, 180)).join() === (await studio.exportPNG(plain, phase, 320, 180)).join();
      studio.meridian.scores.length = 0;
      for (let i = 0; i < 12; i++) await studio.exportPNG(project, phase + i * .03, 64, 36);
      return { same, composed: studio.meridian.scores.length };
    };
    // The tear: what it changes at Peak and Rest, and whether a frame is the same however it is reached.
    const tearChecks = async () => {
      const w = 480, h = 270, target = floatTarget(w, h);
      const shot = (seed, phase, amount) => {
        const layer = layerFor(seed); layer.params.glitchAmount = amount;
        meridian.draw(gl, layer, phase, w, h, target, draw);
        return read(target, w, h);
      };
      const share = (a, b) => {
        let moved = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > .008 || Math.abs(a[i + 1] - b[i + 1]) > .008 || Math.abs(a[i + 2] - b[i + 2]) > .008) moved++;
        return moved / (a.length / 4);
      };
      const peak = [], rest = [];
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const atPeak = phaseOf(seed, 4, .4), atRest = phaseOf(seed, 6, .5);
        peak.push(share(shot(seed, atPeak, 1), shot(seed, atPeak, 0)));
        rest.push(share(shot(seed, atRest, 1), shot(seed, atRest, 0)));
      }
      target.dispose();
      const project = m.createProject(), layer = layerFor(4);
      project.layers = [layer]; project.background = '#000000'; project.duration = 4;
      const total = m.frameCount(project), frame = index => studio.exportPNG(project, m.phaseAtFrame(index, total), 320, 180);
      const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
      const peakFrame = Math.round(phaseOf(4, 4, .4) / (Math.PI * 2) * total);
      const first37 = await frame(37), firstPeak = await frame(peakFrame);
      for (const between of [3, 80, peakFrame + 1, 11]) await frame(between);
      return {
        peak, rest, total, peakFrame,
        repeat37: same(first37, await frame(37)), repeatPeak: same(firstPeak, await frame(peakFrame)),
        loops: same(await frame(0), await studio.exportPNG(project, Math.PI * 2, 320, 180)),
      };
    };
    // Hold frames, in real output frames: the tear shader's inputs must stay the same for exactly N frames.
    const tearHold = async (fps, hold) => {
      const project = m.createProject(), layer = layerFor(4);
      layer.params.glitchHoldFrames = hold;
      project.layers = [layer]; project.background = '#000000'; project.duration = 4; project.fps = { num: fps, den: 1 };
      const total = m.frameCount(project), from = Math.floor(phaseOf(4, 4, 0) / (Math.PI * 2) * total), to = Math.ceil(phaseOf(4, 5, 0) / (Math.PI * 2) * total);
      const runs = [];
      let last = null;
      for (let frame = from; frame < to; frame++) {
        await studio.exportPNG(project, m.phaseAtFrame(frame, total), 32, 18);
        const tear = studio.meridian.tear.uniforms, noise = tear.uNoise.value;
        const pattern = studio.meridian.tearAmount > 0 ? [noise.x, noise.y, noise.z, noise.w, tear.uTear.value].join() : null;
        if (pattern !== null && pattern === last) runs[runs.length - 1]++;
        else if (pattern !== null) runs.push(1);
        last = pattern;
      }
      return { fps, hold, runs, inner: runs.slice(1, -1) };
    };
    // With a raised black level, nothing in a torn frame may fall below it.
    const tearBlack = level => {
      const w = 480, h = 270, target = floatTarget(w, h);
      let lowest = Infinity;
      for (const seed of [1, 2, 3, 4, 5, 6]) for (const share of [.2, .4, .7]) {
        const layer = layerFor(seed);
        Object.assign(layer.params, { outputBlackLevel: level, glitchAmount: 2, glitchScanBands: 1, glitchColourShred: 1, glitchPosterise: 1 });
        meridian.draw(gl, layer, phaseOf(seed, 4, share), w, h, target, draw);
        const data = read(target, w, h);
        for (let i = 0; i < data.length; i += 4) lowest = Math.min(lowest, data[i], data[i + 1], data[i + 2]);
      }
      target.dispose();
      return lowest;
    };
    // A long hold on a short loop must still show a tear in the first output frame of Peak.
    const tearShort = async (seconds, hold) => {
      const missing = [];
      for (let seed = 1; seed <= 24; seed++) {
        const frameOf = amount => {
          const project = m.createProject(), layer = layerFor(seed);
          Object.assign(layer.params, { glitchHoldFrames: hold, glitchAmount: amount });
          project.layers = [layer]; project.background = '#000000'; project.duration = seconds; project.fps = { num: 30, den: 1 };
          const total = m.frameCount(project), at = Math.ceil(phaseOf(seed, 4, 0) / (Math.PI * 2) * total - 1e-6);
          return studio.exportPNG(project, m.phaseAtFrame(at, total), 96, 54);
        };
        const torn = await frameOf(1), amount = studio.meridian.tearAmount, clean = await frameOf(0);
        if (!(amount > 0) || (torn.length === clean.length && torn.every((value, i) => value === clean[i]))) missing.push(seed);
      }
      return missing;
    };
    // Empty torn cells stay exactly on the floor that Resolve lays down, with black level and background lift raised.
    const tearEmpty = () => {
      const w = 320, h = 180, target = floatTarget(w, h);
      let worst = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const layer = layerFor(seed);
        Object.assign(layer.params, { outputBlackLevel: .1, lightBackgroundLift: .2, glitchAmount: 2, glitchScanBands: 1, glitchColourShred: 1, glitchPosterise: 1, glitchRgbSplit: 1 });
        meridian.draw(gl, layer, phaseOf(seed, 4, .4), w, h, target, draw);
        gl.setClearColor(0, 0); gl.setRenderTarget(meridian.light); gl.clear();
        meridian.resolve.uniforms.uWeights.value.fill(0);
        draw(meridian.resolve, target);
        const floor = read(target, w, h);
        draw(meridian.resolve, meridian.untorn);
        draw(meridian.tear, target);
        const torn = read(target, w, h);
        for (let i = 0; i < torn.length; i += 4) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(torn[i + k] - floor[i + k]));
      }
      target.dispose();
      return worst;
    };
    // In transparent output, alpha follows the torn colour as Resolve defines it, so dark patches do not occlude.
    const tearAlpha = () => {
      const w = 320, h = 180, target = floatTarget(w, h);
      let worst = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const layer = layerFor(seed);
        Object.assign(layer.params, { outputTransparent: 1, glitchAmount: 2, glitchScanBands: 1, glitchColourShred: 1 });
        meridian.draw(gl, layer, phaseOf(seed, 4, .4), w, h, target, draw);
        const data = read(target, w, h);
        for (let i = 0; i < data.length; i += 4) worst = Math.max(worst, Math.abs(data[i + 3] - Math.min(1, Math.max(data[i], data[i + 1], data[i + 2]))));
      }
      target.dispose();
      return worst;
    };
    window.meridianQA = { m, studio, layerFor, phaseOf, measure, ringWidth, sweep, structuralHold, tearChecks, tearHold, tearBlack, tearShort, tearEmpty, tearAlpha };
  });

  const report = { luma: {}, widths: {}, errors };
  // Collected so a failing run still saves the pictures that show why.
  const failures = [];
  await page.evaluate(([seed, index, share]) => window.meridianQA.measure(seed, index, share), [1, ...STATES.peak]);
  assert.deepEqual(errors, [], 'the shaders must compile');
  const STILL = [640, 360];
  for (const seed of SEEDS) {
    report.luma[seed] = {};
    for (const name of CHECKED) {
      const [index, share] = STATES[name];
      const { luma, nan } = await page.evaluate(([seed, index, share]) => window.meridianQA.measure(seed, index, share), [seed, index, share]);
      report.luma[seed][name] = luma;
      assert.equal(nan, 0, `seed ${seed} ${name}: ${nan} NaN pixels`);
    }
    const l = report.luma[seed];
    if (!(l.rest < .02)) failures.push(`seed ${seed}: Rest mean luma ${l.rest.toFixed(4)}`);
    if (!(l.peak > 2 * l.build)) failures.push(`seed ${seed}: Peak ${l.peak.toFixed(4)} is not twice Build ${l.build.toFixed(4)}`);
  }
  for (const [name, w, h] of [['1080p', 1920, 1080], ['4K', 3840, 2160]]) {
    const width = await page.evaluate(([w, h]) => window.meridianQA.ringWidth(1.5, w, h), [w, h]);
    report.widths[name] = width;
    if (!(Math.abs(width - 1.5) <= .5)) failures.push(`${name}: a 1.5 px ring measures ${width.toFixed(2)} px`);
  }

  // The shared layer controls still act on a Meridian layer.
  const shared = await page.evaluate(async () => {
    const { m, studio, layerFor, phaseOf } = window.meridianQA, phase = phaseOf(4, 4, .4);
    const frame = async (change, under) => {
      const project = m.createProject(), layer = layerFor(4); change(layer);
      project.layers = under ? [layerFor(2), layer] : [layer]; project.background = '#000000';
      const bitmap = await createImageBitmap(new Blob([await studio.exportPNG(project, phase, 320, 180)], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(320, 180), context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, 320, 180).data;
    };
    const apart = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
    const plain = await frame(() => {}), over = await frame(() => {}, true);
    return {
      mask: apart(plain, await frame(l => { l.mask.kind = 'circle'; l.mask.size = .25; })),
      transform: apart(plain, await frame(l => { l.transform.x = .2; l.transform.scale = .7; })),
      opacity: apart(plain, await frame(l => { l.opacity = .4; })),
      blend: apart(over, await frame(l => { l.blend = 'add'; }, true)),
    };
  });
  report.shared = shared;
  for (const [name, change] of Object.entries(shared)) if (!(change > .3)) failures.push(`${name} has no effect on a Meridian layer (${change.toFixed(3)})`);

  const hold = await page.evaluate(() => window.meridianQA.structuralHold());
  report.structuralHold = hold;
  if (hold.composed !== 1) failures.push(`animated structural values composed ${hold.composed} scores in 12 frames`);
  if (!hold.same) failures.push('a saved structural animation changed the picture');

  const swept = await page.evaluate(([groups, needs, skips]) => window.meridianQA.sweep(groups, needs, skips), [SWEPT_GROUPS, SWEEP_NEEDS, SWEEP_SKIPS]);
  report.sweep = { ...swept, pending: Object.values(PENDING).flat().length, awaitingConductor: AWAITING_CONDUCTOR.length, provenByPanelTests: PROVEN_BY_PANEL_TESTS.length };
  const total = await page.evaluate(() => window.meridianQA.m.MERIDIAN_PARAMETERS.length);
  if (swept.swept + Object.keys(SWEEP_SKIPS).length !== total) failures.push(`the dead-parameter check covers ${swept.swept + Object.keys(SWEEP_SKIPS).length} of ${total} parameters`);
  if (swept.dead.length) failures.push(`parameters that change no pixels: ${swept.dead.join(', ')}`);

  const tear = await page.evaluate(() => window.meridianQA.tearChecks());
  report.tear = { peakMin: +Math.min(...tear.peak).toFixed(3), restMax: Math.max(...tear.rest), repeat37: tear.repeat37, repeatPeak: tear.repeatPeak, loops: tear.loops };
  tear.peak.forEach((value, i) => { if (!(value > .1)) failures.push(`seed ${SEEDS[i]}: Glitch changes only ${(value * 100).toFixed(1)}% of the Peak`); });
  tear.rest.forEach((value, i) => { if (value !== 0) failures.push(`seed ${SEEDS[i]}: Glitch changes ${(value * 100).toFixed(2)}% of Rest`); });
  if (!tear.repeat37) failures.push('frame 37 differs when rendered again after other frames');
  if (!tear.repeatPeak) failures.push(`Peak frame ${tear.peakFrame} differs when rendered again after other frames`);
  if (!tear.loops) failures.push('frame N of the loop does not equal frame 0');

  report.tearHold = [];
  for (const [fps, hold] of [[30, 1], [30, 3], [60, 5]]) {
    const result = await page.evaluate(([fps, hold]) => window.meridianQA.tearHold(fps, hold), [fps, hold]);
    report.tearHold.push({ fps, hold, inner: result.inner.length });
    if (result.inner.length < 2 || result.inner.some(run => run !== hold)) failures.push(`Hold ${hold} at ${fps} fps gave runs of ${result.runs.join(', ')} frames`);
  }
  const BLACK_LEVEL = .1;
  report.tearBlack = await page.evaluate(level => window.meridianQA.tearBlack(level), BLACK_LEVEL);
  if (report.tearBlack < BLACK_LEVEL - 1e-3) failures.push(`a torn pixel reaches ${report.tearBlack.toFixed(4)}, below the black level ${BLACK_LEVEL}`);

  report.tearShort = {};
  for (const [seconds, hold] of [[1, 12], [2, 12], [1, 6]]) {
    const missing = await page.evaluate(([seconds, hold]) => window.meridianQA.tearShort(seconds, hold), [seconds, hold]);
    report.tearShort[`${seconds}s hold ${hold}`] = missing.length;
    if (missing.length) failures.push(`${seconds} s loop at Hold ${hold}: no tear at Peak for ${missing.length} of 24 seeds`);
  }
  report.tearEmpty = await page.evaluate(() => window.meridianQA.tearEmpty());
  if (report.tearEmpty > .004) failures.push(`an empty torn area moves ${report.tearEmpty.toFixed(4)} off the black level floor`);
  report.tearAlpha = await page.evaluate(() => window.meridianQA.tearAlpha());
  if (report.tearAlpha > .004) failures.push(`transparent tear alpha is ${report.tearAlpha.toFixed(4)} away from its colour`);

  // Stills go through the whole Studio path, so masks, blend and transform stay in the proof.
  const tiles = [];
  for (const name of SHEET) for (const seed of SEEDS) {
    const [index, share] = STATES[name];
    const bytes = await page.evaluate(async ([seed, index, share, w, h]) => {
      const { m, studio, layerFor, phaseOf } = window.meridianQA, project = m.createProject();
      project.layers = [layerFor(seed)]; project.background = '#000000';
      return Array.from(await studio.exportPNG(project, phaseOf(seed, index, share), w, h));
    }, [seed, index, share, ...STILL]);
    await fs.writeFile(path.join(out, `seed${seed}-${name}.png`), Buffer.from(bytes));
    tiles.push(bytes);
  }
  // Full-size frames, for judging line quality and the smoothness of a collapsing ring.
  for (const name of ['build', 'peak', 'collapse']) {
    const [index, share] = STATES[name];
    const bytes = await page.evaluate(async ([index, share]) => {
      const { m, studio, layerFor, phaseOf } = window.meridianQA, project = m.createProject();
      project.layers = [layerFor(4)]; project.background = '#000000';
      return Array.from(await studio.exportPNG(project, phaseOf(4, index, share), 1920, 1080));
    }, [index, share]);
    await fs.writeFile(path.join(out, `full-${name}.png`), Buffer.from(bytes));
  }
  const sheet = await page.evaluate(async ([tiles, across, w, h]) => {
    const canvas = new OffscreenCanvas(across * w, Math.ceil(tiles.length / across) * h), context = canvas.getContext('2d');
    for (let i = 0; i < tiles.length; i++) {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(tiles[i])], { type: 'image/png' }));
      context.drawImage(bitmap, (i % across) * w, Math.floor(i / across) * h, w, h);
    }
    return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, [tiles, SEEDS.length, 400, 225]);
  await fs.writeFile(path.join(out, 'first-look.png'), Buffer.from(sheet));

  report.ui = await verifyInApp(page, failures);
  console.log(JSON.stringify({ structuralHold: report.structuralHold, sweep: report.sweep, tear: report.tear, tearHold: report.tearHold, tearBlack: report.tearBlack, tearShort: report.tearShort, tearEmpty: report.tearEmpty, tearAlpha: report.tearAlpha, ui: report.ui }));
  console.log(JSON.stringify(report.widths), JSON.stringify(report.shared), Object.entries(report.luma).map(([seed, l]) => `${seed}: build ${l.build.toFixed(3)} peak ${l.peak.toFixed(3)} rest ${l.rest.toFixed(4)}`).join(' | '));
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log('verify-meridian: PASS');
} finally {
  await app.close();
}
