# 06. Graphic Patterns

**Recommendation: retain layout/rendering; replace synchronized motion with designed relationships. Scope: M — high return with limited renderer risk.**

32 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

The 32 presets cover 26 named variants. The layout and SDF glyph system in [graphic-layout.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/graphic-layout.ts>) and [GraphicRenderer.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/GraphicRenderer.ts>) is useful: seeded packing, path generation and real motif repetition are worth preserving. Most motion still derives from a global sine, shared radial index or a single draw-progress value. All circuit paths open and close together; most tile fields use one passing pulse. The color gradients and constant full-frame density make several different families feel like generic screensavers.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/graphic-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Family / variants | Per-variant direction |
| --- | --- |
| Pillars — Wave | Compose several large groups with delayed response, not a single waveform across every bar. |
| Uneven pillars | Keep widths; add meaningful group/weight differences and rests. |
| Lava columns | Use merging silhouettes or rename as rounded bars; current geometry is not lava. |
| Fine bars | Build sparse bands and controlled interference; enforce a projection-width floor. |
| Warm curtains | Choreograph opening/closing in sections and preserve a large quiet opening. |
| Green tide | Add a coherent crest and recovery rather than a palette variant of Wave. |
| Circle blooms — Concentric halo | Give rings clear gaps/weights; current stack often reads as a simple radial gradient. |
| Orbital bloom | Control one evolving flower silhouette and its hold, not near-uniform disk overlap. |
| Counter-rotating fans | Make two systems and their interaction readable at different speeds/scales. |
| Packed tiles — Mosaic | Introduce selected macroblocks and color proportions; retain packing. |
| Hollow frames | Sequence frames by region and depth/line weight, maintaining deliberate darkness. |
| Nested contours | Allocate contour detail to selected cells; reduce equal treatment everywhere. |
| Travelling morph | Move a clear transformation front across a region graph, with a settled aftermath. |
| Spiral — Beaded | Use varied bead groups, draw order and line-weight hierarchy. |
| Polygon tunnel | Offer a graphic contour tunnel separately from a true perspective room. |
| Woven vortex | Add readable over/under groups or call it overlapping polygons. |
| Web rosette | Protect a large quiet center and emphasize a few bands. |
| Line interference | Design interference with adjustable scale relationships and a safe detail limit. |
| Coiling ribbon | Build a coherent ribbon boundary; repeated polygons can remain the cheaper style. |
| Particle rays | Add staggered radial packets and gaps; call these glyphs unless actually transported. |
| Disc mandala | Give alternating groups distinct actions and timing. |
| Monochrome vortex | Retain as a strong graphic option; reduce accidental fine striping and author scale changes. |
| Circuits — Worms | Separate births, pulses and draw progression by path. |
| Directional channels | Send packets along a stable graph instead of revealing all lines together. |
| Mirrored carpet | Keep intentional symmetry; animate region-level events independently. |
| Radial core | Make the core affect path flow/timing; an empty ring alone is not an attractor simulation. |

## Comparison and reference lessons

TouchDesigner: [Pao Olea — Instancing Sine Cos [33]](https://derivative.ca/community-post/tutorial/instancing-sine-cos-touchdesigner-tutorial-33/75458), [vtln — Rolling Tiles](https://derivative.ca/community-post/tutorial/rolling-tiles-using-pops-chops-and-dats/75531) and [reflekkt — Chaser mapping tutorial](https://derivative.ca/community-post/tutorial/chaser-effect-projection-mapping-tutorial/71750) demonstrate different relationships between elements and time. MadMapper: [MadMapper Line Pattern Pro](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Line%20Pattern%20Pro/Line%20Pattern%20Pro.fs), [MadMapper Shapes](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Shapes/Shapes.fs) and [MadMapper Wave Synth](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Wave%20Synth/waveform_synth.fs) are useful control/design baselines. [KRATATA — AchromaticHiss](https://resolume.com/footage/AchromaticHiss) is on the current retailer Top 12 and its sampled preview shows that restrained repeating geometry can still have spatial depth and rhythm; [Visual Lab — InternalCircuitry](https://resolume.com/footage/InternalCircuitry) is a second current graphic benchmark. [Tyler Hobbs — Fidenza algorithm account](https://www.tylerxhobbs.com/words/fidenza) supplies a precise lesson in weighted color and spacing, not a style to clone.

## Proposed authored target

**Architectural score**—a few macroblocks hold while a narrow chase crosses secondary cells. **Signal garden**—three differently timed pulses move through stable routes and meet at a hub. **Optical counterpoint**—two simple monochrome systems produce intentional interference and then settle. Start with Signal garden; it addresses the clearest shared-motion weakness without changing the layout engine.

## Implementation sequence

1. Give tiles, rings and paths stable attributes: region/group, event offset, size class and color role. Keep geometry identity independent of frame order.
2. Separate structure from activity. Add path-distance sampling for moving packets, and group envelopes for holds, chases and transformations.
3. Replace automatic full-palette interpolation with selected flat colors, weighted assignment and optional gradients. Author negative-space rules at composition scale.
4. Add a small region-to-group mapping bridge, then curate the existing 26 variants; demote duplicates rather than increasing the preset count.

## Controls, timing and mapping

Expose grouping, activity density, event stagger, pulse speed, motif weight and color proportions. Use seconds or beat-normalized events with explicit loop scheduling. Shared sine motion remains available when intentional. Keep contour/line scale tied to output and intended physical detail; provide user-set limits rather than a universal pixel claim.

## Proof required before broadening

For each animated variant study, show a monochrome movie and an activity-only overlay. At least three states must differ in structure/activity, not just hue; deliberately static utility presets are exempt. Test all paths at pulse joins, transforms and repeat boundaries, and verify that a change in view does not reseed geometry. Judge complex patterns after downsampling and mild blur, then on the projector.

## Cost, risk and alternative

This can improve rapidly because the layout engine is already good. The main cost is authoring relationships and curating presets. A node editor, full particle solver or all-new renderer is unnecessary for the first proof.
