/**
 * Getting a look ready without freezing the wall. The first draw with a new shader waits for the graphics driver to
 * finish linking it, on the page's only thread. While the gate is on, a draw whose program is still linking is
 * refused before it reaches three.js, so the caller can carry on and try again on a later frame.
 */
export interface LinkingProgram { isReady(): boolean }

/** A draw was refused because its program is still linking. Nothing has failed. */
export class ProgramsCompiling extends Error {
  constructor() { super('Shaders are still being prepared.'); this.name = 'ProgramsCompiling'; }
}

/** A program that never reports back (its context was lost) stops holding up the others after this long. */
const TURN_LIMIT_MS = 5000;
/**
 * The graphics process links on one thread for every context, and any wait on it holds up the wall. So across all
 * renderers only one gated program links at a time.
 */
let turn: { gate: ProgramGate; since: number } | null = null;

export class ProgramGate {
  /** Off, as it is outside Perform, nothing is ever refused. */
  on = false;
  private waiting: LinkingProgram | null = null;
  /** The last attempt was refused because another renderer holds the turn. */
  private queued = false;
  private readonly linked = new WeakMap<object, number>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Whether the program that stopped the last attempt is still linking. */
  get linking(): boolean {
    if (!this.on || !this.waiting) return false;
    if (this.waiting.isReady()) { this.waiting = null; this.endTurn(); return false; }
    return true;
  }
  private endTurn(): void { if (turn?.gate === this) turn = null; }
  private otherHoldsTurn(): boolean {
    if (!turn || turn.gate === this) return false;
    if (!turn.gate.linking || this.now() - turn.since > TURN_LIMIT_MS) { turn = null; return false; }
    return true;
  }
  /** Whether trying again now would only be refused: its own program is linking, or it is waiting behind another renderer's. */
  get blocked(): boolean {
    if (this.linking) return true;
    if (this.queued && this.on && this.otherHoldsTurn()) return true;
    this.queued = false;
    return false;
  }
  /** Before an attempt: no point in redrawing the earlier passes while the same wait is still on. */
  check(): void { if (this.blocked) throw new ProgramsCompiling(); }
  /** Before starting a link: refused while another renderer's program is linking. */
  awaitTurn(): void {
    if (!this.on || !this.otherHoldsTurn()) return;
    this.queued = true;
    throw new ProgramsCompiling();
  }
  /** Whether these materials, as they are now, have already linked here, so nothing needs starting or checking. */
  knows(materials: readonly { version: number }[]): boolean { return materials.every(m => this.linked.get(m) === m.version); }
  /** Before a draw: refuses it if any of its programs is still linking. */
  before(programs: Iterable<LinkingProgram | null | undefined>): void {
    if (!this.on) return;
    for (const program of programs) if (program && !program.isReady()) {
      this.waiting = program;
      turn = { gate: this, since: this.now() };
      throw new ProgramsCompiling();
    }
  }
  remember(materials: readonly { version: number }[]): void { for (const m of materials) this.linked.set(m, m.version); }
  open(): void { this.endTurn(); this.on = true; this.waiting = null; this.queued = false; }
  close(): void { this.endTurn(); this.on = false; this.waiting = null; this.queued = false; }
}

/**
 * Runs work that may be refused until it goes through. After a refusal it always gives the page a turn, and tries again
 * only once the wait is over, so what the work builds is not built again and again meanwhile.
 * False when `wanted` says the work is no longer needed.
 */
export async function retryWhenLinked(attempt: () => void, gate: ProgramGate, pause: () => Promise<void>, wanted: () => boolean): Promise<boolean> {
  for (;;) {
    try { attempt(); return true; }
    catch (error) { if (!(error instanceof ProgramsCompiling)) throw error; }
    do {
      await pause();
      if (!wanted()) return false;
    } while (gate.blocked);
  }
}
