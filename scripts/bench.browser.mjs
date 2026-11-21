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
  cases.push({ id: 'kaleidoscope-inputs', title: 'Kaleidoscope: image, layer below and feedback', check: kaleidoscopeInputs });
  return cases;
}

// 64 x 64 = 4,096 grid points per group. The y offset keeps points off the diagonal walls, where the
// position is still right but either side's reflection is a valid answer and the gradients would differ.
const PARITY_GRID = 64, PARITY_MIN = -3.37, PARITY_MAX = 3.41, PARITY_Y_OFFSET = .01373, PARITY_SECTORS = 7, PARITY_LIMIT = 1e-3, IMAGE_LIMIT = .03;
const parityPoint = i => PARITY_MIN + (i + .5) / PARITY_GRID * (PARITY_MAX - PARITY_MIN);

/** Compares the shader's fold with foldPoint, then checks the textureGrad path against a known texture. */
async function kaleidoscopeParity(entry, modules) {
  const { THREE, SYMMETRY_GROUPS, foldPoint, spiralTau, parityAverage, kaleidoscopeGLSL, kaleidoscopeUniforms, KaleidoscopeRenderer, createLayer } = modules;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  const logs = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...a) => { logs.push(a.join(' ')); original.warn(...a); };
  console.error = (...a) => { logs.push(a.join(' ')); original.error(...a); };
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  scene.add(quad);
  const floatTarget = (width, height = width) => new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, format: THREE.RGBAFormat,
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
  const spiralCentre = [];
  let texture = null, imageTarget = null, centreTarget = null, kaleidoscope = null;
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

    // An odd frame puts a pixel centre exactly on the spiral centre. Its footprint must stay large,
    // so it resolves to the same average as its neighbours instead of one unfiltered sample.
    const CENTRE_W = 961, CENTRE_H = 541, CENTRE_LIMIT = .02, block = new Float32Array(9 * 4);
    centreTarget = floatTarget(CENTRE_W, CENTRE_H);
    for (const source of ['lines', 'squares', 'parity', 'texture']) for (const [a, b] of [[1, 2], [2, 3]]) {
      const centreLayer = createLayer('kaleidoscope');
      Object.assign(centreLayer.params, { spiral: 1, spiralA: a, spiralB: b, sourceDrift: 0, warpIn: 0, warpOut: 0, motif: Math.max(0, ['lines', 'squares', 'parity'].indexOf(source)) });
      kaleidoscope.draw({ layer: centreLayer, phase: TAU * .3, width: CENTRE_W, height: CENTRE_H, target: centreTarget, input: source === 'texture' ? texture : null, history: null, imageAspect: 1,
        draw(material, output) { quad.material = material; renderer.setRenderTarget(output); renderer.render(scene, camera); } });
      renderer.readRenderTargetPixels(centreTarget, (CENTRE_W - 1) / 2 - 1, (CENTRE_H - 1) / 2 - 1, 3, 3, block);
      let difference = 0;
      for (let c = 0; c < 3; c++) {
        let around = 0;
        for (let i = 0; i < 9; i++) if (i !== 4) around += block[i * 4 + c] / 8;
        difference = Math.max(difference, Math.abs(block[4 * 4 + c] - around));
      }
      const entry = { source, a, b, difference };
      if (source === 'parity') {
        // The centre must land on the true parity average for this phase, not just match its neighbours.
        const { coverage, ink } = parityAverage(kaleidoscopeUniforms(centreLayer, .3).uKPhase);
        const [ground, first, second] = [5, 4, 2].map(i => new THREE.Color(centreLayer.palette[i]));
        const want = ['r', 'g', 'b'].map(k => ground[k] * (1 - coverage) + first[k] * (coverage - ink) + second[k] * ink);
        entry.averageDifference = Math.max(...want.map((v, c) => Math.abs(block[4 * 4 + c] - v)));
        if (!(entry.averageDifference < 1e-3)) throw new Error(`Parity average mismatch: ${JSON.stringify(entry)}`);
      }
      spiralCentre.push(entry);
    }
    const worstCentre = spiralCentre.reduce((x, y) => y.difference > x.difference ? y : x);
    if (!(worstCentre.difference < CENTRE_LIMIT)) throw new Error(`Spiral centre speck: ${JSON.stringify(worstCentre)}`);
    const shaderWarnings = logs.filter(line => /shader|program|glsl/i.test(line));
    if (shaderWarnings.length) throw new Error(`Shader warnings: ${shaderWarnings.join(' | ')}`);
    return { id: entry.id, title: entry.title, limit: PARITY_LIMIT, groups, image, spiralCentre, shaderWarnings: 0 };
  } finally {
    console.warn = original.warn; console.error = original.error;
    renderer.setRenderTarget(null);
    kaleidoscope?.dispose(); texture?.dispose(); imageTarget?.dispose(); centreTarget?.dispose();
    target.dispose(); fold.dispose(); quad.geometry.dispose(); renderer.dispose();
  }
}

// A generated test card: asymmetric, so a wrong flip or stretch shows, with one see-through corner.
function testCard(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const c = canvas.getContext('2d');
  const ramp = c.createLinearGradient(0, 0, width, height);
  ramp.addColorStop(0, '#12307a'); ramp.addColorStop(.5, '#e0457b'); ramp.addColorStop(1, '#ffd34d');
  c.fillStyle = ramp; c.fillRect(0, 0, width, height);
  c.fillStyle = '#ffffff'; c.font = `700 ${Math.round(height * .62)}px sans-serif`; c.textBaseline = 'middle';
  c.fillText('F', width * .5 - height * .2, height * .54);
  c.fillStyle = '#17c9a5'; c.beginPath(); c.arc(height * .24, height * .26, height * .15, 0, Math.PI * 2); c.fill();
  c.clearRect(width - height * .2, 0, height * .2, height * .2);
  return { name: 'test-card.png', dataUrl: canvas.toDataURL('image/png'), width, height, fit: 'cover' };
}

const INPUT_W = 480, INPUT_H = 270, LOOP_FRAMES = 60, ENERGY_FRAMES = 1000, ENERGY_SIZE = 128, CUT_SIZE = 512;
const luma = (px, i) => .2126 * px[i] + .7152 * px[i + 1] + .0722 * px[i + 2];
function pictureStats(px) {
  let sum = 0, square = 0, alpha = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) { const l = luma(px, i); sum += l; square += l * l; alpha = Math.max(alpha, px[i + 3]); }
  const mean = sum / n;
  return { mean, deviation: Math.sqrt(Math.max(0, square / n - mean * mean)), maxAlpha: alpha };
}
function closeShare(a, b, limit) {
  let close = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3])) <= limit) close++;
  }
  return close / (a.length / 4);
}
function largestDifference(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

/** Drives the real renderer through every input, then checks loops, energy and the spiral branch cut. */
async function kaleidoscopeInputs(entry, modules, config) {
  const { THREE, StudioRenderer, KaleidoscopeRenderer, createProject, createLayer } = modules;
  const logs = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...a) => { logs.push(a.join(' ')); original.warn(...a); };
  console.error = (...a) => { logs.push(a.join(' ')); original.error(...a); };
  const canvas = document.createElement('canvas');
  const studio = new StudioRenderer(canvas);
  const floatTarget = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  const halfTarget = size => new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
  const readTarget = floatTarget(INPUT_W, INPUT_H), energyRead = floatTarget(ENERGY_SIZE, ENERGY_SIZE), cutTarget = floatTarget(CUT_SIZE, CUT_SIZE);
  const energyA = halfTarget(ENERGY_SIZE), energyB = halfTarget(ENERGY_SIZE);
  const fold = new KaleidoscopeRenderer();
  let ramp = null;
  const copyTo = (texture, rt, buffer) => {
    studio.copy.uniforms.uImage.value = texture; studio.draw(studio.copy, rt);
    studio.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buffer);
    return buffer;
  };
  const frame = (project, phase = 0) => {
    studio.exactFeedback = true;
    studio.renderFrame(project, phase, INPUT_W, INPUT_H);
    return copyTo(studio.linearOutput.texture, readTarget, new Float32Array(INPUT_W * INPUT_H * 4)).slice();
  };
  const kLayer = (params = {}, image) => {
    const layer = createLayer('kaleidoscope');
    Object.assign(layer.params, { sourceDrift: .15 }, params);
    if (image) layer.image = { ...image };
    return layer;
  };
  const projectOf = (layers, extra = {}) => Object.assign(createProject(), { id: 'bench-inputs', seed: 1729, duration: 2, fps: { num: 30, den: 1 },
    transparent: false, background: '#000000', tileEdges: false, layers }, extra);
  const save = async (name, project, phase = TAU * .2) => {
    if (!config.images) return;
    const bytes = await studio.exportPNG(project, phase, 960, 540);
    let text = '';
    for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
    await window.bench.image(name, btoa(text));
  };

  try {
    const card = testCard(640, 360), square = testCard(512, 512);
    const under = () => { const layer = createLayer('surface'); layer.params.seed = 11; return layer; };
    const pictures = {
      'image-fold': projectOf([kLayer({ input: 1 }, card)]),
      'image-spiral': projectOf([kLayer({ input: 1, spiral: 1 }, square)]),
      'image-lattice-contain': projectOf([kLayer({ input: 1, group: 1, sourceDrift: 0 }, { ...card, fit: 'contain' })], { background: '#20242c' }),
      below: projectOf([under(), kLayer({ input: 2 })]),
      'below-spiral': projectOf([under(), kLayer({ input: 2, spiral: 1 })]),
      feedback: projectOf([kLayer({ input: 3, echo: .9, sourceDrift: .4, motif: 1, lineWidth: 1 })]),
      'feedback-spiral': projectOf([kLayer({ input: 3, echo: .9, spiral: 1, motif: 0, lineWidth: 1 })]),
    };
    const rendered = {};
    for (const [name, project] of Object.entries(pictures)) {
      await studio.prepare(project);
      const stats = pictureStats(frame(project, TAU * .2));
      rendered[name] = stats;
      if (!(stats.mean > .01 && stats.deviation > .01)) throw new Error(`${name} rendered empty: ${JSON.stringify(stats)}`);
      await save(name, project);
    }

    // The picture must really arrive: the folded image differs from the motif it would fall back to.
    const motifProject = projectOf([kLayer({ input: 0 })]);
    await studio.prepare(motifProject);
    const motif = frame(motifProject, TAU * .2);
    await studio.prepare(pictures['image-fold']);
    const imageVsMotif = largestDifference(frame(pictures['image-fold'], TAU * .2), motif);
    if (!(imageVsMotif > .2)) throw new Error(`The image input shows the motif: ${imageVsMotif}`);

    // Missing, not yet loaded and undecodable pictures all show the motif and never throw.
    const fallbacks = {};
    const missing = projectOf([kLayer({ input: 1 })]);
    await studio.prepare(missing);
    fallbacks.missing = largestDifference(frame(missing, TAU * .2), motif);
    const loading = projectOf([kLayer({ input: 1 }, testCard(64, 64))]);
    fallbacks.loading = largestDifference(frame(loading, TAU * .2), motif);
    const broken = projectOf([kLayer({ input: 1 }, { ...card, dataUrl: 'data:image/png;base64,AAAA' })]);
    await studio.prepare(broken);
    fallbacks.undecodable = largestDifference(frame(broken, TAU * .2), motif);
    for (const [name, value] of Object.entries(fallbacks)) if (!(value < 1e-3)) throw new Error(`${name} image did not show the motif: ${value}`);

    // The bottom layer on the below input is transparent black, whatever the palette.
    const bottom = projectOf([kLayer({ input: 2 })], { transparent: true });
    await studio.prepare(bottom);
    const empty = frame(bottom, TAU * .2);
    const emptyMax = empty.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    if (!(emptyMax < 1e-4)) throw new Error(`The empty mode is not empty: ${emptyMax}`);
    await save('below-bottom-empty', bottom);

    // Contain keeps the picture's shape, with clear bars; cover fills the tile.
    const fitAt = (px, x, y) => px[(Math.round((y + .5) * INPUT_H) * INPUT_W + Math.round(x * INPUT_H + INPUT_W / 2)) * 4 + 3];
    const fitLayer = fit => projectOf([kLayer({ input: 1, group: 1, sourceDrift: 0 }, { ...card, fit })], { transparent: true });
    const contain = fitLayer('contain'), cover = fitLayer('cover');
    await studio.prepare(contain);
    const containPx = frame(contain), coverPx = frame(cover);
    const fits = { containBar: fitAt(containPx, 0, .4), containPicture: fitAt(containPx, 0, .1), coverSameSpot: fitAt(coverPx, 0, .4) };
    if (!(fits.containBar < .01 && fits.containPicture > .99 && fits.coverSameSpot > .99)) throw new Error(`Image fit failed: ${JSON.stringify(fits)}`);

    // The capture exists only while used, and echo on this input is ignored rather than half-applied.
    const belowEcho = projectOf([under(), kLayer({ input: 2, echo: .7 })]);
    await studio.prepare(belowEcho);
    const withoutEcho = frame(projectOf([belowEcho.layers[0], { ...belowEcho.layers[1], params: { ...belowEcho.layers[1].params, echo: 0 } }]), TAU * .2);
    const withEcho = frame(belowEcho, TAU * .2);
    const belowLifetime = { held: studio.belowCapture !== null, echoStates: studio.feedbackStates.size, echoDifference: largestDifference(withEcho, withoutEcho) };
    frame(motifProject, TAU * .2);
    belowLifetime.released = studio.belowCapture === null;
    if (!belowLifetime.held || !belowLifetime.released || belowLifetime.echoStates !== 0 || !(belowLifetime.echoDifference < 1e-3)) throw new Error(`Below capture: ${JSON.stringify(belowLifetime)}`);

    // Loops: the frame after the last equals the first, including with held echo set.
    const loops = {};
    for (const [name, params] of Object.entries({
      fold: { echo: .9, sourceDrift: .4 }, longest: { echo: 1, sourceDrift: .4 },
      heldEchoSet: { echo: 1, echoKeep: 1, echoZoom: 1.02, sourceDrift: .4 }, spiral: { echo: .9, spiral: 1 },
    })) {
      const project = projectOf([kLayer({ input: 3, ...params })]);
      await studio.prepare(project);
      const first = frame(project, 0);
      let midLoop = 0;
      for (let i = 1; i < LOOP_FRAMES; i++) {
        if (i === LOOP_FRAMES / 2) midLoop = largestDifference(first, frame(project, i / LOOP_FRAMES * TAU));
        else { studio.exactFeedback = true; studio.renderFrame(project, i / LOOP_FRAMES * TAU, INPUT_W, INPUT_H); }
      }
      const last = frame(project, 0);
      loops[name] = { within1of255: closeShare(first, last, 1 / 255), maxDifference: largestDifference(first, last), midLoopDifference: midLoop };
      if (!(loops[name].within1of255 >= .999)) throw new Error(`Feedback loop ${name} did not close: ${JSON.stringify(loops[name])}`);
      // A frozen picture would close trivially, so the middle of the loop must really differ.
      if (!(midLoop > .05)) throw new Error(`Feedback loop ${name} does not move: ${JSON.stringify(loops[name])}`);
    }

    // Energy, from a full-white history at the highest gain. With a held motif the map is monotone,
    // so each frame must be no brighter than the one before; a moving motif must stay under the seed.
    const energy = {};
    for (const [name, moving] of [['heldMotif', false], ['movingMotif', true]]) {
      const layer = kLayer({ input: 3, echo: 1, sourceDrift: .4, group: 1 });
      studio.renderer.setRenderTarget(energyA); studio.renderer.setClearColor(0xffffff, 1); studio.renderer.clear(); studio.renderer.setClearColor(0, 0);
      const buffer = new Float32Array(ENERGY_SIZE * ENERGY_SIZE * 4);
      const seed = pictureStats(copyTo(energyA.texture, energyRead, buffer)).mean;
      let [from, to] = [energyA, energyB], previous = seed, largestRise = -Infinity, peak = -Infinity, final = seed;
      for (let i = 0; i < ENERGY_FRAMES; i++) {
        fold.draw({ layer, phase: moving ? (i % LOOP_FRAMES) / LOOP_FRAMES * TAU : TAU * .2, width: ENERGY_SIZE, height: ENERGY_SIZE, target: to,
          draw: (m, t) => studio.draw(m, t), input: null, history: from.texture, imageAspect: 1, mode: 'feedback' });
        final = pictureStats(copyTo(to.texture, energyRead, buffer)).mean;
        largestRise = Math.max(largestRise, final - previous); peak = Math.max(peak, final); previous = final;
        [from, to] = [to, from];
      }
      energy[name] = { frames: ENERGY_FRAMES, seed, peak, final, largestRise };
      if (!(peak <= seed + 1e-3)) throw new Error(`Feedback gained energy: ${JSON.stringify(energy[name])}`);
      if (!moving && !(largestRise <= 1e-3)) throw new Error(`Feedback brightened: ${JSON.stringify(energy[name])}`);
    }

    // Spiral branch cut: the step across the negative x axis, against the same step on the positive x axis.
    const SIZE = 64, data = new Uint8Array(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) data.set([Math.round((x + .5) / SIZE * 255), Math.round((y + .5) / SIZE * 255), 128, 255], (y * SIZE + x) * 4);
    ramp = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    ramp.minFilter = THREE.LinearMipmapLinearFilter; ramp.magFilter = THREE.LinearFilter; ramp.generateMipmaps = true; ramp.needsUpdate = true;
    const branchCut = [];
    for (const [a, b] of [[1, 2], [2, 3], [-1, 2], [3, 1]]) {
      const layer = kLayer({ spiral: 1, spiralA: a, spiralB: b, sourceDrift: 0, zoomCycles: 0 });
      fold.draw({ layer, phase: 0, width: CUT_SIZE, height: CUT_SIZE, target: cutTarget, draw: (m, t) => studio.draw(m, t), input: ramp, history: null, imageAspect: 1, mode: 'image' });
      const px = new Float32Array(CUT_SIZE * CUT_SIZE * 4);
      studio.renderer.readRenderTargetPixels(cutTarget, 0, 0, CUT_SIZE, CUT_SIZE, px);
      const stepAt = x => {
        const low = ((CUT_SIZE / 2 - 1) * CUT_SIZE + x) * 4, high = (CUT_SIZE / 2 * CUT_SIZE + x) * 4;
        return Math.max(Math.abs(px[low] - px[high]), Math.abs(px[low + 1] - px[high + 1]));
      };
      let negative = 0, positive = 0;
      for (let d = 41; d < CUT_SIZE / 2 - 1; d++) { negative = Math.max(negative, stepAt(CUT_SIZE / 2 - 1 - d)); positive = Math.max(positive, stepAt(CUT_SIZE / 2 + d)); }
      branchCut.push({ a, b, negativeAxisMax: negative, positiveAxisMax: positive });
      if (!(negative <= 1.5 * positive + .005)) throw new Error(`Spiral seam on the branch cut: ${JSON.stringify(branchCut.at(-1))}`);
    }

    const shaderWarnings = logs.filter(line => /shader|program|glsl|feedback loop/i.test(line));
    if (shaderWarnings.length) throw new Error(`Shader warnings: ${shaderWarnings.join(' | ')}`);
    return { id: entry.id, title: entry.title, rendered, imageVsMotif, fallbacks, emptyMax, fits, belowLifetime, loops, energy, branchCut, shaderWarnings: 0 };
  } finally {
    console.warn = original.warn; console.error = original.error;
    studio.renderer.setRenderTarget(null);
    fold.dispose(); ramp?.dispose();
    for (const rt of [readTarget, energyRead, cutTarget, energyA, energyB]) rt.dispose();
    studio.dispose();
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
    cases.push(entry.check ? await entry.check(entry, modules, config) : await measure(entry, config, modules));
  }
  await window.bench.done({ renderer: rendererString, size: config.size, width: config.width, height: config.height,
    frames: config.frames, warmupMs: WARMUP_MS, gpuTimerAvailable: timerAvailable,
    gpuPassMsNote: 'Ordered by draw, possibly CUMULATIVE within a frame on ANGLE/Metal (not confirmed isolated). A pass drawn several times per frame has several samples per frame, so count can exceed frames. Do not pick optimisation targets from it; use fullOutputMs for totals.',
    cases });
}

run().catch(error => window.bench.fail(error && error.stack || error));
