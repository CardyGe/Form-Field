# Warp proof

Proof for Warp, Liquid, Luma Warp, Polar and Mirror on branch `warp-engine`, against the baseline at `22339a8`. Run on 2026-11-23 on one Apple Silicon Mac.

## Check results

| Command | Result |
| --- | --- |
| `node scripts/verify-warp.mjs --baseline=<baseline>` | 76 passed, 0 failed, with no exceptions |
| `node scripts/verify-warp.mjs --baseline=<baseline> --previous=<source of 4c746a1>` | 79 passed, 0 failed |
| `node scripts/verify-warp.mjs --baseline=<baseline> --previous=<source of 08061de> --only=others-unchanged,default-pose` | 2 passed, 0 failed |
| `npx tsc --noEmit` | clean |
| `npm test` | 571 unit and 93 Electron tests pass, 0 fail |
| `npm run test:workspace` | 14 passed, 0 failed on the third run of the final code. Runs 1 and 2 stopped at the known "Focus preview" timeout |
| `npm run test:map` | **2 of 3 runs passed on the final code; run 1 failed one check.** See below |
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

## Moved layers and bounded Images

Mirror and Polar work in the layer's own space. They pivot on its transformed centre and follow its turn and scale. Polar's centre controls are offsets from that pivot.

**The picture rule.** An Image shown once is bounded whenever its picture does not fill the frame: when it is moved, or when Contain leaves bars, at any transform. Its picture is one rectangle, defined once in `warpPicture`: Cover runs past the layer box on one axis, and Contain's bars are outside it. For a pixel inside the picture, every Mirror and Polar read resolves to a position safely inside the picture, or the pixel keeps its own position:

1. The read folds back and forth between the picture's true edges.
2. It then moves to the nearest position at least one filtered read inside the edge, so it never mixes in the nothing past the edge. That inset is one texel across a square edge and up to 1.41 texels across a turned one.
3. Each tap of a filtered read is held inside the picture the same way. A tap that would leave the frame uses the read's own centre.
4. The pixel keeps its own position when the read would land off-frame, because source past the frame does not exist, and when a read at the edge has stayed within half a texel of the pixel itself, where it is already exact.

5. With Warp, Liquid or Luma Warp on as well, every position such a pixel then reads is held again: the moved read, its colour fringe, its trail samples and each filter tap. The position is folded into the frame, then folded and held inside the picture, twice over, because a picture that runs past the frame can send the first result back off it. One that still leaves the frame falls back to the last safe position from steps 1 to 4. Luma Warp's driver, when it comes from this layer, is read through the same hold. With no later warp on, step 5 does nothing.

Pixels outside the picture take no fold, so no stray copy appears there. With Mirror and Polar off, the rule does not run, and a later warp bends a bounded Image's outline as before. Full-frame Images, repeated Images and other layer kinds do not use the rule.

**To circle's second cause.** With step 2 alone, every Mirror case in picture-solid was clean and 265 Polar cases still failed, with a lowest value of 0. Those were To circle and Unroll in every variant, alone and with Kaleidoscope. Polar squeezes many texels into one pixel, most of all toward the middle of To circle, so the four taps of a filtered read spread well past any fixed inset and landed on nothing. Step 3 cleared all of them. Where in the picture the dim pixels sat was not mapped.

| Check | Covers | Result | Limit |
| --- | --- | --- | --- |
| moved-visible | Every Mirror and Polar mode, 3 poses, including Image at scale .45, x .3 | Left-right lit 19.2%, plain 19.2% | at least half of plain |
| moved-symmetry | Symmetry about the layer's own axes, 2 turned poses | worst .401 of 255 | 1.5 |
| moved-follows | The moved look against the unmoved look carried by the transform, including Unroll | worst .476 of 255 | 2 |
| moved-filter | Mirror reads at 4 mirror angles, 2 poses | spread 0 texels, 0 collapsed | .01 |
| moved-engage | Amount .0001 on a moved layer | worst .0027 of 255 | .05 |
| moved-no-ghost | A layer hanging off the frame under Left-right | 0% lit past its reflected edge | .1% |
| moved-cover | One smooth square Cover Image at Mirror angle 0, 2 poses fully in frame, 960x540 and 720x900. Symmetry is measured on the four Mirror modes and To circle. Unroll has no symmetry and is judged by the other three measures | symmetry .378 of 255, box-edge step 2.71, 100% of the picture lit, 0% stray | 1.5, 12, over 99%, .1% |
| picture-visible | Smooth 4:1 and 1:4 Images, Contain and Cover, 480x270 and 360x450, the default transform and 8 in-frame and partly off-frame poses, every Mirror mode at 0, 45, 160 and -33 degrees, both Polar modes, plus the reported 4:1 Cover pose at 960x540 (1260 cases, after skipping poses with under .5% of the frame lit) | 0 cases under the limit, lowest 1.000x plain | .8x, no exceptions |
| picture-solid | Solid white 1:1, 4:1 and 1:4 Images, Contain and Cover, 960x540 and 360x450, 5 poses (the reported pose, the default transform, one small turned pose, two partly off-frame), every Mirror mode at 4 angles, both Polar modes, To circle twisted, off centre and at half amount, Unroll twisted, and Kaleidoscope with To circle (1380 cases). Every pixel the plain picture lights is counted, not only the interior | 0 cases with a dim pixel, lowest value 239 of a plain peak of 240 | every pixel at least .9x the plain peak, 0 pixels under |
| mirror-symmetry, Contain rows | The busy 16:9 picture on Contain in a 720x900 frame at the default transform, under the three flips. The flip is compared pixel for pixel inside a 2-pixel rim, and the kept side against plain to its last pixel | flips off by 1 of 255, kept side off by 0 | 2 |
| picture-later | Mirror or Polar with a later warp on top: 4:1 and 1:4 Images, Contain and Cover, the default transform, 2 poses centred in the frame and 4 pushed partly off it at 480x270, plus 1:4 Contain at the default transform at 960x540. All six modes, each with Warp Noise .15, Warp Waves .3 with colour fringe, Warp Plasma .3, Liquid Swirl .4, Liquid Flow .4 with trail, Liquid Chaos .5, Luma Warp .3, and Luma Warp .3 on top of Warp Noise and of Liquid Swirl (1458 cases). Lit share is read on a smooth picture. Hard steps are read on a solid white one: the share of visible picture pixels more than 64 of 255 from a neighbour in the picture | 0 cases under the limit, lowest 1.000x plain; 0 cases with more hard steps than the fold alone, and 0% in every case | .8x plain; no more hard steps than Mirror or Polar alone |
| picture-later, busy picture | The same 1458 cases on a busy picture. **Reported, not required** | 506 cases have more hard steps than the fold alone, 300 of them at the default transform and the two centred poses | none; see below |
| later-steps-control | Report only. A full-frame 16:9 Image, where the picture rule never runs, under the six modes and the same nine later warps (54 cases each) | busy picture: 52 of 54 cases have more hard steps than the fold alone, the most 52.66% against 0%. Smooth picture: 6 of 54, the most .10% | none |
| picture-hold | Read from the shader, not the picture: for each pair of neighbouring held pixels, how much further apart the hold leaves their reads than the later warp did. A frame-shaped Image at 2 in-frame and 4 partly off-frame poses, 480x270, six modes, the nine later warps (324 cases) | 0 cases with a pair pulled more than 3 texels further apart; widest .4 texels | 3 texels, 0 pixels over |
| picture-driver | Read from the shader: Luma Warp .3 driven by this layer, on top of Warp Noise, Warp Plasma or Liquid Swirl, six modes, a solid frame-shaped picture square to the frame at one in-frame and one partly off-frame pose (36 cases). The driver is the same everywhere on a solid picture, so Luma must move every held pixel alike | Luma's move runs from 40.4 to 40.6 texels over every held pixel | no held pixel more than 2 texels short of the largest move |
| others-unchanged | 284 renders against `4c746a1`, and again against `08061de`. Under neutral and all six modes: a 16:9 Image and a square Cover Image at the default transform, and Surface, Fractal, Liquid and a repeated Image at the default transform and 3 poses. Under neutral, Warp, Liquid and Luma Warp only: moved 16:9 and Cover Images, and a Contain Image with bars at the default transform and 2 poses. Under Mirror or Polar with no later warp: 4:1 and 1:4 Images, Contain at the default transform and 2 poses and Cover at 2 poses, in 13 looks (the six modes, To circle twisted, off centre and at half amount, Unroll twisted, Kaleidoscope with To circle, Kaleidoscope at 160 degrees, Left-right at half amount) | all byte-identical | exact |
| picture-change | Report only: 4:1, 1:4 and square Images, Contain and Cover, at the default transform and 2 in-frame poses, under Mirror or Polar alone, against the previous commit | 0 of 108 changed against `4c746a1` and `08061de`; the change from `c4009b7` is below | none |
| default-pose-unchanged | 124 Mirror and Polar renders of full-frame layers at a default transform, against `4c746a1`, `08061de` and `c4009b7` | all byte-identical | exact |

Each check was shown to fail. moved-visible, moved-symmetry, moved-follows and moved-no-ghost failed on the code before the pivot. moved-filter failed on a draft whose layer edge spread reads by 2188 texels, moved-engage on an injected .01 offset, and moved-cover on `51c257e` (symmetry 33.623, box-edge step 97.59). picture-visible failed on `c4009b7`: 15 of 1260 cases under .8x, lowest .205x (Kaleidoscope at 160 degrees, 1:4 Contain, 360x450, default transform). picture-solid failed on `c4009b7`: 935 of 1380 cases, up to 97.35% of the picture dim, lowest value 0. The Contain rows of mirror-symmetry failed on an injected .01 offset in the picture fold (flips off by 232, kept side by 239), and the kept side failed on a draft without step 4's own-pixel clause (off by 151). others-unchanged failed against a copy of `c4009b7` with its fold line moved (36 of 154 changed), and its Mirror-or-Polar-alone rows failed on a draft of step 5 that also re-held reads with no later warp on (34 of 284 changed). picture-later failed on `08061de` on both counts, in its first form of 546 cases: 39 under .8x plain, lowest .087x (Top-bottom with Luma Warp .3, 4:1 Contain, x .18), and 432 cases with more hard steps than the fold alone, the most 32.59% of the picture (To circle with Warp Plasma .3, 1:4 Contain, x .18). picture-hold failed on `4c746a1`: 180 of 324 cases, all at the four partly off-frame poses and none at the in-frame ones, with reads pulled up to 66.0 texels apart. With one fold pass in place of two it still failed 18 cases, all at the pose lying mostly off the frame (x -.75). picture-driver failed on `4c746a1` in 36 of 36 cases: up to 20.77% of held pixels, with Luma's move running from 0 to 40.6 texels.

**Why the busy picture is not a requirement.** The count asked for was hard steps inside the visible picture on a busy picture, no higher than with Mirror or Polar alone. No hold can meet that, because a later warp raises that count on busy detail by itself. later-steps-control shows it on a full-frame Image, where the picture rule never runs: 52 of 54 cases rise, as far as 52.66% of the frame against 0%. Luma Warp is driven by the picture's own tone, so on busy detail it breaks the picture up by design, and Warp and Liquid squeeze detail until neighbours differ. So the count cannot tell a torn read from the warp's own work. On `4c746a1` it stood at 709 of 1458 cases, 341 of them at the default transform and the two centred poses, where picture-hold found no tear at its own in-frame poses; it now stands at 506 and 300. picture-hold measures the tear itself, as distance between reads, and that is the requirement.

**What changed from `c4009b7`, by owner ruling.** From picture-change run at `08061de`, as mean change out of 255 over all six modes: moved Contain .03 (36 of 36 renders changed, most .06), moved Cover .06 (36 of 36, most .14), Contain at the default transform 20.16 (18 of 18, most 75.81 on To circle), Cover at the default transform 0 (0 of 18). On Contain at the default transform the lowest lit share rose from .22x to 1.00x plain. Moved pictures change by the inset and the held taps. Unmoved Contain pictures change because they now fold at their own edge and not the frame's.

**Fixtures.** moved-visible, moved-symmetry, moved-follows, moved-engage and moved-no-ghost use one smooth 16:9 Image in a 960x540 frame, at the default Mirror angle. moved-filter feeds a smooth float source at 962x542 and measures the read footprint, not the picture. moved-cover uses one smooth square Cover Image, which overhangs its box vertically at 960x540 and sideways at 720x900. picture-visible measures lit share only, so it proves a picture stays visible, not that its folds are symmetric. picture-solid proves no read touches nothing; a solid picture cannot show whether the right part of the picture was read.

**Two full-frame checks changed fixture.** mirror-symmetry and polar-shape run in a 720x900 frame as well as 960x540. They used the 16:9 test picture there, which on Contain has bars and is now a bounded Image. Their full-frame rows now use a picture of the frame's own shape, with the same limits, and mirror-symmetry gained the Contain rows above. The probe helper that feeds a frame-filling source now declares that source as the frame's shape.

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
- **Other Image shapes.** Symmetry on Cover was measured with one square picture, fully in frame. Symmetry on Contain with bars was measured with one busy 16:9 picture at the default transform under the three flips. 4:1 and 1:4 Images were measured for lit share and for dim pixels only. Symmetry of Kaleidoscope and Polar on a Contain Image with bars, and of any fold on a moved busy picture, was not measured.
- **The picture's rim.** Within about a texel and a half of a bounded Image's edge, and of each crease where a fold meets that edge, a read is moved inward by up to that much. So symmetry there is approximate, and a rim pixel's read can step by up to about two texels as an amount passes the point where the read leaves its own pixel. Neither was measured on a busy moved picture or judged by eye.
- **Pictures with their own transparency or soft edges.** The rule keeps reads inside the picture's rectangle. Transparency inside the picture, a layer mask, and softening by Feedback or Time before the warp are not covered by picture-solid.
- **Bounded Images with Mirror or Polar and a later warp together.** picture-later measures lit share on a smooth picture and hard steps on a solid one, and picture-hold measures tears as distance between reads. None shows whether the later warp's bend looks right where it folds back at the picture's edge or the frame's; that was not judged by eye. picture-hold and picture-driver use a frame-shaped picture only, at 480x270, and picture-driver only poses square to the frame. A read that still leaves the frame after two fold passes falls back to the last safe position, which is a jump; no fixture reached that case, and it is not proved impossible. Luma Warp's Layer below source and Luma's Edges and Contours modes were not in these checks. With the driver held, the picture's own edge no longer shows up in Edges and Contours as an edge for held pixels.
- **Mirror between 0 and 1 with a later warp.** Mirror's amount crossfades a mirrored read with a plain one. The plain one is not held, so a later warp still bends its outline, and at part amount that shows through in proportion. No check covers it.
- **Moved full-frame generators.** Surface, Fractal and Liquid are compared byte for byte with `c4009b7` when moved, which proves the bounded-Image fixes left them alone. Their moved look itself is not measured for symmetry or judged by eye.
- **Symmetry on partly off-frame Images.** Source past the frame does not exist. A pixel whose Mirror or Polar read needs it stays unfolded, so the picture stays visible but symmetry is incomplete on those pixels. picture-visible measures lit share only.
- **Map failures, unclassified.** On the final code `npm run test:map` ran three times with no other test window open: failed, passed, passed. Run 1 failed one check, "a border run lights only part of the border, and the lit part goes round": only 9 of 16 places were ever lit. On the commit before (`4c746a1`) the suite failed 2 of 5 runs here while a second Electron window from this worktree was open, with different checks failing each time (a closed page in one run, a click timeout in "Finish in the Effect tab" in the other), and the controller then passed 3 of 3 with that window closed. Earlier on this branch one of 10 runs failed two Live checks, against 0 of 4 on baseline. No two failing runs failed the same way, the warp shader changes under test run only for a bounded Image under Mirror or Polar, which no Map check uses, and none of this proves the cause. The suite was not run repeatedly on baseline for comparison in this round.
