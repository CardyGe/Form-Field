/**
 * Links applied for one frame of drawing: shapes' brightness, opacity and placement, instruments' speed and settings.
 * Pure apart from the smoothing it keeps between frames. The show, its compositions and their undo history are never
 * changed: only what is drawn.
 */
import { readParameterDefinitions } from '../core/project';
import type { Project } from '../shared/types';
import { evaluate, type Link } from '../react/links';
import type { Signals } from '../react/signals';
import { parseTarget, type ShapeProp } from './targets';
import { BRIGHTNESS_MAX, SPEED_RANGE, ZOOM_RANGE, type Shape } from './show';

export interface ModShow { shapes: Shape[]; sources: { id: string; speed: number; tempoSync?: number | null }[]; groups: { id: string }[]; links?: Link[] }
export interface ParamOverride { layer: number; key: string; value: number }
export interface Modulated<T extends ModShow> { show: T; opacity: Map<string, number>; speed: Map<string, number>; params: Map<string, ParamOverride[]> }

const SHAPE_RANGE: Record<ShapeProp, [number, number]> = { brightness: [0, BRIGHTNESS_MAX], opacity: [0, 1], zoom: [ZOOM_RANGE.min, ZOOM_RANGE.max], turn: [-180, 180], movex: [-1, 1], movey: [-1, 1] };

function shapeBase(shape: Shape, prop: ShapeProp): number {
  switch (prop) {
    case 'brightness': return shape.brightness;
    case 'opacity': return 1;
    case 'zoom': return shape.placement.zoom;
    case 'turn': return shape.placement.turn;
    case 'movex': return shape.placement.offset.x;
    case 'movey': return shape.placement.offset.y;
  }
}

/** A copy of the composition with some settings changed: the same layers (ids), so the renderer keeps their history. */
export function withParams(project: Project, overrides: ParamOverride[] | undefined): Project {
  if (!overrides?.length) return project;
  return { ...project, layers: project.layers.map((layer, i) => {
    const mine = overrides.filter(o => o.layer === i);
    return mine.length ? { ...layer, params: { ...layer.params, ...Object.fromEntries(mine.map(o => [o.key, o.value])) } } : layer;
  }) };
}

/** An instrument in tempo sync: where its loop is (radians), one loop every `beats` beats of the clock; null without a clock. */
export function tempoPhase(signals: Signals, beats: number): number | null {
  const beat = signals['tempo.beat'], phase = signals['tempo.phase'];
  if (beat === undefined || phase === undefined || !(beats > 0)) return null;
  const loops = (beat + phase) / beats;
  return (loops - Math.floor(loops)) * Math.PI * 2;
}

export class Modulator {
  private readonly state = new Map<string, number>();

  apply<T extends ModShow>(show: T, projects: ReadonlyMap<string, Project>, signals: Signals, dt: number): Modulated<T> {
    const out: Modulated<T> = { show, opacity: new Map(), speed: new Map(), params: new Map() };
    const links = show.links ?? [];
    if (!links.length) return out;
    const byTarget = new Map<string, Link[]>();
    for (const l of links) if (l.on) (byTarget.get(l.target) ?? byTarget.set(l.target, []).get(l.target)!).push(l);
    const changed = new Map<string, Shape>();
    for (const [target, group] of byTarget) {
      const t = parseTarget(target);
      if (!t) continue;
      if (t.kind === 'shape') {
        const shape = changed.get(t.shapeId) ?? show.shapes.find(s => s.id === t.shapeId);
        if (!shape) continue;
        const [min, max] = SHAPE_RANGE[t.prop];
        const value = evaluate(shapeBase(shape, t.prop), { min, max }, group, signals, this.state, dt);
        if (t.prop === 'opacity') { out.opacity.set(shape.id, value); continue; }
        const next: Shape = { ...shape, placement: { ...shape.placement, offset: { ...shape.placement.offset } } };
        if (t.prop === 'brightness') next.brightness = value;
        else if (t.prop === 'zoom') next.placement.zoom = value;
        else if (t.prop === 'turn') next.placement.turn = value;
        else if (t.prop === 'movex') next.placement.offset.x = value;
        else next.placement.offset.y = value;
        changed.set(shape.id, next);
      } else if (t.kind === 'speed') {
        const source = show.sources.find(s => s.id === t.sourceId);
        if (source) out.speed.set(source.id, evaluate(source.speed, SPEED_RANGE, group, signals, this.state, dt));
      } else {
        const project = projects.get(t.sourceId), layer = project?.layers[t.layer];
        const def = layer && readParameterDefinitions(layer.kind).find(d => d.key === t.key);
        const base = layer?.params[t.key];
        if (!def || typeof base !== 'number') continue;
        const value = evaluate(base, { min: def.min, max: def.max }, group, signals, this.state, dt);
        (out.params.get(t.sourceId) ?? out.params.set(t.sourceId, []).get(t.sourceId)!).push({ layer: t.layer, key: t.key, value });
      }
    }
    // Smoothing for links that are gone is forgotten.
    for (const id of [...this.state.keys()]) if (!links.some(l => l.id === id)) this.state.delete(id);
    if (changed.size) out.show = { ...show, shapes: show.shapes.map(s => changed.get(s.id) ?? s) };
    return out;
  }
}
