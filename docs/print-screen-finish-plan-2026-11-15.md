# Form & Field: Print screen finish design

15 November 2026 · branch `liquid-scope` · status: awaiting approval

## 1. Intent

A per-layer **Print screen** finish: the layer's tone is redrawn as halftone dots, a line screen or an ordered dither. The screen is sized in pixels of a 1080-line frame, like the Flat colour outlines, so a 4K or supersampled export has the same pattern as the preview. The artist can limit where the screen prints, so it can sit on the edges of an instrument, or everywhere but the edges, instead of covering the whole thing.

**Goals**

- Dot and line edges as sharp as the output allows at every size, with no shimmer or moiré from the screen itself.
- Dots stay whole: never sliced by picture detail, cell borders or the layer's silhouette.
- Off by default and exactly neutral, so existing projects render unchanged.
- Preview, 4K export and 2× / 3× supersampled export show the same pattern in the same place.
- Stateless: loops close exactly, with no warm-up.
- Works on a transparent background.
- Enough control to place the screen by tone and by edge, not only on or off.

**Non-goals**

- Ink bleed, paper grain, patchy ink, deliberate misregistration.
- A whole-picture screen under Output.
- Error-diffusion or blue-noise dither.

**Anti-goals**

- A screen that crawls, flickers or changes pitch when the export size changes.
- A screen that enters the Feedback history and compounds.

## 2. Approaches

| Approach | Trade-off | Decision |
| --- | --- | --- |
| **Drawn screen in the compositor.** The pattern is computed per output pixel in `compositeFragment`, with each edge an exact distance filtered to one pixel. | No extra passes; soft effects such as ink bleed would need a later pass. | **Chosen** (picked in conversation, 15 Nov). |
| Its own render pass at 2–3× size, scaled down. | Room for ink spread and paper later, but an extra large target per screened layer and slightly softer edges. | Dropped. |
| Tiled threshold texture. | Cheapest, but edges are only as good as the tile and blur or alias at 4K. | Dropped. |

## 3. Design

### Controls

Added to `FINISH_PARAMETERS` in `src/core/finishing.ts` as `PRINT_PARAMETERS`, with `PRINT_KEYS` exported like the other families. All keys are prefixed `print…`. Sizes are in pixels of a 1080-line frame.

**Screen**

| Key | Label | Range | Default | What it does |
| --- | --- | --- | --- | --- |
| `printMix` | Print screen | 0–1 | 0 | Blend from the plain layer to the screened layer. 0 is off and skips all screen work. |
| `printType` | Screen type | 0–2, step 1 | 0 | Dots, Lines, Dither. |
| `printSize` | Screen size | 1–64, step 0.25 | 8 | Dot pitch, line pitch, or the size of one dither cell. |
| `printAngle` | Screen angle | −90–90°, step 0.5 | 45 | Turns the whole screen about the frame centre. |
| `printDot` | Dot shape | 0–3, step 1 | 0 | Round, Classic (round dots that join into a checkerboard at mid tone, then round holes), Diamond, Square. Dots only. |
| `printMatrix` | Dither matrix | 0–2, step 1 | 2 | 2×2, 4×4, 8×8 Bayer. Dither only. |
| `printScroll` | Screen travel per loop | −8–8, step 1 | 0 | The screen slides this many whole cells along its angle per loop, so the loop closes exactly. |

**Tone**

| Key | Label | Range | Default | What it does |
| --- | --- | --- | --- | --- |
| `printFloor` | Tone floor | 0–1 | 0 | Tones below this print nothing. |
| `printCeiling` | Tone ceiling | 0–1 | 1 | Tones above this print solid. |
| `printMax` | Largest mark | 0.1–1 | 0.8 | The most of a cell any mark covers, so full-bright areas still show marks. 1 lets them print solid. (Added during the build, 15 Nov: without it, bright saturated layers printed solid and showed no screen.) |
| `printGain` | Dot gain | −1–1 | 0 | Bends the tone curve: positive fattens the marks, negative thins them. |
| `printSoft` | Mark softness | 0–1 | 0 | 0 is a crisp one-pixel filtered edge; 1 softens each mark across half a cell. |
| `printInvert` | Invert | 0–1, step 1 | 0 | Off: bright tone makes big marks (light on dark). On: dark tone makes big marks (ink on paper). |

**Colour**

| Key | Label | Range | Default | What it does |
| --- | --- | --- | --- | --- |
| `printColour` | Screen colour | 0–3, step 1 | 0 | Layer colour, Palette ink, RGB light (three screens, added), CMYK ink (four screens, overprinted). |
| `printInk` | Ink | 1–6, step 1 | 1 | Palette swatch used by Palette ink. |
| `printPaper` | Paper | 0–6, step 1 | 0 | 0 leaves the gaps transparent; 1–6 fill them with that palette swatch, inside the layer's own coverage. |

**Where it prints**

| Key | Label | Range | Default | What it does |
| --- | --- | --- | --- | --- |
| `printArea` | Print area | 0–2, step 1 | 0 | Everywhere, Edges only, Away from edges. Outside the area the layer shows as normal. |
| `printEdgeWidth` | Edge width | 1–64 | 12 | How far the edge band reaches from an edge. |
| `printEdgeSense` | Edge sensitivity | 0–1 | 0.5 | How small a tone step counts as an edge. Higher finds fainter edges. |
| `printEdgeFeather` | Edge feather | 0–1 | 0.25 | Softness of the boundary between screened and plain. |

Every continuous control can be animated. The screen counts as active when `printMix > 0` or `printMix` has a modulation, mirroring `glowActive`. Where the inspector can hide controls by another control's value (as style-dependent controls do), hide Dot shape unless Dots, Dither matrix unless Dither, Ink unless Palette ink, and the three edge controls when Print area is Everywhere. If it cannot, show them all.

### Where it applies

`supportsPrint(layer)`: every kind except Graphic Patterns, whose source is a repeating tile (the same rule as the other finishes). Oscilloscope is included as long as it is drawn through `compositeFragment`; builder to confirm, and exclude it if not. Controls are hidden and nothing runs where unsupported.

### Rendering

Everything happens in `compositeFragment`, after Flat colour (`toon`) and before grading, behind one `uPrintOn` switch so layers without the finish pay nothing.

**The grid.** Built from `vUv`, not the layer's `uv`, so it is fixed to the frame and the layer moves under it. Screen coordinate: `s = rotate(angle) * ((vUv − .5) * vec2(uAspect, 1.) * 1080. / printSize) + scroll`. One unit of `s` is one cell. `scroll = printScroll × loopPhase / 2π` along the screen's first axis. Uniform values (pitch, angle in radians, per-channel angles, scroll) are computed by a pure function `printUniforms(layer, phase)` in a new `src/rendering/print-screen.ts`, so they can be tested.

**Tone.** The same measure Flat colour uses: `t = L / (.35 + L)` on the straight colour, multiplied by the layer's alpha, then through floor, ceiling, gain and invert to give a target coverage `c` in 0–1. Using alpha means marks at the layer's silhouette shrink away instead of being cut.

**Dots.** For the pixel's own cell and its eight neighbours, read the tone at the cell centre (mapped back from `s` to the layer's `uv`, through `sampleSource`). The own cell uses the average of five taps (centre and four at a quarter cell) so a dot does not flicker when fine detail passes under its centre. Each cell gives a signed distance to its mark for the chosen shape, with the radius set so the mark's area equals `c`. The nine distances are combined as a union, so marks that grow past their cell join their neighbours with no seams. Coverage is `clamp(.5 − d / w, 0., 1.)` where `w` is the larger of the pixel footprint (`fwidth` of `s`) and the Mark softness width.

**Lines.** Line half-width equals `c / 2` cells. The tone is read at the pixel's projection onto the line's centre, so both sides of a line agree and its edges are clean curves. The lines either side are included in the union, the same way as dots.

**Dither.** `s` is floored to cells. Each cell compares the tone at its centre with the Bayer threshold for its position, giving on or off. The cell edges are box-filtered to the pixel footprint, so cells are crisp squares at any export size and do not alias when a cell is not a whole number of output pixels.

**Fine-screen fade.** When one cell is under about two output pixels (`fwidth(s) > .5`), the screen fades to the plain coverage `c`, the same footprint rule Flat colour uses. A small screen in a reduced preview turns into flat tone, not noise.

**Colour.**

- *Layer colour:* each mark takes the layer's colour at its cell centre (own pixel for lines), scaled by `min(1 / c, 8)` so the cell's average brightness matches the unscreened layer.
- *Palette ink:* marks are the chosen swatch at full strength.
- *RGB light:* three screens, one per channel, at the Screen angle +15°, +75° and +0°, each drawn in its primary and added.
- *CMYK ink:* cyan, magenta, yellow and black screens at +15°, +75°, +0° and +45°, with black taken as the common part of the three. The inks multiply over the paper swatch, or over white when Paper is transparent.

**Alpha.** With Paper transparent, the screened layer's alpha is the layer's alpha times the mark coverage (for CMYK, the union of the four inks), premultiplied as everywhere else. With a Paper swatch, alpha is the layer's own alpha and the gaps are paper.

**Print area.** An edge strength is measured on the same tone, including alpha so the silhouette counts as an edge: the largest tone difference between the centre and 24 taps (two rings of twelve, at the Edge width and at half of it). It is turned into a 0–1 mask with a smooth step whose position comes from Edge sensitivity and whose width comes from Edge feather. Edges only uses the mask; Away from edges uses its inverse. For dots and dither the mask is measured at the cell centre, so whole marks fade in and out instead of being cut. The final layer is `mix(plain, screened, mask × printMix)`.

**Order and interactions.**

- Runs after Flat colour, so banded colour can be screened.
- Saturation, Hue, Exposure and Tonal finishing grade the screened result.
- Glow is added on top afterwards from the unscreened source, so it stays soft over the dots.
- Feedback echoes and Time shift slices are screened, and the screen never enters the echo history.
- The layer mask and opacity apply afterwards, as now.

**Cost.** Dots read about 13 source taps per pixel, 24 more when Print area is not Everywhere, and three or four times the dot taps in RGB and CMYK. Builder to measure the preview frame rate on a 4K working size; if RGB or CMYK is too slow, reduce their neighbours from eight to the four that share an edge and say so.

### Library looks

`PRINT_KEYS` join `FINISH_LOOK_KEYS`, so applying any finish look resets the screen and **No finish** clears it. A look that sets print keys is disabled where `supportsPrint` is false. New looks, all with `printMix 1`:

- **Halftone**: Dots, size 8, angle 45, Layer colour.
- **Fine Halftone**: Dots, Classic shape, size 4, angle 45.
- **Engraving**: Lines, size 6, angle 30.
- **Comic Process**: Dots, size 7, CMYK ink.
- **RGB Raster**: Dots, size 9, RGB light.
- **Bitmap Dither**: Dither, size 3, 8×8, angle 0.
- **Halftone Edges**: Halftone with Print area Edges only, edge width 16.

### Vary

Vary treats the screen as an explicit choice, like Glow: it never changes `printMix`, any stepped print control, or `printScroll`, and it leaves every print control alone while the screen is off. When on, the continuous controls move near where the artist set them.

### Interface

A **Print screen** section in the Finish tab, after Glow, with the four groups above in that order. The Tonal finishing filter in `App.tsx` must exclude `PRINT_KEYS`. Old projects pick the new keys up through the existing `FINISH_KEYS` upgrade path in `project.ts`.

### Tests and checks

- `tests/print.test.ts`: defaults are neutral; keys exist on every kind; controls hidden on Graphic Patterns; active with and without modulation; `printUniforms` gives the same pitch in frame units at 1080, 2160 and 3× supersampled heights; scroll is a whole number of cells at the loop end; looks apply, replace each other and clear; Vary leaves the protected keys alone.
- In the app: each screen type on Liquid Light and on a Surface; Halftone Edges on Sculpture; preview against a 4K export and a 2× supersampled export for matching pattern and position; transparent PNG export; first and last frame of a loop with Screen travel set.
- README: add Print screen to the finishes list.

## 4. Calls made without you

These are my choices, not things you agreed to. Say if any is wrong.

- **Edge control means three areas:** Everywhere, Edges only, Away from edges. I read your "not all the instrument being affected" as wanting the screen placed by edges; both directions are offered.
- Tone floor and ceiling are a second way to limit the screen, by brightness.
- The screen is fixed to the frame, not to the layer.
- Layer colour dots keep the layer's average brightness instead of darkening it.
- Four colour modes, including RGB light and CMYK ink at fixed classic angles.
- Screen travel per loop is included as the only built-in motion.
- No ink bleed, paper texture or misregistration in this version.
- Seven library looks.
- Graphic Patterns are excluded, as they are from the other finishes.
- The doc lives here with the other dated plans and is not committed yet.
