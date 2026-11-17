/** Undo history of immutable snapshots, held by reference. */
export class History<T> {
  private states: T[];
  private index = 0;

  constructor(initial: T, private readonly limit = 100) {
    this.states = [initial];
  }

  present(): T { return this.states[this.index]; }

  commit(next: T): void {
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(next);
    if (this.states.length > this.limit) this.states = this.states.slice(this.states.length - this.limit);
    this.index = this.states.length - 1;
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    this.index--;
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) return false;
    this.index++;
    return true;
  }

  canUndo(): boolean { return this.index > 0; }
  canRedo(): boolean { return this.index < this.states.length - 1; }
}
