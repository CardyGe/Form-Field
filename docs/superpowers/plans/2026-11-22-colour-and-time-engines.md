# Colour and Time Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring 18 old Artefact effects into Form & Field as two shared engines: Colour and Lens (Split, Gradient Map, richer Glow, grading and Luma Key) and Time Sampler (Echo, Median, Darkest, Brightest, Vortex, Brightness Time and real future frames).

**Architecture:** Colour and Lens is one new full-screen pass that runs per layer after Feedback and Time, and before Glow and the composite, so it never enters the echo history. Time Sampler extends the existing stateless slit-scan loop, which re-renders the looping source at other phases, so every new mode loops exactly and needs no stored history. All controls are ordinary finish parameters, so saving, migration, modulation and the inspector follow the existing path.

**Tech Stack:** TypeScript, three.js 0.187 `WebGLRenderer`, GLSL through `ShaderMaterial`, React, `node:test` through `tsx`, Electron and Playwright render checks.

**Spec:** The [Artefact Effects Catalogue](https://claude.ai/artifact/UbnTLyEawmZVnqiLj5wK7n), steps 1 and 2. Old implementations are in `/Users/grego/Documents/Code/antigravity/artefact/effects-source/`: `gradientMap.js`, `rgbSplit.js`, `chromaShift.js`, `chromaWarp.js`, `edgeChromaAberration.js`, `prismaticGlitch.js`, `channelSwap.js`, `chromaHalo.js`, `bloom.js`, `infrared.js`, `temporalEcho.js`, `temporalMedian.js`, `temporalVortex.js`, `reverseEcho.js`, `timeRemap.js`.

## What this covers

| Old effect | Where it lands |
|---|---|
| RGB Split, Chroma Shift | Split: Straight and Lens shapes |
| Edge Chroma | Split: Edges shape |
| Chroma Warp | Split: Wave shape |
| Prism | Split: spectral samples |
| Channel Swap | Split: channel order and blocks |
| Gradient Map, Infrared | Gradient Map and its palettes |
| Colour Grade | Temperature and Tint, using the existing exposure and tone controls |
| Color Shift | Shadow and highlight tint |
| Luma Key | Key finish: cut by brightness or hue |
| Chroma Halo | Glow: Colour spread |
| Bloom streak and starburst | Glow: Streak, Line or Cross |
| Temporal Echo | Time mode: Echo |
| Reverse Echo | Time mode: Echo, direction Future |
| Temporal Median | Time modes: Median, Darkest, Brightest |
| Temporal Vortex | Rings map with Twist, Zoom and Colour lag |
| Time Remap | Brightness and Bands delay maps |

Color Offset is not in this plan because the catalogue marks it as leave.

## Global Constraints

- Build on a new branch `colour-time-engines` from `main` at `4a8acdd`, in the worktree `/Users/grego/Documents/ChatGPT/three VJ - Colour Time`. Do not build on `map-stage-1`, which is 89 commits behind `main`.
- Test baseline on `4a8acdd`: **503 pass, 0 fail**.
- Every new control defaults to off or neutral. Existing projects, presets, loops, seeking and exports render pixel-identically.
- Project schema stays at version 2. New keys migrate through `FINISH_KEYS`.
- Do not change the Live or Map code. Map picks up finishes through its saved projects and needs no work.
- Sizes are in pixels of a 1080-line frame. Motion is in whole cycles per loop.
- Work in linear premultiplied half-float. RGB must never exceed alpha on output from a new pass.
- Graphic layers take no Split, Gradient Map or Glow additions, matching `supportsGlow`.
- Each effect stays a separate control. Add only the eight finish looks in Tasks 6 and 10, with no combined starter or reference-matching preset.
- Variations never switch a new effect on, and never change a mode, shape, order, palette or stepped choice.
- Use plain labels in the UI. Do not show "chromatic aberration", "dispersion", "median filter" or "temporal".
- Finish parameters automatically create a composite uniform named `u` + capitalised key. Any hand-written uniform must avoid those names, so the streak texture is `uGlowStreakMap`.

## Review Focus

1. **Transparent layers:** a soft-edged layer with Split, Median or Colour lag must not gain bright fringes outside its coverage. Pinned in Tasks 2, 5 and 9.
2. **Older project files:** a saved project without the new keys opens and renders exactly as before. Pinned in Tasks 1, 7 and 11.
3. **Tile Edges:** Split and Streak must wrap across the frame edge, so seamless tiles stay seamless. Pinned in Tasks 2 and 4.
4. **4K and supersampled Median:** nine full-size slices must not exhaust GPU memory or fail the export. Pinned in Tasks 7 and 9.
5. **Colour over Feedback:** Split and Gradient Map on an echoing layer must colour the output once and never compound through the history. Pinned in Task 3.

---

### Task 1: Colour and Lens rules

**Files:**
- Create: `src/rendering/colour-lens.ts`, `tests/colour-lens.test.ts`
- Modify: `src/core/finishing.ts`, `src/core/project.ts`, `tests/glow.test.ts`

**Interfaces:**
- Produces from `finishing.ts`: `SPLIT_PARAMETERS`, `GRADIENT_PARAMETERS`, `SPLIT_KEYS`, `GRADIENT_KEYS`, with `GLOW_PARAMETERS` extended.
- Produces from `colour-lens.ts`:
  - `SPLIT_SHAPES`, `SPLIT_ORDERS`, `GRADIENT_PALETTES: { name: string; stops: string[] }[]`
  - `supportsLens(layer: Pick<Layer,'kind'>): boolean`
  - `lensActive(layer: Pick<Layer,'kind'|'params'|'modulations'>): boolean`
  - `spectralWeights(count: number): { offset: number; weight: [number, number, number] }[]`
  - `gradientTone(luma: number, midpoint: number): number`
  - `gradientStops(index: number, palette: string[]): string[]`

New parameters, in this order. All are `section:'Material'` except `splitTravel` and `gradCycles`, which are `'Motion'`:

| Key | Label | Min | Max | Step | Default |
|---|---|---:|---:|---:|---:|
| `splitAmount` | Split amount | 0 | 64 | .25 | 0 |
| `splitShape` | Split shape | 0 | 3 | 1 | 0 |
| `splitAngle` | Split angle | -180 | 180 | 1 | 0 |
| `splitSamples` | Colour smoothness | 3 | 15 | 1 | 3 |
| `splitThreshold` | Edge threshold | 0 | 1 | .01 | .15 |
| `splitWaves` | Waves | 1 | 24 | 1 | 4 |
| `splitTravel` | Wave travel per loop | -8 | 8 | 1 | 1 |
| `splitOrder` | Channel order | 0 | 5 | 1 | 0 |
| `splitBlocks` | Order blocks | 0 | 64 | 1 | 0 |
| `splitChance` | Block chance | 0 | 1 | .01 | .5 |
| `gradMix` | Gradient map | 0 | 1 | .01 | 0 |
| `gradPalette` | Gradient colours | 0 | 9 | 1 | 0 |
| `gradMidpoint` | Gradient midpoint | .05 | .95 | .01 | .5 |
| `gradOffset` | Gradient offset | 0 | 1 | .01 | 0 |
| `gradCycles` | Gradient cycles per loop | -8 | 8 | 1 | 0 |
| `gradKeep` | Keep brightness | 0 | 1 | 1 | 0 |
| `glowSpread` | Glow colour spread | 0 | 1 | .01 | 0 |
| `glowStreak` | Glow streak | 0 | 2 | .01 | 0 |
| `glowStreakAngle` | Streak angle | -90 | 90 | 1 | 0 |
| `glowStreakShape` | Streak shape | 0 | 1 | 1 | 0 |

- `SPLIT_SHAPES = ['Straight','Lens','Edges','Wave']`
- `SPLIT_ORDERS = ['RGB','GBR','BRG','RBG','GRB','BGR']`
- `GRADIENT_PALETTES[0]` is `{ name:'Layer palette', stops:[] }`. The other nine are authored dark to bright and must keep their order:

`Neon #0d0033 #e61a80 #ffe64d`, `Toxic #001a0d #4de633 #e6ff66`, `Cyber #050026 #1ae6f2 #ff33cc`, `Infrared #00001a #cc0000 #ffe6b3`, `Duotone #0d0d1a #8066cc #fff2ff`, `Vapor #330d66 #f266b3 #4df2ff`, `Blood #0d0000 #80000d #ff801a`, `Deep #00051a #006699 #80f2e6`, `Acid #1a0026 #99ff00 #ff4de6`.

- [ ] **Step 1: Create the worktree and confirm the baseline**

```bash
git -C "/Users/grego/Documents/ChatGPT/three VJ" worktree add -b colour-time-engines "/Users/grego/Documents/ChatGPT/three VJ - Colour Time" 4a8acdd
```

```bash
cd "/Users/grego/Documents/ChatGPT/three VJ - Colour Time" && npm ci && npx tsx --test tests/*.test.ts
```

Expected: 503 pass, 0 fail.

- [ ] **Step 2: Write the failing tests in `tests/colour-lens.test.ts`**

```ts
test('colour and lens are off by default and older projects migrate without them', () => {
  const project = createProject();
  for (const layer of project.layers) {
    assert.equal(lensActive(layer), false);
    for (const key of [...SPLIT_KEYS, ...GRADIENT_KEYS]) delete layer.params[key];
  }
  const migrated = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(migrated.layers[0].params.splitAmount, 0);
  assert.equal(migrated.layers[0].params.gradMix, 0);
});
test('lens runs when animated from zero and never on graphic patterns', () => {
  const layer = createLayer('surface');
  assert.equal(lensActive({ ...layer, modulations: { splitAmount: {} as never } }), true);
  assert.equal(lensActive({ ...layer, params: { ...layer.params, gradMix: .4 } }), true);
  assert.equal(lensActive({ ...layer, params: { ...layer.params, splitOrder: 2 } }), true);
  const graphic = createLayer('graphic');
  assert.equal(lensActive({ ...graphic, params: { ...graphic.params, splitAmount: 8 } }), false);
  assert.equal(visibleParameterDefinitions(graphic).some(d => [...SPLIT_KEYS, ...GRADIENT_KEYS].includes(d.key)), false);
});
test('three spectral samples are pure red, green and blue', () => {
  assert.deepEqual(spectralWeights(3).map(s => s.weight), [[1,0,0],[0,1,0],[0,0,1]]);
  assert.deepEqual(spectralWeights(3).map(s => s.offset), [-.5,0,.5]);
});
test('spectral weights keep neutral colour at every sample count', () => {
  for (let n = 3; n <= 15; n++) for (const c of [0,1,2]) {
    const sum = spectralWeights(n).reduce((a, s) => a + s.weight[c], 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${n}:${c}`);
  }
});
test('gradient tone is perceptual, bounded, and bent by the midpoint', () => {
  assert.equal(gradientTone(0, .5), 0);
  assert.equal(gradientTone(1, .5), 1);
  assert.equal(gradientTone(8, .5), 1);
  assert.ok(Math.abs(gradientTone(Math.pow(.5, 2.2), .5) - .5) < 1e-9);
  assert.ok(gradientTone(.2, .25) > gradientTone(.2, .75));
});
test('layer palette stops run dark to bright, authored palettes keep their order', () => {
  assert.deepEqual(gradientStops(0, ['#ffffff','#000000','#808080']), ['#000000','#808080','#ffffff']);
  assert.deepEqual(gradientStops(3, []), ['#050026','#1ae6f2','#ff33cc']);
});
test('variations never switch colour effects on or change their choices', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, { palette:false, structure:false, motion:false, material:false }, entropy);
      for (const key of [...SPLIT_KEYS, ...GRADIENT_KEYS]) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
      for (const key of ['glowSpread','glowStreak','glowStreakShape']) if (!layer.params.glowMix) assert.equal(varied.params[key], layer.params[key]);
    }
  }
});
```

In `tests/glow.test.ts`, change the expected `GLOW_KEYS` to `['glowMix','glowThreshold','glowSize','glowTint','glowSpread','glowStreak','glowStreakAngle','glowStreakShape']`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx tsx --test tests/colour-lens.test.ts tests/glow.test.ts`
Expected: FAIL, because `colour-lens` cannot be resolved.

- [ ] **Step 4: Implement the parameters, rules and project wiring**

`lensActive` is true when the layer is supported and `splitAmount > 0`, `splitOrder > 0`, `gradMix > 0`, or `splitAmount` or `gradMix` is modulated.

`spectralWeights`: for sample `i`, let `t = i/(count-1)` and `offset = t - .5`. Raw channel weights are `max(0, 1 - 2|t - c|)` with `c` = 0, .5 and 1. Divide each channel by its own total.

`gradientTone`: `pow(pow(clamp(luma,0,1), 1/2.2), log(.5)/log(midpoint))`.

In `project.ts`:
- Add both key lists to `FINISH_LOOK_KEYS`.
- Filter them in `visibleParameterDefinitions` when `!supportsLens(layer)`.
- Require `supportsLens` in `finishSupported` for looks that set them.
- In `varyLayer`, skip every Split and Gradient key, and skip `glowSpread`, `glowStreak`, `glowStreakAngle` and `glowStreakShape` when glow is off. Treat `glowStreakShape` as fixed always.

- [ ] **Step 5: Run the full suite**

Run: `npx tsx --test tests/*.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/rendering/colour-lens.ts src/core/finishing.ts src/core/project.ts tests/colour-lens.test.ts tests/glow.test.ts
git commit -m "Add colour and lens finish controls"
```

### Task 2: Split pass and render proof harness

**Files:**
- Modify: `src/rendering/colour-lens.ts`, `src/rendering/StudioRenderer.ts`
- Create: `scripts/verify-colour-time.mjs`

**Interfaces:**
- Consumes: Task 1 rules.
- Produces: `lensFragment: string`; `StudioRenderer.lensSource(original: Layer, layer: Layer, source: THREE.Texture, phase: number, width: number, height: number): THREE.Texture`; a script accepting `--baseline=<checkout>` and `--only=<check>`.

- [ ] **Step 1: Create the baseline checkout**

```bash
git -C "/Users/grego/Documents/ChatGPT/three VJ" worktree add --detach "/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" 4a8acdd
```

```bash
ln -s "/Users/grego/Documents/ChatGPT/three VJ - Colour Time/node_modules" "/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline/node_modules"
```

- [ ] **Step 2: Write the failing render checks**

Build `scripts/verify-colour-time.mjs` on the Electron bundling and `shot`/`difference` helpers in `scripts/verify-glow.mjs`. Add these checks:

- `neutral`: for one preset of every kind, a 960x540 PNG equals the baseline byte for byte.
- `split-grey`: a neutral grey layer with `splitAmount:12, splitSamples:9` stays neutral, with mean `|R-G|` and `|G-B|` under 1/255.
- `split-alpha`: a soft-masked layer on a transparent project, each Split shape at amount 32. Pixels with zero source coverage across the whole split reach stay at alpha 0, and in the straight-alpha PNG no partly covered pixel exceeds the brightest source channel by more than 2/255.
- `split-scale`: the same layer at 960x540 and 1920x1080, downsampled, differs by a mean under 2/255.
- `split-tile`: with `tileEdges` on, the mean difference across the left and right edge columns is within 1.25x of the difference between two adjacent interior columns.
- `split-loop`: Wave shape, phase 0 and phase TAU match byte for byte.

- [ ] **Step 3: Run the checks to verify they fail**

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" --only=split`
Expected: `split-grey` passes trivially, and `split-alpha` or `split-loop` reports that Split has no effect on the render.

- [ ] **Step 4: Implement the pass**

In `renderFrame`, after `sourceTexture` is chosen:

```ts
const finished = lensActive(original) ? this.lensSource(original, layer, sourceTexture, wrapped, width, height) : sourceTexture;
```

Use `finished` for `u.uSource` and `bindGlow`. Keep one half-float target sized to the render, and call `setWrap(target, this.tiling)`. Dispose it in `dispose()`.

Shader rules:
- Offset per sample is `spectral.offset * amount / 1080 * direction`, corrected for aspect. Weights arrive in `uniform vec3 uSplitWeights[15]`.
- Straight uses `splitAngle`. Lens points away from the centre and scales with radius. Edges multiplies Straight by `smoothstep(threshold, threshold+.2, sobel luma)`. Wave multiplies Straight by `sin(TAU*(waves*uv.y + travel*phase/TAU))`.
- Sample with wrapped coordinates when tiling and clamped coordinates otherwise.
- Output alpha is the mean of the sample alphas weighted by the green weights. Then clamp `rgb = min(rgb, alpha)`.
- Channel order applies after sampling. With `splitBlocks > 0`, each block of `blocks` per frame height is permuted when a seeded hash is below `splitChance`.

- [ ] **Step 5: Run the checks and unit tests**

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" --only=neutral,split`
Expected: all listed checks print PASS.

Run: `npx tsc --noEmit && npx tsx --test tests/*.test.ts`
Expected: clean and all pass.

- [ ] **Step 6: Commit**

```bash
git add src/rendering/colour-lens.ts src/rendering/StudioRenderer.ts scripts/verify-colour-time.mjs
git commit -m "Render the Split finish"
```

### Task 3: Gradient Map

**Files:**
- Modify: `src/rendering/colour-lens.ts`, `src/rendering/StudioRenderer.ts`, `scripts/verify-colour-time.mjs`

**Interfaces:**
- Consumes: `gradientStops`, `gradientTone`, `lensSource`.
- Produces: gradient stage inside `lensFragment`, with uniforms `uGradStops[6]` and `uGradCount`.

- [ ] **Step 1: Add the failing render checks**

- `gradient-map`: a black-to-white ramp with the Neon palette at `gradMix:1` matches `#0d0033` at the dark end and `#ffe64d` at the bright end, within 3/255.
- `gradient-alpha`: a soft mask keeps its alpha within 1/255 of the unmapped layer.
- `gradient-loop`: `gradCycles:3`, phase 0 and TAU match byte for byte.
- `gradient-echo`: an echoing layer (`echo:.9`) with Gradient Map at frame 60, exported twice from different seek orders, is byte-identical, and it matches a CPU copy of the map applied once to the same layer exported with `gradMix:0`, within 4/255. A compounding map would fail this.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" --only=gradient`
Expected: `gradient-map` FAIL.

- [ ] **Step 3: Implement the gradient stage**

Run it after Split on unpremultiplied colour. Tone comes from `gradientTone` mirrored in GLSL, plus `gradOffset + gradCycles*phase/TAU`. When the offset is non-zero, fold tone with a triangle wave so the top and bottom meet without a seam. Interpolate stops evenly with smoothstep between neighbours. Bind colours with `THREE.Color.set(hex)`, which converts to linear.

`gradKeep` scales the mapped colour so its luma equals the input luma. Otherwise, values above 1 keep their extra brightness by multiplying the mapped colour by `max(luma, 1)`. Mix by `gradMix` and re-premultiply.

- [ ] **Step 4: Run checks**

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" --only=neutral,gradient`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/colour-lens.ts src/rendering/StudioRenderer.ts scripts/verify-colour-time.mjs
git commit -m "Render the Gradient Map finish"
```

### Task 4: Richer Glow

**Files:**
- Modify: `src/rendering/bloom.ts`, `src/rendering/shaders.ts`, `src/rendering/StudioRenderer.ts`, `tests/glow.test.ts`, `scripts/verify-colour-time.mjs`

**Interfaces:**
- Produces: `bloomChannelWeights(amount: number, size: number, spread: number): [number,number,number][]`; class `StreakBlur` with `render(source, width, height, angle, cross, draw, wrap): THREE.Texture` and `dispose()`.

- [ ] **Step 1: Write the failing test**

```ts
test('colour spread is neutral at zero and moves red tighter and blue wider', () => {
  const plain = bloomWeights(1, .5);
  bloomChannelWeights(1, .5, 0).forEach((level, i) => assert.deepEqual(level, [plain[i], plain[i], plain[i]]));
  const spread = bloomChannelWeights(1, .5, 1);
  assert.ok(spread[0][0] > spread[0][2], 'red favours the tight level');
  assert.ok(spread[4][2] > spread[4][0], 'blue favours the wide level');
});
```

Add render checks `glow-neutral` (the existing glow looks equal baseline), `streak-scale` (960 and 1920 widths differ under 2/255 after downsample) and `streak-tile` (same edge rule as `split-tile`).

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/glow.test.ts`
Expected: FAIL, `bloomChannelWeights` is not exported.

- [ ] **Step 3: Implement**

`bloomChannelWeights` calls `bloomWeights` with sizes `clamp(size - .35*spread)`, `size` and `clamp(size + .35*spread)`.

`StreakBlur` runs four one-direction passes at half the bright target's resolution, doubling the step each pass, with step lengths defined per 1080 lines. Cross runs a second chain at `angle + 90` and adds the two.

In the composite, change glow to use `uniform vec3 uGlowChannels[5]`, and add `uGlowStreak * texture2D(uGlowStreakMap, g).rgb` before tint. Bind `this.fallback` when the streak is off.

- [ ] **Step 4: Run tests and checks**

Run: `npx tsx --test tests/glow.test.ts`
Expected: PASS.

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" --only=neutral,glow,streak`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/bloom.ts src/rendering/shaders.ts src/rendering/StudioRenderer.ts tests/glow.test.ts scripts/verify-colour-time.mjs
git commit -m "Add colour spread and streaks to Glow"
```

### Task 5: Grading and Luma Key

**Files:**
- Modify: `src/core/finishing.ts`, `src/core/project.ts`, `src/rendering/colour-lens.ts`, `src/rendering/StudioRenderer.ts`, `tests/colour-lens.test.ts`, `scripts/verify-colour-time.mjs`

**Interfaces:**
- Consumes: `lensFragment`, `lensSource`, `lensActive`.
- Produces: `GRADE_PARAMETERS`, `KEY_PARAMETERS`, `GRADE_KEYS`, `KEY_KEYS`; `whiteBalance(temperature: number, tint: number): [number, number, number]`; `keyCoverage(value: number, low: number, high: number, softness: number, invert: number): number`.

| Key | Label | Min | Max | Step | Default |
|---|---|---:|---:|---:|---:|
| `gradeTemperature` | Temperature | -1 | 1 | .01 | 0 |
| `gradeTint` | Tint | -1 | 1 | .01 | 0 |
| `gradeShadowTint` | Shadow tint | 0 | 1 | .01 | 0 |
| `gradeShadowColour` | Shadow colour | 1 | 6 | 1 | 1 |
| `gradeHighlightTint` | Highlight tint | 0 | 1 | .01 | 0 |
| `gradeHighlightColour` | Highlight colour | 1 | 6 | 1 | 2 |
| `keyMix` | Key | 0 | 1 | .01 | 0 |
| `keyMode` | Key by | 0 | 1 | 1 | 0 |
| `keyLow` | Key low | 0 | 1 | .01 | .25 |
| `keyHigh` | Key high | 0 | 1 | .01 | 1 |
| `keySoftness` | Key softness | 0 | 1 | .01 | .1 |
| `keyHue` | Key hue | 0 | 360 | 1 | 120 |
| `keyHueRange` | Hue range | 1 | 180 | 1 | 40 |
| `keyInvert` | Invert key | 0 | 1 | 1 | 0 |

All are `section:'Material'`. Shadow and highlight colours are swatches of the layer palette.

- [ ] **Step 1: Write the failing tests**

```ts
test('neutral white balance changes nothing, and keeps brightness when moved', () => {
  assert.deepEqual(whiteBalance(0, 0), [1, 1, 1]);
  const warm = whiteBalance(1, 0), luma = (c: number[]) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  assert.ok(warm[0] > 1 && warm[2] < 1);
  assert.ok(Math.abs(luma(warm) - 1) < 1e-9);
  assert.ok(whiteBalance(0, 1)[1] < 1, 'positive tint moves towards magenta');
});
test('key coverage keeps the range, feathers its edges and inverts', () => {
  assert.equal(keyCoverage(.5, .25, .75, 0, 0), 1);
  assert.equal(keyCoverage(.1, .25, .75, 0, 0), 0);
  assert.equal(keyCoverage(.1, .25, .75, 0, 1), 1);
  const edge = keyCoverage(.25, .25, .75, .2, 0);
  assert.ok(edge > 0 && edge < 1);
});
test('grading and key turn the lens pass on, and variations never switch them on', () => {
  const layer = createLayer('surface');
  for (const params of [{ gradeTemperature: .2 }, { gradeTint: -.2 }, { gradeShadowTint: .3 }, { gradeHighlightTint: .3 }, { keyMix: 1 }])
    assert.equal(lensActive({ ...layer, params: { ...layer.params, ...params } }), true);
  const varied = varyLayer(layer, 1, { palette:false, structure:false, motion:false, material:false }, 2);
  for (const key of [...GRADE_KEYS, ...KEY_KEYS]) assert.equal(varied.params[key], layer.params[key]);
});
```

Add render checks `grade-grey` (zero tints equal baseline), `grade-temperature` (a grey layer gets warmer with unchanged luma within 2/255), `key-alpha` (a ramp keyed at .5 is transparent below the key and unchanged above it, with no bright fringe at the soft edge) and `key-hue` (a colour-bar layer keeps only the green bar).

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/colour-lens.test.ts`
Expected: FAIL, `whiteBalance` is not exported.

- [ ] **Step 3: Implement**

`whiteBalance`: start from `[1 + .25*t, 1 - .15*n, 1 - .25*t]`, where `t` is temperature and `n` is tint, then divide all three by their Rec. 709 luma.

Run grading after Gradient Map on unpremultiplied colour. Shadow tint weights by `1 - smoothstep(0,.5,tone)` and highlight tint by `smoothstep(.5,1,tone)`, where `tone` is the perceptual luma, and each tint keeps the pixel's luma.

Run Key last. Coverage comes from brightness, or from a circular hue distance with `keyHue` and `keyHueRange`. Multiply RGB and alpha together by `mix(1, coverage, keyMix)`. Add both key lists to `FINISH_LOOK_KEYS` and to the `supportsLens` filter. In `varyLayer`, skip all of them.

- [ ] **Step 4: Run tests and checks**

Run: `npx tsc --noEmit && npx tsx --test tests/*.test.ts`
Expected: clean and all pass.

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" --only=neutral,grade,key`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/finishing.ts src/core/project.ts src/rendering/colour-lens.ts src/rendering/StudioRenderer.ts tests/colour-lens.test.ts scripts/verify-colour-time.mjs
git commit -m "Add white balance, split toning and Luma Key"
```

### Task 6: Colour controls and looks

**Files:**
- Create: `src/ui/ColourSections.tsx`
- Modify: `src/ui/App.tsx`, `src/core/project.ts`, `tests/colour-lens.test.ts`, `scripts/verify-workspace-ui.mjs`

**Interfaces:**
- Consumes: `Parameter` from `src/ui/LayerControls.tsx`, the Task 1 and Task 5 lists.
- Produces: `ColourSplitSection`, `GradientMapSection`, `ColourBalanceSection` and `KeySection`, with the same props as `PrintScreenSection`; pure `splitControlVisible(layer, key)` and `gradientControlVisible(layer, key)` exported from `colour-lens.ts`.

Looks to add to `FINISH_LOOKS`:

- `finish-edge-prism`, Edge Prism: `{ splitAmount: 10, splitShape: 2, splitSamples: 9 }`
- `finish-neon-map`, Neon Map: `{ gradMix: 1, gradPalette: 1 }`
- `finish-anamorphic`, Anamorphic: `{ glowMix: 1.2, glowThreshold: .7, glowSize: .35, glowStreak: .8 }`

- [ ] **Step 1: Write the failing tests**

```ts
test('split controls appear only when they apply', () => {
  const on = (params: Record<string, number>) => ({ ...createLayer('surface'), params: { ...createLayer('surface').params, splitAmount: 8, ...params } });
  assert.equal(splitControlVisible(createLayer('surface'), 'splitAmount'), true);
  assert.equal(splitControlVisible(createLayer('surface'), 'splitAngle'), false);
  assert.equal(splitControlVisible(on({ splitShape: 1 }), 'splitAngle'), false);
  assert.equal(splitControlVisible(on({ splitShape: 2 }), 'splitThreshold'), true);
  assert.equal(splitControlVisible(on({ splitShape: 3 }), 'splitTravel'), true);
  assert.equal(splitControlVisible(on({ splitShape: 0 }), 'splitWaves'), false);
  assert.equal(splitControlVisible(on({ splitOrder: 0 }), 'splitBlocks'), false);
});
test('colour looks apply, replace other finishes and clear', () => {
  const layer = applyFinish(createLayer('surface'), 'finish-edge-prism');
  assert.equal(layer.params.splitShape, 2);
  const mapped = applyFinish(layer, 'finish-neon-map');
  assert.deepEqual([mapped.params.splitAmount, mapped.params.gradMix], [0, 1]);
  assert.equal(applyFinish(mapped, 'finish-none').params.gradMix, 0);
  assert.equal(finishSupported(createLayer('scope'), 'finish-anamorphic'), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/colour-lens.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Place the sections after Glow in the Finish tab. `splitAmount` and `splitOrder` are always visible. Shape and sample controls need Split amount above 0 or animated, Angle is hidden for Lens, Threshold shows only for Edges, Waves and Wave travel show only for Wave, and Order blocks and Block chance need a channel order other than RGB. Use `ChoiceParameter` from `src/ui/LayerControls.tsx` for stepped choices. Section copy:

- Colour split: "Pulls colour apart along edges, lenses or waves. Loops close exactly."
- Gradient map: "Recolours the layer by brightness using a palette."
- Colour balance: "Warms, cools and tints the layer, with separate shadow and highlight colour."
- Key: "Cuts the layer out by brightness or colour."

Update `verify-workspace-ui.mjs` to expect `22` finish cards.

- [ ] **Step 4: Run all checks**

Run: `npx tsc --noEmit && npx tsx --test tests/*.test.ts && npm run test:workspace`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ColourSections.tsx src/ui/App.tsx src/rendering/colour-lens.ts src/core/project.ts tests/colour-lens.test.ts scripts/verify-workspace-ui.mjs
git commit -m "Add colour split and gradient map controls"
```

### Task 7: Time Sampler rules

**Files:**
- Modify: `src/core/finishing.ts`, `src/rendering/slitscan.ts`, `src/core/project.ts`, `tests/slitscan.test.ts`

**Interfaces:**
- Produces from `slitscan.ts`:
  - `SLIT_MODES = ['Delay map','Echo','Median','Darkest','Brightest']`
  - `SLIT_SHAPES`, extended with `'Brightness','Bands'`
  - `sliceCount(params: Record<string, number>): number`
  - `slicePhase(phase: number, delay: number, total: number, direction: number): number`
  - `echoWeights(count: number, decay: number): number[]`
  - `channelSliceCounts(count: number, reach: number): [number, number, number]`
  - `medianOf(values: number[]): number`
  - `medianTargetSize(width: number, height: number, slices: number): { width: number; height: number }`

Append to `SLIT_PARAMETERS`, with `slitShape.max` raised to 6:

| Key | Label | Min | Max | Step | Default | Section |
|---|---|---:|---:|---:|---:|---|
| `slitMode` | Time mode | 0 | 4 | 1 | 0 | Shape |
| `slitDirection` | Direction | 0 | 1 | 1 | 0 | Motion |
| `slitDecay` | Echo fade | .05 | 1 | .01 | .7 | Material |
| `slitReach` | Colour reach | .1 | 1 | .01 | 1 | Material |
| `slitTwist` | Twist | -4 | 4 | .01 | 0 | Shape |
| `slitZoom` | Time zoom | 0 | .9 | .01 | 0 | Shape |
| `slitChroma` | Colour lag | 0 | 1 | .01 | 0 | Material |

- [ ] **Step 1: Write the failing tests**

```ts
test('median uses an odd slice count of at most nine', () => {
  assert.equal(sliceCount({ slitMode: 2, slitSlices: 12 }), 9);
  assert.equal(sliceCount({ slitMode: 2, slitSlices: 4 }), 5);
  assert.equal(sliceCount({ slitMode: 2, slitSlices: 2 }), 3);
  assert.equal(sliceCount({ slitMode: 0, slitSlices: 12 }), 12);
  assert.equal(sliceDelays({ params: { slitMode: 2, slitShift: 1, slitSpan: 32, slitSlices: 12 } }).length, 9);
});
test('slices reach backward by default and forward in Future, wrapped to the loop', () => {
  const TAU = Math.PI * 2;
  assert.ok(Math.abs(slicePhase(0, 10, 100, 0) - TAU * .9) < 1e-9);
  assert.ok(Math.abs(slicePhase(TAU * .95, 10, 100, 1) - TAU * .05) < 1e-9);
});
test('echo weights sum to one and fade with age', () => {
  const w = echoWeights(5, .5);
  assert.ok(Math.abs(w.reduce((a, b) => a + b) - 1) < 1e-9);
  assert.ok(w.every((v, i) => i === 0 || v < w[i - 1]));
  assert.deepEqual(echoWeights(4, 1), [.25, .25, .25, .25]);
});
test('colour reach gives red the shortest memory and blue all of it', () => {
  assert.deepEqual(channelSliceCounts(9, 1), [9, 9, 9]);
  assert.deepEqual(channelSliceCounts(9, .4), [4, 7, 9]);
  assert.deepEqual(channelSliceCounts(3, .1), [1, 2, 3]);
});
test('median handles odd and even counts', () => {
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([4, 1, 3, 2]), 2.5);
  assert.equal(medianOf([7]), 7);
});
test('median slices fit the memory budget at any size', () => {
  assert.deepEqual(medianTargetSize(3840, 2160, 9), { width: 3840, height: 2160 });
  const big = medianTargetSize(7680, 4320, 9);
  assert.ok(big.width * big.height * 8 * 9 <= 768 * 1024 * 1024);
  assert.ok(Math.abs(big.width / big.height - 16 / 9) < .01);
});
test('older time displacement settings keep their meaning', () => {
  const project = createProject();
  const layer = project.layers[0];
  layer.params.slitShift = 1; layer.params.slitShape = 4;
  for (const key of ['slitMode','slitDirection','slitDecay','slitReach','slitTwist','slitZoom','slitChroma']) delete layer.params[key];
  const migrated = validateProject(JSON.parse(JSON.stringify(project))).layers[0].params;
  assert.deepEqual([migrated.slitShape, migrated.slitMode, migrated.slitDirection, migrated.slitTwist], [4, 0, 0, 0]);
});
```

Extend the existing variation test's fixed keys with `slitMode` and `slitDirection`.

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/slitscan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `sliceCount`: for Median, `min(9, max(2, round(slices)) | 1)`. Otherwise today's rule.
- `sliceDelays` calls `sliceCount`.
- `echoWeights`: `decay^i`, normalised.
- `channelSliceCounts`: `r = max(1, round(count*reach))`, `g = round((r+count)/2)`, `b = count`.
- `medianTargetSize`: returns the input when `width*height*8*slices <= 768 MiB`. Otherwise scales both sides by the square root of the ratio and floors them.
- In `varyLayer`, add `slitMode`, `slitDirection` and `slitTwist` to the fixed Time keys.

- [ ] **Step 4: Run the full suite**

Run: `npx tsx --test tests/*.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/finishing.ts src/rendering/slitscan.ts src/core/project.ts tests/slitscan.test.ts
git commit -m "Add time sampler controls and rules"
```

### Task 8: New delay maps, Vortex and Future

**Files:**
- Modify: `src/rendering/slitscan.ts`, `src/rendering/StudioRenderer.ts`, `scripts/verify-colour-time.mjs`

**Interfaces:**
- Consumes: `slicePhase`, `SLIT_SHAPES`.
- Produces: `slitFragment` with `uDriver`, `uTwist`, `uZoom`, `uChroma`; a private driver target in `StudioRenderer`.

- [ ] **Step 1: Add the failing render checks**

- `time-neutral`: the three existing time looks equal baseline byte for byte.
- `time-brightness`: on a moving layer with a brightness ramp, Brightness map output differs from plain Rows, and a fully dark and fully bright region show different phases.
- `time-bands`: Bands alternates delay between adjacent bands.
- `time-vortex`: Rings with `slitTwist:.5` differs from Rings alone, and phase 0 equals phase TAU byte for byte.
- `time-future`: with direction Future and a full-frame layer, the output at phase P with `slitShift:1`, span S and a Blocks map matches direction Past at phase P+S with `slitShift:-1` within 1/255, at `slitSmooth:0`.
- `time-seek`: rendering frame 40 directly equals rendering frames 0 to 40 in order.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" --only=time`
Expected: `time-brightness` FAIL.

- [ ] **Step 3: Implement**

In `slices()`, replace the inline phase with `slicePhase`.

- **Brightness map:** before the slice loop, draw the source at the current phase into a half-size half-float driver target using `this.copy`, because `plainSource` reuses its target. Delay is `1 - pow(luma, 1/2.2)` of the unpremultiplied driver.
- **Bands map:** `mod(floor(uv.y * uBlocks), 2.)`.
- **Vortex:** rotate the sampling coordinate about the frame centre, in aspect-corrected space, by `TAU * uTwist * delay`, and scale it by `1 - uZoom * delay`. Keep `delayMap(vUv)` unwarped. Mirror coordinates outside 0 to 1, or wrap them when tiling.
- **Colour lag:** evaluate the weight at `position ± uChroma * (uCount-1) * .25` for red and blue, clamped to the slice range. Green and alpha use the unshifted weight. On the final slice, clamp `rgb = min(rgb, a)` only when `uChroma > 0`.

All neutral values must leave the existing arithmetic unchanged.

- [ ] **Step 4: Run checks**

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" --only=neutral,time`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/slitscan.ts src/rendering/StudioRenderer.ts scripts/verify-colour-time.mjs
git commit -m "Add brightness, bands, vortex and future time"
```

### Task 9: Echo, Median, Darkest and Brightest

**Files:**
- Create: `src/rendering/time-stats.ts`
- Modify: `src/rendering/StudioRenderer.ts`, `scripts/verify-colour-time.mjs`

**Interfaces:**
- Consumes: `sliceCount`, `echoWeights`, `channelSliceCounts`, `medianTargetSize`, `slicePhase`.
- Produces: `timeGatherFragment: string` for Echo, Darkest and Brightest; `timeMedianFragment: string`; private `StudioRenderer.statSlices(original, phase, total, duration): THREE.Texture`.

- [ ] **Step 1: Add the failing render checks**

- `stats-order`: a three-frame step sequence through a test image matches a CPU `medianOf`, min and max of the same three exported frames, within 2/255.
- `stats-alpha`: a soft-edged moving layer on a transparent project in each mode with `slitReach:.4`. Pixels never covered in any slice stay at alpha 0, and no straight-alpha channel exceeds the brightest source channel by more than 2/255.
- `stats-loop`: each mode, phase 0 equals phase TAU byte for byte.
- `stats-zero`: `slitShift` animated to 0 in each mode equals the plain layer within 1/255.
- `stats-4k`: Median at 3840x2160 exports a PNG with no WebGL error, and a 2x supersampled 4K Median completes wherever the GPU allows that render size.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" --only=stats`
Expected: `stats-order` FAIL.

- [ ] **Step 3: Implement**

`slices()` dispatches to `statSlices` when `slitMode > 0`.

- **Echo, Darkest, Brightest:** ping-pong over the slit targets. Echo adds `source * weight`. Darkest and Brightest start from slice 0, then take per-channel `min` or `max`. A channel ignores slices at or beyond its `channelSliceCounts` value. Alpha always uses all slices. Clamp `rgb = min(rgb, a)` on the last slice.
- **Median:** allocate one `THREE.WebGLArrayRenderTarget` lazily, half-float, linear filter, no depth, sized by `medianTargetSize`, with depth 9. Copy each slice into its layer with `renderer.setRenderTarget(target, layer)`. Then draw `timeMedianFragment` to the result target. It reads the layers from `sampler2DArray`, insertion-sorts up to nine values per channel, and takes the middle value or the mean of the middle two. Alpha uses all slices, followed by the same RGB clamp.
- Release the array target when no visible layer uses Median, at the same point as `releaseFeedback`, and in `dispose()`.

- [ ] **Step 4: Run checks**

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline" --only=neutral,time,stats`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/time-stats.ts src/rendering/StudioRenderer.ts scripts/verify-colour-time.mjs
git commit -m "Add echo, median, darkest and brightest time modes"
```

### Task 10: Time controls and looks

**Files:**
- Modify: `src/ui/App.tsx`, `src/rendering/slitscan.ts`, `src/core/project.ts`, `tests/slitscan.test.ts`, `scripts/verify-workspace-ui.mjs`

**Interfaces:**
- Produces: `slitControlVisible(layer: Layer, key: string): boolean`, exported from `slitscan.ts`.

Looks to add:

- `finish-time-vortex`, Time Vortex: `{ slitShift: 1, slitSpan: 60, slitShape: 2, slitSlices: 16, slitSmooth: 1, slitTwist: .5, slitZoom: .2, slitChroma: .25 }`
- `finish-ghost-median`, Ghosts: `{ slitShift: 1, slitSpan: 60, slitMode: 2, slitSlices: 9, slitReach: .4 }`
- `finish-long-exposure`, Long Exposure: `{ slitShift: 1, slitSpan: 45, slitMode: 4, slitSlices: 16 }`
- `finish-premonition`, Premonition: `{ slitShift: 1, slitSpan: 24, slitMode: 1, slitDirection: 1, slitSlices: 8, slitDecay: .7 }`
- `finish-brightness-time`, Brightness Time: `{ slitShift: 1, slitSpan: 60, slitShape: 5, slitSlices: 16, slitSmooth: 1 }`

- [ ] **Step 1: Write the failing tests**

```ts
test('time controls appear only for the mode that uses them', () => {
  const base = createLayer('surface');
  const on = (params: Record<string, number>) => ({ ...base, params: { ...base.params, slitShift: 1, ...params } });
  assert.equal(slitControlVisible(base, 'slitShift'), true);
  assert.equal(slitControlVisible(base, 'slitMode'), false);
  assert.equal(slitControlVisible(on({ slitMode: 0 }), 'slitTwist'), true);
  assert.equal(slitControlVisible(on({ slitMode: 1 }), 'slitTwist'), false);
  assert.equal(slitControlVisible(on({ slitMode: 1 }), 'slitDecay'), true);
  assert.equal(slitControlVisible(on({ slitMode: 2 }), 'slitReach'), true);
  assert.equal(slitControlVisible(on({ slitMode: 2 }), 'slitSmooth'), false);
  assert.equal(slitControlVisible(on({ slitShape: 4 }), 'slitBlocks'), true);
  assert.equal(slitControlVisible(on({ slitShape: 6 }), 'slitBlocks'), true);
});
```

In the existing look test, change the expected slit look count from `3` to `8`.

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/slitscan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace the inline Time displacement filter in `App.tsx` with `slitControlVisible`. Show `ChoiceParameter` controls for Time mode, Direction (`Past`, `Future`) and Delay map. Delay map, Twist, Time zoom, Colour lag, Slice blend and Map scroll appear only in Delay map mode. Echo fade appears only in Echo. Colour reach appears only in Median, Darkest and Brightest.

Update the section description to: "Parts of the frame show other moments of the loop. Loops close exactly; each slice renders the source once more."

Update `verify-workspace-ui.mjs` to expect `27` finish cards.

- [ ] **Step 4: Run all checks**

Run: `npx tsc --noEmit && npx tsx --test tests/*.test.ts && npm run test:workspace`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx src/rendering/slitscan.ts src/core/project.ts tests/slitscan.test.ts scripts/verify-workspace-ui.mjs
git commit -m "Add time sampler controls and looks"
```

### Task 11: Whole-branch proof

**Files:**
- Modify: `scripts/verify-colour-time.mjs`, `README.md`
- Create: `docs/colour-and-time-proof.md`

**Interfaces:**
- Consumes: every finish look from Tasks 6 and 10.

- [ ] **Step 1: Add the final checks**

- `all-presets-neutral`: every preset at one phase equals baseline byte for byte.
- `old-file`: a project saved by the baseline build opens in the new build and renders byte-identically.
- `looks-sheet`: renders the eight new looks on Surface, Fractal, Liquid and Image layers at three phases into `work/colour-time-proof/`.
- `preview-cost`: logs mean preview frame time at 1280x720 for each of the eight looks. This is a report, not a pass/fail gate.

- [ ] **Step 2: Run everything**

Run: `node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Colour Baseline"`
Expected: every check PASS, and preview times printed.

Run: `npx tsc --noEmit && npm test && npm run test:workspace && node scripts/verify-glow.mjs && node scripts/verify-print.mjs`
Expected: all pass.

- [ ] **Step 3: Review the contact sheets by eye**

Each look must meet rules 2, 3 and 6 in `docs/effects-improvement-plan-2026-11-12.md`: reads on a wall, changes across the loop, and stays clean at projector scale. Retune a look's values if it fails. Remove it, and update the card counts, if retuning does not fix it.

- [ ] **Step 4: Record the results**

Write the check results, preview times and any retuned or removed look to `docs/colour-and-time-proof.md`. Add the new controls to the finishing section of `README.md`.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-colour-time.mjs docs/colour-and-time-proof.md README.md src/core/project.ts scripts/verify-workspace-ui.mjs
git commit -m "Prove the colour and time engines"
```
