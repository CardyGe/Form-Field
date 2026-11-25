# First-hand code audit, benchmark and reference-clip analysis

Collected directly from the repo on 2026-11-21 (branch map-stage-1, working tree has uncommitted work). These are primary findings. Treat them as verified unless marked as inference.

## User's goal

"Audit fractals and kaleidoscopes. Both need lots of work." Six reference clips show how the user wants each to work. Do big research on how they can be improved and made performance-ready for live shows and art installations. Make them the best, industry leading.

Standing user preference: a reference is inspiration, not a target. Build each effect as its own standalone instrument. Do not propose combined "match the source" compositions or recreate the clips. Keep additions beyond the request minimal.

## Reference clips (720x1280, 30 fps; observed from 12-frame contact sheets, so motion claims are limited)

1. 15 s. Log-polar spiral of scale-like mosaic tiles in red, yellow, green, blue. Infinite inward spiral. Sampled frames alternate between a dark version with a bright central disc and a fully bright version, which suggests a strong pulse or strobe. Check flash safety.
2. 14 s. Nested heart and circle contours made from thousands of fine spectral lines and dots, on dark ground with a light beam and particles. Shape morphs heart to mandala. Looks pre-rendered or AI-generated, with a landscape and small figure. Useful idea: line-field contour shapes, spectral dispersion, shape morphing. Not a real-time target as a whole scene.
3. 58 s. Thin neon curves on black in a mirrored wallpaper lattice with swirl warps; colour and line phase travel along curves.
4. 30 s. Interlaced over/under ribbons in orange and teal with tube shading, rosette symmetry and a dark centre. Very slow or subtle motion in sampled frames.
5. 18.5 s. Hard-edged blue/white rosettes: flower-of-life overlaps, posterised gradients, inversion, shape changes between sections. High contrast full-frame changes between sampled frames. Check flash safety.
6. 30 s. Mirrored dot-grid tunnel with perspective, saturated colour cycling, trails/feedback, lens bulge and melt moments.

Across the clips: strong graphic readability, one clear structure at a time, line and tile quality, continuous motion through symmetry, colour moving through structure, and section changes.

## Current implementation

- Fractal is one layer kind with three styles in one fragment shader: Kaleidoscope, Julia Bloom, Mandelbox. `src/rendering/fractal.ts`, `fractal-julia.ts`, `fractal-box.ts`.
- **There is no true kaleidoscope instrument.** "Kaleidoscope" is a 7-iteration folded IFS line ornament (`kaleidoscopeSample`, fractal.ts:64-106). It cannot take video, camera, image, another layer or feedback as input. `git grep -il kaleido -- src tests` finds only project.ts, fractal.ts and App.tsx.
- Symmetry is only a dihedral wedge (`wedge`, fractal.ts:30-35), 3 to 12 sectors. No wallpaper groups, log-polar/Droste, circle inversion, Mobius, hyperbolic or spherical tilings, and no over/under weaving.
- Only three kaleidoscope motifs: circle, ellipse petal, cross ribbon (fractal.ts:77-84).
- Zoom flight for the Kaleidoscope is a two-copy crossfade over the last 22% of the loop (fractal.ts:118-127), not true self-similar zoom. It evaluates the shader twice during the fade. Benchmark p95 is about 1.7x median for these presets, consistent with that doubling (inference).
- Julia: good maths. Smooth escape, distance estimate, orbit traps, analytic stroke filtering, exact looping dive via repelling period-2 cycle. Limits: 32-bit float, so no deep zoom; quadratic only; up to 256 iterations; live preview forces one sample.
- Mandelbox: sphere tracing up to 100 steps live, 12-14 fold iterations, 4-tap normal, 24-step soft shadow, 4-tap AO, all re-evaluated per pixel every frame at fixed step factor .6 (fractal-box.ts:90-110). No temporal reuse, no over-relaxation, no depth pre-pass, no adaptive resolution. Camera is a small periodic orbit; `approach` moves it inside.
- Live preview forces `uQuality=0`, and Mandelbox draws at fixed half resolution then upscales through a plain copy (StudioRenderer.ts:684-698). No temporal or spatial upscaler.
- Existing 2026-11-11 audit (`docs/effect-audit-2026-11-11/effects/03-fractal.md`) reached a similar view: maths is legitimate, framing and motion are the weakness. Its proposed authoring split was not implemented in the current code as far as observed.

## Live-show readiness (grep over src and electron)

- No audio analysis (`createAnalyser`, `AnalyserNode`), no MIDI (`requestMIDIAccess`), no OSC, Ableton Link, tap tempo, Syphon or NDI references found.
- WebGL context-loss handling exists only in `src/map/compositor.ts:253`. None found in `StudioRenderer` or `LiveRenderer`.
- No GPU timer queries, no parallel shader compile extension, no dynamic resolution, no photosensitive flash limiter found.

## Benchmark (measured)

Method: standalone WebGL2 harness in Electron using the repo's actual fractal shader and all 11 fractal presets. ANGLE Metal on Apple M5 Pro. RGBA16F target, quality 0 (live setting), Mandelbox at the app's half-resolution rule. 22 timed frames per preset across the loop, draw plus 1-pixel readback. This measures the fractal source pass only; compositing, finish passes, projection mapping and UI add more. Shader compile + link call: 118 ms (driver may defer some work until first draw).

| Preset | Style | 1080p median / p95 ms | 4K median / p95 ms |
| --- | --- | --- | --- |
| prismatic-fold | Kaleidoscope | 1.4 / 2.7 | 4.4 / 7.6 |
| velvet-petals | Kaleidoscope | 1.3 / 3.1 | 4.2 / 7.5 |
| luminous-weave | Kaleidoscope | 2.6 / 4.3 | 4.6 / 7.9 |
| ink-lace | Kaleidoscope | 1.6 / 2.3 | 4.7 / 7.8 |
| velvet-julia | Julia | 4.5 / 5.9 | 14.9 / 17.0 |
| coral-mandala | Julia | 4.2 / 5.0 | 16.6 / 18.5 |
| spiral-garden | Julia | 2.2 / 2.9 | 6.9 / 7.5 |
| ember-julia | Julia | 4.1 / 4.9 | 15.9 / 18.5 |
| abyssal-cathedral | Mandelbox (half res) | 13.0 / 14.4 | 52.4 / 55.4 |
| ivory-vault | Mandelbox (half res) | 11.1 / 12.4 | 42.9 / 46.9 |
| chromatic-lattice | Mandelbox (half res) | 13.2 / 14.9 | 52.5 / 55.0 |

Reading: at 60 fps the whole frame budget is 16.7 ms. Kaleidoscope has headroom even at 4K. Julia at 4K exceeds the budget at p95 before compositing on an M5 Pro. Mandelbox at 4K output runs about 18-23 fps even at half resolution, and at 1080p output uses most of a 60 fps frame. Lower-end machines will be worse (not measured).
