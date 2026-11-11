# Oil / Paint Slides — reference study and implementation plan

7 November 2026. Planning only; application code is unchanged.

**Recommendation:** add an **Oil Slides** instrument with a moving paint sheet, persistent-looking black cellular marks, and a separately moving glossy lens. Build it as a deterministic, three-pass 2.5D renderer inside the existing Three.js pipeline. First match the yellow/black/cyan reference; broader psychedelic palettes come afterward.

![Six reference moments](</Users/grego/Documents/ChatGPT/three VJ/docs/oil-paint-reference/keyframes.jpg>)

## What was inspected

Source: `Screen Recording 2026-11-07 at 12.47.38(1).mov`, recovered from the referenced chat's attachment. The supplied `/mnt/data/…` location does not exist on this Mac; the attachment was accessible through the chat's local file preview.

The MOV is **894 × 1480, 21.623333 seconds, H.264, 8-bit 4:2:0 Rec.709**, with no audio stream. Both decoding and timestamp enumeration produced **1,246 frames**. Nominal rate is 60 FPS; timestamps are variable, with approximately 16.7 or 33.3 ms between frames. Last presentation timestamp is 21.616667 seconds. All times below use those timestamps, not a presumed constant frame rate.

I reviewed **every decoded frame in 26 sequential contact sheets**, then inspected selected moments at native resolution. Thumbnail review establishes temporal coverage; native detail establishes the optical and surface features. Per-frame RGB differences and flat-colour detection support the transition audit; these measurements do not identify the underlying material or physical forces.

Local audit artifacts:

- [All 1,246 frames in order](../work/oil-slide-analysis/frame-review.html)
- [Per-frame timestamps and image-change measurements](../work/oil-slide-analysis/frame-audit.csv)
- [Reference keyframes](oil-paint-reference/keyframes.jpg)

The exhaustive audit is in ignored `work/`; the plan and six-frame reference are in `docs/`.

## Reference timeline

Frame numbers are zero-based. Timing divisions describe useful visual events, rather than separate effects.

| Time | Visible event | Implementation implication |
| --- | --- | --- |
| 0.00–~0.70 s | Near-static opening with a play overlay, a diagonal tool, and a circular cellular footprint | Exclude the player overlay. The cellular footprint is important even before the glossy dome appears. |
| ~0.70–1.25 s | Tool moves; a rounded transparent-looking dome becomes prominent, with a white reflection and dark interior | Separate lens shape and optics from paint coverage. Do not infer the exact application mechanism. |
| 1.25–2.30 s | Dense fine maze-like marks are visible through the dome; surrounding film moves more slowly | Maintain feature identity through refractive sampling. |
| 2.30–3.15 s | Fine threads elongate above the dome and remain visible inside it | Use one continuous underlying pattern across the lens boundary, refracted inside. |
| 3.15–4.70 s | Relative sliding changes direction; the dome becomes oblique and threads form a long diagonal wake | Drive stretching from relative sheet/lens motion, including rotation. |
| 4.70–5.35 s | Dome encounters a smaller yellow pool; its interior becomes greener/clearer | Contact with different underlying paint changes the lens's appearance. |
| 5.35–7.28 s | More cyan is exposed; a branching black pattern emerges on the yellow footprint behind the dome | This exposed cellular wake is a central fidelity test. |
| 7.30–7.40 s | Three isolated flat-yellow frames interrupt an abrupt reframing: frames 422, 425, 426 | Treat as recording/transition interruptions, outside the material model. |
| 7.40–10.38 s | Another sliding passage; internal dark cells and rings deform while bright reflections remain compact | Model pigment, lens refraction, and reflection separately. |
| 10.38–12.08 s | A rounded yellow pool meets the dome's edge; thick, winding black branches become exposed | Cellular detail must be localized by contact and coverage, rather than filling everything uniformly. |
| 12.08–15.00 s | Dome crosses a broad yellow sheet; a dark halo fans into fingers, dots, and connected channels | Couple contact radius, stretching, and pattern scale. |
| 15.00–18.35 s | Long, thin connectors stretch; rounded satellite pools coexist with a broad sheet and a domed form | Use multiple feature scales and different apparent surface heights. |
| 18.38–19.62 s | Abrupt background/reframing change, then the dome crosses another sheet | Exclude this jump from the smooth motion model. |
| ~19.63–20.85 s | Glossy dome disappears; a flat cellular patch remains and stretches with the sheet | Provide a dome-off/lift phase without deleting underlying material marks. |
| 20.87–21.05 s | More flat-yellow interruptions: frames 1202–1203 and 1206–1212 | Exclude from colour and temporal matching. |
| 21.07–21.62 s | Cut to a person operating a small illuminated setup, with the imagery on surrounding displays | Supports an analogue tabletop/camera workflow; does not prove the fluid recipe. |

The clip does not demonstrate a seamless loop. The app's loop must be designed rather than copied from the recording's endpoints.

## Visual anatomy

| Component | Direct observation | Proposed representation |
| --- | --- | --- |
| Motion | Broad material regions sweep beneath/around a relatively central dome. Shapes stretch, change orientation, and reveal patterned footprints. | Independent sheet transforms, lens path, local drag, and contact deformation. |
| Layers | Cyan field; yellow pools and sheets; black inclusions/veins; clear-looking domed region; reflections and offset shadows. | Internal material fields and optical passes within one composition layer. |
| Optics | Strong local magnification/distortion, a thick rim, a white spot plus broader reflection, blue/green interior accents. | Ellipsoidal cap height, normal-driven refraction, Fresnel-like reflection and small light cards. |
| Colour | Fluorescent yellow/lime dominates; cyan substrate, near-black ink, cobalt shadows, olive contact zones and occasional warm rims. | Named material colours with thickness-dependent absorption; controlled saturation. |
| Blend | Pigment boundaries remain dark and distinct. Overlap often darkens rather than washing toward white. | Coverage plus absorption/occlusion internally; shared layer blending externally. |
| Texture | Rounded spots, branched labyrinths, narrow filaments, specks, softly uneven paint thickness and fine cyan grain. | Separate masks at coarse, medium and fine scales. |
| Focus | Fine structures can be sharp beside softer pool edges and substrate grain. | Small spatially controlled softness, avoiding a global heavy blur. |

The camera alone cannot establish whether this is oil, paint, soap, ink, a glass element, or a mixture. Pressure, wetting and viscous fingering are **useful visual analogies**, not verified physical diagnoses. Subtle spectral accents are visible, but a full rainbow thin-film treatment is not the defining feature.

The dominant visual hierarchy is: **large quiet colour masses → glossy dome and contact halo → medium cellular branches → fine filaments and sparse specks**. Equal-strength noise at every scale would lose this hierarchy.

## Rendering approach

### One new instrument

Use a new layer kind, provisionally `oil`, displayed as **Oil Slides**. A preset consumes **one** of the app's four composition slots, including its internal sheets and lens. This gives its controls a clear meaning and avoids changing the existing Surface instrument's saved behaviour.

The app already provides:

- A Three.js `WebGLRenderer` with full-screen `ShaderMaterial` passes.
- Associated/premultiplied linear RGBA16F source and composition buffers.
- Shared transforms, masks, opacity, four blend modes and colour finish.
- Seeded variation and parameter modulation.
- Explicit periodic phase, arbitrary scrubbing, direct-resolution export and resumable per-frame rendering.

Preserve these contracts. Use the existing renderer and context; no second canvas, physics engine, WebGPU migration or generic postprocessing stack is necessary. Three.js supplies the required [custom shader material](https://threejs.org/docs/pages/ShaderMaterial.html) and [render-target](https://threejs.org/docs/pages/WebGLRenderTarget.html) interfaces. The project's installed Three.js version and local source remain the implementation baseline.

### Three source passes

```text
Saved layer + evaluated Motion + wrapped loop phase + seed
                     │
                     ▼
A. Material fields ──► oilFields (RGBA16F, raw numerical data)
                     │
                     ▼
B. Paint/substrate ──► oilUnderlay (linear premultiplied RGBA16F)
                     │
                     ▼
C. Lens optics ──────► existing source target
                     │
                     ▼
Existing transform / mask / colour finish / layer blending
                     │
                     ▼
Existing SDR finish → display or EXR → current native encoders
```

**A — Material fields.** Generate coarse pools, black cellular ink and contact effects in aspect-correct material coordinates. Start with this explicit packing: R = paint height, G = ink density, B = paint coverage, A = contact/wake influence. All channels are data, not colour or opacity. Use `NoColorSpace`, no depth/stencil, no MSAA and no mipmaps for this target. Do not run it through the existing colour-target helper without overriding its colour-space annotation.

**B — Paint and substrate.** Sample those fields to render the cyan support, yellow film, black ink, meniscus, local diffuse shaping and soft offset shadows. Derive normals from neighbouring height samples with explicit texel offsets and material-space scaling. Output associated linear RGBA. Base colour and its shadow are resolved before the lens so both can be distorted coherently.

**C — Lens optics.** Evaluate an analytic ellipsoidal cap and its normal, refract-sample B, apply thickness absorption, add restrained reflections and resolve its silhouette. Output to the existing source target. Never sample the target being written. Keep the world-space light direction stable as the material slides; reflection should respond to the cap's orientation and shape.

Allocate **two additional** scratch targets, lazily when the first visible Oil Slides layer needs them. Reuse them sequentially across Oil layers; resize only when dimensions/quality change and dispose them on renderer disposal or when releasing the instrument. Complete every pass for each layer to prevent stale data leaking from another layer.

For one visible Oil layer this is three source draws plus composite, finish and display: **six draws total**, compared with four for a single-pass source. Four Oil layers would be eighteen draws; quality and fill cost still need profiling.

### Geometry and morphology

1. **Paint sheet:** a bounded mixture of smooth blob fields and low-frequency domain warping. Its mask supports disconnected round pools, broad connected sheets and cyan holes. Keep the material coordinate system stable under independent translation/rotation.
2. **Cellular ink:** combine smooth cellular boundaries, rounded dark inclusions and a band-limited winding stripe field. Blend these by local contact/wake influence. Warp the stripe field along relative movement to create directional fingers, and broaden it into branching structures in the exposed footprint. Plain Voronoi cells alone will look too polygonal; broad palette contours alone will look like the existing Surface renderer.
3. **Contact:** calculate lens footprint in the sheet's coordinates, with a soft annulus and smooth compression/expansion. Use shared contact coordinates for ink density, paint height, meniscus and strain so details look connected.
4. **Lens:** begin with one ellipsoidal cap. Vary its aspect and small asymmetric lobes smoothly; keep the boundary regular enough to read as a wet dome. Bound cap slopes at the silhouette to avoid infinite normals or refraction offsets.
5. **Wake:** approximate a recent contact trail with a fixed, bounded set of previous positions on the analytic periodic path. Blend footprints smoothly with distance and age weighting. This is reconstructed for every phase, rather than accumulated in a texture. It can keep a cellular patch visible while the cap lifts away.

This models appearance rather than conserving fluid mass or reproducing irreversible mixing. The highest uncertainty is **convincing cellular-to-filament deformation**. Resolve that visually before expanding controls. If procedural pattern fields fail the reference test, try a seeded static labyrinth texture generated in a fixed preparation step and then deformed in material coordinates. Keep that texture generation reproducible and independent of frame history. Do not add an evolving reaction-diffusion solver merely to obtain a static pattern.

### Motion and exact loops

Use the existing radian phase `φ ∈ [0, 2π)` from `phaseAtFrame`; intrinsic cycles remain integer. Give each internal sheet its own closed transform and give the lens a separate closed path. Use a small mixture of harmonics for slow pauses, faster pulls and asymmetry, rather than one uniform circular orbit.

A representative path component is `x(φ) = x₀ + a₁ sin(φ + α₁) + a₂ sin(2φ + α₂)`. Use independent coefficients for y, rotation and cap tilt. Multiplying wrapped phase by integer cycle counts preserves periodicity.

**Relative motion matters:** transform the lens into the moving sheet's coordinate system before deriving the direction of strain. Whole-image motion must not stretch the material by itself. Use the path's analytic derivative or symmetric phase samples. When speed is near zero, blend directional stretching toward an isotropic contact response instead of normalizing a zero vector.

For viscosity-like lag, use phase-shifted harmonics with attenuated high frequencies. For a wake sample, evaluate the closed path at `φ − jΔφ` and wrap correctly. These operations must depend only on the requested phase and saved values; avoid frame-by-frame interpolation, elapsed wall time, per-frame random numbers or previous rendered colour. If Motion routes change a path parameter, reconstruct each wake sample using the saved layer evaluated at that historical phase. Pass the original layer to the motion helper for this purpose, rather than treating the already-evaluated current parameters as the whole history.

Treat trail length initially as a fraction of the loop so changing duration alters playback speed consistently. Document that it is an artistic drag control, not measured physical viscosity. All intrinsic motion, including lift/settle, can be disabled. Existing explicit modulation routes may still animate a control.

Test both matching values and matching derivatives at the wrap. Do not attempt to force unrelated endpoints together with a whole-image crossfade; double domes and doubled ink patterns would be visible.

### Optics, colour and alpha

Use a simple normal-based refractive offset first; if its magnification feels flat, upgrade to an analytic ray/cap intersection and refracted ray intersection with the substrate plane. Both are cheaper and easier to control than a full scene ray marcher. Sample a single underlying image so continuous lines remain related inside and outside the lens. Bound offsets at grazing angles and extend substrate sampling beyond the visible viewport where needed.

Use a homogeneous absorption approximation `T = exp(−σ × thickness)` for clear/tinted regions. This gives independent colour channels and darkening at thicker edges; it is an artistic approximation, not a reconstructed material measurement. This form follows the standard [transmittance model](https://www.pbr-book.org/4ed/Volume_Scattering/Transmittance).

Opaque yellow pigment also needs its own body/scattering colour; absorption alone would make yellow over cyan too dark. Layer pigment body colour by coverage, then apply clear-film absorption and dark ink. Keep black ink distinct from transparent holes. A compact white light and broader light-card reflection should provide most gloss; avoid white highlights over the entire dome.

Reuse the six-colour palette storage but label its roles: **Paint, Secondary paint, Ink, Substrate, Shadow tint, Rim tint**. These are proposed editable colours, not measured spectral values. Approximate starting sRGB colours: `#EEFF00`, `#A7DE12`, `#060710`, `#25B8ED`, `#071275`, `#E2A51C`. Match by eye against clean reference regions before treating them as presets.

Keep material calculations linear, apply shared exposure/saturation/hue once, and retain the current finish/output conversion. Small warm rims or blue accents may be added after the match; default thin-film iridescence and global hue cycling to zero.

Default reference preset is opaque, with its own cyan substrate. A cutout option may suppress that substrate and export pigment/dome coverage with premultiplied edges, converted to straight alpha by the existing output pipeline. **A normal RGBA cutout cannot encode refraction of an arbitrary background added later.** Version one refracts its internal substrate only; a composition-aware lens that bends other app layers would require an explicit below-layer sampling design. Do not promise that behaviour from alpha export or from the existing blend controls.

Internal sheet overlap uses material coverage/absorption. Existing Normal, Screen, Multiply and Add remain available for the finished instrument layer; Normal is the reference default.

## Integration map

| Existing boundary | Planned work |
| --- | --- |
| `src/shared/types.ts` | Add `oil` to `LayerKind` and to the allowed preset kinds. Retain the current numeric parameter map and six-colour storage for the first version. |
| `src/core/project.ts` | Register definitions, defaults, presets, creation label/palette, strict allowed-kind validation and variation behaviour. Explicitly register discrete choices so gentle variation does not switch the algorithm or quality. |
| `src/core/timeline.ts` | Reuse existing evaluation. Put instrument kinematics in a small pure helper if needed; do not create a second clock. |
| Proposed `src/rendering/oil.ts` | Own the three shader strings, field definitions and rendering limits. A small `oil-motion.ts` helper may own closed paths and bounds. |
| `src/rendering/StudioRenderer.ts` | Add materials, lazy scratch buffers, uniforms and an explicit `oil` branch in `drawSource`; extend resize/disposal. Its current final branch assumes sculpture, so this branch is mandatory. |
| `src/ui/App.tsx`, `src/ui/styles.css` | Add instrument entry, icon/label, palette role labels, presets/filter/caption and appropriate choice controls. Use the existing Shape, Motion, Material and Finish workflow. |
| `electron/export-manager.cjs` | Extend native allowed-kind validation; otherwise a preview could work while export rejects the layer. Keep the existing EXR contract and renderer fingerprint checks. |
| `README.md`, existing tests and verification scripts | Describe optics/alpha limits, add compatibility and export coverage, and include the new renderer in visual proof checks. |

Schema 1 can remain structurally compatible because the new kind fits the existing layer structure. New builds must load existing projects unchanged; older builds will reject new Oil layers. If implementation instead needs arbitrary arrays of independent editable sheets or external simulation assets, revisit versioning explicitly rather than hiding those structures in unrelated numeric controls.

## Controls and starting looks

Keep about twelve primary controls visible initially. Place finer tuning in advanced groups. Ranges are proposed starting bounds, not recovered reference settings.

| Group | Primary controls | Initial bounds / behaviour |
| --- | --- | --- |
| Shape | Pool size, Paint coverage, Cell size, Lens size | Size relative to short canvas dimension; coverage 0–1; lens radius roughly 0.10–0.30 of short dimension. Avoid degenerate widths. |
| Motion | Slide travel, Relative rotation, Drag, Cycles per loop | Travel 0–0.5 short dimensions; rotation excursion 0–45°; drag 0–1; cycles 1–8 integer. Loop duration already controls overall speed. |
| Material | Thickness, Refraction, Wetness, Ink amount | Normalized bounded controls. Refraction zero removes bending; wetness zero removes glossy highlights; ink zero leaves coloured pools. |
| Existing Finish | Palette roles, Saturation, Hue, Exposure; layer opacity/blend/mask/transform | Reuse shared controls and undo/persistence. |

Advanced controls: filament width/amount, edge softness, contact strength, dome height/aspect, lift amount, light direction, shadow strength/softness and grain. Discrete choices: quality and substrate/cutout. Never expose a slider that does not affect the chosen mode. Keep quality stable under New variation; respect palette, structure, motion and material locks.

Ship these starting looks in order:

1. **Acid Slide:** yellow film, dark cellular ink, cyan support, one glossy dome; the fidelity anchor.
2. **Cellular Lift:** cap lifts away while the patterned patch remains visible; based on the final close-up passage.
3. **Ink Drag:** longer fine filaments, stronger relative sheet motion, restrained dome deformation.
4. **Chromatic Slides:** pink/cyan/orange alternate colours after the first three work. This is a creative extension, rather than a match to this clip.

The first build needs one base sheet plus a moving contact/lens system. Extra independently coloured sheets and multiple domes can follow if they improve the instrument without overwhelming its controls.

## Performance targets

These are **engineering targets to measure**, not benchmark results. Use the repository's stated Apple M5 Pro / 24 GB baseline, the packaged Electron renderer, a fixed warm-up and a 300-frame representative sequence.

| Mode | Target |
| --- | --- |
| One Oil layer, Standard, 1920 × 1080 preview | 60 FPS target; 95th-percentile total frame time ≤16.7 ms. Aim for ≤10 ms of Oil GPU work so composition/UI retain headroom. |
| Four-layer composition including one Oil layer | 30 FPS minimum target at 1080p with representative existing instruments; record layer mix. Expensive Mandelbox combinations need separate results. |
| Draft | 960 × 540 preview, fewer field octaves and wake samples; same underlying seed, feature positions and loop phase. |
| High | Full-resolution material fields, better refractive filtering and optional spatial supersampling; preserve geometry and timing. |
| 3840 × 2160 export | Full requested output resolution; initially budget 50–150 ms GPU time/frame for one Oil layer as a profiling goal. EXR readback/compression, disk and encoding are additional and measured separately. No real-time 4K export promise. |
| Scratch colour/data memory at 4K | Two RGBA16F targets ≈126.6 MiB total, before driver overhead. Release/reuse rather than allocate per layer. |

The existing pipeline also holds source/composition/output buffers, multisample attachments, depth and sculpture resources; 126.6 MiB is **incremental**, not total application memory. Measure real peak usage during preview/export resizing and prolonged editing.

Start with full-resolution fields for correctness. If profiling requires reduced field resolution in Draft/Standard, make that an explicit reproducible quality setting, retain full-resolution optics/output and verify that filaments survive. Scale noise/softness/film thickness in material units, not literal framebuffer pixels. Band-limit tiny features toward coverage averages; simple edge smoothing is insufficient when several stripes fit within a pixel.

Bound loops in shaders: initially 3–4 noise octaves, one lens and 8–12 reconstructed wake samples, with early rejection outside contact regions. Calculate repeated transforms on the CPU once per frame. Update uniforms without material recompilation. Avoid per-frame texture uploads, shader creation, synchronous GPU readback or new geometry. Timer queries, where supported, distinguish GPU work from submission cost; use a separate instrumented run when collecting GPU timings.

If the budget fails, optimize field reuse, regional wake evaluation and sampling first. Adjust explicit quality next. Do not silently change a project's renderer based on preview speed or export frame order.

## Staged milestones and acceptance gates

| Stage | Deliverable | Gate before proceeding |
| --- | --- | --- |
| 1. Static material proof | One yellow sheet and separated pools, cyan substrate, dark branching ink, fixed dome and light | At 7 s and 11 s reference compositions, clear silhouette, wet rim, cellular footprint and shadow; no dependence on global rainbow gradients. |
| 2. Relative movement | Independently transformed sheet and lens, direction-sensitive fingers, smooth contact response and reconstructed wake | A 10–20 s motion study reads as sliding contact. Pattern beneath the dome corresponds to the pattern outside it. Pauses do not cause direction glitches. |
| 3. Optics and lift | Refractive magnification, thickness colour, reflections, dome lift and persistent-looking cellular patch | Lift the cap without erasing the paint pattern. Reflections remain tied to light/cap geometry; no extreme offset or border smearing. |
| 4. App integration | New layer kind, controls, palette roles, four initial presets, locks, undo, save/load and native export acceptance | Every control works; older projects retain their authored state; new projects reopen; preview, still and movie exports use the same source renderer. |
| 5. Delivery proof | GPU timings, four-layer composition, 4K output, alpha inspection and interrupted/resumed export | Meet measured quality/performance targets or report the actual limit. No frame-history dependency or loop seam. |

Stages 1–3 are the visual feasibility work. Do not build a large inspector around an unconvincing material. The first reviewable milestone should be **one convincing yellow/black/cyan slide with a moving glossy dome**.

### Verification required during implementation

- **Reference fidelity:** compare static frames, real-speed motion and short adjacent-frame strips. Keep screenshot UI, yellow flash frames and final camera cut outside comparison regions. Evaluate silhouette, exposed wake, lens correspondence, colour hierarchy and wetness separately; pixel matching an uncalibrated compressed recording is not the goal.
- **Determinism:** request frames in shuffled order and after fresh renderer creation. On the same build/GPU, compare decoded linear pixels with repeated requests. Export resume must not require replay from frame zero. EXR container bytes are not the visual comparison metric.
- **Loop:** compare phase 0 with 2π, then sample symmetric values around the boundary to check motion derivatives. Check the final exported frame to first frame against ordinary adjacent-frame changes; those two frames should be adjacent in time, not identical.
- **Stability:** test zero motion/ink/refraction, minimal/maximal thickness, lift through zero, maximum drag, small/large lenses and near-zero relative speed. Reject NaNs, infinities, negative coverage and unbounded refraction. Make endpoint disabling exact.
- **Coordinates:** inspect landscape, portrait and square outputs; transform, rotate and mask the Oil layer. Verify unchanged proportions and resolution-independent softness.
- **Colour/alpha:** inspect dark and bright backgrounds, premultiplied edges and the existing opaque/transparent delivery formats. Verify a saturated yellow pool remains yellow rather than becoming green solely from a simplistic multiply.
- **Integration:** extend meaningful core/native tests, run the existing build/test suites, then the Electron UI/export smoke test. Use the existing 4K proof mechanism for a representative final preset; no need to run a long proof before visual feasibility passes.
- **Resources:** repeated preset switching, layer duplication/deletion and preview/export resizing must not grow texture counts or retain stale scratch contents. Include context-loss behaviour and a long preview soak.

## When a fluid solver becomes justified

A later live mode may need arbitrary pointer stirring, irreversible mixing or continuously deposited pigment. A fixed-step GPU advection/pressure pipeline would then be appropriate, with independent saved simulation state, reset/warm-up, checkpointing and an explicit export replay contract.

That is a larger product change. A conventional 2D stable-fluid solver transports dye and velocity but does **not** by itself supply the separate interfaces, wetting or capillary morphology that define these contact patterns. NVIDIA's [GPU fluid chapter](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu) explicitly limits its base method to a continuous fluid on a rectangular domain without free-surface boundaries. An evolving two-phase implementation would need additional modelling and validation.

For the current seamless-loop instrument, start with the deterministic field/contact/optics design above. Its practical limit is the approximation of irreversible fluid history; its advantage is direct compatibility with the app's existing seeking, saved seeds and resumable exports.
