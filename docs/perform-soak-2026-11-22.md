# Perform soak: measured results

Run on 23 November 2026 with `npm run test:perform:soak` (30 minutes), on the `perform-launcher` branch, with the fix described below.

**What this does and does not show.** These results are from this Mac, with a synthetic 128 BPM mix and no projector. They say nothing about a real room, a real projector or how well a real DJ mix is followed.

## Result

All seven pass criteria were met. The wall no longer freezes while looks are made ready. Three shortfalls remain: **55 zone changes landed late**, the **1% low is 13.6 fps**, and **memory rose slightly over the run**, though within its limit.

| Criterion | Limit | Measured | Result |
|---|---|---|---|
| Errors (page, console, crash, failing source) | 0 | 0 | Pass |
| Lost graphics contexts | 0 | 0 | Pass |
| Median launch error | at most 1 frame | 0 frames | Pass |
| Memory trend after a 5-minute warm-up, per process | at most 2 MB/min | studio +0.91, wall +1.56, GPU +1.90 | Pass |
| Every launch and zone accounted for | 0 unresolved | 0 of 783 | Pass |
| Stalls in the first pass through the set | at most 500 ms | none of 250 ms or more | Pass |
| Stalls after the first pass | 0 of 250 ms or more | 0 | Pass |

The stall limits were fixed before this run. A stall is a gap of 250 ms or more between two wall frames, counted from Start show.

## The freeze this run replaces

The first soak recorded 36 stalls of up to 908 ms. Profiling the wall found these causes, all synchronous work inside its animation frame:

- **Shader linking.** The first draw with a new shader waited for the graphics driver.
- **The Oil pattern bake.** One look submitted 10,000 draws in a single frame.
- **Everything at once.** All armed looks were created and first drawn in the same frame, and every look that left the wall was rebuilt when it came back.
- **Preview read-back** for the operator screen, and the sculpture's lighting set-up in every new renderer.

What changed during a show:

- A draw whose shader is still linking is postponed instead of waited for, and only one shader links at a time across all looks. A look is ready only once it has drawn a whole frame.
- At most one new renderer or first draw per frame. The Oil bake is spread over frames.
- Looks the show has used stay ready within the 24-renderer budget, and the least recently used gives way first. Map's own looks are not kept.
- The preview waits while looks are being armed, for at most a second. The sculpture's lighting is made only when a sculpture is drawn.

## Setup

- MacBook Pro, Apple M5 Pro, 24 GB, on mains power, 120 Hz display.
- Stage drawn at 1920 x 1080, shown in the 960 x 540 scripted-check wall window on the laptop's own screen.
- Real app, `performSession()`, real service, real wall window and Rehearse, with a throwaway profile and muted audio.
- Other apps were open and sharing the GPU, including other Electron builds of this project, Chrome and Spotify. The frame rates are not from an idle machine.
- Chromium's background and occluded-window throttling was turned off for the run, so both windows kept drawing while covered.

## Scene material

| Required | What ran |
|---|---|
| Eight zones, new scene every 8 bars | 8 scenes, 120 scene launches |
| Live-free mix of instruments | 52 different instrument looks, no Live clips |
| Locked video with speed steps | 2 s clip as a 4-beat loop in every scene, 55 checks across 0.5x, 1x and 2x, furthest off the beat 0.075 of a loop |
| Ceiling dissolve | 4 ceiling clips on Dissolve 8, on 4 of the scenes |
| End show with a locked loop at 2x, then a fresh Start show | At minute 27. Rate 2.133 before End, 0.025 of a loop off the beat. After the new Start: rate 1.070, 0.003 off |

## Frame rate

| Measure | All frames | Without launch-probe frames |
|---|---|---|
| Frames | 144,245 | 137,070 |
| Median | 117.6 fps | 117.6 fps |
| 1% low (average of the slowest 1%) | 13.6 fps | 13.8 fps |

- Average per minute: 62.4 to 98.2 fps.
- Longest frame: 239 ms.
- Frames over 50 ms: at least 2,000, which is where the recorder stops counting. Of those recorded, 85 were near a launch.

## Launch error

Every zone of every launch is followed from the wall's own messages and reports.

- **Landing frame.** The wall's report is caught as it is made, after that frame has been drawn. The ideal frame is the first whose callbacks began at or after the launch's `atMs`. The error is the landing frame minus the ideal frame.
- **Time.** The end of the landing frame minus `atMs`, so a stall counts in full.
- **Pixels.** The stage is captured at 96 x 54 around each launch without blocking the wall, for as long as a stall needs. The error by picture is the frames from the ideal frame to the first of two frames in a row showing the new picture. Where pixels could not confirm a landing, its landing frame is used.

| Error | On-time cuts |
|---|---|
| 0 frames | 674 |
| +1 frame | 7 |

- 681 on-time cuts, 638 confirmed by pixels. The other 43 had too few captured frames.
- Median 0 frames, 95th percentile 0, maximum 1.
- End of the landing frame after `atMs`: median 27 ms, 95th percentile 58 ms, maximum 112 ms.
- Deferred changes are not in this table. They are counted below.

## Every launch accounted for

| Outcome, per zone | Count |
|---|---|
| Landed on its bar | 728 |
| Deferred: its look was not ready, so that zone landed on a later bar | 55 |
| Called off | 0 |
| Ended by End show | 0 |
| Unresolved | 0 |

**The 55 deferred changes are a shortfall.** The first 40 are recorded in detail. They fall on 11 launches, the longest was 3.8 s late, and the zones were 3, 4, 5, 6 and the ceiling. In those 40, the pattern is the set wrapping from its last scene back to its first: the launcher only arms the next row, so the first row is not being made ready when the operator jumps back to it. A deferred look shows as waiting on the operator's grid, and the other zones land on time.

## Governor and contexts

- Governor: level 0 for all 1,810 s.
- Instrument contexts made: 793, of which 769 were given back on purpose. Lost: 0.

## Memory (working set, MB)

| Process | Start | 5 min | End | Peak | Trend after 5 min (MB/min) |
|---|---|---|---|---|---|
| Studio renderer | 313 | 255 | 282 | 362 | +0.91 |
| Wall renderer | 319 | 495 | 525 | 609 | +1.56 |
| GPU | 199 | 245 | 305 | 307 | +1.90 |
| All app processes | 1,175 | 1,308 | 1,503 | | +7.31 |

JS heap trend after warm-up, read with precise memory info: studio -0.02 MB/min, wall -0.85 MB/min. Each process is within the limit, but the GPU process is close to it, and 30 minutes cannot rule out slow growth over a longer show.

## Limits of this measurement

- One 30-minute run, on one set, with other apps running.
- The frame-rate figures include the launch probe's captures, which is why they are also given without those frames.
