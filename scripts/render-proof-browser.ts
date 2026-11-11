import { StudioRenderer } from '../src/rendering/StudioRenderer';
import { createProject, createLayer, applyPreset } from '../src/core/project';
import { phaseAtFrame } from '../src/core/timeline';
import type { ExportJob, ExportRequest } from '../src/shared/types';

declare global { interface Window { proof: {
  start(request: ExportRequest): Promise<ExportJob>;
  frame(id: string, index: number, bytes: Uint8Array): Promise<void>;
  note(note: unknown): Promise<void>;
  still(name: string, bytes: Uint8Array): Promise<void>;
  finish(id: string): Promise<unknown>;
  fail(error: string): Promise<void>;
} } }

async function run(): Promise<void> {
  const renderer = new StudioRenderer(document.querySelector<HTMLCanvasElement>('#canvas')!);
  try {
    const fresh = createProject(); fresh.name = 'Neon Strata'; fresh.transparent = true;
    Object.assign(fresh.layers[0].params, { warp: .62, detail: .62, softness: .16, scale: 4.4, reveal: .13 });
    const job = await window.proof.start({ project: fresh, format: 'prores422',
      width: 3840, height: 2160, fps: { num: 30, den: 1 }, frameCount: 300,
      transparent: false, background: fresh.background });
    const project = structuredClone(job.request.project); project.transparent = true;
    await renderer.prepare(project);
    const a = await renderer.exportPNG(project, 0, 640, 360);
    const b = await renderer.exportPNG(project, Math.PI * 2, 640, 360);
    if (a.length !== b.length || a.some((byte, index) => byte !== b[index])) throw new Error('Exact phase-wrap verification failed.');
    await renderer.exportPNG(project, 1.7, 640, 360);
    const c = await renderer.exportPNG(project, 0, 640, 360);
    if (a.length !== c.length || a.some((byte, index) => byte !== c[index])) throw new Error('Arbitrary-seek repeatability verification failed.');
    await window.proof.note({ exactPhaseWrap: true, arbitrarySeekRepeatable: true,
      renderContract: 'finished-sdr-linear-srgb-straight-v1', width: 3840, height: 2160,
      frameCount: 300, fps: '30/1', durationSeconds: 10 });
    const opaque = { ...project, transparent: false };
    await window.proof.still('Neon-Strata-4K.png', await renderer.exportPNG(opaque, .9, 3840, 2160));
    const sculpture = createProject(); sculpture.name = 'Pearlescent Folds'; sculpture.transparent = true;
    sculpture.layers = [applyPreset(createLayer('sculpture'), 'pearl-organism')];
    await window.proof.still('Pearlescent-Folds-4K-alpha.png', await renderer.exportPNG(sculpture, .7, 3840, 2160));
    const completed = new Set(job.completedFrames);
    for (let index = 0; index < 300; index++) {
      if (completed.has(index)) continue;
      const bytes = await renderer.exportEXR(project, phaseAtFrame(index, 300), 3840, 2160);
      await window.proof.frame(job.id, index, bytes);
    }
    await window.proof.finish(job.id);
  } finally { renderer.dispose(); }
}

run().catch(error => window.proof.fail(error instanceof Error ? error.stack || error.message : String(error)));
