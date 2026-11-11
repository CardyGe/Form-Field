# Projection media: creative direction and implementation plan

10 November 2026 · Form & Field 0.10.0 · Original proposal; software implementation tracked in [the 0.11 report](projection-media-0.11.md). Physical projection review remains outstanding.

## Assessment

We have a useful procedural media foundation, but we are not yet at the intended high-end creative standard. The immediate gap is the behaviour and composition of the media: too many looks preserve a regular field while its coordinates oscillate. More controls and more presets alone will not fix that.

The next milestone should produce three convincing moving pieces before expanding the library. Success means recognisable material behaviour, varied motion at different scales, deliberate use of darkness, and content that can respond to a projection surface.

This assessment combines a source audit, inspection of the existing forty-look instrument contact sheet, and research into creators' published project descriptions and production accounts. The source explains motion limitations; the contact sheet supports observations about repetition and composition. I did not perform a fresh frame-by-frame viewing of the reference films or a new projector test. Reference projects are artistic targets, not evidence that we can reproduce their complete production systems.

## What is making the current effects feel rigid?

| Finding | Evidence in the current implementation | Consequence and response |
| --- | --- | --- |
| Several instruments share a simple circular motion driver. | `instrument-shaders.ts:20` defines `orbit()` as `(sin(phase), cos(phase)) * motion`; it drives domain distortion and multiple instruments. | Many materials share a similar temporal character. Introduce independently directed large flow, local eddies, travelling detail and event timing. Retain one reproducible master clock. |
| Living Ink grows during preparation, then samples a fixed chemical texture. | `InstrumentRenderer.ts:42–59` prepares and caches the reaction-diffusion result; `instrument-shaders.ts:97–107` distorts its lookup coordinates during playback. | It cannot currently develop new chemical structure over time. Keep the existing look, then add explicit evolving chemistry and a separate loop-capable treatment. |
| Velvet Currents constructs analytic stripes and brightness tails. | `instrument-shaders.ts:125–145` computes fibres from a scalar field and a cosine tail. | It does not transport particle identities or retain their paths. Add directed trajectories, age, emission and path-based trails. |
| Relief, Reef and Loom expose their regular construction. | Grid cells, repeated sites and periodic folds are visible in the shaders and existing contact sheet. | Provide sparse and asymmetric composition, grouped movement, variable sizes and local response. Keep precise geometric styles available: intentional geometry can be excellent mapping content. |
| Scalar modulation can spend time clipped at its limits. | `timeline.ts:81–93` adds a symmetric offset and clamps to parameter bounds. | Some routes can flatten at extremes. Offer explicit lower/upper endpoints and smooth bounded interpolation for new routes; preserve the existing route behaviour on old projects. |
| Surface information is a compositing mask. | `LayerMask` supports circle, rectangle and image masks; `StudioRenderer.renderFrame()` applies masking after drawing the source. | A cutout can hide ink but cannot make it follow a doorway or flow around a column. Add surface fields as inputs to generation, separately from final clipping. |
| Current verification establishes technical correctness more strongly than creative quality. | Existing suites check controls, finite pixels, phase closure, seeking, alpha, coverage and exports. | Add full-motion comparisons and projector review. Pixel change and successful export do not establish convincing motion. |

Avoid describing the entire renderer as static. Sculpture has actual mesh deformation, Oil reconstructs motion and wakes, and Super 8 reconstructs historical samples. These are useful local precedents. The existing deterministic clock, compositor, alpha handling and recoverable export path are assets to extend.

## Eight references worth studying

The implementation ideas below are our proposed interpretations. They are not claims about undisclosed algorithms used by the artists. Older works are included because their design principles remain useful.

| Reference and location | Published evidence | What we should take into our product |
| --- | --- | --- |
| [Limelight — Interconnection](https://www.limelight.art/portfolio/interconnection), Bucharest, Romania, 2016 | An architectural mapping work at the Palace of Parliament; the creators explicitly describe integrating the facade into its visual concept. The page links the film. | A surface should organise the composition: contours, bays, central features and depth cues should influence where motion begins and how it spreads. Prototype a facade reveal and transformation sequence. |
| [Moment Factory — SuperReal](https://momentfactory.com/products/superreal), New York, US, 2019 | A 360-degree architectural experience with lighting, interactive visuals and multiple distinct visual worlds. | Build complete material environments with foreground, atmosphere and deliberate changes in density. Author contrasting scenes rather than filling every frame uniformly. |
| [Moment Factory — AURA Invalides, Notch production account](https://www.notch.one/madewithnotch/aura-invalides), Paris, France, 2023 | The account describes three movements and a combination of real-time scenes, particles, lighting and pre-rendered work. | Introduce scene phrases and coordinated layers. A professional result may combine generated and imported media; a single shader need not carry the whole scene. Moving-media import is a later feature, since today's imported-image path only supports stills. |
| [teamLab — Universe of Water Particles](https://www.team-lab.com/news/uowp1307/), Osaka, Japan, 2013 | The creator describes water simulated in a virtual rock environment, with selected particle paths expressed as lines; a film is linked. This is a flow-design reference, not evidence for a particular facade-mapping workflow. | Lines should express travel and interaction. Upgrade Currents toward coherent transport, obstacle response and trails with continuity. |
| [Universal Everything — Sydney Opera House: Living Mural](https://www.universaleverything.com/design/sydney-opera-house-living-mural), Sydney, Australia, 2015 | A collaborative architectural projection drawing on hand animation, graphics and physics; the project lists actions including rise, swarm, flow, scatter and melt. | Give motion distinct verbs and personalities. Develop growth, gathering, release, drift and settling instead of one universal wobble. |
| [Bot & Dolly — Box, production account by Ian Sherman](https://www.ianjsherman.com/work/box/), US, 2013 | Forced perspective on moving surfaces, virtual camera work, coordinated projection and robotics. The page links the final film and process. | Test depth, occlusion, shadow and reveal as a coherent illusion. Begin with a fixed audience viewpoint and a simple virtual surface; tracking and robotics are outside this milestone. |
| [1024 architecture — Perspective Lyrique](https://www.1024architecture.net/projects/perspective-lyrique/), Lyon, France, 2010, subsequently toured | The creators describe audience voice controlling projected facade distortions. | Modulation should change a meaningful gesture. Later map an audio envelope to facade flex or particle release, with smoothing and a baked control track for export. |
| [Studio Lemercier — FUJI](https://joanielemercier.com/fuji/), premiered in Takamatsu, Japan, 2013 | A drawn landscape augmented with projection, sound and an abstract narrative. The project includes a film and making-of link. | Darkness, restraint and a precise relationship with the underlying artwork can be stronger than constant detail. Add contour-following light and sparse reveal compositions. |

For the first reference review, annotate each linked film with specific moments showing direction, acceleration, material change, use of black and interaction with the surface. Do not assign fabricated timecodes from descriptions. This annotated review belongs in the first implementation milestone.

## Product direction

Keep the product centred on generating excellent projection media, with export into a venue's mapping/playback workflow. Surface-aware generation is useful within that scope. A full projector calibration, edge-blending, tracking and show-control system is a separate expansion.

Artist-facing controls should describe the result: Flow direction, Travel, Eddy size, Spread, Birth rate, Trail life, Growth, Settle, Surface influence and Phrase. Expose roughly six primary controls per new treatment, with detailed solver controls under Advanced. Introduce only controls that produce a distinct, useful visual change.

Use one source pipeline:

`authored motion + surface fields → material generation → source colour/coverage → existing finish/compositor → existing native output`

Add reusable flow and surface helpers internally. Start with the needs of the proof clips; do not build a public node editor or an unrestricted inter-layer dependency graph first.

## Three proof pieces

| Piece | Intended behaviour | First implementation | Review gate |
| --- | --- | --- | --- |
| **Silk River**, 20-second loop | Fibres gather into a current, separate around a void, form local curls and thin back into darkness. The main travel stays directional while local detail varies. | Extend Currents with deterministic particles or ribbon trajectories, staggered age, independent width/taper and bounded path-history sampling. Use a simple surface obstacle. | Individual paths visibly travel; trails connect without popping; births are distributed; the field does not visibly rock backwards as a whole. |
| **Ink Estuary**, 20-second evolving clip, followed by a separately reviewed loop treatment | A few pigment sources spread into a quiet region, curl, mix and develop fine fronts. Large masses lead; details follow. | First establish directional pigment transport; then add evolving Gray–Scott chemistry through fixed simulation ticks. Keep transport and chemistry independently controllable. | New structure develops over time; pigment is visibly carried; the result remains legible at projection scale. Do not label the evolving clip seamless. |
| **Breathing Facade**, 24-second loop | Light finds selected edges, a few bays open with depth, a wave crosses the structure, and the image settles. | Add a small authored surface layout, distance/edge fields and instanced relief geometry with a fixed virtual camera. Coordinate reveal, geometry and light. | The structure organises the media; depth and shadows agree; groups have intentional timing; it works on a simple physical mock-up from the intended viewing position. |

Each piece needs a landscape render, a portrait crop composed deliberately, a black-background output, and an alpha output. A piece should remain convincing in greyscale: palette and bloom must support the structure.

## Implementation sequence

Sizing is relative: S is local work, M crosses several modules, and L requires a technical prototype and performance measurement. These are dependencies, not delivery-date promises.

| Order | Work and concrete deliverable | Main code areas | Dependency / size |
| --- | --- | --- | --- |
| 0 | Capture current Currents, Ink and Relief as full-motion baselines. Annotate the reference films and storyboard the three proof pieces. Record the chosen Mac/GPU, preview size and export settings. | New proof harness alongside `scripts/verify-instruments.mjs`; research/proof artifacts under `work/projection-media/` | First / S |
| 1 | Build the Silk River slice: a reusable directed field, periodic variation at multiple spatial scales, deterministic trajectory sampling, staggered lifecycle and smooth trails. Expose a distinct new treatment, retaining the original. | Proposed `src/rendering/flow-field.ts`, `src/rendering/flow-trajectories.ts`; `InstrumentRenderer.ts`, `instrument-shaders.ts`, `core/instruments.ts` | 0 / M–L |
| 2 | Add authored motion phrases and explicit modulation endpoints. Supply independent phase offsets for groups, smooth acceleration and a broad quiet/build/release/settle envelope. Deliver three clearly different motion treatments in the same material. | `core/timeline.ts`, `core/project.ts`, `shared/types.ts`, inspector in `ui/App.tsx`; proposed `core/motion-phrases.ts` | 1 / M |
| 3 | Add the deterministic simulation service and Ink Estuary. Begin with a modest 2D velocity/dye field; add pressure projection, boundary handling and chemistry only as the visual need is demonstrated. Deliver seeking, reconstruction and interrupted-export proof before making it generally selectable. | Proposed `rendering/SimulationRenderer.ts`, `rendering/simulation-cache.ts`; `InstrumentRenderer.ts`, `StudioRenderer.ts`; export validation and fingerprinting | 1–2 / L |
| 4 | Add surface-driven generation and Breathing Facade. Start from existing embedded PNG masks plus a small editable polygon layout. Prepare edge distance, gradient, region IDs and explicit obstacle semantics; add true geometry for the relief treatment. | Proposed `core/surface-layout.ts`, `rendering/surface-fields.ts`, `rendering/ReliefRenderer.ts`; `StudioRenderer.ts`, project validation and inspector | 1–2; 3 for simulated boundary interaction / L |
| 5 | Refine material-specific light, depth, coverage and composition across the three pieces. Build nine authored presets: three demonstrably different behaviours per piece. Add moving thumbnails/contact strips. | Existing material helpers and compositor where justified; `core/instruments.ts`, UI assets and proof harness | 1–4, all visual gates / M |
| 6 | Evaluate on a projector/mock-up, profile mixed scenes, run compatibility and decoded-export checks, and package the milestone. | Existing test/export/package infrastructure plus new temporal proofs | 5 / M |

The first product increment is Silk River with old/new movie comparisons. Review that before generalising the architecture. If it still reads as moving wallpaper, improve the field, paths and composition before adding more instruments.

### Motion and trajectory design

Use macro direction, medium eddies and small detail with different amplitudes and timing. A curl-derived field can organise motion; it is not a substitute for tracking how material travels through that field. Prototype a bounded integration scheme, such as RK2, for visible trajectories. The curl-noise paper provides a useful primary technical reference for controlled, divergence-free fields and boundaries: [Bridson, Hourihan and Nordenstam](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf).

For seamless particles, derive identity and age from a seeded periodic emission schedule. Reconstruct the bounded trajectory from its birth time at fixed steps; do not accumulate preview-frame deltas. Fade births/deaths smoothly, with invisible resets. A periodic velocity field alone does not guarantee that a particle returns to its starting position. Test the complete rendered lifecycle at the loop boundary.

For modulation, new endpoint routes interpolate within artist-selected bounds instead of clipping symmetric offsets. Support periodic phase remapping with a monotonic progression for looping travel; reversing motion should be an authored choice. Old routes keep their original evaluation unless explicitly converted.

### Evolving simulation without breaking exports

The current renderer evaluates a wrapped phase and supports out-of-order rendering. A stateful solver requires a time-sampling contract before it can be inserted safely. Extend the render context with explicit clip time and loop policy while adapting all existing sources to their current phase behaviour.

Use a fixed simulation time step, seeded initial conditions, bounded resource ownership and checkpoints. Reconstruct a requested time from a validated checkpoint or the initial state, never from whatever frame the preview happened to render last. Tie automated solver controls to the same fixed timeline. Sub-frame requests use a defined sampling/interpolation policy.

Simulation resolution and quality must be explicit project settings, independent of the display/export pixel count. Preview and export sample the same simulated state. A lower-quality interactive preview must be labelled; provide an exact preview before approval. Cache keys include solver version, seed, initial state, controls and automation, tick rate, simulation resolution, surface fields and boundary policy. Changes invalidate affected checkpoints. Cancellation, context loss, eviction and disposal are part of the design.

WebGL render-to-texture is sufficient to prototype this in the present renderer; benchmark before considering a WebGPU migration. [Three.js GPUComputationRenderer](https://threejs.org/docs/pages/GPUComputationRenderer.html) documents floating-point variables and ping-pong targets; [NVIDIA's fluid simulation chapter](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu) explains a 2D grid solver. Neither source establishes our achievable speed or solves seamless looping for us.

Keep two explicit behaviours:

- **Loop:** closed analytic motion, reconstructed periodic particle lifecycles, or a specifically baked and reviewed loop. Verify image and velocity continuity. Arbitrary fluid/chemical evolution is not guaranteed periodic by a repeating input, warm-up, or replayable seed.
- **Evolve:** an exact-duration developing clip with deterministic seeking and export. The timeline does not wrap the simulation to zero during playback. No seamless badge.

A dissolve between simulation segments can be an optional artistic loop treatment. It can create double images, density pulses and mismatched motion; it is not the default seam solution. Do not use a hidden reset or automatic reversal to make growing ink fit a loop.

Checkpoints may reproduce within an established tolerance on the same rendering environment; do not promise bit-identical simulation across GPUs. An exact resumed export must validate its solver/build fingerprint and required cached state, or refuse to mix frames. Preserve the existing native colour and alpha output path.

### Surface-aware generation

Distinguish the artistic surface from the final composite mask. Provide a field in the same coordinate space as the generated source, with explicit transforms and outside behaviour. A surface layout can drive emission, edge-following light, reveal distance and grouping. An obstacle field controls transport boundaries. A final matte controls output coverage. These roles may use related artwork but are not interchangeable.

Distance fields need documented units and scaling; an image gradient alone is not a physical collision rule. Simulated flow needs no-through boundaries in its velocity/pressure solve, and particles need suitable boundary handling to avoid tunnelling. For thin or transparent imported masks, let the user choose whether the shape is an emitter, obstacle or visual cutout.

Start with PNG and simple polygons. Defer arbitrary SVG and 3D scene import until parsing, storage and coordinate contracts are designed. MadMapper's [custom material documentation](https://docs.madmapper.com/madmapper/6/3.-media/writing-custom-glsl-materials) is a useful precedent for parameterised procedural media on surfaces; implementing our own surface fields does not make our materials automatically compatible with its format.

For perspective illusions, use a declared viewing position. Render actual relief geometry with consistent depth, normals and shadows where it matters. The existing shaded height fields remain useful lighter treatments. Validate the illusion on a physical mock-up; a monitor image cannot establish success for an audience spread across a venue.

### Project and compatibility changes

Existing project validation is strict, and the native export manager separately accepts schema version 1 and a fixed source list. Plan the document change before adding data. Numeric treatment controls may be additive with neutral defaults; surface layouts, endpoint routes, assets and playback policies need an explicitly versioned document contract.

Migrate old files without overwriting their originals, preserve original treatments/defaults, and reject unsupported future versions clearly. Update `shared/types.ts`, renderer-side validation, native `electron/export-manager.cjs`, preload/bridge contracts where affected, save/open, autosave, immutable job snapshots and renderer fingerprints together. New source kinds must be admitted consistently at every boundary. Undo/redo and randomizer locks must understand the new controls. Do not add top-level properties that current schema-1 validation rejects.

Retain the four-layer composition limit initially. Internal material/flow passes need not consume visible layers. Add layer count only after measured composition costs justify it.

## Validation and release gates

Review complete movies at normal speed and slow motion. Render each loop three times consecutively. Compare against the captured current treatment using the same duration, palette, composition size and finishing. The visual gate is whether motion and material behaviour improve; an algorithmically different image is insufficient.

| Gate | Required evidence |
| --- | --- |
| Motion quality | Full clips show directional transport, distinct spatial scales, intentional timing and stable features. Check for whole-field rocking, repetitive breathing, sliding texture, trail discontinuities and excessive uniform density. |
| Loop quality | Compare the final-to-first frame change against neighbouring frame changes; inspect short frame sequences and estimated motion across the boundary. Also evaluate the analytic endpoint where applicable. First and last encoded frames should not be artificially duplicated: a correct sampled loop normally advances between them. |
| Seeking | Render selected times sequentially, backwards, randomly, after eviction and after reopening; compare within the documented numeric tolerance. For simulation, check identical sampled states at the same clip time across output FPS settings. |
| Export recovery | Interrupt and resume a real native export; compare decoded output with an uninterrupted run. Changing the solver, quality, surface or automation must invalidate incompatible state and jobs. |
| Alpha and colour | Preserve finite linear values, correct association, black/transparent gaps and edge colour. Inspect decoded alpha output over light and dark backgrounds as well as opaque output. Keep existing finishing and encoding contracts. |
| Resources | Test repeated edits, preparation cancellation, hidden/deleted layers, multiple simulation layers, cache pressure, context loss and renderer disposal. Record preparation/seek latency and peak resources. |
| Performance | Set a provisional goal of 1080p/30 preview for the agreed hero composition on the recorded target Mac: completed-frame p95 at or below 33.3 ms. Measure UI responsiveness separately. Profile 4K offline export and four-layer stress scenes; report actual throughput, not a universal real-time promise. |
| Projection | Test black level, fine-line survival, defocus, scale, material brightness and depth illusion on a real surface/mock-up. A degraded-screen preview can flag problems but cannot replace this test. |
| Compatibility | Old projects and presets render as before; new modes save/open/autosave; native validators, undo/redo and variation locks agree. Run the existing relevant regression suites after implementation. |

Reuse `npm test`, `npm run build`, the instrument/effect audit scripts and native UI/export checks where they apply. Add focused tests for the new time, lifecycle, field-coordinate and migration contracts, plus temporal movie evidence. Existing reports under `work/pro-audit/` are historical baseline evidence, not a newly executed verification pass for this proposal.

The milestone is complete when all three proof pieces pass both the visual and technical gates, nine authored looks demonstrate distinct behaviours, existing artwork survives migration, and at least one physical projection review is recorded. Preset count or parameter count is not the acceptance criterion.

## Follow-on work

After those gates: investigate deformable cloth/volumes, interactive attractors, recorded audio envelopes, deterministic moving-media import and optional live-output integration. Keep microphone-driven performance separate from repeatable export by recording or baking its control signal. Those additions should follow demonstrated creative needs; none is a prerequisite for the first motion-quality improvement.
