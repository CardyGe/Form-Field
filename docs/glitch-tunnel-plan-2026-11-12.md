# Form & Field: Glitch Tunnel plan

12 November 2026 · main at `259b259`

Reference: `Screen Recording 2026-11-11 at 20.46.00.mov` (30 s, 844×1432 portrait, 60 fps). Stills are in [glitch-tunnel-reference/](glitch-tunnel-reference/): a 12-frame contact sheet across the whole clip, two strips at 4 frames per second (4 s and 15 s in), and one full frame at 10 s.

## 1. What the reference is doing

It is a **video feedback tunnel**, the same family as Recursion Tunnel, but degraded like a broken codec instead of cleanly re-banded. Six things combine:

| # | Visual trait | Where to see it | Already in the app? |
| --- | --- | --- | --- |
| 1 | **Nested frames.** A rectangle of fresh content sits in the middle; every earlier frame is shrunk around it as a ring, dozens deep. | Every frame. | **Yes**: Feedback with Echo zoom below 1 and Source frame/window. |
| 2 | **Fast-cutting centre content.** The centre swaps texture roughly every 0.2–0.3 s: photos of concrete, soil and rock; 1-bit pixel patterns; diagonal stripes; zig-zag dither; random coloured pixel blocks. Each cut leaves a ring in the tunnel, so the history of cuts reads outward. | `motion-4s.jpg`: eight different centres in two seconds. | **No.** Sources move smoothly; nothing hard-cuts between unrelated textures. |
| 3 | **Tilted, travelling vanishing point.** The tunnel is seen at an angle: the rings stack like steps on one side and compress on the other, and the vanishing point swings around the frame over several seconds. | Contact sheet: square-on at 7 s and 25 s, strongly tilted at 0 s, 15 s and 20 s. | **Partly.** Echo drift moves the echo flat; nothing gives a perspective (keystone) tilt per generation. |
| 4 | **Outer echoes smear into streaks.** Towards the edges, each ring is stretched into long pixel streaks pointing outwards (vertical at top and bottom, horizontal at the sides), like a clamped texture edge or pixel sort. | `frame-10s.jpg`, top and bottom thirds. | **No.** Echo melt smears along brightness slopes, not along the tunnel direction, and it stays soft. |
| 5 | **Rounded corners and lens bulge.** The rings become rounded rectangles and, in the corners, concentric rainbow arcs appear: the echo is bent by a barrel lens each pass. | Contact sheet frames 3, 4, 10, 11. | **No.** Source frame is a hard square; the echo transform is affine only. |
| 6 | **Codec-crunch colour.** Every generation gets crunchier: colour collapses to saturated primaries (magenta, cyan, yellow, green, red on black), 8–16 px blocks appear, channels slip sideways. Fresh centre content is fairly natural; outer rings are pure glitch. | All frames. Natural concrete inside, neon blocks outside. | **Partly.** Echo hue shift rotates colour; Flat colour bands the result. Neither degrades progressively per echo, and neither blocks or shifts channels. |

Motion feel: the tunnel recedes steadily (about one ring every 2–3 frames), the centre hard-cuts, and the tilt drifts slowly. It is noisy at frame level but calm at the scale of seconds.

## 2. Approach

Recursion Tunnel proves the core already works. Rather than a new instrument, add the missing pieces where they belong so **any layer** gets them:

- **Traits 3, 4, 5, 6** extend the Feedback finish (`src/rendering/feedback.ts`, `FEEDBACK_PARAMETERS` in `src/core/finishing.ts`). They all act on the echo inside the existing pass, so they inherit the warm-up and loop guarantees.
- **Trait 2** is a new source: a **Texture cuts** variant that hard-cuts between textures at a set rate. This is the one genuinely new generator.

Alternatives considered and dropped:

- *A standalone "Glitch Tunnel" instrument with its own feedback.* Duplicates the feedback node and its warm-up logic, and keeps the glitch echo away from other families.
- *Post-process glitch on the final frame only (no per-echo degradation).* Cheaper, but every ring would be equally crunchy. The reference's defining gradient — clean centre, ruined edge — only comes from degrading inside the loop.
- *Real video decoding with datamosh (P-frame reuse).* Authentic, but not loop-safe or deterministic, and the app has no video input path. The procedural version below gets the look without it.

## 3. Work, in order

Each step is shippable on its own and ends with a preset that shows it.

### Step 1 — Echo perspective (trait 3)

Add a per-generation keystone/tilt to the echo transform.

- New params: `echoTiltX`, `echoTiltY` (−1..1, default 0): perspective tilt applied each pass, so successive rings step to one side. `echoCentreX`, `echoCentreY` (−0.5..0.5): the vanishing point the zoom collapses towards, so it can sit off-centre.
- Shader: replace the affine inverse in `feedbackFragment` with a 3×3 homography `H = T(centre)·R·S(zoom)·P(tilt)·T(−centre)`, computed on the CPU per frame and passed as a `mat3` uniform. The homography stays invertible for |tilt| < 1 at the zoom range.
- Animation: the tilt swing in the reference is just these params on a slow sine via the existing Motion routes; no new machinery.
- Loop safety: unchanged — params are per frame and the fade forgets the start.

### Step 2 — Directional streak (trait 4)

Stretch each echo outward from the vanishing point.

- New params: `echoStreak` (0..1) and `echoStreakAxis` (0 radial, 1 box — axis-aligned to the nearest frame side, which matches the reference's vertical top/bottom and horizontal side streaks).
- Shader: before sampling `uPrevious`, take *N* (6–8) taps along the streak direction towards the centre and keep the sample with the **max luma** (or the nearest one beyond a luma threshold). Max-pick keeps streaks hard-edged; averaging would blur them, which is wrong for this look. Strength scales with distance from the vanishing point so the centre stays sharp.
- Cost: 6–8 extra texture reads per pixel per frame; acceptable at 4K.

### Step 3 — Lens bulge and rounded frame (trait 5)

- New params: `echoLens` (−0.5..0.5): barrel (+) or pincushion (−) applied to the echo coordinates each pass, around the vanishing point. `echoFrameRound` (0..1): corner radius for Source frame/window, using a rounded-box SDF in place of `max(q.x, q.y)`.
- The rainbow corner arcs come for free once lens + hue shift + rounded frame run together; verify against contact-sheet frames 3 and 4.

### Step 4 — Echo crunch (trait 6)

A per-generation codec degrade. Because it runs every pass, older rings are crunched more times than younger ones, giving the clean-centre/ruined-edge gradient automatically.

- New params:
  - `echoCrush` (0..1): posterise the echo towards a small saturated set. Implementation: push saturation up, then quantise each channel to 2–3 levels (so colours snap to the RGB/CMY corners plus black and white). 0 is off.
  - `echoBlock` (0..32 px at 1080 lines): snap echo UVs to a block grid, with a per-block, per-frame hashed jitter of up to one block, so blocks shuffle the way macroblocks break.
  - `echoChannelSlip` (0..1): offset R and B samples in opposite directions along the streak axis.
- Determinism: all hashes take `(blockCoord, frameIndex)` where `frameIndex = frameAtPhase(...)`; never `Math.random` or wall time. Warm-up replays the same frames, so export order and the seam check still hold.
- Order inside the pass: transform (steps 1, 3) → streak (2) → block snap → sample → channel slip → crush → hue → fade.

### Step 5 — Texture Cuts family (trait 2)

**Decided 12 Nov: its own family**, not a Surface variant. Surface's Warp, Roundness, Relief and Softness don't apply to hard cuts, and Surface is already crowded.

Build it on the instrument registry, the cheaper route used by Living Ink, Velvet Currents, Kinetic Relief and Resonant Sand. The hand-wired route (`oil`, `super8`) needs special cases in `project.ts`, `StudioRenderer.ts` and `App.tsx`.

- `src/core/instruments.ts`: add `'texturecuts'` to `INSTRUMENT_KINDS`. Add its parameter list to `specific`, an `InstrumentInfo` entry with three starter looks, and an `explorations` look.
- `src/rendering/instrument-shaders.ts`: add a `texturecuts` branch to `instrumentFragment`. All six generators live in that branch.
- `src/core/canvas-interaction.ts`: set the canvas-drag mapping (for example `['textureScale', 'cutLength']`).
- `project.ts` validation already accepts any registered `INSTRUMENT_KINDS` entry, so saved projects need no format change.
- Randomizer: Palette changes the colours, Structure the texture mix and scale, and Motion the cut length and seed.
- Controls: **Cut length** (frames), **Textures** (one on/off toggle for each of the six generators), **Texture scale**, **Contrast**, plus the shared palette.
- Tests: add the kind to `tests/instruments.test.ts`, and add a loop test that the cut sequence wraps exactly.

- Each "cut" lasts `cutLength` frames (default 12 at 60 fps ≈ 0.2 s). A seeded hash of the cut index picks one texture generator and its parameters.
- Generators (all procedural, all in one shader branch):
  1. Rock / concrete — fBm with ridged cracks, grey-brown.
  2. Soil / gravel — Voronoi cells with noise shading.
  3. 1-bit pixel field — random cells on a coarse grid, two palette colours.
  4. Diagonal stripes — with optional dash breaks.
  5. Zig-zag dither — the green/yellow pattern at 10 s.
  6. Coloured block noise — random palette blocks, like the top-left of frame 1.
- Optional, as a follow-up: **Imported images in the rotation.** The app already embeds PNG/JPEG artwork, but registry instruments don't receive image textures today. This needs a small extension to `InstrumentRenderer`: an array of up to six image textures plus a count uniform. Do it after the procedural version ships.
- Loop safety: the cut count per loop is `floor(loopFrames / cutLength)`; `cutLength` is snapped so the loop holds a whole number of cuts, and the hash sequence wraps at the loop length.

### Step 6 — Presets and docs

- **Library → Presets → Feedback** gains three looks:
  - **Glitch Tunnel** — a Texture Cuts layer with Echo zoom 0.92, Source window 0.55, rounded frame 0.3, lens 0.15, streak 0.6 box, crush 0.5, block 8, slip 0.3, fade 0.95, tilt on a slow sine. The direct match for the reference.
  - **Square Descent** — square-on, no tilt, strong crush and lens: the 7 s / 25 s look.
  - **Stair Fall** — strong fixed tilt, streak radial, little crush: the 15 s look.
**Tuning for 16:9.** The presets target 16:9 stage output, not the portrait reference:

- **Source window:** a 16:9 window would make the tunnel a wide letterbox. Give the window its own aspect (`echoWindowAspect`, default 1.2), so the centre reads as the near-square slab in the reference and the nested rings get more room left and right than above and below.
- **Streaks:** in box mode the side regions are now the large ones, so horizontal streaks dominate. Drop the default streak to about 0.45, or the sides turn into solid smear.
- **Tilt:** sweep mostly in X (left/right staircase), which uses the wide frame. Keep Y tilt small so the vanishing point never leaves the middle third vertically.
- **Lens:** barrel strength is measured against the frame height, so the corners curve the same at any width.
- **Comparison:** render the 16:9 contact sheet, plus a centre crop in portrait for a like-for-like check against the reference.

- README: extend the Feedback section with the new controls.
- Put presets under Feedback, not Surface (the earlier plan already flags Surface as over-full).

## 4. Testing

- **Unit** (`tests/`): homography inverse round-trips; streak tap count scales with export size; crush maps to the expected 8–27 colours; cut index wraps exactly at the loop length; `cutLength` snapping.
- **Determinism**: render frame *k* twice from cold warm-up and compare pixels exactly — the hashes must not depend on render order.
- **Loop seam**: the existing per-export seam check must pass for all three presets.
- **Visual**: render the three presets to `work/glitch-tunnel/` and build the same contact sheet as the reference (`fps=1/2.5, tile=4x3`) for a side-by-side.
- **Performance**: time a 4K export of Glitch Tunnel against Recursion Tunnel; target under 2× slower.

## 5. Open questions

1. ~~**Portrait?**~~ **Decided 12 Nov: 16:9 stage output.** The reference is a portrait capture, so its proportions don't carry over directly. Tune the presets for 16:9 (see "Tuning for 16:9" below).
2. ~~**Where Texture cuts lives**~~ **Decided 12 Nov: its own family**, built on the instrument registry (Step 5).
3. **Photographic content:** procedural rock/soil only, or ship with a few bundled photo textures as well?

## 6. Size

Steps 1–4 are all edits to one shader and one parameter list — about two to three days together. Step 5 is the largest single piece (new family, six generators, randomizer rules, loop snapping) — about two and a half days, plus about half a day if imported images are added. Step 6 plus testing — about a day.
