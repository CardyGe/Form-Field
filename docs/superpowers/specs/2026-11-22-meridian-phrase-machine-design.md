# Meridian: phrase machine design

22 November 2026 · Form & Field 0.17 (`main`) · Design for approval. Nothing is built.

"Meridian" is a working name.

## Intent

Form & Field gets a procedural machine that composes precise, radial, instrument-like graphics: thin rings, spokes, node lattices and a heavy glowing ring. It does not draw a fixed animation. It composes **phrases**, short musical events that appear from nothing, build, burst into colour and glitch, collapse to a point and give way to the next.

It comes in two forms that share one engine:

- **Meridian instrument (Studio and Map):** something to play with, edit, save, export and perform.
- **Meridian Live:** the same visual language driven by people moving in the room, for shows and installations.

Success: a stranger stops and stares, someone in the room realises the graphic is responding to them, and the machine can run a whole night without an operator rescuing it.

The screen recording of 12 November 2026 is **inspiration only**. It shows the vocabulary and the shape of a phrase. Meridian does not recreate that clip, its timing or its logo.

## Goals

- Endless, seed-reproducible compositions that look designed rather than random.
- Phrases that land on the music through the existing sound, beat, tempo and MIDI system.
- A deep parameter section, with a few big performance controls on top so depth never slows a live set.
- Performance moves: hold the tension, drop the peak, collapse, mutate, launch the next phrase.
- A Live version with real interaction for one person or a crowd.
- Crisp lines at any output size, 60 fps at 1080p, and frame-exact 4K export.
- Survives lost camera, lost audio, lost graphics context and long unattended runs.

## Non-goals (this design)

- New audio, beat or MIDI input code. `src/react/` is used as it stands.
- The Perform launcher. Meridian works in Map today and will be a normal clip source if Perform ships.
- 3D geometry, video textures or text generation.
- Calendar scheduling for installations.
- Multi-camera tracking or identifying individuals.
- A preset or starter that combines Meridian with other instruments.

## Anti-goals

It has failed, even if every feature works, if:

- It looks like a screensaver or a random pile of circles.
- A phrase lands visibly off the beat when the tempo is locked.
- A fault shows black, freezes the wall or needs a laptop rescue.
- Thin lines crawl or shimmer on the projector.
- It produces a dangerous full-field strobe with default settings.
- People in the room cannot tell that they are causing anything.
- A camera image is shown, saved or sent anywhere.

## Research and what it contributes

| Source | What we take | Limit |
|---|---|---|
| [Shape grammars and their constraints](https://arxiv.org/pdf/2109.10217) | Seeded rules build the composition. Added constraints protect quality. | Written for 3D buildings, so the 2D rules are our own. |
| [Toussaint, Euclidean rhythms](https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf) | Even hit patterns for each element group, and polyrhythm between groups. | Musical theory, so its visual feel must be judged. |
| [Ryoji Ikeda, *test pattern*](https://special.ycam.jp/datamatics/en/testpattern.html) | The principle that strict signal-to-image sync creates impact. | Principle only. No imitation of the work. |
| [SDF ring and line rendering](https://docs.rs/arcane-core/0.16.0/src/arcane_core/renderer/sdf.rs.html) | One instanced quad per primitive, shaded with analytic anti-aliasing. | Implementation example, not a standard. |
| [Onset and tempo tracking](https://archives.ismir.net/ismir2004/paper/000226.pdf) | Predict beats, rather than reacting late to each onset. | Applies to the conductor only. |
| [WCAG three flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html), [flash risk summary](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/118) | No more than three large bright flashes a second, with extra care for saturated red. | The guard reduces risk. It is not a certification. |
| [Chromium context-loss behaviour](https://issues.chromium.org/issues/40191737) | Rebuild the picture from state after a GPU failure. | Must be proven on the real app. |

No reliable source gives a minimum line width for projectors, so it is set by a test on the real projector.

## What exists today (`main`)

- **Studio layers** are dispatched by `layer.kind` in `StudioRenderer`. `ScopeRenderer` is the closest model: instanced line quads, half-float light, `BloomPyramid`, premultiplied output.
- **Parameters** are `Record<string, number>` described by `ParameterDefinition`, in four sections. Presets, randomise, modulation and validation all build on them.
- **Sound** lives in `src/react/`. `ReactivityEngine` publishes `audio.*`, `beat.pulse`, `beat.count`, `tempo.phase`, `tempo.beat`, `tempo.bpm` and `midi.*` as signals.
- **Links and triggers** map signals to targets in Map and Live, with MIDI learn. Trigger actions are currently scene, vary, blackout, freeze and tap.
- **Live looks** implement `Look` and read `TrackingFeed`: movement flow, people likelihood and stillness timers. Person finding runs in a worker and falls back when it fails.
- **Tempo caveat:** `TempoClock.detected()` re-anchors the beat at every detected onset, so its phase can jump. Meridian must not use that phase directly.

This checkout is behind `main`. **Implementation branches from `main`.**

## Approaches

| Approach | Trade-off | Decision |
|---|---|---|
| **A. One engine, two front ends.** A pure composition core, one renderer, a Studio instrument and a Live look. | More upfront structure. Every improvement reaches both versions. | **Chosen.** The user asked for both. |
| B. Studio instrument only. | Best editing and export, but no room interaction. | Rejected. |
| C. Live look only. | Fast to react, but weak for editing, presets and export. | Rejected. |
| D. Separate app. | Strong crash isolation, but duplicates output, mapping and audio. | Rejected. |

## Architecture

```text
 seed + parameters ─▶ COMPOSER ─▶ Score (the phrase plan, pure data)
                                     │
 Studio loop phase ─┐                ▼
 tempo signals ─────┼─▶ CONDUCTOR ─▶ EVALUATOR ─▶ display list ─▶ RENDERER ─▶ layer / Look output
 performance moves ─┘                ▲                  │
                                     │                  └─▶ FLASH GUARD (adjusts before drawing)
 Live: camera feed ─▶ BODIES ────────┘
```

| Unit | Location | Job | Depends on |
|---|---|---|---|
| `composer` | `src/meridian/composer.ts` | Grammar and quality scoring: seed and parameters to `Score` | Nothing |
| `rhythm` | `src/meridian/rhythm.ts` | Euclidean patterns, subdivisions, ramps | Nothing |
| `evaluate` | `src/meridian/evaluate.ts` | `Score` and a time position to a display list, without allocating | `rhythm` |
| `conductor` | `src/meridian/conductor.ts` | Musical position, smoothing, quantised moves | Signals as plain numbers |
| `guard` | `src/meridian/flash-guard.ts` | Estimates flash risk and limits it | Display list |
| `bodies` | `src/meridian/bodies.ts` | Stable tracks from a small presence grid | Plain arrays |
| `MeridianRenderer` | `src/rendering/MeridianRenderer.ts` | Draws the list: primitives, light, tear, resolve | three, bloom |
| `MeridianLook` | `src/live/Meridian.ts` | Implements `Look` | All of the above |

The first six are free of WebGL and DOM, so they can be tested directly. Keeping the picture a function of `(score, position, performance state)` gives exact export and allows recovery after a context loss.

## The phrase

Each phrase has seven states. The Composer sets their proportions and the performer can bend them.

| State | What happens |
|---|---|
| **Seed** | A point or short mark appears in the dark. |
| **Draw** | Rings and spokes sweep on, one musical hit at a time. |
| **Build** | Lattices, ticks and counter-rotations join. Subdivisions tighten. |
| **Charge** | Everything holds, contracts or vibrates. This state can be held indefinitely. |
| **Peak** | The hero ring ignites, light blooms and colour tears through the structure. |
| **Collapse** | The whole system falls into a line, then a point. |
| **Rest** | Near-darkness. The point becomes the next phrase's Seed, so phrases chain without a cut. |

An optional **Mark** (off by default) lets the final point resolve into an imported PNG of the user's own logo.

## Composer

**Vocabulary:** rings, arcs, dashed orbits, tick scales, spokes, twin spokes, crosshairs, polar and square node lattices, hub, hero ring.

**Grammar:** symmetry order → radial zones → assign elements to zones → phrase role per element → rhythm per group → colour accent plan.

**Quality:** the Composer generates eight candidates per seed and keeps the best under a deterministic score covering:

- radial spacing that follows a ratio set rather than even noise
- one clear hero and a limited number of line weights
- no near-tangent rings or nearly coincident spokes
- balance of empty space
- a clear contrast between Rest and Peak

A test runs 1,000 seeds and asserts every result passes the hard limits.

## Rendering

1. **Primitives.** One instanced quad draws rings, arcs, segments, squares and dots with analytic anti-aliasing. Fixed typed arrays hold up to 20,000 instances with no per-frame allocation.
2. **Light.** Additive drawing into the existing half-float target, so overlaps burn toward white.
3. **Bloom.** The existing `BloomPyramid`, driven per element so only heroes glow strongly.
4. **Tear.** Block displacement, scanline slip and RGB separation, active during Peak and at local disturbances.
5. **Resolve.** Tone roll-off, palette mapping, thin chromatic fringe, premultiplied output.

Line width is defined in output pixels with a settable floor (default 1.5 px), so thin lines hold at any resolution. Motion of thin lines is sub-pixel filtered.

## Parameters

### Performance macros (always visible)

Eight large controls, each moving many parameters along a curated curve: **Density, Tension, Order ↔ Chaos, Speed, Weight, Glitch, Heat, Scale**.

### Performance moves (buttons, keys, MIDI)

| Move | Result |
|---|---|
| **Next** | Starts a new phrase on the next quantise point |
| **Hold** | Stays in Charge while held |
| **Drop** | Jumps to Peak on the next beat |
| **Collapse** | Collapses early |
| **Mutate** | Varies the next phrase while keeping its character |
| **Reseed** | New composition next phrase |
| **Recall 1–8** | Plays a saved seed slot next |
| **Burst** | One accent without changing state |

### Full parameter groups (collapsible, searchable)

| Group | Parameters |
|---|---|
| **Score** | Seed, phrase length (1–32 bars), quantise, autopilot, variation, repeat count, state proportions (Draw, Build, Charge, Peak, Collapse, Rest) |
| **Structure** | Symmetry order, zones, radial ratio, centre X/Y, ellipse, rotation, zoom, perspective tilt, polar/square mix, negative space |
| **Rings** | Count, thin weight, medium weight, spacing jitter, arc share, dash count, dash gap, ticks, tick length, rotation speed, counter-rotation, draw-on style, wobble, opacity |
| **Spokes** | Count, twin share, twin gap, inner reach, outer reach, offset angle, length jitter, sweep speed, retract style, weight, end nodes, opacity |
| **Nodes** | Lattice type, density, size, shape, glow, jitter, chase speed, chase pattern, ring-snap, colour accent, twinkle, opacity |
| **Hero** | Radius, weight, ignition, contraction, overshoot, halo size, halo strength, inner fill, pulse amount, split |
| **Rhythm** | Euclid hits and steps for rings, spokes and nodes, rotation, swing, subdivision ramp, polyrhythm, accent, humanise, Peak rate |
| **Glitch** | Amount, block size, block aspect, horizontal slip, vertical slip, RGB split, scan bands, posterise, hold frames, radial tear, spread, colour shred, recovery, seed |
| **Light** | Exposure, core, bloom amount, bloom size, line glow, afterglow, trail length, background lift, vignette, contrast |
| **Colour** | Palette, base, accent, Peak palette, hue drift, accent frequency, saturation, fringe, colour by radius, colour by age |
| **Output** | Minimum line width, anti-alias width, safe margin, black level, mono mode, transparent background |
| **Safety** | Flash guard, maximum flashes per second, red limit, full-field limit |
| **Reaction** | Bass, mids, highs and beat amounts, audio attack and release, tempo multiplier, beat snap |
| **Live** | See Meridian Live |

### Working with them

- **Lock by group:** Reseed and Mutate leave locked groups alone.
- **Seed bank:** eight stored seeds in each layer.
- **A/B morph:** capture two states and crossfade between them.
- **Reset:** existing double-click reset works on every control.
- **Links:** every continuous parameter is a Map and Live link target, with MIDI learn.
- `ParameterDefinition` gains an optional `group` field. Older instruments are unaffected.

## Timing: the Conductor

Studio and export use **Loop time**: the loop holds a whole number of phrases and each frame is exact.

Map and Live use **Clock time**: the Conductor reads `tempo.beat`, `tempo.phase` and `tempo.bpm` and keeps its own smoothed position.

- Small corrections are slewed. A larger disagreement must persist for two beats before it is accepted.
- If signals stop, it continues at the last good tempo.
- With no audio, it runs from tap, MIDI clock or a fixed BPM through the same tempo system.
- Moves are quantised to the Score's setting, and a move pressed just after a beat counts for that beat.

`src/react/` is not changed.

**How moves reach the engine.** Each move is a momentary parameter (`moveNext`, `moveHold`, `moveDrop` and so on). A MIDI note or sound signal drives it through an ordinary link, and the Conductor acts on its rising edge (Hold uses its level). Existing MIDI learn therefore works without a new trigger type.

**How live changes stay safe.** Links change drawing values every frame and must never rebuild the Score mid-phrase. Continuous parameters apply immediately. Structural parameters (such as symmetry order, zones and counts) take effect at the next phrase, and the control shows that a change is queued.

## Meridian Live

The camera image is **never displayed**. Meridian reads only movement, presence and stillness.

**Bodies.** A 64 × 36 presence grid (people likelihood combined with movement) is read back asynchronously, so it cannot stall drawing. A tracker turns it into up to eight stable bodies with position, velocity, size, energy and stillness. They are anonymous and exist only in memory.

| Interaction | What people do | What they see |
|---|---|---|
| **Orbit** | Walk in | A ring system locks on and follows them |
| **Constellation** | Stand near someone | Spokes connect them and their rings interlock |
| **Merge** | Move together | Two systems fuse into one larger structure |
| **Throw** | Swing an arm or move fast | Spokes fire along the motion and the rings tear locally |
| **Charge** | Stand still | Their hero ring slowly fills, hums and tightens |
| **Release** | Burst into motion after charging | A Peak erupts from where they stand |
| **Conduct** | The crowd moves together | Collective energy raises Tension and can trigger a room-wide Drop |
| **Lattice** | Move through the space | Nodes light up inside their silhouette and leave a fading wake |
| **Attract** | Nobody present | A slow self-playing phrase invites people in |

Live controls: interaction mode mix, maximum bodies, follow speed, body scale, link distance, merge distance, throw sensitivity, charge time, release strength, crowd threshold, silhouette amount, wake length, attract level, mirror alignment, and beat snap (from free reaction to fully quantised).

With music, movement and beat combine: a Throw lands immediately, while its large consequences can snap to the next beat.

## Show safety and failure

| Fault | Behaviour | Operator sees |
|---|---|---|
| Audio lost | Keeps the held tempo, reaction eases to zero | Existing audio status |
| Beat becomes unreliable | Conductor holds, then re-locks gradually | `HOLDING` |
| Camera lost | Live eases to Attract | `Camera lost · attract` |
| People model fails | Falls back to movement only | Existing people status |
| Graphics context lost | Rebuilds from Score and position | Brief hold, then resumes |
| Frame time too high | Governor reduces bloom, then tear, then instance count, never line sharpness | `Quality reduced` |
| Invalid saved values | Clamped by validation | Nothing |

**Flash Guard** is on by default. It estimates the lit area of every frame from the display list and limits large bright transitions to three a second, with a stricter limit for saturated red. When the limit is reached, the hit becomes a line, colour or small-area change, so rhythm survives without a strobe. Turning it off needs a deliberate confirmation and shows a persistent warning. It does not replace a professional compliance test where one is legally required.

**Installation mode** starts autopilot, resumes the last show at launch, keeps the display awake and logs faults locally without images or audio.

## Testing and release gates

- **Unit:** determinism, grammar limits across 1,000 seeds, Euclidean patterns, Conductor jitter and dropout, Flash Guard, body tracking, parameter validation.
- **Rendering:** frame-exact export repeatability, resolution independence of line width, context-loss recovery.
- **Integration:** Studio, presets, export, Map links, MIDI triggers, Live with the test source.
- **Performance:** 60 fps at 1080p with no sustained frames over 25 ms at maximum density.
- **Soak:** 12 hours unattended on the show Mac with no growth in memory and no unrecovered fault.
- **In the room (required before calling it show-ready):** real projector line test, real camera with several people, real DJ audio including a tempo change and breakdown.

## Build stages

| Stage | Result | Done when |
|---|---|---|
| **1. Composer** | Scores, rhythm, evaluator | 1,000 seeds pass and are reproducible |
| **2. Instrument** | Renderer and a playable Studio layer | Beautiful at 1080p, exports exactly |
| **3. Control surface** | Groups, macros, moves, locks, seed bank, morph, presets | Performable without opening a group |
| **4. Music and Map** | Conductor, links, triggers, Flash Guard | Lands on real music on the wall |
| **5. Meridian Live** | Bodies, nine interactions, Attract | Strangers understand it without instruction |
| **6. Show hardening** | Installation mode, recovery, soak, room checks | All release gates pass |

Each stage is usable and reviewed before the next.

## Decisions made for this design

These were not specifically chosen by the user and can be changed:

- The name Meridian.
- Shared engine in `src/meridian/`, with no changes to `src/react/`.
- Eight macros, eight seed slots, eight tracked bodies.
- Camera image never displayed in this look.
- Flash Guard on by default.
- Mark (own logo) off by default.
- 12-hour soak as the installation gate.

## Left to the builder

- Exact grammar weights and macro curves, tuned by eye.
- Shader structure inside the renderer.
- Preset names and the initial curated library.
- Final group ordering in the panel.
