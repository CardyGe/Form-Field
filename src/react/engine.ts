/**
 * The reactivity engine, one per studio window: the sound input, MIDI, the beat and the tempo clock, read once a frame
 * into signals for Map and Live. It runs only while something listens. Device choices belong to this Mac and are kept
 * in the window's own storage.
 */
import { AutoGain } from './features';
import { BeatDetector } from './beat';
import { TempoClock, type TempoSource } from './tempo';
import { AudioInput, TEST_TONE, type AudioStatus } from './audio';
import { MidiInput, type MidiStatus } from './midi';
import type { Signals } from './signals';

export interface ReactPrefs { audioDevice: string | null; midi: boolean; tempo: TempoSource; bpm: number }
const PREFS_KEY = 'reactivity';
const DEFAULT_PREFS: ReactPrefs = { audioDevice: null, midi: false, tempo: 'beat', bpm: 120 };

function loadPrefs(): ReactPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ReactPrefs> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
    return {
      audioDevice: typeof raw.audioDevice === 'string' ? raw.audioDevice : null,
      midi: raw.midi === true,
      tempo: (['beat', 'tap', 'midi', 'fixed'] as const).includes(raw.tempo as TempoSource) ? raw.tempo as TempoSource : 'beat',
      bpm: typeof raw.bpm === 'number' && Number.isFinite(raw.bpm) ? raw.bpm : 120,
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

export class ReactivityEngine {
  readonly audio = new AudioInput();
  readonly tempo = new TempoClock();
  readonly midi = new MidiInput(this.tempo);
  prefs: ReactPrefs = loadPrefs();
  signals: Signals = {};
  private readonly gains = { bass: new AutoGain(), mids: new AutoGain(), highs: new AutoGain(), level: new AutoGain() };
  private readonly beat = new BeatDetector();
  private listeners = new Set<(signals: Signals) => void>();
  private changes = new Set<() => void>();
  private raf = 0;
  private stopping: ReturnType<typeof setTimeout> | undefined;
  private last = 0;

  constructor() {
    this.tempo.setSource(this.prefs.tempo);
    this.tempo.setBpm(this.prefs.bpm);
    this.audio.onStatus = () => this.changed();
    this.midi.onStatus = () => this.changed();
  }

  /** Called with fresh signals every frame while subscribed. Returns the unsubscribe. */
  subscribe(listener: (signals: Signals) => void): () => void {
    this.listeners.add(listener);
    clearTimeout(this.stopping);
    if (this.listeners.size === 1) { cancelAnimationFrame(this.raf); this.run(); if (this.audio.status.state === 'off') void this.applyAudio(); }
    // With nothing listening the device is let go, so the Mac's microphone light goes out: a second later, so a screen
    // that re-subscribes (a panel opening, a new link) keeps the device and its smoothing.
    return () => {
      if (!this.listeners.delete(listener) || this.listeners.size) return;
      cancelAnimationFrame(this.raf);
      this.stopping = setTimeout(() => { if (!this.listeners.size) this.audio.stop(); }, 1000);
    };
  }
  /** Told when devices, status or preferences change (for the panel). */
  onChange(listener: () => void): () => void { this.changes.add(listener); return () => this.changes.delete(listener); }
  private changed(): void { for (const c of this.changes) c(); }

  setPrefs(change: Partial<ReactPrefs>): void {
    this.prefs = { ...this.prefs, ...change };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch { /* kept for this session */ }
    if (change.tempo) this.tempo.setSource(change.tempo);
    if (change.bpm !== undefined) this.tempo.setBpm(change.bpm);
    if ('audioDevice' in change) void this.applyAudio();
    if ('midi' in change) { if (this.prefs.midi) void this.midi.start(); else this.midi.stop(); }
    this.changed();
  }

  /** Starts what the preferences ask for. */
  async begin(allowMicrophone: () => Promise<'granted' | 'refused'>): Promise<void> {
    this.allow = allowMicrophone;
    await this.applyAudio();
    if (this.prefs.midi) await this.midi.start();
  }
  private allow: () => Promise<'granted' | 'refused'> = async () => 'refused';
  private async applyAudio(): Promise<void> {
    if (this.prefs.audioDevice === null) this.audio.stop();
    else await this.audio.start(this.prefs.audioDevice, this.allow);
  }

  tap(): void { this.tempo.tap(performance.now() / 1000); if (this.prefs.tempo !== 'tap') this.setPrefs({ tempo: 'tap' }); }

  private run(): void {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.signals = this.read(now);
      for (const l of this.listeners) l(this.signals);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** One frame's signals. */
  read(nowMs: number): Signals {
    const t = nowMs / 1000, dt = this.last ? Math.min(0.1, t - this.last) : 1 / 60;
    this.last = t;
    const out: Signals = {};
    const sound = this.audio.read();
    if (sound) {
      out['audio.bass'] = this.gains.bass.update(sound.bass, dt);
      out['audio.mids'] = this.gains.mids.update(sound.mids, dt);
      out['audio.highs'] = this.gains.highs.update(sound.highs, dt);
      out['audio.level'] = this.gains.level.update(sound.level, dt);
      if (this.beat.update(sound.bass, t).onset) this.tempo.detected(t, this.beat.state(t).bpm);
      out['beat.pulse'] = this.beat.state(t).pulse;
    }
    const clock = this.tempo.advance(t);
    out['tempo.phase'] = clock.phase; out['tempo.beat'] = clock.beat; out['tempo.bpm'] = clock.bpm;
    Object.assign(out, this.midi.values);
    return out;
  }
}

let engine: ReactivityEngine | null = null;
/** The one engine for this window, started the first time it is asked for. */
export function reactivity(): ReactivityEngine {
  if (engine) return engine;
  engine = new ReactivityEngine();
  void engine.begin(() => window.studio?.live?.microphoneAccess?.() ?? Promise.resolve('granted'));
  // For scripted checks: a test beat in place of a device, and MIDI bytes as if a controller sent them.
  const e = engine;
  window.__studioTest = { ...window.__studioTest, react: { testBeat: (on: boolean) => e.setPrefs({ audioDevice: on ? TEST_TONE : null }), midi: (bytes: number[]) => e.midi.inject(bytes), signals: () => e.signals } };
  return engine;
}
export type { AudioStatus, MidiStatus };
