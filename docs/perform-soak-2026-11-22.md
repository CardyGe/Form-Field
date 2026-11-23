# Perform soak: measured results

Run on 23 November 2026 with `npm run test:perform:soak` (30 minutes), on the `perform-launcher` branch at 615d9bb plus the soak script.

**What this does and does not show.** These results are from this Mac, with a synthetic 128 BPM mix and no projector. They say nothing about a real room, a real projector or how well a real DJ mix is followed.

## Result

All five pass criteria were met, and two weaknesses were measured: **the wall stalls for up to 0.9 s**, and the **governor did not respond to those stalls**.

| Criterion | Limit | Measured | Result |
|---|---|---|---|
| Errors (page, console, crash, failing source) | 0 | 0 | Pass |
| Lost graphics contexts | 0 | 0 | Pass |
| Median launch error | at most 1 frame | 0 frames | Pass |
| Memory trend after a 5-minute warm-up, per process | at most 2 MB/min | studio -3.80, wall -1.56, GPU -1.03 | Pass |
| Launches the probe saw never land | 0 | 0 (see limits) | Pass |

## Setup

- MacBook Pro, Apple M5 Pro, 24 GB, on mains power, 120 Hz display.
- Stage drawn at 1920 x 1080, shown in the 960 x 540 scripted-check wall window on the laptop's own screen.
- Real app, `performSession()`, real service, real wall window and Rehearse, with a throwaway profile and muted audio.
- Other apps were open and sharing the GPU, including two other Electron builds of this project, Chrome and Spotify. They were left running, so the frame rates are not from an otherwise idle machine.
- Chromium's background and occluded-window throttling was turned off for the run, so both windows kept drawing while covered.

## Scene material

| Required | What ran |
|---|---|
| Eight zones, new scene every 8 bars | 8 scenes, 121 scene launches |
| Live-free mix of instruments | 52 different instrument looks, no Live clips |
| Locked video with speed steps | 2 s clip as a 4-beat loop in every scene, 55 checks across 0.5x, 1x and 2x, furthest off the beat 0.045 of a loop |
| Ceiling dissolve | 4 ceiling clips on Dissolve 8, on 4 of the scenes |
| End show with a locked loop at 2x, then a fresh Start show | At minute 27. Rate 2.133 before End, 0.025 of a loop off the beat. After the new Start: rate 1.071, 0.006 off |

## Frame rate

| Measure | All frames | Without launch-probe frames |
|---|---|---|
| Frames | 175,891 | 169,275 |
| Median | 119.0 fps | 120.5 fps |
| 1% low (average of the slowest 1%) | 12.8 fps | 16.4 fps |

- Average per minute: 86.3 to 106.5 fps.
- Longest frame: 908 ms.
- Frames over 50 ms: 1,800, of which 234 were within the probe window around a launch.
- **Stalls of 250 ms or more: 36, totalling 19.8 s.** None reached 1 s. The looks being prepared around them were recorded, but that is a correlation and does not establish the cause.

## Launch error

Measured on the wall's own pixels. For each cut, the ideal frame is the first animation frame whose timestamp is at or after the launch's `atMs`. From 250 ms before to 750 ms after, the stage is read back at 96 x 54, and each zone is compared with its picture before and after the launch. The error is the number of frames from the ideal frame to the first of two frames in a row that look like the new picture.

| Error | Landings |
|---|---|
| -1 frame | 159 |
| 0 frames | 483 |
| +4 frames | 1 |

- 643 cuts measured. Median absolute error 0 frames, 95th percentile 1, maximum 4.
- Median 2 ms after `atMs`, 95th percentile 12 ms.
- The -1 results come from the method: a frame's timestamp is its start, and the wall reads the clock slightly later in that frame.

## Governor, launches and contexts

- Governor: level 0 for all 1,810 s. It never stepped down, even during the stalls above.
- Deferred launches: 0. Launches seen never landing: 0.
- Instrument contexts made: 800. Given back on purpose: 786. Lost: 0.

## Memory (working set, MB)

| Process | Start | 5 min | End | Peak | Trend after 5 min (MB/min) |
|---|---|---|---|---|---|
| Studio renderer | 309 | 344 | 261 | 358 | -3.80 |
| Wall renderer | 302 | 517 | 475 | 524 | -1.56 |
| GPU | 213 | 283 | 256 | 294 | -1.03 |
| All app processes | 1,169 | 1,555 | 1,345 | | -8.95 |

JS heap trend after warm-up: studio +0.97 MB/min, wall +0.46 MB/min. The studio heap read 23 MB at the start and 40 MB at the end.

## Limits of this measurement

- Of at most 726 room-zone cuts, 643 were measured and 67 were skipped because a slow frame left too few frames after the landing. The other 16 are not accounted for.
- The probe treats a launch as called off if it is cancelled before the probe has seen its landing report. A missed report would therefore not count as "never landed", so the 0 for deferred and never-landed launches is weaker than the other results.
- The read-back adds work on the frames around each launch, which is why frame rates are given with and without those frames.
- One 30-minute run, on one set.
