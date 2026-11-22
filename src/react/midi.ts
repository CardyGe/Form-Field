/**
 * MIDI input (Web MIDI, never system-exclusive): control changes and notes become signals; clock, start and stop drive
 * the tempo clock. learn() hands the next control or note that moves to a callback. inject() feeds bytes in, for checks.
 */
import type { Signals } from './signals';

export type MidiStatus = { state: 'off' } | { state: 'on'; devices: string[] } | { state: 'unavailable'; reason: string };
export interface MidiClockSink { midiTick(t: number): void; midiStart(t: number): void; midiContinue(t: number): void; midiStop(): void }

export class MidiInput {
  status: MidiStatus = { state: 'off' };
  onStatus: (status: MidiStatus) => void = () => {};
  /** The last value of every control and note, by signal name. */
  readonly values: Signals = {};
  /** When the last message arrived (performance.now ms), for an activity light. */
  lastMessage = 0;
  private access: MIDIAccess | null = null;
  private learning: ((signal: string) => void) | null = null;

  constructor(private readonly clock: MidiClockSink) {}

  private starting: Promise<void> | null = null;
  private generation = 0;
  start(): Promise<void> {
    if (this.access) return Promise.resolve();
    // One request at a time: two would hear every message twice (and double the clock).
    this.starting ??= this.open().finally(() => { this.starting = null; });
    return this.starting;
  }
  private async open(): Promise<void> {
    const generation = this.generation;
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      if (generation !== this.generation) return; // stopped meanwhile
      this.access = access;
      const wire = () => {
        for (const input of access.inputs.values()) input.onmidimessage = e => { if (e.data) this.receive(e.data, performance.now() / 1000); };
        this.status = { state: 'on', devices: [...access.inputs.values()].map(i => i.name ?? 'MIDI input') };
        this.onStatus(this.status);
      };
      access.onstatechange = wire;
      wire();
    } catch (error) {
      this.status = { state: 'unavailable', reason: String((error as Error)?.message ?? error) };
      this.onStatus(this.status);
    }
  }

  stop(): void {
    this.generation++;
    if (this.access) { this.access.onstatechange = null; for (const input of this.access.inputs.values()) input.onmidimessage = null; }
    this.access = null;
    this.status = { state: 'off' };
    this.onStatus(this.status);
  }

  /** The next control or note that moves goes to `callback` instead of only to the signals. Null stops learning. */
  learn(callback: ((signal: string) => void) | null): void { this.learning = callback; }

  /** For checks: as if these bytes had arrived. */
  inject(bytes: number[]): void { this.receive(Uint8Array.from(bytes), performance.now() / 1000); }

  private receive(data: Uint8Array, t: number): void {
    const [status, a = 0, b = 0] = data;
    this.lastMessage = performance.now();
    if (status === 0xf8) { this.clock.midiTick(t); return; }
    if (status === 0xfa) { this.clock.midiStart(t); return; }
    if (status === 0xfb) { this.clock.midiContinue(t); return; }
    if (status === 0xfc) { this.clock.midiStop(); return; }
    const kind = status & 0xf0, channel = (status & 0x0f) + 1;
    let name: string | null = null, value = 0;
    if (kind === 0xb0) { name = `midi.cc.${channel}.${a}`; value = b / 127; }
    else if (kind === 0x90) { name = `midi.note.${channel}.${a}`; value = b / 127; }
    else if (kind === 0x80) { name = `midi.note.${channel}.${a}`; value = 0; }
    if (!name) return;
    this.values[name] = value;
    // Learning takes a control as soon as it moves, a note only when it goes on.
    if (this.learning && (kind === 0xb0 || (kind === 0x90 && b > 0))) { const take = this.learning; this.learning = null; take(name); }
  }
}
