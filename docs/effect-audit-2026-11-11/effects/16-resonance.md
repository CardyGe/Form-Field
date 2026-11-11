# 16. Resonant Sand

**Recommendation: retain the nodal field; add actual grain organization and mode events. Scope: M/L — particle response and temporal direction.**

4 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

The four looks are smooth pale nodal ribbons with fine static noise. Their identity overlaps Living Ink and Caustic Atlas more than their names imply. [instrument-shaders.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/instrument-shaders.ts>) mixes separable trigonometric modes, optional radial/harmonic terms, thresholds the resulting field, then modulates brightness with a hashed grain value. No grains move or settle. A changing nodal mask is a useful graphic figure, but it cannot show the migration, temporary disorder and accumulation that make sand compelling.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/resonance-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Look | Plan |
| --- | --- |
| Salt Mandala | Use individual grains accumulating near selected nodes, with clear empty plate between them. |
| Copper Modes | Author a switch between two modal targets: grains disperse, migrate and settle. |
| Midnight Membrane | Choose a visibly deforming illuminated membrane as a separate presentation, not a sand texture with more relief. |
| Orbital Cymatics | Keep as an artistic circular-mode study; do not imply those equations solve arbitrary physical plates. |

## Comparison and reference lessons

TouchDesigner: [Aristides.Lab — WaveField TOX](https://derivative.ca/community-post/tutorial/wavefield-tox-pops-without-hassle/74758) provides multiple point/mesh wave constructions including Chladni modes, and [TouchDesigner — Particle POP](https://derivative.ca/UserGuide/Particle_POP) provides stateful particle behavior. These capabilities do not automatically simulate real granular sand. MadMapper’s [MadMapper Wave Synth](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Wave%20Synth/waveform_synth.fs), [MadMapper Dunes](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Dunes/NOISE_Dunes.fs) and [MadMapper Particles](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Factory/Particles/Particles.fs) are distinct wave/graphic baselines, none a Chladni sand solver. [Pao Olea — Instancing Sine Cos [33]](https://derivative.ca/community-post/tutorial/instancing-sine-cos-touchdesigner-tutorial-33/75458) is also relevant: elegant relationships can come from a few waves when the object and score are designed. The scientific language should remain limited to what the model implements.

## Proposed authored target

**Modal transfer**—a stable sand figure breaks up, grains move across the plate, then collect into a second figure and rest. **Sparse resonance**—a few bright grains trace a changing vibration field over darkness. **Membrane study**—a lit surface explains the driving mode beneath an optional grain layer. Movement toward a new configuration is the main event.

## Implementation sequence

1. Keep the current nodal field as a cheap Graphic modes option. Define the grain response as a documented artistic approximation to local field amplitude/gradient, with deterministic forcing.
2. Simulate or reconstruct particles with mass/drag-like response, jitter, finite grain sizes and accumulation near nodes. Prevent unlimited clustering and make plate boundaries explicit.
3. Separate target-mode timing from grain response. Add a disorder/settle phase and a held configuration; use a small authored event track.
4. Render grains with size-aware coverage, selective highlights and optional membrane depth. Add checkpoints/bake only if stateful integration is selected.

## Controls, timing and mapping

Expose modal target, excitation, grain amount/size, migration response, settling and plate shape. Keep frequency/mode semantics honest; there is no live audio analysis in the current product. A finite transfer clip is straightforward. A loop needs an explicit reset/transfer sequence or periodic state preparation, not just sine-blended equations. Use a mapped plate/region whose boundary makes the organization readable.

## Proof required before broadening

Require identifiable grains away from and at nodes, migration over time, and a genuine settled interval. Show field-only, particles-only and combined movies. Check mode transitions, boundary escapes, seed repeatability, excessively dense nodes and particle survival after downsampling. A smooth animated line pattern does not pass a sand-material acceptance test.

## Cost, risk and alternative

An artistic particle response can be substantially cheaper than accurate vibrating-plate/granular physics. Do not over-scope physical correctness unless required. The low-cost alternative is to rename the existing effect Resonance figures and make its graphic motion excellent.
