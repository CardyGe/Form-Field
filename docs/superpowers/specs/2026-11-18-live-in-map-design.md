# Live in Map: a shape can play Live

18 November 2026. Greg's request: "I want to be able to project the live window into the masks… just to have the live view on a shape so I can build the display with that in."

## Intent

Map builds the show, and Live is the camera-reactive art: Paint, Smoke, Relief and Signal Melt. Today they cannot meet, because opening one output closes the other. Greg wants Live to be one more thing a shape can play, so a mapped show can include people's movement next to the instruments.

## Goals

- **A shape can play Live.** Choose it in the look browser the way an instrument is chosen.
- **One camera picture across several shapes** (Greg's choice). With Across group or Across stage, the Live picture is laid over the group or the stage. Movement then travels from mask to mask, just as a shared instrument does today.
- **In scenes** (Greg's choice). A scene can switch a shape between an instrument, its own colour or grid, and Live, with the usual crossfade.
- **Sound on Live** (Greg's choice). The links set up on the Live screen (∿ on Live's sliders, its reactions) keep working while Live plays in Map.
- **The shape's look applies** (Greg's choice). Brightness, tint, opacity links, soft edge, border and Blocker work on Live exactly as on an instrument.
- **One Live look, with Live's own settings** (Greg's choice). Every shape playing Live shows the same look with the same settings and the same camera. These are the Live screen's settings: one set, saved in one place.
- **Adjusted inside Map** (Greg's choice). Leaving Map closes Map's projector, so the Live look is adjusted without leaving Map. Selecting a shape that plays Live shows the Live look's controls in Map's Details: the look, its sliders with ∿ and reactions, the camera, and Clear and Capture empty room. A change there reaches the projector at once and is saved to Live's settings, so the Live screen shows it next time.

## Non-goals

- Different Live looks on different shapes at once.
- Live in Studio's export.
- Mapping the camera's view onto the room's geometry (a person standing in front of mask 3 lighting up mask 3 exactly). The camera picture is placed the way any instrument's is: Fit, Pin, Across group or Across stage, with zoom and move. Greg can line it up by eye.

## Anti-goals

These would be failures even if everything else worked:

- The projector goes black while Live starts, the camera starts, people-finding loads, or the camera is lost. Like an instrument that is not ready, the shape shows its own colour or grid until Live has a picture.
- Live in Map makes the instruments next to it stutter. Live is drawn once a frame for every shape that plays it, never once per shape.
- The Live screen's own settings or file change because Map uses them, other than through the Live screen.

## Constraints

- **The camera.** The projector window may already use the camera (`allowPermission` allows video for every window of ours). The Live screen's preview and Map's projector may both have the camera open; macOS allows that.
- **Size.** Live settings are under 16 KB, so they fit Map's messages.
- **Separate drawing contexts.** Map's projector draws on the graphics card with its own WebGL2 compositor. Live's `LiveRenderer` uses three.js on its own canvas. The compositor already uploads each instrument's canvas as a texture, and Live's canvas is uploaded the same way.

## Approaches considered

1. **The projector window runs Live itself, as one more source** (chosen). A source of a new kind, `live`, sits in the show next to instrument sources. The projector window keeps one Live `Stage` (camera, tracking, look) on its own canvas and uploads that canvas each frame. Shapes share the source like a shared instrument, so placement, Across, scenes, fades and the shape look all work unchanged. There is no added delay and one camera.
2. **Stream Live's own output window into Map.** Rejected: it adds a frame or more of delay, needs both output windows open, and the two outputs cannot share the projector today.
3. **Each shape with its own Live look.** Rejected by Greg in favour of one shared look. It would cost camera tracking per look.

## How it works

- **In the show (version 6):**
  - a new source kind, `{ id, kind: 'live' }`, with at most one per show
  - a shape plays Live by naming it as its `sourceId`
  - version 5 files open unchanged
  - the wire show sends it as `{ id, kind: 'live' }`
- **Choosing it:**
  - a **Live** tile in the look browser, with its own preview picture and a line saying which look it is
  - "Change all linked shapes" and "Make separate" behave as for instruments, except that Make separate on Live keeps Live, since there is only one
  - Speed, Vary, palette, Edit in Studio and Loop with the tempo do not apply to Live; the instrument card shows **Set up in Live** instead
- **Live's controls in Map:**
  - a shape that plays Live shows a **Live** card in Details, in place of the instrument card
  - the card has the look, that look's sliders (each with ∿), Live's reactions and links, the camera (or the test pattern), Mirror, Sensitivity, Clear, and Capture empty room
  - the interaction area and output quality stay on the Live screen
  - the controls are the Live screen's own, taken out of `LivePanel` into shared components, so the two screens never drift apart
  - edits go through the same Live settings as the Live screen and are saved the same way. They are not part of Map's undo, as Live's edits never are
- **Live's settings reach Map's projector:**
  - the studio loads Live's saved settings, and the Live card's changes update them
  - whenever the show has a Live source, the studio sends them to Map's projector in a new message, `liveSettings`
  - the operator screen's own compositor gets them directly
  - the Live screen's links are applied on Map's projector with the same signals Map already sends; their inputs are added to the signals the projector receives
- **On Map's projector:**
  - the compositor keeps one Live `Stage` while the show uses Live anywhere, in the shapes as they are or in any scene. A scene switching back to Live then never waits for the camera. It lets it go (camera off) once nothing in the show uses Live (my call)
  - **the picture fills the place it lands and crops what overflows**, like an instrument on Fit, and never stretches (my call). Live keeps drawing at its own 16:9 size (Live's quality setting), so its looks are unchanged; changing Live to draw at any shape would be a large, risky change to its simulations
  - Clear and Capture empty room reach the projector's Live as messages; the room is captured from the projector's own camera picture
  - the Live screen's Blackout never reaches Map's projector, which has its own (my call)
  - it draws the Live picture at the size of the largest place it lands, as for instruments
  - while the camera starts, or is refused or lost, the shapes play their own fill
  - Freeze holds the Live picture
  - Blackout and the stage corners work as for instruments
- **The operator screen:** with the output closed, the operator's compositor runs Live the same way, so the stage shows it. With the output open, the operator sees the projector's picture as now.
- **The Live screen:** unchanged. Opening Live's own output closes Map's, as today. Since leaving Map closes Map's projector, the two never use the camera at once during a show.
- **Map's own links do not target Live's sliders** (my call). Live's sliders are linked from the Live card's ∿, stored in Live's settings, so two kinds of link never fight over one slider.

## Checks (done when)

- A shape set to Live shows the test pattern's Live look on Map's projector, never a black frame while it starts.
- Two shapes Across stage playing Live show one continuous picture across their shared edge, with one Live drawn.
- A scene switches a shape from an instrument to Live and back with a crossfade.
- A ∿ link on a Live slider, made in the Live card, moves the look on Map's projector with the test beat.
- A slider changed in the Live card changes Map's projector, and the Live screen shows the change afterwards.
- With nothing in the show using Live (no shape and no scene), the projector's camera is off.
- The stage 5 performance measure, with one Live shape added to the eight, stays at the display's rate with the governor at level 0.

## Left to the builder

- How the projector window gets the camera picture when the source is a video file. Files play in the Live screen's preview only today, so Map plays Live from a camera or the test pattern, and a file source shows the shape's own fill with a note.
- Whether the Live `Stage` shares the compositor's canvas or keeps its own. Its own is simplest.
- The Live tile's preview art.
