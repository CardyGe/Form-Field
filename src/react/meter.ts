/** The latest signals for the meters, a few times a second. Only the meters listen, so the rest of the screen never re-renders for them. */
import type { Signals } from './signals';

export class MeterStore {
  private value: Signals = {};
  private readonly listeners = new Set<() => void>();
  readonly get = (): Signals => this.value;
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(value: Signals): void { this.value = value; for (const l of this.listeners) l(); }
}
