# Tiles proof

Proof for LED wall, Characters and Tiles, and Print screen's Blue noise, Shimmer and Retro palettes, on branch `material-tiles`, against the baseline at `fe20b72`. Run on 2026-11-26 on one Apple Silicon Mac.

## Check results

| Command | Result |
| --- | --- |
| `node scripts/verify-tiles.mjs --baseline=<baseline>` | 40 passed, 0 failed |
| `npx tsc --noEmit` | clean |
| `npm test` | 1544 unit and 106 Electron tests pass, 0 fail |
| `npm run test:workspace` | first run: the known "Focus preview" timeout; second run: 14 passed, 0 failed |
| `npm run test:map` | MAP CHECK PASSED on the first run |
| `node scripts/verify-print.mjs` | passes (exit 0) |
| `node scripts/verify-warp.mjs --baseline=<baseline>` | 76 passed, 0 failed on the first run |
| `node scripts/verify-colour-time.mjs --baseline=<baseline>` | 52 passed, 0 failed (at 3d3d422; not rerun after the final fixes) |

**verify-warp old-file: old Warp files render byte-identically.** The check was written for a baseline from before Warp and required the saved file to hold no Warp keys, so on this baseline (main after Warp) it failed even against itself and proved nothing. It now tells the two apart. From a baseline that already has Warp, the baseline build writes its four layers (Tunnel, Terraces, Soft Glow, Halftone) with Warp, Liquid, Luma Warp, Polar and Mirror all switched on, the Image layer moved, turned and scaled. That file is saved to disk, read back, and rendered by the baseline build and by the branch at three phases, alone and together. Result: 140 warp keys in the file, 5 warps on, 112 new keys filled in at their defaults, all 15 renders byte-identical. With Mirror's amount scaled by .99 on the branch only, the same check fails (6 renders changed), so it does catch a warp change.

The final checks:

- **all-presets-neutral:** all 175 baseline presets are byte-identical at phase .9, 960x540. The lowest lit share is 1.15%, so none is blank.
- **old-file:** a project saved by the baseline build, with Tunnel, Terraces, Soft Glow and Halftone layers, holds no LED, Characters or Tiles keys. It opens with 112 new keys, all at their defaults: 104 for the three new effects and 8 for Print's Retro palette and Shimmer. All 15 renders are byte-identical in both builds.
- **stack:** LED wall, Characters and Tiles, each with Warp, Split, Gradient, Glow, Feedback and Time on a moving Surface, render non-blank (lit 99.9%, 77.9%, 99.9%). Each repeats byte for byte after seeking away and back. Taking any one effect out changes the render.
- **sheet:** 18 sheets in `work/tiles-proof/`. They cover all 3 LED shapes, 4 character sets and 3 tile styles on Surface, Fractal, Liquid and Image layers at three phases, with 1:1 crops of a 1080 frame, the stored glyphs, and a strip of LED flicker frames. All 40 choice and layer pairs change the picture visibly. The sheet now also gates, from the full 960x540 frames: every LED wall and Tiles choice keeps at least 50% of plain's mean brightness on every preset (lowest 62.7% and 64.0%), every Characters choice at least 7.5% (lowest 8.9%, Dots on Fractal); no stage goes black (each phase has at least 5% of pixels lit; lowest 10.4%); and Blocks leaves no gaps (0.00% dark pixels inside whole cells of full blocks on white, limit 0.1%). An LED stage forced to black, luminance glyph choice and unstretched block glyphs each make it fail.
- **frame-fixed:** LED wall, Characters, Mosaic and Brick on a white layer that is scaled 1.7, turned .31 rad and moved by sub-pixel steps over three frames. Over the frame's middle every pixel matches the untransformed layer (0.000/255), nothing changes from frame to frame, and the LED pitch is 10.00 output pixels in all four renders. The grid was already fixed to the frame: non-graphic sources are drawn in frame coordinates (their generators take the layer's view), the tile pass runs on that frame-space picture, and the composite's two view transforms cancel. So no code changed for this; the check guards it. With cell sizes made to follow the layer's scale, it fails (pitch 16.81 px, 71 to 104/255 off).
- **wide-output:** a 16384x64 output with all three effects at their smallest sizes keeps the shared cell target within the GPU's 16384 limit (16383 wide), with no GL error. Before the clamp it asked for a 299521-wide target and raised GL error 1281.
- **char-tone:** see Characters below.

Injected defect: with LED wall's default amount set to .01, all-presets-neutral and old-file both fail (preset renders change, and all 15 old-file renders change). The defect was then reverted.

## Preview cost

Report only. Mean frame time on a Surface layer, forced to finish on the GPU. Each value is the median of 3 rounds (60 frames at 1280x720 and 1920x1080, 30 at 3840x2160), after a warm-up round. Rounds of one case differed by at most 1.55 ms (LED Stripes pitch 2 at 4K, 7.57 to 9.11 ms) and 1.20 ms (LED Round pitch 10 at 4K); every other case stayed within .35 ms. Rerun on the final code.

| Case | 1280x720 | 1920x1080 | 3840x2160 |
| --- | --- | --- | --- |
| Plain | 1.04 ms | 1.77 | 6.12 |
| LED Round, pitch 10 (default) | +0.34 | +0.64 | +1.85 |
| LED Round, pitch 2 (smallest) | +0.51 | +0.61 | +1.80 |
| LED Stripes, pitch 2 | +0.37 | +0.57 | +1.47 |
| Characters, size 16 (default) | +0.46 | +0.90 | +3.23 |
| Characters, size 4 (smallest) | +0.41 | +0.73 | +3.14 |
| Characters, size 4, 8 swaps | +0.49 | +0.98 | +3.97 |
| Mosaic, size 18 (default) | +3.22 | +7.29 | +26.38 |
| Mosaic, size 3 (smallest) | +3.08 | +7.06 | +26.30 |
| Brick, size 3 | +0.47 | +1.15 | +4.25 |
| Beads, size 3 | +0.50 | +1.05 | +3.98 |
| All three, smallest | +3.98 | +8.00 | +30.32 |

Size barely changes the cost: each pixel does the same work at any size. LED's 9-cell gather and Characters' 16 samples are cheap. **Mosaic is the costly one:** each of its 16 samples a pixel finds its tile among 9 moved corners, each with its own hash. At 1080 it adds about 7 ms, which fits a 60 fps frame on its own but not beside several heavy layers. At 4K it adds about 26 ms: a 4K Surface with Mosaic takes 32.5 ms a frame, about 31 fps, so it falls well short of 60 fps and sits just above 30 fps on its own. With all three effects at their smallest it takes 36.4 ms, about 27 fps, below 30. Any second heavy layer would also take Mosaic alone below 30 fps at 4K. Exports are not affected beyond taking longer. Making Mosaic cheaper is not a small change, so it is a known limit.

## Retunes and fixes

**Blocks glyphs fill the cell.** On every sheet, Characters Blocks showed bright areas as vertical bars with black gaps, not solid blocks. The glyphs were drawn at their monospace width, so the full block covered only columns 12 to 51 of its 64-pixel square, about 62%. Block elements (U+2580 to U+259F) are now stretched across the square. The full block covers columns 0 to 63, and bright areas read as solid teletext-style blocks with shaded edges. Other sets are unchanged. Characters checks, the sheet and the full verify-tiles run were re-run after the fix and pass. The finish thumbnail uses Density, so it did not change.

| | Old | New |
| --- | --- | --- |
| Full block width in the stored glyph | 40 of 64 px (columns 12-51) | 64 of 64 px |
| Blocks thumbnail level against plain, Surface | 89% (bars with black gaps) | 84% (solid blocks; the stretched shade glyphs carry their own dot pattern across the cell) |

No default was retuned.

## Verdicts by eye

Judged on rules 2 (reads on a wall), 3 (changes over the loop) and 6 (clean at projector scale) of `docs/effects-improvement-plan-2026-11-12.md`, at full amount and default settings. The Image row uses a still poster, so rule 3 does not apply to it.

**Cutoff.** Rule 2 is scored by number, from `sheet-metrics.json`. Each cell gives the choice's ink: its mean brightness against plain over three phases, as a share of the most that choice can give (its brightness against plain on a white layer: LED Round 63%, Square 83%, Stripes 66%, Density 38%, Blocks 100%, Binary 19%, Dots 35%, Mosaic 80%, Brick 83%, Beads 64%). This keeps a glyph set's own empty space from counting against it. **Pass** is 60% or more, **Weak** 30% to 60%, **Fail** under 30%. Ink above 100% means the choice gives more light on that picture than on white (Binary's 1 and 0 are both bright). The brightness against plain follows in brackets. All values are from the full 960x540 frames; the earlier table read 120x68 thumbnails, whose sample step lines up with the cells and reads the same spot of every cell.

| Choice | Surface | Fractal | Liquid | Image |
| --- | --- | --- | --- | --- |
| LED Round | Pass, 104% (66%) | Pass, 110% (69%) | Pass, 116% (73%) | Pass, 108% (68%) |
| LED Square | Pass, 102% (85%) | Pass, 107% (89%) | Pass, 112% (93%) | Pass, 105% (87%) |
| LED Stripes | Pass, 105% (69%) | Pass, 98% (64%) | Pass, 103% (68%) | Pass, 96% (63%) |
| Characters Density | Pass, 91% (35%) | Weak, 39% (15%) | Pass, 69% (26%) | Pass, 91% (35%) |
| Characters Blocks | Pass, 100% (100%) | Pass, 69% (69%) | Pass, 94% (94%) | Pass, 101% (101%) |
| Characters Binary | Pass, 100% (19%) | Pass, 147% (28%) | Pass, 116% (22%) | Pass, 102% (20%) |
| Characters Dots | Pass, 95% (33%) | **Fail, 26% (9%)** | Pass, 74% (26%) | Pass, 99% (34%) |
| Tiles Mosaic | Pass, 100% (80%) | Pass, 101% (81%) | Pass, 100% (80%) | Pass, 100% (80%) |
| Tiles Brick | Pass, 99% (82%) | Pass, 100% (82%) | Pass, 100% (82%) | Pass, 99% (82%) |
| Tiles Beads | Pass, 101% (64%) | Pass, 101% (64%) | Pass, 103% (66%) | Pass, 101% (64%) |

Every choice changes over the loop on the moving layers (rule 3), and none shows seams or line pitch under 4 px at its default size (rule 6).

**Characters pick glyphs by the cell's brightest channel (Ruling 20).** Luminance left saturated reds, purples and blues dark, so most cells of the Fractal and Liquid presets picked `.`, `:` or `-`. Each cell's tone is now its brightest channel, unpremultiplied, held to full value and encoded for the display, then Character contrast applies. Greys are unchanged, so the char-sets ramp still uses every glyph in order. The char-tone check measures ink at 1920x1080, three phases:

| | Luminance (before) | Brightest channel (now) |
| --- | --- | --- |
| Density on Fractal | 23.8% (7.2% of plain) | 43.6% (13.2%) |
| Dots on Fractal | 7.5% (2.4%) | 23.8% (7.5%) |
| Density on Liquid | 35.6% (10.8%) | 71.8% (21.8%) |
| Dots on Liquid | 11.6% (3.7%) | 73.0% (23.0%) |

The check's limit is 20% ink, which the luminance choice fails on both Dots rows. The brief asked for about 60% of plain; no tone rule reaches that, because the glyphs themselves leave most of each cell empty (Density's fullest glyph lights 38% of white, Dots' 35%). **Dots on Fractal stays a Fail, and Density on Fractal Weak: a known limit.** Fractal's preset is mostly mid-tone filaments, which pick the small dot glyphs. A palette background or Palette ink brightens the look. The finish thumbnail (`chars.jpg`) was regenerated; no other thumbnail changed.

The four open items from earlier reviews:

1. **Tall glyphs clipped in the 64-pixel square: no clipping.** The sets hold no `$` or `|`. `@`, `#`, `%` and the other Density glyphs stay clear of all four edges (see `glyphs.png`). Only the Blocks glyphs touch the edges, and they are meant to fill the cell.
2. **Small Character sizes grainy: acceptable.** At size 4 no glyph can be read. The cells become an even fine texture in the layer's colour, not sparkle, because each pixel averages 16 samples. Size 8 shows recognisable marks. Rule 6 asks for nothing under about 4 px, and 4 is the slider's minimum.
3. **Tile relief dims flat tops: acceptable.** Side by side at relief 0, .5 and 1, the default .5 is slightly darker than 0 and still fully saturated. Most of the dimming comes from the grout, not the relief: Mosaic brings Fractal's mean thumbnail level from 69 to 56, about 81%. Relief 0 is there for a flat look. No retune.
4. **LED flicker smooth, not random per frame: reads as a shimmer, not a flicker.** At flicker 1 on flat grey, each LED changes about 3.9 of 255 from one frame to the next, about 22 per quarter second, and swings about 48 over 1.25 s. The LEDs breathe out of step with each other, like a slow twinkle, and never jump. That matches the control's description ("Each LED shimmers a little") and keeps loops exact. A hard per-frame flicker would need a different design, and could strobe in a room. No change.

## What was not verified

- Real footage or camera input. The Image rows use a synthetic poster.
- A projector or LED wall. Rule 6 was judged on 1:1 crops of a 1080 frame on a laptop screen.
- Other GPUs. Preview times come from one Apple Silicon Mac.
- Windows and Linux fonts. Glyphs use the system monospace font (Menlo here). Another font changes the glyph shapes and the Blocks width the stretch corrects. char-fonts checks every glyph draws on this Mac only.
- Live mode with sound driving the tile controls.
