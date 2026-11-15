# Live Mode and Paint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Live section that turns webcam movement into projected paint on a second display, in real time.

**Architecture:** Everything new lives in `src/live/` with its own real-time `LiveRenderer`; it never imports `StudioRenderer`. Tracking publishes plain textures through one `TrackingFeed` interface that looks read from. The renderer runs in the operator window until the artwork window opens, then runs in the artwork window; the main process relays settings and a small preview between them.

**Tech Stack:** Electron 45, three 0.187 (WebGL2, half-float and float targets), React 19, TypeScript, `node:test` via `tsx`, Playwright `_electron` for the scripted run.

**Spec:** `docs/live-mode-design-2026-11-15.md`

## Global Constraints

- Work on a branch named `live-mode`. Commit messages start with `Live: `.
- Camera video is never saved, sent anywhere, or shown unprocessed in the artwork window.
- Nothing in `src/rendering/`, `src/core/`, `electron/export-manager.cjs` or the project file format changes. `npm test` must pass unchanged after every task.
- Permissions: only camera video, only for this app's own windows. Everything else stays denied.
- Output target: 1920 × 1080 at 60 frames per second, measured, never assumed.
- Live settings are stored in `live-settings.json` in Electron's `userData`, not in a project.
- Tracking is exposed only through `TrackingFeed`; looks must not reach into `Tracking` internals.
- Interface text is plain: "Live", "Paint", "Open output", "Blackout", "Clear". No jargon in labels.
- Paint draws movement only. It never draws the camera image.

## Review Focus

1. **Camera access refused or no camera present.** Live shows a message naming System Settings › Privacy & Security › Camera and keeps the app usable. (Task 3, Task 8)
2. **Camera unplugged while running.** The picture keeps rendering and fading; the source reports `lost`; the operator sees it and can pick another camera. (Task 3)
3. **Projector unplugged while the artwork window is open.** The artwork window closes and rendering returns to the operator window without a crash. (Task 7)
4. **A long stall (sleep, window drag, dropped frames).** One oversized time step must not fling particles or wipe the canvas. (Task 1)
5. **A damaged or outdated settings file.** Live starts with defaults; the file is not a crash. (Task 1, Task 7)

---

### Task 1: Settings and tracking maths

**Files:**
- Create: `src/live/settings.ts`, `src/live/maths.ts`
- Test: `tests/live.test.ts`

**Interfaces:**
- Produces:

```ts
// settings.ts
export interface Box { left: number; right: number; bottom: number; top: number } // 0..1, origin bottom-left
export interface LiveSettings {
  version: 1;
  source: { kind: 'camera' | 'file' | 'test'; deviceId: string | null };
  mirror: boolean;                 // default true
  box: Box;                        // default 0,1,0,1
  sensitivity: number;             // 0.2..4, default 1
  noiseFloor: number;              // 0..0.1, default 0.02
  display: number | null;          // Electron display id for the artwork window
  quality: 720 | 1080;             // default 1080
  paint: Record<PaintKey, number>;
  palette: string[];               // six hex colours, default HOT_SIGNAL from src/core/palettes
}
export type PaintKey = 'response' | 'strokeLength' | 'bristle' | 'spread' | 'fadeSeconds' | 'colourChange' | 'ground';
export interface LiveControl { key: PaintKey; label: string; min: number; max: number; step: number; default: number }
export const PAINT_CONTROLS: LiveControl[];
export function defaultLiveSettings(): LiveSettings;
export function validateLiveSettings(value: unknown): LiveSettings; // never throws; repairs field by field

// maths.ts
export const MAX_STEP = 1 / 30;
export function capStep(seconds: number): number;                 // clamp to 0..MAX_STEP; NaN -> 0
export function fadeFactor(step: number, fadeSeconds: number): number; // exp(-3*step/fadeSeconds): 5% left after fadeSeconds
export function boxWeight(x: number, y: number, box: Box): number;     // 1 inside, 0 outside, 0.025 soft edge
export function birthChance(motion: number, response: number, step: number): number; // clamp(motion*response*step*40, 0, 1)
```

`PAINT_CONTROLS` values (label, min, max, step, default): Movement response 0–3, 0.01, 1 · Stroke length 0–1, 0.01, 0.5 · Bristle 0–1, 0.01, 0.6 · Spread 0–1, 0.01, 0.35 · Fade time 2–120, 1, 30 · Colour change 0–1, 0.01, 0.3 · Ground (0 black, 1 white) 0–1, 1, 0.

- [ ] **Step 1: Write the failing tests** in `tests/live.test.ts`

```ts
test('defaults validate to themselves', () => assert.deepEqual(validateLiveSettings(defaultLiveSettings()), defaultLiveSettings()));
test('damaged settings fall back field by field', () => {
  const s = validateLiveSettings({ version: 9, mirror: 'no', paint: { fadeSeconds: 9999, response: 2 }, box: { left: .8, right: .2 }, palette: ['red'] });
  const d = defaultLiveSettings();
  assert.equal(s.mirror, d.mirror); assert.equal(s.paint.fadeSeconds, 120); assert.equal(s.paint.response, 2);
  assert.deepEqual(s.box, d.box); assert.deepEqual(s.palette, d.palette);
});
test('garbage is defaults', () => { for (const v of [null, 'x', 7, []]) assert.deepEqual(validateLiveSettings(v), defaultLiveSettings()); });
test('a stall is capped', () => { assert.equal(capStep(5), MAX_STEP); assert.equal(capStep(-1), 0); assert.equal(capStep(NaN), 0); assert.equal(capStep(.01), .01); });
test('fade leaves 5% after the fade time', () => assert.ok(Math.abs(fadeFactor(30, 30) - Math.exp(-3)) < 1e-12));
test('box weight', () => { const b = { left: .25, right: .75, bottom: 0, top: 1 }; assert.equal(boxWeight(.5, .5, b), 1); assert.equal(boxWeight(.1, .5, b), 0); });
test('still input births nothing', () => { assert.equal(birthChance(0, 3, MAX_STEP), 0); assert.equal(birthChance(1, 3, MAX_STEP), 1); });
```

- [ ] **Step 2:** Run `npx tsx --test tests/live.test.ts`. Expected: fails, modules not found.
- [ ] **Step 3:** Implement both modules. A box with `left >= right` or `bottom >= top` is replaced by the default box. Numbers out of range are clamped; non-numbers take the default.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit `Live: settings and tracking maths`.

### Task 2: Render helpers, look contract and the bare renderer

**Files:**
- Create: `src/live/passes.ts`, `src/live/look.ts`, `src/live/LiveRenderer.ts`, `src/live/test-source.ts`
- Create: `scripts/verify-live.mjs` (first stage)

**Interfaces:**
- Produces:

```ts
// passes.ts
export class Passes {
  constructor(renderer: THREE.WebGLRenderer);
  material(fragment: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial; // full-screen, NoBlending, varying vUv
  draw(material: THREE.ShaderMaterial, output: THREE.WebGLRenderTarget | null): void;
  target(width: number, height: number, options?: { float?: boolean; nearest?: boolean; count?: number }): THREE.WebGLRenderTarget; // half-float unless float
  dispose(): void;
}
export class Pair { read: THREE.WebGLRenderTarget; write: THREE.WebGLRenderTarget; swap(): void; dispose(): void }

// look.ts
export interface TrackingFeed {
  readonly camera: THREE.Texture;   // mirrored camera image, up to 1280x720
  readonly flow: THREE.Texture;     // 320x180: rg = movement in uv per camera frame, b = strength 0..1, box already applied
  readonly fresh: boolean;          // true on display frames where a new camera frame was analysed
}
export interface Look {
  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void;
  readonly output: THREE.Texture;   // linear colour, artwork size
  resize(width: number, height: number): void;
  clear(): void;
  dispose(): void;
}

// LiveRenderer.ts
export interface FrameSource { readonly element: TexImageSource | null; readonly frameId: number } // frameId rises with each new camera frame
export class LiveRenderer {
  constructor(canvas: HTMLCanvasElement, source: FrameSource);
  settings: LiveSettings;
  blackout: boolean;
  view: 'art' | 'tracking';         // 'tracking' is the operator setup view; never set in the artwork window
  start(): void; stop(): void; clear(): void; dispose(): void;
  stats(): { fps: number; worstMs: number; frames: number }; // since the last call
}

// test-source.ts
export class TestSource implements FrameSource { constructor(width?: number, height?: number); advance(seconds: number): void } // 640x360 2D canvas: two bright discs sweeping on fixed paths at 30 frames per second
```

`LiveRenderer` uses `requestAnimationFrame`, measures the step with `performance.now()` and passes it through `capStep`. Its final pass converts linear to sRGB, applies `blackout` (pure black), and sizes the drawing buffer to `settings.quality` at 16:9. In this task it has no tracking and no look: it draws the source element mirrored, so the pipeline can be proven end to end.

- [ ] **Step 1: Write `scripts/verify-live.mjs`** following the launch pattern of `scripts/verify-tile-edges.mjs` (esbuild bundle of `src/live`, hidden Electron window via Playwright). Stage one asserts: with `TestSource`, after 30 frames the canvas read back is not uniform; with `blackout = true` every pixel is 0,0,0; `stats().frames >= 30`.
- [ ] **Step 2:** Run `node scripts/verify-live.mjs`. Expected: fails, `LiveRenderer` missing.
- [ ] **Step 3:** Implement the four modules. `Passes.material` mirrors `material()` at `src/rendering/StudioRenderer.ts:90`; the constructor checks `EXT_color_buffer_float` and throws the same message as `StudioRenderer.ts:228` when missing.
- [ ] **Step 4:** Run `node scripts/verify-live.mjs` and `npm run build`. Expected: both pass.
- [ ] **Step 5:** Commit `Live: render helpers, look contract and bare renderer`.

### Task 3: Camera and file sources

**Files:**
- Create: `src/live/source.ts`
- Test: `tests/live.test.ts` (state rules only)

**Interfaces:**
- Consumes: `FrameSource` (Task 2), `LiveSettings['source']` (Task 1).
- Produces:

```ts
export type SourceState =
  | { status: 'idle' } | { status: 'starting' } | { status: 'running'; label: string; width: number; height: number }
  | { status: 'refused' } | { status: 'none' } | { status: 'lost' } | { status: 'error'; message: string };
export function stateFromError(name: string): SourceState; // NotAllowedError->refused, NotFoundError/OverconstrainedError->none, else error
export class LiveSource implements FrameSource {
  onState: (state: SourceState) => void;
  listCameras(): Promise<{ deviceId: string; label: string }[]>;
  openCamera(deviceId: string | null): Promise<void>; // video only; ideal 1280x720, 60 fps falling back to 30
  openFile(file: File): Promise<void>;                 // object URL, muted, looping
  close(): void;                                       // stops tracks, revokes URLs
}
```

`frameId` advances from `requestVideoFrameCallback`. The camera track's `ended` event sets state `lost`. `openCamera` never requests audio.

- [ ] **Step 1:** Add tests: `stateFromError('NotAllowedError')` is `refused`; `NotFoundError` and `OverconstrainedError` are `none`; `'Boom'` is `error`.
- [ ] **Step 2:** Run `npx tsx --test tests/live.test.ts`. Expected: fails.
- [ ] **Step 3:** Implement `source.ts`.
- [ ] **Step 4:** Run `npm test`. Expected: pass.
- [ ] **Step 5:** Commit `Live: camera and file sources`.

### Task 4: Movement tracking

**Files:**
- Create: `src/live/tracking-shaders.ts`, `src/live/Tracking.ts`
- Modify: `src/live/LiveRenderer.ts`, `scripts/verify-live.mjs`

**Interfaces:**
- Consumes: `Passes`, `Pair`, `FrameSource`, `TrackingFeed`, `boxWeight` semantics.
- Produces: `export class Tracking implements TrackingFeed { constructor(passes: Passes); update(source: FrameSource, settings: LiveSettings): void; dispose(): void }`

Passes, run only when `source.frameId` changed:
1. **Mirror/copy** the source to a 1280 × 720 target (flip x when `settings.mirror`). This is `camera`.
2. **Flow** at 320 × 180 from the current and previous camera targets: 5 × 5 window, taps two source pixels apart, least-squares on luminance gradients with the frame difference soft-thresholded by `noiseFloor`, regulariser 0.002, result clamped to ±0.025 uv. Same method as `/Users/grego/Downloads/PRESENCE_Party/source/party_flow.frag`, rewritten in GLSL ES 1.00 for three's `ShaderMaterial`. Strength (`b`) is `clamp(sum|difference| * 0.4 * sensitivity, 0, 1)`. Multiply all channels by the soft box (0.025 edge).
3. **Smooth** over time: `mix(previousFlow, newFlow, 0.6)`.

`LiveRenderer` owns a `Tracking`, calls `update` each display frame, and when `view === 'tracking'` draws the camera with flow overlaid (direction as hue, strength as brightness) and the box outlined.

- [ ] **Step 1:** Extend `verify-live.mjs`: read back `flow` (via a debug hook on `window.__studioTest`, set only when it already exists). With `TestSource`: mean strength inside the discs' path > 0.1; with a frozen source for 30 frames, mean strength < 0.005; with `box.right = 0.5`, strength in the right half is exactly 0; the sign of mean `r` where a disc moves right is positive and flips when `mirror` is toggled.
- [ ] **Step 2:** Run it. Expected: fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `node scripts/verify-live.mjs` and `npm test`. Expected: pass.
- [ ] **Step 5:** Commit `Live: movement tracking`.

### Task 5: Paint

**Files:**
- Create: `src/live/paint-shaders.ts`, `src/live/Paint.ts`
- Modify: `src/live/LiveRenderer.ts` (use `Paint` as the look for `view === 'art'`), `scripts/verify-live.mjs`

**Interfaces:**
- Consumes: `Look`, `TrackingFeed`, `Passes`, `Pair`, `PAINT_CONTROLS`, `fadeFactor`, `birthChance`.
- Produces: `export class Paint implements Look { constructor(passes: Passes, width: number, height: number) }`

Mechanism:
- **Particle state:** 256 × 256 float targets, two attachments, ping-ponged. A: position xy (uv), velocity xy (uv per second). B: age 0..1, life seconds, colour position 0..1, random seed.
- **Birth:** a dead particle picks a random uv each frame; it is born there with probability `birthChance(flow.b, response, step)`. Velocity is the flow direction rotated by a random angle within ±`spread` × 0.6 radians, speed `(0.15 + 0.85 × random) × strokeLength × 1.2` uv per second scaled by flow magnitude ÷ 0.025. Life 0.25–0.9 s. Colour position `fract(time × colourChange × 0.15 + uv.x × 0.35 + uv.y × 0.2 + hash × 0.08)`.
- **Flight:** position += velocity × step; velocity ×= exp(−3 × step); age += step ÷ life; dies at age 1 or off canvas.
- **Stamp:** one instanced quad per particle drawn into the paint canvas with normal alpha blending at full opacity, stretched from the previous to the current position, width `mix(6, 1.2, bristle)` pixels at 1080 high, alpha tapering along its length and to 0 over the last 30% of life. Colour is the six-colour palette sampled cyclically at the colour position, linear.
- **Canvas:** half-float pair at artwork size. Each frame before stamping: `canvas = mix(ground, advected, fadeFactor(step, fadeSeconds))` where `advected` samples the previous canvas displaced by `flow.rg × 0.5` (wet drift). Ground is black or white from `paint.ground`.
- `clear()` fills the canvas with ground and kills every particle. Nothing reads `feed.camera`.

- [ ] **Step 1:** Extend `verify-live.mjs` with `TestSource`, 180 frames: more than 3% of pixels differ from ground; the painted pixels' centroid lies within the discs' path band; fewer than 1% of pixels are painted in a region the discs never cross; with a frozen source and `fadeSeconds = 2`, after 240 further frames the maximum difference from ground is below 0.02; `clear()` gives exactly ground; with `ground = 1` an untouched corner is white; a 5-second stall injected through a test hook leaves every particle inside 0..1 and the canvas not wiped. Save `work/live/paint.png` for review by eye.
- [ ] **Step 2:** Run it. Expected: fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `node scripts/verify-live.mjs`, `npm test`, `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit `Live: Paint look`.

### Task 6: Camera permission, policy and packaging

**Files:**
- Create: `electron/live.cjs`, `electron/live.test.cjs`
- Modify: `electron/main.cjs:206-208` (permission handlers and policy), `package.json` (`build.mac.extendInfo`, `build.files`)

**Interfaces:**
- Produces (in `electron/live.cjs`):

```js
allowPermission(permission, details, isOurWindow)        // true only for 'media' with details.mediaTypes exactly ['video'] and isOurWindow
allowPermissionCheck(permission, details, isOurWindow)   // true only for 'media' with details.mediaType === 'video' and isOurWindow
ensureCameraAccess(systemPreferences)                    // -> 'granted' | 'refused'; asks only when status is 'not-determined'
```

- `main.cjs` replaces the two blanket denials with these functions; `isOurWindow` means the requesting `webContents` is the studio window or the artwork window (Task 7).
- Add `media-src 'self' blob:` to the policy string at `main.cjs:208`.
- `package.json`: `build.mac.extendInfo.NSCameraUsageDescription` = `"Form & Field uses the camera to turn movement into live visuals. Video is never saved or sent anywhere."`; add `electron/live.cjs` to `build.files`.

- [ ] **Step 1:** Write `electron/live.test.cjs`: video-only request from our window is allowed; `['video','audio']`, `['audio']`, `'geolocation'`, `'notifications'`, and a video request from a foreign window are all denied; `ensureCameraAccess` with a stub returning `denied` resolves `refused` without calling `askForMediaAccess`, and with `not-determined` calls it once.
- [ ] **Step 2:** Run `node --test electron/live.test.cjs`. Expected: fails.
- [ ] **Step 3:** Implement and wire into `main.cjs`.
- [ ] **Step 4:** Run `npm test`. Expected: pass.
- [ ] **Step 5:** Commit `Live: camera permission, policy and packaging`.

### Task 7: Artwork window, relay and settings file

**Files:**
- Modify: `electron/live.cjs`, `electron/live.test.cjs`, `electron/main.cjs` (register handlers; include the artwork window in the trusted-sender check at `main.cjs:88`; close it when the studio window closes), `electron/preload.cjs`, `src/shared/types.ts` (extend `StudioBridge` only)

**Interfaces:**
- Produces on `window.studio`:

```ts
live: {
  loadSettings(): Promise<unknown>;                      // parsed file or null; a damaged file returns null
  saveSettings(settings: LiveSettings): Promise<void>;   // temp file then rename
  cameraAccess(): Promise<'granted' | 'refused'>;
  displays(): Promise<{ id: number; label: string; primary: boolean }[]>;
  openOutput(displayId: number): Promise<void>;
  closeOutput(): Promise<void>;
  send(message: LiveMessage): void;                      // operator -> artwork window
  onMessage(callback: (message: LiveMessage) => void): () => void;
  onOutputChanged(callback: (open: boolean) => void): () => void;
  sendPreview(jpeg: ArrayBuffer): void;                  // artwork -> operator, at most 10 per second
  onPreview(callback: (jpeg: ArrayBuffer) => void): () => void;
}
type LiveMessage = { type: 'settings'; settings: LiveSettings } | { type: 'blackout'; on: boolean } | { type: 'clear' };
```

- The artwork window is a second `BrowserWindow` with the same `webPreferences` as the studio window, frameless, full-screen on the chosen display, black background, loading the same page with the hash `#live-output`. Escape closes it. It is closed on `screen` `display-removed` for its display and when the studio window closes.
- `send` messages are filtered in the main process: the `type` must be one of the three known types and the payload a plain object under 16 KB. Range checking of settings happens in the artwork page through `validateLiveSettings`, not in the main process. Messages are forwarded only to the artwork window. Preview buffers over 512 KB are dropped.

- [ ] **Step 1:** Extend `electron/live.test.cjs` for the pure parts: settings round-trip through temp-and-rename in a temp directory; a file containing `{oops` loads as `null`; message filter accepts the three types and rejects unknown types and oversized payloads; `pickDisplay(displays, id)` returns the matching display or `null`.
- [ ] **Step 2:** Run `node --test electron/live.test.cjs`. Expected: fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit `Live: artwork window, relay and settings file`.

### Task 8: Live section and artwork page

**Files:**
- Create: `src/ui/LivePanel.tsx`, `src/ui/LiveOutput.tsx`, `src/ui/useLive.ts`
- Modify: `src/main.tsx` (mount `LiveOutput` when `location.hash === '#live-output'`), `src/ui/App.tsx` (a "Studio / Live" switch in `app-header`; Live replaces the studio workspace while selected; studio playback pauses), `src/ui/styles.css`
- Create: `scripts/verify-live-ui.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: `useLive()` returning `{ settings, update(change), sourceState, cameras, outputOpen, blackout, setBlackout, clear, openOutput, closeOutput, view, setView, stats }`.

Behaviour:
- Entering Live for the first time calls `cameraAccess()`, then opens the saved or first camera. Refused or none shows: "Camera access is off. Allow Form & Field in System Settings › Privacy & Security › Camera, then reopen the app." with a "Use a video file" button. `lost` shows "Camera disconnected" and the camera list.
- Layout: left column **Setup** (Camera, Use a video file, Mirror, Sensitivity, Camera noise floor, Area left/right/bottom/top, Show tracking), centre preview, right column **Paint** (the seven controls from `PAINT_CONTROLS`, palette picker from `src/core/palettes`, Ground). Top of centre: Display picker, **Open output**, **Blackout**, **Clear**, and a frames-per-second readout.
- No artwork window: `LiveRenderer` runs on the preview canvas. On `onOutputChanged(true)` the operator stops its renderer and releases the camera, and shows the incoming preview images; the artwork window's `LiveOutput` opens the same source from the latest `settings` message and runs the renderer with `view` fixed to `'art'`, sending a 480 × 270 JPEG preview every 100 ms. On `onOutputChanged(false)` the operator renderer restarts.
- "Show tracking" while the artwork window is open is disabled with the note "Close the output to adjust tracking."
- Settings save through `saveSettings` 500 ms after the last change and are sent to the artwork window immediately.
- Leaving Live closes the camera; the artwork window stays open only while Live is selected.

- [ ] **Step 1:** Write `scripts/verify-live-ui.mjs` on the pattern of `scripts/verify-workspace-ui.mjs`, launching with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`: switch to Live; preview is not black within 3 s; drag Fade time and reopen the app, the value persists; Blackout makes the preview black; Clear returns it to ground; Open output creates a second window whose page hash is `#live-output` and whose canvas is not black; closing it restores the operator renderer; switching back to Studio leaves the existing project intact and `npm run test:workspace` still passes. A second launch without the fake-ui flag and with permission denied shows the System Settings message.
- [ ] **Step 2:** Run it. Expected: fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `node scripts/verify-live-ui.mjs`, `npm test`, `npm run test:workspace`. Expected: pass.
- [ ] **Step 5:** Commit `Live: Live section and artwork page`.

### Task 9: Performance record and room session

**Files:**
- Modify: `scripts/verify-live.mjs` (`--performance`), `package.json` (`"test:live": "npm run build && node scripts/verify-live.mjs && node scripts/verify-live-ui.mjs"`), `README.md` (a short "Live" section: placement, setup steps, known limits from the spec)
- Create: `docs/live-performance-2026-11.md`

- [ ] **Step 1:** Add `--performance`: a visible 1920 × 1080 window, `TestSource`, Paint at defaults, 120 seconds; record mean frames per second, worst frame time, and the same with the preview relay active. Write the numbers, the Mac model and the date to `docs/live-performance-2026-11.md` exactly as measured.
- [ ] **Step 2:** Run `node scripts/verify-live.mjs --performance`. If the mean is below 58, lower the particle texture to 192 × 192 and re-measure; record both results.
- [ ] **Step 3:** Run `npm run package` and `npm run test:packaged`; confirm with `plutil` that the bundle's `Info.plist` contains `NSCameraUsageDescription`.
- [ ] **Step 4:** Write the README section.
- [ ] **Step 5:** Commit `Live: performance record and guide`.
- [ ] **Step 6:** Hand over to Greg for a real-camera session against the Body Paint photos. Paint is not done until that session; changes that come out of it are new tasks.

---

## Not in this plan

Person mask, Smoke, Glow, feeding the camera into existing effects, recording, projector warping. Each needs its own design.
