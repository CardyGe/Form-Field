import { StudioRenderer, createProject, createLayer, applyPreset, phaseAtFrame } from './renderer.js';
const stills = [
  ['prismatic-fold','Prismatic-Fold-v4-4K.png'],
  ['velvet-julia','Velvet-Julia-v4-4K.png'],
  ['abyssal-cathedral','Abyssal-Cathedral-v4-4K.png'],
];
function projectFor(preset) {
  const names = { 'prismatic-fold': 'Prismatic Bloom v4', 'velvet-julia': 'Velvet Julia v4', 'abyssal-cathedral': 'Abyssal Cathedral v4' };
  const project = createProject(); project.name = names[preset];
  project.id = preset + '-v4-proof'; project.seed = 1729;
  // The planar Prismatic Fold movie is opaque. Keep alpha in the retained
  // master pipeline so the 3D Cathedral still also retains its real cutout.
  project.transparent = true;
  project.layers = [applyPreset(createLayer('fractal'), preset)];
  project.layers[0].id = preset + '-v4-layer'; project.layers[0].params.seed = 1729;
  return project;
}
async function run() {
  const renderer = new StudioRenderer(document.querySelector('#canvas'));
  const timings = [], started = performance.now();
  try {
    const project = projectFor('prismatic-fold'); await renderer.prepare(project);
    await window.fractalProof.still('fractal-thumb.png', await renderer.exportPNG({ ...project, transparent: false }, .7, 512, 288));
    await window.fractalProof.still('Prismatic-Bloom-v4.formfield', new TextEncoder().encode(JSON.stringify(project, null, 2)));
    for (const [preset, name] of [['velvet-julia', 'Velvet-Julia-v4.formfield'], ['abyssal-cathedral', 'Abyssal-Cathedral-v4.formfield']]) {
      await window.fractalProof.still(name, new TextEncoder().encode(JSON.stringify(projectFor(preset), null, 2)));
    }
    for (const [preset, name] of stills) await window.fractalProof.still(name, await renderer.exportPNG(projectFor(preset), .7, 3840, 2160));
    const cathedral = projectFor('abyssal-cathedral'); cathedral.transparent = false;
    for (let index = 0; index < 300; index++) {
      await window.fractalProof.motionFrame(index, await renderer.exportPNG(cathedral, phaseAtFrame(index, 300), 1280, 720));
    }
    const job = await window.fractalProof.start({ project, format: 'prores4444', width: 3840, height: 2160,
      fps: { num: 30, den: 1 }, frameCount: 300, transparent: true, background: '#000000' });
    const exact = structuredClone(job.request.project);
    const zero = await renderer.exportEXR(exact, 0, 3840, 2160);
    await window.fractalProof.phase('zero', zero);
    await window.fractalProof.phase('full-cycle', await renderer.exportEXR(exact, Math.PI*2, 3840, 2160));
    await renderer.exportEXR(exact, 1.731, 3840, 2160);
    await window.fractalProof.phase('zero-after-arbitrary-seek', await renderer.exportEXR(exact, 0, 3840, 2160));
    const completed = new Set(job.completedFrames);
    if (!completed.has(0)) { await window.fractalProof.frame(job.id, 0, zero); completed.add(0); }
    for (let i = 1; i < 300; i++) {
      if (completed.has(i)) continue;
      const start = performance.now(), bytes = await renderer.exportEXR(exact, phaseAtFrame(i, 300), 3840, 2160);
      timings.push(performance.now() - start); await window.fractalProof.frame(job.id, i, bytes);
    }
    const sorted = [...timings].sort((a,b) => a-b);
    await window.fractalProof.finish(job.id, { frameCount: 300, width: 3840, height: 2160, fps: '30/1',
      artworkOpaque: true, exactPhaseWrap4K: true, arbitrarySeekRepeatable4K: true,
      renderMilliseconds: { measuredFrames: timings.length,
        mean: timings.reduce((a,b) => a+b,0) / Math.max(timings.length,1), median: sorted[Math.floor(sorted.length/2)] ?? null,
        p95: sorted[Math.floor(sorted.length*.95)] ?? null, includes: 'render + async half-float readback + EXR ZIP compression' },
      renderStageSeconds: (performance.now() - started)/1000, stats: renderer.getStats() });
  } finally { renderer.dispose(); }
}
run().catch(error => window.fractalProof.fail(error instanceof Error ? error.stack || error.message : String(error)));
