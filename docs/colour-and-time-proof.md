# Colour and Time proof

Run on 2026-11-22 on branch `colour-time-engines`, against the baseline checkout at `4a8acdd`.

## Result

- All 48 checks in `scripts/verify-colour-time.mjs` pass, with none skipped.
- 102 of 102 presets are byte-identical to the baseline at phase .9, 960x540.
- A project saved by the baseline build opens in the new build. All 15 renders are byte-identical.
- Seven of the eight planned looks are kept. **Edge Prism was removed**, and Anamorphic and Long Exposure were retuned.
- One known weak case remains: Anamorphic on Fractal. The `looks-sheet` gate names it and fails on any other weak result.
- The Long Exposure hairlines are fixed in the renderer.
- The workspace UI check is intermittent, and it fails the same way on the baseline. See [Workspace UI](#workspace-ui).

## Checks

| Command | Result |
| --- | --- |
| `node scripts/verify-colour-time.mjs --baseline=<baseline>` | 48 passed, 0 failed |
| `npx tsc --noEmit` | Pass |
| `npm test` | 626 pass, 0 fail: 533 unit tests and 93 Electron tests |
| `npm run test:workspace` | Intermittent; see [Workspace UI](#workspace-ui) |
| `node scripts/verify-glow.mjs` | Pass |
| `node scripts/verify-print.mjs` | Pass |

After the final Step 2 run, only the `stats-alpha` reference in `scripts/verify-colour-time.mjs` changed, so that script and `tsc` were run again.

### Workspace UI

Every failure is the same timeout, waiting for the "Focus preview" button at `scripts/verify-workspace-ui.mjs:126`.

| Build | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| This branch | Pass | **Fail** | Pass |
| Baseline `4a8acdd` | **Fail** | **Fail** | Pass |

The timeout is pre-existing, since the baseline fails it too. Its cause was not diagnosed and it was not fixed. The final Step 2 run on this branch failed once more and then passed. Earlier, before the fixes, the branch also failed once and then passed.

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
| Anamorphic | Pass: strong glow, softer colour, no white-out | **Known weak**: small change (3.2) | Pass: highlights glow with visible streaks (11.4) | Pass: clear streaks | Keep, retuned |
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
| Plain layer | 3.50 | 4.60 |
| Neon Map | 3.78 (+0.28) | 4.68 (+0.08) |
| Anamorphic | 6.22 (+2.72) | 7.84 (+3.24) |
| Time Vortex | 13.49 (+9.99) | 17.29 (+12.69) |
| Ghosts | 6.72 (+3.22) | 9.53 (+4.93) |
| Long Exposure | 6.17 (+2.67) | 8.12 (+3.52) |
| Premonition | 6.01 (+2.51) | 8.59 (+3.99) |
| Brightness Time | 9.13 (+5.63) | 12.36 (+7.76) |

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
