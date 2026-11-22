# Kaleidoscope phase 1: acceptance proof

**Result: not accepted yet.** `npm run bench -- --proof kaleidoscope` exits 1. The Centre gate fails, and frame stability is not proven.

Measured 2026-11-22 on one machine. Nothing here says how the instrument behaves on any other machine.

## Machine and load

| | |
|---|---|
| Machine | Apple M5 Pro, 15 CPU cores, 24 GB, macOS (Darwin 25.6.0) |
| Renderer | ANGLE Metal, Electron 45.2.3, Chrome 156 |
| Load average (1 min) | 5.76 at the start of the proof, 4.36 at the end; 4.37 to 5.10 around the timing runs |
| Other GPU process | One Electron GPU helper from another checkout, 0.6% to 2.4% CPU. It was left alone |

The machine counts as quiet below a one-minute load of 2 with no other GPU process at 5% CPU or more. **It was never quiet during these runs**, so every timing result below was taken under competing load.

## Results

| Gate | Limit | Measured | Result |
|---|---|---|---|
| Fold quality | Fold-line error within 1/255 of non-fold pixels, against a 16x reference, all five groups | Worst difference 0.822/255 | **PASS** |
| 4K budget | p95 at or below 8 ms with a video input, 300+ frames | Worst p95 6.8 ms (p6m) | **PASS** (under load) |
| Loop closure | Start and end within 1/255 on 99.9% of pixels | 100% in all 13 configurations | **PASS** |
| Frame stability | Spiral p95 at or below 1.25x median | 1.724x per frame; 1.297x on 5-frame means | **NOT PROVEN** |
| Centre | Temporal variance in the centre 5% no higher than the surrounding ring | Spirals 0.06 to 0.08x; fold groups 1.03 to 1.11x | **FAIL** |
| Finite output | No NaN or infinite pixels | 0 bad channels in 240 Studio renders and 12 Live 4K frames | **PASS** |
| Repeatability | Two runs agree within 5% on median | Worst difference 3.3% (spiral) | **PASS** (under load) |

The existing parity and input checks also pass.

## How each gate was measured

**Fold quality.** Linear RGBA16F at 480 x 270, read back at native size, against 16 x 16 samples per pixel. Fold pixels are found from the TypeScript fold maths, not the shader. Both the mean and the p95 must be within 1/255, in either direction, because a line sharper than its surroundings is also visible. Two pictures were used: smooth waves crossing the mirrors obliquely, and thin oblique lines over soft dots. The reference renders through the same shader at 16x, so it would not expose an error in the fold maths itself. The separate parity check covers that.

**4K budget, stability and repeatability.** The real `LiveRenderer` frame (tracking, look, final encode) at 3840 x 2160, fed a generated 1080p VP9 clip decoded by a real video element. Each of six cases (five groups and the spiral) ran 360 timed frames, twice. Only frames carrying a new video picture are timed.

- The app caps Live at 1080p. The proof overrides that size in the harness, so **the app cannot output this 4K path today**.
- The clip plays in a bare harness page, because video files are blocked in the real app by a pending Content-Security-Policy decision.
- `performance.now()` is coarsened to 0.1 ms. Budget and stability use per-frame samples. Repeatability uses the median of 5-frame means, because a 2 to 3 ms median on that clock moves in steps as large as the 5% limit.
- With a CPU-backed 1080p canvas instead of decoded video, frames took 10 to 16 ms under load while GPU time stayed at 2 to 5 ms, which points to the upload (not isolated). A source that arrives through a software path may miss the budget.

**Centre.** A zone plate at 961 x 541, turned about the exact centre for 48 frames. Both the mean and the peak variance must be no higher than the ring.

## The Centre failure

The spirals pass clearly. All six fold cases miss, by 3% to 11% on the mean.

The evidence points at the test rather than a visible sparkle, but **this has not been accepted as a pass**:

- A 4x4 supersampled render of the same motion is also busier at the centre, at 1.02 to 1.09x. A near-perfect render would fail this gate with this picture.
- The real render sits about 2% above that supersampled ratio in every fold case.
- A deliberately broken centre scores 1.19x on folds and 640x on spirals. The gate detects the spiral defect easily, but its margin on folds is thin.

The test design changed twice before this result. The first version placed the zone plate near the picture, so the two zones read different ring frequencies, and added a small orbit to the turn. The second moved the plate far outside the picture, and the third removed the orbit. Neither change made the fold cases pass, and the limit was not moved. Deciding whether to compare against the supersampled ratio is a change to the gate, so it is left open.

## Defect found and fixed

The first proof run failed fold quality, with p95 up to 1.35/255 above non-fold pixels. A single filtered tap on a mirror reads picture from beyond the wall. Every folded pixel now takes four rotated-grid taps, each with its own fold and half the footprint, so the filter is the same on and off a mirror. Feedback history is still read once, because spreading its taps would blur it again on every echo.

The cost of this change was not measured separately with the video feed.

## Not measured or not verified

- Video files in the real app
- A real webcam
- The separate Live output window
- 4K output through the app itself
- Any GPU other than this M5 Pro
- Any timing on a quiet machine
- **No flash or photosensitive safety is claimed.**

## Fractal baseline: pending

No baseline was saved. Two runs of `npm run bench -- --case all --size 1080p --frames 300`, at a load of about 3.6 to 4.4, disagreed by more than 5% on 9 of 11 fractal cases (worst 43.2%, Ember Julia at 4.6 and 8.1 ms). Those numbers are not valid for comparison, so `docs/benchmarks/2026-11-baseline.json` does not exist.

## To finish

1. Rerun `npm run bench -- --proof kaleidoscope` and the baseline on a quiet machine.
2. Decide how the Centre gate should treat fold groups.
