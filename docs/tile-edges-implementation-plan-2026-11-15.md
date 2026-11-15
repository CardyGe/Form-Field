# Tile Edges (Core + Chromatic Field Pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, off-by-default **Tile edges** project setting. When it's on, the exported frame wraps left↔right and top↔bottom. This plan proves it on Chromatic Field.

**Architecture:** The setting is a project field (`tileEdges`). Pure TypeScript rules in `src/core/tile-edges.ts` decide whether a project can tile and compute each layer's pattern period. The renderer passes that period to the Chromatic Field shader as `uTile`, and the shader runs a separate tile branch: whole-wave frequency snapping plus periodic noise. When `uTile` is zero, the original code runs untouched. Glow and outline sampling wrap through `RepeatWrapping` on the layer source and glow targets. The export adds an advisory edge check next to the loop seam check.

**Tech Stack:** TypeScript, three.js 0.187 GLSL ShaderMaterial, React 19, Electron 45, node:test via `tsx --test`, Playwright Electron verification scripts.

**Spec:** `docs/tile-edges-design-2026-11-15.md` (rollout step 1 only; each further instrument gets its own plan)

## Global Constraints

- `tileEdges` absent or `false` renders exactly as today. Every tile code path is gated on it, and the shader keeps the original lines in the off branch, unedited.
- Older project files load unchanged. There is no schema version bump. `tileEdges` is optional and boolean.
- Checkbox label: **Tile edges**. Help text, verbatim: "The exported clip repeats seamlessly side by side and top to bottom, for mapping copies onto neighbouring surfaces."
- The edge check is advisory. Like the loop seam check, it never fails delivery.
- Pilot tileable set: `surface` (Chromatic Field) style Bands (0) with all three variants, and style Drips (2) with variants Beads (1) and Strands (2). Everything else is a blocker.

## Deviations from the spec (decided while planning; confirm when reviewing)

1. **Each spatial term snaps instead of the Scale value.** Chromatic Field mixes many unrelated frequencies (1.35, 0.85, 2.2, 0.47 × density…), and no single Scale fits them all. Each frequency instead snaps to whole waves across the frame, so the Scale slider stays exactly where the user put it.
2. **Print screen is a blocker in the pilot.** Its four screens sit at 0–90° plus the user's angle, and a rotated grid only repeats at special angles. It gets its own follow-up.
3. **Chromatic Field Contours, Fusion and Drips Melt are blockers.** They're centred (rings, portals), or the drip tips don't repeat vertically.

## Review Focus

1. **A 90° Direction with a portrait canvas.** The x and y periods must swap. Pinned in Task 2 (`tilePeriod swaps axes at 90°`).
2. **Very small Scale** (period under one noise cell). Snapping must never produce zero waves or NaN. Pinned in Task 2 (`tileWave never returns zero waves`) and Task 6 (render at Scale 0.5).
3. **Turning on a blocker while Tile edges is on** (for example adding Feedback echo). Tile edges must switch off and notify with the blocker's message. Pinned in Task 5 (`reconcileTile turns tiling off and names the blocker`).
4. **Supersampled and non-16:9 exports** (1080×1080, 2160×3840 at supersample 2) must still tile. Pinned in Task 6's render matrix.
5. **Off must be unchanged after a project round-trip.** `validateProject` must not add `tileEdges: false` to projects that lacked it. Pinned in Task 1.

---

### Task 1: The `tileEdges` project field

**Files:**
- Modify: `src/shared/types.ts` (Project interface, after `highlights`)
- Modify: `src/core/project.ts:846` (root `keys([...])` list, plus the boolean check)
- Modify: `electron/export-manager.cjs:54` (validateProject)
- Test: `tests/tile-edges.test.ts` (new)

**Interfaces:**
- Produces: `Project.tileEdges?: boolean` (absent means off)

- [ ] **Step 1: Write the failing tests** in `tests/tile-edges.test.ts`

```ts
test('tileEdges is optional and round-trips', () => {
  const p = createProject();
  assert.equal('tileEdges' in validateProject(structuredClone(p)), false);
  assert.equal(validateProject({ ...structuredClone(p), tileEdges: true }).tileEdges, true);
  assert.throws(() => validateProject({ ...structuredClone(p), tileEdges: 'yes' }));
});
```

- [ ] **Step 2: Run** `npx tsx --test tests/tile-edges.test.ts` and expect a FAIL (unknown key `tileEdges`).
- [ ] **Step 3: Implement.** Add `'tileEdges'` to the allowed root keys. When it's present and not a boolean, fail with `fail('tileEdges', 'must be true or false.')`. Copy the field only when it's present. In `export-manager.cjs` `validateProject`, throw `'Invalid tile edges setting.'` when it's present and not boolean.
- [ ] **Step 4: Run** `npm test` and expect a PASS.
- [ ] **Step 5: Commit** `git commit -m "Tile edges: optional project field"`

### Task 2: Tile rules and period maths

**Files:**
- Create: `src/core/tile-edges.ts`
- Test: `tests/tile-edges.test.ts`

**Interfaces:**
- Consumes: `sourceViewMatrix` from `src/rendering/source-view.ts`, plus `feedbackActive`, `slitActive` and `printActive`
- Produces:
  - `layerTileBlocker(layer: Layer): string | null`
  - `tileBlockers(project: Project): string[]` (visible layers only, in layer order)
  - `snapQuarterTurn(angle: number): number` (nearest multiple of π/2)
  - `tilePeriod(layer: Layer, aspect: number): { x: number; y: number }`: the frame's size in Chromatic Field pattern space (`p` in `surface.ts` main), after both rotations are snapped
  - `tileWave(k: number, L: number): number`: for `sin(k·x)`. Returns `k` when `L <= 0`, otherwise `TAU·n/L` with `n = max(1, round(|k|·L/TAU))` and k's sign
  - `tileRate(k: number, L: number): number`: for linear terms that feed a period-1 function (`paint`, `fract`, `floor`). Returns `k` when `L <= 0`, otherwise `round(k·L)/L` (it may be 0)
  - `tileCells(f: number, L: number): number`: the noise lattice period. `max(1, round(f·L))`

- [ ] **Step 1: Write the failing tests.**

```ts
test('tilePeriod at defaults is aspect × scale by scale', () => {
  const l = createLayer('surface'); l.params.scale = 4;
  const t = tilePeriod(l, 16 / 9);
  assert.ok(Math.abs(t.x - 64 / 9) < 1e-9 && Math.abs(t.y - 4) < 1e-9);
});
test('tilePeriod swaps axes at 90°', () => {
  const l = createLayer('surface'); l.params.scale = 4; l.params.rotation = Math.PI / 2 - .2; // snaps to 90°
  const t = tilePeriod(l, 9 / 16);
  assert.ok(Math.abs(t.x - 4) < 1e-9 && Math.abs(t.y - 4 * 9 / 16) < 1e-9);
});
test('tilePeriod follows layer zoom and stretch', () => {
  const l = createLayer('surface'); l.params.scale = 4; l.params.stretch = 4; l.transform.scale = 2;
  const t = tilePeriod(l, 1);
  assert.ok(Math.abs(t.x - 4) < 1e-9 && Math.abs(t.y - 1) < 1e-9); // ×2 and ÷2 from stretch, ÷2 from zoom
});
test('tileWave never returns zero waves', () => {
  assert.equal(tileWave(1.35, 0), 1.35);
  assert.ok(Math.abs(tileWave(.01, 3) - TAU / 3) < 1e-12);
  const k = tileWave(1.35, 64 / 9); assert.ok(Number.isInteger(Math.round(k * 64 / 9 / TAU)) && Math.abs(k * 64 / 9 / TAU - Math.round(k * 64 / 9 / TAU)) < 1e-9);
});
test('tileRate rounds to whole cycles and may reach zero', () => {
  assert.equal(tileRate(.035, 4), 0);
  assert.equal(tileRate(.47, 4), .5);
});
test('blockers name the layer and the reason', () => {
  const p = createProject(); const l = createLayer('surface'); l.name = 'Couch'; p.layers = [l];
  assert.deepEqual(tileBlockers(p), []);
  l.params.style = 1; assert.deepEqual(tileBlockers(p), ["Couch: the Contours style can't tile."]);
  l.params.style = 2; l.params.variant = 0; assert.deepEqual(tileBlockers(p), ["Couch: the Melt style can't tile."]);
  l.params.variant = 1; l.mask.kind = 'circle'; assert.deepEqual(tileBlockers(p), ['Couch has a mask.']);
  l.mask.kind = 'none'; l.params.delaySpread = .2; assert.deepEqual(tileBlockers(p), ["Couch: Delay spread and Pause can't tile."]);
  l.params.delaySpread = 0; l.params.echo = 1; assert.deepEqual(tileBlockers(p), ["Couch: Feedback can't tile."]);
  const g = createLayer('glitchtunnel'); g.name = 'Tunnel'; p.layers = [g];
  assert.deepEqual(tileBlockers(p), ["Tunnel: this instrument can't tile yet."]);
  g.visible = false; assert.deepEqual(tileBlockers(p), []);
});
```

- [ ] **Step 2: Run** `npx tsx --test tests/tile-edges.test.ts` and expect a FAIL (module missing).
- [ ] **Step 3: Implement `src/core/tile-edges.ts`.** Each layer reports only its first blocker, checked in this order, with this exact copy:
  1. Kind other than `surface`: `"<name>: this instrument can't tile yet."`
  2. Style 1: `"<name>: the Contours style can't tile."` Style 3: `"…the Fusion style…"`. Style 2 with variant 0: `"…the Melt style…"`.
  3. `mask.kind !== 'none'`: `"<name> has a mask."`
  4. `layer.surface` set: `"<name> has a surface shape."`
  5. `delaySpread > 0 || pause > 0`: `"<name>: Delay spread and Pause can't tile."`
  6. Any modulation on `scale`, `rotation` or `stretch`: `"<name>: animated Scale, Direction or Stretch can't tile."`
  7. `feedbackActive`: `"<name>: Feedback can't tile."` `slitActive`: `"<name>: Time displacement can't tile."` `printActive`: `"<name>: Print screen can't tile."`

  `tilePeriod` maps the two frame axes through `sourceViewMatrix` (with `snapQuarterTurn(transform.rotation)`), then `(·)·(aspect, 1)`, then `R(snapQuarterTurn(params.rotation))·scale`, then `·(√stretch, 1/√stretch)`. Use the same clamps as the shader: `max(scale, .1)` and `max(stretch, .25)`. It returns the absolute x and y extents.
- [ ] **Step 4: Run** `npm test` and expect a PASS.
- [ ] **Step 5: Commit** `git commit -m "Tile edges: support rules and period maths"`

### Task 3: Periodic GLSL for Chromatic Field

**Files:**
- Create: `src/rendering/tile-glsl.ts` (exports `tileGLSL`)
- Modify: `src/rendering/surface.ts` (include `tileGLSL`; add `uniform vec2 uTile;` and the tile branches)

**Interfaces:**
- Consumes: the maths of `tileWave`, `tileRate` and `tileCells` from Task 2, mirrored line for line in GLSL as `tWave(float k, float L)`, `tRate(float k, float L)` and `tCells(float f, float L)`
- Produces: `uTile` (vec2, the p-space period; `(0,0)` means off)

- [ ] **Step 1: Add `tileGLSL`** with `tWave`, `tRate`, `tCells` and `hashT(vec3 i, vec2 n)`, which applies `mod(i.xy, n)` when `n.x > 0` and then calls the existing `hash`. Add `noiseT(vec3 p, vec2 n)`: the same quintic interpolation as `noise`, but hashing through `hashT`. Add `fieldT(vec2 x, vec2 P)`. It's the same three octaves as `field` with the same weights, orbit and z offsets. For each octave with multiplier `m ∈ {1, 2.03, 4.07}` and each axis where `P > 0`, the period is `n = tCells(m, P)` and the input is scaled by `n/P` instead of `m`. An axis with `P = 0` keeps `m` and passes `n = 0` (not periodic).
- [ ] **Step 2: Add the tile branches.** Wrap each spatial function as `if (uTile.x > 0.) { tile version } else { original lines, unedited }`. Everything that depends on position follows three rules: a term inside `sin`/`cos` goes through `tWave`; a linear term that reaches `paint`/`fract`/`floor` goes through `tRate` *on its total coefficient*; and a noise call becomes `fieldT` with the input's period (`.65·uTile`, `.8·uTile`, or `vec2(.4·uTile.y, 0)` for the drip bend). Terms to convert:
  - **main:** flow `field(p*.65)` (both calls); curl `sin(p.y*1.6)` and `sin(p.x*1.3)`; warp `field(q*.8)`
  - **bandCoordinate (Flow):** `sin(p.x*1.35)`; spatial rate `.47·uDensity` along y
  - **Braids:** carrier rate `.54·uDensity` along y; `angle` coefficient `(1.05+.2·uDensity)` through `tWave`. Rebuild the colour coordinates without `a*.37`, as `tRate(.54·uDensity·.37, Ly)·(p.y+warp·.45) − .37·wave + tRate(.035, Lx)·p.x`, and the same for b with `+wave` and its `+.5` offset times `.37`.
  - **Ribbons:** `sin(p.x*.85)`; `sin(p.x*2.2 + p.y*.65)` with each coefficient through `tWave` on its own axis; coordinate rate `.64·uDensity` along y
  - **Drips (Beads, Strands):** column density `tRate(2.15·uDensity, Lx)` with a minimum of `1/Lx`. Column count `N = round(density·Lx)`. Use `mod(column, N)` for the seed hash and for `paint(column*.117…)`. Strands `q.x += .24 sin(q.y*1.6) + .11 sin(q.y*3.1)` through `tWave`. Beads `fract(q.y*density*.7…)` with rate `tRate(2.15·uDensity·.7, Ly)`. Width sines `sin(q.y*2.)`, `sin(q.y*.7)` and `sin(q.y*1.9)` through `tWave`. The bend uses `fieldT(vec2(p.y*.4, 3.7), vec2(.4·Ly, 0))`.
- [ ] **Step 3: Check that it compiles and the build passes.** Run `npm run build` and expect no TypeScript or esbuild errors. (Shader compilation is proven in Task 6.)
- [ ] **Step 4: Commit** `git commit -m "Tile edges: periodic Chromatic Field branch"`

### Task 4: Renderer wiring

**Files:**
- Modify: `src/rendering/StudioRenderer.ts`, in three places: the surface material uniforms (add `uTile: { value: new THREE.Vector2() }`), the surface draw branch around line 640, and the source/glow target creation (`this.source` and the `glow` bright target and pyramid levels)
- Modify: `src/rendering/bloom.ts` (`BloomPyramid` takes a `wrap: boolean` that applies to its level targets)

**Interfaces:**
- Consumes: `tileBlockers`, `tilePeriod` and `snapQuarterTurn` (Task 2); `uTile` (Task 3)
- Produces: `StudioRenderer` honours `project.tileEdges` in `render`, `exportPNG` and `exportEXR`

- [ ] **Step 1: Implement.** At the start of each frame, set `this.tiling = project.tileEdges === true && tileBlockers(project).length === 0`. When tiling:
  - The surface branch sets `uTile` to `tilePeriod(layer, aspect)`, `uRotation` to `snapQuarterTurn(params.rotation)`, and builds `uView` from the transform with `snapQuarterTurn(transform.rotation)`.
  - Set `wrapS`/`wrapT` to `RepeatWrapping` on `this.source`, the glow bright target and the bloom levels.

  Otherwise, set `uTile` to `(0, 0)` and `ClampToEdgeWrapping` (today's behaviour). Only flag `texture.needsUpdate` when the wrap actually changes.
- [ ] **Step 2: Run** `npm test && npm run build` and expect a PASS.
- [ ] **Step 3: Commit** `git commit -m "Tile edges: renderer wiring and wrapped glow and outlines"`

### Task 5: Output checkbox, conflicts and tiled preview

**Files:**
- Modify: `src/ui/App.tsx:625` (Output section)
- Modify: `src/core/tile-edges.ts` (add `reconcileTile`)
- Modify: `src/ui/Preview.tsx` (tiled view)
- Modify: `src/ui/styles.css`
- Test: `tests/tile-edges.test.ts`

**Interfaces:**
- Produces: `reconcileTile(project: Project): { project: Project; message: string | null }`. When `tileEdges` is on and there are blockers, it returns the project with `tileEdges: false` and `message = "Tile edges turned off. " + blockers[0]`. Otherwise it returns the same object and `null`.

- [ ] **Step 1: Write the failing test.**

```ts
test('reconcileTile turns tiling off and names the blocker', () => {
  const p = createProject(); const l = createLayer('surface'); l.name = 'Seat'; p.layers = [l]; p.tileEdges = true;
  assert.deepEqual(reconcileTile(p), { project: p, message: null });
  l.params.echo = 1;
  const r = reconcileTile(p);
  assert.equal(r.project.tileEdges, false);
  assert.equal(r.message, "Tile edges turned off. Seat: Feedback can't tile.");
});
```

- [ ] **Step 2: Run** `npx tsx --test tests/tile-edges.test.ts` and expect a FAIL.
- [ ] **Step 3: Implement `reconcileTile`.** Call it inside App's `edit` path, so every project change passes through it, and `notify(message)` when it's non-null.
- [ ] **Step 4: Add the checkbox and blocker lines.** In the Output section, add a `checkbox-row` labelled **Tile edges** (`aria-label="Tile edges"`) with the help text from Global Constraints. It's disabled while `tileBlockers(project)` is non-empty, and then each blocker shows below it as a `muted-text` line.
- [ ] **Step 5: Add the tiled preview.** When `project.tileEdges` is on, a **Tiled view** toggle appears under the preview (`aria-label="Tiled view"`). It's local React state, never saved. When it's on, `Preview` draws the WebGL canvas 2×2 into an overlay 2-D canvas after each `engine.render` at the same CSS size, each copy at half size. The WebGL canvas is hidden underneath.
- [ ] **Step 6: Run** `npm test && npm run test:ui` and expect a PASS. Existing UI checks must be unaffected.
- [ ] **Step 7: Commit** `git commit -m "Tile edges: Output setting, conflicts and tiled preview"`

### Task 6: Edge check and real-render verification

**Files:**
- Modify: `electron/seam-check.cjs` (add `measureEdges`, `describeEdges` and `checkEdges`)
- Modify: `electron/export-manager.cjs:507` (after `checkSeam`, set `record.job.edges` only when `request.project.tileEdges === true`)
- Modify: `src/ui/App.tsx:512-513` (completion notice)
- Test: `electron/seam-check.test.cjs`
- Create: `scripts/verify-tile-edges.mjs` (modelled on `scripts/verify-glow.mjs`, including its `--baseline=` option)

**Interfaces:**
- Produces:
  - `measureEdges(frame: Float32Array, width: number, height: number, channels = 3)`, returning `{ status: 'clean'|'seam', horizontal: {seam, typical, ratio, visible}, vertical: {...} }`. Here `seam` is the mean |last column − first column|, and `typical` is the largest mean |column k − column k+1| over the 6 columns next to each edge. Rows work the same way. The ratio uses the loop check's floor rule with `FLOOR` and `JUMP_LIMIT`.
  - `describeEdges(result)` returns `"Tile edges clean (left/right 0.9×, top/bottom 1.0× of a normal pixel step)."` or `"Visible tile seam: left/right 3.2× a normal pixel step."` (listing whichever edges are visible, joined with " and ").
  - `checkEdges({ run, directory, request, frameName, toLinear })` measures frames 0, ⌊n/2⌋ and n−1 through `analysisFilter` and reports the worst one.

- [ ] **Step 1: Write the failing tests.**

```js
test('a wrapping image passes the edge check', () => {
  const w = 64, h = 32, f = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) f[(y * w + x) * 3 + c] = .5 + .4 * Math.sin(2 * Math.PI * x / w) * Math.cos(2 * Math.PI * y / h);
  assert.equal(measureEdges(f, w, h).status, 'clean');
});
test('a ramp fails left/right only', () => {
  const w = 64, h = 32, f = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) f.fill((i % w) / w, i * 3, i * 3 + 3);
  const r = measureEdges(f, w, h);
  assert.equal(r.status, 'seam'); assert.equal(r.horizontal.visible, true); assert.equal(r.vertical.visible, false);
  assert.match(describeEdges(r), /^Visible tile seam: left\/right/);
});
test('a flat image is clean', () => { assert.equal(measureEdges(new Float32Array(16 * 16 * 3).fill(.3), 16, 16).status, 'clean'); });
```

- [ ] **Step 2: Run** `node --test electron/seam-check.test.cjs` and expect a FAIL.
- [ ] **Step 3: Implement.** Write the three functions and the export-manager hook (`{ ...result, summary: describeEdges(result) }`, with errors becoming `{status: 'error'}` like `checkSeam`). In App, when `result.edges?.status === 'seam'`, append `" The tile edges show a seam."` to the completion notice.
- [ ] **Step 4: Run** `npm test` and expect a PASS.
- [ ] **Step 5: Write `scripts/verify-tile-edges.mjs`.** It renders through `StudioRenderer.exportPNG` with `tileEdges: true`. Each variant must be `clean` under an in-page port of `measureEdges` (8-bit pixels / 255) at phases 0 and 2.1:
  - Bands Flow, Braids and Ribbons, and Drips Beads and Strands, all at their default look
  - Flow at Scale 0.5, at Direction 90°, and with Glow (`glowMix .8`) plus outlines (`toonMix 1, toonOutline 2`)
  - All of these at 960×540, at 1080×1080, and at 1080×1920 with supersample 2

  As a guard, Flow with `tileEdges: false` must be reported as `seam`. With `--baseline=<checkout>`, every pilot look with `tileEdges` absent must match the baseline byte for byte. It writes PNGs to `work/tile-edges/`, plus a 2×2 montage of each tiled render for visual review.
- [ ] **Step 6: Run** the script twice. First `node scripts/verify-tile-edges.mjs`, which must exit 0 with every pilot render clean. Then `git worktree add ../tile-baseline af0556f && node scripts/verify-tile-edges.mjs --baseline=../tile-baseline`, which must exit 0 with off byte-identical.
- [ ] **Step 7: Review the montages by eye.** No join lines should be visible, and each tiled look should read the same as its untiled version.
- [ ] **Step 8: Commit** `git commit -m "Tile edges: edge seam check and render verification"`
