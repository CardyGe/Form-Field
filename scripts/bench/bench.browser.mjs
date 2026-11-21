// Runs inside the benchmark window. See bench.cjs for options.
const config = await window.bench.config();
const { StudioRenderer, GpuTimer, createProject, createLayer, applyPreset, validateProject, PRESETS, frameCount, phaseAtFrame, summarize, summarizeSamples } = await import('./renderer.js');

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const channel = new MessageChannel();
/** A yield that is not clamped to 4 ms like setTimeout. */
const yieldNow = () => new Promise(resolve => { channel.port1.onmessage = () => resolve(); channel.port2.postMessage(0); });

/** Resolves once the GPU has finished every command issued so far. */
async function fence(gl) {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  try {
    for (;;) {
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return;
      if (status === gl.WAIT_FAILED) throw new Error('GPU fence failed.');
      await yieldNow();
    }
  } finally { gl.deleteSync(sync); }
}

function projectFor(c) {
  let project;
  if (c.preset) {
    const preset = PRESETS.find(p => p.id === c.preset);
    if (!preset) throw new Error(`Case ${c.name}: no preset ${c.preset}.`);
    project = createProject();
    project.layers = [applyPreset(createLayer(preset.kind), preset.id)];
  } else project = validateProject(structuredClone(c.projectJSON));
  project.id = `bench-${c.name}`; project.seed = 1729;
  for (const layer of project.layers) layer.params.seed = 1729;
  for (const [key, value] of Object.entries(c.params ?? {})) {
    if (!Number.isFinite(value)) throw new Error(`Case ${c.name}: param ${key} must be a number.`);
    project.layers[0].params[key] = value;
  }
  return project;
}

function gpuInfo(gl) {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    timerQuery: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')),
    parallelCompile: Boolean(gl.getExtension('KHR_parallel_shader_compile')),
  };
}

async function runCase(c, run) {
  const project = projectFor(c), total = frameCount(project);
  const draw = (renderer, k) => {
    const phase = phaseAtFrame(k % total, total);
    if (c.mode === 'export') renderer.renderExportQuality(project, phase, c.width, c.height, c.supersample ?? 1);
    else renderer.render(project, phase, c.width, c.height);
  };
  const canvas = document.createElement('canvas');
  document.body.replaceChildren(canvas);

  // Cold start: a new renderer and context, no cached programs, to the first finished frame.
  await nextFrame();
  let t = performance.now();
  const renderer = new StudioRenderer(canvas);
  const constructMs = performance.now() - t;
  const gl = renderer.gpuContext();
  t = performance.now();
  await renderer.prepare(project);
  const prepareMs = performance.now() - t;
  t = performance.now();
  draw(renderer, 0);
  await fence(gl);
  const firstFrameMs = performance.now() - t;

  for (let k = 1; k <= c.warmup; k++) { await nextFrame(); draw(renderer, k); }
  await fence(gl);

  const timer = GpuTimer.create(gl);
  const samples = [], cpuSubmit = [], intervals = [];
  renderer.setTimer(timer);
  let last = null;
  for (let i = 0; i < c.frames; i++) {
    const now = await nextFrame();
    if (last !== null) intervals.push(now - last);
    last = now;
    const k = c.warmup + 1 + i;
    if (timer) {
      timer.beginFrame(i);
      const s = performance.now(); draw(renderer, k); cpuSubmit.push(performance.now() - s);
      samples.push(...timer.poll());
    } else {
      // No GPU timer: wall time from submission to a completed fence. Serialises CPU and GPU, so it overstates cost.
      const s = performance.now(); draw(renderer, k); cpuSubmit.push(performance.now() - s);
      await fence(gl);
      samples.push({ frame: i, pass: 'frame', ms: performance.now() - s });
    }
  }
  renderer.setTimer(null);
  if (timer) {
    await fence(gl);
    for (let tries = 0; timer.waiting && tries < 120; tries++) { await nextFrame(); samples.push(...timer.poll()); }
    samples.push(...timer.poll());
  }
  const incomplete = timer ? [...timer.incomplete] : [];
  const lost = timer ? timer.waiting : 0;
  timer?.dispose();
  const stats = renderer.getStats();
  renderer.dispose();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.remove();

  const timings = summarizeSamples(samples, new Set(incomplete));
  const result = {
    name: c.name, run, mode: c.mode, width: c.width, height: c.height, frames: c.frames, warmup: c.warmup,
    preset: c.preset ?? null, project: c.project ?? null, params: c.params ?? {},
    coldStart: { constructMs, prepareMs, firstFrameMs, totalMs: constructMs + prepareMs + firstFrameMs },
    gpu: timings, cpuSubmit: summarize(cpuSubmit), frameInterval: summarize(intervals),
    incompleteFrames: incomplete.length, unreadQueries: lost, drawCalls: stats.drawCalls,
  };
  const g = timings.total;
  await window.bench.log(`${c.name} run ${run + 1}: median ${g.median.toFixed(2)} ms, p95 ${g.p95.toFixed(2)} ms, p99 ${g.p99.toFixed(2)} ms over ${g.count} frames; cold start ${result.coldStart.totalMs.toFixed(0)} ms`);
  return result;
}

try {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) throw new Error('WebGL2 is not available.');
  const gpu = gpuInfo(probe);
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  await window.bench.log(`GPU: ${gpu.renderer}; timer queries ${gpu.timerQuery ? 'yes' : 'no (CPU fence fallback)'}`);
  const results = [];
  for (let run = 0; run < config.runs; run++) for (const c of config.cases) results.push(await runCase(c, run));
  // Repeatability: spread of each case's median total across runs, against the 5% target.
  const agreement = config.runs < 2 ? null : config.cases.map(c => {
    const medians = results.filter(r => r.name === c.name).map(r => r.gpu.total.median);
    const spread = Math.max(...medians) / Math.min(...medians) - 1;
    return { name: c.name, medians, spread, agrees: spread <= .05 };
  });
  if (agreement) for (const a of agreement) await window.bench.log(`${a.name}: medians ${a.medians.map(m => m.toFixed(2)).join(', ')} ms, spread ${(a.spread * 100).toFixed(1)}% ${a.agrees ? 'agrees' : 'DOES NOT AGREE'}`);
  await window.bench.done({ gpu, timing: gpu.timerQuery ? 'gpu-timer' : 'cpu-fence', cases: results, agreement });
} catch (error) {
  await window.bench.fail(error?.stack || String(error));
}
