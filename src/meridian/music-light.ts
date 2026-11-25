import type { ConductorFrame } from './conductor';

/** What the music adds to Evolve's light this frame. All zero, with a gain of 1, leaves the picture exactly as drawn. */
export interface MusicLightFrame {
  active: boolean; following: boolean; beats: number; bpm: number; waveBeats: number;
  wave: number; bass: number; mids: number; highs: number; lift: number; evolutionLift: number;
}
export const createMusicLight = (): MusicLightFrame => ({ active: false, following: false, beats: 0, bpm: 124, waveBeats: 0, wave: 0, bass: 0, mids: 0, highs: 0, lift: 0, evolutionLift: 0 });

const TAU = Math.PI * 2;
const WAVE_DEPTH = 0.24, BASS_DEPTH = 0.7, MIDS_DEPTH = 0.5, HIGHS_DEPTH = 0.8, LIFT_DEPTH = 0.09, EVOLUTION_DEPTH = 0.4;
const PRESENCE_RISE = 0.15, PRESENCE_FALL = 1.2;
const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);
const amount = (value: number | undefined, fallback: number): number => (Number.isFinite(value) ? clamp(value as number, 0, 2) : fallback);

/** Delays every second beat, continuously, so a moved Swing never makes the wave jump far. */
function swung(beats: number, swing: number): number {
  const s = clamp(swing, 0, 1) * 0.33, cell = Math.floor(beats / 2) * 2, pair = beats - cell;
  return cell + (pair < 1 + s ? pair / (1 + s) : 1 + (pair - 1 - s) / (1 - s));
}

/** The soft wave of brightness at a distance from the centre: it travels outward through the structure. */
export function waveAt(music: MusicLightFrame, radius: number): number {
  const c = 0.5 + 0.5 * Math.cos(TAU * (music.waveBeats - radius * 0.72));
  return c * c;
}

/** A delicate glint that passes over one mark at a time. */
export function sparkleAt(music: MusicLightFrame, index: number): number {
  const s = Math.sin(Math.PI * (music.beats * 0.5 + index * 0.618)), q = s * s;
  return q * q * q * q;
}

export class MusicLight {
  private lastBeats = Number.NaN; private wave = 0; private presence = 0;

  update(frame: ConductorFrame, params: Readonly<Record<string, number>>, dt: number, out: MusicLightFrame): void {
    const step = Number.isFinite(this.lastBeats) ? frame.beats - this.lastBeats : 0;
    this.lastBeats = frame.beats;
    this.wave += step * (Number.isFinite(params.reactionTempoMultiplier) ? clamp(params.reactionTempoMultiplier, 0.25, 4) : 1);
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.presence = frame.pulse + (this.presence - frame.pulse) * Math.exp(-safeDt / (frame.pulse > this.presence ? PRESENCE_RISE : PRESENCE_FALL));
    if (this.presence < 1e-4 && frame.pulse === 0) this.presence = 0;

    const shape = 0.5 + 0.5 * Math.cos(TAU * frame.beats / 4), accent = 1 + clamp(params.rhythmAccent ?? 0.5, 0, 1) * (shape * shape * 0.6 - 0.15);
    const wave = WAVE_DEPTH * amount(params.reactionBeat, 1) * Math.min(1, this.presence * 1.6) * accent;
    const bass = BASS_DEPTH * amount(params.reactionBass, 1) * frame.bass * 0.5, mids = MIDS_DEPTH * amount(params.reactionMids, 1) * frame.mids * 0.5, highs = HIGHS_DEPTH * amount(params.reactionHighs, 1) * frame.highs * 0.5;
    const anyReaction = wave > 0 || bass > 0 || mids > 0 || highs > 0, lift = anyReaction ? LIFT_DEPTH * frame.energy : 0;

    out.following = frame.status !== 'free'; out.beats = frame.beats; out.bpm = frame.bpm;
    out.waveBeats = swung(this.wave, params.rhythmSwing ?? 0);
    out.wave = wave; out.bass = bass; out.mids = mids; out.highs = highs; out.lift = lift;
    out.evolutionLift = anyReaction ? clamp(frame.energy, 0, 1) * EVOLUTION_DEPTH * 0.5 : 0;
    out.active = anyReaction && frame.status !== 'free' || out.wave > 0 || out.bass > 0 || out.mids > 0 || out.highs > 0;
  }
}
