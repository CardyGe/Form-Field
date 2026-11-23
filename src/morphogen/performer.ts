import { MORPH_LOOKS } from './looks';
import { applyMacros, type MacroKey } from './macros';
import { MORPH_CONTROLS, validateMorphParams, type MorphKey, type MorphParams } from './params';
import type { MorphInput } from './solver';

type Overlay = Partial<MorphParams>;
interface Layer { overlay: Overlay; baseAt: MorphParams | null }

const MUTABLE: MorphKey[] = ['drive', 'asymmetry', 'alignment', 'forkRate', 'lineSharp', 'spiral', 'curlAmount', 'flowSpeed', 'surge', 'depth', 'bevel', 'roughness', 'irid', 'filmNm', 'filmVary', 'colourShift', 'colourZones', 'chroma', 'bloom'];
const MUTATE_REACH = .18, MUTATE_SECONDS = 1.5, UNDO_SECONDS = .6, SCRAMBLE_SECONDS = 3.5;
const CONTROLS = new Map(MORPH_CONTROLS.map(c => [c.key, c]));

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** The moves a performer makes on a running picture. The simulation never restarts for any of them. */
export class MorphPerformer {
  private layer: Layer = { overlay: {}, baseAt: null };
  private readonly history: Layer[] = [];
  private shown: MorphParams | null = null;
  private from: MorphParams | null = null;
  private progress = 0;
  private duration = 1;
  private held = false;
  private energy = 0;
  private pendingMutation: number | null = null;

  morphTo(index: number, seconds: number): void {
    const look = MORPH_LOOKS[index];
    if (!look) return;
    this.layer = { overlay: { ...look.params }, baseAt: null };
    this.begin(seconds);
  }

  hold(on: boolean): void { this.held = on; }
  mutate(seed: number): void { this.pendingMutation = seed; }
  scramble(): void { this.energy = 1; }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.layer = previous;
    this.begin(UNDO_SECONDS);
  }

  private begin(seconds: number): void {
    this.from = this.shown;
    this.progress = 0;
    this.duration = Math.max(1 / 240, seconds);
  }

  /** A moved slider wins: an overlaid value applies only while the operator's own value is unchanged. */
  private target(base: MorphParams): MorphParams {
    this.layer.baseAt ??= base;
    const at = this.layer.baseAt, out = { ...base };
    for (const key of Object.keys(this.layer.overlay) as MorphKey[]) if (base[key] === at[key]) out[key] = this.layer.overlay[key]!;
    return out;
  }

  private applyMutation(base: MorphParams, seed: number): void {
    const current = this.target(base), next = random(seed), overlay: Overlay = { ...this.layer.overlay };
    for (const key of MUTABLE) {
      const c = CONTROLS.get(key)!;
      overlay[key] = Math.max(c.min, Math.min(c.max, current[key] + (next() * 2 - 1) * MUTATE_REACH * (c.max - c.min)));
    }
    this.history.push(this.layer);
    if (this.history.length > 16) this.history.shift();
    this.layer = { overlay, baseAt: this.layer.baseAt };
    this.begin(MUTATE_SECONDS);
  }

  /** `base` is what the operator set. `modulated` is the same with sound and MIDI links applied, which move around the look. */
  frame(seconds: number, base: MorphParams, macros: Record<MacroKey, number>, modulated: MorphParams = base): { params: MorphParams; input: Pick<MorphInput, 'impulse' | 'seedBurst'> } {
    if (this.pendingMutation !== null) { this.applyMutation(base, this.pendingMutation); this.pendingMutation = null; }
    const target = this.target(base);
    let shown = target;
    if (this.from) {
      this.progress = Math.min(1, this.progress + seconds / this.duration);
      if (this.progress >= 1) this.from = null;
      else {
        const t = this.progress * this.progress * (3 - 2 * this.progress), from = this.from;
        shown = { ...target };
        for (const c of MORPH_CONTROLS) shown[c.key] = c.step === 1 ? (t < .5 ? from[c.key] : target[c.key]) : from[c.key] + (target[c.key] - from[c.key]) * t;
      }
    }
    this.shown = shown;
    const energy = this.energy;
    this.energy = Math.max(0, this.energy - seconds / SCRAMBLE_SECONDS);
    let linked = shown;
    if (modulated !== base) {
      linked = { ...shown };
      for (const c of MORPH_CONTROLS) if (c.step < 1) linked[c.key] += modulated[c.key] - base[c.key];
      linked = validateMorphParams(linked);
    }
    const stirred = energy > 0 ? { ...linked, flowSpeed: linked.flowSpeed + energy * .35, surge: linked.surge + energy * .4 } : linked;
    const played = applyMacros(stirred, macros);
    const params = energy > 0 && played === stirred ? { ...played, flowSpeed: Math.min(1, played.flowSpeed), surge: Math.min(1, played.surge) } : played;
    return { params: this.held ? { ...params, speed: 0 } : params, input: { impulse: energy, seedBurst: energy * .7 } };
  }
}
