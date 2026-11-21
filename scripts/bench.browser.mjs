// Runs inside the hidden window. To add a case, append to buildCases(); each case supplies
// an id, a title and a project() factory. The measuring loop is shared.
const TAU = Math.PI * 2;
// The GPU clock ramps with load, so every case is warmed for a fixed time before it is measured.
const WARMUP_MS = 2500;
// Frames rendered back to back between yields, so the GPU stays busy and its clock does not drop.
const BATCH = 25;
const ms = () => performance.now();
// Query results only become readable after the browser has turned over a task.
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function buildCases({ createProject, createLayer, applyPreset, PRESETS }) {
  const cases = [];
  for (const preset of PRESETS.filter(item => item.kind === 'fractal')) {
    cases.push({ id: `fractal-${preset.id}`, title: `Fractal: ${preset.name}`, project() {
      const project = createProject();
      Object.assign(project, { id: 'bench-project', name: preset.id, seed: 1729, transparent: false, background: '#070912' });
      const layer = applyPreset(createLayer('fractal'), preset.id);
      layer.id = 'bench-layer'; layer.params.seed = 1729;
      project.layers = [layer];
      return project;
    } });
  }
  return cases;
}

function summaries(map, summarise) {
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v.length).map(([k, v]) => [k, summarise(v)]));
}

async function measure(entry, config, modules) {
  const { StudioRenderer, GpuTimer, summarise } = modules;
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new StudioRenderer(canvas);
  const gl = canvas.getContext('webgl2');
  const timer = new GpuTimer(gl);
  const { width, height, frames } = config;
  // gl.finish() does not reliably wait under ANGLE/Metal; reading one pixel back does.
  const pixel = new Uint8Array(4);
  const sync = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); };
  try {
    const project = entry.project();
    let t = ms();
    await renderer.prepare(project);
    const prepareMs = ms() - t;
    // A tiny first frame compiles and links every program the case uses; the full-size
    // frame that follows then shows target allocation and first execution separately.
    t = ms(); renderer.render(project, 0, 16, 16); sync();
    const compileMs = ms() - t;
    t = ms(); renderer.render(project, 0, width, height); sync();
    const firstDrawMs = ms() - t;
    renderer.setPassTimer(timer.available ? timer : null);
    const cpu = [], full = [];
    let warmupFrames = 0;
    for (const warmStart = ms(); ms() - warmStart < WARMUP_MS; warmupFrames++) {
      renderer.render(project, (warmupFrames % frames) / frames * TAU, width, height); sync();
      if (warmupFrames % BATCH === BATCH - 1) { await tick(); timer.poll(); }
    }
    // Let every warm-up query land, then start the GPU series clean.
    for (let i = 0; i < 8; i++) { sync(); await tick(); timer.poll(); }
    timer.reset();
    for (let i = 0; i < frames; i++) {
      const phase = i / frames * TAU;
      const start = ms();
      renderer.render(project, phase, width, height);
      const submitted = ms();
      sync();
      const done = ms();
      if (i % BATCH === BATCH - 1) { await tick(); timer.poll(); }
      cpu.push(submitted - start); full.push(done - start);
    }
    for (let i = 0; i < 6; i++) { sync(); await tick(); timer.poll(); }
    const passes = timer.results();
    return { id: entry.id, title: entry.title, prepareMs, compileMs, firstDrawMs,
      cpuFrameMs: summarise(cpu), fullOutputMs: summarise(full), gpuPassMs: summaries(passes, summarise) };
  } finally { renderer.setPassTimer(null); timer.dispose(); renderer.dispose(); canvas.remove(); }
}

async function run() {
  const config = await window.bench.config();
  const modules = await import('./renderer.js');
  const all = buildCases(modules);
  const wanted = config.caseSelector === 'all' ? all : config.caseSelector.split(',').map(id => {
    const found = all.find(item => item.id === id);
    if (!found) throw new Error(`Unknown case ${id}. Known: ${all.map(item => item.id).join(', ')}`);
    return found;
  });
  const probe = document.createElement('canvas').getContext('webgl2');
  const info = probe.getExtension('WEBGL_debug_renderer_info');
  const rendererString = info ? probe.getParameter(info.UNMASKED_RENDERER_WEBGL) : probe.getParameter(probe.RENDERER);
  const timerAvailable = new modules.GpuTimer(probe).available;
  const cases = [];
  for (const entry of wanted) {
    await window.bench.note(`case ${entry.id}`);
    cases.push(await measure(entry, config, modules));
  }
  await window.bench.done({ renderer: rendererString, size: config.size, width: config.width, height: config.height,
    frames: config.frames, warmupMs: WARMUP_MS, gpuTimerAvailable: timerAvailable,
    gpuPassMsNote: 'Ordered by draw, possibly CUMULATIVE within a frame on ANGLE/Metal (not confirmed isolated). A pass drawn several times per frame has several samples per frame, so count can exceed frames. Do not pick optimisation targets from it; use fullOutputMs for totals.',
    cases });
}

run().catch(error => window.bench.fail(error && error.stack || error));
