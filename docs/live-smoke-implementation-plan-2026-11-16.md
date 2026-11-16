# Live Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Smoke look to Live in which people, found by MediaPipe Multiclass and recoloured through the palette, dissolve into a real fluid-simulated smoke. Add the shared person-finding groundwork that Dust and Melt will reuse.

**Architecture:**
- Multiclass runs in a Web Worker behind a `MaskProvider` interface.
- A GPU `People` stage inside `Tracking` aligns, smooths, times and filters the mask, then publishes `people`, `still` and `peopleReady` on `TrackingFeed`.
- `Smoke` is a new `Look`: a Pavel-style fluid solver fed by the recoloured person.
- `LiveRenderer` picks Paint or Smoke from `settings.look`.

**Tech Stack:** three 0.187 (WebGL2, half-float and float targets), `@mediapipe/tasks-vision` 1.2.0, Electron 45, React 19, TypeScript, `node:test` via `tsx`, Playwright `_electron`.

**Spec:** `docs/live-smoke-design-2026-11-16.md`. The earlier Live spec, `docs/live-mode-design-2026-11-15.md`, still applies.

## Global Constraints

- Work on branch `live-smoke`. Commit messages start with `Live: `.
- Dependency: `@mediapipe/tasks-vision` exactly `1.2.0` (`--save-exact`, devDependency, like the rest).
- Ship only `vision_wasm_internal.js` and `vision_wasm_internal.wasm` (plus the `module` and `nosimd` variants only if the loader requires them) and `selfie_multiclass_256x256.tflite`, under `public/mediapipe/`.
- Get the four files from the reference branch: `git checkout spike/person-mask -- public/mediapipe`. Then delete the three models that are not shipped.
- Content security policy: add `'wasm-unsafe-eval'` to `script-src` in **both** `electron/main.cjs` and the `<meta>` in `index.html`. Add `worker-src 'self' blob:` to the `<meta>` only if the worker needs it. `connect-src` stays `'self'`. Nothing else is loosened.
- Model labels: `background, hair, body-skin, face-skin, clothes, others`. Person = 1 − background confidence.
- Camera video is never saved, sent anywhere, or shown unprocessed on the projector. The captured empty room is never saved and never crosses IPC.
- Paint does not change. All existing tests and `scripts/verify-live.mjs` Paint checks pass unmodified.
- A 0.15.0 `live-settings.json` loads unchanged and selects Paint.
- Person finding failing must never stop or blacken Live.
- 60 fps at 1920 × 1080 with Smoke and Multiclass running, measured on this Mac.
- Interface copy, verbatim from the spec:
  - Controls: "Smoulder", "Burn away", "Movement response", "Rise", "Swirl", "Smoke life", "Colour change", "Palette", "Look".
  - Setup controls: "Ignore still objects", "Use empty room", "Capture empty room", "Show people".
  - Status lines: "Finding people…", "People not found: <reason>", "People finding is behind", "Capture the empty room again".

## Review Focus

1. **The worker or its GPU path is unavailable in the packaged app, which loads from `file://`.** Person finding falls back, Live keeps rendering, and the operator sees why. Task 2 proves this in the packaged app before building on it.
2. **The camera is switched, or the output is opened or closed, mid-show.** No mask, still timer or empty room from the previous source is reused, and timers restart as never moved. Pinned in Task 3.
3. **Several people fill most of the frame.** Smoke must not saturate to a white sheet. Pinned in Task 5.
4. **A palette with near-black entries, such as Pour.** People stay visible and recognisable. Pinned in Tasks 1 and 4.
5. **Masks stop arriving mid-show** (the worker crashes or falls behind). Within about 2 seconds Smoke switches to movement-only smoke and the status line says so. When masks resume, the person fades back in. Pinned in Tasks 3 and 5.

---

### Task 1: Settings, colour ramp and the people rules

**Files:**
- Modify: `src/live/settings.ts`, `src/live/maths.ts`
- Create: `src/live/colour.ts`
- Test: `tests/live.test.ts`

**Interfaces:**
- Produces:

```ts
// settings.ts
export type LookKind = 'paint' | 'smoke';
export type SmokeKey = 'smoulder' | 'burnAway' | 'response' | 'rise' | 'swirl' | 'lifeSeconds' | 'colourChange';
export const SMOKE_CONTROLS: LiveControl<SmokeKey>[];   // LiveControl becomes generic over its key; PAINT_CONTROLS is LiveControl<PaintKey>[]
export const SMOKE_STARTS: { id: 'solid' | 'smoulder' | 'burn'; label: string; smoulder: number; burnAway: number }[];
export interface PeopleSettings { ignoreStillSeconds: number | null; useEmptyRoom: boolean }  // null = Off
// LiveSettings gains: look: LookKind; smoke: Record<SmokeKey, number> & { palette: string[] }; people: PeopleSettings

// colour.ts
export function paletteRamp(palette: string[]): [number, number, number][]; // entries 0–4 as linear RGB, sorted darkest first by relative luminance

// maths.ts
export const SWAY_SECONDS_FLOOR = 10;           // Ignore still objects minimum
export function ignoreStillWeight(sinceAnyMove: number, ignoreSeconds: number | null): number; // 1 while sinceAnyMove < ignoreSeconds, eases to 0 over the next 2 s; null → always 1
export function burnFade(sinceDeliberateMove: number, burnAway: number): number;            // 0 below 1 s, rises smoothly to burnAway by 3 s
export function personWeight(model: number, box: number, still: number, room: { use: boolean; captured: boolean; differs: number }): number;
                                                 // model × box × still × (use && captured ? differs : 1)
```

Values to use:

| | Control | Range | Default | Step |
|---|---|---|---|---|
| `SMOKE_CONTROLS` | Smoulder | 0–1 | 0.5 | 0.01 |
| | Burn away | 0–1 | 0 | 0.01 |
| | Movement response | 0–3 | 1 | 0.01 |
| | Rise | 0–1 | 0.4 | 0.01 |
| | Swirl | 0–1 | 0.5 | 0.01 |
| | Smoke life | 1–20 | 6 | 0.5 |
| | Colour change | 0–1 | 0.3 | 0.01 |
| Smoke palette | | | `HOT_SIGNAL` | |
| `SMOKE_STARTS` | Solid until they move | | smoulder 0, burn away 0 | |
| | Always smouldering | | smoulder 0.5, burn away 0 | |
| | Burning away | | smoulder 0.9, burn away 0.9 | |
| People | Ignore still objects | 10–120 or `null` (Off) | 30 | |
| | Use empty room | | false | |

- [ ] **Step 1: Write the failing tests** in `tests/live.test.ts`:

```ts
test('a 0.15.0 settings file loads unchanged as Paint', () => {
  const old = { ...defaultLiveSettings() } as Record<string, unknown>; delete old.look; delete old.smoke; delete old.people;
  const s = validateLiveSettings(old);
  assert.equal(s.look, 'paint'); assert.deepEqual(s.paint, defaultLiveSettings().paint); assert.deepEqual(s.palette, defaultLiveSettings().palette);
  assert.deepEqual(s.smoke, defaultLiveSettings().smoke); assert.deepEqual(s.people, { ignoreStillSeconds: 30, useEmptyRoom: false });
});
test('smoke settings repair field by field and keep their own palette', () => {
  const s = validateLiveSettings({ look: 'smoke', smoke: { smoulder: 7, rise: .2, palette: ['#000000'] }, people: { ignoreStillSeconds: 5, useEmptyRoom: 'yes' } });
  assert.equal(s.look, 'smoke'); assert.equal(s.smoke.smoulder, 1); assert.equal(s.smoke.rise, .2);
  assert.deepEqual(s.smoke.palette, HOT_SIGNAL); assert.equal(s.people.ignoreStillSeconds, 10); assert.equal(s.people.useEmptyRoom, false);
  assert.equal(validateLiveSettings({ people: { ignoreStillSeconds: null } }).people.ignoreStillSeconds, null);
  assert.equal(validateLiveSettings({ look: 'dust' }).look, 'paint');
});
test('the three starting points', () => assert.deepEqual(SMOKE_STARTS.map(s => [s.smoulder, s.burnAway]), [[0, 0], [.5, 0], [.9, .9]]));
test('the ramp leaves out the ground colour and runs dark to light', () => {
  for (const palette of [HOT_SIGNAL, POUR, CANDY]) {
    const ramp = paletteRamp(palette), lum = ramp.map(([r, g, b]) => .2126 * r + .7152 * g + .0722 * b);
    assert.equal(ramp.length, 5); assert.deepEqual([...lum].sort((a, b) => a - b), lum);
  }
  assert.ok(!paletteRamp(HOT_SIGNAL).some(c => c.every(v => v < .02)), 'Hot Signal ground colour leaked in');
});
test('sway keeps a still person counted; nothing moved for longer than the time drops out', () => {
  assert.equal(ignoreStillWeight(29, 30), 1); assert.equal(ignoreStillWeight(33, 30), 0); assert.equal(ignoreStillWeight(1e6, null), 1);
});
test('burn away starts after a second still and is complete at three', () => {
  assert.equal(burnFade(.9, .8), 0); assert.ok(Math.abs(burnFade(3, .8) - .8) < 1e-9); assert.equal(burnFade(10, 0), 0);
});
test('empty room only applies once captured', () => {
  assert.equal(personWeight(1, 1, 1, { use: true, captured: false, differs: 0 }), 1);
  assert.equal(personWeight(1, 1, 1, { use: true, captured: true, differs: 0 }), 0);
  assert.equal(personWeight(1, 0, 1, { use: false, captured: false, differs: 1 }), 0);
});
```

- [ ] **Step 2:** Run `npx tsx --test tests/live.test.ts`. Expected: fails, because the new exports are missing.
- [ ] **Step 3:** Implement. `validateLiveSettings` keeps its field-by-field rule. `ignoreStillSeconds` below 10 clamps to 10, above 120 clamps to 120, `null` stays `null`, and anything else defaults to 30. Use the sRGB → linear conversion from `THREE.Color` in `paletteRamp`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit `Live: Smoke settings, colour ramp and people rules`.

### Task 2: Multiclass in a worker, proven in the packaged app

**Files:**
- Create: `src/live/people-worker.ts`, `src/live/MaskProvider.ts`
- Modify: `index.html`, `electron/main.cjs` (content security policy), `package.json`, `package-lock.json`, `build/notices/` (add `mediapipe-tasks-vision-LICENSE.txt` and `selfie-multiclass-model-LICENSE.txt`, both Apache 2.0, with the model card link from the spec)
- Add: `public/mediapipe/` (see Global Constraints)
- Create: `scripts/verify-live-people.mjs`
- Test: `tests/live.test.ts`

**Interfaces:**
- Produces:

```ts
// MaskProvider.ts
export interface Mask { data: Uint8Array; width: number; height: number; frameId: number }   // row 0 = top of the source frame, 0..255 person likelihood
export type PeopleStatus = { state: 'loading' } | { state: 'running'; ms: number } | { state: 'failed'; reason: string } | { state: 'behind' };
export interface MaskProvider {
  submit(frame: HTMLVideoElement | HTMLCanvasElement, frameId: number): void;  // dropped (not queued) while a frame is in flight
  latest(): Mask | null;
  readonly status: PeopleStatus;
  readonly ready: boolean;                     // a mask arrived within the last READY_MS
  dispose(): void;
}
export const READY_MS = 2000;
export class MaskGate { constructor(now: () => number); offer(): boolean; received(): void; get ready(): boolean; get behind(): boolean } // pure scheduling rules, unit-tested
export class WorkerMaskProvider implements MaskProvider { constructor() }
// people-worker.ts: receives { bitmap: ImageBitmap, frameId, timestamp }, replies { data: Uint8Array (transferred), width, height, frameId, ms } or { error: string }
```

- `MaskGate.offer()` returns false while a frame is in flight.
- An in-flight frame older than `READY_MS` counts as lost: `offer()` is allowed again and `behind` is true.
- `ready` is true only when `received()` was called within `READY_MS`.

- [ ] **Step 1: Write the failing tests** for `MaskGate` with a fake clock:
  - a second offer while one is in flight is refused;
  - an offer is allowed again after `received()`;
  - `ready` is false at start, true just after `received()`, and false 2001 ms later;
  - a frame in flight for 2001 ms makes `behind` true and `offer()` allowed again.
- [ ] **Step 2:** Run `npx tsx --test tests/live.test.ts`. Expected: fails.
- [ ] **Step 3:** Install the pinned library, bring in `public/mediapipe/`, update both security policies, and add the notices.
- [ ] **Step 4:** Implement `MaskGate`, `WorkerMaskProvider` and `people-worker.ts`.
  - The worker loads `FilesetResolver.forVisionTasks(new URL('mediapipe', <page URL>).href)`. The page URL is sent from the main thread in the first message.
  - `ImageSegmenter.createFromOptions` with `delegate: 'GPU'`, `runningMode: 'VIDEO'`, `outputConfidenceMasks: true`, `outputCategoryMask: false` and `canvas: new OffscreenCanvas(1, 1)`.
  - If GPU creation throws, retry with `delegate: 'CPU'` and report it in the status `reason` text.
  - Frames are sent with `createImageBitmap(frame)` and transferred.
  - Person = 1 − background (label index 0).
- [ ] **Step 5: Write `scripts/verify-live-people.mjs`.** It launches the **packaged** app (pattern: `work/room-test/check.mjs` on `spike/person-mask`), opens Live with the fake camera, and asserts:
  - within 15 s the provider status is `running` and at least 5 masks arrived;
  - every network request recorded by the page (`page.on('request')`) has a `file:`, `blob:` or `data:` URL. Requests blocked by the security policy count as blocked, not as sent; record them separately and report them;
  - the Live frame rate stays at 55 or above while it runs.

  If the worker cannot be created from `file://`, or the GPU path fails in the worker, **stop and choose by measurement** between the CPU path in the worker and the main thread on every second camera frame, as the spec allows. Record the choice as a ruling.
- [ ] **Step 6:** Run `npm run package && node scripts/verify-live-people.mjs`. Expected: pass.
- [ ] **Step 7:** Commit `Live: Multiclass person finding in a worker`.

### Task 3: People in tracking: alignment, timers and filters

**Files:**
- Create: `src/live/People.ts`, `src/live/people-shaders.ts`
- Modify: `src/live/look.ts`, `src/live/Tracking.ts`, `src/live/LiveRenderer.ts` (pass a provider), `src/live/Stage.ts` (create `WorkerMaskProvider` when needed), `src/live/test-source.ts`, `scripts/verify-live.mjs`

**Interfaces:**
- Consumes: `MaskProvider` and `Mask` (Task 2); `ignoreStillWeight`, `personWeight` and `PeopleSettings` (Task 1).
- Produces:

```ts
// look.ts — TrackingFeed gains
readonly people: THREE.Texture;     // CAMERA_SIZE, aligned with `camera`; person likelihood 0..1 with all filters applied
readonly still: THREE.Texture;      // STILL_SIZE (People.ts exports it, e.g. 160 × 90): r = seconds since any movement nearby (sway counts), g = seconds since deliberate movement
readonly peopleReady: boolean;
readonly peopleStatus: PeopleStatus;
// Tracking
constructor(passes: Passes, makeProvider?: () => MaskProvider);   // provider created lazily, only while settings.look needs people
captureRoom(): void; readonly roomCaptured: boolean;
// test-source.ts
export class TestSource { figure: boolean; /* draws a person-shaped figure (head, body, arms) */ standing: boolean /* holds it still, with a 0.5 px sway */ }
export class TestMaskProvider implements MaskProvider { constructor(source: TestSource) }  // mask from the figure's known shape, plus a fixed "poster" rectangle the "model" wrongly calls a person
```

- **Still timers.** Movement thresholds are taken from `TrackingFeed.flow.b` around each point, using its 3 × 3 neighbourhood maximum:
  - "any" = above 0.004;
  - "deliberate" = above 0.05.
- At start, and on every source change or `reset()`, both timers start at **never moved** (1e4 seconds).
- Mask smoothing over time: `mix(previous, new, 0.5)` per mask arrival.

- [ ] **Step 1: Extend `scripts/verify-live.mjs`** with a "people" stage that uses `TestSource({ figure })` and `TestMaskProvider`. Read back `people` and `still` through `LiveRenderer.readPeople()` (a checks-only method, like `readFlow`). Assert:
  - with Smoke selected, `people` is above 0.5 at the figure's centre and below 0.05 in empty room;
  - the poster stays below 0.05 from the start (it never moved), and a figure that moves and then stands for 40 s with sway stays above 0.5 at Ignore still 30;
  - with sway only, `still.g` passes 1 s while `still.r` stays below 1 s;
  - with `box.right = .5`, `people` is 0 on the right half;
  - after switching to a second `TestSource`, `people` is 0 until that source's first mask, and `still` restarts as never moved;
  - with Paint selected, no provider is ever created.
- [ ] **Step 2:** Run it. Expected: the new checks fail.
- [ ] **Step 3:** Implement `People` and the Tracking wiring.
  - Align the mask with the same mirror and crop as `cameraFragment`, and flip y (row 0 is the top).
  - Room difference: the average colour distance over a 3 × 3 neighbourhood against the captured room, `smoothstep(.06, .12, d)`.
  - The room picture lives only in the GPU target of the window that captured it.
- [ ] **Step 4:** Run `node scripts/verify-live.mjs` and `npm test`. Expected: pass, Paint checks included.
- [ ] **Step 5:** Commit `Live: people in tracking`.

### Task 4: Recolouring and the Show people view

**Files:**
- Create: `src/live/recolour.ts` (GLSL chunk plus uniform helper)
- Modify: `src/live/LiveRenderer.ts` (`view: 'art' | 'tracking' | 'people'`), `src/live/tracking-shaders.ts`, `scripts/verify-live.mjs`

**Interfaces:**
- Consumes: `paletteRamp` (Task 1); `TrackingFeed.camera`, `people` and `peopleReady` (Task 3).
- Produces:

```ts
export const recolourGLSL: string;   // declares uniform vec3 uRamp[5]; uniform float uRampShift; and
                                     // vec3 recolour(vec3 camera, vec2 uv, float time): ramp colour picked by lifted luminance + shift, multiplied by lifted luminance
export function setRamp(uniforms: Record<string, THREE.IUniform>, palette: string[], shift: number): void;
```

- Lifted luminance: `l = smoothstep(.04, .85, luma)^0.8`.
- Ramp position = `clamp(l + .12 * sin(time * colourChange * .4 + uv.x * 3. + uv.y * 2.), 0., 1.)`.
- Output = ramp colour × `(.25 + .75 * l)`. The floor keeps people visible on dark palettes.

**Show people** (operator only) draws:
- the camera dimmed by 0.45;
- `people` in blue `(.05, .75, .9)`;
- its outline in pink `(1, .2, .75)`, where the people value differs by 0.3 or more across 3 pixels;
- for Use empty room, a corner badge when nothing is captured.

- [ ] **Step 1:** Add checks:
  - with Pour and with Hot Signal, a figure lit at luma 0.1 to 0.9 recolours to at least 12/255 everywhere on the figure, and its brightest region is the brightest output;
  - Show people lights the figure blue and the poster not at all.
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `node scripts/verify-live.mjs`. Expected: pass.
- [ ] **Step 5:** Commit `Live: recolouring and Show people`.

### Task 5: The Smoke look

**Files:**
- Create: `src/live/fluid.ts` (solver), `src/live/smoke-shaders.ts`, `src/live/Smoke.ts`
- Modify: `src/live/LiveRenderer.ts` (choose the look from `settings.look`; switching disposes the old look and creates the new one), `build/notices/` (add `webgl-fluid-simulation-LICENSE.txt`, MIT, Copyright (c) 2017 Pavel Dobryakov), `scripts/verify-live.mjs`

**Interfaces:**
- Consumes: `Look` and `TrackingFeed` (with Task 3's additions); `recolourGLSL` and `setRamp` (Task 4); `burnFade` and `SMOKE_CONTROLS` (Task 1); `Passes` and `Pair`.
- Produces:

```ts
// fluid.ts
export class Fluid {
  constructor(passes: Passes, grid: [number, number], dye: [number, number], pressureIterations?: number);
  splat(material: THREE.ShaderMaterial): void;  // runs a caller's pass that writes velocity (rg) and dye (rgb) additions; see Smoke
  step(seconds: number, curl: number, velocityLife: number, dyeLife: number, buoyancy: number): void; // curl → vorticity → divergence → pressure → gradient → advect velocity → advect dye
  readonly velocity: THREE.Texture; readonly dye: THREE.Texture;
  clear(): void; dispose(): void;
}
// Smoke.ts
export class Smoke implements Look { constructor(passes: Passes, width: number, height: number) }
```

Starting values:

| | Value |
|---|---|
| Grid | 256 × 144 |
| Dye | half the artwork size (960 × 540 at 1080) |
| Pressure iterations | 20 |
| Curl | Swirl × 60, so 0.5 gives 30 |
| Dye life | Smoke life (5% left after that time) |
| Velocity life | 1.5 s |
| Buoyancy | Rise × 0.8 uv/s² per unit dye luminance |

Injection each step, inside the person (`people` × `peopleReady`) or, when people is not ready, everywhere inside the box:
- **Movement:** velocity += `flow.rg × 30 × response`; dye += `recolour × flow.b × response × step × 6`.
- **Smoulder:** dye += `recolour × smoulder × step × 1.5 × (edge + .3 × body)`, with edge = |∇people| scaled to 0..1; velocity += `(0, .08) × smoulder` plus curl noise × 0.05.
- **Burn away:** fade = `burnFade(still.g, burnAway)`; dye += `recolour × fade × step × 2`.
- **Not ready:** people treated as 0; movement injection uses the box-weighted whole frame, with the recolour taken from the camera.

Drawn: dye, then the person (`recolour × people × (1 − fade) × personVisible`) over it with a 2-pixel soft edge. `personVisible` eases to 0 within 1 s when people is not ready, and back to 1 within 1 s when it is.

Dye is clamped per channel to 1.5, and the final output passes through Paint's highlight roll-off, so a full frame of people cannot become a white sheet.

- [ ] **Step 1:** Add Smoke checks to `scripts/verify-live.mjs` (all with `TestMaskProvider`):
  - smoke appears from the moving figure, and its painted centroid rises (y decreases on screen) over 2 s;
  - after the figure stops at defaults, the smoke field keeps changing for at least 1 s (mean absolute frame difference above 0.5/255);
  - at Burning away, the figure standing still for 5 s with sway drops below 30% of its moving brightness, and moving restores 80% within 0.5 s;
  - at Solid until they move, the figure standing still gives off no new smoke (smoke outside the figure below 2/255 after 10 s still);
  - the poster never smokes;
  - clear gives exactly black;
  - a mask covering 90% of the frame for 10 s leaves fewer than 5% of pixels above 250/255 (**Review Focus 3**);
  - with the provider disposed mid-run, the output is not black after 3 s and movement still makes smoke (**Review Focus 5**);
  - a 5 s stall does not change the smoke coverage by more than 5 percentage points;
  - Paint's checks still pass.
- [ ] **Step 2:** Run. Expected: Smoke checks fail.
- [ ] **Step 3:** Implement `Fluid`, then `Smoke`. Port Pavel's pass structure with credit in the file header; do not copy line for line.
- [ ] **Step 4:** Run `node scripts/verify-live.mjs`, `npm test` and `npm run build`. Expected: pass.
- [ ] **Step 5:** Save `work/live/smoke.png` and look at it.
- [ ] **Step 6:** Commit `Live: Smoke look`.

### Task 6: Live screen, relay and artwork window

**Files:**
- Modify:
  - `src/ui/LivePanel.tsx`, `src/ui/useLive.ts`, `src/ui/LiveOutput.tsx`, `src/ui/styles.css`
  - `src/shared/types.ts` (`LiveMessage` gains `{ type: 'captureRoom' }`; `LiveBridge.sendState` also carries people status)
  - `electron/live.cjs` (add `'captureRoom'` to `MESSAGE_TYPES`), `electron/live.test.cjs`
  - `scripts/verify-live-ui.mjs`

**Interfaces:**
- Consumes: everything above. The artwork window reports `{ status, people: PeopleStatus, roomCaptured }` through the existing state channel; extend `acceptState` to allow an optional `people` object.

**Behaviour:**
- **Look:** a "Look" choice (Paint / Smoke) at the top of the right column. The right column shows that look's controls.
- **Smoke column:**
  - the seven Smoke sliders;
  - three "Start from" buttons from `SMOKE_STARTS`;
  - Smoke's own Palette select with swatches of the five ramp colours, darkest first.
- **Setup column, under Show tracking:**
  - "Show people" (operator only; disabled while the output is open, with the same note as Show tracking);
  - "Ignore still objects": a slider for 10–120 s and an "Off" checkbox;
  - "Use empty room", with "Capture empty room" beside it;
  - the people status line.
- **Status lines:**
  - "Finding people…" while loading;
  - "People not found: <reason>" on failure;
  - "People finding is behind" when behind;
  - "Capture the empty room again" when Use empty room is on and nothing is captured.

  While the output is open, all of these come from the artwork window's report.
- **Capture empty room** captures in the local renderer, or sends `{ type: 'captureRoom' }` while the output is open.

- [ ] **Step 1:** Add tests.
  - `electron/live.test.cjs`: `acceptMessage({ type: 'captureRoom' })` is true, and `acceptState({ status: 'running', label: 'x', width: 1, height: 1, people: { state: 'behind' } })` is true.
  - `scripts/verify-live-ui.mjs`:
    - choosing Smoke and moving Smoulder persists across a restart;
    - with Smoke chosen, the people status reaches "running" in the operator view, and then in the artwork window's report once the output opens;
    - Capture empty room while the output is open makes the artwork window report `roomCaptured: true`;
    - switching back to Paint restores Paint's own palette and values;
    - a damaged settings file still opens Live.
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npm run build`, `node scripts/verify-live-ui.mjs`, `node scripts/verify-live.mjs` and `node scripts/verify-workspace-ui.mjs`. Expected: pass.
- [ ] **Step 5:** Commit `Live: Smoke on the Live screen`.

### Task 7: Packaged check, performance, guide

**Files:**
- Modify:
  - `scripts/verify-live.mjs` (`--performance` gains `--look=smoke` with the real `WorkerMaskProvider` and the fake camera)
  - `docs/live-performance-2026-11.md`
  - `README.md` (a Smoke subsection under Live: what it does, the three Start from points, the filters, and that people are found on this computer and never recorded)
  - `package.json`: version `0.16.0`, with a matching change in `package-lock.json`; README gets "What's new in 0.16"

- [ ] **Step 1:** Run `npm run package` and `node scripts/verify-live-people.mjs`. Expected: pass.
- [ ] **Step 2:** Run `node scripts/verify-live.mjs --performance --look=smoke`, 120 s. Record the numbers as measured.
  - If the mean is below 58 fps, apply the spec's fallbacks **in order**, re-measuring after each: dye resolution, then pressure iterations, then the model on every second frame, then 1280 × 720.
  - Record every result.
- [ ] **Step 3:** Write the README and performance sections. Confirm `plutil` shows 0.16.0 in the packaged app.
- [ ] **Step 4:** Commit `Live: Smoke performance record, guide and 0.16.0`.
- [ ] **Step 5:** Hand over to Greg for the room session. Smoke is not done until then.

---

## Not in this plan

Dust, Melt, Glow, using hair, skin and clothes separately, Show tracking while the output is open, recording.
