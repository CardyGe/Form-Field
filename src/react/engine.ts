/**
 * The reactivity engine, one per studio window: the sound input, MIDI, the beat and the tempo clock, read once a frame
 * into signals for Map and Live. It runs only while something listens. Device choices belong to this Mac and are kept
 * in the window's own storage.
 */
import { AutoGain } from './features';
import { BeatDetector } from './beat';
import { TempoClock, type SavedTempoSource } from './tempo';
import { AudioInput, TEST_TONE, type AudioStatus } from './audio';
import { MidiInput, type MidiStatus } from './midi';
import type { Signals } from './signals';

export interface ReactPrefs { audioDevice: string | null; midi: boolean; tempo: SavedTempoSource; bpm: number }
const PREFS_KEY = 'reactivity';
const DEFAULT_PREFS: ReactPrefs = { audioDevice: null, midi: false, tempo: 'beat', bpm: 120 };

function loadPrefs(): ReactPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ReactPrefs> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
    return {
      audioDevice: typeof raw.audioDevice === 'string' ? raw.audioDevice : null,
      midi: raw.midi === true,
      tempo: (['beat', 'tap', 'midi', 'fixed'] as const).includes(raw.tempo as SavedTempoSource) ? raw.tempo as SavedTempoSource : 'beat',
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
  /** A rehearsal ended because its file could not be read. Kept until the Perform screen has said so. */
  rehearsalFault = false;
  private readonly gains = { bass: new AutoGain(), mids: new AutoGain(), highs: new AutoGain(), level: new AutoGain() };
  private beat = new BeatDetector();
  private listeners = new Set<(signals: Signals) => void>();
  private changes = new Set<() => void>();
  private raf = 0;
  private stopping: ReturnType<typeof setTimeout> | undefined;
  private last = 0;

  constructor() {
    this.tempo.setSource(this.prefs.tempo);
    this.tempo.setBpm(this.prefs.bpm);
    this.audio.onStatus = () => this.changed();
    this.audio.onFileLost = () => void this.fileLost();
    this.audio.onFileResumed = () => this.forgetOnsets();
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
      // A rehearsal is playing to the speakers, so it carries on between sections.
      this.stopping = setTimeout(() => { if (!this.listeners.size && !this.audio.rehearsal) this.audio.stop(); }, 1000);
    };
  }
  /** Told when devices, status or preferences change (for the panel). */
  onChange(listener: () => void): () => void { this.changes.add(listener); return () => this.changes.delete(listener); }
  private changed(): void { for (const c of this.changes) c(); }

  setPrefs(change: Partial<ReactPrefs>): void {
    this.prefs = { ...this.prefs, ...change };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch { /* kept for this session */ }
    // During a show the clock stays with the show; a saved change takes effect when it ends.
    if (change.tempo && !this.show) this.tempo.setSource(change.tempo);
    if (change.bpm !== undefined && !this.show) this.tempo.setBpm(change.bpm);
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
    // A device chosen during a rehearsal is saved as usual and takes over when the rehearsal stops.
    if (this.audio.rehearsal) return;
    if (this.prefs.audioDevice === null) this.audio.stop();
    else await this.audio.start(this.prefs.audioDevice, this.allow);
  }

  /** Plays a recorded mix in place of the input, or with null stops it and goes back to the chosen input. Writes no preferences. */
  async rehearse(file: Blob | null): Promise<void> {
    if (file) { if (await this.audio.startFile(file)) this.forgetOnsets(); return; }
    this.audio.cancelFile();
    await this.leaveRehearsal();
  }
  /** The mix stopped being readable, such as a drive unplugged. A newer mix still loading is left to take over. */
  private async fileLost(): Promise<void> {
    await this.leaveRehearsal();
    this.rehearsalFault = true;
    this.changed();
  }
  private async leaveRehearsal(): Promise<void> {
    if (!this.audio.rehearsal) return;
    this.audio.stop();
    this.forgetOnsets();
    // With nothing listening the device stays closed, and the next listener opens it.
    if (this.listeners.size) await this.applyAudio();
  }

  /** A different sound: the last one's onsets must not suggest its tempo. The beat count carries on. */
  private forgetOnsets(): void {
    const { count } = this.beat;
    this.beat = new BeatDetector();
    this.beat.count = count;
  }

  tap(): void {
    if (this.show) { this.showTap(); return; }
    this.tempo.tap(performance.now() / 1000);
    if (this.prefs.tempo !== 'tap') this.setPrefs({ tempo: 'tap' });
  }

  /** The tempo before the show, while one is running. None of the show controls write preferences. */
  private show: { bpm: number } | null = null;
  /** A show follows the music, unless the saved source is MIDI clock, which stays in charge. */
  beginShowClock(): void {
    if (this.show) return;
    this.show = { bpm: this.tempo.bpm };
    this.tempo.clearBarStart();
    if (this.prefs.tempo !== 'midi') this.tempo.setSource('follow');
  }
  /** Back to the saved source and its tempo. The beat count carries on. */
  endShowClock(): void {
    if (!this.show) return;
    const { bpm } = this.show;
    this.show = null;
    this.tempo.setSource(this.prefs.tempo);
    if (this.prefs.tempo !== 'midi') this.tempo.setBpm(this.prefs.tempo === 'fixed' ? this.prefs.bpm : bpm);
  }
  showTap(): void { this.tempo.manualTap(performance.now() / 1000); }
  followAgain(): void { this.tempo.resumeFollow(performance.now() / 1000); }
  setBarStart(): void { this.tempo.setBarStart(performance.now() / 1000); }

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
      const { onset, followOnset, strength } = this.beat.update(sound.bass, t);
      const beat = this.beat.state(t);
      if (onset) this.tempo.detected(t, beat.bpm);
      if (followOnset) this.tempo.followOnset(t, beat.bpm, strength);
      out['beat.pulse'] = beat.pulse;
      out['beat.count'] = beat.count;
    }
    this.tempo.followTick(t);
    const clock = this.tempo.advance(t);
    out['tempo.phase'] = clock.phase; out['tempo.beat'] = clock.beat; out['tempo.bpm'] = clock.bpm;
    Object.assign(out, this.midi.values);
    return out;
  }
}

let engine: ReactivityEngine | null = null;
/** The engine if something has started it, without starting it: asking must not open the microphone. */
export const reactivityIfStarted = (): ReactivityEngine | null => engine;
/** The one engine for this window, started the first time it is asked for. */
export function reactivity(): ReactivityEngine {
  if (engine) return engine;
  engine = new ReactivityEngine();
  void engine.begin(() => window.studio?.live?.microphoneAccess?.() ?? Promise.resolve('granted'));
  // For scripted checks: a test beat in place of a device, and MIDI bytes as if a controller sent them.
  const e = engine;
  window.__studioTest = { ...window.__studioTest, react: { testBeat: (on: boolean) => e.setPrefs({ audioDevice: on ? TEST_TONE : null }), midi: (bytes: number[]) => e.midi.inject(bytes), signals: () => e.signals, audio: () => e.audio.status, mixElement: () => e.audio.fileElement, audioDevice: (id: string) => e.setPrefs({ audioDevice: id }) } };
  return engine;
}
export type { AudioStatus, MidiStatus };
