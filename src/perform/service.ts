/**
 * The Perform service: one per studio window, above the sections, so a running show survives moving between them.
 * It joins the clock, the launcher and the controls to the wall. It only reads the Map show and never edits it,
 * and sound reaches it as numbers for this frame: nothing here is saved or sent anywhere but the wall's values.
 */
import { acceptMapMessage, wallInputs, type MapMessage } from '../map/messages';
import { LIVE_SOURCE_ID, type ShowDocument } from '../map/show';
import type { LiveSettings } from '../live/settings';
import { reactivity, type AudioStatus, type MidiStatus } from '../react/engine';
import type { Signals } from '../react/signals';
import type { TempoClock } from '../react/tempo';
import { applyControl, holdForReconnect, initialControls, knobOffset, speedFactor, type ControlEvent, type ControlValues, type PerformAction } from './controls';
import { armList, bankBack, bankNext, initialLauncher, landed, launchNow, queueScene, queueZone, retime, returnZone, stopZone, type Launch, type LauncherState } from './launcher';
import { linkedZones, zoneShapes, type ZonePicture } from './resolve';
import { dueFollow } from './sequence';
import { beatAt, LATE_GRACE_MS, launchPhaseOffset, msAtBeat, nextBoundary, type ClockSnapshot } from './timing';
import { BEATS_PER_BAR, ZONE_COUNT, type Clip } from './types';
import { MAX_WALL_LAUNCHES, type PerformValues, type WallLaunch } from './wall-perform';

export interface PerformView {
  running: boolean; clock: ClockSnapshot; launcher: LauncherState; controls: ControlValues; shift: boolean; audio: AudioStatus; midi: 'none' | 'connected' | 'lost';
  /** The sources the wall says are ready. */
  armed: string[];
  /** Asked for and not ready yet (the amber dot). */
  waiting: string[];
  /** Asked for and still not ready after a whole bar (the red dot). */
  stuck: string[];
  notices: string[];
}
export interface WallLink { send(m: MapMessage): void; isOpen(): boolean; sendWholeShow(): void }
export interface ClockLink {
  snapshot(nowMs: number): ClockSnapshot; begin(): void; end(): void; tap(): void; follow(): void; setBarStart(): void; subscribe(fn: (signals: Signals) => void): () => void;
  /** The sound input's and the controller's status, when the clock has them. */
  audio?(): AudioStatus;
  midi?(): MidiStatus;
}
interface Deps { wall: WallLink; clock: ClockLink; show: () => ShowDocument; now: () => number; id: () => string; random: () => number; live?: () => LiveSettings | null }

const MAX_ARMED = 8;
const VALUES_EVERY_MS = 1000 / 30;
const VIEW_EVERY_MS = 100;
/** Queued this long before the bar, so the wall has it in time. */
const FOLLOW_LOOKAHEAD_MS = 200;
/** A due launch the wall has not reported for this long is waiting on a source, not on its way back. */
const IN_FLIGHT_MS = 250;
/** A cancel sent this close to a launch's time can cross it landing, so its report is still listened for. */
const CANCEL_RACE_MS = 50;
/** How far the clock may drift from a queued launch before it is sent again, and how near the bar it is left alone. */
const DRIFT_MS = 10, DRIFT_SETTLED_MS = 50;
/** How quickly audio reaction moves, and how a burst rises and falls: at once with the kick, slowly on the ceiling. */
const REACT_MS = 120;
const BURST_MS = { room: { on: 10, off: 180 }, ceiling: { on: 2000, off: 4000 } };
/** A held burst lifts a zone by half, and by as much again with the kick. Reaction and bursts add this share to a free clip's speed. */
const BURST_BASE = .5, BURST_KICK = .5, SPEED_FOLD = .5;
const HUE_RANGE = 180;
const CEILING = ZONE_COUNT - 1;
/** The launcher names the waiting ceiling part of a launch with this suffix. */
const CEILING_PART = ':ceiling';
const AUDIO_KEYS: Record<Clip['audioBand'], string> = { bass: 'audio.bass', mid: 'audio.mids', high: 'audio.highs', level: 'audio.level' };
const STOPPED: ClockSnapshot = { anchorMs: 0, anchorBeat: 0, bpm: 120, state: 'manual', barOffset: 0 };

const unit = (n: number | undefined) => n === undefined || !Number.isFinite(n) ? 0 : Math.min(1, Math.max(0, n));
const wrapHue = (deg: number) => { const h = ((deg + 180) % 360 + 360) % 360 - 180; return h === -180 ? 180 : h; };
const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
const zeros = () => Array.from({ length: ZONE_COUNT }, () => 0);

/** The tempo clock as a snapshot in the time base both windows share. `timeOrigin` turns it into the clock's own seconds. */
export function clockSnapshot(tempo: Pick<TempoClock, 'snapshot'>, nowMs: number, timeOrigin: number): ClockSnapshot {
  const { beats, bpm, state, barOffset } = tempo.snapshot((nowMs - timeOrigin) / 1000);
  return { anchorMs: nowMs, anchorBeat: beats, bpm, state, barOffset };
}

export class PerformService {
  private isRunning = false;
  private launcher = initialLauncher();
  private controls = initialControls();
  private shift = false;
  private audio: AudioStatus = { state: 'off' };
  private midi: PerformView['midi'] = 'none';
  private wallArmed: string[] = [];
  private requested: string[] = [];
  /** When each requested source was first asked for. */
  private requestedAt = new Map<string, number>();
  /** What the wall holds, as last sent. */
  private held = new Map<string, { launch: WallLaunch; key: string; source: Launch }>();
  /** Launches cancelled as they came due: the wall may have landed them, so a late report still counts. */
  private replaced = new Map<string, { launch: Launch; wall: WallLaunch; until: number }>();
  /** When each queued launch was pressed, counted up; never its place in the queue. */
  private presses = new Map<string, number>();
  private lastPress = 0;
  /** The press that last landed on each zone. */
  private landedPress = zeros();
  /** The bar offset each source on the wall plays with, kept so a reopened wall gets them back. */
  private phases = new Map<string, number>();
  private bursts = Array.from({ length: ZONE_COUNT }, () => false);
  private burstLevel = zeros();
  private reaction = zeros();
  private signals: Signals = {};
  private lastFrame: number | null = null;
  private valuesAt = -Infinity;
  private valuesKey = '';
  private viewAt = -Infinity;
  private offClock: (() => void) | null = null;
  private readonly listeners = new Set<(v: PerformView) => void>();

  constructor(private readonly deps: Deps) {}

  /** Cheap, for guards that run every frame. */
  get running(): boolean { return this.isRunning; }

  startShow(): void {
    if (this.isRunning) return;
    this.reset();
    this.isRunning = true;
    this.deps.clock.begin();
    this.sendStart();
    this.pushValues(this.deps.now(), true);
    this.sendArm();
    this.offClock = this.deps.clock.subscribe(signals => { this.signals = signals; this.tick(); });
    this.publish(true);
  }

  endShow(): void {
    if (!this.isRunning) return;
    this.offClock?.();
    this.offClock = null;
    this.send({ type: 'performEnd' });
    this.deps.clock.end();
    this.isRunning = false;
    this.reset();
    this.publish(true);
  }

  control(e: ControlEvent): void {
    if (!this.isRunning) return;
    const { values, actions, shift } = applyControl(this.controls, e, this.shift);
    this.controls = values;
    this.shift = shift;
    for (const a of actions) this.action(a);
    this.pushValues(this.deps.now());
    this.publish(true);
  }

  action(a: PerformAction): void {
    if (!this.isRunning) return;
    const now = this.deps.now(), set = this.deps.show().performance, clock = this.deps.clock.snapshot(now);
    const press = (next: (s: LauncherState, at: number, id: string) => LauncherState, zone?: number) => this.place(now, (s, at) => next(s, at, this.deps.id()), zone);
    switch (a.type) {
      case 'next': press((s, at, id) => queueZone(s, set, a.zone, 1, clock, at, id), a.zone); break;
      case 'previous': press((s, at, id) => returnZone(s, set, a.zone, clock, at, id), a.zone); break;
      case 'stop': press((s, at, id) => stopZone(s, a.zone, clock, at, id), a.zone); break;
      case 'burst': this.bursts[a.zone] = a.on; break;
      case 'bankNext': press((s, at, id) => bankNext(s, set, clock, at, id)); break;
      case 'bankBack': press((s, at, id) => bankBack(s, set, clock, at, id)); break;
      case 'launchNow': this.place(now, s => launchNow(s, now)); break;
      case 'downbeat': this.deps.clock.setBarStart(); this.retimeQueue(now); break;
      case 'tap': this.deps.clock.tap(); this.retimeQueue(now); break;
      case 'follow': this.deps.clock.follow(); break;
    }
    this.syncWall();
    this.publish(true);
  }

  /** What the wall reports: which armed sources are ready, and what has landed. */
  wallState(state: { armed?: string[]; landed?: { launchId: string; zones: number[] }[] }): void {
    if (!this.isRunning) return;
    if (state.armed) this.wallArmed = state.armed;
    const now = this.deps.now(), partial = new Set<string>(), overruled = new Set<number>();
    let latestMissed = now;
    const reported = (state.landed ?? []).map(r => r.launchId);
    for (const { launchId, zones } of state.landed ?? []) {
      const before = this.launcher.queue.find(l => l.id === launchId);
      // Replaced as it landed: the picture did change, so what is playing follows it. Nothing of it stays queued.
      const late = before ? undefined : this.replaced.get(launchId);
      const launch = before ?? late?.launch;
      if (!launch) continue;
      // A zone a later press has already landed on stays with that press. The wall is put right below.
      const press = this.pressOf(launchId), accepted = zones.filter(z => this.landedPress[z] <= press);
      for (const z of zones) if (!accepted.includes(z)) overruled.add(z);
      const wall = late?.wall ?? this.held.get(launchId)?.launch;
      if (wall) this.recordPhases(wall, accepted);
      for (const c of launch.changes) if (accepted.includes(c.zone)) this.landedPress[c.zone] = press;
      if (late) {
        const queue = this.launcher.queue;
        this.launcher = { ...landed({ ...this.launcher, queue: [late.launch] }, launchId, accepted, now, this.deps.random), queue };
        continue;
      }
      const queue = this.launcher.queue;
      this.launcher = landed(this.launcher, launchId, accepted, now, this.deps.random);
      if (this.launcher.queue !== queue && this.launcher.queue.some(l => l.id === launchId)) { partial.add(launchId); latestMissed = Math.max(latestMissed, launch.atMs); }
    }
    const swept = this.dropOverruled(now);
    // A due launch pressed before a partial landing's remainder gives up the zones they share.
    const remainders = this.launcher.queue.filter(l => partial.has(l.id));
    const older = this.launcher.queue.filter(l => !partial.has(l.id) && l.atMs <= now && remainders.some(p => this.pressOf(p.id) > this.pressOf(l.id) && p.changes.some(c => l.changes.some(x => x.zone === c.zone))));
    const stale = new Set([...partial, ...older.map(l => l.id)]);
    if (stale.size) this.yieldToNewer(stale);
    // Reported first, then moved: exactly on the missed bar the launch would only retry that same bar.
    const moved = new Set([...stale, ...swept]);
    if (moved.size) this.retimeQueue(latestMissed + 1, moved);
    for (const zone of overruled) this.restoreZone(zone, now);
    this.syncWall();
    for (const id of reported) this.replaced.delete(id);
    this.forgetPresses();
    this.publish(true);
  }

  /** The wall window came back, or reloaded: it knows nothing, so it is told everything, Perform first. */
  wallReopened(): void {
    if (!this.isRunning) return;
    const now = this.deps.now();
    this.held.clear();
    this.replaced.clear();
    this.wallArmed = [];
    this.prune();
    this.sendStart();
    // Before the show, so a fresh wall never draws a frame at full master.
    this.pushValues(now, true);
    this.deps.wall.sendWholeShow();
    // A new wall has had no chance to make anything ready, so the wait for each source starts again.
    this.requested = [];
    this.requestedAt.clear();
    this.sendArm(true);
    this.retimeQueue(now, new Set(this.launcher.queue.map(l => l.id)));
    this.syncWall();
    this.publish(true);
  }

  /** Once a frame while a show runs. */
  tick(): void {
    if (!this.isRunning) return;
    const now = this.deps.now();
    this.readStatus();
    this.stepEnvelopes(now);
    this.prune();
    for (const [id, late] of this.replaced) if (now > late.until) this.replaced.delete(id);
    this.forgetPresses();
    if (this.deps.wall.isOpen()) {
      this.landEmpty(now);
      this.moveWaiting(now);
      this.queueFollow(now);
      this.followDrift(now);
    }
    this.syncWall();
    this.sendSignals();
    this.pushValues(now);
    this.publish(false);
  }

  /** The controller went away: the picture keeps running, and each control has to earn its way back. */
  controllerLost(): void {
    if (!this.isRunning) return;
    this.shift = false;
    for (let zone = 0; zone < ZONE_COUNT; zone++) this.action({ type: 'burst', zone, on: false });
    this.controls = holdForReconnect(this.controls);
    this.midi = 'lost';
    this.publish(true);
  }

  subscribe(fn: (v: PerformView) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  view(): PerformView {
    const now = this.deps.now(), clock = this.isRunning ? this.deps.clock.snapshot(now) : STOPPED;
    const waiting = this.requested.filter(id => !this.wallArmed.includes(id));
    const barMs = BEATS_PER_BAR * 60000 / clock.bpm;
    const stuck = waiting.filter(id => now - (this.requestedAt.get(id) ?? now) >= barMs);
    const notices: string[] = [];
    if (this.isRunning) {
      if (['lost', 'missing', 'failed'].includes(this.audio.state)) notices.push('Audio lost. The show keeps running on the held tempo.');
      if (this.midi === 'lost') notices.push('MIDImix lost. The picture keeps its values until it reconnects.');
      if (!this.deps.wall.isOpen()) notices.push('The projector window is closed. The show carries on and resumes when it opens.');
    }
    return { running: this.isRunning, clock, launcher: this.launcher, controls: this.controls, shift: this.shift, audio: this.audio, midi: this.midi, armed: this.wallArmed, waiting, stuck, notices };
  }

  // ---- The wall ----
  private send(m: MapMessage): void { if (this.deps.wall.isOpen()) this.deps.wall.send(m); }
  private sourceOf(clipId: string | null): string | null {
    return clipId === null ? null : this.deps.show().performance.clips.find(c => c.id === clipId)?.sourceId ?? null;
  }
  private pictures(): ZonePicture[] {
    const show = this.deps.show(), shapes = zoneShapes(show.performance.zones, show.shapes);
    return Array.from({ length: ZONE_COUNT }, (_, i) => ({ shapeIds: shapes[i] ?? [], sourceId: this.sourceOf(this.launcher.playing[i]), launched: this.launcher.launched[i] }));
  }
  private sendStart(): void { this.send({ type: 'performStart', zones: this.pictures(), phaseOffsets: Object.fromEntries(this.phases) }); }

  /** Sends only the difference between the queue and what the wall holds. */
  private syncWall(): void {
    this.prune();
    this.sendArm();
    if (!this.deps.wall.isOpen()) return;
    const wanted = this.launcher.queue.filter(l => l.changes.length > 0), sentAt = this.deps.now();
    for (const [id, had] of [...this.held]) {
      if (wanted.some(l => l.id === id)) continue;
      this.send({ type: 'performCancel', launchId: id });
      this.held.delete(id);
      if (had.launch.atMs <= sentAt + CANCEL_RACE_MS) this.replaced.set(id, { launch: had.source, wall: had.launch, until: Math.max(sentAt, had.launch.atMs) + IN_FLIGHT_MS });
    }
    if (!wanted.length) return;
    const clock = this.deps.clock.snapshot(this.deps.now()), shapes = zoneShapes(this.deps.show().performance.zones, this.deps.show().shapes);
    for (const l of wanted) {
      // A launch already firing keeps the bar it was sent with: it is not sent again for a correction made after its time.
      const sentPhase = l.atMs <= this.deps.now() ? this.held.get(l.id)?.launch.changes[0]?.phaseOffsetBeats : undefined;
      const changes = l.changes.map(c => ({ zone: c.zone, sourceId: this.sourceOf(c.clipId), shapeIds: shapes[c.zone] ?? [], blend: c.blend, phaseOffsetBeats: sentPhase ?? launchPhaseOffset(clock) }));
      // The tempo moves a little every frame, so the bar length is not part of what counts as a change. The bar offset is:
      // on a one-beat launch grid, "This is the 1" can leave the time as it was and still move the loop's start.
      const key = JSON.stringify([l.atMs, changes.map(c => [c.zone, c.sourceId, c.shapeIds, c.blend, c.phaseOffsetBeats])]);
      const had = this.held.get(l.id);
      if (had?.key === key) { had.source = l; continue; }
      const launch: WallLaunch = { id: l.id, atMs: l.atMs, barMs: BEATS_PER_BAR * 60000 / clock.bpm, changes };
      if (had && had.launch.atMs !== l.atMs) this.send({ type: 'performCancel', launchId: l.id });
      this.send({ type: 'performLaunch', launch });
      this.held.set(l.id, { launch, key, source: l });
    }
  }

  /** Queued sources first, in the launcher's order. A source already on the wall needs no arming. */
  private sendArm(force = false): void {
    const show = this.deps.show(), playing = new Set(this.pictures().map(p => p.sourceId));
    const ids = [...new Set(armList(this.launcher, show.performance).map(c => this.sourceOf(c)).filter((s): s is string => s !== null && !playing.has(s)))].slice(0, MAX_ARMED);
    const same = ids.length === this.requested.length && ids.every((id, i) => id === this.requested[i]);
    if (!same) {
      const now = this.deps.now();
      for (const id of [...this.requestedAt.keys()]) if (!ids.includes(id)) this.requestedAt.delete(id);
      for (const id of ids) if (!this.requestedAt.has(id)) this.requestedAt.set(id, now);
      this.requested = ids;
    }
    if (!same || force) this.send({ type: 'performArm', sourceIds: ids });
  }

  /** The wall's own rule for a source's bar: a source already playing on another zone keeps the one it has. */
  private recordPhases(wall: WallLaunch, zones: readonly number[]): void {
    const sources = this.launcher.playing.map((c, i) => this.launcher.launched[i] ? this.sourceOf(c) : null);
    for (const c of wall.changes) {
      if (!zones.includes(c.zone)) continue;
      sources[c.zone] = c.sourceId;
      if (c.sourceId !== null && !sources.some((s, i) => i !== c.zone && s === c.sourceId)) this.phases.set(c.sourceId, c.phaseOffsetBeats);
    }
    for (const id of [...this.phases.keys()]) if (!sources.includes(id)) this.phases.delete(id);
  }

  private sendSignals(): void {
    const used = wallInputs(this.deps.show(), this.deps.live?.() ?? null, true);
    this.send({ type: 'signals', signals: Object.fromEntries(Object.entries(this.signals).filter(([k]) => used.has(k))) });
  }

  // ---- The queue ----
  /** A clip deleted while queued has nothing to play: its change is dropped, and a scene launch stays to move the row. */
  private prune(): void {
    const known = new Set(this.deps.show().performance.clips.map(c => c.id));
    const gone = (c: Launch['changes'][number]) => c.clipId !== null && !known.has(c.clipId);
    if (!this.launcher.queue.some(l => l.changes.some(gone) || (l.changes.length === 0 && l.sceneIndex === null))) return;
    this.launcher = { ...this.launcher, queue: this.launcher.queue.map(l => ({ ...l, changes: l.changes.filter(c => !gone(c)) })).filter(l => l.changes.length > 0 || l.sceneIndex !== null) };
  }

  /** Due, and with the wall or just landing here: its report may be on its way, so nothing may replace it. */
  private isFiring(l: Launch, now: number): boolean {
    return l.atMs <= now && now - l.atMs < IN_FLIGHT_MS && (this.held.has(l.id) || l.changes.length === 0);
  }

  /**
   * Makes a queue change as if the launches now firing had landed, and keeps them queued until their reports say so.
   * The press cannot replace them, and it goes to the next boundary: the bar they fired on has been used.
   * `zone`: a press on one zone. It only waits if a firing launch changes that zone; otherwise it keeps the late-press grace.
   */
  private place(now: number, next: (s: LauncherState, at: number) => LauncherState, zone?: number): void {
    const due = this.launcher.queue.filter(l => this.isFiring(l, now));
    const firing = zone === undefined || due.some(l => l.changes.some(c => c.zone === zone)) ? due : [];
    let after: LauncherState;
    if (firing.length === 0) after = next(this.launcher, now);
    else {
      const landing = firing.reduce((s, l) => landed(s, l.id, l.changes.map(c => c.zone), now, () => 0), this.launcher);
      const moved = next(landing, Math.max(now, ...firing.map(l => l.atMs + LATE_GRACE_MS + 1)));
      if (moved === landing) return;
      after = { ...this.launcher, queue: [...firing, ...moved.queue] };
    }
    // The wall refuses a new launch silently when full, so a change past the limit is not taken.
    if (after.queue.length < MAX_WALL_LAUNCHES) { this.launcher = after; this.stampPresses(); }
  }

  // ---- Who owns a zone: the later press, whatever the queue order. ----
  /** A launch and its `:ceiling` part are one press, and every change in them carries its number. */
  private pressKey(id: string): string { return id.endsWith(CEILING_PART) ? id.slice(0, -CEILING_PART.length) : id; }
  private pressOf(id: string): number { return this.presses.get(this.pressKey(id)) ?? 0; }
  private stampPresses(): void {
    for (const l of this.launcher.queue) if (!this.presses.has(this.pressKey(l.id))) this.presses.set(this.pressKey(l.id), ++this.lastPress);
  }
  private forgetPresses(): void {
    const live = new Set([...this.launcher.queue.map(l => this.pressKey(l.id)), ...[...this.replaced.keys()].map(id => this.pressKey(id))]);
    for (const key of [...this.presses.keys()]) if (!live.has(key)) this.presses.delete(key);
  }
  /** Removes changes a later press has already landed over. Returns the due launches that still have something left to do. */
  private dropOverruled(now: number): Set<string> {
    const changed = new Set<string>();
    const queue = this.launcher.queue.flatMap((l): Launch[] => {
      const changes = l.changes.filter(c => this.landedPress[c.zone] <= this.pressOf(l.id));
      if (changes.length === l.changes.length) return [l];
      if (changes.length === 0 && l.sceneIndex === null) return [];
      if (l.atMs <= now) changed.add(l.id);
      return [{ ...l, changes }];
    });
    this.launcher = { ...this.launcher, queue };
    return changed;
  }
  /** An older launch reached the wall after a later press did: the zone goes back to the later press's clip on the next boundary. */
  private restoreZone(zone: number, now: number): void {
    const { queue, playing } = this.launcher;
    if (queue.length >= MAX_WALL_LAUNCHES - 1 || queue.some(l => l.changes.some(c => c.zone === zone))) return;
    const at = nextBoundary(this.deps.clock.snapshot(now), now, this.deps.show().performance.launchQuantize, 0);
    const launch: Launch = { id: this.deps.id(), beat: at.beat, atMs: at.atMs, sceneIndex: null, changes: [{ zone, clipId: playing[zone], blend: { kind: 'cut', durationMs: 0 } }] };
    this.launcher = { ...this.launcher, queue: [...queue, launch] };
    this.stampPresses();
  }

  /**
   * A launch past its time with no report is waiting on a source. It moves to the next boundary of the clock as it is
   * now, and gives up any zone or scene that a newer press has since queued.
   */
  private moveWaiting(now: number): void {
    const waiting = this.launcher.queue.filter(l => l.changes.length > 0 && now - l.atMs >= IN_FLIGHT_MS);
    if (!waiting.length) return;
    this.yieldToNewer(new Set(waiting.map(l => l.id)));
    this.retimeQueue(now);
  }

  /** Launches left over from an earlier bar give up any zone or scene a later press owns, so the operator's last choice wins. */
  private yieldToNewer(stale: ReadonlySet<string>): void {
    const queue = this.launcher.queue;
    const kept = queue.flatMap((l): Launch[] => {
      if (!stale.has(l.id)) return [l];
      const press = this.pressOf(l.id), newer = queue.filter(o => this.pressOf(o.id) > press);
      const changes = l.changes.filter(c => this.landedPress[c.zone] <= press && !newer.some(o => o.changes.some(x => x.zone === c.zone)));
      const sceneIndex = newer.some(o => o.sceneIndex !== null && o.sceneIndex !== l.sceneIndex) ? null : l.sceneIndex;
      return changes.length > 0 || sceneIndex !== null ? [{ ...l, changes, sceneIndex }] : [];
    });
    this.launcher = { ...this.launcher, queue: kept };
  }

  /** Moves the queue to the clock as it is now. A launch already firing stays where it is, unless named in `force`. */
  private retimeQueue(nowMs: number, force: ReadonlySet<string> = new Set()): void {
    const real = this.deps.now();
    const firing = (l: Launch) => !force.has(l.id) && this.isFiring(l, real);
    const stay = this.launcher.queue.filter(firing);
    const moved = retime({ ...this.launcher, queue: this.launcher.queue.filter(l => !firing(l)) }, this.deps.clock.snapshot(nowMs), this.deps.show().performance, nowMs);
    this.launcher = { ...moved, queue: [...stay, ...moved.queue] };
  }

  /** A scene with nothing to change has nothing for the wall to report: it lands here, so the row and its follow timer move on. */
  private landEmpty(now: number): void {
    for (const l of this.launcher.queue) if (l.changes.length === 0 && l.atMs <= now) this.launcher = landed(this.launcher, l.id, [], now, this.deps.random);
  }

  private queueFollow(now: number): void {
    const set = this.deps.show().performance, clock = this.deps.clock.snapshot(now);
    const row = dueFollow(this.launcher, set, beatAt(clock, now + FOLLOW_LOOKAHEAD_MS), this.deps.random);
    if (row === null || this.launcher.followAtBeat === null) return;
    // Placed as a press exactly on the bar it is due, so a check made early cannot count as late for the bar before.
    const dueMs = msAtBeat(clock, this.launcher.followAtBeat);
    this.place(now, (s, at) => queueScene(s, set, row, clock, Math.max(at, dueMs), this.deps.id()));
  }

  private followDrift(now: number): void {
    const clock = this.deps.clock.snapshot(now);
    if (this.launcher.queue.some(l => l.atMs > now + DRIFT_SETTLED_MS && Math.abs(msAtBeat(clock, l.beat) - l.atMs) > DRIFT_MS)) this.retimeQueue(now);
  }

  // ---- Values ----
  private readStatus(): void {
    const audio = this.deps.clock.audio?.(), midi = this.deps.clock.midi?.();
    if (audio) this.audio = audio;
    if (!midi) return;
    if (midi.state === 'on' && midi.devices.length > 0) this.midi = 'connected';
    else if (this.midi === 'connected') this.controllerLost();
  }

  private clipOf(zone: number): Clip | undefined {
    const id = this.launcher.playing[zone];
    return id === null ? undefined : this.deps.show().performance.clips.find(c => c.id === id);
  }

  /** Audio reaction and bursts ease, so a lost input fades out rather than cutting. */
  private stepEnvelopes(now: number): void {
    const dt = this.lastFrame === null ? 0 : Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    for (let i = 0; i < ZONE_COUNT; i++) {
      const band = this.clipOf(i)?.audioBand ?? 'level';
      this.reaction[i] += (this.controls.knobs[i][2] * unit(this.signals[AUDIO_KEYS[band]]) - this.reaction[i]) * Math.min(1, dt / REACT_MS);
      const times = i === CEILING ? BURST_MS.ceiling : BURST_MS.room, on = this.bursts[i];
      this.burstLevel[i] += ((on ? 1 : 0) - this.burstLevel[i]) * Math.min(1, dt / (on ? times.on : times.off));
    }
  }

  private isLocked(sourceId: string): boolean {
    const show = this.deps.show();
    return !!(show.sources.find(s => s.id === sourceId)?.tempoSync ?? show.videos.find(v => v.id === sourceId)?.tempoSync);
  }

  private computeValues(): PerformValues {
    const pictures = this.pictures(), linked = linkedZones(pictures), { faders, knobs, master, ready } = this.controls;
    const lift = (i: number) => this.reaction[i] + this.burstLevel[i] * (BURST_BASE + BURST_KICK * unit(this.signals['audio.bass']));
    const speedOf = (i: number) => {
      const source = pictures[i].sourceId;
      if (source === null || source === LIVE_SOURCE_ID) return 1;
      // Zones sharing a source share one picture, so they share one speed.
      const zones = linked.get(source) ?? [i], offset = mean(zones.map(z => knobOffset(knobs[z][0])));
      return this.isLocked(source) ? speedFactor(offset, true) : speedFactor(offset, false) * (1 + SPEED_FOLD * mean(zones.map(lift)));
    };
    return {
      master: ready ? master : 0,
      zones: Array.from({ length: ZONE_COUNT }, (_, i) => ({
        brightness: faders[i] * (1 + lift(i)),
        hueDeg: wrapHue((this.clipOf(i)?.hueOffset ?? 0) + knobOffset(knobs[i][1]) * HUE_RANGE),
        speed: speedOf(i),
      })),
    };
  }

  private pushValues(now: number, force = false): void {
    if (!this.deps.wall.isOpen() || (!force && now - this.valuesAt < VALUES_EVERY_MS)) return;
    const values = this.computeValues(), key = JSON.stringify(values);
    if (!force && key === this.valuesKey) return;
    this.valuesAt = now;
    this.valuesKey = key;
    this.send({ type: 'performValues', values });
  }

  private publish(now: boolean): void {
    if (!this.listeners.size) return;
    const t = this.deps.now();
    if (!now && t - this.viewAt < VIEW_EVERY_MS) return;
    this.viewAt = t;
    const view = this.view();
    for (const fn of this.listeners) fn(view);
  }

  private reset(): void {
    this.launcher = initialLauncher();
    this.controls = initialControls();
    this.shift = false;
    this.midi = 'none';
    this.wallArmed = [];
    this.requested = [];
    this.requestedAt.clear();
    this.held.clear();
    this.replaced.clear();
    this.presses.clear();
    this.landedPress = zeros();
    this.phases.clear();
    this.bursts.fill(false);
    this.burstLevel = zeros();
    this.reaction = zeros();
    this.signals = {};
    this.lastFrame = null;
    this.valuesAt = -Infinity;
    this.valuesKey = '';
  }
}

/** How the service reaches the wall and the show: given by the Map session, which outlives the Map screen. */
export interface PerformMapLink { send(m: MapMessage): void; isOpen(): boolean; sendWholeShow(): void; show(): ShowDocument; live(): LiveSettings | null }
let mapLink: PerformMapLink | null = null;
export function linkPerformToMap(link: PerformMapLink): void { mapLink = link; }

let service: PerformService | null = null;
let launchIds = 0;
/** The one service for this window. Nothing listens to sound or MIDI until a show starts. */
export function performService(): PerformService {
  if (service) return service;
  const origin = () => performance.timeOrigin;
  service = new PerformService({
    wall: {
      send: m => { if (acceptMapMessage(m as unknown)) mapLink?.send(m); },
      isOpen: () => mapLink?.isOpen() ?? false,
      sendWholeShow: () => mapLink?.sendWholeShow(),
    },
    clock: {
      snapshot: nowMs => clockSnapshot(reactivity().tempo, nowMs, origin()),
      begin: () => reactivity().beginShowClock(),
      end: () => reactivity().endShowClock(),
      tap: () => reactivity().showTap(),
      follow: () => reactivity().followAgain(),
      setBarStart: () => reactivity().setBarStart(),
      subscribe: fn => reactivity().subscribe(fn),
      audio: () => reactivity().audio.status,
      midi: () => reactivity().midi.status,
    },
    show: () => mapLink?.show() ?? (() => { throw new Error('Perform needs the Map session'); })(),
    live: () => mapLink?.live() ?? null,
    now: () => origin() + performance.now(),
    id: () => `launch-${++launchIds}`,
    random: Math.random,
  });
  return service;
}
