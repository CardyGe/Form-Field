# Live Smoke: design

16 November 2026 · Form & Field 0.15.0 · Design for approval. Nothing is built.

## Intent

People in front of the camera **become smoke**. Each person stays recognisable as themselves, recoloured through the app's palettes, and dissolves off into curling, billowing smoke as they move. It is the "smokey" look Greg asked for when Live was first discussed.

Smoke is the first of three new Live looks, each a separate look built and tried one at a time:

1. **Smoke**, with the shared groundwork for finding people (this document)
2. Dust: people break into coloured specks that blow away (own design, later)
3. Melt: people run and smear like wet paint (own design, later)

Glow follows those as its own look. None of these is combined into one scene.

## What the room test established

A throwaway test on branch `spike/person-mask` (commit `39e6885`) put four MediaPipe person-finding models and an empty-room method side by side on Greg's real camera.

- **Multiclass** (`selfie_multiclass_256x256`) worked best in Greg's room. It also separates hair, body skin, face skin, clothes and accessories.
- It is the slowest of the four: about 39 ms per frame on the fake camera, measured on this Mac (Apple M5 Pro). Run on the screen's own thread, it pulled the Live picture from 60 to about 52 fps.
- All the models are **sometimes triggered by things on the wall and by objects that never move**.
- The MediaPipe library tries to send usage logs to `odml.pa.googleapis.com`. The app's content security policy blocked it.
- Loading the models needed `'wasm-unsafe-eval'` added to `script-src` in **both** policies: the header policy in `electron/main.cjs` and the `<meta>` policy in `index.html`, which governs the packaged app's `file://` page. Models and WebAssembly files served from `public/mediapipe/` loaded correctly in the packaged app.

## Goals

- A **Smoke** look in Live, chosen alongside Paint.
- Each person is shown as their own picture recoloured through the palette, and turns into smoke.
- Smoke behaves like smoke: it rises, curls into eddies, keeps moving after the person stops, and thins away.
- Two behaviour controls cover the three behaviours Greg wants, with each as a named starting point:

| Starting point | Smoulder | Burn away | What you see |
|---|---|---|---|
| Solid until they move | 0 | 0 | Standing still, people look nearly like themselves; only movement tears smoke off |
| Always smouldering (default) | 0.5 | 0 | People always give off rising smoke; movement whips off much more |
| Burning away | 0.9 | 0.9 | Standing still, people slowly dissolve away entirely into smoke; moving brings them back |

- Movement always tears off extra smoke and pushes it the way they moved, whatever the two controls are set to.
- **Shared groundwork**, built so Dust and Melt can use it unchanged:
  - Multiclass person finding, off the screen's own thread.
  - Filters against false triggers.
  - The person mask published through `TrackingFeed`.
  - Recolouring a person through the palette.
- 60 fps at 1920 × 1080 on this Mac with Smoke and person finding both running, measured and recorded.

## Non-goals

- Dust, Melt and Glow.
- Using hair, skin and clothes separately. Multiclass provides them, but this project merges them into one person mask. A later look may use them.
- Telling one person from another, skeletons, faces, depth cameras.
- Showing people in their own camera colours. Greg chose palette colours.
- Recording or export.
- Show tracking while the output is open. This is still Greg's open decision from the Live review and is not part of this project.

## Anti-goals

- Camera video is never saved, sent anywhere, or shown unprocessed on the projector. Smoke shows people only after palette recolouring.
- **Nothing leaves the computer.** The MediaPipe telemetry stays blocked, and nothing downloads models at runtime: they ship inside the app.
- Paint does not change. Its look, controls and tests stay as they are, and existing Live settings files still load.
- People-finding problems never stop Live. A model that fails to load or falls behind degrades gracefully, and Live keeps running.

## Constraints

- Everything new lives in `src/live/` and follows Live's existing rules:
  - Its own real-time renderer.
  - Looks read only from `TrackingFeed`.
  - Half-float targets.
  - The operator and the artwork window each run one `Stage`, never both at once.
- **Library:** `@mediapipe/tasks-vision` pinned exactly at `1.2.0` (Apache 2.0), released 27 October 2026. Newer releases were under two weeks old when chosen.
- **Model:** `selfie_multiclass_256x256.tflite` (16.4 MB), from Google's MediaPipe model storage. Its model card, published on Google's own storage as [Model Card Multiclass Segmentation](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf), gives the licence as Apache 2.0. Add the licence notices for the library and the model to `build/notices`.
- **Content security policy:** `'wasm-unsafe-eval'` in both policies, and nothing else loosened. `connect-src` stays `'self'`, which keeps the telemetry blocked.
- **Labels:** the model's labels are `background, hair, body-skin, face-skin, clothes, others`. The person mask is 1 minus the background confidence.

## Approaches

Greg chose to have all three, as separate looks built in this order.

| Approach | Trade-off | Decision |
|---|---|---|
| **A. A real smoke simulation**: a pressure-projected fluid solver, with the recoloured person poured in as coloured smoke | The only one that gives real curling, billowing smoke. The most new code and the heaviest on the graphics card. | **This project: Smoke** |
| B. Push the recoloured person through Paint's existing wind-and-swirl field | Quick and cheap. It smears and runs like wet paint rather than billowing. | Later, as **Melt** |
| C. Break the person into particles that blow away | Striking and fairly cheap. Reads as dust or sand, not smoke. | Later, as **Dust** |

## Design

### Shared groundwork

**Person finding off the screen's thread.**
- Multiclass runs in a Web Worker, so the 39 ms per frame does not block drawing.
- Camera frames go to the worker as transferable bitmaps. Person masks come back as transferable byte arrays.
- The worker is sent at most one frame at a time. Frames that arrive while it is busy are dropped, never queued, so the mask is never more than one frame behind.
- If the GPU path is not available inside a worker, the builder measures the alternatives and records the choice. See **Left to the builder**.

**One person-finding component, owned by `Tracking`.**
- It turns the raw mask into a `people` texture at camera alignment: mirrored and cropped exactly like `TrackingFeed.camera`.
- It applies the filters (below) and light smoothing over time, to calm flicker.
- It is created only when the current look needs people, so Paint alone never loads the model.

**`TrackingFeed` gains:**
- `people: THREE.Texture`: person likelihood 0..1, the same size and alignment as `camera`, with the filters already applied.
- `still: THREE.Texture`: two timers per point, in seconds. Its resolution is the builder's choice.
  - **Since any movement nearby, sway included.** Used by Ignore still objects, so a person swaying while standing still keeps counting as a person.
  - **Since deliberate movement**, above a higher threshold so sway does not count. Used by Burn away, so a person standing still reads as still within about a second.
  - At start-up, and whenever tracking starts afresh, every point begins as **never moved**. Objects on the wall therefore never count, and a person standing still appears as soon as they sway, normally within a second. *(My call, from the builder check.)*
- `peopleReady: boolean`: false until the first mask arrives, and false again if person finding fails or stops returning masks for 2 seconds.

**Filters against false triggers**, all on the operator's Setup panel:
- **Area box:** the existing Area sliders also limit where people are found. A person partly outside the box is cut off at its soft edge. *(My call.)*
- **Ignore still objects:** after N seconds with no movement nearby, a region stops counting as a person. The control runs from 10 to 120 seconds or Off, with a default of 30. People standing still still sway slightly, so they normally stay in. The control is there because a very still person can drop out.
- **Use empty room** (off by default): when on, something counts as a person only where Multiclass finds a person **and** the picture differs from a captured empty room. A **Capture empty room** button sits beside it. It needs a fixed camera and steady light. *(My calls, from the builder check:)*
  - The capture is taken and held by whichever window owns the camera. While the output is open, the button sends a new `captureRoom` relay message to the artwork window, added to the allowed message types.
  - Opening or closing the output starts a new capture-free state, because the room picture never travels between windows. The Setup panel says "Capture the empty room again" when Use empty room is on and nothing is captured.
  - With Use empty room on and nothing captured, Multiclass alone decides.

**Show people:** the room test's operator view becomes a permanent Setup option beside Show tracking. It shows the camera dimmed, with the filtered mask in blue and its outline in pink. Like Show tracking, it is operator-only and unavailable while the output is open.

**Palette recolouring.** A person is drawn by mapping their camera brightness through the palette, like a gradient map. *(The details are my calls, from the builder check.)*
- Use the five bright palette colours (entries 1–5). The sixth is each palette's ground colour, and Paint already leaves it out.
- Sort those five by their own brightness, darkest first. Shadows on the person take the darkest and highlights the brightest, so light and dark on a face stay the right way round. This holds for every palette, including Pour, whose entries are not in brightness order.
- Multiply the result by the person's lifted brightness, so the deepest shadows still fall towards black and faces keep their shape.
- A slow drift over time and position shifts which colour each brightness picks, like Paint's Colour change.
- Contrast is lifted so faces stay readable.

Dust and Melt will use the same function.

### Smoke

**Simulation.** A grid fluid solver in the style of Pavel Dobryakov's WebGL Fluid Simulation (MIT licence; port it with credit and add its notice). Each step runs these passes in order:
1. Curl.
2. Vorticity confinement.
3. Divergence.
4. Pressure, by Jacobi iteration.
5. Gradient subtract.
6. Advect velocity.
7. Advect smoke colour.

Pavel's defaults are the starting point: a 128-cell simulation grid, 1024 smoke colour, 20 pressure iterations and curl 30. The grid follows 16:9 here.

**What goes in each step:**
- **Movement:** where `TrackingFeed.flow` shows movement inside a person, velocity in that direction is added. Recoloured person colour is poured in, in proportion to movement strength × Movement response.
- **Smoulder:** recoloured person colour is poured in continuously at the person's edges and across their body, with a gentle upward push and a little noise.
- **Rise:** smoke drifts upward in proportion to its density.
- **Burn away:** where a person has been still (`still` above about 1 second), their own picture fades, by up to Burn away × 100% after about 3 seconds still. Its colour goes into the smoke as it fades. Movement restores it within about half a second.

**What is drawn**, from back to front:
1. The smoke.
2. The recoloured person on top. Its opacity is 1 minus the Burn-away fade, and it has a soft edge so the person melts into their own smoke.

The ground is black. Smoke on white is not offered.

**Without person finding.** Before the first mask, if the model fails to load, or if masks stop arriving for 2 seconds (`peopleReady` false), Smoke does not go black. *(My call, from the builder check.)*
- Smoke is poured in from movement alone across the whole picture, inside the Area box, so the wall keeps reacting.
- The recoloured person layer fades out over about a second, and the last mask is not held.
- The operator's Setup panel shows a status line: "Finding people…", "People not found: <reason>" or "People finding is behind".

When masks resume, the person layer fades back in.

**Smoke controls** (right column, like Paint):

| Control | Range | Default |
|---|---|---|
| Smoulder | 0–1 | 0.5 |
| Burn away | 0–1 | 0 |
| Movement response | 0–3 | 1 |
| Rise | 0–1 | 0.4 |
| Swirl | 0–1 | 0.5, which is curl 30 |
| Smoke life | 1–20 s | 6 s; the time for smoke to fade to 5% |
| Colour change | 0–1 | 0.3 |
| Palette | the same list as Paint; Smoke keeps its own choice, separate from Paint's | Hot Signal |

Three **Start from** buttons set Smoulder and Burn away to the starting points in **Goals**.

**Choosing the look.** A **Look** choice at the top of the right column offers Paint or Smoke. It is saved in Live settings and sent to the artwork window like every other setting.
- Switching clears the outgoing look's state. Each look keeps its own control values.
- An old settings file without a look loads as Paint.

### Settings

Live settings gain:
- `look` (`'paint' | 'smoke'`, default `'paint'`)
- `smoke`, the Smoke control values, including its own `palette`. The existing top-level `palette` stays Paint's, so 0.15.0 files keep working without migration. *(My call.)*
- `people`, the filter settings: ignore-still seconds or off, and use-empty-room

`validateLiveSettings` keeps its rule of repairing field by field, and a settings file from 0.15.0 must load unchanged. The captured empty room is a picture of the room, so it is **never saved**; it is captured again after each start.

## Checks

- **Unit tests:**
  - Settings round-trip, and a 0.15.0 file loading as Paint.
  - The three Start from values.
  - The "still" timing rules.
  - The filter combination rules, including Use empty room with nothing captured.
  - Both still timers, and that they start as never moved.
  - Palette brightness sorting, including Pour.
- **Scripted renderer checks** (`scripts/verify-live.mjs`). A synthetic source with a person-shaped figure, and a stand-in mask that does not need the real model, must show:
  - smoke appears from the figure and rises;
  - smoke keeps moving after the figure stops;
  - with Burn away high, a still figure fades, and movement restores it;
  - with Smoulder and Burn away at 0, a still figure gives off no smoke;
  - an object outside the box never smokes;
  - a mask region that never moves stops counting after the Ignore still objects time;
  - clear empties the smoke;
  - output is not black;
  - a long stall does not throw smoke across the picture;
  - with person finding unavailable, movement still makes smoke and the picture is not black;
  - a person standing still with slight sway stays counted, while Burn away still treats them as still.
- **Real model:** a check that Multiclass loads and returns masks in the packaged app, and that no network request leaves the app.
- **Performance:** at 1920 × 1080 on this Mac, Smoke with Multiclass running gives a mean frame rate, worst frame time and frames later than 25 ms over at least two minutes, recorded in `docs/live-performance-2026-11.md`.
- **Room session:** Greg tries Smoke on the real camera and judges it against the intent. Smoke is not done until then.

## Left to the builder

- How Multiclass runs off the screen's thread. The design calls for a Web Worker with the GPU path; if that is not available there, measure the CPU path in the worker, or running on the main thread every second camera frame, and choose by frame rate.
- Simulation and smoke colour resolutions and the number of pressure iterations, chosen by measurement against the 60 fps goal.
- The resolution of the `still` texture and how "nearby" movement is measured.
- How the mask is smoothed over time.
- How the person's edge and body are weighted for Smoulder.
- How Smoke's shaders are organised. Pavel's structure is the reference, not a template to copy line for line.
- Whether the room-test branch's code is reused or rewritten. The branch is a reference and is not merged.

## Known risks

- Multiclass is described for people near the camera. Greg's room test was encouraging, but crowds at a distance are untested.
- Smoke and a 16 MB model in the background together may not hold 60 fps at 1920 × 1080. The fallbacks, in order, are:
  1. a smaller smoke colour resolution;
  2. fewer pressure iterations;
  3. the model on every second camera frame;
  4. 1280 × 720 output.
- Ignore still objects can drop a person who stands extremely still for longer than its time.
- The app grows by about 20 MB: the library's WebAssembly files plus the model.

## Change after the first try-out (16 November 2026)

Greg tried Smoke on his camera: "the smoke effect is really cool but i dont want to see the person … the effect should turn the person/s into smoke". He also found that the three Start from points "dont really chage much". He approved the change below.

**People are made of smoke, not shown.** This replaces the parts of the design above that draw the person:
- **No person layer.** The camera picture is never drawn on the artwork, recoloured or otherwise. It is used only to find people and their movement.
- **The figure is smoke.** Smoke is poured across each person's whole body, up to a level set by **Density**, so their shape reads as a churning smoky figure.
  - Inside the body the smoke keeps a gentle swirl.
  - Moving tears smoke off and pushes it.
  - Standing still, the figure stays. **Smoulder** sets how much it sheds: at 0 the figure holds its shape; at 1 smoke streams freely off it and rises.
  - When a person leaves, their figure drifts apart and fades.
- **Colour comes from the palette alone.** It is the smoke palette's five bright colours, drifting over space and time with Colour change. The camera's light and shade are not used.
- **Burn away is removed.** It is replaced by **Density** (0–1, default 0.6): from a faint figure you can half see through, to a thick, solid-looking one. Saved settings that still contain `burnAway` simply ignore it.
- **Start from sets all the smoke controls, so the three are clearly different:**

| Start from | Density | Smoulder | Rise | Swirl | Smoke life | Movement response |
|---|---|---|---|---|---|---|
| Wispy | 0.25 | 0.9 | 0.8 | 0.7 | 4 s | 1.5 |
| Smouldering (default) | 0.6 | 0.5 | 0.4 | 0.5 | 6 s | 1 |
| Solid | 1 | 0.1 | 0.15 | 0.3 | 10 s | 0.7 |

  The values are a first pick, to be judged on the camera. *(My call.)*
- **Checks:**
  - The Smoke materials never receive the camera picture.
  - With Smoulder at 0, a still figure sheds almost nothing outside its outline.
  - Higher Density gives a brighter figure.
  - The three Start from points differ measurably in how bright the figure is and in how much smoke leaves it.

Unchanged: person finding, its filters, Show people, the smoke simulation, the movement-only fallback, and the other controls.

## Second try-out (16 November 2026)

Greg recorded Smoke on his camera and said it "could be improved". The recording showed five problems:
- The figure looked like a flat colour cut-out, even at Density 0.25.
- A bright neon line traced the outline.
- After a few seconds the whole picture filled with smoke.
- Smoke piled up against the frame edges.
- Colour swept across the body in broad bands.

He agreed to these changes:
- **The figure is made of wisps.** It is turbulent, drifting smoke with dark gaps. **Density** decides how much of the figure is filled in, as well as how bright it is: low is a broken, ghostly shape, high is thick.
- **Edges fray.** Smoke peels off the outline in broken wisps instead of collecting into a bright line.
- **Smoke leaves the frame.** The edges are open, and smoke thins away near them instead of piling up.
- **The background stays mostly dark.** Less smoke is poured by movement, and what is poured comes in wisps rather than as a fog.
- **Colour drifts at the scale of the smoke,** not in bands across the body.

**Checks:**
- A low-Density figure has dark gaps, and more of them than a high-Density one.
- The outline is not brighter than the inside of the figure.
- Smoke does not build up at the frame edges.
- With a figure moving at the default settings, most of the picture stays dark.
