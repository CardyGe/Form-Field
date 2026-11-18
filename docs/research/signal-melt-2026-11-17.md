# Signal Melt

Live mode → Look → Signal Melt. Uses camera, video preview or the moving test pattern.

## Research and technology choice

- **Motion-driven frame memory:** Careaga, Reddy and Aksoy, *Datamoshing with Optical Flow*, SIGGRAPH Asia Posters 2023, demonstrates datamoshing by applying motion to mismatched visual data without corrupting a video codec. https://yaksoy.github.io/datamosh/
- **GPU frame history:** Three.js render targets store rendered images for later passes. Two half-float buffers alternate reading and writing; a texture is never sampled while attached as output. https://threejs.org/manual/pages/rendertargets.html and https://threejs.org/docs/pages/GPUComputationRenderer.html
- **Depth distinction:** Three.js DepthTexture records scene geometry depth. It cannot recover physical depth from an ordinary camera video. https://threejs.org/docs/pages/DepthTexture.html
- **WebGPU:** Three.js provides a separate WebGPU post-processing pipeline. Migrating the existing WebGLRenderer and tracking pipeline would add scope without being necessary for this effect. https://threejs.org/manual/pages/webgpu-postprocessing.html

The implementation reuses the existing GPU motion estimator. It is an artistic optical-flow approximation, not the paper's pretrained flow model and not manipulation of encoded MPEG packets. No extra model download or dependency is introduced.

## The effect

A 320 × 180 filtered brightness map acts as artistic relief. Depth focus selects the stationary brightness plane; the signed height and local gradient steer pixel displacement. Brightness is not measured distance, and the UI says so.

Camera movement transports remembered image pixels. Motion is sampled at block centres as fracture increases. Deterministic per-block offsets produce broken slabs; staggered block refresh interrupts long memory. Frame memory is the time to decay to approximately 5% in the absence of block refresh, with a range of 0.1–20 seconds.

Chroma slip separates brightness from colour using Y/Cb/Cr. The colour component samples displaced frame history, producing a different trail from the brightness component. Internal camera/history values remain in the camera's sRGB encoding; the display pass converts to linear colour for the existing Live output encoder.

Depth glass favours short memory and continuous displacement. Chroma wake favours delayed colour. Codec collapse favours large blocks, long memory and aggressive motion. Each preset resets frame memory; other controls and setup remain untouched.

Hold stops normal memory refresh while motion continues transporting it. Clear reseeds from the current source. Out-of-frame history refreshes from the source to avoid stretched edge accumulation. Source replacement, mirroring and resolution changes reseed history. Motion displacement occurs only on fresh analysed camera frames, independent of display refresh. Zero-time redraws do not advance memory.

## Validation

- `npm run build`: passed.
- `node --import tsx --test tests/live.test.ts`: 31 passed, including settings migration and persistence.
- `node scripts/verify-signal.mjs`: GPU harness added for preset differences, source colour, hold/clear, redraw stability, source changes, resize, blackout and look switching. Electron could not launch within this session's execution sandbox, so these checks are **not yet verified**. Performance and final visual tuning also require a GPU run.

This is a Live effect. It does not add a Studio loop exporter or measured/AI camera depth.

## Interactive artwork revision

The final artwork revision supersedes the initial full-frame video treatment above.

### Artistic research

Golan Levin's *Interstitial Fragment Processor* makes body contours and the empty spaces between people into material: https://www.flong.com/archive/projects/ifp/index.html . Universal Everything's *Kinfolk* transforms viewers through movement, using vivid colour and a legible relationship between action and transformation: https://www.universaleverything.com/art/kinfolk . The implementation takes those general principles—recognisable body, clear causality, discoverable transformations—without reproducing either artwork.

MediaPipe's Image Segmenter supports person/background segmentation in continuous video: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter?tab=Web . The app already bundles its multiclass model and worker, so Signal now reuses them rather than adding a model download. This is segmentation, not physical depth sensing.

### Final pipeline and interaction

1. Mirror and track source motion as before.
2. Remove the room using the temporally filtered person mask, adjustable confidence threshold and feather width. Cutout is on by default. A missing mask admits no room pixels.
3. Recolour the isolated person using an independent vivid palette, with height bands, luminous edges and local motion-driven colour variation. This pass produces premultiplied linear RGB and coverage.
4. Transport that isolated pigment through the existing block/motion feedback. Longer memory and Echo spread create dragged silhouettes and ribbons. Premultiplied coverage allows trails outside the current silhouette without leaking camera background. Cutout, threshold and palette changes reseed history immediately.
5. Separate luminance and chroma in the remembered pigment. Preserve saturation after colour mixing, and remove imperceptibly faint residue to keep the surround black.
6. Composite the live body over its trails and use the existing output encoder. Effect mix now reveals the isolated, recoloured participant; it never bypasses cutout to reveal the room.

Starting points are now **Prism body**, **Chroma wake**, and **Signal sculpture**. Slow movement draws colour trails; quicker movement increases displacement, local colour change and block fracture; the live body remains readable. Contours continue to show camera brightness relief while still. These controls are local image/motion responses, not skeletal gesture recognition.

The person-finding setup controls, empty-room calibration and status now also appear for Signal with cutout enabled. The synthetic test source becomes a moving figure, with synthetic masks, so it demonstrates the interaction without opening a camera. Real sources continue using the bundled worker. Source replacement rebuilds the provider so synthetic masks cannot carry over to a real camera.

### Completed validation

- Full TypeScript/Vite build and app packaging passed, build 136.
- The packaged archive check found all seven Electron runtime modules and their local dependencies.
- 32 Live unit checks and 19 Electron Live checks passed.
- 10 actual GPU checks passed in a packaged Electron runner: missing-mask black output, vivid masked participant, stable zero-time redraw, all three presets, distinct preset images, explicit background opt-out, immediate removal of room history on enabling cutout, blackout.
- The final main application was opened and inspected in Live with Signal Melt → Chroma wake → Test pattern, background removal enabled. The participant and chromatic trails rendered against black. Camera person-finding reported running before switching to the synthetic demonstration.

GPU runner: `node scripts/verify-signal.mjs` builds the isolated test app; open `work/signal-art-check/pack/mac-arm64/Signal Study.app`, then run `node scripts/verify-signal.mjs --results` to verify its recorded checks. The runner exists only to validate the actual renderer; the artwork is integrated into the main app.

Real camera cutout quality still depends on framing, lighting and model accuracy. Test results use synthetic silhouettes, so they do not establish hair-edge accuracy or multi-person performance in an installation.

## Pose and release interaction

Signal now tracks the masked body's centre, average motion, stored pose charge and released energy in a two-pixel GPU state. Holding still fills the charge; renewed movement releases a short prismatic ring and expands remembered pigment away from the body centre. Charge changes contour phase and brightness, making stillness visibly participatory. No image is read back into JavaScript during rendering. A read-only two-pixel diagnostic is available for GPU checks.

New controls: Pose charge time, Gesture release and Prismatic flare. Each starting point sets them. Release 0 disables the outward impulse and flare. Clear, source changes, mirroring, cutout changes and appearance changes reset stored energy. Zero-time redraws cannot charge or release it.

Keep still poses is on by default for Signal. It bypasses the shared still-object timeout only for this look; Smoke keeps its existing filtering. Empty-room calibration and mask confidence still apply. As with all segmentation, static imagery that resembles a person may need empty-room rejection or the still-object filter.

The synthetic figure alternates three seconds holding and four seconds moving to demonstrate the interaction without a camera.

Validation: full build and packaging passed (build 137), all 33 Live unit checks passed, and all 15 GPU checks passed. New GPU checks cover visibility beyond a ten-second still-object timeout, full charge from stillness, nonzero released energy after moving, zero-time gesture stability and clearing stored energy. The preset check allows intentional flares to reach the frame edge while verifying black corners and bounded image coverage. Missing-mask and cutout-purge checks continue to require completely black output, rather than accepting a nonzero tolerance.
