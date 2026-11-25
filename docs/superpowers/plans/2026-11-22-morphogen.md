# Morphogen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a party-ready, endless, sound-reactive stripe-growth generator that plays through Live and Live in Map and is performed from the MIDImix.

**Architecture:** A self-contained engine in `src/morphogen/` runs a GPU Swift-Hohenberg solver steered by a direction field, then shades its height as chrome and thin film. A thin `Look` adapter connects it to Live, which already reaches Map, sound links and scenes. A flash limiter sits on Map's final wall output.

**Tech Stack:** TypeScript 7, Three.js 0.187 (WebGL2, GLSL), React 19, Electron 45, `tsx --test`, Playwright Electron scripts.

**Spec:** `docs/superpowers/specs/2026-11-22-morphogen-design.md`

## Global Constraints

- Start from `main` in a new worktree on branch `morphogen`. The current working branch is behind `main`.
- `src/morphogen/` imports neither `src/live` nor `src/map`, except type-only imports in adapters outside that folder.
- The clip is inspiration. No preset, test or acceptance step may aim to match it.
- Simulation state is 32-bit float: `passes.pair(w, h, { float: true, nearest: true })`. This is RGBA32F because `Passes` has no RG format; R is ground, G is body.
- Default simulation size 1024×576; tiers 768×432, 1024×576, 1280×720. At most 12 solver steps a frame.
- Laplacian is the 9-point stencil: orthogonal .5, diagonal .25, centre −3.
- Flash limiter is on by default and targets no more than 3 flashes in any second. Never describe it as certified.
- Faders never change job in Morphogen mode.
- Targets on the M5 Pro at 1080p: median under 8 ms, p99 under 14 ms, no morph frame over 33 ms.
- Show visible results early. After Task 3, stop for Greg's reaction before continuing.
- Schedule gates: Task 3 by 24 Nov, Task 5 by 26 Nov, Task 7 by 28 Nov, Task 9 by 30 Nov, Task 10 by 2 Dec.
- Party cut order: extra looks, Forms beyond one disc and one ring, Mutate, camera reaction. Never cut the limiter, recovery or soak.
- Meridian's party readiness takes priority whenever the two compete for time.

## Review Focus

1. Extreme slider combinations while audio modulates them should never blank, explode or permanently damage the pattern (Task 1 and Task 10 tests).
2. A sustained 10 Hz kick driving Map shape brightness on a red look should stay within the flash limit at the wall (Task 6 test).
3. No camera, microphone or MIDI at startup should still play the look in Map rather than the shape's fill (Task 4 test).
4. A damaged or older `live-settings.json` should load with valid Morphogen values and leave other looks untouched (Task 4 test).
5. MIDImix unplugged or a mode change mid-morph should hold the picture with no value jump (Task 9 test).

---

## Stage 0: first look

### Task 1: Parameters and stability

**Files:**
- Create: `src/morphogen/params.ts`, `src/morphogen/stability.ts`
- Test: `tests/morphogen-core.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MorphControl { key: MorphKey; label: string; section: MorphSection; min: number; max: number; step: number; default: number; description: string; advanced?: boolean }
  export type MorphSection = 'Pattern'|'Flow'|'Forms'|'Motion'|'Relief'|'Material'|'Iridescence'|'Colour'|'Camera'|'Finish'|'Reaction'|'System';
  export const MORPH_CONTROLS: readonly MorphControl[];
  export type MorphParams = Record<MorphKey, number>;
  export function defaultMorphParams(): MorphParams;
  export function validateMorphParams(value: unknown): MorphParams;
  export function stableStep(wavelength: number, alignment: number, asymmetry: number): number;
  ```

Party core keys, with `min/max/default`:

| Section | Keys |
|---|---|
| Pattern | `wavelength 7/32/12`, `drive .05/.7/.28`, `asymmetry 0/.7/.12`, `alignment 0/1/.65`, `forkRate 0/1/.3`, `lineSharp 0/1/.45`, `seed 0/9999/1` |
| Flow | `fieldType 0/5/0` (radial, spiral, swirl, parallel, poles, curl), `fieldMix 0/1/.2`, `centreX -1/1/0`, `centreY -1/1/0`, `spiral -1/1/0`, `curlAmount 0/1/.2`, `curlScale .3/6/1.4` |
| Forms | `formType 0/3/1` (none, disc, ring, blob), `formX -1/1/0`, `formY -1/1/0`, `formSize .05/.9/.42`, `formSoft 0/.3/.02`, `refraction 0/1/.45`, `formWavelength .5/2/.8`, `orbit 0/1/.1` |
| Motion | `speed 0/4/1`, `breathing 0/1/.2`, `travel 0/1/.15`, `fieldDrift 0/1/.25`, `freezeFloor 0/1/.35` |
| Relief | `depth 0/2/1`, `bevel 0/1/.4` |
| Material | `roughness .04/.9/.2`, `metal 0/1/.85`, `clearcoat 0/1/.5`, `lightAngle -3.14/3.14/-.7`, `envRotate -3.14/3.14/0` |
| Iridescence | `irid 0/1/.6`, `filmNm 100/900/420`, `filmVary 0/1/.5`, `filmIor 1.1/2.4/1.45` |
| Colour | `palette 0/11/0`, `colourShift 0/1/0`, `colourZones 0/1/.5`, `saturation 0/2/1`, `exposure .25/2/1` |
| Finish | `bloom 0/1/.25`, `chroma 0/1/.2`, `grain 0/1/.05` |
| System | `quality 0/2/1` |

- [ ] **Step 1: Write failing tests**

```ts
test('defaults are inside every control range', () => { /* every default within min..max */ });
test('validation repairs bad, missing and out-of-range values', () => {
  const v = validateMorphParams({ wavelength: 9999, drive: 'x', depth: NaN });
  assert.equal(v.wavelength, 32); assert.equal(v.drive, .28); assert.equal(v.depth, 1);
});
test('step at the default spacing matches the bound', () => {
  assert.ok(Math.abs(stableStep(12, 0, 0) - .0873) < .0005);
});
test('solver stays bounded across extreme parameters', () => {
  // 64×64 CPU reference using the 9-point stencil, 2,000 steps at each corner of wavelength, alignment, asymmetry and drive.
  // Assert every value is finite and |u| <= 1.5.
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/morphogen-core.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```text
K = (2π / wavelength)²
stableStep = 1.8 / ((4 − K)² + 4·alignment + 3·1.5² + 3·asymmetry)
```

Keep the JSON of a full parameter set under 4 KB, so it fits the 16 KB Live message.

- [ ] **Step 4: Run and confirm pass**

Run: `npx tsx --test tests/morphogen-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/morphogen tests/morphogen-core.test.ts
git commit -m "Add Morphogen parameters and stability bound"
```

### Task 2: Solver and direction field

**Files:**
- Create: `src/morphogen/solver.ts`, `src/morphogen/solver-shaders.ts`, `src/morphogen/director.ts`, `scripts/verify-morphogen.mjs`
- Modify: `package.json` (add `"test:morphogen": "npm run build && node scripts/verify-morphogen.mjs"`)
- Test: `tests/morphogen-core.test.ts`, `scripts/verify-morphogen.mjs`

**Interfaces:**
- Consumes: `MorphParams`, `stableStep`.
- Produces:
  ```ts
  export function accumulateSteps(carry: number, seconds: number, speed: number, dt: number, maxSteps: number): { steps: number; carry: number };
  export class MorphSolver {
    constructor(passes: GpuPasses, width: number, height: number);
    step(seconds: number, time: number, params: MorphParams, input: MorphInput): void;
    readonly state: THREE.Texture; reseed(seed: number): void; resize(width: number, height: number): void; dispose(): void;
  }
  export interface GpuPasses { material(fragment: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial; draw(m: THREE.ShaderMaterial, t: THREE.WebGLRenderTarget | null): void; pair(w: number, h: number, o: { float?: boolean; nearest?: boolean }): { read: THREE.WebGLRenderTarget; write: THREE.WebGLRenderTarget; swap(): void; setSize(w: number, h: number): void; dispose(): void } }
  export interface MorphInput { flow: THREE.Texture | null; people: THREE.Texture | null; impulse: number; seedBurst: number }
  ```
  `GpuPasses` is a structural type that the existing `Passes` class satisfies, so the engine needs no import from `src/live`.

- [ ] **Step 1: Write failing tests**

Test `accumulateSteps`: carries fractions; never exceeds 12; drops excess time after a stall; `speed: 0` yields 0 steps.

In `verify-morphogen.mjs`, on real WebGL, assert after 1,200 frames: no NaN; pixel variance above .05; dominant stripe period within 20% of `wavelength`; radial field has measurably aligned stripes and at least one fork.

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/morphogen-core.test.ts && npm run test:morphogen`
Expected: FAIL.

- [ ] **Step 3: Implement**

```text
∂u/∂t = r·u − (K + ∇²)²u + g·u² − u³ + a·∂ₜₜu + f·cos(φ) + seeds
```

Compute `(K+∇²)²` in one pass from a 5×5 footprint by applying the 9-point stencil twice. Replace NaN and infinity with 0. Clamp `u` to ±1.5. Treat directors as lines: blend in double-angle space `(cos 2θ, sin 2θ)`.

- [ ] **Step 4: Run and confirm pass**

Run: `npx tsx --test tests/morphogen-core.test.ts && npm run test:morphogen`
Expected: PASS. If stripes do not form or fork, stop and report rather than tuning around it.

- [ ] **Step 5: Commit**

```bash
git add src/morphogen scripts/verify-morphogen.mjs package.json tests/morphogen-core.test.ts
git commit -m "Add Morphogen stripe solver and steering field"
```

### Task 3: Chrome and iridescent shading

**Files:**
- Create: `src/morphogen/shade.ts`, `src/morphogen/shade-shaders.ts`, `src/morphogen/palettes.ts`, `src/morphogen/engine.ts`
- Modify: `scripts/verify-morphogen.mjs`

**Interfaces:**
- Consumes: `MorphSolver`, `MorphParams`.
- Produces:
  ```ts
  export class MorphEngine {
    constructor(passes: GpuPasses, width: number, height: number);
    step(seconds: number, time: number, params: MorphParams, input: MorphInput): void;
    readonly output: THREE.Texture; // linear colour
    resize(width: number, height: number): void; clear(): void; dispose(): void;
  }
  export const MORPH_PALETTES: readonly { name: string; stops: string[] }[]; // 12 entries
  ```

- [ ] **Step 1: Add a failing render check**

Render three distinct parameter sets at 1920×1080 to `work/morphogen/first-look-{1,2,3}.png`. Assert non-black, not clipped over 15% of pixels, and mean colour differs between sets.

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:morphogen`
Expected: FAIL, `MorphEngine` missing.

- [ ] **Step 3: Implement shading**

Follow the spec's shading order: bicubic height using `texelFetch`, normal, form dome and refraction, palette, thin film, procedural environment, specular and clear coat, valley occlusion, dispersion, bloom, tone map, grain. Use a Belcour-style phase-shifted RGB film approximation, and fade film contrast by pixel footprint to prevent banding and moiré.

- [ ] **Step 4: Run and confirm pass**

Run: `npm run test:morphogen`
Expected: PASS, three PNGs written.

- [ ] **Step 5: Commit**

```bash
git add src/morphogen scripts/verify-morphogen.mjs
git commit -m "Add Morphogen chrome and thin-film shading"
```

- [ ] **Step 6: Stop for Greg's reaction**

Show the three renders and a short recording. Continue only after Greg accepts the visual direction or gives changes.

---

## Stage 1: playable in the show

### Task 4: Live and Live in Map connection

**Files:**
- Create: `src/live/Morphogen.ts`
- Modify: `src/live/settings.ts`, `src/live/modulate.ts`, `src/live/LiveRenderer.ts:24`, `src/map/liveReady.ts`, `src/map/liveSlot.ts:66`, `src/ui/LiveLookControls.tsx`
- Test: `tests/morphogen-live.test.ts`

**Interfaces:**
- Consumes: `MorphEngine`, `MORPH_CONTROLS`, `validateMorphParams`, `Look`.
- Produces: `LOOK_LABELS.morphogen = 'Morphogen'`; `LiveSettings.morphogen: MorphParams`; link targets `live.morphogen.<key>`; `liveReadiness` input gains `needsCamera: boolean`.

- [ ] **Step 1: Write failing tests**

```ts
test('old settings gain valid Morphogen values and keep their look', ...);
test('damaged Morphogen values are repaired without touching Signal', ...);
test('live.morphogen.drive is a link target with its control range', ...);
test('Morphogen plays with no camera', () => {
  assert.equal(liveReadiness({ status: 'missing' } as SourceState, { file: false, needsCamera: false, needsPeople: false, peopleLoading: false, drawnSinceRunning: 0, hasPicture: false }), 'play');
});
test('camera looks still cannot play with no camera', ...);
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/morphogen-live.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `Morphogen implements Look`, pass the feed's `flow` and `people` as `MorphInput`, and add it to the `looks` table. Add `morphogen` everywhere `Section` is listed in `modulate.ts`, including both reaction key maps (`movement-bass: 'drive'`, `glow-beat: 'bloom'`). When the look is Morphogen, Live must still step and draw with no running source. Check the validator's `v.look` allowlist at `settings.ts:202`.

- [ ] **Step 4: Run tests and Live checks**

Run: `npx tsx --test tests/morphogen-live.test.ts && npm test && npm run test:live`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests/morphogen-live.test.ts
git commit -m "Play Morphogen in Live and on mapped shapes"
```

### Task 5: Forms and never-freeze

**Files:**
- Create: `src/morphogen/forms.ts`, `src/morphogen/activity.ts`
- Modify: `src/morphogen/solver.ts`, `src/morphogen/solver-shaders.ts`, `src/morphogen/shade-shaders.ts`, `scripts/verify-morphogen.mjs`
- Test: `tests/morphogen-core.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function formAt(params: MorphParams, time: number): { x: number; y: number; radius: number; type: number };
  export class ActivityGovernor { update(activity: number, floor: number, seconds: number): { driftBoost: number; seedBurst: number } }
  ```

- [ ] **Step 1: Write failing tests**

`ActivityGovernor`: no action above the floor; raises `driftBoost` first when low; seeds only after 8 seconds below the floor; relaxes after recovery; output never exceeds `driftBoost 1`, `seedBurst 1`. `formAt`: stays on-screen for any orbit over 10,000 seconds. In WebGL: with default settings, frame difference after 20 simulated minutes stays above the floor.

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/morphogen-core.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Ground and body fields update in one pass; the form mask selects which is shown. Measure activity from a small asynchronous readback once a second, using `fenceSync` and never a blocking read.

- [ ] **Step 4: Run and confirm pass**

Run: `npx tsx --test tests/morphogen-core.test.ts && npm run test:morphogen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/morphogen scripts/verify-morphogen.mjs tests/morphogen-core.test.ts
git commit -m "Add Morphogen forms and anti-freeze"
```

---

## Stage 2: show safety

### Task 6: Wall-output flash limiter

**Files:**
- Create: `src/map/flash-limiter.ts`
- Modify: `src/map/gpu.ts:306`, `src/map/compositor.ts:289`, final-pass fragment in `src/map/gpu.ts`
- Test: `tests/flash-limiter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class FlashLimiter {
    constructor(enabled?: boolean);
    push(rgba: Uint8ClampedArray, width: number, height: number, tSeconds: number): FlashCorrection;
    readonly flagged: number;
  }
  export interface FlashCorrection { gain: number; redScale: number }
  ```
  `Gpu.setOutputCorrection(gain: number, redScale: number): void`.

Rules from WCAG 2.3.1, using sRGB relative luminance:

- A general transition is a change of at least .10 where the darker state is below .80.
- A red transition has `R/(R+G+B) >= .8` in either state and a change in `(R−G−B)·320` above 20.
- A frame event needs at least **10% of cells** in a 32×18 grid changing the same way. This is deliberately stricter than WCAG's 25% area, because viewing distance in a room is unknown.
- A flash is a pair of opposing transitions.

- [ ] **Step 1: Write failing tests**

```ts
test('a steady picture is untouched', ...);            // gain 1, redScale 1
test('2 Hz pulses pass unchanged', ...);
test('10 Hz full-frame white is limited to 3 flashes in any second', ...); // closed loop, 2-frame latency
test('10 Hz saturated red is limited to 3 flashes in any second', ...);
test('10 Hz flash on 5% of the frame is ignored', ...);
test('limiter releases smoothly within 2 seconds', ...); // gain change per frame <= .08
test('Map brightness link at 10 Hz on a red look stays within the limit', ...); // simulated output after shape brightness
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/flash-limiter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement and wire**

Reuse `Gpu.requestPreview` and `collectPreview`, which are already non-blocking. They allow one read at a time, so hand the same collected image to both the limiter and any existing preview consumer. Apply `gain` and `redScale` in the final pass only, so previews and fades are unchanged. If no readback arrives for 500 ms, hold the last correction.

- [ ] **Step 4: Run and confirm pass**

Run: `npx tsx --test tests/flash-limiter.test.ts && npm test && npm run test:map`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/map tests/flash-limiter.test.ts
git commit -m "Limit flashes on the final wall output"
```

### Task 7: Governor and recovery

**Files:**
- Create: `src/morphogen/governor.ts`
- Modify: `src/morphogen/engine.ts`, `src/live/Morphogen.ts`, `scripts/verify-morphogen.mjs`
- Test: `tests/morphogen-core.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface QualityState { steps: number; simHeight: 432 | 576 | 720; bloom: boolean }
  export class QualityGovernor { update(frameMs: number, budgetMs: number): QualityState }
  ```

- [ ] **Step 1: Write failing tests**

Governor drops in the order steps, simulation size, bloom; a single spike does nothing; recovers only after 10 seconds of headroom; never oscillates under a constant load at a tier boundary. Budget comes from the measured display refresh, not a fixed 16.7 ms. WebGL: `WEBGL_lose_context` forced loss returns a non-black picture within 3 seconds, using current parameters.

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/morphogen-core.test.ts && npm run test:morphogen`
Expected: FAIL.

- [ ] **Step 3: Implement**

A simulation resize resamples the old state bicubically, so a tier change never resets the pattern. After context loss, rebuild from parameters, reseed and fade in over 1 second.

- [ ] **Step 4: Run and confirm pass**

Run: `npx tsx --test tests/morphogen-core.test.ts && npm run test:morphogen`
Expected: PASS, and print median and p99 ms against the targets.

- [ ] **Step 5: Commit**

```bash
git add src/morphogen src/live/Morphogen.ts scripts/verify-morphogen.mjs tests/morphogen-core.test.ts
git commit -m "Add Morphogen quality governor and GPU recovery"
```

---

## Stage 3: the party instrument

### Task 8: Panel, macros, looks and performance tools

**Files:**
- Create: `src/morphogen/macros.ts`, `src/morphogen/looks.ts`, `src/morphogen/performer.ts`, `src/ui/MorphogenPanel.tsx`
- Modify: `src/ui/LiveLookControls.tsx`, `src/live/Morphogen.ts`, `src/live/settings.ts`
- Test: `tests/morphogen-perform.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MACROS: readonly ['growth','chaos','density','liquid','heat','prism','warp','impact'];
  export type MacroKey = typeof MACROS[number];
  export function applyMacros(base: MorphParams, macros: Record<MacroKey, number>): MorphParams;
  export const MORPH_LOOKS: readonly { id: string; name: string; params: Partial<MorphParams> }[]; // six party looks
  export class MorphPerformer {
    morphTo(index: number, seconds: number): void; hold(on: boolean): void; mutate(seed: number): void; undo(): void; scramble(): void;
    frame(seconds: number, base: MorphParams, macros: Record<MacroKey, number>): { params: MorphParams; input: Pick<MorphInput,'impulse'|'seedBurst'> };
  }
  ```

Party looks: Orchid Lens, Solar Fingers, Mercury Coral, Abyss Filament, Acid Petri, Twin Moons.

- [ ] **Step 1: Write failing tests**

Macro at 0.5 leaves base unchanged; macro output always validates; morph is monotonic and ends exactly on the target; enum values switch at the midpoint; a new morph mid-morph starts from current values with no jump; Hold sets solver speed to 0 and leaves colour motion; Mutate stays in range and Undo restores exactly; Scramble decays to 0 within 4 seconds.

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/morphogen-perform.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Build `MorphogenPanel` from `MORPH_CONTROLS`: macros at the top, sections collapsed, advanced hidden, existing link (∿) control on each slider, looks in a dropdown. Follow `LiveLookControls` patterns.

- [ ] **Step 4: Verify**

Run: `npx tsx --test tests/morphogen-perform.test.ts && npm run test:live && npm run test:morphogen`
Expected: PASS. Render all six looks to `work/morphogen/looks/` and check they are visibly distinct.

- [ ] **Step 5: Commit**

```bash
git add src tests/morphogen-perform.test.ts
git commit -m "Add Morphogen panel, macros, looks and morphing"
```

### Task 9: MIDImix mode

**Files:**
- Create: `src/morphogen/midimix-mode.ts`, `src/morphogen/midimix-map.ts`
- Modify: `src/ui/MorphogenPanel.tsx`, `src/live/Morphogen.ts`
- Test: `tests/morphogen-midimix.test.ts`

**Interfaces:**
- Consumes: `MorphPerformer`, MIDI signals `midi.cc.<channel>.<number>` and `midi.note.<channel>.<number>`.
- Produces:
  ```ts
  export interface MidimixMap { knobs: string[][]; faders: string[]; master: string; amber: string[]; red: string[]; solo: string; sendAll: string }
  export class MidimixMode {
    constructor(map: MidimixMap, performer: MorphPerformer);
    update(signals: Signals, seconds: number): { active: boolean; macros: Record<MacroKey, number>; lights: { amber: boolean[]; red: boolean[] } };
  }
  ```

- [ ] **Step 1: Capture the real control map with Greg**

If the MIDImix is available, move every control and press every button, then save the signal names in `midimix-map.ts`. Check Solo and Send All can be held and combined. If the device is unavailable, use a clearly marked placeholder and block the Task 10 go decision on this step.

- [ ] **Step 2: Write failing tests**

Solo + Send All toggles once per press; knob pickup waits until the knob crosses the held value; ambers morph to looks 1–8 (7 and 8 are ignored while only six exist); red 1–4 fire Hold, Mutate, Scramble, Undo; fader signals are never consumed; disconnect (signals stop changing) holds all values; toggling mid-morph causes no value jump.

- [ ] **Step 3: Run and confirm failure**

Run: `npx tsx --test tests/morphogen-midimix.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement and verify**

Implement `MidimixMode`. Physical lights use a MIDI output only after Step 1 confirms how the device responds; on-screen state is always shown.

Run: `npx tsx --test tests/morphogen-midimix.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests/morphogen-midimix.test.ts
git commit -m "Play Morphogen from the MIDImix"
```

---

## Stage 4: party proof

### Task 10: Fuzz, soak and rehearsal

**Files:**
- Create: `scripts/verify-morphogen-show.mjs`, `reports/Morphogen party proof.md`
- Modify: `package.json` (add `"test:morphogen:show": "npm run build && node scripts/verify-morphogen-show.mjs"`)

- [ ] **Step 1: Write the show script**

Modes:

- `--fuzz`: 10,000 random valid parameter changes. Fail on NaN, a black frame or a blown-out frame.
- `--soak=8h`: cycles looks and morphs with the built-in test beat, no camera. Log median, p99, GPU memory estimate, JS heap and activity each minute. Fail on a crash, NaN, heap growth over 10% after the first 30 minutes, or activity below the floor for 60 seconds.
- `--flash`: worst-case 10 Hz audio on every look through Map. Fail on more than 3 flagged flashes in any second.
- `--recover`: forced context loss. Fail if the picture is not back within 3 seconds.

- [ ] **Step 2: Run short proofs**

Run: `npm run test:morphogen:show -- --fuzz --flash --recover`
Expected: all pass.

- [ ] **Step 3: Run the soak in the background**

Run: `npm run test:morphogen:show -- --soak=8h`
Expected: PASS, with the minute-by-minute log written to `work/morphogen/soak.json`.

- [ ] **Step 4: Rehearse with Greg in the real setup**

Use the projector, DJ audio or a recorded mix, the MIDImix and the mapped surfaces. Check moiré at projector resolution, red-heavy looks, morphs on the beat, and unplugging the MIDImix and audio.

- [ ] **Step 5: Write the go or no-go report**

Record measured results against every acceptance target, and anything not tested. Decision options on 2 December: **Go**, **Go with sound-driven brightness off**, or **No-go**. Greg makes the call.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-morphogen-show.mjs package.json "reports/Morphogen party proof.md"
git commit -m "Add Morphogen show proof"
```

---

## After the party (separate plan)

Full parameter set, twelve looks, up to four forms, looks saved in show files and scene recall, 72-hour soak, the Perform source, and installation reliability. These depend on party feedback, so they are deliberately not detailed here.
