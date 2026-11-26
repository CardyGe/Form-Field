# Signal Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the old Artefact signal looks into Form & Field as five new Finish effects: VHS, Dropout, CRT, JPEG damage and Databend.

**Architecture:** A per-layer signal pass runs after the tile pass and before Glow, so CRT light can glow. It is a short chain of full-frame stages: Databend, then JPEG damage, then VHS, then Dropout, then CRT. Each stage runs only when its effect is on and ping-pongs between two lazy half-float targets. Every size is in pixels of a 1080-line frame. All motion is a stateless function of the wrapped loop phase, so seeks, warm-ups and the loop seam repeat exactly.

**Tech Stack:** TypeScript, three.js 0.187 `WebGLRenderer`, GLSL 3 through `ShaderMaterial`, React, `node:test` through `tsx`, Electron and Playwright render checks.

**Spec:** The [Artefact Effects Catalogue](https://claude.ai/artifact/UbnTLyEawmZVnqiLj5wK7n), Signal path. Old implementations are in `/Users/grego/Documents/Code/antigravity/artefact/effects-source/`: `vhs.js`, `signalDropout.js`, `crtBarrel.js`, `scanlines.js`, `jpegArtefact.js`, `databend.js`.

## What this covers

| Old effect | Where it lands |
|---|---|
| VHS | VHS: tracking, colour bleed, noise bands, head switching, tape age, rolling bar |
| Signal Dropout | Dropout |
| CRT Barrel, Scanlines | CRT: curve, scan lines, mask, corners |
| JPEG Artefact | JPEG damage, rebuilt as a real 8x8 block transform |
| Databend | Databend: Echo, Comb, Fold, Stutter and Corrupt modes along Across, Down or Wrap |

**Not in this plan:**
- VHS camcorder text (date stamp, REC, timecode).
- Databend's Filter mode, which overlaps blur.
- Colour split and RGB shift, which are already in Colour and Lens.
- The Cell engine, which the owner dropped.

## Global Constraints

- **Branch:** build on a new branch `signal-path` from `material-tiles` at `6f2bfb7`, in the worktree `/Users/grego/Documents/ChatGPT/three VJ - Signal`. Both branches change the same render stage, so building on Tiles avoids a conflict. If Tiles is dropped, rebase onto main.
- **Baseline checkout:** keep a detached checkout of `6f2bfb7` at `/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline`.
- **Test baseline:** record it on `6f2bfb7` before changing anything. `npx tsx --test tests/*.test.ts` gives 1544 pass, 0 fail.
- **Byte-identical renders:** every new control defaults to off. Existing projects, presets, loops, seeking and exports render byte-identically.
- **Project format:** the project schema does not change. New keys migrate through `FINISH_KEYS`.
- **Live and Map:** do not change Live or Map code. Map receives the effects through the shared Finish panel.
- **Units:** sizes are pixels of a 1080-line frame, and the effects are fixed to the frame.
- **Motion:** whole cycles per loop. Per-frame randomness is hashed from the loop frame, rounded to the nearest frame so the seam closes.
- **Colour and light:**
  - Work in linear premultiplied half-float.
  - Stages that quantise (JPEG damage, Databend Fold and Corrupt) work on the 0 to 1 part of unpremultiplied colour and add the over-range part back unchanged, so over-range light survives.
  - As an amount approaches zero, the output converges to the plain layer with no jump.
- **Coverage:** moved rows carry their alpha with them. Fills such as black bands, noise and the CRT bezel appear only where the layer has coverage, unless the control says otherwise.
- **Graphic layers and Tile Edges:** graphic layers take none of the new effects. Layers using them cannot use Tile Edges.
- **Variations:** never switch a new effect on or change its stepped choices.
- **Picker:** add no finish-look presets. Effects are added from Add effect, in a new `Signal` group.
- **Labels:** use plain words. Do not show "YUV", "DCT", "coefficient", "quantise", "luma", "XOR" or "serpentine".
- **Code:** write original code. Do not copy third-party shader code.

## Review Focus

1. **Loop seam with per-frame randomness:** VHS jitter, noise, Dropout events and Databend Stutter close the loop and repeat after a seek. Pinned in Tasks 2 and 5.
2. **Preview against export:** the same settings look the same at 960x540 and 3840x2160. Pinned in Tasks 2, 3, 4 and 5.
3. **Over-range light through quantising stages:** a bright HDR highlight keeps its over-range part through JPEG damage and Databend. Pinned in Tasks 4 and 5.
4. **Soft and transparent layers:** bands, bezel and blocks do not fringe or fill outside coverage. Pinned in Tasks 2, 3 and 4.
5. **Cost at 4K:** JPEG damage and Databend Echo stay usable in a 4K preview. Pinned in Task 7.

---

### Task 1: Signal rules and saved controls

**Files:**
- Create: `src/rendering/signal.ts`, `tests/signal.test.ts`
- Modify: `src/core/finishing.ts`, `src/core/project.ts`, `src/core/tile-edges.ts`, `src/ui/finish-rack.ts`, `src/ui/styles.css`, `tests/finish-rack.test.ts`, `tests/core.test.ts` (extend key lists only)

**Interfaces:**
- Produces from `finishing.ts`: `VHS_KEYS`, `DROP_KEYS`, `CRT_KEYS`, `JPEG_KEYS` and `DATABEND_KEYS`.
- Produces from `signal.ts`:
  - `CRT_MASKS = ['None','Stripes','Slots','Dots']`
  - `CRT_BEZELS = ['Transparent','Black']`
  - `DROP_FILLS = ['Black','Noise','Hold line']`
  - `DATABEND_MODES = ['Echo','Comb','Fold','Stutter','Corrupt']`
  - `DATABEND_AXES = ['Across','Down','Wrap']`
  - `supportsSignal(layer: Pick<Layer,'kind'>): boolean`
  - `signalActive(layer: Pick<Layer,'kind'|'params'|'modulations'>): boolean`
  - `signalStages(layer: Pick<Layer,'kind'|'params'|'modulations'>): ('databend'|'jpeg'|'vhs'|'drop'|'crt')[]`, in pass order, giving only the active stages
  - `loopFrame(wrapped: number, frames: number): number`, which rounds to the nearest frame and maps `frames` to 0
  - `crtCurve(uv: [number, number], curve: number): [number, number]`
  - `signalControlVisible(layer: Pick<Layer,'params'|'modulations'>, key: string): boolean`

All keys use `section:'Material'` unless marked M (`'Motion'`) or S (`'Shape'`).

| Key | Label | Min | Max | Step | Default |
|---|---|---:|---:|---:|---:|
| `vhsAmount` | VHS | 0 | 1 | .01 | 0 |
| `vhsTracking` | Tracking wobble | 0 | 1 | .01 | .4 |
| `vhsBleed` | Colour bleed | 0 | 1 | .01 | .5 |
| `vhsNoise` | Noise bands | 0 | 1 | .01 | .3 |
| `vhsHeadSwitch` | Head switching | 0 | 1 | .01 | .4 |
| `vhsAge` | Tape age | 0 | 1 | .01 | .3 |
| `vhsRoll` M | Rolling bar per loop | 0 | 8 | 1 | 0 |
| `dropAmount` | Dropout | 0 | 1 | .01 | 0 |
| `dropChance` | Dropout chance | 0 | 1 | .01 | .15 |
| `dropBands` S | Dropout bands | 1 | 20 | 1 | 4 |
| `dropFill` | Dropout fill | 0 | 2 | 1 | 0 |
| `dropBurst` M | Burst length | 1 | 8 | 1 | 1 |
| `crtAmount` | CRT | 0 | 1 | .01 | 0 |
| `crtCurve` S | Screen curve | 0 | .5 | .01 | .15 |
| `crtLines` S | Scan lines | 120 | 1080 | 1 | 480 |
| `crtLineDepth` | Scan line depth | 0 | 1 | .01 | .5 |
| `crtMask` S | Screen mask | 0 | 3 | 1 | 1 |
| `crtMaskSize` S | Mask size | 1 | 12 | .25 | 3 |
| `crtCorners` | Dark corners | 0 | 1 | .01 | .4 |
| `crtBezel` | Outside the screen | 0 | 1 | 1 | 1 |
| `crtBrightness` | CRT brightness | .5 | 3 | .01 | 1.3 |
| `jpegAmount` | JPEG damage | 0 | 1 | .01 | 0 |
| `jpegQuality` | Quality | 0 | 1 | .01 | .2 |
| `jpegBlock` S | Block size | 4 | 64 | .25 | 8 |
| `jpegChroma` | Colour damage | 0 | 1 | .01 | .5 |
| `jpegGlitch` | Broken blocks | 0 | 1 | .01 | 0 |
| `jpegGlitchSwaps` M | Block changes per loop | 0 | 32 | 1 | 4 |
| `databendAmount` | Databend | 0 | 1 | .01 | 0 |
| `databendMode` S | Databend mode | 0 | 4 | 1 | 0 |
| `databendAxis` S | Direction | 0 | 2 | 1 | 2 |
| `databendDistance` S | Distance | 1 | 960 | .5 | 120 |
| `databendRepeats` | Repeats | 1 | 8 | 1 | 4 |
| `databendFeedback` | Feedback | 0 | .95 | .01 | .55 |
| `databendSplit` | Channel split | 0 | 1 | .01 | .33 |
| `databendDepth` | Depth | 0 | 1 | .01 | .5 |
| `databendCycles` M | Cycles per loop | 0 | 16 | 1 | 1 |

- [ ] **Step 1: Create the worktrees and record the baseline**

```bash
git -C "/Users/grego/Documents/ChatGPT/three VJ" worktree add -b signal-path "/Users/grego/Documents/ChatGPT/three VJ - Signal" 6f2bfb7
```

```bash
git -C "/Users/grego/Documents/ChatGPT/three VJ" worktree add --detach "/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline" 6f2bfb7
```

```bash
cd "/Users/grego/Documents/ChatGPT/three VJ - Signal" && npm ci --no-audit --no-fund && ln -s "$PWD/node_modules" "../three VJ - Signal Baseline/node_modules" && npm test
```

Expected: all pass, with 1544 unit tests and 106 Electron tests.

- [ ] **Step 2: Write the failing tests in `tests/signal.test.ts`**

```ts
const allKeys = [...VHS_KEYS, ...DROP_KEYS, ...CRT_KEYS, ...JPEG_KEYS, ...DATABEND_KEYS];
const amounts = ['vhsAmount', 'dropAmount', 'crtAmount', 'jpegAmount', 'databendAmount'];
test('signal effects are off by default and older projects migrate without them', () => {
  const project = createProject();
  for (const layer of project.layers) { assert.equal(signalActive(layer), false); for (const key of allKeys) delete layer.params[key]; }
  const migrated = validateProject(JSON.parse(JSON.stringify(project))).layers[0].params;
  for (const key of amounts) assert.equal(migrated[key], 0);
});
test('any amount or an animated amount runs the signal pass, never on graphic layers', () => {
  const layer = createLayer('surface');
  for (const key of amounts) {
    assert.equal(signalActive({ ...layer, params: { ...layer.params, [key]: .3 } }), true, key);
    assert.equal(signalActive({ ...layer, modulations: { [key]: {} as never } }), true, key);
  }
  const graphic = createLayer('graphic');
  assert.equal(signalActive({ ...graphic, params: { ...graphic.params, crtAmount: 1 } }), false);
  assert.equal(visibleParameterDefinitions(graphic).some(d => allKeys.includes(d.key)), false);
});
test('stages run in signal order and only when on', () => {
  const layer = createLayer('surface');
  const on = (params: Record<string, number>) => ({ ...layer, params: { ...layer.params, ...params } });
  assert.deepEqual(signalStages(layer), []);
  assert.deepEqual(signalStages(on({ crtAmount: 1, vhsAmount: 1, databendAmount: 1, jpegAmount: 1, dropAmount: 1 })), ['databend', 'jpeg', 'vhs', 'drop', 'crt']);
  assert.deepEqual(signalStages(on({ crtAmount: .5 })), ['crt']);
});
test('a signal layer cannot use Tile Edges, naming the effect', () => {
  const layer = createLayer('surface'); layer.params.vhsAmount = .5;
  assert.match(layerTileBlocker(layer) ?? '', /VHS can't use Tile Edges/);
});
test('loop frames round to the nearest frame and wrap at the seam', () => {
  assert.equal(loopFrame(0, 120), 0);
  assert.equal(loopFrame(Math.PI * 2 - 1e-4, 120), 0);
  assert.equal(loopFrame(Math.PI, 120), 60);
  assert.equal(loopFrame(Math.PI * 2 * (59.6 / 120), 120), 60);
});
test('the CRT curve leaves the centre alone and pushes the corners out', () => {
  assert.deepEqual(crtCurve([.5, .5], .3), [.5, .5]);
  const [x, y] = crtCurve([1, 1], .3);
  assert.ok(x > 1 && y > 1);
  assert.deepEqual(crtCurve([.9, .2], 0), [.9, .2]);
});
test('variations never switch signal effects on or change their choices', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, { palette: false, structure: false, motion: false, material: false }, entropy);
      for (const key of allKeys) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
    }
  }
});
test('signal controls appear only for the choice that uses them', () => {
  const base = createLayer('surface');
  const on = (params: Record<string, number>) => ({ ...base, params: { ...base.params, ...params } });
  assert.equal(signalControlVisible(base, 'crtAmount'), true);
  assert.equal(signalControlVisible(base, 'crtCurve'), false);
  assert.equal(signalControlVisible(on({ crtAmount: .5, crtMask: 0 }), 'crtMaskSize'), false);
  assert.equal(signalControlVisible(on({ jpegAmount: .5, jpegGlitch: 0 }), 'jpegGlitchSwaps'), false);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 2 }), 'databendRepeats'), false);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 0 }), 'databendRepeats'), true);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 0 }), 'unknownKey'), false);
});
```

Extend `tests/finish-rack.test.ts`: `FINISH_GROUPS` ends with `'Signal'`, and the Signal group lists `vhs`, `drop`, `crt`, `jpeg` and `databend` in that order.

- [ ] **Step 3: Run to verify failure**

Run: `npx tsx --test tests/signal.test.ts tests/finish-rack.test.ts`
Expected: FAIL, `src/rendering/signal` cannot be resolved.

- [ ] **Step 4: Implement the rules and wiring**

Follow how Task 1 of the Tiles plan wired `tiles.ts`: keys in `FINISH_PARAMETERS`, hidden on unsupported layers, required in `finishSupported`, and skipped in `varyLayer`. Do not add any keys to `FINISH_LOOK_KEYS`.

`signalControlVisible` rules:
- The `*Amount` key always shows.
- Other keys show only while their effect's amount is non-zero or modulated.
- `crtMaskSize` shows only when the mask is not None.
- `jpegGlitchSwaps` shows only when Broken blocks is above 0.
- `databendRepeats` and `databendFeedback` show only for Echo and Comb.
- `databendCycles` shows for Comb and Stutter.
- Unknown keys return false.

`layerTileBlocker` names the first active effect, for example `VHS can't use Tile Edges.`

Append `'Signal'` to `FINISH_GROUPS`, and make `.finish-groups` in `styles.css` lay out six groups on one row.

Add the five effects to `finish-rack.ts`:

| id | Label | Switch starts at | Description |
|---|---|---|---|
| `vhs` | VHS | `vhsAmount: 1` | Worn videotape: wobbling lines, bleeding colour, noise and a torn bottom edge. |
| `drop` | Dropout | `dropAmount: 1` | Bands of the picture drop out to black, noise or a held line. |
| `crt` | CRT | `crtAmount: 1` | An old tube screen: curved glass, scan lines, a colour mask and dark corners. |
| `jpeg` | JPEG damage | `jpegAmount: 1` | Heavy picture compression: blocky detail, smeared colour and broken blocks. |
| `databend` | Databend | `databendAmount: 1` | Treats the picture as sound: echoes, combs, folds, stutters and corruption. |

Row summaries:
- CRT shows the mask name.
- Databend shows the mode and direction.
- Dropout shows the fill.
- VHS and JPEG show none.

- [ ] **Step 5: Run the full suite**

Run: `npx tsc --noEmit && npx tsx --test tests/*.test.ts`
Expected: clean, all pass.

- [ ] **Step 6: Commit**

```bash
git add src/rendering/signal.ts tests/signal.test.ts src/core/finishing.ts src/core/project.ts src/core/tile-edges.ts src/ui/finish-rack.ts src/ui/styles.css tests/finish-rack.test.ts tests/core.test.ts
git commit -m "Add signal path controls and rules"
```

### Task 2: Signal pass, VHS and Dropout

**Files:**
- Create: `scripts/verify-signal.mjs`
- Modify: `src/rendering/signal.ts`, `src/rendering/StudioRenderer.ts`

**Interfaces:**
- Consumes: Task 1 rules.
- Produces:
  - `StudioRenderer.signalSource(original: Layer, layer: Layer, source: THREE.Texture, phase: number, width: number, height: number): THREE.Texture`
  - GLSL stage programs `vhsFragment` and `dropFragment`, each a `ShaderMaterial` fragment that reads `uSource` and writes one stage
  - The script, with named checks, `--baseline=` and `--only=`

- [ ] **Step 1: Write the failing render checks**

Build `scripts/verify-signal.mjs` from `scripts/verify-tiles.mjs`, including its loop and seam helper and its baseline handling. Add these checks:

- `neutral`: one preset of every kind, plus an Image layer, equals the baseline byte for byte, and each render is non-blank.
- `vhs-tracking`: Tracking wobble .8 shifts rows sideways. Each row is a horizontal shift of the plain row, within 2/255 after the shift, and the shift varies between rows.
- `vhs-bleed`: on a red-to-blue edge, Colour bleed 1 spreads colour sideways by at least 8 px at 1080 lines while brightness edges stay within 2 px.
- `vhs-head`: Head switching .5 tears a strip at the bottom about 4% of the frame tall, and the rest of the frame is not torn.
- `vhs-roll`: Rolling bar 2 moves a noise bar exactly twice across the frame per loop.
- `vhs-age`: Tape age 1 lowers saturation and warms the picture compared with Tape age 0.
- `vhs-alpha`: on a soft-masked layer, noise and tears appear only inside coverage.
- `drop-events`: Dropout chance .5 drops bands in about half of 120 frames, within 10 points. Each drop fills with its chosen fill, and Burst length 3 groups drops into runs of 3.
- `drop-hold`: Hold line repeats the last row above each dropped band.
- `signal-loop`: VHS, Dropout and both together, checked at phase `0` against `TAU` and at the seam phase `TAU - 1e-4` against `0`, using the shared helper.
- `signal-seek`: a render after seeking equals a fresh render of the same frame byte for byte.
- `signal-scale`: the same settings at 960 and 3840 wide, downsampled, differ by a mean under 3/255.
- `signal-engage`: `vhsAmount: .001` and `dropAmount: .001` match plain, with a mean difference under 1/255.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/verify-signal.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline" --only=neutral,vhs,drop,signal`
Expected: FAIL, VHS does not change the render.

- [ ] **Step 3: Implement the pass, VHS and Dropout**

In `renderFrame`, after the tile pass, add:

```ts
const signalled = signalActive(original) ? this.signalSource(original, layer, finished, wrapped, width, height) : finished;
```

Use `signalled` for Glow and the composite.

`signalSource`:
- Runs each stage from `signalStages`, ping-ponging between two lazy half-float targets.
- Releases the targets beside the tile targets when no visible layer uses the signal pass.
- Mixes each stage with its input by that effect's amount.

VHS works in linear light and borrows a broadcast split into brightness and colour difference:
- Tracking wobble shifts each row by a hashed amount up to 40 px at 1080 lines. Rare rows tear up to 40% of the frame width.
- Colour bleed blurs only the colour part sideways, by up to 60 px.
- Noise bands are hashed bands 2 to 12 px tall.
- Head switching shifts and noises the bottom 8% times the amount.
- Tape age desaturates and warms.
- Rolling bar is a soft noise band that moves `vhsRoll` whole times per loop.
- All randomness hashes the layer seed (wrapped to 0..999), the row, and `loopFrame(wrapped, frames)`.

Dropout picks events from a hash of the event start frame, so a burst of length N covers N frames and repeats on seek and across the seam.

- [ ] **Step 4: Run checks**

Run: `npx tsc --noEmit && npm test && node scripts/verify-signal.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline" --only=neutral,vhs,drop,signal`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-signal.mjs src/rendering/signal.ts src/rendering/StudioRenderer.ts
git commit -m "Add the signal pass, VHS and Dropout"
```

### Task 3: CRT

**Files:**
- Modify: `src/rendering/signal.ts`, `src/rendering/StudioRenderer.ts`, `scripts/verify-signal.mjs`

**Interfaces:**
- Consumes: the signal pass and `crtCurve`.
- Produces: the GLSL stage `crtFragment`.

- [ ] **Step 1: Add failing render checks**

- `crt-curve`:
  - With Screen curve .3, straight lines in the source bow outward on screen.
  - The centre pixel is unchanged.
  - Pixels outside the curved screen are transparent when Outside the screen is Transparent, and black where the layer has coverage when it is Black.
  - The screen edge is filtered to one output pixel.
- `crt-lines`:
  - Scan lines 240 gives 240 dark bands per frame height at both 960x540 and 3840x2160.
  - Scan line depth 0 leaves no bands.
- `crt-mask`:
  - Stripes, Slots and Dots each change the render and differ from each other.
  - Stripes splits a white field into separate red, green and blue columns.
- `crt-glow`:
  - CRT brightness 2 keeps over-range light, with a peak above 1.5 on white.
  - With Glow on, it glows more than brightness 1.
- `crt-corners`: Dark corners 1 darkens the corners by at least 50% and the centre by under 5%.
- `crt-scale`, `crt-engage`: same rules as the VHS checks.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/verify-signal.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline" --only=crt`
Expected: FAIL.

- [ ] **Step 3: Implement CRT**

- `crtCurve` maps screen uv to source uv by `c + d * (1 + curve * |d|²)`, where `d = uv - .5` is aspect-corrected. The same maths runs in GLSL and in TS for tests.
- Scan lines are a raised cosine across each line, filtered so that lines finer than 2 output pixels fade to a flat darkening of the same mean.
- Mask pitch is in 1080-line pixels:
  - Stripes are RGB columns.
  - Slots are RGB columns with staggered gaps.
  - Dots are RGB triads.
  - The mask is scaled so a white field keeps its mean brightness before `crtBrightness`.
- Corners use a smooth falloff from the curved edge.
- Do not clamp light.

- [ ] **Step 4: Run checks**

Run: `npx tsc --noEmit && npm test && node scripts/verify-signal.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline" --only=neutral,vhs,drop,signal,crt`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/signal.ts src/rendering/StudioRenderer.ts scripts/verify-signal.mjs
git commit -m "Add CRT"
```

### Task 4: JPEG damage

**Files:**
- Create: `src/rendering/jpeg-blocks.ts`, `tests/jpeg-blocks.test.ts`
- Modify: `src/rendering/signal.ts`, `src/rendering/StudioRenderer.ts`, `scripts/verify-signal.mjs`

**Interfaces:**
- Produces from `jpeg-blocks.ts`:
  - `dct8(row: number[]): number[]` and `idct8(coefficients: number[]): number[]`, the 8-point orthonormal cosine transform pair
  - `quantStep(index: number, quality: number, colour: boolean): number`, the step for frequency index 0..63 at quality 0..1
  - `blockGrid(width: number, height: number, blockPx: number): { cols: number; rows: number }`
  - The GLSL `jpegFragments`: forward rows, forward columns with quantising, inverse columns, inverse rows

- [ ] **Step 1: Write failing tests**

```ts
test('the 8-point transform round-trips', () => {
  const row = [0, .1, .5, .9, 1, .3, .2, .7];
  idct8(dct8(row)).forEach((v, i) => assert.ok(Math.abs(v - row[i]) < 1e-9));
});
test('a flat row has energy only in the first term', () => {
  const c = dct8(new Array(8).fill(.5));
  assert.ok(c.slice(1).every(v => Math.abs(v) < 1e-12));
});
test('lower quality means coarser steps, more so for fine detail and colour', () => {
  assert.ok(quantStep(0, 0, false) > quantStep(0, 1, false));
  assert.ok(quantStep(63, .5, false) > quantStep(1, .5, false));
  assert.ok(quantStep(10, .5, true) >= quantStep(10, .5, false));
});
test('block grids are sized in 1080-line pixels', () => {
  assert.deepEqual(blockGrid(1920, 1080, 8), { cols: 240, rows: 135 });
  assert.deepEqual(blockGrid(3840, 2160, 8), { cols: 240, rows: 135 });
});
```

Add these render checks:
- `jpeg-blocks`: at Quality 0, block edges every `jpegBlock` px at 1080 lines show visible steps, and at Quality 1 the result is within 4/255 of plain.
- `jpeg-colour`: Colour damage 1 smears colour across 2-block areas (colour sampled at half size) while brightness detail survives.
- `jpeg-hdr`: a highlight at 4.0 keeps over-range brightness above 3 after damage.
- `jpeg-glitch`:
  - Broken blocks .3 freezes or shifts about 30% of blocks, within 8 points.
  - Changes happen only `jpegGlitchSwaps` times per loop.
  - The loop closes at the seam.
- `jpeg-alpha`: on a soft-masked layer, no colour appears outside coverage and straight colour does not exceed the brightest source channel by more than 4/255.
- `jpeg-scale`, `jpeg-engage`: same rules as before.

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/jpeg-blocks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement JPEG damage**

Four 8-tap passes over a half-float target sized to the frame:
- Rows forward.
- Columns forward, with quantising by `quantStep`.
- Columns inverse.
- Rows inverse.

Details:
- Blocks are `jpegBlock` px at 1080 lines. Each pass samples the block's 8 positions with linear filtering, so a block larger than 8 output pixels is processed at 8x8 and scaled back up.
- Colour damage splits brightness and colour difference, quantises colour with the coarser colour steps, and samples it at half block resolution.
- Broken blocks hash the block, the seed and the slot `loopFrame` mapped to `jpegGlitchSwaps` slots. A broken block either takes a neighbour's first term or shifts by one block.
- Work on the clamped 0 to 1 part of unpremultiplied colour, and add the over-range part back.
- Release the targets with the signal targets.

- [ ] **Step 4: Run checks**

Run: `npx tsc --noEmit && npm test && node scripts/verify-signal.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline" --only=neutral,vhs,drop,signal,crt,jpeg`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/jpeg-blocks.ts tests/jpeg-blocks.test.ts src/rendering/signal.ts src/rendering/StudioRenderer.ts scripts/verify-signal.mjs
git commit -m "Add JPEG damage"
```

### Task 5: Databend

**Files:**
- Modify: `src/rendering/signal.ts`, `src/rendering/StudioRenderer.ts`, `scripts/verify-signal.mjs`, `tests/signal.test.ts`

**Interfaces:**
- Produces:
  - `streamIndex(x: number, y: number, width: number, height: number, axis: number): number`
  - `streamPixel(index: number, width: number, height: number, axis: number): [number, number]`
  - GLSL `databendFragment`

- [ ] **Step 1: Write failing tests**

```ts
test('the stream runs across, down or wrapping row to row', () => {
  assert.equal(streamIndex(3, 2, 10, 5, 0), 23);
  assert.equal(streamIndex(3, 2, 10, 5, 1), 17);
  assert.deepEqual(streamPixel(23, 10, 5, 2), [3, 2]);
  assert.deepEqual(streamPixel(streamIndex(9, 0, 10, 5, 2) + 1, 10, 5, 2), [0, 1]);
});
```

Add these render checks:
- `bend-modes`: each of Echo, Comb, Fold, Stutter and Corrupt changes the render and they all differ from each other.
- `bend-echo`: Echo with Repeats 3 and Feedback .5 places 3 fading copies of a bright dot at Distance, 2 × Distance and 3 × Distance along the axis, each about half the brightness of the one before.
- `bend-wrap`: in Wrap, an echo that runs off the right edge reappears at the start of the next row.
- `bend-split`: Channel split 1 moves red, green and blue copies apart.
- `bend-hdr`: Fold keeps the over-range part of a 4.0 highlight.
- `bend-loop`: Comb and Stutter with Cycles 2 close the loop across the seam and repeat after a seek.
- `bend-scale`, `bend-engage`: same rules as before. Distance is in 1080-line pixels, so 960 and 3840 match.

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/signal.test.ts`
Expected: FAIL, `streamIndex` is not exported.

- [ ] **Step 3: Implement Databend**

The stage treats the frame as one stream along the axis.

- **Wrap** continues off one row's end onto the next row.
- **Across** and **Down** clamp at the edge.
- **Echo:** sums `databendRepeats` taps at multiples of Distance, each weighted by `databendFeedback` to the power of its tap number, normalised so a flat field keeps its level.
- **Comb:** a single delayed tap whose distance swings by `databendDepth` with `databendCycles` whole cycles per loop, with the phase offset per channel by Split.
- **Fold:** a wavefold of the 0 to 1 part, with Depth setting the gain and Split offsetting the curve per channel.
- **Stutter:** cuts the stream into grains of Distance pixels. A hashed share (Depth) of grains repeat or reverse, re-rolled `databendCycles` times per loop.
- **Corrupt:** encodes the 0 to 1 part as 8-bit values and flips bits with a hashed mask. Depth sets how many bits, and Split offsets the mask per channel.
- **Over-range light:** add the over-range part back in Fold and Corrupt.
- **Alpha:** in Echo, Comb and Stutter, alpha travels with colour. In Fold and Corrupt, alpha is kept.

- [ ] **Step 4: Run checks**

Run: `npx tsc --noEmit && npm test && node scripts/verify-signal.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline" --only=neutral,vhs,drop,signal,crt,jpeg,bend`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/signal.ts src/rendering/StudioRenderer.ts scripts/verify-signal.mjs tests/signal.test.ts
git commit -m "Add Databend"
```

### Task 6: Controls and thumbnails

**Files:**
- Create: `src/ui/SignalSections.tsx`, plus thumbnails in `src/ui/assets/finish/` named `vhs.jpg`, `drop.jpg`, `crt.jpg`, `jpeg.jpg` and `databend.jpg`
- Modify: `src/ui/FinishControls.tsx`, `src/ui/finish-thumbs.ts`, `scripts/make-finish-thumbs.mjs`, `scripts/verify-workspace-ui.mjs`

**Interfaces:**
- Consumes: the Task 1 lists and `signalControlVisible`. Also the existing `FinishProps`, including the optional `animate`, `extra` and `readOnly`.
- Produces: `VhsSection`, `DropoutSection`, `CrtSection`, `JpegSection` and `DatabendSection`.

- [ ] **Step 1: Write the failing UI check**

Extend the workspace check:
- The picker shows a Signal group with all six groups on one row.
- On a Surface layer, the Signal group lists VHS, Dropout, CRT, JPEG damage and Databend, each with a thumbnail.
- Adding each effect opens controls that fit one screen.
- With read-only on, every choice is disabled.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:workspace`
Expected: FAIL on the missing group.

- [ ] **Step 3: Implement**

- Add the five sections, following `TileSections.tsx`.
- Stepped choices use the Task 1 lists. Outside the screen and Dropout fill are choices, not sliders.
- Render the five thumbnails with `make-finish-thumbs.mjs --only=vhs,drop,crt,jpeg,databend`, leaving the others unchanged.

- [ ] **Step 4: Run all checks**

Run: `npx tsc --noEmit && npm test && npm run test:workspace && npm run test:map`
Expected: all pass. Rerun workspace up to twice for the known "Focus preview" timeout, and record each result.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SignalSections.tsx src/ui/FinishControls.tsx src/ui/finish-thumbs.ts src/ui/assets/finish/vhs.jpg src/ui/assets/finish/drop.jpg src/ui/assets/finish/crt.jpg src/ui/assets/finish/jpeg.jpg src/ui/assets/finish/databend.jpg scripts/make-finish-thumbs.mjs scripts/verify-workspace-ui.mjs
git commit -m "Add Signal controls and thumbnails"
```

### Task 7: Whole-branch proof

**Files:**
- Modify: `scripts/verify-signal.mjs`, `README.md`
- Create: `docs/signal-proof.md`

- [ ] **Step 1: Add final checks**

- `all-presets-neutral`: every preset equals the baseline byte for byte and is non-blank.
- `old-file`: a project saved by the baseline build, with Tiles and Warp on, opens and renders byte-identically.
- `stack`: all five signal effects together, plus LED wall, Warp, Split, Gradient, Glow, Feedback and Time, render non-blank and repeat after a seek.
- `sheet`:
  - Covers every VHS level, Dropout fill, CRT mask, JPEG quality and Databend mode and direction.
  - Uses Surface, Fractal, Liquid and Image layers, at three phases each.
  - Writes to `work/signal-proof/`.
  - Gates on these stated values: brightness stays at least 40% of plain (CRT and JPEG at least 60%), no stage goes black, and every effect differs from plain.
- `preview-cost`: report only. The mean preview frame time for each effect and for all five together, at 1280x720, 1920x1080 and 3840x2160, against plain.

- [ ] **Step 2: Run everything**

Run: `node scripts/verify-signal.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline"`
Expected: every check passes.

Run: `npx tsc --noEmit && npm test && npm run test:workspace && npm run test:map && node scripts/verify-print.mjs && node scripts/verify-tiles.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline" && node scripts/verify-warp.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline" && node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Signal Baseline"`
Expected: all pass.

- [ ] **Step 3: Review the sheets by eye**

Judge each choice against rules 2, 3 and 6 in `docs/effects-improvement-plan-2026-11-12.md`. Use the stated Pass, Weak and Fail cutoffs. Retune defaults for a real failure, and record old and new values.

- [ ] **Step 4: Record results**

Write check results, preview times, retunes and what was not verified to `docs/signal-proof.md`. Add a short section to `README.md`.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-signal.mjs docs/signal-proof.md README.md
git commit -m "Prove the signal path"
```
