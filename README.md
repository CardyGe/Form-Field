# Form & Field

A local visual instrument studio for Apple Silicon Macs. Create looping liquid fields, pearlescent 3D forms, fractal worlds and graphic patterns, composite up to four layers, and export full-resolution stage media. This is a working 0.11 alpha.

## Start creating

Open **Form & Field.app**. The packaged application includes its rendering and encoding tools and works offline.

1. Start with the current surface, or choose a look in **Presets**. A preset replaces the selected instrument of the same kind. Selecting a different kind adds a layer when there is room.
2. Choose **Bands**, **Contours**, **Drips**, or **Fusion**, then explore its three **Variant** options. **Folded Sculpture** offers Shell, Bloom, Ribbon and Knot forms. **Fractal Worlds** combines three fractal families with variants and colour treatments.
3. Select a layer in the composition list. The top row is the foreground. **Finish** contains blending, transforms and masks. Imported PNGs retain transparency; PNG/JPEG artwork is embedded in the project.
4. Click a wave button beside a parameter to animate it. **Motion** offers sine, pulse, smooth periodic noise and cyclic keyframes. Depth offsets the base value; the result stays inside the parameter's bounds. Keyframes drag vertically and interpolate smoothly through the loop boundary.
5. **Randomize effect** makes coherent variations of the selected effect. Choose Subtle, Balanced or Bold, or use the shuffle button beside any layer. **Keep** locks retain palette, structure, motion and material independently. The source seed stays fixed when structure or motion is locked; repeated clicks still produce fresh variations. Effect modes, quality, coverage, transforms, masks and authored animation routes stay intact. Imported images receive colour grading variations.
6. Set the duration, preview the loop, then open **Export**. Use a small draft to check a composition before committing to 4K.

Space plays/pauses outside text controls. Command-S saves a self-contained `.formfield` project; Command-O opens one. Header undo/redo buttons operate on composition edits. Command-Z in a text field keeps normal text editing behavior.

## Projection motion · 0.11

Open **Library → Presets → Projection motion** for nine authored studies. **Velvet Currents → Fibre motion → Transported fibres** adds travelling paths, local eddies, staggered births and continuous trails. **Living Ink → Pigment motion** offers the original prepared growth, a flowing pigment loop, and evolving chemistry with transported pigment. **Kinetic Relief → Relief construction → Hinged solids** uses real geometry, perspective and shared shadows. New layers use the upgraded treatments; existing saved looks keep their original settings.

The ten projection instruments also have Organic motion, Flow direction, Travel and a Motion phrase: Steady travel, Gather and release, or Drift and settle. Controls follow the selected treatment. Evolving chemistry has an explicit 128/256/384 chemical resolution used by both preview and export. Its simulation clock is fixed and interpolated; transport and preparation controls rebuild deterministic state.

**Evolving clips stop at their end** and export with **Render clip**. They do not claim seamless looping. Press Play to replay. Use Flowing pigment loop for a deliberately periodic treatment. Evolving chemistry supports clips up to 60 seconds.

**Shape → Surface influence** adds an editable polygon or uses an imported image mask. Choose Flow around shape, Emit inside shape, or Trace shape edges. Transported fibres and evolving chemistry use shapes during generation; other treatments use them for reveals. Drag polygon vertices or use arrow keys; add/remove vertices to describe a surface. Image masks can independently clip the final output with **Also clip output with mask**. Active obstacles stay solid while Influence blends the visible treatment.

Under **Motion → Animation range**, choose **Smooth between endpoints** to animate within explicit lower and upper values without clipping a symmetric offset. Endpoint routes and surface layouts save in document version 2. Version-1 projects remain readable and migrate neutral numeric settings; original artwork is preserved. Keep a copy for use with older application versions.

The [implementation and source register](docs/projection-media-0.11.md) documents references, engineering decisions, evidence and remaining physical projection checks. The [creative direction](docs/projection-media-direction-2026-11-10.md) retains the original staged plan. Reproduce the new software proof with `npm run test:projection`.

## Flat colour & outlines

Every layer has **Finish → Flat colour & outlines**. It replaces shading with hard bands of the layer palette and draws contour lines between them, for cartoon-style mapping work. **Colour bands** sets how many tone bands there are; the palette repeats beyond six. **Outline width** is measured in pixels of a 1080-line frame, so lines keep their proportions at 4K and with supersampling. **Outline colour** uses black or any palette swatch. Edges from the source are snapped to one side, so soft source edges never leave slivers of in-between colours. For the cleanest result, lower the source's Relief and Softness.

**Palette cycles per loop** rotates the bands through the palette in whole turns, so the loop still closes exactly. On smooth gradients the bands flow; on flat areas whole regions change colour at once, which can read as strobing.

**Library → Presets → Flat colour & outlines** has five looks: Neon Strata, Acid Drip, Pop Portal, Contour Pop and Pour Lace. Applying one turns on **Finish → Output → Exact colour**, which shows palette colours at their exact values instead of rolling off bright highlights. Leave Exact colour off for lit 3D and glowing sources.

## Feedback

Any layer except Graphic Patterns and Ink *Evolving* can feed back into itself (Finish → Feedback). Each frame keeps a faded echo of the last one, zoomed, turned, moved and hue-shifted, and the new source is drawn with it. Flat colour and outlines then apply to the result, so echoes are re-banded into flat poster colour.

- **Echo blend:** *Mix* blends the echoes across the whole source. *Behind source* shows them only through transparent areas and frames. *Brighter* keeps whichever is brighter, for glowing trails.
- **Source frame** cuts a centred hole so the source becomes a border. With Echo zoom below 1, the borders nest inward into a tunnel.
- **Source window** keeps only the centre of the source. With Echo zoom above 1, the echoes stream outward around it.
- **Echo melt** pushes each echo along its own brightness slopes, so the trails smear.

Motion values apply per frame. Loops close exactly, because the fading means the process forgets its start. Each export first warms up for up to about 270 frames, until the oldest frame's contribution falls below half-float precision, and then renders the loop in order. At 4K this adds a few seconds per export. In the preview, playback is exact. After a seek or an edit, the preview warms up for only 60 frames and settles as it plays. Three looks live under Library → Presets → Feedback.

## Projection delivery

**Export → Delivery format** offers mastering formats (ProRes 4444, ProRes 422 HQ, 16-bit PNG sequence) and projection playback formats: **HAP Q** (best quality), **HAP** (smallest) and **HAP Alpha** (transparent). HAP is decoded on the GPU by MadMapper, Resolume, Millumin and TouchDesigner, so 4K loops scrub and play smoothly. HAP needs dimensions that are multiples of 4; 4K frames are written in 8 chunks for parallel decoding. Projector sizes include DCI 4K, 4K WUXGA and WUXGA.

**Anti-aliasing** renders the whole composition at 2× or 3× the delivery size and filters it down with a Mitchell filter, removing edge shimmer and moiré from fine lines. 2× takes roughly 2.5× as long per 4K frame. 3× is limited to 8192 pixels per side, so it suits HD and smaller deliveries. Fine film grain is softened slightly by the filter.

**Loop seam check** runs after every export. It compares the six frames either side of the loop point and reports when the step from the last frame back to the first is larger than any nearby step (a pop) or when the motion changes speed there (a hitch). A seam is reported in the export panel but never stops delivery. To check the whole library, run `env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/seam-audit.cjs`, optionally followed by preset ids. Results go to `work/seam-audit/results.json`. The Ink *Evolving* looks currently grow from seed without returning, so they are reported as seams.

## Workspace

The canvas takes priority. The slim left rail selects layers; expand **Layers** for visibility, order and per-layer variation actions. **Library** opens a searchable drawer of instruments and looks. The inspector uses single-row controls and expandable sections: the main shape controls start open, with secondary geometry under **Advanced shape**. Values, reset buttons and animation controls remain beside each slider.

Playback, timeline, duration and **Vary** share one compact bottom dock. The settings button beside Vary opens variation amount and **Keep** locks. Panel layout is remembered separately from the composition.

| Shortcut | Workspace action |
| --- | --- |
| **B** | Show/hide Library |
| **L** | Expand/collapse the layer list |
| **I** | Show/hide the inspector |
| **F** | Focus the preview; press again to restore the layout |
| **Esc** | Close an open drawer/settings panel, then exit focus mode |

These shortcuts leave text fields and export dialogs alone. Focus mode also has a visible exit button. The desktop window can be resized to 960 × 640.

The [workspace research and measurements](docs/research/workspace-ux-2026-11-10.md) record the design rationale and before/after canvas area. `npm run test:ui` builds the current app and verifies the workspace, gestures, persistence and native media exports. The earlier fixed-panel smoke script is retained as `scripts/verify-ui-legacy.mjs` for reference.

## Interactive canvas

Select a visible layer, then work directly on its preview:

| Gesture | Action |
| --- | --- |
| Click | Vary the selected effect using the current variation amount and Keep locks. |
| Drag | Shape the pattern with two controls chosen for the instrument. Horizontal movement changes the first; upward movement increases the second. |
| Ctrl + drag | Pan the selected layer. |
| Ctrl + scroll | Zoom the selected layer around the cursor, from 5% to 800%. Trackpad pinch events use the same path. |
| Shift during a gesture | Use finer movement or zoom. |
| Percentage / reset button | Restore the layer's pan and zoom. |

The preview identifies the selected layer and shows the two parameter values while shaping. Each drag or short wheel burst is one undo step. Framing and shape changes save in the project and carry through to stills and movies. Ctrl navigation explicitly edits layer transforms; Keep locks govern variations and shaping. Shape gestures skip animated and preparation-only controls. Animated position or scale routes must be removed before direct framing so the gesture cannot fight an animation.

Focus the canvas with Tab: Enter or Space varies, arrow keys shape, Ctrl-arrow pans, and Ctrl-plus/minus zooms. Shift makes arrow adjustments finer. Space elsewhere retains playback control. Imported images support click variations and Ctrl framing.

The preview renders at the display's pixel density within a 4K pixel budget. Magnified repeating graphics render their geometry at the current view resolution, keeping fine outlines and contours sharp as you zoom. Small repeating fields retain filtered sampling. Imported images retain the detail present in their original pixels.

The interaction design and API research are recorded in [canvas interaction research](docs/research/canvas-interaction-2026-11-09.md). Run `npm run test:interaction` to build and verify the gestures in the real desktop application.
Run `npm run test:zoom` to compare 2×, 4× and 8× graphics against native-resolution reference crops and check that rotated solid tiles retain continuous coverage.

## Deeper effect controls and finishing

Every layer now has **Finish → Tonal finishing**: Tonal contrast, Contrast pivot, Midtone gamma, Shadow lift, Highlight compression and Vibrance. These work on luminance and colour before layer blending, preserving alpha. Contrast pivot takes effect when Tonal contrast differs from 1. Reset any numeric parameter with its ↺ button; this is a normal undoable edit.

The ten light/material/space instruments expose **Advanced shape**, **Advanced motion** and **Advanced material** sections. Field stretch, Domain warp, Warp scale, Field twist and Motion phase are shared. Warp scale needs a nonzero Domain warp. Lit materials add Light elevation, Fill light, Directional sheen, Sheen direction and Clear coat; Sheen direction takes effect when Directional sheen is enabled. The new directional highlight is also available on Surface and Oil Slides.

Family-specific controls add aligned/asymmetric caustics; ink seed coverage, development and edge pigment; magnetic ridges; braided/vortex currents; staggered rounded shutters; interlaced cloth; mineral facet controls; twisted/off-axis vaults; circular and harmonic nodal figures; and directional volume scattering, absorption, ribbon width, turbulence and banding suppression. Ink preparation controls are not animation targets. Their cache keys include every preparation setting.

Each new instrument has a fourth exploration look that demonstrates these controls. The original 120 looks remain, with neutral migration defaults preserving existing artwork. The full library now has 139 presets, including the nine projection motion studies.

Volume Banding suppression uses deterministic sampling dither; High quality reduces the resulting sampling texture. Directional highlights are filtered against rapid normal changes to reduce sparkle. All render and grading changes use the shared compositor and native output pipeline. The detailed audit and research are in [the professional effect audit](docs/professional-effect-audit-0.10.md).

## Signature collection

Choose **Presets → Signature collection** for 20 additional authored looks across Surfaces, Sculptures, Fractals, Oil Slides, Super 8 Paint and Graphic Patterns. The cards show actual renderer reference frames. All 70 original presets remain available in their family filters. The collection uses the existing renderer and export pipeline and saves as ordinary schema-1 layers.

The randomizer stays near an authored recipe for the current family and variant. It changes groups of related controls together and chooses a complete authored palette rather than mixing random swatches. Julia constants, algorithm switches and coverage options are held deliberately; locked or animated controls are retained. **Undo** restores the previous variation.

## Surface controls

Version 0.6 has twelve pattern variants:

| Pattern | Variants |
| --- | --- |
| Bands | Flow, Braids, Ribbons |
| Contours | Terrace, Ripples, Vortex |
| Drips | Melt, Beads, Strands |
| Fusion | Portal, Twin Portals, Lens |

**Pattern density** changes the frequency of the pattern, independently of loop timing. **Stretch** changes its proportions; **Center horizontal/vertical** position the focal point. **Flow** controls the smooth original distortion, and **Turbulence** adds stronger domain curls. **Detail** changes finer flow. **Roundness** softens edges, corners and liquid bodies.

**Relief** changes shading and depth. **Light angle** moves the light around the surface and **Roughness** changes the width of highlights. **Softness** widens colour transitions. **Negative space** cuts dark channels into the artwork; use a mask for transparent cutouts. Exposure, Saturation and Hue shift are together under **Finish → Color finish**.

Very small rings and thin patterns filter toward their average at the pixel limit. Preview and 4K export use the same math, with filtering for the actual target resolution. New fields are added only when absent in earlier saved projects; old settings and embedded assets remain intact. Neutral new settings retain the earlier appearance within GPU rounding tolerances.

## Light, material & space

Ten projection instruments share the existing rendering loop, layer compositor, masks, palette grading, smart randomizer and native output pipeline. The library includes four original looks per instrument, plus nine projection motion studies across Currents, Ink and Relief: 139 presets overall.

| Instrument | Material and controls |
| --- | --- |
| Caustic Atlas | Curved wave-focusing ridges, wave mixture, focus, spectral spread and ridge width. |
| Living Ink | A seeded Gray–Scott reaction-diffusion pattern, four growth families, branching, pigment coverage, flow distortion and embossed relief. |
| Magnetic Skin | An irregular liquid-metal height field with magnetic pull, peak sharpness, roughness and an opal finish. |
| Velvet Currents | Coherent luminous fibres with curl, density, trail length and depth shading. |
| Kinetic Relief | Bevelled hinged shutters, three hinge directions, travelling opening waves and material shading. |
| Holographic Loom | Filtered warp/weft threads, fabric folds, interference beats, tension and foil finish. |
| Crystal Reef | Connected mineral veins and planar crystal facets with growth, density, height and inner light. |
| Prism Cathedral | Repeated mirrored vaults with bevelled frames, perspective depth and spectral material shading. |
| Resonant Sand | Chladni-inspired standing-wave figures, mixed modes, nodal width, grain and membrane relief. |
| Volumetric Veils | Ray-marched pigment ribbons with erosion, optical depth, light direction and edge illumination. |

**Pattern scale** reveals more of the original continuous fields. Layer transforms evaluate those sources across the full view; scaling never repeats a rectangular screenshot. Evolving Ink instead uses a finite simulation domain with a soft edge, which can become visible when zooming out. Set **Field background** to zero for transparent gaps, then enable transparent output when exporting. The original ten treatments use periodic motion and integer Cycles per loop; evolving chemistry uses a finite clip clock. Motion amount zero stops intrinsic animation. Artist-authored Motion routes remain independent.

Living Ink’s **Prepared growth** treatment prepares its deterministic 384 × 384 chemical texture when its seed, Growth family or Branching changes. Those controls do not run during playback; Branching cannot receive an animation route. Four prepared textures are cached. Flow, pigment, relief, colour and transforms remain live. That treatment’s moving appearance is a periodic deformation of the prepared pattern. **Evolving chemistry** instead advances the chemical and pigment state as described in the 0.11 section above. This keeps seeks and resumed exports reproducible.

Velvet Currents uses analytic strand fields, and Magnetic Skin, Kinetic Relief and Crystal Reef use shaded height fields. They are artistic material instruments rather than physical simulations or editable 3D meshes. Prism Cathedral shades a bounded sequence of mirrored architectural frames; exported alpha cannot refract a background added later in another application. Volumetric Veils uses 24, 40 or 64 depth samples for Draft, Standard and High; this setting affects both preview and export.

The shared optical helpers also improve existing instruments: **Surface → Optical sheen** adds a thin-film finish, while **Oil Slides → Caustic light** and **Optical sheen** add focused illumination and spectral material colour. These controls default to zero in older projects, preserving their appearance. Fine lines in the new instruments use filtering based on the target pixel footprint; Living Ink uses mipmapped chemical textures.

`node scripts/verify-instruments.mjs` checks all forty looks, every control, transparency, loop closure, seek reproducibility and transformed portrait/square/landscape coverage. `node scripts/verify-instruments-ui.mjs` exercises their editor controls and native PNG/ProRes exports in an isolated profile. Neither changes the working composition.

## Graphic Patterns controls

Add **Graphic Patterns** from Instruments. It is a normal composition layer with the same masks, blending, opacity, undo/redo, Motion routes, saving and full-resolution export as the other instruments. Five families provide twenty-six starting presets:

- **Pillars:** wave, uneven pillars, lava columns, fine bars, warm curtains and green tide. Columns, Uneven widths, Wave height, Waves across, Centre opening, Column spacing and Corner roundness change their construction.
- **Circle blooms:** concentric halo, orbital bloom and circle fans. Circle layers, Outer radius, Orbit spread, Layer twist, Coiling depth and Breathing shape the stack.
- **Packed tiles:** packed mosaic, neon frames, nested tiles and tile ripple. Tile density, Largest tile, Tile spacing, Corner roundness, Tile finish, Outline width, Contour spacing and Contour thickness control the field. Linear and radial waves add direction, width, spread, shrink and rounding controls.
- **Spiral forms:** beaded spiral, polygon tunnel, woven vortex, web rosette, line interference, coiling ribbon, particle rays, disc mandala and scalloped vortex. Spiral detail, Shape profile, Spiral spacing, Spiral angle, Shape size, Size falloff, Shape angle, Spiral coiling and Outline width are independent. Circle, line and polygons from triangle through decagon are available.
- **Circuit paths:** circuit worms, circuit channels, maze carpet and radial circuit. Path density, Path length, Path thickness, Path hollowness, Path corners, Draw amount and Hold open control the cached grid paths. Channels expose direction and direction strength; the radial core exposes its ring radii.

Every family also offers Pattern size/stretch/position/angle, palette position/repeats/balance/motion, edge softness, motion depth, cycles and phase. Full turns per loop independently controls whole-pattern rotation for pillars, circles, tiles and spirals. Set both Motion depth and Full turns per loop to zero for a still pattern. Saturation, Hue shift and Exposure live under **Finish → Color finish**.

**Pattern size** changes the pattern's scale across the canvas, rather than shrinking a rectangular drawing. Pillars, tiles and paths continue through a filtered repeating field. Circle blooms and spirals add outer geometry to retain one continuous centre. Stretch, position, angle and the Graphic layer's Finish transforms also keep the field covering the frame. Explicit masks, gaps and transparent Pattern background remain available. Preview and export use the same behavior. `node scripts/verify-pattern-fill.mjs` checks frame coverage, minification, transformed/animated size, masks, portrait/square output and 4K rendering.

**Pattern background** sets the opacity of the sixth palette colour behind the artwork. Set it to zero to reveal lower layers through gaps, frame interiors and hollow paths; also enable the composition's Transparent background for alpha delivery. Starting look selects an authored preset, resetting that layer's pattern settings and Motion routes, just like the preset library. New variation retains the selected family and look and changes only relevant controls; locks still apply.

All motion is evaluated from periodic phase and saved seed. Layouts are cached; scrubbing, transparent exports and resumed jobs need no simulation warm-up. Pattern density and line widths retain the same proportions between preview and export. The implementation uses original geometry and shader code within the existing Three.js renderer.

## Oil Slides controls

**Oil Slides** recreates sliding coloured paint, black cellular ink and a glossy refractive dome. Choose **Acid Slide**, **Cellular Lift**, **Ink Drag**, **Chromatic Slides**, **Cobalt Tide**, **Ember Glass** or **Pearl Ink** in Presets. It occupies one composition layer.

**Pool size**, **Paint coverage**, **Cell size** and **Lens size** shape the material. **Slide travel**, **Relative rotation**, **Drag** and **Cycles per loop** control relative movement. **Thickness**, **Refraction**, **Wetness** and **Ink amount** shape its finish. **Show fine tuning** reveals Lens stretch, Organic shape, Lens depth, Cell complexity, Color separation, Lens lift, Filaments, Edge softness, Light angle, Shadow strength and Grain. At zero travel, rotation and lift the instrument stops unless Motion routes animate a parameter.

The six palette roles are Paint, Secondary paint, Ink, Substrate, Shadow tint and Rim tint. **Substrate** selects a coloured support or a transparent cutout. The glass bends this instrument's own paint; RGBA exports retain tint and reflections, but cannot bend an arbitrary background added later. Existing layer opacity, blending, masks and transforms apply to the whole instrument.

**Render quality** selects Draft (reduced material-field resolution), Standard or High (extra lens sampling). Preview and export share this setting. Saved seeds and periodic paths reconstruct the wake at any timeline position, including animated path controls. Scrubbing and resumed exports need no simulation warm-up. Organic shape gently deforms the glass with the slide, Cell complexity breaks regular cells into branching ink, and Color separation adds subtle refractive color fringes. Longer connected wakes and direction-following filaments stay attached to the paint. The renderer skips lens calculations outside its silhouette and paint calculations outside coverage. Older Oil projects receive defaults only for the four absent refinement controls. This is a procedural approximation of the analogue appearance, without irreversible fluid mixing.

## Seamless scaling and repetition

Pattern size changes the pattern within the full canvas. Packed tiles are packed across their repeat boundaries, and circuit paths can continue from one edge to the opposite edge. Wrapping a tile preserves its complete outline and animation. Fractional pillar waves, palette and travelling morph phases close over the repeat. Solid rectangular tiles at zero spacing share full sample coverage, so they do not leave an artificial dark grid.

Circle blooms and spirals extend around one centre. Radial Circuit keeps one central ring cutout. They do not become a rectangular grid of copied frames.

Surface, Fractal, Oil and Super 8 layers evaluate their procedural coordinates across the actual scaled/rotated view. Zooming out reveals more of the field instead of shrinking a cropped render into a box. Sculpture transforms operate on the projected geometry before clipping, revealing the complete object when scaled down. Imported images with Repeat above 1 use a wrapping, filtered sampler across the view; Repeat 1 retains the artwork's finite bounds and contain/cover fit. Imported artwork intended to be seamless should have matching edges.

Masks, opacity, blending, grading, shared Motion routes and optional Super 8 gate framing still apply. Preview, PNG stills and sequence/movie exports share these rendering rules.

## Super 8 Paint controls

Add **Super 8 Paint** from Instruments, or choose **Chromatic Staircase**, **Paint Destruction**, **Scratched Negative** or **Cut-out Collage** in Presets. These modes share one layer and retain their controls when switched. Staircase creates terraced color plates; Destruction erodes broad brush swathes; Negative inverts stepped pigment over dark film; Collage overlaps torn painted fragments.

**Geometry scale**, **Geometry steps**, **Paint coverage**, **Paint destruction** and **Direction** shape the paint. **Paint texture**, **Texture scale**, **Dry brush** and **Pigment bleed** adjust procedural pigment and edges. **Emulsion movement** adds fluid distortion, pigment pooling and frame-by-frame texture boiling, rather than only translating rigid forms. The six palette roles are Paint 1–4, Ink and Paper. **Substrate** chooses painted paper or real transparent cutouts. Masks, blending, transforms, opacity and Finish color grading use the same controls as other instruments.

**Motion amount** and **Cycles per loop** animate the geometry. **Film frame rate** simulates 1–48 FPS independently of the export rate; the nearest whole number of film frames fills the loop. **Scratches**, **Film grain**, **Flicker** and **Gate weave** reproduce film wear and registration. Paint settings and shared Motion routes hold together on that clock. Projector transport moves continuously between those held exposures.

**Projector view** offers **Full canvas** (no border), **Rounded gate** and **Film strip** (a single Super 8 perforation rail). Gate inset/corners and Sprocket holes control the optional framing. Geometry and texture scale always change the paint within the view; they do not shrink the canvas into a box.

**Frame advance** pulls the previous exposed frame through the gate during the first 16% of each film interval. **Projector shutter** darkens the rotating shutter; **Shutter blades** chooses one, two or three closures per frame. **Reel turns per loop** adds continuous strip travel and **Frame lines** exposes the dividers between frames. Gate weave and Flicker remain independent. Strong shutter and advance settings deliberately produce dark flashes and visible frame changes.

**Dust**, **Gate hair**, **Scratches** and **Film grain** add separate film defects. **Light leaks** breathes warm edge flares over the loop. **Lens softness**, **Halation**, **Projector vignette** and **Color fading** recreate the projector lens and aged stock. Transparent cutouts retain real alpha; wear and leaks stay within the paint, and optional gates mask its edges. To stop all intrinsic changes, zero Motion amount, Emulsion movement, Frame advance, Projector shutter, Reel turns, Light leaks, Flicker, Gate weave, Film grain, Scratches and Dust, and remove Motion routes.

Existing saved Super 8 projects acquire neutral new controls; their stored controls are retained. New layers and the four updated presets include a warm projector finish. Apply a preset to an existing layer to start with the new treatment, or dial in the projector controls individually.

**Feedback** composites the current paint with five earlier impressions. **Feedback spacing (frames)** sets their age on the film clock; **Feedback zoom** and **Feedback rotation** transform successive impressions. This is a bounded procedural feedback reconstruction, with historical animated paint controls evaluated at their original phases. It has no persistent simulation buffer, so seeks, stills and resumed exports reproduce the same image without warm-up. Feedback affects this instrument's paint before its substrate and film finish; it does not sample other composition layers.

## Sculpture controls

Version 0.6 adds four distinct forms:

- **Shell:** the original curled, scalloped form with layered pleats.
- **Bloom:** a closed petal bowl with a scalloped perimeter.
- **Ribbon:** a broad, rolled and corrugated loop.
- **Knot:** a continuous trefoil tube with a closed periodic frame.

**Fold**, **Opening**, **Twist**, **Curl**, **Lobes**, **Thickness** and **Stretch** change the silhouette. **Fold frequency** sets broad pleat spacing, **Ridges** adds fine relief, and **Ridge scale** sets its spacing. **Asymmetry** offsets the balance of the form. These controls are interpreted by the selected form; switching forms retains their values.

**Breath** creates periodic movement and returns to its starting position. At zero, the form is still unless you add Motion routes. **Orbit**, **Elevation** and **Framing** move the camera.

**Roughness**, **Metal finish**, **Clear coat** and **Sheen** range from soft satin to polished metal. **Iridescence** sets the spectral effect and **Film thickness** changes its colours. The palette presents the two colours this material actually uses: **Base color** and **Sheen color**. **Light angle**, **Light power**, **Shadow strength** and **Shadow softness** shape the studio lighting. Shared Exposure, Saturation and Hue shift are in **Finish → Color finish**.

Sphere-based and periodic-grid forms use matching colour and shadow deformation. The older Shell presets retain their authored shape and material at the neutral new settings; extra tube controls avoid degenerate thickness and the Knot limits extreme strand overlap.

## Fractal controls

Fractal Worlds has three families, each with three variants, plus Palette, Duotone and Contours colouring. There are twelve curated Fractal starting looks. The inspector shows the controls used by the selected family; switching family retains your other settings. Filter **Presets** to the selected family to explore its looks.

- **Kaleidoscope** offers **Lace**, **Petals** and **Weave**: recursive rings, elliptical petal bodies and intersecting ribbons. **Fold**, **Symmetry**, **Twist**, **Detail** and **Line width** shape the pattern. Thin strokes integrate their coverage at the pixel limit.
- **Julia Bloom** offers a genuine quadratic **Classic** set, a mirrored **Radial** arrangement and a smoothly warped **Spiral**. **Julia real** and **Julia imaginary** choose the complex constant, with five decimal places for fine adjustment. Small changes can transform the whole set. **Orbit detail**, **Fold**, **Line width** and **Color density** shape its ornament and colouring. Start with small Morph values to retain intricate filaments throughout a loop.
- **Mandelbox** offers **Architecture**, **Sphere Fold** and **Lattice**, with cubic, stronger spherical and elongated fold structures. **Box scale** and **Fold radius** change the fractal itself; **Fold** changes the folding volume and **Detail** changes recursion. **Radial fold** is an optional mirrored arrangement. **Roughness**, **Light angle**, **Relief** and **Exposure** shape the shaded material, including shadows and ambient occlusion. Space around it is transparent when the composition uses transparent output.

**Coloring** selects the original **Palette** treatment, **Duotone** using the first and last palette colours, or **Contours** with stepped colours and fine contour lines. The new treatments retain the source lighting and fine detail. **Coloring amount** blends back to the original treatment and can be animated. **Contour colors** changes the number of steps. **Finish → Color finish** has Exposure, Saturation and Hue shift.

**Render quality** chooses Draft, Standard or High sampling. High gives the cleanest fine edges and takes longer. This setting applies to preview and export and is preserved by **Randomize effect**. **Scale**, **Orbit**, **Elevation** and **Framing** change the view. The 2D families fill the source canvas; use masks for transparent cutouts.

**Morph** periodically changes structure. **Travel** adds a periodic pan/orbit/dolly and returns to its starting position. With both at zero, intrinsic Fractal motion stops. You can still animate any continuous control through the shared Motion routes. Family, variant, quality, radial fold, symmetry and intrinsic cycle settings remain discrete. **Color drift** offsets the cyclic palette; **Color density**, **Relief**, **Glow**, **Contrast** and **Exposure** shape the finish.

These are finite fractal renderers designed for controllable loops. They do not provide unlimited numerical zoom or an endless forward flight. Saved settings and the app version determine the image, with no accumulated simulation state or temporal feedback.

Earlier version-1 Fractal projects receive only absent new control defaults. Their authored settings, routes and assets are retained, but the revised renderer changes their appearance. Keep the 0.4 app archive when a composition must reproduce its old look. Unfinished exports need the same app build that started them.

The Mandelbox uses an original implementation of the folding definition described by [Tom Lowe](https://sites.google.com/site/mandelbox/what-is-a-mandelbox). Its enclosing volume limits ray traversal without adding artificial sphere-cut surfaces. Its distance estimate is marched with a safety margin; the estimator is not an exact signed distance field.

## Image controls

Imported PNG/JPEG artwork stays embedded in the project. **Image fit** selects Contain or Cover. **Mirror** flips horizontally, vertically or both; **Repeat** tiles the image within its fitted area. **Finish → Color finish** provides Exposure, Saturation and Hue shift without changing the embedded file. Transform, blending, masks and opacity remain available for every layer.

## Delivery formats

| Format | Precision and use |
| --- | --- |
| ProRes 4444 MOV | 10-bit color conversion with an alpha channel when Transparent output is enabled. Useful for cutout sculptures and overlays. |
| ProRes 422 HQ MOV | Opaque 10-bit delivery. The selected composition background is composited in linear light. |
| PNG sequence | 16-bit sRGB RGB/RGBA frames. Useful for lossless delivery and further processing. |
| Save PNG still | An 8-bit sRGB RGB/RGBA still at the export dialog's selected resolution and current preview position. |

Resolution options are 3840×2160, 2160×3840, 2160×2160, 1920×1080 and 960×540. Rates include 24, 25, 30, 50, 60, 30000/1001 and 60000/1001 FPS. The dialog shows the actual integer frame count and resulting duration. A rounded duration can differ slightly from the requested seconds at fractional rates.

Every movie/sequence frame is rendered directly at the requested dimensions. Preview resolution is independent. The pipeline retains ZIP-compressed half-float EXRs containing finished SDR, linear-sRGB, straight-alpha pixels. The encoder applies the output transfer function, matrix and range after that handoff. ProRes files carry Rec.709 metadata. This is an SDR pipeline; the EXR cache is a high-precision intermediate, not a scene-linear HDR delivery.

All instruments and modulation use an explicit periodic phase. A loop exports phases `0…(N−1)/N`; the duplicate endpoint is omitted. Visual identity is reproducible from the saved project and app version, with no accumulated simulation state. Visual pacing still depends on your chosen settings.

## Saving and recovery

Projects embed imported images and masks. Autosave writes are atomic, debounced during editing, and flushed before native close/quit, including a name still being typed. A failed close save offers to keep editing. One raw copy of the previous autosave is preserved per app session; the latest ten startup backups are retained in the application's `recovery` folder.

Export jobs retain an immutable project snapshot, frame checksums and high-precision masters. **Stop safely** retains completed frames. Recoverable jobs appear in Export after interruption or restart. Resume reconciles cached files and refuses to mix frames from a different renderer build. Keep the same app version to resume an unfinished job.

The default destination is `~/Documents/Form & Field Exports`. Each job has its own folder. A 4K frame cache can consume several gigabytes per loop; finished caches are retained deliberately. Remove a completed job's directory in Finder when its masters are no longer needed. Do not remove the cache of a job you intend to resume.

## Current limits

The first instruments focus on liquid/contour fields, folded forms, fractal families, graphic patterns and painted film, with curated presets including four Super 8 Paint looks. Four composition layers, PNG/JPEG imports, SDR output, and 1–60 second loops are supported in the interface. There is no projection warping, node graph, imported video, audio analysis, fluid simulation or unbounded temporal feedback in this version. Super 8 Paint reconstructs a bounded six-impression feedback trail. Still export uses 8-bit PNG; use the PNG sequence path for 16-bit output. Signing/notarization and broader hardware qualification remain release work.

The baseline machine is an Apple M5 Pro with 24 GB unified memory. Rendering complex 4K loops takes time and retains a disk cache. Performance measurements in `work/` are specific to this machine and test composition.

## Develop and verify

### Versions and automatic packaging

The footer shows the version and build, for example `v0.12.0 · build 4`. The build number is the commit count, so it rises with every commit. A `+` means the build includes uncommitted changes. Hover the label for the commit and build time. The same build number is stamped into the app bundle, under Get Info → Version. Raise the version in `package.json` for releases you want to name.

After every commit on `main`, a git hook (`.githooks/post-commit`) rebuilds `work/release/mac-arm64/Form & Field.app` in the background and sends a notification when it's done. If the app is open, the hook waits until you quit it. Progress and errors go to `work/auto-package.log`. To skip one commit, run `FORM_FIELD_NO_AUTOPACKAGE=1 git commit …`. A fresh clone needs `git config core.hooksPath .githooks` once.

```sh
npm ci
npm run dev
```

`node scripts/verify-smart-repeat.mjs` checks geometry at repeat joins, all ninety transformed presets, procedural view equivalence, finite 3D geometry, image repeat/sampler isolation and 4K output.

`node scripts/verify-quality.mjs` renders all 139 presets at multiple phases, stresses every family at slider extremes, checks randomized variants and compares the 20 signature reference images. It writes a review gallery to `work/quality-pass/gallery.html`. Only `--update-references` replaces the committed thumbnails. `node scripts/verify-randomizer-ui.mjs` checks all seventeen layer types, three variation amounts, locks, routes, undo/redo and the 20 signature cards through native persistence.

`npm run start` builds and opens the desktop app without a development server. `npm run build` runs TypeScript validation and produces the renderer. `npm test` runs core and native export tests with actual media tools. `node scripts/verify-graphics.mjs` checks the thirty-two graphic presets, looping, controls, transparency, 4K stills and native movie export; `node scripts/verify-graphics-ui.mjs` checks their integrated UI and persistence. `node scripts/verify-super8.mjs` checks all four film modes, every paint/projector control, frame holds, continuous transport, feedback history, exact loops, alpha, 4K output and resumed native exports. Set `SUPER8_CAPTURE_MOTION=1` to also capture a short ProRes projector preview. `node scripts/verify-super8-ui.mjs [app-path]` checks packaged projector controls, older project migration, save/open and native alpha output. `node scripts/verify-oil.mjs` checks Oil rendering, looping, alpha, mixed layers and 4K output in Electron. `node scripts/verify-ui.mjs` drives the built Electron application, including native persistence and a real transparent movie export; only file dialogs are replaced for repeatability.

`npm run package` builds an Apple Silicon `.app` under `work/release`. The local alpha is not notarized. Media-tool build instructions and notices are included with the bundled tools.

`node scripts/render-proof.cjs` performs the 4K, 300-frame proof using a frozen renderer bundle and the native export manager. Its artifacts, cache and progress live under `work/proof-4k`. Run with `PROOF_NEW=1` for a fresh job. Reuse requires a matching renderer fingerprint.

Source boundaries:

- `src/core/`: validated project schema, presets, seeded variation and deterministic timeline.
- `src/rendering/`: Three.js GPU rendering, compositing, EXR export and direct PNG encoding.
- `src/ui/`: React editor and native workflow orchestration.
- `electron/`: isolated preload bridge, document persistence, durable jobs, FFmpeg encoding and verification.

The preview and export renderer share the same implementation. Renderer and main process boundaries validate input separately. Export buffers are awaited frame by frame to bound memory. A browser-only preview can save PNGs/projects; reliable movie and sequence delivery uses the desktop application.
