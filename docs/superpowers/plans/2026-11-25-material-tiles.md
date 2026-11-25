# Material Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the old Artefact tile looks into Form & Field as three new Finish effects (LED wall, Characters, Tiles) and two Print screen additions (blue-noise dither and retro palettes).

**Architecture:** A per-layer tile pass runs after Warp and Colour and Lens and before Glow, so LED light can glow. It first reduces the layer to one colour per cell in a small target, then draws emitters, glyphs or tiles from those cells. The cell grid is fixed to the frame and sized in pixels of a 1080-line frame, so previews and 4K exports match. Characters use a signed-distance glyph atlas built once at runtime, so type stays sharp at any size.

**Tech Stack:** TypeScript, three.js 0.187 `WebGLRenderer`, GLSL through `ShaderMaterial`, Canvas 2D for the glyph atlas, React, `node:test` through `tsx`, Electron and Playwright render checks.

**Spec:** The [Artefact Effects Catalogue](https://claude.ai/artifact/UbnTLyEawmZVnqiLj5wK7n), step 5, Material tiles. Old implementations are in `/Users/grego/Documents/Code/antigravity/artefact/effects-source/`: `ledMatrix.js`, `ascii.js`, `mosaic.js`, `lego.js`, `perler.js`, `bitCrush.js`, `ditherBlueNoise.js`, `ditherTemporal.js`.

## What this covers

| Old effect | Where it lands |
|---|---|
| LED Matrix | LED wall |
| ASCII | Characters |
| Mosaic | Tiles: Mosaic |
| Lego | Tiles: Brick |
| Perler Beads | Tiles: Beads |
| Dither Blue | Print screen: Blue noise type |
| Dither Temporal | Print screen: Shimmer |
| Bit Crush palettes | Print screen: Retro palette colour |

**Not in this plan:** Text Tile needs a saved text field, which the project format does not have, so it gets its own plan. Cross-Stitch and Knit were marked to leave out. The Cell engine is out of scope by the owner's choice.

## Global Constraints

- Build on a new branch `material-tiles` from `main` at `fe20b72`, in the worktree `/Users/grego/Documents/ChatGPT/three VJ - Tiles`. Keep a detached baseline checkout of `fe20b72` at `/Users/grego/Documents/ChatGPT/three VJ - Tiles Baseline`.
- Record the test baseline on `fe20b72` before changing anything. `npx tsx --test tests/*.test.ts` gives 1525 pass, 0 fail.
- Every new control defaults to off. Existing projects, presets, loops, seeking and exports render byte-identically.
- Project schema does not change. New keys migrate through `FINISH_KEYS`.
- Do not change Live or Map code. Map receives the effects through the shared Finish panel.
- Cell and glyph sizes are pixels of a 1080-line frame, and the grid is fixed to the frame. Motion is in whole cycles per loop.
- Work in linear premultiplied half-float. Keep over-range light. As an amount approaches zero, the output converges to the plain layer with no jump.
- Graphic layers take none of the new effects. Layers using them cannot use Tile Edges.
- Variations never switch a new effect on or change its stepped choices.
- Add no finish-look presets. Effects are added from Add effect, in the existing Surface group.
- Use plain labels. Do not show "SDF", "distance field", "dither matrix", "luma", "quantise" or "atlas".
- Use original code and system fonts. Do not copy third-party shader code or bundle a font file.

## Review Focus

1. **Older project files:** a project without the new keys opens and renders exactly as before. Pinned in Tasks 1 and 7.
2. **Preview against export:** the same cell size looks the same at 960x540 and 3840x2160. Pinned in Tasks 2, 3 and 4.
3. **Soft and transparent layers:** gaps and grout appear only where the layer has coverage, with no fringe. Pinned in Tasks 2 and 4.
4. **LED light into Glow:** bright emitters glow, and the LED never clips over-range light when Glow is off. Pinned in Task 2.
5. **Tiny cells at 4K:** the smallest LED, character and tile sizes do not shimmer or drop preview badly. Pinned in Tasks 2, 3 and 7.

---

### Task 1: Tile rules and saved controls

**Files:**
- Create: `src/rendering/tiles.ts`, `tests/tiles.test.ts`
- Modify: `src/core/finishing.ts`, `src/core/project.ts`, `src/core/tile-edges.ts`, `src/ui/finish-rack.ts`, `src/rendering/print-screen.ts`, `tests/print.test.ts`, `tests/core.test.ts` (extend key lists only)

**Interfaces:**
- Produces from `finishing.ts`: `LED_KEYS`, `CHAR_KEYS`, `TILE_KEYS`, and `PRINT_PARAMETERS` extended.
- Produces from `tiles.ts`:
  - `LED_SHAPES = ['Round','Square','Stripes']`
  - `CHAR_SETS: { name: string; glyphs: string }[]`
  - `TILE_STYLES = ['Mosaic','Brick','Beads']`
  - `GAP_FILLS = ['Transparent','Black','Colour 1','Colour 2','Colour 3','Colour 4','Colour 5','Colour 6']`
  - `RETRO_PALETTES: { name: string; colours: string[] }[]`
  - `supportsTiles(layer: Pick<Layer,'kind'>): boolean`
  - `tilesActive(layer: Pick<Layer,'kind'|'params'|'modulations'>): boolean`
  - `cellGrid(width: number, height: number, cellPx: number): { cols: number; rows: number; cellUv: [number, number] }`
  - `glyphForTone(tone: number, count: number): number`
  - `tileControlVisible(layer: Pick<Layer,'params'|'modulations'>, key: string): boolean`

`CHAR_SETS`, in order:

- `Density`: `' .:-=+*#%@'`
- `Blocks`: `' ░▒▓█'`
- `Binary`: `' 01'`
- `Dots`: `' ·•●'`

`RETRO_PALETTES`, in order:

- `Game Boy`: `#0f380f #306230 #8bac0f #9bbc0f`
- `CGA`: `#000000 #55ffff #ff55ff #ffffff`
- `Teletext`: `#000000 #ff0000 #00ff00 #ffff00 #0000ff #ff00ff #00ffff #ffffff`
- `Green screen`: `#001a00 #00ff41`

All new keys are `section:'Material'` unless marked M (`'Motion'`) or S (`'Shape'`):

| Key | Label | Min | Max | Step | Default |
|---|---|---:|---:|---:|---:|
| `ledAmount` | LED wall | 0 | 1 | .01 | 0 |
| `ledSize` S | LED pitch | 2 | 64 | .25 | 10 |
| `ledDot` S | LED size | .2 | 1 | .01 | .75 |
| `ledShape` S | LED shape | 0 | 2 | 1 | 0 |
| `ledBrightness` | LED brightness | .5 | 4 | .01 | 1.5 |
| `ledGaps` | LED background | 0 | 7 | 1 | 1 |
| `ledDead` | Dead LEDs | 0 | .2 | .001 | 0 |
| `ledScan` | LED scan lines | 0 | 1 | .01 | 0 |
| `ledFlicker` M | LED flicker | 0 | 1 | .01 | 0 |
| `charAmount` | Characters | 0 | 1 | .01 | 0 |
| `charSize` S | Character size | 4 | 96 | .25 | 16 |
| `charSet` S | Character set | 0 | 3 | 1 | 0 |
| `charColour` | Character colour | 0 | 1 | 1 | 0 |
| `charInk` | Character ink | 1 | 6 | 1 | 1 |
| `charGaps` | Character background | 0 | 7 | 1 | 1 |
| `charContrast` | Character contrast | .5 | 3 | .01 | 1 |
| `charSwaps` M | Character swaps per loop | 0 | 32 | 1 | 0 |
| `charSwapChance` | Swap chance | 0 | 1 | .01 | .05 |
| `tileAmount` | Tiles | 0 | 1 | .01 | 0 |
| `tileStyle` S | Tile style | 0 | 2 | 1 | 0 |
| `tileSize` S | Tile size | 3 | 96 | .25 | 18 |
| `tileGrout` S | Grout width | 0 | .5 | .01 | .12 |
| `tileGaps` | Grout colour | 0 | 7 | 1 | 1 |
| `tileRelief` | Tile relief | 0 | 1 | .01 | .5 |
| `tileLight` | Light angle | -180 | 180 | 1 | 135 |
| `tileJitter` | Irregularity | 0 | 1 | .01 | .3 |
| `printRetro` | Retro palette | 0 | 3 | 1 | 0 |
| `printShimmer` M | Shimmer | 0 | 1 | 1 | 0 |

Raise the existing `printType` max to 3 so it adds `Blue noise`, and `printColour` max to 4 so it adds `Retro palette`.

- [ ] **Step 1: Create the worktrees and record the baseline**

```bash
git -C "/Users/grego/Documents/ChatGPT/three VJ" worktree add -b material-tiles "/Users/grego/Documents/ChatGPT/three VJ - Tiles" fe20b72
```

```bash
git -C "/Users/grego/Documents/ChatGPT/three VJ" worktree add --detach "/Users/grego/Documents/ChatGPT/three VJ - Tiles Baseline" fe20b72
```

```bash
cd "/Users/grego/Documents/ChatGPT/three VJ - Tiles" && npm ci --no-audit --no-fund && ln -s "$PWD/node_modules" "../three VJ - Tiles Baseline/node_modules" && npm test
```

Expected: all pass, with 1525 unit tests. Record the Electron count.

- [ ] **Step 2: Write the failing tests in `tests/tiles.test.ts`**

```ts
const allKeys = [...LED_KEYS, ...CHAR_KEYS, ...TILE_KEYS];
test('tile effects are off by default and older projects migrate without them', () => {
  const project = createProject();
  for (const layer of project.layers) { assert.equal(tilesActive(layer), false); for (const key of [...allKeys, 'printRetro', 'printShimmer']) delete layer.params[key]; }
  const migrated = validateProject(JSON.parse(JSON.stringify(project))).layers[0].params;
  for (const key of ['ledAmount', 'charAmount', 'tileAmount', 'printShimmer']) assert.equal(migrated[key], 0);
});
test('any amount or an animated amount runs the tile pass, never on graphic layers', () => {
  const layer = createLayer('surface');
  for (const key of ['ledAmount', 'charAmount', 'tileAmount']) {
    assert.equal(tilesActive({ ...layer, params: { ...layer.params, [key]: .3 } }), true, key);
    assert.equal(tilesActive({ ...layer, modulations: { [key]: {} as never } }), true, key);
  }
  const graphic = createLayer('graphic');
  assert.equal(tilesActive({ ...graphic, params: { ...graphic.params, ledAmount: 1 } }), false);
  assert.equal(visibleParameterDefinitions(graphic).some(d => allKeys.includes(d.key)), false);
});
test('a tiled layer cannot use Tile Edges', () => {
  const layer = createLayer('surface'); layer.params.tileAmount = .5;
  assert.match(layerTileBlocker(layer) ?? '', /Tiles can't tile/);
});
test('the cell grid is sized in 1080-line pixels at any render size', () => {
  assert.deepEqual(cellGrid(1920, 1080, 10).cols, 192);
  assert.deepEqual(cellGrid(3840, 2160, 10).cols, 192);
  assert.deepEqual(cellGrid(960, 540, 10).rows, 108);
  const g = cellGrid(1000, 1000, 7);
  assert.equal(g.rows, Math.ceil(1080 / 7));
  assert.ok(Math.abs(g.cellUv[1] * g.rows - 1) < .02);
});
test('glyphs run from empty to full with tone', () => {
  assert.equal(glyphForTone(0, 10), 0);
  assert.equal(glyphForTone(1, 10), 9);
  assert.equal(glyphForTone(.5, 10), 5);
  assert.equal(glyphForTone(-1, 4), 0);
  assert.equal(glyphForTone(8, 4), 3);
});
test('character sets and retro palettes keep their order', () => {
  assert.deepEqual(CHAR_SETS.map(s => s.name), ['Density', 'Blocks', 'Binary', 'Dots']);
  assert.ok(CHAR_SETS.every(s => s.glyphs[0] === ' '));
  assert.deepEqual(RETRO_PALETTES.map(p => p.name), ['Game Boy', 'CGA', 'Teletext', 'Green screen']);
});
test('variations never switch tile effects on or change their choices', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, { palette: false, structure: false, motion: false, material: false }, entropy);
      for (const key of [...allKeys, 'printRetro', 'printShimmer', 'printType', 'printColour']) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
    }
  }
});
test('tile controls appear only for the choice that uses them', () => {
  const base = createLayer('surface');
  const on = (params: Record<string, number>) => ({ ...base, params: { ...base.params, ...params } });
  assert.equal(tileControlVisible(base, 'ledAmount'), true);
  assert.equal(tileControlVisible(base, 'ledSize'), false);
  assert.equal(tileControlVisible(on({ charAmount: .5, charColour: 0 }), 'charInk'), false);
  assert.equal(tileControlVisible(on({ charAmount: .5, charColour: 1 }), 'charInk'), true);
  assert.equal(tileControlVisible(on({ charAmount: .5, charSwaps: 0 }), 'charSwapChance'), false);
  assert.equal(tileControlVisible(on({ tileAmount: .5, tileStyle: 0 }), 'tileJitter'), true);
  assert.equal(tileControlVisible(on({ tileAmount: .5, tileStyle: 2 }), 'tileJitter'), false);
});
```

Add to `tests/print.test.ts`: Print keys migrate with `printRetro` 0 and `printShimmer` 0, and `printType` 3 and `printColour` 4 validate.

- [ ] **Step 3: Run to verify failure**

Run: `npx tsx --test tests/tiles.test.ts tests/print.test.ts`
Expected: FAIL, `src/rendering/tiles` cannot be resolved.

- [ ] **Step 4: Implement the rules and wiring**

- `cellGrid`: `cellPx` is in 1080-line pixels, so the cell height is `cellPx / 1080` of the frame height. `rows` is `ceil(1080 / cellPx)`, and `cols` uses the frame aspect.
- `glyphForTone`: clamp to `[0, 1]`, then `round(tone * (count - 1))`.
- Spread the new groups into `FINISH_PARAMETERS`. In `project.ts`, hide the keys for unsupported layers, require support in `finishSupported`, and skip them in `varyLayer`.
- Do not add tile keys to `FINISH_LOOK_KEYS`.
- Add `${n}: Tiles can't tile.` to `layerTileBlocker`.
- Add three effects to the `Surface` group in `finish-rack.ts`, after Print screen:

| id | Label | Switch starts at | Description |
|---|---|---|---|
| `led` | LED wall | `ledAmount: 1` | Rebuilds the picture as a wall of glowing LEDs. |
| `chars` | Characters | `charAmount: 1` | Rebuilds the picture from text characters. |
| `tiles` | Tiles | `tileAmount: 1` | Rebuilds the picture from mosaic tiles, bricks or beads. |

Row summaries are the LED shape, Character set name and Tile style.

- [ ] **Step 5: Run the full suite**

Run: `npx tsc --noEmit && npx tsx --test tests/*.test.ts`
Expected: clean, all pass.

- [ ] **Step 6: Commit**

```bash
git add src/rendering/tiles.ts tests/tiles.test.ts src/core/finishing.ts src/core/project.ts src/core/tile-edges.ts src/ui/finish-rack.ts src/rendering/print-screen.ts tests/print.test.ts tests/core.test.ts
git commit -m "Add material tile controls and rules"
```

### Task 2: Cell pass and LED wall

**Files:**
- Create: `scripts/verify-tiles.mjs`
- Modify: `src/rendering/tiles.ts`, `src/rendering/StudioRenderer.ts`

**Interfaces:**
- Consumes: Task 1 rules.
- Produces: `cellColourFragment: string`, `tileFragment: string`, and `StudioRenderer.tileSource(original: Layer, layer: Layer, source: THREE.Texture, phase: number, width: number, height: number): THREE.Texture`. GLSL `vec4 cellColour(vec2 cell)` and `vec4 ledStage(vec2 uv)`, later joined by `charStage` and `tileStage`. A script with named checks, `--baseline=` and `--only=`.

- [ ] **Step 1: Write the failing render checks**

Build `scripts/verify-tiles.mjs` from the harness in `scripts/verify-warp.mjs`, including its loop helper. Add:

- `neutral`: one preset of every kind, plus an Image layer, equals the baseline byte for byte, and each render is non-blank.
- `cell-average`: a fine checker under the cell pass gives each cell its true mean colour within 2/255.
- `led-shapes`: Round, Square and Stripes each change the render and differ. Stripes shows separate red, green and blue bars in a white cell.
- `led-scale`: the same pitch at 960 and 3840 wide, downsampled, differs by a mean under 2/255.
- `led-gaps`: Transparent gaps are alpha 0 between emitters on an opaque layer. Black and palette gaps fill only where the layer has coverage.
- `led-glow`: with Glow on, `ledBrightness` 3 glows visibly more than 1. With Glow off, output keeps over-range light instead of clamping it to 1.
- `led-dead`: `ledDead: .05` turns off about 5% of emitters, within 1.5 points, and the same ones on every frame.
- `led-loop`: with `ledFlicker: .5`, phase `0` against `TAU`, and the seam phase `TAU - 1e-4` against `0`, using the shared helper.
- `led-engage`: `ledAmount: .001` matches plain, mean under 1/255.
- `led-history`: an echoing layer with LED wall stays byte-identical after a seek, and the echo is not tiled twice.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/verify-tiles.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Tiles Baseline" --only=led,cell`
Expected: FAIL, LED wall does not change the render.

- [ ] **Step 3: Implement the cell pass and LED wall**

In `renderFrame`, after `lensSource`, add:

```ts
const tiled = tilesActive(original) ? this.tileSource(original, layer, lensed, wrapped, width, height) : lensed;
```

Use `tiled` for Glow and the composite. Keep the Smoke Cloud fast path correct.

- **Cell pass:** draws one texel per cell into a small half-float target, averaging premultiplied colour over up to 8x8 even samples in the cell.
- **Tile pass:** reads that target with nearest filtering at the cell centre and draws the effect.
- **Emitters:** shape distance is filtered to one output pixel, using frame-fixed cells.
- **Brightness:** `ledBrightness` multiplies emitted light without clamping.
- **Dead LEDs and flicker:** come from a seeded per-cell hash. Flicker keys on the loop frame, so warm-ups and seeks repeat.
- **Mix:** blends tiled and plain by the amount.
- **Targets:** allocate both lazily and release them beside `warpTarget`.

- [ ] **Step 4: Run checks**

Run: `npx tsc --noEmit && npm test && node scripts/verify-tiles.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Tiles Baseline" --only=neutral,cell,led`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-tiles.mjs src/rendering/tiles.ts src/rendering/StudioRenderer.ts
git commit -m "Add the cell pass and LED wall"
```

### Task 3: Characters

**Files:**
- Create: `src/rendering/glyph-atlas.ts`, `tests/glyph-atlas.test.ts`
- Modify: `src/rendering/tiles.ts`, `src/rendering/StudioRenderer.ts`, `scripts/verify-tiles.mjs`

**Interfaces:**
- Consumes: the cell pass and `CHAR_SETS`.
- Produces:
  - `distanceField(alpha: Uint8Array, width: number, height: number, spread: number): Float32Array`
  - `buildGlyphAtlas(glyphs: string, cellPx: number): { width: number; height: number; field: Float32Array; columns: number }`
  - GLSL `vec4 charStage(vec2 uv)`

- [ ] **Step 1: Write failing tests**

```ts
test('the distance field is signed, centred on the edge and clamped by spread', () => {
  const w = 16, h = 16, alpha = new Uint8Array(w * h);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) alpha[y * w + x] = 255;
  const f = distanceField(alpha, w, h, 4);
  assert.ok(f[8 * w + 8] > .5, 'inside is above the edge value');
  assert.ok(f[0] < .5, 'outside is below the edge value');
  assert.ok(Math.abs(f[8 * w + 4] - .5) < .2, 'the edge sits near .5');
  assert.ok(f.every(v => v >= 0 && v <= 1));
});
test('an empty glyph gives an all-outside field', () => {
  assert.ok(distanceField(new Uint8Array(64), 8, 8, 4).every(v => v < .5));
});
```

Add render checks:

- `char-sets`: each set changes the render, and a black-to-white ramp uses the set's glyphs in order: the first cell is empty and the last is the full glyph.
- `char-sharp`: at `charSize: 48`, a 3840-wide export has a glyph edge width within 1.5 output pixels.
- `char-scale`: 960 against 3840 at the same size, downsampled, mean under 3/255.
- `char-colour`: Layer colour keeps each cell's hue. Palette ink uses that swatch everywhere.
- `char-swaps`: `charSwaps: 8, charSwapChance: .2` changes about 20% of glyphs at each swap, holds between swaps, and closes the loop across the seam.
- `char-fonts`: every glyph in every set renders non-empty except the space, proving the system font covers them.
- `char-engage`: `charAmount: .001` matches plain.

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/glyph-atlas.test.ts`
Expected: FAIL, `glyph-atlas` cannot be resolved.

- [ ] **Step 3: Implement Characters**

- `distanceField`: two-pass Euclidean distance transform on inside and outside masks, mapped to `0.5 + signed / (2 * spread)` and clamped.
- `buildGlyphAtlas`: draws each glyph with Canvas 2D in `ui-monospace, Menlo, Consolas, monospace` at 64 px per glyph, then runs `distanceField` with spread 8. Build once per set, cache it, upload it as a single-channel float texture, and release it with the tile targets.
- **Glyph choice:** each cell picks a glyph by `glyphForTone` of perceptual tone after `charContrast`.
- **Swaps:** they pick a seeded random glyph, re-rolled `charSwaps` times per loop.
- **Edges:** threshold at .5 with `fwidth` smoothing.

- [ ] **Step 4: Run checks**

Run: `npx tsc --noEmit && npm test && node scripts/verify-tiles.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Tiles Baseline" --only=neutral,cell,led,char`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/glyph-atlas.ts tests/glyph-atlas.test.ts src/rendering/tiles.ts src/rendering/StudioRenderer.ts scripts/verify-tiles.mjs
git commit -m "Add Characters"
```

### Task 4: Tiles

**Files:**
- Modify: `src/rendering/tiles.ts`, `src/rendering/StudioRenderer.ts`, `scripts/verify-tiles.mjs`

**Interfaces:**
- Consumes: the cell pass.
- Produces: GLSL `vec4 tileStage(vec2 uv)`.

- [ ] **Step 1: Add failing render checks**

- `tile-styles`: Mosaic, Brick and Beads change the render and differ.
- `tile-grout`: Grout width 0 leaves no grout pixels. Width .3 gives grout covering roughly 50% of each cell, within 8 points: 1 - .7² is 51%.
- `tile-brick`: every other row of Brick is offset by half a cell, and each brick shows a round stud.
- `tile-beads`: Beads have a transparent or grout-coloured hole at the centre of every cell.
- `tile-light`: turning `tileLight` 180 degrees swaps the lit and shaded bevel edges.
- `tile-jitter`: Mosaic irregularity .8 makes cell boundaries visibly uneven, while 0 makes a regular grid, and the result is stable across frames.
- `tile-alpha`: on a soft-masked layer, grout and tiles appear only inside coverage, and straight colour does not exceed the brightest source channel by more than 2/255.
- `tile-scale`, `tile-engage`: same rules as the LED checks.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/verify-tiles.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Tiles Baseline" --only=tile`
Expected: FAIL.

- [ ] **Step 3: Implement Tiles**

All three styles colour each tile from its cell, shade it with a height profile lit from `tileLight`, and fill grout with the Grout colour. Edges are filtered to one output pixel.

- **Mosaic:** each grid corner moves by `tileJitter * .35` of a cell, from a seeded hash, and tile edges follow the moved corners.
- **Brick:** alternate rows are offset by half a cell, with a stud of radius .3 cell raised by `tileRelief`.
- **Beads:** each cell is a ring, outer radius .46 cell and inner radius .16 cell, with a specular highlight from `tileLight`.

- [ ] **Step 4: Run checks**

Run: `npx tsc --noEmit && npm test && node scripts/verify-tiles.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Tiles Baseline" --only=neutral,cell,led,char,tile`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/tiles.ts src/rendering/StudioRenderer.ts scripts/verify-tiles.mjs
git commit -m "Add Tiles: mosaic, brick and beads"
```

### Task 5: Print screen blue noise, shimmer and retro palettes

**Files:**
- Create: `scripts/make-blue-noise.mjs`, `src/rendering/blue-noise-data.ts`, `tests/blue-noise.test.ts`
- Modify: `src/rendering/print-screen.ts`, `src/rendering/shaders.ts`, `src/rendering/StudioRenderer.ts`, `tests/print.test.ts`, `scripts/verify-print.mjs`

**Interfaces:**
- Produces:
  - `BLUE_NOISE_SIZE = 64`
  - `blueNoise(): Uint8Array`, with 4096 values
  - `retroColour(tone: number, palette: number): string`
  - `shimmerOffset(frame: number): [number, number]`

- [ ] **Step 1: Write failing tests**

```ts
test('the blue-noise tile uses every threshold once and has no low-frequency clumps', () => {
  const n = blueNoise();
  assert.equal(n.length, 4096);
  const counts = new Array(256).fill(0); for (const v of n) counts[v]++;
  assert.ok(counts.every(c => c === 16), 'each byte value appears 16 times');
  const mean = (x0: number, y0: number) => { let s = 0; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) s += n[(y0 + y) * 64 + x0 + x]; return s / 256; };
  for (const [x, y] of [[0, 0], [16, 32], [48, 48]]) assert.ok(Math.abs(mean(x, y) - 127.5) < 6);
});
test('retro colours step through the palette by tone', () => {
  assert.equal(retroColour(0, 0), '#0f380f');
  assert.equal(retroColour(1, 0), '#9bbc0f');
  assert.equal(retroColour(.5, 3), '#00ff41');
});
test('shimmer offsets are whole texels and differ frame to frame', () => {
  const a = shimmerOffset(0), b = shimmerOffset(1);
  assert.ok(a.every(Number.isInteger) && b.every(Number.isInteger));
  assert.notDeepEqual(a, b);
});
```

Add Print render checks:

- `print-blue`: the Blue noise type at mid-grey has no visible repeating grid. Its high-frequency energy ratio is well above the 8x8 Bayer screen at the same size.
- `print-retro`: each retro palette produces only that palette's colours, within 2/255, on an opaque ramp.
- `print-shimmer`: Shimmer changes the pattern every frame, closes the loop across the seam, and is off by default, so existing Print looks stay unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/blue-noise.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`scripts/make-blue-noise.mjs` runs void-and-cluster with a Gaussian of sigma 1.5 on a 64x64 torus, ranks every pixel into 0 to 255, and writes `blue-noise-data.ts` as base64. Commit the generated file.

Blue noise is a single-channel nearest-filtered repeating texture, scaled so one texel is one Print cell. Shimmer offsets it by `shimmerOffset(loop frame)`, using the R2 sequence over the 64x64 tile. Retro palette maps tone to the nearest of the palette's colours after the screen threshold.

- [ ] **Step 4: Run checks**

Run: `npx tsc --noEmit && npm test && node scripts/verify-print.mjs`
Expected: all pass, and existing Print checks are unchanged.

- [ ] **Step 5: Commit**

```bash
git add scripts/make-blue-noise.mjs src/rendering/blue-noise-data.ts tests/blue-noise.test.ts src/rendering/print-screen.ts src/rendering/shaders.ts src/rendering/StudioRenderer.ts tests/print.test.ts scripts/verify-print.mjs
git commit -m "Add blue-noise screen, shimmer and retro palettes to Print"
```

### Task 6: Controls and thumbnails

**Files:**
- Create: `src/ui/TileSections.tsx`, `src/ui/assets/finish/led.jpg`, `src/ui/assets/finish/chars.jpg`, `src/ui/assets/finish/tiles.jpg`
- Modify: `src/ui/FinishControls.tsx`, `src/ui/finish-thumbs.ts`, `scripts/make-finish-thumbs.mjs`, `scripts/verify-workspace-ui.mjs`

**Interfaces:**
- Consumes: Task 1 lists and `tileControlVisible`; existing `FinishProps`, including optional `animate`, `extra` and `readOnly`.
- Produces: `LedSection`, `CharactersSection` and `TilesSection`.

- [ ] **Step 1: Write the failing UI check**

Extend the workspace check:

- On a Surface layer, the Surface picker group shows LED wall, Characters and Tiles with thumbnails, and still fits one screen.
- Adding each opens controls that fit one screen.
- The Print screen panel offers `Blue noise` and `Retro palette`.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:workspace`
Expected: FAIL on the missing rows.

- [ ] **Step 3: Implement**

Add the three sections, following `WarpSections.tsx`. Pass `disabled` from `readOnly` on choices. In Print, add `Blue noise` to the type choices, and `Retro palette` with a `Retro palette` choice to the colour choices. Add the Shimmer switch when the type is Dither or Blue noise.

Render the three thumbnails with `make-finish-thumbs.mjs --only=led,chars,tiles`, leaving the others unchanged.

- [ ] **Step 4: Run all checks**

Run: `npx tsc --noEmit && npm test && npm run test:workspace && npm run test:map`
Expected: all pass. Rerun workspace up to twice for the known "Focus preview" timeout, and record each result.

- [ ] **Step 5: Commit**

```bash
git add src/ui/TileSections.tsx src/ui/FinishControls.tsx src/ui/finish-thumbs.ts src/ui/assets/finish/led.jpg src/ui/assets/finish/chars.jpg src/ui/assets/finish/tiles.jpg scripts/make-finish-thumbs.mjs scripts/verify-workspace-ui.mjs
git commit -m "Add LED wall, Characters and Tiles controls"
```

### Task 7: Whole-branch proof

**Files:**
- Modify: `scripts/verify-tiles.mjs`, `README.md`
- Create: `docs/tiles-proof.md`

- [ ] **Step 1: Add final checks**

- `all-presets-neutral`: every preset equals baseline byte for byte, non-blank.
- `old-file`: a project saved by the baseline build opens and renders byte-identically.
- `stack`: LED wall, Characters and Tiles, each with Warp, Split, Gradient, Glow, Feedback and Time, renders non-blank and repeats after a seek.
- `sheet`: every LED shape, character set and tile style on Surface, Fractal, Liquid and Image layers at three phases, written to `work/tiles-proof/`.
- `preview-cost`: mean preview frame time at 1280x720 for each effect at its smallest size, against plain. Report only.

- [ ] **Step 2: Run everything**

Run: `node scripts/verify-tiles.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Tiles Baseline"`
Expected: every check passes.

Run: `npx tsc --noEmit && npm test && npm run test:workspace && npm run test:map && node scripts/verify-print.mjs && node scripts/verify-warp.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Tiles Baseline" && node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Tiles Baseline"`
Expected: all pass.

- [ ] **Step 3: Review the sheets by eye**

Judge each choice against rules 2, 3 and 6 in `docs/effects-improvement-plan-2026-11-12.md`. Retune defaults for a real failure, and record old and new values.

- [ ] **Step 4: Record results**

Write check results, preview times, retunes and what was not verified to `docs/tiles-proof.md`. Add a short section to `README.md`.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-tiles.mjs docs/tiles-proof.md README.md
git commit -m "Prove the material tiles"
```
