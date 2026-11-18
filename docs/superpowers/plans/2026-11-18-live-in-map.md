# Live in Map Implementation Plan: a shape can play Live

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any Map shape can play Live (the Live screen's one look, one camera), placed like an instrument, in scenes, reacting to sound, and adjusted from a Live card in Map's Details.

**Done when:**
- A shape set to Live shows Live on Map's projector, never a black frame while it starts.
- Two shapes Across stage show one continuous Live picture.
- A scene switches a shape between an instrument and Live with a crossfade.
- A ∿ link and a slider in the Live card change the look on the projector.
- With nothing in the show using Live, the projector's camera is off.
- The stage 5 performance measure, plus one Live shape, stays at the display's rate with the governor at level 0.

**Architecture:**
- **In the show:** Live is a reserved source id, `LIVE_SOURCE_ID = 'live'`, which a shape names as its `sourceId`. It has no entry in `show.sources`.
  - This is a deviation from the design's "source of kind `live`" that does the same thing: at most one per show, and shared, so Across, scenes and fades work.
  - It avoids changing the 49 places that read `source.project`.
  - The show moves to version 6.
- **On the projector:** a `LiveSlot` in the compositor holds one Live `Stage` on its own canvas. The canvas is uploaded each frame like an instrument's and cropped to cover the place it lands.
- **Settings:** Live's settings are the Live screen's own. A `useLiveSettings` hook loads and saves them for Map, and they reach the projector in a `liveSettings` message.
- **The Live card:** its controls are the Live screen's look controls, taken out of `LivePanel` into a shared component.

**Tech Stack:** Electron 45, React 19, TypeScript, three.js (Live), WebGL2 (Map compositor), node:test via tsx, Playwright scripted checks.

**Spec:** [docs/superpowers/specs/2026-11-18-live-in-map-design.md](../specs/2026-11-18-live-in-map-design.md)

**Branch:** `map-stage-5`, in the `three VJ - main` folder. It is already merged into `main`; this work merges again when done. No branch switching.

**Execution:** native. Independent reviews after Task 3 and across the whole work at the end.

## Global Constraints

- **The projector:**
  - never a black frame while Live starts, the camera starts, people-finding loads, or the camera is refused or lost; the shape plays its own fill until Live has a picture
  - Live is drawn once a frame for every shape that plays it, never once per shape
- **Live's settings** change only through the Live card or the Live screen. Map's undo never covers them.
- **Live's picture** fills the place it lands and crops what overflows; it never stretches. Live keeps drawing at its own 16:9 size (its quality setting).
- **The camera** runs on the projector while the show uses Live anywhere (shapes or any scene) and is let go once nothing does.
- **Kept apart:** the Live screen's Blackout never reaches Map's projector. Map's own links never target Live's sliders.
- **Video files:** a video file as Live's source plays Live in Map as the shape's own fill, with a note in the Live card. Map plays Live from a camera or the test pattern.
- **On screen:** no technical mapping jargon. Studio's loops, seeking and export are unchanged, and Studio's own project is never overwritten.

## Review Focus

1. **The camera refused or unplugged mid-show.** The Live shapes fall back to their own fill, and come back when the camera does (Retry in the Live card). → Task 3 check, in Task 5.
2. **Live's quality changed on the Live screen while Map plays Live** (1080 ↔ 720). The picture resizes without a black frame. → Task 3: `LiveSlot` keeps the last texture until the resized canvas has drawn.
3. **The look switched in the Live card** (for example Paint to Smoke). The new look starts fresh, as on the Live screen, and the shapes keep their last picture until it has drawn once. → Task 5 check.
4. **Opening Live's own output while Map plays Live.** Map's output closes, as now, and the camera is let go from the Map window. → Task 5 check.
5. **A show using Live opened on a Mac with no camera access.** The shapes play their fill, and the Live card says how to allow the camera. → Task 4 copy and Task 5 check.

---

### Task 1: The show: a shape can play Live (version 6)

**Files:**
- Modify:
  - `src/map/show.ts`: `LIVE_SOURCE_ID`, version 6, reading `sourceId: 'live'` in shapes and scene states, `usesLive`
  - `src/map/editor.ts`: `setContent` `{ kind: 'live' }`, `makeSeparate`, `shareSource`
  - `src/map/messages.ts`: `toWire` adds `usesLive`
- Test: `tests/map-live.test.ts`

**Interfaces:**
- Produces:
  - `export const LIVE_SOURCE_ID = 'live'`
  - `export function usesLive(show: Pick<ShowDocument, 'shapes' | 'scenes'>): boolean`, true when a shape or a scene state names `LIVE_SOURCE_ID`
  - `ShowDocument.version: 6`
  - `WireShow` gains `usesLive: boolean`
  - `EditAction` `setContent` content gains `{ kind: 'live'; linked?: boolean }`

- [ ] **Step 1: Write the failing tests** in `tests/map-live.test.ts`:
  - `a shape plays Live; linked shapes all change; Live is never in sources`
    - after `addShape` a and b and a shared instrument, `setContent(a, { kind: 'live', linked: true })` gives both `sourceId === 'live'`
    - `show.sources` no longer has the instrument
    - `linked: false` changes only a
  - `Make separate on a Live shape keeps Live`: `makeSeparate` leaves `sourceId === 'live'`
  - `Share with a Live shape plays Live`
  - `a blocker never plays Live`: `setBlocker` true sets `sourceId` null
  - `scenes keep Live`:
    - `addScene`, then set to Live, `addScene`, then set to colour
    - switching back gives `sourceId === 'live'`
    - `usesLive(show)` is true while only a scene names it
  - `version 6 round-trips; version 5 files open unrepaired; a version 5 file naming 'live' as a source id loses it, repaired`: in version 5, `'live'` was only a missing source
  - `the wall is told whether the show uses Live`: `toWire(show).usesLive` follows `usesLive`

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `npx tsx --test tests/map-live.test.ts`. Expected: FAIL (no `LIVE_SOURCE_ID`).

- [ ] **Step 3: Implement in `show.ts`, `editor.ts` and `messages.ts`.** In the shape reader and the scene-state reader, a `sourceId` equal to `LIVE_SOURCE_ID` is kept in version 6 files without a matching source. `dropUnplayed` never needs it. Update the existing tests that pin `version: 5` to 6.

- [ ] **Step 4: Run all the tests**
  Run: `npx tsc --noEmit -p . && npx tsx --test tests/*.test.ts`. Expected: all pass.

- [ ] **Step 5: Commit** `Live in Map, task 1: a shape can play Live (show version 6)`

### Task 2: Live's settings reach Map and its projector

**Files:**
- Create: `src/ui/useLiveSettings.ts`
- Modify:
  - `src/ui/useLive.ts`: uses `useLiveSettings` for loading, saving and the unsaved flush, so the two screens share one way of keeping them
  - `src/map/messages.ts` and `electron/map.cjs`: messages `liveSettings`, `liveClear`, `liveCaptureRoom`
  - `src/map/wall.ts`: `WallState.live: LiveSettings | null`
  - `src/ui/useMap.ts`: sends `liveSettings` while `usesLive(show)`, and adds Live's link inputs to the signals sent
- Test: `tests/map-live.test.ts`, `tests/map-messages.test.ts` (parity rows)

**Interfaces:**
- Consumes: `usesLive`, `LIVE_SOURCE_ID` (Task 1)
- Produces:
  - `useLiveSettings(onError: (m: string) => void): { settings: LiveSettings | null; update: (change: (s: LiveSettings) => LiveSettings) => void }`: loaded once, validated with `validateLiveSettings`, saved 500 ms after a change and on unmount
  - `MapMessage` gains:
    - `{ type: 'liveSettings'; settings: LiveSettings | null }` (16 KB limit, as for other messages; checked with `validateLiveSettings` by the wall)
    - `{ type: 'liveClear' }`
    - `{ type: 'liveCaptureRoom' }`
  - `export function wallInputs(show: ShowDocument, live: LiveSettings | null): Set<string>`: Map's link inputs, plus `tempo.beat` and `tempo.phase`, plus Live's link inputs when `usesLive(show)`
  - `useMap` returns `live: LiveSettings | null`, `updateLive`, `clearLive()` and `captureLiveRoom()`

- [ ] **Step 1: Write the failing tests**
  - `the wall keeps Live's settings; damaged ones are repaired; null lets Live go`: `applyMapMessage` with `liveSettings`
  - `the main process and the page agree on the Live messages`: parity rows for the three types, plus one over 16 KB refused
  - `the wall hears Live's link inputs only while the show uses Live`: `wallInputs`

- [ ] **Step 2: Run them to verify they fail.** Run: `npx tsx --test tests/map-live.test.ts tests/map-messages.test.ts`

- [ ] **Step 3: Implement.** `useMap` sends `liveSettings` when the output opens, whenever the settings change, and once with `null` when the show stops using Live. The per-frame signal filter in `useMap` uses `wallInputs`. Live's subscription in `useMap` is active when `usesLive(show)` and Live has links.

- [ ] **Step 4: Run all the tests, and `node --test electron/*.test.cjs`.** Expected: all pass.

- [ ] **Step 5: Commit** `Live in Map, task 2: Live's settings and actions reach Map's projector`

### Task 3: The projector plays Live

**Files:**
- Create: `src/map/liveSlot.ts`
- Modify:
  - `src/live/LiveRenderer.ts`: constructor option `{ preserveDrawingBuffer?: boolean }`, so another context can copy its canvas after it draws
  - `src/live/Stage.ts`: accepts that option. Add `ready(): boolean`, true once its source is running and it has drawn a frame
  - `src/map/placement.ts`: `coverCrop`
  - `src/map/compositor.ts`: holds a `LiveSlot`
  - `src/ui/MapOutput.tsx`: passes the Live messages
  - `src/ui/MapPanel.tsx`: the operator's own compositor gets `map.live`
- Test: `tests/map-live.test.ts` (crop maths and slot rules)

**Interfaces:**
- Consumes: `WallState.live`, the Live messages, `wireShow.usesLive` (Tasks 1 and 2)
- Produces:
  - `export function coverCrop(landAspect: number, pictureAspect: number): H3`: maps the landing's 0..1 square onto the centred part of the picture that covers it
  - `class LiveSlot { constructor(gpu: Gpu); setSettings(s: LiveSettings | null): void; setSignals(s: Signals): void; setFrozen(on: boolean): void; clear(): void; captureRoom(): void; frame(): Texture | null; readonly state: SourceState; dispose(): void }`
    - `frame()` uploads the Live canvas and returns the texture, or the last good texture, or null before the first picture
  - `MapCompositor.setLive(settings: LiveSettings | null)`, `liveClear()`, `liveCaptureRoom()`
  - `window.__mapStats.live: { running: boolean; state: string } | null`, for the checks

- [ ] **Step 1: Write the failing tests**
  - `a wide picture on a square shape is cropped at its sides, never stretched`: `coverCrop(1, 16/9)` maps x 0..1 to 0.21875..0.78125 and y to 0..1
  - `a tall shape crops the top and bottom`: `coverCrop(0.5, 16/9)`
  - `a picture as wide as its shape is unchanged`: `coverCrop(16/9, 16/9)` is the identity

- [ ] **Step 2: Run them to verify they fail.** Run: `npx tsx --test tests/map-live.test.ts`

- [ ] **Step 3: Implement `coverCrop`, then `LiveSlot` and the compositor's use of it.**
  - **Lifetime:** the compositor creates the slot when the show uses Live (`usesLive` on the full show, `wire.usesLive` on the wall) and settings are present. It disposes it (camera off) when either stops.
  - **Drawing a Live shape:**
    - `content` is the slot's texture, with `inv` composed with `coverCrop(landing aspect, 16/9)`
    - the shape's own fill shows while `frame()` returns null, or while the source is a video file
    - fades and glides treat `LIVE_SOURCE_ID` like a source, with kinds `'live'`
  - **Freeze** stops the Live renderer's loop and keeps the last texture. **Blackout** comes from Map only.

- [ ] **Step 4: Run all the tests and the build.** Run: `npx tsc --noEmit -p . && npx tsx --test tests/*.test.ts && npm run test:map`. Expected: all pass, and no existing check changes.

- [ ] **Step 5: Commit** `Live in Map, task 3: the projector plays Live, cropped to cover, never black while it starts`

- [ ] **Step 6: Independent review** of Tasks 1–3, then fix what it finds.

### Task 4: The Live card and the Live tile

**Files:**
- Create:
  - `src/ui/LiveLookControls.tsx`: the look column of `LivePanel` (the look select, each look's controls with ∿, palettes, starts, the reactions and links section), taken out unchanged
  - `src/ui/MapLiveCard.tsx`
- Modify:
  - `src/ui/LivePanel.tsx`: uses `LiveLookControls`; it looks and behaves as before
  - `src/ui/MapDetails.tsx`: a Live shape shows `MapLiveCard` in place of `ContentCard`
  - `src/ui/MapLookBrowser.tsx`: a **Live** tile in a group "Live", `value: 'live'`, `description: 'The Live screen’s look, from the camera'`
  - `src/ui/mapActions.ts`: `play()` handles `'live'`
- Test: `tests/react-screens.test.ts` (the browser's value list includes `'live'`)

**Interfaces:**
- Consumes: `useMap().live`, `updateLive`, `clearLive`, `captureLiveRoom`, `engine`, `startEngine`, `signals` (Task 2)
- Produces:
  - `LiveLookControls({ settings, update, reactFor, engine, meter, onStart, onClear, onError })`, with the props the Live screen already passes
  - `MapLiveCard({ map, shape, locked })`, containing:
    - the source (camera list or test pattern), Mirror and Sensitivity
    - `LiveLookControls`
    - Clear, Capture empty room (when Use empty room is on) and Retry (when the camera is lost or refused)
    - "Change all linked shapes" and Share with, as on the instrument card
    - the note for a video file: `Video files play on the Live screen only. Choose a camera or the test pattern to show Live here.`
    - the note for camera access: the Live screen's `CAMERA_OFF` text

- [ ] **Step 1: Write the failing test** `the look browser offers Live`.
- [ ] **Step 2: Run it to verify it fails.**
- [ ] **Step 3: Take out `LiveLookControls`, then build `MapLiveCard`, the tile and `play('live')`.** The Live card's slider changes go through `updateLive`, never `dispatch`.
- [ ] **Step 4: Run the tests and the Live check.** Run: `npx tsx --test tests/*.test.ts && npm run test:map`. Expected: all pass, including the existing Live check.
- [ ] **Step 5: Commit** `Live in Map, task 4: the Live card in Details and the Live tile`

### Task 5: Checks, performance, design notes

**Files:**
- Modify:
  - `scripts/verify-map.mjs`: new checks
  - `scripts/measure-map.mjs`: `--live`, a ninth shape playing Live on the test pattern
  - `docs/projection-mapping-design-2026-11-16.md`: "Live in Map results" and known limits

- [ ] **Step 1: Add the checks**, with Live's source set to the test pattern from the Live card:
  - `a shape playing Live shows Live on the wall, never black while it starts`: sample every 100 ms from choosing Live until the picture moves; no sample is black inside the shape
  - `two shapes Across stage playing Live show one continuous picture`: as the instrument check, with one Live drawn (`__mapStats.live.running`)
  - `a scene switches a shape from an instrument to Live and back, with a crossfade`
  - `∿ on a slider in the Live card, with the test beat, moves the look on the wall`: read the wall's `__studioTest.liveDrawn()`
  - `a slider changed in the Live card changes the wall, and the Live screen shows it afterwards`
  - `with nothing using Live, the wall's camera is off`: `__mapStats.live === null`
  - `opening Live's own output closes Map's`
- [ ] **Step 2: Run** `npm run test:map`. Expected: `MAP CHECK PASSED`.
- [ ] **Step 3: Run** `node scripts/measure-map.mjs --live`. Expected: about 120 fps, governor level 0 throughout.
- [ ] **Step 4: Write the results and known limits**, then the whole-work review and its fixes.
- [ ] **Step 5: Commit, then relaunch the app:**
  ```bash
  open -n -a "/Users/grego/Documents/ChatGPT/three VJ - main/node_modules/electron/dist/Electron.app" --args "/Users/grego/Documents/ChatGPT/three VJ - main"
  ```
