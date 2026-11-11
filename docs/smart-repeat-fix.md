# Seamless pattern repetition and effect scaling — 9 November 2026

The running Form & Field 0.8.0 app now repeats connected pattern geometry without the rectangular tile boundaries shown in the supplied screenshot. The user's red outlined Tile Ripple composition was reproduced with the same saved settings in isolated before/after packaged profiles. The working composition was retained unchanged when the updated app was installed and reopened.

## Root cause

The earlier canvas-fill correction prevented empty borders by repeating a rendered rectangle. Its tile and circuit generators still stopped at that rectangle's edges. Palette/morph phases and rounded pillar end caps could also expose the repeated frame. The prior tests checked repeated-image equality and full canvas coverage; those checks did not prove that the geometry itself joined correctly.

## Changes

- Packed tiles now pack across both edges of a toroidal occupancy grid. A wrapping tile retains one complete outline, colour and animated shape; it does not gain a false border at the source boundary.
- Circuit paths can continue across either edge instead of every wire terminating at a rectangular frame. Mirrored carpet retains its deliberate reflection symmetry.
- Pillar outer ends extend beyond the repeat cell, while matching pigment and closed wave phases make both joins continuous. Fractional wave counts blend adjacent closed frequencies. Tile palette and morph phases are periodic on both axes.
- Solid rectangular fills with zero spacing use shared hardware sample coverage. Independent half-covered SDF edges previously left a false dark grid; the verified native PNG now has alpha **255/255 at every pixel**, including edges, under small scale/stretch, rotation and layer transforms.
- Circle blooms and spirals continue extending around one centre. Radial Circuit now applies one global ring cutout, instead of repeating a grid of ring-shaped gaps. Ring animation does not rebuild path topology.
- Surface, Fractal, Oil and Super 8 generate the actual unbounded scaled/rotated view before compositing. The compositor no longer shrinks a cropped procedural render into a rectangle. Oil's material, shading and refraction use matching domain/screen transforms. Super 8's paint and optical passes use the same view and gate mapping.
- Sculpture applies the layer transform to projected geometry before clipping. Zooming out reveals geometry that lay beyond the old source frame. Homogeneous clip coordinates avoid division by zero when geometry reaches the camera plane.
- Repeated images use an independent wrapping mipmapped sampler and continue across the view. Single images retain finite contain/cover bounds. Imported images intended to tile should have matching artwork at their edges; the renderer does not alter that artwork.

Masks, opacity, blending, colour grading, palette, Motion routes, optional film framing, project schema, preset IDs and delivery formats remain available. No saved controls were added, removed or reset. All seven instruments and seventy presets are still in one app. Preview, PNG and movie/sequence exports share this renderer.

## Verification

- **69 unit/native tests passed:** 52 TypeScript/core tests and 17 native/export tests. Toroidal tile occupancy is checked exactly once per grid cell, paths remain adjacent and self-avoiding modulo their domain, real boundary crossings are exercised, and source-view transforms agree with the compositor and invert correctly.
- **22 full editor checks passed**, including persistence, undo, masks, precise controls, all libraries, animation, autosave/recovery, native close and a fully decoded transparent ProRes movie.
- **80 dedicated real-GPU checks passed:** actual wire coverage across 7 horizontal and 13 vertical crossings; 6 wrapped tile interiors without phantom outlines; 4 pillar row joins; one radial core; exact wider-domain equivalence for Surface/Fractal/Super 8; all 70 transformed presets with loop and seek equality; revealed Sculpture geometry and near-camera framing for all four forms; repeated/single image sampler isolation; transparent-alpha contracts and a 4K capture.
- All 26 Graphic looks, their controls and native movie export passed. Oil and Super 8 GPU/export regressions passed, including resumed deliveries.
- All 30 pattern-fill checks passed. The packaged zero-spacing fill test now requires full alpha at every pixel, rather than merely a high mean coverage.
- Packaged native smoke tests passed Surface, Sculpture, Fractal, Oil and Image, including 4K Oil output and a 30-frame Fractal ProRes 4444 movie. Packaged Super 8 controls, migration, persistence, animation and alpha output also passed.
- The exact saved red composition exported before and after without modifying its project data. Captures: `work/smart-repeat/before-composition.png` and `updated-composition.png`.
- TypeScript, production build and macOS arm64 packaging passed. Vite retains its existing large-bundle advisory.

## Installed application

The updated app is running at `work/release/mac-arm64/Form & Field.app`. Source/build/package alignment was checked after activation: **12 renderer/native runtime files and 21 embedded source modules matched, with zero mismatches**. Package/lockfile, packaged package and macOS bundle all remain 0.8.0. Archive SHA-256: `b1f04b0b12d7b4f5e26797bfc8584c9a142fce179da5efacadff5dcabff68f85`.

The update used normal native close to flush edits, then reopened the verified app. No user export was active. The saved composition's bytes and all settings were unchanged. The previous app is retained at `work/smart-repeat/previous/Form & Field.app`.

## Modified files

| File | Change |
| --- | --- |
| `src/rendering/source-view.ts` (new) | Shared unbounded source-view matrices and shader mapping. |
| `src/rendering/StudioRenderer.ts` | View uniforms, camera-safe projected Sculpture transform, independent image samplers, Super 8 gate mappings, source/compositor integration. |
| `src/rendering/graphic-layout.ts` | Toroidal packing and paths, periodic colour/morph/waves, wrapped geometry, cache dependencies. |
| `src/rendering/GraphicRenderer.ts` | Full hardware sample coverage for adjoining solid rectangular tiles. |
| `src/rendering/shaders.ts` | View-aware compositing, one radial core, image-repeat bounds and sampling. |
| `src/rendering/surface.ts` | Unbounded procedural coordinates and matching footprint. |
| `src/rendering/fractal.ts` | View-aware plane sampling, footprints and bounded perspective denominator. |
| `src/rendering/fractal-julia.ts` | View-aware Julia coordinates and bounded perspective denominator. |
| `src/rendering/fractal-box.ts` | View-aware camera rays, subpixel samples and footprint. |
| `src/rendering/oil.ts` | Consistent material/optical view transforms, shading gradients, refraction and shadow sampling. |
| `src/rendering/super8.ts` | View-aware paint/film coordinates and footprint. |
| `src/rendering/super8-projector.ts` | Consistent paint sampling, optical coordinates and gate edges. |
| `tests/graphics.test.ts` | Toroidal coverage, adjacency, repeat crossings and ring cache regression checks. |
| `tests/source-view.test.ts` (new) | Compositor agreement, neutral identity and inverse transforms. |
| `scripts/verify-smart-repeat.mjs` (new) | Join geometry and all-effect GPU regression proof. |
| `scripts/verify-repeat-ui.mjs` (new) | Saved-composition packaged before/after capture without changing settings. |
| `scripts/verify-pattern-fill.mjs` | Single radial-core behavior and strict full-alpha fill assertions. |
| `scripts/verify-pattern-fill-ui.mjs` | Requires fully opaque native alpha for contiguous fills. |
| `README.md` | Seamless pattern/scaling behavior and verification. |
| `docs/smart-repeat-fix.md` (new) | This report. |
| `docs/system-alignment-audit.md` | Current application alignment and evidence. |
| `docs/pattern-scaling-fix.md` | Explains why the earlier fill correction needed this join fix. |

Generated `dist/` and the packaged application were rebuilt. Logs, screenshots, native exports and JSON evidence are under `work/smart-repeat/`, including `report.json`, `ui-results.json`, `packaged-fill.json`, `alignment.json`, `activation.json` and `final.json`.
