# 05. Super 8 Paint

**Recommendation: retain film transport; redesign marks and temporal composition. Scope: M; original scanned media is an optional addition.**

6 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

This family already has more character: stepped color, dry edges, collage and a separate projector treatment. The six looks are still built from a narrow set of repeated swathes, staircases and seven procedural paper pieces. [super8.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/super8.ts>) reconstructs six historical paint samples, while [super8-motion.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/super8-motion.ts>) uses a held film clock and deterministic transport. These are bounded echoes rather than an indefinitely evolving video feedback system. The result needs authored marks and phrase structure more than extra dust and gate effects.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/super8-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Mode | Plan |
| --- | --- |
| Chromatic Staircase | Add interruptions, selective erasure and changes in mark scale; preserve deliberate geometric rhythm. |
| Paint Destruction | Give a stroke a lifetime: wet arrival, directional drag, dry breakup and disappearance. |
| Scratched Negative | Put coherent engraving and sparse scratches into the image; make scratches a compositional action rather than uniform decoration. |
| Cut-out Collage | Introduce pivoted paper pieces with independent hold/release and meaningful overlap, rather than continuous wobble. |

## Comparison and reference lessons

Direct-film references: [NFB — Begone Dull Care, McLaren and Lambart](https://collection.nfb.ca/film/begone_dull_care) and [Ngā Taonga — A Colour Box, Len Lye](https://www.ngataonga.org.nz/search-use-collection/search/F9061/) are about marks and rhythm, not merely an aged film border. [NFB — McLaren technical notes](https://www3.nfb.ca/archives_mclaren/notech/NT_EN.pdf) offers primary process evidence. TouchDesigner: [Crystal Jow / IIHQ — Painterly Feedback](https://derivative.ca/community-post/tutorial/painterly-feedback-effect-touchdesigner/71632) and [Crystal Jow / IIHQ — Audio Reactive Analog Content](https://derivative.ca/community-post/tutorial/audio-reactive-analog-content-touchdesigner/63615) separate source material from feedback and performance. MadMapper: [MadMapper Feedback Grid](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Feedback%20Grid/Feedback%20Grid.fs) actually samples previous state; [MadMapper Runny Ink](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Runny%20Ink/Runny%20Ink.fs) is analytic deformation. Commercial comparison: [Dan Chelger — FeedboxAbstract](https://resolume.com/footage/FeedboxAbstract) explicitly describes an artist-built analog feedback system. These should not be conflated under one Feedback slider.

## Proposed authored target

**Painted phrase**—one broad stroke arrives, fractures into fine scratched marks, then clears to a quiet frame. **Paper exchange**—three pieces hold, pivot, overlap and give way to another arrangement. **Engraved pulse**—sparse bright lines answer broader negative shapes. Keep the emulsion/gate optional so the paint itself can be judged.

## Implementation sequence

1. Separate mark generation, mark timing and projector/film treatment. Preserve the existing held-frame clock and native deterministic path.
2. Add a small grammar of strokes, smears, scratches and cutouts with persistent IDs, spatial scale and controlled lifetimes. Permit original scanned mark atlases when the media path is ready.
3. Author event tracks that change scale, coverage and density across a phrase. Build several mark histories rather than rendering every frame as the same staircase.
4. If true recursive feedback is chosen, give it fixed ticks, reset/pre-roll, cache identity and reproducible export; otherwise label the existing mechanism as Echo history.

## Controls, timing and mapping

Expose stroke scale, phrase progression, erosion direction, mark persistence, paper movement and film treatment. Keep paint FPS distinct from output FPS. A scratched/held-frame style can intentionally jump; smoothness is not the only quality criterion. Design repeated musical phrases with a deliberate join, or export finite gestures. Mapping regions should receive whole gestures or coordinated subsets, not slices of arbitrary film borders.

## Proof required before broadening

Review the movie once with all film damage disabled and once with it enabled. The first must already be expressive. Check gate edges, shutter aliasing at chosen output rates, scratch persistence, repeated motifs and a clean alpha overlay over both black and white. Do not make a historical 35mm direct-film reference into a claim of authentic Super 8 mechanics.

## Cost, risk and alternative

This is a strong candidate for a focused improvement without a new renderer. Scanned marks improve source richness only if we author or license them and organize them carefully. The alternative is a clean procedural graphic-film instrument with fewer, better gestures.
