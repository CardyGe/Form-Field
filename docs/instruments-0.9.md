# Projection instruments · Form & Field 0.9.0

All ten research proposals are implemented as ordinary saved layers in the existing WebGL renderer. There is one application loop, compositor, colour pipeline and native export path. The library contains 120 looks: the previous 90 plus three looks for each new instrument. No Three.js, Electron or React dependency was changed for this release.

## What was added

| Instrument | Implementation |
| --- | --- |
| Caustic Atlas | Wave-height Hessians form curved focusing ridges; derivative-filtered edges and three optical bands add controlled spectral separation. |
| Living Ink | A seeded 384 × 384 Gray–Scott preparation pass uses periodic boundaries, four productive feed/kill families and 1,101 deterministic updates. A mipmapped chemical texture feeds live pigment, relief and periodic flow. |
| Magnetic Skin | A warped Voronoi peak field responds to a periodic attractor; derivative normals shade metallic and opal finishes. |
| Velvet Currents | Coherent analytic strand fields use integrated stripe filtering, curl, directional trails and depth shading. |
| Kinetic Relief | Projected hinged plates have bevelled height normals, opening waves, three axes and material shading. |
| Holographic Loom | Filtered warp/weft strands and low-frequency interference beats follow a folded height field; foil tint respects the authored palette. |
| Crystal Reef | A connected Voronoi vein network supports planar crystal facets and seeded cyclic growth fronts. |
| Prism Cathedral | A bounded sequence of bevelled, perspective-scaled vaults extends through a continuous mirrored source domain. |
| Resonant Sand | Mixed standing-wave modes form granular nodal lines. Coincident modal choices select a distinct companion mode so either blend endpoint remains a figure. |
| Volumetric Veils | Periodic, eroded pigment ribbons are integrated through 24/40/64 volume samples with transmission and directional edge illumination. |

All ten expose scale, direction, motion amount, integer cycles, field background, colour grading and family controls. Their source coordinates cover the actual transformed view; small patterns never become cropped frames or repeated screenshots. Optional transparent gaps, layer masks and finite source content retain their intended meaning.

The shared optical helpers are also used in existing effects. Surface gains **Optical sheen** on its material normals. Oil Slides gains **Caustic light** and **Optical sheen** on pigment and glass. Absent controls migrate to zero, and existing explicit values remain untouched.

## Playback and resource limits

Animation is evaluated from the saved seed and wrapped phase. Living Ink prepares its spatial chemistry once per seed/family/branching combination; flow and pigment are periodic animation over that prepared pattern. Branching cannot be routed to Motion. Its four-entry texture cache evicts GPU resources, and all prepared textures are released when no visible Ink layer needs them. Every new material is disposed with the shared renderer.

Magnetic Skin, Kinetic Relief and Crystal Reef use shaded height fields; Velvet Currents uses analytic strands. These are artistic approximations, not physical solvers or editable meshes. Prism Cathedral creates optical architecture without recursive scene capture and cannot refract imagery added after an RGBA export. Volumetric Veils is a sampled volume whose quality setting applies equally to preview and export.

## Verification

- `npm test`: document validation, migration, preset completeness, routing, variation locks, native requests, encoding and recovery.
- `npm run build`: TypeScript validation and production UI build.
- `npm run test:ui`: complete existing editor regression suite, native save/open, assets, undo, animation, export recovery and close/restart persistence.
- `node scripts/verify-instruments.mjs --production`: all 30 new looks; every control at its limits; control activation; loop closure; arbitrary seeking; stopped motion; transparent overlays; random variants; portrait, square and landscape coverage after transforms; Surface/Oil optical controls; bounded Ink cache and deterministic eviction; mixed four-layer compositions; 4K stills; HD/4K completed-frame timing samples.
- `node scripts/verify-instruments-ui.mjs [bundle]`: adding all ten instruments, three presets each, live controls, valid Motion routes, native saved projects, PNG stills and ProRes 4444 movies. Every movie frame is decoded; alpha, dimensions, frame counts, animation and transfer metadata are checked. Runs use isolated profiles.
- `node scripts/verify-randomizer-ui.mjs`: all 17 source types, three variation strengths, category locks, authored routes, per-layer shuffle, undo/redo and signature collection.
- `node scripts/verify-quality.mjs --references-only --production`: existing signature reference frames and six existing source families at 4K.
- `node scripts/verify-smart-repeat.mjs`: the complete 120-look library plus repeat joins, transformed fields, explicit masks and imported-image sampling.
- `node scripts/verify-pattern-fill-ui.mjs [bundle]`: packaged scaled/rotated tile output must retain alpha 255 at every pixel, including the edges.
- `PACKAGED_SMOKE_SMALL=1 node scripts/verify-packaged.mjs [bundle]`: existing packaged source controls, native stills, 4K Oil alpha and a decoded 30-frame Fractal movie.
- `node scripts/verify-alignment.mjs [bundle]`: package, lockfile, native bundle version, every packaged runtime file, embedded source map, ten new thumbnails, twenty signature assets, bundled guide and encoding tools.

The completed run passed **60 core tests, 18 native tests and 22 editor checks**. It also passed 459 new control/edge checks, 35 Surface/Oil optical checks, 130 repeat/scale checks and 24 chemical-family/branching/seed boundary cases. All ten packaged instruments produced native PNGs and six-frame ProRes 4444 movies; all sixty movie frames decoded with real animation. The existing packaged smoke movie decoded all thirty Fractal frames. All twenty existing signature references passed, and every new instrument rendered at 3840 × 2160.

The installed 0.9.0 archive matches 42 runtime files and 26 embedded source modules, with no mismatches. The latest user composition was preserved; its sole migration added an absent Surface Optical sheen value of zero. The 0.8.0 app and the composition before migration remain recoverable under `work/instruments/`.

Observed single-layer completed-frame medians ranged from 4.7–23.4 ms at HD and 5.4–77.3 ms at 4K. Volumetric Veils was the most expensive at Standard quality (23.4/77.3 ms); Draft reduces its sample count. These five-sample measurements include asynchronous readback and were taken during other verification work. They are not a sustained FPS guarantee.

Timing samples include CPU submission, completion of GPU work and asynchronous one-pixel readback. They exclude preparation and encoding and are observations on this machine during testing, not a guaranteed frame rate for arbitrary four-layer compositions. Projector brightness, physical focus, geometry and mapping still require venue testing.

Proof images and JSON reports are under `work/instruments/`. The contact sheet is `work/instruments/contact.png`. The application bundle is installed at `work/release/mac-arm64/Form & Field.app`; its preceding version is retained under `work/instruments/previous/` after activation.

## Files changed

### Core, renderer and native pipeline

- `src/core/instruments.ts` — ten instrument registries and thirty authored looks.
- `src/core/project.ts` — definitions, presets, creation, validation, neutral migration and smart variation.
- `src/shared/types.ts` — supported layer kinds and preparation-only control metadata.
- `src/rendering/InstrumentRenderer.ts` — shared source-pass integration and deterministic chemical preparation/cache.
- `src/rendering/instrument-shaders.ts` — ten source shaders.
- `src/rendering/projection-optics.ts` — shared filtering and optical functions.
- `src/rendering/StudioRenderer.ts` — preparation, source dispatch and disposal within the existing renderer.
- `src/rendering/surface.ts` — optional optical finish.
- `src/rendering/oil.ts` — optional focused light and optical finish.
- `electron/export-manager.cjs` — native persistence/export accepts the ten new source kinds.

### Interface, assets and documentation

- `src/ui/App.tsx` — instrument cards, preset filters, source controls, preparation-safe Motion options and version fallback.
- `src/ui/styles.css` — instrument section and control explanations.
- `src/ui/assets/instruments/{caustic,livingink,magnetic,currents,relief,loom,reef,prism,resonance,veils}.png` — actual renderer thumbnails.
- `package.json`, `package-lock.json` — application version 0.9.0.
- `README.md` — usage, controls, implementation limits and verification commands.
- `docs/instruments-0.9.md` — this implementation and file report.

### Verification

- `tests/instruments.test.ts` — new source contracts, invalid state, migration, routes and variation locks.
- `tests/core.test.ts`, `tests/quality.test.ts` — expanded kind/preset coverage.
- `electron/export-manager.test.cjs` — native acceptance and independent snapshots for all ten new kinds.
- `scripts/verify-instruments.mjs`, `scripts/verify-instruments-ui.mjs`, `scripts/verify-alignment.mjs` — GPU, editor/native and package proofs.
- `scripts/verify-randomizer-ui.mjs` — expanded to seventeen kinds.
- `scripts/verify-ui.mjs`, `scripts/verify-super8-ui.mjs` — updated complete library count.
