/**
 * Meridian's autopilot, for installations: with no one at the controls, it keeps Evolve changing, reproducibly from its seed.
 *
 * It only ever presses Evolve's continuous moves, Next (glide to the next form) and Mutate (a session-only variation of the
 * structure), so nothing cuts. Changes land on the 8-beat grid of the Conductor's clock, which keeps time with or without
 * music, at a varied pace around the chosen one. Every change carries a fresh seed that does not repeat within 32 changes.
 * Hold shape stops it.
 *
 * Pure and allocation-free: `next` returns one of two shared objects.
 */
import { createRandom } from './random';

export type AutopilotMove = 'moveNext' | 'moveMutate';
export interface AutopilotAction { readonly seed: number; readonly moves: readonly AutopilotMove[] }

export const AUTOPILOT = {
  /** Changes within which a seed never repeats. */
  history: 32,
  /** Changes land on this grid of beats. */
  phraseBeats: 8,
  /** Seeds run from 1 to this, the panel's seed range. */
  maxSeed: 999999,
  /** The pace chosen, in beats between changes; each gap is this times one of PACE. */
  defaultBeats: 32,
  minBeats: 16,
  maxBeats: 128,
  /** Share of changes that Mutate rather than Next. */
  mutateShare: .4,
} as const;

/** Each gap is the chosen pace times one of these, so the rhythm of change never settles into a pattern. */
const PACE = [.75, 1, 1, 1.25, 1.5] as const;
const NONE: AutopilotAction = Object.freeze({ seed: 0, moves: Object.freeze([]) as readonly AutopilotMove[] });
const NEXT: readonly AutopilotMove[] = Object.freeze(['moveNext']);
const MUTATE: readonly AutopilotMove[] = Object.freeze(['moveMutate']);

export class Autopilot {
  private readonly random: () => number;
  private readonly every: number;
  private readonly recent = new Uint32Array(AUTOPILOT.history);
  private count = 0;
  private due = Number.NaN;
  private mutatesRunning = 0;
  private nextsRunning = 0;
  private readonly action: { seed: number; moves: readonly AutopilotMove[] } = { seed: 0, moves: NEXT };

  constructor(seed = 1, everyBeats: number = AUTOPILOT.defaultBeats) {
    this.random = createRandom((Number.isFinite(seed) ? Math.trunc(seed) : 1) >>> 0 ^ 0x6d2b79f5);
    this.every = Number.isFinite(everyBeats) ? Math.max(AUTOPILOT.minBeats, Math.min(AUTOPILOT.maxBeats, everyBeats)) : AUTOPILOT.defaultBeats;
  }

  /** Once a frame, with the Conductor's clock. Returns a change when one is due, otherwise no moves. */
  next(frame: { readonly beats: number }, params: Readonly<Record<string, number>>): AutopilotAction {
    const beats = frame.beats;
    if (!Number.isFinite(beats)) return NONE;
    // Hold shape is the operator keeping this form: nothing changes, and the count starts again when it is let go.
    if ((params.scoreHoldShape ?? 0) >= .5) { this.due = Number.NaN; return NONE; }
    if (Number.isNaN(this.due)) { this.due = this.after(beats); return NONE; }
    if (beats < this.due) {
      // The clock went back (a reset): count again from here.
      if (this.due - beats > AUTOPILOT.maxBeats * 2) this.due = this.after(beats);
      return NONE;
    }
    // Late by more than a gap (a stall or a jump): one change now, and the next a full gap from here, never a burst.
    this.due = this.after(beats);
    const mutate = this.mutatesRunning >= 2 ? false : this.nextsRunning >= 4 ? true : this.random() < AUTOPILOT.mutateShare;
    if (mutate) { this.mutatesRunning++; this.nextsRunning = 0; } else { this.nextsRunning++; this.mutatesRunning = 0; }
    this.action.moves = mutate ? MUTATE : NEXT;
    this.action.seed = this.freshSeed();
    return this.action;
  }

  /** The next change: a varied gap from `beats`, on the phrase grid. */
  private after(beats: number): number {
    const gap = this.every * PACE[Math.floor(this.random() * PACE.length) % PACE.length];
    return Math.ceil((beats + gap) / AUTOPILOT.phraseBeats) * AUTOPILOT.phraseBeats;
  }

  private freshSeed(): number {
    const recent = this.recent, used = Math.min(this.count, recent.length);
    let seed = 0;
    for (let tries = 0; tries < 64; tries++) {
      seed = 1 + Math.floor(this.random() * AUTOPILOT.maxSeed);
      let seen = false;
      for (let i = 0; i < used; i++) if (recent[i] === seed) { seen = true; break; }
      if (!seen) break;
    }
    recent[this.count % recent.length] = seed;
    this.count++;
    return seed;
  }
}
