# Morphogen: a live stripe-growth generator

22 November 2026 · Form & Field, based on `main` · Design for approval. Nothing is built.

"Morphogen" is a working name and is easy to change.

**How to read the evidence.** **[M]** is measured or read directly from this repo or a local calculation. **[S]** comes from a linked source. **[I]** is inference, including every target and technique choice not yet tested.

## Intent

Greg wants a procedural generation machine inspired by a 20-second reference clip: glossy, iridescent, finger-like stripes that branch around a lens-like disc. It must be fit for live performance and art installations, have a very robust parameter section, and wow people.

Greg chose:

- **Endless live** behaviour: it never loops, and it can respond to the room and the music.
- **A shared engine** with thin connections into the app's playback systems.

The clip is inspiration. The machine should produce a wide family of original images. No preset, test or acceptance step should aim to match the clip.

## Goals

- A real-time simulation that grows stripes, forks and fingers, and never settles into a still picture.
- A liquid-metal and thin-film finish that looks expensive on a projector.
- Forms: discs, rings, blobs and multiple bodies that bend, refract and redirect the pattern.
- A deep, organised parameter section, with a small set of performance macros on top.
- Strong presets that morph into each other without resetting the picture.
- Reaction to sound, MIDI, camera movement and people through the app's existing systems.
- Show reliability: no black frames, no crashes from bad values, recovery from GPU loss, unattended running.

## Non-goals (first release)

- Exact loops or export of a seamless clip.
- 3D geometry. The depth is a shaded height field.
- Several different Live looks on different shapes at once. Live in Map plays one Live look.
- A certified photosensitive test. The limiter reduces risk but is not a Harding certificate.
- WebGPU. The app is WebGL2 throughout.

## Anti-goals

It has failed, even if every feature works, if:

- It looks like a stripe texture sliding around rather than something growing.
- The picture freezes into a static pattern after a few minutes.
- A slider can blow it up, blank it or leave it in a dead state.
- Changing a preset visibly resets the image.
- It needs the laptop during a normal performance moment.
- It looks like a copy of the reference clip.

## What the research says

### What is producing the look

This is a reading of 14 frames, not the original creator's confirmed method. **[I]**

| Visible feature | Likely cause | Basis |
|---|---|---|
| Even stripe spacing | A system with a preferred wavelength | Swift-Hohenberg is the standard stripe-forming model **[S]** [Cross & Hohenberg](https://doi.org/10.1103/RevModPhys.65.851) |
| Y-shaped forks | Dislocation defects | Studied directly in stripe systems **[S]** [oblique stripe growth](https://arxiv.org/pdf/2102.02905), [grain boundaries](https://ar5iv.arxiv.org/html/1604.08766) |
| Stripes fanning outward | A steering direction field | Anisotropic diffusion aligns stripes **[S]** [Witkin & Kass](https://www.cs.cmu.edu/afs/cs/user/aw/www/pdf/texture.pdf) |
| Rainbow on slopes | Thin-film interference | **[S]** [Belcour & Barla 2017](https://belcour.github.io/blog/research/publication/2017/05/01/brdf-thin-film.html) |
| Offset stripes at the disc rim | A second field or refraction | Visible in frames **[I]** |

A useful consequence: stripes fanning from a centre must add new stripes as the circle widens if they are to keep their spacing. **So a radial steering field should create the forks by itself**, and they will sit where the picture needs them. **[I]** This is the heart of why the image should feel grown rather than drawn.

### Solver choice

| Option | For | Against | Decision |
|---|---|---|---|
| Gray-Scott (Living Ink) | Already in the repo | Two fields, no native wavelength control, stripes are not its natural regime | No |
| Spectral semi-implicit Swift-Hohenberg | Large stable steps **[S]** [Punke et al.](https://arxiv.org/pdf/2210.04329) | Needs a multi-pass fragment-shader FFT; spatially varying steering is awkward; no measured WebGL2 timing found | Fallback |
| **Explicit Swift-Hohenberg, 9-point Laplacian** | One simple pass, local steering and masks are trivial | Step size is limited | **Chosen** |

Explicit schemes have [severe step limits](https://arxiv.org/pdf/2210.04329). The choice of stencil matters a lot. For a 12-texel stripe wavelength, the largest stable linear step is **[M]**:

| Laplacian | Largest stable step |
|---|---:|
| 5-point | 0.034 |
| 9-point isotropic | 0.144 |

The 9-point stencil allows about **4.3 times** larger steps and reduces grid-direction bias. The first prototype must confirm this holds with steering and nonlinear terms.

### The main technical risk: the pattern can freeze

Plain Swift-Hohenberg relaxes toward a lower energy and then almost stops. **[S]** [Cross & Hohenberg](https://doi.org/10.1103/RevModPhys.65.851) An endless instrument must therefore keep feeding it. Motion comes from a slowly moving steering field, a breathing wavelength, travelling forcing, moving forms and occasional defect seeding, with an activity monitor as the safety net (see Engine).

### Show safety

WCAG 2.3.1 limits content to [three flashes per second unless below the flash thresholds](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html), and treats saturated red separately. The palette here leans toward pink and red, so the red test matters. **[S]**

## What exists today

All read from `main`. **[M]** This working branch is behind `main`, so the build must start from `main`.

- `src/live/look.ts` defines `Look`: `step`, `output`, `resize`, `clear`, `dispose`. Live has its own unseekable clock.
- **Live in Map** already lets a shape play the current Live look, including scenes, groups and Live's sound links.
- `src/react/` already provides audio bands, beat, tempo and MIDI as named signals.
- `src/live/modulate.ts` already connects those signals to Live settings.
- `TrackingFeed` provides camera movement and people.
- Live renders at 720p or 1080p, 16:9.
- `src/map/compositor.ts` runs Studio instruments in slots and recovers them from context loss. Its sources are seekable Studio projects.
- **Perform has an approved design but no code on `main`.** That design excludes Live looks from clips.
- No photosensitive limiter exists in `src`.

## Approaches

1. **Shared engine with thin connections (chosen by Greg).** One self-contained engine, connected first as a Live look, then as a Perform source. It costs more up front and is the only route that reaches both crowd interaction and clip launching.
2. **Live look only.** Fastest, and mappable through Live in Map, but limited to the single Live source and unable to be a Perform clip.
3. **Studio instrument with checkpoints.** Fits Map immediately, but seeking forces re-simulation and works against endless motion. Rejected.

## Architecture

```text
 Sound, MIDI, camera, people
             │
     Modulation (existing links + macros)
             │
             ▼
 ┌─────────────── Morphogen engine ───────────────┐
 │ Parameters → Director field → Stripe solver    │
 │                                   │            │
 │        Forms ─────────────────────┤            │
 │                                   ▼            │
 │             Height → Shading → Safety limiter  │
 └───────────────────────┬────────────────────────┘
             ┌───────────┴───────────┐
       Live look adapter      Perform adapter
       (release 1)            (release 2)
```

The engine lives in `src/morphogen/` and imports neither Live nor Map. It takes a plain input object per frame: `dt`, parameters, optional movement and people textures, and named reactive values.

## Engine

### Simulation

```text
∂u/∂t = r·u − (K + ∇²)²u + g·u² − u³ + a·∂ₜₜu + f·cos(φ) + seeds
```

- `u`: the stripe height. `K = (2π/λ)²` sets stripe spacing.
- `r`: drive. `g`: asymmetry, moving from even stripes toward fat fingers and cells.
- `a·∂ₜₜu`: diffusion along the director, which aligns stripes to the steering field.
- `f·cos(φ)`: weak forcing that can nudge stripes along a travelling phase.
- `seeds`: small disturbances from audio, movement and the anti-freeze monitor.

Decisions:

- **32-bit float state (RG32F).** At half-float precision, small updates near 1.0 round away, and slow creep would stall. **[I]** The existing `EXT_color_buffer_float` check applies.
- **Two fields in one texture:** R is the ground and G is the body inside forms. One pass updates both.
- **Simulation resolution is independent of output.** Default 1024×576, with 768×432 and 1280×720 tiers.
- **Bicubic upsampling.** Stripes are smooth and band-limited, so they scale cleanly. Use `texelFetch`, so float-linear filtering is not required.
- **Fixed-step accumulator**, at most 12 steps a frame. Excess time is dropped, so a stall cannot cause a catch-up spiral.
- **Stability clamp.** `dt` is derived from the current wavelength and steering strength, so no slider combination can exceed the bound.
- **Bad values:** the shader replaces NaN and infinity and clamps `u`.

### Director field

A low-resolution texture blended from radial, spiral, swirl, parallel, multi-pole and curl-noise fields, and optionally camera flow. Directions are treated as line directions, so `θ` and `θ+π` are equal and blends do not create false seams.

### Forms

Up to four forms: disc, ring, soft blob or superellipse. Each has position, size, softness, drift, refraction, phase offset, and its own steering and wavelength multipliers. Forms can attract, repel or orbit.

### Never-freeze system

Each second, a small asynchronous readback measures activity. If it stays below the target, the engine increases steering drift, then seeds defects. It never hard-resets. The readback must not stall the frame.

### Shading

Per output pixel:

1. Height from `u`, with optional sharpening into ridges and valleys.
2. Normal from bicubic derivatives.
3. Form dome and refraction.
4. Palette ramp driven by height, angle or field position.
5. Thin-film colour from slope and film thickness.
6. Studio-style environment reflection, from a procedural gradient and no image assets.
7. Specular, clear coat, rim, ambient occlusion in valleys.
8. Chromatic dispersion, bloom, tone mapping, optional grain.

The Belcour & Barla approach is the reference for spectral antialiasing. An RGB approximation is acceptable if it avoids visible banding.

### Safety and output

- A low-resolution luminance and red-flash monitor on the final wall output limits fast change, aiming at no more than three flashes a second. It is on by default, and turning it off requires a deliberate action.
- Audio may modulate motion and shape freely. All brightness, including Map's shape links and scene fades, passes through the limiter before the projector.
- On context loss, the engine rebuilds from parameters, reseeds and fades in. Map's own context handling remains in place.
- A quality governor lowers simulation steps, then simulation resolution, then bloom. It raises them only after sustained headroom, and never changes tier on a visible jump.

## Parameters

Every parameter has a range, default, plain-language tooltip and a target for sound/MIDI links. All continuous values are smoothed. Advanced controls collapse by default.

| Section | Controls |
|---|---|
| **Macros** | Growth, Chaos, Density, Liquid, Heat, Prism, Warp, Impact |
| **Pattern** | Stripe width, width variation, drive, asymmetry, line thickness, fork rate, defect density, alignment, edge sharpness, seed |
| **Flow** | Field type, field mix, centre X/Y, poles, spiral, swirl, curl amount, curl scale, curl speed, rotation |
| **Forms** | Count, type, position, size, softness, orbit, drift, refraction, rim, phase offset, inner stripe width, inner steering, attract/repel |
| **Motion** | Speed, evolution, wavelength breathing, travelling wave, field drift, turbulence, seed rate, anti-freeze floor, freeze, reverse drift |
| **Relief** | Depth, ridge profile, bevel, valley depth, micro-detail, normal smoothing |
| **Material** | Metalness, roughness, clear coat, specular, environment type, environment rotation, light angle, light height, fill, rim, occlusion |
| **Iridescence** | Amount, film thickness, thickness variation, thickness follows height, film index, dispersion, fringe scale |
| **Colour** | Palette, palette position, cycle speed, colour by height/angle/position, zone split, saturation, hue, contrast, exposure, background |
| **Camera** | Zoom, pan, rotation, lens bulge, mirror, kaleidoscope folds, vignette |
| **Finish** | Bloom, bloom threshold, chromatic split, grain, sharpening |
| **Reaction** | Bass/mids/highs/beat routing and depth, beat action, movement influence, people as forms, smoothing |
| **System** | Quality tier, simulation resolution, steps, governor, flash limiter, installation mode |

Performance tools:

- **Morph** between presets over beats or seconds, with the simulation running throughout.
- **Mutate** creates a nearby variation inside curated safe ranges, with one-step undo.
- **Scramble** is a controlled burst of disorder that heals back into a pattern.
- **Hold** freezes growth while shading and colour keep moving.
- **Installation mode** walks slowly through presets on a schedule, unattended.

## Looks

Twelve starting presets, deliberately far apart. Candidates: Orchid Lens, Solar Fingers, Mercury Coral, Abyss Filament, Pearl Dune, Acid Petri, Chrome Fingerprint, Ember Veins, Ice Delta, Oil Halo, Twin Moons, Monochrome Cast. All are original and none is tuned to match the clip.

## Build order

The first playable look comes first, in line with how Greg judges instruments.

Greg chose to make Morphogen a **full candidate for the party around 6 December**, including sound-reactive brightness. Safety work therefore moves ahead of the deep panel.

| Stage | Target | Result | Gate |
|---|---|---|---|
| **0. Look prototype** | 24 Nov | Solver, steering, chrome and iridescence running in the app | Greg reacts to the picture |
| **1. Engine and Live look** | 26 Nov | Forms, never-freeze, stability clamp, shading; plays in Live and on a mapped shape | No blow-ups under parameter fuzzing |
| **2. Show safety** | 28 Nov | Wall-output flash limiter, governor, context recovery, no-input running | Flash, recovery and frame targets pass |
| **3. Party instrument** | 30 Nov | Core parameters, 8 macros, 6 strong looks, morph, Mutate, Scramble, Hold, MIDImix mode, sound links | Greg can play it on the MIDImix |
| **4. Party proof** | 2 Dec | 8-hour soak, recorded DJ mix, projector rehearsal | **Go or no-go** |
| **5. After the party** | Later | Full parameter set, 12 looks, looks saved in show files, 72-hour soak, Perform source | Party feedback |

**Party cut line.** If a stage slips, cut in this order: extra looks, Forms beyond one disc and one ring, Mutate, camera reaction. Never cut the flash limiter, recovery or the soak.

**Go or no-go on 2 December.** If stage 4 fails, Morphogen stays out of the party, or plays with sound-driven brightness off if only the flash test is unresolved. Meridian's party readiness takes priority over Morphogen whenever the two compete for time. Meridian is not yet on `main`, so this is the plan's largest schedule risk.

## MIDImix: Morphogen mode

The mode is entered and left with **Solo + Send All**. It is shown on screen and by the amber lights. Perform's normal layout is unchanged outside it.

```text
           STRIP 1   2       3        4     5     6     7       8
Knob 1     Growth    Chaos   Density  Liquid Heat Prism Warp    Impact
Knob 2     Morph time · remaining knobs available through MIDI learn
Amber      Morph to look 1 to 8
Red        Hold      Mutate  Scramble Undo   (free for MIDI learn)
Fader      Brightness, exactly as outside the mode      Master: whole projector
```

- **Faders never change job**, so the brightness and blackout path is always under the hand.
- Knobs use **pickup**: on entering the mode, a macro changes only when its knob passes through the current value, so the picture cannot jump.
- Amber shows the current look solid and a queued look flashing. Morphs can land on the next beat or bar.
- Losing the MIDImix holds the current values and never stops the picture.
- This is a deliberate, narrow exception to Perform's "no shifted function" rule. Perform's design should note it when built. Until Perform exists, this mode works directly through the existing MIDI signals.

## Acceptance targets

All are proposed **[I]** and to be measured on the M5 Pro:

- 1080p, full engine: median under 8 ms and p99 under 14 ms of GPU work.
- No frame over 33 ms caused by a preset change or morph.
- 8-hour soak before a live show and 72-hour soak before an installation: no crash, no NaN, no memory growth, and activity remains above the freeze floor.
- Parameter fuzz: 10,000 random valid changes without a blown-up or blank picture.
- Forced context loss: picture returns within 3 seconds.
- Flash monitor: no more than 3 flagged flashes in any second under a worst-case audio test.
- Real-room rehearsal with projector and DJ audio before calling it show-ready.

## Known risks

- **Freezing or sameness over long runs.** Tested from stage 1.
- **Explicit-step cost at wide stripe spacing.** Fallback: a coarser simulation grid, then the spectral solver.
- **Moiré from fine stripes on projectors.** Density limits per output size, and analytic filtering of stripe highlights.
- **Pink and red palettes against the red-flash test.** The limiter treats these separately.
- **Single Live source.** Until stage 5, only one Morphogen picture can play in a show.

## Calls made in this design

- The name, the solver, 32-bit state and default resolutions.
- Release order: Live first because Live in Map already gives mapping and sound.
- The parameter grouping, macro names and preset candidates.
- Flash limiter on by default.
- All acceptance targets.
- **Flash protection boundary.** Because sound-reactive brightness will play to a real crowd, the limiter must act on the **final wall output in the Map compositor**, after shape brightness, opacity links and scene fades. This small piece is the deliberate exception to the rule that the engine imports neither Live nor Map. It reduces risk but is not a certified photosensitive test.
- **Where looks are saved.** For the party, the six looks ship with the app and Greg's adjustments stay in Live settings. After the party, looks are saved in the show file as compact named looks that scenes can recall. That needs a show-format version bump and a parameter channel separate from the 16 KB Live settings message.
- **Pictures at once.** One Morphogen simulation runs per show. In Perform, Morphogen clips are looks on that one engine, and a transition is a morph inside it. It is always running, so arming needs no warm-up. Several independent simulations are out of scope.
- **Installations.** The first release must run with no camera, microphone or MIDI, which requires changing Live in Map's missing-camera behaviour for this look. It also includes the slow preset walk and a 72-hour soak before any installation claim. Start after reboot, crash relaunch and opening hours are a separate Electron reliability project.

## Left to the builder

- Exact shader factoring, tier thresholds and smoothing constants.
- The precise thin-film approximation.
- Panel layout, following existing Live and Map UI patterns.
- Exact Perform adapter shape, once Perform exists.
