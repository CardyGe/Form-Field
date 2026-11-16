# Live mode: measured performance

Measured 15 November 2026 with `node scripts/verify-live.mjs --performance`.

| | Paint only | Paint with the operator preview being sent |
|---|---|---|
| Length of run | 120 s | 60 s |
| Mean frame rate | 60.0 fps | 60.0 fps |
| Longest gap between frames | 17.8 ms | 17.8 ms |
| 99th-percentile gap | 17.7 ms | 17.7 ms |
| Frames later than 25 ms | 0 | 0 |
| Share of the picture covered in paint at the end | 64% | 64% |

**Re-measured 16 November 2026 after Paint was reworked to flow like wet paint** (wind field, colour wash, wet blending, rounded brush marks, averaged tracking): 60.0 fps in both runs, longest gap 17.8 ms, 99th percentile 17.7 ms, no frames later than 25 ms, 82% of the picture covered at the end. The rework added no measurable cost on this machine.

**Machine:** Apple M5 Pro (Mac17,9), macOS 26.6.2, built-in display, 60 Hz.

**What was run:** the Live renderer at 1920 × 1080 with Paint at its default settings and 65,536 particles, driven by the synthetic test source (two moving discs at 30 frames per second), in a visible Electron window.

## What this does not show

- A real camera. Camera decode and a 1280 × 720 upload every frame were not part of this run.
- A projector or second display. The window was on the built-in screen and was smaller than 1920 × 1080 on screen; the picture itself was rendered at the full 1920 × 1080.
- The full two-window arrangement. The preview cost was imitated in the same window (a 480 × 270 JPEG ten times a second), not sent between windows.
- A long session. The longest run was two minutes.
- Frame rates above 60. The display limits the measurement to 60 Hz, so there is no reading of spare capacity.

These need checking in the real-camera session with a projector attached.
