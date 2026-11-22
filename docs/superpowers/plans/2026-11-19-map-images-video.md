# Map Stage 6 Implementation Plan: images and video in shapes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shape can play a picture (stored in the show) or a short looping video (left on disk), placed, faded, shaded and reacting like an effect.

**Done when:**
- An image tile plays a chosen PNG or JPEG in a shape.
- A video tile plays a chosen MP4 in two shapes, in step.
- Loop with the tempo fits the clip to the beats.
- A missing video shows the shape's fill, with Find…; the projector never goes black.
- `npm run test:map` passes.
- `measure-map --video` (eight effects plus two video shapes) stays at the display's rate with the governor at level 0.

**Architecture:**
- **Images** are a one-layer Studio composition of the `image` kind, made in Map's editor. They play through today's instrument path.
- **Videos** are a new list in the show, `show.videos`.
  - Each has an id beginning `video-`, which shapes name as their `sourceId` (as Live's reserved id).
  - The compositor holds a `VideoSlot` per video playing: an `HTMLVideoElement`, uploaded once a frame when a new frame arrived, cropped to cover.
- **The main process** serves chosen video files through a private `formfield-video:` scheme. It answers only paths on its allowed list.

**Tech Stack:** Electron 45 (`protocol.handle`), React 19, TypeScript, WebGL2, node:test via tsx, Playwright scripted checks, ffmpeg (from `build/media` or the system) to make a test clip.

**Spec:** [docs/superpowers/specs/2026-11-19-map-images-video-design.md](../specs/2026-11-19-map-images-video-design.md), including its "Calls made after the builder check".

**Branch:** `map-stage-5`, in the `three VJ - main` folder. No branch switching.

**Execution:** native. Independent reviews after Task 3 and across the whole work at the end.

## Global Constraints

- **Never black:** the projector never goes black while a video loads, when a file is missing, or when a video switches. The shape plays its own colour or grid instead.
- **Videos:** always looping, always muted.
- **Speed:** 0.1 to 4×. Loop with the tempo offers 1, 2, 4, 8 or 16 beats. Speed is greyed while tempo looping is on.
- **Limits:**
  - 16 videos a show
  - images 8 MB a file and 32 MB a show (by decoded size)
  - image dimensions as Studio (16384 px a side, 64 megapixels)
- **Files the projector may open:** only those with the extensions `.mp4 .mov .m4v .webm`, and only paths on the allowed list. The list holds:
  - files picked in Video… or Find…
  - video paths in a show opened through Open, or restored from the app's own autosave
- **The show file is version 7.** Version 6 files open unchanged.
- **The camera, sound and MIDI rules are unchanged.**
- **Copy, from the spec:**
  - "Plays as 8 beats: the clip is too long for 1" (with the numbers filled in)
  - a missing file names the file and says why it isn't playing
- **Words on screen:** no technical mapping jargon. Studio is unchanged.

## Review Focus

1. **A video file renamed or moved while the show is open.** The shapes go to their fill, the Effect tab says the file can't be found, and Find… restores it for every shape and scene. → Task 5 check.
2. **A show opened on another Mac where the paths don't exist.** Every video shape plays its fill with the note, and nothing hangs or loops trying to load. → Task 3 rule (`VideoSlot` gives up after one error until Find… or Retry); Task 5 check.
3. **A clip with no length yet** (metadata not loaded) **with Loop with the tempo on.** No division by zero: the video plays at Speed until its length is known. → Task 3 test of `videoRate`.
4. **Freeze, then Blackout, then unfreeze, with videos playing.** The videos resume from where they paused, and never jump. → Task 5 check.
5. **A huge image picked while the show is near the 32 MB budget.** The pick is refused with the note; no partial show is saved. → Task 1 test.

---

### Task 1: The show: images and videos as things a shape plays (version 7)

**Files:**
- Modify:
  - `src/map/show.ts`: `VideoSource`, `show.videos`, `isVideoId`, version 7, the readers keeping video ids on shapes and in scenes, `playedBy` covering videos, the image budget
  - `src/map/editor.ts`: `setContent` `image` and `video`; `makeSeparate`, `setSourceSpeed` and `setTempoSync` on video ids; a new `relinkVideo`; `tidy` drops unplayed videos
  - `src/map/targets.ts`: `targetRange` for `source.<videoId>.speed`
- Test: `tests/map-media.test.ts`

**Interfaces:**
- Produces:
  - `export interface VideoSource { id: string; path: string; name: string; speed: number; tempoSync: number | null }`
  - `ShowDocument.videos: VideoSource[]`, with `version: 6 | 7`. Readers accept both versions and write 7.
  - `export const MAX_VIDEOS = 16`, `IMAGE_FILE_LIMIT = 8 * 1024 * 1024`, `IMAGE_SHOW_LIMIT = 32 * 1024 * 1024`
  - `export const isVideoId = (id: string | null) => !!id && id.startsWith('video-')`
  - `export function imageBytes(show: ShowDocument): number`: the decoded size of every image layer's `dataUrl`, counting each distinct `dataUrl` once
  - `setContent` content gains:
    - `{ kind: 'image'; sourceId: string; image: { name: string; dataUrl: string; width: number; height: number } }`: makes a one-layer `image` composition with fit `'cover'`. If a source already holds the same `dataUrl`, the shape shares it.
    - `{ kind: 'video'; videoId: string; path: string; name: string }`
  - Refusals: `'image-too-large'` (file over 8 MB), `'images-over-budget'` (show over 32 MB), `'too-many-videos'`, `'not-a-video'` (bad extension)
  - `{ type: 'relinkVideo'; path: string; to: string; name: string }`: every video whose `path === path` takes the new path

- [ ] **Step 1: Write the failing tests** in `tests/map-media.test.ts`:
  - `a shape plays a picture: a one-layer image composition, cover fit; the same picture picked again is shared, stored once`: `imageBytes` counts it once
  - `a picture over 8 MB, or one that takes the show past 32 MB, is refused and changes nothing`
  - `a shape plays a video; linked shapes share it; Make separate gives this shape its own copy with its own speed`
  - `a video's speed and Loop with the tempo work through setSourceSpeed and setTempoSync; a tempo loop greys nothing in the show (rule only)`: `tempoSync` is set and `speed` is kept
  - `a 17th video is refused; a file without a video extension is refused`
  - `relinkVideo moves every video on the missing path, and scenes keep their shapes on it`
  - `version 7 round-trips; version 6 opens with no videos, unrepaired; a video id with no video in the file is a missing source, repaired`
  - `scenes keep a video a shape plays only in another scene; deleting its last player removes it`
  - `a reaction on a video's speed has a range of 0.1 to 4 and a label naming the video`
- [ ] **Step 2: Run them to verify they fail.** Run: `npx tsx --test tests/map-media.test.ts`. Expected: FAIL (no exports).
- [ ] **Step 3: Implement.** Update the tests that pin version 6 to 7.
- [ ] **Step 4: Run all the tests.** Run: `npx tsc --noEmit -p . && npx tsx --test tests/*.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `Map stage 6, task 1: images and videos in the show (version 7)`

### Task 2: The main process serves chosen video files, and only those

**Files:**
- Create: `electron/video-files.cjs`: the allowed list and the scheme handler
- Modify:
  - `electron/main.cjs`:
    - register `formfield-video` as a privileged, streaming scheme before ready
    - `protocol.handle` it
    - CSP `media-src 'self' blob: formfield-video:`
  - `electron/map.cjs`:
    - handlers `chooseVideo`, which returns `{ path, name } | null`
    - `findVideo(oldName)`, which returns `{ path, name } | null`
    - `openShow` and `loadAutosave` grant the video paths inside the show they load
  - `electron/preload.cjs`, `src/shared/types.ts`: `map.chooseVideo()`, `map.findVideo(name)`
  - `src/map/messages.ts`: `toWire` sends `videos` (with paths); `WireShow.videos`
- Test: `electron/video-files.test.cjs`

**Interfaces:**
- Produces:
  - `videoUrl(path: string): string`, giving `formfield-video://file/<encodeURIComponent(path)>`, in `src/map/videoUrl.ts`
  - `createVideoFiles({ fs }) → { allow(path): boolean; allowFromShow(text: string): number; handle(request: Request): Promise<Response> }`:
    - `allow` refuses non-video extensions
    - `handle` answers 403 for paths not allowed, 404 for missing files, and supports `Range` requests (206) so seeking works

- [ ] **Step 1: Write the failing tests** in `electron/video-files.test.cjs`:
  - `only video extensions can be allowed`
  - `a path not on the list is refused (403), even if it exists`
  - `an allowed file is served with its type and supports byte ranges`
  - `a missing allowed file answers 404`
  - `allowFromShow grants the video paths a show names, and nothing else`: a show naming `/etc/passwd` as a video path is not granted
- [ ] **Step 2: Run them to verify they fail.** Run: `node --test electron/video-files.test.cjs`.
- [ ] **Step 3: Implement**, then wire the scheme, the CSP, the handlers and the preload.
- [ ] **Step 4: Run** `node --test electron/*.test.cjs && npx tsc --noEmit -p . && npx tsx --test tests/*.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `Map stage 6, task 2: the main process serves chosen video files only`

### Task 3: The projector plays videos

**Files:**
- Create:
  - `src/map/videoSlot.ts`
  - `src/map/videoRate.ts`
- Modify:
  - `src/map/compositor.ts`: a `VideoSlot` per video that a shown shape plays, or that is fading
  - `src/map/wall.ts`: `WallState.show.videos`
  - `src/ui/MapOutput.tsx`, `src/ui/MapPanel.tsx`: the operator's own compositor plays them too
- Test: `tests/map-media.test.ts`

**Interfaces:**
- Consumes: `show.videos`, `isVideoId` (Task 1); `videoUrl` (Task 2); `coverCrop` and `LIVE_ASPECT`-style cropping (existing)
- Produces:
  - `videoRate(durationS: number | null, speed: number, beats: number | null, bpm: number): { rate: number; beats: number | null }`:
    - with `beats` null or the duration unknown: `{ rate: speed, beats: null }`
    - otherwise the rate fits the clip to `beats` at `bpm`
    - when that rate falls outside 0.1..4, it uses the nearest of 1, 2, 4, 8, 16 beats whose rate fits, and returns those beats
  - `class VideoSlot { constructor(gpu: Gpu, video: VideoSource); update(video: VideoSource): void; frame(signals: Signals): Texture | null; setFrozen(on: boolean): void; readonly state: 'loading' | 'playing' | 'missing' | 'unplayable'; readonly aspect: number; readonly playsAs: number | null; retry(): void; dispose(): void }`:
    - after one error it stops trying until `retry()`, or until `update()` gives it a new path
    - with tempo sync it restarts on `tempo.beat` multiples of `playsAs`
  - `CompositorStats.videos: Record<string, { state: string; playsAs: number | null }>`

- [ ] **Step 1: Write the failing tests:**
  - `videoRate fits a 2 s clip to 4 beats at 120 BPM at rate 1`
  - `a 12 s clip at 1 beat and 120 BPM is too long: it plays as the nearest beat count that fits`, giving `{ beats: 8 or 16, rate within 0.1..4 }`
  - `an unknown length plays at Speed`
  - `Speed is used when tempo looping is off`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement `videoRate`, `VideoSlot` and the compositor's use of them.**
  - Draw a video shape with its texture through `coverCrop(landingAspect(land), slot.aspect)`.
  - While its state is not `playing`, it plays its own fill. A fade into a video waits only while it is `loading`.
  - Upload only when `requestVideoFrameCallback` has reported a new frame.
- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npx tsx --test tests/*.test.ts && npm run test:map`. Expected: all pass, and no existing check changes.
- [ ] **Step 5: Commit** `Map stage 6, task 3: the projector plays videos, in step, cropped to cover, never black`
- [ ] **Step 6: Independent review** of Tasks 1–3, then fix what it finds.

### Task 4: Image… and Video… on screen

**Files:**
- Modify:
  - `src/ui/mapLooks.ts`: tiles `image` ("Image…", "A picture of your own: PNG or JPEG") and `video` ("Video…", "A short loop of your own: MP4 or MOV"), group "Your own"
  - `src/ui/MapLookBrowser.tsx`, `src/ui/mapActions.ts`: picking them opens the file picker (images in the page, read as a data URL with their size; videos through `map.chooseVideo()`), then dispatches `setContent`; refusals become notes
  - `src/ui/MapEffectTab.tsx`, `src/ui/MapDetails.tsx`:
    - an image shape shows its picture's name, Fit (Cover or Contain), and Replace…
    - a video shape shows:
      - its name and state
      - Speed with ∿, greyed while tempo looping is on
      - Loop with the tempo, with the "Plays as…" note
      - Find… when it is missing or can't play, calling `relinkVideo`
      - Try again
  - `src/ui/MapShapeList.tsx`: a shape plays "Image · <name>" or "Video · <name>"
- Test: `tests/react-screens.test.ts`: `OWN_LOOKS` is `['grid', 'colour', 'live', 'image', 'video']`

- [ ] **Step 1: Write the failing test.**
- [ ] **Step 2: Run it to verify it fails.**
- [ ] **Step 3: Build the tiles, pickers and panels.**
- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npx tsx --test tests/*.test.ts && npm run test:map`.
- [ ] **Step 5: Commit** `Map stage 6, task 4: Image… and Video… tiles, and their panels`

### Task 5: Checks, performance, notes, review

**Files:**
- Modify:
  - `scripts/verify-map.mjs`: new checks; a test clip made with ffmpeg into `work/map/` (a 2 s, 640×360, H.264 MP4 of a moving gradient), and a small test PNG made in the page
  - `scripts/measure-map.mjs`: `--video`
  - `docs/projection-mapping-design-2026-11-16.md`: "Stage 6 results"

- [ ] **Step 1: Add the checks:**
  - `an image tile plays a chosen picture in a shape on the wall`
  - `a video plays in two shapes, in step, and moves`: two samples a moment apart differ, and the two shapes' crops match where the picture is continuous Across stage
  - `Loop with the tempo with the test beat: the clip restarts on the beat`: `__mapStats.videos[id].playsAs` is set
  - `a video renamed on disk falls back to the shape's colour with a note, never black; Find… brings it back`
  - `a show opened with a missing video path plays the fill and says so`
  - `Freeze holds a video; unfreezing resumes it`
- [ ] **Step 2: Run** `npm run test:map`. Expected: `MAP CHECK PASSED`.
- [ ] **Step 3: Run** `node scripts/measure-map.mjs --video`. Expected: about 120 fps, governor level 0.
- [ ] **Step 4: Write the results and known limits;** the whole-work review and its fixes.
- [ ] **Step 5: Commit, then relaunch the app:**
  ```bash
  open -n -a "/Users/grego/Documents/ChatGPT/three VJ - main/node_modules/electron/dist/Electron.app" --args "/Users/grego/Documents/ChatGPT/three VJ - main"
  ```
