import { StudioRenderer, createProject, createLayer, applyPreset, phaseAtFrame } from './renderer.js';
async function run() {
  const renderer = new StudioRenderer(document.querySelector('#canvas'));
  const timings = [];
  const started = performance.now();
  try {
    const project = createProject(); project.name = 'Sculpted Opal v2'; project.transparent = true;
    project.id = 'sculpted-opal-v2-proof'; project.seed = 1729;
    project.layers = [applyPreset(createLayer('sculpture'), 'pearl-organism')];
    project.layers[0].id = 'sculpted-opal-v2-layer'; project.layers[0].params.seed = 1729;
    await renderer.prepare(project);
    await window.sculptureProof.still('sculpture-thumb.png', await renderer.exportPNG({ ...project, transparent: false }, .7, 512, 288));
    await window.sculptureProof.still('Sculpted-Opal-v2-4K-alpha.png', await renderer.exportPNG(project, .7, 3840, 2160));
    const job = await window.sculptureProof.start({ project, format: 'prores4444', width: 3840, height: 2160,
      fps: { num: 30, den: 1 }, frameCount: 300, transparent: true, background: '#000000' });
    const exactProject = structuredClone(job.request.project);
    const zero = await renderer.exportEXR(exactProject, 0, 3840, 2160);
    await window.sculptureProof.phase('zero', zero);
    await window.sculptureProof.phase('full-cycle', await renderer.exportEXR(exactProject, 2 * Math.PI, 3840, 2160));
    await renderer.exportEXR(exactProject, 1.731, 3840, 2160);
    await window.sculptureProof.phase('zero-after-arbitrary-seek', await renderer.exportEXR(exactProject, 0, 3840, 2160));
    const completed = new Set(job.completedFrames);
    if (!completed.has(0)) { await window.sculptureProof.frame(job.id, 0, zero); completed.add(0); }
    for (let i = 1; i < 300; i++) {
      if (completed.has(i)) continue;
      const start = performance.now();
      const bytes = await renderer.exportEXR(exactProject, phaseAtFrame(i, 300), 3840, 2160);
      timings.push(performance.now() - start);
      await window.sculptureProof.frame(job.id, i, bytes);
    }
    const sorted = [...timings].sort((a, b) => a-b);
    await window.sculptureProof.finish(job.id, { frameCount: 300, width: 3840, height: 2160, fps: '30/1',
      exactPhaseWrap4K: true, arbitrarySeekRepeatable4K: true, renderMilliseconds: {
        measuredFrames: timings.length, mean: timings.reduce((a,b) => a+b, 0) / Math.max(timings.length, 1),
        median: sorted[Math.floor(sorted.length / 2)] ?? null, p95: sorted[Math.floor(sorted.length * .95)] ?? null,
        includes: 'render + async half-float readback + EXR ZIP compression',
      }, renderStageSeconds: (performance.now() - started) / 1000, stats: renderer.getStats() });
  } finally { renderer.dispose(); }
}
run().catch(error => window.sculptureProof.fail(error instanceof Error ? error.stack || error.message : String(error)));
