# 15. Prism Cathedral

**Recommendation: replace nested 2D outlines with a coherent optical space. Scope: L — 3D scene and optics; bounded quality first.**

4 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

All four looks are nested rounded quadrilateral bands. The helical preset changes their relative rotation, but there is little architectural structure or optical room. [instrument-shaders.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/instrument-shaders.ts>) folds a 2D domain, draws repeated analytic arch bands, creates a local bevel normal and applies palette-based highlights. Mirror finish changes a shading coefficient; it does not ray-reflect a rendered room. Glass dispersion changes a color treatment; it does not trace transmitted scene geometry. The inspector sentence saying mirrors contain the rendered room overstates this implementation and should be corrected when the direction is chosen.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/prism-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Look | Plan |
| --- | --- |
| Smoked Glass Vault | Model a small glass/metal room with a convincing dark interior and distinct openings. |
| Amber Arcade | Build an architectural sequence with a common perspective and controlled transmitted/tinted light. |
| Porcelain Infinity | Use opaque ceramic frames, real shadows and depth falloff; it does not need glass optics. |
| Helical Arcade | Rotate real sections along depth, with occlusion and a deliberate camera/light move. |

## Comparison and reference lessons

Projection references [Bot & Dolly — Box, Ian Sherman production account](https://www.ianjsherman.com/work/box/) and [DJVB — BoxMappingToolkit](https://resolume.com/footage/BoxMappingToolkit) make spatial consistency central. TouchDesigner: [IIHQ — 3D Stained Glass](https://derivative.ca/community-post/tutorial/3d-stained-glass-touchdesigner/68782) uses geometry, HDRI and PBR, and [tekt — RayTK volumetric sampling](https://derivative.ca/community-post/tutorial/raytk-v014-volumetric-sampling-tutorial/64950) provides an SDF/reflective workflow. MadMapper’s [MadMapper Raymarching Template](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Raymarching%20Template/Raymarching%20Template.fs) offers actual intersection/normal/shadow logic; [MadMapper Voronoi Glass Panes](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Voronoi%20Glass%20Panes/Voronoi%20Glass%20Panes.fs) and [MadMapper Crystalline Sphere](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Crystalline%20Sphere/Crystalline%20Sphere.fs) include real ray/refraction operations. Our current shader is much closer to a stylized nested-line material than those optical constructions.

## Proposed authored target

**Porcelain passage**—a few thick frames reveal a lit room beyond, with strong foreground/midground separation. **Smoked chamber**—one reflective interior with a limited glass element produces recognizable reflections. **Helical opening**—depth sections slowly twist around a stationary vanishing point. First prove the opaque passage so geometry and lighting can be judged without optical complexity.

## Implementation sequence

1. Create a shared-camera mesh or bounded SDF scene with architectural cross-sections, floor/side references and explicit depth spacing. Keep the old shader as Graphic vault.
2. Implement a light rig, occlusion/shadows and a controlled camera path. Test perspective with a chosen mock surface/audience view.
3. Add a single-bounce reflection or environment reflection with a clearly stated approximation. For transmission, render a known scene/underlay and use a bounded refraction method; do not relabel generic color variation as dispersion.
4. Add optical sampling quality/bake options only after the geometry proof succeeds. Keep preview/export paths aligned and correct misleading help text by construction mode.

## Controls, timing and mapping

Expose room proportions, frame thickness, depth spacing, camera/vanishing point, light travel and material identity. Material presets should distinguish porcelain, metal and glass. A stationary room with a closed light cycle is a viable loop; a camera flight may be finite. The media assumes a virtual view; real audience/projector calibration requires external mapping setup. Exported alpha cannot refract layers composited later.

## Proof required before broadening

Require actual T-junctions/occlusion, consistent perspective, cast shadows and readable thickness in a neutral frame. A reflection must respond coherently to the scene it claims to reflect. Test thin frames, corner aliasing, optical noise, depth ordering, transparency and loop joins. Review from the assumed audience position in a mock-up and eventually on site.

## Cost, risk and alternative

General multi-bounce glass is too broad for a first rewrite. An excellent opaque architectural passage is a credible first milestone. Baked optical studies are a valid higher-quality option if a live solution cannot meet the visual target within the measured budget.
