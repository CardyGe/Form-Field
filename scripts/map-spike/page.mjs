// Map stage 0 spike, browser side. Measures N instrument sources drawn per frame
// and composited into one stage canvas, the way the Map compositor would.
import { StudioRenderer } from '../../src/rendering/StudioRenderer';
import { createProject, createLayer, applyPreset, PRESETS } from '../../src/core/project';

const TAU = Math.PI * 2;
const status = text => { document.getElementById('status').textContent = text; };
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? NaN; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? NaN; };

// One preset per distinct kind, so the mix covers different instruments.
function distinctPresets() {
  const seen = new Map();
  for (const preset of PRESETS) if (!seen.has(preset.kind)) seen.set(preset.kind, preset);
  return [...seen.values()];
}

function projectFor(preset, index) {
  const project = createProject();
  Object.assign(project, { id: `spike-${index}`, name: preset.id, seed: 1729 + index, width: 1920, height: 1080, transparent: false, background: '#070912' });
  project.layers = [applyPreset(createLayer(preset.kind), preset.id)];
  project.layers[0].id = `spike-layer-${index}`;
  project.layers[0].params.seed = 1729 + index;
  return project;
}

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// Forces the GPU to finish queued work so frame times are real, not just submit times.
function sync(canvas) {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (gl) { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
}

async function probe(cfg) {
  // How many live WebGL contexts can this machine hold, each rendering once?
  const made = [], errors = [];
  let lost = 0;
  for (let i = 0; i < 32; i++) {
    try {
      const canvas = makeCanvas(320, 180);
      canvas.addEventListener('webglcontextlost', () => { lost++; });
      const renderer = new StudioRenderer(canvas);
      await renderer.prepare(projectFor(distinctPresets()[i % 4], i));
      renderer.render(projectFor(distinctPresets()[i % 4], i), 0, 320, 180);
      sync(canvas);
      made.push(renderer);
    } catch (error) { errors.push(String(error && error.message || error)); break; }
  }
  return { contextsAlive: made.length, lostEvents: lost, firstError: errors[0] ?? null };
}

async function timedRun(cfg) {
  const presets = distinctPresets();
  const instruments = cfg.kinds
    ? cfg.kinds.map(kind => PRESETS.find(preset => preset.kind === kind))
    : presets.slice(0, cfg.instruments);
  if (instruments.some(preset => !preset)) throw new Error('Unknown instrument kind in --kinds');
  const stage = makeCanvas(cfg.stageWidth, cfg.stageHeight);
  const ctx = stage.getContext('2d');
  const sources = [];
  const shapeCols = Math.ceil(Math.sqrt(cfg.sources));
  const cellW = cfg.stageWidth / shapeCols, cellH = cfg.stageHeight / Math.ceil(cfg.sources / shapeCols);
  let renderers = [];

  if (cfg.mode === 'separate') {
    for (let i = 0; i < cfg.sources; i++) {
      const canvas = makeCanvas(cfg.sourceWidth, cfg.sourceHeight);
      const renderer = new StudioRenderer(canvas);
      const project = projectFor(instruments[i % instruments.length], i);
      await renderer.prepare(project);
      renderers.push(renderer);
      sources.push({ renderer, canvas, project, x: (i % shapeCols) * cellW, y: Math.floor(i / shapeCols) * cellH });
    }
  } else if (cfg.mode === 'shared') {
    // Cost floor only: one renderer drawing every project in turn. This is not a
    // correct design, since StudioRenderer keeps per-composition state; it bounds the best case.
    const canvas = makeCanvas(cfg.sourceWidth, cfg.sourceHeight);
    const renderer = new StudioRenderer(canvas);
    renderers = [renderer];
    for (let i = 0; i < cfg.sources; i++) {
      const project = projectFor(instruments[i % instruments.length], i);
      await renderer.prepare(project);
      sources.push({ renderer, canvas, project, x: (i % shapeCols) * cellW, y: Math.floor(i / shapeCols) * cellH });
    }
  }

  const start = performance.now();
  const warmEnd = start + cfg.warmup * 1000, end = warmEnd + cfg.seconds * 1000;
  const frames = [], renderCpu = [];
  let last = null, dropped = 0;

  await new Promise(resolve => {
    function frame(now) {
      const t0 = performance.now();
      const phase = ((now - start) / 1000) * (TAU / 8) % TAU;
      for (const s of sources) s.renderer.render(s.project, phase, cfg.sourceWidth, cfg.sourceHeight);
      const tRender = performance.now();
      for (const s of sources) ctx.drawImage(s.canvas, s.x, s.y, cellW, cellH);
      // Each renderer has its own context and queue, so every one must be synced.
      for (const s of sources) sync(s.canvas);
      const t1 = performance.now();
      if (now >= warmEnd) { frames.push(t1 - t0); renderCpu.push(tRender - t0); if (last !== null && now - last > 20) dropped++; }
      last = now;
      status(`${cfg.label}: ${Math.round((now - start) / 1000)} s`);
      if (now < end) requestAnimationFrame(frame); else resolve();
    }
    requestAnimationFrame(frame);
  });

  // Sanity check: the composited stage must not be blank, or the timings measure nothing.
  const pixels = ctx.getImageData(0, 0, cfg.stageWidth, cfg.stageHeight).data;
  let lit = 0;
  for (let i = 0; i < pixels.length; i += 4 * 97) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) lit++;
  const litShare = lit / (pixels.length / (4 * 97));

  const med = median(frames);
  const gpuStats = renderers.map(r => r.getStats ? r.getStats() : null).filter(Boolean);
  for (const r of renderers) r.dispose();
  return {
    frames: frames.length,
    frameMsMedian: med, frameMsP95: pct(frames, 0.95), frameMsMax: Math.max(...frames),
    cpuRenderMsMedian: median(renderCpu),
    estimatedFps: 1000 / med,
    framesOver16_7ms: frames.filter(f => f > 16.7).length,
    rafGapsOver20ms: dropped,
    instrumentKinds: instruments.map(p => p.kind),
    stageLitShare: Number(litShare.toFixed(3)),
    textures: gpuStats.reduce((sum, s) => sum + s.textures, 0),
  };
}

async function run() {
  const cfg = await window.spike.config();
  status(`${cfg.label}: ${cfg.mode}, ${cfg.sources} sources`);
  if (cfg.mode === 'probe') {
    const result = await probe(cfg);
    return { summary: result, probe: result };
  }
  const result = await timedRun(cfg);
  return { summary: result };
}

run().then(report => { status('done'); window.spike.done(report); })
  .catch(error => { status('failed'); window.spike.fail(error && error.stack || error); });
