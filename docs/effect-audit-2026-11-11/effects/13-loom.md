# 13. Holographic Loom

**Recommendation: replace the flat plaid construction with a deforming material surface. Scope: L for cloth; M for an authored procedural surface.**

4 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

The four presets are wavy, fine plaid fields. Thread density and thin-film color distinguish them slightly, but there is little fabric silhouette, drape, overlap or convincing tension. [instrument-shaders.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/instrument-shaders.ts>) adds a small number of sine folds to a 2D domain, combines warp/weft stripe functions, and shades a derived height normal with the common coat model. The over/under option modulates brightness rather than constructing interlaced yarn geometry. Fine thread grids also risk becoming the dominant visual artifact after resampling or projection.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/loom-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Look | Plan |
| --- | --- |
| Pearl Gauze | Build a translucent cloth patch with a readable free edge, large folds and sparse visible weave. |
| Petrol Satin | Use a coherent draped surface and tangent-aligned highlights; minimize rainbow coloring until the shape works. |
| Copper Interference | Retain as an intentional optical grating/moire graphic study, separate from cloth realism. |
| Iridescent Organza | Use layered thin fabric surfaces with depth, restrained transmission and filtered microstructure. |

## Comparison and reference lessons

TouchDesigner: [tormozgh — Fabric Simulation with Spring SOP](https://derivative.ca/community-post/tutorial/fabric-simulation-touchdesigner/65193) explicitly combines a simulated surface and silk material; [TouchDesigner — PBR MAT](https://derivative.ca/UserGuide/PBR_MAT) supports the material workflow. [RAW Designs — DeepSilk2](https://resolume.com/footage/DeepSilk2) supplies a commercial comparison for large folds, reflections and silhouette. MadMapper’s [MadMapper RaymarchedNoodles](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/RaymarchedNoodles/RaymarchedNoodles.fs) is a 3D filament example, while [MadMapper Dunes](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Dunes/NOISE_Dunes.fs) demonstrates composed waves; neither is a cloth solver. [Google — Physically Based Rendering in Filament](https://google.github.io/filament/Filament.md.html) supports a separate cloth/sheens model, and [Macklin, Müller & Chentanez — XPBD](https://matthias-research.github.io/pages/publications/XPBD.pdf) is a potential deformation method. The real lesson is coordinated shape, tangent and light—not merely choosing a more complex solver.

## Proposed authored target

**Suspended organza**—one cloth corner is held while a broad fold moves down to a free edge. **Satin wave**—one large crease rolls through a dark sheet, carrying a broad directional highlight. **Interference screen**—a deliberately graphic pair of line systems produces slow moire. Treat optical grating and physical fabric as separate looks.

## Implementation sequence

1. Prototype a tessellated 3D cloth surface with a boundary silhouette and explicit tangent frame. Begin with authored periodic deformation and a few anchor constraints.
2. Use the macro surface for drape/folds; add weave as a filtered material detail. Derive sheen from yarn/fold directions and give the material an environment/light rig.
3. Add two-layer transmission/occlusion only where needed. Resolve sorting and premultiplied alpha carefully; arbitrary translucent cloth intersections are not free.
4. Only choose XPBD after a procedural surface has failed the approved movement target. If selected, add fixed ticks, anchor/control tracks, pre-roll and baked replay before broad UI exposure.

## Controls, timing and mapping

Expose anchor layout, slack/tension, fold travel, wind/gesture strength, weave scale and sheen width. A procedural surface can be an exact loop. Simulated cloth needs a solved/baked cycle or a finite-clip contract; periodic wind alone is insufficient. Choose a mapped region whose silhouette can carry the cloth illusion rather than filling every surface uniformly.

## Proof required before broadening

Require an untextured clay/silhouette version that reads as fabric in motion. Then verify tangent-aligned highlights, no grid crawling, no depth-sort popping, sensible layer alpha and coherent movement at the held/free boundaries. Test the weave at preview, HD and target projector detail. Large form must survive when the threads are filtered away.

## Cost, risk and alternative

A strong procedural fabric surface may meet the need without a simulation. Full cloth collision, self-collision and robust transparent layering are expensive. The low-cost alternative is to retain the current pattern under a clear name such as Woven interference and stop promising satin material presence from it.
