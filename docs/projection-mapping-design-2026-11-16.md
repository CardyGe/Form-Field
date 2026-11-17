# Map: projection mapping design

16 November 2026 · Form & Field 0.16.0 · Design for approval. Nothing is built and nothing here has been measured.

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
- A composition holds at most four layers (`project.ts:859`, `StudioRenderer.renderFrame`).
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

- **Outline drives the instrument**: the shape's outline is handed to instruments that support "flow around", "emit inside" and "trace edges", so ink grows from the edges of the actual object.
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
- **Swapping content** keeps the old source drawing until the new one reports ready, then fades.

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
| **1. Stage and first shapes** | Map section, show file and autosave, output window, compositor, Colour sources, rectangle and four-corner shapes, select / move / points / nudge / exact positions, wall crosshair, Test grid, Identify, Blackout, undo. | Greg lines four-corner shapes up on real objects with a projector. |
| **2. Instruments in shapes** | Instrument sources, Library and presets on a shape, own settings per shape, Vary, palette, speed, Edit in Studio and back, Fit placement, sizing to the wall, the frame-rate governor, fade on change. | Eight shapes play four instruments at the measured rate, and editing one never disturbs the others. |
| **3. The full drawing kit** | Pen with curves, triangle, ellipse, add / remove / convert points, holes, Snap, Photo, duplicate / flip / mirror, Make a grid, groups, lock / hide / solo, soft edge, border, Blockers. | A photographed scene of about 20 pieces is traced and aligned in one sitting. |
| **4. Placement** | Pin, Across group, Across stage, Share with / Make separate, stage corners, brightness and tint. | A grid pinned to an angled box face looks square to the eye; nudging the projector is fixed with four handles. |
| **5. Scenes** | Save, switch, fade, keys 1 to 9, per-scene fade time; two-hour run. | A three-scene show runs for two hours and switches without a black frame. |
| **6. More content** | Image, Video and Live look sources. | Smoke plays inside one shape while instruments play in the others, with the camera rule intact. |
| **7. Wild options** | Outline drives the instrument, Stagger, Vary each, palette shift, border runs, scene auto-advance. | Each works alone and is switched off by default. |
| **Later, own designs** | Sound and MIDI control. Curved objects. More projectors. | — |

## Left to the builder

- Which route instrument sources take, from stage 0's numbers.
- Buffer formats, coverage picture size, how the soft edge is computed.
- The message format between the windows and how images are sent.
- File layout inside `src/map/`.
- How Edit in Studio swaps the composition Studio is editing and puts the user's own back.

## Known risks

- **Many instruments at once is unmeasured.** Stage 0 exists because of this. If neither route holds 60 with four heavy instruments, the answer is smaller sources or a lower target, said plainly.
- **Fractals and Sculpture are heavy.** They may need to run reduced inside small shapes.
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
