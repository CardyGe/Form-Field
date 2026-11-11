const TAU = Math.PI * 2;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const saveJSON = (name, value) => window.study.write(name, new TextEncoder().encode(JSON.stringify(value, null, 2)));

async function run() {
  const config = await window.study.config();
  const current = await import(`./${config.label}-renderer.js`);
  const baseline = await import(`./${config.label}-v5-baseline.js`);
  const { StudioRenderer, createProject, createLayer, applyPreset, validateProject, parameterDefinitions, PRESETS, EXRLoader, FloatType } = current;
  const canvas = document.querySelector('#canvas');
  const renderer = new StudioRenderer(canvas);
  const loader = new EXRLoader().setDataType(FloatType);
  const report = { label: config.label, snapshot: config.snapshot, createdAt: new Date().toISOString(), captures: [], checks: [], timings: [] };
  const oldIDs = new Set(baseline.PRESETS.map(preset => preset.id));
  const newPresets = PRESETS.filter(preset => !oldIDs.has(preset.id));
  function projectFor(id, transparent = false, library = current) {
    const selected = library.PRESETS.find(preset => preset.id === id);
    assert(selected, `Unknown preset ${id}`);
    const project = library.createProject();
    Object.assign(project, { id: 'instrument-study-project', name: id, seed: 1729, transparent, background: '#070912' });
    project.layers = [library.applyPreset(library.createLayer(selected.kind), id)];
    Object.assign(project.layers[0], { id: 'instrument-study-layer' });
    project.layers[0].params.seed = 1729;
    return project;
  }
  function pixels(bytes) { return loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).data; }
  async function exr(project, phase, width = 320, height = 180, engine = renderer) {
    return pixels(await engine.exportEXR(project, phase, width, height));
  }
  async function png(project, phase, name, width = 1280, height = 720) {
    const start = performance.now(), bytes = await renderer.exportPNG(project, phase, width, height);
    report.timings.push({ name, width, height, milliseconds: performance.now() - start, bytes: bytes.length });
    if (name) await window.study.write(name, bytes);
    return bytes;
  }
  function stats(data, width, height) {
    let nonFinite = 0, rgbMin = Infinity, rgbMax = -Infinity, alphaZero = 0, alphaSoft = 0, alphaOne = 0, invalidAlpha = 0, zeroAlphaRGB = 0, alphaSum = 0, luminanceSum = 0, brightPixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      for (let channel = 0; channel < 4; channel++) if (!Number.isFinite(data[index + channel])) nonFinite++;
      for (let channel = 0; channel < 3; channel++) { rgbMin = Math.min(rgbMin, data[index + channel]); rgbMax = Math.max(rgbMax, data[index + channel]); }
      if (alpha === 0) { alphaZero++; if (data[index] || data[index + 1] || data[index + 2]) zeroAlphaRGB++; }
      else if (alpha === 1) alphaOne++;
      else if (alpha > 0 && alpha < 1) alphaSoft++;
      else invalidAlpha++;
      const luminance = (.2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2]) * alpha;
      luminanceSum += luminance; alphaSum += alpha; if (luminance > .01) brightPixels++;
    }
    return { width, height, nonFinite, rgbMin, rgbMax, alphaZero, alphaSoft, alphaOne, invalidAlpha, zeroAlphaRGB, meanAlpha: alphaSum / (width * height), meanPremultipliedLuminance: luminanceSum / (width * height), brightPixels };
  }
  function finite(output, context) {
    assert(!output.nonFinite && !output.invalidAlpha && !output.zeroAlphaRGB && output.rgbMin >= 0 && output.rgbMax <= 1.0001, `${context}: invalid finished-SDR straight-alpha output ${JSON.stringify(output)}`);
  }
  function delta(a, b) {
    let sum = 0, maximum = 0;
    for (let index = 0; index < a.length; index += 4) {
      for (let channel = 0; channel < 4; channel++) {
        const difference = Math.abs(channel === 3 ? a[index + 3] - b[index + 3] : a[index + channel] * a[index + 3] - b[index + channel] * b[index + 3]);
        sum += difference; maximum = Math.max(maximum, difference);
      }
    }
    return { mean: sum / a.length, maximum };
  }
  async function contact(name, cells, columns = 3, cellWidth = 640, cellHeight = 360) {
    const sheet = document.createElement('canvas'); sheet.width = columns * cellWidth;
    sheet.height = Math.ceil(cells.length / columns) * (cellHeight + 30);
    const context = sheet.getContext('2d'); context.fillStyle = '#100d1c'; context.fillRect(0, 0, sheet.width, sheet.height);
    for (let index = 0; index < cells.length; index++) {
      const bitmap = await createImageBitmap(new Blob([cells[index].bytes], { type: 'image/png' }));
      const x = index % columns * cellWidth, y = Math.floor(index / columns) * (cellHeight + 30);
      context.drawImage(bitmap, x, y, cellWidth, cellHeight); bitmap.close();
      context.fillStyle = '#eee8f6'; context.font = '15px sans-serif'; context.fillText(cells[index].title, x + 10, y + cellHeight + 22);
    }
    const blob = await new Promise(resolve => sheet.toBlob(resolve, 'image/png'));
    await window.study.write(name, new Uint8Array(await blob.arrayBuffer()));
  }
  async function progress(stage, extra = {}) {
    await saveJSON('partial-report.json', report);
    await window.study.note({ stage, ...extra });
  }
  let baselineRenderer;
  try {
    const allCells = [], familyCells = { surface: [], sculpture: [], fractal: [] }, styleCells = new Map();
    for (const preset of PRESETS) {
      const project = projectFor(preset.id); await renderer.prepare(project);
      for (const [suffix, phase] of [['p0', 0], ['p25', TAU / 4]]) {
        const name = `${preset.id}-${suffix}.png`, bytes = await png(project, phase, name);
        const cell = { title: `${preset.name} / ${phase ? '25%' : '0%'}`, bytes };
        allCells.push(cell);
        if (!phase) familyCells[preset.kind].push(cell);
        const group = `${preset.kind}-${preset.kind === 'sculpture' ? 'forms' : project.layers[0].params.style}`;
        if (!styleCells.has(group)) styleCells.set(group, []); styleCells.get(group).push(cell);
        report.captures.push({ name, preset: preset.id, kind: preset.kind, phase, project });
      }
      await window.study.note({ stage: 'captured', preset: preset.id });
    }
    await contact('all-presets-contact.png', allCells, 4, 480, 270);
    for (const kind of ['surface', 'sculpture', 'fractal']) await contact(`${kind}-collection.png`, familyCells[kind]);
    for (const [group, cells] of styleCells) await contact(`${group}-contact.png`, cells, group === 'sculpture-forms' ? 4 : 3, group === 'sculpture-forms' ? 480 : 640, group === 'sculpture-forms' ? 270 : 360);
    await saveJSON('projects.json', PRESETS.map(preset => projectFor(preset.id)));
    await progress('gallery-complete', { presets: PRESETS.length, newPresets: newPresets.length, bundleSha256: config.snapshot.bundleSha256 });

    if (!config.quick) {
      baselineRenderer = new baseline.StudioRenderer(document.createElement('canvas'));
      const regressionCells = [];
      for (const preset of baseline.PRESETS) {
        const oldProject = projectFor(preset.id, true, baseline), newProject = validateProject(structuredClone(oldProject));
        await baselineRenderer.prepare(oldProject); await renderer.prepare(newProject);
        const oldData = await exr(oldProject, .7, 640, 360, baselineRenderer), newData = await exr(newProject, .7, 640, 360);
        const difference = delta(oldData, newData), oldStats = stats(oldData, 640, 360), newStats = stats(newData, 640, 360);
        finite(newStats, `Legacy ${preset.id}`);
        const luminanceRatio = newStats.meanPremultipliedLuminance / Math.max(oldStats.meanPremultipliedLuminance, 1e-9);
        assert(difference.mean < .0015 && Math.abs(luminanceRatio - 1) < .015, `Legacy look drift ${preset.id}: ${JSON.stringify({ difference, luminanceRatio })}`);
        report.checks.push({ test: 'legacy-v5-regression', preset: preset.id, difference, luminanceRatio, oldStats, newStats, tolerance: { meanPremultipliedRGBA: .0015, meanLuminanceRatio: .015 } });
        const oldPNG = await baselineRenderer.exportPNG(oldProject, .7, 640, 360);
        const newPNG = await png(newProject, .7, null, 640, 360);
        regressionCells.push({ title: `v0.5 / ${preset.name}`, bytes: oldPNG }, { title: `${config.label} / ${preset.name}`, bytes: newPNG });
        await window.study.note({ stage: 'legacy-passed', preset: preset.id, meanDifference: difference.mean });
      }
      await contact('legacy-comparison.png', regressionCells, 2);
      baselineRenderer.dispose(); baselineRenderer = null;
      await progress('legacy-regressions-complete');

      for (const preset of PRESETS) {
        const project = projectFor(preset.id, true); await renderer.prepare(project);
        const first = await png(project, 0, null, 320, 180);
        assert(equal(first, await png(project, TAU, null, 320, 180)), `${preset.id}: exact phase wrap failed`);
        await png(project, 1.731, null, 320, 180);
        assert(equal(first, await png(project, 0, null, 320, 180)), `${preset.id}: arbitrary seek failed`);
        const output = stats(await exr(project, .7), 320, 180); finite(output, preset.id);
        assert(output.brightPixels > 320 * 180 * .003, `${preset.id}: effectively empty authored preset`);
        if (preset.kind === 'surface' || (preset.kind === 'fractal' && project.layers[0].params.style < 2)) assert(output.alphaOne === 320 * 180, `${preset.id}: planar source lost coverage`);
        else assert(output.alphaZero && output.alphaSoft && output.alphaOne, `${preset.id}: cutout lost exterior, edge or interior coverage`);
        const previous = await exr(project, -TAU / 300), zero = await exr(project, 0), next = await exr(project, TAU / 300);
        const seam = delta(previous, zero).mean, firstStep = delta(zero, next).mean, interior = [];
        for (let index = 1; index <= 9; index++) {
          const phase = TAU * index / 10;
          interior.push(delta(await exr(project, phase), await exr(project, phase + TAU / 300)).mean);
        }
        const maxInterior = Math.max(...interior), threshold = maxInterior * 4 + .00001;
        assert(maxInterior > .000001 && seam <= threshold, `${preset.id}: seam anomaly ${JSON.stringify({ seam, firstStep, maxInterior, threshold })}`);
        report.checks.push({ test: 'loop-seek-alpha', preset: preset.id, exactPhaseWrap: true, exactArbitrarySeek: true, output, seam, firstStep, maxInterior, seamThreshold: threshold, interiorSamples: interior.length });
        await window.study.note({ stage: 'loop-passed', preset: preset.id });
      }
      await progress('loops-complete');
    }

    if (!config.quick || config.quality) {
      const resolutionCells = [], nativeCrops = [];
      for (const preset of newPresets) {
        const project = projectFor(preset.id, true); await renderer.prepare(project);
        const previewPNG = await png(project, .7, `${preset.id}-720p.png`);
        const previewStats = stats(await exr(project, .7, 1280, 720), 1280, 720);
        const fullPNG = await png(project, .7, `${preset.id}-4k.png`, 3840, 2160);
        const fullStats = stats(await exr(project, .7, 3840, 2160), 3840, 2160);
        finite(fullStats, `${preset.id}: 4K`);
        const luminanceRatio = fullStats.meanPremultipliedLuminance / Math.max(previewStats.meanPremultipliedLuminance, 1e-9);
        assert(luminanceRatio > .82 && luminanceRatio < 1.18, `${preset.id}: preview/4K luminance diverged ${luminanceRatio}`);
        assert(Math.abs(fullStats.meanAlpha - previewStats.meanAlpha) < .025, `${preset.id}: 4K silhouette coverage changed`);
        report.checks.push({ test: 'true-4K', preset: preset.id, previewStats, fullStats, luminanceRatio });
        resolutionCells.push({ title: `720p / ${preset.name}`, bytes: previewPNG }, { title: `4K reduced / ${preset.name}`, bytes: fullPNG });
        const bitmap = await createImageBitmap(new Blob([fullPNG], { type: 'image/png' }));
        for (const [label, x, y] of [['center', 1408, 568], ['left', 768, 480]]) {
          const crop = document.createElement('canvas'); crop.width = crop.height = 1024;
          const context = crop.getContext('2d'); context.fillStyle = '#070912'; context.fillRect(0, 0, 1024, 1024);
          context.drawImage(bitmap, x, y, 1024, 1024, 0, 0, 1024, 1024);
          const blob = await new Promise(resolve => crop.toBlob(resolve, 'image/png'));
          const bytes = new Uint8Array(await blob.arrayBuffer());
          await window.study.write(`${preset.id}-4k-${label}-crop.png`, bytes);
          nativeCrops.push({ title: `${preset.name} / ${label} / native crop`, bytes });
        }
        bitmap.close();
        await window.study.note({ stage: '4K-passed', preset: preset.id, luminanceRatio });
      }
      await contact('preview-versus-4k.png', resolutionCells, 2);
      await contact('native-4k-crops.png', nativeCrops, 4, 512, 512);
      await progress('4K-complete', { newPresets: newPresets.length });
    }

    if (!config.quick) {
      const cases = [];
      const surfaceKeys = ['density', 'stretch', 'turbulence', 'centerX', 'centerY', 'lightAngle', 'roughness', 'exposure', 'saturation', 'hue'];
      const sculptureKeys = ['lobes', 'thickness', 'stretch', 'curl', 'foldFrequency', 'asymmetry', 'ridgeScale', 'metallic', 'clearcoat', 'sheen', 'filmScale', 'lightPower', 'shadowStrength', 'shadowSoftness', 'exposure', 'saturation', 'hue'];
      function extreme(kind, key, high) { const definition = parameterDefinitions(kind).find(item => item.key === key); assert(definition, `No definition ${kind}.${key}`); return high ? definition.max : definition.min; }
      for (let style = 0; style < 4; style++) for (let variant = 0; variant < 3; variant++) for (const high of [false, true]) {
        const params = { style, variant, cycles: 8, scale: high ? 12 : .5, warp: high ? 1 : 0, roundness: high ? 0 : 1, detail: 1, softness: 0 };
        for (const key of surfaceKeys) params[key] = extreme('surface', key, high);
        cases.push({ kind: 'surface', preset: 'acid-tide', label: `surface-corner-${style}-${variant}-${high}`, params });
      }
      for (let style = 0; style < 4; style++) for (const key of surfaceKeys) for (const high of [false, true]) cases.push({ kind: 'surface', preset: 'acid-tide', label: `surface-${style}-${key}-${high}`, params: { style, variant: 1, [key]: extreme('surface', key, high) } });
      for (let form = 0; form < 4; form++) {
        for (const high of [false, true]) {
          const params = { form, cycles: 8, fold: high ? 1 : 0, ridges: high ? 1 : 0, opening: high ? 1 : 0, breath: 1, twist: high ? 1 : -1 };
          for (const key of sculptureKeys) params[key] = extreme('sculpture', key, high);
          cases.push({ kind: 'sculpture', preset: 'pearl-organism', label: `sculpture-corner-${form}-${high}`, params });
        }
        for (const key of sculptureKeys) for (const high of [false, true]) cases.push({ kind: 'sculpture', preset: 'pearl-organism', label: `sculpture-${form}-${key}-${high}`, params: { form, [key]: extreme('sculpture', key, high) } });
      }
      for (let style = 0; style < 3; style++) for (let variant = 0; variant < 3; variant++) for (let colorMode = 0; colorMode < 3; colorMode++) for (const colorSteps of [2, 12]) for (const colorMix of [0, 1]) cases.push({ kind: 'fractal', preset: ['prismatic-fold', 'velvet-julia', 'abyssal-cathedral'][style], label: `fractal-color-${style}-${variant}-${colorMode}-${colorSteps}-${colorMix}`, params: { style, variant, colorMode, colorSteps, colorMix, cycles: 8 } });
      for (let style = 0; style < 3; style++) for (const key of ['hue', 'saturation', 'exposure']) for (const high of [false, true]) cases.push({ kind: 'fractal', preset: ['prismatic-fold', 'velvet-julia', 'abyssal-cathedral'][style], label: `fractal-${style}-${key}-${high}`, params: { [key]: extreme('fractal', key, high) } });
      const stress = [], stressCells = [];
      for (let index = 0; index < cases.length; index++) {
        const item = cases[index], project = projectFor(item.preset, true); Object.assign(project.layers[0].params, item.params);
        const phases = [0, 1.731, TAU - TAU / 300], outputs = [];
        for (const phase of phases) { const output = stats(await exr(project, phase, 240, 135), 240, 135); finite(output, item.label); outputs.push(output); }
        const zero = await png(project, 0, null, 240, 135);
        assert(equal(zero, await png(project, TAU, null, 240, 135)), `${item.label}: extreme endpoint mismatch`);
        stress.push({ ...item, finitePhases: phases, outputs, exactPhaseWrap: true });
        if (item.label.includes('corner')) stressCells.push({ title: item.label, bytes: zero });
        if (index % 20 === 0) await window.study.note({ stage: 'stress-progress', complete: index + 1, total: cases.length });
      }
      await contact('stress-corners.png', stressCells, 4, 320, 180);
      await saveJSON('stress-report.json', stress);
      report.checks.push({ test: 'continuous-extremes-and-discrete-families', cases: stress.length, finiteOutputs: stress.length * 3, byKind: Object.fromEntries(['surface', 'sculpture', 'fractal'].map(kind => [kind, stress.filter(item => item.kind === kind).length])) });
      await progress('stress-complete', { cases: stress.length });

      const texture = document.createElement('canvas'); texture.width = 256; texture.height = 144;
      const ctx = texture.getContext('2d'); ctx.clearRect(0, 0, 256, 144);
      const gradient = ctx.createLinearGradient(0, 0, 256, 144); gradient.addColorStop(0, '#f265a7'); gradient.addColorStop(.4, '#84eadf'); gradient.addColorStop(1, '#ffd076');
      ctx.fillStyle = gradient; ctx.fillRect(13, 9, 218, 120); ctx.clearRect(30, 30, 30, 44);
      ctx.fillStyle = '#552777'; ctx.fillRect(88, 21, 24, 80); ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.arc(183, 84, 34, 0, TAU); ctx.fill();
      const imageProject = createProject(); imageProject.transparent = true; imageProject.layers = [createLayer('image')];
      imageProject.layers[0].image = { name: 'embedded asymmetrical QA texture', dataUrl: texture.toDataURL('image/png'), width: 256, height: 144, fit: 'contain' };
      await renderer.prepare(imageProject);
      const imageReport = [], imageCells = [];
      const imageWidth = 384, imageHeight = 216;
      const baseImage = await exr(imageProject, 0, imageWidth, imageHeight);
      function reflectedDifference(actual, flipX, flipY) {
        let sum = 0; for (let y = 0; y < imageHeight; y++) for (let x = 0; x < imageWidth; x++) for (let c = 0; c < 4; c++) sum += Math.abs(actual[(y * imageWidth + x) * 4 + c] - baseImage[((flipY ? imageHeight - 1 - y : y) * imageWidth + (flipX ? imageWidth - 1 - x : x)) * 4 + c]);
        return sum / actual.length;
      }
      for (let mirror = 0; mirror < 4; mirror++) for (const repeat of [1, 2, 8]) for (const fit of ['contain', 'cover']) {
        const project = structuredClone(imageProject); Object.assign(project.layers[0].params, { mirror, repeat }); project.layers[0].image.fit = fit;
        const data = await exr(project, 0, imageWidth, imageHeight), output = stats(data, imageWidth, imageHeight); finite(output, `image mirror${mirror} repeat${repeat} ${fit}`);
        let reflectionError = null;
        if (repeat === 1) { reflectionError = reflectedDifference(data, mirror % 2 === 1, mirror > 1); assert(reflectionError < .0001, `Image mirror mismatch ${mirror}: ${reflectionError}`); }
        let tileError = null, repeatedDifference = null;
        if (repeat > 1) {
          let sum = 0; const offsets = [[imageWidth / repeat, 0], [0, imageHeight / repeat]];
          for (let y = 0; y < imageHeight; y++) for (let x = 0; x < imageWidth; x++) for (let c = 0; c < 4; c++) for (const [dx, dy] of offsets) {
            sum += Math.abs(data[(y * imageWidth + x) * 4 + c] - data[(((y + dy) % imageHeight) * imageWidth + (x + dx) % imageWidth) * 4 + c]);
          }
          tileError = sum / (data.length * 2); repeatedDifference = delta(data, baseImage).mean;
          assert(tileError < .0001, `Repeated image tiles differ ${repeat}: ${tileError}`);
          assert(repeatedDifference > .005, `Repeat ${repeat} failed to change the asymmetric source texture`);
        }
        imageReport.push({ mirror, repeat, fit, output, reflectionError, tileError, repeatedDifference });
        if (fit === 'contain') imageCells.push({ title: `Mirror${mirror} / repeat${repeat}`, bytes: await png(project, 0, null, 640, 360) });
      }
      const coloringChecks = [];
      for (const preset of ['prismatic-fold', 'velvet-julia', 'abyssal-cathedral']) {
        const project = projectFor(preset, true); Object.assign(project.layers[0].params, { colorMode: 0, colorMix: 1 });
        const original = await exr(project, .7);
        for (const colorMode of [1, 2]) {
          Object.assign(project.layers[0].params, { colorMode, colorMix: 0 });
          const bypass = await exr(project, .7), bypassDifference = delta(original, bypass);
          assert(bypassDifference.maximum < .00001, `${preset}: color mix zero changed the original image`);
          project.layers[0].params.colorMix = 1;
          const colored = await exr(project, .7), colorDifference = delta(original, colored);
          assert(colorDifference.mean > .00001, `${preset}: coloring ${colorMode} has no visible effect`);
          finite(stats(colored, 320, 180), `${preset}: coloring mix`);
          coloringChecks.push({ preset, colorMode, bypassDifference, colorDifference });
        }
      }
      report.checks.push({ test: 'coloring-mix-bypass-and-visible-effect', coloringChecks });
      for (const kind of ['surface', 'sculpture', 'fractal', 'image']) for (const high of [false, true]) {
        const project = kind === 'image' ? structuredClone(imageProject) : projectFor({ surface: 'citrine-braids', sculpture: 'liquid-trefoil', fractal: 'ember-julia' }[kind], true);
        Object.assign(project.layers[0].params, { hue: high ? Math.PI : -Math.PI, exposure: high ? 2 : .25, saturation: high ? 2 : 0 });
        project.layers[0].opacity = .37; project.layers[0].mask = { kind: 'circle', size: .7, softness: .35, invert: false };
        const data = await exr(project, .7), output = stats(data, 320, 180); finite(output, `${kind}: graded mask`);
        assert(output.alphaZero && output.alphaSoft, `${kind}: graded mask lost alpha`);
        let grayError = 0;
        if (!high) { for (let index = 0; index < data.length; index += 4) grayError = Math.max(grayError, Math.abs(data[index] - data[index + 1]), Math.abs(data[index] - data[index + 2])); assert(grayError < .003, `${kind}: zero saturation is not neutral gray ${grayError}`); }
        imageReport.push({ test: 'shared-grade-mask-alpha', kind, high, grayError, output });
      }
      await contact('image-options.png', imageCells, 3, 480, 270);
      await saveJSON('image-report.json', imageReport);
      report.checks.push({ test: 'image-mirror-repeat-and-shared-grading', cases: imageReport.length, reflectedImageVerified: true, repeatedTilesVerified: true, grayscaleVerified: true, maskedAlphaVerified: true });
      await progress('image-and-grade-complete');
    }
    await window.study.done(report);
  } catch (error) {
    await saveJSON('partial-report.json', report); throw error;
  } finally { baselineRenderer?.dispose(); renderer.dispose(); }
}
run().catch(error => window.study.fail(error instanceof Error ? error.stack || error.message : String(error)));
