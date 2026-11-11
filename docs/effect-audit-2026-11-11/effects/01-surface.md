# 01. Surface

**Recommendation: retain the graphic engine; redesign composition and movement. Scope: M — focused renderer redesign.**

17 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

The 17 looks cover 12 branches, but most read as continuously moving stripes, concentric bands or glossy columns. The saturated defaults amplify the repetition. Tidal Silk is more restrained, yet the forms still share a narrow wave vocabulary. In [surface.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/surface.ts>), palette bands are derived from scalar coordinates, with derivative-based bevel lighting. The domain combines a few noise scales and a closed circular time sample. This is a capable graphic field, but it has no transported pigment, interacting ribbons or independent events. Adding generic organic motion would not change that construction.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/surface-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Existing branch | Specific next treatment |
| --- | --- |
| Bands / Flow | Keep flat-color bands; introduce selected broad channels and quiet regions instead of equal density everywhere. |
| Bands / Braids | Give each ribbon persistent identity, width and a deliberate over/under sequence; retain the current cheap mode. |
| Bands / Ribbons | Sweep actual ribbon curves when silhouette/overlap is the objective; otherwise label it a patterned field. |
| Contours / Terrace | Use a curated height map or authored scalar landscape; light terraces coherently rather than shading every color boundary alike. |
| Contours / Ripples | Use two or three positioned sources with spreading fronts and phase relationships. |
| Contours / Vortex | Organize one readable vortex and secondary motion; control winding independently from palette drift. |
| Drips / Melt | Detach selected drops, pause at necks and merge at a receiving pool. A tip moving up and down is insufficient. |
| Drips / Beads | Add varied spacing, collision-aware grouping and staggered release; preserve a clean graphic option. |
| Drips / Strands | Add tapered free ends and independent travel/recovery; avoid identical endless columns. |
| Fusion / Portal | Anchor an opening to a surface region, with a clear reveal and separate interior motion. |
| Fusion / Twin Portals | Design interaction between openings, not duplicate the same field twice. |
| Fusion / Lens | Distort a real selected underlay through the lens; disclose the limit of an exported RGBA overlay. |

## Comparison and reference lessons

TouchDesigner: [Crystal Jow / IIHQ — Jen Stark-inspired colour drip](https://derivative.ca/community-post/tutorial/jen-stark-inspired-colour-drip-effect-touchdesigner/71765) uses feedback/displacement, a useful comparison for evolving edges; [TouchDesigner — Noise TOP](https://derivative.ca/UserGuide/Noise_TOP) separates noise construction from its coordinates. MadMapper: [MadMapper MadNoise](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/MadNoise/MadNoise.fs) offers multiple domain/remap treatments; [MadMapper Line Pattern Pro](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Line%20Pattern%20Pro/Line%20Pattern%20Pro.fs) varies attributes per cell. Projection reference: [Universal Everything — Living Mural](https://www.universaleverything.com/design/sydney-opera-house-living-mural) suggests distinct verbs and surface-shaped compositions. These references support richer organization; they do not make complexity mandatory.

## Proposed authored target

Three original studies: **Contour quarry**—one broad ridge traverses a dark landscape; **Ribbon exchange**—three differently sized bands pass over/under one another; **Slow spill**—a neck stretches, a drop detaches, a pool receives it. Agree one of these before implementing all twelve branches.

## Implementation sequence

1. Separate domain, motif, color allocation and lighting in surface.ts without changing old saved looks. Add a new construction/version choice rather than silently replacing the old shader.
2. Prototype Contour quarry with an authored scalar field, large-scale composition mask and sparse secondary contour detail. Keep flat graphic color as an intentional material.
3. For braids/strands, prototype curve-swept ribbons with depth ordering; do not reuse a height normal to claim actual overlap. For drips, use tracked shapes or a modest 2D liquid approximation only if the approved target needs splitting.
4. Add independent event envelopes and spatial phase groups in the timeline; author presets after the target movie works.

## Controls, timing and mapping

Primary controls: motif width, spacing distribution, focal region, travel direction, event spacing and color allocation. Keep geometry motion separate from palette travel. Offer deliberate continuous travel or attack/hold/release, rather than requiring every feature to oscillate together. Export fixed-camera media with region boundaries; calibration stays in the mapping host.

## Proof required before broadening

A 20-second study must contain three distinguishable states without relying on hue changes. Check joins at the intended pixel density, portrait framing, the loop boundary and whether the main silhouette survives a half-resolution preview. Review a monochrome version first. Preserve the existing 12 branches as legacy choices until replacements are accepted.

## Cost, risk and alternative

M for field composition; L if detached/merging liquid is required. The low-cost alternative is an excellent flat graphic family with honest names. Do not turn every branch into an expensive simulator.
