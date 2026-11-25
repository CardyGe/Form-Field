# Wall brightness with several shapes: notes (25 Nov 2026)

## What Greg saw

The projector output went bright, then dropped dark, as soon as more than one shape was on the wall. This happened before
Perform existed.

## Cause

The always-on **wall flash limiter** (`src/map/flash-limiter.ts`, applied in `Gpu.finish` through `setOutputCorrection`)
was stepping in when nothing was flashing.

The limiter judges flashing from a small 64 × 36 copy of the wall that it reads every frame (`Gpu.requestFlashProbe`). That copy
was drawn with the final pass's ordinary filtered read, so each of its pixels looked at only **4 of the ~900 stage pixels** it
stands for. In a look with fine moving detail, such as Oil's grain and edges, those 4 pixels land on light and then dark
detail from one frame to the next. To the limiter that reads as a cell flashing many times a second.

The limiter acts only when at least 10 % of the wall's 32 × 18 cells are "flashing". One shape covers too few cells to
reach that. Two or three shapes do, so the limiter dims the **whole wall** (gain down to about 0.2), holds for a second,
recovers, and trips again. That is the "bright, then dark" pumping.

These were ruled out by measurement: the quality governor (it stayed at level 0, 120 fps), Meridian's Wall Flash Guard (it
did not limit), compositing and blending (white shapes stay at full white however many there are), and Perform (not involved).

## Fix

`requestFlashProbe` now draws the copy with its own small shader (`PROBE` in `src/map/gpu.ts`). Each probe pixel is the
average, in linear light, of **every** stage pixel it covers (15 × 15 filtered taps, each on the corner of four stage
pixels). Perform's master level is applied as before, and the limiter's own correction is still left out. The picture on
the wall is drawn exactly as before. Only what the limiter measures has changed.

The limiter's rules, thresholds and strength are unchanged. Real flashes still change the averaged copy, so they are still
caught (see `npm run test:map`: strobe, burst and halves checks).

## Proof

`npm run test:wall` (`scripts/verify-wall-brightness.mjs`, throwaway profile under `work/wall-brightness/`). It plays Oil, a
dark Meridian and plain white on 1, 2 and 3 shapes, with the limiter on and off, and reads real wall pixels every frame.

| Oil, limiter on | first shape (linear) | lowest limiter gain |
|---|---|---|
| before, 1 shape | 0.423 | 1.00 |
| before, 2 shapes | 0.104 | 0.18 |
| before, 3 shapes | 0.323 | 0.36 |
| after, 1 shape | 0.423 | 1.00 |
| after, 2 shapes | 0.421 | 1.00 |
| after, 3 shapes | 0.423 | 1.00 |

One shape is unchanged (0.4232 before and after). White stays at 1.0.

## Known limits

- The check uses Oil, the look that showed the problem in testing. Other looks with very fine detail went through the same
  path and are fixed the same way, but were not each measured.
- The limiter still dims the whole wall when a real fast flash covers 10 % of it. That is intended. If Greg ever wants
  control over it (for example a per-show "flash limiter: strict / standard" switch), that is a separate decision. Nothing
  here removes or weakens it.
