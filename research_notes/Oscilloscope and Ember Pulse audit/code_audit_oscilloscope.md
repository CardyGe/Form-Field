# Oscilloscope instrument: code audit of `main` (commit cd4830c)

Method and evidence labels:

- Every `path:line` citation refers to the `main` branch, read with `git show main:<path>`. The user's checkout (`map-stage-1`) was not changed. `ScopeRenderer.ts` differs between the two branches, so line numbers apply to `main` only.
- **[Measured]** means the real `main` code was extracted to a temporary folder outside the repository and run in Node 25 on this Mac. `writeClassic`, `scopeLine` and the presets are the real code. Beam light was computed with a line-for-line JavaScript port of the fragment shader (`ScopeRenderer.ts:77-95`) over the real geometry. It is not a GPU capture.
- **[Code]** means read directly from source.
- **[Inference]** means reasoned from the code and not observed on stage.
- No app was launched and no live GPU timing was taken. The only GPU timings are from an existing report dated 15 November.

## Ranked defects and limitations

### Takeaway
The beam is a sound analytic design, but its brightness model is broken in the common case. Most Classic looks have little or no speed-based brightness, Intensity does not mean what the code says, and the Ring and Afterglow are badly mis-scaled. The largest missing feature is real audio: Classic cannot draw a sound as X/Y at all.

### Cited Findings

Severity reflects the visible effect on stage for a performer.

#### Critical

**1. Brightness does not follow beam speed in most looks.**
- Evidence: the shader divides by `max(vLength, sigma*.5)` (`src/rendering/ScopeRenderer.ts:88`). Segments are usually much shorter than `sigma*.5`, because 4096 segments share a short line (`ScopeRenderer.ts:13`). Below that floor, the sum over neighbouring segments becomes `2/sigma`, whatever the speed.
- [Measured] Share of segments under the floor, across 48 phases: default 100%, Ember Ring 100%, Twin Orbit 84.7%, Signal Burst 76%, Atom 39.3%, Morse Weave 10.3%, Cyan Tangle 7.1%.
- [Measured] Slowest-15% versus fastest-15% on-line light, actual against the ideal `1/length`:

| Look | Actual | Ideal |
|---|---:|---:|
| Default | 1.00 | 4.85 |
| Ember Ring | 1.02 | 3.92 |
| Twin Orbit | 1.06 | 3.38 |
| Atom | 1.78 | 4.25 |
| Morse Weave | 2.58 | 3.30 |
| Cyan Tangle | 3.64 | 3.84 |

- On stage: the default, Twin Orbit and Ember Ring read as an evenly lit neon tube. Turning points do not flare, contrary to the README (`README.md:364`) and the plan (`docs/liquid-light-and-oscilloscope-plan-2026-11-12.md:37`).

**2. No real audio path for Classic: it cannot act as a true vector scope.**
- The line is always built from internal oscillators and `scopeWave` (`ScopeRenderer.ts:174-175`). The comments say sound "will go" there (`src/rendering/scope-curve.ts:136-139`), and the plan lists audio as a follow-up (`docs/liquid-light-and-oscilloscope-plan-2026-11-12.md:230`).
- The app already reads a 2048-sample waveform, but uses it only for RMS level (`src/react/audio.ts:95-96`). The analyser has one mono-summed path (`audio.ts:51-63`), so left and right are not available separately.
- Signals between windows are plain named numbers (`src/react/signals.ts:11-16`), so a waveform cannot use the existing route to the wall.
- The planned seam is not X/Y: one wave is added to all three axes with small delays (`scope-curve.ts:188`). It also wraps as a closed loop (`scope-curve.ts:178`), so a raw audio buffer would have a jump at the seam unless it is triggered or windowed. The only test feeds a perfectly periodic sine (`tests/scope.test.ts:150`).
- On stage: no stereo Lissajous, no oscilloscope-music playback, and no waveform that truly matches the sound.

#### High

**3. Intensity is not comparable between looks.**
- The comment says an average segment peaks at Intensity (`ScopeRenderer.ts:256-257`).
- [Measured] Median on-line light as a share of Intensity: Ember Ring 0.12, default 0.49, Twin Orbit 0.71, Morse Weave 1.03, Cyan Tangle 1.04, Atom 1.06.
- On stage: the same Intensity value can differ about ninefold in line light between looks, so switching looks causes exposure jumps. Ember Ring's line relies on bloom and ring to be visible.

**4. Ring brightness is mis-scaled against the figure.**
- The Ring is meant to match the average figure at Ring 1 (`ScopeRenderer.ts:191-192`). Its long segments escape the floor from defect 1, while the figure's do not.
- [Measured] Ring/figure light at Ring 1: Ember Ring 8.52×, default 2.04×, Twin Orbit 1.41×, Atom 0.94×.
- On stage: the rim overpowers the figure in the default and in Ember Ring.

**5. Afterglow adds far more light than designed, and is not phosphor persistence.**
- Ghost gain is multiplied by `SEGMENTS / GHOST_SEGMENTS` (2.67×) to compensate for longer segments (`ScopeRenderer.ts:199-200`). That is wrong under the floor, where light no longer depends on segment length.
- [Measured] On-line light multiplier at Afterglow 0.5 / 1.0: Ember Ring 3.25 / 5.10, default 2.30 / 2.58, Cyan Tangle 1.40 / 1.37.
- Ghosts are 8 redrawn copies at earlier phases (`ScopeRenderer.ts:195-207`). No light is kept between frames, so it is frame-rate independent, but it cannot retain anything a live signal did.
- Trail time depends on the loop: each copy is `.016 × afterglow` radians of local phase (`ScopeRenderer.ts:197`). Faster loops or more Cycles shorten the trail in seconds.
- [Measured] With Tangle, Phase drift 4 and Afterglow 1, 64.6% of neighbouring copies are farther apart than the beam's width, so the trail breaks into separate lines. Shipped looks are fine (0-2%).

**6. Whole-number controls pop when driven live.**
- Figure, Second figure, Phase drift, Tumble, Cycles, Dash count, Dash travel and Signal pitch are stepped (`src/core/project.ts:240-261`) and rounded at draw time (`scope-curve.ts:36,69-70,145,171,208`; `src/rendering/StudioRenderer.ts:628-629`).
- Studio's LFO routing excludes step-1 parameters (`project.ts:926`), but Map links allow them (`src/map/targets.ts:35-42`).
- [Measured] Line movement in one frame at 1080p, with radius 0.36:

| Change | Mean movement | Maximum movement |
|---|---:|---:|
| Normal playback frame | 1.9 px | 4.4 px |
| Signal pitch 36 to 37 | 39.2 px | 134.4 px |
| Phase drift 1 to 2 | 266.6 px | 418.8 px |
| Figure 1 to 2 | 208.5 px | 427.2 px |

- On stage: a knob or audio link on these controls makes the figure jump instead of glide.

**7. Fill cost grows with the square of Beam width, and Ember Ring is very heavy.**
- Each segment's quad extends `13.5σ` on every side (`ScopeRenderer.ts:68,263`), to fit the halo.
- [Measured] Beam-quad coverage in full-frame fills at 16:9: default 3.1, Twin Orbit 3.1, afterglow looks about 12, Ember Ring 39.3. Ember Ring at Beam width 6 reaches 108.9.
- Each covered fragment evaluates four `erf` calls and two Gaussians (`ScopeRenderer.ts:84-95`).
- The only recorded GPU timing is from `work/scope-build/verification/report.json` (15 November, 1080p): Atom 4.38 ms, Twin Orbit 4.82 ms, Morse Weave 8.37 ms, Signal Burst 8.47 ms, Cyan Tangle 8.75 ms, Ember Ring 10.62 ms. The check gates at 1080p only (`scripts/verify-scope.mjs:78`).

#### Medium

**8. Minimum beam width is wrong when the layer is scaled.**
- The floor is `.65 / height * scale` (`ScopeRenderer.ts:262`). Source space is divided by scale on the way in (`src/rendering/source-view.ts:8`), so the correct floor is `.65 / (height * scale)`.
- [Code, computed] At 1080p with Beam width 1: scale 0.25 gives a 0.35 px sigma, which can shimmer, and scale 0.05 gives 0.07 px. Scale 8 gives 41.6 px instead of the expected 11.2 px. The allowed range is 0.05-8 (`project.ts:896`).

**9. Depth fade thins the far side below the anti-shimmer floor.**
- The floor is applied before the shader multiplies sigma by up to 0.55 (`ScopeRenderer.ts:92,262`). At the floor, the far side can reach about 0.36 px.
- On stage: thin beams can crawl or sparkle on the far side of the figure.

**10. Live Map output is limited to 1080p.**
- The wall canvas and instrument sources are capped at 1920×1080 (`src/map/show.ts:73`; `src/map/compositor.ts:143-144`; `src/map/placement.ts:65-66`).
- On stage: on a 4K projector, a roughly 1.4 px-sigma line is upscaled instead of drawn natively. Studio export does support higher sizes and 2×/3× supersampling (`StudioRenderer.ts:1116-1132`).

**11. Look changes snap in Map.**
- Crossfades happen only when the source or instrument kinds change (`src/map/playout.ts:93-97`). Changing Oscilloscope look or Vary keeps the same kind, so it cuts instantly. Studio has no parameter smoothing for this either.

**12. Morph cannot be performed directly.**
- The final morph is `morph × automatic weight(phase)` (`scope-curve.ts:171`). At loop start the weight is 0, so the Morph control has no effect at that moment. There is no manual "A to B" position.

**13. The whole point buffer is uploaded every frame.**
- The buffer is 325 KB (`ScopeRenderer.ts:17,38`). `updateRanges` is empty [Measured], so three.js uploads the entire array (`node_modules/three/src/renderers/webgl/WebGLAttributes.js:87-90`). Looks with no afterglow use about a quarter of it. At 60 fps that is about 19.5 MB/s.

**14. The 4× MSAA source target gives the scope nothing.**
- The shared source target has up to 4 samples (`StudioRenderer.ts:237`), but the scope's beam is drawn to a separate non-MSAA target and only a fullscreen resolve reaches the source (`ScopeRenderer.ts:270-271,296`).
- [Computed] About 63 MB at 1080p and 253 MB at 4K for that multisample buffer, in addition to the scope's own targets (32 MB at 1080p, 95 MB at 4K, 348 MB at 8K internal for 2× supersampled 4K).

#### Low

**15. Studio does not recover from context loss.** The renderer throws (`StudioRenderer.ts:411`) and the preview reports an error (`src/ui/Preview.tsx:62`). Map handles this properly by restarting the source (`compositor.ts:386-391`).

**16. Tone mapping happens per layer, before compositing.** `1 - exp(-x)` is applied in the scope resolve (`ScopeRenderer.ts:140`), so later layer blending, Exposure and EXR export receive values already limited to 0-1. HDR headroom is lost at that point.

**17. Figures can exceed the ring.** The comment says corners stay inside (`scope-curve.ts:121`). [Measured] Maximum radius reaches 1.08-1.17× the ring in most looks.

**18. High Signal pitch loses its spectrum.** Partials clamp at 200 (`scope-curve.ts:145`) while pitch reaches 120 (`project.ts:248`). Above about 77, the top partial stops rising; above about 104, two partials sit at the same frequency.

**19. Rendering checks do not guard the light model.** `tests/scope.test.ts` covers curve maths and `scripts/verify-scope.mjs:73-78` covers looping, coverage and frame time. Nothing checks speed-to-brightness, ring balance or Afterglow energy, which is how defects 1, 3, 4 and 5 passed.

### Inferences
- A single fix to the energy model is the highest-value change. It should resolve or materially change defects 1, 3, 4 and 5 together. Existing looks will then need re-tuning, because their current appearance depends on the bug.
- Real X/Y audio is the largest capability gap and needs a new path: a stereo capture, a waveform transport to the wall, and a triggered or windowed line builder.

### Gaps
- No on-stage or GPU capture was made, so visual consequences are derived from code and measured maths.
- The 15 November timing report may predate later changes.

## How is the beam drawn, and does it behave like a phosphor trace?

### Takeaway
Geometry and anti-aliasing are good. The energy model is the weak point.

### Cited Findings
- Classic draws up to 4,096 figure segments, a 256-segment ring and 8 ghosts of 1,536 segments as instanced quads (`ScopeRenderer.ts:13-17,161`).
- Each quad integrates a Gaussian along the segment with `erf`, so joints sum seamlessly and do not need caps or miters (`ScopeRenderer.ts:77-88`). The `erf` constants match the standard Abramowitz and Stegun form.
- Light accumulates additively in a half-float target as core, halo and colour mix (`ScopeRenderer.ts:95,101`).
- Beam thickness is defined relative to frame height, so it stays proportional between sizes unless the minimum-width floor is active (`ScopeRenderer.ts:262`).
- [Measured] Ghost copies match the main line closely at high pitch (RMS error 1.8% of the ripple at pitch 120).

### Inferences
- Stair-stepping and joint artifacts are unlikely at normal scales. The real aliasing risks are defects 8 and 9.

### Gaps
- Temporal shimmer was not measured on a GPU.

## How are persistence, glow and tone mapping handled?

### Takeaway
Bloom is well built and resolution-aware. Persistence is simulated, and tone mapping is simple and compresses what speed shading remains.

### Cited Findings
- Bloom has five levels at fixed heights of 540, 270, 135, 68 and 34 lines (`src/rendering/bloom.ts:12`), with correctly normalised blur weights (`bloom.ts:79-83`). The light target has mipmaps, so reducing it into the first level is filtered (`ScopeRenderer.ts:46`; `bloom.ts:41-43`).
- The pipeline is half-float until the display stage, where sRGB and 8-bit dither are applied (`StudioRenderer.ts:132-135`). Studio banding risk is therefore low.
- Tone mapping is per-channel `1-exp(-x)` (`ScopeRenderer.ts:140`). [Computed] With Intensity 2.2 and a full red line, output is 0.562, 0.808, 0.963, 0.999 at 0.25×, 0.5×, 1× and 2× light.
- Afterglow is stateless and repeats exactly in a loop (`ScopeRenderer.ts:195-207`).

### Inferences
- At the default Intensity, a correct speed model would still clip quickly above average brightness, so exposure needs re-tuning with any energy fix.

### Gaps
- Banding after Map's 8-bit canvas upload (`compositor.ts:297`) was not inspected visually.

## How do audio, BPM, MIDI and modulation reach it, and with what latency?

### Takeaway
Classic has no direct sound input. It reacts only through Map links that change its parameters, or through tempo sync of its loop.

### Cited Findings
- The Studio sound panel appears only for Ember (`src/ui/LayerControls.tsx:172`), and the audio frame passed to the renderer is used only for Ember smoke (`ScopeRenderer.ts:214-245,286`).
- Map links can drive Classic parameters from audio bands, beat, tempo or MIDI, with attack/release smoothing (`src/react/links.ts:18-40`; `src/map/modulate.ts:76-83`). Defaults are 20 ms attack and 200 ms release (`links.ts:65`).
- Tempo sync sets loop phase from the clock (`src/map/modulate.ts:40-45`; `compositor.ts:288-289`).
- Audio is analysed with a 2048-sample window and 0.35 smoothing (`audio.ts:53`), read once per display frame (`src/react/engine.ts:93-97`), then sent to the wall by message (`src/ui/useMap.ts:444-447`).

### Inferences
- Estimated audio-to-light latency on the wall is about 60-110 ms: about 43 ms analysis window at 48 kHz (roughly half of that as effective delay), 20 ms link attack, up to two display-frame waits, and GPU presentation. This was not measured.

### Gaps
- Actual end-to-end latency needs a light-sensor or high-speed camera test.

## What are the CPU, GPU, allocation and scaling costs?

### Takeaway
CPU is fine. GPU fill is the real scaling risk, especially with wide beams at 4K.

### Cited Findings
- [Measured] `writeClassic` per frame: Twin Orbit 0.26 ms, Atom 0.27 ms, Ember Ring 0.41 ms, Morse Weave 1.43 ms, Signal Burst 2.29 ms, Cyan Tangle 2.72 ms.
- Per-frame allocation is limited to small objects: rotation arrays and a closure per `scopeLine`, a pitch array per wave, and a few small objects per draw (`scope-curve.ts:72-81,145,178`; `ScopeRenderer.ts:169-171,281-283`).
- Each frame runs the beam pass, mipmap generation, 10 bloom passes and a resolve (`ScopeRenderer.ts:270-296`; `bloom.ts:95-101`).
- Map gives each playing source its own WebGL context and renderer, up to 24 (`compositor.ts:37,380-392`), with an automatic resolution governor (`src/map/playout.ts:43`).

### Inferences
- Beam fill scales with pixels, so a look costs about 4× the beam-pass fragments at 4K compared with 1080p. Ember Ring at 4K is the highest-risk shipped look.

### Gaps
- No 4K GPU timing or multi-output timing was taken. The heap measurement was too noisy to give a reliable KB-per-frame figure.

## How stable is it?

### Takeaway
Long-run stability is good. The main stability issues are parameter pops and Studio's lack of context recovery.

### Cited Findings
- Phase wraps to 0-2π during playback, so long shows do not lose time precision (`src/core/playback.ts:9-11`).
- Non-finite frame phase is rejected (`StudioRenderer.ts:767`). Link outputs are clamped (`links.ts:38-39`) and signals must be finite (`signals.ts:15`).
- Zero-length segments are handled in the vertex shader (`ScopeRenderer.ts:66`), and the ring's divisor is protected (`ScopeRenderer.ts:192`).
- Render targets resize only when their size changes (`ScopeRenderer.ts:269`; `bloom.ts:98`).
- `ScopeRenderer` reads several parameters without fallbacks (for example `p.hueDrift`, `p.ring`, `ScopeRenderer.ts:182,192`), but project validation normally supplies them (`tests/scope.test.ts:64-76`).

### Inferences
- NaN is unlikely through normal use. The realistic stage failures are visible jumps (defects 6 and 11), not crashes.

### Gaps
- No multi-hour soak test or forced context-loss test was run.

## Are the controls musically useful for a performer?

### Takeaway
The controls are rich for designing a look but weak for playing one live.

### Cited Findings
- Classic exposes 33 instrument parameters (`project.ts:240-272`).
- Useful macro-style controls exist: Signal, Signal bursts, Dashes, Bloom and Afterglow (`project.ts:247-266`). These are continuous and safe to link, apart from their stepped companions (pitch, count, travel).
- The main motion controls are stepped: Phase drift and Tumble are whole turns per cycle (`project.ts:253,260-261`).
- Figures are 8 curated ratios with no continuous detune (`scope-curve.ts:24-33`).
- Morph has no direct position (`scope-curve.ts:171`).
- Ember Pulse shares the beam, bloom and resolve (`ScopeRenderer.ts:249-258,123-138`). Its dedicated controls and audio input are hidden in Classic (`project.ts:73-77`).

### Inferences
- The most useful performer additions would be a direct morph fader, continuous detune or phase offset, a beat-triggered flash or dash burst, independent X and Y gain, and a real stereo X/Y input.

### Gaps
- No performer testing was done. Control judgments are based on the code and parameter design.
