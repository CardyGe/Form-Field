# Morphogen party proof

22 November 2026, soak results added 23 November · branch `morphogen` · Apple M5 Pro

## Decision today: not yet a go

The software checks and the 8-hour soak pass, but two required proofs have not happened: the real MIDImix capture and a rehearsal with the projector and DJ audio. The soak also missed the slow-frame target in 9 of 479 minutes. The go or no-go is Greg's call on 2 December.

## Measured

| Target | Result | Status |
|---|---|---|
| 8 hours without failure | 479 logged minutes on `8d496b9`, no page errors or invalid simulation values | Pass |
| 1080p median under 8 ms | Typical minute 5.0 ms, slowest minute 10.1 ms, 5 of 479 minutes over | Met overall, with brief misses |
| 1080p p99 under 14 ms | Typical minute 7.9 ms, worst minute 16.7 ms, 9 of 479 minutes over | **Missed in 9 minutes** |
| Pattern never freezes | Lowest activity 0.552 | Pass |
| Quality holds | Full quality in all 479 minutes | Pass |
| 10,000 random parameter changes | No blown-up, black, flat or invalid picture | Pass |
| No more than 3 flashes a second | Worst-case 10 Hz test: 10 reduced to 2 on all six looks | Pass in simulation |
| Normal kicks left alone | 120 to 174 BPM pass with no dimming | Pass in simulation |
| Opposed panels, chases and checkers | Caught by the limiter | Pass in simulation |
| GPU loss recovers within 3 s | Five of five, about 1.0 to 1.1 s | Pass |
| Plays with no camera, microphone or MIDI | Plays through Live | Pass |
| No memory growth | Heap steady at 17.4 MB for all 479 minutes | Pass |
| Automated suite | 644 and 93 tests pass; Map and Live checks pass | Pass |

Frame timing varied between runs, from 3.8 to 8.2 ms median in shorter checks, depending on what else the Mac was doing. The soak did not include projector mapping, a camera or live audio, so a real show will cost more.

## Not proven

- **Frame margin under show load:** the soak's worst minute used the whole 16.7 ms of a 60 fps frame before any show load was added.
- **MIDImix:** the control map is a marked placeholder. The mode is tested with simulated messages only, and button lights are not driven.
- **Faders:** Morphogen mode leaves them alone, but they need Map brightness links until Perform exists.
- **Real room:** projector moiré, brightness, real DJ audio and mapped surfaces are untested.
- **Flash safety:** the limiter reduces risk and is not a certified photosensitive test. It has no off switch, so deliberate fast strobes in any Map show are dimmed.

## Known limits

- A fast flash on 10% or more of the wall dims the whole wall while it lasts.
- Morphogen enters a mapped shape as a cut from the shape's fill unless a scene fade applies.
- Deferred minor issues: a camera warning can still show in Map's Live card, on-screen Hold and MIDImix Hold are separate, Undo history crosses looks, and flash probes allocate about 1.5 MB/s.

## Before 2 December

1. Capture the real MIDImix controls.
2. Rehearse with the projector, DJ audio or a recorded mix, the MIDImix and mapped surfaces, and watch frame timing.
3. Decide: **Go**, **Go with sound-driven brightness off**, or **No-go**.
