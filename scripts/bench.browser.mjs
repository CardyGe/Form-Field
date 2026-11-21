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
  cases.push({ id: 'kaleidoscope-parity', title: 'Kaleidoscope: GPU fold parity', check: kaleidoscopeParity });
  return cases;
}

// 64 x 64 = 4,096 grid points per group. The y offset keeps points off the diagonal walls, where the
// position is still right but either side's reflection is a valid answer and the gradients would differ.
const PARITY_GRID = 64, PARITY_MIN = -3.37, PARITY_MAX = 3.41, PARITY_Y_OFFSET = .01373, PARITY_SECTORS = 7, PARITY_LIMIT = 1e-3, IMAGE_LIMIT = .03;
const parityPoint = i => PARITY_MIN + (i + .5) / PARITY_GRID * (PARITY_MAX - PARITY_MIN);

/** Compares the shader's fold with foldPoint, then checks the textureGrad path against a known texture. */
async function kaleidoscopeParity(entry, modules) {
  const { THREE, SYMMETRY_GROUPS, foldPoint, spiralTau, kaleidoscopeGLSL, kaleidoscopeUniforms, KaleidoscopeRenderer, createLayer } = modules;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  const logs = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...a) => { logs.push(a.join(' ')); original.warn(...a); };
  console.error = (...a) => { logs.push(a.join(' ')); original.error(...a); };
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  scene.add(quad);
  const floatTarget = size => new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  const target = floatTarget(PARITY_GRID);
  const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const uniforms = { uRange: { value: new THREE.Vector3(PARITY_MIN, PARITY_MAX, PARITY_Y_OFFSET) }, uGradients: { value: 0 } };
  for (const [key, value] of Object.entries(kaleidoscopeUniforms(createLayer('kaleidoscope'), 0))) uniforms[key] = { value };
  Object.assign(uniforms, { uKHasImage: { value: 0 }, uKImage: { value: null }, uKImageFit: { value: new THREE.Vector2(1, 1) },
    uKPalette: { value: Array.from({ length: 6 }, () => new THREE.Color()) } });
  const fold = new THREE.ShaderMaterial({ vertexShader, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    fragmentShader: `precision highp float;varying vec2 vUv;uniform vec3 uRange;uniform float uGradients;${kaleidoscopeGLSL}
      void main(){vec2 p=mix(vec2(uRange.x),vec2(uRange.y),vUv)+vec2(0.,uRange.z);vec2 dx=vec2(1.,0.),dy=vec2(0.,1.);
      vec2 q=uKSpiral==1?spiralDomain(p,dx,dy):foldDomain(p,dx,dy);gl_FragColor=uGradients>.5?vec4(dx,dy):vec4(q,0.,1.);}` });
  const groups = {};
  const image = { maxDifference: 0, points: 0 };
  let texture = null, imageTarget = null, kaleidoscope = null;
  try {
    quad.material = fold;
    const pixels = new Float32Array(PARITY_GRID * PARITY_GRID * 4), gradients = new Float32Array(pixels.length);
    for (let g = 0; g < SYMMETRY_GROUPS.length; g++) {
      uniforms.uKGroup.value = g; uniforms.uKSectors.value = PARITY_SECTORS;
      renderer.setRenderTarget(target);
      uniforms.uGradients.value = 0; fold.uniformsNeedUpdate = true; renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, PARITY_GRID, PARITY_GRID, pixels);
      uniforms.uGradients.value = 1; fold.uniformsNeedUpdate = true; renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, PARITY_GRID, PARITY_GRID, gradients);
      let max = 0, maxGradient = 0;
      for (let y = 0; y < PARITY_GRID; y++) for (let x = 0; x < PARITY_GRID; x++) {
        const want = foldPoint(SYMMETRY_GROUPS[g], { x: parityPoint(x), y: parityPoint(y) + PARITY_Y_OFFSET }, PARITY_SECTORS);
        const at = (y * PARITY_GRID + x) * 4;
        const [m00, m01, m10, m11] = want.linear;
        max = Math.max(max, Math.hypot(pixels[at] - want.p.x, pixels[at + 1] - want.p.y));
        maxGradient = Math.max(maxGradient, Math.abs(gradients[at] - m00), Math.abs(gradients[at + 1] - m10),
          Math.abs(gradients[at + 2] - m01), Math.abs(gradients[at + 3] - m11));
      }
      groups[SYMMETRY_GROUPS[g]] = { points: PARITY_GRID * PARITY_GRID, maxDifference: max, maxGradientDifference: maxGradient };
      if (!(max < PARITY_LIMIT) || !(maxGradient < PARITY_LIMIT)) throw new Error(`Fold parity failed for ${SYMMETRY_GROUPS[g]}: position ${max}, gradient ${maxGradient}`);
    }

    // Spiral: tau against spiralTau, and the analytic gradient against a central difference of spiralTau.
    const [spiralA, spiralB, spiralScale] = [1, 2, 4], step = 1e-5;
    Object.assign(uniforms, { uKSpiral: { value: 1 }, uKSpiralA: { value: spiralA }, uKSpiralB: { value: spiralB }, uKSpiralScale: { value: spiralScale } });
    renderer.setRenderTarget(target);
    uniforms.uGradients.value = 0; fold.uniformsNeedUpdate = true; renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, PARITY_GRID, PARITY_GRID, pixels);
    uniforms.uGradients.value = 1; fold.uniformsNeedUpdate = true; renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, PARITY_GRID, PARITY_GRID, gradients);
    let spiralMax = 0, spiralGradient = 0;
    for (let y = 0; y < PARITY_GRID; y++) for (let x = 0; x < PARITY_GRID; x++) {
      const z = { x: parityPoint(x), y: parityPoint(y) + PARITY_Y_OFFSET }, at = (y * PARITY_GRID + x) * 4;
      if (Math.hypot(z.x, z.y) < .2) continue;
      const tau = spiralTau(z, spiralA, spiralB, spiralScale);
      spiralMax = Math.max(spiralMax, Math.hypot(pixels[at] - tau.x, pixels[at + 1] - tau.y));
      // Keep the difference on one side of the branch cut.
      if (Math.abs(z.y) < 10 * step) continue;
      const along = (dx, dy) => { const p = spiralTau({ x: z.x + dx, y: z.y + dy }, spiralA, spiralB, spiralScale), m = spiralTau({ x: z.x - dx, y: z.y - dy }, spiralA, spiralB, spiralScale); return [(p.x - m.x) / (2 * step), (p.y - m.y) / (2 * step)]; };
      const [ax, ay] = along(step, 0), [bx, by] = along(0, step);
      spiralGradient = Math.max(spiralGradient, Math.abs(gradients[at] - ax), Math.abs(gradients[at + 1] - ay), Math.abs(gradients[at + 2] - bx), Math.abs(gradients[at + 3] - by));
    }
    groups.spiral = { maxDifference: spiralMax, maxGradientDifference: spiralGradient };
    if (!(spiralMax < PARITY_LIMIT) || !(spiralGradient < PARITY_LIMIT)) throw new Error(`Spiral parity failed: tau ${spiralMax}, gradient ${spiralGradient}`);
    uniforms.uKSpiral.value = 0;

    // textureGrad path: a small ramp texture stores its own uv, so the output can be checked against the maths.
    const SIZE = 64, data = new Uint8Array(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      data.set([Math.round((x + .5) / SIZE * 255), Math.round((y + .5) / SIZE * 255), 0, 255], (y * SIZE + x) * 4);
    }
    texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.generateMipmaps = true; texture.needsUpdate = true;
    const RENDER = 128;
    imageTarget = floatTarget(RENDER);
    kaleidoscope = new KaleidoscopeRenderer();
    const layer = createLayer('kaleidoscope');
    Object.assign(layer.params, { group: 1, sourceDrift: 0, warpIn: 0, warpOut: 0, cell: 1, sourceScale: 1, sourceX: 0, sourceY: 0, sourceTurn: 0, spiral: 0 });
    kaleidoscope.draw({ layer, phase: 0, width: RENDER, height: RENDER, target: imageTarget, input: texture, history: null, imageAspect: 1,
      draw(material, output) { quad.material = material; renderer.setRenderTarget(output); renderer.render(scene, camera); } });
    const out = new Float32Array(RENDER * RENDER * 4);
    renderer.readRenderTargetPixels(imageTarget, 0, 0, RENDER, RENDER, out);
    for (let y = 0; y < RENDER; y++) for (let x = 0; x < RENDER; x++) {
      const px = (x + .5) / RENDER - .5, py = (y + .5) / RENDER - .5;
      const q = foldPoint('pmm', { x: px, y: py }, 6).p;
      const tri = v => Math.abs(2 * (v - Math.floor(v)) - 1);
      const u = tri(.75 + .5 * q.x), v = tri(.75 + .5 * q.y), at = (y * RENDER + x) * 4;
      image.maxDifference = Math.max(image.maxDifference, Math.abs(out[at] - u), Math.abs(out[at + 1] - v));
      image.points++;
    }
    if (!(image.maxDifference < IMAGE_LIMIT)) throw new Error(`textureGrad path failed: ${image.maxDifference}`);
    const shaderWarnings = logs.filter(line => /shader|program|glsl/i.test(line));
    if (shaderWarnings.length) throw new Error(`Shader warnings: ${shaderWarnings.join(' | ')}`);
    return { id: entry.id, title: entry.title, limit: PARITY_LIMIT, groups, image, shaderWarnings: 0 };
  } finally {
    console.warn = original.warn; console.error = original.error;
    renderer.setRenderTarget(null);
    kaleidoscope?.dispose(); texture?.dispose(); imageTarget?.dispose();
    target.dispose(); fold.dispose(); quad.geometry.dispose(); renderer.dispose();
  }
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
    cases.push(entry.check ? await entry.check(entry, modules) : await measure(entry, config, modules));
  }
  await window.bench.done({ renderer: rendererString, size: config.size, width: config.width, height: config.height,
    frames: config.frames, warmupMs: WARMUP_MS, gpuTimerAvailable: timerAvailable,
    gpuPassMsNote: 'Ordered by draw, possibly CUMULATIVE within a frame on ANGLE/Metal (not confirmed isolated). A pass drawn several times per frame has several samples per frame, so count can exceed frames. Do not pick optimisation targets from it; use fullOutputMs for totals.',
    cases });
}

run().catch(error => window.bench.fail(error && error.stack || error));
