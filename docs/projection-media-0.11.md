# Projection media implementation · 0.11

10 November 2026 · Form & Field

This release improves the existing instruments' movement and gives the three proof families different construction methods. It adds nine authored studies, directional organic motion across all ten projection instruments, explicit animation endpoints, and surface inputs. The original 130 presets and their neutral rendering are retained; the library now contains 139.

## What changed

**Velvet Currents** now offers Transported fibres alongside Analytic weave. Fibres follow seeded RK2 trajectories through a directed field with eddies at different scales. Their staggered ages, soft births/deaths and continuous path tails replace the apparent movement of brightness along a static stripe field. Paths are reconstructed from birth and cached by field settings, independently of playback order. Central obstacles and polygon/image surface obstacles affect the paths. A finite lifetime with smooth coverage makes the treatment periodic; the velocity field being periodic alone would not establish that.

**Living Ink** retains its prepared growth and adds Flowing pigment loop and Evolving chemistry. The loop transports a prepared field across its periodic texture domain; it does not claim new chemical growth. The evolving mode advances actual Gray–Scott chemistry, advects its state, and carries a separate pigment deposit through the flow. Pigment carry blends the chemical front with transported pigment. A larger simulation domain and an explicit edge fade prevent texture-edge smearing. This is a directed reaction-advection material, not a general water/free-surface solver.

The chemical grid is saved at 128, 256 or 384 pixels square, independently of output resolution. A fixed 24 Hz simulation clock runs chemical substeps, with interpolated state between ticks. Seeking restores a suitable checkpoint or reconstructs from initial conditions. Each simulation retains at most eight checkpoints; at most four visible chemical layers are retained. Algorithm identity, resolution, seed, preparation/transport settings and surface inputs participate in invalidation. The native build fingerprint prevents mixing frames from different rendering software in a resumed job.

**Kinetic Relief** retains its shaded-field representation and adds Hinged solids: actual instanced geometry, a fixed perspective camera, shared lights, and cast/received shadows. Shadow strength controls occlusion independently of light power; Clear coat uses the physical material's coating. Neighbouring groups have independent phase offsets, with source-space identity retained as the view changes. Surface cutouts also affect the shadow-depth pass, avoiding shadows from visually removed solids. This is a virtual scene for media generation; it does not calibrate a physical projector or solve audience tracking.

**The other seven projection instruments** receive optional Organic motion, directional travelling deformation and motion phrases. Caustic crests can travel through the wave field, fabric folds can propagate through the weave, mineral growth can follow a spatial front, and vaults can move relative to depth. Precise regular patterns remain available. Existing controls are not silently changed in saved artwork.

**All seventeen layer types** can use explicit lower/upper animation endpoints. These evaluate the bounded source signal directly between the selected values, rather than clipping an offset near a parameter limit. Legacy offset routes retain their evaluation. Endpoint routes ignore the old Depth value; the interface hides that control for them.

## Surface inputs and document compatibility

Surface influence accepts a simple editable polygon with 3–12 vertices, or an imported image mask. A bounded 128-square field supplies approximate signed distance, normals and coverage in layer coordinates. Polygon validation rejects crossings, duplicate edges and collapsed areas. Raster masks use luminance times alpha, the mask's size and inversion, with a documented approximate distance transform.

Transported fibres use the field to redirect paths and reject invalid emission points. Evolving chemistry uses it in its stream function, boundary conditions and seed placement. Other treatments use it for coverage and edge reveals. An emitter defines where material begins; transported material may leave that shape. Image masks can independently clip the final composition through **Also clip output with mask**. This distinction avoids the contradiction of hiding all the material that flows around an obstacle.

An active obstacle remains solid; Influence blends the visible treatment. Collision handling for fibre paths is a bounded approximation, including intermediate segment checks and outward projection. It is not an exact continuous collision or mass-conservation solver. Very thin mask details are limited by the field resolution.

Surface layouts and endpoint routes use **document version 2**, accepted by both renderer and native persistence/export validation. Plain documents may remain version 1. Missing new numeric controls migrate to neutral defaults; explicit corrupt values are rejected. Old projects open without being overwritten. Keep a separate copy when opening a new document in older application versions, which cannot understand the new fields.

The native colour, alpha, compositing and encoding pipeline remains shared. No second delivery renderer or replacement encoder was introduced. H.264 review movies use a local encoder only for review; native delivery still uses the bundled high-precision PNG/ProRes tools.

## Using the update

1. Choose **Library → Presets → Projection motion**. Silk River, Copper Confluence and Gathering Light demonstrate transported fibres. Ink Estuary and Coral Development demonstrate finite evolving chemistry; Tidal Pigment is a loop. Breathing Facade, Folding Copper and Quiet Monument demonstrate hinged geometry.
2. Use **Motion phrase** for steady travel, gather/release or drift/settle. Treatment-specific controls appear in the inspector. Flow direction, Travel and Eddy frequency direct the field.
3. Open **Shape → Surface influence** to draw or import a surface. Drag vertices or move them with arrow keys; use Shift for finer keyboard movement. Add/remove vertices to refine the outline. Geometry edits participate in undo, autosave and native save/open.
4. Under **Motion**, choose **Animation range → Smooth between endpoints** for a bounded animation. Lower and upper values define its full excursion.
5. Evolving clips stop at their end and show **Render clip**. Play starts them again. They support up to 60 seconds and do not claim seamless looping. Other source layers can continue to use their periodic clocks within that clip.

Adding a new Currents, Ink or Relief layer starts with its upgraded treatment. The other new projection layers start with organic motion enabled. Applying an original preset or opening an old project retains that artwork's authored settings.

## Reference register: design lessons versus algorithms

No project images, shader implementations or film frames were copied into the product. Source descriptions and production accounts guide the design. Interpretations below are ours; they do not assert that the artists used our algorithms. The original [research plan](projection-media-direction-2026-11-10.md) retains the broader direction.

| Reference | Concrete influence in this release | Evidence limit |
| --- | --- | --- |
| [teamLab — Universe of Water Particles](https://www.team-lab.com/news/uowp1307/) | Fibre paths express transport and interaction, rather than serving only as surface texture. | A creative reference for the path language. Our field/lifecycles do not reproduce teamLab's water simulation. |
| [Universal Everything — Living Mural](https://www.universaleverything.com/design/sydney-opera-house-living-mural) | Distinct motion verbs and phrases: gathering, travelling and settling. | Creator-described design principles; no invented film timecodes. The current `/design/` page replaces the old `/projects/` URL. |
| [Limelight — Interconnection](https://www.limelight.art/portfolio/interconnection) | Shape-driven regions, reveals and architectural grouping. | A surface-aware generation tool, not a reproduction of the Palace of Parliament show. |
| [Bot & Dolly — Box, Ian Sherman's production account](https://www.ianjsherman.com/work/box/) | Consistent geometry, perspective, occlusion and shadows. | A fixed virtual audience position. Robotics, physical camera capture and dynamic mapping are not implemented. |
| [Moment Factory — SuperReal](https://momentfactory.com/products/superreal) | Contrasting material studies with transparent gaps and darker composition. | The full immersive installation, lighting rig and spatial sound are outside this application milestone. |
| [AURA Invalides — Notch production account](https://www.notch.one/madewithnotch/aura-invalides) | Authoring and reviewing a complete moving scene, with coordinated light/material response. | We do not claim the production's multi-tool pipeline or live NDI workflow. |
| [1024 architecture — Perspective Lyrique](https://www.1024architecture.net/projects/perspective-lyrique/) | Parameters describe a meaningful deformation or release gesture; endpoint routes support directed control. | Live audio analysis is a follow-on, not part of this release. |
| [Studio Lemercier — FUJI](https://joanielemercier.com/fuji/) | Edge reveals, negative space and restraint. | The underlying drawing, narrative and original projected content are not included. |
| [Bridson, Hourihan and Nordenstam — Curl-Noise for Procedural Fluid Flow](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf) | Directed stream-function fields, spatial scales and boundary-aware flow as engineering principles. | Our sine stream functions, lifecycle reconstruction and collision approximations are an original bounded implementation, not the paper's exact Perlin-noise construction. |
| [Karl Sims — Reaction-Diffusion Tutorial](https://www.karlsims.com/rd.html) | Gray–Scott feed/kill chemistry and discrete diffusion. | Advected pigment, finite clip playback, checkpoint reconstruction and display treatments are application decisions. |
| [Three.js — GPUComputationRenderer](https://threejs.org/docs/pages/GPUComputationRenderer.html) | Floating-point textures and ping-pong computation as a technical precedent. | We use the existing renderer's draw callback and explicit targets, not a second computation renderer or display loop. |
| [Three.js — InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) | Shared geometry with per-piece transforms and colour. | Documentation supports the rendering mechanism, not the artistic quality or physical mapping accuracy. |

The [NVIDIA fluid chapter](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu) remains a reference for a possible pressure-projected solver. This release uses an analytic transport field; it does not mislabel that as a full Navier–Stokes implementation. [MadMapper's material documentation](https://docs.madmapper.com/madmapper/6/3.-media/writing-custom-glsl-materials) remains a workflow reference; our saved media is not automatically an ISF/MadMapper material.

## Verification and review artifacts

The executable evidence is under `work/projection-media/`; these paths are local review artifacts rather than bundled application dependencies.

- `baseline/` and `baseline-renderer.js`: pre-change source snapshot and compiled renderer captured before implementation.
- `full-report.json`, `final-report.json` and the associated logs: old-preset comparisons, surface cases, numerical checks, timings and native recovery evidence. The final report records the final rendering revision.
- `studies-contact.png`: the nine authored looks, captured from the actual renderer. Their source thumbnails ship with the application.
- `silk-river`, `ink-estuary` and `breathing-facade` `.formfield`/`.mp4` files: complete proof projects and review clips. The matching `-before-after.mp4` files place the prior renderer on the left and the upgraded treatment on the right, with matching source parameters and palette.
- `native/`: real native alpha ProRes exports, interrupted halfway through and resumed with a fresh renderer. Rendered frame hashes are compared against an uninterrupted reconstruction, and decoded streams are inspected.
- `ui-*/report.json` and screenshots: native save, version-2 data, polygon keyboard editing, vertices, undo/redo, endpoint controls, library thumbnails, finite playback/replay and chemical resolution.
- `*-motion-sheet.png` and `temporal-report.json`: decoded twelve-phase contact sheets, movie frame counts and loop-boundary measurements. Review clips composite over black before discarding alpha; the editable projects retain transparency.
- `unit-tests.log`, `instrument-audit.log`, workspace/interaction checks and packaged checks: software regression evidence. Historical audit reports from earlier releases remain historical; their counts are not substituted for a new run.

Reproduce:

```sh
npm test
npm run build
node scripts/verify-projection-media.mjs --performance --native
node scripts/verify-projection-media-ui.mjs
node scripts/verify-instruments.mjs
npm run test:ui
```

Add `--baseline` only when the captured pre-change renderer is available. Add `--update-thumbnails` deliberately to refresh the nine shipped images. Full review clips use `--movies` and a locally available H.264 encoder selected with `REVIEW_FFMPEG`; this is not required by the app or native export tests.

Frame timing includes completed GPU work and readback, not only command submission. The release evidence reports the machine and measured cases; arbitrary four-layer 4K combinations have no universal live-rate promise. A mathematically closed phase is supplemented with full clips and boundary-frame review. First and last encoded frames are not artificially duplicated.

## What remains outside the completed software work

A real projector/mock-up review is still required for black level, line survival, defocus, physical geometry and the intended audience position. No physical projector test was possible in this workspace, so that release gate is explicitly outstanding. Creator pages and production notes were researched; a complete timed annotation of every reference film is not claimed.

Live audio/gesture inputs, recorded control tracks, general moving-media import, deformable cloth, arbitrary 3D surface import and projector calibration remain follow-on work. The application is still an alpha. The milestone supplies concrete motion, surface and export improvements for review; it does not claim that software tests alone establish world-class projection art.
