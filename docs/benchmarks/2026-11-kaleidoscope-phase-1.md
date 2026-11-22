# Kaleidoscope phase 1: acceptance proof

**Result: not accepted yet.** `npm run bench -- --proof kaleidoscope` exits 1. The Centre gate fails. The 4K budget, frame stability and repeatability are not proven.

Measured 2026-11-22 on one machine. Nothing here says how the instrument behaves on any other machine. The raw output of this run is in `work/bench/kaleidoscope-proof-final.json`, which is local and not committed.

## Machine and load

| | |
|---|---|
| Machine | Apple M5 Pro, 15 CPU cores, 24 GB, macOS (Darwin 25.6.0) |
| Renderer | ANGLE Metal, Electron 45.2.3, Chrome 156 |
| Load average (1 min) | 4.17 when the proof launched; 4.57 to 5.01 around the timing runs |
| Other processes | 311% CPU at proof start, peaking at 160% and 174% during the two timing runs |
| Other GPU processes | None at 5% CPU or more when sampled; an Electron GPU helper showed 2.3% to 2.8%. Nothing outside this proof was stopped |

The machine counts as quiet when the one-minute load was at most 2 **before the proof launched**, and, throughout the timing runs, other processes used under 200% CPU in total with no other GPU process at 5% or more. The proof's own processes are excluded from those CPU figures. **The machine was not quiet for this run**, because the load at launch was 4.17.

## Results

| Gate | Limit | Measured | Result |
|---|---|---|---|
| Fold quality | Fold-line error within 1/255 of non-fold pixels, against a 16x reference, all five groups | Worst difference 0.822/255 | **PASS** |
| 4K budget | p95 at or below 8 ms with a video input, 300+ frames | Worst p95 9.4 ms (p6m) | **NOT PROVEN** |
| Loop closure | Start and end within 1/255 on 99.9% of pixels | 100% in all 13 configurations | **PASS** |
| Frame stability | Spiral p95 at or below 1.25x median | 1.794x | **NOT PROVEN** |
| Centre | Temporal variance in the centre 5% no higher than the surrounding ring | Spirals 0.06 to 0.08x; fold groups 1.03 to 1.11x | **FAIL** |
| Finite output | No NaN or infinite pixels | 0 bad channels in 240 Studio renders and 12 Live 4K frames | **PASS** |
| Repeatability | Two runs agree within 5% on median | Worst difference 23.6% (spiral) | **NOT PROVEN** |

The existing parity and input checks also pass.

### 4K timing per case (ms, per frame, 360 frames)

| Case | Run 1 median | Run 1 p95 | Run 2 median | Run 2 p95 | Median difference |
|---|---|---|---|---|---|
| Rosette | 4.00 | 7.30 | 4.10 | 6.20 | 2.4% |
| pmm | 6.05 | 9.30 | 4.90 | 6.00 | 19.0% |
| p3m1 | 5.80 | 9.20 | 4.90 | 5.80 | 15.5% |
| p4m | 6.00 | 9.20 | 5.10 | 6.00 | 15.0% |
| p6m | 5.90 | 9.40 | 5.40 | 6.20 | 8.5% |
| Spiral | 4.45 | 5.80 | 3.40 | 6.10 | 23.6% |

Rosette and spiral are inside the 8 ms budget in both runs. The four lattice groups missed it in run 1 (9.2 to 9.4 ms) and met it in run 2 (5.8 to 6.2 ms). The two runs disagree too much to settle this, so a quiet-machine run has to.

**What the 4K gate covers.** It measures the render path at 3840 x 2160 with a 1080p feed. The product's Live path currently caps output at 1080p and its feed at 720p, so this gate does not describe a mode the app can run today.

### First use of the shader (not a gate)

Five rounds each, every round with a new GL context and a shader text never compiled before, drawing 960 x 540. Measured during this proof at a one-minute load of 4.80, with other processes at 142% CPU. `KHR_parallel_shader_compile` was available.

| | Prepare (median) | Longest main-thread gap during prepare (median / worst) | First draw (median / worst) | Programs built by first draw |
|---|---|---|---|---|
| Compiled in `prepare` | 10.4 ms | 4.8 / 5.5 ms | 13.5 / 14.1 ms | 2 |
| Compiled at first draw (before this change) | 0 ms | 4.6 / 4.7 ms | 18.3 / 20.1 ms | 3 |

Compiling in `prepare` moved the Kaleidoscope program off the first draw, and the main thread kept running while it built. **This does not prove the Map wall loop never stalls.** The first draw still takes about 13.5 ms on the main thread, because two shared programs are still built there and the graphics driver may do further work at first use. It was measured on a bare renderer, not on a running wall with other slots.

### Picture rules (real renders, not gates)

- **Feedback ground.** On a white ground, mean linear luminance is 0.8236 at Echo 0, 0.8235 at .0005, 0.8227 at .001, 0.0591 at .049, 0.0581 at .05 and 0.0582 at .051. The largest change between neighbouring settings .001 apart, from 0 to .06, is 0.023.
- **Circle motif.** Tile coverage varies by 0.0014 across the loop (limit 0.03), down from a range of .387 to .597. With 8 cycles per loop, the frame's mean linear luminance moves by 0.006 (spiral) to 0.032 (Hexagon), because a frame shows only part of each tile. That range is measured, but **it is not a flash-safety result.**

## How each gate was measured

**Fold quality.** Linear RGBA16F at 480 x 270, read back at native size, against 16 x 16 samples per pixel. Fold pixels are found from the TypeScript fold maths, not the shader. Both the mean and the p95 must be within 1/255, in either direction, because a line sharper than its surroundings is also visible. Two pictures were used: smooth waves crossing the mirrors obliquely, and thin oblique lines over soft dots. The reference renders through the same shader at 16x, so it would not expose an error in the fold maths itself. The separate parity check covers that.

**4K budget, stability and repeatability.** The real `LiveRenderer` frame (tracking, look, final encode) at 3840 x 2160, fed a generated 1080p VP9 clip decoded by a real video element. Each of six cases (five groups and the spiral) ran 360 timed frames, twice.

- A frame is timed only when `requestVideoFrameCallback` reports a newly presented picture. Frames between pictures keep the GPU busy and are not timed.
- The app caps Live output at 1080p and its feed at 720p. The proof overrides the output size in the harness and supplies a 1080p feed, so **the app cannot run this 4K path today**.
- The clip plays in a bare harness page, because video files are blocked in the real app by a pending Content-Security-Policy decision.
- `performance.now()` is coarsened to 0.1 ms. All three gates use per-frame samples. The JSON also records 5-frame means as extra information (spiral stability 1.293x, worst repeatability 24.5%). They do not decide any result.
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

The cost of this change was not measured separately. The lattice groups, which run the most fold steps per tap, are the only cases that missed the 4K budget, and only in run 1, so the fix may be part of that cost.

## Not measured or not verified

- Video files in the real app
- A real webcam
- The separate Live output window
- 4K output through the app itself
- Any GPU other than this M5 Pro
- Any timing on a quiet machine
- A first use of the shader during a running Map show
- **No flash or photosensitive safety is claimed.**

## Fractal baseline: pending

No baseline was saved. Two runs of `npm run bench -- --case all --size 1080p --frames 300`, at a load of about 3.6 to 4.4, disagreed by more than 5% on 9 of 11 fractal cases (worst 43.2%, Ember Julia at 4.6 and 8.1 ms). Those numbers are not valid for comparison, so `docs/benchmarks/2026-11-baseline.json` does not exist.

## To finish

1. Rerun `npm run bench -- --proof kaleidoscope` and the baseline on a quiet machine.
2. If the lattice groups miss 8 ms on a quiet machine, measure the cost of the four-tap fold filter and reduce it.
3. Decide how the Centre gate should treat fold groups.
