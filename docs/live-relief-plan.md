# Live Relief

Proposed third look for Live, alongside Paint and Smoke. Carry over the folding metal wall and the colour travelling across its surface from the Tidal Relief study. Give the audience control over where each fold starts and how far it travels.

## What the audience sees

| Gesture | Wall response |
| --- | --- |
| Empty room | A still, edge-to-edge wall of brushed blue-silver blades. A fixed grazing light picks out the bevels, so the surface has depth before anyone enters. |
| Small hand movement | A few blades tilt at the hand’s position. A silver glint and a sliver of coloured enamel reveal the fold. |
| Sweep across the frame | The fold follows the hand, with a short travelling crest in the direction of the sweep. Colour peaks on the turning edge and fades as the blades settle. |
| Two people moving apart | Each leaves a separate wake. Where wakes cross, the metal can turn further up to a fixed limit. |
| Everyone stops | The last crease relaxes back into alignment. Aim for roughly one second at the default setting. |

Use a fixed, front-facing composition for projection. The first trial should use one finish, one accent and fixed lighting. A person watching from the back of the room should be able to point to who caused a particular fold.

## Implementation sequence

1. **Prove one gesture inside Live.** Add an experimental Relief entry to the look selector and renderer switch in the isolated worktree. Implement the existing `Look` interface in `src/live/Relief.ts`. Use the study’s blade profile, bevels and brushed finish as the visual reference. Render a fixed orthographic scene with Live’s existing Three.js renderer into a depth-enabled target. Publish linear colour through `Look.output` so preview, projector and blackout use the existing output path.

2. **Make the wall respond where the movement happened.** Start with a 160 × 90 GPU field holding signed bend and velocity. Read Live’s existing `TrackingFeed.flow` in artwork coordinates. Its red and green channels carry direction and its blue channel carries strength. Inject a local impulse only on `feed.fresh`. Carry some impulse a short distance along the flow, then spread it to neighbouring cells and damp it using bounded simulation steps. Apply the existing interaction box to incoming motion. Sample the field in the blade vertex shader and derive the surface normals from the same deformation so the highlight stays attached. Use the existing motion tracker for this look.

3. **Review the projected gesture before adding controls.** Try a slow hand trace, a quick sweep in either direction, and two people moving at opposite edges. Check both mirror settings. Tune the input noise threshold, spread and damping against a quiet room and a moving performer. Proceed when the first bend lands under the hand, a reversed sweep reverses the wake, and the fold remains readable at projector distance. If it feels like a lighting effect, tune the blade rotation and silhouette first.

4. **Finish the operator workflow.** Extend `src/live/settings.ts` and `src/ui/LivePanel.tsx` with three Relief controls. **Depth** sets maximum blade rotation, **Reach** sets propagation distance, and **Settle** sets recovery time. Keep camera sensitivity, mirroring and interaction area in Live’s shared setup. Give Relief its own validated defaults, preserve saved Paint and Smoke settings, and label the shared interaction area for all three looks. Clear should flatten the wall immediately. Switching looks should release the field, geometry, materials and render targets.

## Checks before a build for rehearsal

- Extend `tests/live.test.ts` for saved settings and range validation. Exercise the GPU look with controlled moving patches in `scripts/verify-live.mjs`. Check left and right alignment, movement outside the interaction area, two independent wakes, and decay when the camera stops delivering frames. Repeat with a slower camera cadence to catch impulses accidentally applied on every display frame.
- Extend `scripts/verify-live-ui.mjs` for look selection, persistence, Clear and switching back to Paint or Smoke. Exercise blackout, resizing, opening and closing projector output, and camera reconnection. Inspect the artwork and tracking views on their intended displays.
- Run the existing Live performance procedure at 720p and 1080p with the operator preview active. Target 60 fps at 1080p on the project’s M5 Pro reference machine. Record frame-time percentiles and dropped frames during a full-width sweep. Film a hand and the projected wall together to check end-to-end response, then inspect moving bevels for shimmer on the actual projector.

**First milestone:** a camera-driven wall with one convincing sweep, ready to judge on a projector before building the operator controls.
