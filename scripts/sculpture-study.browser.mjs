const TAU = Math.PI * 2;
const presets = ['pearl-organism', 'mercury-flower', 'rose-shell'];
const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const assert = (value, message) => { if (!value) throw new Error(message); };
const saveJSON = (name, value) => window.study.write(name, new TextEncoder().encode(JSON.stringify(value, null, 2)));

async function run() {
  const config = await window.study.config();
  const { StudioRenderer, createProject, createLayer, applyPreset, EXRLoader, FloatType } = await import(`./${config.label}-renderer.js`);
  const canvas = document.querySelector('#canvas');
  const renderer = new StudioRenderer(canvas);
  const loader = new EXRLoader().setDataType(FloatType);
  const report = { label: config.label, snapshot: config.snapshot, createdAt: new Date().toISOString(), captures: [], checks: [], timings: [] };
  const images = [];
  function projectFor(id, transparent = false) {
    const project = createProject();
    project.id = 'sculpture-study-project'; project.seed = 1729;
    project.name = id; project.transparent = transparent; project.background = '#100d1c';
    const layer = applyPreset(createLayer('sculpture'), id);
    layer.id = 'sculpture-study-layer'; layer.params.seed = 1729;
    project.layers = [layer]; return project;
  }
  async function png(project, phase, name, width = 1280, height = 720) {
    const start = performance.now();
    const bytes = await renderer.exportPNG(project, phase, width, height);
    report.timings.push({ name, width, height, milliseconds: performance.now() - start, bytes: bytes.length, includes: 'render + async readback + PNG encoding' });
    await window.study.write(name, bytes);
    return bytes;
  }
  async function addImage(bytes, title) {
    const blob = new Blob([bytes], { type: 'image/png' });
    images.push({ image: await createImageBitmap(blob), title });
  }
  function exrStats(bytes) {
    const parsed = loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const data = parsed.data; let nonFinite = 0, min = Infinity, max = -Infinity;
    let alphaZero = 0, alphaSoft = 0, alphaOne = 0, alphaInvalid = 0, zeroAlphaNonzeroRGB = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i]; if (!Number.isFinite(v)) nonFinite++;
      min = Math.min(min, v); max = Math.max(max, v);
      if (i % 4 === 3) {
        if (v === 0) { alphaZero++; if (data[i-3] !== 0 || data[i-2] !== 0 || data[i-1] !== 0) zeroAlphaNonzeroRGB++; }
        else if (v === 1) alphaOne++;
        else if (v > 0 && v < 1) alphaSoft++;
        else alphaInvalid++;
      }
    }
    return { width: parsed.width, height: parsed.height, nonFinite, min, max, alphaZero, alphaSoft, alphaOne, alphaInvalid, zeroAlphaNonzeroRGB };
  }
  function exrPixels(bytes) {
    return loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).data;
  }
  function visibleDifference(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let c = 0; c < 3; c++) sum += Math.abs(a[i+c] * a[i+3] - b[i+c] * b[i+3]);
      sum += Math.abs(a[i+3] - b[i+3]);
    }
    return sum / a.length;
  }
  try {
    for (const id of presets) {
      const project = projectFor(id); await renderer.prepare(project);
      for (const [suffix, phase] of [['p0', 0], ['p25', TAU * .25]]) {
        const name = `${id}-${suffix}.png`;
        const bytes = await png(project, phase, name);
        report.captures.push({ name, preset: id, phaseRadians: phase, phaseFraction: phase / TAU, transparent: false });
        await addImage(bytes, `${id} · ${suffix === 'p0' ? '0%' : '25%'}`);
      }
      await window.study.note({ status: 'captured', preset: id, snapshot: config.snapshot.bundleSha256 });
    }
    // Contact sheet is a QA artifact; it does not enter the render/export pipeline.
    const contact = document.createElement('canvas'); contact.width = 1280; contact.height = 1152;
    const ctx = contact.getContext('2d'); ctx.fillStyle = '#100d1c'; ctx.fillRect(0, 0, contact.width, contact.height);
    for (let i = 0; i < images.length; i++) {
      const x = i % 2 * 640, y = Math.floor(i / 2) * 384;
      ctx.drawImage(images[i].image, x, y, 640, 360);
      ctx.fillStyle = '#ece8f4'; ctx.font = '15px sans-serif'; ctx.fillText(images[i].title, x + 14, y + 379);
      images[i].image.close();
    }
    const contactBlob = await new Promise(resolve => contact.toBlob(resolve, 'image/png'));
    await window.study.write('contact-sheet.png', new Uint8Array(await contactBlob.arrayBuffer()));
    const baseline = await window.study.baseline();
    if (baseline) {
      const comparison = document.createElement('canvas'); comparison.width = 1280; comparison.height = 1152;
      const comparisonContext = comparison.getContext('2d');
      comparisonContext.fillStyle = '#100d1c'; comparisonContext.fillRect(0, 0, 1280, 1152);
      for (let i = 0; i < baseline.length; i++) {
        const oldImage = await createImageBitmap(new Blob([baseline[i].bytes], { type: 'image/png' }));
        comparisonContext.drawImage(oldImage, 0, i * 384, 640, 360); oldImage.close();
        const currentProject = projectFor(baseline[i].id); await renderer.prepare(currentProject);
        const currentBytes = await renderer.exportPNG(currentProject, 0, 1280, 720);
        const currentImage = await createImageBitmap(new Blob([currentBytes], { type: 'image/png' }));
        comparisonContext.drawImage(currentImage, 640, i * 384, 640, 360); currentImage.close();
        comparisonContext.fillStyle = '#ece8f4'; comparisonContext.font = '15px sans-serif';
        comparisonContext.fillText(`${config.compare} · ${baseline[i].id}`, 14, i * 384 + 379);
        comparisonContext.fillText(`${config.label} · ${baseline[i].id}`, 654, i * 384 + 379);
      }
      const blob = await new Promise(resolve => comparison.toBlob(resolve, 'image/png'));
      await window.study.write(`comparison-to-${config.compare}.png`, new Uint8Array(await blob.arrayBuffer()));
    }
    if (config.grid || config.seedGrid) {
      const base = projectFor(config.gridPreset);
      const candidates = [];
      if (config.grid) {
        for (const [key, values] of [
          ['fold', [.25, .5, .75, 1]], ['opening', [.1, .35, .65, .9]], ['twist', [-.75, -.25, .25, .75]],
        ]) for (const value of values) {
          const candidate = structuredClone(base); candidate.layers[0].params[key] = value;
          candidates.push({ name: `${key}-${value}`, title: `${key} ${value.toFixed(2)} · seed1729`, project: candidate, grid: 'shape' });
        }
      }
      if (config.seedGrid) for (const seed of [1, 17, 41, 83, 123, 191, 811, 1729, 1969, 2718, 4093, 65537]) {
        const candidate = structuredClone(base); candidate.layers[0].params.seed = seed;
        candidates.push({ name: `seed-${seed}`, title: `seed ${seed}`, project: candidate, grid: 'seed' });
      }
      for (const gridKind of ['shape', 'seed']) {
        const cells = candidates.filter(c => c.grid === gridKind);
        if (!cells.length) continue;
        const gridCanvas = document.createElement('canvas'); gridCanvas.width = 2048; gridCanvas.height = 984;
        const gridContext = gridCanvas.getContext('2d'); gridContext.fillStyle = '#100d1c'; gridContext.fillRect(0, 0, 2048, 984);
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i]; await renderer.prepare(cell.project);
          const bytes = await renderer.exportPNG(cell.project, .7, 512, 288);
          await window.study.write(`grid-${cell.name}.png`, bytes);
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const x = i % 4 * 512, y = Math.floor(i / 4) * 328;
          gridContext.drawImage(bitmap, x, y); bitmap.close();
          gridContext.fillStyle = '#ece8f4'; gridContext.font = '16px sans-serif';
          gridContext.fillText(cell.title, x + 12, y + 313);
        }
        const blob = await new Promise(resolve => gridCanvas.toBlob(resolve, 'image/png'));
        await window.study.write(`${gridKind}-grid.png`, new Uint8Array(await blob.arrayBuffer()));
      }
      await saveJSON('grid-candidates.json', candidates);
      report.grid = { preset: config.gridPreset, phaseRadians: .7, candidates: candidates.length };
    }
    if (!config.quick) {
      for (const id of presets) {
        const project = projectFor(id, true); await renderer.prepare(project);
        const baseline = await renderer.exportPNG(project, 0, 640, 360);
        const wrapped = await renderer.exportPNG(project, TAU, 640, 360);
        assert(bytesEqual(baseline, wrapped), `${id}: phase0/TAU mismatch`);
        await renderer.exportPNG(project, 1.731, 640, 360);
        const seeked = await renderer.exportPNG(project, 0, 640, 360);
        assert(bytesEqual(baseline, seeked), `${id}: arbitrary seek changed frame0`);
        const exr = await renderer.exportEXR(project, .7, 640, 360);
        const stats = exrStats(exr);
        assert(!stats.nonFinite && !stats.alphaInvalid && !stats.zeroAlphaNonzeroRGB, `${id}: invalid EXR values`);
        assert(stats.alphaZero > 0 && stats.alphaSoft > 0 && stats.alphaOne > 0, `${id}: missing expected solid/soft/transparent coverage`);
        const delta = TAU / 300;
        const previous = exrPixels(await renderer.exportEXR(project, -delta, 320, 180));
        const zero = exrPixels(await renderer.exportEXR(project, 0, 320, 180));
        const next = exrPixels(await renderer.exportEXR(project, delta, 320, 180));
        const lastToFirst = visibleDifference(previous, zero), firstToSecond = visibleDifference(zero, next);
        report.checks.push({ preset: id, exactPhaseWrap: true, arbitrarySeekRepeatable: true, exr: stats,
          adjacentMotion: { frameCount: 300, lastToFirst, firstToSecond, ratio: lastToFirst / Math.max(firstToSecond, 1e-12), metric: 'mean abs premultiplied-linear RGBA difference; visual continuity diagnostic' } });
      }
      const project = projectFor('pearl-organism', true); await renderer.prepare(project);
      await png(project, .7, 'pearl-organism-alpha-4k.png', 3840, 2160);
      const start = performance.now();
      const exr = await renderer.exportEXR(project, .7, 3840, 2160);
      report.timings.push({ name: 'pearl-organism-4k.exr', width: 3840, height: 2160, milliseconds: performance.now() - start, bytes: exr.length, includes: 'render + async readback + EXR ZIP compression' });
      await window.study.write('pearl-organism-4k.exr', exr);
      report.checks.push({ preset: 'pearl-organism', full4K: exrStats(exr), stats: renderer.getStats() });
      const orbits = [
        ['front', 0, .2], ['left', -.85, .2], ['right', .85, .2],
        ['back', Math.PI, .2], ['above', .2, 1.1], ['below', -.2, -1.1],
      ];
      const orbitSheet = document.createElement('canvas'); orbitSheet.width = 1280; orbitSheet.height = 1152;
      const orbitContext = orbitSheet.getContext('2d'); orbitContext.fillStyle = '#100d1c'; orbitContext.fillRect(0, 0, 1280, 1152);
      for (let i = 0; i < orbits.length; i++) {
        const [name, yaw, pitch] = orbits[i];
        project.transparent = false;
        Object.assign(project.layers[0].params, { cameraYaw: yaw, cameraPitch: pitch });
        const bytes = await png(project, .7, `orbit-${name}.png`);
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const x = i % 2 * 640, y = Math.floor(i / 2) * 384;
        orbitContext.drawImage(bitmap, x, y, 640, 360); bitmap.close();
        orbitContext.fillStyle = '#ece8f4'; orbitContext.font = '15px sans-serif'; orbitContext.fillText(`${name} · yaw ${yaw.toFixed(2)} · pitch ${pitch.toFixed(2)}`, x + 14, y + 379);
        const orbitEXR = exrStats(await renderer.exportEXR(project, .7, 320, 180));
        assert(!orbitEXR.nonFinite && !orbitEXR.alphaInvalid, `orbit ${name}: nonfinite output`);
      }
      const orbitBlob = await new Promise(resolve => orbitSheet.toBlob(resolve, 'image/png'));
      await window.study.write('orbit-contact-sheet.png', new Uint8Array(await orbitBlob.arrayBuffer()));
      report.checks.push({ orbitFiniteViews: orbits.length, note: 'Normal continuity and silhouette require visual inspection of orbit-contact-sheet.png.' });
      if (config.normals) {
        // Diagnostic-only access to the physical material. The production sources
        // and immutable renderer bundle stay unchanged; normal colors still pass
        // through the app's usual finished-SDR output transform.
        const material = renderer.sculptureMaterial;
        assert(material, 'Normal diagnostic could not find the sculpture material.');
        const originalCompile = material.onBeforeCompile;
        const originalKey = material.customProgramCacheKey();
        material.onBeforeCompile = function(shader, ...rest) {
          originalCompile.call(this, shader, ...rest);
          const marker = '#include <dithering_fragment>';
          assert(shader.fragmentShader.includes(marker), 'Physical shader final-output marker changed.');
          shader.fragmentShader = shader.fragmentShader.replace(marker,
            `${marker}\ngl_FragColor=vec4(normalize(normal)*.5+.5,diffuseColor.a);`);
        };
        material.customProgramCacheKey = () => originalKey + '-study-normal-diagnostic';
        material.needsUpdate = true;
        const normalSheet = document.createElement('canvas'); normalSheet.width = 1280; normalSheet.height = 1152;
        const normalContext = normalSheet.getContext('2d'); normalContext.fillStyle = '#100d1c'; normalContext.fillRect(0, 0, 1280, 1152);
        for (let i = 0; i < orbits.length; i++) {
          const [name, yaw, pitch] = orbits[i];
          Object.assign(project.layers[0].params, { cameraYaw: yaw, cameraPitch: pitch });
          const bytes = await renderer.exportPNG(project, .7, 1280, 720);
          await window.study.write(`normals-${name}.png`, bytes);
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const x = i % 2 * 640, y = Math.floor(i / 2) * 384;
          normalContext.drawImage(bitmap, x, y, 640, 360); bitmap.close();
          normalContext.fillStyle = '#ece8f4'; normalContext.font = '15px sans-serif'; normalContext.fillText(`view-space normals · ${name}`, x + 14, y + 379);
          const normalStats = exrStats(await renderer.exportEXR(project, .7, 320, 180));
          assert(!normalStats.nonFinite, `normal debug ${name}: nonfinite output`);
        }
        const normalBlob = await new Promise(resolve => normalSheet.toBlob(resolve, 'image/png'));
        await window.study.write('normal-contact-sheet.png', new Uint8Array(await normalBlob.arrayBuffer()));
        report.checks.push({ debugNormalFiniteViews: orbits.length, note: 'Final view-space shading normals encoded as RGB, through the usual SDR output transform; diagnostic material only.' });
      }
    }
    await saveJSON('projects.json', presets.map(id => projectFor(id)));
    await window.study.done(report);
  } finally { renderer.dispose(); }
}
run().catch(error => window.study.fail(error instanceof Error ? error.stack || error.message : String(error)));
