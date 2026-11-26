# Signal proof

Proof for VHS, Dropout, CRT, JPEG damage and Databend on branch `signal-path`, against the baseline at `6f2bfb7` (the `material-tiles` branch, which already has LED wall, Characters, Tiles and Warp). Run on 2026-11-26 on one Apple Silicon Mac. The render checks live in `scripts/verify-signal-path.mjs`; `scripts/verify-signal.mjs` is Signal Melt's and was not touched.

## Check results

Every result is listed, reruns included. "Final code" is the committed code; the mutation runs below were made on top of it and undone.

| Command | Result |
| --- | --- |
| `node scripts/verify-signal-path.mjs --baseline=<baseline>` (first full run) | 47 passed, 1 failed. The failure was `all-presets-neutral`: `meridian-evolve-orrery` differed once. See below |
| Same, after the final-review fixes (whole counts not animatable, 24-bit hash fractions, packed JPEG step table, two more cost cases) | **48 passed, 0 failed**, one full run, 175 of 175 presets byte-identical |
| `... --baseline=<baseline> --current=<baseline> --only=all-presets` (baseline against itself, ten times) | passed ten times, 175 of 175 byte-identical; `meridian-evolve-orrery` never differed |
| `... --only=all-presets` (twice) | passed both times, 175 of 175 byte-identical |
| `... --only=jpeg,bend,all-presets` (the heavy checks first, as in the full run) | 21 passed, 0 failed |
| `... --baseline=<this branch> --only=all-presets` (the branch against itself, three times) | passed all three times |
| `... --only=sheet` (again, after the mutation runs had overwritten the sheets) | passed |
| `npx tsc --noEmit` | clean |
| `npm test` | 1562 unit and 106 Electron tests pass, 0 fail; after the final-review fixes 1565 unit and 106 Electron, 0 fail |
| `npm run test:workspace` | 14 passed, 0 failed, first run (no "Focus preview" timeout); again after the final-review fixes: 14 passed, 0 failed, first run |
| `npm run test:map` | 70 ok, 0 FAIL, first run; again after the final-review fixes: 70 ok, 0 FAIL, first run |
| `node scripts/verify-print.mjs` | run 1 failed its speed gate: `cmyk-edges-flat` 20.7 ms per 1080p frame (limit 16.7). Runs 2 and 3 passed (15.5 and 16.5 ms). The baseline checkout, run once for comparison, passed at 15.7 ms. Print is unchanged on this branch and the signal pass does not run with every amount at 0; the gate has little headroom on this Mac |
| `node scripts/verify-tiles.mjs --baseline=<baseline>` | 39 passed, 1 failed: `old-file`, by design. See below |
| `node scripts/verify-warp.mjs --baseline=<baseline>` | 76 passed, 0 failed, first run |
| `node scripts/verify-colour-time.mjs --baseline=<baseline>` | 52 passed, 0 failed |

**The one Meridian difference.** In the first full run, `meridian-evolve-orrery` rendered differently from the baseline once. It did not happen in the six runs after it, nor in the final full run after the review fixes (48 of 48, 175 of 175 byte-identical). To see whether the baseline alone does this, the harness gained `--current=<checkout>`, which builds the "current" side from another checkout: `--baseline=<baseline> --current=<baseline> --only=all-presets` compares the baseline with itself. Run ten times, `all-presets-neutral` passed ten times, 175 of 175 byte-identical, with `meridian-evolve-orrery` never differing (0 of 10). So a baseline-against-baseline difference was not reproduced either, and the single difference was not reproduced in 17 runs of the branch or baseline in all. Every signal amount is 0 on presets, so the signal pass does not run for it. Conclusion: one unexplained, unrepeatable difference, most likely a one-off in Meridian's own render (this branch changes nothing it draws), at a rate below roughly 1 in 10 to 1 in 20 runs. Not proven, and the cause was not found.

**verify-tiles `old-file` against this baseline.** That check was written for a baseline from before Tiles, and requires the old file to hold no LED, Characters or Tiles keys. This baseline already has Tiles, so the file holds 104 of them and the check fails on that clause alone. Its other clauses held: 144 new keys filled in, 0 off default, 15 renders byte-identical. The signal path's own `old-file` covers an old Tiles and Warp file.

The final checks:

- **all-presets-neutral:** 175 of 175 baseline presets are byte-identical at phase .9, 960x540. The lowest lit share is 1.15%, so none is blank (limit .5%).
- **old-file:** the baseline build writes a project of four layers with LED wall, Characters, two Tiles layers and all five warps (Warp, Liquid, Luma Warp, Polar, Mirror) on. It goes to disk and back as `work/signal-proof/baseline-project.formfield`. The file holds no signal keys; opening it fills in 144 at their defaults, none off default. All 15 renders (all layers and each layer alone, at three phases) are byte-identical in both builds.
- **stack:** all five signal effects with LED wall, Warp, Split, Gradient, Glow, Feedback and Time on one Surface layer: 12 effects on, at least 87.1% lit at three phases, byte-identical after seeking away and back, and taking out any one effect changes the render.
- **sheet:** 33 sheets (24 contact sheets, 4 crops at 1:1 from a 1080 frame, 5 eye-review sheets) cover 104 choice and layer pairs: every VHS level (amount .4, defaults, heavy), every Dropout fill, every CRT mask, three JPEG qualities, every Databend mode on Wrap and every mode that has a direction on Across and Down, each on Surface, Fractal, Liquid and Image at three phases. Gates: brightness against plain at least 40% (CRT and JPEG damage 60%); lowest seen VHS 101.4%, Dropout 83.1%, CRT 75.9%, JPEG damage 99.2%, Databend 99.6%. No stage under 5% lit on any phase or under a 2/255 mean. Every choice differs from plain by over 1/255 on 120x68 thumbnails.
- **preview-cost:** report only, below.

Each new gate was shown to fail on an injected defect, then the defect was removed:

| Defect | Check | Result |
| --- | --- | --- |
| VHS amount defaults to .01, not 0 | all-presets-neutral, old-file | both FAIL: dozens of presets changed; old-file 15 of 15 renders changed |
| The CRT stage is dropped from the pass | stack, sheet | both FAIL: stack names `crtAmount` as having no effect; sheet lists all 16 CRT rows as no change from plain (0.00) |
| CRT brightness defaults to .5, not 1.3 | sheet | FAIL: all 16 CRT rows too dim, 46.2% to 50.4% of plain (limit 60%) |
| Signal sliders ignore the locked shape (`readOnly={false}`) | test:map, the strengthened read-only check | FAIL: "VHS has a slider that is not disabled while locked: VHS, Tracking wobble, ...". The failed check left the shape locked, so 12 later Map checks failed after it; all 70 pass on the real code |

## Retunes

| Control | Old default | New default | Why |
| --- | --- | --- | --- |
| Databend `databendDepth` (Depth) | .5 | .25 | At .5, Corrupt flips each bit of the 8-bit colour with even chance, which is pure noise: on every layer kind the picture was gone (grey static on Surface and Image, a grey wash on Fractal and Liquid). At .25 the picture's bands and edges stay readable under the corruption. Depth is shared, so the other modes change too. Comb's delay swing is smaller and looks much the same. Stutter jumps a quarter of its grains, not half: still clear on Surface and Image, fainter on Fractal and Liquid (thumbnail change 7 to 9 of 255, was 14 to 18). Fold's gain drops from 4.5 to 2.75, which folds dark sources up further: Fractal and Liquid go from 2.4 and 2.2 times plain's brightness to 2.7 and 3.0. Both were Weak before and stay Weak. Echo has no Depth. |
| VHS thumbnail recipe (`scripts/make-finish-thumbs.mjs`) | the shared source with VHS heavy | the source turned to Direction 1.2, Colour bleed 1, Noise bands 1, Tape age .6, Rolling bar 1 | The old card was wavy horizontal bands, so sideways wobble and torn rows ran along the bands and the card read as a soft wavy pattern, not tape. Turned near upright, the bands are cut by jagged rows and torn lines and it reads as tape at 240 px. Only `src/ui/assets/finish/vhs.jpg` was rewritten (`--only=vhs`; the other 23 thumbnails are byte-identical by md5). |

The sheet's middle JPEG level moved from Quality .5 to Quality .35. This is a sheet choice, not a default: on the first run Quality .5 on Surface changed the 120x68 thumbnails by .97/255, under the 1/255 gate. That is a true reading. At mid quality JPEG damage on a smooth source is close to plain, and Quality 1 is plain by design.

Nothing else was retuned. The checks the Depth change could reach were run again after it: the full `verify-signal-path.mjs`, `npm test` and the workspace and Map UI runs above all ran on the final code.

## Verdicts by eye

Judged on rules 2 (reads on a wall), 3 (changes over the loop) and 6 (clean at projector scale) of `docs/effects-improvement-plan-2026-11-12.md`, from the sheets and crops in `work/signal-proof/` (which stays out of git). Each effect at full amount, other controls at default, Dropout at chance .5.

**Cutoffs:**

- **Pass:** the effect reads as itself at preview size (960x540) on every layer kind, it changes across the three phases wherever the effect has motion of its own, and the 1:1 1080 crop shows no shimmer, stray seams or detail finer than the effect intends.
- **Weak:** it passes rule 2 on at least half the layer kinds but reads faintly on the others, or it reads clearly only in the 1:1 crop and faintly at preview size, or it breaks rule 3 or 6 only in a way the effect intends (a mask or grain pitch under 4 px, a still look on a still Image), or a named flaw shows on one kind. Weak passes with the flaw named.
- **Fail:** the picture is lost or the effect does not read on more than half the layer kinds, or it breaks a rule in a way nobody would choose. A Fail at a default is retuned.

| Choice | Surface | Fractal | Liquid | Image |
| --- | --- | --- | --- | --- |
| VHS amount .4 | Pass | Pass | Pass | Weak: rule 3, light tearing is the only change on a still image |
| VHS defaults | Pass: jagged rows, smear, fade, torn bottom edge | Pass | Pass | Pass: the tears change every frame |
| VHS heavy | Pass | Pass | Pass | Pass |
| Dropout Black, Noise, Hold line | Pass | Pass | Pass | Pass. Band edges are hard by design |
| CRT None | Pass | Pass | Pass | Weak: rule 3, still on a still image |
| CRT Stripes, Slots, Dots | Weak: rule 6, the mask pitch is under 4 px at 1080 by design; it fades flat under 2 px so it never shimmers | Weak: same | Weak: same | Weak: same, and rule 3 |
| JPEG Quality 0 and .2 (default) | Weak: rule 2, clear block steps on edges at 1:1, faint at preview size | Weak: same | Weak: same | Weak: same, and rule 3 |
| JPEG Quality .35 | Weak: as above, fainter | Weak | Weak | Weak |
| Databend Echo | Pass | Pass | Pass | Weak: rule 3, still on a still image |
| Databend Comb | Pass | Pass | Pass | Pass: the sweep moves |
| Databend Fold | Pass: bold new bands | Weak: rule 2, washes a dark source pale (2.7x plain's brightness) | Weak: same (3.0x) | Weak: rule 3 |
| Databend Stutter | Pass | Weak: rule 2, faint on fine detail | Weak: same | Pass: jumps move |
| Databend Corrupt (Depth .25) | Weak: rule 6, fine bit noise by design | Weak: same | Weak: same | Weak: same, and rule 3 |
| Databend Across (Echo, Comb, Stutter, Corrupt) | as Wrap | as Wrap | as Wrap | as Wrap |
| Databend Down (Echo, Comb) | Pass | Pass | Pass | Weak: rule 3 |
| Databend Down (Stutter, Corrupt) | Weak: rule 6, one-pixel vertical streaks | Weak: same | Weak: same | Weak: same |

No Fail remains. The one Fail was Databend Corrupt at the old default Depth .5, on every kind: the picture was gone. It is retuned above.

## Open items from earlier reviews

1. **CRT at a 960 preview: Pass.** `eye-crt-960.png` shows the full preview and a 2x inset. At Mask size 5 (2.5 preview pixels a cell), Stripes reads as a phosphor mask, and Slots and Dots read as finer grids. Curved glass, black surround and dark corners make it read as a tube at a glance. The 480 default scan lines are 1.1 preview pixels apart, so they fade flat on a 960 preview as designed (crt-lines proves them at 1080 and 4K). At projector scale the mask is Weak on rule 6, as above.
2. **JPEG Quality on gradients: Weak, not retuned.** `eye-jpeg-gradient.png`: on a soft gradient, Quality 0 and the default .2 look the same as plain at 1:1. The block mean step cap of 3/255 is under what the eye sees there. On the poster's hard edges the 8-pixel block stairs show clearly. At preview size on every layer kind JPEG damage reads faintly (thumbnail change 2.5 to 4.8 of 255, against 16 to 28 for VHS defaults). Under the cutoffs this is Weak, not Fail: it reads at 1:1 on every kind. The cap holds `jpeg-alpha`'s limit of no brighter than the source plus 4/255. Raising it is a design change for the owner, not a default retune. A larger default Block size (16) reads much more clearly in a scratch render.
3. **Databend Corrupt at default Depth .5: Fail, retuned to .25.** At .5 each bit is flipped with even chance, which is uniform noise (`eye-databend-corrupt.png`). At .25 the bands and rings read through the damage on every kind. Depth 1 flips every bit, which inverts the picture cleanly, so the control rises to noise at .5 and falls back to an invert at 1. **Corrupt at Split 0: Pass.** The channels share one mask, so flips go grey-white where all three flip together (most visible in the black bands of Surface). Split 1 breaks into colour. Both are distinct, usable looks.
4. **VHS at defaults reads as tape: Pass.** `eye-vhs-defaults.png`: jagged wobbling rows, smeared colour, a faded and warmer picture and a torn strip at the bottom, on all four kinds. The weak part was its card, now retuned (see Retunes).
5. **Torn VHS rows, preview against export on hard edges: Pass.** `eye-vhs-torn-rows.png` shows the poster with Tracking wobble .8 at 960, the 3840 export averaged down 4x4, and their difference times 4. The two look the same. The difference sits only on hard edges, one pixel wide: mean 1.67/255, 3.2% of pixels over 8/255, worst 126.8/255. That is the deferred whole-pixel rounding: a row moved by a whole 4K pixel can land a quarter of a preview pixel from the preview's row on a hard edge. It is not visible at viewing size.

## Preview cost

A report, not a gate. A Surface layer, each frame forced to finish on the GPU. Each case runs once in each of 4 rounds, the first only warms, and the median of the other 3 is shown, in ms per frame, with the difference from plain. 60 frames a round at 1280x720 and 1920x1080, 30 at 3840x2160. Plain's range across rounds (in brackets) shows the noise: differences under about .5 ms at 720 and 2 ms at 4K are within it.

| Case | 1280x720 | 1920x1080 | 3840x2160 |
| --- | ---: | ---: | ---: |
| Plain | 3.29 (3.26 to 3.34) | 4.66 (4.56 to 4.96) | 13.13 (12.75 to 13.46) |
| VHS (defaults) | 3.94 (+0.65) | 6.49 (+1.83) | 23.44 (+10.31) |
| VHS Colour bleed 1 | 4.23 (+0.94) | 7.76 (+3.10) | 31.17 (+18.04) |
| Dropout (defaults) | 3.61 (+0.31) | 4.96 (+0.29) | 13.59 (+0.46) |
| Dropout Hold line, 20 bands, burst 8 | 3.64 (+0.35) | 5.47 (+0.81) | 15.33 (+2.20) |
| CRT (defaults) | 3.53 (+0.23) | 5.39 (+0.73) | 14.58 (+1.45) |
| CRT Dots, 1080 lines, curve .5 | 3.52 (+0.23) | 5.22 (+0.56) | 14.29 (+1.16) |
| JPEG damage (defaults) | 6.38 (+3.09) | 9.05 (+4.39) | 20.93 (+7.80) |
| JPEG damage Block 4 | 5.92 (+2.63) | 8.80 (+4.13) | 27.28 (+14.15) |
| Databend Echo (defaults) | 3.85 (+0.56) | 5.95 (+1.29) | 17.22 (+4.09) |
| Databend Echo Repeats 8 Split 1 | 4.20 (+0.91) | 7.07 (+2.41) | 20.28 (+7.15) |
| All five (defaults) | 8.39 (+5.09) | 12.77 (+8.10) | 35.99 (+22.86) |
| All five, heaviest | 8.35 (+5.06) | 14.41 (+9.75) | 50.68 (+37.55) |

All five at their defaults add about 5 ms at 720p, 8 ms at 1080p and 23 ms at 4K. VHS Colour bleed is the most costly single control at 4K (+18 ms at 1). JPEG damage costs about the same at every size because its block grid is set by Block size; Block 4 is the worst at 4K (+14 ms). Databend Echo stays under +8 ms at 4K even with Repeats 8 and Split 1. The two heaviest common cases added after review stay small: Dropout with Hold line, 20 bands and burst 8 adds +2.2 ms at 4K (+0.8 at 1080p), and CRT with Dots, 1080 lines and curve .5 adds +1.2 ms at 4K (+0.6 at 1080p), so neither is a cost worry. A 4K preview with all five at their heaviest common settings runs at about 20 frames a second on this Mac (50.7 ms a frame).

## Live set at 4K

Measured at 4K (3840x2160) on this one Apple Silicon Mac, in the run above:

- All five effects at their defaults add about 23 ms a frame per layer (22.9 ms measured; the earlier run gave 21.6 ms). The heaviest common settings add about 38 ms (37.6 ms measured). VHS Colour bleed at 1 alone adds about 18 ms.
- A frame has about 33 ms at 30 frames a second and about 17 ms at 60. Plain 4K is already 13 ms here, so **two layers with signal effects at 4K drop below 30 fps**, and one layer with all five at the heaviest settings is about 20 fps. For a live set at 4K, run one signal layer, and only the effects it needs, or work at 1080p, where all five at defaults add about 8 ms.
- Memory per 4K Map slot: about 130 MB, and a JPEG damage layer adds 50 to 200 MB while it is on (Block 8 about 47 MB, Block 4 about 142 MB at 4K in the `jpeg-cost` and `jpeg-shrink` checks). Several 4K slots with JPEG damage on can reach a gigabyte or more.

## Not verified

- Cost on any machine but this one Apple Silicon Mac, and in the packaged app's live preview rather than the render harness.
- A projector. Rule 6 was judged from 1:1 crops of 1080 frames on a monitor.
- The cause of the single `meridian-evolve-orrery` difference (not reproduced in ten baseline-against-baseline runs or in the later branch runs).
- Every combination of controls: the sheets cover each choice with other controls at default, plus the stack.
- Live and Perform outputs: unchanged by design and not rerun here (`npm run test:live` and `test:perform` were not run).
- The new VHS card was judged at 240 px in this session only; the owner has not seen it.
