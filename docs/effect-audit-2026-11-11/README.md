# Form & Field — effect audit and new direction

11 November 2026 · Current source: 0.11.0 · Audit and proposal only

**We are not yet at the intended high-end projection-media standard.** The current app has useful rendering and delivery foundations, but much of the library still feels like a collection of parameterized demonstrations. The previous changes improved mechanisms without establishing sufficiently strong finished images. The next step should be one approved piece of moving media, followed by a reusable instrument derived from it.

The issue is not that sine waves, procedural shaders or simple geometry are inherently poor. Excellent work uses all three. Our main gaps are spatial composition, material-specific form, relationships between elements, and directed change over time. A generic Organic control cannot provide those decisions.

Read the [visual review](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/review.html>) alongside the dossiers. The [research register](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>) separates verified source facts from design interpretation and records access limits. The [preset index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>) accounts for every current preset.

## What was audited

- All **17 source families**: 16 procedural families plus imported Image.
- All **139 presets**, freshly captured at phase 0, 1/3 and 2/3: **417 stills**, composited over black at 640 × 360.
- **70 temporal sheets**, each with 12 equally spaced samples across a 20-second study, covering every named Surface, Sculpture, Fractal, Graphic and Super 8 branch plus the newer construction modes. The sheets were inspected as temporal strips; they do not substitute for full-speed motion/loop review.
- **32 additional renders**: one representative per procedural family at 1920 × 1080 and 720 × 1280. These provide inspection assets; the audit is not a fresh 4K performance certification.
- Source construction, clocks, material responses, parameter dependencies, layout, surface inputs and export implications. Image import has a locally generated diagnostic fixture.
- **31 actual MadMapper shader implementations**, selected from an inventoried official source tree, plus official material documentation. Factory and community material status are identified in the register.
- Creator/production sources, commercial loop references, 2026 TouchDesigner examples, official operators and primary technical literature. Six commercial preview/trailer pages were visually sampled in the browser. No complete pack was bought or locally benchmarked.

These are qualitative design judgments grounded in current renders and source. No arbitrary numerical beauty scores are used. Existing software tests are not evidence that an effect has reached the requested visual standard.

## Root causes

| Finding | Concrete evidence | Consequence |
| --- | --- | --- |
| Material names outrun their representations | Magnetic is shaded cells; Reef is a faceted Voronoi sheet; Prism is nested analytic bands; Sand has no moving grains. | Either construct the promised behavior/form or keep the current result under an honest graphic identity. |
| Motion often changes the whole image in one way | Shared phase, global reveal, regular traveling fields and synchronized opening dominate. | Add relationships, local timing, holds, propagation and meaningful events. |
| Geometry and composition are too uniform | Similar grids, evenly distributed cells, constant line density and centered objects. | Author macrostructure, spacing, size classes and where activity happens. |
| Different media share similar shading/color logic | Several newer fields use the same height-normal/coat model and related palettes. | Use material-specific cues and intentional flat color where appropriate; PBR everywhere is not the answer. |
| State exists without sufficient visual direction | Evolving Ink fills with pale pigment; transported Currents lacks a consistently strong main flow. | Direct injection/emission, density and lifetimes. Simulation alone does not create a compelling image. |
| Loop closure has become a design constraint too early | Small periodic breathing is easy to close and reconstruct. | Choose loop or finite-clip identity for the scene, then implement the correct temporal contract. |
| Surface relationship is still shallow | Most patterns can be generated without knowing the receiving architecture; the new surface field is a limited 2D influence. | Introduce useful region/edge/depth inputs for selected scenes before arbitrary calibration features. |

The 1080p Magnetic/Reef evidence also exposes hard field-boundary highlight/edge artifacts. Those need representation/filtering review; passing finite-pixel checks does not establish clean highlights. Two help-text claims need mode-specific correction: evolving Ink is no longer described correctly by the general “without simulation warm-up” sentence, and Prism does not actually reflect a rendered room.

## Plan for every effect

Each dossier contains current evidence, individual branch/look actions, TouchDesigner and MadMapper comparisons, an original target scene, implementation sequence, controls/timing/mapping, acceptance criteria and cost/risk alternatives. **M/L are relative scope classes, not calendar estimates.**

| Effect | Presets | Proposed decision | Scope |
| --- | ---: | --- | --- |
| [Surface](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/01-surface.md>) | 17 | retain the graphic engine; redesign composition and movement | M — focused renderer redesign |
| [Sculpture](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/02-sculpture.md>) | 11 | retain the 3D foundation; rebuild motion direction and framing | M; optional growth solver is L |
| [Fractals](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/03-fractal.md>) | 15 | separate 2D ornament from 3D environment; retain the mathematics | M for 2D direction; L for world traversal |
| [Oil Slides](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/04-oil.md>) | 9 | retain the optical pass; replace the repeated behavioral setup | L for a convincing liquid instrument |
| [Super 8 Paint](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/05-super8.md>) | 6 | retain film transport; redesign marks and temporal composition | M; original scanned media is an optional addition |
| [Graphic Patterns](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/06-graphic.md>) | 32 | retain layout/rendering; replace synchronized motion with designed relationships | M — high return with limited renderer risk |
| [Image / imported media](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/07-image.md>) | Import | retain still compositing; extend it into a deliberate source/input workflow | M for field inputs; L for moving-media ingest |
| [Caustic Atlas](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/08-caustic.md>) | 4 | replace the line-threshold look with a receiver-based light construction | M — new caustic source pass |
| [Living Ink](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/09-livingink.md>) | 7 | separate reaction patterns from ink transport; rebuild the evolving treatment | L — simulation and material direction |
| [Magnetic Skin](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/10-magnetic.md>) | 4 | replace the peak geometry model; retain a legacy cellular-metal mode | L — new 3D surface construction |
| [Velvet Currents](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/11-currents.md>) | 7 | retain deterministic path reconstruction; rebuild emission, density and ribbon form | M/L — path composition and renderer work |
| [Kinetic Relief](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/12-relief.md>) | 7 | retain actual solids; replace the square-grid choreography | M — scene, layout and event design |
| [Holographic Loom](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/13-loom.md>) | 4 | replace the flat plaid construction with a deforming material surface | L for cloth; M for an authored procedural surface |
| [Crystal Reef](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/14-reef.md>) | 4 | separate the polygon mosaic from an actual clustered growth instrument | L — topology, geometry and growth authoring |
| [Prism Cathedral](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/15-prism.md>) | 4 | replace nested 2D outlines with a coherent optical space | L — 3D scene and optics; bounded quality first |
| [Resonant Sand](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/16-resonance.md>) | 4 | retain the nodal field; add actual grain organization and mode events | M/L — particle response and temporal direction |
| [Volumetric Veils](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/effects/17-veils.md>) | 4 | retain ray integration; rebuild density structure and scene lighting | L for a convincing atmosphere; M for bounded procedural veils |

## How the reference tools change the plan

TouchDesigner is a construction environment. Comparing our preset to “TouchDesigner” in general is not meaningful: the useful comparison is a particular network, its source fields, geometry, state, material and score. The dossiers name the actual operator/tutorial sources and explicitly distinguish proposed networks from networks that were executed. Recent POPs examples reinforce per-element attributes and form/material/light layering; they do not require us to recreate a node editor.

MadMapper contains simple factory generators as well as community materials and surface workflows. Some inspected materials are inexpensive trigonometric or noise textures; others have real distance-field intersection, reflection/refraction or previous-frame feedback. Their names are not a quality scale. We should match the useful controls and spatial mechanisms, and exceed the simple texture baseline with strong authored media.

Commercial loops provide a finished-image benchmark, often made with offline tools or captured material. Their quality is a legitimate target; their complexity is not evidence that the same scene can run live in our Electron/WebGL renderer. Three current retailer Top 12 entries are included as a dated popularity snapshot, alongside older examples chosen for specific relevant strengths.

Examples: [Pao Olea — Aura Flow [34]](https://derivative.ca/community-post/tutorial/aura-flow-touchdesigner-tutorial-34/75535), [vtln — Rolling Tiles](https://derivative.ca/community-post/tutorial/rolling-tiles-using-pops-chops-and-dats/75531), [MadMapper Raymarching Template](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Raymarching%20Template/Raymarching%20Template.fs), [MadMapper Line Pattern Pro](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Line%20Pattern%20Pro/Line%20Pattern%20Pro.fs), [KRATATA — AchromaticHiss](https://resolume.com/footage/AchromaticHiss) and [DJVB — BoxMappingToolkit](https://resolume.com/footage/BoxMappingToolkit). [Moment Factory / Notch — AURA Invalides](https://www.notch.one/madewithnotch/aura-invalides) documents a professional hybrid production pipeline; it supports evaluating hybrid authoring rather than forcing every target into one procedural pass.

## Three viable product paths

| Path | What it means | Strength | Cost / limitation |
| --- | --- | --- | --- |
| **A. Purpose-built authored instruments — recommended first** | Keep this app and its delivery pipeline; prove a few excellent scenes, then expose only useful controls. | Direct ownership, focused workflow, deterministic output. | Requires real art direction and some new representations. Stop adding families until the chosen proof succeeds. |
| **B. Hybrid media director** | Combine original baked/captured/simulated media with procedural generation, masks, grading and timed events. | Higher ceiling for glass, liquids, cloth and volumes without requiring every process to run live. | Needs deterministic video/image-sequence ingest, asset management and caches. Render quality and source provenance become explicit responsibilities. |
| **C. TouchDesigner companion workflow** | Use TD for complex networks; keep this app for a curated interface, preparation or delivery where that adds value. | Access to a mature generative construction ecosystem. | Licenses, distribution, integration and reproducibility need a technical proof. It may change what this product is; do not switch engines on assumption alone. |

No engine migration is justified merely by dissatisfaction with the current presets. A better renderer cannot choose composition or choreography for us. If a strict live-performance requirement dominates, it must be measured against the approved scene before choosing B or C.

## Recommended next experiment

Start with **one mapping-first architectural study**, jointly using the Kinetic Relief / Prism / Graphic direction. This tests the product’s central promise more directly than another fullscreen texture.

Proposed 20-second score, created as original media:

1. **0–4 s:** a few fixed facade/cube edges are revealed; the main opening stays dark.
2. **4–9 s:** large panels begin to open; neighboring smaller groups respond after a delay.
3. **9–14 s:** an interior passage is revealed with coherent depth and light. Thin graphic activity follows the structure.
4. **14–18 s:** activity settles; a light sweep explains the geometry.
5. **18–20 s:** close into the starting pose if a loop is selected, or hold a deliberate finite ending.

Only build the minimum layout, event track and geometry needed for this movie. Produce a neutral clay/silhouette version first. Do not add a general graph editor, model importer or full simulation platform before seeing whether this scene is convincing.

Alternative first proofs are **receiver-based neutral caustics** for a bounded optical rewrite, or **two-tributary Currents** for an organic composition. Ink, Magnetic, Loom and Veils have larger material/solver risks; they should follow an explicit identity choice rather than another generic motion pass.

## Implementation order after a direction is selected

| Stage | Deliverable | Stop / continue condition |
| --- | --- | --- |
| 1. Reference contract | One original target, two or three relevant references, required material cues, geometry/view, loop-or-clip, intended surface and delivery size. | We agree what the result must look and move like. |
| 2. Minimum proof | A single complete 10–20 second scene, with diagnostic clay/field views and a simple mapped mock-up. | Visual review decides whether the representation works. No library expansion before this. |
| 3. Instrument | Extract controls that preserve the approved look; add several genuinely different authored variations. | Variations retain composition and identity without being palette swaps. |
| 4. Shared utilities | Reuse only demonstrated needs: region IDs, event envelopes, source-field inputs, material/light rigs or state caches. | Each utility serves an approved scene; no speculative framework rewrite. |
| 5. Delivery and regression | Integrate with existing saved projects, one compositing/export path, native output and resume behavior. | Numerical correctness and visual quality both pass their own gates. |
| 6. Physical review | Project onto the chosen mock surface at the intended view and light conditions. | Detail, black level, focus and depth illusion work in the actual use case. |

## Acceptance criteria for the new approach

- **Composition:** a main form/action is readable at small viewing size; secondary detail supports it. Quiet and active regions are deliberately placed. A uniform utility texture may remain uniform when that is its chosen purpose.
- **Material identity:** shape, light and behavior explain the promised medium. A clay/field diagnostic must support that claim; color/glow cannot conceal the wrong geometry.
- **Time:** animated studies show a purposeful progression or deliberately controlled continuous behavior. Static looks and meditative light-only loops are valid when intentional. Full-speed review and seam-adjacent frames are required later; sampled sheets cannot certify these.
- **Mapping:** use a registered test surface/regions and an explicit audience view where perspective matters. The app is a media generator; it need not reproduce MadMapper calibration or show control to produce excellent content.
- **Controls:** a small useful set with clear dependencies. Preparation, simulation and display controls are distinguished. No generic slider is added merely to increase parameter count.
- **Technical delivery:** set a named hardware/resolution budget, then measure completed GPU work, memory, preparation/seek cost, alpha, color, sampling and resumed output. No universal four-layer 4K live-rate promise.
- **Reference honesty:** identify whether evidence is creator description, source code, stills, sampled preview or full motion study. Preserve credits; create original media and code unless reuse is explicitly cleared.

## What changed during this audit

Only research documentation and isolated review artifacts were created. No effect, preset, UI, installed app, saved project or user profile was changed. The capture harness reports no page/renderer errors. Existing unit/native export tests were not rerun because product code did not change; old passing reports are not presented as new verification. The audit does not certify physical projection, current third-party-host performance or every frame of every reference film.

The decision now is which product path and first visual proof to pursue. The 17 dossiers preserve the remaining options without committing to a broad rewrite.
