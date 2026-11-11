# 17. Volumetric Veils

**Recommendation: retain ray integration; rebuild density structure and scene lighting. Scope: L for a convincing atmosphere; M for bounded procedural veils.**

4 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

The four presets are soft broad ribbons with obvious repeating bands, often filling the frame at one scale. They have some depth accumulation but little plume detail, breakup, self-shadow or spatial reference. [instrument-shaders.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/instrument-shaders.ts>) marches 24/40/64 depth samples through a sine-sheet density with 2D noise variation. It applies exponential view extinction and estimates illumination from one neighboring density sample. The scatter direction factor is effectively a global angular weight for the current fixed view/light construction, not a complete lighting integral. More ray steps reduce sampling bands but do not make the underlying density field more interesting.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/veils-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Look | Plan |
| --- | --- |
| Milk in Cobalt | Build a coherent injection/plume with a thick body, thin rolled edge and fading filaments, or rename as a procedural ribbon veil. |
| Rose Smoke | Introduce ascending/rolling motion and density loss; do not merely bend a periodic sheet. |
| Amber Veil | Keep a thin sculpted veil, with a clear free edge and light passing through its thickness. |
| Opalescent Smoke | Resolve density and light first; reserve opalescent coloring for a deliberate secondary art treatment. |

## Comparison and reference lessons

TouchDesigner: [NODE / Derivative — 3D Volumetrics in TouchDesigner](https://derivative.ca/community-post/tutorial/3d-volumetrics-touchdesigner-course-live-node-institute/63129) explicitly connects volumetrics to scene lighting; [tekt — RayTK volumetric sampling](https://derivative.ca/community-post/tutorial/raytk-v014-volumetric-sampling-tutorial/64950) supplies field/volume vocabulary. MadMapper’s [MadMapper DiffusedSmoke](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/DiffusedSmoke/DiffusedSmoke.fs) is a 2D noise texture, while [MadMapper Torus Fog](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Torus%20Fog/Torus%20Fog.fs) and [MadMapper Smoke Rings](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Smoke%20Rings/Smoke%20Rings.fs) use different spatial/marching constructions. Names alone do not establish simulation fidelity. [Tristan Gieler — FogAndDust](https://resolume.com/footage/FogAndDust) is a scene-atmosphere benchmark, and [PBRT — Volume Transmittance](https://pbr-book.org/4ed/Volume_Scattering/Transmittance) explains light-path attenuation. [Bridson, Hourihan & Nordenstam — Curl-Noise](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf) offers a procedural rolling field that can be used without a full 3D fluid solver.

## Proposed authored target

**Backlit plume**—one thick body curls, sheds finer edges and thins into darkness, with a clear lit side and self-shadowed side. **Architectural haze**—a narrow shaft of light crosses several depth layers, anchored by a known room/occluder. **Silk veil**—one intentionally smooth sheet carries a strong large-scale fold. Do not require every look to resemble smoke.

## Implementation sequence

1. Separate density construction from ray integration. Add a bounded 3D domain with a coherent macro shape, several controlled scales of erosion and a deliberate source/lifetime envelope.
2. Prototype a cheap secondary march or light-volume cache for self-shadow/transmittance. Define view/light directions consistently instead of using a global brightness factor as the principal scatter control.
3. Use blue-noise/stratified spatial sampling with deterministic phase behavior; add quality tiers, early exit and measured error/budget comparisons. Temporal accumulation must have explicit seek/export semantics if introduced.
4. Try advected volume/baked density only if the procedural plume cannot meet the approved motion. Keep original volume fields or licensed assets distinct from shader-only presets.

## Controls, timing and mapping

Expose plume/veil shape, source direction, body density, edge breakup, extinction and light placement. Density dynamics and lighting have separate controls. A procedural field sampled on a closed time path can loop; a simulated plume needs a bake/closure strategy or finite clip. Spatial occluder/depth inputs are more useful for mapping than generic fullscreen fog.

## Proof required before broadening

Require a clear macro silhouette, intermediate curls and fine edge detail, plus meaningful light-side/shadow-side contrast. Compare density-only and lit results. Check depth banding, noise swimming, alpha over bright/dark underlays and variation across quality/resolution. Verify the main form survives downsampling before raising sample counts. Judge depth illusion on a registered mock surface and later a projector.

## Cost, risk and alternative

A 3D simulation can be expensive in memory, cache size and render time. A bounded procedural volume with good light can be excellent and is the first candidate. Do not add a large volume solver to compensate for a weak composition, or use 64 samples as a proxy for high visual quality.
