# 11. Velvet Currents

**Recommendation: retain deterministic path reconstruction; rebuild emission, density and ribbon form. Scope: M/L — path composition and renderer work.**

7 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

The original four looks are regular woven line fields. The three new transported studies have actual trajectories and more empty space, but often read as sparse hairline fragments with uneven concentration and a few dominant bends. [CurrentRenderer.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/CurrentRenderer.ts>) seeds a world lattice, reconstructs 64-step paths, and draws finite-age screen-plane triangle strips. [flow-field.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/flow-field.ts>) supplies a directed sine stream-function field. This is real transport through a prescribed field, but not a fluid solver, and the fibres have no 3D layering. Directional sheen mainly changes brightness in this renderer, not a physical fibre response.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/currents-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Treatment / look | Plan |
| --- | --- |
| Analytic — Aurora Comb, Copper Estuary, Ivory Undertow, Vortex Filaments | Retain as Graphic weave; do not confuse denser parallel stripes with transported fabric. |
| Silk River | Replace uniform lattice emission with intentional upstream ribbons and obstacle-guided bundles. |
| Copper Confluence | Stage two distinguishable tributaries and their meeting; avoid a few isolated curls on an otherwise empty frame. |
| Gathering Light | Gather material through a designed change in field/emission, not only a time warp that accelerates/slows the same paths. |

## Comparison and reference lessons

TouchDesigner: [Pao Olea — Aura Flow [34]](https://derivative.ca/community-post/tutorial/aura-flow-touchdesigner-tutorial-34/75535) describes trail form, attributes, material, lights and a secondary detail layer; [TouchDesigner — Particle POP](https://derivative.ca/UserGuide/Particle_POP) supplies per-particle lifecycle behavior. MadMapper: [MadMapper Wisps](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Wisps/Wisps.fs) is a cheap analytic filament baseline and [MadMapper Particles](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Particles/Particles.fs) is a small fixed particle/link shader, not an equivalent large simulation. [teamLab — Universe of Water Particles](https://www.team-lab.com/news/uowp1307/) gives a stronger transport/spatial benchmark; [Tyler Hobbs — Fidenza algorithm account](https://www.tylerxhobbs.com/words/fidenza) explains why placement, widths and spacing are essential. [Bridson, Hourihan & Nordenstam — Curl-Noise](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf) provides a procedural velocity option without requiring a full fluid solver.

## Proposed authored target

**Two tributaries**—wide, medium and fine bundles enter from two chosen regions, skirt an obstacle, then meet with readable density. **Folded current**—one broad ribbon turns through depth, carrying finer strands. **Quiet eddy**—a sparse secondary swirl supports the main flow. The targets need distinct scales and a reason for each strand to be present.

## Implementation sequence

1. Replace the fixed lattice as the only composition mechanism with seeded emitter curves/regions, density masks and several strand-width classes. Keep stable IDs and deterministic reconstruction.
2. Prototype spatially composed noise/curl and explicit attractor/vortex primitives. Evaluate actual field behavior at boundaries; adding more frequencies globally is not the objective.
3. Add adaptive path sampling at tight turns and a proper ribbon join/taper implementation. Prototype depth-separated ribbon bundles, normal/tangent-based highlights and selective occlusion.
4. Let emission and field envelopes author a genuine gather/confluence action. Keep lifecycle closure explicit and measure CPU upload/cache cost before raising strand count.

## Controls, timing and mapping

Expose emitter layout, main flow, bundle scale, turbulence scale, lifetime/length and width distribution. Distinguish geometric depth from brightness spread. The current finite lifecycle is a useful loop mechanism; preserve it or replace it with a documented periodic emission/state strategy. Boundary regions should steer bundles, with enough clearance for their width—not just keep center points outside an obstacle.

## Proof required before broadening

Require a readable main flow at small viewing size, fine strands only as support, no recurring lattice pattern and no sharp segment corners at high curvature. Check birth/death density, obstacle contact, path identity under crop/zoom and two-emitter interaction. A monochrome silhouette/coverage movie must work before glow and color. Review aliasing of narrow fibres at the actual output scale.

## Cost, risk and alternative

This is primarily a composition/geometry problem now; another transport implementation alone would repeat the last mistake. More fibres can increase bandwidth without improving the image. The lower-cost route is a beautifully staged flat flow drawing; 3D volumetric fibres are an optional higher scope.
