// Acceptance proof for the Kaleidoscope. Every picture comparison is in linear RGBA16F, read back at
// native size. A timing gate has three results, because a miss on a busy machine proves nothing:
//   PASS        the limit was met (load can only make a timing worse)
//   FAIL        the limit was missed on a quiet machine, or a picture gate missed
//   NOT_PROVEN  the limit was missed while other work was competing for the machine
const TAU = Math.PI * 2;
const LIMIT_255 = 1 / 255;
const WARMUP_MS = 2500, BATCH = 25, TIMING_FRAMES = 360, BATCH_MEAN = 5;
const BUDGET_MS = 8, STABILITY_RATIO = 1.25, REPEAT_TOLERANCE = .05, LOOP_SHARE = .999;
// Above this one-minute load, or with another GPU process this busy, the machine is not quiet.
const QUIET_LOAD = 2, GPU_BUSY_PERCENT = 5;
const FEED_W = 1920, FEED_H = 1080, OUTPUT_W = 3840, OUTPUT_H = 2160;
const FOLD_W = 480, FOLD_H = 270, REFERENCE = 16, TILE_W = 1920, TILE_H = 1080, PICTURE = 2048;
const CENTRE_W = 961, CENTRE_H = 541, CENTRE_FRAMES = 48;
const LOOP_W = 480, LOOP_H = 270, LOOP_FRAMES = 60, FINITE_W = 255, FINITE_H = 143;

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const note = text => window.bench.note(text);

/** Half-float bits to numbers. One table is far cheaper than a call per channel of a 33 MP reference. */
function halfTable(THREE) {
  const table = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) table[i] = THREE.DataUtils.fromHalfFloat(i);
  return table;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}
const mean = values => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

// A timing result can only be trusted as a miss when nothing else was competing.
function timingStatus(met, loaded) { return met ? 'PASS' : loaded ? 'NOT_PROVEN' : 'FAIL'; }

function gpuStage(THREE) {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  const draw = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(scene, camera); };
  const target = (width, height) => {
    const result = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    result.texture.colorSpace = THREE.NoColorSpace;
    return result;
  };
  const dispose = () => { renderer.setRenderTarget(null); quad.geometry.dispose(); renderer.dispose(); };
  return { renderer, draw, target, dispose };
}

/** A picture with the same sampler state the Studio gives an imported image. */
function pictureTexture(THREE, renderer, paint) {
  const data = new Uint8Array(PICTURE * PICTURE * 4);
  for (let y = 0; y < PICTURE; y++) for (let x = 0; x < PICTURE; x++) {
    const [r, g, b] = paint((x + .5) / PICTURE, (y + .5) / PICTURE), at = (y * PICTURE + x) * 4;
    data[at] = r * 255 + .5; data[at + 1] = g * 255 + .5; data[at + 2] = b * 255 + .5; data[at + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, PICTURE, PICTURE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

// Smooth everywhere, so no edge can sit on a mirror, with detail crossing every mirror obliquely.
// The finest term is about three output pixels across at the size the fold gate renders.
const WAVES = [[3, 2, .2, .4], [13, 7, .16, 1.1], [-9, 17, .14, 2.3], [23, -11, .1, .7], [31, 19, .07, 3.9], [-47, 29, .05, 5.2]];
function obliqueDetail(u, v) {
  const channel = shift => {
    let sum = .5;
    for (const [fx, fy, amount, offset] of WAVES) sum += amount * Math.sin(TAU * (fx * u + fy * v) + offset + shift);
    return Math.min(1, Math.max(0, sum));
  };
  return [channel(0), channel(1.7), channel(3.9)];
}

// A second, unrelated picture with a broader spectrum: thin soft lines at two oblique angles over soft dots.
function linesAndDots(u, v) {
  const line = (a, b, period, width) => { const t = (a * u + b * v) / period; const d = Math.abs(t - Math.floor(t) - .5) * period; return 1 - Math.min(1, Math.max(0, (d - width) / .004)); };
  const first = line(.83, .56, .071, .006), second = line(-.38, .92, .053, .004);
  let dots = 0;
  for (let i = 0; i < 14; i++) {
    const x = (i * .618034 + .11) % 1, y = (i * .754878 + .37) % 1, d = Math.hypot(u - x, v - y);
    dots = Math.max(dots, 1 - Math.min(1, Math.max(0, (d - .035 - .012 * (i % 3)) / .006)));
  }
  return [Math.min(1, .12 + .7 * first + .3 * dots), Math.min(1, .1 + .65 * second + .45 * dots), Math.min(1, .2 + .35 * first + .35 * second + .2 * dots)];
}

// The plate's own centre is far outside the picture, so the centre zone and the ring read the same
// band (about 120 to 170 cycles per tile, 3 to 4.5 output pixels). With the plate's centre nearby, one
// zone sits on coarser or finer rings than the other and the variance compares the picture, not the filter.
function zonePlate(u, v) {
  const du = u + 1.2, dv = v + .9, value = .5 + .5 * Math.cos(TAU * 35 * (du * du + dv * dv));
  return [value, value, value];
}

// Negative controls: the footprint is thrown away near the centre, the defect this gate exists to catch.
const BROKEN_CENTRE = {
  spiral: ['vec2 inverse = r2 < 1e-12 ? vec2(1e6, 0.) : vec2(z.x, -z.y) / r2;', 'vec2 inverse = r2 < .02 ? vec2(0.) : vec2(z.x, -z.y) / r2;'],
  fold: ['vec2 tapX = .5 * dx, tapY = .5 * dy;', 'float keep = step(.14, length(p)); vec2 tapX = .5 * dx * keep, tapY = .5 * dy * keep;'],
};

const FOLD_VIEW = { cell: .53, turn: .41, x: .013, y: .007 };

/** Marks pixels whose footprint crosses a mirror, from the verified maths rather than the shader. */
function foldMask(modules, groupName, sectors) {
  const { foldPoint } = modules;
  const c = Math.cos(FOLD_VIEW.turn), s = Math.sin(FOLD_VIEW.turn), aspect = FOLD_W / FOLD_H;
  const side = key => {
    const x = key.x, y = key.y;
    const fx = (x - .5) * aspect - FOLD_VIEW.x, fy = y - .5 - FOLD_VIEW.y;
    const folded = foldPoint(groupName, { x: (c * fx - s * fy) / FOLD_VIEW.cell, y: (s * fx + c * fy) / FOLD_VIEW.cell }, sectors);
    const wave = v => { const t = .75 + .5 * v; return t - Math.floor(t) > .5 ? 1 : 0; };
    return `${folded.linear.map(v => v.toFixed(5)).join()}|${wave(folded.p.x)}${wave(folded.p.y)}`;
  };
  const mask = new Uint8Array(FOLD_W * FOLD_H);
  for (let y = 0; y < FOLD_H; y++) for (let x = 0; x < FOLD_W; x++) {
    const first = side({ x: (x + .5) / FOLD_W, y: (y + .5) / FOLD_H });
    search: for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) {
      if (side({ x: (x + i / 4) / FOLD_W, y: (y + j / 4) / FOLD_H }) !== first) { mask[y * FOLD_W + x] = 1; break search; }
    }
  }
  return mask;
}

function dilate(mask, radius) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < FOLD_H; y++) for (let x = 0; x < FOLD_W; x++) {
    if (!mask[y * FOLD_W + x]) continue;
    for (let b = Math.max(0, y - radius); b <= Math.min(FOLD_H - 1, y + radius); b++)
      for (let a = Math.max(0, x - radius); a <= Math.min(FOLD_W - 1, x + radius); a++) out[b * FOLD_W + a] = 1;
  }
  return out;
}

async function foldQuality(modules) {
  const { THREE, SYMMETRY_GROUPS, KaleidoscopeRenderer, createLayer, kaleidoscopeGLSL } = modules;
  const stage = gpuStage(THREE), half = halfTable(THREE);
  const pictures = { oblique: pictureTexture(THREE, stage.renderer, obliqueDetail), 'lines-dots': pictureTexture(THREE, stage.renderer, linesAndDots) };
  const kaleidoscope = new KaleidoscopeRenderer();
  const nativeTarget = stage.target(FOLD_W, FOLD_H), tileTarget = stage.target(TILE_W, TILE_H);
  const nativeBits = new Uint16Array(FOLD_W * FOLD_H * 4), tileBits = new Uint16Array(TILE_W * TILE_H * 4);
  let reference = null;
  const groups = {};
  try {
    for (const [pictureName, texture] of Object.entries(pictures)) for (let g = 0; g < SYMMETRY_GROUPS.length; g++) {
      const name = SYMMETRY_GROUPS[g], layer = createLayer('kaleidoscope');
      Object.assign(layer.params, { input: 1, group: g, sectors: 7, cell: FOLD_VIEW.cell, sourceTurn: FOLD_VIEW.turn, sourceX: FOLD_VIEW.x, sourceY: FOLD_VIEW.y,
        sourceDrift: 0, warpIn: 0, warpOut: 0, spiral: 0 });
      kaleidoscope.draw({ layer, phase: 0, width: FOLD_W, height: FOLD_H, target: nativeTarget, input: texture, history: null, imageAspect: 1, mode: 'image', draw: stage.draw });
      stage.renderer.readRenderTargetPixels(nativeTarget, 0, 0, FOLD_W, FOLD_H, nativeBits);
      const material = kaleidoscope.material;
      if (material.uniforms.uView.value.elements.some((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) > 1e-9)) throw new Error('The fold gate expects an identity view.');
      reference ??= new THREE.ShaderMaterial({ vertexShader: material.vertexShader, uniforms: { ...material.uniforms, uTile: { value: new THREE.Vector4() } },
        depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
        fragmentShader: `precision highp float;varying vec2 vUv;uniform mat3 uView;uniform float uAspect;uniform vec4 uTile;${kaleidoscopeGLSL}
          void main(){vec2 uv=uTile.xy+vUv*uTile.zw;vec2 frame=((uView*vec3(uv,1.)).xy-.5)*vec2(uAspect,1.);gl_FragColor=kaleidoscopeColor(frame,dFdx(frame),dFdy(frame));}` });
      reference.uniformsNeedUpdate = true;

      // 16 x 16 samples per output pixel, in 1080p tiles, box filtered down to native size.
      const sum = new Float64Array(FOLD_W * FOLD_H * 3);
      const columns = FOLD_W * REFERENCE / TILE_W, rows = FOLD_H * REFERENCE / TILE_H;
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        reference.uniforms.uTile.value.set(column / columns, row / rows, 1 / columns, 1 / rows);
        reference.uniformsNeedUpdate = true;
        stage.draw(reference, tileTarget);
        stage.renderer.readRenderTargetPixels(tileTarget, 0, 0, TILE_W, TILE_H, tileBits);
        for (let y = 0; y < TILE_H; y++) {
          const outY = Math.floor((row * TILE_H + y) / REFERENCE);
          for (let x = 0; x < TILE_W; x++) {
            const at = (outY * FOLD_W + Math.floor((column * TILE_W + x) / REFERENCE)) * 3, from = (y * TILE_W + x) * 4;
            sum[at] += half[tileBits[from]]; sum[at + 1] += half[tileBits[from + 1]]; sum[at + 2] += half[tileBits[from + 2]];
          }
        }
        await tick();
      }

      const crossing = foldMask(modules, name, 7), band = dilate(crossing, 1), near = dilate(crossing, 3);
      const foldErrors = [], cleanErrors = [], samples = REFERENCE * REFERENCE;
      for (let i = 0; i < FOLD_W * FOLD_H; i++) {
        const error = Math.max(Math.abs(half[nativeBits[i * 4]] - sum[i * 3] / samples),
          Math.abs(half[nativeBits[i * 4 + 1]] - sum[i * 3 + 1] / samples), Math.abs(half[nativeBits[i * 4 + 2]] - sum[i * 3 + 2] / samples));
        if (band[i]) foldErrors.push(error);
        else if (!near[i]) cleanErrors.push(error);
      }
      const row = { foldPixels: foldErrors.length, cleanPixels: cleanErrors.length,
        foldMean: mean(foldErrors), cleanMean: mean(cleanErrors), foldP95: percentile(foldErrors, .95), cleanP95: percentile(cleanErrors, .95) };
      row.meanExcess = row.foldMean - row.cleanMean;
      row.p95Excess = row.foldP95 - row.cleanP95;
      // Two-sided: a line sharper than its surroundings is as visible as one that is worse.
      row.met = foldErrors.length > 0 && cleanErrors.length > 0 && Math.abs(row.meanExcess) <= LIMIT_255 && Math.abs(row.p95Excess) <= LIMIT_255;
      groups[`${pictureName}/${name}`] = row;
      await note(`fold ${pictureName}/${name}: mean excess ${(row.meanExcess * 255).toFixed(3)}/255, p95 excess ${(row.p95Excess * 255).toFixed(3)}/255`);
    }
  } finally {
    reference?.dispose(); kaleidoscope.dispose(); for (const texture of Object.values(pictures)) texture.dispose(); nativeTarget.dispose(); tileTarget.dispose(); stage.dispose();
  }
  const rows = Object.values(groups);
  return { id: 'fold-quality', name: 'Fold quality', kind: 'picture', limit: 'mean and p95 fold-line error within 1/255 of non-fold pixels, either way, 16x16 reference, 5 groups, 2 pictures',
    value: Math.max(...rows.map(r => Math.max(Math.abs(r.meanExcess), Math.abs(r.p95Excess)))) * 255, unit: '/255 worst absolute difference', status: rows.every(r => r.met) ? 'PASS' : 'FAIL', groups };
}

async function centreGate(modules) {
  const { THREE, KaleidoscopeRenderer, createLayer, kaleidoscopeFragment } = modules;
  const stage = gpuStage(THREE), half = halfTable(THREE);
  const texture = pictureTexture(THREE, stage.renderer, zonePlate);
  const kaleidoscope = new KaleidoscopeRenderer();
  const target = stage.target(CENTRE_W, CENTRE_H), bits = new Uint16Array(CENTRE_W * CENTRE_H * 4);
  const fine = stage.target(CENTRE_W * 4, CENTRE_H * 4), fineBits = new Uint16Array(CENTRE_W * CENTRE_H * 64);
  const radius = Math.sqrt(.05 * CENTRE_W * CENTRE_H / Math.PI);
  const cases = [
    ...[0, 1, 2, 3, 4].map(group => ({ name: `group-${group}`, params: { group, sectors: group ? 6 : 7, spiral: 0 } })),
    { name: 'rosette-12', params: { group: 0, sectors: 12, spiral: 0 } },
    { name: 'spiral-1-2', params: { spiral: 1, spiralA: 1, spiralB: 2, zoomCycles: 1 } },
    { name: 'spiral-2-3', params: { spiral: 1, spiralA: 2, spiralB: 3, zoomCycles: 1 } },
  ];
  const results = {}, controls = {};
  const broken = new KaleidoscopeRenderer();
  const allCases = [...cases, { name: 'control-broken-spiral', control: 'spiral', params: cases[6].params }, { name: 'control-broken-fold', control: 'fold', params: cases[0].params }];
  try {
    for (const item of allCases) {
      const layer = createLayer('kaleidoscope');
      Object.assign(layer.params, { input: 1, sourceDrift: 0, warpIn: 0, warpOut: 0 }, item.params);
      const renderer = item.control ? broken : kaleidoscope;
      if (item.control) {
        renderer.draw({ layer, phase: 0, width: 16, height: 16, target, input: texture, history: null, imageAspect: 1, mode: 'image', draw: () => {} });
        const [from, to] = BROKEN_CENTRE[item.control];
        if (!kaleidoscopeFragment.includes(from)) throw new Error(`The ${item.control} control no longer matches the shader.`);
        renderer.material.fragmentShader = kaleidoscopeFragment.replace(from, to);
        renderer.material.needsUpdate = true;
      }
      const sum = new Float64Array(CENTRE_W * CENTRE_H), square = new Float64Array(CENTRE_W * CENTRE_H);
      const trueSum = new Float64Array(CENTRE_W * CENTRE_H), trueSquare = new Float64Array(CENTRE_W * CENTRE_H);
      for (let f = 0; f < CENTRE_FRAMES; f++) {
        const t = f / CENTRE_FRAMES;
        // A turn about the exact centre, on an odd-sized frame so one pixel sits on the singular point.
        Object.assign(layer.params, { sourceTurn: t * TAU - Math.PI, sourceX: 0, sourceY: 0 });
        renderer.draw({ layer, phase: t * TAU, width: CENTRE_W, height: CENTRE_H, target, input: texture, history: null, imageAspect: 1, mode: 'image', draw: stage.draw });
        stage.renderer.readRenderTargetPixels(target, 0, 0, CENTRE_W, CENTRE_H, bits);
        for (let i = 0; i < sum.length; i++) {
          const l = .2126 * half[bits[i * 4]] + .7152 * half[bits[i * 4 + 1]] + .0722 * half[bits[i * 4 + 2]];
          sum[i] += l; square[i] += l * l;
        }
        // The same frame at 4 x 4 samples per pixel: what the picture itself does under this motion.
        renderer.draw({ layer, phase: t * TAU, width: CENTRE_W * 4, height: CENTRE_H * 4, target: fine, input: texture, history: null, imageAspect: 1, mode: 'image', draw: stage.draw });
        stage.renderer.readRenderTargetPixels(fine, 0, 0, CENTRE_W * 4, CENTRE_H * 4, fineBits);
        const box = new Float64Array(CENTRE_W * CENTRE_H);
        for (let y = 0; y < CENTRE_H * 4; y++) for (let x = 0; x < CENTRE_W * 4; x++) {
          const at = (y * CENTRE_W * 4 + x) * 4;
          box[(y >> 2) * CENTRE_W + (x >> 2)] += (.2126 * half[fineBits[at]] + .7152 * half[fineBits[at + 1]] + .0722 * half[fineBits[at + 2]]) / 16;
        }
        for (let i = 0; i < box.length; i++) { trueSum[i] += box[i]; trueSquare[i] += box[i] * box[i]; }
        if (f % 8 === 7) await tick();
      }
      const trueInner = [], trueRing = [];
      const inner = [], ring = [];
      for (let y = 0; y < CENTRE_H; y++) for (let x = 0; x < CENTRE_W; x++) {
        const d = Math.hypot(x - (CENTRE_W - 1) / 2, y - (CENTRE_H - 1) / 2);
        if (d > 2 * radius) continue;
        const i = y * CENTRE_W + x, m = sum[i] / CENTRE_FRAMES, variance = Math.max(0, square[i] / CENTRE_FRAMES - m * m);
        (d <= radius ? inner : ring).push(variance);
        const tm = trueSum[i] / CENTRE_FRAMES;
        (d <= radius ? trueInner : trueRing).push(Math.max(0, trueSquare[i] / CENTRE_FRAMES - tm * tm));
      }
      const row = { centreMean: mean(inner), ringMean: mean(ring), centreMax: Math.max(...inner), ringMax: Math.max(...ring), centrePixels: inner.length, ringPixels: ring.length,
        trueCentreMean: mean(trueInner), trueRingMean: mean(trueRing), trueCentreMax: Math.max(...trueInner), trueRingMax: Math.max(...trueRing) };
      row.met = row.centreMean <= row.ringMean && row.centreMax <= row.ringMax;
      // Evidence only, never part of the result: the same ratio for a 4x4 supersampled render.
      row.renderRatio = row.centreMean / Math.max(row.ringMean, 1e-12);
      row.truthRatio = row.trueCentreMean / Math.max(row.trueRingMean, 1e-12);
      (item.control ? controls : results)[item.name] = row;
      await note(`centre ${item.name}: mean ${row.centreMean.toExponential(3)} vs ring ${row.ringMean.toExponential(3)}, max ${row.centreMax.toExponential(3)} vs ${row.ringMax.toExponential(3)}; 4x4 truth mean ${row.trueCentreMean.toExponential(3)} vs ${row.trueRingMean.toExponential(3)}`);
    }
  } finally { kaleidoscope.dispose(); broken.dispose(); texture.dispose(); target.dispose(); fine.dispose(); stage.dispose(); }
  const rows = Object.values(results);
  // If a deliberately broken centre passes too, a pass here means nothing.
  const sensitive = Object.values(controls).every(row => !row.met);
  return { id: 'centre', name: 'Centre', kind: 'picture', limit: 'temporal variance in the centre 5% (mean and peak) no higher than the surrounding ring',
    value: Math.max(...rows.map(r => r.centreMean / Math.max(r.ringMean, 1e-12))), unit: 'worst centre/ring mean variance', status: rows.every(r => r.met) && sensitive ? 'PASS' : 'FAIL', sensitive, controls, cases: results };
}

function studioRig(modules) {
  const { THREE, StudioRenderer, createProject, createLayer } = modules;
  const canvas = document.createElement('canvas'), studio = new StudioRenderer(canvas);
  const float = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  const frame = (project, phase, rt) => {
    studio.exactFeedback = true;
    studio.renderFrame(project, phase, rt.width, rt.height);
    studio.copy.uniforms.uImage.value = studio.linearOutput.texture;
    studio.draw(studio.copy, rt);
    const px = new Float32Array(rt.width * rt.height * 4);
    studio.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, px);
    return px;
  };
  const projectOf = layers => Object.assign(createProject(), { id: 'proof', seed: 1729, duration: 2, fps: { num: 30, den: 1 }, transparent: false, background: '#000000', tileEdges: false, layers });
  const kLayer = params => { const layer = createLayer('kaleidoscope'); Object.assign(layer.params, params); return layer; };
  return { studio, float, frame, projectOf, kLayer, createLayer };
}

async function loopClosure(modules) {
  const rig = studioRig(modules), rt = rig.float(LOOP_W, LOOP_H), results = {};
  const configs = [];
  for (let group = 0; group < 5; group++) {
    configs.push([`motif-group-${group}`, { input: 0, group, sourceDrift: .4 }]);
    configs.push([`feedback-group-${group}`, { input: 3, group, echo: .9, sourceDrift: .4 }]);
  }
  configs.push(['feedback-held-echo', { input: 3, echo: 1, echoKeep: 1, echoZoom: 1.02, sourceDrift: .4 }]);
  configs.push(['motif-spiral', { input: 0, spiral: 1 }], ['feedback-spiral', { input: 3, echo: .9, spiral: 1 }]);
  try {
    for (const [name, params] of configs) {
      const project = rig.projectOf([rig.kLayer(params)]);
      await rig.studio.prepare(project);
      const first = rig.frame(project, 0, rt);
      let middle = 0;
      for (let i = 1; i < LOOP_FRAMES; i++) {
        const px = i === LOOP_FRAMES / 2 ? rig.frame(project, i / LOOP_FRAMES * TAU, rt) : null;
        if (px) for (let c = 0; c < px.length; c++) middle = Math.max(middle, Math.abs(px[c] - first[c]));
        else { rig.studio.exactFeedback = true; rig.studio.renderFrame(project, i / LOOP_FRAMES * TAU, LOOP_W, LOOP_H); }
        if (i % 20 === 0) await tick();
      }
      const last = rig.frame(project, 0, rt);
      let close = 0;
      for (let i = 0; i < first.length; i += 4) {
        if (Math.max(Math.abs(first[i] - last[i]), Math.abs(first[i + 1] - last[i + 1]), Math.abs(first[i + 2] - last[i + 2]), Math.abs(first[i + 3] - last[i + 3])) <= LIMIT_255) close++;
      }
      const share = close / (first.length / 4);
      // A frozen picture closes trivially, so the middle of the loop must really differ.
      results[name] = { within1of255: share, midLoopDifference: middle, met: share >= LOOP_SHARE && middle > .05 };
    }
  } finally { rt.dispose(); rig.studio.dispose(); }
  const rows = Object.values(results);
  return { id: 'loop-closure', name: 'Loop closure', kind: 'picture', limit: '99.9% of pixels within 1/255, and the loop must move',
    value: Math.min(...rows.map(r => r.within1of255)) * 100, unit: '% worst share', status: rows.every(r => r.met) ? 'PASS' : 'FAIL', configs: results };
}

function pictureUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 144;
  const c = canvas.getContext('2d'), ramp = c.createLinearGradient(0, 0, 256, 144);
  ramp.addColorStop(0, '#12307a'); ramp.addColorStop(.5, '#e0457b'); ramp.addColorStop(1, '#ffd34d');
  c.fillStyle = ramp; c.fillRect(0, 0, 256, 144);
  c.clearRect(220, 0, 36, 36);
  return { name: 'proof.png', dataUrl: canvas.toDataURL('image/png'), width: 256, height: 144, fit: 'cover' };
}

async function finiteOutput(modules) {
  const rig = studioRig(modules), rt = rig.float(FINITE_W, FINITE_H), image = pictureUrl();
  const inputs = { 'motif-lines': { input: 0, motif: 0 }, 'motif-squares': { input: 0, motif: 1 }, 'motif-parity': { input: 0, motif: 2 },
    image: { input: 1 }, below: { input: 2 }, feedback: { input: 3, echo: 1 } };
  const spirals = { off: { spiral: 0 }, 'a1-b2': { spiral: 1, spiralA: 1, spiralB: 2, spiralScale: 4 }, 'a-3-b5-s2': { spiral: 1, spiralA: -3, spiralB: 5, spiralScale: 2 }, 'a6-b1-s256': { spiral: 1, spiralA: 6, spiralB: 1, spiralScale: 256 } };
  const extremes = { normal: {}, extreme: { cell: .1, sourceScale: .1, warpIn: 1, warpOut: 1, sectors: 24, sourceDrift: 1, motifScale: 8 } };
  let renders = 0, bad = 0;
  const failures = [];
  try {
    for (let group = 0; group < 5; group++) for (const [inputName, input] of Object.entries(inputs)) for (const [spiralName, spiral] of Object.entries(spirals)) for (const [extremeName, extreme] of Object.entries(extremes)) {
      const layer = rig.kLayer({ group, ...input, ...spiral, ...extreme });
      if (inputName === 'image') layer.image = { ...image };
      const under = rig.createLayer('surface');
      under.params.seed = 11;
      const project = rig.projectOf(inputName === 'below' ? [under, layer] : [layer]);
      await rig.studio.prepare(project);
      const px = rig.frame(project, TAU * .37, rt);
      let count = 0;
      for (let i = 0; i < px.length; i++) if (!Number.isFinite(px[i])) count++;
      renders++; bad += count;
      if (count && failures.length < 8) failures.push({ group, input: inputName, spiral: spiralName, extreme: extremeName, count });
      if (renders % 12 === 0) await tick();
    }
  } finally { rt.dispose(); rig.studio.dispose(); }
  return { id: 'finite-output', name: 'Finite output', kind: 'picture', limit: 'no NaN or infinite channel in any group, input or spiral setting',
    value: bad, unit: `bad channels across ${renders} renders`, status: bad === 0 && renders > 0 ? 'PASS' : 'FAIL', renders, failures };
}

/** A real decoded video: a generated clip at 1080p, recorded here and played on a loop. No camera, no user file. */
async function videoFeed() {
  const canvas = document.createElement('canvas');
  canvas.width = FEED_W; canvas.height = FEED_H;
  const c = canvas.getContext('2d');
  let count = 0;
  const paint = () => {
    const t = ++count / 30, shift = (t * 240) % FEED_W, ramp = c.createLinearGradient(shift - FEED_W, 0, shift + FEED_W, FEED_H);
    ramp.addColorStop(0, '#12307a'); ramp.addColorStop(.25, '#e0457b'); ramp.addColorStop(.5, '#ffd34d'); ramp.addColorStop(.75, '#17c9a5'); ramp.addColorStop(1, '#12307a');
    c.fillStyle = ramp; c.fillRect(0, 0, FEED_W, FEED_H);
    c.strokeStyle = 'rgba(255,255,255,.65)'; c.lineWidth = 5;
    for (let k = 0; k < 24; k++) { const x = (k * 97 + t * 180) % FEED_W; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 320, FEED_H); c.stroke(); }
  };
  paint();
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 12e6 }), chunks = [];
  recorder.ondataavailable = event => chunks.push(event.data);
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });
  recorder.start();
  const painter = setInterval(paint, 1000 / 30);
  await new Promise(resolve => setTimeout(resolve, 4000));
  clearInterval(painter); recorder.stop(); await stopped;
  const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
  const element = document.createElement('video');
  element.muted = true; element.loop = true; element.playsInline = true; element.src = url;
  await element.play();
  const source = { element, frameId: 1, last: element.currentTime,
    /** True once a new picture has been presented. */
    poll() { if (element.currentTime === source.last) return false; source.last = element.currentTime; source.frameId++; return true; },
    close() { element.pause(); element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); } };
  return { source, size: () => [element.videoWidth, element.videoHeight] };
}

const batchMeans = values => {
  const out = [];
  for (let i = 0; i + BATCH_MEAN <= values.length; i += BATCH_MEAN) out.push(mean(values.slice(i, i + BATCH_MEAN)));
  return out;
};

/** The real Live path at 4K: tracking, the look and the final encode, with a new source frame every frame. */
async function liveRun(modules, kaleidoscope, source) {
  const { LiveRenderer, summarise, THREE } = modules;
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const live = new LiveRenderer(canvas, source);
  // The app caps Live at 1080p, so the gate sets the size the audit asks for without changing the app.
  live.resize = function resizeToProofSize() {
    if (this.width === OUTPUT_W && this.height === OUTPUT_H) return;
    this.width = OUTPUT_W; this.height = OUTPUT_H;
    this.renderer.setSize(OUTPUT_W, OUTPUT_H, false);
    this.scratch.setSize(OUTPUT_W, OUTPUT_H);
    this.look?.resize(OUTPUT_W, OUTPUT_H);
  };
  live.settings.look = 'kaleidoscope';
  Object.assign(live.settings.kaleidoscope, kaleidoscope);
  const gl = canvas.getContext('webgl2'), pixel = new Uint8Array(4);
  const sync = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); };
  try {
    live.frame(1 / 60); sync();
    for (let i = 0, start = performance.now(); performance.now() - start < WARMUP_MS; i++) {
      source.poll(); live.frame(1 / 60); sync();
      if (i % 4 === 3) await tick();
    }
    const samples = [], elapsed = [], queries = [], timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const collect = () => {
      while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
        const query = queries.shift();
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) elapsed.push(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
        gl.deleteQuery(query);
      }
    };
    // Only frames carrying a new video picture are timed: they are the expensive ones. The frames
    // between them keep the GPU clock up, as a 60 Hz display would.
    for (let i = 0; i < TIMING_FRAMES; i++) {
      for (let idle = 0; !source.poll(); idle++) {
        if (idle > 4000) throw new Error('The test video stopped presenting frames.');
        live.frame(1 / 60); sync();
        await tick();
      }
      // An independent clock on the same work, to confirm the readback really waited for the GPU.
      const query = timer ? gl.createQuery() : null;
      if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      const start = performance.now();
      live.frame(1 / 60);
      if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query); }
      sync();
      samples.push(performance.now() - start);
      if (i % BATCH === BATCH - 1) { await tick(); if (timer) collect(); }
    }
    for (let i = 0; i < 8 && queries.length; i++) { sync(); await tick(); collect(); }
    for (const query of queries.splice(0)) gl.deleteQuery(query);
    // The look's own output at full size, so the finite check also covers the Live path.
    const picture = live.look.picture, bits = new Uint16Array(OUTPUT_W * OUTPUT_H * 4);
    live.renderer.readRenderTargetPixels(picture, 0, 0, OUTPUT_W, OUTPUT_H, bits);
    let nonFinite = 0;
    for (let i = 0; i < bits.length; i++) if ((bits[i] & 0x7c00) === 0x7c00) nonFinite++;
    if (picture.width !== OUTPUT_W || picture.height !== OUTPUT_H || picture.texture.type !== THREE.HalfFloatType) throw new Error(`The look rendered ${picture.width}x${picture.height}, not RGBA16F at 4K.`);
    return { frames: samples.length, raw: summarise(samples), batched: summarise(batchMeans(samples)), nonFinite, gpuElapsedMs: elapsed.length ? summarise(elapsed) : null };
  } finally { live.dispose(); canvas.remove(); }
}

const TIMING_CASES = [
  ['rosette', { group: 0, spiral: false }], ['pmm', { group: 1, spiral: false }], ['p3m1', { group: 2, spiral: false }],
  ['p4m', { group: 3, spiral: false }], ['p6m', { group: 4, spiral: false }], ['spiral', { group: 0, spiral: true }],
];

function isLoaded(sample) { return sample.load[0] > QUIET_LOAD || sample.competingGpu.some(p => p.cpu >= GPU_BUSY_PERCENT); }

async function timingGates(modules) {
  const { agree } = modules, runs = [], feed = await videoFeed();
  const [videoWidth, videoHeight] = feed.size();
  if (videoWidth !== FEED_W || videoHeight !== FEED_H) throw new Error(`The test video is ${videoWidth}x${videoHeight}.`);
  try { for (let r = 0; r < 2; r++) {
    const before = await window.bench.load(), cases = {};
    for (const [name, settings] of TIMING_CASES) {
      await note(`4K run ${r + 1}: ${name}`);
      cases[name] = await liveRun(modules, settings, feed.source);
      await note(`  median ${cases[name].raw.median.toFixed(2)} ms, p95 ${cases[name].raw.p95.toFixed(2)} ms`);
    }
    const after = await window.bench.load();
    runs.push({ before, after, loaded: isLoaded(before) || after.competingGpu.some(p => p.cpu >= GPU_BUSY_PERCENT), cases });
  } } finally { feed.source.close(); }
  const loaded = runs.some(run => run.loaded);
  const names = TIMING_CASES.map(([name]) => name);
  const worstP95 = Math.max(...runs.flatMap(run => names.map(name => run.cases[name].raw.p95)));
  const stabilityRaw = Math.max(...runs.map(run => run.cases.spiral.raw.p95 / run.cases.spiral.raw.median));
  const stabilityBatched = Math.max(...runs.map(run => run.cases.spiral.batched.p95 / run.cases.spiral.batched.median));
  const repeat = Object.fromEntries(names.map(name => {
    // Batch means: a 2 ms median on a 0.1 ms clock can only move in 5% steps, the size of this limit.
    const a = runs[0].cases[name].batched.median, b = runs[1].cases[name].batched.median;
    return [name, { a, b, difference: Math.abs(a - b) / Math.max(a, b), met: agree(a, b, REPEAT_TOLERANCE) }];
  }));
  const worstRepeat = Math.max(...Object.values(repeat).map(row => row.difference));
  const repeatMet = Object.values(repeat).every(row => row.met);
  const nonFinite = runs.reduce((sum, run) => sum + names.reduce((n, name) => n + run.cases[name].nonFinite, 0), 0);
  return { runs, liveNonFinite: nonFinite, gates: [
    { id: '4k-budget', name: '4K budget', kind: 'timing', limit: `p95 <= ${BUDGET_MS} ms, ${TIMING_FRAMES} new-picture frames per case, generated ${FEED_W}x${FEED_H} VP9 video, output ${OUTPUT_W}x${OUTPUT_H}`,
      value: worstP95, unit: 'ms worst p95 of 6 cases, 2 runs', loaded, status: timingStatus(worstP95 <= BUDGET_MS, loaded) },
    { id: 'frame-stability', name: 'Frame stability', kind: 'timing', limit: `spiral p95 <= ${STABILITY_RATIO} x median, per frame`,
      value: stabilityRaw, unit: 'x median (worst run, per frame)', batchedRatio: stabilityBatched, loaded, status: timingStatus(stabilityRaw <= STABILITY_RATIO, loaded) },
    { id: 'repeatability', name: 'Repeatability', kind: 'timing', limit: `two runs agree within ${REPEAT_TOLERANCE * 100}% on the median of ${BATCH_MEAN}-frame means, every case`,
      value: worstRepeat * 100, unit: '% worst difference', loaded, status: timingStatus(repeatMet, loaded), cases: repeat },
  ] };
}

async function existingChecks(modules, config, checks) {
  const results = {};
  let status = 'PASS';
  for (const [id, check] of Object.entries(checks)) {
    try { await check({ id, title: id }, modules, { ...config, images: false }); results[id] = 'passed'; }
    catch (error) { results[id] = String(error && error.message || error); status = 'FAIL'; }
  }
  return { id: 'existing-checks', name: 'Existing parity and input checks', kind: 'picture', limit: 'both pass', value: Object.values(results).filter(v => v === 'passed').length, unit: 'of 2 passed', status, results };
}

async function guarded(id, name, kind, work) {
  try { return await work(); }
  catch (error) { return { id, name, kind, limit: 'gate must run', value: null, unit: '', status: 'FAIL', error: String(error && error.stack || error) }; }
}

export async function runProof(modules, config, checks) {
  const started = await window.bench.load();
  const gates = [], wanted = id => !config.onlyGates || config.onlyGates.includes(id);
  const step = async (id, name, work) => {
    if (!wanted(id)) return null;
    await note(name);
    const gate = await guarded(id, name, 'picture', work);
    gates.push(gate);
    return gate;
  };
  await step('existing-checks', 'Existing parity and input checks', () => existingChecks(modules, config, checks));
  await step('fold-quality', 'Fold quality', () => foldQuality(modules));
  await step('loop-closure', 'Loop closure', () => loopClosure(modules));
  await step('centre', 'Centre', () => centreGate(modules));
  const finite = await step('finite-output', 'Finite output', () => finiteOutput(modules));
  let timing = null;
  if (['4k-budget', 'frame-stability', 'repeatability'].some(wanted)) {
    await note('timing');
    try {
      timing = await timingGates(modules);
      gates.push(...timing.gates);
      if (finite) {
        finite.liveNonFinite = timing.liveNonFinite;
        if (timing.liveNonFinite > 0) { finite.status = 'FAIL'; finite.value = (finite.value ?? 0) + timing.liveNonFinite; }
      }
    } catch (error) {
      const text = String(error && error.stack || error);
      for (const [id, name] of [['4k-budget', '4K budget'], ['frame-stability', 'Frame stability'], ['repeatability', 'Repeatability']])
        gates.push({ id, name, kind: 'timing', limit: 'gate must run', value: null, unit: '', status: 'FAIL', error: text });
    }
  }
  return { proof: 'kaleidoscope', quietRule: { load1Above: QUIET_LOAD, otherGpuCpuPercentAtLeast: GPU_BUSY_PERCENT }, loadAtStart: started, loadAtEnd: await window.bench.load(),
    timingMethod: 'performance.now() around LiveRenderer.frame plus a one-pixel readback, on frames carrying a new picture from a generated 1080p VP9 video. The clock is coarsened to 0.1 ms: budget and stability use per-frame samples; repeatability uses the median of 5-frame means.',
    timingRuns: timing?.runs ?? [], gates };
}
