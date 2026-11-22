# Kaleidoscope Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone Kaleidoscope instrument that folds a motif, image, the layers below it, its own feedback, or (in Live) a camera or video, with seam-free symmetry, filtered sampling, a true looping spiral zoom, and a benchmark that can prove the result.

**Architecture:** A new `kaleidoscope` layer kind has its own renderer and shader, separate from `fractal`. Pure TypeScript holds the fold and spiral maths, and one GLSL chunk implements the same maths for both Studio and Live. Studio and Map share the project-based path through `StudioRenderer`. Live gets a `Look` that feeds the camera or video into the same shader.

**Tech Stack:** TypeScript, Three.js 0.187 on WebGL2, Electron 45, `node:test` through `tsx`, esbuild for the benchmark bundle.

**Spec:** [reports/Fractal and kaleidoscope live audit.md](../../../reports/Fractal%20and%20kaleidoscope%20live%20audit.md), "Kaleidoscope should become a source-agnostic symmetry instrument" and "Phase 1".

**Status:** Draft for review. No app code has changed.

## Decisions to confirm

1. **Camera and video run in Live, not Map.** The report asked for all inputs in Live and Map, but `electron/main.cjs:211` deliberately refuses the camera to Map's wall window, and Map sources are saved `Project`s with no video path. Phase 1 gives Map the motif, image, layer-below and feedback inputs. Camera or video in Map would change that permission boundary and the show file, so it needs its own decision.
2. **Studio has no camera or video input.** Studio's loops, seeking and export are frame-exact, and a live feed cannot be.
3. **The old style stays and is relabelled.** Saved projects and all four existing presets keep rendering identically through `fractal` style 0. Its on-screen name changes from "Kaleidoscope" to "Folded Lace" so the app does not show two Kaleidoscopes.
4. **No new presets.** The instrument opens on a neutral default. This keeps clip-matched looks out and leaves the curated preset counts alone.
5. **Branch.** Build on `kaleidoscope-phase-1` in its own worktree, cut from `map-stage-1` at `59daf59`. `main` has diverged from this branch, so merging is a separate step. The report and this plan are not committed yet, so read them from the main checkout or commit them first.

## Global Constraints

- Kaleidoscope is a separate instrument. No combined starter, no clip-matched preset, and no reproduced palette, tile or pulse from the reference clips.
- Excluded from Phase 1: weaving, the 13 non-mirror wallpaper groups, hyperbolic tilings, audio control, strobe, inversion controls, flashing behaviour.
- Symmetry groups: D_n (n from 3 to 24), pmm, p3m1, p4m, p6m.
- Write original code. Do not copy Shadertoy, Quilez or other reference shader code.
- Existing projects, presets, loops, seeking and exports render unchanged.
- Test baseline on `59daf59`: **377 pass, 3 fail**. The failures are the preset counts in `tests/core.test.ts:684` and `tests/quality.test.ts:8`, and `copper-concertina` in `tests/timing.test.ts:43`. Do not fix or worsen them here. Every task ends with the same three failures and no others.
- No on-screen maths jargon. Use "Symmetry", "Spiral", "Repeat", "Source". Group names appear as Mirror, Square, Triangle, Hexagon and Rosette.
- Project schema stays at version 2. New kinds and fields must not make an older file fail to open.

## Verified maths

A local check (200,000 random points per group over a 40-unit range) confirmed these definitions. Every point landed in its chamber, every fold was 1-Lipschitz (largest measured stretch 1.000000), and lattice translation invariance held to under 1e-14. The spiral's one-turn residual was 1.78e-15 for `λ` in {2, 4, 16, 256} and integer `a, b` from -6 to 6.

Each wall is a half-plane `n·p ≤ d`, with `n` normalised. Reduce `p` by the nearest lattice vector once, then reflect across any violated wall, repeating up to the pass cap.

| Group | Lattice a, b | Walls `(nx, ny, d)` before normalising | Max passes | Max reflections |
|---|---|---|---:|---:|
| pmm | (1,0), (0,1) | (-1,0,0), (1,0,.5), (0,-1,0), (0,1,.5) | 2 | 2 |
| p4m | (1,0), (0,1) | (0,-1,0), (1,0,.5), (-1,1,0) | 3 | 4 |
| p3m1 | (1.5,√3/2), (0,√3) | (0,-1,0), (√3,1,√3), (-√3,1,0) | 4 | 5 |
| p6m | (1,0), (.5,√3/2) | (0,-1,0), (1,0,.5), (-1,√3,0) | 5 | 8 |

Use a shader cap of **6 passes**. D_n uses the closed-form wedge.

Spiral: `w = log z`, `γ = b - i·a·ln(λ)/(2π)`, `τ = (Re(γw)/ln λ, Im(γw)/(2π))`. One turn around the centre moves `τ` by exactly `(a, b)`. Zoom adds `zoomCycles × loopFraction` to `τ.x`, so it closes for any integer `zoomCycles`. Non-motif sources are read through a period-1 triangle wave of `τ`, so they close for any integer `a, b`. `(a, b) = (0, 0)` is invalid.

## Review Focus

1. **Pixels at the exact centre of a rosette or spiral.** `log 0` and zero-length gradients must not produce NaN, black specks or sparkle. Pinned in Tasks 2 and 8.
2. **Image or layer below still loading, missing or removed.** The layer shows its motif instead of throwing or going black. Pinned in Task 5.
3. **Saved project containing a Kaleidoscope with out-of-range or non-integer controls.** Values clamp or round so the spiral still closes. Pinned in Tasks 2 and 3.
4. **Kaleidoscope as the bottom layer with "Layer below" chosen.** It folds transparent black and shows a calm empty frame, with no feedback from a stale target. Pinned in Task 5.
5. **Camera lost or video closed during Live.** The look holds the last frame and recovers when the source returns. Pinned in Task 6.

---

### Task 1: Benchmark harness

**Files:**
- Create: `src/core/bench-stats.ts`, `src/rendering/gpu-timer.ts`, `scripts/bench.cjs`, `scripts/bench.browser.mjs`, `scripts/bench.preload.cjs`
- Modify: `src/rendering/StudioRenderer.ts:492` (`draw`), `package.json`
- Test: `tests/bench-stats.test.ts`

**Interfaces:**
- Produces: `summarise(samples: number[]): { count: number; median: number; p95: number; p99: number; max: number }`
- Produces: `agree(a: number, b: number, tolerance: number): boolean`
- Produces: `class GpuTimer { constructor(gl: WebGL2RenderingContext); readonly available: boolean; begin(pass: string): void; end(): void; poll(): void; results(): Record<string, number[]>; dispose(): void }`
- Produces: `StudioRenderer.setPassTimer(timer: GpuTimer | null): void`, with `draw` labelling each pass by material name. With no timer the cost is one null check.
- Produces: `npm run bench -- --case <id|all> --size 1080p|4k --frames 300 --out <file.json>`

- [ ] **Step 1: Write failing tests** for `summarise` (nearest-rank p95 of 1..100 is 95; empty input throws; input array is not mutated) and `agree` (`agree(10, 10.4, .05)` true, `agree(10, 10.6, .05)` false).
- [ ] **Step 2: Run** `npx tsx --test tests/bench-stats.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `bench-stats.ts` and `gpu-timer.ts`. `GpuTimer` uses `EXT_disjoint_timer_query_webgl2`, never nests queries, discards results when `GPU_DISJOINT_EXT` is set, and reports `available: false` when the extension is missing.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Build the Electron harness**, bundling with esbuild as `scripts/fractal-study.cjs:67` does. For each case record: cold compile and link time, first-draw time, per-pass GPU ms, CPU frame ms, and full-output ms including composite and finish. Write JSON with machine, Electron version, renderer string, size and frame count. Include the 11 existing fractal presets as the baseline.
- [ ] **Step 6: Verify repeatability.** Run `npm run bench -- --case all --size 1080p --frames 300` twice. Expected: every case's median agrees within 5%. Save the baseline to `docs/benchmarks/2026-11-baseline.json`.
- [ ] **Step 7: Run** `npm test`. Expected: the 3 baseline failures only. **Commit.**

### Task 2: Fold and spiral maths

**Files:**
- Create: `src/core/kaleidoscope-math.ts`
- Test: `tests/kaleidoscope-math.test.ts`

**Interfaces:**
- Produces: `type SymmetryGroup = 'rosette' | 'pmm' | 'p3m1' | 'p4m' | 'p6m'`, and `SYMMETRY_GROUPS` in that order (index equals the `group` param)
- Produces: `GROUP_TABLES: Record<Exclude<SymmetryGroup,'rosette'>, { a: Vec2; b: Vec2; walls: [number, number, number][] }>`, using the Verified maths values
- Produces: `foldPoint(group: SymmetryGroup, p: Vec2, sectors: number): { p: Vec2; linear: [number, number, number, number]; reflections: number }`
- Produces: `spiralTau(z: Vec2, a: number, b: number, lambda: number): Vec2`
- Produces: `sanitiseSpiral(a: number, b: number): { a: number; b: number }`, which rounds and turns `(0,0)` into `(0,1)`

- [ ] **Step 1: Write failing tests:**

```ts
test('every fold stays continuous: a small step never grows', () => { /* 30,000 directed steps per group, h = 1e-4: |fold(p+h)-fold(p)| <= h*(1+1e-6) */ });
test('wallpaper folds repeat on their lattice', () => { /* fold(p + 3a - 2b) equals fold(p) within 1e-9 */ });
test('the linear part is orthogonal and maps a step to the folded step', () => { /* away from walls */ });
test('rosettes are continuous for every n from 3 to 24', () => {});
test('one turn moves the spiral by exactly (a, b)', () => { /* residual < 1e-9 for lambda 2, 4, 16, 256 and a,b in -6..6 */ });
test('the exact centre returns finite values', () => { /* foldPoint and spiralTau at (0,0) */ });
test('sanitiseSpiral rounds and refuses (0,0)', () => {});
```

- [ ] **Step 2: Run** `npx tsx --test tests/kaleidoscope-math.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Accumulate each reflection into `linear`. No allocation inside the wall loop.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: The layer kind

**Files:**
- Modify: `src/shared/types.ts:6`, `src/core/project.ts:37,320,786,813`, `src/core/library.ts:7`, `src/core/tile-edges.ts`, `src/core/canvas-interaction.ts:15`
- Test: `tests/kaleidoscope-layer.test.ts`

**Interfaces:**
- Produces: `LayerKind` includes `'kaleidoscope'`. `KALEIDOSCOPE_INPUT = { motif: 0, image: 1, below: 2, feedback: 3 } as const`
- Produces these params, plus the shared grading fields and `seed`, `cycles`, `echo`:

| Key | Label | Range, step | Default |
|---|---|---|---|
| `input` | Source | 0 to 3, 1 | 0 |
| `group` | Symmetry | 0 to 4, 1 | 0 |
| `sectors` | Mirrors | 3 to 24, 1 | 6 |
| `cell` | Repeat size | .1 to 4, .01 | 1 |
| `spiral` | Spiral | 0 to 1, 1 | 0 |
| `spiralA` | Spiral arms | -6 to 6, 1 | 1 |
| `spiralB` | Spiral rings | -6 to 6, 1 | 2 |
| `spiralScale` | Spiral step | 2 to 256, .01 | 4 |
| `zoomCycles` | Zoom per loop | -4 to 4, 1 | 1 |
| `sourceX`, `sourceY` | Source position | -1 to 1, .001 | 0 |
| `sourceScale` | Source size | .1 to 8, .01 | 1 |
| `sourceTurn` | Source turn | -π to π, .01 | 0 |
| `sourceDrift` | Source drift | 0 to 1, .01 | .15 |
| `warpIn` | Warp before fold | 0 to 1, .01 | 0 |
| `warpOut` | Warp after fold | 0 to 1, .01 | 0 |
| `motif` | Motif | 0 to 2, 1 | 0 |
| `motifScale` | Motif scale | .25 to 8, .01 | 2 |
| `lineWidth` | Line weight | .25 to 6, .01 | 2 |

- [ ] **Step 1: Write failing tests:** `createLayer('kaleidoscope')` passes project validation and round-trips through save and load; a Kaleidoscope layer may hold `image` while other non-image kinds are still refused; out-of-range params are handled like other kinds; an old project without the kind opens unchanged; `PRESETS.filter(p => p.kind === 'kaleidoscope').length === 0`; `tileBlockers` names a visible Kaleidoscope layer.
- [ ] **Step 2: Run** `npx tsx --test tests/kaleidoscope-layer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Allow `layer.image` for `'image' | 'kaleidoscope'` at `project.ts:813`.
- [ ] **Step 4: Run** the test, then `npm test`. Expected: new tests PASS, 3 baseline failures only.
- [ ] **Step 5: Commit.**

### Task 4: Shader core with motifs

**Files:**
- Create: `src/rendering/kaleidoscope-glsl.ts`, `src/rendering/KaleidoscopeRenderer.ts`
- Modify: `src/rendering/StudioRenderer.ts:616-630` (`drawSource`), `:1163` (`dispose`)
- Test: `tests/kaleidoscope-layer.test.ts`, `scripts/bench.browser.mjs`

**Interfaces:**
- Consumes: `GROUP_TABLES`, `sanitiseSpiral`, `sourceViewGLSL`
- Produces: `kaleidoscopeGLSL: string`, containing `foldDomain(vec2 p, inout vec2 dx, inout vec2 dy)` and `spiralDomain(vec2 z, inout vec2 dx, inout vec2 dy)`
- Produces: `kaleidoscopeUniforms(layer: Layer, loopFraction: number): Record<string, unknown>`, a pure function
- Produces: `class KaleidoscopeRenderer { draw(args: KaleidoscopeDraw): void; dispose(): void }`, where `KaleidoscopeDraw = { layer: Layer; phase: number; width: number; height: number; target: THREE.WebGLRenderTarget; draw: Draw; input: THREE.Texture | null; history: THREE.Texture | null; imageAspect: number }`

Signal path, in this order: source transform, warp before fold, fold or spiral, warp after fold, motif or texture lookup, colour. Rules the shader must follow:

- Take `dFdx` and `dFdy` of the **continuous pre-fold** coordinate only. Never differentiate after `atan`, `log`, `mod` or a fold.
- Carry gradients through the fold's reflections. In the spiral use the analytic derivative `dw = dz / z`, then multiply by `γ`.
- Sample textures with `textureGrad`. Warps use analytic Jacobians.
- Motifs compute analytic coverage from the same footprint, and fade to their average colour once the footprint exceeds one tile.
- The three motifs are an original line field, a square tile, and circle-overlap parity. Circle parity moves locally only and never inverts the full frame.
- All motion is periodic in `phase` with integer cycles.

- [ ] **Step 1: Write failing tests** for `kaleidoscopeUniforms`: integer rounding of `group`, `sectors`, `spiralA`, `spiralB`; `(0,0)` sanitised; identical uniforms at `loopFraction` 0 and 1 after wrapping.
- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement** the GLSL, renderer and `drawSource` branch. Compile lazily so projects without the instrument pay nothing.
- [ ] **Step 4: Add a GPU parity case to the harness.** Render fold coordinates to RGBA32F for 4,096 grid points per group and compare with `foldPoint`. Expected: maximum difference under 1e-3 in chamber units.
- [ ] **Step 5: Run** the tests, `npm run build`, and the parity case. Expected: PASS, with no shader warnings.
- [ ] **Step 6: Commit.**

### Task 5: Image, layer-below and feedback inputs

**Files:**
- Modify: `src/rendering/StudioRenderer.ts:451-471` (`prepare`), `:616` (`drawSource`), `:778-790` (`renderFrame`), `:941` (`feedbackStep`)
- Modify: `src/rendering/KaleidoscopeRenderer.ts`, `src/rendering/feedback.ts`
- Test: `tests/feedback.test.ts`, `tests/kaleidoscope-layer.test.ts`, `scripts/bench.browser.mjs`

**Interfaces:**
- Consumes: `KaleidoscopeDraw.input`, `.history`, `.imageAspect`
- Produces: `kaleidoscopeInputMode(layer: Layer, ready: { image: boolean; hasBelow: boolean }): 'motif' | 'image' | 'below' | 'empty' | 'feedback'`, a pure function
- Produces: `echoAppliedInSource(layer): boolean` in `feedback.ts`, true for a Kaleidoscope on the feedback input with `echo > 0`

Rules:

- **Image:** load through `loadAsset` with its mip chain.
- **Layer below:** copy the accumulated composite into a dedicated RGBA16F target with mipmaps, only when this input is active. Never sample a target while writing to it.
- **Feedback:** reuse the existing history so loops, warm-up and export stay exact. In `feedbackStep`, pass `from.texture` as `history`. The shader computes `motif over (echoFade × fold(history))`. When `echoAppliedInSource` is true, set `uFade = 0` so the echo is not applied twice. `echoFade` stays capped by `MAX_PERSISTENCE` (.97), which bounds the energy.

- [ ] **Step 1: Write failing tests:** the mode table (missing image gives `motif`; bottom layer with below gives `empty`; feedback with `echo = 0` gives `motif`); `feedbackActive` true for feedback input with `echo > 0`; `echoAppliedInSource` false for every other kind and input.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Add harness checks:** each input renders non-empty except the bottom-layer `empty` case; a feedback loop's first and last frames match within 1/255 on 99.9% of pixels; 1,000 feedback frames from a full-white seed never raise mean luminance.
- [ ] **Step 5: Run** tests and harness. Expected: PASS. **Commit.**

### Task 6: Live camera and video

**Files:**
- Create: `src/live/Kaleidoscope.ts`
- Modify: `src/live/settings.ts:12,30,113,143`, `src/live/LiveRenderer.ts:112`, `src/ui/LivePanel.tsx:115`
- Test: `tests/live.test.ts`

**Interfaces:**
- Consumes: `TrackingFeed.camera`, `Look`, `kaleidoscopeGLSL`
- Produces: `class Kaleidoscope implements Look`
- Produces: `LiveSettings.look` includes `'kaleidoscope'`, and `LiveSettings.kaleidoscope: { group: number; sectors: number; cell: number; spiral: boolean; spin: number; zoom: number }`, sanitised on load

Rules: `TrackingFeed.camera` carries both webcam and video-file frames, so one path serves both. Convert from sRGB to linear. Copy into a mip-mapped target only on `feed.fresh`. Do not start person finding for this look. Live settings must stay under the 16 KB cap.

- [ ] **Step 1: Write failing tests:** old settings load with the existing look unchanged; `look: 'kaleidoscope'` survives sanitising; out-of-range values clamp; the settings stay under the cap; the look does not request people.
- [ ] **Step 2: Run** `npx tsx --test tests/live.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** When no new frame arrives, keep the last frame in the mip target.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Run the app** with a video file through Live's existing file input. Close and reopen the source mid-play. Expected: the last frame holds, then the picture recovers with no console errors. **Commit.**

### Task 7: Studio controls

**Files:**
- Modify: `src/ui/App.tsx:42,44,287,645-651`, `src/ui/styles.css`
- Create: `src/ui/assets/kaleidoscope.png`, an original render from the default instrument
- Test: `npm run test:ui`

**Interfaces:**
- Consumes: Task 3 params
- Produces: a "Kaleidoscope" card in the Instruments library, and a "Folded Lace" label for `fractal` style 0

Rules: show only relevant controls. Source picks the input, and Image shows the existing image picker. Symmetry shows Mirrors only for Rosette and Repeat size for the others. Spiral reveals its three spiral controls and zoom. The feedback source shows the existing Echo amount.

- [ ] **Step 1: Add UI checks** to `scripts/verify-ui.mjs`: the card adds a layer; each Source and Symmetry option can be picked without a console error; the old fractal style reads "Folded Lace".
- [ ] **Step 2: Run** `npm run test:ui`. Expected: new checks FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:ui` and `npm test`. Expected: UI checks PASS, 3 baseline failures only.
- [ ] **Step 5: Verify in the app, including Map.** Put a Kaleidoscope source on a Map shape with the image, layer-below and feedback inputs. Expected: each plays on the wall window. **Commit.**

### Task 8: Acceptance proof

**Files:**
- Create: `scripts/kaleidoscope-proof.browser.mjs`, `docs/benchmarks/2026-11-kaleidoscope-phase-1.md`
- Modify: `scripts/bench.cjs`

**Interfaces:**
- Consumes: the Task 1 harness and every input
- Produces: `npm run bench -- --proof kaleidoscope`, which exits non-zero on any failed gate

| Gate (from the report) | Pass condition |
|---|---|
| Fold quality | Fold-line error within 1/255 of non-fold pixels against a 16x reference, all five groups |
| 4K budget | p95 at or below 8 ms with a video input, 300+ frames |
| Loop closure | Start and end match within 1/255 on 99.9% of pixels |
| Frame stability | Spiral p95 at or below 1.25x median |
| Centre | No centre sparkle in a zone-plate test: per-pixel temporal variance within the centre 5% no higher than the surrounding ring |
| Finite output | No NaN or infinite pixels in any group, input or spiral setting |
| Repeatability | Two runs agree within 5% on median |

- [ ] **Step 1: Implement the gates.** Compare in linear RGBA16F, read back at native size.
- [ ] **Step 2: Run** `npm run bench -- --proof kaleidoscope`. Expected: all gates pass. If one fails, fix the cause. Do not loosen a gate without recording it and asking.
- [ ] **Step 3: Record** results in the benchmark note, with the machine, what was and was not measured, and the existing fractal baseline for comparison. State plainly that only the M5 Pro was tested and that no flash or photosensitive safety is claimed.
- [ ] **Step 4: Run** `npm run build`, `npm test`, `npm run test:ui`. Expected: build passes, 3 baseline failures only, UI checks pass.
- [ ] **Step 5: Commit.**
