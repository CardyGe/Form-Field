/** The Perform launcher: what is playing, what is queued, and what changes on the next bar. Pure: every function returns a new state. */
import { followBeat, followChoices, pickFollow, plannedFollow } from './sequence';
import { nextBoundary, type ClockSnapshot } from './timing';
import { BEATS_PER_BAR, ZONE_COUNT, type BlendKind, type Clip, type PerformanceSet, type Quantize, type Scene } from './types';

export interface ZoneChange { zone: number; clipId: string | null; blend: { kind: BlendKind; durationMs: number } }
/** One queued launch. followAtBeat and followChoices carry a scene's follow rule, because landed() has no set to read it from. */
export interface Launch { id: string; beat: number; atMs: number; sceneIndex: number | null; changes: ZoneChange[]; followAtBeat?: number | null; followChoices?: number[] }
/** followTarget is the row the current scene's follow rule chose when it landed. */
export interface LauncherState { playing: (string | null)[]; previous: (string | null)[]; launched: boolean[]; sceneIndex: number; queue: Launch[]; followAtBeat: number | null; followTarget: number | null; ceilingBusyUntilMs: number }

const CEILING_ZONE = ZONE_COUNT - 1;
const FADE_BARS = [0.5, 1, 2, 4, 8];
const DISSOLVE_BARS = [8, 16, 32];
const CEILING_DEFAULT_BARS = 16;
const ROOM_FADE_BARS = 1;
const MAX_ARMED = 8;
/** A stop lands on the next beat rather than the next bar. */
const STOP_QUANTIZE: Quantize = '1/4';

export const initialLauncher = (): LauncherState => ({
  playing: Array(ZONE_COUNT).fill(null),
  previous: Array(ZONE_COUNT).fill(null),
  launched: Array(ZONE_COUNT).fill(false),
  sceneIndex: -1,
  queue: [],
  followAtBeat: null,
  followTarget: null,
  ceilingBusyUntilMs: 0,
});

const barsToMs = (bars: number, bpm: number) => bars * BEATS_PER_BAR * 60000 / bpm;
/** Saved files can be hand-edited, so bars snap to the nearest allowed length (the shorter one on a tie). */
const snap = (bars: number, allowed: readonly number[]) => allowed.reduce((best, v) => Math.abs(v - bars) < Math.abs(best - bars) ? v : best);

function blendFor(clip: Clip | undefined, zone: number, via: 'scene' | 'amber', bpm: number): ZoneChange['blend'] {
  const own = clip?.blend;
  if (own) {
    if (own.kind === 'cut') return { kind: 'cut', durationMs: 0 };
    const bars = own.kind === 'fade' ? snap(own.bars, FADE_BARS) : own.kind === 'dissolve' ? snap(own.bars, DISSOLVE_BARS) : own.bars;
    return { kind: own.kind, durationMs: barsToMs(bars, bpm) };
  }
  if (zone === CEILING_ZONE) return { kind: 'dissolve', durationMs: barsToMs(CEILING_DEFAULT_BARS, bpm) };
  return via === 'scene' ? { kind: 'cut', durationMs: 0 } : { kind: 'fade', durationMs: barsToMs(ROOM_FADE_BARS, bpm) };
}
const stopBlend = (bpm: number): ZoneChange['blend'] => ({ kind: 'fade', durationMs: barsToMs(ROOM_FADE_BARS, bpm) });
const clipById = (set: PerformanceSet, id: string | null) => id === null ? undefined : set.clips.find(c => c.id === id);
/** Only a new ceiling loop waits for a running dissolve. A Stop (null) does not. */
const waitsForCeiling = (c: ZoneChange) => c.zone === CEILING_ZONE && c.clipId !== null;

type Slot = { beat: number; atMs: number };
/**
 * Places a launch: everything on the room slot, and any new ceiling loop on the wait slot if the room would land during the dissolve.
 * The ceiling part keeps the scene's index until the room lands, so Bank ◀ cancels both. With a scene, the follow beat is reworked for each part's slot.
 */
function placeLaunch(s: LauncherState, l: Launch, room: Slot, wait: Slot, scene?: Scene): Launch[] {
  const at = (slot: Slot): Partial<Launch> => ({ beat: slot.beat, atMs: slot.atMs, ...(scene ? { followAtBeat: followBeat(scene, slot.beat) } : {}) });
  const ceiling = l.changes.filter(waitsForCeiling);
  if (ceiling.length === 0 || room.atMs >= s.ceilingBusyUntilMs) return [{ ...l, ...at(room) }];
  const rest = l.changes.filter(c => !waitsForCeiling(c));
  if (rest.length === 0) return [{ ...l, ...at(wait) }];
  return [{ ...l, ...at(room), changes: rest }, { ...l, id: `${l.id}:ceiling`, ...at(wait), changes: ceiling }];
}

/** When a press lands. A ceiling change that would land during a running dissolve waits for the first boundary after it. */
function slot(s: LauncherState, clock: ClockSnapshot, nowMs: number, q: Quantize, ceiling: boolean): { beat: number; atMs: number } {
  const b = nextBoundary(clock, nowMs, q);
  if (!ceiling || b.atMs >= s.ceilingBusyUntilMs) return { beat: b.beat, atMs: b.atMs };
  const w = nextBoundary(clock, s.ceilingBusyUntilMs, q, 0);
  return { beat: w.beat, atMs: w.atMs };
}

/** The queue with any change for these zones removed. A scene launch stays even when emptied, because it still moves the current row. */
function withoutZones(queue: readonly Launch[], zones: readonly number[]): Launch[] {
  return queue
    .map(l => l.changes.some(c => zones.includes(c.zone)) ? { ...l, changes: l.changes.filter(c => !zones.includes(c.zone)) } : l)
    .filter(l => l.changes.length > 0 || l.sceneIndex !== null);
}
const queuedChange = (s: LauncherState, zone: number) => s.queue.flatMap(l => l.changes).find(c => c.zone === zone);
const queuedScene = (s: LauncherState) => s.queue.find(l => l.sceneIndex !== null)?.sceneIndex ?? null;

/** Puts one zone's change in the queue, replacing what it had. A change to what is already playing just clears the queue for that zone. */
function queueChange(s: LauncherState, zone: number, clipId: string | null, blend: ZoneChange['blend'], clock: ClockSnapshot, nowMs: number, q: Quantize, id: string): LauncherState {
  const queue = withoutZones(s.queue, [zone]);
  if (clipId === s.playing[zone]) return { ...s, queue };
  const at = slot(s, clock, nowMs, q, zone === CEILING_ZONE && clipId !== null);
  return { ...s, queue: [...queue, { id, ...at, sceneIndex: null, changes: [{ zone, clipId, blend }] }] };
}

/** The zone's clips in row order. A clip on several rows is one stop, so stepping can never stick on it. */
const column = (set: PerformanceSet, zone: number) => [...new Set(set.scenes.map(sc => sc.cells[zone]).filter((c): c is string => c !== null && c !== undefined))];

export function queueZone(s: LauncherState, set: PerformanceSet, zone: number, step: 1 | -1, clock: ClockSnapshot, nowMs: number, id: string): LauncherState {
  const clips = column(set, zone);
  if (clips.length === 0) return s;
  const pending = queuedChange(s, zone);
  const from = clips.indexOf((pending ? pending.clipId : s.playing[zone]) as string);
  const to = from < 0 ? (step === 1 ? 0 : clips.length - 1) : (from + step + clips.length) % clips.length;
  const clipId = clips[to];
  return queueChange(s, zone, clipId, blendFor(clipById(set, clipId), zone, 'amber', clock.bpm), clock, nowMs, set.launchQuantize, id);
}

/** One chosen cell, as Amber would launch it. Choosing what the zone already plays takes back anything queued for it. */
export function queueCell(s: LauncherState, set: PerformanceSet, row: number, zone: number, clock: ClockSnapshot, nowMs: number, id: string): LauncherState {
  const clipId = set.scenes[row]?.cells[zone];
  if (clipId === null || clipId === undefined) return s;
  return queueChange(s, zone, clipId, blendFor(clipById(set, clipId), zone, 'amber', clock.bpm), clock, nowMs, set.launchQuantize, id);
}

export function returnZone(s: LauncherState, set: PerformanceSet, zone: number, clock: ClockSnapshot, nowMs: number, id: string): LauncherState {
  const clipId = s.previous[zone];
  if (clipId === null) return s;
  return queueChange(s, zone, clipId, blendFor(clipById(set, clipId), zone, 'amber', clock.bpm), clock, nowMs, set.launchQuantize, id);
}

export function stopZone(s: LauncherState, zone: number, clock: ClockSnapshot, nowMs: number, id: string): LauncherState {
  return queueChange(s, zone, null, stopBlend(clock.bpm), clock, nowMs, STOP_QUANTIZE, id);
}

/** The zones a scene changes, with their clips. An empty cell keeps playing; a protected zone is left alone unless the scene includes it. */
function sceneCells(set: PerformanceSet, index: number): { zone: number; clipId: string }[] {
  const scene = set.scenes[index];
  const cells: { zone: number; clipId: string }[] = [];
  for (let zone = 0; zone < ZONE_COUNT; zone++) {
    const clipId = scene.cells[zone];
    if (clipId === null || clipId === undefined) continue;
    if (set.zones[zone]?.protected && !scene.includeProtected) continue;
    cells.push({ zone, clipId });
  }
  return cells;
}

export function queueScene(s: LauncherState, set: PerformanceSet, index: number, clock: ClockSnapshot, nowMs: number, id: string): LauncherState {
  const scene = set.scenes[index];
  if (!scene) return s;
  const cells = sceneCells(set, index);
  const queue = withoutZones(s.queue.filter(l => l.sceneIndex === null), cells.map(c => c.zone));
  const changes: ZoneChange[] = cells
    .filter(c => c.clipId !== s.playing[c.zone])
    .map(c => ({ zone: c.zone, clipId: c.clipId, blend: blendFor(clipById(set, c.clipId), c.zone, 'scene', clock.bpm) }));
  const bar = slot(s, clock, nowMs, set.launchQuantize, false);
  const wait = slot(s, clock, nowMs, set.launchQuantize, true);
  const launch: Launch = { id, ...bar, sceneIndex: index, changes, followChoices: followChoices(scene, index, set.scenes) };
  return { ...s, queue: [...queue, ...placeLaunch(s, launch, bar, wait, scene)] };
}

export function bankNext(s: LauncherState, set: PerformanceSet, clock: ClockSnapshot, nowMs: number, id: string): LauncherState {
  const next = (queuedScene(s) ?? s.sceneIndex) + 1;
  return next < set.scenes.length ? queueScene(s, set, next, clock, nowMs, id) : s;
}

export function bankBack(s: LauncherState, set: PerformanceSet, clock: ClockSnapshot, nowMs: number, id: string): LauncherState {
  if (queuedScene(s) !== null) return { ...s, queue: s.queue.filter(l => l.sceneIndex === null) };
  return s.sceneIndex > 0 ? queueScene(s, set, s.sceneIndex - 1, clock, nowMs, id) : s;
}

/** Fires the queued scene now. A new ceiling loop keeps its place behind a running dissolve, and the room goes without it. */
export function launchNow(s: LauncherState, nowMs: number): LauncherState {
  return { ...s, queue: s.queue.flatMap(l => l.sceneIndex === null ? [l] : placeLaunch(s, l, { beat: l.beat, atMs: nowMs }, { beat: l.beat, atMs: l.atMs })) };
}

/** Re-places every queued launch after a "This is the 1" or tempo correction, and re-works its blend lengths at the new tempo. */
export function retime(s: LauncherState, clock: ClockSnapshot, set: PerformanceSet, nowMs: number): LauncherState {
  const queue = s.queue.flatMap((l): Launch[] => {
    const isStop = l.sceneIndex === null && l.changes.length > 0 && l.changes.every(c => c.clipId === null);
    const q = isStop ? STOP_QUANTIZE : set.launchQuantize;
    const room = nextBoundary(clock, nowMs, q, 0);
    const wait = nextBoundary(clock, Math.max(nowMs, s.ceilingBusyUntilMs), q, 0);
    const changes = l.changes.map(c => ({
      ...c,
      blend: c.clipId === null ? stopBlend(clock.bpm) : blendFor(clipById(set, c.clipId), c.zone, c.blend.kind === 'cut' ? 'scene' : 'amber', clock.bpm),
    }));
    const scene = l.sceneIndex === null ? undefined : set.scenes[l.sceneIndex];
    const next: Launch = scene ? { ...l, changes, followChoices: followChoices(scene, l.sceneIndex!, set.scenes) } : { ...l, changes };
    return placeLaunch(s, next, { beat: room.beat, atMs: room.atMs }, { beat: wait.beat, atMs: wait.atMs }, scene);
  });
  // A running follow rule moves to the first corrected bar at or after it.
  const followAtBeat = s.followAtBeat === null ? null
    : clock.barOffset + Math.ceil((s.followAtBeat - clock.barOffset) / BEATS_PER_BAR - 1e-9) * BEATS_PER_BAR;
  return { ...s, queue, followAtBeat };
}

/** Records which zones of a launch reached the wall. Any other zone stays queued, and retime moves it to the next bar. */
export function landed(s: LauncherState, launchId: string, zones: readonly number[], nowMs: number, random: () => number = Math.random): LauncherState {
  const launch = s.queue.find(l => l.id === launchId);
  if (!launch) return s;
  const hit = launch.changes.filter(c => zones.includes(c.zone));
  if (hit.length === 0 && launch.changes.length > 0) return s;

  const playing = [...s.playing], previous = [...s.previous], isLaunched = [...s.launched];
  let ceilingBusyUntilMs = s.ceilingBusyUntilMs;
  for (const c of hit) {
    if (playing[c.zone] !== c.clipId) previous[c.zone] = playing[c.zone];
    playing[c.zone] = c.clipId;
    isLaunched[c.zone] = true;
    if (c.zone === CEILING_ZONE) {
      const blendEnd = Math.max(launch.atMs, nowMs) + c.blend.durationMs;
      // A Stop replaces the running dissolve, so only its own fade holds the ceiling.
      ceilingBusyUntilMs = c.clipId === null ? blendEnd : Math.max(ceilingBusyUntilMs, blendEnd);
    }
  }

  const rest = launch.changes.filter(c => !zones.includes(c.zone));
  const isScene = launch.sceneIndex !== null;
  // Once a scene has landed, what is left of it is a straggler: it no longer counts as a queued scene or restarts the follow timer.
  const queue = s.queue.flatMap((l): Launch[] => {
    if (l === launch) return rest.length > 0 ? [{ id: l.id, beat: l.beat, atMs: l.atMs, sceneIndex: null, changes: rest }] : [];
    if (isScene && l.sceneIndex === launch.sceneIndex) return [{ id: l.id, beat: l.beat, atMs: l.atMs, sceneIndex: null, changes: l.changes }];
    return [l];
  });
  return {
    ...s, playing, previous, launched: isLaunched, queue, ceilingBusyUntilMs,
    sceneIndex: isScene ? launch.sceneIndex! : s.sceneIndex,
    followAtBeat: isScene ? launch.followAtBeat ?? null : s.followAtBeat,
    followTarget: isScene ? pickFollow(launch.followChoices ?? [], random) : s.followTarget,
  };
}

/** The clips to keep warm, most urgent first: everything queued, the follow target, then the next scene. Never more than the renderer budget. */
export function armList(s: LauncherState, set: PerformanceSet): string[] {
  const queued = s.queue.flatMap(l => l.changes).map(c => c.clipId).filter((c): c is string => c !== null);
  const pending = s.queue.find(l => l.sceneIndex !== null);
  // A queued scene's random rule is not chosen until it lands, so only a single known target can be armed for it.
  const followRow = pending ? (pending.followChoices?.length === 1 ? pending.followChoices[0] : null) : plannedFollow(s, set);
  const rowClips = (row: number | null) => row !== null && set.scenes[row] ? sceneCells(set, row).map(c => c.clipId) : [];
  const nextRow = (pending?.sceneIndex ?? s.sceneIndex) + 1;
  return [...new Set([...queued, ...rowClips(followRow), ...rowClips(nextRow)])].filter(c => !s.playing.includes(c)).slice(0, MAX_ARMED);
}
