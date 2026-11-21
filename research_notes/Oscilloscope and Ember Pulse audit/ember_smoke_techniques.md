# Ember Pulse: State-of-the-Art Real-Time Ember, Fire, Glow and Smoke Techniques (WebGL2 / three.js)

Research date: 2026-11-21. Scope: Ember Pulse as its own separate look. Techniques are studied here; no other product's look, presets or assets should be reproduced.

Evidence labels used throughout:
- **Cited Findings** come from a source opened or returned in this research.
- **Inferences** are engineering judgement or arithmetic from this research. They have not been tested in the app.
- **No GPU timing was measured.** Every cost figure for Ember Pulse below is a count of pixel writes, which predicts relative load only. Real milliseconds must be profiled on the show machine.

Repo facts checked locally (branch `map-stage-1`, commit 78e6f20 plus uncommitted work):
- No source file, doc or README mentions "Ember Pulse" by name. Existing presets `ember-ring`, `ember-cells` and `ember-julia` are different looks (`src/core/project.ts`).
- three is pinned at 0.187.0, MIT licence (`node_modules/three/package.json`, `LICENSE`).
- `LiveRenderer` sets `renderer.toneMapping = THREE.NoToneMapping` (`src/live/LiveRenderer.ts:76`), so Ember Pulse must apply its own tone curve in its display shader.
- `src/live/passes.ts` already provides half-float RGBA targets, linear or nearest filtering, MRT and ping-pong pairs.
- A search of `src` found no use of `getOutputTimestamp`, `outputLatency`, `getByteFrequencyData`, `getFloatFrequencyData` or `AudioWorklet`. Audio analysis for pulses would need to be added or supplied through a path this search did not identify.

## Simulation options: which solver, advection, confinement, pressure budget and combustion model?

### Takeaway
Use a low-resolution 2D stable-fluids core with a limited MacCormack step for temperature and smoke, semi-Lagrangian velocity, vorticity confinement and a capped warm-started Jacobi solve, with curl noise added as cheap detail. Keep a pure flow-map or curl-noise mode as the safe fallback tier.

### Cited Findings
**Stable fluids and the base loop**
- The GPU Gems step is advection, diffusion, force application, then projection; semi-Lagrangian backtrace with bilinear lookup is stable for arbitrary time steps and velocities — [GPU Gems ch. 38](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
- Boundaries there use no-slip velocity (copy interior × -1) and pure Neumann pressure (copy interior × 1) — [GPU Gems ch. 38](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
- Fedkiw, Stam and Jensen use the inviscid Euler equations and add vorticity confinement to restore small rolling features lost on coarse grids — [Visual Simulation of Smoke](https://www.graphics.stanford.edu/papers/smoke/)
- Later work notes that confinement cannot recover detail the grid does not resolve and adds energy without being physically exact — [Wavelet-turbulence-related preprint](https://gamma.cs.unc.edu/turbulence/preprint.pdf)

**Advection**
- MacCormack uses two intermediate semi-Lagrangian steps, is not unconditionally stable alone, and needs a limiter that clamps to the min/max of the nearest grid nodes — [GPU Gems 3 ch. 30](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids)
- Selle et al. show MacCormack estimates error the way BFECC does while dropping BFECC's third advection step, retaining second-order accuracy at lower cost — [Selle et al. abstract](https://www.academia.edu/13497521/An_Unconditionally_Stable_MacCormack_Method)
- GPU Gems 3 argues that because "math is cheap compared to band-width", higher-order schemes can often add more detail than a higher-resolution grid — [GPU Gems 3 ch. 30](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids)

**Pressure budget**
- GPU Gems ch. 38 typically uses 40 to 80 Jacobi iterations and warns it is "not a good idea to go below 20" — [GPU Gems ch. 38](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
- GPU Gems 3 compares 20 vs 1,000 iterations on a flame: vortices "flatten out" somewhat but the overall look is similar; liquids are far more sensitive — [GPU Gems 3 ch. 30](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids)
- Dobryakov's widely used WebGL fluid defaults: sim 128, dye 1024, 20 pressure iterations, pressure carry-over 0.8, curl 30, velocity dissipation 0.2, density dissipation 1 — [script.js](https://raw.githubusercontent.com/PavelDoGreat/WebGL-Fluid-Simulation/master/script.js)

**Combustion**
- The GPU Gems 3 fire model advects a reaction coordinate (1 = just ignited, below 0 = exhausted), decrements it by constant *k*, and maps it to colour through an artist-defined 1D texture. It does not feed back into dynamics — [GPU Gems 3 ch. 30](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids)
- Nguyen, Fedkiw and Jensen model vaporised fuel and hot products separately, with hot products and smoke rising by buoyancy, rendered with blackbody radiation — [Physically Based Modeling and Animation of Fire](https://graphics.stanford.edu/papers/fire-sg02/)
- Curl-noise and fluid solvers are both exposed as production controls: Notch's Fluid Affector has grid size and a Curl Noise mode — [Notch manual](https://manual.notch.one/2026.1/en/docs/reference/nodes/procedurals/displacement/fluid-affector/)

### Inferences
**When each option wins**

| Option | Wins when | Loses when | Relative cost |
|---|---|---|---|
| Curl noise / flow map only | Fallback tier, 4K on weak GPU, always-stable idle | Needs a real response to impulses; motion can look looped | Lowest; no solve |
| Semi-Lagrangian everything | Velocity field, low-tier mode | Smoke and temperature smear quickly | 1 pass per field |
| MacCormack + limiter | Temperature and smoke, where crisp detail shows | Applied to velocity it can add energy and flicker on a noisy input | About 3 lookups per field |
| BFECC | Rarely justified here | Adds a third advection for little visible gain | Highest of the three |
| Vorticity confinement | Coarse grids that need curl | High values look wiry and inject energy; scale down during hits | 2 small passes |
| Reaction-coordinate fire | Full art control, robust | Flames do not expand on burn | Adds 1 scalar |
| Fuel + temperature + smoke | Fuel burns into heat, then soot; convincing ember life | More parameters to keep stable | Fits in one RGBA target |

**Recommended Ember Pulse model** (to prototype, not validated)
- Fields: `velocity.xy` plus `pressure` at sim resolution; `T` (temperature), `F` (fuel), `S` (smoke) and optional `age` in one RGBA16F target at dye resolution.
- Step order: advect velocity → apply buoyancy `(αT − βS)ŷ` → confinement → impulses → divergence (add a small expansion term where fuel burns) → pressure solve → subtract gradient → advect `T/F/S` with limited MacCormack → burn and cool.
- Burn: `burn = min(F, rate·dt)·smoothstep(Tignite, Tignite+w, T)`; `F -= burn`; `T += heat·burn`; `S += soot·burn`.
- Cooling: a mild `T⁴`-shaped radiative term plus exponential cooling gives a bright core that falls quickly and a long dull-red tail. This is a stylised approximation.
- Pressure: start at 16 to 24 Jacobi iterations with previous pressure × about 0.8. This is below the classic GPU Gems guidance, but fire tolerates it and Dobryakov's default shows 20 works visually for 2D.
- Drop iterations before dropping resolution when the frame budget is exceeded, because the GPU Gems 3 comparison suggests the look degrades gently.

**Write-count budget** (arithmetic; assumes `cells × (Jacobi + 5)` for sim passes, plus 2 dye-resolution writes)

| Tier | Sim grid | Jacobi | Dye | Writes per step | vs one 1080p fill | vs one 4K fill |
|---|---|---|---|---:|---:|---:|
| Safe | 256×144 | 16 | 960×540 | 1.81 M | 0.87 | 0.22 |
| Standard | 384×216 | 24 | 1280×720 | 4.25 M | 2.05 | 0.51 |
| High | 512×288 | 32 | 1920×1080 | 9.60 M | 4.63 | 1.16 |

Limited MacCormack adds further dye-resolution passes, so High is not a sensible default. Simulation cost is independent of output resolution, which is the main reason to keep it fixed and upscale for 4K.

### Gaps
- Bridson's curl-noise paper was retrieved but could not be parsed (no PDF tools available), so its boundary treatment is not cited here. [PDF](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf)
- No measured WebGL comparison of Jacobi, red-black or multigrid was found. Multigrid is not recommended without a benchmark.
- No source quantified MacCormack versus semi-Lagrangian GPU cost; GPU Gems 3 gives no numeric comparison.

## Volumetric look on a 2D or 2.5D budget: slices, integration, shadowing, phase, froxels and raymarching?

### Takeaway
Do not raymarch a real 3D volume for Ember Pulse. Treat the 2D field as a thin emissive-absorbing slab, with Beer-Lambert optical depth and a short 4 to 8 tap light march at half resolution, then add parallax through 3 to 5 displaced slices if depth is needed.

### Cited Findings
- GPU Gems 3 marches at half-voxel steps, blends front to back, exits when alpha passes 0.99, and reduces banding with an extra weighted sample; *Hellgate: London* used jittered trilinear sampling at twice per voxel — [GPU Gems 3 ch. 30](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids)
- For fire, GPU Gems 3 accumulates values based on the reaction coordinate instead of blending density, and suggests a very low-resolution downsample of the volume as a light source — [GPU Gems 3 ch. 30](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids)
- The Nubis lighting model combines Beer-Lambert `exp(-density along light ray)`, Henyey-Greenstein phase and a powder term `1 - exp(-density)` for dark edges — [Nubis slides](https://www2.slideshare.net/guerrillagames/nubis-realtime-volumetric-cloudscapes-in-a-nutshell)
- A Nubis deck reports stages falling from 60+ ms to 22, 3.34 and then 1.2 ms through parallelisation, march optimisation and excluding hidden pixels — [Nubis slides](https://www2.slideshare.net/guerrillagames/nubis-realtime-volumetric-cloudscapes-in-a-nutshell)
- A related paper states that this kind of cloud rendering needs about 128 view steps with about 6 light steps per pixel for good results, and targets an order of magnitude fewer — [Optimisations for Real-Time Volumetric Cloudscapes](https://arxiv.org/pdf/1609.05344)
- Wronski's AC4 volumetric fog totals about 1.1 ms on Xbox One, with 0.43 ms lighting and density, 0.116 ms scattering solve and 0.247 ms applying to screen — [AC4 GDC deck](https://bartwronski.com/wp-content/uploads/2014/03/ac4_gdc.pdf)
- Frostbite contrasts non-energy-conserving accumulation with an analytic integration that reduces light leaking around volumetric shadows — [Hillaire 2015](https://www.ea.com/news/physically-based-unified-volumetric-rendering-in-frostbite); [Hillaire 2016 PDF](https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf)

### Inferences
**Technique fit for Ember Pulse**

| Technique | Verdict | Reason |
|---|---|---|
| Single-layer optical depth | Baseline | One lookup; dense soot can occlude the glow |
| Short light march in 2D | **Recommended** | 4 to 8 taps toward a virtual light give self-shadowed smoke |
| 3 to 5 parallax slices | Optional | Reuses the same field with offsets and blur; reads as depth |
| Full slice stack / 3D sim | Avoid by default | Memory and fill grow rapidly |
| Froxels | Avoid | Designed for camera-space scene fog with many lights; Ember Pulse has neither |
| Full raymarch | Avoid | The ~128×6 baseline shows why; even reduced it competes with the sim |

**Shading sketch** (per pixel, half resolution for 4K)
```glsl
float tau = sigmaT * S;                      // view optical depth
float Tr = exp(-tau);                        // Beer-Lambert
float tauL = marchToLight(uv, 6);            // jittered taps
float beer = exp(-sigmaT * tauL);
float powder = 1.0 - exp(-2.0 * tauL);       // artistic dark-edge term
vec3 smoke = smokeAlbedo * ambient * (1.0 - Tr)
           + smokeAlbedo * lightColor * phaseHG(cosTheta, g) * beer * powder * (1.0 - Tr);
vec3 fire = blackbody(T) * emissionGain * (1.0 - exp(-emissiveDepth));
vec3 hdr = fire * mix(1.0, Tr, soot_occlusion) + smoke;
```
- Light the smoke from the fire as well: blur `T` heavily (the low-res-light idea from GPU Gems 3) and add it to in-scattering. This is the single cheapest cue that makes smoke feel lit from within.
- Use `g` around 0.3 to 0.6 as a starting range and keep it an art control. In a fixed 2D view, phase mostly acts as a directional brightness bias.

### Gaps
- No published 2D-slab ember renderer with timings was found. The shading sketch is a synthesis and needs visual testing.
- Wronski's SIGGRAPH 2014 [deck](https://www.advances.realtimerendering.com/s2014/wronski/bwronski_volumetric_fog_siggraph2014.pdf) timing table was not read; the 1.1 ms figure is from the AC4 GDC deck.
- The exact Frostbite integral was not read from the appendix, so it is not reproduced.

## Colour: blackbody, emission vs scattering, HDR, tone mapping, banding and deep blacks?

### Takeaway
Keep emission and smoke separate in linear HDR, drive emission from a baked blackbody LUT with art-directable exposure, tone-map in the Ember display pass, then dither after the transfer function. Protect black with an explicit floor and threshold rather than relying on the tone curve.

### Cited Findings
- Blender's blackbody code integrates Planck's law against CIE matching functions from about 800 K to 12,000 K, stores a 317-entry table (about 5 KB) and reports accuracy within 0.1%; the file carries the Sony Imageworks BSD-style licence — [Blender blackbody.cpp](https://projects.blender.org/archive/blender-archive/raw/commit/1dfd82d2bcdd28e6230878d643c19b93a31cb4cd/intern/cycles/render/blackbody.cpp)
- ColorAide documents computing the Planckian locus from colour matching functions, which is useful for validating a baked ramp — [ColorAide](https://facelessuser.github.io/coloraide/temperature)
- three r187 ships Linear, Reinhard, Cineon, ACES Filmic, AgX and Neutral tone mapping. Its AgX is "based on Filament", which is based on Blender's implementation, working through Rec.2020 primaries — [three.js r187 source](https://raw.githubusercontent.com/mrdoob/three.js/r187/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js)
- three's ACES is modified for a brighter viewing environment and multiplies exposure by a subjective `1/0.6` — [three.js r187 source](https://raw.githubusercontent.com/mrdoob/three.js/r187/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js)
- three's AgX and other tone mappers target LDR displays — [three.js PR #27413](https://github.com/mrdoob/three.js/pull/27413)
- AgX Base is less saturated than ACES Filmic by design, so scenes lit for ACES can look flatter after switching — [three.js forum](https://discourse.threejs.org/t/is-agx-tonemapping-implemented-correctly/60609)
- WebGL2's `EXT_color_buffer_float` enables float16 and float32 rendering; float16 blending is always supported, while float32 blending requires `EXT_float_blend`; framebuffer completeness must be checked — [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- GPU Gems 3 reports 32-bit float textures yield "roughly half the performance" of 16-bit in its context — [GPU Gems 3 ch. 30](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids)
- Gjøl recommends noise at shader outputs as the usually easiest banding fix and covers triangular-PDF noise; for blended output he reports needing around 10× more noise in alpha than RGB — [Gjøl, Banding](https://pixelmager.github.io/linelight/banding)
- Wronski reports triangular noise removes bands without over-noising and advises against ordered Bayer patterns, preferring blue noise where possible — [Wronski, Dithering part three](https://bartwronski.com/2016/10/30/dithering-part-three-real-world-2d-quantization-dithering/)

### Inferences
**Pipeline order**
1. Simulate and shade in linear RGBA16F. Do not use float32 unless a specific field proves it needs it.
2. `T → blackbody LUT → emission`, normalised so the art exposure is stable. True Planck radiance spans a huge range, so use the LUT for **chromaticity** and a separate authored intensity curve.
3. Composite smoke and emission.
4. Bloom in HDR.
5. Tone map, then apply black floor, then encode to display.
6. Add TPDF blue-noise dither of about ±1 LSB **after** encoding, last in the chain.

**Tone-map choice for Ember Pulse**

| Curve | Character for fire | Recommendation |
|---|---|---|
| AgX | Hot cores desaturate gracefully toward white; less punchy | **Default**, with a small contrast and saturation look on top |
| ACES (three) | Punchy, contrasty, can skew hot oranges | Offer as "Hot" look only |
| Neutral | Preserves hue and saturation | Useful for saturated LED walls; test clipping |
| Custom ember curve | Full control of toe and red rolloff | Best long-term option if AgX lacks punch |

The app runs `NoToneMapping`, so setting `renderer.toneMapping` will not solve this. Port or include the chosen curve in the Ember display shader.

**Deep blacks on projectors and LED**
- Use a thresholded toe: `rgb = max(rgb - blackFloor, 0.0) / (1.0 - blackFloor)` after tone mapping, with `blackFloor` as a venue control.
- Fade smoke's ambient term to true zero at low density. Smoke with constant ambient lifts the entire frame, which is very visible on a projector.
- Apply dither **conditionally** near zero (scale it by a smoothstep on luminance) so the black background stays exactly `0`. On LED walls, a noisy near-black can show as sparkling pixels.
- Provide a peak limit too. Large full-frame white flashes on a pulse are harsh on LED walls and a safety concern for audiences, so limit full-frame luminance change per pulse.

### Gaps
- No primary source was found that measures AgX vs ACES hue skew on fire specifically. The table is qualitative and should be checked with a rendered test ramp.
- No authoritative source on LED-wall black-level processing was retrieved. The black-floor guidance is engineering judgement and needs testing on target hardware.
- HDR display output is out of scope: three's tone mappers target LDR.

## Sparks and embers: GPU particles, streaks, cooling curves and field coupling?

### Takeaway
Use texture-state GPU particles with instanced velocity-aligned quads, sampling the sim velocity with a drag model so sparks lag and then follow the flow. Colour them from a per-particle cooling temperature through the same blackbody ramp as the fire.

### Cited Findings
- WebGL2 transform feedback captures vertex outputs to a buffer and ping-pongs read and write buffers, keeping particle state on the GPU — [gpfault WebGL2 particles](https://gpfault.net/posts/webgl2-particles.txt.html)
- WebGL2 forbids a buffer being bound for transform feedback and as an array buffer at the same time — [gpfault WebGL2 particles](https://gpfault.net/posts/webgl2-particles.txt.html)
- Point sprites are convenient, but some GPUs refuse very large ones; textured quads are more robust — [gpfault WebGL2 particles](https://gpfault.net/posts/webgl2-particles.txt.html)
- The Notch particle fluid docs show FLIP and SPH as particle-based alternatives, with FLIP described as less detailed but more stable — [Notch FLIP Affector](https://manual.notch.one/2026.2/en/docs/reference/nodes/particles/affectors/fluid-flip-affector/)

### Inferences
**State.** Prefer a float texture over transform feedback here, because `passes.ts` already handles float pairs and vertex shaders can fetch from it. Use two RGBA32F MRT attachments: `pos.xy, age, seed` and `vel.xy, temp, size`. Particle state needs float32 precision, unlike the fields. It is written without blending, so `EXT_float_blend` is not required for the update.

**Motion**
```glsl
vec2 fluid = texture(uVelocity, pos).xy;
vel += (fluid - vel) * (1.0 - exp(-drag * dt));   // frame-rate independent coupling
vel.y += buoyancy * temp * dt;
vel += curlNoise(pos * f, t) * flutter * dt;
pos += vel * dt;
```
Vary `drag` per particle. Light ash follows the flow closely, while heavy sparks fly ballistically and curve late.

**Streak rendering**
- Instanced quad from `prevPos` to `pos`, with length clamped to a max pixel length. Width should stay at least about 1.2 output pixels, scaled by resolution, to avoid crawling at 1080p.
- Use a soft capsule profile with additive HDR output so that bloom produces the glow. Fade energy by `1/length` so that faster sparks do not get brighter simply from covering more pixels.

**Cooling and lifetime**
- `temp(t)` as a fast exponential plus slow tail, e.g. `T = Tamb + (T0 - Tamb) * (0.7*exp(-t/τfast) + 0.3*exp(-t/τslow))`.
- Colour runs white-yellow → orange → deep red → off. Add a small per-particle flicker near the end for dying embers.
- Starting counts: 2k to 5k on-screen at Safe, 10k to 20k at High. Overdraw, not count, sets the limit, so keep sparks thin.
- Respawn from high-`T` cells by random-sampling the temperature field and rejecting cold samples. This ties sparks to the visible form without a CPU readback.

### Gaps
- No primary source on velocity-aligned spark streaks or cooling curves was found; the design above is engineering practice and needs visual tuning.
- Particle-count limits are starting values, not benchmarks.

## Pulses that feel musical: transients, envelopes, injection, rings, latency and no-audio behaviour?

### Takeaway
Detect onsets with a compact band-wise spectral flux and adaptive threshold, then convert each onset into a fast-attack, slower-release envelope that drives separate heat, velocity and pressure-ring impulses. Timestamp events on the audio clock, and run a low-energy "breathing" idle whenever audio is absent.

### Cited Findings
- SuperFlux computes a spectrum, reduces to triangular filter bands and takes spectral flux with a maximum filter — [Essentia SuperFluxExtractor](https://essentia.upf.edu/reference/std_SuperFluxExtractor.html)
- Essentia's peak picker uses a moving-average look-back window (default 100 ms) plus a relative threshold — [Essentia SuperFluxPeaks](https://essentia.upf.edu/reference/std_SuperFluxPeaks.html)
- Böck, Krebs and Schedl find that with the right parameters, online onset detection can reach a performance range similar to offline methods, and that preprocessing noticeably helps — [ISMIR 2012 paper](https://archives.ismir.net/ismir2012/paper/000049.pdf); [record](https://zenodo.org/records/1416036)
- One real-time onset paper states that accepted latency is generally below 10 ms and that short windows make this difficult because of spectral leakage — [Minimum-latency time-frequency analysis](https://arxiv.org/pdf/1606.09047)
- `AnalyserNode.smoothingTimeConstant` defaults to 0.8 and averages with prior frames; 0 disables time averaging — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/smoothingTimeConstant)
- `AudioContext.outputLatency` estimates the delay from the audio graph to the output device, and is Baseline 2025, so it must be feature-detected — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)
- `getOutputTimestamp()` returns matching `contextTime` and `performanceTime` values, linking the audio clock to the page clock — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp)

### Inferences
**Detector.** Run in an `AudioWorklet` if possible, since `AnalyserNode` is polled at the render rate and can miss or delay transients.
- 3 bands: kick (about 30 to 150 Hz), body/snare (about 150 Hz to 2.5 kHz), air (about 2.5 to 12 kHz).
- Flux: `sum(max(0, log(1 + γ·mag[n]) − log(1 + γ·mag[n−1])))`.
- Threshold: `median or mean of last 100 to 300 ms × k + δ`, with a per-band refractory period of about 80 to 120 ms.
- If `AnalyserNode` must be used, set `smoothingTimeConstant = 0` for the detector. The default 0.8 would blur the transients that the detector needs.

**Musical mapping** (one event, several time scales)

| Target | Trigger | Attack | Release | Effect |
|---|---|---|---|---|
| Fuel/heat at core | Kick | 0 to 10 ms | 150 to 400 ms | Form swells and brightens |
| Radial velocity | Kick | Single step | Decays in sim | Smoke is pushed outward |
| Divergence ring | Strong kick | Single step | 200 to 500 ms travel | Visible pressure wave |
| Vorticity gain | Snare/body | 20 ms | 200 ms | Smoke curls harder |
| Spark burst | Air/strong hit | Instant | Particle lifetime | Fine detail on hats and hits |
| Exposure | Slow RMS | 50 ms | 1 to 2 s | Overall energy follows the track |

**Injection rules**
- Inject impulses as **a change in momentum per event**, not `force × dt` per frame, so a hit has the same strength at any frame rate.
- Add positive divergence in a soft ring (or Gaussian) *before* the pressure solve to get a real outward push. Keep a separate cheap display-space ring distortion, because a low-iteration Jacobi solve will not carry a clean wavefront.
- Use a soft limiter (`1 - exp(-x)`) on accumulated energy, so that a dense passage cannot saturate the frame to white.
- Keep brightness response partly independent of size. A pulse reads best when the form moves first and light follows slightly behind.

**Latency compensation**
- Timestamp onset on the audio clock. Estimate `visualDelay = render queue + display/projector latency` as an operator-set value.
- `delayToSpeakers = outputLatency` where available. If audio arrives through a mic or line-in from a PA, the app does not know the room delay, so provide a manual ±150 ms offset.
- If visuals are late, a detector cannot look into the future. Use a tempo or beat predictor to fire slightly early only when beat confidence is high. Otherwise accept the delay rather than firing wrongly.

**No-audio behaviour**
- After about 1.5 to 3 s of silence (below a gate), crossfade to an idle: slow noise-driven breathing at about 0.1 to 0.25 Hz, gentle fuel and a low spark rate.
- Never freeze or fall to black unintentionally. Offer a manual tap trigger, which goes through the same envelope system.
- The gate needs hysteresis and an adaptive noise floor, so a noisy line input does not trigger false pulses.

### Gaps
- Exact online latency figures from Böck et al. were not extracted.
- No published perceptual threshold for audio-visual sync in VJ/projection settings was retrieved. The ±150 ms offset range is a practical control range only.
- Whether the app's audio path already exposes onsets was not established beyond the API search noted at the top.

## Temporal techniques: upscaling, reprojection, frame-rate-independent dissipation and fixed-step simulation?

### Takeaway
Run the simulation on a fixed 60 Hz step with an accumulator and a hard step cap, use exact exponential decay, and scale to 4K by keeping the sim fixed and upsampling a mid-resolution shaded buffer with added procedural detail. Avoid general TAA, because smoke and sparks have no reliable motion vectors except the ones the sim already provides.

### Cited Findings
- Fix Your Timestep: accumulate frame time, consume it in fixed `dt` steps, carry the remainder, cap steps or clamp frame time (0.25 s in its example) to avoid the spiral of death, and interpolate with `alpha = accumulator / dt` — [Gaffer on Games](https://gafferongames.com/post/fix_your_timestep/)
- Time-based exponential smoothing gives the same result regardless of step size: `lerp(target, value, exp2(-rate*dt))` — [Lembcke, Improved Lerp Smoothing](https://gamedeveloper.com/programming/improved-lerp-smoothing-)
- Dobryakov's advection divides by `1 + dissipation*dt` and clamps frame `dt` to 1/60 s — [script.js](https://raw.githubusercontent.com/PavelDoGreat/WebGL-Fluid-Simulation/master/script.js)
- GPU Gems 3 renders fluid to a smaller off-screen target and re-renders problem edges at full resolution, found with a Sobel filter — [GPU Gems 3 ch. 30](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids)
- Kim et al.'s wavelet approach synthesises missing turbulent detail with band-limited noise — [secondary description](https://gamma.cs.unc.edu/turbulence/preprint.pdf)
- Jimenez's Advanced Warfare bloom uses a pyramidal filter hierarchy for temporal stability and robustness, and his firefly weighting must be renormalised — [Jimenez, SIGGRAPH 2014](https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/)

### Inferences
**Dissipation.** Use `field *= exp(-rate * dt)`.
Arithmetic for one second of decay shows why:

| Rate | `1/(1+r·dt)` at 30 fps | at 60 fps | at 120 fps | exact `exp(-r)` |
|---|---:|---:|---:|---:|
| 1 | 0.3739 | 0.3709 | 0.3694 | 0.3679 |
| 3 | 0.0573 | 0.0535 | 0.0517 | 0.0498 |

The divide form is close, but at a rate of 3 it leaves about 11% more residual at 30 fps than at 120 fps. With a fixed step this drift disappears, but the exact form costs nothing. Also note that a `dt` clamp without an accumulator makes the sim run in **slow motion** below 60 fps.

**Fixed step recipe**
- `simDt = 1/60`; accumulator; **max 2 steps per frame**; drop excess time rather than catching up.
- On a 120 Hz display, skip sim on alternate frames and interpolate the *display* only.
- Under load, degrade in order: spark count → light taps → Jacobi iterations → dye resolution → sim resolution. Change resolution only with a crossfade, because reallocating and resampling mid-show can hitch.

**Upscaling to 4K**

| Layer | 1080p | 4K |
|---|---|---|
| Velocity/pressure | 256×144 to 384×216 | Same as 1080p |
| Temperature/fuel/smoke | 960×540 to 1280×720 | 1280×720 to 1920×1080 |
| Volumetric shading | Half res | Quarter to third res |
| Sparks | Native | Native, or 1440p if overdraw is high |
| Bloom | Pyramid from half res | Pyramid from quarter res |
| Final composite, grain, dither | Native | Native |

- Upsample with bicubic or Catmull-Rom on the temperature and smoke fields, then add **advected** fine noise, so that detail moves with the flow instead of sitting on the screen.
- A two-phase flow-map detail layer (two noise lookups displaced by velocity, crossfaded and reset out of phase) is a cheap way of doing this.
- RGBA16F at 4K is 66.4 MB per target (16.6 MB at 1080p), before pairs and mips, so avoid native-4K ping-pong targets.

**Temporal accumulation.** The sim is itself a temporal filter, so use history only in narrow ways:
- Reproject the shaded smoke using the sim velocity, with a blend around 0.7 to 0.85, clamped to the neighbourhood.
- Exclude sparks and pulse flashes from history, or transients will smear exactly when they should be sharp.

### Gaps
- Driscoll's original damping article was identified but not opened; the citation here is Lembcke's related write-up.
- No WebGL benchmark of upscaling methods for fluid fields was found.
- Whether FSR/XeSS-like upscalers help this content was not evaluated; they are not readily available to a WebGL2 pipeline and assume scene motion vectors.

## Leading references, tools and code licences

### Takeaway
Stam, GPU Gems, Fedkiw/Nguyen, Selle and the Nubis talks provide the technique base. Dobryakov's MIT code is the only substantial fluid implementation verified as cleanly reusable here, but writing Ember Pulse's own solver on the existing `passes.ts` is the better path and avoids inheriting a recognisable look.

### Cited Findings
**Technique sources**

| Reference | Use for Ember Pulse | Link |
|---|---|---|
| Stam, Stable Fluids (1999) | Unconditionally stable solver | [PDF copy](https://pages.cs.wisc.edu/~chaol/data/cs777/stam-stable_fluids.pdf); [SIGGRAPH record](https://history.siggraph.org/?p=116411) |
| GPU Gems ch. 38 | GPU fluid passes, boundaries | [NVIDIA](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu) |
| GPU Gems 3 ch. 30 | MacCormack, fire, marching | [NVIDIA](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids) |
| Fedkiw et al. 2001 | Vorticity confinement | [Stanford](https://www.graphics.stanford.edu/papers/smoke/) |
| Nguyen et al. 2002 | Fire, blackbody | [Stanford](https://graphics.stanford.edu/papers/fire-sg02/) |
| Selle et al. 2008 | MacCormack | [Abstract](https://www.academia.edu/13497521/An_Unconditionally_Stable_MacCormack_Method) |
| Nubis (Guerrilla) | Beer, powder, phase, budgets | [2017 talk](https://advances.realtimerendering.com/s2017/Nubis%20-%20Authoring%20Realtime%20Volumetric%20Cloudscapes%20with%20the%20Decima%20Engine%20-%20Final%20.pdf); [2023 talk](https://advances.realtimerendering.com/s2023/Nubis%20Cubed%20(Advances%202023).pdf) |
| Hillaire (Frostbite) | Energy-conserving integration | [2016 PDF](https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf) |

**Tools (for workflow ideas only; do not copy their looks or presets)**
- EmberGen is a GPU volumetric fluid simulator for fire and smoke — [CG Channel](https://www.cgchannel.com/2024/07/jangafx-releases-embergen-1-2). JangaFX itself calls combustion in EmberGen 1.0 convoluted, with many hard-to-understand parameters, and targets clearer control of combustion speed and size in 2.0 — [JangaFX roadmap](https://www.jangafx.com/roadmap)
- Notch exposes a Fluid 2D Affector with simulation speed — [Notch manual](https://manual.notch.one/2026.1/en/docs/reference/nodes/fields/affectors/fluid-2d-affector/)
- TouchDesigner offers Nvidia Flex as a particle-based GPU solver — [Derivative docs](https://derivative.ca/UserGuide/Flex). Community 2D grid solvers exist, such as [touchFluid](https://github.com/kamindustries/touchFluid)

**Licences and IP**

| Code / method | Status | Reuse guidance |
|---|---|---|
| three.js 0.187.0 (incl. tone-mapping GLSL) | MIT, verified in `node_modules` | Reusable with notice |
| PavelDoGreat/WebGL-Fluid-Simulation | MIT, © 2017 Pavel Dobryakov — [LICENSE](https://raw.githubusercontent.com/PavelDoGreat/WebGL-Fluid-Simulation/master/LICENSE) | Reusable with notice; prefer learning the method |
| Blender/Cycles blackbody table | Sony Imageworks BSD-style per file — [source](https://projects.blender.org/archive/blender-archive/raw/commit/1dfd82d2bcdd28e6230878d643c19b93a31cb4cd/intern/cycles/render/blackbody.cpp) | Prefer generating our own LUT from Planck and CIE data; otherwise keep notice |
| GPU Gems sample text/code | Licence not checked | Reimplement from the description |
| touchFluid | Licence not checked | Do not reuse until checked |
| Stam's US 6,266,071 | Listed "Expired - Lifetime" by Google, which notes that status is not a legal conclusion — [Google Patents](https://patents.google.com/patent/US6266071) | Low apparent concern, but not legal advice; verify with USPTO if commercial risk matters |

### Inferences
**Recommended Ember Pulse stack**
1. Fixed-step 2D solver on `passes.ts`: 256×144 to 384×216 velocity, 16 to 24 warm-started Jacobi.
2. `T/F/S` at 960×540 to 1280×720, limited MacCormack, simple burn model.
3. Slab shading: Beer-Lambert, 4 to 8 light taps, fire-lit smoke.
4. Own blackbody LUT, AgX-style default, explicit black floor, late blue-noise TPDF dither.
5. GPU spark streaks coupled to velocity by drag.
6. Band-split onset detector → envelopes → heat, velocity, ring and spark impulses, with a designed idle.
7. Quality tiers that shed load in a defined order, and a curl-noise fallback that keeps the look alive.

To keep Ember Pulse visually distinct, its identity should come from its own form: a single glowing mass that breathes, with a defined cooling palette and pressure-ring behaviour. Dobryakov's coloured splats and sunrays, and any tool's stock fire presets, should not be used as visual targets.

### Gaps
- Current EmberGen parameter documentation was not reached, and its internal solver is not publicly established by the sources reviewed.
- TouchDesigner's official current fluid operators, if any, were not confirmed; the search found Flex and community components.
- Licences for GPU Gems sample code and touchFluid remain unverified.
- USPTO patent status was not checked directly.
