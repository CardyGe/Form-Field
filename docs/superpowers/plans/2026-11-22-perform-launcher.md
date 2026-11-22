# Perform Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Perform section where Greg launches, blends and sequences mapped visuals across eight zones in time with deck audio, from an on-screen controller now and an Akai MIDImix when it arrives.

**Architecture:** Pure modules in `src/perform/` own launching, sequencing and controls. An app-level `PerformService` in the studio window uses the existing `reactivity()` engine and survives section changes. The wall applies exact-time launches as an overlay on the Map show, so saved shapes, undo history and Map scenes are never edited.

**Tech Stack:** TypeScript 7, React 19, Electron 45, the existing WebGL `MapCompositor` and `src/react/` engine, Web MIDI, `node:test` through `tsx`, Playwright Electron checks.

**Spec:** `docs/superpowers/specs/2026-11-22-perform-launcher-design.md`

**Branch:** `perform-launcher`, in the `three VJ - Perform` worktree, from `main` at `58d643b`.

## Global Constraints

- Exactly 8 zones. Zone index 7 defaults to the ceiling and is `protected: true`.
- Up to 16 Perform scenes. Up to 64 distinct sources (`MAX_SOURCES`).
- Renderer budget: 8 playing, 8 armed, 1 outgoing ceiling look, inside `MAX_LIVE_INSTRUMENTS` (24). The app starts with `--max-active-webgl-contexts=32`. If the soak disproves it, the fallback is 14 renderers total, prioritising playing, then outgoing ceiling, then armed.
- 4 beats to a bar. Launch quantize: `'1/4'` = 1 beat, `'1/2'` = 2, `'1bar'` = 4, `'2bar'` = 8, `'4bar'` = 16. Default `'1bar'`.
- Late-press grace: 100 ms. Follow tempo range: 85–175 BPM.
- Blend defaults: room scene `cut`; room Amber `fade` 1 bar; ceiling `dissolve` 16 bars. A clip's own blend always wins. Fade bars: ½, 1, 2, 4, 8. Dissolve bars: 8, 16, 32. Durations are fixed in milliseconds at launch.
- Locked loop lengths are the existing `TEMPO_SYNC_BEATS`: 1, 2, 4, 8, 16 beats.
- Scenes never store fader or knob values. No control positions are saved anywhere.
- A show starts black. Send All reads the controls. Bank ▶ launches the first scene.
- Shapes outside the eight zones are hidden during a show. Blockers keep working.
- A running show never edits Map's saved shapes, undo history or scenes. Map's scene bar, triggers and auto-advance pause during a show and resume after it.
- Deck audio is never saved, sent anywhere, or used for anything except live analysis.
- No MIDI SysEx. The wall window never receives audio or MIDI permission.
- Studio's loop, seek and export behaviour must not change. Shows not using Perform keep their current behaviour, including the existing `beat` tempo source.
- Show format becomes version 9. Versions 1–8 still open, with an empty Perform set.
- UI copy is plain English. No control may require looking at the laptop during a normal transition.
- Do not build: Link, CDJ sync, timecode, two projectors, recording, a timeline arranger, A/B buses.

## Review Focus

1. **Double press while a launch is queued:** the queue moves on one step and never fires two launches on one bar. Pinned in Task 4.
2. **"This is the 1" or a tempo change while a launch is queued:** the launch re-times to the corrected bar, and running loops do not jump. Pinned in Tasks 2, 4 and 8.
3. **Deleting a Map shape, group or source used by a clip mid-show:** the zone keeps running or goes black, and nothing throws. Pinned in Tasks 1, 3 and 8.
4. **Wall window closed and reopened mid-show:** it receives the set, playing clips and values, and does not flash. Pinned in Tasks 8 and 9.
5. **Controller or audio device removed mid-show:** the picture continues with the held tempo and values. Pinned in Tasks 5, 8 and 16.

---

## Stages 0 and 1: data, clock and control logic

### Task 1: Perform set and show version 9

**Files:**
- Create: `src/perform/types.ts`, `src/perform/set.ts`
- Modify: `src/map/show.ts` (`ShowDocument`, `WireShow`, `createShow`, `validateShow`, `validateWireShow`, `playedBy`), `src/map/editor.ts` (every `playedBy` call that builds a partial show), `src/map/messages.ts` (`toWire`)
- Test: `tests/perform-set.test.ts`; update the version assertions in `tests/map-media.test.ts:94`, `tests/map-show.test.ts:67,111,261`, `tests/map-live.test.ts:68`, `tests/map-wild.test.ts:31`

**Interfaces:**
- Produces in `types.ts`:
  ```ts
  export const ZONE_COUNT = 8; export const MAX_PERFORM_SCENES = 16; export const BEATS_PER_BAR = 4;
  export type Quantize = '1/4' | '1/2' | '1bar' | '2bar' | '4bar';
  export type BlendKind = 'cut' | 'fade' | 'dip' | 'dissolve';
  export interface Blend { kind: BlendKind; bars: number }
  export interface Zone { id: string; name: string; target: { kind: 'group' | 'shape'; id: string } | null; protected: boolean }
  export interface Clip { id: string; name: string; sourceId: string; hueOffset: number; blend: Blend | null; audioBand: 'bass' | 'mid' | 'high' | 'level' }
  export interface Scene { id: string; name: string; cells: (string | null)[]; includeProtected: boolean; follow: { afterBars: 4 | 8 | 16 | 32; to: 'next' | 'previous' | 'first' | 'random' | string } | null }
  export interface PerformanceSet { zones: Zone[]; scenes: Scene[]; clips: Clip[]; launchQuantize: Quantize }
  ```
- Produces in `set.ts`: `createPerformanceSet(): PerformanceSet`, `validatePerformanceSet(value: unknown, knownSourceIds: ReadonlySet<string>): { set: PerformanceSet; repaired: boolean }`, `clipSourceIds(set: PerformanceSet): string[]`.
- `ShowDocument` gains `performance: PerformanceSet`, `version: 9`. `WireShow` becomes version 9 and gains `clipSourceIds: string[]`.

- [ ] **Step 1: Confirm the baseline**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Write the failing tests**

```ts
test('a new set has 8 unassigned zones, the last protected and named Ceiling', () => {
  const s = createPerformanceSet();
  assert.equal(s.zones.length, 8); assert.equal(s.zones[7].name, 'Ceiling'); assert.equal(s.zones[7].protected, true);
  assert.ok(s.zones.every(z => z.target === null)); assert.equal(s.launchQuantize, '1bar');
});
test('repair: too many scenes, a clip with a missing source, and wrong cell counts', () => {
  const raw = { ...createPerformanceSet(), scenes: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: 'x', cells: ['gone'], includeProtected: false, follow: null })),
    clips: [{ id: 'gone', name: 'x', sourceId: 'missing', hueOffset: 0, blend: null, audioBand: 'bass' }] };
  const { set, repaired } = validatePerformanceSet(raw, new Set());
  assert.equal(repaired, true); assert.equal(set.scenes.length, 16); assert.equal(set.clips.length, 0);
  assert.ok(set.scenes.every(s => s.cells.length === 8 && s.cells.every(c => c === null)));
});
test('a clip may play an instrument, a video or Live', () => { /* known ids 'a', 'video-b', LIVE_SOURCE_ID: all three clips survive */ });
test('a version 8 show opens with an empty set and becomes version 9', () => {});
test('an instrument used only by a clip survives load, wire and an unrelated shape delete', () => {});
test('a video used only by a clip survives an unrelated shape delete', () => {});
test('deleting the group a zone targets leaves the zone unassigned on next validation', () => {});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx tsx --test tests/perform-set.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

Wrap `hueOffset` to 0–360. Invalid `follow` becomes null. Invalid blends become null. Make `playedBy` accept optional `performance` and count clips, and pass `performance` wherever the editor builds a partial show for it. Update the listed version assertions.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-22-perform-launcher-design.md docs/superpowers/plans/2026-11-22-perform-launcher.md src tests
git commit -m "Add the Perform set to the show file"
```

### Task 2: Beat following and launch timing

**Files:**
- Create: `src/perform/timing.ts`
- Modify: `src/react/tempo.ts`, `src/react/engine.ts`
- Test: `tests/perform-timing.test.ts`

**Interfaces:**
- Produces in `tempo.ts`:
  ```ts
  export type TempoSource = 'beat' | 'tap' | 'midi' | 'fixed' | 'follow';
  export type FollowState = 'locked' | 'holding' | 'manual';
  // TempoClock gains:
  followOnset(t: number, bpmHint: number | null): void;
  followTick(t: number): void;     // moves to holding after 4 s with no accepted onset
  manualTap(t: number): void;      // tap for a show: state manual, does not change saved prefs
  resumeFollow(t: number): void;
  setBarStart(t: number): void;    // sets barOffset 0..3 only; never changes the beat count
  readonly followState: FollowState; readonly barOffset: number;
  snapshot(t: number): { beats: number; bpm: number; state: FollowState; barOffset: number };
  ```
- Produces in `engine.ts`: `beginShowClock(): void` (uses `follow`, unless the saved source is `midi`), `endShowClock(): void` (restores the source), `showTap(): void`, `followAgain(): void`, `setBarStart(): void`. These never write preferences.
- Produces in `timing.ts`:
  ```ts
  export interface ClockSnapshot { anchorMs: number; anchorBeat: number; bpm: number; state: FollowState; barOffset: number }
  export function beatAt(c: ClockSnapshot, nowMs: number): number;
  export function msAtBeat(c: ClockSnapshot, beat: number): number;
  export const quantizeBeats: Record<Quantize, number>;
  export function nextBoundary(c: ClockSnapshot, nowMs: number, q: Quantize, graceMs?: number): { beat: number; atMs: number; late: boolean };
  export function launchPhaseOffset(c: ClockSnapshot): number; // beats a locked clip launched now is shifted by
  ```

- [ ] **Step 1: Write the failing tests**

```ts
const c = { anchorMs: 0, anchorBeat: 0, bpm: 120, state: 'manual', barOffset: 0 } as const;
test('next bar', () => assert.deepEqual(nextBoundary(c, 1900, '1bar'), { beat: 4, atMs: 2000, late: false }));
test('a press within 100 ms after the bar counts as that bar and fires now', () => assert.deepEqual(nextBoundary(c, 2050, '1bar'), { beat: 4, atMs: 2050, late: true }));
test('a press later than that waits for the next bar', () => assert.deepEqual(nextBoundary(c, 2150, '1bar'), { beat: 8, atMs: 4000, late: false }));
test('bars follow the offset', () => assert.equal(nextBoundary({ ...c, barOffset: 1 }, 1900, '1bar').beat, 5));
test('quantize values', () => assert.deepEqual(quantizeBeats, { '1/4': 1, '1/2': 2, '1bar': 4, '2bar': 8, '4bar': 16 }));
test('follow: on-beat onsets lock at 128 ±1 BPM within 8 seconds', () => {});
test('follow: an off-beat onset does not move the beat', () => {});
test('follow: phase converges within 30 ms after a small timing error', () => {});
test('follow: 4 s without onsets is holding, at the last tempo', () => {});
test('follow: tempo stays within 85 to 175', () => {});
test('setBarStart changes barOffset and never changes the beat count', () => {});
test('manualTap is manual until resumeFollow', () => {});
test('the existing beat source still re-anchors on each onset', () => {});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx --test tests/perform-timing.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Accept an onset only within 15% of a beat from the expected position, correcting phase and tempo gently. In `ReactivityEngine.read`, also call `followOnset` on an onset and `followTick` each frame. Do not add `follow` to persisted preference values.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "Add a steady beat-following clock for launches"
```

### Task 3: Resolve zones over the Map show

**Files:**
- Create: `src/perform/resolve.ts`
- Test: `tests/perform-resolve.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function zoneShapes(zones: readonly Zone[], shapes: readonly Shape[]): string[][]; // a shape belongs to the first zone claiming it
  export interface ZonePicture { shapeIds: string[]; sourceId: string | null; launched: boolean }
  export function overlayShow<T extends { shapes: Shape[]; groups: Group[] }>(show: T, zones: readonly ZonePicture[]): T;
  export function linkedZones(zones: readonly ZonePicture[]): Map<string, number[]>;
  ```

- [ ] **Step 1: Write the failing tests**

Assert: a group target returns its members; a shape claimed twice goes to the first zone; a deleted target returns `[]` without throwing; a launched zone's shapes play its source; never-launched zones and unassigned shapes are `visible: false`; a launched zone with `sourceId: null` is visible, black, `fill: 'colour'`, border width 0, with no border run; a blocker stays visible and a blocker; the input is not mutated; `linkedZones` reports zones 0 and 1 sharing a source.

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx --test tests/perform-resolve.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `resolve.ts`**

- [ ] **Step 4: Run to confirm it passes**

Run: `npx tsx --test tests/perform-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/perform/resolve.ts tests/perform-resolve.test.ts
git commit -m "Resolve Perform zones over the Map show"
```

### Task 4: Launcher and sequence rules

**Files:**
- Create: `src/perform/launcher.ts`, `src/perform/sequence.ts`
- Test: `tests/perform-launcher.test.ts`

**Interfaces:**
- Consumes: `ClockSnapshot`, `nextBoundary`, `msAtBeat`, `PerformanceSet`.
- Produces:
  ```ts
  export interface ZoneChange { zone: number; clipId: string | null; blend: { kind: BlendKind; durationMs: number } }
  export interface Launch { id: string; beat: number; atMs: number; sceneIndex: number | null; changes: ZoneChange[] }
  export interface LauncherState { playing: (string | null)[]; previous: (string | null)[]; launched: boolean[]; sceneIndex: number; queue: Launch[]; followAtBeat: number | null; ceilingBusyUntilMs: number }
  export const initialLauncher = (): LauncherState;
  export function queueZone(s: LauncherState, set: PerformanceSet, zone: number, step: 1 | -1, clock: ClockSnapshot, nowMs: number, id: string): LauncherState;
  export function returnZone(s: LauncherState, set: PerformanceSet, zone: number, clock: ClockSnapshot, nowMs: number, id: string): LauncherState;
  export function stopZone(s: LauncherState, zone: number, clock: ClockSnapshot, nowMs: number, id: string): LauncherState;
  export function queueScene(s: LauncherState, set: PerformanceSet, index: number, clock: ClockSnapshot, nowMs: number, id: string): LauncherState;
  export function bankNext(s: LauncherState, set: PerformanceSet, clock: ClockSnapshot, nowMs: number, id: string): LauncherState;
  export function bankBack(s: LauncherState, set: PerformanceSet, clock: ClockSnapshot, nowMs: number, id: string): LauncherState;
  export function launchNow(s: LauncherState, nowMs: number): LauncherState;
  export function retime(s: LauncherState, clock: ClockSnapshot, set: PerformanceSet, nowMs: number): LauncherState;
  export function landed(s: LauncherState, launchId: string, zones: readonly number[], nowMs: number): LauncherState;
  export function armList(s: LauncherState, set: PerformanceSet): string[]; // next scene and queued clips, at most 8
  ```
  In `sequence.ts`: `dueFollow(s: LauncherState, set: PerformanceSet, beat: number, random: () => number): number | null`, `followBeat(scene: Scene, landedBeat: number): number | null`.

- [ ] **Step 1: Write the failing tests**

Use one `fixtureSet()` with 4 scenes, 8 zones and named clips. Each test name below is its assertion:

```ts
test('Bank ▶ queues the first scene from a black room, on the next bar', () => {});
test('Bank ▶ twice moves the queued scene on one row, with one launch queued', () => {});
test('Bank ◀ cancels a queued scene and changes nothing playing', () => {});
test('Bank ◀ with nothing queued queues the previous scene', () => {});
test('Bank ▶ on the last scene does not wrap', () => {});
test('an empty scene cell keeps the zone playing', () => {});
test('the ceiling ignores scenes unless includeProtected is set', () => {});
test('room scene cuts, Amber fades 1 bar, ceiling dissolves 16 bars at 120 BPM', () => { /* durationMs 0, 2000, 32000 */ });
test('a clip with its own blend overrides every default', () => {});
test('Amber skips empty cells and wraps within the column', () => {});
test('Amber twice before the bar moves the queued clip on one step, with one change for that zone', () => {});
test('Solo + Amber returns to the previous clip', () => {});
test('a ceiling launch during a dissolve waits for it to end; pressing again changes what waits', () => {});
test('landed updates only the zones that landed; a deferred zone stays queued', () => {});
test('retime moves queued launches to the corrected bar and recalculates fade milliseconds', () => {});
test('armList holds the next scene without queueing, and never more than 8', () => {});
test('a follow rule fires after its bars; a manual launch restarts the timer', () => {});
test('follow random never picks the current scene', () => {});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx --test tests/perform-launcher.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

A scene launch replaces any queued change for the zones it touches. Fade milliseconds are `bars × 4 × 60000 / bpm`.

- [ ] **Step 4: Run to confirm it passes**

Run: `npx tsx --test tests/perform-launcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/perform/launcher.ts src/perform/sequence.ts tests/perform-launcher.test.ts
git commit -m "Add the Perform launcher and follow rules"
```

### Task 5: Control logic

**Files:**
- Create: `src/perform/controls.ts`
- Test: `tests/perform-controls.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ControlEvent =
    | { kind: 'knob'; strip: number; knob: 0 | 1 | 2; value: number } | { kind: 'fader'; strip: number; value: number } | { kind: 'master'; value: number }
    | { kind: 'amber' | 'red'; strip: number; down: boolean } | { kind: 'bankNext' | 'bankBack' | 'solo'; down: boolean }
    | { kind: 'sendAllStart' } | { kind: 'sendAllEnd' };
  export type PerformAction =
    | { type: 'next' | 'previous' | 'stop'; zone: number } | { type: 'burst'; zone: number; on: boolean }
    | { type: 'bankNext' | 'bankBack' | 'launchNow' | 'downbeat' | 'tap' | 'follow' };
  export interface ControlValues { faders: number[]; knobs: number[][]; master: number; ready: boolean; held: boolean[] }
  export const initialControls = (): ControlValues; // faders 0, knobs 0.5, master 0, ready false
  export function applyControl(v: ControlValues, e: ControlEvent, shift: boolean): { values: ControlValues; actions: PerformAction[]; shift: boolean };
  export function holdForReconnect(v: ControlValues): ControlValues;
  export function knobOffset(value: number): number; // −1..1, dead zone ±0.04 around centre
  export function speedFactor(offset: number, locked: boolean): number;
  ```

- [ ] **Step 1: Write the failing tests**

Assert every row of the spec's layout and shift table: Amber → `next`; shift + Amber → `previous`; shift + Red → `stop`; Red down/up → `burst`; Bank ▶ → `bankNext`; shift + Bank ▶ → `launchNow`; Bank ◀ → `bankBack`; shift + Bank ◀ → `downbeat`. Also:

```ts
test('nothing reaches the picture until Send All has finished', () => {});
test('after reconnect a fader takes over only when it crosses its held value', () => { /* held .6: .2 ignored, .7 accepted */ });
test('Send All after reconnect takes every value at once', () => {});
test('knob dead zone', () => { assert.equal(knobOffset(.5), 0); assert.equal(knobOffset(.53), 0); assert.equal(knobOffset(1), 1); });
test('free clips scale from a quarter to four times; locked clips snap to half, 1 and 2', () => {
  assert.equal(speedFactor(-1, false), .25); assert.equal(speedFactor(0, false), 1); assert.equal(speedFactor(1, false), 4);
  assert.equal(speedFactor(-.8, true), .5); assert.equal(speedFactor(.1, true), 1); assert.equal(speedFactor(.8, true), 2);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx --test tests/perform-controls.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `controls.ts`**

- [ ] **Step 4: Run to confirm it passes**

Run: `npx tsx --test tests/perform-controls.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/perform/controls.ts tests/perform-controls.test.ts
git commit -m "Add Perform control mapping"
```

---

## Stage 2: the working launcher

### Task 6: Wall rules and messages

**Files:**
- Create: `src/perform/wall-perform.ts`
- Modify: `src/map/messages.ts`, `electron/map.cjs` (`acceptMapMessage`, `acceptState`), `src/map/wall.ts`, `src/map/playout.ts`
- Test: `tests/perform-wall.test.ts`; extend `tests/map-messages.test.ts`, `tests/map-playout.test.ts`

**Interfaces:**
- Produces `MapMessage` types:
  ```ts
  | { type: 'performStart'; zones: ZonePicture[] } | { type: 'performEnd' }
  | { type: 'performArm'; sourceIds: string[] }
  | { type: 'performLaunch'; launch: WallLaunch } | { type: 'performCancel'; launchId: string }
  | { type: 'performValues'; values: PerformValues }
  ```
  ```ts
  export interface WallChange { zone: number; sourceId: string | null; shapeIds: string[]; blend: { kind: BlendKind; durationMs: number }; phaseOffsetBeats: number }
  export interface WallLaunch { id: string; atMs: number; barMs: number; changes: WallChange[] }
  export interface PerformValues { master: number; zones: { brightness: number; hueDeg: number; speed: number }[] }
  export interface WallPerform { active: boolean; zones: ZonePicture[]; armed: string[]; launches: WallLaunch[]; values: PerformValues | null; phaseOffsets: Record<string, number> }
  export const initialWallPerform = (): WallPerform;
  export function applyPerformMessage(p: WallPerform, m: MapMessage): WallPerform;
  export function stepWallPerform(p: WallPerform, nowMs: number, ready: (sourceId: string) => boolean): { perform: WallPerform; changed: boolean; landed: { launchId: string; zones: number[] }[]; blends: Map<string, { kind: BlendKind; durationMs: number }> };
  ```
- Produces in `playout.ts`: `blendAlphas(kind: BlendKind, t: number): { from: number; to: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('a launch waits for its time', () => {});
test('a ready source lands at its time, with its blend', () => {});
test('a source that is not ready defers only that zone by one bar', () => {});
test('a cancelled launch never lands', () => {});
test('an overdue launch lands now', () => {});
test('performEnd clears the overlay', () => {});
test('dip goes through black', () => { assert.deepEqual(blendAlphas('dip', .25), { from: .5, to: 0 }); assert.deepEqual(blendAlphas('dip', .75), { from: 0, to: .5 }); });
test('new message types are accepted in both copies of the check', () => {});
test('performValues with non-finite numbers is refused', () => {});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx --test tests/perform-wall.test.ts tests/map-playout.test.ts tests/map-messages.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the rules and both message checks**

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src electron tests
git commit -m "Add the wall's Perform rules and messages"
```

### Task 7: Compositor arming, blends and values

**Files:**
- Modify: `electron/main.cjs` (startup switch), `src/map/compositor.ts`, `src/map/gpu.ts`, `src/ui/MapOutput.tsx`
- Create: `scripts/verify-perform-contexts.mjs`

**Interfaces:**
- Consumes: `WallPerform`, `stepWallPerform`, `overlayShow`, `blendAlphas`.
- Produces in `MapCompositor`:
  ```ts
  setShow(show, projects, fade?: number | ReadonlyMap<string, { kind: BlendKind; durationMs: number }>): void;
  setArmed(ids: ReadonlySet<string>): void; isReady(id: string): boolean; armedIds(): string[];
  setPerformValues(v: { master: number; shapes: ReadonlyMap<string, { brightness: number; hueDeg: number }>; speed: ReadonlyMap<string, number>; phaseOffsets: ReadonlyMap<string, number> } | null): void;
  ```
- `ShapeDraw` in `gpu.ts` gains `hueDeg?: number`.

- [ ] **Step 1: Prove the context limit with a failing check**

`scripts/verify-perform-contexts.mjs` opens the built app's Map wall and creates 24 instrument sources plus the stage. It asserts that no context is lost over 60 seconds and the stage still draws.

Run: `npm run build && node scripts/verify-perform-contexts.mjs`
Expected: FAIL before the switch, with older contexts lost.

- [ ] **Step 2: Add `app.commandLine.appendSwitch('max-active-webgl-contexts', '32')` before app ready**

Run: `npm run build && node scripts/verify-perform-contexts.mjs`
Expected: PASS. If it fails, set the fallback budget from Global Constraints and record it in the task report.

- [ ] **Step 3: Implement arming**

Keep armed sources alive in `frame()`: prepare them, draw one frame at their largest zone size, then stop drawing until used. Keep video slots for armed videos. Enforce the budget order from Global Constraints.

- [ ] **Step 4: Implement per-shape blends**

- With no blend map, behaviour is unchanged.
- A protected zone's outgoing source keeps rendering through its dissolve. A room outgoing source keeps rendering when budget allows, otherwise it holds as a copy.
- A launch during a room blend first renders the current mix into a held texture and uses it as `from`.

- [ ] **Step 5: Implement performance values**

Add a hue rotation to the shape shader, skipped at 0. Apply brightness and hue per shape, and `master` as the final stage multiply before corners. For a synced source use `tempoPhase(signals, beats / speed)` plus its stored phase offset. Never replace the `Project` object for a performance value.

- [ ] **Step 6: Wire `MapOutput.tsx`**

Each animation frame: call `stepWallPerform` with `compositor.isReady`, call `setShow` with its blends when `changed`, and report `armed` and `landed` through `sendState` immediately when they change. On `performEnd`, return to the plain show without a flash.

- [ ] **Step 7: Run the checks**

Run: `npm test && npm run test:map && node scripts/verify-perform-contexts.mjs`
Expected: PASS, with no change to Map behaviour.

- [ ] **Step 8: Commit**

```bash
git add electron src scripts
git commit -m "Arm, launch and blend Perform clips on the wall"
```

### Task 8: App-level Perform service

**Files:**
- Create: `src/perform/service.ts`
- Modify: `src/ui/useMap.ts` (wall close guard, signals sender, triggers, auto-advance, `switchScene`), `src/ui/App.tsx` (`finishShapeEdit`)
- Test: `tests/perform-service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PerformView { running: boolean; clock: ClockSnapshot; launcher: LauncherState; controls: ControlValues; shift: boolean; audio: AudioStatus; midi: 'none' | 'connected' | 'lost'; armed: string[]; notices: string[] }
  export interface WallLink { send(m: MapMessage): void; isOpen(): boolean; sendWholeShow(): void }
  export interface ClockLink { snapshot(nowMs: number): ClockSnapshot; begin(): void; end(): void; tap(): void; follow(): void; setBarStart(): void; subscribe(fn: (signals: Signals) => void): () => void; }
  export class PerformService {
    constructor(deps: { wall: WallLink; clock: ClockLink; show: () => ShowDocument; now: () => number; id: () => string; random: () => number });
    startShow(): void; endShow(): void; control(e: ControlEvent): void; action(a: PerformAction): void;
    wallState(state: { armed?: string[]; landed?: { launchId: string; zones: number[] }[] }): void; wallReopened(): void; tick(): void;
    subscribe(fn: (v: PerformView) => void): () => void; view(): PerformView;
  }
  export function performService(): PerformService;
  ```

- [ ] **Step 1: Write the failing tests with a fake wall and clock**

```ts
test('startShow sends a black start; no launch until Bank ▶', () => {});
test('a press sends one exact-time launch to the wall', () => {});
test('correcting the 1 cancels and resends queued launches at the new bar', () => {});
test('landed reports update what is playing', () => {});
test('a follow rule launches by itself', () => {});
test('values reach the wall at most 30 times a second', () => {});
test('shared clips average their speed knobs, but keep separate brightness and colour', () => {});
test('wallReopened resends the show, zones, armed sources and values', () => {});
test('a deleted zone target does not throw during tick', () => {});
test('endShow restores the clock source and the Map show', () => {});
test('losing audio keeps the show running and reports it', () => {});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx --test tests/perform-service.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the service**

Subscribe to the engine for frames while running. While running, send the wall `tempo.*` and the show's used signals.

- [ ] **Step 4: Change `useMap` and `App`**

While `performService().view().running`: do not close the wall on unmount or section change, do not send `signals`, do not fire triggers or auto-advance, and refuse `switchScene` with a plain note. Expose `sendWholeShow` through the Map session so it works when Map is not mounted.

- [ ] **Step 5: Run all tests**

Run: `npm test && npm run test:map`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "Run Perform as an app-level service"
```

### Task 9: Perform screen and on-screen MIDImix

**Files:**
- Create: `src/ui/PerformPanel.tsx`, `src/ui/PerformGrid.tsx`, `src/ui/ControllerSurface.tsx`, `src/ui/perform.css`, `src/ui/usePerform.ts`, `scripts/verify-perform.mjs`
- Modify: `src/map/editor.ts` (`setPerformance` and `addClipSource` actions), `src/ui/App.tsx:164,342,439,516`, `package.json`

**Interfaces:**
- Consumes: `performService()`, `useMap`, `ControlEvent`.
- Produces `EditAction`s: `{ type: 'setPerformance'; performance: PerformanceSet }` (one undo step per edit), `{ type: 'addClipSource'; sourceId: string; project: Project }`. Produces `keyboardControl(event: KeyboardEvent): ControlEvent | null` in `usePerform.ts`.
- Keyboard: `1–8` Amber; `Q W E R T Y U I` Red (held); `[` Bank ◀; `]` Bank ▶; `Shift` Solo; `\` Send All; `Space` tap; `F` Follow.

- [ ] **Step 1: Add the section and a failing Electron check**

`npm run test:perform` runs `npm run build && node scripts/verify-perform.mjs`. Using the throwaway-profile pattern in `scripts/verify-map.mjs` and the existing `__studioTest.react.testBeat`, it builds a 3-zone show, opens the wall and asserts:
- black before Send All, and still black after it until Bank ▶
- Bank ▶ lands the first scene on the bar
- unassigned shapes are black on the wall
- Amber changes one zone only
- Master at 0 is black
- moving to Map and Studio and back leaves the wall open and playing
- closing and reopening the wall restores the picture
- ending the show returns Map's own picture, and its scene bar works again

Run: `npm run test:perform`
Expected: FAIL.

- [ ] **Step 2: Build the Perform screen to the spec's layout**

Status row, 8-column grid with Scenes column, and `ControllerSurface` as a clickable copy of the MIDImix. Show playing, queued, armed, loading and too-heavy states, linked zones, LOCKED/HOLDING/MANUAL, Follow, Tap, This is the 1, End show with confirmation, and `NEXT: <scene> in <n> beats`. Must be readable from a metre away in a dark room.

- [ ] **Step 3: Build grid editing**

Drag an instrument, video or Live look into a cell, assign zones from Map groups, and use a right-click menu: Link, Duplicate and edit, Blend, Timing, Audio band, Clear. A full source budget shows a plain message.

- [ ] **Step 4: Run the checks**

Run: `npm test && npm run test:perform && npm run test:map`
Expected: PASS.

- [ ] **Step 5: Screenshot the Perform screen at 1512 × 982 and review it**

Expected: nothing overlaps, and playing and queued states are distinct.

- [ ] **Step 6: Commit**

```bash
git add src scripts package.json tests
git commit -m "Add the Perform screen and on-screen controller"
```

### Task 10: Clip editing with Apply and Discard

**Files:**
- Modify: `src/ui/useMap.ts:beginStudioEdit,studioEdit,endStudioEdit`, `src/ui/App.tsx` (shape-edit bar), `src/ui/PerformGrid.tsx`, `scripts/verify-perform.mjs`
- Test: `tests/perform-draft.test.ts`

**Interfaces:**
- Produces in `useMap.ts`:
  ```ts
  export function beginClipEdit(sourceId: string, draft: boolean): { project: Project; shapeName: string } | null;
  export function applyClipDraft(): string | null;
  export function discardClipDraft(): void;
  ```

- [ ] **Step 1: Write the failing tests**

Assert: a clip-only source can be opened; a draft sends nothing to the wall while edited; Apply makes exactly one undo step and one wall source update; Discard leaves the show identical; outside a show, an edit streams live as a Map shape does. Add an Electron check that the wall's picture is unchanged during a draft and crossfades after Apply.

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx --test tests/perform-draft.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement, with Apply to show and Discard buttons in the edit bar**

- [ ] **Step 4: Run the checks**

Run: `npm test && npm run test:perform`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src scripts tests
git commit -m "Edit Perform clips as drafts during a show"
```

---

## Stages 4 and 5: reaction and the ceiling

These run before the hardware stage, because the on-screen controller can drive them.

### Task 11: Bursts and audio reaction

**Files:**
- Create: `src/perform/reaction.ts`
- Modify: `src/perform/service.ts`, `src/ui/PerformGrid.tsx`
- Test: `tests/perform-reaction.test.ts`

**Interfaces:**
- Consumes the existing signals `audio.bass`, `audio.mids`, `audio.highs`, `audio.level`, `beat.pulse`.
- Produces:
  ```ts
  export interface ReactionState { envelope: number; burst: number }
  export function bandSignal(signals: Signals, band: Clip['audioBand']): number;
  export function stepReaction(s: ReactionState, band: number, amount: number, held: boolean, pulse: number, seconds: number): ReactionState;
  export function zoneBrightness(fader: number, master: number, r: ReactionState): number;
  export function reactionSpeed(base: number, r: ReactionState): number;
  ```

- [ ] **Step 1: Write the failing tests**

Assert: fader 0 is black whatever the audio; Audio knob at 0 gives no reaction; attack is faster than release; a burst decays after release; audio loss eases to zero within 1 second; brightness is finite and at most 1.6.

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx --test tests/perform-reaction.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement and connect to the service**

- [ ] **Step 4: Run the checks**

Run: `npm test && npm run test:perform`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "Add Perform bursts and audio reaction"
```

### Task 12: Protected ceiling

**Files:**
- Modify: `src/perform/launcher.ts`, `src/perform/service.ts`, `src/perform/reaction.ts`, `src/ui/PerformGrid.tsx`
- Test: extend `tests/perform-launcher.test.ts`, `tests/perform-reaction.test.ts`

**Interfaces:**
- Produces: `ceilingBlend(): Blend` (dissolve, 16 bars), `breathValue(knob: number, seconds: number): number`, `bloomValue(s: ReactionState): number`.

- [ ] **Step 1: Write the failing tests**

Assert: a room scene leaves a running ceiling dissolve untouched; `includeProtected` changes it; a new ceiling clip placed in the grid leaves its source `Free`; Knob 1 on strip 8 is drift and Knob 3 is breath; Red 8 blooms slowly (rise of at least 2 seconds) and settles after release; a tempo change does not alter a running dissolve.

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx --test tests/perform-launcher.test.ts tests/perform-reaction.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the checks**

Run: `npm test && npm run test:perform`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "Protect the ceiling and add slow dissolves"
```

---

## Stage 6: readiness

### Task 13: Check Set and Import Map scenes

**Files:**
- Create: `src/perform/check-set.ts`, `src/perform/import-scenes.ts`
- Modify: `src/ui/PerformPanel.tsx`
- Test: `tests/perform-check-set.test.ts`

**Interfaces:**
- Produces: `checkSet(show: ShowDocument, stats?: { prepareMs?: Record<string, number>; midiInputs?: readonly string[] }): { level: 'error' | 'warning'; zone: number | null; message: string }[]`, `importMapScenes(show: ShowDocument, id: () => string): PerformanceSet`.

- [ ] **Step 1: Write the failing tests**

`checkSet` reports: a zone with no target; a zone with no clips; an unassigned visible shape; a scene needing more than 8 renderers; a clip with `prepareMs` above one bar; a ceiling clip using `texturecuts` or `glitchtunnel`; a ceiling shape with `softEdge` 0; a link or trigger using a control in `midiInputs`.

`importMapScenes` creates one row per Map scene from each zone's first shape, stops at 16 rows, and leaves Map's scenes deep-equal to before.

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx --test tests/perform-check-set.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement and add the Check Set and Import Map scenes buttons**

- [ ] **Step 4: Run the checks**

Run: `npm test && npm run test:perform`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "Add Check Set and Map scene import"
```

### Task 14: Rehearsal mode

**Files:**
- Modify: `src/react/audio.ts`, `src/react/engine.ts`, `src/ui/PerformPanel.tsx`, `scripts/verify-perform.mjs`
- Create: `scripts/make-perform-fixture.mjs`

**Interfaces:**
- Produces: `AudioInput.startFile(data: ArrayBuffer): Promise<void>`, `AudioInput.pauseFile(on: boolean): void`, `ReactivityEngine.rehearse(data: ArrayBuffer | null): Promise<void>`.

- [ ] **Step 1: Add a failing Electron check**

The fixture script writes a synthetic 128 BPM WAV to `work/perform/`. The check loads it through Rehearse and asserts the clock reads 128 ± 1 and LOCKED within 10 seconds, and that the audio path writes nothing to the user-data folder.

Run: `npm run test:perform`
Expected: FAIL.

- [ ] **Step 2: Add a Rehearse control**

It picks a local audio file, plays it to the speakers and feeds the same analyser. The file is held in memory only. Play, pause and stop are on-screen. Stopping restores the chosen device.

- [ ] **Step 3: Run the checks**

Run: `npm test && npm run test:perform`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src scripts
git commit -m "Add rehearsal from a recorded mix"
```

### Task 15: Measured soak

**Files:**
- Create: `scripts/verify-perform-soak.mjs`, `docs/perform-soak-2026-11-22.md`
- Modify: `package.json`

- [ ] **Step 1: Write the soak**

`npm run test:perform:soak` runs 30 minutes at 1920 × 1080 with eight zones and a scene change every 8 bars using the fixture audio. It records frame rate, launch error in frames, governor level, deferred launches, lost contexts, memory at start and end, and any error.

- [ ] **Step 2: Run it**

Run: `npm run test:perform:soak`
Expected: no errors, no lost contexts, median launch error at most 1 frame, memory stable. If not, fix the cause before continuing.

- [ ] **Step 3: Record the measured results, including any shortfall**

- [ ] **Step 4: Commit**

```bash
git add scripts docs package.json
git commit -m "Measure a 30-minute Perform soak"
```

---

## Stage 3: hardware, when the MIDImix arrives

**Do not start this stage until Greg has the unit connected.** Tasks 1–15 do not depend on it.

### Task 16: MIDImix test page, input and lights

**Files:**
- Create: `src/perform/midimix.ts`, `src/ui/MidiTest.tsx`
- Modify: `src/react/midi.ts`, `src/perform/service.ts`, `src/ui/PerformPanel.tsx`
- Test: `tests/perform-midimix.test.ts`

**Interfaces:**
- Produces in `MidiInput`: `listen(fn: (data: Uint8Array) => void): () => void`, `send(deviceMatch: RegExp, messages: number[][]): void`.
- Produces in `midimix.ts`:
  ```ts
  export interface MidimixMap { knobs: number[][]; faders: number[]; master: number; amber: number[]; red: number[]; solo: number; bankBack: number; bankNext: number; channel: number }
  export function translateMidi(map: MidimixMap, data: Uint8Array): ControlEvent | null;
  export function lightMessages(map: MidimixMap, view: PerformView, beatPhase: number): number[][];
  ```

- [ ] **Step 1: Build `MidiTest`, then capture the real device with Greg**

Greg moves each control once. Record every message and test how each light responds, including Solo and Send All. Save the confirmed `MidimixMap` as a constant.

Expected: every control is identified. **If Solo cannot act as a shift, stop and agree a new shift control with Greg.** Choose the hardware combination for Tap and Follow here.

- [ ] **Step 2: Write failing tests using the captured messages**

Assert: each captured message becomes the right `ControlEvent`; unknown messages return null; light output matches the spec's light table; unchanged lights send no message; a burst of Send All messages followed by 100 ms of quiet produces `sendAllEnd`.

- [ ] **Step 3: Run to confirm failure**

Run: `npx tsx --test tests/perform-midimix.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

On device removal, call `holdForReconnect`, report `lost`, keep the picture running, and resume on reconnect.

- [ ] **Step 5: Run the checks**

Run: `npm test && npm run test:perform`
Expected: PASS.

- [ ] **Step 6: Perform with Greg**

Play the spec's Examples 2, 3, 4 and 5 on the MIDImix. Unplug and replug it mid-transition.

Expected: a full transition without touching the laptop, and the picture never stops.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "Connect the Akai MIDImix"
```

### Task 17: Room session sign-off

**Files:**
- Create: `docs/perform-room-session.md`

- [ ] **Step 1: Run a session with Greg on the real rig**

Use the decks through the USB interface, the MIDImix, the projector, real objects and real tulle.

Check: the projector reaches objects and ceiling; tulle is not in the beam to the objects; the ceiling reads as floating; no moiré from chosen looks; beat lock on a real DJ mix, including a transition and a breakdown.

- [ ] **Step 2: Write down what passed, what failed and what to change**

- [ ] **Step 3: Commit**

```bash
git add docs/perform-room-session.md
git commit -m "Record the Perform room session"
```
