# Displacement Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring 12 old Artefact warps into Form & Field as five Finish effects (Warp, Liquid, Luma Warp, Polar and Mirror) built on one shared displacement pass.

**Architecture:** One new per-layer pass composes all five effects into a single displaced coordinate, then samples the source once, so stacked warps do not soften the picture. It runs after Feedback and Time and before Colour and Lens, so it never enters the echo history. Motion comes from a looped noise domain and whole cycles per loop, so no history is stored and every frame can be rendered in any order.

**Tech Stack:** TypeScript, three.js 0.187 `WebGLRenderer`, GLSL through `ShaderMaterial`, React, `node:test` through `tsx`, Electron and Playwright render checks.

**Spec:** The [Artefact Effects Catalogue](https://claude.ai/artifact/UbnTLyEawmZVnqiLj5wK7n), step 3. Old implementations are in `/Users/grego/Documents/Code/antigravity/artefact/effects-source/`: `warp.js`, `waveDistortion.js`, `rippleDisplace.js`, `magneticWarp.js`, `plasmaWarp.js`, `curlNoiseWarp.js`, `flowField.js`, `fluidWarp.js`, `lumaWarp.js`, `polarWarp.js`, `mirror.js`, and Pixel Melt in `wgslEffects.js`.

## What this covers

| Old effect | Where it lands |
|---|---|
| Warp, Wave Distort | Warp: Waves and Noise fields |
| Ripple Displace | Warp: Ripple field |
| Magnetic Warp | Warp: Magnetic field |
| Plasma Warp | Warp: Plasma field |
| Curl Noise, Pixel Melt | Liquid: Curl style, with more flow steps for melt |
| Flow Field | Liquid: Flow style |
| Fluid Warp | Liquid: Ridge, Vortex and Chaos styles |
| Luma Warp | Luma Warp, driven by this layer or the layer below |
| Polar Warp | Polar |
| Mirror | Mirror |

**Not in this plan:** Depth Pop needs a real depth model and gets its own plan. Fluid Warp's built-in hue and iridescence are dropped because Gradient Map, Colour split and Feedback already cover them.

## Global Constraints

- Build on a new branch `warp-engine` from `main` at `22339a8`, in the worktree `/Users/grego/Documents/ChatGPT/three VJ - Warp`. Keep a detached baseline checkout of `22339a8` at `/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline`.
- Test baseline on `22339a8`: **552 unit and 93 Electron tests pass, 0 fail**. The workspace "Focus preview" step has a known intermittent timeout.
- Every new control defaults to off or neutral. Existing projects, presets, loops, seeking and exports render byte-identically.
- Project schema does not change. New keys migrate through `FINISH_KEYS`.
- Do not change Live or Map code. Map receives the effects through the shared Finish panel.
- Distances are shares of frame height, so the look matches at every export size. Motion is in whole cycles per loop.
- Work in linear premultiplied half-float. Keep over-range light. As any amount approaches zero, output converges to the plain layer with no jump.
- Graphic layers take no warp. Layers using a warp cannot use Tile Edges.
- Variations never switch a warp on, and never change its stepped choices.
- Add no finish-look presets. Each effect is added from Add effect.
- Use plain labels. Do not show "displacement", "domain", "curl", "divergence", "gradient" or "advection". The Liquid style named `Swirl` is the old Curl style.

## Review Focus

1. **Older project files:** a project without the new keys opens and renders exactly as before. Pinned in Tasks 1 and 7.
2. **Warps at the frame edge:** high amounts must never smear a stretched edge line or show black gaps on a full-frame layer. Pinned in Task 2.
3. **Soft and transparent layers:** warping a cut-out must not create bright or dark fringes. Pinned in Task 2.
4. **Luma Warp on the bottom layer:** with nothing below it, "Layer below" leaves the picture unchanged and says why. Pinned in Task 4.
5. **Fine detail at 4K:** strong warps must not sparkle where the picture is squeezed. Pinned in Task 2.

---

### Task 1: Warp rules and saved controls

**Files:**
- Create: `src/rendering/warp.ts`, `tests/warp.test.ts`
- Modify: `src/core/finishing.ts`, `src/core/project.ts`, `src/core/tile-edges.ts`, `src/ui/finish-rack.ts`, `tests/core.test.ts` (extend the step-1 key list only)

**Interfaces:**
- Produces from `finishing.ts`: `WARP_PARAMETERS`, `WARP_KEYS`, `LIQUID_KEYS`, `LUMA_WARP_KEYS`, `POLAR_KEYS`, `MIRROR_KEYS`.
- Produces from `warp.ts`:
  - `WARP_FIELDS = ['Waves','Noise','Ripple','Magnetic','Plasma']`
  - `LIQUID_STYLES = ['Swirl','Flow','Ridge','Vortex','Chaos']`
  - `LUMA_SOURCES = ['This layer','Layer below']`
  - `LUMA_CHANNELS = ['Brightness','Red','Green','Blue','Saturation']`
  - `LUMA_MODES = ['Push','Edges','Contours']`
  - `POLAR_MODES = ['To circle','Unroll']`
  - `MIRROR_MODES = ['Left-right','Top-bottom','Four-way','Kaleidoscope']`
  - `supportsWarp(layer: Pick<Layer,'kind'>): boolean`
  - `warpActive(layer: Pick<Layer,'kind'|'params'|'modulations'>): boolean`
  - `warpPoints(count: number, seed: number): { x: number; y: number; polarity: number }[]`
  - `foldAngle(angle: number, segments: number): number`
  - `loopOffset(phase: number, cycles: number): [number, number]`

All are `section:'Material'` unless marked M (`'Motion'`) or S (`'Shape'`):

| Key | Label | Min | Max | Step | Default |
|---|---|---:|---:|---:|---:|
| `bendAmount` | Warp amount | 0 | 1 | .005 | 0 |
| `bendField` S | Warp type | 0 | 4 | 1 | 0 |
| `bendScale` S | Warp scale | .25 | 12 | .01 | 3 |
| `bendAngle` S | Warp angle | -180 | 180 | 1 | 0 |
| `bendCycles` M | Warp cycles per loop | -8 | 8 | 1 | 1 |
| `bendDetail` S | Warp detail | 1 | 5 | 1 | 3 |
| `bendPoints` S | Warp points | 1 | 8 | 1 | 3 |
| `bendFalloff` S | Warp falloff | 0 | 1 | .01 | .5 |
| `bendChroma` | Warp colour fringe | 0 | 1 | .01 | 0 |
| `liquidAmount` | Liquid amount | 0 | 1 | .005 | 0 |
| `liquidStyle` S | Liquid style | 0 | 4 | 1 | 0 |
| `liquidScale` S | Liquid scale | .25 | 8 | .01 | 2 |
| `liquidSteps` S | Flow steps | 1 | 16 | 1 | 6 |
| `liquidDetail` S | Liquid detail | 1 | 5 | 1 | 3 |
| `liquidCycles` M | Liquid cycles per loop | -4 | 4 | 1 | 1 |
| `liquidTrail` | Liquid trail | 0 | 1 | .01 | 0 |
| `liquidChroma` | Liquid colour fringe | 0 | 1 | .01 | 0 |
| `lumaWarpAmount` | Luma warp amount | 0 | 1 | .005 | 0 |
| `lumaWarpSource` S | Driven by | 0 | 1 | 1 | 0 |
| `lumaWarpChannel` S | Read from | 0 | 4 | 1 | 0 |
| `lumaWarpMode` S | Luma direction | 0 | 2 | 1 | 0 |
| `lumaWarpAngle` S | Luma angle | -180 | 180 | 1 | 90 |
| `lumaWarpThreshold` | Luma threshold | 0 | 1 | .01 | 0 |
| `lumaWarpSoft` | Luma softness | 0 | 1 | .01 | .2 |
| `lumaWarpChroma` | Luma colour fringe | 0 | 1 | .01 | 0 |
| `polarAmount` | Polar amount | 0 | 1 | .005 | 0 |
| `polarMode` S | Polar type | 0 | 1 | 1 | 0 |
| `polarCentreX` S | Polar centre X | -.5 | .5 | .005 | 0 |
| `polarCentreY` S | Polar centre Y | -.5 | .5 | .005 | 0 |
| `polarTwist` S | Polar twist | -4 | 4 | .01 | 0 |
| `mirrorAmount` | Mirror amount | 0 | 1 | .01 | 0 |
| `mirrorMode` S | Mirror type | 0 | 3 | 1 | 0 |
| `mirrorSegments` S | Mirror segments | 2 | 16 | 1 | 6 |
| `mirrorAngle` S | Mirror angle | -180 | 180 | 1 | 0 |
| `mirrorTurns` M | Mirror turns per loop | -8 | 8 | 1 | 0 |

- [ ] **Step 1: Create the worktrees and confirm the baseline**

```bash
git -C "/Users/grego/Documents/ChatGPT/three VJ" worktree add -b warp-engine "/Users/grego/Documents/ChatGPT/three VJ - Warp" 22339a8
```

```bash
git -C "/Users/grego/Documents/ChatGPT/three VJ" worktree add --detach "/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline" 22339a8
```

```bash
cd "/Users/grego/Documents/ChatGPT/three VJ - Warp" && npm ci --no-audit --no-fund && ln -s "$PWD/node_modules" "../three VJ - Warp Baseline/node_modules" && npm test
```

Expected: 552 and 93 pass, 0 fail.

- [ ] **Step 2: Write the failing tests in `tests/warp.test.ts`**

```ts
const allKeys = [...WARP_KEYS, ...LIQUID_KEYS, ...LUMA_WARP_KEYS, ...POLAR_KEYS, ...MIRROR_KEYS];

test('warps are off by default and older projects migrate without them', () => {
  const project = createProject();
  for (const layer of project.layers) { assert.equal(warpActive(layer), false); for (const key of allKeys) delete layer.params[key]; }
  const migrated = validateProject(JSON.parse(JSON.stringify(project))).layers[0].params;
  for (const key of ['bendAmount', 'liquidAmount', 'lumaWarpAmount', 'polarAmount', 'mirrorAmount']) assert.equal(migrated[key], 0);
});
test('any warp amount, or an animated amount, makes the pass run', () => {
  const layer = createLayer('surface');
  for (const key of ['bendAmount', 'liquidAmount', 'lumaWarpAmount', 'polarAmount', 'mirrorAmount']) {
    assert.equal(warpActive({ ...layer, params: { ...layer.params, [key]: .2 } }), true, key);
    assert.equal(warpActive({ ...layer, modulations: { [key]: {} as never } }), true, key);
  }
});
test('graphic layers take no warp, and a warped layer cannot tile', () => {
  const graphic = createLayer('graphic');
  assert.equal(warpActive({ ...graphic, params: { ...graphic.params, bendAmount: 1 } }), false);
  assert.equal(visibleParameterDefinitions(graphic).some(d => allKeys.includes(d.key)), false);
  const layer = createLayer('surface'); layer.params.liquidAmount = .3;
  assert.match(layerTileBlocker(layer) ?? '', /Warp can't tile/);
});
test('warp points are stable, inside the frame and use both polarities', () => {
  assert.deepEqual(warpPoints(4, 1729), warpPoints(4, 1729));
  assert.notDeepEqual(warpPoints(4, 1729), warpPoints(4, 1730));
  const points = warpPoints(8, 1729);
  assert.equal(points.length, 8);
  assert.ok(points.every(p => p.x >= .1 && p.x <= .9 && p.y >= .1 && p.y <= .9));
  assert.deepEqual([...new Set(points.map(p => p.polarity))].sort(), [-1, 1]);
});
test('kaleidoscope folding is periodic and mirrored', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  const wedge = Math.PI * 2 / 6;
  near(foldAngle(.2, 6), .2);
  near(foldAngle(.2 + wedge, 6), .2);
  near(foldAngle(wedge - .2, 6), .2);
  near(foldAngle(-.2, 6), .2);
});
test('loop motion closes after whole cycles', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9);
  for (const cycles of [-3, 1, 4]) { const a = loopOffset(0, cycles), b = loopOffset(Math.PI * 2, cycles); near(a[0], b[0]); near(a[1], b[1]); }
  assert.deepEqual(loopOffset(1.2, 0), [0, 0]);
});
test('variations never switch a warp on or change its choices', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, { palette: false, structure: false, motion: false, material: false }, entropy);
      for (const key of allKeys) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
    }
  }
});
test('every warp key belongs to one Finish effect in the Warp group', () => {
  const ids = FINISH_EFFECTS.filter(item => item.group === 'Warp').map(item => item.id);
  assert.deepEqual(ids, ['warp', 'liquid', 'lumaWarp', 'polar', 'mirror']);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx tsx --test tests/warp.test.ts`
Expected: FAIL, because `src/rendering/warp` cannot be resolved.

- [ ] **Step 4: Implement the rules and wiring**

- `loopOffset`: `[sin(cycles*phase), cos(cycles*phase) - 1]`, returning `[0,0]` when `cycles` is 0.
- `foldAngle`: reduce into `[0, wedge)`, then return `min(a, wedge-a)`.
- `warpPoints`: deterministic from `seed`, with alternating polarity.
- Spread `WARP_PARAMETERS` into `FINISH_PARAMETERS`.
- In `project.ts`, hide all warp keys when `!supportsWarp(layer)`, require support in `finishSupported`, and skip every warp key in `varyLayer`. Do not add warp keys to `FINISH_LOOK_KEYS`, so applying a look keeps the artist's warp.
- Add `${n}: Warp can't tile.` to `layerTileBlocker` when `warpActive`.
- In `finish-rack.ts`, add `'Warp'` to `FINISH_GROUPS` after `'Light'`, plus five effects:

| id | Label | Switch starts at | Description |
|---|---|---|---|
| `warp` | Warp | `bendAmount: .15` | Bends the picture with waves, noise, ripples, magnets or plasma. |
| `liquid` | Liquid | `liquidAmount: .25` | Swirls and melts the picture along flowing currents. |
| `lumaWarp` | Luma Warp | `lumaWarpAmount: .15` | Melts the picture along its own light, or along the layer below. |
| `polar` | Polar | `polarAmount: 1` | Wraps the picture into a circle, or unrolls a circle into a strip. |
| `mirror` | Mirror | `mirrorAmount: 1` | Reflects the picture into symmetrical halves, quarters or wedges. |

Row summaries are the Warp type, Liquid style, Driven by, Polar type and Mirror type.

- [ ] **Step 5: Run the full suite**

Run: `npx tsc --noEmit && npx tsx --test tests/*.test.ts`
Expected: clean, all pass.

- [ ] **Step 6: Commit**

```bash
git add src/rendering/warp.ts tests/warp.test.ts src/core/finishing.ts src/core/project.ts src/core/tile-edges.ts src/ui/finish-rack.ts tests/core.test.ts
git commit -m "Add warp finish controls and rules"
```

### Task 2: Shared pass and the Warp effect

**Files:**
- Create: `scripts/verify-warp.mjs`
- Modify: `src/rendering/warp.ts`, `src/rendering/StudioRenderer.ts`

**Interfaces:**
- Consumes: Task 1 rules.
- Produces: `warpFragment: string`; `StudioRenderer.warpSource(original: Layer, layer: Layer, source: THREE.Texture, below: THREE.Texture, phase: number, width: number, height: number): THREE.Texture`; GLSL `vec2 warpedUv(vec2 uv)`, later extended by Tasks 3 to 5; a script with named checks, `--baseline=` and `--only=` by comma-separated prefixes.

- [ ] **Step 1: Write the failing render checks**

Build `scripts/verify-warp.mjs` from the Electron and comparison helpers in `scripts/verify-colour-time.mjs`. Add:

- `neutral`: one preset of every kind, plus an Image layer, equals the baseline byte for byte.
- `warp-types`: each of the five fields visibly changes the render and differs from the other four.
- `warp-engage`: `bendAmount: .0001` matches the plain layer on a smooth source, mean under 1/255.
- `warp-loop`: phase `TAU - 1e-4` matches phase `0`, mean under .1, and the check fails if `bendCycles` is not rounded.
- `warp-scale`: the same look at 960 and 1920 wide, downsampled, differs by a mean under 2/255.
- `warp-edge`: full-frame layer at amount 1, each field. Alpha stays full everywhere, and no output row or column is a constant stretched line.
- `warp-alpha`: soft-masked layer on a transparent project. No straight-alpha colour exceeds the brightest source channel by more than 2/255, measured with exact highlights.
- `warp-sparkle`: a fine checker at 3840x2160 under strong Noise. Mean frame-to-frame high-frequency energy is under half of the same render with single-tap sampling.
- `warp-history`: an echoing layer with Warp is byte-identical when seeking two ways, and its echo is not warped twice.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/verify-warp.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline" --only=warp`
Expected: FAIL, Warp does not change the render.

- [ ] **Step 3: Implement the pass**

In `renderFrame`, between the Feedback and Time source and `lensSource`:

```ts
const warped = warpActive(original) ? this.warpSource(original, layer, sourceTexture, below.texture, wrapped, width, height) : sourceTexture;
```

Pass `warped` to `lensSource`, and use it wherever `sourceTexture` was used after that point. Keep one lazily allocated half-float target, and release it beside `lensTarget` in `releaseTimeTargets` and `dispose()`.

Shader rules:
- Non-graphic source textures are already in frame coordinates, so `vUv` is both.
- Compose everything into one `warpedUv`, and sample the source once per tap.
- Mirror coordinates that leave the frame, so there is no edge streak or gap.
- Use 1 tap when the coordinate footprint is at most one texel, rising to 4 rotated-grid taps at larger footprints, computed from `fwidth(warped)`.
- `bendChroma` samples red and blue at `±(chroma * .08)` of the displacement. Keep the Split bound rule: straight colour stays within the brightest straight sample.
- `bendAmount` 1 is a maximum displacement of `.5` of frame height.
- Waves uses two sines along `bendAngle`. Noise uses looped fractal value noise over `bendDetail` octaves. Ripple and Magnetic use `bendPoints` positions from `warpPoints()` in a uniform array. Plasma uses four interfering sines.

- [ ] **Step 4: Run checks**

Run: `node scripts/verify-warp.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline" --only=neutral,warp`
Expected: all PASS.

Run: `npx tsc --noEmit && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-warp.mjs src/rendering/warp.ts src/rendering/StudioRenderer.ts
git commit -m "Render the shared warp pass and Warp effect"
```

### Task 3: Liquid

**Files:**
- Modify: `src/rendering/warp.ts`, `src/rendering/StudioRenderer.ts`, `scripts/verify-warp.mjs`

**Interfaces:**
- Consumes: `warpFragment`, `warpedUv`, `warpSource`.
- Produces: GLSL `vec2 liquidUv(vec2 uv)`, called from `warpedUv` after the Warp field.

- [ ] **Step 1: Add failing render checks**

- `liquid-styles`: all five styles change the render and differ from each other.
- `liquid-steps`: 16 flow steps differ from 1 step, and the mean step-to-step change between 15 and 16 is below the change between 1 and 2.
- `liquid-area`: Swirl at amount .5 keeps the mean image brightness within 3/255 of plain on a full-frame source, proving it does not pinch colour into sinks.
- `liquid-engage`, `liquid-loop`, `liquid-scale`, `liquid-edge`: same rules as the Warp checks.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/verify-warp.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline" --only=liquid`
Expected: FAIL.

- [ ] **Step 3: Implement Liquid**

Integrate `liquidSteps` midpoint steps through a looped velocity field. Each step moves `liquidAmount * .5 / steps` of frame height.

- **Swirl:** the 90-degree rotated gradient of looped fractal noise.
- **Flow:** Swirl plus a steady direction, and `liquidTrail` averages up to 8 samples along the path.
- **Ridge:** noise reshaped with `1 - abs(2n - 1)` before taking the rotated gradient.
- **Vortex:** Swirl plus an animated spiral about the frame centre.
- **Chaos:** Ridge plus Vortex, with the sampling coordinate fed back once.

`liquidTrail` weights fall off exponentially and sum to 1. `liquidChroma` follows the Warp fringe rule.

- [ ] **Step 4: Run checks**

Run: `node scripts/verify-warp.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline" --only=neutral,warp,liquid`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/warp.ts src/rendering/StudioRenderer.ts scripts/verify-warp.mjs
git commit -m "Add the Liquid warp"
```

### Task 4: Luma Warp and layer-below driving

**Files:**
- Modify: `src/rendering/warp.ts`, `src/rendering/StudioRenderer.ts`, `scripts/verify-warp.mjs`

**Interfaces:**
- Consumes: `below: THREE.Texture` passed to `warpSource`.
- Produces: GLSL `vec2 lumaUv(vec2 uv)`; uniform `uBelow`; pure `lumaDriver(value: number, threshold: number): number` exported from `warp.ts`.

- [ ] **Step 1: Write failing tests and checks**

Add to `tests/warp.test.ts`:

```ts
test('the luma driver rescales above its threshold', () => {
  assert.equal(lumaDriver(.5, 0), .5);
  assert.equal(lumaDriver(.2, .4), 0);
  assert.equal(lumaDriver(.7, .4), .5);
  assert.equal(lumaDriver(1, 1), 0);
});
```

Add render checks:

- `luma-modes`: Push, Edges and Contours each change the render and differ.
- `luma-channels`: on a colour-bar source, each channel gives a different result.
- `luma-below`: a top layer driven by a bright shape on the layer below bends only where the shape is, and changing the below layer changes the top layer.
- `luma-bottom`: `Layer below` on the bottom layer equals the plain layer, mean under 1/255.
- `luma-order`: rendering two layers after a seek is byte-identical to rendering them in sequence, proving the top layer reads the current frame's below layer.
- `luma-engage`, `luma-loop`, `luma-scale`, `luma-edge`: same rules as the Warp checks.

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/warp.test.ts`
Expected: FAIL, `lumaDriver` is not exported.

- [ ] **Step 3: Implement Luma Warp**

The driver reads `lumaWarpChannel` from the source or the composite below, in perceptual tone. Blur the driver with a small tap kernel whose radius is `lumaWarpSoft * .03` of frame height.

- **Push** moves along `lumaWarpAngle`.
- **Edges** moves along the driver's slope.
- **Contours** moves at 90 degrees to that slope.
- Amount 1 is `.5` of frame height. An uncovered below pixel contributes a driver of 0.

- [ ] **Step 4: Run checks**

Run: `npx tsx --test tests/warp.test.ts && node scripts/verify-warp.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline" --only=neutral,warp,liquid,luma`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/warp.ts src/rendering/StudioRenderer.ts scripts/verify-warp.mjs tests/warp.test.ts
git commit -m "Add Luma Warp and layer-below driving"
```

### Task 5: Polar and Mirror

**Files:**
- Modify: `src/rendering/warp.ts`, `src/rendering/StudioRenderer.ts`, `scripts/verify-warp.mjs`

**Interfaces:**
- Consumes: `foldAngle`, `loopOffset`, `warpedUv`.
- Produces: GLSL `vec2 polarUv(vec2 uv)` and `vec2 mirrorUv(vec2 uv)`. Order inside `warpedUv` is Mirror, Polar, Warp, Liquid, Luma.

- [ ] **Step 1: Add failing render checks**

- `polar-modes`: To circle and Unroll change the render and differ. `polarAmount` .5 lies between plain and full.
- `polar-seam`: To circle has no visible vertical seam at the wrap angle, within 1.25x of neighbouring columns.
- `mirror-symmetry`: Left-right, Top-bottom and Four-way are pixel-symmetric within 2/255. Kaleidoscope with 6 segments matches itself after a 60-degree turn within 4/255 on a centred square crop.
- `mirror-turns`: `mirrorTurns: 2` closes across the loop seam.
- `polar-engage`, `mirror-engage`: a small amount converges to plain on a smooth source. Mirror's amount crossfades between plain and mirrored.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/verify-warp.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline" --only=polar,mirror`
Expected: FAIL.

- [ ] **Step 3: Implement Polar and Mirror**

Polar interpolates between plain and polar coordinates by `polarAmount`, with radius and angle in aspect-corrected frame space. `polarTwist` adds turns by radius. Mirror folds about the frame centre after rotating by `mirrorAngle + mirrorTurns * phase`; Kaleidoscope uses `foldAngle` in GLSL.

- [ ] **Step 4: Run checks**

Run: `node scripts/verify-warp.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/warp.ts src/rendering/StudioRenderer.ts scripts/verify-warp.mjs
git commit -m "Add Polar and Mirror"
```

### Task 6: Controls, thumbnails and a picker that stays short

**Files:**
- Modify: `src/ui/FinishControls.tsx`, `src/ui/finish-rack.ts`, `src/ui/finish-thumbs.ts`, `src/ui/styles.css`, `scripts/make-finish-thumbs.mjs`, `scripts/verify-workspace-ui.mjs`, `tests/finish-rack.test.ts`
- Create: `src/ui/WarpSections.tsx`, `src/ui/assets/finish/{warp,liquid,lumaWarp,polar,mirror}.jpg`

**Interfaces:**
- Consumes: Task 1 lists and option arrays.
- Produces: `WarpSection`, `LiquidSection`, `LumaWarpSection`, `PolarSection`, `MirrorSection`, with `FinishProps`-compatible props; pure `warpControlVisible(layer, key): boolean` in `warp.ts`; `pickerEffects(effects: readonly FinishEffect[], group: FinishGroup | 'All', query: string): FinishEffect[]` in `finish-rack.ts`.

Visibility rules:

- Every effect shows only its amount until that amount is above 0 or animated.
- Warp: `bendDetail` for Noise. `bendPoints` and `bendFalloff` for Ripple and Magnetic. `bendAngle` for Waves.
- Liquid: `liquidTrail` for Flow.
- Luma Warp: `lumaWarpAngle` for Push.
- Mirror: `mirrorSegments` for Kaleidoscope.

- [ ] **Step 1: Write the failing tests**

```ts
test('the picker filters by group and search together', () => {
  assert.equal(pickerEffects(FINISH_EFFECTS, 'All', '').length, FINISH_EFFECTS.length);
  assert.deepEqual(pickerEffects(FINISH_EFFECTS, 'Warp', '').map(item => item.id), ['warp', 'liquid', 'lumaWarp', 'polar', 'mirror']);
  assert.deepEqual(pickerEffects(FINISH_EFFECTS, 'Warp', 'circle').map(item => item.id), ['polar']);
  assert.deepEqual(pickerEffects(FINISH_EFFECTS, 'Time', 'circle'), []);
});
test('warp controls appear only for the type that uses them', () => {
  const base = createLayer('surface');
  const on = (params: Record<string, number>) => ({ ...base, params: { ...base.params, bendAmount: .2, ...params } });
  assert.equal(warpControlVisible(base, 'bendAmount'), true);
  assert.equal(warpControlVisible(base, 'bendField'), false);
  assert.equal(warpControlVisible(on({ bendField: 1 }), 'bendDetail'), true);
  assert.equal(warpControlVisible(on({ bendField: 0 }), 'bendDetail'), false);
  assert.equal(warpControlVisible(on({ bendField: 3 }), 'bendPoints'), true);
  assert.equal(warpControlVisible(on({ bendField: 0 }), 'bendAngle'), true);
});
```

Extend the workspace check: on a Surface layer, each picker group fits one screen at the default window; the Warp filter shows five cards; adding each warp opens its controls, and each fits one screen.

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/finish-rack.test.ts tests/warp.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add a row of group filter buttons under the picker's search, `All` first, with one button per group that has an effect on this layer. Filter choice resets to `All` when the picker closes. Add warp recipes to `make-finish-thumbs.mjs` and render five new thumbnails. Use `ChoiceParameter` for every stepped choice. When Luma Warp is `Layer below` on the bottom layer, show: "There is no layer below this one, so nothing moves."

- [ ] **Step 4: Run all checks**

Run: `npx tsc --noEmit && npm test && npm run test:workspace && npm run test:map`
Expected: all pass. Rerun the workspace check up to twice for the known "Focus preview" timeout, and record each result.

- [ ] **Step 5: Commit**

```bash
git add src/ui/FinishControls.tsx src/ui/WarpSections.tsx src/ui/finish-rack.ts src/ui/finish-thumbs.ts src/ui/styles.css src/ui/assets/finish/warp.jpg src/ui/assets/finish/liquid.jpg src/ui/assets/finish/lumaWarp.jpg src/ui/assets/finish/polar.jpg src/ui/assets/finish/mirror.jpg src/rendering/warp.ts scripts/make-finish-thumbs.mjs scripts/verify-workspace-ui.mjs tests/finish-rack.test.ts tests/warp.test.ts
git commit -m "Add warp controls and picker group filters"
```

### Task 7: Whole-branch proof

**Files:**
- Modify: `scripts/verify-warp.mjs`, `README.md`
- Create: `docs/warp-proof.md`

**Interfaces:**
- Consumes: all five effects.

- [ ] **Step 1: Add final checks**

- `all-presets-neutral`: every preset equals baseline byte for byte, and each compared render is non-blank.
- `old-file`: a project saved by the baseline build opens and renders byte-identically.
- `stack`: Mirror, Polar, Warp, Liquid and Luma Warp together with Feedback, Time, Split, Gradient, Glow and Print render non-blank and repeat byte-identically after a seek.
- `sheet`: each warp type on Surface, Fractal, Liquid and Image layers at three phases, written to `work/warp-proof/`.
- `preview-cost`: mean preview frame time at 1280x720 for each warp type, against the plain layer. Report only.

- [ ] **Step 2: Run everything**

Run: `node scripts/verify-warp.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline"`
Expected: every check PASS.

Run: `npx tsc --noEmit && npm test && npm run test:workspace && npm run test:map && node scripts/verify-colour-time.mjs --baseline="/Users/grego/Documents/ChatGPT/three VJ - Warp Baseline"`
Expected: all pass.

- [ ] **Step 3: Review the contact sheets by eye**

Judge each warp type against rules 2, 3 and 6 in `docs/effects-improvement-plan-2026-11-12.md`. Retune its defaults for a real failure and record old and new values.

- [ ] **Step 4: Record results**

Write check results, preview times, retunes and what was not verified to `docs/warp-proof.md`. Add a short Warp section to `README.md`.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-warp.mjs docs/warp-proof.md README.md
git commit -m "Prove the displacement engine"
```
