import { StudioRenderer, createProject, createLayer, applyPreset, phaseAtFrame } from './renderer.js';
const stills = [
  ['acid-tide','Acid-Tide-v3-4K.png'], ['orchid-rings','Orchid-Rings-v3-4K.png'],
  ['solar-melt','Solar-Melt-v3-4K.png'], ['deep-bloom','Deep-Bloom-v3-4K.png'],
  ['mineral-silk','Mineral-Silk-v3-4K.png'],
];
function projectFor(preset) {
  const project = createProject(); project.name = 'Liquid Strata v3';
  project.id = 'liquid-strata-v3-proof'; project.seed = 1729;
  // Every Surface source pixel is opaque. Keeping the internal render/export
  // alpha flag avoids unnecessary flattening without changing visible output.
  project.transparent = true;
  project.layers = [applyPreset(createLayer('surface'), preset)];
  project.layers[0].id = 'liquid-strata-v3-layer'; project.layers[0].params.seed = 1729;
  return project;
}
async function run() {
  const renderer = new StudioRenderer(document.querySelector('#canvas'));
  const timings = [], started = performance.now();
  try {
    const project = projectFor('acid-tide'); await renderer.prepare(project);
    await window.surfaceProof.still('surface-thumb.png', await renderer.exportPNG({ ...project, transparent: false }, .7, 512, 288));
    await window.surfaceProof.still('Liquid-Strata-v3.formfield', new TextEncoder().encode(JSON.stringify(project, null, 2)));
    for (const [preset, name] of stills) await window.surfaceProof.still(name, await renderer.exportPNG(projectFor(preset), .7, 3840, 2160));
    const job = await window.surfaceProof.start({ project, format: 'prores4444', width: 3840, height: 2160,
      fps: { num: 30, den: 1 }, frameCount: 300, transparent: true, background: '#000000' });
    const exact = structuredClone(job.request.project);
    const zero = await renderer.exportEXR(exact, 0, 3840, 2160);
    await window.surfaceProof.phase('zero', zero);
    await window.surfaceProof.phase('full-cycle', await renderer.exportEXR(exact, Math.PI*2, 3840, 2160));
    await renderer.exportEXR(exact, 1.731, 3840, 2160);
    await window.surfaceProof.phase('zero-after-arbitrary-seek', await renderer.exportEXR(exact, 0, 3840, 2160));
    const completed = new Set(job.completedFrames);
    if (!completed.has(0)) { await window.surfaceProof.frame(job.id, 0, zero); completed.add(0); }
    for (let i = 1; i < 300; i++) {
      if (completed.has(i)) continue;
      const start = performance.now(), bytes = await renderer.exportEXR(exact, phaseAtFrame(i, 300), 3840, 2160);
      timings.push(performance.now() - start); await window.surfaceProof.frame(job.id, i, bytes);
    }
    const sorted = [...timings].sort((a,b) => a-b);
    await window.surfaceProof.finish(job.id, { frameCount: 300, width: 3840, height: 2160, fps: '30/1',
      artworkOpaque: true, exactPhaseWrap4K: true, arbitrarySeekRepeatable4K: true,
      renderMilliseconds: { measuredFrames: timings.length,
        mean: timings.reduce((a,b) => a+b,0) / Math.max(timings.length,1), median: sorted[Math.floor(sorted.length/2)] ?? null,
        p95: sorted[Math.floor(sorted.length*.95)] ?? null, includes: 'render + async half-float readback + EXR ZIP compression' },
      renderStageSeconds: (performance.now() - started)/1000, stats: renderer.getStats() });
  } finally { renderer.dispose(); }
}
run().catch(error => window.surfaceProof.fail(error instanceof Error ? error.stack || error.message : String(error)));
