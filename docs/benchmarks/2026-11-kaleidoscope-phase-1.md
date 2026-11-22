# Kaleidoscope phase 1: acceptance proof

**Result: not accepted yet.** `npm run bench -- --proof kaleidoscope` exits 1. The Centre gate fails. The 4K budget, frame stability and repeatability are not proven.

Measured 2026-11-22 on one machine. Nothing here says how the instrument behaves on any other machine. The raw output of this run is in `work/bench/kaleidoscope-proof-final.json`, which is local and not committed.

## Machine and load

| | |
|---|---|
| Machine | Apple M5 Pro, 15 CPU cores, 24 GB, macOS (Darwin 25.6.0) |
| Renderer | ANGLE Metal, Electron 45.2.3, Chrome 156 |
| Load average (1 min) | 4.85 when the proof launched; 4.33 to 4.97 around the timing runs |
| Other processes | 438% CPU at proof start, peaking at 110% to 164% during the timing runs |
| Other GPU processes | Electron GPU helpers from another checkout, 22% and 30% CPU at proof start, 1% or less around the timing runs. They were left alone |

The machine counts as quiet when the one-minute load was at most 2 **before the proof launched**, and, throughout the timing runs, other processes used under 200% CPU in total with no other GPU process at 5% or more. The proof's own processes are excluded from those CPU figures. **The machine was not quiet for this run**, because the load at launch was 4.85.

## Results

| Gate | Limit | Measured | Result |
|---|---|---|---|
| Fold quality | Fold-line error within 1/255 of non-fold pixels, against a 16x reference, all five groups | Worst difference 0.822/255 | **PASS** |
| 4K budget | p95 at or below 8 ms with a video input, 300+ frames | Worst p95 11.1 ms (p6m) | **NOT PROVEN** |
| Loop closure | Start and end within 1/255 on 99.9% of pixels | 100% in all 13 configurations | **PASS** |
| Frame stability | Spiral p95 at or below 1.25x median | 1.605x | **NOT PROVEN** |
| Centre | Temporal variance in the centre 5% no higher than the surrounding ring | Spirals 0.06 to 0.08x; fold groups 1.03 to 1.11x | **FAIL** |
| Finite output | No NaN or infinite pixels | 0 bad channels in 240 Studio renders and 12 Live 4K frames | **PASS** |
| Repeatability | Two runs agree within 5% on median | Worst difference 8.8% (p3m1) | **NOT PROVEN** |

The existing parity and input checks also pass.

### 4K timing per case (ms, per frame, 360 frames)

| Case | Run 1 median | Run 1 p95 | Run 2 median | Run 2 p95 | Median difference |
|---|---|---|---|---|---|
| Rosette | 3.70 | 5.20 | 3.80 | 5.00 | 2.6% |
| pmm | 7.40 | 9.70 | 7.90 | 9.90 | 6.3% |
| p3m1 | 7.35 | 9.60 | 6.70 | 9.50 | 8.8% |
| p4m | 7.50 | 9.90 | 8.10 | 10.80 | 7.4% |
| p6m | 8.80 | 10.80 | 9.00 | 11.10 | 2.2% |
| Spiral | 4.30 | 6.90 | 4.00 | 6.40 | 7.0% |

Rosette and spiral are inside the 8 ms budget. The four lattice groups are not, in this loaded run. A miss under load cannot be called a failure or a pass, so a quiet-machine run has to settle it.

## How each gate was measured

**Fold quality.** Linear RGBA16F at 480 x 270, read back at native size, against 16 x 16 samples per pixel. Fold pixels are found from the TypeScript fold maths, not the shader. Both the mean and the p95 must be within 1/255, in either direction, because a line sharper than its surroundings is also visible. Two pictures were used: smooth waves crossing the mirrors obliquely, and thin oblique lines over soft dots. The reference renders through the same shader at 16x, so it would not expose an error in the fold maths itself. The separate parity check covers that.

**4K budget, stability and repeatability.** The real `LiveRenderer` frame (tracking, look, final encode) at 3840 x 2160, fed a generated 1080p VP9 clip decoded by a real video element. Each of six cases (five groups and the spiral) ran 360 timed frames, twice.

- A frame is timed only when `requestVideoFrameCallback` reports a newly presented picture. Frames between pictures keep the GPU busy and are not timed.
- The app caps Live at 1080p. The proof overrides that size in the harness, so **the app cannot output this 4K path today**.
- The clip plays in a bare harness page, because video files are blocked in the real app by a pending Content-Security-Policy decision.
- `performance.now()` is coarsened to 0.1 ms. All three gates use per-frame samples. The JSON also records 5-frame means as extra information (spiral stability 1.283x, worst repeatability 4.9%). They do not decide any result.
- In an earlier run with a CPU-backed 1080p canvas instead of decoded video, frames took 10 to 16 ms under load while GPU time stayed at 2 to 5 ms, which points to the upload (not isolated). A source that arrives through a software path may miss the budget.

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

The cost of this change was not measured separately. The lattice groups, which run the most fold steps per tap, are the cases over the 4K budget in this run, so the fix may be part of that cost.

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
2. If the lattice groups still miss 8 ms, measure the cost of the four-tap fold filter and reduce it.
3. Decide how the Centre gate should treat fold groups.
