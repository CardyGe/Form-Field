# Perform build notes

Built 22–24 November 2026 on `perform-launcher`, from `main` at `58d643b`. Tasks 1–15 of the [build plan](plans/2026-11-22-perform-launcher.md) are done. Tasks 16 (MIDImix) and 17 (room session) wait for the hardware.

Each task was built by one agent and reviewed by another. A final review covered the whole branch. This page records the decisions made without asking Greg, the known limits, and the small issues left for later.

## Known limits to check at Meridian

- **Beat clock, tested on synthetic audio only.** After an abrupt change from 128 BPM to a related syncopated tempo (for example 3-3-2 at 102, 171 or 175 BPM), LOCKED can stay on the wrong tempo for up to a minute. Music shifted exactly half a beat with strong off-beats can stay LOCKED half a beat out. **Tap, then Follow** fixes both.
- **MIDI clock.** With MIDI clock running, one Tap or Follow takes the show off the clock until End show, and nothing on screen says so. Greg's rig follows deck audio, so this only matters if MIDI clock is used. Fix it with Task 16.
- **MIDI clock and bar 1.** When MIDI clock takes over again after a stop and start, press "This is the 1" to line up bar 1.
- **Cold scene jumps.** The next scene and any follow target are prepared in advance. Jumping to a scene not played recently can make some zones land 1–2 bars late, up to about 4 seconds. Each late zone shows as waiting.
- **Flashing.** Audio reaction and Red bursts are limited to 3 large brightness swings per second per zone. Flashing inside a look itself is not measured, so check looks by eye before a public show.
- **Last fixes not soaked.** The final arming fixes were checked by tests only, at Greg's request. One 6-minute trial showed a single 3.6-second freeze on the first pass, cause unknown. The last full 30-minute soak, before those fixes, had no freeze of 250 ms or more.
- **Soak conditions.** The soak ran on this Mac with a synthetic mix, a 960 × 540 wall window and other apps running. The 1% low frame rate was about 13–14 fps, and GPU memory rose about 2 MB per minute. Both need a longer run on the show machine.
- **Feel.** Audio reaction amounts, ceiling breath and bloom, crossfade timing and the look on tulle are first guesses for the room.
- **Rehearse.** It was checked with WAV, MP3, M4A, AAC, FLAC, Ogg and Opus, but not by ear (test runs were muted) and not with a drive unplugged. AIFF is not supported.

## Decisions made on Greg's behalf

Each line gives the decision, then what it costs if it was wrong.

**Clock**
1. The follow clock takes its first tempo from onset spacing, and only then rejects onsets outside 15% of a beat. Cost: slower first lock.
2. Space is Tap and F is Follow on the keyboard. Hardware combinations wait for Task 16. Cost: a small handler change.
3. Follow has its own faster onset detector, about 0.12 s. The existing `beat` source is unchanged. Cost: more false onsets, which the window rejects.
4. A hard cut into a new phase at the same tempo stays HOLDING until Tap. Cost: one tap in a rare case.
5. A wrong LOCKED is treated as worse than HOLDING. Phase locks only with a clear margin, never above 175 BPM, and LOCKED must keep earning itself. Cost: slower lock on ambiguous music.
6. Any new tempo needs 32 beats of agreement before the running grid changes, and leaving LOCKED never moves the beat. Cost: about 15–20 s to follow a real tempo change unless tapped.
7. Tap and Follow always work during a show. A silent MIDI clock hands over to following the music after 2 s.

**Launching and the wall**
8. A clip's blend bars snap to the allowed values (fade ½–8, dissolve 8/16/32) at launch. Follow rule keywords are read before scene names.
9. A zone inside a group hidden in Map is still shown during a show. A blocker keeps its Map visibility.
10. Ceiling Stop does not wait for a running dissolve. It fades to black over 1 bar on the next beat.
11. A controller disconnect clears Shift and ends every burst.
12. A reopened projector window gets back each loop's position, so loops do not jump.
13. A loop's show speed carries past End show only until its next loop boundary.
14. "Newer" means pressed later, tracked by a press number, so the latest press always wins however the queue is reordered.
15. End show with Map off screen leaves the projector on Map's picture.
16. A launched zone whose look cannot play shows black, never Map's fill colour or test grid.
17. Arming never blocks the projector. Looks compile in the background, at most one starts per frame, recently used looks stay ready, and queued looks start first.
18. "Too heavy" appears after two bars, not one.

**Perform screen**
19. During a show, clicking a clip or scene launches it on the next bar, and right-click edits. With no show running, a click selects.
20. Start show turns off Map's Test Grid and Freeze, with a note.
21. Grid rows grow to fill the screen, shrink as scenes are added, and keep the queued or current row in view.
22. During a show, Undo refuses anything except Perform grid edits, cells cannot be dragged, and + Scene is off.
23. Audio reaction and bursts change brightness and speed only, never the speed of a beat-locked clip.

**Clip editing**
24. If an applied look fails to start, the old look keeps playing, the show goes back to it, and the draft is kept.
25. Duplicate and edit creates the copy only on Apply, so Discard changes nothing.
26. Only one Apply at a time per look, and "Starting…" shows until the projector confirms it.

**Safety, Check Set and Rehearse**
27. A flash guard limits audio-driven flashes to 3 per second per zone. Greg's own cuts, faders and Master are not limited.
28. Check Set says MIDI clashes are not checked until the MIDImix is set up. It times how long each look takes to get ready, and says when looks are untimed.
29. Imported Map scenes leave the ceiling alone unless switched on, and reuse only untuned clips.
30. Rehearse streams the file from disk instead of loading it whole: 158 MB for an hour instead of about 3.7 GB. Nothing is written or sent.
31. Until the MIDImix is identified, unplugging a MIDI device never freezes the on-screen controls.
32. The soak's pass limit was set before the re-run: after the first pass, no freeze of 250 ms or more.

## Small issues left for later

- If a held look fails once and then works, the new look appears without a crossfade.
- When a look cannot play, a palette border shows black.
- No Electron check confirms that a failed look draws black. `scripts/verify-perform-contexts.mjs` has no npm script.
- A focused Sound input menu's type-ahead letters also drive the controller.
- A touch scroll on the grid can launch a clip.
- Audio band choices do nothing for ceiling clips.
- Repeated imports near the 256-clip limit could be trimmed on save without warning.
- A vanished rehearsal file can take about a minute to report.
- Freeze hides launches until it is turned off. The status row shows Freeze.
- Several test-coverage gaps are listed in the final review.
