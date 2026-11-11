# 04. Oil Slides

**Recommendation: retain the optical pass; replace the repeated behavioral setup. Scope: L for a convincing liquid instrument.**

9 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

The nine looks mostly reuse the same pool arrangement and prominent lens, with palette and drag differences. This makes the family feel like one demonstration. [oil.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/oil.ts>) has a worthwhile separation of material fields, paint and optical cap. However, pools are a small fixed arrangement of analytic blobs, and contact reconstructs ten historical footprints. [oil-motion.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/oil-motion.ts>) supplies closed transforms and a short wake. There is no conserved oil volume or evolving immiscible interface. The dark cellular collar often dominates the supposedly liquid image.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/oil-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Existing treatment / look group | Plan |
| --- | --- |
| Acid Slide / Cellular Lift | Keep as legacy diagnostic looks; replace identical pool staging with separate authored fields. |
| Ink Drag / Pearl Ink | Give pigment a persistent transported trail with stretching, dilution and deposition. |
| Chromatic Slides / Cobalt Tide / Ember Glass | Rebuild composition before producing more palette variants. |
| Verdigris Slide / Lantern Glass | Preserve their restrained color/optical lessons; use them to compare the new material behavior. |

## Comparison and reference lessons

Physical reference: [Joshua Light Show — Present](https://www.joshualightshow.com/about-recent/joshua-light-show-present) places changing colored liquid and performance at the center. TouchDesigner: [Crystal Jow / IIHQ — Audio Reactive Analog Content](https://derivative.ca/community-post/tutorial/audio-reactive-analog-content-touchdesigner/63615) shows a practical mixed-media route; [TouchDesigner — Feedback TOP](https://derivative.ca/UserGuide/Feedback_TOP) explains actual memory. MadMapper: [MadMapper Oil Flow](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Oil%20Flow/Oil%20Flow.fs), [MadMapper Oil Edge](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Oil%20Edge/Oil%20Edge.fs) and [MadMapper Fractal Oil](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Fractal%20Oil/Fractal%20Oil.fs) are mostly analytic treatments despite their names; they are benchmarks for controllable graphics, not proof that our oil physics is close. [Evan Wallace — WebGL Water](https://madebyevan.com/webgl-water/) supports the value of coupling optical response to a changing surface.

## Proposed authored target

**Compressed cell**—one large colored chamber squeezes, necks and relaxes; **Pigment drag**—a lens pulls a persistent dark filament and leaves diluted color; **Liquid overlap**—two translucent color bodies move across each other, with thickness changing at their boundaries. Keep the projected light/transmission character; avoid making everything look like opaque glossy paint.

## Implementation sequence

1. Prototype two competing routes: a modest 2D multi-channel pigment/interface simulation, and original captured liquid source material with procedural optical control. Judge the images before committing to the solver.
2. If procedural wins, store velocity, pigment/thickness and interface state separately; implement bounded injection, advection, diffusion and loss. An artistic incompressible field is acceptable if described honestly; true immiscible dynamics is a higher scope.
3. Make pool/lens arrangement an authored scene with multiple sizes and tracks. Derive contact and refraction from the same changing surface, preserving the existing optical pass where possible.
4. Add fixed-tick cache/bake/replay behavior before exposing persistent simulation in native export. Keep live source changes separate from prepared state.

## Controls, timing and mapping

Useful controls: squeeze gesture, source placement, pigment concentration, interface tension surrogate, drag duration and transmitted light. Decouple lens movement from paint movement. Use a finite clip for genuinely evolving liquid unless a reviewed loop has been baked. A crossfade is an optional visible treatment, not a physical loop solution. Screen-space refraction can only refract a supplied underlay; alpha export cannot affect future layers.

## Proof required before broadening

Require visible transport and a history-dependent trail; a shape must deform, not just translate. Test ten seeds with controlled density, a quiet pool and a strongly stretched contact event. Review the complete movie for pattern repetition, dark collar dominance, interface smearing and clipping. Compare at least one original physical-liquid reference sample with attribution.

## Cost, risk and alternative

A full two-phase fluid solver is expensive and may be the wrong first product choice. A hybrid asset/procedural route can produce better images sooner but needs source provenance, media import and cache design. Do not add more meniscus sliders to the current fixed pool as the main quality strategy.
