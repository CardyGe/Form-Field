# Form & Field

A local visual instrument studio for Apple Silicon Macs. Create looping liquid fields, pearlescent 3D forms, fractal worlds and graphic patterns, composite up to four layers, and export full-resolution stage media. This is a working 0.17 alpha.

## What's new: Meridian (alpha)

- **Meridian (alpha):** a generative artwork and live instrument. Its default style, **Evolve**, is one calm, continuous structure of mostly white rings, arcs and spokes that slowly morphs through 15 forms and never resets. **Pulse** and **Dense** remain selectable. Treat it as alpha until feedback from its first party is in.
- **Play it:** 8 macros (Density, Tension, Chaos, Speed, Weight, Glitch, Heat, Scale), Evolution, Hold shape, moves on keys N, H, D, C, M, R and 1-8, seed slots, A/B morph, searchable lockable groups and 10 Evolve presets.
- **Music and Map:** the light follows audio bands and a smoothed beat, and the test beat is available. Meridian plays on mapped shapes, and moves work through Map links and MIDI learn.
- **Meridian Live:** reacts to people (orbit, constellation, merge, throw, conduct and more). The camera picture never reaches the output.
- **Wall flash limiter:** on by default whenever a show contains Meridian, and it covers other instruments on that wall. Turning it off needs confirmation. It is not a certified photosensitivity test.
- **Hardening:** a quality governor, recovery after graphics resets, an installation mode with autopilot, a text-only fault log, and a soak tool. See `docs/meridian-show-checklist.md` and `reports/Meridian soak.md`.
- **Not yet tested:** no real projector, camera, room lighting, DJ audio or MIDI hardware, and no 12-hour run on the show Mac. A crashed wall is not reopened automatically.

## What's new in 0.17

- **Map:** a new screen for projection mapping. Switch to **Map** in the header, draw shapes and drag their corners to fit the surfaces in the room, using a room photo, Snap, a test grid and Identify. The artwork shows on a projector while the controls stay on your screen, with Blackout.
- **Anything can play on a shape:** give each shape a Studio instrument, an image, a video or the Live picture.
- **Groups and scenes:** link shapes so they share one instrument, use **Make a grid** to spread one picture across many cells, and move between saved scenes by hand or with Auto-advance.
- **Wild options:** Stagger, Vary each, Palette shift, Border runs with Chase, and instruments driven by a shape's outline. Each is off until you turn it on.
- **Sound and MIDI:** Live and Map can follow sound bands, the beat and tempo, and MIDI controllers with learn.
- **New Live looks:** **Relief** turns the camera into a kinetic metal wall, and **Signal Melt** adds live pose echoes.
- **New in Studio:** the Ember Pulse Oscilloscope look, Copper Concertina in Kinetic Relief, and more projection-focused Fractals.
- **Graphics recovery:** if the graphics context is lost, the Studio preview now comes back by itself, including instruments that build up a picture over time.

## What's new in 0.16

- **Smoke:** a second Live look. People in front of the camera become figures made of smoke, in the palette's colours, shedding curling smoke as they move. Their camera picture never reaches the wall. See [Live](#live).
- **Finding people:** Live can now pick people out from the room, on this computer, with filters for things on the wall and objects that never move.
- **Show people:** an operator-only view of who Live has found.

## What's new in 0.15

- **Live:** a new screen that turns a camera into projected artwork as it happens. Switch between **Studio** and **Live** in the header. See [Live](#live).
- **Paint:** the first live look. Movement in front of the camera lays down opaque, bristly strokes of colour that slowly fade.
- **Projector output:** Live shows the artwork full screen on a chosen display while the controls stay on your screen, with Blackout and Clear.
- **Camera access:** the app now asks for the camera the first time Live is opened. Video is used on this computer only and is never saved or sent anywhere.

## What's new in 0.14

- **Four new instruments:** Texture Cuts, Feedback Glitch, Liquid Light and Oscilloscope, with 21 looks between them. The library now has 88 presets.
- **Print screen finish:** any layer except Graphic Patterns can be redrawn as halftone dots, a line screen or an ordered dither (Finish → Print screen), limited by tone or to its edges, with seven new finishes.
- **Glow finish:** any layer except Graphic Patterns and Oscilloscope can bloom its bright areas (Finish → Glow), with four new finishes: Soft Glow, Dream Haze, Hot Highlights and Glowing Trails.
- **Glitch for any feedback:** Glitch echo and the corruption controls from Feedback Glitch work in any layer's Feedback finish.
- **Files:** **New** (⌘N) starts a fresh composition and Undo brings the previous one back. **Save** (⌘S) writes to the file you last opened or saved; ⇧⌘S or Shift-click saves as a new file. The file name shows in the header.
- **Finer control:** double-click a slider or its label to reset it. Hold Shift while dragging a slider, or with the arrow keys, to move it a tenth as far.
- **Smoother playback with images:** imported images and image masks are no longer copied on every frame.

## What's new in 0.13

- **A smaller, stronger library:** 83 presets in saturated colour, down from 151. Six effects that never delivered their look were retired; older projects open without them.
- **Finishes for any layer:** Tunnel, Bloom Echo, Melt, Terraces, Block Shuffle and Ring Delay.
- **Staggered motion:** Surface, Graphic Patterns, Kinetic Relief and Living Ink move element by element, with pauses, instead of all at once.
- **Fractals that fly:** Zoom flight, Fly in for the Mandelbox, a seamless Julia dive, Outside colour, and a much faster preview.
- **New looks:** Oil Pour and Lacing layouts, Colour from below for painting effects with an imported image, Resonant Sand mode scores and plate fills, and turning flat-colour Sculptures.

## Start creating

Open **Form & Field.app**. The packaged application includes its rendering and encoding tools and works offline.

1. Start with the current surface, or choose a look in **Presets**. A preset replaces the selected instrument of the same kind. Selecting a different kind adds a layer when there is room.
2. Choose **Bands**, **Contours**, **Drips**, or **Fusion**, then explore its three **Variant** options. **Folded Sculpture** offers Shell, Bloom, Ribbon and Knot forms. **Fractals** offers Kaleidoscope, Julia Bloom, Mandelbox and Portal.
3. Select a layer in the composition list. The top row is the foreground. **Finish** contains blending, transforms and masks. Imported PNGs retain transparency; PNG/JPEG artwork is embedded in the project.
4. Click a wave button beside a parameter to animate it. **Motion** offers sine, pulse, smooth periodic noise and cyclic keyframes. Depth offsets the base value; the result stays inside the parameter's bounds. Keyframes drag vertically and interpolate smoothly through the loop boundary.
5. **Randomize effect** makes coherent variations of the selected effect. Choose Subtle, Balanced or Bold, or use the shuffle button beside any layer. **Keep** locks retain palette, structure, motion and material independently. The source seed stays fixed when structure or motion is locked; repeated clicks still produce fresh variations. Effect modes, quality, coverage, transforms, masks and authored animation routes stay intact. Imported images receive colour grading variations.
6. Set the duration, preview the loop, then open **Export**. Use a small draft to check a composition before committing to 4K.

Space plays/pauses outside text controls. Command-S saves a self-contained `.formfield` project; Command-O opens one. Header undo/redo buttons operate on composition edits. Command-Z in a text field keeps normal text editing behavior.

## Projection motion · 0.11

Open **Library → Presets → Projection motion** for five authored studies. **Living Ink → Pigment motion** offers the original prepared growth, a flowing pigment loop, and evolving chemistry with transported pigment. **Kinetic Relief → Relief construction → Hinged solids** uses real geometry, perspective and shared shadows. New layers use the upgraded treatments; existing saved looks keep their original settings.

The three projection instruments also have Organic motion, Flow direction, Travel and a Motion phrase: Steady travel, Gather and release, or Drift and settle. Controls follow the selected treatment. Evolving chemistry has an explicit 128/256/384 chemical resolution used by both preview and export. Its simulation clock is fixed and interpolated; transport and preparation controls rebuild deterministic state.

**Evolving chemistry loops.** Ink grows from its seeds through the loop. Over the last **Loop return** share of the loop (0.3 by default), a second copy of the simulation keeps growing past the end, and its state recedes back into the opening state in patches, so the last frame flows into the first. The two states are blended before the ink edges are cut, so the ink pulls back rather than cross-dissolving. Set Loop return to 0 for the original finite clip, which grows once, stops at its end and exports with **Render clip**. Evolving chemistry supports clips up to 60 seconds.

**Shape → Surface influence** adds an editable polygon or uses an imported image mask. Choose Flow around shape, Emit inside shape, or Trace shape edges. Evolving chemistry uses shapes during generation; other treatments use them for reveals. Drag polygon vertices or use arrow keys; add/remove vertices to describe a surface. Image masks can independently clip the final output with **Also clip output with mask**. Active obstacles stay solid while Influence blends the visible treatment.

Under **Motion → Animation range**, choose **Smooth between endpoints** to animate within explicit lower and upper values without clipping a symmetric offset. Endpoint routes and surface layouts save in document version 2. Version-1 projects remain readable and migrate neutral numeric settings; original artwork is preserved. Keep a copy for use with older application versions.

The [implementation and source register](docs/projection-media-0.11.md) documents references, engineering decisions, evidence and remaining physical projection checks. The [creative direction](docs/projection-media-direction-2026-11-10.md) retains the original staged plan. Reproduce the new software proof with `npm run test:projection`.

## Flat colour & outlines

Every layer has **Finish → Flat colour & outlines**. It replaces shading with hard bands of the layer palette and draws contour lines between them, for cartoon-style mapping work. **Colour bands** sets how many tone bands there are; the palette repeats beyond six. **Outline width** is measured in pixels of a 1080-line frame, so lines keep their proportions at 4K and with supersampling. **Outline colour** uses black or any palette swatch. Edges from the source are snapped to one side, so soft source edges never leave slivers of in-between colours. For the cleanest result, lower the source's Relief and Softness.

**Palette cycles per loop** rotates the bands through the palette in whole turns, so the loop still closes exactly. On smooth gradients the bands flow; on flat areas whole regions change colour at once, which can read as strobing.

**Library → Presets → Flat colour & outlines** has five looks: Neon Strata, Acid Drip, Pop Portal, Contour Pop and Pour Lace. Applying one turns on **Finish → Output → Exact colour**, which shows palette colours at their exact values instead of rolling off bright highlights. Leave Exact colour off for lit 3D and glowing sources.

## Glow

Finish → Glow makes the bright parts of a layer spill soft light around themselves, like projected light blooming on a wall. It's available for every layer except Graphic Patterns and Oscilloscope, which has its own bloom.

- **Glow amount** is the strength. At 0 the glow is off and costs nothing.
- **Glow threshold** is the brightness above which light glows. At 0 the whole layer glows; raise it so only the highlights do.
- **Glow size** goes from a tight halo to a wide haze. The width is a share of the frame, so a 4K export matches the preview.
- **Glow colour** keeps the layer's own colour at 0, or uses palette swatch 1–6.

The glow is taken after Feedback and Time displacement, so echoes and delayed slices glow too, and it never feeds back into the echo. Loops close exactly. It is added as light, so it brightens the layers underneath and keeps its soft edge in a transparent export; the layer mask cuts it. On a layer using Flat colour or Fractal contour colouring, the glow keeps the original shading colours unless Glow colour picks a swatch.

## Print screen

Finish → Print screen redraws a layer's tone as a printed screen. Every size is in pixels of a 1080-line frame, like the outline width, so a 4K or supersampled export has the same pattern as the preview. The screen is fixed to the frame: the layer moves under it. It is available for every layer except Graphic Patterns.

- **Screen:** *Screen type* picks Dots, Lines or Dither. *Screen size* is the dot or line pitch, or the size of one dither cell. *Screen angle* turns the screen. *Dot shape* is Round, Classic (dots that join into a checkerboard at mid tone, then become round holes), Diamond or Square. *Dither matrix* is 2×2, 4×4 or 8×8. *Screen travel per loop* slides the screen whole cells, so the loop still closes.
- **Tone:** below *Tone floor* nothing prints; above *Tone ceiling* marks reach *Largest mark*, the most of a cell any mark covers. At its default of 0.8 even full-bright colours print as dots with the background between them; at 1 they print solid. *Dot gain* fattens or thins every mark. *Mark softness* blurs mark edges. *Invert* makes dark areas the big marks, like ink on paper.
- **Colour:** *Layer colour* keeps the layer's colour, brightening each mark towards the layer's overall brightness without ever passing full value. *Palette ink* uses one swatch. *RGB light* adds three primary screens; *CMYK ink* overprints four ink screens at their classic angles. *Paper* fills the gaps with a palette swatch instead of leaving them transparent.
- **Where it prints:** *Print area* is Everywhere, Edges only or Away from edges, so the screen can follow a layer's outline and inner creases while the rest stays smooth. *Edge width*, *Edge sensitivity* and *Edge feather* set how wide the band is, how faint an edge counts and how soft its boundary is.

Every mark edge is worked out exactly and filtered to one output pixel; a screen finer than about two pixels turns into its plain tone instead of shimmering. The screen runs after Flat colour and before grading. Glow is added afterwards from the unscreened layer, so it stays soft over the dots, and the screen never enters the Feedback echo. Finishes: Halftone, Fine Halftone, Engraving, Comic Process, RGB Raster, Bitmap Dither and Halftone Edges.

## Time displacement

Finish → Time displacement makes parts of the frame show the layer as it was some frames ago. This is the slit-scan look: stepped terraces, tears and block-shuffled time. It's available for every layer except Graphic Patterns and Ink *Evolving*.

- **Delay map** picks which parts lag: rows, columns, rings, a diagonal or random blocks.
- **Time shift** sets how far back the map reaches, as a share of **Time span** (in frames). Negative values flip the map.
- **Time slices** sets how many moments are sampled. **Slice blend** goes from hard steps (0) to a continuous smear (1).
- **Map scroll** sweeps the map across the frame a whole number of times per loop.

Each slice is the looping source rendered again at an earlier moment, so no history is stored. The loop closes exactly, needs no warm-up and can be exported in any order. Each slice costs one extra render of the source, so 12 slices render about 12 times slower than the plain layer. Time displacement runs before Feedback and Flat colour, so both apply to the stitched result. It needs a source that moves: raise the source's Cycles per loop if the steps barely show. Three looks live under Library → Presets → Time displacement.

## Feedback

Any layer except Graphic Patterns and Ink *Evolving* can feed back into itself (Finish → Feedback). Each frame keeps a faded echo of the last one, zoomed, turned, moved and hue-shifted, and the new source is drawn with it. Flat colour and outlines then apply to the result, so echoes are re-banded into flat poster colour.

- **Echo blend:** *Mix* blends the echoes across the whole source. *Behind source* shows them only through transparent areas and frames. *Brighter* keeps whichever is brighter, for glowing trails.
- **Source frame** cuts a centred hole so the source becomes a border. With Echo zoom below 1, the borders nest inward into a tunnel.
- **Source window** keeps only the centre of the source. With Echo zoom above 1, the echoes stream outward around it.
- **Echo melt** pushes each echo along its own brightness slopes, so the trails smear.

- **Glitch echo:** *Vanishing point* moves where the echoes zoom to, and the frame or window with it. *Echo tilt* steps every echo sideways in perspective, like a staircase. *Echo lens* bends each echo so nested frames round off. *Frame rounding*, *Frame squareness* and *Frame edge* shape the frame or window; Frame edge draws a dark rule every frame so the echoes stack as steps. *Echo streaks* tear the outer echoes into lines, radially or straight to the nearest side. *Echo blocks* break echoes into jittering macroblocks and read them as hard pixels. *Channel slip* and *Colour crush* split and collapse colour, so older echoes turn into saturated glitch. The **Glitch Tunnel** finish applies all of this to any layer.

Motion values apply per frame. Loops close exactly, because the fading means the process forgets its start. Each export first warms up for up to about 270 frames, until the oldest frame's contribution falls below half-float precision, and then renders the loop in order. At 4K this adds a few seconds per export. In the preview, playback is exact. After a seek or an edit, the preview warms up for only 60 frames and settles as it plays. Three looks live under Library → Presets → Feedback.

## Texture Cuts

A source that hard-cuts between unrelated textures: rock, gravel, 1-bit pixel fields, broken diagonal stripes, zig-zags and coloured blocks. *Cuts per loop* sets the pace, and the sequence repeats exactly every loop. *Texture set* keeps all six, the natural pair, or the four digital ones. Motion amount pans each texture during its cut; at 0 the first texture holds. As an overlay (Field background 0), stone opens up at its cracks and zig-zags drop their second colour.

Three looks feed Texture Cuts through the glitch echo into a tunnel: **Cut Tunnel** (square-on, streaking and crunching), **Square Descent** (a square window bent through a strong lens) and **Stair Fall** (tilted to one side, with radial streaks).

## Feedback Glitch

A feedback instrument: a box of fresh pictures is stamped into the middle of the frame, and every frame the previous picture is zoomed outward around it and corrupted, so old pictures become the glitching rings of a tunnel. Echoes keep full brightness until they leave the frame (raise *Fade* to let them sink), and the loop still closes exactly, because everything zooms out of the frame within a few seconds.

- **Picture:** concrete, stripes, sawtooth and static by default; *1* shuffles all ten, including the Texture Cuts textures; *2–11* hold one. *Picture changes per loop* sets how often it changes. *Box size*, *Box rounding*, *Static rim* and *Dark rule* shape the box and the steps it leaves.
- **Tunnel:** *Tunnel speed*, *Wobble*, *Tilt*, *Lens* and *Vanishing point*.
- **Corruption:** *Glitch events* (cells tear, posterise and swap channels), *RGB split*, *Colour drift*, *Contrast push*, *Pixel size*, *Hue shift*, *Colour crush*, *Block breakup*, *Streaks* and *Melt*.

Five looks: Feedback Glitch, Neon Collapse, Glitch Staircase, Static Bloom and Melted Signal. The same corruption is available to any layer in the Feedback finish: *Hold brightness*, *Glitch events*, *Colour drift*, *Contrast push* and *Echo pixel size*.

## Live

Live turns a camera into projected artwork as it happens. It is a separate screen: switch between **Studio** and **Live** in the header. Nothing in Live is exported or recorded, and camera video never leaves the computer.

**Setting up**

1. Put the camera at the wall you are projecting on, facing out at the people. Keep the projected picture out of the camera's view, or the artwork reacts to itself.
2. Open **Live**. The first time, macOS asks for camera access. If it was refused, allow Form & Field in System Settings › Privacy & Security › Camera and reopen the app.
3. Choose the camera under **Source**. **Test pattern** gives moving shapes to try a look without a camera, and **Use a video file** plays a clip in the preview.
4. Tick **Show tracking** to see the camera with the movement it has found drawn over it. Use the four **Area** sliders to leave out screens, curtains and bystanders. Raise **Camera noise floor** if a still room lights up; raise **Sensitivity** if gestures barely register. This view only ever appears on your screen.
5. Choose the projector under **Display** and press **Open output**. The artwork fills that display. **Esc** closes it.

**Blackout** makes the output black at once while everything keeps running. **Clear** wipes the artwork.

**Paint** is the first look. Moving lays down opaque, bristly strokes of colour; standing still lets them fade. Movement response sets how readily paint appears, Stroke length and Spread shape each throw, Bristle goes from broad strokes to fine hairs, Fade time is how long paint lasts, and Colour change is how quickly the colour moves through the palette.

**Smoke** is the second look. Choose it under **Look**. People are made of smoke: their shape fills with churning smoke in the palette's colours, and moving tears smoke off them. Their camera picture never appears on the wall.

- **Start from** sets every smoke control at once:
  - *Wispy*: a faint figure streaming long trails upward.
  - *Smouldering*: a clear smoky figure steadily giving off smoke.
  - *Solid*: a thick figure that barely sheds, with heavy smoke hanging where they moved.
- **Density** runs from a faint figure to a thick one.
- **Emit** is how much new smoke comes off people, moving or still. At 0 they add none and only push the smoke that is already there.
- **Smoulder** is how much smoke streams off a still figure.
- **Movement response** is how hard people push the smoke. **Rise** and **Smoke life** shape it.
- **Calm ↔ Wild** sets how the smoke moves: at Calm it flows in smooth ribbons and movement throws it gently; at Wild it breaks into curls. The middle is how Smoke always behaved.
- **Vividness** keeps colours bright where smoke mixes, instead of fading towards grey.
- **Forever**, under Smoke life, keeps smoke from ever fading and keeps it inside the picture. Fill the room with Emit up, turn Emit down, then move through it and swirl it around. **Clear** empties it.
- **Colour change** and **Palette** set its colours. Smoke keeps its own palette, separate from Paint's.

With Smoke chosen, Setup gains a **Finding people** section:
- **Show people** marks who Live has found: blue for a person, pink for their outline. It appears on your screen only.
- **Ignore still objects** stops anything that has not moved for that long from counting as a person, such as a poster or a coat. People standing still still sway enough to stay in. Tick **Count still objects too** to turn this off.
- **Use empty room**, with **Capture empty room**, only counts what differs from a picture of the room with nobody in it. It needs a fixed camera and steady light. Capture again after opening or closing the output.
- A status line says whether people finding is running, behind, or has failed. If it fails, Smoke keeps reacting to movement on its own.

People are found on this computer by Google's MediaPipe Multiclass model, which ships with the app. Nothing is downloaded, recorded or sent anywhere.

**Limits to know**

- People are not picked out from the room: anything that moves paints. The Area sliders and camera placement are the remedy.
- A webcam needs light on the people. A dark room gives noisy tracking.
- Mirror is on by default, which is right for a camera facing the people.
- While the output is open the camera belongs to it, so Show tracking is unavailable until you close the output.
- Video files play in the preview only. Use a camera or the test pattern to drive the output.
- The person-finding model is built for people fairly near the camera. Crowds at a distance are untested.
- Measured performance is in `docs/live-performance-2026-11.md`. It has not yet been measured with a real camera and projector.

## Projection delivery

**Export → Delivery format** offers mastering formats (ProRes 4444, ProRes 422 HQ, 16-bit PNG sequence) and projection playback formats: **HAP Q** (best quality), **HAP** (smallest) and **HAP Alpha** (transparent). HAP is decoded on the GPU by MadMapper, Resolume, Millumin and TouchDesigner, so 4K loops scrub and play smoothly. HAP needs dimensions that are multiples of 4; 4K frames are written in 8 chunks for parallel decoding. Projector sizes include DCI 4K, 4K WUXGA and WUXGA.

**Anti-aliasing** renders the whole composition at 2× or 3× the delivery size and filters it down with a Mitchell filter, removing edge shimmer and moiré from fine lines. 2× takes roughly 2.5× as long per 4K frame. 3× is limited to 8192 pixels per side, so it suits HD and smaller deliveries. Fine film grain is softened slightly by the filter.

**Loop seam check** runs after every export. It compares the six frames either side of the loop point and reports when the step from the last frame back to the first is larger than any nearby step (a pop) or when the motion changes speed there (a hitch). A seam is reported in the export panel but never stops delivery. To check the whole library, run `env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/seam-audit.cjs`, optionally followed by preset ids. Results go to `work/seam-audit/results.json`.

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

The four material instruments expose **Advanced shape**, **Advanced motion** and **Advanced material** sections. Field stretch, Domain warp, Warp scale, Field twist and Motion phase are shared. Warp scale needs a nonzero Domain warp. Lit materials add Light elevation, Fill light, Directional sheen, Sheen direction and Clear coat; Sheen direction takes effect when Directional sheen is enabled. The new directional highlight is also available on Surface and Oil Slides.

Family-specific controls add ink seed coverage, development and edge pigment; staggered rounded shutters; and circular and harmonic nodal figures. Ink preparation controls are not animation targets. Their cache keys include every preparation setting.

Each new instrument has a fourth exploration look that demonstrates these controls. Neutral migration defaults preserve existing artwork.

Volume Banding suppression uses deterministic sampling dither; High quality reduces the resulting sampling texture. Directional highlights are filtered against rapid normal changes to reduce sparkle. All render and grading changes use the shared compositor and native output pipeline. The detailed audit and research are in [the professional effect audit](docs/professional-effect-audit-0.10.md).

## Per-element timing

Surface, Graphic Patterns and Kinetic Relief have three Motion controls that stop a layer moving in unison:

- **Delay spread** makes each element (band, ring, drip, tile, glyph, path or panel) run behind the first by up to one whole cycle. 0 moves everything together.
- **Delay from** chooses where the motion starts: the left side, the centre, or the top-left corner.
- **Pause** makes each element hold still for part of every cycle, then move.

Delays are fixed in time and the pause maps each cycle onto itself, so loops still close exactly. At 0 the layer renders exactly as before. With Pause on, Surface drips run down from above the frame, swell at their own depth and drain away before the next one starts.

Kinetic Relief also has **Panel sizes**, which mixes large, medium and small panels in the solid relief instead of one uniform grid.

## Fractal flight

**Zoom flight** flies continuously into the pattern. Julia sets dive toward a repeating point of the set (a repelling period-2 cycle), where the set repeats exactly at a smaller scale. Each loop goes deep enough to land on the start's own copy, so there is no crossfade and the frame stays full of detail. If that cycle is too weak to zoom, and on Kaleidoscopes, the next zoom step fades in over the last fifth of the loop instead. **Outside colour** (Julia) fills the space beyond the set with dim colour bands instead of black. To keep playback smooth, the live preview draws fractals with one sample per pixel and traces the Mandelbox at half resolution; exports always use the full Render quality at every pixel. **Fly in** (Mandelbox) moves the camera inside the box toward its folded core and turns it once per loop. Both are 0 by default. The 2D presets now fill the frame and fly; the Mandelbox presets are viewed from inside.

## Living Ink

Loop ink travels one pattern period per loop. Delay spread, Delay from and Pause make that travel arrive in gentle pulses across the frame. Evolving ink has **Colour by age**, which colours new growth differently from old; Ink Estuary uses it with flat colour and keeps its ink between about 30% and 65% of the frame.

## Oil layouts and colour from an image

Oil Slides has a **Layout** control. *Slide* is the original pools pressed by a moving glass. *Pour* fills the frame with one paint mass and laced cells that swell and close in their own time. *Lacing* runs ribbons edge to edge, laced inside with dark threads. **Glass dome** shows or hides the dome; at 0 only the paint remains. Acrylic Pour and Lace Ribbons use the new layouts, and Cobalt Tide is a Pour under the glass.

Any layer can use the **Colour from below** blending mode. The layer keeps its shapes and its light and dark, and takes its colour from the layers under it. To use a paint scan or photograph, import it as an image layer, put the effect above it and set the effect's Blending to Colour from below.

## Resonant Sand and Sculpture

Resonant Sand has a **Mode score**: the plate holds one figure, then the sand snaps into the next mode, stepping through up to three changes and back to the first each loop. **Snap speed** sets how fast the sand reorganises, and **Plate fill** colours the plate between the sand lines with two palette colours.

Sculpture has **Turns per loop**, which turns the form whole times each loop on a tilted axis so its silhouette keeps changing. All Sculpture presets are now framed close, in flat colour with outlines.

## Preset library

The library has 88 presets, including the looks for Texture Cuts, Feedback Glitch, Liquid Light and Oscilloscope. After 0.13, Velvet Currents was retired and 14 more presets were removed: four Oil slides that repeated one composition in different colours, two Living Ink mazes, seven weak or duplicated Graphic Patterns and the Deep Bloom portal. New Graphic layers now start from Lava Columns. In 0.13 the library was cut from 151 to remove near-identical looks, pastel looks that do not read on a projection wall, and the 20-look signature collection (each was a recolour of another preset). Kept presets use saturated palettes on a dark ground; Kinetic Relief and Resonant Sand start in flat colour with outlines.

**Presets → Finishes for any layer** holds eleven finishes: Tunnel, Bloom Echo, Glitch Tunnel and Melt (feedback), Terraces, Block Shuffle and Ring Delay (time displacement), Soft Glow, Dream Haze and Hot Highlights (glow), and Glowing Trails (feedback with glow). A finish applies to the selected layer of any kind except Graphic Patterns and Ink *Evolving*, and replaces any finish already on it; the four glow finishes are not offered on Oscilloscope. **No finish** turns all three off. Recursion Tunnel and Time Terraces remain as Surface presets that show a finish on a source.

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

Three projection instruments (Living Ink, Kinetic Relief, Resonant Sand) share the existing rendering loop, layer compositor, masks, palette grading, smart randomizer and native output pipeline. The library includes original looks for each instrument plus five projection motion studies across Ink and Relief.

Caustic Atlas, Magnetic Skin, Holographic Loom, Crystal Reef, Prism Cathedral and Volumetric Veils were retired in 0.13 because none of them looked like what its name promised. Opening an older project drops layers of those kinds; a project that only used them reports that its effects were retired. Velvet Currents was retired after 0.13 for the same reason: even at 16,000 strands it read as sparse, dim lines around an empty centre. Its layers are dropped the same way.

| Instrument | Material and controls |
| --- | --- |
| Living Ink | A seeded Gray–Scott reaction-diffusion pattern, four growth families, branching, pigment coverage, flow distortion and embossed relief. |
| Kinetic Relief | Bevelled hinged shutters, three hinge directions, travelling opening waves and material shading. |
| Resonant Sand | Chladni-inspired standing-wave figures, mixed modes, nodal width, grain and membrane relief. |

**Pattern scale** reveals more of the original continuous fields. Layer transforms evaluate those sources across the full view; scaling never repeats a rectangular screenshot. Evolving Ink instead uses a finite simulation domain with a soft edge, which can become visible when zooming out. Set **Field background** to zero for transparent gaps, then enable transparent output when exporting. The original ten treatments use periodic motion and integer Cycles per loop; evolving chemistry uses a finite clip clock. Motion amount zero stops intrinsic animation. Artist-authored Motion routes remain independent.

Living Ink’s **Prepared growth** treatment prepares its deterministic 384 × 384 chemical texture when its seed, Growth family or Branching changes. Those controls do not run during playback; Branching cannot receive an animation route. Four prepared textures are cached. Flow, pigment, relief, colour and transforms remain live. That treatment’s moving appearance is a periodic deformation of the prepared pattern. **Evolving chemistry** instead advances the chemical and pigment state as described in the 0.11 section above. This keeps seeks and resumed exports reproducible.

Kinetic Relief uses a shaded height field. It is an artistic material instrument rather than physical simulations or editable 3D meshes.

The shared optical helpers also improve existing instruments: **Surface → Optical sheen** adds a thin-film finish, while **Oil Slides → Caustic light** and **Optical sheen** add focused illumination and spectral material colour. These controls default to zero in older projects, preserving their appearance. Fine lines in the new instruments use filtering based on the target pixel footprint; Living Ink uses mipmapped chemical textures.

`node scripts/verify-instruments.mjs` checks every look, every control, transparency, loop closure, seek reproducibility and transformed portrait/square/landscape coverage. `node scripts/verify-instruments-ui.mjs` exercises their editor controls and native PNG/ProRes exports in an isolated profile. Neither changes the working composition.

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

## Liquid Light controls

**Liquid Light** is oil droplets in dye on an overhead projector: packed cells of every size whose colour follows their thickness, from the rim colour through to the hot colour. Three dishes are stacked: a soft far layer, the sharp main layer, and flat floaters on top. Looks: **Ember Cells**, **Blue Hour**, **Ring Dish**, **Clock Glass**, **Magenta Marble** and **Molten Bloom**.

- **Cell size**, **Size range** and **Density** set the layout. Size range and Density rebuild the layout, so they cannot be animated.
- **Crowding** swells droplets into each other; the smaller one bends around the larger. **Rings** dishes some droplets into a bright ring around a dark centre. **Floaters** adds flat discs of the hot colour.
- **Drift**, **Flow**, **Breathing** and **Swell** move the cells. Each droplet breathes and swells in its own time, and the loop closes exactly.
- **Thickness** pushes cells from red towards yellow; **Rim shade** darkens the edge of each cell and **Rim light** adds a thin bright line inside it.
- **Far layer** and **Far blur** set the strength and focus of the dish behind. **Refraction** lets thin droplets act as lenses over it.
- **Merge** joins the larger droplets, in patches, into scalloped blobs; small droplets stay separate along the edges. It works best at high Density, where droplets sit close enough to join.
- **Press** is a glass dome that magnifies the droplets under it and pushes them towards the hot colour. **Press size**, **Press horizontal** and **Press vertical** place it; **Press pulse** eases it off and back once per loop.
- **Wash** marbles the ground with bands of the ground colour, the wash colour and a blend of wash and body, with **Vein width** setting the dark line where bands meet.
- **Soft focus**, **Colour fringe**, **Vignette** and **Grain** are the projector: slightly soft edges whose focus drifts over the loop, warm and violet rims towards the sides of the frame, a lamp that falls off in the corners, and still dust on the glass.
- With **Press** above zero, dragging on the canvas moves the dome.
- **Ground opacity** at 0 leaves the gaps transparent for layering (the wash goes with it).
- Palette order: rim, body, mid, hot, wash, ground.

Check it with `node scripts/verify-liquid.mjs` (add `--quick` for stills only).

## Oscilloscope controls

**Ember Pulse** is an Oscilloscope look with a hollow filament bloom, outward-travelling rings and rolling smoke. Find Ember Pulse, Glacier Vapour, Orchid Static, Acid Plume and Silver Ash in Studio's Looks or Map's look browser. The Colour scheme menu changes the palette independently of the effect settings.

Smoke controls the amount of vapour. Use Smoke curl and Smoke lift for its movement, Smoke spread and Smoke persistence for its reach and wake, and Smoke thickness, Smoke detail and Smoke lighting for its appearance. Use **Smoke audio input** in Studio or **Sound & MIDI** in Map. Detected kicks emit new plumes, sustained bass gives them body, and highs brighten fine wisps. Smoke audio response sets how much they react. Exports use the repeating authored smoke phrase. For a four-bar loop, set Phrases per loop to four in Studio and Loop with the tempo to 16 beats in Map.

**Oscilloscope** draws one glowing line the way an oscilloscope does in X-Y mode: the beam is steered by three oscillators, one each for across, up and depth. The figure is not an object that turns. It moves because the oscillators slip against each other, so it folds, opens and collapses. The core burns to white, the halo keeps the line colour, and parts the beam crosses slowly are brighter. Looks: **Twin Orbit**, **Atom**, **Ember Ring**, **Cyan Tangle**, **Signal Burst** and **Morse Weave**.

- **Figure** picks the frequency ratio of the oscillators (Ellipse 1:1, Eight 1:2, Pretzel 3:2, Trefoil 1:3, Knot 3:4, Weave 5:3, Star 5:4, Tangle 7:5). Simple ratios are calm; larger ones are dense. **Overtones** bends the oscillators away from a pure sine for lopsided, less regular figures.
- **Phase drift** is the main motion: whole turns the oscillators slip against each other per cycle. At 0 the figure holds still.
- **Size** and **Lean** place the figure; **Ring** draws a circle around it, like the rim of the tube.
- **Tumble forward** and **Tumble sideways** turn the whole figure in whole turns per cycle. Both are 0 by default, for a flat screen. **Float** rocks it gently so it is never seen dead flat.
- **Morph** blends the figure into the **Second figure** and back once per cycle; **Morph hold** is the share of the cycle spent resting on each.
- **Sway** is a slow, wide undulation of the whole line.
- **Signal** adds a fast, uneven ripple on top of the oscillators, like sound, fed to the three axes a little apart in time. **Signal pitch** sets roughly how many ripples fit along the line. **Signal bursts** gathers it into patches that travel, swell and fade.
- **Dashes** breaks the line into bright dashes with dim gaps; **Dash count**, **Dash length** and **Dash travel** (whole trips round the line per cycle) shape them.
- **Afterglow** leaves a fading smear where the line was a moment ago.
- **Beam width**, **Intensity** and **Halo** shape the line. **Depth fade** dims and thins the parts of the line that are further away.
- **Bloom** is the wide soft glow and **Bloom size** moves it from tight to wide. It is measured in fixed lines of frame height, so it looks the same in the preview and in a 4K export.
- **Colour fringe** splits red and blue apart towards the edge of the ring. **Colour travel** sends the second line colour round the line once per cycle.
- Palette order: line, halo, bloom, hot core, second line. The sixth swatch is unused.

Check it with `node scripts/verify-scope.mjs` (add `--quick` for stills only).

## Oil Slides controls

**Oil Slides** recreates sliding coloured paint, black cellular ink and a glossy refractive dome. Choose **Acid Slide**, **Cobalt Tide**, **Acrylic Pour** or **Lace Ribbons** in Presets. It occupies one composition layer.

**Pool size**, **Paint coverage**, **Cell size** and **Lens size** shape the material. **Slide travel**, **Relative rotation**, **Drag** and **Cycles per loop** control relative movement. **Thickness**, **Refraction**, **Wetness** and **Ink amount** shape its finish. **Show fine tuning** reveals Lens stretch, Organic shape, Lens depth, Cell complexity, Color separation, Lens lift, Filaments, Edge softness, Light angle, Shadow strength and Grain. At zero travel, rotation and lift the instrument stops unless Motion routes animate a parameter.

**How the ink forms.** Paint pressed under glass and pulled apart breaks into fingers (a lifted Hele-Shaw cell). Oil grows the same shapes with Gray-Scott reaction-diffusion: even-width mazes, foam cells with thin paint walls, and stripes that line up with a stretch. They are grown once per seed on the GPU into a 512² tile that wraps on all sides (about 0.4 s, cached for up to four seeds), so frames only read the finished tile and loops stay exact. Where the glass has pressed, the pattern shows. While it slides, the ink turns into threads along the direction it was moving. Just outside the glass, fingers point outward. The ink thickens toward the centre of the footprint and is always solid, with a crisp edge. **Cell complexity** chooses between foam cells (low) and maze (high) region by region. **Cell size** scales the whole pattern, and **Ink amount** thickens or thins every line. Paint and glass cast a hard, offset shadow in the Shadow tint onto a paper-textured substrate, and loose clusters of spattered drops dot the paint.

The six palette roles are Paint, Secondary paint, Ink, Substrate, Shadow tint and Rim tint. **Substrate** selects a coloured support or a transparent cutout. The glass bends this instrument's own paint; RGBA exports retain tint and reflections, but cannot bend an arbitrary background added later. Existing layer opacity, blending, masks and transforms apply to the whole instrument.

**Render quality** selects Draft (reduced material-field resolution), Standard or High (extra lens sampling). Preview and export share this setting. Saved seeds and periodic paths reconstruct the wake at any timeline position, including animated path controls. Scrubbing and resumed exports need no simulation warm-up. Organic shape gently deforms the glass with the slide, Color separation adds subtle refractive color fringes. Longer connected wakes and direction-following filaments stay attached to the paint. The renderer skips lens calculations outside its silhouette and paint calculations outside coverage. Older Oil projects receive defaults only for the four absent refinement controls. This is a procedural approximation of the analogue appearance, without irreversible fluid mixing.

## Seamless scaling and repetition

Pattern size changes the pattern within the full canvas. Packed tiles are packed across their repeat boundaries, and circuit paths can continue from one edge to the opposite edge. Wrapping a tile preserves its complete outline and animation. Fractional pillar waves, palette and travelling morph phases close over the repeat. Solid rectangular tiles at zero spacing share full sample coverage, so they do not leave an artificial dark grid.

Circle blooms and spirals extend around one centre. Radial Circuit keeps one central ring cutout. They do not become a rectangular grid of copied frames.

Surface, Fractal, Oil and Super 8 layers evaluate their procedural coordinates across the actual scaled/rotated view. Zooming out reveals more of the field instead of shrinking a cropped render into a box. Sculpture transforms operate on the projected geometry before clipping, revealing the complete object when scaled down. Imported images with Repeat above 1 use a wrapping, filtered sampler across the view; Repeat 1 retains the artwork's finite bounds and contain/cover fit. Imported artwork intended to be seamless should have matching edges.

Masks, opacity, blending, grading, shared Motion routes and optional Super 8 gate framing still apply. Preview, PNG stills and sequence/movie exports share these rendering rules.

## Super 8 Paint controls

Add **Super 8 Paint** from Instruments, or choose **Chromatic Staircase**, **Paint Destruction**, **Scratched Negative**, **Cut-out Collage** or **Painted Tunnel** in Presets. These modes share one layer and retain their controls when switched. Staircase creates terraced color plates; Destruction erodes broad brush swathes; Negative inverts stepped pigment over dark film; Collage overlaps torn painted fragments; Tunnel sends nested painted arches and a path of stepping stones rushing outward, mirrored about the horizon.

**Rolling shutter** works with every mode. The frame is split into horizontal **Shutter bands** that are exposed one after another, so each band shows the paint a little later than the last and moving shapes break into stepped terraces and pyramids. **Shutter from centre** rolls the exposure top to bottom at 0 and out from the centre line at 1. **Band smear** holds each band close to a single scan line, giving horizontal streaks, and it also slips some bands sideways and tears pale lines along a few band edges. The delay is a fixed offset in loop time, so loops stay exact. Both controls default to 0, so older projects look unchanged. In Painted Tunnel, Geometry steps sets the ring spacing, Paint coverage sets the paper gap between rings, and Motion amount sets how many rings pass per cycle.

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

Fractals has four families, each with three variants, plus Palette, Duotone and Contours colouring. Open **Library → Presets → Fractals for projection** for six looks arranged around unfolding petals, travelling contours, vaults, bead tunnels, mosaics and light echoes. The inspector shows the controls used by the selected family. Switching family retains your settings.

- **Kaleidoscope** offers **Lace**, **Petals** and **Weave**: recursive rings, elliptical petal bodies and intersecting ribbons. **Fold**, **Symmetry**, **Twist**, **Detail** and **Line width** shape the pattern. Thin strokes integrate their coverage at the pixel limit.
- **Julia Bloom** offers a genuine quadratic **Classic** set, a mirrored **Radial** arrangement and a smoothly warped **Spiral**. **Julia real** and **Julia imaginary** choose the complex constant, with five decimal places for fine adjustment. Small changes can transform the whole set. **Orbit detail**, **Fold**, **Line width** and **Color density** shape its ornament and colouring. Start with small Morph values to retain intricate filaments throughout a loop.
- **Mandelbox** offers **Architecture**, **Sphere Fold** and **Lattice**, with cubic, stronger spherical and elongated fold structures. **Box scale** and **Fold radius** change the fractal itself; **Fold** changes the folding volume and **Detail** changes recursion. **Radial fold** is an optional mirrored arrangement. **Roughness**, **Light angle**, **Relief** and **Exposure** shape the shaded material, including shadows and ambient occlusion. Space around it is transparent when the composition uses transparent output.
- **Portal** offers **Beaded Tunnel**, **Mosaic Spiral** and **Light Halo**. **Depth** and **Bank** shape the view. Set **Travel mode** to **Manual** to hold or scrub a pose with **Travel position**. **Loop** follows the project duration and uses **Travel position** as a phase offset. **Afterglow** controls the Halo’s staggered copies.

Use **Focal point X/Y** to place the centre of the effect. With Portal selected, dragging on the canvas moves that point directly. **Dark-space cutout** clears the gaps for layering or transparent export. **Reveal** stages Kaleidoscope and Julia Bloom, and shapes the pacing of the Portal variants. **Camera passage** on Mandelbox holds a wide view, approaches the folded surface, then pulls back.

**Coloring** selects the original **Palette** treatment, **Duotone** using the first and last palette colours, or **Contours** with stepped colours and fine contour lines. The new treatments retain the source lighting and fine detail. **Coloring amount** blends back to the original treatment and can be animated. **Contour colors** changes the number of steps. **Finish → Color finish** has Exposure, Saturation and Hue shift.

**Render quality** chooses Draft, Standard or High export sampling. High gives the cleanest fine edges and takes longer. Preview uses lighter sampling. **Randomize effect** preserves the quality choice. **Scale**, **Orbit**, **Elevation** and **Framing** change the view.

**Evolution** animates the fractal’s geometry on all four families. New layers and re-applied presets start with it enabled. Existing projects can raise **Evolution** to adopt the new motion. In Portal and Mandelbox, **Bank** sets a fixed tilt while Evolution is active.

**Morph** periodically changes structure. **Travel** adds a pan, orbit or dolly and returns to its starting position. Continuous controls can be animated through the shared Motion routes. Family, variant, quality, radial fold, symmetry and intrinsic cycle settings remain discrete. **Color drift** offsets the cyclic palette. **Color density**, **Relief**, **Glow**, **Contrast** and **Exposure** shape the finish.

These are finite fractal renderers designed for controllable loops. They do not provide unlimited numerical zoom or an endless forward flight. Saved settings and the app version determine the image, with no accumulated simulation state unless a Feedback finish is applied.

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

The first instruments focus on liquid/contour fields, folded forms, fractal families, graphic patterns and painted film, with curated presets including five Super 8 Paint looks. Four composition layers, PNG/JPEG imports, SDR output, and 1–60 second loops are supported in the interface. There is no projection warping, node graph, imported video, audio analysis or fluid simulation in this version. Super 8 Paint reconstructs a bounded six-impression feedback trail. Still export uses 8-bit PNG; use the PNG sequence path for 16-bit output. Signing/notarization and broader hardware qualification remain release work.

The baseline machine is an Apple M5 Pro with 24 GB unified memory. Rendering complex 4K loops takes time and retains a disk cache. Performance measurements in `work/` are specific to this machine and test composition.

## Develop and verify

### Versions and automatic packaging

The footer shows the version and build, for example `v0.13.0 · build 4`. The build number is the commit count, so it rises with every commit. A `+` means the build includes uncommitted changes. Hover the label for the commit and build time. The same build number is stamped into the app bundle, under Get Info → Version. Raise the version in `package.json` for releases you want to name.

After every commit on `main`, a git hook (`.githooks/post-commit`) rebuilds `work/release/mac-arm64/Form & Field.app` in the background and sends a notification when it's done. If the app is open, the hook waits until you quit it. Progress and errors go to `work/auto-package.log`. To skip one commit, run `FORM_FIELD_NO_AUTOPACKAGE=1 git commit …`. A fresh clone needs `git config core.hooksPath .githooks` once.

```sh
npm ci
npm run dev
```

`node scripts/verify-smart-repeat.mjs` checks geometry at repeat joins, every preset under transforms, procedural view equivalence, finite 3D geometry, image repeat/sampler isolation and 4K output.

`node scripts/verify-quality.mjs` renders every preset at multiple phases, stresses every family at slider extremes and checks randomized variants. It writes a review gallery to `work/quality-pass/gallery.html`. `node scripts/verify-randomizer-ui.mjs` checks all ten layer types, three variation amounts, locks, routes and undo/redo through native persistence.

`npm run start` builds and opens the desktop app without a development server. `npm run build` runs TypeScript validation and produces the renderer. `npm test` runs core and native export tests with actual media tools. `node scripts/verify-graphics.mjs` checks the graphic presets, looping, controls, transparency, 4K stills and native movie export; `node scripts/verify-graphics-ui.mjs` checks their integrated UI and persistence. `node scripts/verify-super8.mjs` checks all five film modes, every paint/projector control, frame holds, continuous transport, feedback history, exact loops, alpha, 4K output and resumed native exports. Set `SUPER8_CAPTURE_MOTION=1` to also capture a short ProRes projector preview. `node scripts/verify-super8-ui.mjs [app-path]` checks packaged projector controls, older project migration, save/open and native alpha output. `node scripts/verify-oil.mjs` checks Oil rendering, looping, alpha, mixed layers and 4K output in Electron. `node scripts/verify-ui.mjs` drives the built Electron application, including native persistence and a real transparent movie export; only file dialogs are replaced for repeatability.

`npm run package` builds an Apple Silicon `.app` under `work/release`. The local alpha is not notarized. Media-tool build instructions and notices are included with the bundled tools.

`node scripts/render-proof.cjs` performs the 4K, 300-frame proof using a frozen renderer bundle and the native export manager. Its artifacts, cache and progress live under `work/proof-4k`. Run with `PROOF_NEW=1` for a fresh job. Reuse requires a matching renderer fingerprint.

Source boundaries:

- `src/core/`: validated project schema, presets, seeded variation and deterministic timeline.
- `src/rendering/`: Three.js GPU rendering, compositing, EXR export and direct PNG encoding.
- `src/ui/`: React editor and native workflow orchestration.
- `electron/`: isolated preload bridge, document persistence, durable jobs, FFmpeg encoding and verification.

The preview and export renderer share the same implementation. Renderer and main process boundaries validate input separately. Export buffers are awaited frame by frame to bound memory. A browser-only preview can save PNGs/projects; reliable movie and sequence delivery uses the desktop application.
