# Glow Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-layer Glow finish that blooms a layer's bright areas, with four controls and four library looks.

**Architecture:** Four new finish parameters join `FINISH_PARAMETERS`, so uniforms, saving and project upgrade come for free. The Oscilloscope's blur pyramid moves into a shared `src/rendering/bloom.ts`; `StudioRenderer` runs a bright pass and that pyramid on a glowing layer's final source texture, and `compositeFragment` adds the weighted levels as light.

**Tech Stack:** TypeScript, three.js `ShaderMaterial` (GLSL ES 1), React, `node:test` through `tsx`.

**Spec:** [glow-finish-plan-2026-11-15.md](glow-finish-plan-2026-11-15.md)

## Global Constraints

- Parameter keys are `glowMix`, `glowThreshold`, `glowSize`, `glowTint`. Never the bare key `glow` (Fractal owns it) and never touch the existing `uGlow` halo.
- `glowMix` defaults to 0 and at 0 no glow pass runs and the composite output is bit-identical to today.
- Glow is stateless: it must never be written into Feedback history targets.
- Blur level heights are fixed in lines (`[540, 270, 135, 68, 34]`), so glow width is a share of frame height at every render size.
- Unsupported kinds: `graphic` and `scope`. Every other kind, including Evolving Ink, is supported.
- Labels use British spelling ("Glow colour").
- Run `npm test` and `npm run build` before each commit. Commit only the files a task names.
- **Precondition:** the branch has uncommitted Oscilloscope work in `project.ts`, `ScopeRenderer.ts`, `scope-curve.ts`, `App.tsx`, `README.md` and `tests/scope.test.ts`. It must be committed (or the owner must say otherwise) before Task 1, so glow commits stay separate.

## Review Focus

1. **Glow amount is 0 but animated.** The glow must still render on frames where the modulated value is above 0. Pinned in Task 1 (`glowActive` with a modulation).
2. **Old project files with no glow keys.** They load with glow off and unchanged output. Pinned in Task 1 (migration test).
3. **Tiny renders (thumbnails, preview under 34 lines).** No zero-size targets, and blur still covers the same share of the frame. Pinned in Task 2 (`bloomLevelSize` at height 20).
4. **Two glowing layers in one project.** They share pyramid targets; the second must not show the first's glow. Manual check in Task 3.
5. **Transparent export.** The glow outside the layer's shape carries alpha and is not clipped or black-fringed. Manual check in Task 3.

---

### Task 1: Glow parameters, support rules and weights

**Files:**
- Modify: `src/core/finishing.ts`
- Create: `src/rendering/bloom.ts`
- Modify: `src/core/project.ts` (`visibleParameterDefinitions`, about line 323)
- Test: `tests/glow.test.ts`

**Interfaces:**
- Produces, in `finishing.ts`: `GLOW_PARAMETERS: ParameterDefinition[]`, `GLOW_KEYS: string[]`; `GLOW_PARAMETERS` is spread into `FINISH_PARAMETERS` after `SLIT_PARAMETERS`.
- Produces, in `bloom.ts`:
  - `BLOOM_HEIGHTS = [540, 270, 135, 68, 34]`
  - `bloomWeights(amount: number, size: number): number[]`
  - `supportsGlow(layer: Pick<Layer, 'kind'>): boolean`
  - `glowActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean`

- [ ] **Step 1: Write the failing tests** in `tests/glow.test.ts` (imports as in `tests/slitscan.test.ts`)

```ts
test('glow is off by default and older projects migrate without it', () => {
  const project = createProject();
  for (const layer of project.layers) {
    assert.equal(layer.params.glowMix, 0);
    assert.equal(glowActive(layer), false);
    for (const key of GLOW_KEYS) delete layer.params[key];
  }
  const migrated = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(GLOW_KEYS.map(k => migrated.layers[0].params[k]), [0, .5, .5, 0]);
});

test('glow keys never collide with the Fractal halo', () => {
  assert.deepEqual(GLOW_KEYS, ['glowMix', 'glowThreshold', 'glowSize', 'glowTint']);
});

test('glow runs when the amount is animated from zero', () => {
  const layer = createLayer('surface');
  assert.equal(glowActive({ ...layer, modulations: { glowMix: {} as never } }), true);
  assert.equal(glowActive({ ...layer, params: { ...layer.params, glowMix: .4 } }), true);
});

test('graphic patterns and the oscilloscope take no glow', () => {
  for (const kind of ['graphic', 'scope'] as const) {
    const layer = createLayer(kind);
    assert.equal(supportsGlow(layer), false);
    assert.equal(glowActive({ ...layer, params: { ...layer.params, glowMix: 1 } }), false);
    assert.equal(visibleParameterDefinitions(layer).some(d => GLOW_KEYS.includes(d.key)), false);
  }
  const ink = createLayer('livingink'); ink.params.inkMode = 2;
  assert.equal(GLOW_KEYS.every(k => visibleParameterDefinitions(ink).some(d => d.key === k)), true);
  assert.equal(GLOW_KEYS.every(k => visibleParameterDefinitions(createLayer('liquid')).some(d => d.key === k)), true);
});

test('glow size moves the weights from tight levels to wide ones', () => {
  const close = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));
  close(bloomWeights(1, 0), [.9, .50625, .225, .05625, 0]);
  close(bloomWeights(1, 1), [.225, .39375, .5625, .73125, .9]);
  close(bloomWeights(1, .5), [.5625, .45, .39375, .39375, .45]);
  close(bloomWeights(2, 0), [1.8, 1.0125, .45, .1125, 0]);
});
```

- [ ] **Step 2: Run** `npx tsx --test tests/glow.test.ts`. Expected: FAIL, `bloom` module not found.

- [ ] **Step 3: Add `GLOW_PARAMETERS`** to `finishing.ts`, with a doc comment in the style of the other families.

| key | label | min | max | step | default | section | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `glowMix` | Glow amount | 0 | 2 | .01 | 0 | Material | Soft light spilling from the bright parts of the layer. 0 is off. |
| `glowThreshold` | Glow threshold | 0 | 1 | .01 | .5 | Material | Brightness above which light glows. 0 makes the whole layer glow. |
| `glowSize` | Glow size | 0 | 1 | .01 | .5 | Material | Tight halo at 0, wide haze at 1. The width is a share of the frame, so exports match the preview. |
| `glowTint` | Glow colour | 0 | 6 | 1 | 0 | Material | 0 keeps the layer's own colour; 1–6 use the matching palette swatch. |

- [ ] **Step 4: Create `bloom.ts`** with the four exports. `bloomWeights` is the scope's law, lifted from `ScopeRenderer.ts:239-243`: for `t = i / 4`, `amount * .9 * ((1 - size) * (1 - t) ** 2 + size * (.25 + .75 * t))`. `glowActive` mirrors `feedbackActive`: supported, and `glowMix > 0` or `modulations.glowMix` set.

- [ ] **Step 5: Hide glow where unsupported.** Rename the body of `visibleParameterDefinitions` to a private function and wrap it: drop `GLOW_KEYS` when `!supportsGlow(layer)`. Add `...GLOW_KEYS` to the Evolving Ink key set (`inkMode === 2` branch).

- [ ] **Step 6: Run** `npm test && npm run build`. Expected: all pass. If an existing test counts finish parameters, update the count, not the behaviour.

- [ ] **Step 7: Commit** `finishing.ts`, `bloom.ts`, `project.ts`, `tests/glow.test.ts`: "Glow finish: parameters, support rules and level weights".

---

### Task 2: Share the blur pyramid with the Oscilloscope

**Files:**
- Modify: `src/rendering/bloom.ts`
- Modify: `src/rendering/ScopeRenderer.ts` (lines 22, 56, 102-116, 223-243, 253)
- Test: `tests/glow.test.ts`, `tests/scope.test.ts` (unchanged, must still pass)

**Interfaces:**
- Consumes: `BLOOM_HEIGHTS`, `bloomWeights` from Task 1.
- Produces, in `bloom.ts`:
  - `bloomLevelSize(index: number, width: number, height: number): { width: number; height: number; reach: number }`
  - `class BloomPyramid { render(source: THREE.Texture, width: number, height: number, draw: (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => void): THREE.Texture[]; dispose(): void }`. `render` returns the five blurred level textures, tightest first. Targets are half-float RGBA with linear filtering and clamped edges, as `lightTarget()` in `ScopeRenderer` makes them.

- [ ] **Step 1: Write the failing test**

```ts
test('blur levels keep their share of the frame on small renders', () => {
  assert.deepEqual(bloomLevelSize(0, 1920, 1080), { width: 960, height: 540, reach: 1 });
  assert.deepEqual(bloomLevelSize(4, 1920, 1080), { width: 60, height: 34, reach: 1 });
  const tiny = bloomLevelSize(0, 36, 20);
  assert.deepEqual([tiny.width, tiny.height], [36, 20]);
  assert.ok(Math.abs(tiny.reach - 20 / 540) < 1e-9);
  assert.deepEqual(bloomLevelSize(4, 2, 1), { width: 4, height: 2, reach: 2 / 34 });
});
```

- [ ] **Step 2: Run** `npx tsx --test tests/glow.test.ts`. Expected: FAIL, `bloomLevelSize` is not exported.

- [ ] **Step 3: Implement `bloomLevelSize`** from `ScopeRenderer.ts:224-228`: `h = max(2, min(BLOOM_HEIGHTS[i], height))`, `w = max(2, round(h * width / height))`, `reach = h / BLOOM_HEIGHTS[i]`.

- [ ] **Step 4: Implement `BloomPyramid`** by moving the scope's `blur` material and its per-level across/down loop into it unchanged. Make `ScopeRenderer` own a `BloomPyramid`, delete its local `BLOOM_HEIGHTS`, `levels` and `blur`, and take weights from `bloomWeights(p.bloom, p.bloomSize)`.

- [ ] **Step 5: Run** `npm test && npm run build`. Expected: all pass, including `tests/scope.test.ts`.

- [ ] **Step 6: Check the Oscilloscope by eye.** `npm run dev`, load presets Ember Ring and Cyan Tangle, and compare with the app before this task (`git stash` to flip). Expected: no visible difference in bloom.

- [ ] **Step 7: Commit** `bloom.ts`, `ScopeRenderer.ts`, `tests/glow.test.ts`: "Share the bloom pyramid between Oscilloscope and finishes".

---

### Task 3: Render the glow

**Files:**
- Modify: `src/rendering/bloom.ts` (bright-pass shader)
- Modify: `src/rendering/shaders.ts` (`compositeFragment`: uniforms near line 49, body after line 226)
- Modify: `src/rendering/StudioRenderer.ts` (composite uniforms near line 278, `renderFrame` near line 753, `dispose` near line 1095)

**Interfaces:**
- Consumes: `glowActive`, `bloomWeights`, `BloomPyramid` from Tasks 1–2. `uGlowMix`, `uGlowThreshold`, `uGlowSize`, `uGlowTint` already exist on the composite material and are already set each frame, through the `FINISH_PARAMETERS` loops at `StudioRenderer.ts:279` and `:777`.
- Produces: `glowBrightFragment: string` in `bloom.ts`; composite uniforms `uGlowLevel0`…`uGlowLevel4` (sampler2D), `uGlowWeights` (float[5]), `uGlowColour` (vec3).

- [ ] **Step 1: Write `glowBrightFragment`.** Uniforms `uSource`, `uThreshold`. Works on the premultiplied colour with no divide by alpha:

```glsl
vec4 s = texture2D(uSource, vUv);
float l = max(s.r, max(s.g, s.b));
gl_FragColor = vec4(s.rgb * smoothstep(uThreshold * .8, uThreshold * 1.2 + 1e-4, l), 1.);
```

- [ ] **Step 2: Add the renderer passes.** In `renderFrame`, once `sourceTexture` is chosen and before the composite uniforms are set: when `glowActive(original)` and the evaluated `layer.params.glowMix > 0`, draw the bright pass from `sourceTexture` into a half-resolution target (`ceil(width / 2) × ceil(height / 2)`, half-float, linear), run one renderer-wide `BloomPyramid` on it, and bind the five results to `uGlowLevel0…4`. Set `uGlowWeights` to `bloomWeights(glowMix, glowSize)` from the evaluated layer, and `uGlowColour` to `layer.palette[glowTint - 1]` when `glowTint >= 1`. Otherwise set all five weights to 0 and bind `this.fallback`. Never pass a Feedback history target as a draw destination here. Dispose the target and pyramid in `dispose`.

- [ ] **Step 3: Add the glow to `compositeFragment`**, directly after the `toon` line and before the grade:

```glsl
if (uGlowMix > 0.) {
  vec3 g = uGlowWeights[0]*glowLevel(uGlowLevel0) + /* …levels 1–4 the same way */;
  if (uGlowTint > .5) g = uGlowColour * dot(g, vec3(.2126, .7152, .0722));
  top.rgb += g;
  top.a += (1. - top.a) * clamp(max(g.r, max(g.g, g.b)), 0., 1.);
}
```

`glowLevel(sampler)` reads the level at the same coordinate `sampleSource(uv)` resolves to for an in-view source (the levels are in the same space as `uSource`), clamped to the texture edge with no repeat.

- [ ] **Step 4: Run** `npm test && npm run build`. Expected: all pass.

- [ ] **Step 5: Check in the app** (`npm run dev`), setting values on the Finish tab's raw parameters or by editing a saved project until Task 4 adds the section:
  - Liquid Light, `glowMix 0.8`: bright droplets bloom; `glowMix 0` looks exactly as before.
  - `glowThreshold 0` glows the whole layer; `0.9` glows only the hottest parts.
  - `glowSize` 0 → 1 goes from tight halo to wide haze, with no banding or square artefacts.
  - `glowTint 2` takes palette swatch 2.
  - Surface with finish Tunnel plus glow: the rings glow, the loop still closes, and the glow does not build up over time.
  - Two glowing layers with different settings: each shows only its own glow.
  - Circle mask on a glowing layer: the glow is cut by the mask.
  - Transparent PNG export over a checkerboard: soft glow edge, no black fringe.
  - Preview against a 2× supersampled export of one frame: same glow width.

- [ ] **Step 6: Commit** `bloom.ts`, `shaders.ts`, `StudioRenderer.ts`: "Glow finish: bright pass, pyramid and composite".

---

### Task 4: Inspector section, library looks and README

**Files:**
- Modify: `src/core/project.ts` (`FINISH_LOOKS`, `FINISH_LOOK_KEYS`, `finishSupported`, `applyFinish`, about lines 449-470)
- Modify: `src/ui/App.tsx` (lines 1, 506, 514, 573-576)
- Modify: `README.md`
- Test: `tests/glow.test.ts`

**Interfaces:**
- Consumes: `GLOW_KEYS`, `supportsGlow`.
- Produces: `finishSupported(layer, finishId?: string): boolean`. Without an id it behaves as today. With an id it is also false when that look sets any glow key and `!supportsGlow(layer)`. `applyFinish` checks with the id.

- [ ] **Step 1: Write the failing tests**

```ts
test('glow looks apply, replace other finishes and clear', () => {
  const layer = createLayer('liquid');
  const glowing = applyFinish(layer, 'finish-soft-glow');
  assert.deepEqual([glowing.params.glowMix, glowing.params.glowThreshold, glowing.params.glowSize], [.8, .6, .4]);
  const tunnel = applyFinish(glowing, 'finish-tunnel');
  assert.equal(tunnel.params.glowMix, 0);
  const trails = applyFinish(tunnel, 'finish-glowing-trails');
  assert.deepEqual([trails.params.echo, trails.params.echoBlend, trails.params.glowMix], [.85, 2, .9]);
  assert.equal(applyFinish(trails, 'finish-none').params.glowMix, 0);
});

test('glow looks are refused where glow is not supported, other looks are not', () => {
  const scope = createLayer('scope');
  assert.equal(finishSupported(scope, 'finish-soft-glow'), false);
  assert.equal(finishSupported(scope, 'finish-terraces'), true);
  assert.throws(() => applyFinish(scope, 'finish-dream-haze'));
});
```

- [ ] **Step 2: Run** `npx tsx --test tests/glow.test.ts`. Expected: FAIL, unknown finish.

- [ ] **Step 3: Add the looks** to `FINISH_LOOKS` and `...GLOW_KEYS` to `FINISH_LOOK_KEYS`; extend `finishSupported` and `applyFinish`.

| id | name | description | params |
| --- | --- | --- | --- |
| `finish-soft-glow` | Soft Glow | Bright areas spill a gentle halo. | `glowMix .8, glowThreshold .6, glowSize .4` |
| `finish-dream-haze` | Dream Haze | The whole layer swims in a wide, soft haze. | `glowMix 1.2, glowThreshold .15, glowSize .9` |
| `finish-hot-highlights` | Hot Highlights | Only the hottest points flare, tight and strong. | `glowMix 1.5, glowThreshold .8, glowSize .2` |
| `finish-glowing-trails` | Glowing Trails | Bloom Echo's outward trails, each one glowing. | Bloom Echo's params plus `glowMix .9, glowThreshold .5, glowSize .6` |

- [ ] **Step 4: Wire the interface in `App.tsx`.**
  - Import `GLOW_KEYS` and `supportsGlow`.
  - Exclude `GLOW_KEYS` from the Tonal finishing filter (line 573).
  - After Tonal finishing, add `{supportsGlow(selected) && <section className="control-section"><h3>Glow</h3>…}` rendering the `GLOW_KEYS` definitions with the same `Parameter` props as its neighbours. Muted text: "Bright areas spill soft light. Loops close exactly; adds a few blur passes per glowing layer."
  - Finish cards (line 506): disable and guard with `finishSupported(selected, finish.id)`.
  - Empty note (line 514): keep the existing sentence for layers that take no finishes at all.

- [ ] **Step 5: Update `README.md`**: add Glow to the list of finishes, with the four controls and the four looks, in the file's existing style.

- [ ] **Step 6: Run** `npm test && npm run build && npm run test:ui`. Expected: all pass.

- [ ] **Step 7: Check in the app.** The Glow section shows on Liquid Light and is absent on Oscilloscope and Graphic Patterns. On an Oscilloscope layer the four glow looks are disabled and Terraces still applies. Each new look applies and "No finish" clears it. Glow amount can be animated from the Motion tab.

- [ ] **Step 8: Commit** `project.ts`, `App.tsx`, `README.md`, `tests/glow.test.ts`: "Glow finish: inspector section and library looks".
