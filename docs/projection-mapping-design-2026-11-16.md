# Map: projection mapping design

16 November 2026 · Form & Field 0.16.0 · Approved 17 November. Stage 0 is measured (see Stage 0 results). Stages 1 to 4 are built and reviewed. The projector sessions for stages 1, 3 and 4 are still to happen (see Known limits and the results sections).

## Intent

Draw shapes over the projector's picture so they line up with real objects, and play something different inside each one: a different instrument, or the same instrument with different settings. It should do what the paid mapping tools do for flat surfaces, and be quicker to learn than any of them.

Greg's words: "multiple masks where I can load up different instruments or the same ones but with different parameters into each mask", "a great and well thought out masking system to draw my areas", "loads of options to do wild things", "robust like the paid ones but easy to use".

## What Greg decided (16 November)

| Question | Answer |
|---|---|
| Projecting onto | Flat shapes first: walls, panels, boxes, windows |
| Projectors | One, plus the control screen |
| Plays inside a shape | Studio instruments, Live looks (Paint, Smoke), images and video files, solid colour / outlines / test grids |
| Performing | Set up and let it run; switch saved scenes; change things by hand during a show; sound or MIDI control |

Everything else in this document is my proposal.

## Research: what the main tools do well

Sources are listed at the end. Where a point comes from my own knowledge of a tool and not from a page I read today, it is marked *(unverified)*.

| Tool | What it does best | What people struggle with | What Map takes |
|---|---|---|---|
| **MadMapper** | Surfaces (quad, triangle, circle) with a separate **input** view (which part of the picture) and **output** view (where it lands). Masks drawn by clicking, curves placed automatically, closed with Enter; masks can be inverted, feathered and reordered, and attached either to the surface (follows the warp) or to the picture. Groups. Scenes and cues. | Two views to keep in your head. Adjusting a group only moves it; it cannot re-pin a whole group's perspective. | Click-to-draw outlines closed with Enter. Soft edge and invert per shape. Scenes that store what plays, not where shapes are. |
| **Resolume Arena** | Slices of one composition; snapping to edges, centre and each other, **Ctrl to switch snapping off** for a moment; arrow keys nudge 1 px, Shift 10 px; double-click an edge to add a point, double-click a point to remove it; straight or curved per point; four big corner points for correct perspective plus inner points for bending; brightness, contrast and red/green/blue per slice; masks over everything beneath them. | A slice is a rectangle first and a shape second; the reviewer I found calls tracing complex objects by hand "slow and genuinely tiring". Mapping needs the dearer edition. | The whole keyboard-and-snapping vocabulary. Per-shape brightness and tint. "Blockers" that black out everything under them. |
| **HeavyM** | The easiest to learn. You draw shapes, put them in groups and give a group an effect; every new group gets a white border so you can see what you are drawing. **Magnet** joins corners so there are no gaps and snaps to the canvas edges. **Background image**: trace over a photo that never reaches the projector. A cursor tool for lining up on the object. | Effects are mostly built-in ones per group; less depth than MadMapper. | Shape-first thinking. Magnet. Trace-over photo. Borders as a first-class look. A cursor on the wall. |
| **Millumin** | Layers with corner pinning and a bendable grid; several masks per layer combined with each other; a layer can act as a matte for the one below; a mapping for the whole canvas applied after everything else. | Aimed at theatre timelines. | A corner pin for the **whole stage**, so a bumped projector is fixed by dragging four corners, not every shape. |
| **Isadora IzzyMap** | Unlimited slices and groups; every mapping value can be driven by movement or sound. | Users call the composite mode limited and not intuitive: points are edited in one view, the result in another. | A warning: never split one shape's editing across two views. |
| **TouchDesigner kantanMapper** | Quad and freeform tools, straight or curved, a texture per shape, double-click a shape to move, turn and scale the picture inside it. | Only rectangles get true perspective; freeform shapes need a separate corner pin. | Double-click a shape to adjust the picture inside it. Perspective for any four-corner shape, whatever its outline. |
| **Lightform** | Effects that know where the edges are, using a scan of the scene. | Needs its own hardware; the product was wound down *(status unverified)*. | Edge-aware content, without a scan: the instruments already have "flow around / emit inside / trace edges" for a drawn polygon, so a shape's outline can drive them. |

Left out on purpose because of Greg's answers: blending overlapping projectors, calibrating to a 3D model and camera scanning *(MadMapper has these; unverified)*, LED and DMX pixel mapping.

**The pattern across all of them.** The robust tools make you learn two things, "the picture" and "where it goes", in two views. The easy tool has one thing, a shape with something in it. Map uses the easy model and hides the robust one inside a single setting, **Placement**.

## Goals

- A third section, **Map**, beside Studio and Live.
- Draw shapes on the projector's picture: rectangles, four-corner shapes, triangles, ellipses, and freehand outlines with straight and curved sides and holes.
- Each shape plays its own content with its own settings. Several shapes can also share one picture.
- Line shapes up with real objects quickly, looking at the wall and not the laptop.
- Change anything during a show without the wall flickering or going black.
- Saved scenes, switched with a fade.
- A show file that reopens exactly as it was left, and survives a crash.
- 1920 × 1080 at 60 frames per second with eight shapes playing four different instruments on this Mac. This is a target to be measured, not a claim.

## Non-goals (this design)

- Two or more projectors, and blending their overlap.
- Curved objects (bendable grid). Planned as the stage after this design; the shape data leaves room for it.
- Calibrating to a 3D model, or scanning the scene with a camera.
- Exporting the mapped picture as a video file.
- Shapes that move or change outline over time.
- LED strips, DMX, NDI or Syphon.
- Sound and MIDI control: wanted, and given its own design after stage 5 (see Build order). This design only leaves the connection point for it.

## Anti-goals

- Studio's loops, seeking and export must not change. Existing tests keep passing untouched.
- The camera picture never reaches the wall, including when a Live look plays inside a shape.
- No mapping jargon on screen: no "slice", "surface", "UV", "homography", "input/output".
- No edit, however clumsy, may blank the output. A new instrument appears only once it is ready, faded in over the old one.
- Shape positions are never part of a scene. Switching scenes must not move the mapping.

## Constraints found in the app

- `StudioRenderer` draws one composition into its own shared buffers and keeps per-composition state: `instruments.prepare(project)`, one set of oil buffers, `releaseFeedback(project)` deletes history for any layer not in the project it was just given, and `prepare()` throws away images the current project does not use. Drawing several compositions through one renderer, as it stands, would make them destroy each other's state every frame.
- `StudioRenderer` and `LiveRenderer` each create their own `WebGLRenderer` on a canvas they are given. Neither can draw into another renderer's texture today.
- A composition holds at most four layers (`project.ts:859`, `StudioRenderer.ts:763`).
- Studio instruments are loops driven by a phase from 0 to 2π. Playing them live means advancing that phase from a clock; the Studio preview already does this.
- The artwork window, display picker, blackout, operator preview and keep-awake already exist for Live (`electron/live.cjs`, `LiveOutput.tsx`). Messages between windows are capped at 16 KB, too small for a show with embedded images.
- `Layer.surface` already gives instruments a polygon to flow around, emit inside or trace (up to 12 points, `surface-layout.ts`).
- There is no video import anywhere in Studio. Live plays a chosen video file through a `<video>` element.
- Chromium plays H.264 and HEVC in MP4, and WebM. It does not play HAP or ProRes, the formats this app exports. *(From my knowledge; to be confirmed in stage 6.)*

## Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. A Map section with its own real-time compositor. Each thing that plays is a self-contained "source" that hands the compositor a picture.** | Studio and Live code stay as they are. Any future kind of content plugs in the same way. Needs a decision, by measurement, on how instrument sources share the graphics card (below). | **My pick.** |
| B. Put mapping inside Studio: drawn masks on layers, more than four layers. | Export would work at once. But no correct perspective, no scenes, no Live looks, and every change lands in the 1,184-line renderer that export depends on. | Rejected. |
| C. Keep exporting clips and map them in MadMapper or Resolume. | Nothing to build. Loses "different settings per shape, changed by hand, live", which is the point. | Rejected. |

Greg handed me the how, so I am going with A.

**The one open engineering question inside A**, to be settled by stage 0:

- *Separate renderers:* each instrument source runs its own `StudioRenderer` on a hidden canvas, and the compositor copies that canvas in each frame. No change to Studio code. Risks: browsers cap the number of live graphics contexts (about 16 in Chromium, *unverified*), each renderer carries its own buffers, and the copy has a cost.
- *One shared renderer:* `StudioRenderer` learns to keep a separate bundle of state per composition and to draw into a buffer it is handed. No cap and no copy, but it changes the renderer export depends on.

My expectation is that separate renderers are good enough for about twelve different sources and are the safer start. The spike decides.

**Shared sources and renderer count.** A new shape gets its own source by default, so eight shapes with four instruments can mean eight renderers unless shapes share sources. "Vary each" adds more. The renderer count is therefore set by how many sources exist, not by how many instruments are chosen. Stage 0 measures up to twelve renderers, and stage 2 states the renderer limit it allows.

## Design

### Words used on screen

- **Stage**: the projector's whole picture.
- **Shape**: an area you draw. This is what Greg called a mask.
- **Content**: what plays in a shape.
- **Group**: a folder of shapes.
- **Blocker**: a shape that plays nothing and blacks out everything beneath it.
- **Scene**: a saved choice of what plays where.

### The Map screen

```
 Studio · Live · [Map]      Scene 1 Opening ▾      Blackout · Test grid · Identify      Projector ▾  [Open output]
┌──────┬───────────────────┬───────────────────────────────────────────────┬────────────────────────────────────┐
│ Tools│ Shapes            │  STAGE: the projector's picture                │ Door                               │
│  V ▸ │ ▾ Front wall      │                                                │ Content    Oil Slides ▾  Vary       │
│  R ▭ │   ● Door       🔒 │        ╱╲            ┌────────┐                │            Edit in Studio           │
│  T △ │   ● Window left   │       ╱  ╲           │  Door  │      ◯         │ Placement  Fit · Pin · Across group │
│  E ◯ │   ● Window right  │      ╱____╲          └────────┘                │            Zoom  Move  Turn         │
│  P ✎ │ ▸ Plinths (3)     │                                                │ Look       Opacity  Blend           │
│      │ ■ Blocker: exit   │                                                │            Brightness  Tint         │
│      │ + Shape  + Group  │  Snap ☑  Photo ☐  Grid ☐            Fit ▾      │ Edge       Soft edge  Border  Glow  │
│      │                   │                                                │ Timing     Speed  Delay             │
├──────┴───────────────────┴───────────────────────────────────────────────┴────────────────────────────────────┤
│ Scenes  [1 Opening] [2 Build] [3 Peak] [+]                                                      Fade  2.0 s    │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

One view only. Whatever is selected is editable where it sits.

### Drawing shapes

Tools, each with a single key:

| Tool | Key | Does |
|---|---|---|
| Select | V | Click a shape to select it; drag to move; drag its box to scale or turn. Click again (or press Enter) to edit its points. Double-click to adjust the picture inside it. |
| Rectangle | R | Drag out a rectangle. Its four corners can then be moved freely. |
| Triangle | T | Drag out a triangle. |
| Ellipse | E | Drag out an ellipse. |
| Pen | P | Click for a corner, click-and-drag for a curve. Enter or clicking the first point closes the shape. |

Editing points:

- Drag a point, or a marquee of points. Arrow keys move the selection one projector pixel; Shift, ten. Tab steps to the next point.
- Double-click a side to add a point. Double-click a point to remove it. Alt-click a point to switch it between corner and curve.
- Exact position boxes for the selected point, in projector pixels.
- **Snap** joins points to other shapes' points and sides, to the stage edges and centre. Shared corners stay closed up. Hold Ctrl to switch snapping off while dragging.
- **Hole**: with a shape selected, draw another shape inside it with Alt held to cut a hole.
- Outlines that cross themselves are refused, shown in red, and the last good outline is kept on the wall.

Working with shapes:

- Duplicate (⌘D, or Alt-drag), flip, mirror across a line, bring forward, send back.
- Lock, hide, solo, rename, colour tag.
- **Make a grid**: turn a rectangle into rows and columns of separate shapes.
- Groups: move, scale, hide and fade together.
- Undo and redo for every action, as in Studio.
- Limits (my call): 64 shapes, 32 points a shape.

### Lining up on the real object

- With the output open, every change shows on the wall within a frame or two. The laptop shows the same stage with the outlines drawn over a small picture of the output.
- The selected point shows as a **crosshair on the wall**, so you watch the object while you nudge with the arrow keys.
- **Test grid**: a numbered grid and each shape's outline, name and colour, instead of content.
- **Identify**: flashes the selected shape on the wall.
- **Photo**: put a photograph of the scene behind the stage on the laptop and trace it. It never reaches the projector.
- **Stage corners**: four handles that re-pin the whole picture, every shape together, for when the projector is moved (stage 4).
- **Blackout** and **Freeze**.

### Content: what plays in a shape

A shape points at one **source**. A source belongs to the show, not the shape, so:

- *Different things in each shape:* each shape has its own source. This is the default: dropping a preset on a shape makes a new source for it.
- *Same instrument, different settings:* duplicate the shape, or choose **Make separate**. The copy gets its own source and from then on its own settings.
- *One picture across several shapes:* choose **Share with…** or use a group's content. The shapes point at the same source.

Kinds of source, in build order:

1. **Colour**: a solid colour, a palette gradient, or nothing but a border.
2. **Instrument**: a Studio composition of one to four layers, with all its finishes. Chosen from the same Library and presets as Studio. In Map you get the short list: preset, **Vary**, palette, speed. **Edit in Studio** opens that composition in the Studio screen with every control, and a bar across the top reading "Editing Door · Back to Map"; changes show on the wall as you make them.
3. **Image** and **Video**: a file of your own. Images are stored in the show file. Videos stay where they are on disk and are found again by path; a missing file shows its name on the laptop and plays black.
4. **Live look**: Paint or Smoke, with their own settings. One camera feeds every Live source.

Instrument sources are copies stored inside the show, not links to `.formfield` files. Opening a composition from a file copies it in.

### Placement: how the picture sits in the shape

One setting with three choices. This is where the two-view model of the paid tools is hidden.

- **Fit** (default). The picture fills the shape's bounding box, undistorted, and the outline cuts it. Zoom, Move and Turn adjust it inside the shape.
- **Pin**. For shapes on a surface seen at an angle. Four pin corners (the shape's own corners if it has four, otherwise the corners of a box you place) take the picture with correct perspective, so it looks painted on. The outline still cuts it.
- **Across group** / **Across stage**. The picture is laid over the whole group or stage and the shape is a window on to it. Several shapes then show pieces of one picture.

### Look, edge and timing, per shape

- **Look**: opacity, blend (normal, add, screen, multiply), brightness, tint. Brightness and tint are for evening out surfaces of different colours.
- **Edge**: soft edge (fades inward), border (width, colour from the palette or fixed, glow).
- **Timing**: speed, and delay. In a group, **Stagger** spreads the delay across its shapes in order, so one shared instrument ripples from shape to shape.

### Wild options (stage 7, each small and separate)

- **Outline drives the instrument**: the shape's outline is handed to instruments that support "flow around", "emit inside" and "trace edges", so ink grows from the edges of the actual object. This reuses `Layer.surface`, but it sends the outline at each shape's own size, so it needs its own review against Studio's output.
- **Vary each**: one click gives every shape in a group its own variation of the same instrument.
- **Palette shift across a group**: each shape a step further round the palette.
- **Border runs**: a light travelling round the outline; in a group, chasing from shape to shape.
- **Scene auto-advance**: scenes change by themselves on a timer, for installations.

Nothing here is combined into ready-made "shows". Each is a separate control.

### Scenes

- A scene stores, for each shape: its source, placement, look, edge, timing and whether it is visible. It does not store outlines or positions.
- Switching fades only the shapes whose content differs. Sources used by both scenes keep running without a restart.
- Keys 1 to 9 switch scenes. Fade time is set once, with an override per scene.
- Editing while a scene is live changes that scene.

### How it is built

- `src/map/` holds everything new. It imports from Studio and Live; they do not import from it.
- **Show document**: stage size, shapes, groups, sources, scenes. Its own versioned file (`.formshow`), validated field by field on load like Live settings, autosaved with the same atomic write as projects, with the same recovery copies.
- **`MapSource`**, the one contract every kind of content meets: prepare, draw a frame at a given size and time, report whether it is ready, hand over its picture, dispose. The compositor knows nothing else about content. This is also where sound and MIDI will later attach: they change a source's or shape's numbers, nothing more.
- **`MapRenderer`**, the compositor, with its own real-time clock like `LiveRenderer`. Each frame, back to front, for each visible shape: ask its source for a picture at the size the shape covers on the wall, place it (Fit, Pin or Across), cut it with the shape's coverage, apply look and edge, blend it on. Then the stage corner pin, then blackout.
- **Sized to the wall.** A source is drawn at the pixel size its largest shape covers, not at full stage size. Ten shapes then cost roughly what one full picture costs, because together they cover about one stage.
- **Keeping to 60.** When frames run late, the heaviest sources are drawn smaller first, then at half rate, before the output frame rate is allowed to drop. The laptop shows which sources were reduced.
- **Coverage.** A shape's outline, holes and soft edge are drawn into a small picture whenever the shape changes, and the compositor reads that. Curves, holes and soft edges then cost nothing extra per frame. *(My call; the builder may triangulate instead if measurement says so.)*
- **Pin** is computed per pixel from the four pin corners, so perspective is exact for any outline.
- **Windows.** As in Live, when the output is open the renderer runs there and the laptop gets a small picture ten times a second; outlines on the laptop are drawn locally so dragging feels instant. The output window, display list, keep-awake and Escape-to-close are Live's, generalised. Shape edits travel as small messages; images travel once, separately.
- **Stage size** follows the chosen display by default, or is fixed at 1280 × 720, 1920 × 1080, 1920 × 1200 or 3840 × 2160. Shape positions are stored as fractions of the stage, so changing the size keeps the layout. *(My call.)*
- **One output at a time.** Map and Live share the single output window; opening one closes the other. Live's own full-screen mode stays as it is. *(My call.)*
- **Swapping content** keeps the old source drawing until the new one reports ready, then fades (stage 2).

### Checks

- Unit tests for the pure parts: show validation and repair, outline rules (crossing, limits), snapping, the pin maths, placement boxes, scene differences, the frame-rate governor's decisions.
- Scripted runs in the built app, with the output as an ordinary window: shapes appear where drawn to the pixel; a pinned test grid lands on its four corners; blackout is black; a scene switch never shows a black frame; a bad outline never reaches the output.
- A performance record at 1920 × 1080 for a named show (eight shapes, four instruments), two minutes and then two hours, stated as plainly as the Live record, including what it does not show.
- A session with Greg, a projector and real objects at the end of stages 1, 3 and 5. Scripted runs cannot judge whether lining up feels quick.

## Build order

Each stage ends with something usable. Detailed step-by-step plans are written per stage once this design is approved.

| Stage | What gets built | Done when |
|---|---|---|
| **0. Measure** | A throwaway test: 4, 8 and 12 instruments at once, separate renderers against one shared renderer. | Numbers are written down and the route for instrument sources is chosen. |
| **1. Stage and first shapes** | Map section, show file and autosave, output window, compositor, Colour sources, rectangle and four-corner shapes, select / move / points / nudge / exact positions, wall crosshair, Test grid, Identify, Blackout, undo. The fade-in rule for "output never blanks" moves to stage 2: a solid colour has no not-ready state, so in stage 1 the output cannot blank either way. | Greg lines four-corner shapes up on real objects with a projector. |
| **2. Instruments in shapes** | Instrument sources, Library and presets on a shape, own settings per shape, Vary, palette, speed, Edit in Studio and back, Fit placement, sizing to the wall, the frame-rate governor, fade on change, Freeze (stage 1 has nothing moving to freeze). | Eight shapes play four instruments at the measured rate, and editing one never disturbs the others. |
| **3. The full drawing kit** | Pen with curves, triangle, ellipse, add / remove / convert points, holes, Snap, Photo, duplicate / flip / mirror, Make a grid, groups, lock / hide / solo, soft edge, border, Blockers. | A photographed scene of about 20 pieces is traced and aligned in one sitting. |
| **4. Placement** | Pin, Across group, Across stage, Share with / Make separate, stage corners, brightness and tint. | A grid pinned to an angled box face looks square to the eye; nudging the projector is fixed with four handles. |
| **5. Scenes** | Save, switch, fade, keys 1 to 9, per-scene fade time; two-hour run. | A three-scene show runs for two hours and switches without a black frame. |
| **6. More content** | Image, Video and Live look sources. | Smoke plays inside one shape while instruments play in the others, with the camera rule intact. |
| **7. Wild options** | Outline drives the instrument, Stagger, Vary each, palette shift, border runs, scene auto-advance. | Each works alone and is switched off by default. |
| **Later, own designs** | Sound and MIDI control. Curved objects. More projectors. | — |

**Known limits, stage 1**

- At most 64 shapes, 32 corners a shape, names up to 40 characters. A show file with more is opened without the extra shapes, and says how many were left out; a shape is never cut down to fit.
- Map has its own message limit of 512 KB (256 KB until stage 3), well above the largest valid show, so a valid show always reaches the wall. Corners are sent rounded to 4 decimal places (0.2 projector pixels at 1920 wide) to keep messages small; the show file keeps full precision.
- The operator screen shows the wall's own picture, about ten times a second, behind outlines drawn at once. With the output closed it draws the stage itself.
- A drag that would be refused draws the refused outline in red on the operator screen only; the wall keeps the last valid picture.
- Undo history lasts while the app is open, including leaving Map and coming back. It is not saved with the show.
- Lock protects a shape from every change except Show/Hide and Unlock, deleting included.
- Delete, Backspace and Tab act on shapes only while the stage has focus, so a key pressed on a button never deletes a shape. Tab steps through the corners.
- Corners are editable as soon as a shape is selected, so there is no separate Enter step.
- Open asks before replacing the shapes on screen. A save that keeps failing refuses to close the app, even after leaving Map.
- The output draws an outline on the selected shape, to show which shape is being lined up.
- The test grid draws numbered grid lines and each shape's outline, name and colour, with no fills.

## Stage 2 decisions

Made 17 November 2026, before building stage 2. Each can be changed; the cost of changing it is noted.

- **Compositor.** The output keeps its Canvas 2D compositor. Each instrument source runs its own `StudioRenderer` on a hidden canvas (the route stage 0 measured), and each shape draws its source clipped to its outline. A GPU compositor is only needed for Pin (stage 4); changing then means replacing the drawing step, not the sources.
- **Show format, version 2.** A show holds `sources` (instrument sources: a Studio composition, a speed and a revision number) and each shape has a `sourceId`, or none, meaning it plays its own colour. Version 1 files open as all-colour shows. A new shape, and a duplicated one, gets its own source, so settings are per shape by default.
- **Messages.** The show message carries shapes and source references only. Each instrument source's composition travels in its own message, sent once per revision, with a 24 MB limit (a composition can hold images up to 20 MB). The output keeps the compositions it has been sent.
- **Clock and Freeze.** One clock in the output advances every source by its own speed. Freeze stops the clock and the drawing; the wall holds its last frame.
- **Sizing to the wall.** A source is drawn at the pixel size of its shape's bounding box on the stage (never above 1920 × 1080, never below 64 px), times the frame-rate governor's scale.
- **Frame-rate governor.** The output measures each frame. When frames run late it lowers every instrument's drawing size in steps (100, 75, 50 %), then draws instruments at half rate. It raises them again when frames are well inside budget. The operator screen shows the current level.
- **Fade on change.** When a shape changes to another source, or a source changes preset, the old picture keeps drawing until the new one is ready, then crossfades over 0.4 s. Smaller changes (Vary, palette, speed) take effect as soon as they are ready, without a fade. The wall never shows black in between.
- **Operator screen.** With the output open, the laptop shows the wall's picture behind the outlines (as in stage 1). With it closed, the laptop runs the same compositor itself.
- **Edit in Studio.** Studio's own project, its undo history and its file are set aside while a shape's composition is edited, and Studio's autosave and close-save keep writing the set-aside project, never the shape's. "Back to Map" puts them back. Export is not offered while editing a shape.

## Stage 2 results

Measured 17 November 2026 on this Mac (Electron 45, display at 120 Hz) with `scripts/measure-map.mjs`. Eight shapes in a 4 × 2 grid covering most of a 1920 × 1080 stage, two shapes per instrument, each shape with its own source (eight renderers). The output window was open; the operator screen showed the wall's picture. 30 s after a 4 s warm-up.

| Mix | Instruments | Frames in 30 s | Median frame | 95th percentile | Frames over 16.7 ms | Governor |
|---|---|---|---|---|---|---|
| Medium | Living Ink, Relief, Resonance, Texture Cuts | 3,142 (105 fps) | 8.4 ms | 17.8 ms | 193 (6 %) | stayed at full size |
| Heavy | Fractal, Sculpture, Living Ink, Oil Slides | 2,882 (96 fps) | 8.4 ms | 25 ms | 276 (10 %) | stayed at full size |

**Against the target** (60 fps with eight shapes and four instruments): met on average with room to spare. Not every frame: 6 to 10 % of frames took longer than a 60 Hz frame. They were scattered, not runs of 30, so the governor rightly did not step down.

**After the performance audit** (docs/map-performance-audit-2026-11-17.md): both mixes run at the display's full 120 fps, with no frame over 16.7 ms in 30 s (worst 12.8 ms and 9.4 ms). The long frames were the wall preview's JPEG encode stalling the projector page; it now happens in a worker.

**What these numbers do not show.**
- A 60 Hz projector. This display refreshes at 120 Hz; on a 60 Hz output the scattered long frames would show as occasional repeated frames.
- A long run. The two-hour record is stage 5's.
- Shapes larger than a quarter of the stage each, or more than eight sources.
- The operator screen playing instruments itself (output closed): that doubles the work only when no wall is open.

**Known limits, stage 2**

- At most 24 instruments play at once (Chromium limits live graphics contexts). More play their shape's colour, and the operator is told why.
- Every preset change starts a fresh instrument (and graphics context); the old one is given back at once.
- A composition with large images is slower to edit: each change is sent to the projector whole (at most once a frame).
- Undo history covers the show (shapes and what they play), including a whole Edit in Studio session as one step; it is not saved with the show.
- Placement is Fit only: the picture fills the shape's bounding box, undistorted, and the outline cuts it. Pin and Across group / stage are stage 4.

## Stage 3 decisions

Made 17 November 2026, before building stage 3. Greg chose the first four; the rest are my calls and can be changed.

**Greg's choices**

- **Curves have handles.** In the Pen, a click places a corner and a click-and-drag places a curve point with two handles. Handles are dragged to shape the curve, and they mirror each other unless Alt is held. Alt-click switches a point between corner and curve.
- **Make a grid gives each cell its own copy** of the shape's instrument, as Duplicate does. A grid of more than 24 instrument cells passes the 24-at-once limit, and the extra cells play their colour, with the operator told why.
- **Joined corners move together.** While Snap is on, corners of different shapes that sit on the same spot (within half a projector pixel) move together when one is dragged or nudged. Holding Ctrl while dragging moves one corner on its own and switches snapping off.
- **Groups are one level deep.** A group is a folder of shapes, with no groups inside groups.

**My calls**

- **Show format, version 3.**
  - A point may carry curve handles, `in` and `out`, stored as offsets from the point in stage fractions. A point without handles is a corner, and a side between two corners is straight.
  - A shape gains:
    - `holes`: up to 8 outlines, each one also able to curve
    - `groupId`
    - `blocker`
    - `softEdge`: in projector pixels, 0 to 200
    - `border`: width 0 to 40, colour, glow 0 to 40
  - The show gains `groups` (up to 32) and `photo`.
  - Version 1 and 2 files open with every new field at its default. That is not counted as a repair.
- **Point limit.** 32 points a shape counts the outline and its holes together, so the largest show still fits one message to the wall.
- **Outline rules for curves.** Each curved side is checked as 16 short straight pieces, with the same crossing and size rules as before. A hole must sit wholly inside its shape and must not touch the outline or another hole. Anchor points must stay on the stage; a curve may bulge past the edge of the stage, and that part is simply not drawn.
- **Ellipse and triangle.**
  - An ellipse is drawn as four curve points, so it can be bent like any Pen shape afterwards.
  - A triangle is drawn as three corners, its tip at the top centre of the dragged box.
  - Holding Shift while dragging out a rectangle, triangle or ellipse makes its box square.
- **Holes.**
  - With a shape selected, hold Alt while drawing any shape inside it. What you draw becomes a hole in the selected shape.
  - A hole's points are edited like the outline's.
  - Undo takes a hole away again.
- **Snap targets.** Other shapes' points, then their sides, then the stage edges and centre lines, within 10 screen pixels. Snap is on by default. Its switch is kept for the session, not in the show.
- **Selection.**
  - Shift-click adds or removes shapes.
  - Dragging on empty stage selects every shape wholly inside the dragged box.
  - Clicking a group in the list selects its members.
  - Moving, deleting, duplicating, flipping, scaling and turning act on everything selected.
  - Points are picked one at a time; there is no box for picking points.
- **Scale and turn.** The selection gets a box with four corner handles, which scale it from the opposite corner (Shift keeps the proportions), and a turn handle above it (Shift turns in 15° steps). The edit is refused if any point would leave the stage.
- **Flip and mirror.**
  - Flip turns the selection over, left to right or top to bottom, about its own centre.
  - Mirror makes a mirrored copy across the stage's centre line, left to right or top to bottom.
  - Mirroring across a line you draw yourself is left out.
- **Make a grid.**
  - Works on a shape with four corners and no curves.
  - 1 to 16 rows and columns, with a gap of 0 to 100 projector pixels between cells.
  - The cells follow the shape's own perspective.
  - The cells replace the shape and go into a new group named after it.
- **Groups.**
  - A group's members sit together in the list, which is also the stacking order. Moving the group in the list moves them all.
  - Hiding or locking a group hides or locks its members, but leaves each member's own setting as it was.
  - A group with no members left is removed.
- **Solo** shows only the soloed shapes and groups, on the wall as well. It is not saved and is not an undo step, like Test grid. While solo is on, the header says so in the accent colour.
- **Blocker.**
  - A shape that plays nothing and blacks out everything beneath it, on the wall too, with its soft edge.
  - On the operator screen it is drawn hatched, so you can still see it.
- **Soft edge.**
  - Fades the content to nothing at the outline, over the given distance inwards.
  - The fade is made once, as a small picture, whenever the shape changes, and reused on every frame. Shapes without a soft edge are clipped as before.
- **Border.**
  - Drawn inside the outline, so it never spills off the object.
  - Its colour is a fixed colour or the first colour of the shape's instrument palette.
  - Glow is a blur of the border, also inside the outline.
- **Photo.**
  - Chosen from a file on this screen and stored in the show, shrunk to fit 1920 × 1080 as a JPEG, so it travels with Save As.
  - It is drawn under the outlines on the operator screen only, with its own opacity. It is never sent to the wall.

**Added after stage 3, at Greg's request (17 November)**

- **New shapes show a grid pattern**, like a pro tool's test card. Lines run about every 80 projector pixels in the shape's colour over a dim fill of it. The centre lines are bold, and the shape's name sits in the middle.
  - On a four-corner shape the lines and two diagonals follow its corners, so a shape that is not square to the object shows it at once.
  - Other shapes get straight lines across their box, cut by the outline.
  - "Plays" offers Grid pattern, Its colour or an instrument. The pattern stays until another is chosen.
  - Shows from before keep their plain colour (a shape's `fill` is `colour` unless saved as `grid`).
  - The pattern is drawn once per shape and reused until the shape changes.
- **Room photo** is now offered in three places: a button in the tool strip, the stage's right-click menu, and dropping a JPEG or PNG on the stage. It was already under the stage.


- **Points.**
  - At most 32 points a shape, its holes included, and at most 8 holes.
  - A hole is part of its shape. It moves, turns and is deleted with it, and it cannot be selected on its own (its points can).
- **Curves.**
  - Curves are checked as 16 straight pieces a side. A curve that only grazes another side between those pieces can be accepted.
  - Snapping to a curved side lands on those pieces, at most a pixel or two off the true curve on large shapes.
- **Selecting points.** Points are chosen one at a time; there is no box for picking several points. Shapes can be picked with a box.
- **Joined corners.**
  - Corners on the same spot move together only while Snap is on, and hidden shapes' corners move too.
  - A locked shape's corner stays where it is, which opens a gap.
- **Mirror** copies across the stage's centre lines only.
- **Flip** turns the outline over. It does not flip the picture playing inside: placement is stage 4.
- **Make a grid** works on four-cornered shapes without curves or holes.
  - Each cell gets its own copy of the instrument, as Greg chose.
  - Past 24 instrument cells, the extra cells play their colour. The operator is told why.
- **Solo, Snap, Photo shown and closed folders** are not saved and are not undo steps. Solo is cleared by "Solo on · Clear" in the header.
- **Soft edge.**
  - The fade picture is made at half the projector's resolution and stretched, which is smooth at any soft edge from 1 px.
  - It is made again only when the outline, holes or soft edge change; a counter in the scripted check confirms this.
- **Border.**
  - Drawn inside the outline, at its full width.
  - Its glow also stays inside the outline.
- **Photo.**
  - Fitted to the stage without stretching. It is not pinned or warped to match the projector's view: it is a guide to trace by eye.
  - Stored in the show as a JPEG, so a show with a photo is a few hundred kilobytes larger.
- **Names** lose control characters, which only made messages to the wall larger.

## Stage 3 results

Measured 17 November 2026 on this Mac with `scripts/measure-map.mjs` (eight shapes, four instruments, 30 s). Other programs were busy on this Mac at the time: a packaged Form & Field app used about 54 % of a core, and another Electron app and the window server were busy too. So the commit before stage 3 (62eb379) was built and measured in alternate runs, under the same conditions.

| Build | Mix | Median frame | 95th percentile | Frames over 16.7 ms in 30 s |
|---|---|---|---|---|
| Before stage 3, run 1 | Medium · Heavy | 8.7 · 8.6 ms | 12.3 · 12.3 ms | 16 · 22 |
| Stage 3, run 1 | Medium · Heavy | 8.8 · 8.5 ms | 12.5 · 13.0 ms | 19 · 29 |
| Before stage 3, run 2 | Medium · Heavy | 8.8 · 8.7 ms | 13.1 · 12.5 ms | 18 · 22 |
| Stage 3, run 2 | Medium · Heavy | 8.9 · 8.5 ms | 12.8 · 12.3 ms | 19 · 17 |
| Stage 3, every shape with a 40 px soft edge and a 6 px border with glow | Medium · Heavy | 9.0 · 9.2 ms | 11.8 · 11.5 ms | 10 · 10 |

- The governor stayed at full size throughout, and no instrument failed.
- No soft-edge picture was remade during any run.

**Main thread busy** (`scripts/profile-map.mjs`; after the audit in brackets):

| Window | Busy |
|---|---|
| Projector window, heavy show | 15.2 % (16.5 %) |
| Operator screen, projector open | 2.0 % (2.1 %) |
| Operator screen playing the show itself | 16.6 % (17.8 %) |
| Idle show, projector window | 0.9 % (0.9 %) |
| Idle show, operator screen | 1.4 % (1.2 %) |

**Against the bar.** Stage 3 costs no more than stage 2 did: the before and after runs cannot be told apart, and soft edges and borders add about 0.5 ms to the median. The long frames in these runs come from the other programs, since the commit before stage 3 showed as many. A run on a quiet Mac is still needed to confirm the audit's result again: 120 fps with no frame over 16.7 ms.

**Checked in the app** (`npm run test:map`, 21 checks, 8 of them new):
- An ellipse is round on the wall.
- A hole is black on the wall, and Undo takes it away.
- A Pen curve bulges past the straight line.
- A Blocker blacks out what is beneath it.
- A soft edge darkens the outline, and a border brings it back.
- Solo, and hiding a group, take shapes off the wall.
- A corner snapped onto a neighbour's corner moves with it.
- A 2 × 2 grid projects four cells with gaps.
- The Photo shows on the operator screen and never on the wall.

**Not shown.** Whether tracing about 20 pieces from a photo, and lining them up with a projector, really works in one sitting. That needs Greg, a projector and a real scene.

## Stage 4 decisions

Made 18 November 2026, before building stage 4. Greg handed over the how; each of these is my call and can be changed.

**How Pin is drawn: the wall's drawing moves to the graphics card.** Measured first (18 November, `scripts/map-spike/warp/`). Eight moving 480 × 270 pictures went into eight shapes on a 1920 × 1080 stage, 540 frames each, timed including a wait for the graphics card:

| Route | Median frame | 95th percentile |
|---|---|---|
| Canvas 2D, as stage 3 draws (no Pin) | 6.9–7.8 ms | 8.8–9.8 ms |
| Canvas 2D plus a perspective helper, one copy per pinned shape | 13.7 ms | 16.3 ms |
| …plus the stage-corner pass | 16.9 ms | 19.7 ms |
| Canvas 2D plus the helper, all pinned shapes in one batch | 6.2 ms | 7.2 ms |
| **Everything on the graphics card, in one pass** | **4.9 ms** | **5.6 ms** |

- The helper planned at first fails the plan's own rule (no more than 4 ms added).
- Batching would pass, but pinned and unpinned shapes would need extra care to keep their stacking order.
- **Greg chose the graphics-card compositor.** It was the fastest route measured, the stage corners come almost free, and it suits stage 6 (video and Live looks in shapes).
- **How it works:**
  - Each shape's outline, holes and soft edge become a coverage picture, made in 2D only when the shape changes. This is the original design's "Coverage" idea.
  - Its border and its own fill (colour or grid pattern) become cached pictures too.
  - Instruments are uploaded as textures when they render.
  - Each shape is drawn as a single quad. Its picture goes through one 3 × 3 transform: plain for Fit and the Across placements, perspective for Pin. It is cut by the coverage picture, then given its brightness and tint.
  - The test grid, names, identify flash and crosshair are drawn in 2D only when they change, and laid on top.
  - The finished stage goes through the stage corners last.
- **Two consequences:**
  - The operator's small picture of the projector is read back without waiting for the graphics card, through a pixel buffer, as the audit required. It is taken before the stage corners.
  - A lost graphics context blanks the projector until Chromium restores it. It cannot keep a last picture, because the picture lived on the card. That is accepted, and the operator is told.

**Placement.**
- Each shape gets a placement:
  - **Fit** (the default, as now), with **Zoom**, **Move** and **Turn** for the picture inside the shape
  - **Pin**
  - **Across group**
  - **Across stage**
- **Pin.** The picture is laid on four pin corners with correct perspective.
  - A shape with exactly four points uses its own corners and follows them as they move; curved sides don't matter.
  - Any other shape gets four pin handles of its own, starting at its box's corners and dragged on the stage while Pin is chosen.
- **Across group and Across stage.** The picture covers the group's or the stage's box, and each shape shows its own piece of it. Across group on a shape with no group acts as Across stage.
- **The grid pattern follows the placement.** A pinned shape's grid is drawn in true perspective, so the lines meet at a vanishing point instead of being evenly spaced. That is what makes "a pinned grid looks square on an angled box face" something you can see.

**Sharing.**
- **Share with…** lists the other shapes that play an instrument; choosing one makes this shape play that instrument.
- **Make separate** gives a shape its own copy again.
- Stage 2's rule stays: shapes are separate by default, and duplicates and grid cells get their own copy.
- A shared instrument is drawn once, at the size of the largest place it lands. That is the bounding box of a group or the stage for the Across placements.

**Stage corners.**
- Four handles warp the whole picture on the projector, for when the projector has been nudged.
- They are saved in the show, and they act last, after blackout and every shape.
- The operator screen keeps showing the stage flat, so shape outlines still line up with the picture behind them. The projector's preview is captured before the warp for the same reason.
- A **Stage corners** switch in the header shows the four handles, and **Reset** puts them back at the corners.
- Holding Shift while nudging a stage corner moves it 10 pixels, as with shape points.

**Look per shape.**
- **Brightness**, 0 to 200 %, default 100 %.
- **Tint**: a colour the picture is multiplied by, white for none.
- Both are for evening out surfaces of different colours. They apply to instruments, the grid pattern and plain colours alike, and not to Blockers.

**Show format, version 4.**
- Each shape gains `placement`:
  - its `kind`
  - `zoom` (0.25 to 4)
  - `offset`, in stage fractions
  - `turn`, in degrees
  - `pin`: four points, or null to use the shape's own corners
- Each shape also gains `brightness` and `tint`.
- The show gains `stageCorners`: four points, or null for none.
- Version 1 to 3 files open with Fit, no adjustment and no stage corners. That is not counted as a repair.

**Not in stage 4:**
- Double-click to adjust the picture inside a shape on the stage. Stage 4 adjusts it with sliders in the Details panel.
- A pin or stage-corner grid finer than four corners. That is the "curved objects" design.

**Known limits, stage 4**

- **Pin.**
  - A shape with four points pins by its own corners when they can carry a picture.
  - Any other shape, including four points with one on a straight line, gets four pin handles of its own, starting at its box.
  - Folding a shape's own pinned corners is refused, in red.
  - A pin is one flat surface. Bending a picture over a curved object is the "curved objects" design.
- **Pin and the grid pattern.** On a pinned shape the grid pattern is a flat grid seen through the perspective, without the shape's name, which would be stretched.
- **Zoom, Move and Turn** are for Fit and the Across placements. A pinned picture fills its four corners exactly.
- **The picture inside a shape is adjusted with sliders** in the Details panel. Double-clicking a shape to adjust it on the stage is not built.
- **Across group** covers the box of every member of the group, hidden ones and Blockers included.
- **Stage corners.**
  - They bend the projector's picture only. The operator screen stays flat, and its picture of the projector is taken before the bend.
  - The corners may go at most half a stage past the edge. A corner past the edge is shown, and can be grabbed, at the edge. Tab steps between the four corners for the arrow keys.
  - Each drag is one undo step, and so is each arrow nudge.
- **Sharing.** A shared instrument is drawn once, at the largest place it lands. Vary, palette and speed change every shape that shares it, and Make separate gives a shape its own copy.
- **Brightness and tint** apply to everything a shape shows, its own grid pattern included, but not to Blockers.
- **The projector's drawing is on the graphics card.**
  - If the graphics card resets, the projector shows black until it comes back by itself, usually within a second. The operator is told.
  - The picture is kept after each frame (preserveDrawingBuffer), so a frame with nothing new, the operator screen and the scripted checks all see the last picture. This costs a little graphics-card time.

## Stage 4 results

Measured 18 November 2026 with `scripts/measure-map.mjs` (eight shapes, four instruments, 1920 × 1080, at the display's 120 Hz).

**Earlier in the day, with the Mac quiet** (the new graphics-card drawing, before the pinned runs existed):

| Run | Mix | Median frame | 95th percentile | Worst | Frames over 16.7 ms in 30 s |
|---|---|---|---|---|---|
| Standard | Medium · Heavy | 8.3 · 8.3 ms | 8.4 · 8.5 ms | 9.4 · 9.3 ms | 0 · 0 |
| Every shape with a 40 px soft edge and a 6 px border with glow | Medium · Heavy | 8.3 · 8.3 ms | 9.3 · 9.2 ms | 9.4 · 9.4 ms | 0 · 0 |

That is better than stage 3, whose worst frames were 12.8 and 9.4 ms on a quiet Mac. The wall's drawing now costs less than it did in 2D.

**Later, with other work on the Mac** (another copy of the app was running), standard and pinned runs alternated, 15 s each:

| Run | Frames over 16.7 ms (Medium · Heavy) | Reported fps |
|---|---|---|
| Standard, round 1 | 77 · 174 | 99–108 · 75–98 |
| Every shape pinned, stage corners set, round 1 | 57 · 138 | 106–114 · 83–98 |
| Standard, round 2 | 56 · 162 | 104–118 · 77–100 |
| Every shape pinned, stage corners set, round 2 | 77 · 135 | 102–108 · 82–104 |

- Pin and the stage corners cost nothing measurable; the pinned runs were no slower than the standard ones next to them.
- The long frames in these runs came from the Mac being busy, since the standard show had as many.
- A pinned run on a quiet Mac, to confirm 120 fps with no frame over 16.7 ms, is still to do.

**Checked in the app** (`npm run test:map`, 25 checks, 4 of them new):
- A pinned trapezoid's grid lines bunch up towards its narrow side, where Fit spaces them evenly.
- Two shapes sharing one instrument Across stage show one continuous picture across their shared edge, with one instrument prepared.
- Brightness 50 % halves a colour on the wall.
- Stage corners move the projector's picture. Blackout stays black with them set, the operator screen stays flat, and Reset brings the picture back.

The 21 stage 3 checks pass on the new graphics-card drawing.

**Not shown.**
- That a grid pinned to an angled box face looks square to the eye.
- That a nudged projector is fixed with the four corners.

Both need Greg, a projector and a box.

## Stage 0 results

Measured 17 November 2026 on this Mac (Electron 45, real GPU, display at 120 Hz). Harness: `scripts/map-spike/` (throwaway; not part of the app). Each source is drawn at 640 × 360, roughly one shape, and composited into a 1920 × 1080 stage every frame. Each frame's time covers all renders, the composite and a GPU sync per source. Twenty seconds per run after a three-second warm-up.

| Route and sources | Instruments | Frame median (ms) | Frame p95 (ms) | Stage not blank |
|---|---|---|---|---|
| Separate renderers, 4 | Living Ink, Relief, Resonance, Texture Cuts | 3.9 | 5.3 | yes |
| Separate renderers, 8 | same | 5.0 | 6.5 | yes |
| Separate renderers, 12 | same | 5.7 | 7.0 | yes |
| Separate renderers, 4 | Fractal, Sculpture, Living Ink, Oil | 4.8 | 6.6 | yes |
| Separate renderers, 8 | same | 5.5 | 6.9 | yes |
| Separate renderers, 12 | same | 6.0 | 7.1 | yes |
| One shared renderer, 8 (cost floor, not correct) | same as the first row | 5.8 | 7.3 | yes |
| One full 1920 × 1080 source | Living Ink | 6.5 | 7.8 | yes |

A 16.7 ms frame is the budget for 60 frames per second. Every run stayed under 8 ms at p95.

**Context limit.** Thirty-two WebGL renderers were created and drawn once each, with no context lost. The "about 16" limit in Chromium is therefore not reproduced here. This was tested only in Electron, with small canvases, so the figure stays *unverified* for the laptop's browser build.

**Route chosen: separate renderers.** At 8 sources they cost 5.0 ms against 5.8 ms for the shared route, which is the best case the shared route could reach. The shared route would also need `StudioRenderer` changes that the design wants to avoid. Stage 2 can use one renderer per source.

**What these numbers do not show.**
- Sources were drawn at 640 × 360, one shape's worth. Twelve of them cover about 1.3 stage areas, and one full 1080p source costs more than twelve shape-sized ones, so cost follows area. The stage 2 governor is still needed for larger sources.
- Only one heavy mix was run, at 4, 8 and 12 sources. Fractal and Sculpture at full stage size were not tried.
- Runs were 20 seconds. The two-hour record is still to do, in stage 5.
- The copy into the stage is a 2D `drawImage` in the same frame, and the timing includes a GPU sync. The real compositor may differ.

## Left to the builder

- ~~Which route instrument sources take, from stage 0's numbers.~~ Chosen in Stage 0 results: separate renderers.
- Buffer formats, coverage picture size, how the soft edge is computed.
- The message format between the windows and how images are sent.
- File layout inside `src/map/`.
- How Edit in Studio swaps the composition Studio is editing and puts the user's own back.

## Known risks

- **Many instruments at once is unmeasured.** Stage 0 exists because of this. If neither route holds 60 with four heavy instruments, the answer is smaller sources or a lower target, said plainly.
- **Fractals and Sculpture are heavy.** They may need to run reduced inside small shapes.
- **Drawing a source smaller may change its picture.** Feedback and history buffers are kept at a resolution. Reducing a source to save work could alter the look, not just the cost. Stage 0 checks reduced output against full size before the governor is allowed to use it.
- **Feedback and evolving-ink layers keep history.** They were built to be replayed for export; running forward for hours is a different use and needs the two-hour run to prove it.
- **The laptop picture lags the wall slightly** when the output is open. Outlines are instant; the picture inside them is a few frames behind.
- **Video formats.** The app's own HAP and ProRes exports will probably not play back as Video sources. Instruments play live in Map, so this may not matter; if it does, an MP4 delivery format is the fix.
- **This is a large piece of work.** Eight stages. Stages 1 to 3 give a usable mapper; the rest can be reordered or dropped.

## Sources

- Resolume, Input Selection: https://resolume.com/article/50 (read in full)
- Resolume, Output Transformation: https://resolume.com/article/52 (read in full)
- MadMapper 6, Video Surfaces and Interface Overview: https://docs.madmapper.com/madmapper/6/discover-the-interface/video-surfaces (search summary; the page itself would not load)
- MadMapper masking and mesh warping guides: https://madmapper.com/files/04-Masking.pdf , https://madmapper.com/files/05-Mesh%20Warping.pdf (search summary)
- HeavyM help centre, Magnet and Background Image: https://help.heavym.net/hc/en-us/sections/4407417467666-The-Creative-Tools (search summary; the pages refuse automated reading)
- HeavyM 2 announcement (curves, groups): https://www.heavym.net/?p=9115 (search summary)
- Millumin, mapping and masks: https://help.millumin.com/v4/playback/mapping/ , https://help.millumin.com/v4/playback/masks/ (search summary)
- Isadora, IzzyMap composite mode: https://support.troikatronix.com/support/solutions/articles/13000014932-using-izzymap-s-composite-mapping-mode (search summary) and community forum posts
- TouchDesigner kantanMapper: https://docs.derivative.ca/Palette:kantanMapper (search summary) and forum posts
- Lightform, effects from scan data: https://arxiv.org/abs/2001.00521 (search summary)
- Lime Art Group review, on tracing in Resolume: https://limeartgroup.com/top-5-video-mapping-software/ (search summary; a vendor blog)

Independent user complaints were hard to find; most comparison pages are written by vendors. The "struggle" column leans on forum posts and one review, and should be read as that.
