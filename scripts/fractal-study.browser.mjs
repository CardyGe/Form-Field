const TAU = Math.PI * 2;
let presets = ['prismatic-fold', 'velvet-julia', 'abyssal-cathedral'];
const styles = ['prismatic-fold', 'julia-bloom', 'mandelbox'];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const saveJSON = (name, value) => window.study.write(name, new TextEncoder().encode(JSON.stringify(value, null, 2)));

async function run() {
  const config = await window.study.config();
  const { StudioRenderer, createProject, createLayer, applyPreset, parameterDefinitions, PRESETS, EXRLoader, FloatType } = await import(`./${config.label}-renderer.js`);
  presets = PRESETS.filter(item => item.kind === 'fractal').map(item => item.id);
  assert(!config.qualityPreset || presets.includes(config.qualityPreset), `Unknown preset ${config.qualityPreset}`);
  const renderer = new StudioRenderer(document.querySelector('#canvas'));
  const loader = new EXRLoader().setDataType(FloatType);
  const definitions = parameterDefinitions('fractal');
  const report = { label: config.label, snapshot: config.snapshot, parameterOverride:config.parameters, overridePreset:config.qualityPreset, createdAt: new Date().toISOString(), captures: [], checks: [], timings: [] };
  function projectFor(id, transparent = false) {
    const project = createProject();
    Object.assign(project, { id: 'fractal-study-project', name: id, seed: 1729, transparent, background: '#070912' });
    project.layers = [applyPreset(createLayer('fractal'), id)];
    project.layers[0].id = 'fractal-study-layer'; project.layers[0].params.seed = 1729;
    if(config.parameters && (!config.qualityPreset || config.qualityPreset===id)) {
      for(const [key,value] of Object.entries(config.parameters)) {
        const definition=definitions.find(item=>item.key===key);
        assert(definition && value>=definition.min && value<=definition.max, `Invalid parameter override ${key}`);
        project.layers[0].params[key]=value;
      }
    }
    return project;
  }
  async function png(project, phase, name, width = 1280, height = 720) {
    const start = performance.now(), bytes = await renderer.exportPNG(project, phase, width, height);
    report.timings.push({ name, width, height, milliseconds: performance.now() - start, bytes: bytes.length, includes: 'render + async readback + PNG encoding' });
    if (name) await window.study.write(name, bytes);
    return bytes;
  }
  async function contact(name, cells, columns = 2, cellWidth = 640, cellHeight = 360, labelHeight = 28) {
    const canvas = document.createElement('canvas'); canvas.width = columns * cellWidth;
    canvas.height = Math.ceil(cells.length / columns) * (cellHeight + labelHeight);
    const context = canvas.getContext('2d'); context.fillStyle = '#100d1c'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < cells.length; i++) {
      const bitmap = await createImageBitmap(new Blob([cells[i].bytes], { type: 'image/png' }));
      const x = i % columns * cellWidth, y = Math.floor(i / columns) * (cellHeight + labelHeight);
      context.drawImage(bitmap, x, y, cellWidth, cellHeight); bitmap.close();
      context.fillStyle = '#eee8f6'; context.font = '15px sans-serif';
      context.fillText(cells[i].title, x + 12, y + cellHeight + labelHeight - 7);
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await window.study.write(name, new Uint8Array(await blob.arrayBuffer()));
  }
  function pixels(bytes) { return loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).data; }
  function stats(data, width, height) {
    let nonFinite = 0, min = Infinity, max = -Infinity, alphaZero = 0, alphaSoft = 0, alphaOne = 0, alphaInvalid = 0, zeroAlphaNonzeroRGB = 0;
    let rgbMinimum = Infinity, rgbMaximum = -Infinity, luminanceSum = 0, premultipliedLuminanceSum = 0, alphaSum = 0, brightPixels = 0;
    for (let i = 0; i < data.length; i++) {
      const value = data[i]; if (!Number.isFinite(value)) nonFinite++;
      min = Math.min(min, value); max = Math.max(max, value);
      if (i % 4 !== 3) { rgbMinimum = Math.min(rgbMinimum, value); rgbMaximum = Math.max(rgbMaximum, value); }
      if (i % 4 === 3) {
        if (value === 0) { alphaZero++; if (data[i-3] || data[i-2] || data[i-1]) zeroAlphaNonzeroRGB++; }
        else if (value === 1) alphaOne++;
        else if (value > 0 && value < 1) alphaSoft++;
        else alphaInvalid++;
        const luminance = .2126*data[i-3] + .7152*data[i-2] + .0722*data[i-1];
        luminanceSum += luminance; premultipliedLuminanceSum += luminance*value; alphaSum += value;
        if (luminance > .01) brightPixels++;
      }
    }
    return { width, height, nonFinite, min, max, rgbMinimum, rgbMaximum, meanLuminance: luminanceSum / (width*height),
      meanPremultipliedLuminance:premultipliedLuminanceSum/(width*height),meanAlpha:alphaSum/(width*height),
      brightPixels, alphaZero, alphaSoft, alphaOne, alphaInvalid, zeroAlphaNonzeroRGB };
  }
  function delta(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) sum += Math.abs(a[i+channel]*a[i+3] - b[i+channel]*b[i+3]);
      sum += Math.abs(a[i+3] - b[i+3]);
    }
    return sum / a.length;
  }
  async function exr(project, phase, width = 480, height = 270, name) {
    const start = performance.now(), bytes = await renderer.exportEXR(project, phase, width, height);
    if (name) {
      report.timings.push({ name, width, height, milliseconds: performance.now() - start, bytes: bytes.length, includes: 'render + async readback + EXR ZIP compression' });
      await window.study.write(name, bytes);
    }
    return pixels(bytes);
  }
  function assertFinite(output, context) {
    assert(!output.nonFinite && !output.alphaInvalid && !output.zeroAlphaNonzeroRGB, `${context}: invalid finite/straight-alpha EXR output`);
    assert(output.rgbMinimum >= 0, `${context}: negative finished SDR RGB`);
  }
  try {
    const presetCells = [], familyCells=[[],[],[]], phaseZero = new Map();
    for (const id of presets) {
      const project = projectFor(id); await renderer.prepare(project);
      for (const [suffix, phase] of [['p0', 0], ['p25', TAU*.25]]) {
        const name = `${id}-${suffix}.png`, bytes = await png(project, phase, name);
        presetCells.push({ bytes, title: `${id} · ${phase ? '25%' : '0%'}` });
        familyCells[project.layers[0].params.style].push({ bytes, title: `${id} · ${phase ? '25%' : '0%'}` });
        if (!phase) phaseZero.set(id, bytes);
        report.captures.push({ name, preset: id, phaseRadians: phase, phaseFraction: phase/TAU, project });
      }
      await window.study.note({ status: 'captured', preset: id, snapshot: config.snapshot.bundleSha256 });
    }
    await contact('contact-sheet.png', presetCells);
    for(let style=0;style<3;style++)await contact(`${['kaleidoscope','julia','mandelbox'][style]}-contact-sheet.png`,familyCells[style]);
    const styleCells = [];
    for (let style = 0; style < styles.length; style++) {
      const project = projectFor('prismatic-fold'); project.layers[0].params.style = style;
      const name = `style-${style}-${styles[style]}.png`, bytes = await png(project, .7, name);
      styleCells.push({ bytes, title: `${style} · ${styles[style]} · shared palette` });
      report.captures.push({ name, style, phaseRadians: .7, project });
    }
    await contact('style-contact-sheet.png', styleCells, 3, 640, 360);
    await png(projectFor('prismatic-fold'), .7, 'fractal-thumb.png', 512, 288);
    const baseline = await window.study.baseline();
    if (baseline) {
      const cells = [];
      for (const old of baseline) {
        cells.push({ bytes: old.bytes, title: `${config.compare} · ${old.id}` });
        cells.push({ bytes: phaseZero.get(old.id), title: `${config.label} · ${old.id}` });
      }
      await contact(`comparison-to-${config.compare}.png`, cells);
    }
    const auditVariants = await window.study.auditVariants();
    if (auditVariants) await contact('geometry-audit-montage.png',auditVariants);
    if (config.searchBox || config.searchFold || config.searchCoarse) {
      const candidates=[];
      for (const group of config.searchCoarse ? [0,.2,.45] : config.searchFold ? [0,.2,.45,.7] : [.2,.5,.8]) {
        const cells=[];
        const detail=config.searchCoarse ? group : config.searchFold ? .45 : group;
        for (const fold of config.searchCoarse ? [0,.2] : [config.searchFold ? group : null])
        for (const boxRadius of config.searchCoarse ? [.35] : config.searchFold ? [.35,.55] : [.3,.45,.6,.75])
        for (const boxScale of config.searchCoarse ? [1.85,2.2] : config.searchFold ? [1.85,2.2,2.4] : [1.5,1.7,1.85,2,2.4,2.7]) {
          const project=projectFor('abyssal-cathedral');
          project.layers[0].palette=Array(6).fill('#c4cbd3');
          Object.assign(project.layers[0].params,{style:2,variant:0,radial:0,boxScale,boxRadius,detail,
            relief:1,roughness:.5,contrast:.5,lightAngle:-.7,glow:0,exposure:1,
            cameraYaw:.65,cameraPitch:.35,zoom:.7,travel:0,morph:0,twist:0,quality:1});
          if(fold!==null)project.layers[0].params.fold=fold;
          const name=`search-box-${fold!==null?'f'+fold+'-':''}s${boxScale}-r${boxRadius}-d${detail}.png`;
          const bytes=await png(project,0,name,640,360);
          cells.push({bytes,title:`${fold!==null?'Fold '+fold+' · ':''}Scale ${boxScale} · Radius ${boxRadius} · Detail ${detail}`});
          candidates.push({name,fold:project.layers[0].params.fold,boxScale,boxRadius,detail,phaseRadians:0,project});
        }
        const columns=config.searchCoarse?2:config.searchFold?3:6;
        await contact(`search-box-${config.searchFold?'fold-'+group:'detail-'+detail}.png`,cells,columns,config.searchFold||config.searchCoarse?640:320,config.searchFold||config.searchCoarse?360:180,32);
      }
      await saveJSON('search-box-candidates.json',candidates);
      report.shapeSearch={cases:candidates.length,palette:'neutral #c4cbd3',relief:1,roughness:.5,contrast:.5,lightAngle:-.7,
        note:'Controlled geometry search: fixed camera, palette, light and zero motion.'};
    }
    if (config.grid) {
      const base = projectFor(config.gridPreset);
      if (config.gridStyle !== null) base.layers[0].params.style = config.gridStyle;
      const candidates = [];
      for (const key of ['scale', 'detail', 'fold', 'symmetry', 'twist', 'morph', 'travel', 'relief', 'glow', 'zoom']) {
        const definition = definitions.find(item => item.key === key);
        if (!definition) continue;
        const values = Array.from({ length: 4 }, (_, index) => {
          const value = definition.min + (definition.max-definition.min)*index/3;
          return definition.step === 1 ? Math.round(value) : Math.round(value*1000)/1000;
        });
        const cells = [];
        for (let index = 0; index < values.length; index++) {
          const project = structuredClone(base); project.layers[0].params[key] = values[index];
          const name = `grid-${key}-${index}.png`, bytes = await png(project, .7, name, 640, 360);
          cells.push({ bytes, title: `${key} ${values[index]} · ${styles[project.layers[0].params.style]}` });
          candidates.push({ key, value: values[index], name, phaseRadians: .7, project });
        }
        await contact(`grid-${key}.png`, cells, 4, 480, 270, 32);
      }
      await saveJSON('grid-candidates.json', candidates);
      report.grid = { preset: config.gridPreset, style: base.layers[0].params.style, cells: candidates.length };
    }
    if (!config.quick) {
      for (const id of presets) {
        const project = projectFor(id, true); await renderer.prepare(project);
        const first = await png(project, 0, null, 480, 270);
        assert(equal(first, await png(project, TAU, null, 480, 270)), `${id}: phase wrap mismatch`);
        await png(project, 1.731, null, 480, 270);
        assert(equal(first, await png(project, 0, null, 480, 270)), `${id}: arbitrary-seek mismatch`);
        const output = stats(await exr(project, .7), 480, 270); assertFinite(output, id);
        assert(output.brightPixels > 480*270*.005, `${id}: preset rendered effectively empty`);
        if (project.layers[0].params.style < 2) assert(output.alphaOne === 480*270, `${id}: planar fractal lost opaque coverage`);
        else assert(output.alphaZero && output.alphaSoft && output.alphaOne, `${id}: 3D cutout lost transparent exterior, antialiased edges or opaque interior`);
        const previous = await exr(project, -TAU/300, 320, 180), zero = await exr(project, 0, 320, 180), next = await exr(project, TAU/300, 320, 180);
        const lastToFirst = delta(previous, zero), firstToSecond = delta(zero, next);
        const interior = [];
        // Renderer wraps the exact endpoint, so inspect the actual seam step too.
        // This is a conservative visual anomaly gate, not a C1 continuity proof.
        for (let index = 1; index <= 12; index++) {
          const phase = TAU*index/13;
          interior.push(delta(await exr(project, phase, 320, 180), await exr(project, phase+TAU/300, 320, 180)));
        }
        const maximumInterior = Math.max(...interior), meanInterior = interior.reduce((a,b) => a+b, 0)/interior.length;
        const seamThreshold = maximumInterior*4+.00001;
        assert(maximumInterior > .000001, `${id}: intended animated preset rendered static output`);
        assert(lastToFirst <= seamThreshold, `${id}: seam step ${lastToFirst} exceeds ${seamThreshold}`);
        report.checks.push({ preset: id, exactPhaseWrap: true, arbitrarySeekRepeatable: true, exr: output,
          adjacentMotion: { frameCount: 300, lastToFirst, firstToSecond, ratio: lastToFirst/Math.max(firstToSecond, 1e-12),
            interiorSamples: interior.length, maximumInterior, meanInterior, seamThreshold, seamAnomalyGatePassed: true,
            metric: 'mean abs premultiplied-linear RGBA difference; conservative C0 seam-anomaly gate, not derivative-continuity proof' } });
        await window.study.note({ status: 'loop-and-seek-passed', preset: id });
      }
    }
    if ((!config.quick || config.quality) && !config.noResolution) {
      const resolutionCells = [];
      for (const id of config.quick && config.qualityPreset ? [config.qualityPreset] : presets) {
        const project = projectFor(id, true);
        const previewPNG = await png(project, .7, `${id}-p07-720p.png`);
        const preview = stats(await exr(project, .7, 1280, 720, `${id}-720p.exr`), 1280, 720);
        const outputPNG = await png(project, .7, `${id}-4k.png`, 3840, 2160);
        const bitmap = await createImageBitmap(new Blob([outputPNG], { type: 'image/png' }));
        for (const [region, x, y] of [['center', 1408, 568], ['left', 768, 480]]) {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
          const context = canvas.getContext('2d'); context.fillStyle = '#070912'; context.fillRect(0, 0, 1024, 1024);
          context.drawImage(bitmap, x, y, 1024, 1024, 0, 0, 1024, 1024);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          const name = `${id}-4k-${region}-1to1.png`;
          await window.study.write(name, new Uint8Array(await blob.arrayBuffer()));
          report.captures.push({ name, preset: id, phaseRadians: .7, sourceSize: [3840,2160], crop: { x,y,width:1024,height:1024 }, scale: '1 source pixel = 1 crop pixel' });
        }
        bitmap.close();
        const full4K = stats(await exr(project, .7, 3840, 2160, `${id}-4k.exr`), 3840, 2160);
        assertFinite(preview, `${id} 720p`);
        assertFinite(full4K, `${id} 4K`);
        resolutionCells.push({ bytes: previewPNG, title: `${id} · 720p · 0.7 rad` });
        resolutionCells.push({ bytes: outputPNG, title: `${id} · 4K reduced · 0.7 rad` });
        report.checks.push({ preset: id, full4K, stats: renderer.getStats(),
          resolutionConsistency: { preview, exportToPreviewLuminanceRatio: full4K.meanLuminance/Math.max(preview.meanLuminance, 1e-8),
            exportToPreviewPremultipliedLuminanceRatio:full4K.meanPremultipliedLuminance/Math.max(preview.meanPremultipliedLuminance,1e-8),
            exportToPreviewAlphaRatio:full4K.meanAlpha/Math.max(preview.meanAlpha,1e-8),
            note: 'Same project and phase; inspect resolution-contact-sheet for aliasing, colour shifts and lost structure.' } });
        await window.study.note({ status: '4k-passed', preset: id });
      }
      await contact('resolution-contact-sheet.png', resolutionCells);
    }
    if (config.motion) {
      report.motionReview = [];
      for (const id of config.qualityPreset ? [config.qualityPreset] : presets) {
        const project = projectFor(id), motionCells = [], milliseconds = [];
        for (let index = 0; index < 120; index++) {
          const start = performance.now(), phase = TAU*index/120;
          const name = `motion-${id}-${String(index).padStart(4,'0')}.png`;
          const bytes = await png(project, phase, name, 1280, 720);
          milliseconds.push(performance.now()-start);
          if (index%30===0) motionCells.push({bytes,title:`${id} · ${index/120*100}%`});
        }
        await contact(`motion-${id}-contact.png`, motionCells);
        report.motionReview.push({ preset:id, frameCount:120, width:1280, height:720, fps:30, seconds:4,
          meanPNGMilliseconds:milliseconds.reduce((a,b)=>a+b,0)/milliseconds.length,
          note:'One complete source cycle accelerated into four seconds for temporal artifact review; not a delivery master.' });
        await window.study.note({status:'motion-captured',preset:id,frames:120});
      }
    }
    if (!config.quick) {
      const project = projectFor('prismatic-fold', true);
      project.layers[0].mask = { kind: 'circle', softness: .35, invert: false, size: .7 };
      project.layers[0].opacity = .37;
      const masked = stats(await exr(project, .7), 480, 270); assertFinite(masked, 'masked fractal');
      assert(masked.alphaZero && masked.alphaSoft && !masked.alphaOne, 'Masked fractal opacity/alpha regression');
      report.checks.push({ maskedOpacity: .37, mask: 'circle', exr: masked });
      const stressCases = [];
      const familyPresets=styles.map((_,style)=>PRESETS.find(item=>item.kind==='fractal'&&item.params.style===style).id);
      for (let style = 0; style < 3; style++) {
        const params = projectFor(familyPresets[style]).layers[0].params;
        for (const boundary of ['min', 'max']) {
          stressCases.push({ style, label: `all-${boundary}`, params: { ...params, ...Object.fromEntries(definitions.map(item => [item.key, item[boundary]])), style } });
        }
        for (const definition of definitions.filter(item=>!['style','variant','quality','radial'].includes(item.key))) {
          for (const value of [definition.min, definition.max]) stressCases.push({ style, label: `${definition.key}-${value}`, params: { ...params, [definition.key]: value, style } });
        }
        for(const variant of [0,1,2])for(const quality of [0,1,2])for(const radial of style===2?[0,1]:[0]) {
          stressCases.push({style,label:`variant-${variant}-quality-${quality}-radial-${radial}`,params:{...params,variant,quality,radial,style}});
        }
        for(const seed of [0,4294967295])stressCases.push({style,label:`seed-${seed}`,params:{...params,seed,style}});
      }
      const stressReport = [], stressCells = [], qualityCells=[[],[],[]];
      for (let index = 0; index < stressCases.length; index++) {
        const candidate = stressCases[index], project = projectFor(familyPresets[candidate.style], true);
        project.layers[0].params = candidate.params;
        for (const phase of [0, 1.731, TAU-TAU/300]) assertFinite(stats(await exr(project, phase, 256, 144), 256, 144), `Stress case ${index} at ${phase}`);
        const zero = await png(project, 0, null, 256, 144);
        assert(equal(zero, await png(project, TAU, null, 256, 144)), `Stress case ${index}: endpoint mismatch`);
        stressReport.push({ style: candidate.style, label: candidate.label, params: candidate.params, finitePhases: 3, exactPhaseWrap: true });
        if (candidate.label.startsWith('all-')) stressCells.push({ bytes: zero, title: `${styles[candidate.style]} · ${candidate.label}` });
        if(candidate.label.startsWith('variant-'))qualityCells[candidate.style].push({bytes:zero,title:candidate.label});
        if (index % 24 === 23) await window.study.note({ status: 'stress-passed', style: candidate.style, cases: index+1 });
      }
      await contact('stress-contact-sheet.png', stressCells, 2, 512, 288, 32);
      for(let style=0;style<3;style++)await contact(`stress-family-${style}-variants-quality.png`,qualityCells[style],3,384,216,32);
      await saveJSON('stress-report.json', stressReport);
      report.checks.push({ stressCases: stressCases.length, finitePhaseOutputs: stressCases.length*3, exactWrapChecks: stressCases.length });
      const zoomCases=[];
      for(const detail of [0,1]) {
        const project=projectFor('chromatic-lattice',true);
        Object.assign(project.layers[0].params,{detail,quality:2,zoom:2,morph:0,travel:0});
        const name=`maxzoom-detail-${detail}-4k.png`;
        const image=await png(project,.7,name,3840,2160);
        const output=stats(await exr(project,.7,3840,2160),3840,2160);
        assertFinite(output,`Mandelbox max zoom Detail ${detail}`);
        assert(output.meanAlpha>.05,`Mandelbox max zoom Detail ${detail} lost its surface`);
        const bitmap=await createImageBitmap(new Blob([image],{type:'image/png'}));
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
        const context=canvas.getContext('2d');context.fillStyle='#070912';context.fillRect(0,0,1024,1024);
        context.drawImage(bitmap,1408,568,1024,1024,0,0,1024,1024);bitmap.close();
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        await window.study.write(`maxzoom-detail-${detail}-1to1.png`,new Uint8Array(await blob.arrayBuffer()));
        zoomCases.push({detail,output});
      }
      const coverageRatio=zoomCases[0].output.meanAlpha/zoomCases[1].output.meanAlpha;
      assert(coverageRatio>.85&&coverageRatio<1.15,`Low Detail max-zoom surface coverage drift ${coverageRatio}`);
      report.checks.push({maxZoom4K:zoomCases,lowToHighDetailCoverageRatio:coverageRatio});
      const detailJoins=[];
      for(let index=1;index<2;index++) {
        const project=projectFor('chromatic-lattice',true);
        Object.assign(project.layers[0].params,{quality:2,morph:0,travel:0,detail:index/2-.00001});
        const before=await exr(project,0,480,270);
        project.layers[0].params.detail=index/2+.00001;
        const after=await exr(project,0,480,270),difference=delta(before,after);
        assert(difference<.001,`Animated Detail jumps at recursion join ${index}/2`);
        detailJoins.push({detail:index/2,difference});
      }
      report.checks.push({animatedDetailRecursionJoins:detailJoins,note:'Checks tiny parameter steps around every internal recursion boundary.'});
    }
    await saveJSON('projects.json', presets.map(id => projectFor(id)));
    await window.study.done(report);
  } finally { renderer.dispose(); }
}
run().catch(error => window.study.fail(error instanceof Error ? error.stack || error.message : String(error)));
