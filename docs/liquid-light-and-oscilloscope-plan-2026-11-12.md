# Liquid Light Show and Oscilloscope Vector Graphics: implementation plan

12 November 2026 · main at `29f9aa6` (0.12.0)

Source: `Screen Recording 2026-11-12 at 19.41.51.mov` (21 s, 60 fps, 1518×1544). Stills pulled from it are in `docs/liquid-scope-reference/`. Judgements below come from one frame per second plus three 15 fps motion strips; the recording was not reviewed at full speed.

## 1. What is in the video

Two independent pictures are stacked. Both fill the frame, both are fully saturated on black, and neither moves in unison with the other.

### Timeline

| Time | Liquid | Scope line |
| --- | --- | --- |
| 0–2 s | Dense red and orange cells on black, largest at the edges. | Cyan scribble, loosely spherical, partly hidden behind cells. |
| 2–5 s | Wash turns deep blue. Cells shrink to small red dots. Flat yellow discs float on top. | Dense cyan ball of wiggly line, white-hot core, slight green fringe at the rim. |
| 5–9 s | Back to red cells on black. | Simplifies to two or three clean pink loops inside a circle (figure-eight, twin ovals). At 6 s it stands alone on black with an orange halo. |
| 9–13 s | Cells in the centre swell and turn yellow, as if under a magnifying dome. | Loops break into jagged wiggles, then re-form as a dense red ball with short white dashes (11 s). |
| 13–15 s | Blue and violet wash floods in from the edges. | Three clean loops again, tumbling. |
| 15–21 s | Continuous marbled sheets in magenta and violet with thin dark veins. Large yellow blobs with scalloped edges, fingers, and rows of satellite droplets. | Line turns jagged and breaks into bright dashes. |

### Liquid Light Show: what makes it look right

1. **Discrete cells with a huge size range.** Roughly 30:1 from the biggest to the smallest, packed with thin dark gaps and never overlapping. Crowded cells flatten against each other into beans and kidneys.
2. **Colour comes from thickness.** Each cell runs dark red at the rim, red, orange, then yellow at its thickest. It behaves like dye absorbing projector light, not like a painted gradient. There is no white anywhere.
3. **Hard rim, soft interior.** A crisp edge, a thin dark outline, then a smooth ramp. Some cells have a dimple, giving a dark centre inside a bright ring.
4. **Stacked dishes.** At least three depths: a blurred far layer, a sharp main layer, and sparse flat yellow floaters. Layers multiply like stacked gels.
5. **A changing wash.** The ground goes black, deep blue, violet, magenta. This is the second dye, and it changes the whole mood without touching the cells.
6. **A second regime: sheets.** Late in the clip the cells merge into continuous marbled sheets with thin veins and fingered edges.
7. **Motion.** Slow drift, plus an outward push from the centre that swells and brightens cells (the pressed clock-glass effect). Cells move at their own speeds.

### Oscilloscope Vector Graphics: what makes it look right

1. **One continuous closed line on a sphere.** It tumbles in 3D. The back half is dimmer and thinner than the front.
2. **It morphs between simple and complex.** Two or three clean loops at one extreme, a dense scribble ball at the other, and a jagged in-between where a high-frequency wiggle rides on the simple curve.
3. **Beam look.** White-hot core about 2 px wide at 1080p, a tight coloured halo, and a wide soft bloom. Colour saturates to white only in the core.
4. **Brightness follows beam speed.** Slow parts and crossings are brighter. Short white dashes travel along the line (11 s and 19–21 s).
5. **Colour drifts.** Cyan, then pink and red, with an orange halo at 6 s. A faint colour fringe shows at the edge of the ball.
6. **Persistence.** A short afterglow trails the tumbling line.

### How the two combine

The line is added on top of the far liquid layer but sits behind the near cells, which hide and bend it. Cells inside the ball's outline are brighter and yellower than those outside, so the ball reads as a light source inside the liquid.

## 2. Decisions (my calls; say if you disagree)

- **Two new layer kinds: `liquid` and `scope`.** The current plan says no new families until every survivor passes. This plan breaks that rule on purpose because you asked for these two. To keep the library from growing, `liquid` delivers the "full-frame pour with many cells" promised for Oil Slides (stage 4, item 11), and `scope` takes the place of Velvet Currents, which is on probation for sparse line work.
- **Both are stateless.** Every frame is a pure function of the loop phase, like Surface and slit-scan. Loops are exact with no warm-up and no return trick. A real fluid simulation would merge cells more naturally, but it cannot loop exactly and Living Ink shows what that costs.
- **Flat saturated colour on black.** Both must pass the six preset rules in `effects-improvement-plan-2026-11-12.md` at defaults.
- **Built separately, verified together.** Each must look finished alone. The combined look is a three-layer starter, not a coupled renderer.

## 3. Liquid Light Show

### Approach

One fragment shader (`src/rendering/liquid.ts`) that evaluates a stack of analytic cell layers and composites them as absorbing dye.

**Cell field.** Each layer is a jittered grid. Every grid square owns one droplet with a hashed centre and a radius drawn from a power-law. Three octaves of grid (about 0.22, 0.09 and 0.035 of frame height) give the 30:1 range. A fragment checks the 3×3 neighbourhood in each octave.

- *Packing:* a small droplet's radius is capped by its distance to the nearest larger droplet's edge, minus a gap. Small cells then fill the spaces between big ones and never overlap.
- *Crowding:* a droplet's edge is pulled in where a neighbour of the same octave is close (distance to nearest against second nearest). That produces the bean and kidney shapes.
- *Merging:* a `merge` control swaps the hard union for a smooth union. Low values give separate cells; high values give the scalloped, fingered blobs of the last five seconds, with unmerged small octaves left as satellite droplets.

**Thickness and colour.** Each droplet returns a thickness, not a colour: a rounded cap, optionally with a centre dimple. Colour is `palette ramp(thickness)` applied as absorption, so thin is dark red and thick is yellow. Layers multiply. A thin dark outline and a narrow bright meniscus sit just inside the rim. Edge width is derived from pixel size so rims stay crisp at any resolution.

**Wash and sheets.** The ground is a second dye: a domain-warped looping field cut into two or three flat bands with thin dark veins on the band boundaries. `wash` fades it from black to full marbling; its palette entries are separate from the cell ramp, so blue-with-red-cells and magenta-with-yellow-blobs are both palette choices.

**Depth.** Three cell layers by default: far (larger edge softness, dimmer, slower), main (sharp), floaters (sparse, flat single colour, no ramp). The main layer refracts what is under it: the underlay is sampled with an offset along the thickness gradient, reusing the idea in the Oil lens pass.

**Press.** A circular dome with position and radius. Inside it the cell field is magnified and thickness is boosted, which swells the cells and pushes them to yellow. Its strength pulses over the loop.

**Motion** (`src/rendering/liquid-motion.ts`, pure and unit-tested). Droplet centres ride small closed orbits with a hashed phase and an integer cycle count per droplet (1, 2 or 3), so nothing moves in unison. A slow whole-layer drift is a closed path. The domain warp uses noise sampled on a circle in time. Radii breathe with their own phase. All of it closes exactly at 2π.

**Projector finish.** Reuse `projection-optics.ts` for vignette and soft focus. Add a slight colour fringe at cell rims and a gentle focus breathing.

**Update, 14 November: stage 1 is built, with one change.** The cell field is not a per-pixel jittered grid. Droplets are packed once on the CPU into a repeating tile (`src/rendering/liquid-pack.ts`) and the shader reads the droplets near each pixel from a lookup texture. This gives true non-overlapping packing at any size range and costs about 16 texture reads per pixel instead of 250 droplet tests. Per-droplet orbits were dropped, because droplets that move on their own would collide; the flow warp, breathing and swell provide the independent motion. Crowding and merging in stages 2 and 3 will work on the same lookup.

**Update, 14 November: stage 2 is built.** Crowding grows each droplet into its neighbours and the smaller one is cut back around the larger, giving beans and stacked-coin shapes. Rings (dimple), rim light, the far layer, floaters and refraction are in, with the Blue Hour and Ring Dish presets. The far layer and floaters reuse the same baked layout at a different position and size.

**Update, 14 November: stage 3 is built.** The wash, merge and press are in, with the Clock Glass, Magenta Marble and Molten Bloom presets. Merge joins droplets in patches chosen by a slow noise, so blobs form islands among separate cells. Because a pixel only sees droplets within a short reach, merging needs high Density to bridge the gaps; a longer reach would mean rebuilding the lookup with larger bins.

**Update, 14 November: stage 4 is built; Liquid Light is complete as planned.** Soft focus, colour fringe, vignette and grain are in the shader (the shared optics module had no vignette or focus to reuse). Palette swatches are labelled, dragging moves the press, and the export manager accepts liquid layers. The fringe is a tint on droplet rims, not a true per-channel offset, which would triple the cost.

### Controls

| Section | Parameters |
| --- | --- |
| Shape | cell size, size range, density, crowding, merge, dimple, floaters, wash, vein width |
| Motion | cycles, drift, orbit, breathing, press strength, press radius, press pulse, warp |
| Material | thickness, rim, outline, refraction, far blur, fringe, grain |

Palette slots: rim, body, mid, hot, wash A, wash B.

### Presets (six, structurally different)

| Preset | Recipe | Reference |
| --- | --- | --- |
| Ember Cells | Red to yellow cells on black, full size range. | 0–2 s |
| Blue Hour | Small red cells on deep blue, yellow floaters. | 2–5 s |
| Clock Glass | Strong press, centre swollen to yellow. | 9–13 s |
| Magenta Marble | Wash at full, few cells, thin veins. | 15–16 s |
| Molten Bloom | High merge, large scalloped yellow blobs with satellites. | 17–18 s |
| Ring Dish | High dimple, bright rings with dark centres, sparse. | 6 s, 9 s |

### Stages

1. **Cells.** One layer, hard rims, thickness ramp, packing across three octaves, looping motion. Done when a still matches 0–2 s for size range, gaps and colour ramp, and three phase stills differ clearly.
2. **Shape and depth.** Crowding, dimple, outline and meniscus, far layer, floaters, refraction. Done when Ember Cells, Blue Hour and Ring Dish read as different pictures.
3. **Wash, merge, press.** Marbled wash with veins, smooth union, press dome. Done when Magenta Marble, Molten Bloom and Clock Glass match their reference stills.
4. **Finish and wiring.** Projector optics, presets, thumbnail, controls, tests, verification script.

### Risks

- *Grid shows through.* Jittered grids can look regular. Fix with full-cell jitter, a per-octave rotation, and the domain warp; check at thumbnail size.
- *Popping at grid borders.* A droplet larger than its square is cut off unless its radius is capped below the search range. Cap it, and test with the largest size range.
- *Cost.* Three layers × three octaves × nine squares is 81 droplet tests, doubled by refraction. Budget is 60 fps at 1080p on Apple Silicon. If it misses, drop the far layer to two octaves and reuse the main layer's result for refraction.
- *Merging looks like metaballs.* Smooth union alone gives rubbery blobs. The scalloped edge in the reference needs the small octaves to stay unmerged along the big blob's rim.

## 4. Oscilloscope Vector Graphics

### Approach

A geometry renderer (`src/rendering/ScopeRenderer.ts`), built like `CurrentRenderer`: a polyline drawn as quads with additive blending into the half-float source target. The curve maths lives in `src/rendering/scope-curve.ts`, pure and unit-tested.

**Curve.** A closed parametric curve on the unit sphere, `s` from 0 to 1:

- *Base:* a normalised 3D Lissajous, `normalize(sin(a·s+φ₁), sin(b·s+φ₂), sin(c·s+φ₃))`, with small integer `a, b, c`. Ratios like 1:2:1 and 2:3:1 give the figure-eight and twin-oval frames. A separate `ring` control adds the plain great circle seen around the loops.
- *Wiggle:* a carrier at a high integer frequency displaces the point along the sphere's tangent. Amplitude takes the curve from clean loops through jagged to scribble ball. An envelope along `s` and over the loop makes the wiggle arrive in bursts, as at 9–10 s.
- *Morph:* two base curves are blended and renormalised, with the blend following a hold–move–hold shape over the loop so the picture rests on clean figures and then moves.
- *Tumble:* rotation about two axes with integer turns per loop, then perspective projection.

Integer frequencies and integer turns keep the curve closed and the loop exact.

**Beam.** Each segment is a quad wide enough for the tight halo, shaded with the analytic Gaussian beam integral used by software oscilloscopes, so joints are seamless and brightness is naturally inversely proportional to segment length (slow is bright). 8,192 segments by default, 16,384 at high quality.

- *Depth:* back-facing segments are dimmer and narrower.
- *Dashes:* a travelling intensity pattern along `s` (count, length, speed in integer cycles) gives the white dashes.
- *Afterglow:* the curve is drawn several times at slightly earlier phases with falling intensity. This is stateless, so it loops. Longer trails come from the existing Echo finish.

**Glow.** Three scales: the core and tight halo come from the beam shader; the wide bloom comes from a blur chain (downsample, blur, add back) on the scope target, sized as a fraction of frame height so preview and export match. Colour is `tint × intensity` through a per-channel roll-off, which is what turns the core white while the halo stays saturated. The project `highlights: 'exact'` setting must not clip this; scope applies its own roll-off before compositing.

**Colour.** Core tint, halo tint and bloom tint are separate palette slots (the 6 s frame has a pink core with an orange halo). Hue can drift over the loop and along `s`. A small radial red/blue offset gives the fringe at the ball's edge.

**Update, 14 November: stage 1 is built, with one change.** The figures are not normalised 3D Lissajous curves, which jump where all three terms pass through zero. Each figure winds round the sphere a whole number of times while swinging between the poles a whole number of times (`src/rendering/scope-curve.ts`), which is always smooth, closed and on the sphere. The 1:2 figure is the seam of a ball and gives the twin ovals. The ring is the sphere's outline, a circle facing the viewer.

**Update, 14 November: stage 2 is built.** The beam pass now stores light (core, halo, colour mix) instead of colour. A five-level blur chain at fixed line heights gives the bloom, and the resolve pass tints core, halo and bloom separately, rolls the sum off to white and reads red and blue apart for the fringe. Ember Ring and Cyan Tangle are added. The reference's yellow outer edge around the orange halo at 6 s is not reproduced: the model has one halo colour and one bloom colour.

### Controls

| Section | Parameters |
| --- | --- |
| Shape | figure A, figure B (curated ratio sets), ring, wiggle amount, wiggle frequency, wiggle bursts, radius |
| Motion | cycles, tumble X, tumble Y, morph, hold, dash count, dash length, dash speed |
| Material | beam width, intensity, halo, bloom, afterglow, depth fade, hue drift, fringe |

Figures are chosen from a curated list of good-looking ratio sets, not raw `a, b, c` sliders. Most raw combinations are ugly.

### Presets (six)

| Preset | Recipe | Reference |
| --- | --- | --- |
| Twin Orbit | Two ovals inside a ring, slow tumble, pink. | 7–8 s |
| Atom | Three clean loops, faster tumble. | 14–16 s |
| Cyan Tangle | Dense scribble ball, cyan, white core. | 2–5 s |
| Signal Burst | Clean loops that break into wiggle and re-form. | 9–10 s |
| Morse Sphere | Red ball with travelling white dashes. | 11 s |
| Ember Ring | Simple loop, pink core, wide orange halo on black. | 6 s |

### Stages

1. **Curve and beam.** Curve maths with tests (closed, on the sphere, loop-exact), quad renderer, Gaussian beam, tumble, depth fade. Done when Twin Orbit and Atom match their stills as plain lines.
2. **Glow and colour.** Roll-off to white, bloom chain, separate tints, fringe. Done when a still at 6 s and one at 3 s are matched for core, halo and bloom.
3. **Life.** Wiggle with bursts, morph with holds, dashes, afterglow. Done when Signal Burst and Morse Sphere match, and three phase stills of every preset differ.
4. **Wiring.** Presets, thumbnail, controls, tests, verification script.

### Risks

- *Aliasing on a 2 px core.* Thin bright lines shimmer. The Gaussian profile handles most of it; verify at 1080p without supersampling, since live preview has none.
- *Overdraw.* 16k wide quads in a scribble ball stack hundreds deep in the centre. Keep quads to the tight halo only and leave the wide glow to the blur chain.
- *Bloom differs between preview and export.* Blur radii must be in frame-height units, and the seam and quality scripts should compare a preview-size and an export-size render.
- *Wiggle breaks closure.* Carrier frequency and burst envelope must be integers in `s`; covered by a unit test on the first and last sample.

## 5. Shared wiring (both kinds)

| File | Change |
| --- | --- |
| `src/shared/types.ts` | Add `'liquid'` and `'scope'` to `LayerKind`. |
| `src/core/project.ts` | Parameter definitions, default palettes and names, presets, and the kind list in the validator (line 642). |
| `src/rendering/StudioRenderer.ts` | Materials and a branch in `drawSource`; release scope targets when no scope layer is visible, as Oil does. |
| `src/rendering/feedback.ts` | No change; both kinds support Echo. |
| `src/ui/App.tsx` | Add-layer tiles, captions, thumbnails, control grouping. |
| `src/core/canvas-interaction.ts` | Drag behaviour: press position for liquid, sphere position and radius for scope. |
| `tests/` | `liquid.test.ts`, `scope.test.ts`; add both kinds to the loops in `quality.test.ts`, `canvas-interaction.test.ts`, `instruments.test.ts`. |
| `scripts/` | `verify-liquid.mjs`, `verify-scope.mjs` modelled on `verify-oil.mjs`; add both to `verify-workspace-ui.mjs` and `verify-quality.mjs`. |
| `README.md` | Family list and preset counts. |

## 6. The combined look

A starter project, "Liquid Scope", with three layers:

1. Liquid, far and wash only (main cells off), normal blend.
2. Scope, add blend.
3. Liquid, main cells and floaters only (wash off, transparent ground), normal blend, with its press dome centred on the scope sphere at the same radius.

That reproduces the line sitting between the dishes and the brighter cells inside the ball. Layer 3 hides the line but does not bend it. If that reads as flat, the follow-up is to let a liquid layer refract the layers beneath it, which is a compositor change and is not in this plan.

## 7. Order and verification

Liquid stages 1–2, then Scope stages 1–2, then the remaining stages of each, then the combined starter. Scope is the smaller job; Liquid carries more look risk, so it goes first.

After each stage:

- Contact sheet of every preset at three phases with the harness in `work/effect-audit-2026-11-11/`, checked against the six rules and laid beside the reference stills.
- Seam check on a 10 s export of each preset; both kinds should measure as clean with no warm-up.
- Frame time at 1080p in the live preview.
- Full-speed review in the app. Stills cannot judge motion, and the source recording itself has only been judged from stills.

## 8. Not in this plan

- Audio input. A real oscilloscope draws sound; here the "signal" is synthetic. An audio-driven mode is a natural follow-up for the wiggle and dashes.
- Real fluid simulation for the liquid.
- Cross-layer refraction (see section 6).
- Landing the cull and the other stages of `effects-improvement-plan-2026-11-12.md`. Stage 0 touches the same files as section 5, so do it first or expect conflicts.
