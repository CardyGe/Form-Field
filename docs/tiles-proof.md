# Tiles proof

Proof for LED wall, Characters and Tiles, and Print screen's Blue noise, Shimmer and Retro palettes, on branch `material-tiles`, against the baseline at `fe20b72`. Run on 2026-11-26 on one Apple Silicon Mac.

## Check results

| Command | Result |
| --- | --- |
| `node scripts/verify-tiles.mjs --baseline=<baseline>` | 37 passed, 0 failed |
| `npx tsc --noEmit` | clean |
| `npm test` | 1541 unit and 106 Electron tests pass, 0 fail |
| `npm run test:workspace` | 14 passed, 0 failed on the first run |
| `npm run test:map` | MAP CHECK PASSED on the first run (69 checks ok, 0 failing) |
| `node scripts/verify-print.mjs` | passes (exit 0) |
| `node scripts/verify-warp.mjs --baseline=<baseline>` | 75 passed, 1 failed: old-file, a fault in the check, not in tiles. See below |
| `node scripts/verify-colour-time.mjs --baseline=<baseline>` | 52 passed, 0 failed |

**verify-warp old-file.** This check requires the baseline's saved file to hold no Warp keys, because it was written for a baseline from before Warp. This baseline is main after Warp merged, so its file holds 140 Warp keys and the check cannot pass. Its other measures hold: 112 new keys filled in, 0 off default, and 15 renders byte-identical. Run from the baseline checkout against itself, the same check fails the same way (0 passed, 1 failed, "140 warp keys in the file"), so the branch did not cause it. Tiles' own old-file check covers opening older files.

The final checks:

- **all-presets-neutral:** all 175 baseline presets are byte-identical at phase .9, 960x540. The lowest lit share is 1.15%, so none is blank.
- **old-file:** a project saved by the baseline build, with Tunnel, Terraces, Soft Glow and Halftone layers, holds no LED, Characters or Tiles keys. It opens with 112 new keys, all at their defaults: 104 for the three new effects and 8 for Print's Retro palette and Shimmer. All 15 renders are byte-identical in both builds.
- **stack:** LED wall, Characters and Tiles, each with Warp, Split, Gradient, Glow, Feedback and Time on a moving Surface, render non-blank (lit 99.9%, 77.9%, 99.9%). Each repeats byte for byte after seeking away and back. Taking any one effect out changes the render.
- **sheet:** 18 sheets in `work/tiles-proof/`. They cover all 3 LED shapes, 4 character sets and 3 tile styles on Surface, Fractal, Liquid and Image layers at three phases, with 1:1 crops of a 1080 frame, the stored glyphs, and a strip of LED flicker frames. All 40 choice and layer pairs change the picture visibly.

Injected defect: with LED wall's default amount set to .01, all-presets-neutral and old-file both fail (preset renders change, and all 15 old-file renders change). The defect was then reverted.

## Preview cost

Report only. Mean frame time on a Surface layer, forced to finish on the GPU. Each value is the median of 3 rounds (60 frames at 1280x720 and 1920x1080, 30 at 3840x2160), after a warm-up round. Rounds stayed within .25 ms of each other.

| Case | 1280x720 | 1920x1080 | 3840x2160 |
| --- | --- | --- | --- |
| Plain | 1.00 ms | 1.78 | 5.84 |
| LED Round, pitch 10 (default) | +0.35 | +0.62 | +2.22 |
| LED Round, pitch 2 (smallest) | +0.54 | +0.57 | +2.09 |
| LED Stripes, pitch 2 | +0.36 | +0.49 | +1.72 |
| Characters, size 16 (default) | +0.48 | +0.98 | +3.43 |
| Characters, size 4 (smallest) | +0.36 | +0.71 | +3.21 |
| Characters, size 4, 8 swaps | +0.49 | +0.98 | +4.16 |
| Mosaic, size 18 (default) | +3.34 | +7.20 | +26.73 |
| Mosaic, size 3 (smallest) | +3.17 | +7.01 | +26.66 |
| Brick, size 3 | +0.57 | +1.04 | +4.47 |
| Beads, size 3 | +0.56 | +1.06 | +4.26 |
| All three, smallest | +3.99 | +7.98 | +30.43 |

Size barely changes the cost: each pixel does the same work at any size. LED's 9-cell gather and Characters' 16 samples are cheap. **Mosaic is the costly one:** each of its 16 samples a pixel finds its tile among 9 moved corners, each with its own hash. At 1080 it adds about 7 ms, which fits a 60 fps frame on its own but not beside several heavy layers. At 4K it adds 27 ms, so a 4K preview with Mosaic drops below 30 fps. Exports are not affected beyond taking longer. Making Mosaic cheaper is not a small change, so it is a known limit.

## Retunes and fixes

**Blocks glyphs fill the cell.** On every sheet, Characters Blocks showed bright areas as vertical bars with black gaps, not solid blocks. The glyphs were drawn at their monospace width, so the full block covered only columns 12 to 51 of its 64-pixel square, about 62%. Block elements (U+2580 to U+259F) are now stretched across the square. The full block covers columns 0 to 63, and bright areas read as solid teletext-style blocks with shaded edges. Other sets are unchanged. Characters checks, the sheet and the full verify-tiles run were re-run after the fix and pass. The finish thumbnail uses Density, so it did not change.

| | Old | New |
| --- | --- | --- |
| Full block width in the stored glyph | 40 of 64 px (columns 12-51) | 64 of 64 px |
| Blocks thumbnail level against plain, Surface | 89% (bars with black gaps) | 84% (solid blocks; the stretched shade glyphs carry their own dot pattern across the cell) |

No default was retuned.

## Verdicts by eye

Judged on rules 2 (reads on a wall), 3 (changes over the loop) and 6 (clean at projector scale) of `docs/effects-improvement-plan-2026-11-12.md`, at full amount and default settings. The Image row uses a still poster, so rule 3 does not apply to it. **Weak** passes with a named flaw.

Each cell gives the thumbnail's mean level against plain, from `sheet-metrics.json`.

| Choice | Surface | Fractal | Liquid | Image |
| --- | --- | --- | --- | --- |
| LED Round | Pass, 65% | Pass, 69% | Pass, 73% | Pass, 68% |
| LED Square | Pass, 85% | Pass, 89% | Pass, 93% | Pass, 87% |
| LED Stripes | Pass, 69%: clear RGB bars at 1:1 | Weak, 64%: rule 2, greyish in thumbnails | Weak, 68%: rule 2, olive cast in thumbnails | Pass, 62% |
| Characters Density | Weak, 51%: rule 2 | **Fail, 25%: rule 2, nearly black** | **Fail, 30%: rule 2, nearly black** | Pass, 53%: glyphs read |
| Characters Blocks (after fix) | Pass, 84%: solid blocks | Weak, 32%: rule 2, dark | Pass, 54% | Pass, 71% |
| Characters Binary | Pass, 66%: 0 and 1 read | Weak, 41%: rule 2 | Pass, 60% | Pass, 65% |
| Characters Dots | Weak, 52%: rule 2 | **Fail, 24%: rule 2, nearly black** | **Fail, 31%: rule 2, nearly black** | Weak, 46%: rule 2 |
| Tiles Mosaic | Pass, 80%: clear uneven tiles | Pass, 81% | Pass, 80% | Pass, 80% |
| Tiles Brick | Pass, 82%: studs read | Pass, 82% | Pass, 82% | Pass, 82% |
| Tiles Beads | Pass, 64%: rings read | Pass, 64% | Pass, 65% | Pass, 64% |

Every choice changes over the loop on the moving layers (rule 3), and none shows seams or line pitch under 4 px at its default size (rule 6).

**Characters go dark on saturated, mid-tone pictures. Not fixed.** Each cell picks its glyph by perceptual tone, as the plan specifies. Saturated reds, purples and blues have low luminance, so most cells of the Fractal and Liquid presets pick `.`, `:` or `-`, and little ink is drawn. Raising Character contrast does not help, because it stretches tone about mid-grey and pushes dark cells darker. Two likely fixes, both changing the plan's design and so left to the owner: pick the glyph by the cell's brightest channel instead of its luminance, or add a tone gain. On greys nothing would change, so the char-sets check would still hold. Until then, a palette background or Palette ink brightens the look.

Thumbnails average in encoded values, which darkens fine LED patterns and turns Stripes greyish. The led-scale check shows the 1:1 render keeps the plain picture's light.

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
