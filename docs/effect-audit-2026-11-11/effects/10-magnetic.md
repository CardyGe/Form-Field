# 10. Magnetic Skin

**Recommendation: replace the peak geometry model; retain a legacy cellular-metal mode. Scope: L — new 3D surface construction.**

4 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

The four looks read as rounded cells, ringed bumps or beveled polygon skin. They do not show convincing sharp ferrofluid spikes rising from a continuous liquid body. [instrument-shaders.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/instrument-shaders.ts>) constructs a Voronoi-radius exponential field and a broad moving pull; it estimates a height normal and runs the common coat function. Increasing peakHeight steepens shading but does not create an occluding 3D spike silhouette. Iridescence and metallic color disguise that representation gap rather than fix it.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/magnetic-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Look | Plan |
| --- | --- |
| Pearl Magnet | Keep as a deliberate pearlescent cellular surface, with an honest identity. |
| Mercury Garden | Rebuild around sharp peaks and continuous valleys; render black/chrome against shaped lights. |
| Obsidian Tide | Make a traveling magnet pull peaks from a dark connected sheet, with delayed collapse. |
| Ferrofluid Ridges | Use coherent connected ridges as an alternate shape vocabulary; current polygon bevels remain legacy. |

## Comparison and reference lessons

[Sachiko Kodama + Minako Takeno — Protrude, Flow](https://www.sachikokodama.com/en/works/protrude-flow-installation/) and [Kodama — Protrude, Flow project account](https://www.kodama.hc.uec.ac.jp/project/protrude.html) establish the essential physical cues: pointed peaks, changing connected forms and attraction-driven movement. [HybridVisuals — FerroCious](https://resolume.com/footage/FerroCious) gives a commercial physical-material comparison. TouchDesigner’s [TouchDesigner — PBR MAT](https://derivative.ca/UserGuide/PBR_MAT) plus mesh/GLSL displacement is the construction baseline; an actual height mesh is required when silhouette and occlusion matter. MadMapper’s [MadMapper Crystalline Sphere](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Crystalline%20Sphere/Crystalline%20Sphere.fs) demonstrates normals/reflection/refraction on a 3D body, while [MadMapper ReliefNoise](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/ReliefNoise/ReliefNoise.fs) is just a tonal field. Neither should be described as a stock ferrofluid solver.

## Proposed authored target

**Black spike basin**—a continuous dark sheet grows a small cluster of narrow peaks under a moving field source; peaks tilt/rise and settle behind it. **Ridge sweep**—a coherent crease crosses the basin. **Pearl cells** survives as a separate stylized legacy material. Judge the new basin in neutral lighting before adding color or thin film.

## Implementation sequence

1. Prototype a displaced mesh or bounded heightfield ray intersection with controllable spike profiles and a continuous base surface. Compare silhouettes from an oblique camera.
2. Build the response from several explicit field sources, local spacing and a smooth field envelope. Use a damped response or authored delay; label it ferrofluid-inspired unless magnetohydrodynamics is actually solved.
3. Use coherent reflection cards/environment lighting, shadowing and energy-aware metal response. Add real occlusion between peaks; reserve iridescence for a separately chosen treatment.
4. Add field tracks and grouped rise/settle events, then validate camera/region registration and export reconstruction.

## Controls, timing and mapping

Expose magnet position/path, field strength, peak spacing, spike height, response delay and light-rig contrast. Separate body material from the magnetic event. A deterministic damped cycle may be baked or solved with periodic steady-state preparation; an analytic stylized response can loop if its boundaries are authored. Use projected silhouette and region interaction, not just a square filled with bumps.

## Proof required before broadening

Require a connected basin, pointed peaks and mutual occlusion in a neutral monochrome frame. A side/oblique view must still read as spikes. Review rise and collapse at several field strengths, plus highlight stability and minimum feature survival on a defocused/low-resolution preview. Compare against the physical reference for material cues, not exact geometry.

## Cost, risk and alternative

This cannot be fixed convincingly through palette, roughness or a larger Organic slider. A restrained 3D heightfield is the first plausible route; full magnetic-fluid physics is a separate research project. If that cost is rejected, rename/retain the current family as Cellular metal.
