# Professional effect research and decisions

9 November 2026 · Form & Field 0.10

This review studies professional control design, material rendering, procedural art and projection-media reliability. It uses product documentation, graphics literature and creator-authored projects. The decisions below are engineering and art-direction judgments for this application. They are not endorsements by the referenced vendors, independent projector tests or claims of feature parity.

## What to borrow from professional tools

**Resolve: separate construction from finishing.** A useful effect needs an intentional image, followed by an independent way to shape its tonal response. Blackmagic's documented film-look work distinguishes individual optical contributions; its DCTL guide also addresses deterministic procedural randomness. That supports treating colour finish, material and motion as separate controls rather than making a single intensity slider change everything. Our implementation adds neutral per-layer luminance contrast, pivot, gamma, shadow lift, highlight compression and vibrance. It does not reproduce Resolve's proprietary film model. [Blackmagic 19.1 guide](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_19_1_New_Features_Guide.pdf).

**TouchDesigner: make the signal model legible.** Noise controls separate scale, amplitude, harmonic character and transforms; Level TOP separates tonal operations; Limit CHOP makes range and quantization explicit. The lesson is that a parameter should describe a stable operation, have a useful range and compose predictably with other operations. Form & Field now separates field deformation, temporal phase, material response and finishing. Preparation settings are explicitly excluded from animation routes. [Noise TOP](https://derivative.ca/UserGuide/Noise_TOP), [Level TOP](https://derivative.ca/UserGuide/Level_TOP), [Limit CHOP](https://derivative.ca/UserGuide/Limit_CHOP).

**MadMapper: a material is an instrument on a surface.** Its material documentation defines discoverable inputs and explains why changing a raw time multiplier causes animation jumps. It also distinguishes direct material evaluation from rasterised effects with previous-frame data. The transferable requirements are a coherent clock, clear defaults, bounded controls and awareness of the surface domain. Here we retain wrapped deterministic phase and unbounded source coordinates; we add a phase offset without changing cycle length. We do not introduce history-dependent playback state. [Material specification](https://raw.githubusercontent.com/madmappersoftware/MadMapper-Materials/main/MaterialsDoc.md), [material library](https://docs.madmapper.com/madmapper/6/3.-media/online-material-library).

**ISF: identity is part of the contract.** A parameter's name, limits, default and identity are meaningful metadata. Additional controls should not silently reinterpret a saved image. Our new controls have explicit neutral migration values, strict validation and UI help for dependencies. They use the existing schema and remain ordinary saved numeric parameters. [ISF reference](https://docs.isf.video/ref_json).

## Material depth without pretending to simulate everything

### Directional highlights and fabric

Filament distinguishes dense hard surfaces from cloth and explains directional reflectance. A spherical highlight on every material makes satin, metal and ceramic converge visually. The app now provides a tangent-oriented elliptical highlight, fill light and a separate clear-coat lobe on the new lit instruments. Surface and Oil reuse the directional highlight. Holographic Loom also exposes thread width, warp/weft spacing, fold depth and interlacing, so colour interference is supported by a readable fabric structure. This is an artistic approximation, not a full anisotropic GGX/cloth implementation. [Filament material models](https://google.github.io/filament/Filament.md), [material properties](https://google.github.io/filament/notes/material_properties.html), [Three.js physical material](https://threejs.org/docs/pages/MeshPhysicalMaterial.html).

**Stability matters more than a sharp still.** Very fine normals can produce moving specular sparkle. JCGT's work on geometric specular antialiasing identifies the broader problem; our implementation uses a simpler screen-normal-variance estimate to broaden newly enabled directional/coat highlights. Neutral older materials bypass these changes. This reduces unstable highlights rather than adding more blur to the whole picture. [JCGT abstract](https://jcgt.org/published/0010/02/02/), [NVIDIA filtering discussion](https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-24-high-quality-filtering).

Thin-film iridescence is a spectral problem. Belcour and Barla show why an RGB real-time model needs care. Our existing three-band optical tint remains a stylised finish; it should not be described as a calibrated film stack. It is kept restrained, with independent material controls, instead of turning every surface into a rainbow. [Belcour and Barla](https://belcour.github.io/blog/research/publication/2017/05/01/brdf-thin-film.html), [layered material discussion](https://belcour.github.io/blog/slides/2018-brdf-realtime-layered/slides.html).

### Volume rendering and sampling

PBRT separates transmittance from angular scattering. Accordingly, Veils now separates pigment density, optical absorption and scattering direction. The angular weighting uses a bounded Henyey–Greenstein expression; ribbon width and turbulence shape the density field independently. The instrument remains a procedural ribbon volume with simplified illumination, not a multiple-scattering cloud solver. [Transmittance](https://www.pbr-book.org/4ed/Volume_Scattering/Transmittance), [phase functions](https://www.pbr-book.org/4ed/Volume_Scattering/Phase_Functions).

Uniform depth steps can expose coherent bands in thin density features. Deterministic per-ray sampling dither breaks up those bands while retaining repeatability at a fixed output resolution. More samples reduce the sampling texture. We keep the older undithered result at the neutral setting and demonstrate the new option in Opalescent Smoke. Quality remains the same setting in preview and export. This follows the sampling principle, not copied lesson code. [Ray-marching discussion](https://www.scratchapixel.com/lessons/3d-basic-rendering/volume-rendering-for-developers/ray-marching-get-it-right.html).

### Chemical patterns

Karl Sims' Gray–Scott explanation provides a compact productive basis for chemical pattern generation. The key professional requirement is keeping preparation separate from timeline evaluation. Living Ink gains seed coverage and development duration while retaining curated chemistry families. Every preparation parameter participates in the cache key; pigment and flow remain live controls. Tests exercise combined preparation boundaries so a legal recipe does not silently become a blank field. [Gray–Scott tutorial](https://www.karlsims.com/rd.html), [RD tool controls](https://karlsims.com/rdtool-help.html).

## Weirdness with an intelligible structure

**Light as geometry.** Maxime Heckel's caustic study makes the useful distinction between an appealing optical field and a general geometry-aware light transport solution. Caustic Atlas stays a controlled height-curvature approximation. Wave alignment, refraction strength, halo and asymmetry now allow long lenticular folds and concentrated ridges independently. It is explicitly not scene-traced caustic transport. [Creator study](https://blog.maximeheckel.com/posts/caustics-in-webgl/).

**Flow rather than arbitrary wobble.** Bridson's curl-noise work motivates coherent divergence-free fields. Our domain deformation uses the curl of a small analytic stream function; Velvet Currents adds localized rotational flow, braiding, taper and fine eddies. It is still an analytic strand instrument. It does not claim to advect a persistent particle simulation. Creator particle studies help establish the visual potential, but their feedback/state assumptions should not be imported into an exportable loop without a closure strategy. [Curl-noise paper](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf), [Fanton catalogue](https://demos.niccolofanton.dev/?demo=flowfield), [FBO particle source](https://github.com/juniorxsound/Particle-Curl-Noise).

**Textile structure plus optical finish.** Unwoven's ribbon construction and Holocloth's holographic material show two different routes to tactile digital fabric. Neither is equivalent to a flat rainbow wave. Loom therefore gains construction controls and directional shading. The current implementation remains a filtered height/strand field, without cloth collision physics. [Unwoven](https://github.com/clementgrellier/unwoven), [Holocloth](https://github.com/dmitrykurash/holocloth).

**Standing-wave figures.** Rectangular modal interference is productive but restrictive. Resonant Sand now blends circular/angular figures and a secondary harmonic, while keeping grain density and nodal softness independent. The circular field is an artistic radial mode expression, not a Bessel eigenmode solution for a calibrated plate. Both original modal blend endpoints remain usable when mode numbers coincide. [Creator plate model](https://github.com/KingAzat/cymatique).

**Architectural variation.** A convincing repeated vault benefits from a controlled vanishing point and relative rotation between frames. Prism gains frame width, arch roundness, vault twist and two vanishing-point controls. Relief gains stagger, joints, rounding, hinge position and opening variation. These expand architectural composition through the existing source field rather than introducing another camera, render loop or feedback chain.

**Mineral topology.** Magnetic Skin can transition from isolated peaks to connected ridges and retain a continuous material floor. Crystal Reef independently changes site irregularity, facet orientation, crystal spread and vein depth. These controls let the same construction range from tessellated mineral surfaces to open geodes without randomizing everything into unrelated noise.

## Projection and performance decisions

A pattern's coordinate domain must remain continuous through scale and transform changes. Sampling derivatives belong to the unwrapped coordinates, and fine structure should filter towards its area average. Otherwise a small pattern becomes a grid of bounded screenshots or shimmering lines. Existing repeat infrastructure is retained, with tests for rotated, translated and scaled views, seams, masks and explicit transparent gaps. [Filtering principles](https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-24-high-quality-filtering), [Three.js render targets](https://threejs.org/docs/pages/RenderTarget.html).

Half-float intermediate buffers do not imply HDR delivery. The app's existing output remains SDR with its established tone map, straight-alpha handoff and native encoding. Tonal operations act on unassociated colour and preserve coverage. The new finisher bounds extreme grades before a half-float write, avoiding infinities in otherwise legal combinations. [TouchDesigner pixel formats](https://docs.derivative.ca/Pixel_Formats), [GLSL TOP](https://derivative.ca/UserGuide/GLSL_TOP), [Three.js renderer](https://threejs.org/docs/pages/WebGLRenderer.html).

There is no responsible single FPS promise for arbitrary four-layer compositions. Volume sampling, normal filtering, target resolution and material detail have different costs. The audit records completed-frame latency, and the UI retains explicit quality choices. Venue brightness, defocus, surface geometry and edge blending still need a projector test. Monitor renders and decoded movies cannot establish those physical results.

## Source register and evidence limits

The numbered register separates product specifications, technical models and creator references. Text was read through official/author sources; no third-party effect pack or shader code was copied. The JCGT paper was available as a search-indexed abstract; its full PDF could not be fetched, so the app does not claim to implement that paper's exact method. The 20 Colorist Guide PDF was too large for this browser, so claims about that book are not used as implementation evidence. Some Derivative `docs.` URLs rejected access; the corresponding official `derivative.ca/UserGuide/` pages were read instead. Creator projects were inspected through their published descriptions/source pages in this pass, not independently benchmarked or newly inspected in a live 3D browser.

1. [Blackmagic 19.1 guide](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_19_1_New_Features_Guide.pdf) — discrete optical controls and deterministic DCTL facilities; version-specific documentation.
2. [MadMapper material library](https://docs.madmapper.com/madmapper/6/3.-media/online-material-library) — procedural material workflow.
3. [MadMapper material specification](https://raw.githubusercontent.com/madmappersoftware/MadMapper-Materials/main/MaterialsDoc.md) — parameters, clocks, generators and rasterisation/history contracts.
4. [ISF JSON specification](https://docs.isf.video/ref_json) — names, types, ranges, defaults and identity metadata.
5. [ISF overview](https://isf.video/) — portable procedural shader model.
6. [Noise TOP](https://derivative.ca/UserGuide/Noise_TOP) — independent spatial/noise controls.
7. [Noise POP](https://derivative.ca/UserGuide/Noise_POP) — field displacement and derivatives.
8. [Level TOP](https://derivative.ca/UserGuide/Level_TOP) — separation of tonal operations.
9. [Limit CHOP](https://derivative.ca/UserGuide/Limit_CHOP) — range limiting and quantisation.
10. [Lookup TOP](https://derivative.ca/UserGuide/Lookup_TOP) — colour mapping from scalar fields.
11. [Feedback TOP](https://derivative.ca/UserGuide/Feedback_TOP) — state/history distinction.
12. [Analyze TOP](https://derivative.ca/UserGuide/Analyze_TOP) — measuring images rather than judging a single still alone.
13. [PBR MAT](https://derivative.ca/UserGuide/PBR_MAT) — explicit material/lighting workflow.
14. [Pixel formats](https://docs.derivative.ca/Pixel_Formats) — precision choices.
15. [GLSL TOP](https://derivative.ca/UserGuide/GLSL_TOP) — shader processing context.
16. [Three.js MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) — physically inspired material controls and cost.
17. [Three.js RenderTarget](https://threejs.org/docs/pages/RenderTarget.html) — target resolution, sampling and allocation.
18. [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) — renderer diagnostics and resource ownership.
19. [Filament material models](https://google.github.io/filament/Filament.md) — cloth, anisotropy and coating references.
20. [Filament material properties](https://google.github.io/filament/notes/material_properties.html) — material semantics.
21. [Belcour–Barla iridescence](https://belcour.github.io/blog/research/publication/2017/05/01/brdf-thin-film.html) — spectral-model caveats.
22. [Layered-material talk](https://belcour.github.io/blog/slides/2018-brdf-realtime-layered/slides.html) — layer interactions.
23. [JCGT specular filtering abstract](https://jcgt.org/published/0010/02/02/) — problem statement; full paper unavailable in this pass.
24. [NVIDIA GPU Gems filtering](https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-24-high-quality-filtering) — procedural sample footprints.
25. [PBRT transmittance](https://www.pbr-book.org/4ed/Volume_Scattering/Transmittance) — attenuation along a ray.
26. [PBRT phase functions](https://www.pbr-book.org/4ed/Volume_Scattering/Phase_Functions) — angular scattering.
27. [Scratchapixel ray marching](https://www.scratchapixel.com/lessons/3d-basic-rendering/volume-rendering-for-developers/ray-marching-get-it-right.html) — integration/sampling concepts.
28. [Karl Sims Gray–Scott](https://www.karlsims.com/rd.html) — productive chemical fields.
29. [RD tool help](https://karlsims.com/rdtool-help.html) — artist-facing chemistry controls.
30. [Heckel's caustics](https://blog.maximeheckel.com/posts/caustics-in-webgl/) — optical construction and approximation choices.
31. [Bridson curl-noise](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf) — coherent flow model.
32. [Fanton's catalogue](https://demos.niccolofanton.dev/?demo=flowfield) — creator-described flow/optical experiments.
33. [Particle curl-noise source](https://github.com/juniorxsound/Particle-Curl-Noise) — a concrete FBO particle approach.
34. [Unwoven source](https://github.com/clementgrellier/unwoven) — ribbon construction reference.
35. [Holocloth source](https://github.com/dmitrykurash/holocloth) — holographic textile reference.
36. [Cymatique source](https://github.com/KingAzat/cymatique) — a contrasting plate-model approach.
