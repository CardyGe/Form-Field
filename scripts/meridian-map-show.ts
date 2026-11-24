// Show files for the Meridian checks in verify-map.mjs. Run with tsx: meridian-map-show.ts <output folder>
import fs from 'node:fs';
import path from 'node:path';
import { createLayer, createProject } from '../src/core/project';
import { createShow, shapeExtras, type CurvePoint, type Shape, type ShowDocument } from '../src/map/show';
import type { Link } from '../src/react/links';
import type { Project } from '../src/shared/types';

const box = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const shape = (id: string, points: CurvePoint[], sourceId: string | null, colour = '#ffffff'): Shape => ({ id, name: id, points, colour, visible: true, locked: false, sourceId, ...shapeExtras() });
const source = (id: string, project: Project): ShowDocument['sources'][number] => ({ id, kind: 'instrument', project, speed: 1, revision: 1, tempoSync: null });
const link = (id: string, input: string, target: string): Link => ({ id, input, target, mode: 'control', amount: 1, low: 0, high: 1, attackMs: 0, releaseMs: 0, on: true, name: id });

function meridian(style: number, seed: number, params: Record<string, number> = {}): Project {
  const project = createProject(), layer = createLayer('meridian');
  layer.id = `meridian-${style}-${seed}`;
  Object.assign(layer.params, { scoreStyle: style, seed, ...params });
  project.schemaVersion = 2; project.layers = [layer]; project.background = '#000000'; project.duration = 2; project.fps = { num: 60, den: 1 };
  return project;
}

/** Evolve on several mapped shapes, two of them sharing one source, with Drop and Hold on MIDI notes. */
function calm(): ShowDocument {
  return {
    ...createShow(),
    shapes: [shape('a', box(60 / 1920, 60 / 1080, 660 / 1920, 600 / 1080), 'ev'), shape('b', box(720 / 1920, 60 / 1080, 1320 / 1920, 600 / 1080), 'ev'), shape('c', [{ x: .69, y: .06 }, { x: .97, y: .1 }, { x: .93, y: .6 }, { x: .72, y: .54 }], 'ev2'), shape('d', [{ x: .2, y: .62 }, { x: .8, y: .62 }, { x: .9, y: .96 }, { x: .1, y: .96 }], 'ev3')],
    sources: [source('ev', meridian(2, 1729)), source('ev2', meridian(2, 4242)), source('ev3', meridian(2, 90210))],
    links: [link('drop', 'midi.note.1.60', 'source.ev.param.0.moveDrop'), link('hold', 'midi.note.1.62', 'source.ev.param.0.moveHold'), link('reseed', 'midi.note.1.64', 'source.ev.param.0.moveReseed')],
  };
}

/** Dense, Pulse and Evolve all strobing at 5 Hz over the whole wall, inside a bent stage. */
function strobe(guard: number): ShowDocument {
  const loud = { macroDensity: 1, macroHeat: 1, ringWeight: 14, spokeWeight: 14, lightExposure: 3, lightBackgroundLift: 1, safetyFlashGuard: guard };
  const sources = [source('dense', meridian(1, 5, loud)), source('pulse', meridian(0, 6, loud)), source('evolve', meridian(2, 7, loud))];
  for (const s of sources) s.project.layers[0].modulations.opacity = { kind: 'pulse', cycles: 10, phase: 0, amount: 1, points: [], range: { min: 0, max: 1 } };
  return {
    ...createShow(),
    shapes: [shape('s1', box(0, 0, .34, 1), 'dense'), shape('s2', box(.33, 0, .67, 1), 'pulse'), shape('s3', box(.66, 0, 1, 1), 'evolve')].map(s => ({ ...s, brightness: 2 })),
    sources,
    stageCorners: [{ x: .03, y: .03 }, { x: .97, y: .03 }, { x: .97, y: .97 }, { x: .03, y: .97 }],
  };
}

/** No Meridian at all: a white shape a MIDI control strobes. The wall guard must not touch it. */
function plain(): ShowDocument {
  return { ...createShow(), shapes: [{ ...shape('p', box(.1, .1, .9, .9), null), fill: 'colour' }], links: [{ ...link('flash', 'midi.cc.1.20', 'shape.p.brightness'), high: .5 }] };
}

/** No Meridian: Oil and Liquid Light side by side, for the context-loss check on a show without Meridian. */
function oilLiquid(): ShowDocument {
  const instrument = (kind: 'oil' | 'liquid'): Project => {
    const project = createProject(), layer = createLayer(kind);
    layer.id = `${kind}-check`;
    project.schemaVersion = 2; project.layers = [layer]; project.background = '#000000'; project.duration = 8; project.fps = { num: 60, den: 1 };
    return project;
  };
  return { ...createShow(), shapes: [shape('oil', box(.04, .1, .48, .9), 'oil'), shape('liquid', box(.52, .1, .96, .9), 'liquid')], sources: [source('oil', instrument('oil')), source('liquid', instrument('liquid'))] };
}

/** A white wall a MIDI control flashes, with a small Evolve so the wall guard is on (or, with guard 0, warned about). */
function burst(guard: number): ShowDocument {
  return {
    ...createShow(),
    shapes: [{ ...shape('wash', box(0, 0, 1, 1), null), fill: 'colour' }, shape('e', box(.42, .42, .58, .58), 'ev')],
    sources: [source('ev', meridian(2, 1729, { safetyFlashGuard: guard }))],
    links: [{ ...link('flash', 'midi.cc.1.21', 'shape.wash.brightness'), high: .5 }],
  };
}

/** Left and right halves, each on its own control. */
function halves(): ShowDocument {
  return {
    ...createShow(),
    shapes: [{ ...shape('left', box(0, 0, .5, 1), null), fill: 'colour' }, { ...shape('right', box(.5, 0, 1, 1), null), fill: 'colour' }, shape('e', box(.46, .46, .54, .54), 'ev')],
    sources: [source('ev', meridian(2, 1729))],
    links: [{ ...link('l', 'midi.cc.1.21', 'shape.left.brightness'), high: .5 }, { ...link('r', 'midi.cc.1.22', 'shape.right.brightness'), high: .5 }],
  };
}

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
for (const [name, show] of Object.entries({ calm: calm(), 'strobe-on': strobe(1), 'strobe-off': strobe(0), plain: plain(), 'oil-liquid': oilLiquid(), 'burst-on': burst(1), 'burst-off': burst(0), halves: halves() })) fs.writeFileSync(path.join(out, `meridian-${name}.formshow`), JSON.stringify(show));
