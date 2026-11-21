# Kaleidoscope Phase 1: implementation tasks

Source: `reports/Fractal and kaleidoscope live audit.md`, Phase 1 rows 1–4. This file turns those rows into tasks against the code as it stands on `map-stage-1`.

## What the code tells us

**There are three render worlds, and only two of them have layers.**

- **Studio** (`src/rendering/StudioRenderer.ts`) renders a `Project` of at most four layers. Every frame is a function of loop phase, so preview can seek and export is frame-exact. `drawSource()` renders one layer into `this.source`; `renderFrame()` composites layers bottom-up through `accumA`/`accumB`.
- **Map** (`src/map/compositor.ts`) plays each source as its own `Project` in its own `StudioRenderer` and WebGL context. Anything a Studio layer can do, Map gets for free. Nothing crosses between Map sources.
- **Live** (`src/live/LiveRenderer.ts`) is not layer-based. It runs one `Look` (paint, signal or smoke) on a free-running clock, reading the camera through `TrackingFeed`. A Studio layer cannot run there today.

**Consequences for the five inputs:**

| Input | Studio preview | Studio export | Map | Live | Work needed |
|---|---|---|---|---|---|
| Image | yes | exact | yes | via look | Reuse `loadAsset()` and the image layer's data URL. Small. |
| Layers below | yes | exact | yes | n/a | Read the `below` accumulator in `renderFrame()`. Small. Picking an arbitrary layer by id needs a per-layer target; not worth it in Phase 1. |
| Own feedback | yes | exact | yes | via look | Reuse `FeedbackState` and its warm-up, but the fold must apply to the echo, not over it. Medium. |
| Video file | new | **new pipeline** | new | via look | Nothing in Studio or Map plays video today. Export needs frame-exact decode (ffmpeg is already bundled for encoding) and a loop rule when clip length ≠ composition length. Storing video as a data URL is not viable; needs a file reference. Large. |
| Camera | new | not deterministic | new | new look | Studio/Map need a shared `getUserMedia` stream per window. Export must refuse or record. Live needs a `kaleidoscope` look. Medium. |

**Other findings:**

- The existing "Kaleidoscope" is `fractal` style 0, a generative folded-lace fractal (`src/rendering/fractal.ts:64`). Its `wedge()` fold is the seam-prone cyclic-style fold the audit measured. It should be renamed in the UI (proposed "Folded Lace") so there are not two Kaleidoscopes. Its presets keep loading unchanged; no data migration.
- `textureGrad` is already used (`src/rendering/shaders.ts:25`), so the Jacobian-filtered sampling path compiles in this renderer.
- `EXT_disjoint_timer_query_webgl2` is already queried in `scripts/verify-oil.mjs:105`; the harness can generalise that.
- The four-layer cap (`renderFrame`) stays. A Kaleidoscope over layers below uses one of the four.
- This cloud container has no target GPU. The harness can be built and smoke-tested here (SwiftShader), but every millisecond acceptance figure must be measured on the M5 Pro.

## Tasks

### T1. Benchmark harness (audit row 1, 3–4 days)

Status: built and smoke-tested with software rendering; see `docs/benchmark-harness.md`. Acceptance still needs two runs on the M5 Pro.

- `scripts/bench/` Electron runner modelled on `scripts/fractal-study.*`: loads a project, warms up, renders N≥300 frames at a fixed phase step, full output size.
- Per-pass GPU timing with `EXT_disjoint_timer_query_webgl2`, wrapped in a `GpuTimer` helper (`src/rendering/gpu-timer.ts`) that `StudioRenderer` calls around `drawSource`, feedback steps and composite when a debug flag is set. No cost when off.
- Cold-start metric: time from `new StudioRenderer` + `prepare()` to first frame, with shader compile separated where `KHR_parallel_shader_compile` allows.
- Output JSON: median, p95, p99, max per pass and total; machine, GPU string, resolution. A compare script fails when median moves >5% between two runs of the same commit.
- Presets: current Mandelbox and Kaleidoscope (the audit baselines), then each new Kaleidoscope input as it lands.
- **Accept:** two runs of the same commit agree within 5% on median on the M5 Pro.

### T2. `kaleidoscope` layer kind and inputs (audit row 2, 1–1.5 weeks, plus 3–4 days for video)

Status: first slice done. Kaleidoscope layer with built-in lines, image and layers-below inputs, all five mirror groups with exact texture footprints (pulled forward from T3), library card, and fractal style 0 renamed Folded Lace. Image input reuses `layer.image` and a numeric `input` setting instead of a new sub-object. Still to do: feedback, camera, video, and the Live look.

- `LayerKind` gains `'kaleidoscope'` (`src/shared/types.ts`); validation and defaults in `src/core/project.ts` (kind list at the `choice(...)` call, parameter definitions, default name, palette).
- `Layer.kaleidoscope?: { input: 'motif' | 'image' | 'below' | 'feedback' | 'video' | 'camera'; image?: {...same shape as Layer.image}; video?: { path: string; name: string } }`. Input-specific state lives here, not in `params`.
- New `src/rendering/kaleidoscope.ts`: material, uniforms, `drawKaleidoscope(layer, phase, input: THREE.Texture)`. `StudioRenderer.drawSource()` dispatches to it; `renderFrame()` passes `below.texture` when input is `below`.
- `prepare()` loads the image input through `loadAsset()`.
- Feedback input: a dedicated two-target ping-pong in `kaleidoscope.ts`, reusing `historyFrames()`/warm-up from `feedback.ts` so loops still close; HDR clamp each step.
- Library card and rename of fractal style 0 to "Folded Lace" (`src/ui/App.tsx:42`, `:287`, preset filter labels).
- Map: covered by the above; add the kind to `verify-map.mjs` coverage.
- Live: `kaleidoscope` look in `src/live/` reading `feed.camera`, sharing the fold GLSL; settings validation and panel controls.
- **Accept:** every input renders in Studio and Map; camera input in Live; all existing projects and presets load (`npm test` plus a load-every-preset test); no combined starter preset.

### T3. Seam-free fold core with Jacobian filtering (audit row 3, 1–1.5 weeks)

- `src/rendering/symmetry-glsl.ts`: one function per group, each returning the folded point and the 2×2 linear part of the fold so screen-space derivatives can be carried through: `D_n` (n = 2…24, mirrors only), `pmm`, `p3m1`, `p4m`, `p6m`. Written from the maths notes; no copied shader code.
- Sampling: `textureGrad(input, uv, J·dFdx(p), J·dFdy(p))` with mipmaps on the input target and anisotropy 8. Inputs are copied into a layer-owned RGBA16F target at a fixed size so mips are generated once per frame, not per tap.
- Bounds: fit the fundamental domain inside the source by default (control: "inside view" scale and offset, rotate).
- Pure-TS mirror of each fold in `src/core/symmetry.ts`, unit-tested for continuity across every fold line (max step change over a 0.002 step) and group closure, matching the Python checks in the research notes.
- Render test: 16× supersampled reference vs. 1× render of a zone plate and a photo; fold-line pixels within 1/255 of non-fold pixels.
- **Accept:** the above, plus 4K p95 ≤ 8 ms with a video or camera input on the M5 Pro (measured with T1).

### T4. Log-polar closure and three motifs (audit row 4, 4–6 days)

- Log-polar map with the integer-lattice closure from the notes: zoom by one period per loop, so phase 0 and 2π are the same picture by construction, not by crossfade. Analytic Jacobian (`dv = γ dz/z`) feeds the same `textureGrad` path; centre handled by clamping the footprint so the singularity filters to the mean instead of sparkling.
- Built-in motifs for input `motif`: line field, tile, circle parity (two-tone flower-of-life). Each is an SDF with analytic edge coverage.
- **Accept:** loop start and end within 1/255 on 99.9% of pixels; p95 ≤ 1.25× median; no centre sparkle in a zone-plate test.

### Excluded from Phase 1

Weaving, the 13 non-mirror groups, hyperbolic and spherical modes, audio, strobe and inversion controls (wait for the Phase 2 limiter), clip-matched presets.

## Decision: video file input (settled 2026-11-21: option 1)

Video is the only input with no existing path in Studio or Map, and Studio's frame-exact export is what makes it hard. Options:

1. **Preview, Map and Live only in Phase 1; export refuses with a clear message while a video input is in the project.** Adds about 3–4 days. Recommended: it delivers the live-show use, keeps Phase 1 near its estimate, and leaves export to a later task that can share decode work with Phase 4 media.
2. Full support including frame-exact export via ffmpeg decode. Adds about 1.5–2 weeks and pushes Phase 1 to 5–6.5 weeks.

Camera input follows option 1 regardless: export of a camera layer is refused.

## Order

T1 → T2 (image, below, motif scaffolding first, then feedback, then camera/video/Live) → T3 → T4. T3 can start on the image input as soon as T2's scaffolding lands.
