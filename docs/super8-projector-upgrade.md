# Super 8 projector upgrade

The existing Form & Field **0.8.0** application now includes a more complete projector treatment for all four Super 8 modes. The updated app is running at `work/release/mac-arm64/Form & Field.app`. All seven instrument kinds and all seventy presets remain in the same application. The earlier Graphic Patterns canvas-fill correction remains active.

## Appearance and controls

Seventeen additive controls extend the existing paint, film rate, feedback, grain, scratches, flicker and weave controls:

| Area | Controls and behavior |
| --- | --- |
| Emulsion | Emulsion movement adds fluid warping, irregular pigment pools and frame-by-frame boiling. The four original geometry modes remain distinct. |
| Transport | Frame advance pulls the previous exposed image through the gate during the first 16% of a film interval. Projector shutter and one/two/three shutter blades expose the image between closures. Reel turns per loop adds continuous strip travel; Frame lines shows the frame dividers. |
| Gate | Full canvas, Rounded gate and Film strip views. Gate inset, Gate corners and Sprocket holes adjust optional framing, including a single Super 8 perforation rail. |
| Wear | Separate Dust and Gate hair controls supplement scratches and grain. Dust follows the exposed film; hair stays at the projector gate. |
| Lens | Lens softness, warm Halation, Projector vignette, breathing Light leaks and Color fading. |

The inspector groups paint geometry, paint texture, film motion/feedback, transport, gate, wear and lens controls. Gate controls appear for framed views; perforation strength appears for Film strip. Existing Motion buttons, undo/redo, masks, blending, palette, shared grading and native save/open remain available.

**Full canvas is borderless.** Geometry/texture scale changes the paint coordinates while the source continues covering the output. Rounded gate and Film strip deliberately add adjustable framing. These controls are independent of the earlier Graphic Patterns tiling/radial extent fix.

New layers and the four updated presets include the projector treatment. Saved Super 8 layers acquire neutral new controls, preserving the previous settings. Apply an updated preset to an existing layer for the authored new look, or adjust projector controls individually. The four preset IDs and the seventy-preset library count remain unchanged.

## Renderer and output

Paint and its Motion routes still hold at the simulated film rate. A separate deterministic transport clock runs continuously between exposures. Each image can reconstruct six feedback taps; the adjacent exposed frame has its own historical Motion evaluation for pull-down. It uses the existing StudioRenderer loop and compositor.

A lazy RGBA16F target feeds the projector finish, which samples the paint for lens softness and halation. The target resizes with the output and is released when the composition contains no visible film layer or the renderer is disposed. There is no additional animation loop, accumulated simulation or history leaking between layers. Seek order, loop wrap, fresh renderers and resumed exports reproduce the output.

The source remains associated linear RGBA. Film wear and leaks are confined to source coverage for transparent cutouts; gate edges provide real masks. The existing EXR, PNG-sequence and ProRes pipeline is retained. A packaged transparency check exposed an eight-bit output edge case: tiny alpha could round to zero while straight RGB remained nonzero. The shared display/PNG boundary now quantizes alpha before clearing zero-alpha RGB. The high-precision linear export path retains its faint coverage.

## Verification

- **67 unit/native tests passed:** 50 TypeScript/core tests and 17 native/export tests, including additive migration, corrupt-value rejection, shutter timing and exact transport loops.
- **22 complete editor checks passed:** all existing workflows plus three projector views, sixteen numeric projector controls, conditional gate controls, animated light leaks, four modes/presets and native save/open.
- **Super 8 GPU checks passed:** all four modes, all seventeen new controls, existing controls, held paint with continuous transport disabled, continuous transport enabled, historical feedback routes, exact loops, seek/fresh-render equality, full seed range, layer isolation, alpha/masks, parameter extremes, portrait/landscape/square canvas fill, resource release, 3840×2160 EXR and interrupted/resumed PNG and ProRes 4444 exports.
- Existing Oil Slides GPU regressions, all twenty-six Graphic Patterns looks and thirty canvas-fill checks passed.
- The packaged application passed Surface, Sculpture, Fractal, Oil and Image native smoke tests, including 4K Oil PNG and a fully decoded thirty-frame Fractal ProRes 4444 movie.
- Packaged projector checks passed older-project migration, all three views, numeric controls, animation, native save/open, all seventy library presets and transparent PNG output with clean zero-alpha RGB.
- Packaged Pattern size/stretch/rotation and layer-transform controls still fill the canvas in a native transparent PNG.
- TypeScript/build and macOS arm64 packaging passed. Vite retains its existing large-bundle advisory.

## Application alignment and saved project

The running app, workspace build and source match: **12 executable renderer/native files and 20 bundled source modules compared; zero mismatches**. Workspace package, lockfile, packaged package and macOS bundle remain **0.8.0**. Current archive SHA-256: `bbce2dd84bf631ddb857505f95bca52fcf05508ebb741eb69856310a9bbc1fcc`.

The update used normal native close to commit pending edits and autosave, then reopened the verified bundle. There was no active user export. The existing saved composition retained every original setting; its Super 8 layer acquired only the seventeen neutral migration fields. Its raw pre-update autosave remains in the app's recovery directory. The previous app bundle is retained under `work/super8-projector/previous/`.

## Modified files

| File | Change |
| --- | --- |
| `src/core/project.ts` | Seventeen controls, absent-only migration, improved defaults and four authored projector presets. |
| `src/rendering/super8-motion.ts` | Deterministic continuous transport, shutter and pull-down timing. |
| `src/rendering/super8.ts` | Fluid paint/emulsion, adjacent exposed-frame history, film transport and dust. |
| `src/rendering/super8-projector.ts` (new) | Gate, perforations, frame dividers, hair, leaks and optical finish. |
| `src/rendering/StudioRenderer.ts` | Continuous transport alongside held paint, optical target/uniforms and resource disposal. |
| `src/rendering/shaders.ts` | Clean zero-alpha RGB at the eight-bit display/PNG boundary. |
| `src/ui/App.tsx` | Projector-view selector, grouped controls, conditional gate controls and help. |
| `src/ui/assets/super8.png` | Thumbnail captured from the actual film-strip renderer. |
| `tests/super8.test.ts` | Additive migration, validation, shutter/pull-down and loop timing tests. |
| `scripts/verify-super8.mjs` | New-control GPU proof, continuous/held clocks, seeds, canvas fill, resources and optional motion capture. |
| `scripts/verify-super8-ui.mjs` (new) | Packaged controls, legacy migration, persistence, animation and native PNG-alpha checks. |
| `scripts/verify-ui.mjs` | Expanded full-editor projector controls and animated-light-leak coverage. |
| `README.md` | Projector controls, timing, compatibility and verification commands. |
| `docs/super8-projector-upgrade.md` (new) | This report and modified-file list. |
| `docs/super8-paint-integration.md` | Links the original integration baseline to this upgrade. |
| `docs/system-alignment-audit.md` | Records the updated application alignment. |

`dist/` and the packaged application were regenerated. Evidence is in `work/super8-projector/`, including `alignment.json`, `activation.json`, `packaged-ui.json`, `ui-results.json`, logs and screenshots. Shader captures, the optional two-second ProRes preview and native delivery proofs are in `work/super8-integration/`.
