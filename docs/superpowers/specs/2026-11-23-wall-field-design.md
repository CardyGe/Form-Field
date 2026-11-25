# Wall Field: living space between the art

23 November 2026 · Form & Field, based on `main` (7c66b8d) · Design for approval. Nothing is built.

"Wall Field" is a working name and is easy to change.

**How to read the evidence.** **[M]** is measured or read directly from this repo. **[S]** comes from a linked source. **[I]** is inference, including every target, number and technique choice not yet tested. This checkout (`kinetic-relief-concertina-tests`) is behind `main`; the build must start from `main`, which has Morphogen, Live in Map and the flash limiter.

## Intent

Greg will project finished art into boxes (Map shapes). The rest of the wall, the "free space", should be alive: a reaction or wave that runs around, bounces off and wraps the boxes, so the art and the wall feel like one object. Greg masks off the background in Map and the field fills what is left.

The field must be striking on a projector in a real room. It must not look cheap.

## Goals

- A live field that treats the Map shapes as real obstacles: it reflects off them, flows around them or grows along their edges.
- No new setup: the boxes already drawn in Map are the obstacles.
- Reuses what is built: Morphogen's solver, shading, governor, performer, flash limiter, Live in Map.
- One shared "wall mask + distance field" that later instruments (particles, relief, ink) also use.
- Controls that are obvious in a dark room: a handful of macros on top, everything else collapsed.
- Safe to leave running: no freeze, no blank frame, recovers from GPU loss.

## Non-goals (first release)

- Obstacles that move every frame. Shapes change when the operator edits or a scene changes.
- People as obstacles (they could be, later: they physically block the projection).
- Several different field looks at once. Live in Map plays one Live look **[M]**.
- A certified photosensitive test. The existing limiter lowers risk only.
- WebGPU.

## Anti-goals

It has failed, even if every feature works, if:

- It looks like a screensaver: uniform ripples at constant speed.
- The boxes look pasted on: no visible relationship between field and art.
- Box edges look stair-stepped or shimmer.
- The wall is wallpapered: no dark, no rest, no hierarchy.
- It needs the laptop during a normal performance moment.

## Self-review: is this the best way?

I asked this before writing the design, and it changed three things.

### 1. "Bounce" needs a wave equation, not a reaction

My earlier message said excitable-medium waves would "bounce". That was wrong. Excitable media (FitzHugh–Nagumo, Barkley) do **not** reflect: two waves meeting head-on annihilate each other **[S]** [arXiv 0902.3891](https://arxiv.org/pdf/0902.3891). What obstacles do is anchor spirals: rotating waves attach to heterogeneities and form stable pinned waves **[S]** [arXiv 1109.6115](https://arxiv.org/pdf/1109.6115). I found no source on how such waves diffract round corners **[I]**. Gray-Scott growth wraps obstacles but also does not bounce.

Reflection belongs to the hyperbolic wave equation. Walls that hold the field fixed reflect it, and absorbing layers remove reflection **[S]** [Falstad ripple tank](https://falstad.com/ripple), [WebGL Ripples](https://github.com/m-ender/webgl-ripples), [wave damping and PML](https://rreusser.github.io/notebooks/perfectly-matched-layers-for-the-wave-equation), [UAF wave notes](https://www.cs.uaf.edu/2013/spring/cs493/lecture/03_26_waves.html). **So the literal "bounces around the free space" medium is a damped wave field.**

### 2. A plain wave field looks cheap

Ripple tanks are the classic screensaver. What saves the idea is not the physics but the finish: height shaded as liquid metal with thin-film colour, bicubic upsampling, dithering, and a nonlinear term so ripples leave trails instead of fading uniformly. Morphogen already has a shading stage built for this **[M]** (`src/morphogen/shade-shaders.ts`). The design reuses it, so the wave field and the stripe field share one expensive look.

### 3. The cheapest wow is not new physics

Morphogen is already merged and already has "forms" that refract and rim-light **[M]**. A box is just a form with an arbitrary outline. If the stripes' steering field follows the distance field's gradient, **stripes grow as contour lines around each box** (like a topographic map), and fork where the gap between boxes widens. That needs the mask, not a new solver, so it ships first **[I]**.

### 4. Technology check

| Question | Answer |
|---|---|
| Better than WebGL2 fragment shaders? | WebGPU compute is the main alternative: storage buffers, no ping-pong, more particles. three.js's WebGPU renderer takes TSL, not GLSL, so every shader would need porting, and compute is not guaranteed in the WebGL fallback **[S]** [three.js forum](https://discourse.threejs.org/t/tsl-and-webgl2-vs-webgpu/87974). Chrome has shipped WebGPU on macOS since 113 **[S]** [Chrome blog](https://developer.chrome.com/blog/new-in-webgpu-113), and this app runs Electron 45 **[M]** (`package.json`), so it is probably available; I found no Electron-specific confirmation **[I]**. **Decision: stay on WebGL2.** A 480×270 wave grid and a 1024×576 stripe grid do not need compute. Revisit for more than ~1M particles. |
| Is a GPU distance transform better? | The jump flooding algorithm computes distance on the GPU in log₂(n) passes **[S]** [Rong & Tan 2006](https://www.comp.nus.edu.sg/~tants/jfa/i3d06.pdf). It is the right tool if shapes move every frame. They do not, so an exact CPU transform on edit is simpler and more accurate. Keep JFA as the upgrade path. |
| Is the existing `distanceGrid` enough? | No. It is a bounded 8-neighbour approximation at 128×128 **[M]** (`src/core/surface-layout.ts`). Reflections off a slanted edge need an accurate, smooth distance. |
| Does Map's compositor matter? | Yes, but `main`'s is not the Canvas 2D one in the older [map performance audit](../../map-performance-audit-2026-11-17.md). On `main` the wall is drawn on the graphics card (`src/map/gpu.ts`): every shape is a textured rectangle in one WebGL2 context, the Live canvas is uploaded once a frame, and a small flat copy is read back for the operator screen **[M]**. The stall in that audit was fixed or replaced, so it no longer argues against pixel readback in general. The mask still goes one way (Map to field) only on edit. |

## What exists today

All read from `main` **[M]** unless noted.

- `Look` is the seam for Live looks: `step`, `output`, `resize`, `clear`, `dispose` (`src/live/look.ts`). `Morphogen` is one, driven by `MorphEngine`.
- Live in Map: shapes with `sourceId === 'live'` play the one shared Live, rendered on its own canvas at 16:9 by `LiveSlot` and laid on every shape that plays it (`src/map/liveSlot.ts`, `compositor.ts`).
- The stage is 1920×1080 (`STAGE_SIZE`), shapes have holes (up to `MAX_HOLES`) and blockers, up to 64 shapes (`MAX_SHAPES`).
- Stage corners warp the whole stage on the wall only, so a mask built in stage space is correct after warping.
- `TrackingFeed` already hands looks plain textures (`flow`, `people`, `still`). The people mask is the precedent for a `wall` texture.
- Morphogen: Swift–Hohenberg solver, 1024×576 float simulation, director field, forms, never-freeze monitor, quality governor, performer and macros, MIDImix.
- `src/map/flash-limiter.ts` runs at the final wall output, 32×18 cells, with a deliberately stricter area (10 % of cells) than WCAG's 25 %.
- Living Ink is a Gray-Scott reaction with `solid()` obstacles and polygon or image surface masks (`src/rendering/InkSimulation.ts`, `surface.ts`).
- `src/live/fluid.ts` is a stable-fluids solver (curl, vorticity, pressure Jacobi, advection) after Dobryakov.

**Placement (resolved by the audit [M]).** The field only lines up with the mask if the Live picture is stage-locked. `across-stage` placement does that: its landing is the whole 1920×1080 stage (`src/map/placement.ts`), and Live is 16:9, so the crop is the identity. No new placement mode is needed. The catch: Zoom, Move and Turn, or any other placement kind, break the alignment. See the mask service below for how Map handles that.

## Options considered

### Which medium (what lives in the free space)

| Medium | Bounces? | Reads as | Cost to build | Verdict |
|---|---|---|---|---|
| **Wave field (damped, nonlinear)** | Yes, literally | Liquid metal ripples ringing off the boxes | New solver, reuses shading | **Build: "Echo"** |
| **Morphogen stripes + wall** | No, they wrap | Contour lines growing round the boxes | Mask plus a boundary term and steering from the SDF gradient | **Build first** |
| Excitable medium (Barkley) | No (annihilates) **[S]** | Spirals pinned to boxes **[S]** | New solver | Later, as a third medium |
| Gray-Scott (Living Ink) | No | Coral hugging the boxes | Already exists; needs the mask | Cheap by-product (below) |
| Stable fluids | Flows around | Smoke or ink swirling between boxes | Solver exists in `fluid.ts` | Phase 2 (ink and particles) |

### Where it runs

| Option | For | Against | Decision |
|---|---|---|---|
| **A. A Live look** (shared engine, new `wall` feed) | Uses Live in Map, sound, MIDI, performer, limiter; endless clock; no seeking problem | Only one Live look in Map at a time; Live's camera and people path stays on | **Chosen** |
| B. A Studio instrument in a Map slot with a surface mask | No new plumbing: Living Ink already takes an image mask | Seekable/checkpointed, so not endless; the mask is saved in the project, not driven by Map | Use only for a throwaway prototype |
| C. A new compositor layer | Full control | Duplicates Live; more Map code to keep correct | Rejected |

### How the mask gets to the field

| Option | Decision |
|---|---|
| Rasterise the shapes to a Canvas 2D at 480×270 (stage ÷ 4) on edit or scene change, compute an exact signed distance, upload a float texture | **Chosen** |
| Read pixels back from the stage every frame | Rejected (stalls; see audit) |
| Pass polygons to the shader as uniforms | Rejected (64 shapes with holes, no soft edges) |

## Design

### 1. Wall mask service (`src/map/wallMask.ts`, pure)

Input: the show's shapes, groups, solo state, scene visibility. Output: a versioned object `{ version, width, height, texels }`.

- Rasterise every shape that is shown **and is not a Wall Field shape** as solid: art shapes, plus blockers. Holes in a shape are free space. Wall Field shapes are free.
- `shownOnWall` and `solo` decide what is shown, so the field responds to the same visibility the operator sees **[M]** (`src/map/draw.ts`).
- Compute an exact signed distance with a linear-time Euclidean distance transform (Felzenszwalb and Huttenlocher) run twice (outside and inside), then smooth it a little so the gradient is clean. It is pure code, so it is unit-tested without a GPU. Source of the algorithm: standard; I did not research an alternative **[I]**.
- Texture layout (RGBA16F, 480×270): **R** signed distance in stage-height units (negative = inside a box), **GB** unit gradient (the edge normal), **A** coverage (soft where a shape has a soft edge).
- Scene changes: build the new mask at the start of the fade and blend old to new with one uniform over the scene fade, so obstacles grow and recede instead of popping **[I]**.
- Recompute only when the show's shapes, visibility or scene change. A versioned key skips repeats (the compositor already does this for outlines and faders **[M]**).
- **Alignment rule.** A shape that plays a wall-aware Live look must use `across-stage` placement with zoom 1, no move and no turn. Map shows a plain warning on any such shape that does not ("Set Placement to Across stage so the field lines up"), and the mask is built as if it did.
- **Known mismatch.** A shape's brightness and opacity move with sound links and scene glides **[M]** (`uAlpha`, `uLook` in `gpu.ts`). The mask treats a shown shape as solid whatever its brightness. A box faded to nothing still reflects waves until its scene change finishes. This is a deliberate simplification, listed in the risks.

### 2. Delivery

- `LiveSlot.setWall(mask)` hands the mask to the Live stage; `TrackingFeed` gains `wall: THREE.Texture | null` and `wallVersion`.
- The field look uploads only when `wallVersion` changes, never per frame.
- With no mask (Live screen, not in Map) the field has the whole stage as free space, so it works in Live and Studio too.

### 3. Medium A: Morphogen with the wall (ships first)

- **Boundary:** solid cells are driven toward the resting state by volume penalisation: after each step, `u ← u × free`, where `free` is the smoothed coverage from the mask. The Swift–Hohenberg step is fourth order, with a 5×5 kernel **[M]** (`stepFragment`), so the simple "copy the neighbour across the wall" trick needs two ghost cells and is easy to get wrong. Penalisation is robust and cheap, at the cost of a softer edge **[I]**. The audit changed this from my first draft.
- **Not before the party.** This changes the solver that the 8-hour soak and the go/no-go on 2 December cover **[M]** (Morphogen party proof). It waits until after that decision, behind a switch that is off by default.
- **Steering:** the director field gains a "contour" mode: stripes run parallel to the box edge near it (angle from the SDF gradient), blending into the existing field farther away. This is the wow mechanism: contour lines that fork as gaps widen.
- **Forms:** the wall acts as a form: refraction and rim-light from the existing shader, driven by distance instead of a disc.
- **Wall influence** is a macro (0 = ignore the boxes, 1 = fully wrap them), so the operator can fade the relationship in during a show.

### 4. Medium B: Echo (new look, `src/echo/`)

A damped nonlinear wave field in the free space.

```text
∂ₜₜu = c²∇²u − γ ∂ₜu − β u³ + emitters
```

- `c`: wave speed. `γ`: ring time (damping). `β`: a cubic restoring term that makes ripples disperse and trail instead of fading evenly **[I]**.
- **Boundary:** boxes reflect. Neumann (same-sign) reflection reads as a bounce; fixed (inverted) reflection reads as a harder slap. Both are one switch **[S]** (walls hold the field fixed in the sources above).
- **Sub-cell edges:** a staircase boundary reflects slanted edges wrongly. Use the SDF to give each edge cell a fractional wall position so reflections are smooth **[I]**. The stage edge is an absorbing sponge by default (waves leave the picture), with "bounce off the stage edge" as an option.
- **Stability:** time step from the Courant limit for the grid, derived from `c`, so no slider can blow it up; NaN and infinity are replaced in the shader. The same rule Morphogen uses **[M]**.
- **Emitters:** phrase-driven rings at chosen or wandering points; the room's movement and people from `feed.flow` and `feed.people`; a slow idle emitter. The never-freeze monitor from Morphogen (`src/morphogen/activity.ts`) keeps energy above a floor.
- **Shading:** height, slope and energy go through the shared Morphogen shading (normal, thin-film colour, environment reflection, bloom) so Echo looks like Morphogen's sibling, not a different app **[I]**: step 0 below checks whether that shading takes a plain height texture.
- **Edge ring:** where a wave hits a box, the outside of that edge lights for a moment, drawn by the field into the free space next to the edge. The boxes seem to answer the field without any change to the compositor.

### 5. The art talks back to the field (second release)

Rings should come out of the boxes when the art brightens or pulses. That needs a small picture of the art going from Map's context to the field's context (they are separate WebGL contexts **[M]**). A 64×36 or 128×72 asynchronous readback plus upload is small, and `main`'s compositor already reads a flat copy back without waiting **[M]**, so this is more feasible than my first draft said. The first version still uses only what Map already knows without pixels: **shape colour, border run, and the sound or beat links the shape already has** **[M]**. Real art-brightness coupling is released after measuring the cost **[I]**.

### 6. Finish (what makes it look expensive)

| Stage | Detail |
|---|---|
| Float pipeline | Simulation in RG32F or RGBA16F. Output in linear half-float, tone-mapped once at the end |
| Upsample | Bicubic from simulation to 1080p; `texelFetch` so float-linear filtering is not required (as Morphogen) |
| Edges | The box edge is placed by sampling the SDF at output resolution, so it is anti-aliased and does not stair-step even though the simulation is 480×270 |
| Colour | Thin-film iridescence on slopes (Belcour & Barla, already planned in Morphogen **[M]**) with restrained palettes; no rainbow default |
| Banding | A final dither before the 8-bit canvas. Interleaved gradient noise needs no texture and varies per frame; blue noise looks better but needs stored tiles **[S]** [Wronski](https://bartwronski.com/2016/10/30/dithering-part-three-real-world-2d-quantization-dithering/), [Peters](https://momentsingraphics.de/BlueNoise.html), [Wolfe](https://blog.demofox.org/2017/10/31/animating-noise-for-integration-over-time/). Default: interleaved gradient noise. **Where:** in the last pass of the Live renderer, not at the wall. The wall's stage buffer is RGBA8 **[M]** (`gpu.ts`) and Live arrives as an 8-bit canvas, so any banding is baked in before the wall sees it. One dither in Live's final pass helps every Live look **[I]** (the pass itself is unchecked) |
| Bloom and grain | Small and optional, off by default for the safest first look |
| Dark | At least half the free space stays near black at rest. Contrast is what reads as expensive |

### 7. Controls

Few and obvious, in the order a performer reaches for them.

| Macro | What it does |
|---|---|
| **Medium** | Stripes · Echo |
| **Energy** | How much is moving: emitter rate and wave strength, or stripe drive |
| **Ring time** | How long waves ring before fading (damping) |
| **Hug** | How much the field follows the boxes: contour steering, edge ring, reflection strength |
| **Heat** | Palette temperature and thin-film shift |
| **Impact** | A one-shot ring or burst on a pad or a beat |

Advanced controls (wave speed, nonlinearity, wall reflection type, stage edge behaviour, resolution tier, dither) are collapsed. Every control is a target for sound and MIDI links through the existing modulation **[M]**.

### 8. Safety and recovery

- The wall output already passes through the flash limiter **[M]**. Emitters are rate-limited by default (rings at most 3 a second in any region), so the field stays below the limiter's job.
- The existing quality governor lowers solver steps, then resolution, then bloom, and never jumps visibly **[M]**.
- On context loss the field rebuilds from parameters, reseeds and fades in, as Morphogen does **[M]**.
- A bad or empty mask falls back to "whole stage is free" and says so.

## Why it should not look cheap

| What makes procedural visuals look cheap | Countermeasure here |
|---|---|
| Uniform ripples at constant speed | Nonlinear dispersion, phrase-driven emitters, idle drift, rests |
| Flat, no depth | Height shaded with normals, reflection and thin-film colour |
| Banding in dark gradients | Half-float pipeline plus dither before 8-bit |
| Stair-stepped or shimmering box edges | Edge from the SDF at output resolution; sub-cell reflection |
| Everything the same brightness | Dark rest state, bright events, a small energy budget |
| Soft and muddy on a projector | Bicubic upsample; no extra blur; bloom off by default |
| Looks the same after two minutes | Never-freeze monitor; slow wavelength and emitter wander |
| Field and art feel unrelated | Edge ring, contour steering, scene-fade mask changes |

## Will people go "wow"?

I cannot measure that from here, so these are testable intentions, not claims.

- **The moment:** the first time a ring crosses the room, hits a box, and the box's edge answers. It should be visible within seconds, with no explanation.
- **The unfolding:** contour stripes growing round the boxes and forking where gaps widen. It should read as grown, not drawn.
- **The test:** a 30-second clip of each medium on the real wall layout, watched without sound or labels by someone who has not seen it. If they point at the interaction between field and boxes unprompted, it works. If they only comment on the ripples or the colours, it does not.
- Greg's rule applies: show a striking, playable look early; heavy proofs come later.

## Other effects that improve

| Effect | What it gains |
|---|---|
| **Living Ink** | The mask as its `solid()` and surface input, so ink pools round the boxes. A stable-fluids velocity field (`fluid.ts`) can replace its fixed analytic stream, so people and MIDI can stir it **[M]** (it is not a real fluid solver today). Spatially varying feed and kill rates would give spots in one region and stripes in another; Pearson's map is for uniform parameters, so this is an extension **[S]** [Pearson 1993](https://arxiv.org/abs/patt-sol/9304003), **[I]** |
| **Morphogen** | Wall-aware boundary and contour steering; the forms system generalised from discs to any outline |
| **Smoke (Live)** | The wall as an obstacle next to the people mask, which Smoke already treats as solid **[M]**. Paint: unchecked |
| **Live looks in general** | One dither in Live's final pass removes banding for every look (see Finish) |
| **Map shapes, Kinetic Relief, Concertina** | Possible later uses of the distance field (glow borders, shadows from neighbours). Studio instruments run in separate slots and cannot see the mask today, so this is speculative **[I]** and out of scope |

## The other two instruments, on the same mask

Both come after Echo. They need no new Map work.

### Particles in the free space

- Particle state in float textures (`GPUComputationRenderer`-style) or transform feedback; showcases report around 1M to 2M particles **[S]** [Codrops GPGPU](https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/), [gpfault](https://gpfault.net/posts/webgl2-particles.txt.html). Treat counts as unverified **[I]**.
- Collision from the wall SDF: if the distance is below the particle radius, push out along the gradient and remove the inward velocity **[S]** (a secondhand post; not official) [Niagara docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/gpu-raytracing-collisions-in-niagara-for-unreal-engine). Thin colliders and fast particles can tunnel, which Godot answers with a collider thickness **[S]** [Godot docs](https://docs.godotengine.org/en/stable/tutorials/3d/particles/collision.html). Our SDF is smooth and the particles are slow, so tunnelling is unlikely at 480×270, but the shape-thickness rule is a test **[I]**.
- Spawn along the box edges. Advect by the fluid velocity from `fluid.ts`. The result is dust or sparks streaming round and out of the boxes.

### Raymarched relief

- Extrude the shapes into slabs with a height from the SDF; neighbouring boxes join through a smooth minimum for a liquid-metal bridge **[S]** [Quilez smooth minimum](https://iquilezles.org/articles/smin). Soft shadows come almost free from the closest approach along the shadow ray **[S]** [Quilez soft shadows](https://iquilezles.org/articles/rmshadows).
- Heavy on the GPU, so render at half resolution and upscale, under the same governor **[I]**.
- Overlaps with Kinetic Relief and Concertina, so decide there first whether a raymarched sibling is worth it.

## Decision: Echo is a separate look

Echo is its own Live look, in `src/echo/`, not a medium inside Morphogen.

- **For:** Morphogen's 8-hour soak, flash tests and go/no-go on 2 December cover Morphogen as it is **[M]**. Bolting a second solver onto it voids that evidence. A separate look can be built, broken and thrown away without touching the proven one.
- **For:** the two media need different parameters, macros and MIDImix maps. One panel with half its controls dead is worse than two clear ones.
- **Against, and accepted:** a new look is real wiring. Morphogen touches about 25 files outside its own folder: Live settings, `LiveRenderer`, modulation, `useLive`, the Live panel, `MapLiveCard`, Map messages, the MIDImix map, two verify scripts and seven test files **[M]** (`git grep` on `main`). Echo must repeat that pattern, so its cost is planned in, not hidden.
- **Shared on purpose:** shading, the governor, the never-freeze monitor and the macro and performer helpers are imported from `src/morphogen/` rather than copied. If they cannot be imported without change, step 0 finds out before any wiring.
- Map plays one Live look at a time, so Echo and Morphogen cannot be on the wall together. That is true under either choice.

## What we need to implement

Order matters: the first thing Greg sees should be striking, and nothing may touch the code under proof before 2 December.

| Step | Work | Output | When |
|---|---|---|---|
| **A. Layout lock** | See "Layout lock" below. Independent of everything else; guards the show from accidents | One Lock button on the Map screen | **Before the party** |
| **0. Prototype** | A throwaway page: a few box shapes, an Echo solver, the Morphogen shading. Checks whether the shading accepts a plain height texture. A 30-second clip | A clip to react to, before any production code | Before the party, in a scratch folder |
| **1. Mask service** | `wallMask.ts` with the exact distance transform and unit tests (a circle gives the true distance; holes and blockers; scene changes). Pure code, no effect on any show | Tested pure code | Before the party is fine |
| **2. Delivery** | `LiveSlot.setWall`, optional `TrackingFeed.wall`, upload on version change, the placement warning | The Live stage can see the boxes | After 2 December |
| **3. Echo** | `src/echo/` solver, emitters, edge ring, shading, governor, macros, and the look's wiring | The bounce | After 2 December |
| **4. Morphogen wall mode** | Penalisation, contour steering, wall form, **Hug** macro, behind an off-by-default switch | Contour stripes | After the party's feedback |
| **5. Finish** | Dither in Live's final pass, edge from the SDF, palette review | Looks expensive | With Echo |
| **6. Proof** | Real-wall clip, soak, flash limiter check, context-loss recovery | Report like Morphogen's | Last |
| **Later** | Art-to-field coupling, particles, relief, Barkley, Living Ink mask and fluid | Separate specs | |

New files: `src/map/wallMask.ts`, `src/echo/` (solver, emitters, shade glue, params, looks), tests next to them. Changed files: `src/map/liveSlot.ts`, `src/live/look.ts`, `src/live/Stage.ts` and `LiveRenderer.ts` (plumbing), the Echo wiring listed above, and later `src/morphogen/solver-shaders.ts` and `director.ts`.

## Layout lock (Greg's request, 23 November)

Greg wants a lock on the Map screen so shapes and Live cannot be moved by accident.

**What already exists [M].** Each shape and each group has a lock (`setLocked`, `setGroupLocked`). A locked shape refuses drags, point edits, placement changes, deleting, and changes to the instrument it plays; links that would move it are refused too (`src/map/editor.ts`, `isShapeLocked` in `show.ts`, `gestures.ts`). The only switch is a small button inside each shape's "Shape" section in the details panel (`MapDetails.tsx`). There is **no master lock**, and the stage corners (the projector warp), the add-shape tools and the Live card are not covered.

**Design.**

- One **Lock** button in the Map header next to Blackout and Freeze, with a shortcut and a padlock badge on the stage while on.
- **Locks:** every shape's geometry, holes, placement, grouping, deleting and adding; the stage corners; and the Live card's look and source choice.
- **Does not lock:** Blackout, Freeze, scenes, brightness and sound or MIDI links, so a show can still be played while locked.
- **How:** `isShapeLocked` is already the single guard for gestures and most editor actions, so it returns true when the show is locked. The stage-corner actions, add-shape actions and the Live card need their own guard. A refused action uses the editor's existing `{ reason: 'locked' }` result, so the UI already knows how to tell the operator **[M]**.
- **Saved in the show,** as an optional field the parser defaults to off, so older files load and no format version bump is needed **[I]** (check against the parser's repair rules in `show.ts`). A show reopened on the night stays locked.
- **Unlocking** is one click, with no confirmation. It exists to stop slips, not to protect against intent.
- **Tests:** every geometry action returns `locked` while on; the played-show actions still work; the flag survives save and load; an old file loads unlocked.

## Audit of this plan, 23 November

I checked the spec against `main` rather than this older branch. Verdict: **the direction holds; the sequencing and several details were wrong.** All are now corrected above.

| # | Claim in the first draft | Result | Correction |
|---|---|---|---|
| 1 | The compositor is Canvas 2D and readback stalls the projector | **Wrong for `main`.** The wall is drawn on the graphics card (`gpu.ts`) | Tech table and art-to-field section rewritten |
| 2 | Live's picture might not be stage-locked; a new placement may be needed | **Resolved.** `across-stage` placement does it | Placement note; alignment rule and warning added |
| 3 | Boundary by Neumann neighbour substitution in Morphogen | **Risky.** The solver is fourth order with a 5×5 stencil | Replaced by volume penalisation |
| 4 | Steps 0 to 3 realistic before the party | **Wrong.** Step 3 edits the solver under the 2 December proof | Wall mode moved after the party; only the lock, prototype and pure mask code come first |
| 5 | Echo is a cheap new look | **Understated.** A look costs about 25 outside files | Wiring cost stated; decision made |
| 6 | Dither "inside each instrument" because the compositor is Canvas 2D | **Right conclusion, wrong reason.** Banding is baked in at Live's 8-bit canvas | One dither in Live's final pass |
| 7 | Mask = what is shown | **Incomplete.** Brightness and fades change what is visible | Mismatch stated as a known limit |
| 8 | Wall helps Paint, Relief, Concertina, borders | **Unchecked.** Studio instruments cannot see the mask | Cut to Smoke, with the rest speculative |
| 9 | "Reuse Morphogen shading" | **Unverified.** `MorphShade.draw` takes the full `MorphParams` and Morphogen-specific uniforms | Step 0 checks; an extraction may be needed |
| 10 | Flash limiter figures (32×18 cells, 10 % area) | **Confirmed** in `flash-limiter.ts` | None |
| 11 | Stage is 1920×1080, 16:9, mask 480×270 | **Confirmed** (`STAGE_SIZE`, `LIVE_ASPECT`) | None |
| 12 | Echo cost is small | **Unmeasured.** Morphogen alone had 9 of 479 minutes over the 14 ms target, and the soak had no projector mapping or camera **[M]** | Governor is required, not optional; performance is the top risk |
| 13 | Excitable media annihilate rather than reflect | **Supported** by [arXiv 0902.3891](https://arxiv.org/pdf/0902.3891); diffraction stays unverified | None |

**What the audit could not check:** real frame cost on the show laptop; whether `MorphShade` can take a plain height texture; how Live's final pass is structured; whether the show parser tolerates a new optional field without a version bump; and the actual look. All are in step 0 or the first lines of step A.

## Tests

- Unit: mask rasterisation (visibility, holes, blockers, solo, scenes), distance accuracy against a circle and a slanted rectangle, version key stability.
- Solver: energy decays with damping; no NaN after extreme sliders; a plane wave at a wall reflects at the right angle within a tolerance; stripes near a straight wall are parallel to it.
- Integration: editing one shape rebuilds the mask once; an unchanged show uploads nothing; a Live screen with no mask behaves as the whole stage.
- Safety: a worst-case emitter setting stays under the limiter's thresholds.
- Visual: screenshots of fixed seeds at three box layouts, checked for stair-stepping and banding; a human review of the 30-second clips.

## Risks and open questions

1. **One Live look at a time.** Echo replaces Morphogen or any other Live look while it plays. Accepted; Echo is a separate look (decision above).
2. **Performance is unmeasured and the top risk.** There are no GPU timer queries **[M]**, Morphogen alone sits near the frame budget in its worst minutes **[M]**, and Echo plus the mask sampling is extra. The governor and step 0 are the answer; if Echo does not fit beside a mapped show, it ships at a lower tier.
3. **Obstacle versus visible art.** A box faded by a glide or a sound link still reflects (see the alignment note). If this looks wrong in a rehearsal, the fix is a per-frame mask, which costs more.
4. **Excitable-medium claims** (diffraction around corners) are unverified **[I]**.
5. **Art-brightness coupling** needs a small asynchronous readback between two contexts. Second release.
6. **Schedule.** The party test is around 6 December 2026 **[M]**, and Morphogen's go/no-go is on 2 December **[M]**. Before the party: the layout lock, the prototype and the pure mask code only. Nothing that touches Morphogen's solver or Live's wiring.
7. **Placement discipline.** If the operator sets zoom or turn on a field shape, alignment breaks. The warning mitigates it; the lock (step A) prevents it on the night.

## Sources

- Excitable media: [Wave-train induced unpinning of weakly anchored vortices](https://arxiv.org/pdf/0902.3891), [Critical role of pinning defects in scroll-wave breakup](https://arxiv.org/pdf/1109.6115)
- Wave equation: [Falstad ripple tank](https://falstad.com/ripple), [WebGL Ripples](https://github.com/m-ender/webgl-ripples), [UAF shallow-water notes](https://www.cs.uaf.edu/2013/spring/cs493/lecture/03_26_waves.html), [Perfectly matched layers](https://rreusser.github.io/notebooks/perfectly-matched-layers-for-the-wave-equation)
- Distance fields: [Rong & Tan, Jump Flooding](https://www.comp.nus.edu.sg/~tants/jfa/i3d06.pdf)
- Fluids: [Stam, Stable Fluids](https://pages.cs.wisc.edu/~chaol/data/cs777/stam-stable_fluids.pdf), [GPU Gems ch. 38](https://developer.nvidia.com/gpugems/GPUGems/gpugems_ch38.html)
- Reaction patterns: [Pearson, Complex Patterns in a Simple System](https://arxiv.org/abs/patt-sol/9304003)
- Particles: [Codrops GPGPU](https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/), [gpfault WebGL2 particles](https://gpfault.net/posts/webgl2-particles.txt.html), [Niagara GPU collisions](https://dev.epicgames.com/documentation/en-us/unreal-engine/gpu-raytracing-collisions-in-niagara-for-unreal-engine), [Godot particle collision](https://docs.godotengine.org/en/stable/tutorials/3d/particles/collision.html)
- Raymarching: [Quilez, smooth minimum](https://iquilezles.org/articles/smin), [Quilez, soft shadows](https://iquilezles.org/articles/rmshadows)
- Finish: [Wronski, dithering](https://bartwronski.com/2016/10/30/dithering-part-three-real-world-2d-quantization-dithering/), [Peters, blue noise](https://momentsingraphics.de/BlueNoise.html), [Wolfe, animated noise](https://blog.demofox.org/2017/10/31/animating-noise-for-integration-over-time/)
- Technology: [three.js forum, TSL and WebGL2 vs WebGPU](https://discourse.threejs.org/t/tsl-and-webgl2-vs-webgpu/87974), [Chrome 113 WebGPU](https://developer.chrome.com/blog/new-in-webgpu-113), [Electron 40 release](https://releases.electronjs.org/release/v40.0.0)
- Safety: [WCAG 2.2, three flashes or below threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)
- Precedent (weak): [Panorama NYC facade, TouchDesigner](https://www.derivative.ca/events/2016/PanoramaNYC/). Used generative work including fluid dynamics on a building; I found nothing on masking negative space.
- Thin-film and stripe background are in the [Morphogen design](2026-11-22-morphogen-design.md).
