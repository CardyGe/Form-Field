# Oscilloscope and Ember Pulse: flash screen of `main`

Measured 2026-11-21 on `main` at commit `cd4830c`, on the Apple M5 Pro. Raw results: [flash_results.json](flash_analysis/flash_results.json) and [flash_results_extra.json](flash_analysis/flash_results_extra.json). Method: [flash-analyzer.mjs](flash_analysis/flash-analyzer.mjs) and [run-flash-analysis.mjs](flash_analysis/run-flash-analysis.mjs).

**This is an engineering screen modelled on ITU-R BT.1702-3. It is not a certified analyser, a Harding result, or legal or medical clearance.**

## Takeaway

- All 12 looks pass at their default settings, at assumed wall peaks of 200, 1,000 and 1,500 nits.
- **Acid Plume has no real margin at default.** At 1,500 nits it reaches 20.5% on the 6 px grid and **24.9% on the 2 px grid**, against a 25% limit. Finer measurement raised the figure, so a 1 px or native-resolution run could exceed the limit.
- **Three Ember looks fail at the fastest Phrases setting** (16 phrases, nominally 384 BPM): Glacier Vapour at 1,500 nits, and Acid Plume and Silver Ash at both 1,000 and 1,500 nits.
- Ember Pulse itself, the red look, passes every case. Its worst general area is 12.0% and its worst saturated-red area is 8.0%.
- No look ever changed 25% of the screen in a single frame. The largest single-frame change was 19.4%. The failures come from many small regions flickering within the same second, not a full-screen strobe.

## Results

Percentages are the largest share of the screen with more than three flashes in a one-second window. The limit is 25%.

**Default settings, 6 px grid**

| Look | 200 nits | 1,000 nits | 1,500 nits | Saturated red | Verdict |
|---|--:|--:|--:|--:|---|
| Plain Oscilloscope | 0.00 | 0.00 | 0.00 | 0.05 | Pass |
| Twin Orbit | 0.06 | 0.06 | 0.05 | 1.52 | Pass |
| Atom | 0.58 | 0.64 | 0.53 | 3.94 | Pass |
| Ember Ring | 0.00 | 0.00 | 0.00 | 0.13 | Pass |
| Cyan Tangle | 2.97 | 2.45 | 1.89 | 0.00 | Pass |
| Signal Burst | 0.30 | 0.25 | 0.15 | 0.00 | Pass |
| Morse Sphere | 1.71 | 3.27 | 2.63 | 0.00 | Pass |
| Ember Pulse | 0.00 | 0.77 | 2.63 | 1.31 | Pass |
| Glacier Vapour | 0.08 | 12.08 | 18.15 | 0.00 | Pass |
| Orchid Static | 0.00 | 3.53 | 8.02 | 0.00 | Pass |
| Acid Plume | 0.21 | 14.99 | **20.53** | 0.00 | Pass, narrow |
| Silver Ash | 0.15 | 13.89 | 19.54 | 0.00 | Pass |

**Ember looks at 16 phrases, 6 px grid**

| Look | 200 nits | 1,000 nits | 1,500 nits | Saturated red | Verdict |
|---|--:|--:|--:|--:|---|
| Ember Pulse | 0.00 | 4.50 | 11.98 | 8.00 | Pass |
| Glacier Vapour | 0.81 | 23.66 | **28.80** | 0.00 | **Fail at 1,500** |
| Orchid Static | 0.02 | 11.37 | 18.96 | 0.00 | Pass |
| Acid Plume | 1.69 | **26.88** | **32.63** | 0.00 | **Fail at 1,000 and 1,500** |
| Silver Ash | 1.55 | **26.60** | **32.39** | 0.00 | **Fail at 1,000 and 1,500** |

Setting Pulse depth to 1 slightly lowered every figure at 1,000 and 1,500 nits, and the same looks failed. At 200 nits, Glacier Vapour and Orchid Static rose by less than 0.02 points.

**Grid sensitivity, Acid Plume at 1,500 nits**

| Setting | 6 px grid | 2 px grid |
|---|--:|--:|
| Default | 20.53 | **24.89** |
| 16 phrases | 32.63 | 31.01 |

## Method

- Each look rendered at 1920x1080 and 60 fps for its full 10-second loop, plus one second to catch flashes across the loop point. There was no sound input.
- Output was decoded from sRGB to linear light and averaged into grid cells. Luminance assumes a display that follows sRGB at the stated peak.
- A general transition is a change of at least 20 cd/m² where the darker state is below 160 cd/m². A saturated-red transition uses WCAG's numeric red definition.
- A cell counts as over the limit at its seventh opposing transition within one second, meaning a fourth flash has begun.
- Five known signals were run first, and all received the expected verdict: full-field white at 10 Hz and 2 Hz, white at 10 Hz over 20% and 30% of the screen, and dim full-field red at 10 Hz.

## How far the numbers can be trusted

- **The area measure is deliberately cautious.** It counts cells that flash within the same second even when they are not in step. A certified analyser may treat out-of-step flicker differently, so the 16-phrase failures may not all be failures under BT.1702.
- **Grid size changes the result in both directions**, as the table shows. The default Acid Plume result should be treated as borderline.
- The nit levels are assumptions. No real wall or projector was measured.

## Not measured

- Sound-reactive Ember smoke, where live beats add light that this run does not contain.
- Phrase settings between 8 and 16 for looks other than Ember Pulse, so the exact point of failure is unknown.
- Loops shorter than 10 seconds, which raise the pulse rate at any Phrases setting.
- Non-default looks, multi-layer compositions, Finish effects, and the Live and Map outputs.
- The pattern-risk check that the report's S1 also calls for.
- 4K, and any grid finer than 2 px.

## Note on the earlier baseline

The raw capture files linked from [measured_baseline.md](measured_baseline.md) were in a temporary folder that was cleared on 2026-11-21 at about 22:23. Those links are dead. The numbers written in that note remain, but they can no longer be checked against their source files without re-running the captures.
