/** Perform on the wall: the launcher's values as the compositor draws them. Pure; nothing here changes a show or a composition. */
import { BRIGHTNESS_MAX, SPEED_RANGE } from '../map/show';
import type { Signals } from '../react/signals';
import type { ZonePicture } from './resolve';
import type { PerformValues } from './wall-perform';

/**
 * For drawing only: the master level, each shape's brightness (times its own) and hue turn, each source's speed
 * (times its own) and the beats taken off the beat count for a loop locked to the tempo.
 */
export interface PerformDraw { master: number; shapes: ReadonlyMap<string, { brightness: number; hueDeg: number }>; speed: ReadonlyMap<string, number>; phaseOffsets: ReadonlyMap<string, number> }

const within = (value: number, min: number, max: number, fallback: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/**
 * The wall's Perform values, every one kept inside its range: brightness 0 to 2, hue within a turn either way,
 * speed 0 (held) to 4, master 0 to 1. A shape takes the values of the first zone that owns it, and a source on
 * several zones the speed of the first. Maps, so a source id such as __proto__ is an ordinary key.
 */
export function performDraw(perform: { zones: readonly ZonePicture[]; values: PerformValues | null; phaseOffsets: Record<string, number> }): PerformDraw {
  const shapes = new Map<string, { brightness: number; hueDeg: number }>(), speed = new Map<string, number>();
  const zones = Array.isArray(perform.values?.zones) ? perform.values.zones : [];
  perform.zones.forEach((zone, i) => {
    const z = zones[i];
    if (!z) return;
    const value = { brightness: within(z.brightness, 0, BRIGHTNESS_MAX, 1), hueDeg: within(z.hueDeg, -360, 360, 0) };
    for (const id of zone.shapeIds) if (!shapes.has(id)) shapes.set(id, value);
    if (zone.launched && zone.sourceId !== null && !speed.has(zone.sourceId)) speed.set(zone.sourceId, within(z.speed, 0, SPEED_RANGE.max, 1));
  });
  const phaseOffsets = new Map(Object.entries(perform.phaseOffsets).filter(([, beats]) => Number.isFinite(beats)));
  return { master: perform.values ? within(perform.values.master, 0, 1, 1) : 1, shapes, speed, phaseOffsets };
}

/** A source as far as its pace goes: its own speed, and the beats of its loop when it is locked to the tempo. */
export interface PacedSource { id: string; speed: number; tempoSync?: number | null }

/**
 * After a show: a loop locked to the tempo that plays on carries its Perform speed and bar, so its picture does not
 * jump when the show ends, but only until its next loop boundary. From there it plays as Map plays it. The carry
 * ends at once if the source leaves, its loop length or speed is changed, it was held at speed 0, or there is no tempo.
 */
export class CarriedPace {
  private readonly held = new Map<string, { speed: number; offset: number; sync: number; own: number; loop: number | null }>();
  get size(): number { return this.held.size; }
  get(id: string): { speed: number; offset: number } | undefined {
    const h = this.held.get(id);
    return h && { speed: h.speed, offset: h.offset };
  }
  /** Carries this source's pace on. A free source, or plain pace (speed 1, no offset), carries nothing and drops what was there. */
  keep(source: PacedSource, speed: number, offset: number): void {
    if (!source.tempoSync || (speed === 1 && offset === 0)) { this.held.delete(source.id); return; }
    this.held.set(source.id, { speed, offset, sync: source.tempoSync, own: source.speed, loop: null });
  }
  delete(id: string): void { this.held.delete(id); }
  clear(): void { this.held.clear(); }
  /** Once a frame, with the show's sources as they are now and the tempo: ends every carry that is due to end. */
  step(sources: Iterable<PacedSource>, signals: Signals): void {
    if (this.held.size === 0) return;
    const now = new Map<string, PacedSource>();
    for (const s of sources) now.set(s.id, s);
    const beat = signals['tempo.beat'];
    for (const [id, h] of this.held) {
      const source = now.get(id);
      if (!source || source.tempoSync !== h.sync || source.speed !== h.own || beat === undefined || !(h.speed > 0)) { this.held.delete(id); continue; }
      const loop = Math.floor((beat + (signals['tempo.phase'] ?? 0) - h.offset) * h.speed / h.sync);
      if (h.loop === null) h.loop = loop;
      else if (loop !== h.loop) this.held.delete(id);
    }
  }
}

/**
 * The tempo as one Perform source hears it: `offset` beats taken off the count, and the count run at `speed`, so a
 * loop of n beats plays as n / speed beats and starts on the corrected bar. Only the tempo signals are changed; at
 * speed 1 with no offset, and with no beat to count, the signals are returned as they are.
 */
export function performClock(signals: Signals, offset: number, speed: number): Signals {
  const beat = signals['tempo.beat'], phase = signals['tempo.phase'], bpm = signals['tempo.bpm'];
  if ((offset === 0 && speed === 1) || beat === undefined) return signals;
  const total = (beat + (phase ?? 0) - offset) * speed, whole = Math.floor(total);
  return { ...signals, 'tempo.beat': whole, ...(phase === undefined ? {} : { 'tempo.phase': total - whole }), ...(bpm === undefined ? {} : { 'tempo.bpm': bpm * speed }) };
}
