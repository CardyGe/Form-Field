/**
 * What a link can drive in Map, by name, and the ready-made reactions. Targets:
 *   shape.<id>.brightness | opacity | zoom | turn | movex | movey
 *   source.<id>.speed
 *   source.<id>.param.<layer>.<setting>
 * A target's range comes from the shape's own rules, or from the instrument's parameter definitions.
 */
import { readParameterDefinitions, scopeParameterVisible } from '../core/project';
import type { Layer } from '../shared/types';
import { BRIGHTNESS_MAX, SPEED_RANGE, ZOOM_RANGE, type ShowDocument } from './show';
import type { Link } from '../react/links';

export const SHAPE_PROPS = { brightness: 'Brightness', opacity: 'Opacity', zoom: 'Zoom', turn: 'Turn', movex: 'Move across', movey: 'Move up and down' } as const;
export type ShapeProp = keyof typeof SHAPE_PROPS;
export type Target =
  | { kind: 'shape'; shapeId: string; prop: ShapeProp }
  | { kind: 'speed'; sourceId: string }
  | { kind: 'param'; sourceId: string; layer: number; key: string };

const ID = '([A-Za-z0-9_-]{1,64})';
const SHAPE = new RegExp(`^shape\\.${ID}\\.(brightness|opacity|zoom|turn|movex|movey)$`);
const SPEED = new RegExp(`^source\\.${ID}\\.speed$`);
const PARAM = new RegExp(`^source\\.${ID}\\.param\\.([0-3])\\.([A-Za-z0-9_]{1,40})$`);

export function parseTarget(target: string): Target | null {
  let m = SHAPE.exec(target);
  if (m) return { kind: 'shape', shapeId: m[1], prop: m[2] as ShapeProp };
  m = SPEED.exec(target);
  if (m) return { kind: 'speed', sourceId: m[1] };
  m = PARAM.exec(target);
  if (m) return { kind: 'param', sourceId: m[1], layer: Number(m[2]), key: m[3] };
  return null;
}

export function canLinkParameter(layer: Layer, key: string): boolean {
  return layer.kind !== 'scope' || key !== 'scopeMode' && key !== 'emberPhrases';
}

/** A saved link for another Scope mode stays in the show until that mode is used again. */
export function activeParameterLink(layer: Layer, key: string): boolean {
  return canLinkParameter(layer, key) && (layer.kind !== 'scope' || scopeParameterVisible(layer.params, key));
}

/** The target's range, or null when what it names is not in the show. */
export function targetRange(show: Pick<ShowDocument, 'shapes' | 'sources'>, target: string): { min: number; max: number; label: string } | null {
  const t = parseTarget(target);
  if (!t) return null;
  if (t.kind === 'shape') {
    const shape = show.shapes.find(s => s.id === t.shapeId);
    if (!shape) return null;
    const range = { brightness: [0, BRIGHTNESS_MAX], opacity: [0, 1], zoom: [ZOOM_RANGE.min, ZOOM_RANGE.max], turn: [-180, 180], movex: [-1, 1], movey: [-1, 1] }[t.prop];
    return { min: range[0], max: range[1], label: `${shape.name} · ${SHAPE_PROPS[t.prop]}` };
  }
  const source = show.sources.find(s => s.id === t.sourceId);
  if (!source) return null;
  if (t.kind === 'speed') return { min: SPEED_RANGE.min, max: SPEED_RANGE.max, label: `${source.project.name} · Speed` };
  const layer = source.project.layers[t.layer];
  if (!layer || !canLinkParameter(layer, t.key)) return null;
  const def = readParameterDefinitions(layer.kind).find(d => d.key === t.key);
  if (!def || typeof layer.params[t.key] !== 'number') return null;
  return { min: def.min, max: def.max, label: `${source.project.name} · ${def.label}` };
}

/** For the wall, which does not hold compositions: shapes and sources only, settings checked when drawn. */
export function targetNamesKnown(show: { shapes: { id: string }[]; sources: { id: string }[] }, target: string): boolean {
  const t = parseTarget(target);
  if (!t) return false;
  return t.kind === 'shape' ? show.shapes.some(s => s.id === t.shapeId) : show.sources.some(s => s.id === t.sourceId);
}

/** The ready-made reactions: each adds ordinary links, adjustable afterwards. */
export const REACTIONS = {
  pulse: { label: 'Pulse on the beat', link: { input: 'beat.pulse', prop: 'brightness', amount: 0.35, attackMs: 0, releaseMs: 150 } },
  breathe: { label: 'Breathe with the level', link: { input: 'audio.level', prop: 'brightness', amount: 0.3, attackMs: 80, releaseMs: 500 } },
  'bass-zoom': { label: 'Bass zoom', link: { input: 'audio.bass', prop: 'zoom', amount: 0.08, attackMs: 20, releaseMs: 220 } },
  'highs-flicker': { label: 'Highs flicker', link: { input: 'audio.highs', prop: 'opacity', amount: -0.5, attackMs: 0, releaseMs: 90 } },
  'instrument-bass': { label: 'Instrument on the bass', link: { input: 'audio.bass', prop: 'param', amount: 0.3, attackMs: 30, releaseMs: 300 } },
} as const;
export type Reaction = keyof typeof REACTIONS;

/** The links a reaction adds for a shape, or a reason it cannot (no instrument, or no motion setting). */
export function reactionLinks(show: Pick<ShowDocument, 'shapes' | 'sources'>, reaction: Reaction, shapeId: string, ids: string[]): Link[] | string {
  const r = REACTIONS[reaction], shape = show.shapes.find(s => s.id === shapeId);
  if (!shape) return 'not-found';
  let target = `shape.${shapeId}.${r.link.prop}`;
  if (r.link.prop === 'param') {
    const source = shape.sourceId ? show.sources.find(s => s.id === shape.sourceId) : undefined;
    if (!source) return 'needs-instrument';
    const layer = source.project.layers[0];
    const defs = readParameterDefinitions(layer.kind).filter(d => activeParameterLink(layer, d.key) && typeof layer.params[d.key] === 'number' && d.max > d.min && d.key !== 'seed' && !d.preparation);
    const preferred = layer.kind === 'scope' && layer.params.scopeMode === 1 ? 'emberOpening' : null;
    const def = defs.find(d => preferred ? d.key === preferred : d.section === 'Motion') ?? defs[0];
    if (!def) return 'needs-instrument';
    target = `source.${source.id}.param.0.${def.key}`;
  }
  return [{ id: ids[0], input: r.link.input, target, mode: 'modulate', amount: r.link.amount, low: 0, high: 1, attackMs: r.link.attackMs, releaseMs: r.link.releaseMs, on: true, name: r.label }];
}

/** Every target in the show, for the links list: each shape's settings, then each instrument's speed and settings. */
export function targetOptions(show: Pick<ShowDocument, 'shapes' | 'sources'>): { target: string; label: string }[] {
  const out: { target: string; label: string }[] = [];
  for (const shape of show.shapes) for (const prop of Object.keys(SHAPE_PROPS)) out.push({ target: `shape.${shape.id}.${prop}`, label: `${shape.name} · ${SHAPE_PROPS[prop as ShapeProp]}` });
  for (const source of show.sources) {
    out.push({ target: `source.${source.id}.speed`, label: `${source.project.name} · Speed` });
    source.project.layers.forEach((layer, i) => {
      for (const d of readParameterDefinitions(layer.kind)) {
        if (!activeParameterLink(layer, d.key) || typeof layer.params[d.key] !== 'number' || !(d.max > d.min) || d.key === 'seed' || d.preparation) continue;
        out.push({ target: `source.${source.id}.param.${i}.${d.key}`, label: `${source.project.name}${source.project.layers.length > 1 ? ` (layer ${i + 1})` : ''} · ${d.label}` });
      }
    });
  }
  return out;
}
