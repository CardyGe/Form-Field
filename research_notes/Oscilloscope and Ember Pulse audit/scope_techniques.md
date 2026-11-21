# Real-Time Oscilloscope and Vector-Beam Rendering Techniques

Scope: the Oscilloscope effect only. Target: WebGL2/three.js, with a path to WebGPU. Researched 2026-11-21.

Evidence labels: "Cited Findings" come from the linked source. "Inferences" are my derivations or engineering judgement and have not been tested in this project. Numeric checks marked "computed" were run locally for these notes. No GPU benchmark was run.

## Accurate beam rendering: Gaussian segment integrals, energy, speed, sub-frame sampling, joints, zero-length segments

### Takeaway
The strongest known approach is an analytic time-integral of a Gaussian beam along each segment, drawn as one additive quad per segment into an HDR buffer. It gives speed-dependent brightness and seamless joints with no joint geometry. MAME's current BGFX vector renderer is the most complete public reference because it adds pixel-footprint filtering, a core-plus-halo profile and scan-order timing.

### Cited Findings

**The woscope integral**
- Stereo samples are treated as XY points, and consecutive points form segments — [woscope write-up](https://m1el.github.io/woscope-how/).
- With the segment placed from (0,0) to (l,0), cumulative intensity is `(1/2l) * exp(-py^2/2s^2) * (erf(px/(sqrt2*s)) - erf((px-l)/(sqrt2*s)))` — [woscope write-up](https://m1el.github.io/woscope-how/).
- Each segment is its own rectangle, extended by `uSize` past both ends and sides. Vertices carry start, end and index, and varyings supply segment-local coordinates — [woscope write-up](https://m1el.github.io/woscope-how/).
- Joints need no logic: overlapping quads add through `blendFunc(SRC_ALPHA, ONE)`. The cost is overdraw — [woscope write-up](https://m1el.github.io/woscope-how/).
- woscope uses `sigma = uSize/4` and a four-term polynomial `erf` — [woscope fsLine.glsl](https://github.com/m1el/woscope/blob/master/shaders/fsLine.glsl).
- For length below `1e-6`, woscope falls back to direction (1,0) and a point formula, `exp(-r^2/2s^2)/2/sqrt(uSize)` — [woscope fsLine.glsl](https://github.com/m1el/woscope/blob/master/shaders/fsLine.glsl).
- The author lists these limits: straight-line interpolation produces sharp corners, points saturate quickly, and there is no gamma correction or bloom — [woscope write-up](https://m1el.github.io/woscope-how/).
- Hansi Raber's Oscilloscope uses the same erf integral, expanded through a geometry shader, then applies `pow(alpha, 1 - uIntensityBase)` and a per-sample brightness — [osci.frag](https://github.com/kritzikratzi/Oscilloscope/blob/master/bin/data/shaders/osci.frag), [osci.geom](https://github.com/kritzikratzi/Oscilloscope/blob/master/bin/data/shaders/osci.geom). Its zero-length branch is commented out in that shader.

**The MAME BGFX vector CRT refinements** (all from [MAME BGFX vector CRT docs](https://docs.mamedev.org/techspecs/bgfx_vector_crt.html))
- Each segment is one 12-float instance: endpoints, RGB, sigma, start, duration, intensity, one unused float.
- A six-vertex quad is expanded in target-pixel space, padded by `max(6*sigma, 1px)`.
- Intensity response: `r = sqrt(clamp(I,0,1))`, `coreSigma = base*mix(1.00,1.12,r)`, `haloSigma = base*3.5*mix(1.00,1.25,r)`, `haloStrength = control*mix(0.6,1.0,r)`.
- Pixel-footprint filter: add box variance `pixelAcross^2/12`, so `filteredSigma = sqrt(sigma^2 + pixelVariance)`, and scale the peak by `sigma/filteredSigma` to conserve energy.
- Degenerate segments: `length = max(distance, max(width, 1px))`, so points get non-zero dwell. Timing uses segment position 0.5 and direction falls back to (1,0).
- Scan-order attenuation: `arrival = start + duration*segmentPosition`, `age = frameInterval*(1-arrival)`, `temporal = exp(-age/scanPersistence)`.
- Its model ignores blanked moves, slew limits and generator timing.
- `BEAM_SIGMA_SCALE = 0.085` is empirical, not an FWHM conversion. True FWHM conversion is `width/2.35482`.

### Inferences

**Energy-conserving form (derived).** Using a normalised 2D Gaussian and deposited energy `E`:

```text
I(x,y) = E * exp(-y^2/(2s^2)) / (s*sqrt(2*pi))
           * [erf(x/(sqrt2*s)) - erf((x-l)/(sqrt2*s))] / (2l)

l -> 0:  I -> E * exp(-(x^2+y^2)/(2s^2)) / (2*pi*s^2)
long l:  peak I -> E / (l * s * sqrt(2*pi))
```

- Set `E = beamPower * dt`, with `dt` the sample period. Brightness then falls as 1/speed automatically. Do not add a separate speed term, because that double-counts.
- Because each segment integrates its own time slice, the sum over a polyline is the integral of the whole path. This is why joints stay seamless.

**Defects worth avoiding (computed from the published shaders).**
- woscope's two branches do not meet. As length approaches 0 the integral branch tends to about `1.596*exp(...)`, while the fallback is `exp(...)/(2*sqrt(uSize))`. They match only at `uSize` of about 0.098, so other sizes get a brightness step on stationary points.
- With the `len` guard disabled, as in Oscilloscope's `osci.frag`, a truly zero-length segment evaluates 0/0 unless filtered upstream. In a persistent HDR buffer one NaN can survive and spread through blur. Guard against this explicitly.
- The polynomial `erf` has a maximum absolute error of 4.7e-4 (at x about 0.75), but its slope at 0 is 1.1136 against a true 1.1284. Very short segments therefore read about 1.3% dim, so a hard switch to a true Gaussian creates a small step. Crossfade between the two over `l` from `0.05*s` to `0.1*s`.

**Recommended fragment core (original sketch, untested).**

```glsl
float beam(vec2 p, float l, float s) {           // p in segment space, pixels
  float g = exp(-p.y*p.y/(2.0*s*s)) / (s*2.5066283);
  float u = p.x - 0.5*l;
  float point = exp(-u*u/(2.0*s*s)) / (s*2.5066283);
  if (l < 0.05*s) return g*point;
  float k = 1.0/(1.4142136*s);
  float line = (erfA(p.x*k) - erfA((p.x-l)*k)) / (2.0*l);
  return g * mix(point, line, smoothstep(0.05*s, 0.1*s, l));
}
```

- Quad padding: 4 sigma leaves `exp(-8)` = 3.4e-4 of peak at the edge, which can show as a clipped box at high HDR gain. 6 sigma (MAME) leaves 1.5e-8 but costs more fill. Use 4 sigma for the core, and let bloom supply the far tail.
- Sub-frame timing: at 48 kHz a segment lasts 20.8 microseconds, so one age per segment is enough for any persistence of 1 ms or more (under 2.1% variation across a segment).
- Use a core plus a faint wide halo rather than one wider Gaussian. This keeps the line sharp while retaining glow.

### Gaps
- No published perceptual study was found comparing beam profiles. Real CRT spot profiles are not exactly Gaussian, and no measured spot data was retrieved.
- Slew-limited beam motion (deflection amplifier bandwidth) is not modelled by any renderer reviewed.

## Phosphor modelling: decay, multi-component phosphors, bloom, HDR, tone mapping, frame-rate independence

### Takeaway
Use an RGBA16F accumulation target with exponential decay computed from real elapsed time, ideally with separate fast and slow channels. Follow it with a thresholdless mip-chain bloom and a tone map applied once at the end. Published phosphor numbers are good for character and ratios, but literal values are too short to read at 60 Hz, so the persistence control needs an artistic range.

### Cited Findings

**Decay and timing**
- MAME's inter-frame decay is `exp(-dt/max(tau,0.001))`. It ignores repeated or zero timestamps, clears on backward time, and caps forward intervals at 0.100 s — [MAME BGFX docs](https://docs.mamedev.org/techspecs/bgfx_vector_crt.html).
- MAME defaults: persistence 2 ms (range 1–100 ms), beam intensity 4.0x, halo 0.04x, bloom strength 0.20x, exposure 0.78x — [MAME BGFX docs](https://docs.mamedev.org/techspecs/bgfx_vector_crt.html).
- A public three.js scope uses a fixed per-frame `uDecay` of 0.85–0.95, which the article does not present as frame-rate independent — [Phosphor pipeline article](https://dev.to/the_l_man/building-a-multi-pass-phosphor-rendering-pipeline-in-webgl-113o).

**Phosphor data (low confidence: hobbyist and archival compilations seen through search excerpts; the PDFs could not be parsed here)**
- P1 (Zn2SiO4:Mn): green, peak about 525 nm, about 20 ms — [CRT phosphor research compilation](https://curtpalme.com/forum_archived/crt_phosphor_research_20090315.pdf).
- P7: cascade with a short blue-white layer and long yellow layer, peaks about 440 and 558 nm. One source says the yellow persists over a minute in low ambient light — [CRT phosphor research compilation](https://curtpalme.com/forum_archived/crt_phosphor_research_20090315.pdf).
- P31 (ZnS:Cu): short decay, with sources disagreeing between 0.01–1 ms and under 1 ms — [CRT phosphor research compilation](https://bunkerofdoom.com/tubes/crt/old%20and%20support/crt_phosphor_research_20091220.pdf).

**Decay shape**
- Long afterglow is commonly described with a hyperbolic (Becquerel-type) law, and multi-exponential fits are common — [J. Physical Studies 2011](https://physics.lnu.edu.ua/jps/2011/3/abs/a3301-9.html), [Modeling Long Afterglow Decay Curves](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4177824/).
- Fitted decay constants vary with material, temperature, irradiation intensity and sample thickness — [Modeling Long Afterglow Decay Curves](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4177824/).
- Zn2SiO4:Mn phosphorescence has been modelled as decaying roughly as 1/t through tunnelling — [Tunneling model paper](https://scilit.com/publications/7feb2309c3ce952ae569f13b0077a506).

**HDR formats**
- WebGL2's `EXT_color_buffer_float` makes RGBA16F, RGBA32F and R11F_G11F_B10F renderable, but not RGB16F — [Khronos WebGL registry](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/).
- 16-bit float buffers can blend without clamping. Blending 32-bit float buffers is an error without further support — [EXT_color_buffer_float spec](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_color_buffer_float.txt).
- `EXT_float_blend` is required for 32F blending and has limited availability — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/EXT_float_blend).

**Bloom and tone mapping**
- MAME downsamples to half resolution with no threshold and runs two separable 9-tap blur iterations, splitting sigma by `sqrt(passes)` — [MAME BGFX docs](https://docs.mamedev.org/techspecs/bgfx_vector_crt.html).
- The Call of Duty: Advanced Warfare method uses a 13-tap downsample designed for temporal stability — [Jimenez, SIGGRAPH 2014](https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/).
- A documented implementation uses 13-tap downsample weights, a 1-2-1 tent upsample with additive accumulation, 5–6 mips, no threshold and a bloom mix of roughly 0.03–0.15. A Karis average on the first downsample suppresses fireflies — [LearnOpenGL](https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom).
- MAME tone-maps on luminance: `mappedL = 1 - exp(-L)`, `mappedRGB = hdr*mappedL/L`, Rec. 709 weights, gamma 1/2.2 — [MAME BGFX docs](https://docs.mamedev.org/techspecs/bgfx_vector_crt.html).
- woscope adds small red and blue components so oversaturated pixels turn white — [woscope write-up](https://m1el.github.io/woscope-how/).

### Inferences

**Frame-rate-independent, multi-component persistence.** Treat the R, G and B channels of the accumulation buffer as decay bands rather than display colours:

```text
A_i(t+dt) = A_i(t) * exp(-dt/tau_i) + deposit_i
display   = sum_i (A_i * phosphorColor_i)
```

- This allows a P7-like response: a fast blue-white flash over a slow amber tail. Three exponentials can also approximate a hyperbolic tail, which single-exponential scopes cannot.
- Exponentials compose across any frame time, whereas a direct power law does not. That makes a sum of exponentials the right real-time form.
- The fade can be done in place with `blendFunc(ZERO, CONSTANT_COLOR)` and `blendColor(D1,D2,D3,1)`, avoiding a ping-pong copy and halving persistence memory.

**Converting phosphor figures (computed).** `tau = t10 / ln(10)`, assuming a single exponential and that the quoted time is decay to 10%:

| Quoted t10 | tau | Retained per frame at 60 fps | At 120 fps |
|---|---|---|---|
| 50 us | 0.022 ms | 0 | 0 |
| 1 ms | 0.43 ms | 0 | 0 |
| 20 ms (P1-like) | 8.7 ms | 0.147 | 0.383 |
| 300 ms | 130 ms | 0.880 | 0.938 |

- Short phosphors leave nothing between 60 Hz frames, so their look depends on sub-frame deposit and bloom. Offer presets as "character" and do not claim literal emulation.

**Precision limits (derived).**
- RGBA16F stops decaying when the per-frame change falls below about half a unit in the last place, about `dt/tau < 2^-11`. That is a tau of about 34 s at 60 fps and 17 s at 120 fps. Add a small subtractive floor to clear residual ghosts.
- R11G11B10 has far less mantissa, so slow trails stall at roughly 1–2 s and can shift hue. It is suitable for bloom mips, not persistence.

**Finishing order.** Deposit, decay, bloom and exposure should all stay linear. Tone-map once, then apply the display transform. Luminance-preserving tone mapping keeps hue; per-channel mapping desaturates the hot core to white, which often reads more like a real beam. Expose this as a mix.

### Gaps
- No manufacturer datasheet with full decay curves was obtained. The HP application note and phosphor PDFs were retrieved but could not be parsed because no PDF tools were installed.
- No reliable P31 emission peak was confirmed.
- No measured data was found on how decay varies with excitation level at scope beam currents.

## Leading tools and artists: what each teaches, and reusable licences

### Takeaway
The open reference chain runs from woscope (analytic beam) to Oscilloscope (brightness and 3D channels) to MAME BGFX (complete HDR pipeline). osci-render is the leading open tool for generating audio from geometry, but it is GPLv3, so it should be studied rather than copied unless the project accepts GPL terms.

### Cited Findings

**Licences and activity**

| Project | Licence | Last push / release | Relevance | Reuse position |
|---|---|---|---|---|
| [woscope](https://github.com/m1el/woscope) | MIT | Pushed 2017-03 | Analytic beam | Reusable with notice |
| [Oscilloscope](https://github.com/kritzikratzi/Oscilloscope) | MIT; uses openFrameworks (mostly MIT/BSD) and FFmpeg (LGPL 2.1) | Pushed 2024-03; v1.1.0 Jan 2022 | Beam, Z and 3D channels | Shader reusable with notice; do not bundle FFmpeg casually |
| [osci-render](https://github.com/jameshball/osci-render) | GPL-3.0; names and branding excluded | Pushed 2026-10 | Geometry-to-audio | Do not copy code into a non-GPL project |
| [Phosphor](https://discourse.threejs.org/t/phosphor-vintage-oscilloscope-simulator-with-multi-pass-phosphor-rendering/91293) | MIT (per author) | Not checked | three.js pass layout | Reference only |
| [ofxLaser](https://github.com/sebleedelisle/ofxLaser) | Non-commercial share-alike licence, with a conflicting Apache-2.0 sidebar label | Not checked | Laser path handling | Do not reuse |
| [lasy](https://github.com/nannou-org/lasy) | GitHub reports NOASSERTION | Not checked | Path optimisation | Read licence before any reuse |

**What the tools do**
- Oscilloscope by Hansi Raber is "made for looking at music." It credits m1el for physical rendering, added brightness modulation for 3-channel files (1.0.9) and 3D playback for 4-channel files (1.0.8) — [Oscilloscope page](https://oscilloscopemusic.com/software/oscilloscope/).
- The same site is the home of Jerobeam Fenderson's oscilloscope music links — [oscilloscopemusic.com](https://oscilloscopemusic.com/software/oscilloscope/).
- osci-render renders 3D objects, SVG and text to audio, with Lua scripting, Blender line-art integration and MIDI, as a standalone app or VST3/AU plugin — [osci-render](https://github.com/jameshball/osci-render).
- Its visualiser exposes persistence, focus, glow, afterglow, line and screen saturation, ambient and noise, plus sweep/trigger and an upsampling toggle — [VisualiserSettings.h](https://github.com/jameshball/osci-render/blob/main/Source/visualiser/VisualiserSettings.h).
- TouchDesigner's xyScope converts a two-channel CHOP to a SOP, with Particles, Feedback, Color and Resolution controls — [Derivative docs](https://derivative.ca/UserGuide/Palette:xyScope).
- TouchDesigner's Laser CHOP classifies points as corner points or guide points — [Laser CHOP](https://derivative.ca/UserGuide/Laser_CHOP).

**Laser path lessons (Pangolin Beyond)**
- Anchor points are extra samples at one location that give scanners time to accelerate and stop. Too many visible anchors create a bright dot — [Pangolin wiki](https://wiki.pangolin.com/beyond:vectors_and_points).
- Blank anchors stop the scanners before the next move and prevent a visible tear — [Pangolin wiki](https://wiki.pangolin.com/beyond:vectors_and_points).
- A longer path spreads fixed power thinner, so smaller shapes look brighter unless compensated — [Pangolin wiki](https://wiki.pangolin.com/beyond:vectors_and_points).
- ILDA's two standard test speeds are 12K and 30K points per second — [Pangolin](https://pangolin.com/blogs/news/laser-scanners-the-ilda-test-pattern).
- lasy implements graph and draw-order optimisation with blanking and sharp-angle delays, citing Abderyim et al. — [lasy README](https://rust-digger.code-maven.com/src/lasy-0.4.1/README.md).

### Inferences
- A laser's power budget is the same physics as beam dwell. For generated curves, resample by arc length and curvature, add a controlled dwell at sharp corners, and blank the jumps between sub-paths. This gives clean drawn figures without the stray retrace lines common in naive XY output.
- For true audio input, do not reorder or resample by arc length. The signal path is the artwork.
- Brightness normalisation is a creative decision. Physical behaviour makes small shapes blinding, so offer a soft auto-exposure based on total path length.
- Compete on technique rather than resembling these tools: use original colour response, presets and framing, and no third-party branding or sample assets.

### Gaps
- OsciStudio's features and licence were not confirmed; the page fetched only links to it.
- Resolume and Notch oscilloscope approaches were not researched to a primary source, so no comparison is claimed.
- Vectrex-specific emulation beyond MAME's generic renderer was not reviewed.
- MAME's licence for the BGFX shader files was not checked. Verify per file before reusing any code.
- osci-render's beam shader location was not found in the current tree, so its exact formulas are not reported.

## True audio X/Y input: capture, stereo-to-XY, interpolation, latency, display sync, Z-axis

### Takeaway
Capture raw stereo in an AudioWorklet, move samples through a pre-allocated ring buffer, and draw exactly the samples that became audible since the previous frame. Add 4x windowed-sinc upsampling so sharp corners become the rounded paths a band-limited signal really traces.

### Cited Findings
- `process()` runs synchronously on the audio thread. Blocks are currently 128 frames, but code should read the array length because this may change — [MDN process()](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process).
- Unconnected inputs have zero channels, and an uncaught exception silences the node for the rest of its lifetime — [MDN process()](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process).
- Chrome's design guidance avoids message passing for real-time audio because of repeated allocation and latency. It recommends pre-allocated SharedArrayBuffer ring buffers, with the processor never blocking on a Worker — [Chrome AudioWorklet patterns](https://developer.chrome.com/blog/audio-worklet-design-pattern).
- `getOutputTimestamp()` pairs `contextTime` with `performanceTime`, mapping the audio clock to the `requestAnimationFrame` clock. Values are estimates and may be stale before playback — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp).
- `getUserMedia()` needs a secure context, and audio constraints are given through `MediaTrackConstraints` — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- woscope names sinc interpolation as the fix for sharp corners but does not implement it — [woscope write-up](https://m1el.github.io/woscope-how/).
- Oscilloscope treats a third channel as brightness and supports 4-channel files for 3D — [Oscilloscope page](https://oscilloscopemusic.com/software/oscilloscope/).

### Inferences

**Pipeline**

```text
Input (getUserMedia / media element / internal synth)
  -> AudioWorklet: copy L/R(/Z) into SAB ring, write Atomics frame counter
  -> Render frame: read audible position via getOutputTimestamp
  -> Take samples in (lastDrawnFrame, audibleFrame], plus filter history
  -> Upsample, build segments, deposit with per-segment age
```

- Request `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false` and `channelCount: 2`, then read the actual settings back. Voice processing would destroy the stereo phase that forms the image.
- Drawing the exact interval between frames avoids the duplicated or missing samples of an `AnalyserNode` snapshot. Clamp the interval after a stall, and keep the 100 ms cap so a hitch does not flash.
- Provide a `postMessage` transfer fallback when the page is not cross-origin isolated.

**Budgets (computed)**

| Rate / display | 1x | 2x | 4x | 8x |
|---|---|---|---|---|
| 44.1 kHz, 60 fps | 735 | 1,470 | 2,940 | 5,880 |
| 48 kHz, 60 fps | 800 | 1,600 | 3,200 | 6,400 |
| 48 kHz, 120 fps | 400 | 800 | 1,600 | 3,200 |
| 96 kHz, 60 fps | 1,600 | 3,200 | 6,400 | 12,800 |

- A 32-tap polyphase sinc at 4x from 48 kHz stereo is about 12.3M multiply-adds per second, with about 0.33 ms group delay. Run it in a Worker or on the render side, not in `process()`.
- One 128-frame quantum at 48 kHz is 2.67 ms. A 60 Hz frame is 16.7 ms and dominates visual latency.
- A cheaper quality tier is Catmull-Rom in the vertex stage, fetching four neighbouring samples from a data texture. It rounds corners but is not band-limited.
- When changing upsample factor `k`, divide each segment's energy by `k`, or image brightness will jump.
- Z handling: map a third channel to beam energy as `E *= clamp(gain*z + bias, 0, 1)`, with a threshold for hard blanking. Standard audio interfaces are often AC-coupled, so a held DC level may not survive hardware input, while file or internal-synth channels are exact. Confirm this for the show interface.

### Gaps
- No measured end-to-end browser latency for this pipeline was found, and `outputLatency` accuracy varies by device.
- Current cross-origin isolation requirements for SharedArrayBuffer were not verified from the primary spec in this pass. The Chrome article predates them and does not cover them.
- The AudioWorklet-to-Electron or multi-channel device path was not tested.

## Curve vocabulary: Lissajous, harmonographs, roses, 3D, wavefolding, feedback, musical ratios

### Takeaway
Drive every curve from one phase accumulator with small integer ratios. Figures then close, remain legible and can move musically through slow phase drift, and the same generators can be emitted as audio for true XY display.

### Cited Findings
- Lissajous: `x = A sin(at + d)`, `y = B sin(bt)`. Rational `a/b` closes, irrational `a/b` never closes. With `a = b`, the figure is an ellipse, a circle at `d = pi/2` and equal amplitudes, or a line at `d = n*pi` — [Lissajous curve](https://en.wikipedia.org/wiki/Lissajous_curve).
- Harmonograph: `x(t) = A1 sin(t f1 + p1) e^(-d1 t) + A2 sin(t f2 + p2) e^(-d2 t)`, with the same form for y using a further two terms — [Harmonograph](https://en.wikipedia.org/wiki/Harmonograph).
- Rose: `r = a cos(k theta)`, `k = n/d` in lowest terms. If n and d are both odd there are n petals, otherwise 2n. The curve closes after `d*pi` when `n*d` is odd and `2*d*pi` otherwise — [Rose (mathematics)](https://en.wikipedia.org/wiki/Rose_(mathematics)).
- osci-render demonstrates 3D objects, SVG and text as drawable audio paths — [osci-render](https://github.com/jameshball/osci-render).
- xyScope includes feedback as a core visual control — [Derivative docs](https://derivative.ca/UserGuide/Palette:xyScope).

### Inferences

| Family | Formula | Live control |
|---|---|---|
| Phase-locked Lissajous | `x=sin(a*phi+delta)`, `y=sin(b*phi)` | Ratio from a set; `delta` drifts with beat phase |
| Harmonograph | Damped sums, reset or re-excited on kick | Damping = decay; retrigger amplitude |
| Rose | `r=cos((n/d)*theta)` | Step n/d; morph radius |
| 3D figure | Rotate curve or wire path, perspective divide | Camera orbit; depth to brightness |
| Wavefold | `sin(g*x)` or triangle fold | Fold gain from bass or macro |
| Ring / AM | `x*=1+m*sin(c*phi)` | Depth and integer `c` |
| Phosphor feedback | Warp previous buffer, gain below 1 | Zoom, rotate, decay |

- Good default ratios are 1:1, 2:1, 3:2, 4:3, 5:4, 5:3 and 8:5. They correspond to familiar just intervals and close quickly.
- Change ratios only on a beat or at a shared zero crossing, then crossfade between old and new figures. Directly lerping `a` or `b` passes through irrational ratios and collapses the figure into dense noise.
- Move `delta`, rotation and amplitude continuously. These keep the same figure while feeling alive.
- Use a wrapped phase accumulator, because long shows lose float precision if time is multiplied directly by frequency.
- Wavefolding adds high harmonics, so raise the point density or upsample when fold gain is high.
- Feedback must keep total gain below 1 in every band, with a hard energy clamp and NaN guard. Run it on the persistence buffer only when enabled, as it has a real cost in fill and stability.

### Gaps
- The musical ratio list is standard interval theory applied by judgement. No perceptual study of ratio legibility in scope imagery was found.

## GPU strategies: instancing, vertex pulling, transform feedback, WebGPU compute, segment counts, adaptive quality

### Takeaway
Instanced quads in WebGL2 are enough: audio-rate geometry is only thousands of segments per frame, so the real cost is fragment overdraw and bloom. WebGPU's value is moving upsampling and path processing into compute with storage-buffer vertex pulling, while keeping a vertex-buffer fallback.

### Cited Findings
- MAME stores each beam as an instance record and expands a unit quad in the vertex shader — [MAME BGFX docs](https://docs.mamedev.org/techspecs/bgfx_vector_crt.html).
- MAME's memory is dominated by two full-resolution and two half-resolution RGBA16F targets, and it falls back to normal lines if these cannot be created — [MAME BGFX docs](https://docs.mamedev.org/techspecs/bgfx_vector_crt.html).
- A public four-pass WebGL scope with 4,096 point sprites reports comfortable 60 fps on integrated GPUs. This is the author's claim, and it uses sprites rather than erf segments — [Phosphor pipeline article](https://dev.to/the_l_man/building-a-multi-pass-phosphor-rendering-pipeline-in-webgl-113o).
- A TU Wien thesis found vertex pulling clearly faster than instancing on recent high-end GPUs and rendered ten million particles at about 63 fps on a GTX 1060 using compute. These are particles, not beam segments — [TU Wien thesis](https://www.cg.tuwien.ac.at/research/publications/2023/PETER-2023-PSW/PETER-2023-PSW-.pdf).
- The same thesis notes a 128 MB default maximum storage-buffer binding — [TU Wien thesis](https://www.cg.tuwien.ac.at/research/publications/2023/PETER-2023-PSW/PETER-2023-PSW-.pdf).
- WebGPU's `maxStorageBuffersInVertexStage` defaults to 8, but its compatibility-mode default is 0, so vertex pulling cannot be assumed there — [WebGPU spec](https://www.w3.org/TR/webgpu/).
- VTK's WebGPU work uses storage-buffer vertex pulling in production, and notes WebGL2 lacks texture buffers and geometry shaders — [Kitware](https://www.kitware.com/faster-rendering-of-large-number-of-actors-in-vtk-with-webgpu/).

### Inferences

**Strategy comparison**

| Strategy | Use | Notes |
|---|---|---|
| WebGL2 instanced interleaved buffer | Default | Bind one point buffer twice with a one-point offset so instance `i` reads `P[i]` and `P[i+1]`. In three.js: `InstancedBufferGeometry` with `InstancedInterleavedBuffer` |
| WebGL2 data-texture pulling | Advanced | `texelFetch` by `gl_InstanceID`; enables neighbour access for Catmull-Rom and history without re-upload |
| Transform feedback | Optional | Viable for GPU-side path processing, but adds complexity for little gain at these counts |
| WebGPU compute + storage buffer | Future | Upsample, cull, write indirect args, pull in vertex stage |
| WebGPU vertex-buffer fallback | Required | For compatibility mode with zero vertex-stage storage buffers |

**Fragment cost (computed for 6,400 segments at 1080p, 4-sigma padding, before bloom):**

| Sigma | Avg segment | Fragments per segment | Screen-equivalents |
|---|---|---|---|
| 1.0 px | 2 px | 80 | 0.25 |
| 1.5 px | 2 px | 168 | 0.52 |
| 1.5 px | 8 px | 240 | 0.74 |
| 3.0 px | 2 px | 624 | 1.93 |

- Fill grows roughly with sigma squared for dense paths, so widen glow through bloom rather than beam sigma.
- Upload is small: 6,400 XY float pairs is about 51 KB per frame, about 3 MB/s at 60 fps. Use a pre-allocated ring and partial updates.
- Suggested targets, to be benchmarked: 3,200 segments on integrated GPUs, 6,400–12,800 on discrete GPUs, and tens of thousands only for generated or multi-trace scenes.

**Adaptive quality, in order of least visible loss:** reduce bloom mip resolution; lower upsample from 8x to 4x to 2x with energy compensation; render the beam at reduced resolution with a sharpened composite; shorten quad padding; finally reduce trace count. Use hysteresis on smoothed GPU frame time so quality does not oscillate in a show.

**WebGPU path:** keep beam math, decay and tone mapping as pure functions that can be mirrored in GLSL and WGSL. Separate the "segment producer" from the "beam renderer" so compute can replace the CPU producer without changing the visual result.

### Gaps
- No direct benchmark was found of erf-beam segments under WebGL2 versus WebGPU. Segment targets above are estimates and need testing on the show machine.
- WebGPU's blendability table for `rgba16float`, plus the `float32-blendable` and `rg11b10ufloat-renderable` details, could not be extracted from the spec in this pass. Verify in spec section 26.1 before implementation.
- three.js `WebGPURenderer` support for this custom instanced pipeline was not tested.
