import type { EvolveMoves } from './evolve';

export type LinkedEdit = { kind: 'none' | 'mutate' | 'reseed'; slot: number } | { kind: 'recall'; slot: number };
const NONE: LinkedEdit = { kind: 'none', slot: -1 };
const MUTATE: LinkedEdit = { kind: 'mutate', slot: -1 };
const RESEED: LinkedEdit = { kind: 'reseed', slot: -1 };
const RECALLS: readonly LinkedEdit[] = Array.from({ length: 8 }, (_, slot) => ({ kind: 'recall' as const, slot }));
const PRESS = 0.6, RELEASE = 0.4;   // A linked control must clearly cross both, so jitter around the middle is one press.
const RECALL_SETTLE = 2;            // Frames a linked Recall must rest before it counts, because link smoothing passes through other slots.
const RECALL_STILL = 0.0005;        // Slots a resting control may still move per frame.
const RECALL_NEAR = 0.08;           // How close to a whole slot it must rest.
const down = (value: number | undefined): boolean => (value ?? 0) >= 0.5;

/**
 * The one path from a press to Evolve. Held moves (keys, pads) and linked moves (MIDI through a Map link) are combined here.
 * Mutate, Reseed and Recall from a key have already edited the layer, so only a link's press is reported as an edit.
 */
export class MoveRouter {
  private mutate = false; private reseed = false; private recallArmed = true; private recallValue = 0; private recallFrames = 0;

  read(held: { get(layerId: string, key: string): number }, layerId: string, params: Readonly<Record<string, number>>, out: EvolveMoves): LinkedEdit {
    out.next = held.get(layerId, 'moveNext') > 0 || down(params.moveNext);
    out.hold = held.get(layerId, 'moveHold') > 0 || down(params.moveHold);
    out.drop = held.get(layerId, 'moveDrop') > 0 || down(params.moveDrop);
    out.collapse = held.get(layerId, 'moveCollapse') > 0 || down(params.moveCollapse);
    out.burst = held.get(layerId, 'moveBurst') > 0 || down(params.moveBurst);
    const mutateValue = params.moveMutate ?? 0, reseedValue = params.moveReseed ?? 0;
    const mutated = !this.mutate && mutateValue >= PRESS, reseeded = !this.reseed && reseedValue >= PRESS;
    if (mutated) this.mutate = true; else if (mutateValue <= RELEASE) this.mutate = false;
    if (reseeded) this.reseed = true; else if (reseedValue <= RELEASE) this.reseed = false;
    const raw = params.moveRecall ?? 0, value = Number.isFinite(raw) ? Math.max(0, Math.min(8, raw)) : 0, recall = Math.round(value);
    const resting = Math.abs(value - this.recallValue) <= RECALL_STILL && Math.abs(value - recall) <= RECALL_NEAR;
    this.recallValue = value;
    let recalled = 0;
    if (recall === 0) { this.recallArmed = true; this.recallFrames = 0; }
    else if (this.recallArmed) {
      // Fires where the control comes to rest, so a pad through link smoothing lands on its own slot and a sweep fires nothing on the way.
      this.recallFrames = resting ? this.recallFrames + 1 : 0;
      if (this.recallFrames >= RECALL_SETTLE) { recalled = recall; this.recallArmed = false; }
    }
    return recalled > 0 ? RECALLS[recalled - 1] : reseeded ? RESEED : mutated ? MUTATE : NONE;
  }
}

/** What linked moves have changed for this session. Moving a slider takes that slider back; loading a project clears it all. */
export class LinkedOverrides {
  seed: number | null = null;
  private readonly keys: string[] = [];
  private readonly from: number[] = [];
  private readonly to: number[] = [];

  /** Keeps what Mutate moved, measured from the sliders as they stand. */
  mutated(base: Readonly<Record<string, number>>, after: Readonly<Record<string, number>>): void {
    for (const key of Object.keys(after)) {
      const at = this.keys.indexOf(key);
      if (after[key] === base[key]) { if (at >= 0) this.remove(at); continue; }
      if (at >= 0) { this.from[at] = base[key]; this.to[at] = after[key]; }
      else { this.keys.push(key); this.from.push(base[key]); this.to.push(after[key]); }
    }
  }

  apply(base: Readonly<Record<string, number>>, live: Record<string, number>): void {
    for (let i = this.keys.length - 1; i >= 0; i--) {
      if (base[this.keys[i]] !== this.from[i]) this.remove(i);
      else live[this.keys[i]] = this.to[i];
    }
  }

  clear(): void { this.seed = null; this.keys.length = 0; this.from.length = 0; this.to.length = 0; }

  private remove(at: number): void {
    const end = this.keys.length - 1;
    this.keys[at] = this.keys[end]; this.from[at] = this.from[end]; this.to[at] = this.to[end];
    this.keys.length = end; this.from.length = end; this.to.length = end;
  }
}
