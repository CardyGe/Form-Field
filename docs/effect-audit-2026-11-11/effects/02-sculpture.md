# 02. Sculpture

**Recommendation: retain the 3D foundation; rebuild motion direction and framing. Scope: M; optional growth solver is L.**

11 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

The mesh, normals, physical material, environment and shadow setup are a stronger base than most newer instruments. The 11 presets nevertheless share a centered product-shot presentation and restrained breathing, with several near-identical sampled silhouettes. [sculpture.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/sculpture.ts>) constructs shells/blooms from a deformed sphere and ribbons/knots from closed toroidal coordinates. A shared sine controls breathing and part of the opening. In [StudioRenderer.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/StudioRenderer.ts>), the object lives in a fixed scene. Surface detail does not supply new internal articulation.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/sculpture-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Form | Plan |
| --- | --- |
| Shell | Give the opening a clear origin and a delayed curl toward the free edge; retain asymmetry and controlled thickness. |
| Bloom | Animate petal groups and radial propagation, with a settled open state; avoid all lobes breathing in synchrony. |
| Ribbon | Give the object a readable tension path, a coherent moving fold and occasional broad silhouette changes. |
| Knot | Keep topology stable; use traveling curvature and changing light to explain the knot rather than swelling the whole object. |

## Comparison and reference lessons

TouchDesigner: [TouchDesigner curriculum — Basics of Instancing](https://learn.derivative.ca/courses/200-intermediate/lessons/201-converting-data-types-and-instancing/topic/basics-of-instancing/) and [Pao Olea — Instancing Sine Cos [33]](https://derivative.ca/community-post/tutorial/instancing-sine-cos-touchdesigner-tutorial-33/75458) demonstrate per-element relationships, while [TouchDesigner — PBR MAT](https://derivative.ca/UserGuide/PBR_MAT) supplies material/lighting vocabulary. MadMapper: [MadMapper Raymarched Polyhedrons](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Raymarched%20Polyhedrons/Raymarched%20Polyhedrons.fs) and [MadMapper RaymarchedNoodles](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/RaymarchedNoodles/RaymarchedNoodles.fs) are useful depth/shape constructions, not equivalent cloth. Generative reference: [Nervous System — Floraform](https://n-e-r-v-o-u-s.com/projects/floraform/) shows how growth can alter the surface itself. Our proposed bend/growth deformation is an artistic model unless an actual elastic solver is implemented.

## Proposed authored target

**Opening shell** starts tightly curled, opens along a diagonal, then holds under a moving light. **Sequential corolla** reveals petal groups in a traveling ring. **Tension ribbon** passes one large fold around a loop while its center of mass remains composed. Begin with one close, off-center camera composition rather than more thumbnail-sized objects.

## Implementation sequence

1. Extract a sculpture scene/controller from StudioRenderer.ts so camera, object deformation and lighting can be directed separately while sharing the existing compositor.
2. Add source-space deformation masks and several phase groups; propagate opening/curl over the mesh with well-defined local axes.
3. Author a small set of studio-light rigs and material-specific responses: satin, ceramic and metal should not differ only in color and metallic amount.
4. Try a growth/constraint prototype only if the procedural opening cannot reach the approved silhouette. Retain topology and collision checks as separate concerns.

## Controls, timing and mapping

Expose opening progression, propagation delay, fold travel, local stiffness surrogate, camera framing and light sweep. Label artistic stiffness as a shape control unless it drives mechanics. Closed parametric deformations can remain analytic loops. Actual growth is a finite clip or a baked, reviewed cycle; it does not become seamless merely because its forcing is periodic. Relate the silhouette to a selected opening/region when used in mapping.

## Proof required before broadening

Review side and front views of all four forms for self-intersection, collapsed normals and thickness. Require a silhouette-only movie that communicates the intended action before adding iridescence. Judge detail at 1080p and at the intended projector size. A lighting-only loop is valid if chosen deliberately, but it must be labeled that way.

## Cost, risk and alternative

The first motion/framing upgrade fits the existing 3D engine. Full differential growth, cloth and self-collision add much larger state/export requirements. An authored procedural mesh with excellent lighting is the preferred first proof; a solver is an alternative, not a prerequisite for quality.
