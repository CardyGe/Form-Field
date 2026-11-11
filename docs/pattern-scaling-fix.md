# Pattern scaling correction

Follow-up — 9 November: this earlier correction removed blank borders, but its repeated source was not intrinsically seamless. [The join correction](smart-repeat-fix.md) now connects geometry across repeat boundaries and extends view-aware scaling to every instrument. The original implementation and evidence below are retained as a baseline.

Pattern size, stretch, position, angle and Graphic layer Finish transforms now change the pattern view without shrinking a finite source rectangle into the frame. The corrected application is installed at the existing `work/release/mac-arm64/Form & Field.app` path and running as **0.8.0**. Its saved project was flushed through normal native close and retained unchanged on reopening.

## Rendering changes

Pillars, tiles and paths sample a complete repeating pattern cell across the viewport. Wrapping happens after texture derivatives are computed, and a dedicated linear half-float mipmapped render target filters minified detail. This keeps small/rotated/stretched patterns clean without allocating more geometry for every repeated cell.

Circle blooms and spirals extend their outer geometry as the view zooms out or moves. They preserve a single centre and existing inner shapes instead of repeating the image as rectangular tiles. Generation is deterministic and bounded, including extreme view transforms. The radial view transform is applied once during geometry rendering; the compositor samples its full-frame source.

Shared masks still use layer coordinates, so explicit masks and opacity remain effective. Background opacity and intentional gaps retain real alpha. Other source kinds retain their normal sampling; the repeating sampler and temporary render target cannot leak into subsequent layers. The extra target is released when no graphic instrument remains visible and on disposal.

No project parameters or schema fields changed. Saved presets and Motion routes continue to work. Preview, native PNG stills and movie/sequence export use this same rendering path.

## Validation

- **65 unit/native tests passed**, including a new radial extent/inner-geometry regression test.
- **22 full editor checks passed**, including persistence, masks, animation, recovery and native movies.
- All **26 Graphic Patterns** looks passed GPU regression checks.
- **30 dedicated pattern-fill checks passed**, covering repeating grid coverage, radial fields, small size, stretch, offsets, angle, layer transforms, animation, masks, sampler isolation and target disposal.
- Portrait, landscape, square and 4K output passed.
- Super 8 and Oil GPU/export regression checks passed.
- Graphics editor controls and native save/open passed.
- The packaged application passed the existing Surface/Sculpture/Fractal/Oil/Image native smoke checks.
- A packaged UI regression changed Pattern size to **0.25**, Pattern stretch to **0.4**, angle/position and layer Size to **0.3**, then exported a real native transparent PNG. Its alpha minimum was **244/255** and its mean edge alpha was **250.98/255**, confirming coverage across every canvas edge. The old finite-patch behavior would produce zero-alpha borders here.
- TypeScript, production build and Apple Silicon packaging passed.

The running app, current build and source are aligned: **12 runtime files compared, zero mismatches**. Current packaged archive SHA-256: `e647d66ebece817b45fc86c0f2928c81d71678c1b8561775bcd31b73c444b15b`. The previous app bundle is retained under `work/pattern-fill/previous/`.

## Modified files

- `src/rendering/GraphicRenderer.ts`: separate complete grid cells from extended radial geometry and apply radial view/layer transforms.
- `src/rendering/graphic-layout.ts`: calculate visible radial extent, add outer geometry and bound sampling work.
- `src/rendering/StudioRenderer.ts`: manage the repeating render target and select full-frame versus repeating pattern sampling.
- `src/rendering/shaders.ts`: filtered repeating pattern view and full-frame radial sampling, while retaining mask coordinates.
- `tests/graphics.test.ts`: verify radial size adds coverage while preserving inner shapes and bounded generation.
- `scripts/verify-graphics.mjs`: test actual pattern alpha instead of relying on the unwanted empty rectangle.
- `scripts/verify-pattern-fill.mjs` (new): GPU coverage/filtering/resource and 4K regressions.
- `scripts/verify-pattern-fill-ui.mjs` (new): real packaged controls and native PNG edge-coverage verification.
- `README.md`: document full-frame pattern scaling and its regression command.
- `docs/pattern-scaling-fix.md` (new): this report.

Evidence and captures are under `work/pattern-fill/`, including `final.json`, `report.json`, `packaged-fill.json`, `packaged-pattern-fill.png`, `pattern-fill-4k.png`, command logs and `activation.json`.
