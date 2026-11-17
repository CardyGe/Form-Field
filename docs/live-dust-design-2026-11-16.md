# Live Dust: design

16 November 2026 · Form & Field 0.16.0 · Design for approval. Nothing is built.

## Intent

People in front of the camera are made of **specks**: thousands of tiny particles in the palette's colours. Movement blasts specks off them, and the air carries the specks the way it carries smoke in Smoke. A control called **Return** decides what happens next:
- the specks blow away like sand in the wind and fade;
- or they are pulled back to the person, who reassembles as a swarm when they stand still;
- or anything in between.

Dust is the second of the three looks agreed after the room test. Smoke is done; Melt follows. Each is a separate look chosen under **Look**.

## What Greg decided

- **Both behaviours, with a control between them** ("both"). Blowing away and coming back are the two ends of one control, Return.
- **Three kinds of speck** ("dok", accepting all three with Dust as the default), chosen under **Speck**:
  - **Dust:** tiny soft dots, like ash or sand. The figure reads as a fine cloud.
  - **Sparks:** small bright glowing points with short tails as they fly, like embers.
  - **Pixels:** small hard-edged squares, a digital, glitchy disintegration.
- **Approach B:** specks are carried by the air currents of Smoke's simulation, which runs underneath without drawing smoke.

## Carried over from Smoke

These are my proposals, from what Greg chose and approved in Smoke:
- **No camera picture on the wall.** People are made of specks in palette colours. The camera is used only to find people and their movement.
- **The same person finding:** Multiclass in a background worker, the filters (area box, Ignore still objects, Use empty room), Show people, and counting a person only where the reading is solid. A real camera gives faint readings across the whole room, and drawing from those made confetti in Smoke.
- **Controls that work as they do in Smoke:**

| Control | What it does in Dust |
|---|---|
| Density | How thickly specks fill a figure |
| Emit | How many specks are shed, moving or still |
| Movement response | How hard movement pushes the air |
| Rise | How much shed specks drift upward |
| Calm ↔ Wild | The middle behaves as Smoke's air always did; calmer below, wilder above |
| Colour change | How quickly colour moves through the palette |
| Vividness | Keeps colours bright |
| Palette | Dust's own palette, separate from Paint's and Smoke's |
| Forever | Shed specks never fade, and stay inside the picture |

- **60 fps at 1920 × 1080 on this Mac,** measured.

## Goals

- A **Dust** look under Look, alongside Paint and Smoke.
- A person is a figure of specks that follows them as they move. Their shape reads clearly at the default settings, and Density thins it to a sparse, ghostly swarm.
- **Movement blasts specks off** and pushes them the way it went. The air curls and eddies as it does in Smoke.
- **Return** runs from 0 to 1, with a default of 0.5:
  - **At 0,** shed specks drift away and fade over **Speck life**, and fresh specks keep forming the figure.
  - **At 1,** shed specks are pulled back to the person and rejoin the figure. A person who stands still reassembles within a few seconds.
- **Speck:** Dust (default), Sparks or Pixels, plus a **Speck size** control.
- **Start from,** three points that set every behaviour control at once, so they look clearly different. *(My call, following Smoke's pattern.)*
  - **Sandstorm:** Return 0, fairly wild, a lot shed.
  - **Swarm:** Return 1, calm, a dense figure.
  - **Embers:** Sparks, rising, half returning.

  The exact values are the builder's first pick, checked to differ measurably, and judged on the camera.
- **Without person finding:** before the first mask, or if it fails or falls behind, movement alone still blasts specks from where it happens, as in Smoke's fallback. The picture never goes black.

## Non-goals

- Melt, Glow, and any combined looks.
- Drawing the camera picture, or the person's own light and shade, in any form.
- Three-dimensional specks, depth, lighting or shadows.
- Telling one person from another; specks do not belong to a particular person.
- Recording or export.

## Anti-goals

- Camera video is never saved, sent anywhere, or shown on the projector.
- Smoke and Paint do not change. Their looks, controls and every existing check stay as they are. Any code shared with Smoke must leave Smoke's output the same.
- People-finding problems never stop Live or blacken the picture.
- **No confetti from faint readings:** specks are only ever born where a person reading is solid.
- **No white-out:** a frame full of people or movement must not turn into a white sheet. Sparks glow, so this needs a cap.

## Design

### Specks

- **Each speck is a particle** with:
  - a position and a velocity;
  - a **home**: a point on a person it belongs to;
  - a state: on the figure, or shed;
  - an age and a life;
  - a seed for its colour and size variation.
- **The count is fixed at start-up,** for example 256 × 256 = 65,536 or more. The builder chooses it by measurement against the frame-rate goal. A fixed count also means Forever can never swamp the picture.
- **On the figure:**
  - A speck sits at its home, with a small jitter, so the figure shimmers rather than standing frozen.
  - Homes move with the body. A home is carried by the local movement around it; if it ends up outside any person, it is moved to a fresh point inside a person.
  - How many specks are on figures at once follows Density and the total area of people.
- **Shed:**
  - Specks are shed from a figure's edges and surface at the rate set by Emit, and wherever there is deliberate movement (the same "deliberate" test Smoke uses, so sway does not shed).
  - A shed speck rides the air's velocity, plus Rise, plus Calm ↔ Wild's influence. Return pulls it towards its home, re-picked on a person if needed. Within a short distance of its home, it rejoins the figure.
  - At Return 0 it never rejoins, and fades over Speck life (or never, on Forever).
- **Specks that are not needed** wait unseen until a person needs them, or until movement blasts some off.

### The air

- **Dust uses the same air as Smoke:** the fluid solver in `src/live/fluid.ts`, with Smoke's velocity rules for movement, Calm ↔ Wild, Rise and the smoke-holding inside still figures. It draws no smoke.
- Smoke's velocity rules may be shared between the two looks only if Smoke's output stays the same, as its existing checks confirm.

### Drawing

- **Each speck is one small quad,** drawn instanced as Paint's strokes are.
  - **Dust:** a soft round dot, about 1–3 pixels at 1080 high, scaled by Speck size.
  - **Sparks:** a brighter point stretched along its velocity into a short tail, glowing.
  - **Pixels:** a hard-edged square, a little larger, without a tail.
- **Colour:** the Dust palette, drifting over the picture and over time with Colour change, as Smoke's colour does. Each speck varies slightly by its seed. Vividness applies as in Smoke.
- **Blending and the white-out cap:**
  - Dust and Sparks add light, with Smoke's highlight roll-off so overlap cannot reach white.
  - Pixels cover what is under them.

### Forever

- On Forever, shed specks never fade, and the picture's edges keep them in, as Smoke's edges do.
- Because the number of specks is fixed, the picture can never fill completely, so no fullness cap is needed.

### Settings

Live settings gain `dust`, saved with the others and repaired field by field:
- **Controls:** density, emit, returnAmount, response, rise, swirl (Calm ↔ Wild), lifeSeconds (Speck life), speckSize, colourChange, vividness.
- **Choices:** speck (`'dust' | 'sparks' | 'pixels'`), palette, forever.

`look` gains `'dust'`. A settings file from before Dust still loads unchanged. *(Ranges and defaults are the builder's first pick, judged on the camera.)*

### The Live screen

- **Dust** appears under Look.
- Its column follows Smoke's layout: Start from, the sliders, a Forever tick box under Speck life, a Speck choice, Palette with swatches, and Vividness.
- The **Finding people** section in Setup shows for Dust as it does for Smoke.

## Checks

**Scripted renderer checks** (`scripts/verify-live.mjs`), with the stand-in figure and model:
- Specks form the figure where the person is, and nothing appears away from people at the start.
- A faint person reading across the room (the stand-in's `faintRoom`) gives no specks there.
- Movement sheds specks off the figure.
- **At Return 1,** most shed specks are back on the figure within a few seconds of standing still.
- **At Return 0,** shed specks never come back and fade over Speck life.
- Lower Density gives a sparser figure.
- The three Speck kinds look measurably different: tails for Sparks, hard edges for Pixels.
- A frame full of people or movement does not go white.
- **Without person finding,** movement still sheds specks and the picture is not black.
- **On Forever,** shed specks stay in the picture.
- Clear empties the picture.
- The camera picture never reaches the artwork: no Dust material receives the camera.
- **Smoke and Paint are unchanged:** all their existing checks still pass.

**Elsewhere:**
- **Live screen:** Dust can be chosen, its controls save and reload, and Paint and Smoke keep their own settings.
- **Packaged performance:** Dust at 1920 × 1080 with Multiclass running, recorded in `docs/live-performance-2026-11.md`.
- **Room session:** Greg tries it on the camera. Dust is not done until then.

## Left to the builder

- The number of specks, and how particle state is laid out in float textures.
- How homes are picked, carried with the body, and re-picked.
- How shed specks are chosen at the edges and surface.
- How the Return pull and rejoining work.
- How much of Smoke's air code is shared, and how.
- Speck sizes, the Sparks tail length and glow, and the Pixels size.
- First values for the controls and the three Start from points.

## Known risks

- The fluid solver plus a large number of instanced specks may not hold 60 fps at 1080p. The fallbacks, in order:
  1. fewer specks;
  2. a smaller air grid;
  3. 1280 × 720 output.
- With many people close to the camera, the figures may need more specks than the budget allows. They would then look sparser, never wrong.
- Homes re-picked as people move may make a figure shimmer more than intended. That is judged on the camera.
