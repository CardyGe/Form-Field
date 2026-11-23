import { MERIDIAN_PARAMETERS } from './parameters';

export interface HeldOverride { layer: number; key: string; value: number }
interface HeldLayer { kind: string; params: Readonly<Record<string, number>> }

const DENSE = 1;
const STRUCTURAL = new Set(MERIDIAN_PARAMETERS.filter(d => d.structural).map(d => d.key));

/**
 * Dense composes a whole Score from its structural values, so a link moving one would compose every frame. Its value is taken
 * once per loop instead, as the loop comes round. Evolve and Pulse glide or read these live, so they pass straight through.
 */
export class StructureHold {
  private readonly sources = new Map<string, { phase: number; values: Map<string, number> }>();

  apply<T extends HeldOverride>(id: string, project: { layers: readonly HeldLayer[] }, overrides: T[] | undefined, phase: number): T[] | undefined {
    if (!overrides?.length) { this.sources.delete(id); return overrides; }
    const held = (o: T) => { const layer = project.layers[o.layer]; return layer?.kind === 'meridian' && Math.round(layer.params.scoreStyle ?? 2) === DENSE && STRUCTURAL.has(o.key); };
    if (!overrides.some(held)) { this.sources.delete(id); return overrides; }
    let state = this.sources.get(id);
    const turned = !state || phase < state.phase;
    if (!state) this.sources.set(id, state = { phase, values: new Map() });
    state.phase = phase;
    return overrides.map(o => {
      if (!held(o)) return o;
      const name = `${o.layer}:${o.key}`;
      if (turned || !state!.values.has(name)) state!.values.set(name, o.value);
      return { ...o, value: state!.values.get(name)! };
    });
  }

  forget(id: string): void { this.sources.delete(id); }
}
