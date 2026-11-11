# 09. Living Ink

**Recommendation: separate reaction patterns from ink transport; rebuild the evolving treatment. Scope: L — simulation and material direction.**

7 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

Seven presets include prepared reaction patterns, a translated loop and evolving chemistry. The prepared/loop images are dense, evenly distributed embossed worms. The evolving studies genuinely change, but start from a few small seeds and spread into broad pale coverage that loses internal contrast. [InstrumentRenderer.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/InstrumentRenderer.ts>) prepares Gray–Scott textures; [InkSimulation.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/InkSimulation.ts>) advances chemistry and an accumulating pigment channel on a 128–384 square grid. The displayed pigment mixes concentration and deposit. Filling a field is not enough to look like ink: injection, dilution, edge concentration and material transport need separate direction. The UI also retains a general help sentence claiming playback occurs without simulation warm-up, which no longer accurately describes the evolving mode.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/livingink-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Mode / looks | Plan |
| --- | --- |
| Prepared — Ivory Coral, Cobalt Fingerprints, Ember Cells, Porcelain Estuary | Keep as Reaction pattern studies; add spatial feed/kill and density composition before improving embossing. |
| Flowing loop — Tidal Pigment | Label the existing translated texture honestly; a new flowing-ink mode should deform transported pigment rather than slide a prepared pattern. |
| Evolving — Ink Estuary | Limit injection/deposit, preserve translucent fronts and quiet regions, and prevent loss of structure through indiscriminate accumulated coverage. |
| Evolving — Coral Development | Favor reaction-front differentiation with bounded pigment display; do not sell it as a branching coral mesh. |

## Comparison and reference lessons

[Karl Sims — Reaction-Diffusion](https://www.karlsims.com/rd.html) documents several chemical regimes and spatial style maps; they explain why one narrow parameter neighborhood yields similar worms. TouchDesigner: [Pao Olea — Reaction Diffusion 19.01](https://www.youtube.com/watch?v=NmJ5rPKxF-8) documents a multi-stage treatment, while [Crystal Jow / IIHQ — Painterly Feedback](https://derivative.ca/community-post/tutorial/painterly-feedback-effect-touchdesigner/71632) supplies a different feedback-material route. MadMapper: [MadMapper Runny Ink](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Runny%20Ink/Runny%20Ink.fs) and [MadMapper Fractal Petri Dish](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Fractal%20Petri%20Dish/Fractal%20Petri%20Dish.fs) have evocative names but different analytic mechanisms. Their diversity is useful; neither demonstrates a fluid ink solver. [Jeff Jones — Physarum transport networks](https://uwe-repository.worktribe.com/output/980579/characteristics-of-pattern-formation-and-evolution-in-approximations-of-physarum-transport-networks) is an optional network-forming alternative, not a required extra effect.

## Proposed authored target

Choose between two products: **Reaction garden**, with evolving spots, stripes and fronts controlled spatially; or **Ink in water**, with a finite injection forming tendrils, dilution and curl. They can share rendering utilities but should have separate identities. Initial ink target: a narrow dark injection, one large fold and fine fading filaments, leaving substantial clear space at the end.

## Implementation sequence

1. Make the two target mechanisms explicit. Preserve old modes and migrate their labels/help by mode; do not silently reinterpret saved artwork.
2. For Reaction garden, calibrate feed/kill maps, reaction/diffusion scale, seed arrangement and display transfer independently. Prevent pigment deposit from hiding the chemical detail; measure coverage across a whole clip.
3. For Ink in water, prototype a transported multi-channel dye field with bounded sources, diffusion/loss and a suitable velocity model. Try a curl field first; add a pressure solve only if the approved reference requires that interaction.
4. Keep simulation coordinates, time step and numerical resolution explicit. Add pre-roll/baking, durable cache identity and reconstruction costs to the delivery design before increasing grid size.

## Controls, timing and mapping

Reaction controls: regime, growth scale, seed regions and development rate. Ink controls: injection timing, concentration, viscosity/diffusion surrogate, flow and edge tint. Keep absorption/transmission separate from raised relief. Evolving scenes are finite clips; periodic forcing does not close their state. An approved baked loop may be added with a visible closure strategy. Boundary/emitter input should affect the field, not merely reveal a static pattern.

## Proof required before broadening

Review at 0, 2, 5, 10, 20 and 40 seconds. Require visible fine structure and controlled clear-space coverage throughout the chosen clip. Compare pigment-only, chemistry-only and combined display to locate saturation. Check resolution-dependent morphology, obstacle boundaries, seek/restart, preparation latency and consistent alpha. The test is not simply that pixels change.

## Cost, risk and alternative

A general fluid ink solver is a larger commitment than a reaction pattern instrument. The existing checkpoint machinery is useful, but better cache behavior will not repair weak art direction. Choose one material identity and one target movie before expanding the controls.
