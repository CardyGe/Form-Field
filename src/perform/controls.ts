/**
 * Perform control logic: abstract control events (from the on-screen controller now,
 * from the MIDImix later) in, performance actions and control values out.
 * Pure: inputs are never mutated, and control positions are never saved anywhere.
 */

/**
 * `hardware`: the position came from the physical controller. Only those wait to cross a held value after the controller
 * is lost: the on-screen controller and the keyboard always take their value at once.
 */
export type ControlEvent =
  | { kind: 'knob'; strip: number; knob: 0 | 1 | 2; value: number; hardware?: boolean } | { kind: 'fader'; strip: number; value: number; hardware?: boolean } | { kind: 'master'; value: number; hardware?: boolean }
  | { kind: 'amber' | 'red'; strip: number; down: boolean } | { kind: 'bankNext' | 'bankBack' | 'solo'; down: boolean }
  | { kind: 'sendAllStart' } | { kind: 'sendAllEnd' };

export type PerformAction =
  | { type: 'next' | 'previous' | 'stop'; zone: number } | { type: 'burst'; zone: number; on: boolean }
  | { type: 'bankNext' | 'bankBack' | 'launchNow' | 'downbeat' | 'tap' | 'follow' }
  /** A click on the grid during a show: that cell, or that whole row, on the next boundary. */
  | { type: 'launchCell'; row: number; zone: number } | { type: 'launchScene'; row: number };

export interface ControlValues {
  faders: number[];
  knobs: number[][];
  master: number;
  /** False until a Send All has finished: the picture stays black. */
  ready: boolean;
  /**
   * One flag per control: faders 0-7, then knobs (8 + strip * 3 + knob), then master (32).
   * A held control keeps its value until it is moved through that value.
   */
  held: boolean[];
  /** Last ignored position of each held control, to tell when it has crossed. Absent means none. */
  seen?: (number | null)[];
}

const STRIPS = 8;
const FADER_AT = 0;
const KNOB_AT = STRIPS;
const MASTER_AT = STRIPS + STRIPS * 3;
const CONTROLS = MASTER_AT + 1;
const DEAD_ZONE = 0.04;

export const initialControls = (): ControlValues => ({
  faders: Array.from({ length: STRIPS }, () => 0),
  knobs: Array.from({ length: STRIPS }, () => [0.5, 0.5, 0.5]),
  master: 0,
  ready: false,
  held: Array.from({ length: CONTROLS }, () => false),
});

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : Number.isFinite(n) ? n : 0);
const validStrip = (s: number) => Number.isInteger(s) && s >= 0 && s < STRIPS;

function cloneValues(v: ControlValues): ControlValues {
  return {
    faders: v.faders.slice(),
    knobs: v.knobs.map((k) => k.slice()),
    master: v.master,
    ready: v.ready,
    held: v.held.slice(),
    ...(v.seen ? { seen: v.seen.slice() } : {}),
  };
}

/** Whether a control's new position should be taken, updating the hold bookkeeping. */
function takes(v: ControlValues, index: number, current: number, value: number, hardware: boolean): boolean {
  if (!v.held[index]) return true;
  // The screen shows the value it moves, so it has nothing to cross. It leaves the hardware's hold as it was.
  if (!hardware) return true;
  const prev = v.seen?.[index] ?? null;
  const crossed = value === current || (prev !== null && (prev - current) * (value - current) < 0);
  if (crossed) {
    v.held[index] = false;
    if (v.seen) v.seen[index] = null;
    return true;
  }
  if (!v.seen) v.seen = Array.from({ length: CONTROLS }, () => null);
  v.seen[index] = value;
  return false;
}

export function applyControl(v: ControlValues, e: ControlEvent, shift: boolean): { values: ControlValues; actions: PerformAction[]; shift: boolean } {
  const values = cloneValues(v);
  const actions: PerformAction[] = [];
  let nextShift = shift;
  const live = values.ready;
  switch (e.kind) {
    case 'knob':
      if (validStrip(e.strip) && (e.knob === 0 || e.knob === 1 || e.knob === 2)) {
        const x = clamp01(e.value);
        if (takes(values, KNOB_AT + e.strip * 3 + e.knob, values.knobs[e.strip][e.knob], x, e.hardware === true)) values.knobs[e.strip][e.knob] = x;
      }
      break;
    case 'fader':
      if (validStrip(e.strip)) {
        const x = clamp01(e.value);
        if (takes(values, FADER_AT + e.strip, values.faders[e.strip], x, e.hardware === true)) values.faders[e.strip] = x;
      }
      break;
    case 'master': {
      const x = clamp01(e.value);
      if (takes(values, MASTER_AT, values.master, x, e.hardware === true)) values.master = x;
      break;
    }
    case 'solo':
      nextShift = e.down;
      break;
    case 'amber':
      if (live && e.down && validStrip(e.strip)) actions.push({ type: shift ? 'previous' : 'next', zone: e.strip });
      break;
    case 'red':
      if (!validStrip(e.strip)) break;
      // Releasing always ends a burst, even if shift came down meanwhile, so it cannot stick on.
      if (!e.down) actions.push({ type: 'burst', zone: e.strip, on: false });
      else if (live) actions.push(shift ? { type: 'stop', zone: e.strip } : { type: 'burst', zone: e.strip, on: true });
      break;
    case 'bankNext':
      if (live && e.down) actions.push({ type: shift ? 'launchNow' : 'bankNext' });
      break;
    case 'bankBack':
      if (live && e.down) actions.push({ type: shift ? 'downbeat' : 'bankBack' });
      break;
    case 'sendAllStart':
      // Every control takes its next reported position at once.
      values.held = values.held.map(() => false);
      delete values.seen;
      break;
    case 'sendAllEnd':
      values.held = values.held.map(() => false);
      delete values.seen;
      values.ready = true;
      break;
  }
  return { values, actions, shift: nextShift };
}

/** A controller went away mid-show: keep the picture and every value, but make each control earn its way back. */
export function holdForReconnect(v: ControlValues): ControlValues {
  const out = cloneValues(v);
  out.held = out.held.map(() => true);
  delete out.seen;
  return out;
}

/** Knob position 0..1 as an offset from centre, -1..1, with a dead zone of ±0.04 around the middle. */
export function knobOffset(value: number): number {
  const d = clamp01(value) - 0.5;
  const mag = Math.abs(d);
  if (mag <= DEAD_ZONE) return 0;
  return Math.sign(d) * Math.min(1, (mag - DEAD_ZONE) / (0.5 - DEAD_ZONE));
}

/** Free clips scale from a quarter to four times; locked clips snap to half, 1 and 2. */
export function speedFactor(offset: number, locked: boolean): number {
  const o = Math.max(-1, Math.min(1, Number.isFinite(offset) ? offset : 0));
  if (!locked) return Math.pow(4, o);
  return o < -1 / 3 ? 0.5 : o > 1 / 3 ? 2 : 1;
}
