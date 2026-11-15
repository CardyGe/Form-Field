# Print Screen Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-layer Print screen finish that redraws a layer's tone as halftone dots, a line screen or an ordered dither, sized in 1080-line pixels, with tone, colour and edge-based placement controls and seven library looks.

**Architecture:** Nineteen new finish parameters join `FINISH_PARAMETERS`, so their `uPrint…` uniforms, saving and project upgrade come for free (`StudioRenderer` binds every finish key as `u` + capitalised key). The screen is drawn analytically inside `compositeFragment`, after `toon()` and before grading, on a grid built from `vUv` so it is fixed to the frame. The maths that decides how big a mark is lives twice: as tested TypeScript in a new `src/rendering/print-screen.ts`, and as GLSL that must match it line for line.

**Tech Stack:** TypeScript, three.js `ShaderMaterial` (GLSL ES 1 with derivatives), React, `node:test` through `tsx`.

**Spec:** [print-screen-finish-plan-2026-11-15.md](print-screen-finish-plan-2026-11-15.md)

## Global Constraints

- Keys, ranges, steps, defaults and labels are exactly the four tables in the spec's Controls section. All keys start with `print`.
- `printMix` defaults to 0. At 0 with no modulation, `uPrintOn` is 0, no screen code runs and the composite output is bit-identical to today.
- All sizes are pixels of a 1080-line frame: cells per frame height = `1080 / printSize`. No size may depend on the render target's pixel size, except edge filtering through `fwidth`.
- The grid is built from `vUv` (frame space), never the layer's `uv`.
- Stateless: nothing is written to Feedback or Time displacement targets.
- Unsupported kind: `graphic` only. `scope` is supported (it is drawn into the source and composited like any layer).
- Channel angle offsets, added to `printAngle`: RGB light `[15, 75, 0]`°; CMYK ink `[15, 75, 0, 45]`° for C, M, Y, K.
- Labels use British spelling ("Screen colour").
- Run `npm test` and `npm run build` before each commit. Commit only the files a task names.

## Review Focus

1. **Print screen is 0 but animated.** The screen must still render on frames where the modulated value is above 0. Pinned in Task 1 (`printActive` with a modulation).
2. **Old project files with no print keys.** They load with the screen off and unchanged output. Pinned in Task 1 (migration test).
3. **Tone floor at or above Tone ceiling.** No divide by zero or NaN; it behaves as a hard threshold at the floor. Pinned in Task 1 (`printCoverage` with floor .6, ceiling .4).
4. **Coverage near 0 in Layer colour.** The brightness scale `1 / c` must stay finite and capped at 8. Pinned in Task 1 (`printInkScale(0)`).
5. **Screen finer than the output (size 1 in a reduced preview) and anti-aliased silhouettes on a transparent export.** Flat tone, not noise; no dark fringes around dots. Manual checks in Task 2.

---

### Task 1: Parameters, support rules and mark maths

**Files:**
- Modify: `src/core/finishing.ts`
- Create: `src/rendering/print-screen.ts`
- Modify: `src/core/project.ts` (`visibleParameterDefinitions`, about line 324)
- Test: `tests/print.test.ts`

**Interfaces:**
- Produces, from `src/core/finishing.ts`: `PRINT_PARAMETERS: ParameterDefinition[]`, `PRINT_KEYS: string[]`; `PRINT_PARAMETERS` spread into `FINISH_PARAMETERS` after `GLOW_PARAMETERS`.
- Produces, from `src/rendering/print-screen.ts`:
  - `supportsPrint(layer: Pick<Layer,'kind'>): boolean`
  - `printActive(layer: Pick<Layer,'kind'|'params'|'modulations'>): boolean`
  - `PRINT_CHANNEL_ANGLES: number[]` = `[15, 75, 0, 45]`
  - `printUniforms(layer: Pick<Layer,'params'>, loopPhase: number): { cells: number; angles: number[]; scroll: number }` where `cells = 1080 / printSize`, `angles` is four values in radians (`printAngle` + each channel offset), `scroll = printScroll * loopPhase / (2π)`.
  - `printCoverage(tone: number, floor: number, ceiling: number, gain: number, invert: number): number`
  - `printInkScale(coverage: number): number` = `min(1 / max(coverage, 1e-4), 8)`
  - `printMarkSize(shape: number, coverage: number): number`
  - `bayerThreshold(matrix: number, x: number, y: number): number`

- [ ] **Step 1: Write the failing tests** in `tests/print.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject, validateProject, visibleParameterDefinitions } from '../src/core/project';
import { PRINT_KEYS, FINISH_KEYS } from '../src/core/finishing';
import { bayerThreshold, printActive, printCoverage, printInkScale, printMarkSize, printUniforms, supportsPrint } from '../src/rendering/print-screen';

test('print screen is off by default and older projects migrate without it', () => {
  const project = createProject();
  for (const layer of project.layers) {
    assert.equal(layer.params.printMix, 0);
    assert.equal(printActive(layer), false);
    for (const key of PRINT_KEYS) delete layer.params[key];
  }
  const migrated = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(PRINT_KEYS.map(k => migrated.layers[0].params[k]),
    [0, 0, 8, 45, 0, 2, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 12, .5, .25]);
});

test('print keys are finish keys in the spec order', () => {
  assert.deepEqual(PRINT_KEYS, ['printMix','printType','printSize','printAngle','printDot','printMatrix','printScroll',
    'printFloor','printCeiling','printGain','printSoft','printInvert','printColour','printInk','printPaper',
    'printArea','printEdgeWidth','printEdgeSense','printEdgeFeather']);
  assert.equal(PRINT_KEYS.every(k => FINISH_KEYS.includes(k)), true);
});

test('print screen runs when the amount is animated from zero', () => {
  const layer = createLayer('surface');
  assert.equal(printActive({ ...layer, modulations: { printMix: {} as never } }), true);
  assert.equal(printActive({ ...layer, params: { ...layer.params, printMix: .4 } }), true);
});

test('graphic patterns take no print screen; the oscilloscope does', () => {
  const graphic = createLayer('graphic');
  assert.equal(supportsPrint(graphic), false);
  assert.equal(printActive({ ...graphic, params: { ...graphic.params, printMix: 1 } }), false);
  assert.equal(visibleParameterDefinitions(graphic).some(d => PRINT_KEYS.includes(d.key)), false);
  assert.equal(PRINT_KEYS.every(k => visibleParameterDefinitions(createLayer('scope')).some(d => d.key === k)), true);
});

test('the screen is sized in 1080-line pixels and travels whole cells per loop', () => {
  const layer = createLayer('surface');
  const u = printUniforms({ params: { ...layer.params, printSize: 8, printAngle: 45, printScroll: 3 } }, Math.PI * 2);
  assert.equal(u.cells, 135);
  assert.equal(u.scroll, 3);
  assert.deepEqual(u.angles.map(a => Math.round(a * 180 / Math.PI)), [60, 120, 45, 90]);
  assert.equal(printUniforms({ params: { ...layer.params, printScroll: 3 } }, 0).scroll, 0);
});

test('tone maps to coverage through floor, ceiling, gain and invert', () => {
  assert.equal(printCoverage(.5, 0, 1, 0, 0), .5);
  assert.equal(printCoverage(.2, .2, .8, 0, 0), 0);
  assert.equal(printCoverage(.8, .2, .8, 0, 0), 1);
  assert.ok(printCoverage(.5, 0, 1, .5, 0) > .5);
  assert.ok(printCoverage(.5, 0, 1, -.5, 0) < .5);
  assert.equal(printCoverage(.25, 0, 1, 0, 1), .75);
  // Floor above ceiling: a hard threshold at the floor, never NaN.
  assert.equal(printCoverage(.5, .6, .4, 0, 0), 0);
  assert.equal(printCoverage(.7, .6, .4, 0, 0), 1);
});

test('layer-colour brightness scale is finite and capped', () => {
  assert.equal(printInkScale(0), 8);
  assert.equal(printInkScale(.5), 2);
  assert.equal(printInkScale(1), 1);
});

test('mark size grows with coverage, is empty at 0 and fills the cell at 1', () => {
  // Size is the mark's half-extent in cells: radius, half-side, or diamond reach.
  for (const shape of [0, 1, 2, 3]) {
    assert.equal(printMarkSize(shape, 0), 0);
    let last = 0;
    for (let c = .05; c <= 1; c += .05) { const s = printMarkSize(shape, c); assert.ok(s > last, `${shape} ${c}`); last = s; }
  }
  assert.ok(Math.abs(printMarkSize(0, .2) - Math.sqrt(.2 / Math.PI)) < 1e-9);  // round: area = c
  assert.ok(printMarkSize(0, 1) >= Math.SQRT1_2);                               // round covers the cell corners
  assert.ok(Math.abs(printMarkSize(2, .5) - .5) < 1e-9);                        // diamonds meet at half tone
  assert.equal(printMarkSize(2, 1), 1);
  assert.equal(printMarkSize(3, 1), .5);                                         // square: half-side
});

test('bayer matrices are complete and balanced', () => {
  for (const [matrix, n] of [[0, 2], [1, 4], [2, 8]] as const) {
    const seen = new Set<number>();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) seen.add(bayerThreshold(matrix, x, y));
    assert.equal(seen.size, n * n);
    assert.ok(Math.min(...seen) > 0 && Math.max(...seen) < 1);
    assert.equal(bayerThreshold(matrix, n, n), bayerThreshold(matrix, 0, 0)); // tiles
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/print.test.ts`
Expected: FAIL, cannot find `../src/rendering/print-screen`.

- [ ] **Step 3: Add `PRINT_PARAMETERS` and `PRINT_KEYS` to `src/core/finishing.ts`**

Copy keys, labels, ranges, steps and defaults from the spec's four tables, in table order. `section` is `'Material'` for all except `printScroll`, which is `'Motion'`. Descriptions are the spec's "What it does" text. Add a doc comment in the style of the Glow one. Spread into `FINISH_PARAMETERS` after `GLOW_PARAMETERS`.

- [ ] **Step 4: Create `src/rendering/print-screen.ts`** with the functions in Interfaces.

Decisions the tests do not fully fix:

- `printCoverage`: `x = clamp((tone − floor) / max(ceiling − floor, 1e-3), 0, 1)`; when `ceiling <= floor`, `x = tone > floor ? 1 : 0`. Then `x = pow(x, exp2(−1.5 · gain))`, then `invert > .5 ? 1 − x : x`.
- `printMarkSize(shape, c)`:
  - 0 Round: radius `sqrt(c/π)` up to `c = π/4` (dots touch at radius .5), then linear from .5 to `√½ + .01` at `c = 1`.
  - 1 Classic: the mark is where the field `(cos 2πx + cos 2πy) / 2` is above a level. `printMarkSize(1, c)` returns `c` itself. Also export `classicLevel(c: number): number`, the level whose mark area is `c`: a 17-entry table (c = 0, 1/16 … 1) built once by numeric integration and linearly interpolated, with `classicLevel(.5) = 0`. Task 2 pastes the same 17 numbers into GLSL. Add a test that integrating the field above `classicLevel(c)` on a 200×200 grid gives `c` within .02 for c = .1, .3, .5, .7, .9.
  - 2 Diamond: reach `h` with `|x|+|y| ≤ h`: `sqrt(c/2)` up to `c = .5`, then `1 − sqrt((1 − c)/2)`.
  - 3 Square: half-side `sqrt(c)/2`.
- `bayerThreshold(matrix, x, y)`: standard recursive Bayer index for `n = 2, 4, 8`, wrapped with modulo, returned as `(index + .5) / n²`.

- [ ] **Step 5: Hide the controls where unsupported**

In `visibleParameterDefinitions` in `src/core/project.ts`, additionally filter out `PRINT_KEYS` when `!supportsPrint(layer)`.

- [ ] **Step 6: Run tests**

Run: `npm test` and `npm run build`
Expected: PASS, including the existing suites.

- [ ] **Step 7: Commit**

```bash
git add src/core/finishing.ts src/rendering/print-screen.ts src/core/project.ts tests/print.test.ts
git commit -m "Print screen finish: parameters, support rules and mark maths"
```

---

### Task 2: Draw the dot screen

**Files:**
- Modify: `src/rendering/shaders.ts` (`compositeFragment`)
- Modify: `src/rendering/StudioRenderer.ts` (composite uniforms near line 284; per-layer binding near line 784)

**Interfaces:**
- Consumes: `printActive`, `printUniforms` from Task 1; the auto-bound `uPrint…` uniforms.
- Produces, in GLSL: `vec4 printScreen(vec4 plain, vec2 uv)` returning the premultiplied screened layer already mixed with `plain`; helper `vec2 layerUv(vec2 frameUv)`; `float printTone(vec4 pixel)`; `float printCurve(float tone)`; `float printChannel(vec2 s, int channel, out vec4 centrePixel)` returning one screen's mark coverage. New uniforms `uPrintOn` (float), `uPrintCells` (float), `uPrintAngles` (float[4]), `uPrintOffset` (float).

- [ ] **Step 1: Bind the uniforms**

Add `uPrintOn`, `uPrintCells`, `uPrintAngles: [0,0,0,0]`, `uPrintOffset` to the composite material. Add `private bindPrint(original: Layer, layer: Layer, loopPhase: number)` beside `bindGlow`, called right after it with `wrapped`: `uPrintOn = printActive(original) && number(layer,'printMix',0) > 0`, the rest from `printUniforms(layer, loopPhase)`.

- [ ] **Step 2: Factor the layer transform**

Move the three lines at the top of `main()` that turn `vUv` into `uv` into `vec2 layerUv(vec2 frameUv)` and call it from `main()`. Output must be unchanged.

- [ ] **Step 3: Write the screen for Dots, in Layer colour and Palette ink**

Declare the `uPrint…` uniforms used. Call site, straight after the `toon` line:

```glsl
if(uPrintOn>.5)top=printScreen(top,uv);
```

Rules the code must follow (the spec's Rendering section has the reasoning):

- Screen coordinate for channel `i`: `s = rot(uPrintAngles[i]) * ((vUv−.5)*vec2(uAspect,1.)*uPrintCells) + vec2(uPrintOffset,0.)`. The inverse maps a cell centre back to frame `vUv`, then through `layerUv` and `sampleSource`. Apply `recolor` and `toon` to centre samples when those are on, so marks carry the finished colour.
- `printTone(pixel)`: `L/(.35+L)` on the straight colour, times `pixel.a`. `printCurve` mirrors `printCoverage` from Task 1 exactly.
- Own cell tone: mean of five taps (centre and ±¼ cell on both screen axes). Each of the eight neighbours: one centre tap.
- Per cell, signed distance to the mark in cell units using sizes that mirror `printMarkSize`. Union = minimum distance over the nine cells.
- Coverage `= clamp(.5 − d/w, 0., 1.)`, `w = max(length(fwidth(s)), uPrintSoft*.5)`.
- Fine-screen fade: `mix(coverage, c, smoothstep(.35, .6, length(fwidth(s))))` where `c` is the own cell's target coverage.
- Layer colour ink: straight colour at the own cell centre × `min(1./max(c,1e-4), 8.)`. Palette ink: `uGradePalette[int(uPrintInk−.5)]`.
- Alpha with Paper transparent (`uPrintPaper<.5`): screened = `vec4(ink*a*cov, a*cov)` with `a = min(max(plain.a, centre alpha), 1.)`, so a mark that straddles the silhouette stays whole (its size already shrank with the centre's alpha through `printTone`).
- Alpha with a paper swatch: screened = `vec4(mix(paper, ink, cov)*plain.a, plain.a)`.
- Classic shape: distance `= (level − field) / max(length(gradient of field), 1e-3)` in cell units, with `level` from the 17-entry `classicLevel` table.
- Return `mix(plain, screened, uPrintMix)`.

- [ ] **Step 4: Build and check in the app**

Run: `npm test` and `npm run build`, then `npm run dev`.

Check, on a Liquid Light layer and on a Surface layer with Print screen 1:
1. Round dots at size 8 are round, evenly spaced, and stay still while the layer animates.
2. All four Dot shapes; at mid tone Classic is a checkerboard and Diamond dots just touch; no seams where dots merge.
3. Size 1 in the reduced preview is flat tone, not noise.
4. Print screen 0 looks identical to before (compare against `git stash` if in doubt).
5. Export a transparent PNG at 4K and at 1080 with 2× supersampling: the dot pattern matches the preview in pitch and position, edges are clean, and dots at the layer's silhouette have no dark fringe.
6. Glow on the same layer stays soft over the dots.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/shaders.ts src/rendering/StudioRenderer.ts
git commit -m "Print screen finish: analytic dot screen"
```

---

### Task 3: Lines, dither and screen travel

**Files:**
- Modify: `src/rendering/shaders.ts` (`printChannel`)

**Interfaces:**
- Consumes: Task 2's `printChannel`, `printTone`, `printCurve`.
- Produces: `printChannel` handles `uPrintType` 0, 1 and 2.

- [ ] **Step 1: Lines**

Lines run along the screen's x axis, centred at `s.y = n + .5`. For the pixel's line and the one either side: tone is read at the projection `(s.x, n+.5)`; half-width `= c/2`; distance `= abs(s.y − (n+.5)) − c/2`. Union and filtering as for dots.

- [ ] **Step 2: Dither**

Cell `= floor(s)`; tone from one tap at the cell centre; on when `c >` the Bayer threshold for `mod(cell, n)`, `n = 2, 4, 8` by `uPrintMatrix`. Compute the threshold with the same recursive index as `bayerThreshold` (bit interleave in a loop of 1, 2 or 3 steps). Filter cell edges: evaluate the pixel's cell and the neighbour across each nearer edge, and blend by the box-filter overlap `clamp(.5 + distToEdge/fwidth, 0., 1.)` on each axis (bilinear over four cells).

- [ ] **Step 3: Check in the app**

Run: `npm test`, `npm run build`, `npm run dev`.

1. Lines at size 6: widths swell and thin with tone, edges are smooth curves, both sides of each line agree.
2. Dither at size 3 with each matrix: crisp square cells; at 4K export the cells are the same squares, twice the pixels.
3. Screen travel 2 on Lines: export a short loop; the last frame flows into the first.
4. Screen angle animated: no popping.

- [ ] **Step 4: Commit**

```bash
git add src/rendering/shaders.ts
git commit -m "Print screen finish: line screen, ordered dither and travel"
```

---

### Task 4: RGB light and CMYK ink

**Files:**
- Modify: `src/rendering/shaders.ts` (`printScreen`)

**Interfaces:**
- Consumes: `printChannel(s, channel, centrePixel)`; `uPrintAngles[4]`; `uPrintColour`.
- Produces: `printScreen` handles `uPrintColour` 0–3.

- [ ] **Step 1: Per-channel tone**

Give `printChannel` a channel weight so its tone comes from one component of the cell-centre colour instead of luminance: RGB uses `r`, `g`, `b` of the straight colour through `x/(.35+x)`; CMYK uses `k = 1 − max(r,g,b)` of the tone-mapped colour, then `c,m,y = (1 − rgb − k)/(1 − k)` (0 when `k = 1`). Invert swaps nothing here: `printInvert` is ignored in modes 2 and 3; hide it in Task 6.

- [ ] **Step 2: Combine**

- RGB light: `rgb = vec3(covR, covG, covB) * peak`, `peak = max(max(colour.r, colour.g), colour.b)` capped as the ink scale is, premultiplied by `plain.a`; alpha `= plain.a * max(covR, max(covG, covB))`, or `plain.a` over a paper swatch (paper shows where no light is).
- CMYK ink: `rgb = paper * (1 − covC*vec3(1,0,0)) * (1 − covM*vec3(0,1,0)) * (1 − covY*vec3(0,0,1)) * (1 − covK)`, `paper` white when `uPrintPaper<.5`; alpha `= plain.a * (1 − (1−covC)(1−covM)(1−covY)(1−covK))` when Paper is transparent, else `plain.a`.

- [ ] **Step 3: Measure cost**

In the app, a single Surface layer at the default preview size, Dots, CMYK: note the frame rate against Layer colour. If CMYK drops the preview below 30 fps on this machine, reduce neighbours in modes 2 and 3 from eight to the four that share an edge, and record the before and after rates in the commit message.

- [ ] **Step 4: Check in the app**

1. CMYK dots at size 7: rosette pattern, no seams, greys carried by black dots.
2. RGB light at size 9 on black: three coloured dot lattices that add to the layer's colour from a distance.
3. Both modes with Lines and with Dither.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/shaders.ts
git commit -m "Print screen finish: RGB light and CMYK ink screens"
```

---

### Task 5: Print area by edges

**Files:**
- Modify: `src/rendering/shaders.ts`

**Interfaces:**
- Consumes: `printTone`, `layerUv`, `sampleSource`.
- Produces: `float printEdge(vec2 frameUv)` returning 0–1 edge strength; `printScreen` multiplies `uPrintMix` by the area mask.

- [ ] **Step 1: Edge strength**

`printEdge(frameUv)`: centre tone and 24 taps, twelve directions at radius `uPrintEdgeWidth/1080` of frame height and twelve at half that, offset by 15°. `diff = max |tap tone − centre tone|`. Threshold `th = mix(.5, .02, uPrintEdgeSense)`; half-width `f = max(uPrintEdgeFeather * th, .004)`; result `smoothstep(th − f, th + f, diff)`.

- [ ] **Step 2: Apply**

Mask `= uPrintArea<.5 ? 1. : uPrintArea<1.5 ? edge : 1.−edge`. Evaluate `printEdge` at the own cell centre (channel 0's grid) for Dots and Dither and at the pixel for Lines. Skip all 24 taps when `uPrintArea<.5`. Final: `mix(plain, screened, uPrintMix * mask)`.

- [ ] **Step 3: Check in the app**

1. Sculpture with Edges only, width 16: dots follow the silhouette and inner creases; the interior is the plain layer.
2. Away from edges: the reverse.
3. Dots at the boundary of the band fade as whole dots, none are cut in half.
4. Edge sensitivity 0 to 1 moves from only the hardest edges to nearly everything.
5. Preview against a 4K export: the band is the same width.

- [ ] **Step 4: Commit**

```bash
git add src/rendering/shaders.ts
git commit -m "Print screen finish: limit the screen to edges or away from them"
```

---

### Task 6: Inspector, looks, Vary and README

**Files:**
- Modify: `src/ui/App.tsx` (Finish tab, about lines 574–575)
- Modify: `src/core/project.ts` (`FINISH_LOOKS`, `FINISH_LOOK_KEYS`, `finishSupported`, `varyLayer` near line 579)
- Modify: `README.md`
- Test: `tests/print.test.ts`

**Interfaces:**
- Consumes: `PRINT_KEYS`, `supportsPrint`.
- Produces: look ids `finish-halftone`, `finish-fine-halftone`, `finish-engraving`, `finish-comic-process`, `finish-rgb-raster`, `finish-bitmap-dither`, `finish-halftone-edges`.

- [ ] **Step 1: Write the failing tests** (append to `tests/print.test.ts`; add `PRESETS, applyFinish, applyPreset, finishSupported, varyLayer` to the project import)

```ts
test('print looks apply, replace other finishes and clear', () => {
  const layer = createLayer('surface');
  const halftone = applyFinish(layer, 'finish-halftone');
  assert.deepEqual([halftone.params.printMix, halftone.params.printType, halftone.params.printSize, halftone.params.printAngle], [1, 0, 8, 45]);
  const comic = applyFinish(applyFinish(layer, 'finish-soft-glow'), 'finish-comic-process');
  assert.deepEqual([comic.params.glowMix, comic.params.printColour, comic.params.printSize], [0, 3, 7]);
  const edges = applyFinish(layer, 'finish-halftone-edges');
  assert.deepEqual([edges.params.printArea, edges.params.printEdgeWidth], [1, 16]);
  const dither = applyFinish(layer, 'finish-bitmap-dither');
  assert.deepEqual([dither.params.printType, dither.params.printSize, dither.params.printMatrix, dither.params.printAngle], [2, 3, 2, 0]);
  assert.equal(applyFinish(halftone, 'finish-none').params.printMix, 0);
  assert.equal(applyFinish(halftone, 'finish-tunnel').params.printMix, 0);
});

test('print looks are unavailable on graphic patterns', () => {
  const graphic = createLayer('graphic');
  assert.equal(finishSupported(graphic, 'finish-halftone'), false);
});

test('vary never switches the screen or its stepped choices', () => {
  const stepped = ['printMix','printType','printDot','printMatrix','printScroll','printInvert','printColour','printInk','printPaper','printArea'];
  const off = createLayer('surface');
  const variedOff = varyLayer(off, 7, 1);
  for (const key of PRINT_KEYS) assert.equal(variedOff.params[key], off.params[key], key);
  const on = applyFinish(off, 'finish-halftone');
  const variedOn = varyLayer(on, 7, 1);
  for (const key of stepped) assert.equal(variedOn.params[key], on.params[key], key);
});
```

(Match `varyLayer`'s real argument order from `tests/glow.test.ts` line 75 onward before running.)

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/print.test.ts`
Expected: FAIL, unknown finish `finish-halftone`.

- [ ] **Step 3: Looks and support** in `src/core/project.ts`

Add the seven looks after Glowing Trails with the spec's values (all `printMix: 1`; Fine Halftone `printDot: 1, printSize: 4`; Engraving `printType: 1, printSize: 6, printAngle: 30`; Comic Process `printSize: 7, printColour: 3`; RGB Raster `printSize: 9, printColour: 2`; Bitmap Dither `printType: 2, printSize: 3, printMatrix: 2, printAngle: 0`; Halftone Edges `printArea: 1, printEdgeWidth: 16`). Append `...PRINT_KEYS` to `FINISH_LOOK_KEYS`. In `finishSupported`, also require `supportsPrint(layer)` when the look sets any print key. Update the "No finish" description to "Turns feedback, time displacement, glow and print screen off."

- [ ] **Step 4: Vary** in `varyLayer`

Beside the Glow rule: skip a print key when it is `printMix`, has `step === 1`, or `printMix` is not above 0; when it varies, anchor on the layer's own value as Glow does (`glow ? original : …` becomes `glow || print ? original : …`).

- [ ] **Step 5: Inspector section** in `src/ui/App.tsx`

Add `&&!PRINT_KEYS.includes(d.key)` to the Tonal finishing filter. After the Glow section add, under `supportsPrint(selected)`, a section titled **Print screen** with the caption "Halftone dots, line screens and ordered dither, sized in pixels of a 1080-line frame. Loops close exactly." Show `printMix` always and the rest only when `printMix > 0` or it is animated. Render these as `ChoiceParameter`, not sliders:

| Key | Options |
| --- | --- |
| `printType` | Dots, Lines, Dither |
| `printDot` | Round, Classic, Diamond, Square |
| `printMatrix` | 2×2, 4×4, 8×8 |
| `printColour` | Layer colour, Palette ink, RGB light, CMYK ink |
| `printArea` | Everywhere, Edges only, Away from edges |

Hide: `printDot` unless type 0; `printMatrix` unless type 2; `printInk` unless colour 1; `printInvert` when colour is 2 or 3; the three `printEdge…` keys when area is 0. Order follows the spec's four groups. Stepped keys pass `onAnimate={undefined}` as Glow does.

- [ ] **Step 6: README**

Add a "Print screen finish" bullet under the newest-changes list and a `## Print screen` section after `## Glow`, in the same style: what it is, each control group in one line, the seven looks, and that it is fixed to the frame, runs after Flat colour, and stays out of Feedback history.

- [ ] **Step 7: Run everything**

Run: `npm test`, `npm run build`, `npm run test:ui`
Expected: PASS. Then in the app: apply each of the seven looks to a Liquid Light layer, confirm they are greyed out on a Graphic Patterns layer, and that changing Screen type shows and hides the right controls.

- [ ] **Step 8: Commit**

```bash
git add src/ui/App.tsx src/core/project.ts README.md tests/print.test.ts
git commit -m "Print screen finish: inspector section, library looks and Vary rules"
```
