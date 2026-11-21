# Benchmark harness

Measures GPU time per render pass, cold start and run-to-run agreement for Studio compositions. Every later performance target in the Kaleidoscope and fractal roadmap is reported against it.

## Run

```
npm run bench -- --runs 2                    # the audit suite, twice, on this machine's GPU
npm run bench -- --case mandelbox-4k-preview # one case
npm run bench:compare work/bench/<before> work/bench/<after>
```

Results go to `work/bench/<label>/results.json` (the label defaults to the date and commit). `--label` names the folder; `--frames` changes the timed frame count (300 minimum); `--suite` points at another case file.

`--smoke` runs a few frames to check the harness works, and `--software-gl` renders on the CPU with SwiftShader for machines without a usable GPU. Numbers from either are meaningless, and the compare script says so. On Linux as root, add `--no-sandbox`, and run under `xvfb-run` when there is no display.

## What it measures

- **GPU time per pass.** `StudioRenderer` names each pass as it starts (`source:<kind>`, `glow`, `composite`, `finish`, `downsample`, `display`). The passes sit back to back, so a frame's total is the sum of its passes. Timing uses `EXT_disjoint_timer_query_webgl2`. Frames hit by a disjoint event (a GPU clock change, for example) are dropped rather than undercounted. Without the extension, the harness falls back to wall time to a completed GPU fence, which overstates cost, and the results say `"timing": "cpu-fence"`.
- **Frame pacing.** Frames are drawn on `requestAnimationFrame` in a visible window, as in a show. `frameInterval` is the presented interval, and `cpuSubmit` is the CPU time to issue a frame.
- **Cold start.** A new renderer and context, with Chromium's shader disk cache off, timed through `prepare()` and the first finished frame. This includes real shader compilation.
- **Modes.** `preview` is what Studio and Map play live: half-resolution Mandelbox and one fractal sample per pixel. `export` is delivery quality, drawn to the screen without readback.
- **Statistics.** Median, mean, p95, p99 and max per pass and per frame. Percentiles are nearest-rank, so a reported p95 is a frame time that actually happened.

## Repeatability

`--runs n` repeats the whole suite in fresh renderers and reports each case's spread of median totals. The target is 5% or less. `compare.mjs` exits 1 when any shared case's median moves by more than 5% (`--tolerance` changes this). So two runs of the same commit should exit 0, and a change should report its effect.

## Suites

`scripts/bench/suites/audit.json` holds the audit baselines: Kaleidoscope, Julia and Mandelbox at 4K and 1080p in preview, and Kaleidoscope and Mandelbox at 4K in export. A case gives either a `preset` id or a `project` file (relative to the suite), plus optional `params` overrides for the first layer, `frames`, `warmup` and `supersample`.
