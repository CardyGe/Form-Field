# Form & Field: fidelity audit and improvement plan

11 November 2026 · source 0.11.0 · compared against 7 reference recordings

## 1. What the references are asking for

| Ref | What it is | What makes it work |
| --- | --- | --- |
| 20.46.00 | Datamosh / feedback tunnel | Recursive inset frames, pixel-sort smears, chroma bleed, photographic texture fed through time. **Stateful: each frame depends on the previous one.** |
| 18.14.10, 18.16.08 | Cube projection mapping | Flat, ultra-saturated cartoon bands with dark outlines, drips that flow **across faces** (top cube to lower cube), concentric squares on top faces, a white grid "line-up" intro. **Content is authored per surface.** |
| 11.30.48 | p5.js generative montage | Crisp flat vector shapes (pills, circles, tiles, spirals) and hard edges. No shading, just rhythm, density and colour. |
| 11.51.20 | Painted Super 8 / 16mm, pen light tunnels | Real hand-made marks on film: grain, irregularity, frame-to-frame jitter. |
| 12.41.03 | Scanned paint + slit-scan staircase | Real paint texture with blocky time displacement and stepped tunnels. **Texture comes from real material, not from noise.** |
| 12.47.38 | Acrylic pour / cells | Real fluid behaviour: cells, lacing, glossy domes with sharp speculars, saturated yellow on cyan. |

Three things run through all of them:
1. **Bold, saturated, hard-edged colour.** Neon on black, flat fills, outlines.
2. **Material that comes from something real or something simulated.** Scans, film, fluids, feedback.
3. **Time as a process.** Feedback, advection, slit-scan, drips that travel. Not a field that oscillates in place.

## 2. What the app does now

Current renders, from `work/effect-audit-2026-11-11/*-hd.png`, are mostly:
- soft, muted teal/grey/pearl palettes with PBR-style height-normal shading and sheen;
- centred objects on black, or uniform analytic fields: Voronoi, bands, rings;
- motion where the whole image breathes or oscillates on one shared phase.

They look like competent shader demos. They don't look like the references. The app's own audit (`docs/effect-audit-2026-11-11/README.md`) already reaches a similar conclusion.

## 3. What's good (keep it)

- **Loop clock is correct by construction.** `phaseAtFrame(i, N) = i·2π/N`, integer cycles per loop, cyclic monotone keyframes (`src/core/timeline.ts`). Frame N is never rendered, so there's no duplicated seam frame. This is the right foundation.
- **Linear half-float pipeline.** Sources and accumulation use `HalfFloatType` render targets. sRGB conversion and dither happen only at display (`StudioRenderer.ts:56-73`).
- **Export pipeline is professional.** Half-float EXR per frame, then ffmpeg zscale, then ProRes 422 HQ / 4444 with 16-bit alpha, or a PNG sequence. Tags are BT.709. ffprobe verification and resumable jobs are in place (`electron/export-manager.cjs:174-180`).
- Deterministic seeds, seekable frames, a 4-layer compositor with masks, blend modes and tonal finishing, project save/undo, and a real test suite.
- Bundled ffmpeg already includes the **`hap`** encoder, so the projection-standard codec is one argument list away.

## 4. What's holding fidelity back

### 4.1 Architecture: everything is a stateless `f(pixel, phase)`
Almost every effect is a fragment shader evaluated from phase alone. That's why loops are perfect. It's also why nothing looks like the references: feedback, datamosh, fluid, drips, pixel sorting, slit-scan and particles all need **state carried between frames**. The exceptions (Ink sim, Super 8 history, Oil wakes) are bolted on per instrument rather than built as a shared capability.

### 4.2 Aesthetic defaults point the wrong way
- The shared lighting/coat model (height normals, clear coat, sheen, opal) gets applied to almost everything. The references are almost entirely **unlit flat colour**, apart from the pour's specular domes.
- Palettes are desaturated and "tasteful". The references use neon complementary pairs at full saturation on black.
- There's no outline/ink-line treatment and no posterised banding with hard edges, the core of the cube-mapping look.
- There's no way to bring in real texture (scans, paint, film) as a *material* that gets displaced. Image import exists only as a layer.

### 4.3 No anti-aliasing for shader fields
MSAA (4 samples) helps only rasterised geometry. Fields rely on scattered `fwidth` filtering. Thin lines and hard edges will crawl and shimmer at projector scale. Export has **no supersampling** and **no motion blur**. At 4K on a wall, both show.

### 4.4 Not projection-aware
There's no concept of the target object. The cube references are authored per face, with content that continues across edges. The app outputs one rectangle, and "Surface influence" is only a 2D mask or polygon.

### 4.5 Delivery formats
ProRes is right for editing. Projection playback (MadMapper, Resolume, Millumin, TouchDesigner) wants **HAP / HAP Q / HAP Alpha**, which has GPU decode and scrubs at 4K. There's also no H.265 preview export and no projector-native size presets (1920×1200 WUXGA, 3840×2400, custom multi-projector canvases).

### 4.6 Scope sprawl and code density
17 families, 139 presets, 10 "instruments", and every iteration adds controls. The code is written dense: one-line shader strings, an 85 KB `App.tsx`, a 43 KB `StudioRenderer.ts`. That makes each visual change expensive and fragile. Breadth has outrun depth: nothing is at reference quality yet.

## 5. The plan

Order matters: build the engine features first, then rebuild **a few** looks to reference quality on top of them, and only then widen again.

### Phase 0: Quality bar and tooling (small)
1. **Pick 3 hero targets from the references**, for example *Drip Strata* (cube bands and drips), *Feedback Tunnel* (datamosh/recursive frames) and *Pour* (acrylic cells). Write each as a one-paragraph brief with a reference still.
2. **Seam check tool:** render frames N-2, N-1, 0, 1 and report the per-pixel delta between N-1→0 and the average neighbouring delta. Flag a seam if the jump is more than 1.5× typical. Run it on every export.
3. **Freeze the library.** No new presets or instruments until the heroes pass.

### Phase 1: Export fidelity (small/medium, highest leverage)
1. **Supersampling on export:** render at 2× (option 3×) into half-float, downsample with a Lanczos or Mitchell filter in a shader pass. Preview stays at 1×.
2. **Loop-safe motion blur:** accumulate K sub-frame samples across a shutter angle (e.g. 180°, K = 8–16) by evaluating phase ± δ, **wrapped mod 2π**, so the blur is seamless across the loop point. For stateful sims (Phase 2), blur from interpolated sim states.
3. **HAP / HAP Q / HAP Alpha** via the bundled ffmpeg (`-c:v hap -format hap_q`, chunked for 4K). Add an **H.265 10-bit (VideoToolbox)** preview format.
4. **Projector presets and custom canvas size**, including non-16:9 and multi-output widths. Dimensions are multiples of 4 for HAP.
5. Keep EXR→ProRes as the master path. Add an optional **"loop proof" MP4** that plays the loop 3 times, for review on a phone or projector.

### Phase 2: Stateful engine with guaranteed loops (medium/large: the core unlock)
Add one shared **simulation layer type**: ping-pong half-float targets, a fixed step, and deterministic seeds. Support three loop strategies, chosen per effect:

| Strategy | How | Good for |
| --- | --- | --- |
| **Periodic steady state** | Drive the sim with forcing that's periodic in phase, pre-roll M cycles until frame N ≈ frame 0 (measured), then record one cycle. Works for any **dissipative** system. | Video feedback, datamosh, drips with decay, trails |
| **Crossfade bake** | Simulate N+K frames, blend the last K into the first K (in linear light, or with optical flow for sharper results). | Fluids, reaction-diffusion, pours |
| **Dual-phase flow map** | Advect texture coordinates by a velocity field, with two copies offset half a cycle and crossfaded with a triangle weight. Stateless and perfectly periodic. | Paint/liquid flowing over scanned texture, drips, "melting" bands |

Bake stateful layers to a frame cache (they already have a cache directory) so preview scrubbing and export stay deterministic.

Build these processes on it:
- **Feedback node:** previous frame → transform (zoom/rotate/offset) → colour shift → mix with source. This is the datamosh tunnel reference.
- **Displacement/slit-scan node:** a ring buffer of the last ~64 frames, where each row or block samples a different time offset. This is the 12.41.03 staircase look.
- **Pixel sort / block smear** (threshold-gated per row or column).
- **2D stable fluid** (or the existing ink extended) with dye injection and a surface-tension "cells" pass for the pour look.
- **GPU particles** with trails, for fibres, rays and the light-tunnel pens.

### Phase 3: Look language (medium)
1. **Flat/Toon render mode as the default**: posterise any field into N hard bands with analytic anti-aliasing (`fwidth`), plus an **outline pass** (edge detect on band index) with controllable width and colour. Lighting becomes opt-in.
2. **Palette system rebuilt around saturation:** neon sets, complementary pairs, black-background contrast, and a palette-cycling motion mode with integer cycles.
3. **Texture as material:** import scans, paint or film. Use them as the albedo that flow maps, feedback and slit-scan displace. Ship a small set of your own scanned textures.
4. **Film emulation pass** (grain, gate weave, light leaks, frame jitter) on the final output, using loop-safe periodic noise. This is shared, not only Super 8.

### Phase 4: Projection-aware composition (medium/large)
1. **Surface template mode:** import a PNG/SVG UV layout, or pick a box net (cube / stacked cubes). Each region gets its own layer stack, and fields are evaluated in **object space**, so bands wrap continuously around corners and drips flow over edges from top face to side.
2. **Line-up / reveal generators:** a wireframe grid traced on the template edges, edge glow chases and face-by-face reveals. The cube references open this way.
3. Export the template-space composite (for MadMapper/Resolume to warp) plus per-face crops.

### Phase 5: Rebuild the heroes, then widen (ongoing)
- Build the 3 hero looks on Phases 1–4 and compare side by side with the reference recordings, on an actual projector.
- Only after they pass, port or retire the existing families. Many current ones can survive as *sources* feeding feedback/flow/toon rather than as standalone looks.
- Code health while you do this: split shader strings into `.glsl` files (Vite `?raw`), split `App.tsx` and `StudioRenderer.ts` by concern, and stop the one-line style.

## 6. Suggested order of work

1. Phase 1.3 HAP export and 1.1 supersampling: small changes, immediate quality win for projection.
2. Phase 0 seam checker and hero briefs.
3. Phase 3.1 toon/outline mode: quickest jump toward the cube references with no new engine.
4. Phase 2 sim layer with the feedback node first, then slit-scan, then flow-map paint.
5. Phase 1.2 motion blur, once the sim layer exists.
6. Phase 4 surface templates.
7. Phase 5 hero rebuild and library cull.
