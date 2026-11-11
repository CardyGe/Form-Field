# 03. Fractals

**Recommendation: separate 2D ornament from 3D environment; retain the mathematics. Scope: M for 2D direction; L for world traversal.**

15 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

Fifteen presets span nine constructions plus color treatments. Kaleidoscopes are centered ornaments; Julia sets are dark islands with much of their intricacy below review scale; Mandelboxes are lit isolated objects, even when labeled worlds. [fractal.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/fractal.ts>), [fractal-julia.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/fractal-julia.ts>) and [fractal-box.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/fractal-box.ts>) contain real recursive folds/iterations and careful filtering. The weakness is framing and movement, not a lack of a legitimate fractal formula. The Mandelbox camera looks toward an enclosure from outside; small periodic yaw/pitch changes do not create a journey through a world.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/fractal-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Construction | Plan |
| --- | --- |
| Kaleidoscope / Lace | Fewer legible recursion levels, a dominant ring and a timed reveal. |
| Kaleidoscope / Petals | Let selected scales unfold sequentially; preserve a simple silhouette. |
| Kaleidoscope / Weave | Reduce central density; make several large interlocks readable before microstructure. |
| Julia / Classic | Curate interesting parameter neighborhoods and frame one feature closely; avoid uncontrolled coefficient excursions. |
| Julia / Radial | Separate symmetry reveal from Julia evolution; use a staged circular composition. |
| Julia / Spiral | Follow a stable branch with a controlled camera path rather than morphing every detail. |
| Mandelbox / Architecture | Author a camera path with a readable foreground, middle distance and destination. |
| Mandelbox / Sphere Fold | Use light and material separation to expose smooth fold cavities. |
| Mandelbox / Lattice | Prioritize large voids and connected architecture; reduce distracting fine recursion. |

## Comparison and reference lessons

Commercial comparison: [Julius Horsthuis — BlueSpace](https://resolume.com/footage/BlueSpace) and [Julius Horsthuis — ConsciousCoral](https://resolume.com/footage/ConsciousCoral) provide environment and lighting references; their production performance is not a real-time target. TouchDesigner: [tekt — RayTK volumetric sampling](https://derivative.ca/community-post/tutorial/raytk-v014-volumetric-sampling-tutorial/64950) gives a field/SDF workflow, and [TouchDesigner — PBR MAT](https://derivative.ca/UserGuide/PBR_MAT) emphasizes a scene around material. MadMapper: [MadMapper Twisted Menger](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Twisted%20Menger/Twisted%20Menger.fs) supplies a real recursive distance-field comparison; [MadMapper Fractal Petri Dish](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Fractal%20Petri%20Dish/Fractal%20Petri%20Dish.fs) is a different analytic treatment, not chemical growth. Geometric formula variety alone will not reproduce an authored film.

## Proposed authored target

**Lattice passage** uses one restrained camera move toward a large opening, with two clearly separated light zones. **Julia coastline** studies one boundary at a scale where filaments survive projection. **Folded medallion** opens three recursion bands in sequence over black. Do not combine the three into a single generic Fractal world preset.

## Implementation sequence

1. Split the authoring interface into Ornament, Julia Study and Spatial Fractal workflows; keep saved styles intact.
2. Add explicit camera position/target or a short spline path for the 3D mode. Audit estimator bounds and near-surface stepping before permitting inside/near-field views.
3. Introduce measured depth/fog and a light rig in the 3D path; in 2D, provide artist-selected regions, scale-aware detail and independent reveal masks.
4. Develop a few safe coefficient/path studies, then verify temporal aliasing during the actual move; do not add arbitrary random Julia paths as the main improvement.

## Controls, timing and mapping

Use focal scale, recursion visibility, path distance, camera banking, light contrast and reveal progression. Reversible paths or closed routes can loop; a long cinematic flight can be a finite clip. For mapping, output a stable viewpoint or intentionally lock a portal to a region. An arbitrary camera orbit is not audience-correct perspective.

## Proof required before broadening

Require a full camera-path clip and high-resolution stills at its nearest surfaces. Check normal stability, under-stepped holes, shading sparkle, silhouette alpha and the smallest intended feature after downsampling. Compare day/night art direction without changing geometry. Preserve exact seeking and resumed output for any baked path.

## Cost, risk and alternative

Near-field fractal traversal can multiply marching cost, and true deep zoom may hit float precision limits. Keep the current filtered 2D/isolated-object modes useful. A carefully bounded finite environment clip is more credible than promising unlimited real-time fractal worlds.
