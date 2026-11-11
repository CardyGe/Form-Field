# Visual quality and smart effect variations

The Presets library now includes a **Signature collection** of 20 additional looks with actual renderer thumbnails. All 70 original presets remain available: 90 total. The new collection covers Surfaces, Sculptures, Fractals, Oil Slides, Super 8 Paint and all five Graphic Patterns families.

**Randomize effect** acts on the selected layer. The shuffle beside each layer acts directly on that layer. Subtle, Balanced and Bold set the amount; the existing Keep buttons independently lock palette, structure, motion and material. Images receive grading variations. Undo/redo and autosave use the normal edit path.

The previous variation engine independently perturbed every slider, gradually pushed repeated results towards control limits, and mixed unrelated swatches. The replacement selects the nearest authored recipe within the current family and variant, moves related controls together, and selects a complete authored palette. Small spiral-angle changes are deliberately restrained. Julia constants stay fixed to preserve topology. Quality, modes, projector view, substrate, background opacity, transforms, masks, layer mixing, loop cycle counts and authored animation routes/baselines stay intact. A locked procedural seed no longer prevents fresh random choices: UI entropy is separate from source entropy. If every available control is locked or animated, the editor explains why no variation can be made without adding an empty undo step.

No extra renderer, animation loop, feedback buffer or export path was introduced. Existing projects still use schema 1; collection metadata and variation amount are editor choices. The application version is read from package.json for both development wrappers and packaged launches, avoiding the Electron runtime version appearing as the app version.

## Review artifacts

- `work/quality-pass/gallery.html`: all 20 signature looks at three loop phases.
- `work/quality-pass/signature-contact.png`: collection overview.
- `work/quality-pass/random-contact.png`: originals beside Subtle, Balanced and Bold variants.
- `work/quality-pass/{surface,sculpture,fractal,oil,super8,graphic}-contact.png`: every preset across all six procedural effect types.
- `work/quality-pass/signature-*-4k.png`: six production renders, one per procedural effect type.
- `work/quality-pass/report.json`: full GPU audit.
- `work/quality-pass/reference-check.json`: reference comparisons and production capture records.
- `work/quality-pass/repeat-report.json`: current repeat/coverage regression results.
- `work/quality-pass/randomizer-ui/report.json`: actual UI, persistence and undo/redo results.
- `work/quality-pass/alignment.json`: packaged runtime/source/version checks.
- `work/quality-pass/activation.json`: application replacement and autosave preservation checks.

These are reviewed reference captures, not a claim of user approval. Small cross-device differences are allowed by the reference comparison. Perceptual quality is still subjective; bounds/coverage checks supplement visual review.

## Validation

- 72 automated tests: 55 TypeScript tests and 17 native export tests.
- TypeScript validation, Vite production build and Apple Silicon app packaging.
- 200 preset reference frames; 60 random variant frames reviewed in a contact sheet.
- All 90 presets: three random variation amounts and two combined size/motion extremes (450 cases).
- 21 algorithm families: 1,670 independent slider-extreme renders, with finite linear RGBA, bounded alpha and zero RGB at zero alpha.
- All 20 signature looks: landscape, square, portrait, exact seek and loop checks.
- 100 repeat regression checks, including the 90 transformed presets and genuine geometry crossing repeat joins.
- 22 full editor integration checks, including project recovery and a real 30-frame transparent ProRes 4444 export.
- Focused randomizer UI checks for all seven layer types, all three amounts, independent seed entropy, locked motion/palette, unchanged animation routes, undo/redo, per-layer actions and all 20 signature cards.
- Packaged native PNG exports across Surface, Sculpture, Fractal, Oil and Image; 4K Oil output and a decoded 30-frame Fractal ProRes 4444 movie.
- Packaged Super 8 modes/projector controls, saved animation, migration and native alpha output.
- Packaged small-pattern coverage proof: Pattern size .25, Stretch .4 and layer size .3; minimum, mean and edge alpha all 255 for the opaque packed mosaic.
- Packaged files checked against the working build: 32 runtime files, 22 embedded TypeScript/React sources and all 20 signature thumbnails, with no mismatches; application, package and lockfile versions agree at 0.8.0.

Reproduce the visual audit with `node scripts/verify-quality.mjs`. Only `--update-references` replaces the source thumbnails. `--references-only --production` compares the references and emits six 4K production renders. `node scripts/verify-randomizer-ui.mjs` exercises the actual editor in an isolated native profile.

## Modified files in this pass

Product:

- `src/core/project.ts`: signature expansion and coordinated, bounded variation engine.
- `src/core/signature-looks.ts`: 20 authored recipes.
- `src/shared/types.ts`: optional preset collection metadata.
- `src/ui/App.tsx`: collection filter/thumbnails, amount selector, selected/per-layer randomization and fresh UI entropy.
- `src/ui/styles.css`: thumbnails, variation selector and layer shuffle layout.
- `src/ui/assets/signatures/*.png`: 20 renderer reference thumbnails.
- `electron/main.cjs`: application version from the product manifest.

Verification and documentation:

- `tests/quality.test.ts`: collection, repeated variations, effect identity, palettes, routes, bounds and seed-lock entropy checks.
- `tests/core.test.ts`: original collection coverage and preservation of animated baselines.
- `tests/graphics.test.ts`, `tests/oil.test.ts`, `tests/super8.test.ts`: expanded collection coverage while retaining original modes.
- `scripts/verify-quality.mjs`: reproducible GPU audit, reference comparisons, contacts, gallery and 4K renders.
- `scripts/verify-randomizer-ui.mjs`: native editor randomizer and collection checks.
- `scripts/verify-ui.mjs`, `scripts/verify-graphics-ui.mjs`, `scripts/verify-super8-ui.mjs`: expanded library assertions.
- `README.md`: current controls, collection and verification commands.
- `docs/visual-quality-and-randomizer.md`: implementation, limits, evidence and file list.

Build artifacts are in `dist/` and the updated application is installed at `work/release/mac-arm64/Form & Field.app`. The prior application is preserved at `work/quality-pass/previous/Form & Field.app`.
