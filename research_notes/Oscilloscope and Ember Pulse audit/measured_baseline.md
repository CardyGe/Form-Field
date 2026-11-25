# Oscilloscope and Ember Pulse: measured baseline of `main`

Measured 2026-11-21 on `main` at commit `cd4830c`, app v0.16.0. All numbers come from the files linked beside them. Anything not measured is listed under Gaps.

## What was measured, on what hardware, and how far can the numbers be trusted?

### Takeaway
Timings ran on the real Apple M5 Pro GPU through Metal in a visible Electron window, not a software renderer. They are a valid baseline for this Mac only, and do not represent stage hardware, a real 4K output, or a machine that is otherwise idle.

### Cited Findings
- WebGL renderer string: `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)`. GPU process string: `ANGLE Metal Renderer: Apple M5 Pro, Version 26.6.2 (Build 25G83)`. WebGL and GPU compositing are both reported enabled — [env-info.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/env-info.json)
- Runtime: Electron 45.2.3, Chrome 156.0.8078.80, WebGL 2, three.js 0.187.0, macOS Darwin 25.6.0, 24 GB memory, built-in 120 Hz display — [env-info.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/env-info.json)
- Renderer quality settings: pixel ratio 1, canvas `antialias: false`, 4x MSAA on the composition target (GPU maximum 8), half-float (RGBA16F) light and bloom targets, linear output, no three.js tone mapping, 8-bit output dither — `src/rendering/StudioRenderer.ts:224-239`, `src/rendering/shaders.ts:581-583`, [env-info.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/env-info.json)
- Two timing modes were recorded. **Paced** runs on `requestAnimationFrame`, like the app, and is the number to compare against. **Unpaced** runs frames back to back and shows the lowest cost the GPU reaches — [paced.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/paced.json), [bench.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/bench.json)
- Each frame time covers `render()` plus a 1-pixel `readPixels` that waits for the GPU. A GPU fence gave matching results at 4K: plain 4.7 vs 4.9 ms, Ember Pulse 5.2 vs 5.4 ms, Ember Ring 17.6 vs 17.1 ms — [paced.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/paced.json)
- The machine was not idle: load average ranged from 3.7 to 7.0 during the runs, and other work was active. macOS recorded no thermal or performance warning — [bench.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/bench.json), [soak-ember-pulse.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/soak-ember-pulse.json)

### Inferences
- Paced frames cost up to about 2.8x the unpaced ones at 1080p (plain: 5.0 vs 1.8 ms). GPU clock scaling and compositing are likely causes, but neither was isolated.
- The added `readPixels` wait is not part of the normal app loop, so paced frame times may slightly overstate what the app itself pays.

### Gaps
- Stage hardware, external displays, projectors and capture outputs: not measured.
- True 4K presentation: not measured. 4K frames rendered at full size, then were composited into a 1280x720-point window.
- GPU timer queries were recorded but should not be used as a baseline. They often exceeded the wall-clock frame time (Ember Pulse 1080p: 4.13 ms query vs 2.2 ms unpaced), and the discrepancy was not resolved — [bench.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/bench.json)
- Power draw, GPU utilisation and sustained thermal throttling beyond the 6-minute soak: not measured.

## Do the existing tests and `scripts/verify-scope.mjs` pass on `main`?

### Takeaway
All unit tests pass. `verify-scope.mjs` is intermittent: 2 of its 3 unmodified runs died partway through, then 6 of 6 instrumented runs passed. The cause was not established.

### Cited Findings
- `npm test`: 468 of 468 TypeScript tests and 82 of 82 Electron tests passed, 0 failed, 0 skipped — [npm-test.log](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/npm-test.log)
- `verify-scope.mjs` run 1: exit 1 with `page.evaluate: Target page, context or browser has been closed` at line 46, after 7 of 11 presets — [verify-scope.log](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/verify-scope.log)
- Run 2: exit 1 with the same error after 5 of 11 presets — [verify-scope-retry1.log](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/verify-scope-retry1.log)
- Run 3: exit 0, all 11 presets, 44 captures — [verify-scope-retry2.log](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/verify-scope-retry2.log)
- Six more runs with crash logging added to a scratch copy: all exit 0 with 11 presets, 44 captures, no page errors and no child-process crash events — [verify-diag-summary.txt](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/verify-diag-summary.txt)

### Inferences
- A page crash inside the renderer is not confirmed. The two failures happened without crash logging, and the logged runs never reproduced them. Outside interference is possible because other work was active on the machine at the time, but this is unproven.

### Gaps
- Root cause of the two verifier failures: unknown.

## What are the frame times for each preset at 1080p and 4K?

### Takeaway
At 1080p every preset holds 120 fps on this Mac. At 4K all five Ember Pulse looks and the plain line hold 120 fps; **Ember Ring is the one preset below 60 fps at 4K** (56 fps, 17.7 ms median).

### Cited Findings
Paced: 8 seconds per preset after 30 warm-up frames. Unpaced: 600 frames covering the full 10-second loop. Sources: [paced.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/paced.json), [bench.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/bench.json)

**1920x1080, ms per frame (render + GPU wait)**

| Preset | Paced median | Paced p95 | Paced p99 | Paced worst | Achieved fps (120 Hz display) | Unpaced median | Unpaced p95 | Unpaced p99 | Unpaced worst |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| plain-oscilloscope | 5.0 | 7.2 | 7.8 | 8.8 | 120.0 | 1.8 | 2.4 | 2.5 | 2.6 |
| twin-orbit | 5.0 | 7.0 | 7.4 | 9.0 | 120.0 | 1.8 | 2.4 | 2.4 | 2.5 |
| atom | 4.9 | 7.2 | 7.7 | 8.5 | 120.0 | 1.7 | 2.3 | 2.4 | 2.5 |
| ember-ring | 7.0 | 8.1 | 8.6 | 9.2 | 120.0 | 5.5 | 6.6 | 6.9 | 7.4 |
| cyan-tangle | 7.4 | 8.1 | 8.5 | 9.7 | 120.0 | 4.1 | 4.4 | 4.6 | 5.4 |
| signal-burst | 7.2 | 8.2 | 8.7 | 9.7 | 120.0 | 4.4 | 5.4 | 5.8 | 6.4 |
| morse-sphere | 7.2 | 8.0 | 8.7 | 9.2 | 120.0 | 3.7 | 4.3 | 4.5 | 4.8 |
| ember-pulse | 5.3 | 7.5 | 8.1 | 9.1 | 120.0 | 2.2 | 2.8 | 2.9 | 3.0 |
| ember-glacier | 5.1 | 7.5 | 7.9 | 8.7 | 120.0 | 2.2 | 2.8 | 2.8 | 3.0 |
| ember-orchid | 5.4 | 7.4 | 7.9 | 8.5 | 120.0 | 2.2 | 2.8 | 2.9 | 2.9 |
| ember-acid | 5.2 | 7.5 | 8.1 | 8.3 | 120.0 | 2.2 | 2.9 | 3.0 | 3.4 |
| ember-silver | 5.2 | 7.6 | 8.0 | 8.6 | 120.0 | 2.3 | 3.0 | 3.2 | 3.6 |

**3840x2160, ms per frame (render + GPU wait)**

| Preset | Paced median | Paced p95 | Paced p99 | Paced worst | Achieved fps (120 Hz display) | Unpaced median | Unpaced p95 | Unpaced p99 | Unpaced worst |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| plain-oscilloscope | 6.3 | 7.3 | 7.6 | 8.1 | 120.0 | 4.8 | 5.4 | 5.6 | 5.9 |
| twin-orbit | 6.3 | 7.4 | 7.8 | 8.6 | 120.0 | 4.8 | 5.4 | 5.6 | 6.0 |
| atom | 5.9 | 7.2 | 7.7 | 8.3 | 120.0 | 4.7 | 5.3 | 5.5 | 5.6 |
| ember-ring | 17.7 | 20.6 | 21.8 | 23.3 | 56.1 | 18.4 | 21.2 | 22.2 | 23.7 |
| cyan-tangle | 9.1 | 10.3 | 10.8 | 11.2 | 107.9 | 9.3 | 10.6 | 11.3 | 11.9 |
| signal-burst | 9.7 | 11.7 | 12.5 | 13.9 | 100.5 | 9.6 | 11.7 | 12.4 | 13.2 |
| morse-sphere | 8.3 | 9.2 | 9.7 | 11.0 | 118.6 | 8.3 | 9.6 | 10.2 | 10.8 |
| ember-pulse | 7.0 | 7.7 | 8.1 | 8.5 | 120.0 | 5.3 | 5.8 | 6.0 | 6.1 |
| ember-glacier | 7.2 | 7.8 | 8.1 | 9.1 | 120.0 | 5.4 | 5.8 | 6.0 | 6.2 |
| ember-orchid | 7.0 | 7.8 | 8.1 | 8.9 | 120.0 | 5.4 | 5.9 | 6.1 | 6.4 |
| ember-acid | 6.9 | 7.8 | 8.1 | 9.0 | 120.0 | 5.2 | 5.6 | 5.9 | 6.1 |
| ember-silver | 7.2 | 7.9 | 8.2 | 8.7 | 120.0 | 5.4 | 6.0 | 6.1 | 6.4 |

- First render of a new engine took 24-30 ms at 1080p and 44-51 ms at 4K — [bench.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/bench.json)

### Inferences
- Ember Ring has the same draw count and geometry as the plain line but costs about 3x as much at 4K. Its wide beam and strong halo (`beamWidth` 3.6, `halo` 1.3) probably increase overdraw; this was not profiled per pass.
- Ember Pulse has headroom at 4K on this GPU: 7.0 ms paced median against an 8.33 ms budget at 120 Hz and 16.67 ms at 60 Hz.

### Gaps
- Sound-reactive Ember smoke was not driven, so its audio path is not included in these timings.
- Multi-layer compositions, Finish effects, and the Live and Map output paths: not measured.

## How many draw calls, render targets and how much texture memory does each preset use?

### Takeaway
Every classic preset uses 15 draw calls and 15 render targets; Ember looks use 16 of each. Estimated render-target memory is about 185 MB at 1080p and 707 MB at 4K, and it depends on resolution rather than preset.

### Cited Findings
From `renderer.info`, cross-checked against wrapped WebGL draw calls (the counts matched) — [profile.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/profile.json)

| Preset | Draw calls | Triangles | Line instances | Render targets | Est. target MB 1080p | Est. target MB 4K | three.js textures | Geometries | Programs |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| plain-oscilloscope | 15 | 8734 | 4353 | 15 | 184.6 | 706.6 | 17 | 2 | 6 |
| twin-orbit | 15 | 8734 | 4353 | 15 | 184.6 | 706.6 | 17 | 2 | 6 |
| atom | 15 | 8734 | 4353 | 15 | 184.6 | 706.6 | 17 | 2 | 6 |
| ember-ring | 15 | 8734 | 4353 | 15 | 184.6 | 706.6 | 17 | 2 | 6 |
| cyan-tangle | 15 | 33326 | 16649 | 15 | 184.6 | 706.6 | 17 | 2 | 6 |
| signal-burst | 15 | 33326 | 16649 | 15 | 184.6 | 706.6 | 17 | 2 | 6 |
| morse-sphere | 15 | 33326 | 16649 | 15 | 184.6 | 706.6 | 17 | 2 | 6 |
| ember-pulse | 16 | 11670 | 5820 | 16 | 185.8 | 707.8 | 18 | 2 | 7 |
| ember-glacier | 16 | 11670 | 5820 | 16 | 185.8 | 707.8 | 18 | 2 | 7 |
| ember-orchid | 16 | 11670 | 5820 | 16 | 185.8 | 707.8 | 18 | 2 | 7 |
| ember-acid | 16 | 11670 | 5820 | 16 | 185.8 | 707.8 | 18 | 2 | 7 |
| ember-silver | 16 | 11670 | 5820 | 16 | 185.8 | 707.8 | 18 | 2 | 7 |

- The largest single target is the 4x MSAA composition buffer. Ember adds one 528x297 smoke target at 1080p — [profile.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/profile.json)

### Inferences
- The memory column is a calculated upper estimate: width x height x bytes per texel, with MSAA counted as samples plus a resolve. Apple GPUs may store MSAA more efficiently, so real use may be lower.
- The GPU process working set stayed at 91 MB during the 1080p soaks, well below the 185 MB estimate. Working set probably does not capture all GPU-private memory, so neither figure should be read as exact GPU memory.

### Gaps
- Actual Metal allocation size: not measured.
- Per-pass GPU cost: not measured.

## Does anything leak or drift over a soak of at least 5 minutes?

### Takeaway
No leak or meaningful drift appeared in either 6-minute soak at 1080p. Geometry, texture and program counts stayed flat, and JS heap grew by about 0.1 MB.

### Cited Findings
Each soak ran 12 consecutive 30-second windows. Heap was read after a forced garbage collection — [soak-plain-oscilloscope.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/soak-plain-oscilloscope.json), [soak-ember-pulse.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/soak-ember-pulse.json)

**Plain Oscilloscope**

| Minute | Frame median | Frame p99 | Frame worst | rAF interval median | rAF worst | JS heap after GC (MB) | Geometries | Textures | Programs | GPU process MB | Renderer process MB |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 0.5 | 4.9 | 7.8 | 31.8 | 8.3 | 25.0 | 14.04 | 2 | 17 | 6 | 91 | 162 |
| 1.5 | 4.4 | 7.6 | 9.2 | 8.3 | 9.5 | 14.10 | 2 | 17 | 6 | 91 | 163 |
| 2.5 | 4.8 | 7.9 | 9.2 | 8.3 | 9.4 | 14.11 | 2 | 17 | 6 | 91 | 163 |
| 3.5 | 4.9 | 7.5 | 9.2 | 8.3 | 9.4 | 14.11 | 2 | 17 | 6 | 91 | 163 |
| 4.5 | 4.9 | 7.4 | 8.4 | 8.3 | 9.4 | 14.11 | 2 | 17 | 6 | 91 | 163 |
| 5.5 | 4.9 | 7.5 | 9.1 | 8.3 | 16.3 | 14.12 | 2 | 17 | 6 | 91 | 164 |
| 6.0 | 5.0 | 7.5 | 8.8 | 8.3 | 9.4 | 14.12 | 2 | 17 | 6 | 91 | 164 |

Total frames: 43199. GL errors: 0. Crashed child processes: 0.

**Ember Pulse**

| Minute | Frame median | Frame p99 | Frame worst | rAF interval median | rAF worst | JS heap after GC (MB) | Geometries | Textures | Programs | GPU process MB | Renderer process MB |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 0.5 | 5.2 | 8.0 | 32.5 | 8.3 | 24.9 | 14.12 | 2 | 18 | 7 | 91 | 162 |
| 1.5 | 5.4 | 8.2 | 9.5 | 8.3 | 16.7 | 14.17 | 2 | 18 | 7 | 91 | 163 |
| 2.5 | 5.3 | 8.2 | 9.2 | 8.3 | 10.6 | 14.19 | 2 | 18 | 7 | 91 | 163 |
| 3.5 | 5.4 | 8.2 | 9.1 | 8.3 | 10.4 | 14.20 | 2 | 18 | 7 | 91 | 163 |
| 4.5 | 5.4 | 8.0 | 8.9 | 8.3 | 10.4 | 14.20 | 2 | 18 | 7 | 91 | 163 |
| 5.5 | 5.2 | 8.1 | 8.6 | 8.3 | 10.4 | 14.21 | 2 | 18 | 7 | 91 | 164 |
| 6.0 | 5.3 | 8.1 | 8.6 | 8.3 | 10.4 | 14.22 | 2 | 18 | 7 | 91 | 164 |

Total frames: 43200. GL errors: 0. Crashed child processes: 0.

- The worst frame of each soak (31.8 ms plain, 32.5 ms Ember Pulse) fell in the first 30-second window — same sources.

### Inferences
- The early worst frame is consistent with first-use setup, though the specific frame was not traced.
- Six minutes rules out a fast leak. It cannot rule out a very slow one over a multi-hour show.

### Gaps
- Multi-hour soak, 4K soak, soak with sound input, and soak through the Live or Map outputs: not measured.

## Do preset switching, resizing or WebGL context loss break or pop the output?

### Takeaway
Switching and resizing are safe, with a brief one-frame cost on resize. **Context loss is a real show risk: the app's preview goes blank and stays blank after the context is restored**, even though the renderer itself can recover.

### Cited Findings
- **Switching** (12 looks, 3 cycles, 1080p): 0 blank first frames and 0 GL errors. Repeat-visit first frames had a 2.2 ms median and 4.8 ms worst. The first visit cost 28 ms for the first preset and 7.0 ms for the first Ember look — [robust.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/robust.json)
- **Resizing** (7 sizes, 3 cycles, plain and Ember Pulse): no GL errors, and the first frame at each size matched the settled frame exactly at thumbnail resolution. Worst single frame was 55.2 ms; the jump to 4K typically cost 45 ms — [robust.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/robust.json)
- **Context loss, renderer only:** while lost, `render()` throws `The GPU context was lost. Reload the renderer to resume the saved project.` After restore, the same engine rendered a frame identical to the one before loss (difference 0 at thumbnail size), with a 41-47 ms first frame — [robust.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/robust.json)
- **Context loss, real app UI with an Oscilloscope layer selected:** drawing fell from 2,040 draw calls per second to 0. The context restored, but drawing was still 0 immediately after and about 10 seconds later. The canvas stayed empty with the error toast showing — [result.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/app-context-scope/result.json), [before](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/app-context-scope/1-before.png), [after restore](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/app-context-scope/3-after-restore.png)
- Code path: the `Preview` render loop catches the error and sets `prepared.current = null`, and later frames only render when `prepared.current === state.project` — `src/ui/Preview.tsx` (render loop, lines 25-75 on `main`)

### Inferences
- The stuck preview follows from that code path: nothing re-runs `prepare` after the context returns unless the project changes. The renderer-level recovery suggests a small fix could restore output, but no fix was tried here.

### Gaps
- The real-app test used the default composition with an Oscilloscope layer in Classic mode. Selecting the Ember Pulse look in the UI failed, so Ember context loss was only tested at renderer level.
- Context loss in Live and Map outputs: not tested. Those paths have their own handlers (`src/map/compositor.ts`, `src/map/liveSlot.ts`).
- A real GPU reset or driver failure was not tested. `WEBGL_lose_context` only simulates one.

## What do the stills show about banding, clipping and aliasing?

### Takeaway
No preset clips to full white: output peaks at about 240 of 255. Lines are clean at 1080p, but Ember filaments look visibly faceted up close, and Ember Pulse is dim on average.

### Cited Findings
72 PNG stills: 12 looks at t = 0, 1.7, 3.3, 5, 6.7 and 8.3 s, at 1920x1080 — [stills folder](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/stills), [stills.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/stills.json), [still-levels.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/still-levels.json)

| Preset | Mean luma (0-255) | Peak channel | % pixels >=240 (max of 6) | % pure black |
|---|--:|--:|--:|--:|
| plain-oscilloscope | 4.1-4.4 | 230-238 | 0.000 | 56.2-56.5 |
| twin-orbit | 5.3-5.5 | 236-239 | 0.000 | 55.7-56.0 |
| atom | 5.3-5.5 | 239-240 | 0.000 | 54.9-55.5 |
| ember-ring | 26.7-27.2 | 240-240 | 0.941 | 50.0-50.0 |
| cyan-tangle | 7.0-9.4 | 241-241 | 0.028 | 62.6-64.4 |
| signal-burst | 6.1-7.5 | 240-240 | 0.083 | 48.4-49.0 |
| morse-sphere | 9.8-13.0 | 240-240 | 0.167 | 61.9-65.6 |
| ember-pulse | 1.8-5.2 | 135-240 | 0.000 | 19.0-36.8 |
| ember-glacier | 4.5-12.4 | 159-240 | 0.000 | 12.2-31.7 |
| ember-orchid | 2.3-6.9 | 153-240 | 0.000 | 11.8-31.4 |
| ember-acid | 5.7-15.3 | 157-240 | 0.000 | 18.5-36.7 |
| ember-silver | 5.9-16.1 | 152-240 | 0.000 | 17.3-35.8 |

- Contact sheets: [classic presets](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/contact-classic.png), [Ember looks](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/contact-ember.png)
- Zoom and shadow crops: [plain 4x](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/crop-zoom4x-plain-oscilloscope.png), [Ember Pulse 4x](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/crop-zoom4x-ember-pulse.png), [Ember Pulse shadows 8x](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/crop-darkboost8x-ember-pulse.png), [Ember Ring shadows 8x](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/crop-darkboost8x-ember-ring.png)
- **Clipping:** no pixel in any still reached 250 in any channel. Peak values cluster at 240-241 across presets — [still-levels.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/still-levels.json)
- **Brightness range:** Ember Pulse mean luma swings from 1.9 to 5.2 across its loop, with 19-37% of pixels pure black — [stills.json](/private/tmp/claude-501/-Users-grego--claude-spares-spare-Gbolmu/35067520-8b38-45b0-8eb6-5fb8a6fc2842/scratchpad/baseline-captures/stills.json)

### Inferences
These are visual judgements from single frames, not automated measurements.
- **Aliasing:** the plain line is smooth at 4x zoom, with a mild colour fringe and slight pixel stepping. Ember filaments show straight segments and angular corners, which reads as a polyline rather than a continuous curve.
- **Banding:** no obvious banding at normal viewing. With shadows boosted 8x, Ember Ring's glow stays broadly smooth with slight contouring, and Ember Pulse shows faint concentric arcs in the smoke that could be either smoke structure or quantisation.
- The repeated 240 peak suggests a ceiling somewhere in the output path. The scope resolve uses `1 - exp(-x)` (`src/rendering/ScopeRenderer.ts:140`), which has no hard cap at that value, so the source of the ceiling was not identified.

### Gaps
- Motion artefacts such as shimmer and temporal aliasing: not measured, because stills cannot show them.
- 4K stills, and viewing on a projector or LED wall: not captured.
- A numeric banding score: not produced. The empty-histogram check found no missing levels, which is too coarse to rule banding out.
