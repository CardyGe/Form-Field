# Meridian Phrase Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Meridian, a seeded phrase machine playable as a Studio/Map instrument and as a movement-reactive Live look.

**Architecture:** A pure core in `src/meridian/` composes a `Score` and evaluates it to a fixed-capacity `DisplayList`. One `MeridianRenderer` draws that list for both front ends. Time, performance moves, flash limiting and people tracking are separate testable units that never touch WebGL.

**Tech Stack:** TypeScript 7, React 19, Electron 45, three 0.187 (WebGL2), `node:test` through `tsx`, Playwright verify scripts.

**Spec:** `docs/superpowers/specs/2026-11-22-meridian-phrase-machine-design.md`

## Global Constraints

- Branch `meridian` from `main` at `3e411fe` or later, in a worktree at `../three VJ - Meridian`. This checkout is behind `main`.
- Do not change `src/react/`. Read its signals only.
- `src/meridian/` imports no `three`, DOM or React.
- No per-frame allocation in `evaluate`, `FlashGuard.apply` or `MeridianRenderer.draw`.
- Display list capacity: 20,000 instances. Minimum line width default: 1.5 output px.
- Camera image is never displayed, saved or sent by Meridian. Bodies exist only in memory.
- Flash Guard on by default: at most 3 large bright flashes per second, stricter for saturated red.
- No preset, starter or copy of the reference clip, its timing or its logo. No preset combining Meridian with other instruments.
- Older projects and Live settings must open unchanged.
- User-facing copy is plain language. Every parameter has a `description`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run `npm test` and `npm run build` before each commit that touches existing files.

## Party schedule

The first real-room test is a party around **6 December 2026**.

| Finish by | Tasks | Result |
|---|---|---|
| 26 Nov | 1–5 | Playable Studio instrument |
| 28 Nov | 6–8 | Full control surface, presets, exact export |
| 30 Nov | 9–11 | Lands on music, safe, runs in Map |
| 3 Dec | 12–15 | Live interaction with people |
| 4 Dec | 16–17 | Recovery, installation mode, overnight soak |
| 5 Dec | 18 | Rehearsal in the room or closest equivalent |

**If time runs short, cut in this order:** A/B morph, the Mark, Merge, Lattice wake, Installation resume. **Never cut:** Flash Guard, Conductor hold, recovery, camera-loss fallback, Blackout.

## Review Focus

1. **Party lighting:** strobes or moving lights change the whole camera image. They must not create bodies or trigger a Drop (Task 12 test).
2. **Beat tracker halves or doubles** (140 to 70 BPM, or a false onset). The phrase must not lurch or change speed abruptly (Task 9 test).
3. **Structural change during a Peak** from a knob or MIDI. The Score must not rebuild until the next phrase (Task 9 test).
4. **Export with Flash Guard.** The same frame must render identically whatever was rendered before it (Task 10 test).
5. **Extreme or old values:** maximum density, zero elements, symmetry 1, missing fields. Must not crash or overflow capacity (Task 3 and Task 4 tests).

---

## Stage 1: engine and instrument

### Task 1: Core types and rhythm

**Files:**
- Create: `src/meridian/types.ts`, `src/meridian/random.ts`, `src/meridian/rhythm.ts`
- Test: `tests/meridian-rhythm.test.ts`

**Interfaces:**
- Produces:

```ts
export const PHRASE_STATES = ['seed','draw','build','charge','peak','collapse','rest'] as const;
export type PhraseState = typeof PHRASE_STATES[number];
export type ElementGroup = 'ring'|'arc'|'tick'|'spoke'|'node'|'hub'|'hero';
export interface ScoreElement { group: ElementGroup; zone: number; radius: number; angle: number; length: number; weight: number; colour: number; enter: number; exit: number; slot: number }
export interface Score { seed: number; symmetry: number; bars: number; stateEnds: readonly number[]; elements: readonly ScoreElement[]; rhythm: Readonly<Record<'ring'|'spoke'|'node', readonly boolean[]>>; quality: number }
export interface PerformanceState { hold: boolean; tension: number; burst: number; forcedState: PhraseState | null }
export const PRIMITIVE = { ring: 0, arc: 1, segment: 2, square: 3, dot: 4 } as const;
export function createRandom(seed: number): () => number; // mulberry32, output in [0,1)
export function euclid(hits: number, steps: number, rotation?: number): boolean[];
export function subdivisionAt(progress: number, from: number, to: number): number; // power-of-two steps, never decreasing
```

- [ ] **Step 1: Write the failing tests**

```ts
test('euclid spreads hits evenly', () => {
  assert.deepEqual(euclid(3, 8).map(Number), [1,0,0,1,0,0,1,0]);
  assert.equal(euclid(5, 16).filter(Boolean).length, 5);
  assert.deepEqual(euclid(0, 4), [false,false,false,false]);
  assert.equal(euclid(9, 4).filter(Boolean).length, 4);
});
test('rotation moves the pattern', () => assert.deepEqual(euclid(1, 4, 1).map(Number), [0,1,0,0]));
test('random is reproducible', () => { const a=createRandom(7), b=createRandom(7); for(let i=0;i<100;i++) assert.equal(a(), b()); });
test('subdivisions tighten', () => { assert.equal(subdivisionAt(0,1,8),1); assert.equal(subdivisionAt(1,1,8),8); assert.ok([1,2,4,8].includes(subdivisionAt(.5,1,8))); });
```

- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-rhythm.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement the three files.** `euclid` uses Bjorklund's method, clamps hits to `0..steps`, and starts on a hit before rotation.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `Add Meridian types and rhythm`.

### Task 2: Composer

**Files:**
- Create: `src/meridian/composer.ts`
- Test: `tests/meridian-composer.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `createRandom`, `euclid`.
- Produces:

```ts
export type ComposeParams = Readonly<Record<string, number>>;
export function compose(seed: number, params: ComposeParams): Score;      // best of 8 candidates
export function scoreQuality(score: Score): { value: number; hardFailures: string[] };
```

Hard failures: more than 3 distinct line weights excluding hero, two ring radii within 1.5% of frame height, two spokes within 1.5 degrees unless twins, no hero, `stateEnds` not rising to exactly 1.

- [ ] **Step 1: Write the failing tests**

```ts
test('same seed and settings give the same score', () => assert.deepEqual(compose(42, DEFAULTS), compose(42, DEFAULTS)));
test('1,000 seeds pass every hard limit', () => { for(let s=0;s<1000;s++) assert.deepEqual(scoreQuality(compose(s, DEFAULTS)).hardFailures, [], `seed ${s}`); });
test('seeds differ', () => assert.ok(new Set(Array.from({length:200},(_, s)=>JSON.stringify(compose(s,DEFAULTS).elements.slice(0,8)))).size > 190));
test('the best candidate is kept', () => assert.ok(compose(9, DEFAULTS).quality >= scoreQuality(compose(9, DEFAULTS)).value - 1e-9));
test('symmetry is honoured', () => assert.equal(compose(3, {...DEFAULTS, symmetry: 6}).symmetry, 6));
```

`DEFAULTS` is a local constant here and imports from `parameters.ts` after Task 4.

- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-composer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the spec's grammar in order: symmetry, zones, element assignment, phrase roles, rhythm, colour accents. Radii come from a ratio set. Candidates use `seed`, `seed+1…seed+7` through separate generators.
- [ ] **Step 4: Run the test.** Expected: PASS in under 10 seconds.
- [ ] **Step 5: View a contact sheet** of 24 seeds using a temporary SVG script in the scratchpad. Reject if it reads as random, then tune the weights.
- [ ] **Step 6: Commit** `Add Meridian composer`.

### Task 3: Evaluator and display list

**Files:**
- Create: `src/meridian/display-list.ts`, `src/meridian/evaluate.ts`
- Test: `tests/meridian-evaluate.test.ts`

**Interfaces:**
- Produces:

```ts
export const STRIDE = 12; // kind,x,y,p0,p1,p2,width,glow,colour,alpha,tear,seed
export class DisplayList { readonly data: Float32Array; count: number; dropped: number; constructor(capacity?: number); clear(): void; push(kind: number, x: number, y: number, p0: number, p1: number, p2: number, width: number, glow: number, colour: number, alpha: number, tear: number, seed: number): void }
export interface PhrasePosition { progress: number; state: PhraseState; stateProgress: number; beat: number }
export function positionAt(score: Score, beatsInPhrase: number, beatsPerBar?: number): PhrasePosition;
export function evaluate(score: Score, position: PhrasePosition, perf: PerformanceState, params: Readonly<Record<string, number>>, out: DisplayList): void;
```

- [ ] **Step 1: Write the failing tests**

```ts
test('evaluation is a pure function of its inputs', ...);          // two lists have identical data
test('rest is almost empty and peak is full', ...);                // rest.count <= 3; peak.count > build.count * .8
test('collapse ends at one point', ...);                           // final positions all within .01 of centre
test('the last frame of one phrase meets the next seed', ...);     // the point position and size match within .005
test('hold stays in charge', ...);                                 // forcedState 'charge' at progress .95 gives state charge
test('capacity is never exceeded', ...);                           // maximum params: count <= 20000, dropped reported, no throw
test('an empty score draws nothing and does not throw', ...);
test('no value in the list is NaN at extreme params', ...);
```

- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-evaluate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** When capacity runs out, drop nodes first, then ticks. Rings, spokes and hero are preserved.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `Add Meridian evaluator`.

### Task 4: Parameters and layer registration

**Files:**
- Create: `src/meridian/parameters.ts`, `src/meridian/macros.ts`
- Modify: `src/shared/types.ts`, `src/core/project.ts`, `electron/export-manager.cjs:58`, `src/rendering/bloom.ts:24`, `src/map/targets.ts`
- Test: `tests/meridian-parameters.test.ts`; add `'meridian'` to the kind lists in `tests/canvas-interaction.test.ts`, `tests/quality.test.ts`, `tests/instruments.test.ts`

**Interfaces:**
- Produces:

```ts
// shared/types.ts
export type LayerKind = /* existing */ | 'meridian';
export interface ParameterDefinition { /* existing */ group?: string; structural?: boolean; momentary?: boolean }
export interface MeridianLayerState { locks: string[]; morphA?: Record<string, number>; morphB?: Record<string, number>; mark?: { dataUrl: string; width: number; height: number } }
export interface Layer { /* existing */ meridian?: MeridianLayerState }
// parameters.ts
export const MERIDIAN_GROUPS: readonly string[]; // Score, Structure, Rings, Spokes, Nodes, Hero, Rhythm, Glitch, Light, Colour, Output, Safety, Reaction
export const MERIDIAN_PARAMETERS: ParameterDefinition[];
export const MERIDIAN_MOVES = ['moveNext','moveHold','moveDrop','moveCollapse','moveMutate','moveReseed','moveBurst'] as const;
export const MACRO_KEYS = ['macroDensity','macroTension','macroOrder','macroSpeed','macroWeight','macroGlitch','macroHeat','macroScale'] as const;
// macros.ts
export function applyMacros(params: Readonly<Record<string, number>>, out: Record<string, number>): void;
```

Keys are camelCase with the group as prefix (`ringCount`, `spokeTwinShare`, `glitchBlockSize`) and cover every parameter named in the spec's table. Also add `moveRecall` (0 = none, 1–8) and `seedSlot0`–`seedSlot7` (integers, 0–999999). Structural keys: `symmetry`, `zones`, `ringCount`, `spokeCount`, `nodeDensity`, `latticeType`, and the Score length and proportions.

- [ ] **Step 1: Write the failing tests**

```ts
test('every group has parameters and all have descriptions', ...);
test('there are more than 100 parameters', () => assert.ok(MERIDIAN_PARAMETERS.length > 100));
test('keys are unique and defaults are in range', ...);
test('a new layer validates', () => assert.equal(validateProject({...createProject(), layers:[createLayer('meridian')]}).layers[0].kind, 'meridian'));
test('a project with missing or absurd Meridian values is repaired', ...);
test('malformed layer.meridian state is removed, valid state kept', ...);
test('older projects are unchanged', ...);                  // deep equal for one fixture per older kind
test('macros at neutral leave parameters unchanged', ...);
test('macros stay inside each range at both extremes', ...);
test('every continuous parameter and move can be linked', ...);
```

- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-parameters.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement and register** the kind in `DEFINITIONS`, `ADDED_FIELDS`, `createLayer`, the kind list at `project.ts:889`, validation and the export allowlist. `supportsGlow` returns false because Meridian has its own bloom. Seed slots and `seed` are not link targets.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `Register Meridian parameters and layer`.

### Task 5: Renderer and Studio card

**Files:**
- Create: `src/rendering/MeridianRenderer.ts`, `src/rendering/meridian-shaders.ts`, `scripts/verify-meridian.mjs`, thumbnail in the same location as `scopeThumb`
- Modify: `src/rendering/StudioRenderer.ts` (dispatch near line 659, dispose), `src/ui/App.tsx` (instrument card near line 291, caption near line 127)

**Interfaces:**
- Consumes: `compose`, `evaluate`, `DisplayList`, `applyMacros`, `BloomPyramid`, `lightTarget`.
- Produces:

```ts
export class MeridianRenderer {
  draw(renderer: THREE.WebGLRenderer, layer: Layer, phase: number, width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw, runtime?: MeridianRuntime): void;
  drawList(renderer: THREE.WebGLRenderer, list: DisplayList, params: Readonly<Record<string, number>>, palette: readonly string[], width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw): void;
  dispose(): void;
}
export interface MeridianRuntime { list?: DisplayList; signals?: Readonly<Record<string, number>>; dt?: number }
```

Without a runtime, position comes from `phase` (Loop time): the loop holds `scoreRepeat` whole phrases. Cache `Score` by seed plus structural values.

- [ ] **Step 1: Write `scripts/verify-meridian.mjs`** in the style of `scripts/verify-scope.mjs`. It renders seeds 1–6 at Seed, Build, Peak and Rest, and asserts: Rest mean luma < 0.02, Peak mean luma > 2× Build, no NaN pixels, no console errors. It saves PNGs under `work/meridian/`.
- [ ] **Step 2: Run:** `npm run build && node scripts/verify-meridian.mjs`. Expected: FAIL, no Meridian card or kind drawing.
- [ ] **Step 3: Implement** the instanced primitive, additive half-float light, bloom and resolve from the spec. `width = max(param, minLineWidth)` in output pixels. Coverage uses analytic distance with `fwidth`.
- [ ] **Step 4: Add a line-width check** to the script: a 1.5 px ring measures within ±0.5 px of its width at both 1080p and 4K.
- [ ] **Step 5: Run** the script. Expected: PASS. View the PNGs and tune until they look designed.
- [ ] **Step 6: Commit** `Draw Meridian in Studio`.

---

## Stage 2: control surface

### Task 6: Tear and exact export

**Files:**
- Modify: `src/rendering/MeridianRenderer.ts`, `src/rendering/meridian-shaders.ts`, `scripts/verify-meridian.mjs`

- [ ] **Step 1: Add failing checks:** Peak with Glitch at 1 differs from Glitch at 0 in over 10% of pixels; Rest does not differ; rendering frame 37 twice, with other frames between, is byte-identical; frame N of a loop equals frame 0 at N = total.
- [ ] **Step 2: Run** the script. Expected: FAIL on the first check.
- [ ] **Step 3: Implement** the tear pass (blocks, slip, RGB split, scan bands, posterise), seeded only by the Score and the position. Skip the pass entirely at zero.
- [ ] **Step 4: Run** the script. Expected: PASS. Export a 4K 4-second clip through the app and play it through a loop.
- [ ] **Step 5: Commit** `Add Meridian tear pass and exact export`.

### Task 7: Macros, moves and grouped panel

**Files:**
- Create: `src/ui/MeridianControls.tsx`, `src/ui/meridian.css`, `src/meridian/panel.ts`
- Modify: `src/ui/App.tsx` (render controls when `selected.kind === 'meridian'`)
- Test: `tests/meridian-panel.test.ts`; extend `scripts/verify-meridian.mjs`

**Interfaces:**
- Produces:

```ts
export function filterParameters(definitions: readonly ParameterDefinition[], query: string): Map<string, ParameterDefinition[]>;
export function applyLockedVariation(layer: Layer, seed: number, mode: 'mutate'|'reseed'): Layer;
export function storeSeed(layer: Layer, slot: number): Layer;
export function recallSeed(layer: Layer, slot: number): Layer;
export function morph(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>, amount: number, definitions: readonly ParameterDefinition[]): Record<string, number>;
```

- [ ] **Step 1: Write failing tests:** search matches label, group and description; locked groups survive Mutate and Reseed; an empty slot does not change the layer; morph ends equal A and B, stepped parameters switch at the midpoint, and results stay in range.
- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-panel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Macros and moves sit at the top. Groups collapse. Each group has a lock. A queued structural value shows `Next phrase`. Keyboard: `N` Next, `H` hold, `D` Drop, `C` Collapse, `M` Mutate, `R` Reseed, `1`–`8` Recall, ignored while typing (use `isTypingTarget`).
- [ ] **Step 4: Extend the UI check:** all groups render, search works, a macro changes the picture, keys fire, layout has no horizontal overflow at the app's minimum window width.
- [ ] **Step 5: Run** the tests and script. Expected: PASS.
- [ ] **Step 6: Commit** `Add Meridian control surface`.

### Task 8: Curated library and Mark

**Files:**
- Modify: `src/core/project.ts` (`PRESETS`), `src/meridian/evaluate.ts`, `src/rendering/MeridianRenderer.ts`, `src/ui/MeridianControls.tsx`
- Test: extend `tests/meridian-parameters.test.ts`

- [ ] **Step 1: Write failing tests:** at least 10 Meridian presets; each validates; none has `name` matching `/microlog/i`; Mark off by default; a PNG over the existing image limit is refused.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Author presets** across contrast: sparse, dense, mono, hot, fast, slow, ceiling-friendly. Implement the Mark reveal at Collapse end using a PNG the user imports.
- [ ] **Step 4: Render a contact sheet** of all presets at Peak and at Build, and replace any that are not strong.
- [ ] **Step 5: Run** `npm test && npm run build`. Expected: PASS.
- [ ] **Step 6: Commit** `Add Meridian presets and Mark`.

---

## Stage 3: music, safety and Map

### Task 9: Conductor

**Files:**
- Create: `src/meridian/conductor.ts`
- Modify: `src/rendering/MeridianRenderer.ts`
- Test: `tests/meridian-conductor.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ConductorInput { dt: number; signals: Readonly<Record<string, number>>; params: Readonly<Record<string, number>>; score: Score }
export interface ConductorFrame { beats: number; bpm: number; status: 'locked'|'holding'; position: PhrasePosition; perf: PerformanceState; phraseIndex: number; composeSeed: number; composeParams: Readonly<Record<string, number>>; queued: boolean }
export class Conductor { update(input: ConductorInput): ConductorFrame; reset(beats?: number): void; snapshot(): ConductorSnapshot; restore(s: ConductorSnapshot): void }
```

Behaviour:
- Small phase errors are slewed at no more than 8% speed change.
- A disagreement in tempo or phase is accepted only after it persists for two beats.
- BPM that is half or double the current tempo folds back to the current tempo.
- With missing signals, it runs on at the last good BPM and reports `holding`.
- A move pressed within 80 ms after a beat counts for that beat.
- Structural values and new seeds are captured only at a phrase boundary.

- [ ] **Step 1: Write failing tests**

```ts
test('follows a steady 128 BPM within 10 ms over 5 minutes', ...);
test('one false onset does not move the phrase', ...);
test('a tempo halving does not change speed', ...);
test('a real tempo change is accepted after two beats', ...);
test('signals vanish: keeps time and reports holding, then re-locks', ...);
test('Drop lands on the next quantise point', ...);
test('a press 50 ms late counts for the beat just gone', ...);
test('Hold keeps charge until released', ...);
test('a structural change during Peak waits for the next phrase', ...);
test('moves fire once per press', ...);
test('NaN or negative dt is ignored', ...);
```

- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-conductor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and use it in `MeridianRenderer.draw` when `runtime.signals` is present. Loop time and export never use it.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `Add Meridian conductor`.

### Task 10: Flash Guard

**Files:**
- Create: `src/meridian/flash-guard.ts`
- Modify: `src/rendering/MeridianRenderer.ts`, `src/ui/MeridianControls.tsx`
- Test: `tests/meridian-flash-guard.test.ts`

**Interfaces:**
- Produces:

```ts
export interface GuardSettings { enabled: boolean; maxFlashes: number; redLimit: number; fullFieldLimit: number }
export function estimateFrame(list: DisplayList, palette: readonly string[]): { litArea: number; luminance: number; redArea: number };
export class FlashGuard { apply(frame: ReturnType<typeof estimateFrame>, dt: number, settings: GuardSettings): { gain: number; limited: boolean }; reset(): void }
export function guardLoopTable(sample: (frame: number) => ReturnType<typeof estimateFrame>, frames: number, fps: number, settings: GuardSettings): Float32Array;
```

A flash is a pair of opposing luminance changes over more than 25% of the frame. Export and Loop time use `guardLoopTable`, evaluated across the loop boundary, so a frame does not depend on render order.

- [ ] **Step 1: Write failing tests**

```ts
test('a 5 Hz full-field strobe is limited to at most 3 flashes in every 1 s window', ...);
test('a 2 Hz full-field pulse is not changed', ...);
test('small-area flashes are not limited', ...);
test('saturated red is limited sooner than white', ...);
test('the limit holds across the loop boundary', ...);
test('the table gives the same gain whatever order frames are read', ...);
test('disabled leaves gain at 1', ...);
```

- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-flash-guard.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Apply the gain to fills, bloom and hero, leaving lines visible so rhythm survives. Turning the guard off needs a confirm dialog and shows a persistent warning.
- [ ] **Step 4: Add a verify check:** measure actual rendered luma over a 10-second Peak-heavy preset at 60 fps, and assert the rendered flash count stays within the limit.
- [ ] **Step 5: Run** the tests and script. Expected: PASS.
- [ ] **Step 6: Commit** `Add Meridian Flash Guard`.

### Task 11: Map and wall

**Files:**
- Modify: `src/map/compositor.ts`, `src/rendering/StudioRenderer.ts`, `src/map/playout.ts` if needed
- Test: `tests/meridian-map.test.ts`, extend `scripts/verify-map.mjs`

**Interfaces:**
- Consumes: `MeridianRuntime`, `Conductor`.
- Produces: `StudioRenderer.setPerformanceSignals(signals: Readonly<Record<string, number>>, dt: number): void`, called by the compositor once per drawn frame for sources containing a Meridian layer.

- [ ] **Step 1: Write failing tests:** a link to `source.x.param.0.moveDrop` validates; a link to `seed` is refused; continuous link changes do not trigger composition preparation; two shapes sharing a source show the same phrase.
- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-map.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pass signals during draw and keep them out of composition identity. Freeze holds the Conductor.
- [ ] **Step 4: Extend `verify-map.mjs`** using the existing `__studioTest.react.testBeat(true)` and MIDI bytes: Meridian plays on the wall, a MIDI note fires Drop, Blackout works.
- [ ] **Step 5: Run** `npm test && npm run test:map`. Expected: PASS.
- [ ] **Step 6: Commit** `Play Meridian in Map with sound and MIDI`.

---

## Stage 4: Meridian Live

### Task 12: Body tracking

**Files:**
- Create: `src/meridian/bodies.ts`
- Test: `tests/meridian-bodies.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Body { id: number; x: number; y: number; vx: number; vy: number; size: number; energy: number; stillness: number; age: number }
export interface BodySettings { maxBodies: number; followSpeed: number; minSize: number }
export class BodyTracker { update(grid: Uint8Array, width: number, height: number, dt: number, settings: BodySettings): readonly Body[]; reset(): void; readonly lightingEvent: boolean }
```

`grid` is RG per cell: person likelihood, movement. Use connected components, then nearest-neighbour matching with velocity prediction. A body survives 0.75 seconds without a match.

- [ ] **Step 1: Write failing tests**

```ts
test('finds two separate people', ...);
test('ids stay stable as people walk', ...);
test('two people crossing keep their ids', ...);
test('a person briefly lost keeps their id', ...);
test('noise specks make no bodies', ...);
test('never exceeds maxBodies, keeping the largest', ...);
test('a whole-frame lighting change or strobe creates no body or energy', ...); // over 60% of cells change in a frame
test('stillness rises when still and resets on movement', ...);
test('a person at the frame edge does not throw', ...);
```

- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-bodies.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with reused arrays.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `Add Meridian body tracking`.

### Task 13: Interaction engine

**Files:**
- Create: `src/meridian/interactions.ts`
- Test: `tests/meridian-interactions.test.ts`

**Interfaces:**
- Consumes: `Body`, `DisplayList`, `Conductor` frame.
- Produces:

```ts
export interface InteractionFrame { attract: number; crowdEnergy: number; requestDrop: boolean; links: number; merges: number; releases: number }
export class Interactions { update(bodies: readonly Body[], score: Score, frame: ConductorFrame, params: Readonly<Record<string, number>>, dt: number, out: DisplayList): InteractionFrame; reset(): void }
```

Parameters prefixed `live`: `liveOrbit`, `liveConstellation`, `liveMerge`, `liveThrow`, `liveCharge`, `liveLattice`, `liveCrowd` (mode mix), `liveMaxBodies`, `liveFollow`, `liveBodyScale`, `liveLinkDistance`, `liveMergeDistance`, `liveThrowSensitivity`, `liveChargeSeconds`, `liveReleaseStrength`, `liveCrowdThreshold`, `liveSilhouette`, `liveWake`, `liveAttract`, `liveBeatSnap`.

- [ ] **Step 1: Write failing tests**, one per spec interaction:

```ts
test('Orbit: a body gets a ring system at its position', ...);
test('Constellation: two near bodies are linked, far bodies are not', ...);
test('Merge: close bodies fuse, with hysteresis so it does not flicker', ...);
test('Throw: fast motion emits spokes along its direction', ...);
test('Charge and Release: stillness fills, sudden movement releases once', ...);
test('Conduct: shared energy requests one Drop, then waits for a cooldown', ...);
test('Lattice: nodes inside a body light up and leave a fading wake', ...);
test('Attract: fades in after the room empties and out when someone enters', ...);
test('Beat snap 1 delays large consequences to the next beat; Throw stays immediate', ...);
test('eight bodies stay within capacity', ...);
```

- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-interactions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Prefer readable cause and effect over subtlety.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `Add Meridian interactions`.

### Task 14: Live look

**Files:**
- Create: `src/live/Meridian.ts`, `src/live/meridian-presence.ts`
- Modify: `src/live/LiveRenderer.ts:24`, `src/live/settings.ts`, `src/live/modulate.ts`, `src/live/Stage.ts:72`, `scripts/verify-live.mjs`
- Test: extend `tests/live.test.ts`

**Interfaces:**
- Consumes: `Look`, `TrackingFeed`, `MeridianRenderer.drawList`, `BodyTracker`, `Interactions`, `Conductor`.
- Produces:

```ts
export class Meridian implements Look { constructor(passes: Passes, width: number, height: number); step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void; readonly output: THREE.Texture; resize(w: number, h: number): void; clear(): void; dispose(): void; diagnostics(): { bodies: number; attract: number; readbackMs: number } }
export class PresenceGrid { update(renderer: THREE.WebGLRenderer, feed: TrackingFeed): Uint8Array | null; dispose(): void } // 64×36, renderer.readRenderTargetPixelsAsync, one read in flight
```

`LiveSettings` gains `meridian: Record<MeridianLiveKey, number> & { palette: string[]; seed: number; preset: string | null }`. `LOOK_LABELS` gains `meridian: 'Meridian'`. Link targets are `live.meridian.<key>`.

`LiveRenderer` passes `signals` to the look by assigning `look.signals` when the look has that property. `usesPeople` in `settings.ts` returns true for Meridian. `personStillTimeout` returns `null` for Meridian, because the "ignore still objects" filter would otherwise erase a person standing still and break Charge.

- [ ] **Step 1: Write failing tests:** old settings without `meridian` validate with defaults; bad values repair; `live.meridian.liveChargeSeconds` is a valid link target; the look is selectable; `usesPeople` is true and `personStillTimeout` is `null` for Meridian even when `people.ignoreStillSeconds` is 10.
- [ ] **Step 2: Run:** `npx tsx --test tests/live.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The output contains only Meridian primitives. No shader in this look samples `feed.camera`.
- [ ] **Step 4: Add to `verify-live.mjs`:** with the test source, bodies appear, lines respond, and 120 seconds hold 60 fps. A source check asserts `src/live/Meridian.ts` and `src/live/meridian-presence.ts` do not contain `feed.camera`.
- [ ] **Step 5: Run** `npm test && npm run test:live`. Expected: PASS.
- [ ] **Step 6: Commit** `Add Meridian Live look`.

### Task 15: Live controls and fallback

**Files:**
- Modify: `src/ui/LiveLookControls.tsx`, `src/ui/LivePanel.tsx`, `src/live/Meridian.ts`, `scripts/verify-live-ui.mjs`
- Test: extend `tests/live.test.ts`

- [ ] **Step 1: Write failing tests:** camera lost leads to Attract within 2 seconds; people-model failure leads to movement-only bodies; camera return resumes without a jump; `Load from Studio preset` copies only Meridian's values.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the Live panel: interaction mix, the spec's Live controls, shared macros, Moves, a bodies readout, status text `Camera lost · attract`.
- [ ] **Step 4: Run** `npm test && npm run test:live`. Expected: PASS.
- [ ] **Step 5: Commit** `Add Meridian Live controls and fallbacks`.

---

## Stage 5: show hardening

### Task 16: Recovery and quality governor

**Files:**
- Create: `src/meridian/governor.ts`
- Modify: `src/rendering/MeridianRenderer.ts`, `src/live/Meridian.ts`
- Test: `tests/meridian-governor.test.ts`, extend `scripts/verify-meridian.mjs`

**Interfaces:**
- Produces: `class MeridianGovernor { update(frameMs: number): { bloomLevels: number; tear: boolean; instanceScale: number; reduced: boolean } }`

- [ ] **Step 1: Write failing tests:** sustained frames over 20 ms reduce bloom first, then tear, then instances; line width is never in the output; recovery needs 5 calm seconds; one slow frame changes nothing.
- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-governor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the governor for live use only. Export ignores it.
- [ ] **Step 4: Add a verify check** with `WEBGL_lose_context`, in Studio and in Live: the picture returns within 3 seconds at the same phrase, and no permanent black.
- [ ] **Step 5: Run** the tests and script. Expected: PASS.
- [ ] **Step 6: Commit** `Add Meridian recovery and governor`.

### Task 17: Installation mode and soak tool

**Files:**
- Create: `src/meridian/autopilot.ts`, `electron/installation.cjs`, `electron/installation.test.cjs`, `scripts/soak-meridian.mjs`
- Modify: `electron/main.cjs`, `src/ui/MeridianControls.tsx`, `src/ui/LivePanel.tsx`
- Test: `tests/meridian-autopilot.test.ts`

**Interfaces:**
- Produces: `class Autopilot { next(frame: ConductorFrame, params: Readonly<Record<string, number>>): { seed: number; moves: string[] } }`; IPC `installation:get`, `installation:set`, `installation:log`.

- [ ] **Step 1: Write failing tests:** autopilot is reproducible, varies phrases and never repeats a seed within 32 phrases; settings validate; the log keeps at most 5 MB, rejects image or audio payloads and stores fault strings only.
- [ ] **Step 2: Run:** `npx tsx --test tests/meridian-autopilot.test.ts && node --test electron/installation.test.cjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** On launch with Installation on, restore the last show and start autopilot. Hold `powerSaveBlocker('prevent-display-sleep')` only while running.
- [ ] **Step 4: Implement `soak-meridian.mjs`.** It takes `--hours` and logs FPS, longest frame, JS heap, renderer memory info and faults every minute to `work/meridian/soak-<date>.csv`. It exits non-zero on sustained memory growth above 10% after the first hour or any unrecovered fault.
- [ ] **Step 5: Run** `npm test && node scripts/soak-meridian.mjs --hours 0.1`. Expected: PASS.
- [ ] **Step 6: Commit** `Add Meridian installation mode and soak tool`.

### Task 18: Party readiness

**Files:**
- Create: `docs/meridian-show-checklist.md`, `reports/Meridian soak.md`
- Modify: `README.md`

- [ ] **Step 1: Run the full suite:** `npm test && npm run test:map && npm run test:live && node scripts/verify-meridian.mjs`. Expected: all PASS.
- [ ] **Step 2: Run overnight** on the show Mac: `node scripts/soak-meridian.mjs --hours 12`. Expected: exit 0. Record the real results in the report.
- [ ] **Step 3: Write the one-page show checklist:** connections, camera placement out of the projector beam, audio source, Flash Guard state, fallback moves, Blackout, restart steps.
- [ ] **Step 4: Rehearse with the user** on the actual projector, camera and DJ audio if available. Record line width, camera position and any issue. Items not tested stay listed as untested.
- [ ] **Step 5: Add the README section,** described as alpha until party feedback is in.
- [ ] **Step 6: Commit** `Add Meridian show checklist and soak report`.
