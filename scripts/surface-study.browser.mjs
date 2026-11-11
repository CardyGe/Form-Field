const TAU = Math.PI * 2;
const presets = ['acid-tide', 'orchid-rings', 'solar-melt', 'deep-bloom', 'mineral-silk'];
const styles = ['bands', 'square-contours', 'drips', 'fusion'];
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const saveJSON = (name, value) => window.study.write(name, new TextEncoder().encode(JSON.stringify(value, null, 2)));

async function run() {
  const config = await window.study.config();
  const { StudioRenderer, createProject, createLayer, applyPreset, EXRLoader, FloatType } = await import(`./${config.label}-renderer.js`);
  const renderer = new StudioRenderer(document.querySelector('#canvas'));
  const loader = new EXRLoader().setDataType(FloatType);
  const report = { label: config.label, snapshot: config.snapshot, createdAt: new Date().toISOString(), captures: [], checks: [], timings: [] };
  function projectFor(id, transparent = false) {
    const p = createProject(); p.id = 'surface-study-project'; p.seed = 1729; p.name = id;
    p.transparent = transparent; p.background = '#100d1c';
    p.layers = [applyPreset(createLayer('surface'), id)];
    p.layers[0].id = 'surface-study-layer'; p.layers[0].params.seed = 1729;
    return p;
  }
  async function png(project, phase, name, width = 1280, height = 720) {
    const start = performance.now();
    const bytes = await renderer.exportPNG(project, phase, width, height);
    report.timings.push({ name, width, height, milliseconds: performance.now() - start, bytes: bytes.length, includes: 'render + async readback + PNG encoding' });
    if (name) await window.study.write(name, bytes);
    return bytes;
  }
  async function contact(name, cells, columns = 2, cellWidth = 640, cellHeight = 360, labelHeight = 24) {
    const canvas = document.createElement('canvas'); canvas.width = columns * cellWidth;
    canvas.height = Math.ceil(cells.length / columns) * (cellHeight + labelHeight);
    const context = canvas.getContext('2d'); context.fillStyle = '#100d1c'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < cells.length; i++) {
      const bitmap = await createImageBitmap(new Blob([cells[i].bytes], { type: 'image/png' }));
      const x = i % columns * cellWidth, y = Math.floor(i / columns) * (cellHeight + labelHeight);
      context.drawImage(bitmap, x, y, cellWidth, cellHeight); bitmap.close();
      context.fillStyle = '#eee8f6'; context.font = '15px sans-serif';
      context.fillText(cells[i].title, x + 12, y + cellHeight + labelHeight - 5);
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await window.study.write(name, new Uint8Array(await blob.arrayBuffer()));
  }
  function pixels(bytes) { return loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).data; }
  function stats(data, width, height) {
    let nonFinite = 0, min = Infinity, max = -Infinity, alphaZero = 0, alphaSoft = 0, alphaOne = 0, alphaInvalid = 0, zeroAlphaNonzeroRGB = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i]; if (!Number.isFinite(v)) nonFinite++;
      min = Math.min(min, v); max = Math.max(max, v);
      if (i % 4 === 3) {
        if (v === 0) { alphaZero++; if (data[i-3] || data[i-2] || data[i-1]) zeroAlphaNonzeroRGB++; }
        else if (v === 1) alphaOne++;
        else if (v > 0 && v < 1) alphaSoft++;
        else alphaInvalid++;
      }
    }
    return { width, height, nonFinite, min, max, alphaZero, alphaSoft, alphaOne, alphaInvalid, zeroAlphaNonzeroRGB };
  }
  function delta(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let c = 0; c < 3; c++) sum += Math.abs(a[i+c] * a[i+3] - b[i+c] * b[i+3]);
      sum += Math.abs(a[i+3] - b[i+3]);
    }
    return sum / a.length;
  }
  async function exr(project, phase, width = 640, height = 360) {
    return pixels(await renderer.exportEXR(project, phase, width, height));
  }
  try {
    const presetCells = [], phaseZero = new Map();
    for (const id of presets) {
      const project = projectFor(id); await renderer.prepare(project);
      for (const [suffix, phase] of [['p0', 0], ['p25', TAU * .25]]) {
        const name = `${id}-${suffix}.png`, bytes = await png(project, phase, name);
        presetCells.push({ bytes, title: `${id} · ${phase ? '25%' : '0%'}` });
        if (!phase) phaseZero.set(id, bytes);
        report.captures.push({ name, preset: id, phaseRadians: phase, phaseFraction: phase / TAU, transparent: false });
      }
      await window.study.note({ status: 'captured', preset: id, snapshot: config.snapshot.bundleSha256 });
    }
    await contact('contact-sheet.png', presetCells);
    const styleCells = [];
    for (let style = 0; style < 4; style++) {
      const project = projectFor('acid-tide'); project.layers[0].params.style = style;
      const name = `style-${styles[style]}.png`, bytes = await png(project, 0, name);
      styleCells.push({ bytes, title: `${style} · ${styles[style]} · Acid Tide palette` });
      report.captures.push({ name, style, phaseRadians: 0, palette: project.layers[0].palette });
    }
    await contact('style-contact-sheet.png', styleCells);
    await png(projectFor('acid-tide'), .7, 'surface-thumb.png', 512, 288);
    const baseline = await window.study.baseline();
    if (baseline) {
      const cells = [];
      for (const old of baseline) {
        cells.push({ bytes: old.bytes, title: `${config.compare} · ${old.id}` });
        cells.push({ bytes: phaseZero.get(old.id), title: `${config.label} · ${old.id}` });
      }
      await contact(`comparison-to-${config.compare}.png`, cells);
    }
    if (config.grid) {
      const base = projectFor(config.gridPreset);
      if (config.gridStyle !== null) base.layers[0].params.style = config.gridStyle;
      const candidates = [], cells = [];
      for (const [key, values] of [['warp', [0, .33, .66, 1]], ['scale', [1.5, 3, 6, 10]], ['softness', [0, .2, .5, .9]]]) {
        for (const value of values) {
          const project = structuredClone(base); project.layers[0].params[key] = value;
          const name = `grid-${key}-${value}.png`, bytes = await png(project, .7, name, 512, 288);
          cells.push({ bytes, title: `${key} ${value} · ${styles[project.layers[0].params.style]}` });
          candidates.push({ key, value, name, project, phaseRadians: .7 });
        }
      }
      await contact('control-grid.png', cells, 4, 512, 288, 40);
      for (const key of ['roundness', 'relief']) {
        const studyCells = [];
        for (let style = 0; style < 4; style++) for (const value of [0, .33, .66, 1]) {
          const project = structuredClone(base);
          Object.assign(project.layers[0].params, { style, [key]: value });
          const name = `grid-${key}-style-${style}-${value}.png`, bytes = await png(project, .7, name, 512, 288);
          studyCells.push({ bytes, title: `${styles[style]} · ${key} ${value}` });
          candidates.push({ key, value, style, name, project, phaseRadians: .7 });
        }
        await contact(`${key}-grid.png`, studyCells, 4, 512, 288, 40);
      }
      await saveJSON('grid-candidates.json', candidates);
      report.grid = { preset: config.gridPreset, style: base.layers[0].params.style, cells: candidates.length };
    }
    if (!config.quick) {
      for (const id of presets) {
        const project = projectFor(id, true); await renderer.prepare(project);
        const first = await renderer.exportPNG(project, 0, 640, 360);
        assert(equal(first, await renderer.exportPNG(project, TAU, 640, 360)), `${id}: phase wrap mismatch`);
        await renderer.exportPNG(project, 1.731, 640, 360);
        assert(equal(first, await renderer.exportPNG(project, 0, 640, 360)), `${id}: arbitrary-seek mismatch`);
        const output = stats(await exr(project, .7), 640, 360);
        assert(!output.nonFinite && !output.alphaInvalid && !output.zeroAlphaNonzeroRGB, `${id}: invalid EXR`);
        assert(output.alphaOne === 640 * 360, `${id}: unmasked surface lost opaque coverage`);
        const previous = await exr(project, -TAU/300, 320, 180), zero = await exr(project, 0, 320, 180), next = await exr(project, TAU/300, 320, 180);
        const lastToFirst = delta(previous, zero), firstToSecond = delta(zero, next);
        // renderFrame wraps 2π to 0, so exact endpoint equality alone says
        // nothing about shader periodicity. Compare the actual last step with
        // interior adjacent steps and reject static preset rendering as well.
        const interior = [];
        for (let i = 1; i <= 16; i++) {
          const phase = TAU * i / 17;
          const a = await exr(project, phase, 320, 180), b = await exr(project, phase + TAU/300, 320, 180);
          interior.push(delta(a, b));
        }
        const maximumInterior = Math.max(...interior), meanInterior = interior.reduce((a,b) => a+b, 0) / interior.length;
        const seamThreshold = maximumInterior * 4 + .00001;
        assert(maximumInterior > .000001, `${id}: intended animated preset rendered static output`);
        assert(lastToFirst <= seamThreshold, `${id}: seam step ${lastToFirst} exceeds sampled interior-motion threshold ${seamThreshold}`);
        report.checks.push({ preset: id, exactPhaseWrap: true, arbitrarySeekRepeatable: true, exr: output,
          adjacentMotion: { frameCount: 300, lastToFirst, firstToSecond, ratio: lastToFirst / Math.max(firstToSecond, 1e-12),
            interiorSamples: interior.length, maximumInterior, meanInterior, seamThreshold, seamAnomalyGatePassed: true,
            metric: 'mean abs premultiplied-linear RGBA difference; conservative C0 seam-anomaly gate, not a derivative-continuity proof' } });
      }
      const project = projectFor('acid-tide', true);
      await png(project, .7, 'acid-tide-4k.png', 3840, 2160);
      const start = performance.now(), bytes = await renderer.exportEXR(project, .7, 3840, 2160);
      report.timings.push({ name: 'acid-tide-4k.exr', width: 3840, height: 2160, milliseconds: performance.now() - start, bytes: bytes.length, includes: 'render + async readback + EXR ZIP compression' });
      await window.study.write('acid-tide-4k.exr', bytes);
      const full4K = stats(pixels(bytes), 3840, 2160);
      assert(!full4K.nonFinite && !full4K.alphaInvalid && full4K.alphaOne === 3840*2160, 'Invalid 4K surface EXR');
      report.checks.push({ full4K, stats: renderer.getStats() });
      project.layers[0].mask = { kind: 'circle', softness: .35, invert: false, size: .7 };
      project.layers[0].opacity = .37;
      const masked = stats(await exr(project, .7), 640, 360);
      assert(!masked.nonFinite && !masked.alphaInvalid && !masked.zeroAlphaNonzeroRGB && masked.alphaZero && masked.alphaSoft, 'Masked surface alpha regression');
      report.checks.push({ maskedOpacity: .37, mask: 'circle', exr: masked });
      const stressCases = [], stressCells = [];
      for (let style = 0; style < 4; style++) {
        for (const roundness of [0, 1]) for (const relief of [0, 1]) {
          stressCases.push({ style, roundness, relief, cycles: 8, warp: 1, scale: 12, detail: 1, softness: 0 });
        }
        for (const warp of [0, 1]) for (const scale of [.5, 12]) {
          stressCases.push({ style, roundness: .5, relief: .5, cycles: 8, warp, scale, detail: 1, softness: 0 });
        }
      }
      const stressReport = [];
      for (let i = 0; i < stressCases.length; i++) {
        const parameters = stressCases[i], project = projectFor('acid-tide', true);
        Object.assign(project.layers[0].params, parameters);
        for (const phase of [0, 1.731, TAU - TAU/300]) {
          const output = stats(await exr(project, phase, 320, 180), 320, 180);
          assert(!output.nonFinite && !output.alphaInvalid && output.alphaOne === 320*180, `Stress case ${i} invalid output at ${phase}`);
        }
        const zero = await renderer.exportPNG(project, 0, 320, 180);
        assert(equal(zero, await renderer.exportPNG(project, TAU, 320, 180)), `Stress case ${i} endpoint mismatch`);
        stressReport.push({ parameters, finitePhases: 3, exactPhaseWrap: true });
        if (i % 8 < 4) stressCells.push({ bytes: zero, title: `${styles[parameters.style]} · round${parameters.roundness} relief${parameters.relief}` });
      }
      await contact('stress-contact-sheet.png', stressCells, 4, 320, 180, 32);
      await saveJSON('stress-report.json', stressReport);
      report.checks.push({ stressCases: stressCases.length, finitePhaseOutputs: stressCases.length * 3,
        cycles: 8, flowExtremes: [0, 1], scaleExtremes: [.5, 12], roundnessExtremes: [0, 1], reliefExtremes: [0, 1] });
    }
    await saveJSON('projects.json', presets.map(id => projectFor(id)));
    await window.study.done(report);
  } finally { renderer.dispose(); }
}
run().catch(error => window.study.fail(error instanceof Error ? error.stack || error.message : String(error)));
