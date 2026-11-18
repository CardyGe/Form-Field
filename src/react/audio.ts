/**
 * The sound input: one audio device (or a built-in test beat for checks) through a Web Audio analyser, read once a frame.
 * Nothing is recorded, played or sent anywhere; the samples are only measured.
 */
import { bandEnergies, rms, type Bands } from './features';

export const TEST_TONE = 'test-tone';
export type AudioStatus = { state: 'off' } | { state: 'starting' } | { state: 'on'; label: string } | { state: 'refused' } | { state: 'lost' } | { state: 'failed'; reason: string };

export async function listAudioInputs(): Promise<{ id: string; label: string }[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Audio input ${i + 1}` }));
  } catch { return []; }
}

/** A loud kick on every half second with a hi-hat between, at 120 BPM: a steady beat for scripted checks. */
function testBeat(ctx: AudioContext): AudioBufferSourceNode {
  const seconds = 0.5, rate = ctx.sampleRate, buffer = ctx.createBuffer(1, Math.round(seconds * rate), rate), d = buffer.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / rate;
    const kick = Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9);
    const hat = t > 0.25 && t < 0.3 ? (Math.random() * 2 - 1) * 0.2 * Math.exp(-(t - 0.25) * 60) : 0;
    d[i] = 0.9 * kick + hat;
  }
  const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
  return src;
}

export class AudioInput {
  status: AudioStatus = { state: 'off' };
  onStatus: (status: AudioStatus) => void = () => {};
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private tone: AudioBufferSourceNode | null = null;
  private freq = new Float32Array(1024);
  private wave = new Float32Array(2048);
  private generation = 0;

  private set(status: AudioStatus) { this.status = status; this.onStatus(status); }

  /** Starts listening to a device (or the test beat); stops whatever was listening before. */
  async start(deviceId: string, allow: () => Promise<'granted' | 'refused'>): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    this.set({ state: 'starting' });
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.35;
      if (deviceId === TEST_TONE) {
        this.tone = testBeat(ctx); this.tone.connect(analyser); this.tone.start();
        this.ctx = ctx; this.analyser = analyser;
        this.set({ state: 'on', label: 'Test beat' });
        return;
      }
      if (await allow() !== 'granted') { void ctx.close(); if (generation === this.generation) this.set({ state: 'refused' }); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); void ctx.close(); return; }
      ctx.createMediaStreamSource(stream).connect(analyser);
      const track = stream.getAudioTracks()[0];
      // An unplugged device ends its track: the operator is told, and every link falls back to its set value.
      track?.addEventListener('ended', () => { if (this.stream === stream) { this.stop(); this.set({ state: 'lost' }); } });
      this.ctx = ctx; this.analyser = analyser; this.stream = stream;
      void ctx.resume();
      this.set({ state: 'on', label: track?.label || 'Audio input' });
    } catch (error) {
      if (generation !== this.generation) return;
      const name = (error as Error)?.name;
      this.set(name === 'NotAllowedError' || name === 'SecurityError' ? { state: 'refused' } : { state: 'failed', reason: String((error as Error)?.message ?? error) });
    }
  }

  stop(): void {
    this.generation++;
    try { this.tone?.stop(); } catch { /* already stopped */ }
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null; this.analyser = null; this.stream = null; this.tone = null;
    if (this.status.state !== 'off') this.set({ state: 'off' });
  }

  /** This frame's raw bands and level, or null when not listening. */
  read(): (Bands & { level: number }) | null {
    const a = this.analyser, ctx = this.ctx;
    if (!a || !ctx) return null;
    if (this.freq.length !== a.frequencyBinCount) this.freq = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(this.freq);
    a.getFloatTimeDomainData(this.wave);
    return { ...bandEnergies(this.freq, ctx.sampleRate, a.fftSize), level: rms(this.wave) };
  }
}
