# Warp proof

Proof for Warp, Liquid, Luma Warp, Polar and Mirror on branch `warp-engine`, against the baseline at `22339a8`. Run on 2026-11-23 on one Apple Silicon Mac.

## Check results

| Command | Result |
| --- | --- |
| `node scripts/verify-warp.mjs --baseline=<baseline>` | 69 passed, 0 failed |
| `node scripts/verify-warp.mjs --baseline=<baseline> --previous=<checkout of 6c0c205> --only=default-pose` | 1 passed, 0 failed |
| `npx tsc --noEmit` | clean |
| `npm test` | 570 unit and 93 Electron tests pass, 0 fail |
| `npm run test:workspace` | 14 passed, 0 failed on the final code, first run. The known "Focus preview" timeout stopped two earlier runs during this fix, on intermediate code |
| `npm run test:map` | MAP CHECK PASSED |
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

Mirror and Polar now work in the layer's own space. They pivot on its transformed centre and follow its turn and scale. Polar's centre controls are offsets from that pivot. A moved Image ends at its own edge, so a fold cannot leave a stray copy beyond it.

| Check | Covers | Result | Limit |
| --- | --- | --- | --- |
| moved-visible | Every Mirror and Polar mode, 3 poses, including Image at scale .45, x .3 | Left-right lit 19.2%, plain 19.2% (was 0%) | at least half of plain |
| moved-symmetry | Symmetry about the layer's own axes, 2 turned poses | worst .455 of 255 | 1.5 |
| moved-follows | The moved look against the unmoved look carried by the transform, including Unroll | worst .696 of 255 | 2 |
| moved-filter | Mirror reads at 4 mirror angles, 2 poses | spread 0 texels, 0 collapsed | .01 |
| moved-engage | Amount .0001 on a moved layer | worst .0027 of 255 | .05 |
| moved-no-ghost | A layer hanging off the frame under Left-right | 0% lit past its reflected edge | .1% |
| default-pose-unchanged | 124 Mirror and Polar renders at a default transform, against `6c0c205` | all byte-identical | exact |

Each check was shown to fail: the first three and moved-no-ghost on the code before the fix, moved-filter on a draft whose layer edge spread reads by 2188 texels, moved-engage on an injected .01 offset, and default-pose-unchanged on a checkout with its fold line moved (40 of 124 changed).

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
- **Moved layers by eye.** The moved-layer checks are measured on a smooth Image. No moved layer was judged by eye.
- **Moved full-frame generators.** Surface, Fractal and Liquid use the same pivot, but the moved-layer checks do not render them.
- **Reflections of off-frame picture.** The source holds only what is inside the frame. Where a fold needs a part of a moved Image that hangs off the frame, it shows a reflection of the picture at the frame edge, not the hidden part.
