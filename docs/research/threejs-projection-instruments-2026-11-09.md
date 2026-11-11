# Ten new instruments for Form & Field

Research and product proposals · 9 November 2026

**Build Caustic Atlas, Kinetic Relief and Holographic Loom first.** Together they add light, architectural depth and fabric: three recognisable visual languages that fit Form & Field and have practical routes into its current renderer.

The ten proposals below are original product directions assembled from established graphics techniques and the primary references cited beside them. They are distinct from each other and from the app's existing effects; they are not claims of globally unprecedented inventions. They are design proposals, not implemented or benchmarked instruments.

## Research scope and evidence

I reviewed official Three.js examples and documentation, creator-authored demos, project repositories, technical write-ups and projection workflow documentation. The source register contains 34 references, including recent 2026 experiments and older technical work that remains relevant. I inspected the live official caustics, Niccolò Fanton's particle-flow and Clément Grellier's Unwoven renderings in the browser, as well as reading the sources. Other references were reviewed through their documentation, published descriptions or source pages; this was not a performance benchmark of every demo.

I also inspected the current app's README, renderer, source-view coordinates, timeline and shared types. The app is currently a Three.js 0.187 WebGL renderer with procedural GLSL, geometry-based sources, a shared linear compositing pipeline, seeded variation, masks and deterministic frame export. Its six procedural source types are Surface, Sculpture, Fractal, Oil, Super 8 and Graphic; imported Image makes seven layer types. It has 90 presets, four composition layers and a periodic timeline. Those are local implementation facts, not claims drawn from the external references.

The research deliberately looks beyond attractive website hero sections. A pointer-driven demo, a spinning object and a screen-filling projection loop have different requirements. The useful discoveries are their material, motion, geometry and rendering methods. The proposed art direction, controls, defaults and export contracts are specific to this app.

## What people are doing with Three.js

Several recurring approaches are especially useful here:

- **Light becomes the content.** Caustics, refraction, diffraction and reflected scenes create richer motion than colour cycling alone. Maxime Heckel explains WebGL approaches to caustics and optical effects; official Three.js examples also demonstrate caustics. [Caustics study](https://blog.maximeheckel.com/posts/caustics-in-webgl/), [official example](https://threejs.org/examples/webgpu_caustics.html).
- **Large fields share a small amount of geometry.** Instancing gives many pieces individual transforms while reducing draw calls. That supports architectural skins, crystal clusters and dense fibres. [InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html).
- **Textures hold simulation data.** The same GPU that draws an image can update particle positions or chemical concentrations in textures. Three.js's WebGL computation helper uses paired targets; contemporary WebGPU work uses compute pipelines. [GPUComputationRenderer](https://threejs.org/docs/pages/GPUComputationRenderer.html), [Three.js reaction-diffusion project](https://github.com/colejd/Reaction-Diffusion-ThreeJS).
- **Flat geometry can suggest substantial depth.** Shader-derived normals, refraction, parallax and interior mapping produce a strong material or spatial impression with limited geometry. [Shader's liquid-glass study](https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/), [Jingfu Chen's interior mapping](https://jingfu.design/work/interior).
- **Material and restraint matter as much as complexity.** Holocloth combines fabric motion with an optical finish; Unwoven uses separately deformable ribbons. Their useful contribution is a coherent tactile behaviour. [Holocloth](https://github.com/dmitrykurash/holocloth), [Unwoven](https://github.com/clementgrellier/unwoven).

The adaptation below is my judgement about what would work in Form & Field. Source demos establish feasibility of techniques; they do not establish the projected appearance or performance of our proposed versions.

## Comparison

Effort is relative implementation complexity, not a delivery estimate. Loop routes are proposed designs.

| # | Instrument | Visual identity | Strong projection use | Loop route | Effort |
| --- | --- | --- | --- | --- | --- |
| 1 | Caustic Atlas | Pools of focused, refracted light | Floors, walls, curved objects | Periodic wave/light field | Medium |
| 2 | Living Ink | Cellular pigment, lace and branching membranes | Organic sculptures and broad backgrounds | Seeded pattern bake plus periodic field animation | High |
| 3 | Magnetic Skin | Wet peaks rise from a continuous surface | Sculptural forms, columns and focal panels | Analytic periodic attractors | Medium–high |
| 4 | Velvet Currents | Dense luminous fibres gather into flowing rivers | Wide stages, arches and continuous wraps | Seeded closed paths with sampled trails | Medium–high |
| 5 | Kinetic Relief | Physical-looking folds, shutters and ceramic scales | Facades, boxes and flat architectural panels | Per-piece analytic phase | Medium |
| 6 | Holographic Loom | Woven fabric with moving interference and foil light | Drapes, columns, immersive walls | Periodic ribbon/surface deformation | Medium–high |
| 7 | Crystal Reef | Connected mineral veins grow into faceted clusters | Installation edges and sculptural centrepieces | Seeded geometry with cyclic growth fronts | Medium–high |
| 8 | Prism Cathedral | Mirrored rooms, glass vaults and deep repeated arches | Portals, stage frames and selected viewpoints | Bounded spatial reflections at the current phase | High |
| 9 | Resonant Sand | Powder assembles into standing-wave geometry | Floors, round objects and quiet interludes | Analytic modal morph and repeatable grain motion | Medium |
| 10 | Volumetric Veils | Backlit folds of translucent pigment and mist | Immersive rooms and layered backgrounds | Periodic density field and light motion | High |

## 1. Caustic Atlas

**The picture.** A wall appears to sit beneath a shallow pool or a moving sheet of cut glass. Fine bright ridges gather, split and drift across broad, quieter areas. In another look, honey-coloured light refracts into thin spectral edges over midnight blue. The output is the moving light field itself, extending throughout the canvas.

**Why it belongs.** Oil Slides already renders pigment and a glass dome. Caustic Atlas would explore the light cast by an optical surface. It adds a clear atmospheric background and a clean luminous overlay, with a recognisable identity at modest motion speeds.

**Projection use.** Floors, ceilings, curved sculptures and large architectural surfaces. Strong, broad light structures could remain readable after some defocus. Actual appearance would need a projector test; an attractive monitor preview is insufficient evidence.

**Controls.** Cell size, wave height, wave mixture, focus, light angle, spectral spread, edge softness, drift, contrast and coverage. A focus control should widen light ridges before it simply makes them brighter.

**Starting looks.** *Pool at Midnight* — pale cyan with broad cells; *Amber Lens* — warm focused light; *Prism Rain* — restrained colour separation around white highlights.

**Smart variation.** Pick a coherent wave spectrum, focal regime and light trajectory together. Keep intense light below a controlled coverage ceiling and retain midtones around it. Varying all wave frequencies independently would turn the field into crawling sparkle.

**Three.js route.** A periodic procedural refractive surface and a caustic intensity pass inside the current WebGL pipeline. Begin with a controlled height-field approximation, then consider more geometry-aware projection if it improves the look enough to justify the cost. Existing framebuffer infrastructure is relevant; React Three Fiber is not a requirement.

**Loop and scale.** Integer harmonics drive wave and light phases. Evaluate the field in the app's unbounded source coordinates. Scale changes reveal more of the light field; they never resize a finished rectangular frame.

**Research anchors.** [Maxime Heckel's caustic construction](https://blog.maximeheckel.com/posts/caustics-in-webgl/), [Drei's implementation](https://github.com/pmndrs/drei/blob/master/src/core/Caustics.tsx), [official Three.js caustics](https://threejs.org/examples/webgpu_caustics.html).

## 2. Living Ink

**The picture.** Cream-coloured pigment forms branching coral, fingerprints, cells and lace over a dark ground. Local patterns feel related across the frame, with fine edges gathering around broader islands. A shallow embossed finish gives it the appearance of living screen print or growing ceramic glaze.

**Why it belongs.** Its pattern topology comes from reaction-diffusion rather than the app's liquid bands, packed tiles or recursive fractals. The major addition is a different way of making structure, with a tactile material treatment consistent with Oil and Super 8.

**Projection use.** Organic objects, textured walls and slow full-field backgrounds. Coarse cellular presets suit distant viewing; fine lace is an optional detail setting.

**Controls.** Pattern family, cell size, branching, spacing, directional growth, seed coverage, pigment depth, relief, softness and flow. Feed/kill chemistry can live in an advanced panel; the main controls should stay visual.

**Starting looks.** *Ivory Coral*, *Cobalt Fingerprints*, *Ember Cells*.

**Smart variation.** Choose feed/kill pairs from known productive regions, then vary scale, seed distribution and finish around them. Reject uniform dead fields and overfilled fields during preparation. Do not randomize the full numerical parameter space.

**Three.js route.** A bounded Gray–Scott texture preparation stage using WebGL ping-pong targets, then a material pass. Three.js implementations already demonstrate the core mechanism; a WebGPU rewrite is optional research rather than a prerequisite.

**Loop and scale.** The first release should bake a reproducible spatial pattern, then animate its deformation and pigment threshold with periodic fields. This creates a living appearance with exact seek and repeatability; it is not continuous chemical growth. True evolving RD would need a cached, explicitly closed cycle and validated seam handling. Periodic forcing alone does not prove the state returns to its starting point. Spatial repeat uses periodic simulation boundaries and matching material derivatives.

**Research anchors.** [Colejd's Three.js simulation](https://github.com/colejd/Reaction-Diffusion-ThreeJS), [Robert Leitl's compute implementation](https://github.com/robert-leitl/webgpu-reaction-diffusion), [Karl Sims' parameter study](https://karlsims.com/rd.html). Leitl's example is raw WebGPU, included as a computational reference rather than represented as a Three.js implementation.

## 3. Magnetic Skin

**The picture.** A continuous glossy surface gathers into tapered peaks as invisible magnets pass beneath it. Black chrome opens into opal or warm mercury highlights; ridges merge into smooth valleys. It can fill the canvas as a landscape, or use an explicit mask for a contained pool.

**Why it belongs.** Existing Sculpture renders folded objects. Magnetic Skin would be a deforming material field with local, travelling attractors and a distinct relationship between broad flow and sharp peaks.

**Projection use.** Sculptures, columns, circular objects and dramatic focal panels. A lighter liquid-metal preset should be the initial projection default; almost-black studio renders can lose much of their form in a venue.

**Controls.** Peak spacing, sharpness, magnetic pull, attractor count, viscosity appearance, surface roughness, metal/opal finish, highlight width and movement orbit.

**Starting looks.** *Pearl Magnet*, *Mercury Garden*, *Obsidian Tide*.

**Smart variation.** Couple peak count to height and spacing. Preserve an open silhouette and broad highlights; retain enough smooth material between peaks. Attractor paths should coordinate rather than compete randomly.

**Three.js route.** A displaced surface with derivative-aware normals or a bounded implicit-surface shader. A good first version is an artistic magnetic approximation, not a physically validated ferrohydrodynamic solver. A field mode avoids relying on one floating sphere as the entire composition.

**Loop and scale.** Magnet positions follow closed trajectories; the surface is evaluated from seed and phase with no frame accumulation. Extend the surface past the visible view and derive framing from the current source transform.

**Research anchors.** [Visuval's creator describes its displaced ferrofluid mesh](https://discourse.threejs.org/t/visuval-io-a-3d-music-visualizer-for-content-creators/92288), [a Three.js ferrofluid/audio project](https://github.com/madhuramyadav/ferro-fluid-audio-visualizer), [official implicit-surface example](https://threejs.org/examples/webgl_marchingcubes.html). These are technique references; our surface design would be original.

## 4. Velvet Currents

**The picture.** Thousands of fine luminous fibres follow broad currents, comb into ribbons and form eddies. It should look like illuminated silk, brushed metal filings or long-exposure fluid motion. A few large currents organise the composition while fine strands supply texture.

**Why it belongs.** Graphic Paths are discrete grid structures. Velvet Currents would make a continuous flowing material with depth, thickness variation and directionally related highlights.

**Projection use.** Wide stages, archways, horizontal surfaces and seamless wraps around columns. A sparse alpha version could sit over an existing Surface or Oil layer.

**Controls.** Current layout, fibre count, fibre width, curl, coherence, ribbon thickness, trail length, motion amount, depth spread and highlight falloff.

**Starting looks.** *Aurora Comb*, *Copper Estuary*, *Ivory Undertow*.

**Smart variation.** First choose one coherent flow organisation; vary curl and local disturbance inside it. Tie fibre width and count to target resolution. Brightness should stay stable as strand density changes.

**Three.js route.** Instanced ribbons or camera-facing strokes sampled along seeded paths. GPGPU particle examples are useful inspiration, but a controlled analytic path field is a better initial fit for the app's export contract than unbounded advection.

**Loop and scale.** Use closed, differentiable path functions and evaluate short trails at phase offsets. An integer-period flow field alone would not guarantee an advected particle returns, so the initial design explicitly closes the paths themselves. Neighbouring wrapped paths need consistent identifiers and continuous tangents.

**Research anchors.** [Niccolò Fanton's creator catalogue](https://demos.niccolofanton.dev/?demo=flowfield), [his live flow-field sketch](https://flowfield.niccolofanton.dev/), [official attractor particles](https://threejs.org/examples/webgpu_tsl_compute_attractors_particles.html), [GPUComputationRenderer](https://threejs.org/docs/pages/GPUComputationRenderer.html).

## 5. Kinetic Relief

**The picture.** A surface appears to be constructed from small ceramic shutters, folded paper scales or brushed metal fins. Waves pass through it: some pieces hinge open, others slide or lift, exposing shadowed recesses. Motion should read as a coordinated mechanism with physical thickness.

**Why it belongs.** It gives the app architectural depth and useful mapping content beyond flat graphic tiles. Palette and rhythm can remain as restrained as the existing Signature collection, while perspective, bevels and shadows create the impact.

**Projection use.** Flat panels, cubes, stage facades and architectural details. A frontal, fixed-camera default makes the virtual relief easier to align. Optional perspective can create a stronger illusion from a chosen audience viewpoint; calibration remains a separate installation task.

**Controls.** Piece size, layout, hinge axis, opening, depth, bevel, wave direction, travelling bands, phase spread, shadow strength and material.

**Starting looks.** *Porcelain Shutters*, *Copper Accordion*, *Basalt Scales*.

**Smart variation.** Choose a layout and hinge grammar together. Keep a clearance budget between neighbouring pieces, coordinate opening angle with depth, and preserve an intentional wave direction. Avoid independent random rotations on every tile.

**Three.js route.** Instanced mesh pieces with per-instance phase and transform data, rendered into the existing source target. A shallow material/shadow approximation can be evaluated against a full shadow pass before choosing the final cost. The existing Sculpture branch provides a useful geometry rendering precedent.

**Loop and scale.** Every piece is an analytic function of integer loop phase. Geometry is generated for the transformed camera view plus overscan, with stable cell coordinates; shrinking the pattern adds more pieces instead of repeating a photographed rectangle. Include suitable geometry bounds so animated instancing does not disappear at the frustum edge.

**Research anchors.** [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [Jingfu Chen's parallax depth study](https://jingfu.design/work), [official angular slicing](https://threejs.org/examples/webgpu_tsl_angular_slicing.html). These establish construction tools, not a pre-existing implementation of this proposed instrument.

## 6. Holographic Loom

**The picture.** Woven ribbons ripple like satin under a moving light. Slowly sliding weave directions create broad interference bands. An optional foil finish adds controlled spectral highlights to folds; calmer presets use pearl and charcoal with a single warm accent.

**Why it belongs.** It adds textile behaviour and optical interference, distinct from rigid Sculpture ribbons and Graphic spirals. The texture, fold motion and lighting should all describe the same material.

**Projection use.** Draped fabric, columns, large walls and ambient rooms. A world-space fabric weave supports wraps; a separate centred cloth arrangement supports focal compositions.

**Controls.** Weave scale, warp/weft angle, layer separation, fold size, tension appearance, ripple amount, interference spread, foil intensity, lighting direction and roughness.

**Starting looks.** *Pearl Gauze*, *Petrol Satin*, *Copper Interference*.

**Smart variation.** Keep weave angles close enough to generate controlled broad beats. Couple thread scale with output filtering; limit foil strength and choose material palettes as complete looks. The randomizer must not discover its appearance through accidental sampling aliasing.

**Three.js route.** A deformable ribbon/surface mesh with procedural weave normals and an angle-dependent optical material. Unwoven demonstrates independent ribbons; Holocloth demonstrates a WebGL fabric/foil tool; a dedicated moiré studio shows intentional interference fields. The proposed combination is our design.

**Loop and scale.** Use periodic deformation first. Live Verlet/XPBD cloth would need a baked, closed motion asset or a different replay contract. Synthesize the broad interference analytically where possible, and filter fine carriers against the actual output footprint. Tiny line patterns should degrade gracefully when projected or minified.

**Research anchors.** [Unwoven](https://github.com/clementgrellier/unwoven), [Holocloth](https://github.com/dmitrykurash/holocloth), [NeoVand's Moiré](https://github.com/NeoVand/Moire), [Jingfu Chen's diffraction study](https://jingfu.design/work/cd).

## 7. Crystal Reef

**The picture.** Connected mineral veins spread across a surface and sprout clustered quartz points. A bright growth front travels through them; old clusters become quieter as new ones emerge. A second look resembles porcelain coral, with strong faceted silhouettes rather than tiny glitter.

**Why it belongs.** It adds seeded procedural growth with a clearly authored spatial structure. It is not another scatter of independent objects: connected veins organise the composition and suggest a material transforming the mapped surface.

**Projection use.** Sculptural installations, set edges, facade seams and circular centrepieces. A future optional shape-guide image could encourage veins to follow imported outlines. Guide-driven generation would be an additional capability, not something the app currently does.

**Controls.** Vein layout, branch length, cluster density, facet count, crystal height, growth-front width, material opacity, inner glow and retreat softness.

**Starting looks.** *Amethyst Veins*, *Porcelain Reef*, *Amber Fault*.

**Smart variation.** Generate a connected graph first. Pick related growth and material parameters, with a minimum visible facet size and bounded cluster crowding. Limit transparency overlap and preserve darker channels for separation.

**Three.js route.** Seeded curves and instanced crystal shapes, with a small set of shared materials. Chiro Visuals' Geometry Painter is a strong concrete example of surface-following crystal generation; our instrument would generate its composition automatically and fill the source domain.

**Loop and scale.** Precompute topology. Store each piece's position along a vein and reveal it using a cyclic, feathered growth front. Use staggered zones so the loop can renew without an obvious empty reset. This is controlled growth animation, not irreversible mineral simulation. Spatial chunks must share boundary graph connections, not just use different random seeds.

**Research anchors.** [Geometry Painter source](https://github.com/achrefelouafi/GeometryPainterThreeJS), [creator's technical article](https://tympanus.net/codrops/2026/08/11/exploring-procedural-geometry-with-three-js-and-webgpu/), [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).

## 8. Prism Cathedral

**The picture.** A wall opens into a deep vaulted chamber. Coloured glass ribs, polished arches or nested windows reflect into a controlled distance. A slow optical shift changes the room's proportions without becoming a fast tunnel ride.

**Why it belongs.** Fractal Worlds provides mathematical recursion. This instrument would provide readable architectural space, optical depth and materials, with a much slower, more deliberate composition.

**Projection use.** Portals, stage frames, boxes and selected-viewpoint installations. The stronger the perspective illusion, the more important a defined viewing position becomes. Flat media alone does not calibrate the projector or solve a room's geometry.

**Controls.** Arch profile, vault spacing, virtual depth, mirror count, reflectivity, glass amount, dispersion, camera offset, aperture and movement amount.

**Starting looks.** *Smoked Glass Vault*, *Amber Arcade*, *Porcelain Infinity*.

**Smart variation.** Couple spacing, camera framing and depth. Keep a legible vanishing structure, limited reflection count and a controlled energy falloff. A good variation should still look like one coherent room.

**Three.js route.** A bounded repeated scene or analytic ray-box/SDF room, with limited spatial reflection/refraction. Mirror render targets are a proven technique; runtime reflection count must remain bounded. If an underlying composition is to be refracted, that would require an explicit input contract in the compositor.

**Loop and alpha.** Reflect the scene at the current phase instead of feeding back previous frames. This avoids warm-up-dependent recursion. For standalone alpha export, internal refraction can only affect content included in that render; an RGBA clip cannot later bend arbitrary imagery added by another application.

**Research anchors.** [Maxime Heckel's mirrors and portals](https://blog.maximeheckel.com/posts/beautiful-and-mind-bending-effects-with-webgl-render-targets/), [refraction study](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/), [interior mapping](https://jingfu.design/work/interior), [Shader's glass study](https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/).

## 9. Resonant Sand

**The picture.** Fine grains gather into geometric standing-wave figures: a cross becomes a flower, then opens into lace and concentric nodal bands. Broad negative spaces make the transitions readable. In a ceramic mode, the same modal structure becomes a shallow raised membrane.

**Why it belongs.** Its symmetry comes from a wave field rather than a kaleidoscope or packed layout. It could be contemplative, intricate or rhythmically emphatic without needing frantic motion.

**Projection use.** Floors, round objects, domes, stage circles and sparse foreground overlays. Offer a full-field mode with joined modal structure rather than always displaying a floating plate inside a rectangular image.

**Controls.** Mode pair, plate/disc domain, modal blend, resonance width, grain amount, line thickness, agitation, drift and shallow relief.

**Starting looks.** *Salt Mandala*, *Copper Modes*, *Midnight Membrane*.

**Smart variation.** Select compatible mode pairs and keep the resulting nodal spacing above the chosen minimum feature size. Vary grain distribution without losing the underlying figure. Do not equate all frequency changes with equally useful compositions.

**Three.js route.** Evaluate an analytic modal field, render it as antialiased bands, grains or shallow geometry. Three.js cymatics projects demonstrate both particles and wave-driven patterns. The initial app version should be labelled an artistic cymatic instrument, avoiding a claim of physically exact real-plate mechanics.

**Loop and audio.** Drive modal weights by periodic functions. Grain placement and agitation should be reconstructible from seed and phase; raw particle settling is not automatically cyclic. Audio input could be added later through shared modulation, but the first version must work as a self-contained loop without audio analysis.

**Research anchors.** [Cymatics Labs](https://github.com/Sidmaz666/cymatics-labs), [Cymatique's plate model](https://github.com/KingAzat/cymatique), [Danlex's GPU particle gallery](https://github.com/danlex/particles).

## 10. Volumetric Veils

**The picture.** Translucent folds of pigment billow through soft backlight, with dark air between them and gentle illumination at the edges. It can resemble ink suspended in water, thin smoke, or an aurora seen through silk. The principal structure is three-dimensional density viewed as a rendered image.

**Why it belongs.** This would be the app's soft atmospheric counterpart to its sharp graphic fields and hard material forms. Oil already owns surface pigment; this instrument explores transmission and light inside a volume.

**Projection use.** Immersive rooms, curved screens, quiet backgrounds and alpha overlays. Projecting the image does not create a free-floating volumetric object in clear air; the effect is a visual illusion on the receiving surface.

**Controls.** Fold scale, density, erosion, curl, light direction, scattering appearance, depth layering, drift, colour absorption and quality.

**Starting looks.** *Milk in Cobalt*, *Rose Smoke*, *Amber Veil*.

**Smart variation.** Coordinate density with light and contrast so a variation retains both luminous folds and open areas. Choose a few broad structures before adding fine erosion; prevent all-white fog or an almost invisible dark frame.

**Three.js route.** A bounded volumetric raymarch using a periodic procedural density field. Official cloud/perlin examples and Maxime Heckel's write-up demonstrate the foundations. Reduced-resolution volume rendering and controlled reconstruction are candidates to benchmark, not assumed quality wins.

**Loop and alpha.** Closed coordinate/light motion makes the density field periodic without fluid-state accumulation. Use stable sampling noise so the image does not crawl or change after seeking. Integrate premultiplied colour and transmittance consistently, then obey the app's straight-alpha delivery contract. Preview and export must use the same art settings; a quality switch should alter sampling fidelity rather than the shape.

**Research anchors.** [Official volumetric cloud](https://threejs.org/examples/webgpu_volume_cloud.html), [official Perlin volume](https://threejs.org/examples/webgpu_volume_perlin.html), [Maxime Heckel's cloud rendering](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/).

## Projection requirements shared by all ten

These are proposed acceptance criteria based on the app's existing contract and the projection workflows below.

1. **Three useful composition roles.** Each instrument should have authored Background, Focus and Overlay looks. Background fills the view; Focus may have an intentional silhouette; Overlay supplies usable alpha. Resolume explicitly describes a background/focus/frame composition approach and the usefulness of alpha. [Layers and alpha](https://resolume.com/support/layers).
2. **Full source-domain coverage.** Pattern scale reveals a wider field. Do not scale a completed finite render and fill the unused area with black. Geometry must be created beyond the actual transformed view, and texture fields need appropriate sampling outside their initial domain.
3. **Spatial continuity is a design decision.** Tileable fields need matching values, derivatives, normals and connected geometry at joins. A central architecture, object or mandala should preserve one centre. Full-view coverage does not mean every effect must become a grid.
4. **A deliberate hierarchy of detail.** Start with readable large forms and midtone structure. Add fine texture only where target resolution supports it. Test minimum feature width in delivered pixels and on a projector; do not claim one fixed pixel width is universally safe.
5. **Shadows remain controllable.** Keep base exposure, highlight coverage and negative space separately adjustable. The actual object, ambient light and projector black level affect the result. A deliberately dark gap must remain distinguishable from an unintended rectangular render boundary.
6. **Motion must close as well as position.** Inspect the seam and its neighbouring frames. Matching the first and last frame's image alone does not prove smooth velocity, smooth deformation or stable temporal filtering. Do not include a duplicate endpoint in the exported sequence.
7. **No hidden frame-history dependency.** Prefer direct evaluation from seed and phase. Stateful simulation requires a defined bake/checkpoint/replay mechanism and immutable export data. Scrubbing, reload and interrupted export must reproduce the same result.
8. **Mapping-friendly framing.** Support current square, portrait and landscape exports, source transforms and masks. For surface-specific media, respect the destination's content atlas and aspect ratio. Final output alignment remains with mapping software unless we deliberately build a mapping stage. [Input maps](https://resolume.com/support/input-maps), [output transformation](https://resolume.com/support/en/output-transformation).
9. **Real alpha and honest optics.** Transparent exports must have clean edges and valid colour at zero alpha. A baked refraction clip only refracts the scene present when it was rendered. Publish that limitation in the interface if the effect offers glass transmission.
10. **Physical tests decide projection success.** Review projected output on a flat wall, a curved/irregular object and a masked multi-panel arrangement. The Lightform research illustrates why content's relationship to the physical scene matters. [Procedural projected AR research](https://arxiv.org/html/2001.00521v1).

## Integration strategy

**Retain the existing WebGL renderer for the first implementation wave.** Several inspiration projects use WebGPU/TSL. Three.js's own migration guide says existing ShaderMaterial, RawShaderMaterial and onBeforeCompile customisations need porting, and its old EffectComposer stack is not supported by WebGPURenderer. A backend change is a separate, testable project; importing a WebGPU example does not make it compatible with the app. [Official migration guidance](https://threejs.org/manual/pages/webgpurenderer).

All ten have plausible WebGL2 approaches, with different levels of approximation and engineering effort. That is a feasibility assessment, not proof that each proposed full-quality instrument meets the target frame rate. WebGPU can be evaluated later for a specific measured bottleneck.

A new instrument should follow these boundaries:

- Source module/geometry renderer under `src/rendering/`, called by StudioRenderer inside the current render loop.
- Explicit shape, motion, material and camera controls in the existing definitions/validation system; save only valid, versioned state.
- Existing source-view coordinates, layer ordering, masks, blend modes and grading.
- Existing periodic timeline, opacity/transform routes, native frame export, cache fingerprinting and recovery.
- Authored family recipes and quality limits for the current randomizer; structure/material/motion/palette locks retain their meaning.
- Shared resource lifecycle with bounded target and geometry caches. No per-frame renderer creation, independent requestAnimationFrame loop or hidden global simulation clock.

Prism Cathedral might justify a bounded same-frame scene pass. Living Ink may require a preparation cache. These are explicit extensions inside the effect pipeline, not reasons to duplicate the application renderer.

A saved simulator bake would need a complete identity: seed, topology parameters, simulation version, grid resolution, boundaries, preparation steps and any motion-affecting fields. An interrupted export must not silently rebuild a different bake. GPU replay may differ across hardware, so cross-device bit identity would need its own verification or portable baked assets.

## Build order and prototype gates

**First wave: 1, 5 and 6.** Caustic Atlas gives an immediate full-field light instrument. Kinetic Relief adds the clearest architectural mapping identity. Holographic Loom adds a tactile, flowing material that complements both. Together they cover background, focal structure and overlay.

**Second wave: 9, 4 and 3.** Resonant Sand has a relatively controlled analytic route. Velvet Currents adds richer directional motion. Magnetic Skin expands the app's materials after the shared lighting and filtering decisions are proven.

**Third wave: 7, 2, 8 and 10.** Crystal Reef needs coherent connected generation. Living Ink needs a defined preparation/loop contract. Prism Cathedral needs a bounded optical pipeline and disciplined framing. Volumetric Veils needs particular care at production resolution and on low-contrast projection surfaces.

For each prototype, produce three authored looks and a short loop before adding dozens of controls. Compare a calm and a stronger treatment, then keep only controls that produce a clear, useful change. Prefer reusing material/lighting helpers where it improves consistency; avoid making all ten look like the same shader with different parameters.

Gate each instrument on:

- A distinct visual identity at both thumbnail scale and full output size.
- Loop, reverse-scrub, arbitrary-seek, reload and interrupted-export parity.
- Correct behaviour at small/large source scales, rotation and non-square aspect ratios.
- Meaningful, stable randomizer variants at all three strengths and lock combinations.
- Clean alpha over black, white and saturated lower layers; refraction tested against its stated input contract.
- Timed 1080p previews and 4K exports on the target machine, with one layer and representative multi-layer combinations. Report GPU timing and resource counts rather than borrowing a demo's FPS claim.
- A real projector review for edge readability, contrast, fine-detail stability and intended viewpoint.

## Primary-source register

These are research references, not dependencies added to the app. Descriptions below are intentionally brief; implementation and artistic choices above are proposals. Author-reported capability is not an independent performance measurement. Some Codrops article bodies initially returned 403; where available I used their indexed text and the creator's linked repository. The flow-field source repository linked by its demo returned 404, so it is not offered as an available dependency.

| # | Reference | Relevance / evidence |
| --- | --- | --- |
| 1 | [Official Three.js examples](https://threejs.org/examples/) | Current catalogue of geometry, optical, particle and volumetric approaches; index reviewed. |
| 2 | [Three.js caustics](https://threejs.org/examples/webgpu_caustics.html) | Live optical example; rendering visually inspected. |
| 3 | [Maxime Heckel: caustics](https://blog.maximeheckel.com/posts/caustics-in-webgl/) | Creator's WebGL construction and approximation choices. |
| 4 | [Drei Caustics source](https://github.com/pmndrs/drei/blob/master/src/core/Caustics.tsx) | Concrete framebuffer/material implementation reference. |
| 5 | [Colejd reaction-diffusion](https://github.com/colejd/Reaction-Diffusion-ThreeJS) | GPU-driven Three.js Gray–Scott example. |
| 6 | [Robert Leitl RD source](https://github.com/robert-leitl/webgpu-reaction-diffusion) | Raw WebGPU compute reference; not a Three.js renderer example. |
| 7 | [Leitl's technical write-up](https://tympanus.net/codrops/2024/05/01/reaction-diffusion-compute-shader-in-webgpu/) | Compute/render separation and texture ping-pong; indexed article reviewed. |
| 8 | [Karl Sims RD tutorial](https://karlsims.com/rd.html) | Model behaviour, productive parameter regions and artistic control. |
| 9 | [Visuval creator showcase](https://discourse.threejs.org/t/visuval-io-a-3d-music-visualizer-for-content-creators/92288) | Creator-described mix of mesh, shader and feedback techniques in a visual instrument. |
| 10 | [Madhuram Yadav ferrofluid visualizer](https://github.com/madhuramyadav/ferro-fluid-audio-visualizer) | Three.js displacement and material exploration; creator documentation. |
| 11 | [Official marching cubes](https://threejs.org/examples/webgl_marchingcubes.html) | Implicit-surface construction reference; example description reviewed. |
| 12 | [Niccolò Fanton catalogue](https://demos.niccolofanton.dev/?demo=flowfield) | Creator-described flow fields, material filters and rendering studies. |
| 13 | [Flow-field particle demo](https://flowfield.niccolofanton.dev/) | Live Three.js GPGPU study; page description and rendering inspected. |
| 14 | [Official attractor particles](https://threejs.org/examples/webgpu_tsl_compute_attractors_particles.html) | Current Three.js compute example; description reviewed. |
| 15 | [GPUComputationRenderer](https://threejs.org/docs/pages/GPUComputationRenderer.html) | WebGL paired-target computation API. |
| 16 | [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) | Shared geometry, instance transforms and bounds/resource ownership. |
| 17 | [Angular slicing](https://threejs.org/examples/webgpu_tsl_angular_slicing.html) | Procedural geometry/material visibility technique; example description reviewed. |
| 18 | [Unwoven article](https://tympanus.net/codrops/2026/09/05/building-an-infinite-loom-unravelling-images-into-threads-with-three-js/) | Creator's independent ribbon construction and edge behaviour. |
| 19 | [Unwoven source](https://github.com/clementgrellier/unwoven) | Concrete Three.js ribbon-based experiment. |
| 20 | [Holocloth](https://github.com/dmitrykurash/holocloth) | Creator's WebGL2 cloth and optical-material design tool. |
| 21 | [Moiré](https://github.com/NeoVand/Moire) | Purpose-built interference-field studio using Three.js/TSL; repository reviewed. |
| 22 | [Jingfu Chen CD diffraction](https://jingfu.design/work/cd) | Creator's angle-dependent spectral material study; documentation reviewed. |
| 23 | [Geometry Painter](https://github.com/achrefelouafi/GeometryPainterThreeJS) | Creator's procedural crystal growth and instancing. |
| 24 | [Chiro Visuals geometry article](https://tympanus.net/codrops/2026/08/11/exploring-procedural-geometry-with-three-js-and-webgpu/) | Growth architecture and visual variation; indexed article plus linked repository reviewed. |
| 25 | [Maxime Heckel render targets](https://blog.maximeheckel.com/posts/beautiful-and-mind-bending-effects-with-webgl-render-targets/) | Mirrors, portals and composited scenes. |
| 26 | [Maxime Heckel refraction](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/) | Optical shader construction and scene-input dependency. |
| 27 | [Jingfu Chen interior mapping](https://jingfu.design/work/interior) | Shader-based apparent rooms; creator documentation. |
| 28 | [Shader liquid-glass grid](https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/) | Creator's shader-derived glass normals/refraction and later cloth update; indexed article reviewed. |
| 29 | [Cymatics Labs](https://github.com/Sidmaz666/cymatics-labs) | Three.js modal-field/particle instrument. |
| 30 | [Cymatique](https://github.com/KingAzat/cymatique) | Creator's plate-mode formulation and grain behaviour. |
| 31 | [Official volumetric cloud](https://threejs.org/examples/webgpu_volume_cloud.html) | 3D texture raymarching example; description reviewed. |
| 32 | [Maxime Heckel cloudscapes](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/) | Volume density, lighting and rendering tradeoffs. |
| 33 | [Three.js renderer migration](https://threejs.org/manual/pages/webgpurenderer) | Compatibility boundary for the current GLSL renderer. |
| 34 | [Lightform procedural projected AR](https://arxiv.org/html/2001.00521v1) | Primary projection research connecting effects to physical surfaces. |

Additional workflow references: [Resolume layers](https://resolume.com/support/layers), [input maps](https://resolume.com/support/input-maps), [output transformation](https://resolume.com/support/en/output-transformation). Supporting breadth: [Danlex particles](https://github.com/danlex/particles), [Jingfu Chen's lab](https://jingfu.design/work), [official Perlin volume](https://threejs.org/examples/webgpu_volume_perlin.html), [Aether 1 creator case study](https://tympanus.net/codrops/2025/08/06/building-aether-1-sound-without-boundaries/), [recursive feedback showcase](https://discourse.threejs.org/t/recursive-trail-ping-pong-three-js-render-to-texture-feedback/89718).

## Deliverable status

This pass adds this research document. It does not alter the application, install reference packages, copy demo implementations or change the running composition. The proposed names, preset directions, controls, build priorities and acceptance criteria are ready to guide the first prototypes.
