# Video effects study and implementation plan

Recording: **Screen Recording 2026-11-07 at 11.30.48.mov**. Analysis date: 7 November 2026.

**Build five reusable generators, exposing 21 distinct looks and modifiers.** Start with pillar waves and layered circles, then tile packing, spiral glyphs, and grid paths. Most apparent depth comes from overlapping flat shapes. The recording does not call for a new fractal ray marcher, fluid solver, or temporal feedback pipeline.

![The 21 effects in recommended build order](</Users/grego/Documents/ChatGPT/three VJ/docs/video-effects-reference/effect-index.jpg>)

## Evidence and scope

The requested `/mnt/data/…` path was unavailable locally. I found the identically named recording at `/Users/grego/Documents/Screenshot/Screen Recording 2026-11-07 at 11.30.48.mov`. It is 1738 × 1480, 116.928 seconds, with variable frame timing and no audio stream. The container advertises 3,601 frames; decoding and per-frame timestamp enumeration both produced **3,600 frames**. The analysis uses those decoded timestamps, not an assumed 30 or 60 FPS.

I reviewed every decoded frame in sequential contact sheets, calculated adjacent-frame image differences, and inspected 34 selected frames at larger size. Small thumbnails were used for exhaustive temporal coverage; native-resolution detail crops were used to distinguish strokes, contours, overlaps, and shape types. All times below refer to the **screen recording**, not the embedded Reddit player's timeline. Preset boundaries that interpolate are approximate.

The page visible in the video credits Maksim Vasilyev's [p5 experiments gallery](https://vasilyev-maksim.github.io/p5-experiments/). Its [public repository](https://github.com/vasilyev-maksim/p5-experiments) contains factories and trailer sequences strongly matching the recording. I inspected a read-only source snapshot at commit `e113523b48fb5342199d31e49843f042e741cb30`. This corroborates the five families and technical explanations; it does not establish that the recording used that exact commit.

Three distinctions matter:

- **Observed:** shapes, motion, colours, transitions, and timing visible in the recording.
- **Source corroborated:** matching generator logic in the public reference implementation.
- **Proposed:** parameter ranges, Three.js architecture, development stages, and optional variants below. These are useful starting ranges, not recovered original slider settings or measured performance guarantees.

The source's five matching factories are [pillars](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/pillars/factory.ts), [circles](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/circles/factory.ts), [tiles](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/tiles/factory.ts), [spiral](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/spiral/factory.ts), and [worms](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/worms/factory.ts).

## Recording map

This table keeps chronological identification separate from the build order. Colours alone are variants, not separate effects. IDs refer to the detailed entries below.

| Recording time | Visible scene / source preset match | Effect IDs |
| --- | --- | --- |
| 0.000–1.717 | Partial tile sequence, rounded-shape band, then player scrubbing and hover previews | 5, 7, 8 |
| 1.717–4.9 | Purple opposing pillars, moderately uneven widths; “looks uneven” | 1 |
| ~4.9–7.9 | Broad purple rounded pillars; “lava lamp” | 1 |
| ~7.9–10.9 | Many thin, uneven pillars; “rush hour” | 1 |
| ~10.9–13.9 | Warm opposing bar curtains with a black wavy slit; “dragon” | 1 |
| ~13.9–16.9 | Finer warm bar curtains; “scoliosis” | 1 |
| ~16.9–19.900 | Green sinusoidal pillar field; “wave” | 1 |
| 19.900–~23.0 | Small blue/cyan nested tiles, horizontal rounding band; “tiles” | 5, 7, 8 |
| ~23.0–25.9 | Red rounded concentric cells; “forest fire” | 7, 8 |
| ~25.9–28.967 | Large hollow cyan/purple frames; “frames” | 6, 8 |
| 28.967–31.967 | Pastel nested rounded boxes and capsules; “wes” | 7, 8 |
| 31.967–35.067 | Solid-looking blue/cyan brick mosaic with diagonal rounding sweep; “bricks” | 5, 8 |
| 35.067–38.1 | Fine red/cream rectangular contours with diagonal sweep; “mosaic” | 7, 8 |
| ~38.1–41.067 | Radial expansion through a packed tile field; “epicenter” | 8 |
| 41.067–44.1 | Short red circuit paths grow, then retract; “worms” | 18 |
| ~44.1–47.1 | Long blue/pink parallel circuit channels; “guts” | 19 |
| ~47.1–50.1 | Coarser mirrored red maze; “symmetry” | 20 |
| ~50.1–53.1 | Fine blue/pink symmetric maze carpet; “carpet” | 20 |
| ~53.1–56.067 | Red circuitry around a dark ring, central path cluster; “core” | 21 |
| 56.067–~59.1 | Green concentric luminous disc stack; “signal” | 2 |
| ~59.1–65.1 | Yellow/green circle bloom; “nature” | 3 |
| ~65.1–68.1 | Orange two-sided orbital fan; “cats” | 4 |
| ~68.1–71.1 | Monochrome propeller; “drill” | 4 |
| ~71.1–79.850 | Larger circles coil between bloom and fan states; “turbulence” | 3, 4 |
| 79.850–~82.75 | Green angular nested tunnel; “toxic” | 10 |
| ~82.75–85.75 | Purple/pink woven polygon vortex; “purple lambo” | 11 |
| ~85.75–88.733 | White/pink scalloped web rosette; “spiderverse” | 12 |
| 88.733–91.733 | Green horizontal line interference; “radiation” | 13 |
| ~91.733–94.63 | Broad magenta coiling ribbon; “spiral” | 14 |
| ~94.63–97.63 | Small purple dots forming apparent spiral arms; “black hole” | 9 |
| ~97.63–100.63 | White triangular spiral; “glimmer” | 9 |
| ~100.63–103.63 | Purple polygon beads coil, become spokes, and bunch up; “subatomic” | 15 |
| ~103.63–106.63 | Red/yellow hexagon rays and coils; “carousel” | 15 |
| ~106.63–109.63 | Dense overlapping magenta/purple discs; “mandala” | 16 |
| ~109.63–112.650 | Black/white scalloped polygon whirlpool; “whirlpool” | 17 |
| 112.650–116.928 | Monochrome filled/outlined hexagon spiral; “space odyssey” | 9 |

The source trailer order matches these sequences. The opening already contains part of a tile scene, and hover previews briefly obscure it; those previews are not additional full-screen generators. No 3D city, cube scene, genuine fractal zoom, fluid simulation, or audio-reactive behaviour is established by this recording.

## Direct source map

The repository and gallery links supplied in the follow-up are the same sources identified in the recording. I rechecked the repository: its current main commit still matches the snapshot above. Use these files together: the renderer establishes the actual geometry, controls define the interface ranges, presets identify authored looks, and trailer sequences explain the order seen in the recording.

| Source family | Effect IDs | Implementation references |
| --- | --- | --- |
| pillars | 1 | [renderer](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/pillars/factory.ts) · [controls](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/pillars/controls.ts) · [presets](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/pillars/presets.ts) · [trailer sequence](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/pillars/scenarios.ts) |
| circles | 2–4 | [renderer](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/circles/factory.ts) · [controls](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/circles/controls.ts) · [presets](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/circles/presets.ts) · [trailer sequence](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/circles/scenarios.ts) |
| tiles | 5–8 | [renderer](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/tiles/factory.ts) · [controls](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/tiles/controls.ts) · [presets](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/tiles/presets.ts) · [trailer sequence](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/tiles/scenarios.ts) |
| spiral | 9–17 | [renderer](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/spiral/factory.ts) · [controls](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/spiral/controls.ts) · [presets](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/spiral/presets.ts) · [trailer sequence](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/spiral/scenarios.ts) |
| worms | 18–21 | [renderer](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/worms/factory.ts) · [controls](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/worms/controls.ts) · [presets](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/worms/presets.ts) · [trailer sequence](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/src/sketches/worms/scenarios.ts) |

Important translation details for a faithful port:

- **Source control units differ from this plan's proposed controls.** Pillar amplitude 0–10 maps to 0–half the canvas height; period 0.5–4 controls spatial phase. Circle gap 1–100 maps to an internal multiplier 0.1–3, while its coil factor 0–400 maps directly to an angular multiplier. Port the formulas and then choose intentional user-facing units.
- **Controls and presets can disagree.** For example, the pillar control declares resolution 1–20, but several authored presets use 25 or 30. Do not clamp imported preset values against those declared UI limits without checking the actual renderer and intended appearance.
- **Spiral thickness is inverted internally.** The source converts its 2–20 slider to a size divisor using `maximum + minimum − value`. A larger visible thickness value therefore makes larger glyphs. This plan instead names the actual glyph-size/radius ratio to avoid that ambiguity.
- **Spiral profile 11 means circle; 2 means line.** They are special cases, not ordinary 11-sided or 2-sided filled polygons. Preserve those visual modes but use explicit shape choices in the new app.
- **Timing is not directly portable.** The source factories consume a shared time value; presets also specify `timeDelta` and sometimes `startTime`. Those settings control the reference's playback and initial arrangement. Convert the underlying motion into the existing app's periodic phase rather than copying speed numbers and assuming a seamless loop.
- **Tile animation uses sorted rank, not just distance.** Matching the original wave pacing requires the cached tile ordering and per-tile delay. A direct distance field is a useful alternative, but can move differently through unevenly sized tiles.
- **Worm paths are cached structural data.** Animate the visible length of seeded paths; rebuild only when grid, seed, path policy or structural length changes. Hollow regions should become actual coverage holes when transparent compositing is selected.

## Parameter conventions

Distances below are fractions of canvas height unless marked otherwise. Pixel widths mean **reference pixels at 1080 pixels high**, scaled by output height / 1080 for export. This keeps preview and 4K framing consistent. Angles shown to the user are degrees; shader math can use radians. Counts and shape choices are discrete. Defaults are deliberately conservative.

Common controls: six-colour palette, palette offset 0–1, opacity 0–1, centre X/Y 0–1, orientation −180° to 180°, and intrinsic cycles 1–8 per project loop. Provide an intrinsic motion depth of 0 to stop movement. Keep visible shape selection separate from motion routing.

## Effects in recommended implementation order

### 1. Opposing rounded pillar waves

**Seen:** 1.717–19.900 seconds; references 01–05 in the detail sheets.

**Appearance:** Bars extend inward from opposite canvas edges. Their rounded ends trace a travelling sine wave. Wide bars resemble lava-lamp columns; thin bars resemble an equaliser. The warm variation leaves a continuous black wavy slit.

**Technical basis:** Source-correlated: partition the width into columns; draw two rounded-ended bars per column. Move the split with a sine whose phase varies by column. This is geometric motion, not liquid simulation. A starting model is `split(i) = centre + amplitude × sin(spatialPhase(i) + cycles × phase)`; place upper/lower tips on either side of a gap. Match the reference's index-based phase first; offer X-based phase as a variant.

**Controls:** Column count 8–256 (default 64); width dispersion 0–0.9 (0.15); horizontal gutter 0–8 reference px; split amplitude 0–0.45; central gap 0–0.3; 0.25–6 spatial waves across the field; cap roundness 0–1. Useful presets: broad uneven purple, fine bars, warm slit, green wave. A spatial wave count can be fractional; temporal cycles must close over the loop.

**Stages:** A. Render static equal columns with correct rounded tips. B. Animate the split from the existing periodic phase, then add seeded unequal widths. C. Add the six visible preset variants, palette-by-bar-length colouring, gutter controls, save/load and export verification. Clamp short bars so caps cannot invert or spill across the opposite tip. **Reuses:** rounded rectangles/capsules, seeded layouts, phase, palette. **Effort:** small.

### 2. Breathing concentric halo

**Seen:** 56.067–~59.1 seconds; reference 18.

**Appearance:** A green centre fades through stepped blue/green circular bands into a dark blue field. The stack shifts subtly, creating a luminous orb impression.

**Technical basis:** Source-correlated: many filled circles of increasing size and varying colour, drawn in an explicit large-to-small order. Their centres orbit with very small offsets. The glow impression comes principally from layered colour bands; bloom is optional polish.

**Controls:** Circle count 12–96 (48); outer radius 0.2–0.8; centre offset 0–0.05; colour falloff exponent 0.3–3; breathing depth 0–0.15; 1–4 breathing cycles. Variants: hard stepped bands, smooth dense halo, off-centre pulse. Optional edge feather 0–4 reference px.

**Stages:** A. Draw a static concentric circle stack with a centre-to-edge palette ramp. B. Add small deterministic orbital offsets and periodic radius motion. C. Add colour falloff and sampling controls; verify opaque and transparent backgrounds separately. Match the unblurred reference before adding bloom. **Reuses:** circle glyph, painter order, palette ramp. **Effort:** small.

### 3. Orbital circle bloom

**Seen:** ~59.1–65.1 and ~71.1–79.850 seconds; references 19 and 22.

**Appearance:** Overlapping yellow/green circular lobes expand into a flower or butterfly, then gather around the centre. Flat circles create a surprisingly soft, layered form.

**Technical basis:** Same circle engine as effect 2. Increase radius-dependent centre offsets and vary angle with circle index. Alternating circle groups orbit around opposite pivots. The reference's apparent translucency largely comes from opaque circles with neighbouring colours, rather than requiring physical transparent material.

**Controls:** Circle count 16–96 (49); orbit spread 0–0.8 (0.25); size ramp exponent 0.5–2; index angle step 0–360°; coiling depth 0–180°; coiling cycles 1–4; rotation turns −4 to 4 per loop. Suggested variants: butterfly, nested petals, broad asymmetric bloom. Additional explicit radial copies are an optional extension, not necessary to match the source.

**Stages:** A. Extend effect 2 with offset pivots and index-dependent angles. B. Alternate orbit direction and animate coiling periodically. C. Tune colour and draw order against the yellow reference; expose bloom/fan presets. Avoid changing the sort order as circles cross. **Reuses:** effect 2 entirely. **Effort:** small incremental.

### 4. Counter-rotating circle fans

**Seen:** ~65.1–71.1, with further transitions before 79.850 seconds; references 20–21.

**Appearance:** Two or more sweeping fans resemble a turbine, drill, or propeller. Orange and monochrome versions show the same underlying construction.

**Technical basis:** Same circle stack, with stronger index angle progression and opposite signed rotation for alternating indices. Large discs occlude the stack into swept blades. There is no need to build 3D fan geometry or preserve previous frames.

**Controls:** Use effect 3 controls; start with 32–64 circles, orbit spread 0.2–0.7, alternating rotation enabled, index angle step 120–360°, and rotation 1–4 turns per loop. Offer 2–6 apparent lobes through curated angle/spread presets. Exact lobe count is emergent, so do not promise that one scalar directly equals blade count.

**Stages:** A. Save a fan configuration of effect 3. B. Add opposite signed rotations and loop-safe winding. C. Add orange, monochrome, and coiling transition presets; verify that entering a preset at an arbitrary phase is reproducible. **Reuses:** effects 2–3. **Effort:** small incremental.

### 5. Seeded packed mosaic

**Seen:** The packed layout under all tile scenes; especially 31.967–35.067 seconds for solid-looking bricks; reference 10.

**Appearance:** The screen is filled by irregular rectangles of different sizes, separated by thin gutters. A blue/cyan gradient runs through the structure.

**Technical basis:** Source-correlated: seeded rectangle placement on an occupancy grid. Choose an empty starting cell, fit a legal rectangle into free space, mark its cells occupied, repeat. The original favours larger legal areas while limiting aspect ratio. Some solid-looking reference cells arise from thick borders or widely spaced nested fills. Implement an explicit solid mode for predictable controls.

**Controls:** Grid height 12–96 (40), width derived from aspect; maximum tile area 0.2–12% of grid; maximum aspect ratio 1–4 (2); gutter 0.5–8 reference px; seed integer; corner radius 0–0.5 of the smaller tile side. Palette coordinate: X, Y, radial, tile ID. Start with 500–3,000 tiles as a proposed working budget, then profile.

**Stages:** A. Build and verify a deterministic occupancy layout on the CPU; render solid instances. B. Add area/aspect controls and per-tile palette coordinates. C. Cache layout by structural settings, add geometry bounds and generation budgets, and verify landscape/portrait exports. Never regenerate the packing each frame. **Reuses:** occupancy data later helps paths; rounded rectangle instances help effects 6–8. **Effort:** medium; high foundational value.

### 6. Hollow neon tile frames

**Seen:** ~25.9–28.967 seconds; reference 08.

**Appearance:** Large empty rectangles and rounded frames pack together like a graphic circuit board. Their outlines grade from purple to cyan.

**Technical basis:** Use effect 5's layout. Render the difference between outer and inner rounded rectangles. An analytic signed-distance shape is preferable to placing a black smaller rectangle over a filled one, because the hollow region can then preserve transparency.

**Controls:** Border 0.5–10 reference px (3); roundness 0–0.5; grid height 8–40; tile area up to 15%; gutter 1–8 reference px. Variants: square frames, capsule frames, thick borders, alternating corner radii. Optional glow 0–0.3; the reference can be matched without it.

**Stages:** A. Add outline coverage to the existing tile material. B. Animate radius while keeping border thickness perceptually stable. C. Add large-frame presets and check tiny tiles, transparency, and border disappearance at small sizes. Clamp inner extents instead of creating inverted holes. **Reuses:** effect 5 and the shared shape material. **Effort:** small incremental.

### 7. Nested tile contours

**Seen:** Opening, 19.900–25.9, 28.967–31.967, and 35.067–38.1 seconds; references 06, 07, 09, 11.

**Appearance:** Every packed tile contains nested rectangular rings. When corners round, the pattern becomes concentric pills, capsules, or circles. Pastel and red variants reveal the same structure at different densities.

**Technical basis:** Source-correlated: inset rounded rectangles alternate foreground/background fills. For Three.js, compute repeated inset contour bands inside each tile's local coordinates. A single rounded-rectangle distance field gives an efficient contour approximation; tune radius falloff per inset to approach the reference's changing corner shapes.

**Controls:** Contour spacing 2–20 reference px (6); band duty 0.2–0.8 (0.5); 1–20 visible rings per tile, bounded by tile size; base roundness 0–0.5; contour offset 0–1; gutter 1–6 reference px. Variants: square labyrinth cells, pastel capsules, red rounded cells, fine mosaic contours.

**Stages:** A. Add nested bands to one tile, with pixel-aware edge coverage. B. Apply the material to the packing and add per-inset radius control. C. Add colour arrangements and the observed presets; ensure subpixel rings converge to average coverage rather than shimmering. **Reuses:** effects 5–6, repeated-band math already used in existing surfaces. **Effort:** medium incremental.

### 8. Travelling tile morph — linear sweep and radial ripple

**Seen:** Throughout the tile sequence; diagonal band at ~32–35 seconds, expanding ring at ~38.1–41.067; references 10–12.

**Appearance:** A moving region changes rectangles into smaller, rounder cells, leaving a black channel or band. The radial variant sends the transformation outward like a ripple through the mosaic.

**Technical basis:** Source-correlated: sort tiles by projected position or distance from a centre, offset each tile's animation in that order, and pulse its size, corner radius, and contour spacing. **The tiles mostly stay in place.** This is a travelling parameter field, not a fluid displacement or a global image distortion. The source uses distance rank; a physical-distance phase field is a useful additional variant.

**Controls:** Direction −180° to 180°; origin X/Y 0–1; pulse width 0.03–0.5 of a cycle; roundness depth 0–1; size shrink 0–0.4; sweep cycles 1–8; idle fraction 0–0.8; rank-versus-distance mode. Useful modes: horizontal sweep, diagonal sweep, outward ripple, inward ripple, static field.

**Stages:** A. Cache a normalized order or distance attribute for each tile. B. Evaluate a smooth periodic pulse at `cycles × phase − spatialOffset`, driving radius and scale together. C. Add radial origin and duty controls; verify the wave crosses the loop boundary smoothly. Use a cosine pulse or matched endpoint slopes, not a sawtooth reset. **Reuses:** effects 5–7; the phase-field primitive also helps bars, beads and path reveals. **Effort:** medium; very high reusable value.

### 9. Beaded and polygon-glyph spirals

**Seen:** ~94.63–100.63 and 112.650–116.928 seconds; references 28, 29, 34.

**Appearance:** Purple dots, white triangles, and later filled/outlined hexagons curl inward. The outer glyphs are larger, making the centre appear distant. Apparent multiple arms emerge from angular stepping.

**Technical basis:** Source-correlated: about 500 glyphs are placed using increasing radial distance and an index-dependent angle. A useful equivalent model is `r(i)=spacing×i`, `angle(i)=angularStep×i+rotation`, `position=centre+r×(cos(angle),sin(angle))`, with glyph size proportional to radius. Many apparent arms can emerge from one sampled sequence; they need not be separate emitters.

**Controls:** Count 64–1,000 (500); radial spacing 0.001–0.015; angular step −180° to 180°; glyph size/radius ratio 0.015–0.3; shape circle, triangle, square, pentagon, hexagon, 7–10-gon; border 0–3 reference px; palette frequency 0–8 cycles over index; rotation turns −4 to 4 per loop. Offer fixed world orientation first, then optional tangent alignment.

**Stages:** A. Render one instanced circle batch from polar coordinates. B. Add shape selection, index colour, proportional sizing and outlines. C. Add the dot, triangle and monochrome hexagon presets. Use an explicit circle mode instead of making one valid polygon-side count secretly mean circle. Filter tiny central glyphs. **Reuses:** the glyph renderer unlocks effects 10–17. **Effort:** medium; very high value.

### 10. Polygon contour tunnel

**Seen:** 79.850–~82.75 seconds; reference 23.

**Appearance:** Green angular contour bands form a central tunnel or target, with dark gaps and fine coloured edges.

**Technical basis:** The matching source uses **large polygons placed along the same spiral sequence**, with overlap and index colouring producing the nested tunnel. A stack of centred polygon rings would approximate one still, but would miss how the pattern changes. There is no evidence of ray-marched 3D depth.

**Controls:** Reuse effect 9; start with 7-sided glyphs, 200–600 instances, size/radius ratio 0.5–1.8, rotation 0–2 turns per loop, contour border 0.5–2 reference px, index palette frequency 2–6. Tune angular step near a repeating arrangement to obtain the tunnel.

**Stages:** A. Increase glyph size until neighbours overlap; preserve index draw order. B. Add a palette/index ramp and fine polygon border. C. Save the green tunnel preset and verify slow motion, dark gaps, and edge coverage. Treat this as a spiral preset, not another full fractal engine. **Reuses:** effect 9. **Effort:** small incremental.

### 11. Woven polygon vortex

**Seen:** ~82.75–85.75 seconds; reference 24.

**Appearance:** Many purple/pink polygon outlines form an angular pinwheel, like layered wire sheets spiralling inward.

**Technical basis:** Same overlapping polygon sequence as effect 10, with a different angular step, palette phase, and amount of overlap. Straight polygon edges produce the woven linework. Shape interiors and later draw operations occlude earlier ones; additive blending alone will not reproduce it.

**Controls:** 5–9 sides (start 7), count 200–700, size/radius ratio 0.5–1.8, border 0.5–2 reference px, index angle step −180° to 180°, palette frequency 1–8. Optional small index-based polygon rotation is an extension; the matching reference keeps polygon profile orientation fixed in its local drawing coordinates.

**Stages:** A. Derive an angular vortex preset from effect 10. B. Tune border/fill contrast and preserve painter order. C. Add sparse and dense linework variants; validate anti-aliasing in slow exports. **Reuses:** effects 9–10. **Effort:** small incremental.

### 12. Scalloped web rosette

**Seen:** ~85.75–88.733 seconds; reference 25.

**Appearance:** A white/pink star or flower recedes through repeated scalloped lobes, with fine red curved outlines around it.

**Technical basis:** The source changes the spiral glyph profile to **circles**. Their overlapping edges produce the scallops and pointed negative spaces. The rosette is an emergent arrangement of discs; it does not require fractal recursion or Bézier petal meshes.

**Controls:** Circle profile; count 200–700; size/radius ratio 0.6–1.8; outline 0.5–2 reference px; angular step near repeated arrangements; rotation −2 to 2 turns per loop; colour frequency 2–6. Useful variants: fine web, thick white petal bands, inverted dark petals.

**Stages:** A. Switch effect 10's large overlapping glyphs to circles. B. Tune repeated angle, overlap and fill/border colour. C. Save the rosette and inverted variants; compare black negative spaces as carefully as bright strokes. **Reuses:** effect 9 circle glyph and effects 10–11 draw ordering. **Effort:** small incremental.

### 13. Radial line interference field

**Seen:** 88.733–91.733 seconds; reference 26.

**Appearance:** Thin green, mostly horizontal line segments spread from a central disturbance. Their changing alignment creates compressed bands, diamonds and a vibrating scanline impression.

**Technical basis:** The source uses the spiral's **two-vertex profile**, which is a stroked line segment, positioned along the polar sequence. Index-dependent coiling rearranges the line centres while their profile remains aligned. Frames are cleared each draw. This is not the repository's separate noise-curve sketch and does not require feedback trails.

**Controls:** Count 128–1,000 (500); line length/radius ratio 0.2–2; line width 0.5–2 reference px; profile orientation −180° to 180°; angular-step modulation 0–30°; coiling cycles 1–8; opacity 0.1–1. Variants: horizontal radiation, vertical interference, short dash field.

**Stages:** A. Add a real line/capsule glyph mode, rather than trying to fill a degenerate polygon. B. Apply the existing polar placement and loop-safe coiling. C. Match the green field and profile orientation, then test subpixel filtering. Keep opacity or optional blur separate from the generator. **Reuses:** effect 9 and capsule strokes. **Effort:** medium incremental.

### 14. Broad coiling spiral ribbon

**Seen:** ~91.733–94.63 seconds; reference 27.

**Appearance:** A thick magenta spiral sweeps around a large black opening, curls tightly, then unwraps. Fine edge steps reveal the many shapes forming its surface.

**Technical basis:** The matching source uses overlapping large **pentagons** on the polar sequence, with the angular step changing over time. Their union appears like a ribbon. A swept ribbon mesh is a possible alternative design, but is not needed to reproduce this particular look.

**Controls:** 5-sided profile; count 200–700; size/radius ratio 0.5–1.8; coiling depth 0–60° per index step; coiling cycles 1–4; radial spacing 0.001–0.01; colour frequency 0.5–6; border 0–2 reference px. Variants: thick curl, thin filament, opening/closing spiral.

**Stages:** A. Make an overlapping pentagon preset. B. Animate angular step with a sine from explicit loop phase. C. Add width/spacing controls and stop-motion-depth behaviour; verify that the dramatic unwrap remains reproducible when scrubbing backwards. **Reuses:** effects 9–11. **Effort:** small incremental.

### 15. Coiling particle rays

**Seen:** ~100.63–106.63 seconds; references 30–31.

**Appearance:** Beaded spirals straighten into spokes, bunch into short bright packets, then curl back. Purple polygon beads transition to red/yellow hexagons.

**Technical basis:** Animate the spiral's per-index angular increment, not just a global rotation. Near repeated angular relationships, many samples align into rays. The same particles remain assigned to fixed indices; no particle simulation is required. Brightness changes are produced by colour and overlap as well as motion.

**Controls:** Reuse effect 9; count 128–700, glyph/radius ratio 0.03–0.4, coiling depth 0–120° per index step, coiling cycles 1–8, rotation −4 to 4 turns per loop, palette frequency 1–8. Start with 6- or 7-sided beads. Offer slow coil, brisk spokes, and warm hexagonal rays.

**Stages:** A. Add periodic angular-step modulation to the beaded preset. B. Tune amplitude so it passes through both coiled and aligned states. C. Add warm hexagon and cool polygon presets; bound extreme modulation and check temporal aliasing at 24/30 FPS. **Reuses:** effects 9 and 14's phase modulation. **Effort:** small incremental.

### 16. Overlapping disc whirl / spiral mandala

**Seen:** ~106.63–109.63 seconds; reference 32.

**Appearance:** Large outlined purple/magenta discs fill the screen in spiral arms, alternately opening black channels and closing into a dense scale-like surface.

**Technical basis:** Same polar placement with circle glyphs, a larger size/radius ratio than effect 9, and periodic angular-step changes. Neighbour overlap plus outlines produces the scale pattern. This is distinct from the off-pivot layered circle engine used in effects 2–4.

**Controls:** Count 200–700; glyph/radius ratio 0.2–0.9; outline 0.5–2 reference px; palette frequency 1–8; coiling depth 0–120°; coiling cycles 1–8. Variants: separated discs, touching scales, overlapping plates.

**Stages:** A. Enlarge the dot spiral while retaining thin outlines. B. Add coiling and colour variation. C. Offer a coverage control and test dense overlaps for overdraw and alpha fringes. Use clipped glyph bounds instead of full-screen work per disc. **Reuses:** effects 9, 12, 15. **Effort:** small incremental, moderate fill-rate cost.

### 17. Monochrome scalloped vortex

**Seen:** ~109.63–112.650 seconds; reference 33.

**Appearance:** Alternating black/white polygon bands twist into a scalloped tunnel, opening and folding dramatically as the sequence moves.

**Technical basis:** Large many-sided polygon glyphs in the same spiral system. Animated angular stepping and alternating index colour produce a high-contrast optical depth illusion. It is related to effect 12, but uses polygon edges and stronger time variation rather than circular lobes.

**Controls:** Sides 8–10 (10); count 200–700; glyph/radius ratio 0.3–1.2; black/white palette; palette frequency 2–8; coiling cycles 1–6; coiling depth 0–90°; outline 0.5–2 reference px. Optional contrast/invert and grayscale falloff.

**Stages:** A. Create a high-sided polygon variant of effect 10. B. Add monochrome bands and periodic coiling. C. Tune the scallop transitions at delivery frame rate; inspect narrow bright bands for flicker and preserve matched preview/export filtering. **Reuses:** effects 9–16. **Effort:** small incremental.

### 18. Growing circuit worms

**Seen:** 41.067–~44.1 seconds; reference 13.

**Appearance:** Short red right-angle paths emerge across black, briefly form dense circuitry, then shrink into points and disappear.

**Technical basis:** Source-correlated: seeded self-avoiding walks on an occupancy grid. Cache complete paths, then reveal or retract their segments according to a periodic progress value. A thinner inner stroke makes a hollow tube. These are paths being revealed, not autonomous worms simulated each frame.

**Controls:** Grid height 16–96 (50); maximum path length 2–40 (7); stroke width 0.1–0.9 cell; inner cutout 0–0.9 of stroke width; joins miter/round/bevel; grow/hold/retract fractions; cycles 1–8; seed. Limit total generated segments, initially 20,000–50,000 pending profiling.

**Stages:** A. Generate deterministic non-overlapping grid paths and draw static segments. B. Store cumulative path distance and animate visible length with a smooth grow/hold/retract envelope. C. Add caps, joins, hollow strokes, and repeatable presets. Render path endpoints explicitly; reject unbounded generation. **Reuses:** tile occupancy concepts, seeded generation, capsules, phase. **Effort:** medium-to-large; new path renderer.

### 19. Directional circuit channels

**Seen:** ~44.1–47.1 seconds; reference 14.

**Appearance:** Long blue/pink paths run mostly in parallel before turning, creating packed circuit channels and architectural bands.

**Technical basis:** Same path engine as effect 18, with direction preferences and longer walks. In the matching source, fixed directional priorities choose among available neighbours. An optional weighted-random mode would give a different, looser look. Colours vary with path length and reveal progress.

**Controls:** Path length 20–200 (100); preferred direction −180° to 180°; direction bias 0–1; grid height 24–80; stroke 0.2–0.9 cell; inner cutout 0–0.8; reveal cycles 1–6. Variants: horizontal channels, vertical conduits, diagonal-staircase flow.

**Stages:** A. Add directional priority to cached path generation. B. Tune long-path packing and reuse the reveal system. C. Add channel presets and verify that dead ends terminate cleanly without CPU stalls. Cache regeneration only when direction/seed/grid/length changes. **Reuses:** effect 18. **Effort:** small-to-medium incremental.

### 20. Mirrored maze carpet

**Seen:** ~47.1–53.1 seconds; references 15–16.

**Appearance:** Circuitry forms a balanced, ornamental maze. The red version is coarse and sparse; the blue/pink carpet is finer and denser, with visible mirrored structure.

**Technical basis:** Source-correlated: construct paths in a restricted subregion, then reflect or replicate them into a symmetric whole. Reuse the same reveal progress for corresponding copies so the symmetry persists in time. This is structured grid geometry, not recursive kaleidoscope ray marching.

**Controls:** Mirror X/Y on/off; grid height 16–96; path length 4–80; stroke 0.1–0.9 cell; inner cutout 0–0.9; corner style; reveal cycles 1–6. Optional 4/8-fold radial variants are extensions; start with the reference's rectangular mirrored arrangement.

**Stages:** A. Generate in one subregion and render reflected copies. B. Coordinate reveal and per-copy colouring. C. Add coarse red and fine pastel presets; verify central seams, odd/even grid sizes, and rectangular canvases. Avoid duplicate strokes along mirror axes. **Reuses:** effects 18–19, existing symmetry concepts. **Effort:** medium incremental.

### 21. Radial circuit core

**Seen:** ~53.1–56.067 seconds; reference 17.

**Appearance:** A dark annulus cuts through red circuitry. Short stepped paths gather into a central core and radiate around the surrounding empty ring.

**Technical basis:** Source-correlated: mark a circular annular region unavailable in the occupancy grid, then grow paths through the remaining cells using a central attractor. Paths prefer moves that approach that attractor. The black ring is designed negative space in the generated layout, not a side effect of shadows.

**Controls:** Centre X/Y 0–1; inner radius 0.05–0.4; outer radius 0.1–0.6, constrained above inner radius; attractor bias 0–1; mask inversion; grid height 24–96; path length 3–100; stroke 0.1–0.8 cell; grow/retract cycles 1–6. Variants: central island, empty core, off-centre attractor.

**Stages:** A. Add a radial occupancy constraint to effect 18. B. Add attractor-guided path growth and periodic reveal. C. Expose annulus inversion/origin, and check bounded generation, ring continuity, and non-square framing. **Reuses:** effects 18–20 and common radial-distance math. **Effort:** medium incremental.

## Shared systems and fit with the existing app

### What is already present

The current app is Form & Field 0.5.0. I inspected its source, not only its README.

| Existing system | Where it lives | Reuse |
| --- | --- | --- |
| One GPU pipeline for preview, PNG and EXR export | `src/rendering/StudioRenderer.ts` | Every new generator should render through its existing source target. |
| Half-float internal render targets, linear colour, explicit display conversion | `StudioRenderer.ts`, `src/rendering/shaders.ts` | Keep procedural colours and alpha compatible with this contract. |
| Four layers, transforms, masks, normal/screen/multiply/add | `StudioRenderer.ts`, `src/shared/types.ts` | Each new graphic instrument becomes an ordinary layer. |
| Six-colour palettes, seeds, presets, variation locks | `src/core/project.ts` | Add curated looks without creating another preset subsystem. |
| Periodic phase, frame-index export, sine/pulse/noise/keyframes | `src/core/timeline.ts` | All intrinsic animation can be a pure function of phase. |
| Filtered contour fields and smooth periodic motion | `src/rendering/shaders.ts` | Reuse mathematical concepts; split helpers carefully to avoid changing existing surface output. |
| Existing family/variant controls and family-specific inspector filtering | `src/core/project.ts`, `src/ui/App.tsx` | The fractal inspector is a useful UI pattern for graphic families. |

The present layer kinds are only surface/sculpture/fractal/image. There is no existing general glyph batch, rectangle-packing cache, grid-path renderer, or general temporal feedback system. The compositor's current `glow` expands around transparent silhouettes; it is **not general internal bright-pass bloom**. In particular, it will not create a luminous centre inside an opaque full-frame generator. Effects 2–4 can obtain their reference appearance from colours alone.

### Proposed integration

Add one new **Graphic Patterns** instrument with a new `graphic` layer kind and five stable family IDs: Pillars, Circles, Tiles, Spirals, Paths. Put visible variations inside the family. This is a proposed architecture, not an instruction to implement everything in one change.

Use dedicated small generator modules behind that instrument, for example `graphics/pillars.ts`, `circles.ts`, `tiles.ts`, `spiral.ts`, `paths.ts`, plus a shared glyph material and layout cache. Reuse the existing source/composite/finish/export path. An orthographic graphic scene can draw instanced quads with local analytic circle/rounded-rectangle/polygon/line coverage. Paths need a batched segment mesh plus well-defined joins and caps.

Integrate a first family completely before exposing another:

1. Extend `LayerKind`, preset types, parameter definitions, creation, variation locks, visibility filtering, validation and UI labels. Use stable numeric family/variant IDs and retain settings when switching, following the existing fractal pattern.
2. Update **both** project validation in `src/core/project.ts` and the native export layer-kind allow-list in `electron/export-manager.cjs`. Updating only the renderer would leave native export rejecting the new layers.
3. Add an explicit graphics branch to `StudioRenderer.drawSource`; the current final branch assumes sculpture. Extend resize/dispose and cache invalidation for any additional GPU resources.
4. Add an instrument card, inspector fields, preset filtering and thumbnails. Keep implementation details such as “SDF” and “instance count” out of the creative-facing UI unless a quality control needs them.
5. Preserve old project values and supply defaults for newly introduced fields. Add a renderer revision when output math changes; confirm export fingerprinting includes new shader/module code. The app fingerprint traverses source/built output, but `scripts/render-proof.cjs` uses an explicit file list that must be extended for added modules. Existing interrupted jobs must never mix old and new renderer output.

For parameters, follow the current superset-plus-visible-filter pattern or introduce an equally explicit family schema. Do not silently accept arbitrary unvalidated parameter keys. Structural counts, seed, family and shape choice should remain discrete; route continuous controls through the existing Motion system.

### Reusable primitives

| Primitive | First use | Later use |
| --- | --- | --- |
| Rounded rectangle / capsule / circle coverage | 1 | 2–8, 13, 18–21 |
| Ordered glyph batch with per-index palette coordinate | 2 | All circle and spiral looks, tile outlines |
| Normalized coordinates plus pixel footprint filtering | 1 | Every effect; consistent preview and 4K output |
| Seeded occupancy layout | 5 | Tile variants, paths, annular constraints |
| Linear/radial phase field | 8 | Tile sweeps, per-glyph pulses, path reveal offsets |
| Repeated contour bands | 7 | Tile rings, optional ring glyphs, outlines |
| Polar sequence with radius-dependent glyph size | 9 | 10–17 |
| Periodic angular-step modulation | 14 | 15–17 and circle coiling |
| Cached paths with cumulative distance | 18 | 19–21 and future dashed/flowing strokes |
| Geometric replication/reflection | 20 | Symmetry variants across the instrument |

The existing compositor's `accumA/accumB` targets alternate while composing layers within a frame. They are not previous-frame history. Do not convert them into feedback buffers for this study.

## Small, reviewable delivery stages

Each row should leave the app usable, with a saved preset and a short successful export. The detailed A/B/C steps above fit inside these releases.

| Release | Add | Completion evidence |
| --- | --- | --- |
| 1 | Graphic Patterns shell + effect 1 | Pillars save/reopen, animate, composite and export in the shared renderer. |
| 2 | Circle stack: 2, then 3, then 4 | Halo, bloom and fan presets match their representative frames and loop. |
| 3 | Seeded packed tiles: 5 | Stable layout, bounded generation, portrait and landscape handling. |
| 4 | Tile materials: 6, then 7 | Hollow and nested contours retain clean edges and correct alpha. |
| 5 | Tile motion: 8 | Linear and radial morph fields cross the loop boundary without a pop. |
| 6 | Basic spiral glyphs: 9 | Dots, triangles and monochrome hexagons work from one placement engine. |
| 7 | Overlap presets: 10, 11, 12 | Green tunnel, angular weave and white web share the same renderer. |
| 8 | Line and dynamic spiral modes: 13, 14, 15 | Correct line segments, coil/uncoil motion, reproducible scrubbing. |
| 9 | Dense overlap looks: 16, 17 | Disc mandala and monochrome vortex remain clean at target frame rates. |
| 10 | Grid paths: 18 | Stable layouts and smooth segment reveal, including endpoints/joins. |
| 11 | Path variants: 19, 20, 21 | Directional, mirrored and annular layouts pass their geometry checks. |

If time is limited, stop after releases 2, 5, or 6. Those are useful complete tools. Spiral effects become cheap to add after release 6; path effects should wait until the existing glyph and layout systems are stable.

## Rendering and loop checks that prevent the main failure modes

**Painter order and alpha.** For each family, preserve deliberate per-shape order. Circle stacks and spiral overlap sequences do not necessarily want the same order. Disable unwanted depth interaction in flat graphic batches. Output premultiplied linear RGBA into the existing source contract; coverage must scale RGB and alpha together. Transparent gaps should reveal lower layers. If matching the recording requires a black interior/background, expose that as a deliberate background/fill choice rather than conflating black with transparent.

**Memory and performance.** A single RGBA16F 3840 × 2160 target is about 63.3 MiB before depth/MSAA/driver overhead. The current renderer already owns several targets; avoid one extra target per shape or per look. Use tight instanced glyph bounds, structural caches and bounded path generation. Hundreds of overlapping large glyphs can be fill-rate heavy despite having few draw calls. Benchmark the actual dense overlap presets, not only sparse dots. The suggested counts are starting budgets, not measurements.

**Filtering.** Derive stroke and contour coverage from the output pixel footprint. Fine centre rings should average/fade instead of becoming unstable. Keep artistic line width in normalized/reference-pixel units; adjust sampling quality, not geometry scale, between preview and export. Check narrow bright lines against black at 24/30 FPS, since visually fast motion can alias even if the loop is mathematically closed.

**Loop math.** Feed every generator the existing phase. Use integer temporal cycles and integer full rotation turns, or a sine-driven angular offset. Any per-index twist that varies over time must itself be periodic. A fractional spatial wave/angle is fine; an unconstrained fractional temporal winding can break the seam. Randomness must be derived from saved seed and stable index, not from calls made every frame. No warm-up is needed for these five families.

**Verification per release.** Run the app's existing build and relevant core/native tests. Add meaningful tests for newly introduced geometry/schema behaviour: no overlap/out-of-bounds in packing, bounded path generation, fixed-seed reproducibility, new-kind native export acceptance, and family visibility/serialization. Add a phase-order check: render phase A, phase B, then phase A again and compare. Compare phase 0 with phase 2π, inspect the last-to-first playback step, save/reopen a mixed composition, check transparency over checkerboard and coloured layers, and perform one short native movie export. A still PNG alone cannot verify animation or the native layer-kind validation.

## Visual references and audit files

The six detail sheets contain the 34 larger reference frames, with timestamps and decoded frame numbers:

- [01 — Pillars and early nested tiles](</Users/grego/Documents/ChatGPT/three VJ/docs/video-effects-reference/details-01.jpg>)
- [02 — Tile outlines, contours and morph waves](</Users/grego/Documents/ChatGPT/three VJ/docs/video-effects-reference/details-02.jpg>)
- [03 — Circuit paths and concentric halo](</Users/grego/Documents/ChatGPT/three VJ/docs/video-effects-reference/details-03.jpg>)
- [04 — Circle blooms, fans, polygon tunnel and weave](</Users/grego/Documents/ChatGPT/three VJ/docs/video-effects-reference/details-04.jpg>)
- [05 — Web, line field, ribbon and beaded spirals](</Users/grego/Documents/ChatGPT/three VJ/docs/video-effects-reference/details-05.jpg>)
- [06 — Particle rays, disc mandala and monochrome spirals](</Users/grego/Documents/ChatGPT/three VJ/docs/video-effects-reference/details-06.jpg>)
- [Whole-recording overview, approximately one sample per second](</Users/grego/Documents/ChatGPT/three VJ/docs/video-effects-reference/recording-overview.jpg>)

The exhaustive review material remains in `work/video-effects-analysis/`: 3,600 extracted thumbnail frames, 30 sequential sheets of 120 frames each, original timestamp metadata, `frame-audit.csv`, 34 larger crops, and the read-only source snapshot. The CSV measures adjacent-image change; high change can mean fast motion, not necessarily a scene cut.

This task created analysis documents and reference images. It did not change the app or implement these effects. The public reference repository labels its code CC BY-NC 4.0 in its [license file](https://github.com/vasilyev-maksim/p5-experiments/blob/e113523b48fb5342199d31e49843f042e741cb30/LICENSE.md). The proposed stages describe fresh implementations of the visual techniques; direct reuse of reference code would need to account for that license.
