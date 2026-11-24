/**
 * Which moves are down right now, per layer. Held moves are performance state, so they stay out of the Project:
 * a press never triggers preparation, autosave or Undo. The Conductor reads them each frame with `heldMoves.get`.
 */
export class HeldMoves {
  private readonly layers = new Map<string, Map<string, number>>();

  get(layerId: string, key: string): number {
    return this.layers.get(layerId)?.get(key) ?? 0;
  }

  set(layerId: string, key: string, value: number): void {
    let moves = this.layers.get(layerId);
    if (value === 0) {
      moves?.delete(key);
      if (moves?.size === 0) this.layers.delete(layerId);
      return;
    }
    if (!moves) this.layers.set(layerId, moves = new Map());
    moves.set(key, value);
  }

  clear(layerId: string): void {
    this.layers.delete(layerId);
  }
}

export const heldMoves = new HeldMoves();
