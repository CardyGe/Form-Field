# Map performance audit

17 November 2026 · branch `map-stage-1` at ee4ea44 · this Mac, Electron 45, 120 Hz display.

## How it was measured

- `scripts/profile-map.mjs` runs three situations in the real app, each with eight shapes on a 1920 × 1080 stage, and records each window's CPU profile (12 s, after a 4 s warm-up) and per-process CPU and memory:
  1. **Heavy, projector open.** Fractal, Sculpture, Living Ink and Oil Slides, two shapes each.
  2. **Heavy, projector closed.** The operator screen plays the same show itself.
  3. **Idle.** Eight colour-only shapes, projector open.
- The profiles used an unminified build so function names are readable.
- The wall preview's copy and JPEG encode were then timed directly on the projector page (20 samples, median).
- Not measured:
  - GPU time per instrument (there are no GPU timer queries).
  - A 60 Hz projector.
  - Long runs.

## Findings, most important first

### 1. The wall preview stalls the projector window about 40 % of the time

This is the cause of the long frames.

- **What happens.** Ten times a second, the projector page copies the stage into a 480 × 270 canvas and encodes a JPEG for the operator screen (`MapOutput.tsx`, `convertToBlob`).
- **What it costs.** The encode blocks the page's main thread for a median **41 ms** while it waits for the graphics card to hand back the picture. The whole encode takes 73 ms.
  - That is about 400 ms of every second.
  - Each stall is longer than a 60 Hz frame (16.7 ms).
- **Evidence.**
  - In the CPU profile, 44 % of the projector page's samples are inside `convertToBlob`.
  - The projector process used only about 2 % CPU in the same seconds, so the thread is waiting, not computing.
- **Effect.** Almost certainly the scattered long frames in the stage 2 results (6–10 % over 16.7 ms): one hitch per preview.
- **Fix.**
  - Take the picture without blocking: `createImageBitmap(canvas, { resizeWidth: 480, resizeHeight: 270 })`.
  - Encode it in a Worker.
  - Send only when the wall has changed, at no more than 5 a second.
  - Expected result: the hitches go, and the frame rate rises.

### 2. Every instrument re-allocates its drawing buffer on every frame

- **What happens.** `StudioRenderer.render` calls three.js `setSize` on each call (`StudioRenderer.ts:1094`), and `setSize` assigns `canvas.width` and `canvas.height`.
- **Why it matters.** Per the HTML specification, setting either one, even to the same value, resets the canvas. For a WebGL canvas that means a new drawing buffer, so eight instruments allocate eight drawing buffers every frame.
- **Evidence.** `WebGLRenderer.setSize` is 1.3 % of the projector page's main thread, plus its GPU cost, which the profile cannot show.
- **Also affects Studio.** Studio's own preview does the same on every frame.
- **Fix.** Call `setSize` only when the size changes. This is one guard in `StudioRenderer.render`, with no change to what is drawn. Studio's preview gets faster too.

### 3. Parameter definitions are copied for every layer on every frame

- **What happens.** `evaluateLayer` (`core/timeline.ts:90`) calls `parameterDefinitions(kind)`, which copies every parameter definition, often 50 to 100 objects, on each call.
- **What it costs.** About 4 % of the projector page's time, plus the garbage it leaves for the collector. Studio pays this too.
- **Fix.** Look the definitions up from a read-only table by kind, without copying, inside `evaluateLayer`.

### 4. An idle show redraws everything, all the time

- **What happens.** With only colour shapes and nothing moving, the projector page still composites the whole 1920 × 1080 stage on every frame (112 fps here). It also encodes previews 10 times a second.
- **What it costs.** 7 % of its main thread for a picture that does not change, plus graphics-card work and power. This matters on a laptop running all evening.
- **Fix.**
  - Draw only when something changed: a message arrived, an instrument is playing, a fade is running, or the size changed.
  - Send a preview only after a drawn frame.

### 5. Each instrument's picture is copied once more than needed (minor)

- **What happens.** After each render the instrument's canvas is copied into a 2D frame (`copyFrame`) before it is drawn into the shape.
- **Why it exists.** The copy is needed for frames that are skipped (Freeze, half rate) and for crossfades.
- **What it costs.** `drawImage` is 2.7 % of the page, plus GPU copies.
- **Fix.** On frames where the instrument was just rendered, draw straight from its canvas. Copy only when Freeze, half rate or a fade needs the copy.

## What is fine

| Situation | Main thread busy | Notes |
|---|---|---|
| Operator screen, projector open | 4.5 % | Mostly decoding the preview pictures |
| Operator screen playing the heavy show itself | 20 % | Instrument rendering, as expected |
| Idle operator screen | 2.5 % | |

Memory stayed steady:

| Process | Memory |
|---|---|
| Each window | About 270–310 MB |
| GPU process | 174 MB with eight instruments; 93 MB idle |

No growth was seen in the 12 s windows. Long runs are stage 5's two-hour test.

## Recommended order

1. Finding 1: the biggest gain, and it is all in Map's own code.
2. Findings 2 and 3: small guards in shared Studio code. Behaviour is unchanged, and Studio's preview gets faster too.
3. Finding 4: idle cost and power.
4. Finding 5: optional.
5. Re-run `scripts/measure-map.mjs` and `scripts/profile-map.mjs`, and compare against the stage 2 results: 105 and 96 fps, with 6 % and 10 % of frames over 16.7 ms.

## After the fixes

Fixes 1 to 4 are in; 5 is not (see below). Measured again on the same machine with the same scripts.

**Frame times** (`scripts/measure-map.mjs`, eight shapes, four instruments, 30 s):

| Mix | Before | After |
|---|---|---|
| Medium | 105 fps; 193 frames over 16.7 ms; worst 47.9 ms | 120 fps (the display's rate); 0 frames over 16.7 ms; worst 12.8 ms |
| Heavy | 96 fps; 276 frames over 16.7 ms; worst 69.9 ms | 120 fps; 0 frames over 16.7 ms; worst 9.4 ms |

**Main thread busy** (`scripts/profile-map.mjs`):

| Situation | Before | After |
|---|---|---|
| Projector window, heavy show | 71 % (44 % in the JPEG encode) | 16.5 % |
| Operator screen, projector open | 4.5 % | 2.1 % |
| Operator screen playing the heavy show | 20.4 % | 17.8 % |
| Idle show, projector window | 7 % | 0.9 % |
| Idle show, operator screen | 2.5 % | 1.2 % |

**Memory:** no growth over 90 s with the heavy show. Both pages' JavaScript heaps were flat at 78 MB and 117 MB. Process memory rose and fell with garbage collection, ending lower than it started.

**What changed:**

1. The wall preview is captured with `createImageBitmap`, which does not wait for the graphics card. It is encoded in a worker (`src/map/preview-worker.ts`), sent only after the wall changed, and at most 5 times a second.
2. `StudioRenderer.render` resizes the canvas only when the size changes. Studio's preview benefits too.
3. `evaluateLayer` reads the parameter definitions through `readParameterDefinitions`, without copying.
4. The compositor draws only when something changed: the show, the overlays, Freeze, an instrument playing or becoming ready, or a fade. The governor judges only frames that draw.

**Not done: fix 5.** The extra copy of each instrument's picture stays. Studio's renderer does not keep its picture after it is shown, so the copy is what crossfades, Freeze and half-rate drawing draw from. With no long frames left, it is not worth the risk.

**Studio check:** `npm run test:ui` stops at the same step ("Project saved." never appears) on this branch and on the commit before any Map work (0057891), after the same 12 passing checks. It is an existing failure, not caused by these changes.
