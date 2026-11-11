# 07. Image / imported media

**Recommendation: retain still compositing; extend it into a deliberate source/input workflow. Scope: M for field inputs; L for moving-media ingest.**

Imported image path reviewed with a generated diagnostic fixture. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

This is a static PNG/JPEG layer with fit, mirror, repeat, transform and grading, not a generator. [StudioRenderer.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/StudioRenderer.ts>) loads assets with texture filtering and [shaders.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/shaders.ts>) samples/composites them. It cannot currently supply a selected image as a general displacement, color, emission or height input to other families. The optional imported mask/surface path on the newer instruments is narrower than that. The local fixture verifies what this path looks like; it does not establish support for arbitrary video, HDR image formats or textured 3D assets.

Fresh evidence: [generated image fixture](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/image-fixture.png>) and [fixture project](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/image-fixture.formfield>).

## Branch-by-branch plan

| Path | Plan |
| --- | --- |
| Contain / cover | Keep predictable framing; expose crop/focal placement and an explicit input-space preview. |
| Mirror / repeat | Keep as compositing tools; do not market a mirrored image as new generative structure. |
| Grading / masks | Retain shared color/alpha behavior; make color data and mask/field data distinct inputs. |
| Proposed field source | Let an image explicitly drive color, emission, displacement or height in selected effects. |
| Proposed moving media | Add deterministic video/image-sequence ingest only if the hybrid direction is selected. |

## Comparison and reference lessons

[Quayola — Strata #1](https://quayola.com/strata-1/) is a strong example of abstraction derived from source composition rather than an unrelated effect placed on top. TouchDesigner’s [TouchDesigner — Displace TOP](https://derivative.ca/UserGuide/Displace_TOP) and [reflekkt — Chaser mapping tutorial](https://derivative.ca/community-post/tutorial/chaser-effect-projection-mapping-tutorial/71750) show different roles for source imagery and masks. [Crystal Jow / IIHQ — Audio Reactive Analog Content](https://derivative.ca/community-post/tutorial/audio-reactive-analog-content-touchdesigner/63615) demonstrates why original physical materials can be useful inputs. MadMapper’s [MadMapper — custom GLSL materials](https://docs.madmapper.com/madmapper/6/3.-media/writing-custom-glsl-materials) and [MadMapper — material extension specification](https://raw.githubusercontent.com/madmappersoftware/MadMapper-Materials/main/MaterialsDoc.md) describe texture-backed material inputs and host-specific conventions; this is a workflow comparison, not automatic interoperability.

## Proposed authored target

**Image into material**—an original drawing defines where pigment starts and where it stops. **Architectural score**—named regions from a source image receive distinct timed events. **Original analog plate**—a user-supplied texture retains its material variation while a controlled procedural treatment changes it. These are more productive input roles than adding another mirror mode.

## Implementation sequence

1. Introduce an asset record with role, dimensions, content hash, color interpretation and framing. Reuse the existing loader; avoid embedding the same large asset repeatedly in every layer setting.
2. Start with explicit color/emission/height inputs for one approved effect. Store field data in a non-color path; do not apply display gamma to simulation values.
3. Add region IDs and a registration preview so image-driven behavior aligns to the intended media canvas. Keep mask coverage separate from force/obstacle interpretation.
4. If moving-media import is chosen, specify frame indexing, rational-rate resampling, decode/cache, alpha and resume behavior before implementation. A native or predecoded sequence path must feed the same compositor.

## Controls, timing and mapping

Primary controls: role, crop/focal point, field strength, threshold/softness and source timing. Still-image transforms can loop analytically. Video loops must respect actual frame duration and source boundary behavior. Keep field coordinates explicit so an input used for emission is not accidentally clipped at output. Mapping calibration remains external.

## Proof required before broadening

Use original fixture images with known ramps, thin lines, transparency, an off-center focal point and portrait dimensions. Check contain/cover, edge alpha, repeated boundaries, mask gamma and deterministic asset identity. A future video proof must survive seek, cancellation/restart and differing source/output rates without a new color/alpha path.

## Cost, risk and alternative

Useful field input is a bounded change; a broad media browser/video subsystem is much larger. Prioritize it only with a scene that needs it. This path also enables a hybrid approach when a small procedural shader cannot achieve a convincing material.
