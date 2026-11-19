/**
 * Undo grouping for Map's Effect tab: every change during one drag (or one held key) is one undo step; every change
 * outside a drag (a reset, a typed value, a choice) is a step of its own. Keys never repeat, even across panels.
 */
let next = 0;
export class EditGrouper {
  private current: number | null = null;
  /** A drag, or a held key (whose repeats each begin again): one step until it ends. */
  begin(): void { this.current ??= ++next; }
  end(): void { this.current = null; }
  /** The merge key for an edit to `what` now. */
  key(what: string): string { return `${what}#${this.current ?? ++next}`; }
}
