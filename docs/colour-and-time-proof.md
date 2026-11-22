# Colour and Time proof

Run on 2026-11-22 on branch `colour-time-engines`, against the baseline checkout at `4a8acdd`.

## Result

- All 47 checks in `scripts/verify-colour-time.mjs` pass, with none skipped.
- 102 of 102 presets are byte-identical to the baseline at phase .9, 960x540.
- A project saved by the baseline build opens in the new build. All 15 renders are byte-identical.
- Seven of the eight planned looks are kept. **Edge Prism was removed**, and Anamorphic and Long Exposure were retuned.
- Two kept looks fail on one layer kind each: Anamorphic on Fractal and Long Exposure on Image.
- The workspace UI check failed once and passed on the rerun. See [Checks](#checks).

## Checks

| Command | Result |
| --- | --- |
| `node scripts/verify-colour-time.mjs --baseline=<baseline>` | 47 passed, 0 failed |
| `npx tsc --noEmit` | Pass |
| `npm test` | 533 and 93 tests pass, 0 fail |
| `npm run test:workspace`, run 1 | **Fail**: timed out waiting for the "Focus preview" button, line 126 |
| `npm run test:workspace`, run 2 | Pass |
| `node scripts/verify-glow.mjs` | Pass |
| `node scripts/verify-print.mjs` | Pass |

The "Focus preview" timeout was not diagnosed. It is intermittent on this evidence, but one pass does not show that it is harmless.

`old-file` saves a Surface, Fractal, Liquid and Image project with the baseline build's own code. Each layer has an existing finish. It renders the whole project and each layer alone at three phases. The file records schema version 1, because `createProject` writes 1 in both builds, and it stays at 1 once opened. The 164 keys added on opening are all at their defaults.

## Looks

Judged by eye from the contact sheets against rules 2 (reads on a wall), 3 (changes over the loop) and 6 (clean at projector scale) in `docs/effects-improvement-plan-2026-11-12.md`.

| Look | Surface | Fractal | Liquid | Image | Decision |
| --- | --- | --- | --- | --- | --- |
| Neon Map | Pass: strong flat colour | Pass: clear on a dark ground | Pass: mostly one magenta, still bold | Pass: clean shapes | Keep |
| Anamorphic | Pass: glow keeps the colour | **Fail**: almost no visible change | Pass, weak: lifts highlights, faint streaks | Pass: clear streaks | Keep, retuned |
| Time Vortex | Pass: strong spiral | Pass: strong rings | Pass, weak: muddier than the plain layer | Pass: bold swirl | Keep |
| Ghosts | Pass: colour fringes on moving bands | Pass: distinct at each phase | Pass: streaked motion | Pass: clear separated ghosts | Keep |
| Long Exposure | Pass: trails, little white-out | Pass, weak: paler than the plain layer | Pass: bright trails | **Fail**: hairlines past the moving picture's edge | Keep, retuned |
| Premonition | Pass: soft leading echoes | Pass: soft echoes | Pass: short trails | Pass: clear echo | Keep |
| Brightness Time | Pass: torn bands | Pass: busy but clean | Pass: warped shapes | Pass: hard, deliberate tears | Keep |
| Edge Prism | Fail: thin fringe only | Pass at Split 16 | Fail: not visible | Fail: not visible | **Removed** |

### Changed values

| Look | Old | New | Why |
| --- | --- | --- | --- |
| Anamorphic | Glow 1.2, threshold .7, size .35, streak .8 | Glow .4, threshold 1, size .1, streak 2 | The old values washed Surface and Liquid to pastel |
| Long Exposure | Span 45, slices 16 | Span 16, slices 8 | The old values turned Surface and Fractal bands white |
| Edge Prism | Split 10, Edges, 9 samples, threshold default .15 | Removed | Split 10 to 32 and thresholds .15, .04 and 0 were tried. It read on Fractal only, and 24 and above began to bead along Surface edges |

The Colour split control is unchanged, so the Edge Prism look can still be set by hand. The finish library now has 26 cards rather than 27.

The Long Exposure hairlines reach 79/255 across 4 columns in a 1080-line frame. They appear on a hard-edged picture that drifts. They come from the renderer rather than the look's values, so retuning did not remove them and they remain open.

## Preview cost

Mean of 60 frames at 1280x720 after 10 warm-up frames, each forced to finish on the GPU. Milliseconds, with the extra cost over the plain layer in brackets. This is a report, not a gate. Differences under about 0.5 ms are within noise.

| Look | Surface | Fractal |
| --- | --- | --- |
| Plain layer | 3.39 | 4.89 |
| Neon Map | 3.62 (+0.23) | 4.57 (-0.31) |
| Anamorphic | 5.91 (+2.52) | 7.72 (+2.83) |
| Time Vortex | 8.88 (+5.50) | 15.81 (+10.92) |
| Ghosts | 5.83 (+2.44) | 8.89 (+4.00) |
| Long Exposure | 5.39 (+2.00) | 8.29 (+3.40) |
| Premonition | 5.86 (+2.47) | 8.46 (+3.57) |
| Brightness Time | 7.41 (+4.02) | 11.74 (+6.85) |

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
