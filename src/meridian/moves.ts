import type { EvolveMoves } from './evolve';

export type LinkedEdit = { kind: 'none' | 'mutate' | 'reseed'; slot: number } | { kind: 'recall'; slot: number };
const NONE: LinkedEdit = { kind: 'none', slot: -1 };
const MUTATE: LinkedEdit = { kind: 'mutate', slot: -1 };
const RESEED: LinkedEdit = { kind: 'reseed', slot: -1 };
const RECALLS: readonly LinkedEdit[] = Array.from({ length: 8 }, (_, slot) => ({ kind: 'recall' as const, slot }));
const down = (value: number | undefined): boolean => (value ?? 0) >= 0.5;

/**
 * The one path from a press to Evolve. Held moves (keys, pads) and linked moves (MIDI through a Map link) are combined here.
 * Mutate, Reseed and Recall from a key have already edited the layer, so only a link's rising edge is reported as an edit.
 */
export class MoveRouter {
  private mutate = false; private reseed = false; private recall = 0;

  read(held: (key: string) => number, params: Readonly<Record<string, number>>, out: EvolveMoves): LinkedEdit {
    out.next = held('moveNext') > 0 || down(params.moveNext);
    out.hold = held('moveHold') > 0 || down(params.moveHold);
    out.drop = held('moveDrop') > 0 || down(params.moveDrop);
    out.collapse = held('moveCollapse') > 0 || down(params.moveCollapse);
    out.burst = held('moveBurst') > 0 || down(params.moveBurst);
    const mutate = down(params.moveMutate), reseed = down(params.moveReseed), value = params.moveRecall ?? 0, recall = Number.isFinite(value) ? Math.max(0, Math.min(8, Math.round(value))) : 0;
    const rose = recall > 0 && recall !== this.recall, mutated = mutate && !this.mutate, reseeded = reseed && !this.reseed;
    this.mutate = mutate; this.reseed = reseed; this.recall = recall;
    return rose ? RECALLS[recall - 1] : reseeded ? RESEED : mutated ? MUTATE : NONE;
  }
}
