# Perform: live launcher design

22 November 2026 · Form & Field 0.16.0 · Reworked against `main` at `58d643b` after the first version was found to be based on an older branch. Design for approval. Nothing is built.

## Intent

Greg builds effects and instruments in the app, then wants to **play them live with ease**: trigger them, launch them, blend them and put them in a sequence, the way Ableton's Session View lets a musician play clips.

The first show has a clear shape:

- **Controller:** one Akai Professional MIDImix.
- **Surfaces:** projection mapped on to speakers, furniture and similar objects.
- **Ceiling:** tulle fabric across the ceiling, playing separate, more ethereal loops.
- **Music:** audio input from the DJ decks.
- **Output:** one projector covers both the room and the ceiling.

Success: Greg can run a whole DJ set from the MIDImix, mostly without touching the laptop, and every change lands on the music.

## Goals

- A new **Perform** section built on Map's shapes and instruments.
- Eight **zones**, one per MIDImix strip. Zone 8 defaults to the ceiling.
- A grid of saved **clips**: one column per zone, one row per scene.
- Launch one zone or a whole scene on the next beat or bar.
- A steadier beat clock for live launching, built into the existing tempo clock, with quick manual correction.
- Clips can be anything a Map shape can play: an instrument, image, video or Live look.
- The existing sound levels make each zone react to the music.
- Blends between looks, from a hard cut to a 32-bar dissolve.
- A protected ceiling that keeps drifting while the room changes.
- Simple sequencing: a scene can move on by itself after a set number of bars.
- A rehearsal mode that plays a recorded DJ mix through the same system.

## Non-goals (this design)

- Two projectors or edge blending.
- Other controllers. The control layer is kept separate so one can be added later.
- Ableton Link, CDJ network sync or timecode. MIDI clock already exists and stays available.
- Recording the performance or exporting it.
- A full timeline arranger.
- Replacing Map's scenes, links, triggers or auto-advance. They keep working whenever a show is not running.

## Anti-goals

It has failed, even if every feature works, if:

- Greg has to look at the laptop to get through a normal transition.
- A launch visibly stutters, flashes a flat colour or shows black by accident.
- A controller, audio or beat-detection fault stops the picture.
- A physical control does something other than what its position suggests.
- The ceiling jumps because of a change meant for the room.
- Studio's loop, seek and export behaviour changes.
- Deck audio is saved, sent anywhere, or used for anything except live analysis.

## What the research contributes

| Source | What we take | What we leave |
|---|---|---|
| [Ableton Session View](https://www.ableton.com/en/live-manual/12/session-view/) | Clips in columns, scenes in rows, a queued launch that flashes until it lands | A grid on the hardware: the MIDImix has no pads |
| [Ableton launching](https://www.ableton.com/en/live-manual/12/launching-clips) | Launch quantize, Gate-style hold, Legato, Follow Actions | Probability chains in the first release |
| [Resolume clips](https://resolume.com/support/en/clips), [composition](https://resolume.com/support/en/composition) | Beat Snap, per-clip transitions, protecting a clip from column triggers | A/B buses |
| [Resolume Dashboard](https://resolume.com/support/en/dashboard) | A few big controls instead of every parameter | Per-effect mapping pages |
| [grandMA3 cue timing](https://help.malighting.com/grandMA3/2.5/HTML/cue_timing.html) | Follow-on cues and timing that is fixed when a cue fires | Console-level programming |
| DJ and VJ practice | A clear "this is the 1", rehearse transitions, downbeat cuts | None |

Fabric guidance: on tulle, [black reads as transparent and content works best without a visible rectangle](https://blair-neal.gitbook.io/survey-of-alternative-displays/techniques/projection-on-static-material). [Fine patterns can produce moiré on netting](https://hosting.fluidbook.com/Gerriets/Gerriets-Online-Catalog-2018/m/60-Gerriets-Online-Catalog-2018.html).

## What exists today

Checked on `main` at `58d643b`.

**Perform reuses:**

- **Sound:** `src/react/audio.ts` reads any audio input, with no echo cancellation or noise suppression, and reports a lost device. `features.ts` provides auto-gained level, bass, mids and highs. Microphone and MIDI permission for the studio window already exist.
- **Tempo:** `TempoClock` has detected-beat, tap, MIDI clock and fixed sources, and already drives tempo-synced loops through `source.tempoSync`.
- **MIDI:** `MidiInput` handles input, Learn, notes, controls and clock, with no SysEx.
- **Wall signals:** `ReactivityEngine` runs in the studio window, and one small `signals` message reaches the wall each frame.
- **Map:** shapes, groups, instruments, images, video, Live looks, blockers, soft edges, the GPU compositor, per-shape crossfades and the governor.
- **Scenes:** Map scenes can be imported as Perform rows.

**Perform must add or change:**

- `TempoClock` re-anchors the beat on **every** detected onset. A syncopated kick would move the bar, so it cannot time launches.
- There is no way to set bar one, and no confidence or holding state.
- `MidiInput` cannot send to a device, so it cannot light buttons. It also exposes values but no ordered event stream.
- Map scene changes happen immediately, for the whole show. There is no quantized launch and no per-zone launch.
- A source only starts once a visible shape plays it, so **a look cannot be ready before its launch**.
- `setShow` has one fade time for the whole change, so zones cannot blend differently.
- The shape shader has brightness and tint but no hue control.
- Signals, triggers and the wall stop when Map is left, so a show cannot yet survive moving to Studio.
- `playedBy` discards any source not used by a shape or scene, so clip-only sources would vanish.

## Approaches

| Approach | Trade-off | Decision |
|---|---|---|
| **A. Zone strips.** Each MIDImix strip is one mapped zone. The screen shows the grid, and the hardware plays it. | Matches the hardware and the room. Needs a clear on-screen view of what is next. | **Chosen.** Recommended and carried forward by Greg's answers. |
| B. Scene launcher. The 16 buttons launch 16 whole-room scenes, and faders act as a mixer. | Very simple, but one speaker or sofa cannot be played alone. | Rejected. |
| C. Add a pad grid such as a Launchpad. | Closest to Ableton, but it is not the hardware Greg chose. | Not now. The control layer leaves room for it. |

## Words used

- **Zone:** a part of the room, made of one Map group or shape. One column of the grid.
- **Clip:** a saved look for one zone: an instrument source, speed, colour and how it blends in.
- **Scene:** one row of the grid.
- **Launch:** start a clip or scene, normally on the next bar.
- **Armed:** warmed up off-screen and ready to appear without a hitch.

## The Perform screen

```text
Studio · Live · Map · [Perform]                         WALL 60 fps   MIDImix ●   AUDIO ●
128.0 BPM  ●●●○  LOCKED      Launch: 1 bar ▾      NEXT: Drop in 2 beats       [ BLACK ]
┌────────┬────────┬────────┬────────┬────────┬────────┬────────┬──────────┬─────────┐
│ SPK L  │ SPK R  │ SOFA   │ TABLE  │ SHELF  │ BAR    │ FLOOR  │ CEILING  │ SCENES  │
├────────┼────────┼────────┼────────┼────────┼────────┼────────┼──────────┼─────────┤
│ Ink    │ Ink    │ Veils  │ Reef   │ ·      │ Veils  │ ·      │▶Slow Silk│ Intro   │
│▶Relief │▶Relief │ Sand   │▶Prism  │▶Ink    │ Sand   │▶Loom   │ Mist     │▶Build   │
│◆Glitch │◆Glitch │◆Cuts   │◆Prism  │◆Cuts   │◆Glitch │◆Loom   │ Aurora   │◆Drop    │
│ Caustic│ Caustic│ ·      │ Reef   │ ·      │ ·      │ ·      │ Tide     │ Break   │
├────────┼────────┼────────┼────────┼────────┼────────┼────────┼──────────┼─────────┤
│ ████   │ ████   │ ██▌    │ ███    │ █▌     │ ███    │ ██     │ ██▌      │ MASTER  │
└────────┴────────┴────────┴────────┴────────┴────────┴────────┴──────────┴─────────┘
▶ playing   ◆ queued   · empty: keeps playing what it has   green/amber/red dot: armed/loading/too heavy
```

Readable from a metre away in a dark room. Editing happens here too: drag an instrument into a cell, or right-click for its blend.

## MIDImix layout

```text
         STRIP 1  2  3  4  5  6  7   8 (CEILING)     MASTER
Knob 1   Speed                       Drift speed
Knob 2   Colour                      Colour
Knob 3   Audio response              Breath
Amber    Next clip on the beat       Next ceiling loop
Red      Hold: burst with the kick   Hold: slow bloom
Fader    Zone brightness             Ceiling brightness   Whole projector

Bank ▶   Queue next scene            Bank ◀   Cancel queued, or queue previous scene
Solo     Shift                       Send All Read every fader and knob position
```

With **Solo (shift)** held:

| Press | Result |
|---|---|
| Amber | Previous clip in that zone |
| Red | Stop that zone (fade to black on the next beat) |
| Bank ◀ | **This is the 1.** Sets the bar start now |
| Bank ▶ | Launch the queued scene immediately |

Knobs and faders have one job each and no shifted function. Ceiling dissolve length is set on the clip, on screen.

Button lights:

| Light | Meaning |
|---|---|
| Amber on | Zone is playing |
| Amber flashing | Next clip is queued |
| Amber off | Zone is stopped or empty |
| Red on | Burst is held |
| Red flashing on the beat, strip 1 only | Clock is alive |

**Physical controls never lie (my call).** Scenes do not store fader or knob values, so launching a scene can never leave a control out of step with the picture. Fader 3 always means the sofa's brightness. A clip's speed and colour are its saved starting point, and the knobs offset them from their centre position.

Because the laptop cannot ask the hardware where its controls are, starting a show has one step: **press Send All**. That reads every fader and knob, and the picture stays black until it has. No control positions are saved anywhere. If the hardware test shows Send All is unreliable, faders start at zero and knobs at centre until each is moved.

If the MIDImix reconnects mid-show, the picture holds its current values. Each control then takes over only when it is moved through its held value, or at once after Send All.

**Starting the room.** Reading the controls does not start any visuals. The room stays black until Greg presses **Bank ▶**, which launches the first scene. Zones with no clip yet stay black.

**Shapes outside the eight zones** are black during a show, so a test grid or flat colour can never land on the furniture. Blocker shapes keep working. Check Set lists any unassigned shape.

**Shared pictures.** Zones playing the same clip share one renderer, so a pair of speakers stays perfectly in step and costs one instrument. Brightness, colour, audio response and bursts stay separate per zone because the compositor applies them. Speed belongs to the shared picture, so it uses the average of those zones' Knob 1 offsets, and the screen marks the zones as linked. To run a zone independently, duplicate the clip.

## Worked examples

### Example 1: setting up a room

1. In **Map**, draw shapes on the left speaker, right speaker, sofa, table and so on, and group them.
2. Draw the tulle area as a shape or group named `Ceiling`, with a soft edge.
3. Open **Perform**. Zones are offered from the Map groups in order. Drag `Ceiling` to strip 8.
4. Drag Living Ink on to the Intro row under SPK L and SPK R.
5. Right-click that clip, choose **Duplicate and edit**, darken its palette in Studio, and place the copy under Break.
6. Press **Check Set**. It reports any clip that is too heavy, a zone with no clips, or a ceiling look with fine detail likely to shimmer on the mesh.

### Example 2: the track drops

The DJ is building to a drop at bar 61, at 128 BPM. Each bar lasts 1.875 seconds. Launch is set to 1 bar.

| Time | You | What happens |
|---|---|---|
| Since Build launched | Nothing | Drop is the next scene, so its looks are already armed off-screen |
| Bar 60, beat 2 | Press **Bank ▶** | Drop flashes on screen and on the amber buttons |
| Bar 60, beat 4 | Press **Bank ◀** only if the DJ extends the build | The queued scene cancels with nothing visible, and stays armed |
| Bar 61, beat 1 | Nothing | Seven room zones **cut** to the Drop clips exactly on the bar |
| Bar 61 | Hold **Red** on strips 1 and 2 | Both speakers punch with the kick until released |
| Throughout | Nothing | The ceiling keeps dissolving through its own loop |

If a Drop look isn't armed by bar 61, it does not flash or stutter. The zone keeps its old look and launches on the next bar, and its dot stays amber.

### Example 3: play one object

During a long groove, the room feels static.

- Press **Amber 3**: the sofa moves to its next clip on the next bar, and nothing else changes.
- Turn **Knob 2 on strip 3**: its colour moves.
- Turn **Knob 3 on strip 3**: it responds harder to the bass.
- Regret it? **Solo + Amber 3** returns it to the previous clip.

### Example 4: the ceiling

The ceiling plays `Slow Silk` with a 16-bar dissolve.

- Press **Amber 8**: `Mist` starts dissolving in at the next bar and completes over 16 bars.
- Drop lands: the ceiling ignores the room scene.
- Want a ceiling moment? Hold **Red 8**: it slowly swells, then settles after release.
- Scene row option `Include ceiling` lets a chosen scene, such as the finale, deliberately change it.

### Example 5: the beat goes wrong

The DJ mixes into a track with a long beatless intro.

1. The tempo light goes from **LOCKED** to **HOLDING**. The clock keeps running at the last good tempo.
2. The kick returns slightly off. The app re-locks the beat by itself.
3. Launches land on beat 3 rather than beat 1. Press **Solo + Bank ◀** exactly on the real downbeat. Every later launch is corrected.

### Example 6: stepping away

Set Break to `after 16 bars → Intro` and Intro to `after 32 bars → Break`. The room cycles by itself. Any manual scene launch takes over, and the follow timer starts again from that scene.

### Example 7: something fails

| Fault | What the audience sees | What Greg sees |
|---|---|---|
| MIDImix unplugged | Picture continues | `MIDImix lost`, then it resumes when reconnected |
| Audio cable pulled | Picture continues on the held tempo, reaction eases to zero | `AUDIO lost · HOLDING` |
| A clip fails to load | Zone keeps its current look | Red dot and the reason |
| Machine overloaded | Existing governor lowers internal drawing size | Warning, with the heaviest clip named |

## Clock and audio

**Input.** Perform uses the existing audio input and device picker. The Mac needs a USB audio interface fed from the DJ mixer's booth or record output, because a MacBook has no proper line input. A level meter makes setup easy. Audio is analysed live and never recorded.

**Beat following.** `TempoClock` gains a new source, `follow`, and a show switches the clock to it. All tempo-synced loops, borders and links then share one clock. The existing `beat` source is unchanged, so shows that do not use Perform behave as they do today.

- An onset near the expected beat gently corrects phase and tempo.
- An onset far from the expected beat is ignored, so syncopation cannot move the bar.
- Tempo is folded into 85–175 BPM.

The clock has three states:

- **LOCKED:** confident tempo and beat.
- **HOLDING:** low confidence or silence. It free-runs at the last good tempo.
- **MANUAL:** Greg has tapped or fixed the tempo, or uses MIDI clock.

Automatic detection finds beats more reliably than bars, so **"This is the 1" is a first-class control**. Tap tempo stays available on screen and through a shift combination chosen after the hardware test.

**Launch timing.** The studio window owns the clock. It sends the wall an exact launch time ahead of the beat, in a time base shared by both windows (`performance.timeOrigin + performance.now()`), so a message delay does not move the change. A launch pressed up to about 100 ms *after* a bar counts as that bar and fires immediately, because human presses land slightly late.

**Beat-locked loops.** Perform uses each source's existing `tempoSync`, set as `Free` or a loop of 1, 2, 4, 8 or 16 beats (up to 4 bars), so Map's menus and video fitting do not change. Swapping between locked clips keeps musical position, as Ableton's Legato does. Ceiling clips default to `Free`.

**Knob 1 on a locked clip** steps the loop to ½×, 1× or 2× and stays on the beat grid. On a video it changes playback speed in the same way. A Live look has no speed, so its knob is marked inactive on screen.

**Correcting the bar.** "This is the 1" stores a bar offset of 0 to 3 beats. It re-times queued launches and follow rules without moving the beat count, so running loops and videos never jump. A locked clip launched after the correction lines up with the corrected bar.

**Which clock a show uses.** Starting a show uses `follow`, unless the saved source is MIDI clock, which stays in charge. A tap during a show moves the clock to MANUAL for that show without changing saved preferences. An on-screen **Follow** button (key `F`) returns to following the music. End show restores the source used before the show.

## Launch engine

Pure, unit-tested logic, separate from drawing:

- `launcher`: what is playing, queued and armed; what happens at a given beat.
- `controls`: MIDI message in, performance action out.
- `sequence`: follow-on rules.

**Overlay, not edits.** A running show never changes Map's saved shapes, undo history or scenes. The wall applies Perform's zone choices over the current show, so a Map edit such as nudging a corner still reaches the wall and keeps the running looks.

**Arming.** The next scene is armed as soon as the current one lands, so it is ready before Greg presses anything. Anything else that gets queued arms at that moment. The wall prepares each instrument off-screen and draws one frame, or loads a video to its first frame. Armed sources are not drawn every frame.

**Renderer budget.** Electron keeps only 16 WebGL contexts by default and silently kills the oldest, which could be the projector's own stage. The app therefore starts with `--max-active-webgl-contexts=32`, proved by a soak on this Mac. Perform budgets at most 8 playing, 8 armed and 1 outgoing ceiling look, inside the existing 24-instrument cap. If the switch does not hold in the soak, the budget falls to 14 renderers in total: playing looks come first, then the ceiling's outgoing look, then armed looks. A look that cannot be armed shows a red dot and is never allowed to threaten the stage.

**Outgoing looks.** The ceiling's outgoing loop keeps moving through its whole dissolve. A room look keeps moving through its blend when the budget has room, and otherwise holds as a still for that short blend.

**Launching during a blend.** A room zone takes the picture currently on the wall, including the part-finished mix, as the new starting point, so nothing jumps. A new ceiling loop waits for the running dissolve to finish. Pressing Amber 8 again changes which loop is waiting.

**Blends.** `cut`, `fade` over ½, 1, 2, 4 or 8 bars, `dip` through black, and for the ceiling `dissolve` over 8, 16 or 32 bars. Defaults by launch: room `cut` on a scene, room `fade 1 bar` on Amber, ceiling `dissolve 16 bars`. A clip normally uses these defaults. If Greg sets a blend on a clip, that blend always wins. Durations are fixed in milliseconds at launch, so a tempo change does not distort a running fade.

**Per-frame performance values.** A small new wall message carries zone brightness, hue, speed, audio reaction, burst and master. These apply in the compositor and never create a new composition. Existing links keep working underneath them.

**While a show runs.** Map's scene bar, triggers and auto-advance are paused with a visible note, because they would change the picture outside the launcher. They resume when the show ends. MIDI links stay active, and Check Set warns if a link or trigger uses a control the MIDImix layout also uses.

## Data

The Perform set lives in the `.formshow` file as `performance`, which raises the show format from version 8 to 9. Files from versions 1 to 8 open with an empty Perform set. `validateShow` repairs the new fields one by one, as it does today.

```ts
interface PerformanceSet {
  zones: Zone[];               // exactly 8; a zone may be unassigned
  scenes: Scene[];             // up to 16 rows
  clips: Clip[];               // cells refer to these
  launchQuantize: '1/4' | '1/2' | '1bar' | '2bar' | '4bar';
}
interface Zone { id: string; name: string; target: { kind: 'group' | 'shape'; id: string } | null; protected: boolean }
interface Clip {
  id: string; name: string; sourceId: string; hueOffset: number; // instrument, video id, or Live
  blend: { kind: 'cut' | 'fade' | 'dip' | 'dissolve'; bars: number } | null; // null uses the launch default
  audioBand: 'bass' | 'mid' | 'high' | 'level';
}
interface Scene {
  id: string; name: string;
  cells: (string | null)[];    // one clip id per zone; null keeps what is playing
  includeProtected: boolean;
  follow: { afterBars: 4 | 8 | 16 | 32; to: 'next' | 'previous' | 'first' | 'random' | string } | null;
}
```

Fader and knob positions are not part of the file. BPM and audio device are per-machine settings and are stored outside the show.

**Where a clip's look lives.** Each clip points to its own Map instrument source. Dragging an instrument into the grid makes a new source. Placing an existing clip in another cell links to it, so editing it changes every cell using it. **Duplicate and edit** makes an independent copy and opens it through the existing edit-in-Studio route. A clip's base speed and its Free or locked timing are its source's existing `speed` and `tempoSync`, so clips that share a source share them. The set can hold 64 distinct sources (`MAX_SOURCES`), and the grid says so when full. `playedBy` must count clips, so their sources and videos are kept.

**Import from Map.** **Import Map scenes** creates one Perform row per Map scene, taking what the first shape in each zone plays. It is a one-time copy, and it leaves Map's scenes unchanged.

## Staying live across the app

A running show must survive moving between sections. The launcher, control input and wall link live in an app-level Perform service above the sections. The service subscribes to the existing `reactivity()` engine directly, so sound, tempo and MIDI keep running in Studio. While a show runs, it sends the wall's signals, and `useMap` does not send its own. `useMap` no longer closes the wall on unmount during a show.

Greg can open Map to nudge a shape, or Studio to fix a look, while the wall keeps playing and the MIDImix keeps working. Outline edits reach the wall as they do now.

**Editing a clip during a show is a draft.** **Edit** opens the clip in Studio without touching the wall. **Apply to show** replaces the running look through the normal hold-then-crossfade and is one undo step. **Discard** leaves the show as it was. When no show is running, a clip edits live, like a Map shape. Ending a show is a deliberate **End show** action with a confirmation.

## Permissions

No permission changes are expected. Audio input and MIDI for the studio window, the macOS microphone text and the refusal of SysEx already exist on `main`. Sending to a MIDI output uses the same `midi` permission. The wall window stays denied.

## Build order

Each stage ends with something Greg can use.

| Stage | Delivers | Proof |
|---|---|---|
| **0. On-screen controller** | A clickable copy of the controller on the Perform screen, plus keyboard keys, sending the same actions the hardware will. Greg does not own the controller yet, so no stage before 3 may depend on it. | Every control works with no hardware attached. |
| **1. Clock** | Beat following, confidence, holding and "This is the 1" in the existing tempo clock. | Clock judged against real DJ mixes, including a tempo change and a breakdown. |
| **2. Launcher** | Zones, clips, grid, armed launch on the bar. Works by mouse. | No missed launches, no flat-colour flashes, measured frame timing. |
| **3. Hardware (when it arrives)** | A test page lists every message and tests the lights, Solo and Send All, and saves the confirmed map. Then full control, lights, startup safety and reconnect. Stages 4 to 6 can go ahead first using the on-screen controller. | Greg moves each control once, then plays a full transition without touching the laptop. |
| **4. Blends and reaction** | Fades, dips, bursts, zone audio response, knobs. | Greg judges feel with real music on the projector. |
| **5. Ceiling** | Protected zone, slow dissolves, tulle checks. | Tested on real tulle in a dark room. |
| **6. Sequence and rehearsal** | Follow-on rules, Check Set, Import Map scenes, rehearsal from a recorded mix. | A 30-minute rehearsal run with no faults. |

## Checks

- Unit tests for clock, launcher, control mapping, sequence and file repair.
- A virtual MIDI device to script every control in the built app.
- A recorded audio fixture with a known tempo to measure beat accuracy.
- Launch accuracy measured in frames, stated honestly.
- A 30-minute soak at 1920 × 1080 with eight zones and scene changes.
- Sessions with Greg using the real MIDImix, decks, projector, objects and tulle. Scripted runs cannot judge feel or how the fabric looks.

## Known risks

- **MIDImix details are unconfirmed.** Akai's manual could not be read during research. Community sources suggest note-based momentary buttons and computer-driven lights. Greg does not have the unit yet, so the hardware test in stage 3 settles this. If Solo cannot act as a shift, stop and agree a new shift control with Greg before stage 3.
- **Beat tracking will sometimes be wrong**, especially on breakdowns and swung or live material. Holding and manual correction are part of the design rather than a fallback.
- **One projector has to reach both the objects and the ceiling.** Its position and lens decide whether that is possible, and each surface gets only part of the 1920 × 1080 picture.
- **Tulle is see-through.** Light passes through to the real ceiling. If the tulle hangs in the beam's path to the objects, room visuals will also land on it. Blocker shapes help, and the rig needs testing early.
- **Heavy instruments may not arm in time.** Preparation time per instrument is unmeasured. Check Set and the amber/red dots exist for this reason.

## Calls made in this design

- Perform is an overlay on Map and never edits saved shapes, undo history or Map scenes.
- Beat following is a new clock source, so existing shows keep their current beat behaviour.
- Map's scene bar, triggers and auto-advance pause during a show.
- Clips use each source's existing speed and tempo sync, in beats.
- The app raises Chromium's WebGL context limit to 32, with a smaller fallback budget.
- The ceiling's outgoing loop keeps moving, and a new ceiling loop waits for a running dissolve.
- "This is the 1" corrects launches without jumping running loops.
- Clip edits during a show are drafts with Apply and Discard.
- Scenes never store fader or knob values, which removes most pickup problems.
- Master controls the whole projector. A show starts black, Send All reads the controls, and Bank ▶ launches the first scene.
- Zones sharing a clip share one picture, and their speed knobs average.
- Shapes outside the eight zones are black during a show.
- A running show survives moving to Map or Studio.
- A clip's own blend overrides the launch default.
- An empty cell keeps the zone playing.
- The operator window owns the clock, and the wall owns drawing.
- The Perform set lives inside the show file.
- Late presses up to about 100 ms count as on the bar.

## Left to the builder

- The exact beat-tracking algorithm, chosen by measuring it against real mixes.
- Exact fader and knob response curves.
- File layout and component structure for Perform.
- The precise off-screen arming sequence inside `StudioRenderer`.
- The visual styling of the Perform screen, within the layout above.
