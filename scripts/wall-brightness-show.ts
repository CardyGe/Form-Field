// Show files for verify-wall-brightness.mjs. Run with tsx: wall-brightness-show.ts <output folder>
// The same bright look on one, two and three shapes, plus a plain white control on the same shapes.
import fs from 'node:fs';
import path from 'node:path';
import { createLayer, createProject } from '../src/core/project';
import { createShow, shapeExtras, type CurvePoint, type Shape, type ShowDocument } from '../src/map/show';
import type { Project } from '../src/shared/types';

const box = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const shape = (id: string, points: CurvePoint[], sourceId: string | null): Shape => ({ id, name: id, points, colour: '#ffffff', visible: true, locked: false, sourceId, ...shapeExtras() });
const source = (id: string, project: Project): ShowDocument['sources'][number] => ({ id, kind: 'instrument', project, speed: 1, revision: 1, tempoSync: null });

function look(kind: string, params: Record<string, number> = {}): Project {
  const project = createProject(), layer = createLayer(kind as never);
  layer.id = `${kind}-wall`;
  Object.assign(layer.params, params);
  project.schemaVersion = 2; project.layers = [layer]; project.background = '#000000'; project.duration = 4; project.fps = { num: 60, den: 1 };
  return project;
}

// Three places, side by side, each about a sixth of the wall.
const PLACES = [box(.04, .2, .32, .8), box(.36, .2, .64, .8), box(.68, .2, .96, .8)];

const out = process.argv[2], kind = process.argv[3] ?? 'meridian';
const params = kind === 'meridian' ? { scoreStyle: 2, seed: 1729 } : {};
fs.mkdirSync(out, { recursive: true });
for (let n = 1; n <= 3; n++) {
  // Every shape plays its own copy, as a person adding shapes one by one with the same look would get.
  // Names are unique to each file, so opening the next file never looks like the same source to the wall.
  const shapes = PLACES.slice(0, n).map((p, i) => shape(`${kind}${n}-s${i}`, p, `${kind}${n}-src${i}`));
  const sources = shapes.map((_, i) => source(`${kind}${n}-src${i}`, look(kind, params)));
  fs.writeFileSync(path.join(out, `wall-${kind}-${n}.formshow`), JSON.stringify({ ...createShow(), shapes, sources }));
  const white = PLACES.slice(0, n).map((p, i) => ({ ...shape(`white${n}-${i}`, p, null), fill: 'colour' as const }));
  fs.writeFileSync(path.join(out, `wall-white-${n}.formshow`), JSON.stringify({ ...createShow(), shapes: white }));
}
