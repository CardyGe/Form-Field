# Warp proof

Proof for Warp, Liquid, Luma Warp, Polar and Mirror on branch `warp-engine`, against the baseline at `22339a8`. Run on 2026-11-23 on one Apple Silicon Mac.

## Check results

| Command | Result |
| --- | --- |
| `node scripts/verify-warp.mjs --baseline=<baseline>` | 71 passed, 0 failed, with no exceptions |
| `node scripts/verify-warp.mjs --baseline=<baseline> --previous=<checkout of 6c0c205> --only=default-pose` | 1 passed, 0 failed |
| `node scripts/verify-warp.mjs --baseline=<baseline> --previous=<checkout of a185fc5> --only=moved-others,moved-contain-change,default-pose` | 3 passed, 0 failed |
| `npx tsc --noEmit` | clean |
| `npm test` | 570 unit and 93 Electron tests pass, 0 fail |
| `npm run test:workspace` | 14 passed, 0 failed on the third run of the final code. Runs 1 and 2 stopped at the known "Focus preview" timeout |
| `npm run test:map` | Passed 3 of 3 on the final code. Across this branch's last fixes, 1 of 9 runs failed, and 0 of 4 on baseline; see below |
| `node scripts/verify-colour-time.mjs --baseline=<baseline>` | 52 passed, 0 failed, with no change to its tests |

The final checks:

- **all-presets-neutral:** 102 of 102 baseline presets are byte-identical at phase .9, 960x540. The lowest lit share is 16.42%, so none is blank and no exception is needed.
- **old-file:** a project written by the baseline build holds no warp keys. It opens with 140 new keys at their defaults, and 15 renders are byte-identical.
- **stack:** all five warps with Feedback, Time, Split, Gradient, Glow and Print render non-blank and repeat byte-identically after a seek, on one layer and on two layers using Luma Warp's Layer below. Removing any one effect changes the render.
- **sheet:** 24 sheets cover 76 type and layer pairs.
- **warp-strength:** mean push differs by 1.03x across the Warp types (limit 1.25x).
- **liquid-tear:** 0.002% of pixels on a smooth picture break hard under Chaos (limit 0.01%).

Each new gate was shown to fail on an injected defect:

| Defect | Check | Result |
| --- | --- | --- |
| Warp amount defaults to .01 | all-presets-neutral, old-file | both FAIL |
| A random value reaches the shader on each render | stack | FAIL, seek differs |
| Per-type gains all set to 1 | warp-strength | FAIL, 3.77x |
| Chaos ridge feedback back at .35 | liquid-tear | FAIL, 0.064% |

## Moved layers

Mirror and Polar now work in the layer's own space. They pivot on its transformed centre and follow its turn and scale. Polar's centre controls are offsets from that pivot. A moved Image ends at its own edge, so a fold cannot leave a stray copy beyond it. Source past the frame does not exist, so a pixel whose fold needs it stays unfolded. That edge is the picture's true rectangle: Cover runs past the layer box on one axis, and Contain's transparent bars count as outside the picture, so a mirrored Contain Image folds at its visible edge.

| Check | Covers | Result | Limit |
| --- | --- | --- | --- |
| moved-visible | Every Mirror and Polar mode, 3 poses, including Image at scale .45, x .3 | Left-right lit 19.2%, plain 19.2% (was 0%) | at least half of plain |
| moved-symmetry | Symmetry about the layer's own axes, 2 turned poses | worst .455 of 255 | 1.5 |
| moved-follows | The moved look against the unmoved look carried by the transform, including Unroll | worst .696 of 255 | 2 |
| moved-filter | Mirror reads at 4 mirror angles, 2 poses | spread 0 texels, 0 collapsed | .01 |
| moved-engage | Amount .0001 on a moved layer | worst .0027 of 255 | .05 |
| moved-no-ghost | A layer hanging off the frame under Left-right | 0% lit past its reflected edge | .1% |
| moved-cover | One smooth square Cover Image at Mirror angle 0, 2 poses fully in frame, 960x540 and 720x900. Symmetry is measured on the four Mirror modes and To circle. Unroll has no symmetry and is judged by the other three measures | symmetry .416 of 255, box-edge step 2.70, 100% of the picture lit, 0% stray | 1.5, 12, over 99%, .1% |
| moved-off-frame | Smooth 4:1 and 1:4 Images, Contain and Cover, 480x270 and 360x450, 8 in-frame and partly off-frame poses, every Mirror mode at 0, 45, 160 and -33 degrees, both Polar modes, plus the reported 4:1 Cover pose at 960x540 (1116 cases, after skipping poses with under .5% of the frame lit) | 0 cases under the limit, lowest .963x plain | .8x, no exceptions |
| moved-others-unchanged | 126 renders against `a185fc5`, neutral and all six modes: Surface, Fractal, Liquid and repeated Image at 3 poses, in-frame 16:9 and Cover Images, and Cover and Contain at a default transform | all byte-identical | exact |
| moved-contain-change | Report only: in-frame 4:1, 1:4 and square Contain Images against `a185fc5`, 2 poses | see below | none |
| default-pose-unchanged | 124 Mirror and Polar renders at a default transform, against `6c0c205`, `51c257e`, `9f61b6d` and `a185fc5` | all byte-identical | exact |

Each check was shown to fail: the first three and moved-no-ghost on the code before the fix, moved-filter on a draft whose layer edge spread reads by 2188 texels, moved-engage on an injected .01 offset, default-pose-unchanged on a checkout with its fold line moved (40 of 124 changed), moved-cover on `51c257e` (symmetry 33.623, box-edge step 97.59), and moved-others-unchanged on a checkout with its fold line moved (36 of 126 changed). moved-off-frame failed on `9f61b6d` at 0.000x on the reported 4:1 Cover case. Its expanded form failed on `a185fc5`: 100 of 1116 cases under .8x, lowest .039x (Kaleidoscope at 160 degrees, 1:4 Contain, 360x450).

**In-frame Contain changes, by owner ruling.** Mirror and Polar on a moved Contain Image now fold at its visible edge. Across the 6 fixtures per mode, every render changed from `a185fc5`. Mean change out of 255: Left-right .03, Top-bottom .04, Four-way .04, Kaleidoscope 3.01, To circle 8.84, Unroll 7.42. The lowest lit share moved from .23x to 1.00x on Kaleidoscope, 1.38x to 1.00x on To circle and 1.22x to 1.00x on Unroll, because reads no longer land on the bars and the picture no longer spreads over them.

**Fixtures.** moved-visible, moved-symmetry, moved-follows, moved-engage and moved-no-ghost use one smooth 16:9 Image in a 960x540 frame, at the default Mirror angle. moved-filter feeds a smooth float source at 962x542 and measures the read footprint, not the picture. moved-cover uses one smooth square Cover Image, which overhangs its box vertically at 960x540 and sideways at 720x900. moved-off-frame uses smooth 4:1 and 1:4 Images and measures lit share only, so it proves a picture stays visible, not that its folds are symmetric.

## Retunes

**Warp strength.** At one amount, Waves pushed 3.77 times as far as Magnetic and looked far stronger on the sheets. Each type now has a gain. A push still cannot exceed the amount's ceiling.

| Type | Old gain | New gain | Old mean push | New mean push | New peak |
| --- | --- | --- | --- | --- | --- |
| Waves | 1 | .55 | .681 | .375 | .550 |
| Noise | 1 | 1.6 | .234 | .375 | .806 |
| Ripple | 1 | 1.8 | .238 | .378 | .910 |
| Magnetic | 1 | 2.4 | .181 | .372 | .912 |
| Plasma | 1 | 1.25 | .306 | .383 | 1.000 |

Push is a share of the Warp ceiling, read across the frame at default settings. Waves at amount 1 now peaks at .275 of the frame height rather than .5.

**Liquid Chaos.** Ridge feedback goes from .35 to .2. At .35, Chaos tore into ragged combs on every layer kind. Torn pixels fall from 0.064% to 0.002%. Small ragged patches can still appear at some phases.

**Luma softness, tried and rejected.** Raising the default from .2 to .5 did not clear the grain on Fractal and made Push noisier in the 1080 crop. It stays at .2.

## Verdicts by eye

Judged on rules 2 (reads on a wall), 3 (changes over the loop) and 6 (clean at projector scale) of `docs/effects-improvement-plan-2026-11-12.md`. Amounts: Warp .3, Liquid .4, Luma Warp .4, Polar 1, Mirror 1, all other controls at default. **Weak** passes with a named flaw.

| Type | Surface | Fractal | Liquid | Image |
| --- | --- | --- | --- | --- |
| Warp Waves | Pass: clean, even bends | Pass: strong, lines hold | Pass: cells stretch cleanly | Pass: clear travel |
| Warp Noise | Pass: organic edges | Pass: lines hold | Pass: soft reshaping | Pass: moves clearly |
| Warp Ripple | Pass: rings read | Pass: rings read | Pass: rings read | Pass: rings distort the bands |
| Warp Magnetic | Pass: local pulls read | Pass: local pulls read | Pass: clear lens points | Weak: rule 3, least motion of the Warp types |
| Warp Plasma | Pass: rich movement | Pass: lines hold | Pass: bold shapes | Pass: moves clearly |
| Liquid Swirl | Pass: clean curls | Pass: fine lines hold | Pass: melted cells | Pass: clean curls |
| Liquid Flow | Pass: directional drift | Pass: fine lines hold | Pass: melted cells | Pass: clean drift |
| Liquid Ridge | Pass: sharp folds | Pass: sharp folds | Pass: dense but clean | Pass: sharp folds |
| Liquid Vortex | Pass: clean spiral | Pass: clean spiral | Pass: clean spiral | Pass: clean spiral |
| Liquid Chaos | Weak: rule 6, small ragged patch | Weak: rule 6, small ragged patch | Pass: rag hidden by detail | Weak: rule 6, small ragged patch |
| Luma Push | Pass: bold stepped push | **Fail: rule 6, fine grain** | Weak: rule 6, vertical tearing | **Fail: rule 3, still; stepped breaks** |
| Luma Edges | Pass: layered edges | **Fail: rule 6, grain; rule 2, washed colour** | Weak: rule 6, fine rings | **Fail: rule 3, still** |
| Luma Contours | Weak: rule 6, ragged edges | **Fail: rule 6, grain; rule 2, washed colour** | Weak: rule 6, fine rings | **Fail: rule 3, still** |
| Polar To circle | Pass: bold symmetry | Weak: rule 6, lines pinch at centre | Weak: rule 6, lines pinch at centre | **Fail: rule 3, still** |
| Polar Unroll | Pass: clean strip | Pass: clean strip | Pass: clean strip | **Fail: rule 3, still** |
| Mirror Left-right | Pass: clean fold | Weak: rule 3 holds, little change on a symmetric source | Pass: clean fold | **Fail: rule 3, still** |
| Mirror Top-bottom | Pass: clean fold | Weak: little change on a symmetric source | Pass: clean fold | **Fail: rule 3, still** |
| Mirror Four-way | Pass: clean fold | Weak: little change on a symmetric source | Pass: clean fold | **Fail: rule 3, still** |
| Mirror Kaleidoscope | Pass: strong star | Weak: little change on a symmetric source | Pass: strong pattern | **Fail: rule 3, still** |

The Image failures on rule 3 are expected. Luma Warp, Polar and Mirror have no motion of their own at default, and the test image does not move. Mirror turns per loop can animate it.

**Open failure, needs the owner's acceptance at merge:** Luma Warp over Fractal stays a **Fail**. At amount .4 it breaks fine detail into grain in Push, Edges and Contours. It was not fixed, because the slope gain, minimum reach and nine-read kernel are held by an earlier ruling, and the one default available to change did not help.

## Preview cost

A report, not a gate. Median of four rounds of 60 frames at 1280x720 on a Surface layer, after a warm-up round. Plain ranged from 2.07 to 3.22 ms across rounds, so differences under about 1 ms are within noise.

| Case | ms | Over plain |
| --- | --- | --- |
| Plain | 2.84 | |
| Warp Waves / Noise / Ripple / Magnetic / Plasma | 3.49 / 3.39 / 3.16 / 3.23 / 3.28 | +.65 / +.56 / +.32 / +.39 / +.44 |
| Liquid Swirl / Flow / Ridge / Vortex | 5.29 / 4.94 / 5.09 / 5.11 | +2.46 / +2.10 / +2.25 / +2.27 |
| Liquid Chaos | 6.88 | +4.04 |
| Luma Push / Edges / Contours | 3.80 / 3.80 / 3.83 | +.96 / +.96 / +.99 |
| Polar To circle / Unroll | 3.06 / 2.95 | +.23 / +.11 |
| Mirror Left-right / Top-bottom / Four-way / Kaleidoscope | 3.06 / 3.23 / 2.96 / 3.14 | +.22 / +.39 / +.12 / +.30 |
| The same Mirrors at amount .5 | 3.50 / 3.39 / 3.18 / 3.50 | +.66 / +.56 / +.34 / +.66 |
| Kaleidoscope + Warp, fold lines | 3.71 | +.87 |
| Kaleidoscope at .5 + Warp, fold lines | 4.12 | +1.28 |

## Contact sheets

Git-ignored, in `work/warp-proof/`:

- `sheet-<kind>-<effect>.png`, for kinds `surface`, `fractal`, `liquid`, `image` and effects `warp`, `liquid`, `luma-warp`, `polar`, `mirror`
- `crop-1080-<kind>.png`, one-to-one crops of a 1080 frame
- `sheet-metrics.json`, `warp-strength.json`, `preview-cost.json`
- `baseline-project.formfield`, the project written by the baseline build
- `logs/`, the output of every command above

## Not verified

- **Real footage.** The Image rows use a made-up poster. No video or photograph was tested.
- **A live projector.** Rule 6 was judged from 1080 crops on a screen, not on a wall.
- **Other GPUs.** Every render and timing comes from one Mac. Chaos in particular is sensitive to shader compiler differences.
- **Motion by eye.** Loops were judged from three stills and measured checks. No one watched them play.
- **Preview cost in the full app.** Times measure the renderer alone, on one Surface layer, and not the app's interface or multi-layer projects.
- **Map and Live with warps on.** Their suites pass, but neither was judged by eye with a warp applied.
- **Non-default settings.** The sheets use one working amount per effect. Other scales, step counts and detail levels were not judged by eye.
- **Moved layers by eye.** The moved-layer checks are measured on smooth test Images. No moved layer was judged by eye.
- **Other Image shapes.** Symmetry on Cover was measured with one square picture, fully in frame. 4:1 and 1:4 Images were measured for lit share only. Busy pictures and symmetry on Contain Images with bars were not measured.
- **Moved full-frame generators.** Surface, Fractal and Liquid are compared byte for byte with `a185fc5` when moved, which proves the bounded-Image fixes left them alone. Their moved look itself is not measured for symmetry or judged by eye.
- **Symmetry on partly off-frame Images.** Source past the frame does not exist. A pixel whose Mirror or Polar read needs it stays unfolded, so the picture stays visible but symmetry is incomplete on those pixels. moved-off-frame measures lit share only.
- **One Map failure, unclassified.** One `npm run test:map` run failed two Live checks: "switching the Live look mid-show" and "Live: Glow on the beat", which showed 1 instead of 2.5. It passed on the immediate rerun and did not recur in 7 further branch runs or 4 baseline runs, including runs straight after the workspace check. It could not be attributed to this branch or to baseline.
