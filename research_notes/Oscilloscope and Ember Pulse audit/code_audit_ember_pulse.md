# Code audit: Ember Pulse on `main`

Basis: read-only audit of `main` at `cd4830c`. Citations are `path:line` on that commit, readable with `git show main:<path>`. The look was added in `d6d8afd`, `c7d08c7` and `24e8e74`, all dated 2026-11-18.

"Measured" means the three pure Ember modules from `main` were copied to a scratch folder and run in Node 25.8.1 on this Mac, with import paths and type annotations adjusted. The app was not launched, so there are no GPU timings or stage captures. Stage consequences are derived from the code.

## What are the ranked defects and limitations?

### Takeaway
The most urgent fault is a confirmed bug: every new detected beat changes the noise pattern of all live plumes still on screen. The largest design gap is that only the smoke hears the music. The filaments, rings and main light pulse follow a fixed authored timeline, which is 120 BPM at default settings.

### Cited Findings

Severity: **Critical** breaks the core promise on stage. **High** is clearly visible or risky in a show. **Medium** is visible in some setups. **Low** is cleanup.

| # | Severity | Area | Defect | Evidence | Visible consequence on stage |
|---|---|---|---|---|---|
| 1 | Critical | Beat, smoke | Live plumes have no stable shader slot. New beats are inserted at the front, moving each older plume to the next index. The shader uses that index for origin, vortex shear and noise offset. | `src/react/ember-smoke.ts:42`; `src/rendering/scope-ember-smoke.ts:40-41,92,104,107` | Every live plume changes shape in a single frame on each new beat. Measured: beat 1 moves from slot 5 to 6 to 7 to 8, and its noise offset jumps 41.5, 49.8, 58.1, 66.4. Smoke reads as re-rolled rather than continuing to curl. |
| 2 | Critical | Beat, motion | Audio reaches only the smoke. `writeEmberPoints` takes no audio input, while `drawSmoke` does. | `src/rendering/scope-ember.ts:144`; `src/rendering/ScopeRenderer.ts:214-216,249` | A kick can launch smoke while the filament body, rings and heat accent happen somewhere else in the bar. On anything other than the authored tempo, the "pulse" visibly disagrees with the music. |
| 3 | High | Beat, sync | Default phrasing cannot lock to the tempo options. Default is 5 four-beat phrases, needing a 20-beat loop, but the options are 1, 2, 4, 8 and 16 beats. Studio playback has no tempo sync at all. | `src/core/project.ts:67`; `src/map/show.ts:90`; `src/ui/Preview.tsx:43`; workaround documented at `README.md:362` | With 16-beat sync, each "four-beat" phrase lasts 3.2 beats, so accents slide across the bar. It only lines up if the operator knows to set Phrases per loop to 4. |
| 4 | High | Beat, motion | Detected-beat tempo re-anchors the clock on every onset, and Ember uses that phase with no smoothing. `beat` is the default tempo source. | `src/react/tempo.ts:36,53-56`; `src/react/engine.ts:15`; `src/map/modulate.ts:40-44`; `src/map/compositor.ts:288-289` | With tempo sync on, a syncopated kick can snap the clock by up to half a beat. At the documented 4-phrase/16-beat setting that is one eighth of a phrase, so filaments, rings and smoke visibly jump. |
| 5 | High | Smoke | The smoke is a stateless screen-space procedural field: up to 9 warped noise stamps. It has no velocity field, density history or advection. | `src/rendering/scope-ember-smoke.ts:21-44,87-120`; drawn fresh in one pass with no previous-frame input at `src/rendering/ScopeRenderer.ts:239` | Plumes cannot interact, wrap around filaments, or carry momentum from one beat into the next. They read as animated soft shapes rather than a body of smoke. |
| 6 | High | Rendering | There is no self-shadowing or light transport. Lighting is the blurred beam value at the same pixel, and density only sets opacity. | `src/rendering/ScopeRenderer.ts:129-136` | Thick smoke has no shadowed side, bright rim or internal depth. Two noise slabs give some overlap but limited volume. |
| 7 | High | Rendering, Map | Beam energy depends on render height below about 980 lines. Sigma has a pixel floor, and line light is not normalised for sigma. The Map governor can cut sources to half size. | `src/rendering/ScopeRenderer.ts:84-87,262`; `src/map/playout.ts:43`; `src/map/show.ts:73` | Small shapes look brighter and fatter than large ones. Under load at 540 lines, sigma rises from .00066 to .0012, about 1.82 times the line energy feeding bloom and smoke, so the look brightens just as quality is reduced. |
| 8 | High | Audio | Auto-gain treats a quiet noise floor as full scale once the old peak decays. The floor is only `2e-3`. The authored pulse also continues through silence. | `src/react/features.ts:30-34`; `src/rendering/ScopeRenderer.ts:95,217,244`; `src/rendering/scope-ember.ts:64-68` | In a quiet room or between sets, smoke can swell from mic noise. At the default response, full-scale bass adds 18% plume size and .28 smoke exposure. The piece never truly rests. |
| 9 | Medium | Beat, smoke | Only 4 live plumes are kept and the oldest is removed without a fade. | `src/react/ember-smoke.ts:5,43` | Measured gain at removal with Persistence 1: .088 at 128 BPM, .182 at 140 BPM, .441 at 174 BPM. Fast music at long persistence makes smoke pop out. |
| 10 | Medium | Performance | Beam cost grows with pixel count and every fragment evaluates core and halo. | `src/rendering/ScopeRenderer.ts:84-95,263` | Measured estimate at default settings: 5.8M beam fragments at 1080p and 23.1M at 4K, before bloom and compositing. This is the likely first frame-rate limit at 4K. |
| 11 | Medium | Performance | The full-resolution half-float beam target has mipmaps. | `src/rendering/ScopeRenderer.ts:45`; `src/rendering/bloom.ts:41-44` | Calculated about 88.5 MB at 4K for this target, plus about 11 MB of bloom levels, with mip generation on every update. Several Ember sources will consume VRAM quickly. |
| 12 | Medium | Smoke | Smoke resolution is capped at 528 pixels on the long side. Young fine noise is close to 2 smoke texels per cell at 1080p and 4K. | `src/rendering/ScopeRenderer.ts:235-237`; `src/rendering/scope-ember-smoke.ts:95,107-110` | At 4K the smoke is upscaled about 7.3 times. Fine wisps can look soft or shimmer next to needle-sharp filaments. |
| 13 | Medium | Variety | Authored smoke repeats exactly each loop, each slot reuses its noise domain, and all five looks share the same base settings. | `src/rendering/scope-ember-smoke.ts:5-11,107`; `src/core/project.ts:79,490` | With no audio, a default 10-second piece repeats exactly for hours. Changing preset changes colour, not behaviour. |
| 14 | Medium | Beat | Onset detection compares per-display-frame differences and considers only bass. | `src/react/beat.ts:16-27`; `src/react/engine.ts:92-97` | Sensitivity likely differs between 60 and 120 Hz displays. Tracks led by snare, percussion or sidechain bass may trigger poorly. |
| 15 | Medium | State | Live smoke state is discarded when playback pauses, or when a Map link drives Smoke or Response to 0. | `src/ui/Preview.tsx:50-51`; `src/rendering/StudioRenderer.ts:1098-1100`; `src/react/ember-smoke.ts:15-18`; `src/map/modulate.ts:31-36` | A smoke fader touching zero wipes all live plumes instead of letting them fade. |
| 16 | Medium | Reliability | Studio has no context-restore path. After a render error it clears `prepared`, stopping preview rendering until a new prepare. Map restarts a lost source after 5 seconds, from phase 0. | `src/rendering/StudioRenderer.ts:411`; `src/ui/Preview.tsx:46,62`; `src/map/compositor.ts:39,383-391` | A GPU reset stops Studio preview. In Map, the shape falls back to its fill for 5 seconds and returns at the loop start unless tempo-synced. |
| 17 | Medium | Output | The Map stage is fixed at 1920x1080, and each compositor keeps its own free-running source phase. | `src/map/show.ts:73`; `src/map/compositor.ts:143-144,289`; `src/map/placement.ts:65`; `src/ui/MapPanel.tsx:173`; `src/ui/MapOutput.tsx:21` | A 4K projector receives an upscaled Ember image. The operator preview and wall can drift apart unless tempo sync is on. |
| 18 | Medium | Beat | Smoke attack is slow relative to a kick, with no latency compensation. | `src/rendering/scope-ember-smoke.ts:27,41`; `src/react/audio.ts:53` | At default persistence, plume gain takes about 132 ms to peak, after a 2048-sample analysis window of 42.7 ms at 48 kHz. Smoke looks like a response to the kick rather than the hit itself. |
| 19 | Low | Beat | Plume strength has a narrow range of .66 to 1. | `src/react/ember-smoke.ts:42` | Soft and hard hits look similar. |
| 20 | Low | Performance | The full point buffer is marked for upload though Ember uses about a third, and each frame makes small allocations. | `src/rendering/ScopeRenderer.ts:37,41,254,282`; `src/rendering/scope-ember-smoke.ts:29-38`; `src/react/ember-smoke.ts:37` | Measured 5,800 average points against capacity for 16,650. The full buffer is 333 KB, and no partial update range is set. Minor garbage-collection and bandwidth cost. |
| 21 | Low | Routing | Echo and slit-scan source paths call `drawSource` without the audio frame. | `src/rendering/StudioRenderer.ts:790-792,888`; `src/rendering/feedback.ts:80-87`; `src/rendering/slitscan.ts:18-24` | If those finishes are enabled on Ember, live plumes disappear from that layer. |

### Inferences
- Fix order should be 1, then 2 to 4, because they determine whether Ember feels like it is playing with the music. Items 5 and 6 are the main visual-quality upgrade, and they should stay inside Ember's own renderer.
- Item 1 may be partly hidden in casual viewing because the jump lands on a beat, but it undermines the rolling-smoke effect that `24e8e74` set out to add.
- Existing tests would not catch item 1. They cover one live beat, not whether an existing plume keeps its slot after another arrives (`tests/scope.test.ts:259-279`).

### Gaps
- Actual severity on real music, real GPU cost and any visible shimmer need an in-app capture with a known audio track.

## What is Ember Pulse doing each frame, and what kind of smoke is it?

### Takeaway
Each frame is a pure function of loop phase plus an optional small live-beat state. The smoke is procedural domain-warped noise in screen space, not a simulation or advected texture.

### Cited Findings
- The CPU fills a line buffer with up to 48 filament strands of 112 segments, 2 low-detail trails, up to 9 travelling ring paths and 2 outer contours — `src/rendering/scope-ember.ts:4-8,144-183`.
- Measured geometry: 5,800 points on average and 6,256 peak at default settings, 7,952 with the relevant controls maxed, against capacity for 16,650 — probe of `writeEmberPoints`.
- The GPU pass order is beam, 5 bloom levels with 2 blur passes each, smoke, then resolve — `src/rendering/ScopeRenderer.ts:269-296`; `src/rendering/bloom.ts:93-103`.
- Smoke has 5 authored puffs and up to 4 live puffs — `src/rendering/scope-ember-smoke.ts:5-13`; `src/react/ember-smoke.ts:5`.
- Each puff is an ellipse, warped by two fixed vortices, with three octaves of value noise plus a rear slab — `src/rendering/scope-ember-smoke.ts:94-119`.
- Smoke resolution is `min(.5, 528 / longSide)`, so it is 528x297 for both 1080p and 4K at 16:9 — `src/rendering/ScopeRenderer.ts:235-237`.

### Inferences
- "Rolling" is a time-parameterised distortion. Density is not transported or conserved from frame to frame.

### Gaps
- None for the code path.

## Does it look volumetric?

### Takeaway
It has convincing ingredients for a stylised glow, including HDR light, soft extinction and two depth slabs, but it lacks the shadowing and density-dependent colour that make smoke feel volumetric.

### Cited Findings
- Density has front, rear and edge channels — `src/rendering/scope-ember-smoke.ts:113-119`.
- Beams are attenuated by front smoke through Beer-Lambert-style transmission, so smoke can partly hide filaments — `src/rendering/ScopeRenderer.ts:132-136`.
- Smoke colour is one tint plus a small hot-colour contribution, with no ramp by density, age or temperature — `src/rendering/ScopeRenderer.ts:133,289-292`.
- Tone mapping is `1 - exp(-sum)` per channel — `src/rendering/ScopeRenderer.ts:140`.
- Internal targets are half-float, and display output has sub-LSB dither, which reduces banding risk — `src/rendering/bloom.ts:41-44`; `src/rendering/shaders.ts:581-583`.
- The noise is value noise on an axis-aligned lattice, and octaves are not rotated relative to each other — `src/rendering/scope-ember-smoke.ts:61-65,108-110`.
- There is no tiling texture; the noise is evaluated procedurally — `src/rendering/scope-ember-smoke.ts:55-66`.

### Inferences
- Per-channel roll-off will push dense highlights toward white and can shift hue on saturated palettes, which suits the hot core but limits colour retention in bright smoke.
- Banding is a lower risk in Studio than repetition or softness. The Map path is less certain because each source passes through an 8-bit canvas before compositing (`src/map/compositor.ts:296-297`).

### Gaps
- Blown highlight area and banding were not measured from rendered frames.

## How does the pulse work?

### Takeaway
There are two unsynchronised pulse systems: a fixed authored bar for everything, and live beat plumes for the smoke only.

### Cited Findings
- The authored bar uses hard-coded accent envelopes — `src/rendering/scope-ember.ts:23-36`.
- Measured body peaks fall at beats 0.00, 1.00, 2.07, 3.08 and 3.93 of a 4-beat bar — probe of `emberPhrase`.
- Default duration is 10 seconds with 5 phrases, or 2 seconds per phrase, equivalent to 120 BPM — `src/core/project.ts:67,623`.
- Audio analysis uses FFT 2048 with analyser smoothing .35, read once per animation frame — `src/react/audio.ts:53,89-97`; `src/react/engine.ts:92-97`.
- An onset needs a bass flux rise over an adaptive threshold, with a 0.25-second minimum gap — `src/react/beat.ts:5,27`.
- Beat pulse decays with a .15-second constant. Smoothed bass has 55 ms attack and 380 ms release; highs have 55 ms attack and 200 ms release — `src/react/beat.ts:36`; `src/react/ember-smoke.ts:22-23,35-36`.
- Live beats emit once by watching `beat.count`, and infer age to absorb skipped frames — `src/react/ember-smoke.ts:38-45`.
- With no audio engine or while paused, only the authored smoke draws — `src/ui/Preview.tsx:50-51`; `src/rendering/StudioRenderer.ts:1098-1101`.
- When the input is lost, audio signals disappear and smoothing falls away, per the tested quiet path — `src/react/engine.ts:106-117`; `tests/scope.test.ts:275-278`.
- On the wall, stale signals are cleared after a timeout — `src/ui/MapOutput.tsx:58`.

### Inferences
- Unstable tempo mostly affects Map tempo sync, through re-anchoring and median BPM changes. Free-running Ember ignores tempo, so it remains stable but unsynced.

### Gaps
- End-to-end audio-to-photon latency was not measured.

## Is it frame-rate independent, deterministic and durable?

### Takeaway
The authored look is strong here: deterministic, seekable and free of accumulating simulation state. Live audio is intentionally not exported, and recovery from context loss is the weak spot.

### Cited Findings
- Geometry is documented as independent of play order, and tests cover loop equality and seeking — `src/rendering/scope-ember.ts:143-145`; `tests/scope.test.ts:196-212`.
- Exports call `renderFrame` without smoke audio, and the UI states that exports use the repeating phrase — `src/rendering/StudioRenderer.ts:1118,1123`; `src/ui/App.tsx:537`.
- Live smoke envelopes are time-based, with `dt` clamped to .12 seconds — `src/react/ember-smoke.ts:22-23,32`.
- Preview playback clamps a frame step to 0.1 seconds, so long stalls slow time instead of skipping — `src/ui/Preview.tsx:43`.
- Render targets are resized when dimensions change — `src/rendering/ScopeRenderer.ts:238,269`; `src/rendering/bloom.ts:98`.
- The renderer disposes its geometry, materials and targets — `src/rendering/ScopeRenderer.ts:299-302`.
- Beat history and live puffs are bounded — `src/react/beat.ts:20-21,30`; `src/react/ember-smoke.ts:37,43`.

### Inferences
- No hours-long numerical drift is apparent in Ember's own state because phase wraps and arrays are bounded. A real soak test is still needed for GPU driver and Electron behaviour.

### Gaps
- No soak test, context-loss test, or preset-switch stress test was run.

## What are the CPU, GPU and output costs?

### Takeaway
CPU cost is modest for one source. At 4K, beam overdraw and memory are the main concerns, and Map output is currently limited by its 1080p stage.

### Cited Findings
- Measured `writeEmberPoints`: 1.44 ms per frame at default settings and 1.98 ms with controls maxed, single-threaded in Node.
- Ember uses 12 half-float targets inside `ScopeRenderer`: 1 beam, 10 bloom, 1 smoke — `src/rendering/ScopeRenderer.ts:45-47`; `src/rendering/bloom.ts:72`.
- Each frame runs at least 13 Ember passes before layer compositing: 1 beam, 10 blur, 1 smoke, 1 resolve — `src/rendering/ScopeRenderer.ts:269-296`.
- Studio preview is capped near 8.3 megapixels — `src/rendering/preview-size.ts:6`.
- Map sources are drawn once at the largest landing size, in steps of 16 pixels, capped to the stage — `src/map/compositor.ts:292-296`; `src/map/placement.ts:53-66`.
- Each Map source has its own canvas and `StudioRenderer`, and uploads its canvas to the compositor — `src/map/compositor.ts:382,392,296-297`.
- The compositor allows 24 live instruments — `src/map/compositor.ts:37`.

### Inferences
- At the measured CPU cost, 10 distinct Ember sources would use roughly 14 ms of main-thread time for geometry alone, consuming most of a 60 fps budget. Reusing one source across shapes is much cheaper because it is drawn once.

### Gaps
- GPU frame time, VRAM use and thermal behaviour on the target Mac were not measured.

## Are the controls useful to a performer and an installation operator?

### Takeaway
The controls describe the look well, but they do not yet give a performer direct command of the pulse, or an installation operator a reliable idle behaviour.

### Cited Findings
- Ember has 18 dedicated parameters: 9 shown by default and 9 marked advanced — `src/core/project.ts:51-68`.
- Smoke has its own audio-response slider, but no attack, release, threshold or beat-division control — `src/core/project.ts:59`; `src/react/ember-smoke.ts:22-23,39`.
- Pulse depth controls the authored contrast and does not make filaments follow the input — `src/core/project.ts:53`; `src/rendering/scope-ember.ts:65-68,144`.
- Phrases per loop cannot be linked in Map — `src/map/targets.ts:35-37`.
- The one-click Map reaction for Ember targets Opening — `src/map/targets.ts:93`.
- The five Ember looks are palette variations with the same settings — `src/core/project.ts:81-86,490`.
- The Colour scheme menu changes the palette independently — `src/ui/LayerControls.tsx:183-185`.
- Audio input setup is available from an Ember section in Studio and through Sound & MIDI in Map — `src/ui/App.tsx:535-538`; `README.md:362`.

### Inferences
- Performers would benefit most from separate filament, ring and smoke beat amounts, plus a manual "launch plume" trigger.
- Installation operators need a silence policy, such as hold, breathe or dim, and a noise gate, because the current look keeps pulsing and auto-gain can amplify room noise.
- These controls can all live within Ember Pulse. Nothing in this audit requires merging it with another effect.

### Gaps
- No user testing or live-show feedback was available.
