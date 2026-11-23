/**
 * The sound input: one audio device (or a built-in test beat for checks) through a Web Audio analyser, read once a frame.
 * Nothing is recorded or sent anywhere. A live input is only measured; a rehearsal file is also played to the speakers,
 * read from disk as it plays, with the live input closed so the speakers cannot feed back into it.
 */
import { bandEnergies, rms, type Bands } from './features';

export const TEST_TONE = 'test-tone';
export const REHEARSAL = 'Rehearsal', REHEARSAL_PAUSED = 'Rehearsal paused';
export type AudioStatus = { state: 'off' } | { state: 'starting' } | { state: 'on'; label: string } | { state: 'refused' } | { state: 'lost' } | { state: 'missing' } | { state: 'failed'; reason: string };

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

/** Resolves when the element can play. Rejects if it cannot, if it is abandoned, or if it says nothing for 20 seconds. */
function whenPlayable(element: HTMLAudioElement, abandoned: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (done: () => void) => {
      clearTimeout(timer);
      element.removeEventListener('canplay', ready);
      element.removeEventListener('error', failed);
      abandoned.removeEventListener('abort', aborted);
      done();
    };
    const ready = () => finish(resolve);
    const failed = () => finish(() => reject(new Error('The file cannot be played')));
    const aborted = () => finish(() => reject(new DOMException('Replaced', 'AbortError')));
    const timer = setTimeout(failed, 20000);
    element.addEventListener('canplay', ready);
    element.addEventListener('error', failed);
    abandoned.addEventListener('abort', aborted);
  });
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
  private file: { element: HTMLAudioElement; release: () => void } | null = null;
  private filePaused = false;
  private loading: AbortController | null = null;
  /** The file could not be read any more, during playback. */
  onFileLost: () => void = () => {};
  /** The file is sounding again after a pause. */
  onFileResumed: () => void = () => {};
  private fileSilent = false;

  private set(status: AudioStatus) { this.status = status; this.onStatus(status); }

  get rehearsal(): 'playing' | 'paused' | null { return this.file ? (this.filePaused ? 'paused' : 'playing') : null; }
  get fileLoading(): boolean { return this.loading !== null; }
  /** The playing file's element, for scripted checks. */
  get fileElement(): HTMLAudioElement | null { return this.file?.element ?? null; }

  /**
   * Streams a recorded mix from disk, looping, to the speakers and the analyser. The current input keeps running until
   * the file is really playing, so a file that cannot play throws and changes nothing. A newer file, or cancelFile,
   * replaces one still loading. Resolves true only if this file took over.
   */
  async startFile(file: Blob): Promise<boolean> {
    this.loading?.abort();
    const load = new AbortController();
    this.loading = load;
    this.onStatus(this.status);
    const url = URL.createObjectURL(file), element = new Audio();
    let ctx: AudioContext | null = null, node: MediaElementAudioSourceNode | null = null, analyser: AnalyserNode | null = null;
    const release = () => {
      element.pause();
      element.removeAttribute('src');
      element.load();
      URL.revokeObjectURL(url);
      node?.disconnect();
      analyser?.disconnect();
      void ctx?.close().catch(() => {});
    };
    try {
      element.loop = true; element.preload = 'auto'; element.src = url;
      await whenPlayable(element, load.signal);
      ctx = new AudioContext();
      node = ctx.createMediaElementSource(element);
      // Not connected yet, so nothing is heard until the old input has gone.
      await element.play();
      if (load.signal.aborted) throw new DOMException('Replaced', 'AbortError');
    } catch (error) {
      release();
      if (load.signal.aborted) return false;
      this.loading = null;
      this.onStatus(this.status);
      throw error;
    }
    this.loading = null;
    this.stop();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.35;
    node.connect(analyser); node.connect(ctx.destination);
    const lost = () => { if (this.file?.element === element) this.onFileLost(); };
    element.addEventListener('error', lost);
    this.ctx = ctx; this.analyser = analyser;
    this.file = { element, release: () => { element.removeEventListener('error', lost); release(); } };
    // Stopping straight away closes the context, which rejects a resume still waiting.
    void ctx.resume().catch(() => {});
    this.set({ state: 'on', label: REHEARSAL });
    return true;
  }

  /** Forgets a file still loading. */
  cancelFile(): void {
    if (!this.loading) return;
    this.loading.abort();
    this.loading = null;
    this.onStatus(this.status);
  }

  /** Holds the file where it is. While paused the analyser reads as silence, so onsets stop and the reaction eases out. */
  pauseFile(on: boolean): void {
    if (!this.file || this.filePaused === on) return;
    const { element } = this.file;
    this.filePaused = on;
    if (on) { this.fileSilent = true; element.pause(); }
    else {
      // Sound coming back mid-beat looks like a kick, and would set the clock's phase wrongly: the detector starts afresh.
      element.addEventListener('playing', () => {
        if (this.file?.element !== element || this.filePaused) return;
        this.fileSilent = false;
        this.onFileResumed();
      }, { once: true });
      void element.play().catch(() => {});
    }
    this.set({ state: 'on', label: on ? REHEARSAL_PAUSED : REHEARSAL });
  }

  /** Starts listening to a device (or the test beat); stops whatever was listening before. */
  async start(deviceId: string, allow: () => Promise<'granted' | 'refused'>): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    this.set({ state: 'starting' });
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      const live = ctx;
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.35;
      if (deviceId === TEST_TONE) {
        this.tone = testBeat(live); this.tone.connect(analyser); this.tone.start();
        this.ctx = live; this.analyser = analyser;
        this.set({ state: 'on', label: 'Test beat' });
        return;
      }
      if (await allow() !== 'granted') { void live.close(); if (generation === this.generation) this.set({ state: 'refused' }); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); void live.close(); return; }
      live.createMediaStreamSource(stream).connect(analyser);
      const track = stream.getAudioTracks()[0];
      // An unplugged device ends its track: the operator is told, and every link falls back to its set value.
      track?.addEventListener('ended', () => { if (this.stream === stream) { this.stop(); this.set({ state: 'lost' }); } });
      this.ctx = live; this.analyser = analyser; this.stream = stream;
      void live.resume();
      this.set({ state: 'on', label: track?.label || 'Audio input' });
    } catch (error) {
      // Each try's context is given back: Chromium allows only a few at once.
      if (ctx && ctx !== this.ctx) void ctx.close().catch(() => {});
      if (generation !== this.generation) return;
      const name = (error as Error)?.name;
      this.set(name === 'NotAllowedError' || name === 'SecurityError' ? { state: 'refused' }
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? { state: 'missing' } : { state: 'failed', reason: String((error as Error)?.message ?? error) });
    }
  }

  stop(): void {
    this.generation++;
    try { this.tone?.stop(); } catch { /* already stopped */ }
    // A file's release closes its own context too; closing twice is caught.
    this.file?.release();
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null; this.analyser = null; this.stream = null; this.tone = null; this.file = null; this.filePaused = false; this.fileSilent = false;
    if (this.status.state !== 'off') this.set({ state: 'off' });
  }

  /** This frame's raw bands and level, or null when not listening. */
  read(): (Bands & { level: number }) | null {
    const a = this.analyser, ctx = this.ctx;
    if (!a || !ctx) return null;
    // Exactly silent while paused, whatever the analyser still holds, so the reaction always eases out.
    if (this.fileSilent) return { bass: 0, mids: 0, highs: 0, level: 0 };
    if (this.freq.length !== a.frequencyBinCount) this.freq = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(this.freq);
    a.getFloatTimeDomainData(this.wave);
    return { ...bandEnergies(this.freq, ctx.sampleRate, a.fftSize), level: rms(this.wave) };
  }
}
