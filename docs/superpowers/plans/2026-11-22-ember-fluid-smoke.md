# Ember Fluid Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Ember's scripted smoke with a real fluid, make every smoke control strong, and add ten colour schemes.

**Architecture:** A pure model (`ember-fluid-model.ts`) turns layer params into simulation settings and burst events. `EmberFluid` runs Live's `Fluid` solver on a fixed 60 Hz clock and returns a density texture that `ScopeRenderer` composites in place of the old smoke target. Exports replay deterministically and crossfade the loop seam.

**Tech Stack:** TypeScript, three.js 0.187 WebGL2, Electron 45, `node:test` through tsx, Playwright Electron checks.

**Spec:** `docs/superpowers/specs/2026-11-22-ember-fluid-smoke-design.md`

## Global Constraints

- Classic Oscilloscope output must not change, and Live's Smoke must behave as it does today.
- Existing param keys stay. Saved projects load without error, with no legacy smoke mode.
- Each smoke control, minimum to maximum, visibly changes at least 10% of the picture at defaults.
- At least half the pixels reach true black in trough frames at default.
- 4K p99 at most 11.7 ms for one Ember layer on the M5 Pro.
- All 15 schemes pass the flash screen at default at 200, 1,000 and 1,500 nits, 2 px grid.
- Two exports of one frame are identical, and the exported loop has no visible jump.
- Do not commit, push or merge until the owner asks.

## Review Focus

- Scrubbing the timeline while paused: the picture settles on the same smoke as an export of that frame.
- Several Ember layers, or Ember in several Map shapes: each keeps its own smoke, with no state shared by layer index.
- Resizing the preview mid-play: smoke continues, with no black flash or GL error.
- Context loss during playback or export: smoke rebuilds with no error toast.
- Long loops (600 s) and short loops (0.1 s): seeking and pre-roll stay bounded.

---

### Task 1: Model, controls and styles

**Files:**
- Create: `src/rendering/ember-fluid-model.ts`
- Modify: `src/core/project.ts:49-79,662`, `src/ui/LayerControls.tsx:170-172`
- Test: `tests/ember-fluid.test.ts`

**Interfaces:**
- Produces:
  - `EMBER_SMOKE_STYLES = ['Wisps','Rolling','Billow','Plume','Storm'] as const`
  - `EMBER_SMOKE_ORIGINS = ['Core','Ring','Filaments','Rising'] as const`
  - `interface EmberFluidSettings { curl: number; velocityLife: number; dyeLife: number; buoyancy: number; force: number; emit: number; radius: number; turbulence: number; density: number; lighting: number }`
  - `emberFluidSettings(params: Record<string, number>, audio?: { bass: number; highs: number }): EmberFluidSettings`
  - `interface EmberBurst { time: number; angle: number; strength: number }`
  - `emberBursts(fromSeconds: number, toSeconds: number, loopSeconds: number, phrases: number, seed: number): EmberBurst[]`, using the beat offsets of `emberPhrase`
  - `emberFluidSteps(seconds: number): number`, whole 1/60 s steps, capped at 6 for live play
  - `emberLoopBlend(seconds: number, loopSeconds: number): { weight: number; blendSeconds: number }`, where `blendSeconds = min(1.5, loopSeconds * .25)` and `weight` is a smoothstep of `seconds / blendSeconds`

- [ ] **Step 1: Write failing tests**

```ts
test('each style produces distinct simulation settings', () => {
  const at = (emberSmokeStyle: number) => emberFluidSettings({ ...defaults, emberSmokeStyle });
  const all = EMBER_SMOKE_STYLES.map((_, i) => JSON.stringify(at(i)));
  assert.equal(new Set(all).size, 5);
});
test('every smoke control moves its setting by at least a factor of two', () => {
  for (const [key, field] of [['emberSmoke','emit'],['emberSmokeSpread','force'],['emberSmokeCurl','curl'],['emberSmokeLife','dyeLife'],['emberSmokeBody','density'],['emberSmokeDetail','turbulence'],['emberSmokeLight','lighting']] as const) {
    const low = emberFluidSettings({ ...defaults, [key]: .05 })[field], high = emberFluidSettings({ ...defaults, [key]: 1 })[field];
    assert.ok(high >= low * 2, key);
  }
});
test('lift changes the sign of buoyancy', () => {
  assert.ok(emberFluidSettings({ ...defaults, emberSmokeLift: -1 }).buoyancy < 0);
  assert.ok(emberFluidSettings({ ...defaults, emberSmokeLift: 1 }).buoyancy > 0);
});
test('bursts are deterministic and split cleanly across windows', () => {
  const whole = emberBursts(0, 10, 10, 5, 1729);
  assert.deepEqual([...emberBursts(0, 4, 10, 5, 1729), ...emberBursts(4, 10, 10, 5, 1729)], whole);
  assert.ok(whole.length >= 20);
});
test('loop blend is bounded on short and long loops', () => {
  assert.equal(emberLoopBlend(0, 10).weight, 0);
  assert.equal(emberLoopBlend(1.5, 10).weight, 1);
  assert.ok(emberLoopBlend(0, .1).blendSeconds <= .025);
  assert.equal(emberLoopBlend(0, 600).blendSeconds, 1.5);
});
test('older Ember layers gain style and origin, and validate', () => {
  const old = applyPreset(createLayer('scope'), 'ember-pulse');
  delete old.params.emberSmokeStyle; delete old.params.emberSmokeOrigin;
  const project = validateProject({ ...createProject(), layers: [old] });
  assert.equal(project.layers[0].params.emberSmokeStyle, 1);
  assert.equal(project.layers[0].params.emberSmokeOrigin, 0);
});
```

- [ ] **Step 2: Run** `npx tsx --test tests/ember-fluid.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement the model and params.** Add `emberSmokeStyle` (0 to 4, step 1, default 1) and `emberSmokeOrigin` (0 to 3, step 1, default 0) to `EMBER_PARAMETERS` and `VARIATION_FIXED`. Remove `advanced: true` from Spread, Lift, Persistence, Detail and Lighting. Render both as `ChoiceParameter` under the Ember controls, and add them to the list that excludes choice keys from sliders.
- [ ] **Step 4: Run** `npx tsx --test tests/ember-fluid.test.ts tests/scope.test.ts`. Expected: PASS.

---

### Task 2: Fluid in the picture

**Files:**
- Create: `src/rendering/EmberFluid.ts`
- Modify: `src/live/fluid.ts` (additive), `src/rendering/ScopeRenderer.ts:47-55,214-245,286-296`, `src/rendering/StudioRenderer.ts` (scope call, context reset), `src/rendering/scope-ember-smoke.ts` (removed), `tests/scope.test.ts`
- Create: `scripts/verify-ember-smoke.mjs`

**Interfaces:**
- Consumes: Task 1 model; `Fluid`, `Passes`.
- Produces:
  - `Fluid.saveState(): FluidState`, `Fluid.restoreState(state)`, `FluidState.dispose()`
  - `class EmberFluid { constructor(renderer: THREE.WebGLRenderer, aspect: number); sample(input: EmberFluidInput): THREE.Texture; reset(): void; dispose(): void }`
  - `EmberFluidInput = { params; seconds: number; loopSeconds: number; exact: boolean; audio?: SmokeAudioFrame; view: THREE.Matrix3; radius: number }`
  - `ScopeRenderer.draw(..., audio?, timing?: { exact: boolean; duration: number; layerId: string })`
  - `ScopeRenderer.resetGpuHistory(): void`

- [ ] **Step 1: Write `verify-ember-smoke.mjs --range`.** Render Ember at 960×540 after a 4-second run-in, at three phases, with each smoke control at minimum and maximum. Report the share of pixels whose mean channel differs by more than 12. Fail if any control is under 10%, and write `range.png`.
- [ ] **Step 2: Run it.** Expected: FAIL on the current smoke.
- [ ] **Step 3: Implement `EmberFluid`.** Grid 256×144 scaled to aspect, dye at half the smoke target's limit (528 px long side). Inject bursts as radial force plus dye at the origin chosen by `emberSmokeOrigin`. Keep one `EmberFluid` per `layerId`, and dispose those no longer drawn.
- [ ] **Step 4: Composite.** Keep the existing `uSmoke` resolve path, with R as front density, G as rear density and B as fine edges. Delete `emberSmokeFrame` and `emberSmokeFragment`, and replace their tests with `emberBursts` coverage. `EmberSmokeAudio` stays and feeds bursts.
- [ ] **Step 5: Context reset.** Call `scope?.resetGpuHistory()` from `onContextRestored` in `StudioRenderer`.
- [ ] **Step 6: Add a `--perf` mode.** Measure one Ember layer at 3840×2160 over 600 frames. Expected: p99 at most 11.7 ms. If it fails, lower the grid to 192×108, then pressure iterations to 12, and re-run.
- [ ] **Step 7: Run** `--range`, `--perf`, `npm test`, and `node scripts/verify-context-recovery.mjs 20 5`. Expected: all pass.

---

### Task 3: Seeking, exports and the loop seam

**Files:**
- Modify: `src/rendering/EmberFluid.ts`, `src/rendering/StudioRenderer.ts:1148-1172`, `scripts/verify-ember-smoke.mjs`

**Interfaces:**
- Consumes: `emberLoopBlend`, `Fluid.saveState`, `EmberFluidInput.exact`.

- [ ] **Step 1: Add `--export` checks that fail first.** Export one frame twice and assert byte equality. Export t = 0 and t = loop end at 960×540 and assert a mean channel difference under 1. Seek to 7 s, then 2 s, then 7 s, and assert the 7 s frames are identical.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement exact sampling.** Exact mode resets to a seed-derived state, pre-rolls `min(4, loopSeconds)` seconds, and replays from checkpoints every 1 s of simulated time, holding at most 12. Checkpoints thin evenly on long loops. Within `blendSeconds` of the start, output mixes `S(t + loop)` into `S(t)` using `emberLoopBlend`, with a second `EmberFluid` that exists only during exact sampling.
- [ ] **Step 4: Paused preview.** A paused seek uses exact mode, spread across frames through `needsRefresh()` so the UI stays responsive. Playing preview never resets at the loop point.
- [ ] **Step 5: Run** `--export`, `npm test`. Expected: PASS.

---

### Task 4: Colour schemes

**Files:**
- Modify: `src/core/project.ts:81-87`
- Test: `tests/ember-fluid.test.ts`

**Interfaces:**
- Produces: `EMBER_PALETTES` with 15 entries. Slot 1 and 2 are filaments, 4 is hot highlight, 6 is smoke.

- [ ] **Step 1: Write the failing test.**

```ts
test('there are fifteen distinct Ember schemes with their own presets', () => {
  assert.equal(EMBER_PALETTES.length, 15);
  assert.equal(new Set(EMBER_PALETTES.map(p => p.palette.join())).size, 15);
  for (const look of EMBER_PALETTES) {
    assert.equal(look.palette.length, 6);
    assert.ok(PRESETS.some(p => p.id === look.id));
  }
});
```

- [ ] **Step 2: Run.** Expected: FAIL with 5.
- [ ] **Step 3: Add** Solar Flare, Toxic Violet, Deep Sea, Neon Dusk, Blood Moon, Arctic Fire, Copper Patina, Ultraviolet, Ink and Aurora, with the filament and smoke colours in the spec. Ids use the `ember-` prefix.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

---

### Task 5: Tune and pass the gates

**Files:**
- Modify: `src/rendering/ember-fluid-model.ts`, palettes as needed
- Modify: `scripts/verify-ember-smoke.mjs`, with a `--sheet` mode

- [ ] **Step 1: Generate contact sheets:** five styles, four origins, 15 schemes. Look at them, and tune until styles are clearly different, filaments stay readable and blacks stay clean.
- [ ] **Step 2: Flash screen.** Use `flash-analyzer.mjs` from commit `234426a` in a scratch copy, rendering every Ember scheme after the run-in on the 2 px grid. Expected: all at or under 25%. Retune any that fail.
- [ ] **Step 3: Run the full gate:** `--range`, `--perf`, `--export`, `npm test`, `npm run test:interaction`, both context-recovery scripts, `npm run test:map`.
- [ ] **Step 4: Show the owner** the sheets and the running app for visual approval. Commit only when asked.
