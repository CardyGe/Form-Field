# Meridian soak

Status: **Not yet run on the show Mac.** The 12-hour soak and the rehearsal need the artist's show Mac and equipment.

## The command

On the show Mac, with the show display connected and the app built:

```
npm run build
caffeinate -i node scripts/soak-meridian.mjs --hours 12 --fullscreen
```

`--fullscreen` runs the real full-screen wall on the second display (never the main screen). Leave the Mac alone while it runs. For a quick check, use `--hours 0.25` without `--fullscreen`.

## Pass rules

The run passes only if it exits 0. It fails on any of these:

- the app, the Studio window or the wall crashes, closes or throws a page error;
- a Meridian source stands still, disappears or starts again from scratch;
- the wall restarts an instrument, or a wall fault lasts two samples in a row;
- the wall flash limiter is off or has failed;
- after the first hour, memory (process, graphics, JS heap) grows more than 10% over minutes 61 to 70 by the last 30 minutes, or by slope.

The per-minute CSV is written to `work/meridian/soak-<date>.csv`: frame rate, longest frame, memory, quality governor, limiter, autopilot changes and faults.

## Results on the show Mac

**Not yet run.**

| Item | Result |
| --- | --- |
| Date and Mac | Not yet run |
| Command used | Not yet run |
| Exit code | Not yet run |
| Faults | Not yet run |
| Frame rate (mean, lowest) | Not yet run |
| Longest frame | Not yet run |
| Memory growth after the first hour | Not yet run |
| Output refresh rate and line width checked | Not yet run |

## Dry run from the development Mac (not the show Mac)

A 15-minute soak from the development Mac. It is a dry run only: it shows the tool works. It says nothing about the show Mac, the projector or a 12-hour run.

- Faults: 0
- Frame rate: 120 fps
- Median wall frame at 1080p: 3.3 to 3.6 ms

## Still untested

No real projector, camera, room lighting, DJ audio or MIDI hardware has been tested. A crashed wall is not reopened automatically yet. Single-display installations need a saved display.
