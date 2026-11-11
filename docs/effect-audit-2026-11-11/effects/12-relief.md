# 12. Kinetic Relief

**Recommendation: retain actual solids; replace the square-grid choreography. Scope: M — scene, layout and event design.**

7 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

Seven presets include a shaded-field grid and real hinged solids. The latter is technically a substantial improvement, but all three new studies still look like walls of similar square plates. [ReliefRenderer.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/ReliefRenderer.ts>) uses one BoxGeometry, up to 2048 instances, a fixed perspective camera and a shared key/fill setup. Each opening follows a sinusoidal wave with a coarse group offset. The actual-solids mode correctly hides bevel/rounding controls it does not implement; that is not a no-op-control bug. The underlying visual limitation is that a more physical grid is still the same composition and repeated action.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/relief-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Treatment / look | Plan |
| --- | --- |
| Shaded — Porcelain Shutters, Copper Accordion, Basalt Scales, Phase Shutters | Preserve as Graphic shutters; do not mistake normal shading for solid mechanics. |
| Breathing Facade | Use facade regions and several scale groups, with an opening origin and a clear held state. |
| Folding Copper | Model an articulated accordion/linked set of panels so motion transfers between pieces. |
| Quiet Monument | Use a few large solids and a traveling light/reveal; quiet should not mean a dense grid moving almost imperceptibly. |

## Comparison and reference lessons

[DJVB — BoxMappingToolkit](https://resolume.com/footage/BoxMappingToolkit) shows internal mechanisms and face continuity in a mapped-object context; [Bot & Dolly — Box, Ian Sherman production account](https://www.ianjsherman.com/work/box/) explains coherent camera/scene relationships. [Limelight — Interconnection](https://www.limelight.art/portfolio/interconnection) treats facade regions as design elements. TouchDesigner: [Dean Cheesman — Flip-Dot Display](https://derivative.ca/community-post/tutorial/flip-dot-display-tutorial-pops-dithering-and-feedback/74546) makes instances respond to image attributes, and [vtln — Rolling Tiles](https://derivative.ca/community-post/tutorial/rolling-tiles-using-pops-chops-and-dats/75531) offers deliberate looping row/column behavior. MadMapper: [MadMapper Raymarching Template](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Raymarching%20Template/Raymarching%20Template.fs) is a coherent 3D scene baseline; [MadMapper Plane Deform](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Plane%20Deform/PlaneDeform.fs) is a cheaper depth illusion. Its material called [MadMapper Shutter scale](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Shutter%20scale/Shutter%20scale.fs) is only a color timing gate and is explicitly **not** a hinged-solid reference.

## Proposed authored target

**One opening, many scales**—a few large panels open first, smaller neighboring pieces follow, one internal layer is revealed, then the structure settles. **Linked accordion**—hinges transmit motion across a connected band. **Stone light study**—mostly stationary macrogeometry becomes legible through a controlled light sweep. Prove the first target on a simple facade/cube mock-up.

## Implementation sequence

1. Replace uniform placement as the only layout with a stable region hierarchy: main opening, secondary panels, joints and negative-space areas. Support strips, polygons or a small curated kit of shapes.
2. Implement local hinge frames, optional parent/child transforms and an authored event score with anticipation, travel, hold and release. Separate mechanical relationships from random phase.
3. Add real edge treatment for close-view solids where the target requires it, and a light rig that reveals depth. Keep shadow resolution/softness consistent with the chosen framing.
4. Add audience-view and region-registration previews. Continue exporting the same scene through StudioRenderer; avoid a separate show renderer.

## Controls, timing and mapping

Expose layout hierarchy, hinge direction, reveal progression, follow delay, opening depth and light sweep. These should produce meaningful spatial actions. Use an explicitly closed event schedule for loops; finite opening/collapse scenes can be clips. Optional perspective setup should explain the assumed audience view. Existing polygon influence is not a full facade/3D calibration system.

## Proof required before broadening

Require a neutral clay movie where a large action is readable before small panels are visible. Check hinge contact and panel intersections, cast shadows on surviving geometry, silhouette/alpha, no layout reseeding under transforms and no abrupt density stride changes in intended framing. Compare a mapped mock-up from the chosen viewpoint, then a physical surface before calling the illusion production-ready.

## Cost, risk and alternative

This does not need a general rigid-body solver for the first result. A few correctly articulated pieces with a strong score can outperform thousands of independently opening boxes. Curated scene/layout authoring is the first investment; arbitrary imported architecture is a later option.
