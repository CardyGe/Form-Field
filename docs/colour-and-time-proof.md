# Colour and Time proof

Run on 2026-11-22 on branch `colour-time-engines`, against the baseline checkout at `4a8acdd`.

## Result

- All 52 checks in `scripts/verify-colour-time.mjs` pass, with none skipped.
- 102 of 102 presets are byte-identical to the baseline at phase .9, 960x540.
- A project saved by the baseline build opens in the new build. All 15 renders are byte-identical.
- Seven of the eight planned looks are kept. **Edge Prism was removed**, and Anamorphic and Long Exposure were retuned.
- One known weak case remains: Anamorphic on Fractal. The `looks-sheet` gate names it and fails on any other weak result.
- The Long Exposure hairlines are fixed in the renderer.
- The workspace UI check is intermittent, and it fails the same way on the baseline. See [Workspace UI](#workspace-ui).
- `verify-print.mjs` has a frame-time limit that failed once in three runs after the final review fixes. See [Print timing](#print-timing).

## Checks

| Command | Result |
| --- | --- |
| `node scripts/verify-colour-time.mjs --baseline=<baseline>` | 52 passed, 0 failed |
| `npx tsc --noEmit` | Pass |
| `npm test` | 631 pass, 0 fail: 538 unit tests and 93 Electron tests |
| `npm run test:workspace` | Passed first time after the final review fixes; intermittent, see [Workspace UI](#workspace-ui) |
| `node scripts/verify-glow.mjs` | Pass |
| `node scripts/verify-print.mjs` | Fail, pass, pass; see [Print timing](#print-timing) |

After the final Step 2 run, only the `stats-alpha` reference in `scripts/verify-colour-time.mjs` changed, so that script and `tsc` were run again.

### Workspace UI

Every failure is the same timeout, waiting for the "Focus preview" button at `scripts/verify-workspace-ui.mjs:126`.

| Build | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| This branch | Pass | **Fail** | Pass |
| Baseline `4a8acdd` | **Fail** | **Fail** | Pass |

The timeout is pre-existing, since the baseline fails it too. Its cause was not diagnosed and it was not fixed. The final Step 2 run on this branch failed once more and then passed. Earlier, before the fixes, the branch also failed once and then passed.

### Print timing

After the final review fixes, `verify-print.mjs` ran three times. Run 1 failed its 16.7 ms frame limit with RGB at 18.2 ms. Runs 2 and 3 passed, with RGB at 10.8 and 12.6 ms. The slowest mode in run 3 was 16.5 ms, so the limit has little margin on this Mac. The print code and the limit were not changed. The cause of the slow run was not diagnosed, and this script was not run repeatedly on the baseline.

### Final review checks

| Check | Before the fix | After the fix |
| --- | --- | --- |
| `streak-beads`: false peaks from a 3-pixel dot at 960, 1920, 3840 wide | 0, 76, 232 | 0, 0, 0 |
| `time-shift-sweep`: distance from shift 0 at shift .0001 | 70.310 | 0.266 |
| `time-shift-sweep`: route held at 0 against the plain layer | 70.310 | 0.029 |
| `grade-black`: bright end with a black swatch, plain 242.2 | 242.2 | 43.0 |
| `gradient-midpoint-guard`: route at 1 against .95, and at 0 against .05 | 10.522, 17.413 | 0, 0 |

`time-shift-sweep` first used a limit of 2 between neighbouring shifts. That limit was wrong: after the fix a real, proportional warp still moves busy detail by 11.7 at shift .01. The check now requires the distance from shift 0 to rise with the shift and to be under .5 at shift .0001. With the fix disabled, the revised check still fails at 70.310.

Unit tests cover variations from off values across 480 seeds with Glow and Time on, fixed Twist, streak angle and shape, and looks and No finish keeping Colour balance, Key and their routes.

### Gates

- `all-presets-neutral` and `old-file` fail if a compared render has under 0.5% of its pixels lit above 8/255. No preset is exempt. The lowest lit shares are 16.42% and 21.54%.
- `looks-sheet` measures mean 8-bit difference on a 120x68 thumbnail. Each look must differ from the plain layer by at least 5 and change across the loop by at least 15. The only exemption is Anamorphic on Fractal, at 3.2. The check also fails if that exemption stops being needed.
- `stats-image-edge` renders all four Time modes over rows of a moving picture that are black at every moment, and allows at most 2/255. Before the fix it failed with Brightest at 80 and Echo at 44. After the fix every mode reads 0.

`old-file` saves a Surface, Fractal, Liquid and Image project with the baseline build's own code. Each layer has an existing finish. It renders the whole project and each layer alone at three phases. The file records schema version 1, because `createProject` writes 1 in both builds, and it stays at 1 once opened. The 164 keys added on opening are all at their defaults.

## Looks

Judged by eye from the contact sheets against rules 2 (reads on a wall), 3 (changes over the loop) and 6 (clean at projector scale) in `docs/effects-improvement-plan-2026-11-12.md`.

| Look | Surface | Fractal | Liquid | Image | Decision |
| --- | --- | --- | --- | --- | --- |
| Neon Map | Pass: strong flat colour | Pass: clear on a dark ground | Pass: mostly one magenta, still bold | Pass: clean shapes | Keep |
| Anamorphic | Pass: strong glow, softer colour, no white-out (37.3) | **Known weak**: small change (3.2) | Pass: highlights glow with visible streaks (11.4) | Pass: clear streaks (24.1) | Keep, retuned. Rechecked after the streak fix |
| Time Vortex | Pass: strong spiral | Pass: strong rings | Pass, weak: muddier than the plain layer | Pass: bold swirl | Keep |
| Ghosts | Pass: colour fringes on moving bands | Pass: distinct at each phase | Pass: streaked motion | Pass: clear separated ghosts | Keep |
| Long Exposure | Pass: trails, little white-out | Pass, weak: paler than the plain layer | Pass: bright trails | Pass: clean trails after the edge fix | Keep, retuned |
| Premonition | Pass: soft leading echoes | Pass: soft echoes | Pass: short trails | Pass: clear echo | Keep |
| Brightness Time | Pass: torn bands | Pass: busy but clean | Pass: warped shapes | Pass: hard, deliberate tears | Keep |
| Edge Prism | Fail: thin fringe only | Pass at Split 16 | Fail: not visible | Fail: not visible | **Removed** |

### Changed values

| Look | Old | New | Why |
| --- | --- | --- | --- |
| Anamorphic | Glow 1.2, threshold .7, size .35, streak .8 | Glow .5, threshold .95, size .15, streak 2 | The old values washed Surface and Liquid to pastel. A first retune (Glow .4, threshold 1, size .1) was too weak on Liquid |
| Long Exposure | Span 45, slices 16 | Span 16, slices 8 | The old values turned Surface and Fractal bands white. Its description now says short trails |
| Edge Prism | Split 10, Edges, 9 samples, threshold default .15 | Removed | Split 10 to 32 and thresholds .15, .04 and 0 were tried. It read on Fractal only, and 24 and above began to bead along Surface edges |

The Colour split control is unchanged, so the Edge Prism look can still be set by hand. The finish library now has 26 cards rather than 27.

### The hairline fix

The Image shader returns early outside the picture. Beside that branch, automatic texture derivatives can pick a coarse mip, which draws a one-pixel line of the picture's average colour at its moving edge. Brightest kept that line from each slice. The line is also in a plain moving Image layer on the baseline, peaking at 80/255.

The Time modes now sample with explicit derivatives through `uExactEdge`, which does not change what Brightest means. It stays off everywhere else, so existing renders remain byte-identical. **The one-pixel line therefore remains on plain moving Image layers**, and fixing it there would change existing renders.

## Preview cost

Mean of 60 frames at 1280x720 after 10 warm-up frames, each forced to finish on the GPU. Milliseconds, with the extra cost over the plain layer in brackets. This is a report, not a gate. Times moved between runs on this Mac (the Surface plain layer read 2.15 to 3.50 ms), so treat them as approximate.

| Look | Surface | Fractal |
| --- | --- | --- |
| Plain layer | 3.29 | 4.86 |
| Neon Map | 4.39 (+1.10) | 5.51 (+0.65) |
| Anamorphic | 7.17 (+3.88) | 8.03 (+3.17) |
| Time Vortex | 15.43 (+12.14) | 17.66 (+12.79) |
| Ghosts | 8.30 (+5.02) | 10.83 (+5.97) |
| Long Exposure | 7.43 (+4.15) | 10.13 (+5.27) |
| Premonition | 7.14 (+3.85) | 9.72 (+4.85) |
| Brightness Time | 9.60 (+6.31) | 13.84 (+8.97) |

## Files

These are in `work/colour-time-proof/`, which is git-ignored:

- Contact sheets: `looks-surface-colour.png`, `looks-surface-time.png`, `looks-fractal-colour.png`, `looks-fractal-time.png`, `looks-liquid-colour.png`, `looks-liquid-time.png`, `looks-image-colour.png`, `looks-image-time.png`
- One-to-one 1080-line crops: `crop-1080-surface.png`, `crop-1080-fractal.png`, `crop-1080-liquid.png`, `crop-1080-image.png`
- Data: `looks-metrics.json`, `preview-cost.json`, `baseline-project.formfield`

## Not verified

- **No real footage or photographs.** The Image layer used a generated picture of flat shapes, given a slow drift because a still picture has no motion for the time looks to use.
- **No live projector or real wall.** "Reads on a wall" and "clean at projector scale" were judged from screen images.
- **Motion at full speed was not watched.** The looks were judged from three stills per loop, so flicker and rhythm are unproven.
- **Line pitch was judged by eye** from 1080-line crops, not measured.
- **Only default layers were judged.** Each look was seen on one setup each of Surface, Fractal, Liquid and Image, not on every preset.
- **Preview cost covers this Mac only**, on Surface and Fractal.
- **Byte-identical preset proof covers one phase** per preset. `old-file` covers three phases on one saved project.
- **Live and Map were not exercised.** Their code was not changed.
- **Streak smoothness was measured on one case:** a white 3-pixel dot with a horizontal Line streak. Cross and angled streaks at 4K were not measured for beads.
- **Anamorphic was rechecked from stills** on the four contact sheets and the `looks-sheet` gate, not at 4K or in motion.
- **The print frame-time failure was not diagnosed.**
- **Very bright pixels with a saturated dark tint** can lose some brightness, because the tint gain is limited to 16. This was not judged on real material.
