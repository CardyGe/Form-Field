# System alignment audit — 7 November 2026

Latest update — **9 November 2026**: the seamless-repeat correction is installed and running. All 12 runtime files and 21 bundled source modules match the current build. All seven instruments remain in version 0.8.0; the saved composition was preserved byte-for-byte. Archive SHA-256: `b1f04b0b12d7b4f5e26797bfc8584c9a142fce179da5efacadff5dcabff68f85`. See [Seamless repetition and scaling](smart-repeat-fix.md) for the root cause, 69 unit/native tests, 22 editor checks, 80 GPU checks and modified files. The follow-ups below describe earlier baselines.

Current follow-up: the Super 8 projector upgrade is installed and running in the same **0.8.0** application. All 12 executable renderer/native files and 20 bundled source modules match the workspace. The saved composition retained all original settings and acquired only neutral Super 8 migration fields. Current archive SHA-256: `bbce2dd84bf631ddb857505f95bca52fcf05508ebb741eb69856310a9bbc1fcc`. See [Super 8 projector upgrade](super8-projector-upgrade.md) for controls, verification and modified files. The records below are earlier audit baselines.

Follow-up: the pattern scaling correction has since been installed in the same **0.8.0** app at the same path. Source/build/package alignment was rechecked after activation: 12 runtime files matched, the app is running, and its saved project was retained unchanged. The updated build passed 65 unit/native tests and 22 editor checks. Current archive SHA-256: `e647d66ebece817b45fc86c0f2928c81d71678c1b8561775bcd31b73c444b15b`. See `docs/pattern-scaling-fix.md` for the correction and new coverage tests. The audit evidence below records the earlier baseline.

**All implemented effects are in the same Form & Field 0.8.0 application. No functional version split or missing instrument was found. Application source was not changed.**

Audited app: `/Users/grego/Documents/ChatGPT/three VJ/work/release/mac-arm64/Form & Field.app`.

The user's running application was detected at this exact path. Its process started at 17:34:29 on 7 November, after this package was built at 15:07:10. Audit launches used separate profiles; the open project and running instance were left alone.

## Version and artifact checks

- Workspace package, lockfile root/package entry, packaged package, macOS bundle version, packaged runtime and visible app version all report **0.8.0**.
- All **19** bundled TypeScript/React source modules match the current source through embedded source maps.
- All six instrument thumbnails match their built assets.
- A fresh production build matches every packaged executable renderer/native file and asset byte for byte: **12 runtime files compared; zero mismatches**.
- The debug source map changed only in generated `ROLLDOWN_FILE_URL` asset identifiers, which depend on bundler emission order. Normalizing those identifiers makes the maps identical. Actual runtime URLs, images, shaders and application code are identical. Native export fingerprints already exclude debug maps, so this does not change rendering or resume compatibility.
- The packaged guide matches the README. Packaged FFmpeg/FFprobe match the local pinned binaries; app and both media tools are Apple Silicon arm64 executables.
- `npm ls --depth=0` succeeds with installed dependencies aligned to the declared package versions.
- Packaged `app.asar` SHA-256: `a6d44116bfb4fa7db02f279a48996992c40a618390c4d0a35ef4aaa7864c62eb`.

## Effect inventory

| Instrument | Presets | Packaged preview and native persistence |
| --- | ---: | --- |
| Surface | 13 | Passed every preset |
| Sculpture | 8 | Passed every preset |
| Fractal Worlds | 12 | Passed every preset |
| Oil Slides | 7 | Passed every preset |
| Super 8 Paint | 4 | Passed every preset |
| Graphic Patterns | 26 | Passed every preset |
| Imported image | Import source | Packaged import, mirror, repeat, grading, alpha and still export passed |
| **Total** | **70 presets + image import** | **All included in this package** |

Every preset was selected in the actual packaged editor, checked against its authored parameters and palette, rendered to the GPU canvas, and read back through native autosave. All four Super 8 modes and all five Graphic Patterns families are included.

## Shared architecture

All seven source kinds are registered in the project schema, UI, renderer and native document/export boundary. They share `StudioRenderer`, the four-layer compositor, masks, opacity, transforms, blending, color finishing, Motion routes, still output and native jobs. Graphic Patterns uses a drawing helper inside the shared renderer. Super 8 uses a source shader and deterministic film clock inside that renderer. Neither requires a separate application or output pipeline.

Preview, PNG stills and EXR movie/sequence masters use the same source rendering and compositor. Associated linear source pixels and straight-alpha finished-linear EXRs retain the existing contract. Native encoding supplies PNG sequences, ProRes 4444 and opaque ProRes 422. Renderer fingerprints cover the combined build and reject cached frames from incompatible builds when resuming exports.

Project **schema 1** is the saved-file format, separate from app version 0.8.0. Electron **45.2.3** is the runtime dependency, separate from the app/effect version. README references to earlier 0.4–0.7 milestones describe the introduction and compatibility of features now included in 0.8.

## Verification results

- `npm test`: **64 tests passed**, zero failures, including migrations, presets, modulation, variation, native precision/alpha/color and durable/resumed jobs.
- `npm run build`: TypeScript and production Vite build passed. The existing large-bundle advisory remains; it does not indicate different versions.
- `npm run test:ui`: **22 editor checks passed**, including save/open, legacy migration, undo, controls, masks, recovery, close flushing and native movie output.
- Packaged preset audit: **all 70 presets passed**, with zero GPU/page errors.
- `PACKAGED_SMOKE_SMALL=1 npm run test:packaged`: packaged Surface, Sculpture, Fractal, Oil and Image checks passed, including a fully decoded 30-frame Fractal ProRes 4444 movie, real alpha and a 4K Oil still.
- Additional packaged checks: Super 8 Paint and Graphic Patterns each completed a **30-frame native ProRes 4444 movie**, covering the newer kinds beyond the older packaged smoke script's five-kind coverage.
- `node scripts/verify-super8.mjs`: four modes, controls, deterministic frame holds/history, alpha/masks, extremes, mixed layers, 4K and resumed PNG/ProRes exports passed.
- `node scripts/verify-graphics.mjs --checks-only`: all 26 looks, controls, looping/seeking, alpha/masks, extremes and native output checks passed.
- `node scripts/verify-oil.mjs`: all seven looks, looping, alpha/masks, optical controls, mixed layers, resource release and 4K output passed.

No functional alignment fixes were necessary. This audit generated reports and isolated test artifacts and rebuilt the unchanged source. It did not replace or restart the user's running application.

## Evidence

Reports and logs are in `work/system-audit/`: `results.json`, `alignment.json`, `packaged-all.json`, `packaged-results.json`, `ui-results.json`, `dependencies.json` and command logs. `packaged-all.mjs` is the isolated audit harness. Six `packaged-*.png` captures show the instrument groups. Detailed Super 8, Graphics and Oil GPU evidence is also retained in their existing verification folders.
