# Professional effect audit · 0.10.0

9 November 2026 · Form & Field

The audit covers all seventeen source types, all procedural families, their saved controls, smart variation, preview/compositing and native output. The resulting release adds 134 source controls across the ten newer instruments, six tonal controls for every layer, directional highlights on Surface and Oil, per-control reset and ten exploration looks. There are 130 presets; the previous 120 are retained.

The professional references are Resolve's separation of optical/finishing controls, TouchDesigner's explicit signal/material operations and MadMapper's surface-oriented procedural material contracts. The research register contains 36 product, technical and creator references, with access limitations recorded. See [research and decisions](research/professional-effects-2026-11-09.md). These references guide the implementation; this release does not claim the vendors' complete feature sets or calibrated physical simulation.

## Findings and actions

The strongest existing qualities were deterministic loops, the shared alpha/colour pipeline and source fields that continue through transforms. The main shortcomings were restricted construction controls in the newer instruments, similar lighting across different materials, and insufficient independent tonal finishing. Two artifacts appeared during visual review: high-frequency highlight sparkle and coherent volume sampling bands.

The changes address those findings directly. Existing artwork keeps neutral defaults. New construction controls change the field or material itself rather than scaling a finished rectangular image. The advanced presets exercise the new combinations; they are not simply palette replacements.

| Source | Audit finding | Work completed |
| --- | --- | --- |
| Surface | Rich construction; finishing and directional material response could be separated better. | Shared tonal finishing; optional filtered directional sheen and orientation, retaining all four pattern families and their variants. |
| Sculpture | Existing mesh deformation and physical material are already substantial. | Shared tonal finishing; preserved geometry, lighting, masks and camera controls. Existing form references and exports are regression-tested. |
| Fractal | Family-specific controls and colouring need to remain coherent through finishing. | Shared tonal finishing after existing colour treatment, preserving the established exposure handling and family visibility. |
| Oil Slides | Material response needed a directional finish independent of its refraction/ink construction. | Directional highlight and orientation on paint/glass; shared tonal finish; existing optical, wake and quality controls retained. |
| Super 8 Paint | Transport, lens, gate and wear controls are already deep; finishing should remain independent of them. | Shared tonal controls, preserving four modes, held film cadence, reconstructed feedback and projector options. |
| Graphic Patterns | Source continuity is essential; finishing must never change coverage. | Tonal controls for all five families; original repeat/join, mask and alpha contracts retained. |
| Imported image | Grading should work without making a finite image into an unintended tiled field. | Tonal controls, with original image fit, repeat, mirror, embedded assets and alpha retained. |
| Caustic Atlas | Wave mixture alone offered a narrow family of light fields. | Wave alignment, refraction strength, halo, wave asymmetry; stretch, warp, twist and phase. |
| Living Ink | Needed more chemical preparation and pigment-edge control. | Seed coverage, development, edge pigment and softness; material lighting and field controls. Every preparation value participates in the cache key. |
| Magnetic Skin | Isolated rounded peaks dominated its identity. | Connected ridge formation, peak height, attractor radius, continuous skin, directional sheen and coating. |
| Velvet Currents | Needed larger coherent flow structures and independent strand character. | Local vortex, braid, taper, fine eddies, field deformation and directional material shading. |
| Kinetic Relief | Regular shutters needed more architectural construction choices. | Joint spacing, row stagger, hinge position, plate rounding, opening variation and independent material lighting. |
| Holographic Loom | Needed textile construction rather than only interference colour. | Thread width, weft spacing, fold depth, interlacing, directional sheen and coating. |
| Crystal Reef | Mineral shape, spacing and veins needed independent articulation. | Site irregularity, facet orientation, crystal spread and vein depth, plus field/material controls. |
| Prism Cathedral | Repeated vaults needed controllable perspective and relative construction. | Arch roundness, frame thickness, depth twist and horizontal/vertical vanishing point, plus material controls. |
| Resonant Sand | Rectangular nodal fields were expressive but restrictive. | Circular modes, harmonic detail, grain density and nodal softness, retaining productive mode-pair fallbacks. |
| Volumetric Veils | Needed independent optical and density controls; thin ribbons exposed sampling bands. | Ribbon width, turbulence, absorption, scattering direction, light elevation and deterministic banding suppression. |

## New control structure

All ten newer sources share Field stretch, Domain warp, Warp scale, Field twist and Motion phase. Deformation uses an analytic stream-function curl, evaluated at the current periodic phase. It does not add simulation history. Motion phase is retained by smart variation so a new material recipe does not unexpectedly move the loop's timing.

Eight lit sources additionally expose Light elevation, Fill light, Directional sheen, Sheen direction and Clear coat. Caustics uses its own optical controls; Veils has volume-specific illumination. Sheen direction is a support control for nonzero Directional sheen, and Warp scale supports nonzero Domain warp. Tests explicitly activate the parent control when checking these dependent parameters.

Tonal finishing supplies Tonal contrast, Contrast pivot, Midtone gamma, Shadow lift, Highlight compression and Vibrance. These act on unassociated colour before layer blending, while coverage remains unchanged. Contrast pivot is active when contrast differs from 1. Extreme legal grades remain finite in the half-float working pipeline. The existing SDR tone map and native output transfer are preserved.

Advanced shape, motion and material controls are collapsible. Numeric controls have an undoable reset button. Keyboard activation of advanced disclosures preserves the playback state. Preparation controls do not expose an animation button or appear as Motion targets. Shared finishing remains under Finish rather than filling the construction panel.

## Rendering quality and artistic limits

Directional and clear-coat highlights are broadened where screen-space normals vary rapidly. The directional helper is reused by Surface and Oil. This is a bounded artistic material model; it does not claim a full anisotropic GGX implementation or spectral thin-film solver.

Volume banding suppression jitters the sampling offset deterministically per ray. Fixed output resolution and seed produce the same sampling positions at any seek/export order. More samples reduce sampling texture. The new Opalescent Smoke preset uses High quality and banding suppression; the neutral setting retains older volume artwork.

Living Ink remains a prepared Gray–Scott pattern with periodic deformation. Development changes preparation duration, not playback speed. Its cache key includes seed, growth family, branching, seed coverage and development. The four-entry resource limit and deterministic re-preparation remain tested.

Velvet Currents remains an analytic strand instrument. Magnetic Skin, Relief and Reef remain shaded height fields. Prism is bounded optical architecture rather than a recursive ray tracer. Resonant Sand's circular figures are artistic radial modes, not a calibrated plate eigenmode solver. These are deliberate representations within the shared WebGL renderer, not interchangeable claims of physical simulation.

No shader code was copied from the referenced projects. The shared loop, source transforms, layer compositor, masks, grading and native EXR/PNG/ProRes pipeline remain the only output path.

## Verification and evidence

A renderer was reconstructed from the installed 0.9.0 archive's embedded source map and compiled against the unchanged dependency set. Every one of its 120 presets was rendered beside the new renderer after neutral document migration. The maximum mean linear-RGBA difference was approximately 0.00000721 at the audit resolution; 96 were pixel-identical. This is a numerical image comparison, not a claim of independent aesthetic approval.

The expanded GPU suite exercises 40 new-instrument looks, all control endpoints and activation, three strengths of smart variation, exact seeking, stopped intrinsic motion, loop closure, alpha, full-field transforms, portrait/square/landscape output, mixed layers, masks and resource bounds. The new control activation suite has 1,041 edge/activation records.

The finisher is tested on all seventeen source types: 102 control checks verify that each control changes the image, preserves alpha exactly and supports a cyclic animation route. A coloured embedded PNG supplies a real imported-image case. Thirty-two combined chemical preparation boundary cases remain productive.

The complete visual-quality pass renders the 130-look library at multiple phases, stresses each construction family and compares the twenty existing signature references. The repeat suite also covers the complete library, repeat joins and explicit masks. Native editor tests cover save/open, animation, undo/redo, preparation controls, parameter reset and the expanded preset library.

Relevant commands:

```
npm test
npm run build
npm run test:ui
node scripts/verify-effect-audit.mjs
node scripts/verify-instruments.mjs
node scripts/verify-quality.mjs
node scripts/verify-smart-repeat.mjs
node scripts/verify-randomizer-ui.mjs
node scripts/verify-instruments-ui.mjs [bundle]
node scripts/verify-pattern-fill-ui.mjs [bundle]
PACKAGED_SMOKE_SMALL=1 node scripts/verify-packaged.mjs [bundle]
node scripts/verify-alignment.mjs [bundle]
```

The comparison suite uses `work/pro-audit/baseline-renderer.js` when present. That module was captured from 0.9.0 before activation; it is retained with the audit artifacts rather than shipped as another application renderer. Without that local baseline, the script still runs the seventeen-source finishing and chemical preparation tests and reports an empty baseline comparison list.

Proofs are under `work/pro-audit/`; the forty-look contact sheet and source-control proof are under `work/instruments/`. New native movie checks export the advanced fourth look with non-neutral tonal settings. Every frame is decoded and checked for actual animation, dimensions, frame count, alpha-capable codec and transfer metadata. Existing export recovery and closing/restarting persistence remain in the full editor regression suite.

Completed-frame timings include GPU completion and a one-pixel readback; they are not encoder timings or guaranteed live frame rates. Veils remains the most expensive instrument, particularly at full-resolution High quality. Venue brightness, projector focus, mapping geometry and physical edge blending require stage evaluation beyond this software audit.

## Files changed

- `src/core/finishing.ts` — new shared neutral finishing definitions.
- `src/core/instruments.ts` — advanced source controls, defaults, migration keys and ten new exploration looks.
- `src/core/project.ts` — finishing integration, strict additive migration, relevant Graphic control visibility and smart-variation support rules.
- `src/shared/types.ts` — optional advanced/control-description metadata.
- `src/rendering/projection-optics.ts` — reusable directional highlight and filtering.
- `src/rendering/instrument-shaders.ts` — field, construction, material, modal and volume improvements.
- `src/rendering/InstrumentRenderer.ts` — phase offset and complete chemical preparation/cache keys.
- `src/rendering/shaders.ts` — alpha-preserving per-layer tonal stage.
- `src/rendering/StudioRenderer.ts` — shared finishing uniforms and parameter dispatch.
- `src/rendering/surface.ts`, `src/rendering/oil.ts` — directional highlight reuse.
- `src/ui/App.tsx`, `src/ui/styles.css` — advanced disclosures, help, reset and tonal panel.
- `src/ui/assets/instruments/*.png` — refreshed renderer captures at the neutral defaults.
- `tests/instruments.test.ts`, `tests/core.test.ts`, `tests/quality.test.ts` — migration, boundaries, preparation, variation and library coverage.
- `scripts/verify-effect-audit.mjs` — old/new renderer comparison, all-source finishing and preparation combinations.
- `scripts/verify-instruments.mjs` — dependent-control activation and forty-look gallery.
- `scripts/verify-instruments-ui.mjs` — advanced controls/reset and native graded exploration exports.
- `scripts/verify-randomizer-ui.mjs` — finishing/reset/undo on all seventeen kinds.
- `scripts/verify-ui.mjs`, `scripts/verify-super8-ui.mjs` — complete library count.
- `scripts/verify-alignment.mjs` — packaged guide/research alignment checks.
- `package.json`, `package-lock.json` — 0.10.0 version; audit documentation bundled with the app guide.
- `README.md`, `docs/professional-effect-audit-0.10.md`, `docs/research/professional-effects-2026-11-09.md` — controls, evidence, decisions and limitations.
