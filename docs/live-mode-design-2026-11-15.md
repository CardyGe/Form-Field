# Live mode and Paint: design

15 November 2026 · Form & Field 0.14.0 · Design for approval. Nothing is built.

## Intent

Point a webcam at people and project them on a wall, transformed in real time. This is a new direction for the app: until now it makes looping clips for export; Live makes a picture that only exists while it runs.

This document covers the first of several projects:

1. **Live mode and Paint** (this document)
2. Smoke (needs a person mask; its own design)
3. Glow (its own design)
4. Later: letting existing effects read the live camera and movement

Each look is a separate thing. None of them tries to reproduce a reference as a combined scene.

## Goals

- A **Live** section in the app, separate from the layer stack and the timeline.
- Camera input from any connected webcam, and a video file as a stand-in for testing without people.
- A full-screen artwork window on a chosen display (the projector). Controls stay on the laptop.
- Movement tracking that measures where and in which direction things move.
- One finished look, **Paint**: movement lays down opaque, bristly, saturated paint that covers the wall and slowly fades. Style reference: Memo Akten's [Body Paint](https://memo.tv/projects/2009/body-paint/).
- 1920 × 1080 at 60 frames per second on this Mac, measured and recorded, not assumed.

## Non-goals

- Export or recording of live output.
- Finding people (person mask). Paint does not need it. It arrives with Smoke.
- Smoke, Glow, particles or any second look.
- Mixing live looks with existing layers, or feeding the camera into existing effects.
- Projector warping, keystone, edge blending, multiple projectors.
- Sound reactivity, infrared cameras, depth cameras.

## Anti-goals

- Camera video is never saved, sent anywhere, or shown on the projector unprocessed. Setup previews (raw camera, tracking view) appear on the operator screen only.
- The existing loop, seek and export behaviour must not change. Existing tests keep passing untouched.
- No look that only works with a synthetic test figure. Paint is judged on a real camera in a real room.

## Constraints found in the app

- `electron/main.cjs:206` denies every permission request, and the packaged app has no camera usage text. Camera access must be opened narrowly: video only, this app's own page only.
- `setWindowOpenHandler` denies all new windows. The artwork window must be created deliberately by the main process.
- The content security policy has no `media-src`; a chosen video file needs one.
- `StudioRenderer` is built on a looping phase and re-runs history so any frame can be reproduced. A live camera cannot be replayed, so Live gets its own renderer.
- Useful to reuse: half-float render targets, `bloom.ts`, palettes, the full-screen pass helper pattern, `backgroundThrottling: false`.

## Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. Separate Live mode with its own renderer** | Clean real-time clock and state; no risk to export. Live looks cannot sit in the layer stack yet. | **Chosen by Greg**, because Live can later feed existing effects. |
| B. A "Live" layer kind inside `StudioRenderer` | Live over existing instruments straight away. Requires reworking loop, seek, warm-up and export assumptions throughout a 1,184-line renderer. | Rejected for now. |
| C. Keep building in TouchDesigner | Fast to prototype. Capped at 1280 px on the non-commercial licence, separate from the app, and the native optical-flow operator is Windows/NVIDIA only. | Rejected. |

## Design

### Shape of the code

- `src/live/` holds everything new: source, tracking, the Paint look, the Live renderer, settings.
- **`LiveRenderer`** owns a real-time loop: measured time step (capped so a stall cannot explode the picture), tracking, the current look, final output. It shares small helpers with the existing renderer but does not import `StudioRenderer`.
- **Tracking outputs are plain textures behind one small interface**: camera image, movement field, and later a person mask. Looks read only from that interface. This is the seam that later lets existing effects use the camera, and lets Smoke add a mask without touching Paint.
- A **look** is one module with a fixed contract: create, step (time step + tracking in), draw, clear, dispose, plus its list of controls. Paint is the first.

### Source

- Webcam through `getUserMedia`, with a device picker and a clear message when no camera is available or access is refused.
- Video file through a file picker, looping, for development and tests.
- Camera frames are processed at up to 1280 × 720. New tracking is computed only when a new camera frame arrives; the picture still updates every display frame.
- Mirror on by default (camera at the wall, facing the people).

### Movement tracking

- A movement field at about 320 × 180: direction and strength per pixel, from the change between consecutive camera frames (the same local least-squares method as Codex's `party_flow.frag`, rewritten for this renderer).
- Camera-noise floor and sensitivity controls, light smoothing over time, and an **interaction box** so screens, curtains and bystanders can be left out.
- A tracking preview for the operator: camera with the movement overlaid.

### Paint

What the reference photos show, and what Paint must do:

- **Opaque paint that covers.** New colour lands on top of old colour. Not additive light on black.
- **Bristly strokes.** Moving areas throw fine streaks along the direction of movement, fanning out, with speckle at the ends.
- **Colour per gesture.** Colour drifts through the palette over time and place, so neighbouring gestures differ.
- **Slow fade.** With no movement the wall gradually returns to the ground colour.
- **People are not drawn.** Only their movement paints.

Mechanism (my call): streak particles are born where movement is strong, travel along the measured direction, and are stamped onto a canvas that keeps its history. The canvas fades slowly and drifts slightly so wet colour moves.

Controls, about seven: Movement response, Stroke length, Bristle, Spread, Fade time, Colour change, Palette. Ground colour (black or white) as a setting.

### Operator screen and artwork window

- Live section layout: source and setup on one side, look controls on the other, preview in the middle.
- **Open output** puts a borderless full-screen window on the chosen display. Escape closes it.
- **Blackout** makes the artwork black at once while everything keeps running. **Clear** wipes the paint.
- The operator always sees what the projector shows. A lower rate preview is acceptable; it must not cost output frames.
- My call: when the artwork window is open, the renderer runs in that window and draws straight to the screen. How the preview reaches the operator screen is left to the builder.

### Settings

Live settings (camera, mirror, box, sensitivity, look controls, display) save to their own file in the app's data folder. They are not part of a project file and do not change the project format.

### Permissions and packaging

- Allow only camera video, only for the app's own page; everything else stays denied.
- Add the macOS camera usage text to the packaged app and ask for access the first time Live is opened, not at launch.
- If access was refused, say so and point to System Settings.

## Checks

- Unit tests for the pure logic (settings, interaction box, time-step capping, particle birth rules).
- A scripted run in the built app using a bundled synthetic movement clip: output is not black, paint appears where movement is, blackout is black, clear clears, and still input fades.
- A measured performance record on this Mac at 1920 × 1080: frame rate over at least two minutes, stated honestly.
- A real-camera session with Greg before Paint is called done. The scripted run cannot judge how it looks.

## Left to the builder

- The preview route between the two windows.
- Particle count, canvas resolution and internal formats, chosen from measurement.
- Exact file layout inside `src/live/` and how the Live section is reached from the existing interface.
- Whether tracking needs a second smoothing pass, decided on real footage.

## Known risks

- A webcam needs light on the people. A dark room gives noisy tracking; the noise floor helps only so far.
- If the camera can see the projection, the paint reacts to itself. Camera placement and the interaction box are the remedy.
- Frame rate at 1920 × 1080 is unmeasured until built.
