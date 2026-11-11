// Renders the frames around the loop point for every library preset.
import { StudioRenderer } from '../src/rendering/StudioRenderer';
import { PRESETS, createProject, createLayer, applyPreset } from '../src/core/project';
import { frameCount, phaseAtFrame } from '../src/core/timeline';

declare global { interface Window { audit: {
  begin(): Promise<{ width: number; height: number; only: string[] }>;
  indices(total: number): Promise<number[]>;
  frame(presetId: string, index: number, bytes: Uint8Array): Promise<void>;
  measure(presetId: string, name: string, kind: string, frames: number): Promise<void>;
  done(error?: string): Promise<void>;
} } }

async function run(): Promise<void> {
  const { width, height, only } = await window.audit.begin();
  const renderer = new StudioRenderer(document.querySelector<HTMLCanvasElement>('#canvas')!);
  try {
    for (const preset of PRESETS.filter(p => !only.length || only.includes(p.id))) {
      const project = createProject();
      project.name = preset.name; project.transparent = true;
      project.layers = [applyPreset(createLayer(preset.kind), preset.id)];
      const total = frameCount(project);
      await renderer.prepare(project);
      for (const index of await window.audit.indices(total)) {
        await window.audit.frame(preset.id, index, await renderer.exportEXR(project, phaseAtFrame(index, total), width, height));
      }
      await window.audit.measure(preset.id, preset.name, preset.kind, total);
    }
    await window.audit.done();
  } catch (error) {
    await window.audit.done(error instanceof Error ? error.stack || error.message : String(error));
  } finally { renderer.dispose(); }
}
void run();
