# 08. Caustic Atlas

**Recommendation: replace the line-threshold look with a receiver-based light construction. Scope: M — new caustic source pass.**

4 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

All four presets render smooth bright closed lines and broad empty cells. The shapes are clean but closer to luminous contours than varied focused water light. In [instrument-shaders.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/instrument-shaders.ts>), Caustic Atlas sums a small wave Hessian, forms a determinant and thresholds its absolute value to make a ridge. RGB variants perturb this calculation slightly. It is an analytic focusing approximation, but it lacks an explicit ray-to-receiver map, receiver depth variation and a convincing range of focus intensity. The generic traveling domain changes the contours without resolving those missing cues.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/caustic-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Look | Plan |
| --- | --- |
| Pool at Midnight | Re-author as shallow, near-white focused light over broad darkness; preserve little spectral color. |
| Amber Lens | Derive amber from transmission/tint and light, not a uniformly colored contour. |
| Prism Rain | Use controlled dispersed foci with several scales; avoid rainbow outlines around every cell. |
| Lenticular Tide | Preserve its directional idea but add broad defocused light and concentrated cusps. |

## Comparison and reference lessons

MadMapper’s factory [MadMapper Caustics](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Caustics/Caustics.fs) is an inexpensive iterative texture; our current version should be judged against that baseline without pretending the factory shader is physical optics. Its [MadMapper Water](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Water/water.fs) contains a wave surface and view-dependent water treatment. For a more ambitious method, [Maxime Heckel — Caustics in WebGL](https://blog.maximeheckel.com/posts/caustics-in-webgl/) explains refracted rays onto a receiver, and [Evan Wallace — WebGL Water](https://madebyevan.com/webgl-water/) couples waves and caustics. TouchDesigner’s [TouchDesigner — Displace TOP](https://derivative.ca/UserGuide/Displace_TOP) / GLSL-style field workflow provides an equivalent way to prototype normal/refraction/receiver passes; no specific executed TouchDesigner caustic patch is claimed. Lake Heckaman’s private network was not available for inspection.

## Proposed authored target

**Shallow water light**—one coherent swell shifts a web of sharp cusps and broader washed areas. **Glass focus**—an asymmetric lens produces a moving concentrated patch, controlled by light angle and receiver distance. **Spectral edge**—dispersion appears mainly at selected high-curvature foci. First approve the neutral white-light study.

## Implementation sequence

1. Create an explicit smooth wave/lens normal field with a restrained spectrum of spatial scales and independently authored phases.
2. Map refracted rays to a receiver and estimate focused energy from area change or controlled splatting. Clamp/filter near-singular concentration without turning everything into the same-width line.
3. Add receiver distance and a useful receiver-height/region input. Use finite light size or bounded smoothing for defocus; introduce dispersion after the monochrome result works.
4. Calibrate brightness and sampling for both preview and export, then author the four distinct looks from scene parameters.

## Controls, timing and mapping

Expose source scale, wave steepness, light direction, receiver distance, focus softness and restrained dispersion. Moving waves should travel; geometry and light movement should be independent. A periodic height field plus a stateless receiver pass can form an analytic loop, provided sampling and all phases close. Generate a light overlay or use a registered receiving region; do not add fake shadows that contradict the receiving facade.

## Proof required before broadening

Require thin sharp cusps, broad soft regions and varying concentration in the same neutral-light frame. Check no flickering singularities during the entire loop, no fixed-width neon tracing at every boundary, stable integrated brightness across resolution and usable alpha on multiple backgrounds. Physical projector focus/black level still require venue review.

## Cost, risk and alternative

This is a good bounded flagship candidate: it can become substantially more convincing without full fluid simulation. If receiver optics proves too expensive, keep a clearly named Stylized caustic texture mode and judge its composition honestly.
