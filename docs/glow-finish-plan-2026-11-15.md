# Form & Field: Glow finish design

15 November 2026 · branch `liquid-scope` · status: awaiting approval

## 1. Intent

A per-layer **Glow** finish: the bright parts of a layer spill soft light around themselves, like projected light blooming on a wall or in a lens. It is for the layers that have no glow of their own today: Liquid Light, Oil Slides, Surface, Sculpture, Fractal, Super 8, images and the instruments.

**Goals**

- One layer can glow while its neighbours stay crisp.
- Off by default and exactly neutral, so existing projects render unchanged.
- The glow looks the same in the preview, a 4K export and a supersampled export.
- Loops close exactly, with no warm-up.
- The glow survives transparent export.

**Non-goals**

- A whole-picture glow under Output.
- Replacing the Oscilloscope's own bloom, or the small halo Fractal and Sculpture already have (`uGlow` in `shaders.ts`).
- Lens extras: streaks, flares, anamorphic stretch, separate halation.

**Anti-goals**

- Glow that feeds back into the Feedback echo and builds up without limit.
- A glow whose width changes with export size.

## 2. Approaches

| Approach | Trade-off | Decision |
| --- | --- | --- |
| **Per-layer finish.** Bright-pass and blur pyramid per glowing layer, added when the layer is composited. | About eleven small passes per glowing layer. | **Chosen** (picked in conversation, 15 Nov). |
| Whole-picture glow under Output. One pyramid over the finished composite. | Cheapest, but cannot glow one layer alone and doubles up on the Oscilloscope's bloom. | Dropped. |
| Widen the existing four-tap halo in the compositor. | Almost free, but four taps cannot make a wide soft bloom without visible artefacts. | Dropped. |

## 3. Design

### Controls

Added to `FINISH_PARAMETERS` in `src/core/finishing.ts` as `GLOW_PARAMETERS`, with `GLOW_KEYS` exported like the other families. Keys are prefixed `glow…` and must not be the bare `glow`, which Fractal already uses.

| Key | Label | Range | Default | What it does |
| --- | --- | --- | --- | --- |
| `glowMix` | Glow amount | 0–2 | 0 | Strength of the glow. 0 is off and skips every glow pass. |
| `glowThreshold` | Glow threshold | 0–1 | 0.5 | Brightness above which light glows, with a soft knee. 0 makes the whole layer glow. |
| `glowSize` | Glow size | 0–1 | 0.5 | Moves the glow from the tight blur levels to the wide ones (same weighting law as the scope's Bloom size). |
| `glowTint` | Glow colour | 0–6, step 1 | 0 | 0 keeps the layer's own colour; 1–6 use the matching palette swatch (same convention as Outline colour). |

All four can be animated. The glow counts as active when `glowMix > 0` or `glowMix` has a modulation, mirroring `feedbackActive`.

### Where it applies

- `supportsGlow(layer)`: every kind except Graphic Patterns (the source is a repeating tile, not the frame) and Oscilloscope (it has its own bloom).
- Hidden controls and no passes where unsupported. Evolving Ink **is** supported: the glow is stateless.

### Rendering

1. **Bright pass.** After the layer's source texture is final (after Feedback and Time displacement), a pass at half resolution keeps the light above the threshold, in linear light, from the premultiplied source.
2. **Pyramid.** Five levels at fixed line heights, each a separable nine-tap Gaussian, exactly as the scope does. Move the scope's blur shader, `BLOOM_HEIGHTS` and the small-render `reach` rule into a shared `src/rendering/bloom.ts`, used by both `ScopeRenderer` and `StudioRenderer`. One set of pyramid targets is shared by all layers, since each layer's glow is consumed straight away by its composite pass.
3. **Composite.** `compositeFragment` gets the five levels, their weights and the tint. The glow is kept apart from the layer's coverage: Saturation, Hue and Exposure grade it as they grade the layer, the layer mask and opacity scale it, and it is added to the result after the layer is blended, so it can only brighten what is underneath. Where nothing is underneath it raises alpha by its own brightness, so it exports correctly on a transparent background. Flat colour and the tonal controls do not act on it. (Revised after review, 15 Nov: the first version added the glow to the layer's coverage, which darkened brighter layers below.)

Consequences worth knowing:

- Echoes and time-shifted slices glow, and the glow never enters the echo history, so Feedback warm-up and loop closure are untouched.
- Glow width is a share of the frame height, not of the layer's zoom. (Builder to confirm how `source-view.ts` places non-graphic sources and keep this true.)
- The threshold reads the layer before flat colour and Fractal recolouring. On those layers the glow keeps the original shading colours unless Glow colour picks a palette swatch. Accepted limit for this version.

### Library looks

Glow keys join `FINISH_LOOK_KEYS`, so applying any finish look resets glow and **No finish** clears it. New looks:

- **Soft Glow**: `glowMix 0.8, glowThreshold 0.6, glowSize 0.4`
- **Dream Haze**: `glowMix 1.2, glowThreshold 0.15, glowSize 0.9`
- **Hot Highlights**: `glowMix 1.5, glowThreshold 0.8, glowSize 0.2`
- **Glowing Trails**: Bloom Echo's feedback settings plus `glowMix 0.9, glowThreshold 0.5, glowSize 0.6`

A look that sets glow keys is disabled on a layer where `supportsGlow` is false; the other looks stay available there.

### Interface

A **Glow** section in the Finish tab, after Tonal finishing. The Tonal finishing filter in `App.tsx` must exclude `GLOW_KEYS`. Old projects pick the new keys up through the existing `FINISH_KEYS` upgrade path in `project.ts`.

### Tests and checks

- `tests/glow.test.ts`: defaults are neutral; keys exist on every kind; controls hidden on Graphic and Oscilloscope; `glowActive` with and without modulation; level weights for sizes 0, 0.5 and 1; looks apply, replace each other and clear.
- Existing `scope.test.ts` still passes after the blur moves to `bloom.ts`.
- In the app: Liquid Light with Soft Glow; a Surface with Tunnel plus glow; transparent PNG export; preview against a 2× supersampled export for matching width.
- README: add Glow to the finishes list.

## 4. Calls made without you

These are my choices, not things you agreed to. Say if any is wrong.

- Four controls only; no separate halation or lens streaks.
- Glow keys are part of finish looks, so swapping looks resets glow.
- Glow is cut by the layer mask.
- Graphic Patterns are excluded, as they are from the other finishes.
- Fractal and Sculpture keep their existing small halo alongside the new finish.
- The doc lives here with the other dated plans, not committed yet (the branch has unrelated uncommitted Oscilloscope work).
