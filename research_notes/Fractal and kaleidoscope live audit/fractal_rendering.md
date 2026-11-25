# Real-Time Fractal Rendering for Live Visuals (WebGL2/WebGPU)

Evidence labels used below. "Cited Findings" were read in a fetched page or a search result for that URL. "Inferences" are my reasoning or arithmetic and have not been benchmarked. Repository facts come from reading `src/rendering/fractal.ts`, `fractal-julia.ts`, `fractal-box.ts` and `StudioRenderer.ts` in the working tree on 2026-11-21.

Source access limits for this run: the Keinert PDF and Syntopia blog failed TLS checks, so they were not fetched. Inigo Quilez article pages returned 404 to the fetcher, the Segment Tracing and Bán-Valasek PDFs returned 403, and the Draves PDF exceeded the fetch size limit. Claims from those works are limited to abstracts, search excerpts or secondary summaries, and are marked as such.

## Deep zoom: perturbation, series approximation, rebasing, precision limits, GPU feasibility

### Takeaway
Deep zoom is feasible in the browser with a CPU-computed high-precision reference orbit, a GPU orbit texture or storage buffer, and per-pixel low-precision deltas. For a live VJ tool, the best first target is a bounded f32 perturbation path with rebasing, because BLA tables, floatexp and arbitrary depth add much more complexity. The existing Julia "dive" is a separate, cheaper looping technique and should stay.

### Cited Findings
- Perturbation tracks each pixel as a small offset `z` from a high-precision reference `Z`, with update `z -> 2Zz + z^2 + c`; only the reference needs high precision — [mathr, Deep Zoom Theory and Practice](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html).
- Pauldelbrot glitch test: flag a pixel when `|Z+z|^2 < G|Z|^2`, with G "somewhere between 1e-2 and 1e-8". Too large is slow and too small misses glitches; choosing G is described as an open question — [mathr](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html).
- Rebasing: when the perturbation becomes small relative to the reference, "replace z_n with Z_m + z_n and reset the reference iteration count m to 0"; check after each BLA or perturbation step — [mathr, Deep Zoom](https://mathr.co.uk/web/deep-zoom.html).
- Attribution: Robert Munafo credits Zhuoran with introducing rebasing tests on Fractal Forums in December 2021 — [Munafo, Bivariate Linear Approximation](https://mrob.com/pub/muency/bivariatelinearapproximati.html). The mathr page cites the forum thread and names Zhuoran only for a remark on table construction — [mathr](https://mathr.co.uk/web/deep-zoom.html).
- BLA single-step validity is `|z_n| << |A_{n,1}|`. Merge rules are `A_z = A_y A_x`, `B_z = A_y B_x + B_y`, `R_z = max{0, min{R_x, (R_y - |B_x||c|)/|A_x|}}`. The table has O(M) elements — [mathr](https://mathr.co.uk/web/deep-zoom.html).
- Lookup picks the BLA at iteration m with the largest skip whose radius satisfies `|z| < R`; otherwise it performs one perturbation step — [mathr](https://mathr.co.uk/web/deep-zoom.html).
- Hybrids need one reference per phase in the loop, each with its own BLA table; formulas with multiple critical points need one per critical point — [mathr](https://mathr.co.uk/web/deep-zoom.html).
- Series approximation expresses `z_n` as a polynomial in `c` to skip iterations and is validated with probe points. The author notes no complete proof with rigorous error bounds — [mathr](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html).
- Munafo says the best deep-zoom results have been produced with bivariate linear approximation — [Munafo](https://mrob.com/pub/muency/bivariatelinearapproximati.html).
- Number ranges: single has a 24-bit mantissa and "underflows below 1e-38 or so"; double has 53 bits and underflows below about 1e-308. Floatexp reaches arbitrary depth but is slow because every operation is handled in software — [mathr](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html).
- Double-single gives up to about 48 bits (about 14 decimal digits) but keeps the f32 exponent range. f32 is about 7 digits and binary64 about 15-16 — [luma.gl GPU precision guide](https://luma.gl/docs/api-guide/shaders/gpu-floating-point-precision).
- WebGL and portable WGSL do not expose native 64-bit floats — [luma.gl](https://luma.gl/docs/api-guide/shaders/gpu-floating-point-precision). A 2022 W3C thread flagged Metal's lack of float64 as a possible blocker — [public-gpu](https://lists.w3.org/Archives/Public/public-gpu/2022Apr/0004.html).
- WGSL permits reassociation and fusion, so classic TwoSum/TwoProd double-single code can break. Temporaries, extra parentheses and identity bitcasts are not portable guarantees. luma.gl automatically selects an integer-controlled path on Apple WebGPU adapters, at higher cost — [luma.gl](https://luma.gl/docs/api-guide/shaders/gpu-floating-point-precision).
- Browser projects report plain float32 failing near 10^7 zoom and df64 reaching about 10^14 — [DEV write-up, lower-confidence source](https://dev.to/pavkode/webgl-mandelbrot-explorer-efficient-deep-zooming-1014-in-browser-with-optimized-rendering-1ja).

### Inferences
- Recommended ladder: f32 direct to about 10^5-10^6 zoom; perturbation with f32 deltas to roughly 10^30, leaving margin before f32 underflow; rescaled deltas or floatexp only if a real show needs deeper zoom. Skip df64 as the main path, since perturbation avoids its compiler hazard on Apple GPUs.
- Reference orbit storage in RG32F costs 8 bytes per iteration: 1M iterations = 8 MB. A pairwise BLA table has about 2M entries; at 5 f32 values each, that is about 40 MB per 1M-iteration reference. That is a reason to defer BLA.
- Compute the reference in a Worker (WASM bigint or similar) and upload incrementally. Keep rendering the previous reference until the new orbit is ready, then swap on a frame boundary with the delta origin corrected in the same frame.
- Repository: `fractal-julia.ts` loops a dive around a repelling 2-cycle using inverse iteration and a spiral zoom. It has no precision-ladder problem because coordinates stay near the cycle. It should remain the default "infinite zoom" for live use; true perturbation is mainly valuable for Mandelbrot-location zooms.

### Gaps
- I found no measured frame-time benchmark for perturbation on Apple Silicon or mid-range GPUs in WebGL2/WebGPU.
- The primary Fractal Forums Zhuoran post was not retrieved. Imagina, Kalles Fraktaler and fraktaler-3 performance figures were not obtained.
- The zoom thresholds in the ladder are engineering estimates and need testing per GPU.

## Most visually rewarding fractal families for live use

### Takeaway
The strongest additions are a GPU fractal flame (highest visual novelty, naturally progressive), Mandelbulb, and pseudo-Kleinian/hybrid folds. Strange attractors via compute are a good WebGPU-only family. Sourcing here supports feasibility more than aesthetic ranking, so the ranking is judgment.

### Cited Findings
- Fractal flame loop: choose a function by probability, apply it to `(x,y)`, blend colour with `c=(c+Fj.color)/2`, and accumulate in a histogram — [Wikipedia, Fractal flame](https://en.wikipedia.org/wiki/Fractal_flame), summarizing [Draves and Reckase](https://flam3.com/flame_draves.pdf).
- Flame tone map: `alpha = log(freq_avg)/log(freq_max)`, `final = color_avg * alpha^(1/gamma)`. Supersampling uses a histogram larger than the output (example 300x300 for 100x100) — [Wikipedia](https://en.wikipedia.org/wiki/Fractal_flame).
- Adaptive density estimation uses a filter width inversely proportional to local sample count, so sparse regions blur and dense regions stay sharp — [Wikipedia](https://en.wikipedia.org/wiki/Fractal_flame).
- GPU lineage: Fractorium uses Ember/EmberCL through OpenCL — [LinuxLinks](https://www.linuxlinks.com/fractorium-qt-based-fractal-flame-editor/). Cuburn is a CUDA flame renderer aimed at or near real time — [Cuburn](https://github.com/stevenrobertson/cuburn).
- pyr3 is a TypeScript + WebGPU flame renderer sharing WGSL compute shaders between browser and CLI. It checks 26 fixtures against flam3-C, with 22 in its tier-1 band (R < 5). It is GPL-3.0-or-later and publishes no render-throughput numbers — [pyr3](https://github.com/MattAltermatt/pyr3).
- Mandelbulb: n=8 is described as the most popular choice — [arXiv 2102.01747](https://ar5iv.labs.arxiv.org/html/2102.01747). Quilez describes distance-field raymarching as what makes real-time rendering feasible and used 3D orbit traps for colour — [Quilez, Mandelbulb, search excerpt](https://iquilezles.org/articles/mandelbulb/).
- Pseudo-Kleinian: Knighty developed the standalone formula from a 2011 idea, and Mandelbox/pseudo-Kleinian hybrids are documented — [IMAGINARY](https://www.imaginary.org/node/2364). Fragmentarium includes `Knighty Collection/PseudoKleinian.frag` — [Syntopia, search excerpt](https://blog.hvidtfeldts.net/index.php/category/distance-estimation/).
- Hybrid analytic DEs often overshoot and need a fudge factor — [Syntopia, search excerpt](https://blog.hvidtfeldts.net/index.php/category/distance-estimation/).
- Burning Ship is supported in Fraktaler 3's deep-zoom approach, using a safety margin of `|X|/2` and `|Y|/2` around folds — [mathr](https://mathr.co.uk/web/deep-zoom.html).
- Attractors: rreusser's WebGPU notebook integrates the Bouali attractor with RK4 in compute and stores tracks in a ring buffer, but reports no timings and says it runs slightly slower than the WebGL 1 version — [rreusser](https://rreusser.github.io/notebooks/strange-attractors-in-webgpu).
- A thesis reports ten million compute-shader particles at about 63 FPS on a GTX 1060; that workload is not an attractor renderer — [TU Wien thesis](https://www.cg.tuwien.ac.at/research/publications/2023/PETER-2023-PSW/PETER-2023-PSW-.pdf).

### Inferences
Suggested priority for this app:

| Priority | Family | Why | Runtime class |
|---|---|---|---|
| 1 | Fractal flame (WebGPU compute, WebGL2 fallback via additive points) | Distinct look; accumulation hides noise; audio can drive weights | Real-time at reduced samples, offline at full quality |
| 2 | Pseudo-Kleinian / Mandelbox hybrid | Architectural interiors; reuses the current ray tracer | Real-time with low iteration count |
| 3 | Mandelbulb | Recognisable and organic; simple DE | Real-time; power animation is a strong control |
| 4 | Menger / KIFS 3D | Cheap folds, crisp geometry; extends the current ornament language | Real-time |
| 5 | Newton / Burning Ship | Cheap 2D variety; Newton basins suit palette work | Real-time |
| 6 | Attractor point clouds | Strong motion; pairs with existing feedback | WebGPU preferred |
| 7 | Lyapunov | Striking stills, but costly and less fluid under modulation | Reduced-resolution or progressive |

- Do not copy pyr3 code unless GPL-3.0 is acceptable for this project. Use it as an architectural reference only.
- A flame needs its own pass, because the fold-in-a-fragment approach cannot accumulate a histogram.

### Gaps
- I found no controlled study comparing the visual appeal of fractal families. The table is editorial judgment.
- I did not retrieve authoritative real-time numbers for Apollonian, Lyapunov, Newton or Menger on target hardware. Apollonian received no usable source in this run.
- No source gave iterations/second for a browser WebGPU flame on Apple Silicon.

## Sphere tracing improvements

### Takeaway
The largest immediate wins are not exotic tracers. Bound the worst-case per-pixel cost, add a low-resolution conservative depth pre-pass, stop supersampling every pixel, and test safe over-relaxation against the current fixed 0.6 step. Segment tracing is poorly suited to Mandelbox because it needs local Lipschitz bounds that folds do not readily provide.

### Cited Findings
- Enhanced Sphere Tracing proposes "a safe, over-relaxation-based method", a screen-space metric for selecting an intersection when tracing does not converge, and a precision/performance tradeoff for self-intersection — [Keinert et al., FAU](https://www.lgdv.tf.fau.de/publications/enhanced-sphere-tracing/).
- Bán and Valasek (Eurographics 2023) compare enhanced sphere tracing and relaxed variants by average steps to convergence and report auto-relaxation performing on par with enhanced tracing; their ω conventions differ, so values should not be mixed — [search excerpt](https://diglib.eg.org/bitstream/handle/10.2312/egs20231014/057-060.pdf).
- Segment Tracing computes a local Lipschitz bound along a ray segment to take larger steps and reports significantly fewer field queries without acceleration structures — [Galin et al. 2020](https://diglib.eg.org/handle/10.1111/cgf13951).
- Mandelbulber's ray step multiplier trades quality against overstepping, with most fractals best between 0.5 and 1.0. Detail level 1.0 corresponds to a one-pixel minimum detail size — [Mandelbulber guide excerpt](https://www.scribd.com/document/324027791/Mandelbulber-user-guide-pdf).
- Rotation in Mandelbox-style formulas can make DE inaccurate and discontinuous, forcing low step factors — [Fractal Forums](https://www.fractalforums.com/3d-fractal-generation/mandelbox-distance-estimation-problem). One user needed a 0.2 multiplier at 20 iterations — [Fractal Forums](https://www.fractalforums.com/programming/de-accuracy-for-ifs-fractals).
- Every formula in a hybrid must apply its own correct update to the running derivative — [Fractal Forums](https://www.fractalforums.com/programming/de-accuracy-for-ifs-fractals).
- Reusing previous-frame depth as a march start is limited to static scenes in one voxel renderer's design — [jedjoud10](https://jedjoud10.github.io/blog/depth-reproj).

### Inferences
Repository audit of `fractal-box.ts`:
- Worst case at High is 4 samples x (192 primary + 4 normal + 24 shadow + 4 AO) = 896 field evaluations per pixel. At 14 fold iterations, that is 12,544 fold iterations per pixel. This, not average cost, is what produces frame spikes.
- Primary marching uses a fixed `t += d * .6`. The pixel-footprint epsilon on line 94 is already the right idea.
- Normals use 4-tap tetrahedron differences through the full field, and shadow and AO also evaluate the full orbit-colour field. A distance-only `boxDE` that skips orbit accumulation should reduce cost in these paths at no visual change.

Recommended order:
1. Split `boxField` into distance-only and distance+orbit versions.
2. Replace uniform 4x supersampling with one primary sample plus temporal accumulation, or edge-only extra samples.
3. Add a 1/4 or 1/8 resolution cone pre-pass storing conservative start `t`, stepping back by the footprint radius. It remains valid under animation because it is recomputed each frame.
4. Test over-relaxation starting at ω 1.2 on top of a calibrated safe base step, with the standard fallback when consecutive unbounding spheres do not overlap. Measure step counts per preset, since Mandelbox DE error limits the benefit.
5. Add a per-frame budget: reduce `steps`, shadow steps and iterations by measured GPU time, and fade any change instead of switching.
6. For interior camera paths, keep the camera at a minimum DE clearance by sampling the same DE on the CPU, or use a smoothed path. Near-zero DE at the eye causes slow marching and visual popping.

### Gaps
- The measured step reductions in Keinert, Bán-Valasek and Galin were not retrievable, so I give no percentage. The ω 1.2 starting value is from memory of common practice and needs verification.
- I found no source benchmarking hierarchical depth pre-passes specifically for Mandelbox on Apple Silicon.

## Temporal reprojection, upscaling, variable-rate rendering, and anti-shimmer

### Takeaway
A custom fractal-aware TAA or temporal accumulator is the highest-quality path. FSR 1 is easy to port but will not fix temporal shimmer. FSR 2-style temporal upscaling requires depth and motion vectors that must be generated for the raymarcher, and its official implementation does not target WebGL or WebGPU.

### Cited Findings
- FSR 1 is spatial, needing no frame history or motion vectors, and expects an anti-aliased input. Modes: Ultra Quality 1.3x, Quality 1.5x, Balanced 1.7x, Performance 2.0x — [AMD FSR 1](https://gpuopen.com/fidelityfx-superresolution/).
- FSR 1 upper-bound cost at 4K: 0.40 ms (RX 6800 XT/RTX 3080), 0.60 ms (RX 6700 XT/RTX 3060 Ti), 1.0 ms (RX 5700 XT/RTX 2060 SUPER). At 1440p: 0.20, 0.30 and 0.50 ms — [AMD FSR 1](https://gpuopen.com/fidelityfx-superresolution/).
- FSR 2 inputs: colour, depth, motion vectors, optional reactive and transparency/composition masks, and exposure. All render-resolution inputs except motion vectors are jittered — [AMD FSR 2 manual](https://gpuopen.com/manuals/fsr_sdk/techniques/super-resolution-temporal/).
- FSR 2 uses Halton(2,3) jitter with sequence length `ceil(8 * n^2)`: Quality 18, Balanced 23, Performance 32, Ultra Performance 72 — [AMD FSR 2 manual](https://gpuopen.com/manuals/fsr_sdk/techniques/super-resolution-temporal/).
- FSR 2 at 4K Quality: 0.7 ms (RX 7900 XTX), 1.2 ms (RX 6800 XT), 2.4 ms (RX 5700 XT), 5.4 ms (RX 590). At 1080p Quality: 0.2, 0.3, 0.6 and 1.3 ms. Shader target is HLSL CS_6_2 — [AMD FSR 2 manual](https://gpuopen.com/manuals/fsr_sdk/techniques/super-resolution-temporal/).
- The reactive mask controls how much current samples replace history, with a recommended maximum near 0.9 — [AMD FSR 2 manual](https://gpuopen.com/manuals/fsr_sdk/techniques/super-resolution-temporal/).
- MetalFX offers a temporal scaler with reactive mask support — [Apple MTLFXTemporalScalerDescriptor](https://developer.apple.com/documentation/metalfx/mtlfxtemporalscalerdescriptor.md).
- Neighbourhood clipping is "the main ingredient" behind modern temporal supersampling; variance clipping builds a colour AABB from the first two moments of local samples — [Salvi, GDC 2016](https://developer.download.nvidia.com/gameworks/events/GDC2016/msalvi_temporal_supersampling.pdf).
- Variance can collapse when the neighbourhood is unrepresentative, clipping history to the current sample and causing flicker. Plain 3x3 min/max can produce box artifacts. Karis's reduce-blend weights by luminance distance after clipping — [Cech, TU Wien 2023](https://www.cg.tuwien.ac.at/research/publications/2023/cech-2023-taa/cech-2023-taa-Report.pdf).
- Subpixel features can slip between jittered samples, and TAA failure appears as ghosting or returned aliasing — [Marrs et al., NVIDIA](https://research.nvidia.com/sites/default/files/pubs/2019-03_Improving-Temporal-Antialiasing//Marrs2019_Chapter_TemporalAntialiasingWAdaptiveRays.pdf).

### Inferences
- Output from the Mandelbox pass should include linear HDR colour, hit `t`, and optionally orbit/material ID. Motion vectors come from reprojecting `origin + ray*t` with the previous camera.
- Camera reprojection is not enough when fold parameters animate, because surface points themselves move. Lower history weight in proportion to parameter velocity, and write that into a reactive-style mask.
- Anti-shimmer pipeline: Halton jitter -> trace -> depth-aware reprojection -> YCoCg variance clip -> luminance-weighted blend -> tone map last. Clamp only firefly outliers before accumulation.
- On beat cuts, preset changes or strong audio hits, reduce history weight immediately to avoid ghosting. Static or slow moments can converge to very high quality.
- Checkerboard or 1/2-rate tracing can pair with reprojection, but only with reliable depth. For high-frequency fractal surfaces, adaptive extra rays at variance-clipped pixels are likely safer than a fixed checker pattern.
- MetalFX is a native API and should only be considered if a native or Electron-native bridge exists. In browser-based WebGL2/WebGPU, use a custom shader path. FSR 1's EASU/RCAS can be ported as a post step after TAA.
- The current preview uses one sample per pixel and final quality uses up to 4 fixed samples, so preview and output differ in aliasing. A shared temporal path would reduce that gap.

### Gaps
- I found no source specifically measuring TAA quality on fractal sparkle, nor an authoritative published fractal denoiser for real-time use.
- I did not find FSR 2 timings on Apple Silicon or an official WebGPU port.
- I did not retrieve Karis's original 2014 slides.

## Colouring: orbit traps, histogram, smooth iteration, line art, glow, HDR, OKLCH

### Takeaway
Colour should be computed from stable, continuous fields, composited in linear HDR, and mapped through OKLCH palettes. Log-density, DE-based line width and early-orbit weighting are the highest-value techniques. Global histogram equalization should be avoided in live output unless temporally smoothed.

### Cited Findings
- Orbit traps track closest approach to a point, line or other shape; averages and standard deviations of orbit distances also produce useful images — [Quilez, geometric orbit traps, search excerpt](https://iquilezles.org/articles/ftrapsgeometric/).
- Quilez computed four 3D orbit traps and used the results for Mandelbulb colour — [Quilez, Mandelbulb, search excerpt](https://iquilezles.org/articles/mandelbulb/).
- DE for escape-time fractals uses `G/|grad G|`, with distance and derivative computed together in the iteration — [arXiv 2102.01747](https://ar5iv.labs.arxiv.org/html/2102.01747).
- Flames use log-density because linear brightness loses detail; gamma per channel is better quality but more expensive — [Wikipedia](https://en.wikipedia.org/wiki/Fractal_flame).
- Oklab hue RMS error is 0.49 versus 0.69 for CIELAB and 1.10 for HSV; chroma RMS is 0.81 versus 1.84 for CIELAB. White-to-blue blends avoid the purple shift seen in CIELAB, CIELUV and HSV — [Ottosson, Oklab](https://bottosson.github.io/posts/oklab/).
- Oklch polar form is `C = sqrt(a^2+b^2)`, `h = atan2(b,a)` — [Ottosson](https://bottosson.github.io/posts/oklab/).

### Inferences
- Repository strengths: Julia already combines smooth count, circle/cross orbit traps, log-derivative distance and exponentially decaying orbit weights. The Mandelbox comment on avoiding the final, exponentially sensitive iterations reflects the correct anti-shimmer rule.
- Generate palette LUTs in OKLCH on the CPU, gamut-map to the output space, then sample in linear colour. Interpolate hue along the shortest arc, and fade chroma through low values when two hues are far apart.
- Keep line width in screen-space from DE (`distance / pixelFootprint`) so line art stays stable during zoom.
- Volumetric glow: accumulate `exp(-k*d)` along the primary march with a step-length weight. Weighting by step length prevents the glow from changing when step count or over-relaxation changes.
- Use RGBA16F for accumulation, then ACES-like or similar tone mapping once at the end. Apply bloom before tone mapping. If histogram colouring is used, compute a low-resolution CDF and low-pass it over about 0.5-2 s to prevent frame-wide brightness pumping.

### Gaps
- Exact Quilez smooth-iteration and DE article text could not be fetched. The repository's formula uses the standard form, but I did not verify it line by line against his article.
- I found no measured perceptual study of OKLCH on fractal gradients specifically.

## Seamless navigation and morphing between parameter sets

### Takeaway
Reliable morphs interpolate in parameter spaces chosen for continuity, keep the camera clear of the surface, and hide topology changes with temporal or crossfade transitions. This area has little formal literature, so most guidance is engineering inference.

### Cited Findings
- Flame parameters are weights and affine transforms over variations, giving a continuous space to interpolate — [Wikipedia](https://en.wikipedia.org/wiki/Fractal_flame).
- Each hybrid formula must update the running DE derivative correctly, so a morph between formulas can invalidate the estimator unless handled per formula — [Fractal Forums](https://www.fractalforums.com/programming/de-accuracy-for-ifs-fractals).
- Rotation can make Mandelbox DE discontinuous and nonlinear — [Fractal Forums](https://www.fractalforums.com/3d-fractal-generation/mandelbox-distance-estimation-problem).
- Temporal history must be rejected when reprojection fails, otherwise ghosting appears — [Cech, TU Wien 2023](https://www.cg.tuwien.ac.at/research/publications/2023/cech-2023-taa/cech-2023-taa-Report.pdf).

### Inferences
- Interpolate by parameter type: exponential/log for zoom and scale; quaternion slerp for rotations; shortest-arc for phase; decomposed rotation/log-scale/shear for flame affines; OKLCH or pre-baked LUT crossfade for palette.
- Use C1 or better easing (critically damped spring or smoothstep-style) so audio modulation does not produce velocity pops.
- Same-family morphs can be direct. Cross-family morphs (Julia to Mandelbox) should be a compositing transition, preserving this project's preference for separate named effects rather than a combined recreation.
- Fractional iteration blending, as already used at `fractal-box.ts:45-46`, is the right pattern for Detail changes. Reuse it for every discrete loop count.
- For Julia morphs, moving `c` across the Mandelbrot boundary changes connectivity abruptly. Choose paths that avoid the boundary, or crossfade in the short interval around crossing.
- For interior fly-throughs, solve camera clearance against the DE and keep a target minimum distance; when parameters change, ease the camera and fold values together.
- Validate with a pop detector: render successive frames and flag spikes in mean absolute luminance difference or step count.

### Gaps
- I found no authoritative paper on real-time parameter morphing for hybrid fractals, and no measured threshold for a visible pop. The recommendations above should be validated in the app.
