# Live reliability and performance specification for an Electron + Three.js VJ and projection-mapping app on macOS

Researched 2026-11-21. "Local probe" means a WebGL2 capability script run on 2026-11-21 inside this repo's Electron 45.2.3 (Chromium 156.0.8078.80), on an Apple M5 Pro with macOS 26.6.2, using ANGLE's Metal renderer. It is evidence for this machine and build only. "Repo" means code read in this working tree, which has uncommitted changes. Numbers under **Inferences** are proposed engineering targets unless a source is linked; none has been load-tested on this app.

## Frame pacing, GPU timing, governors and shader-compile hitches

### Takeaway
On this exact stack, GPU elapsed-time queries and non-blocking shader compilation are both available, so the app can move from a CPU-time governor to a GPU-time one. Program binaries are not available, so hitch prevention must rely on background linking, warming each program before it goes on air, and never making an unprepared program visible.

### Cited Findings
- `EXT_disjoint_timer_query_webgl2` provides `TIME_ELAPSED_EXT`, `TIMESTAMP_EXT` and `GPU_DISJOINT_EXT`; results are polled across frames, and measurements spanning a disjoint event must be discarded — [Khronos](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)
- Timestamp support is optional: code must check that `QUERY_COUNTER_BITS_EXT` for `TIMESTAMP_EXT` is above zero — [Khronos](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)
- Local probe: the timer extension is present, `TIME_ELAPSED_EXT` has 64 bits, **`TIMESTAMP_EXT` has 0 bits (unavailable)**, and results arrive. Four single-clear samples read 15,625, 109,833, 8,333 and 15,666 ns, so very short passes are noisy.
- Public support data shows 61.86% on macOS and 80.34% on Chrome/Chromium, without an Electron breakdown, so the extension must remain optional — [Web3D Survey](https://web3dsurvey.com/webgl2/extensions/EXT_disjoint_timer_query_webgl2)
- ANGLE's test suite has skipped a time-elapsed test on ARM Macs for its desktop OpenGL backend. That does not establish a Metal failure, but shows the path has had platform-specific problems — [ANGLE tests](https://chromium.googlesource.com/angle/angle.git/+/HEAD/src/tests/gl_tests/TimerQueriesTest.cpp)
- `KHR_parallel_shader_compile` adds a non-blocking `COMPLETION_STATUS_KHR`; it does not make compilation faster, and completion queries return true after context loss so polling cannot hang — [Khronos](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/)
- MDN recommends compiling all shaders, linking all programs, then checking status; it warns that `getError`, `getProgramParameter` and similar calls can flush and round-trip, with `getError`/`getParameter` taking as long as 1 ms or more — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- Local probe: `KHR_parallel_shader_compile` is present. `gl.getProgramBinary` does not exist and no program-binary extension is exposed.
- Chromium has a persistent GPU cache in its source — [Chromium](https://chromium.googlesource.com/chromium/src/+/HEAD/gpu/command_buffer/service/gpu_persistent_cache.cc). A 2020 thread reported about 200 ms for a first link and about 5 ms afterward, which is old and hardware-specific — [graphics-dev](https://groups.google.com/a/chromium.org/g/graphics-dev/c/a-dIhkhKwl0)
- ANGLE's Metal backend caches render pipelines in a context-level LRU cache — [ANGLE commit](https://android.googlesource.com/platform/external/angle/+/b46344bb2c). WebKit disabled its ANGLE Metal program memory cache because it could grow too large — [WebKit](https://lists.webkit.org/pipermail/webkit-changes/2023-February/282643.html)
- Unreal's dynamic-resolution controls include a budget, GPU headroom, history length, minimum change period, change threshold and a "panic" drop; too little headroom causes constant changes — [Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/dynamic-resolution-in-unreal-engine)
- Unity HDRP averages GPU time over evaluation windows and uses separate scale-up and scale-down durations with discrete steps — [Unity](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.2/manual/Dynamic-Resolution.html)
- Repo: `src/map/playout.ts` has a four-level governor (`1, 0.75, 0.5, 0.5` scale, half-rate at the last level) with fixed `LATE_MS = 15`, `EASY_MS = 10`, `STEP_DOWN_AFTER = 30`, `STEP_UP_AFTER = 120`, and treats an interval over 24 ms as a missed refresh. It uses compositor work time and frame intervals. No GPU timer use was found under `src/`.

### Inferences
**Likely defect in the current governor:** its fixed thresholds do not scale with refresh rate. At 120 Hz (8.33 ms budget) a 12 ms frame is "inside budget" and a 16.7 ms interval is not counted as a miss. At 50 Hz (20 ms budget), 16 ms of work is treated as late despite being on time. Thresholds should derive from the measured display interval.

| Output | Budget | Governor target (GPU p95) | Step down | Step up only below | Pixels/s at full res |
|---|---:|---:|---:|---:|---:|
| 50 Hz | 20.00 ms | 15.0 ms | 17.0 ms | 12.0 ms | 4K: 415 MP/s; 8K: 1.66 GP/s |
| 60 Hz | 16.67 ms | 12.5 ms | 14.2 ms | 10.0 ms | 4K: 498 MP/s; 8K: 1.99 GP/s |
| 120 Hz | 8.33 ms | 6.25 ms | 7.1 ms | 5.0 ms | 4K: 995 MP/s |

Proposed acceptance targets for a show scene at output resolution:
- Missed presents: under 0.1% over a 10-minute run, and no two consecutive misses during normal playback.
- Frame-time p99 no more than 1.25x the display interval. Longest stall during a scene change: under 1 display interval.
- Shader or scene switch: zero blocking main-thread compile or link calls after the program is marked ready.

Governor pattern:
1. Measure each major pass with `TIME_ELAPSED_EXT`, using a ring of 4 to 6 query objects. Never block on results. Discard windows with `GPU_DISJOINT_EXT`.
2. Fall back to rAF interval plus CPU work when the extension is absent or results stop arriving.
3. Feed a 30-frame rolling p95. Step down after 15 frames over threshold; panic-drop one or two levels after 3 consecutive missed refreshes.
4. Step up only after 3 to 5 seconds below the step-up threshold, one level at a time, with a 2-second cooldown. This asymmetry prevents visible oscillation.
5. Prefer this degradation order: reduce expensive iteration counts, feedback or blur resolution, then internal resolution, then per-layer rate. Keep final warp, blend and UI at native output resolution.
6. Change internal resolution in discrete steps, on a beat or during a crossfade where possible. Reuse pre-allocated render targets; never reallocate them during a performance.

Compile pattern:
- Enumerate every program a show can reach and link it at load behind a progress state. Render each with its real state into a 1x1 or 16x16 target to trigger backend pipeline creation.
- A cue may go live only when its program is ready and warmed. Otherwise keep the old look or crossfade to a safe look.
- Rate-limit background links, for example 2 per frame while playing, and record link durations in telemetry.
- Treat Chromium's disk cache as an optimisation only. Performance must pass from a cold cache after an app or OS update.

### Gaps
- No current Chromium or Apple document states exactly how Chromium's persistent cache interacts with ANGLE Metal pipeline creation. Measure cold and warm links on target machines.
- No authoritative source confirms the accuracy of `TIME_ELAPSED_EXT` on Apple tile-based GPUs. Whether it captures all deferred tile work should be validated against Xcode Metal tools.
- No first-party AMD or NVIDIA dynamic-resolution heuristic was found; Unreal and Unity are the sources used.

## Should an uber-shader be split into specialised programs?

### Takeaway
Use a hybrid: keep one prewarmed fallback for instant availability and compile specialised variants for the expensive, stable looks. Do not generate a full permutation matrix, and never let a parameter change trigger a synchronous compile.

### Cited Findings
- Godot's ubershader approach precompiles one pipeline, then builds optimised specialised variants in the background; this greatly reduces the pipelines needed up front, but Godot says it is not a perfect solution — [Godot](https://docs.godotengine.org/en/stable/tutorials/performance/pipeline_compilations.html)
- Godot's background variants do not stutter but can reduce frame rate when many compile at once — [Godot](https://docs.godotengine.org/en/stable/tutorials/performance/pipeline_compilations.html)
- Godot's OpenGL-based Compatibility renderer lacks that modern pipeline path and instead preloads materials by rendering them for a frame during loading — [Godot](https://docs.godotengine.org/en/stable/tutorials/performance/pipeline_compilations.html)
- Driver pipeline caches are usually deleted when the driver updates — [Godot](https://docs.godotengine.org/en/stable/tutorials/performance/pipeline_compilations.html)
- "Ubershader" can mean either one source compiled into many `#define` variants or one runtime-branching fallback; this comes from a forum discussion — [Hacker News mirror](https://hn.nuxt.dev/item/43114362)
- WebGL has no exposed program binary path in the local probe, so applications cannot ship or restore their own compiled variants.

### Inferences
| Approach | Strength | Cost | Use here |
|---|---|---|---|
| Single runtime-branching uber-shader | One link, instant control changes | Slower worst case, larger compile, harder GPU profiling | Safe fallback and rarely used combinations |
| `#define` specialised programs | Best per-frame cost for known looks | Link time, memory and permutation growth | Expensive fractal, kaleidoscope and feedback modes |
| Multi-pass modules | Separate cost control and resolution per pass | More targets and bandwidth | Bloom, feedback, colour, warp and safety |
| Hybrid | Instant switch, then optimise | Requires a ready-state system and visual-match tests | **Recommended** |

Split rules:
- Specialise on structural switches: iteration family, loop count tier, sample count, feedback on or off.
- Keep continuous controls as uniforms. A slider must never cause a link.
- Budget about 8 to 16 variants per major effect, chosen from actual presets. Beyond that, simplify features or use the fallback.
- Split when a variant saves at least 15% GPU time at show resolution, or removes a costly loop or texture path. Otherwise leave it merged.
- Swap variants only after ready and warmed, then require a pixel-difference test against the fallback so the swap cannot pop.

### Gaps
- No Metal/ANGLE benchmark was found comparing dynamic branching with specialised WebGL programs on Apple GPUs. The 15% threshold is a proposed decision rule and must be profiled.

## Output: resolution, multi-projector, LED, sync, video sharing, HDR and colour

### Takeaway
Electron can drive high-resolution multi-window SDR output, but it cannot provide verified frame lock across Mac outputs. For a seamless multi-projector blend, use one logical output through a hardware splitter or processor. Treat WebGL HDR, 10-bit end-to-end output and native Syphon/NDI as items requiring proof or native code.

### Cited Findings
**Resolution and limits**
- Local probe: max texture, renderbuffer and viewport are all 16384 on the M5 Pro.
- Electron offscreen shared-texture mode exposes GPU frames to native modules without a CPU copy; the default bitmap mode copies GPU to CPU — [Electron OSR](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)

**Sync and genlock**
- Apple's genlock setup requires macOS **27.2 Golden Gate or later** and supports Mac mini with M5 Pro, Mac Studio with M5 Max/Ultra, and MacBook Pro with M5 Pro/Max, with a compatible USB-C dock — [Apple](https://support.apple.com/en-us/148292)
- Apple's page describes camera and virtual-production sync with one background display and recommends a VRR display or projector. It does not address multiple displays — [Apple](https://support.apple.com/en-us/148292)
- A developer asked in August 2026 whether this can frame-lock several outputs; the thread had no Apple answer when read — [Apple Developer Forums](https://developer.apple.com/forums/thread/844198)
- Local probe: this machine has qualifying M5 Pro hardware but runs macOS 26.6.2, below Apple's stated requirement.
- A QLab community reply says true sync between separate displays needs genlock and suggests a hardware divider so the Mac sees one display; another thread lists Datapath, Matrox, AJA and Blackmagic options. These are practitioner sources — [QLab](https://groups.google.com/g/qlab/c/276mrGJBqwc); [QLab](https://groups.google.com/g/qlab/c/jIp4FOAgj00)

**Edge blending and black level**
- WATCHOUT says blend gamma depends on display technology, environment and projector black level, and should be tuned visually on full white — [Dataton](https://docs.dataton.com/watchout-7-new/watchout/displays-and-outputs/edge-blending.html)
- Its older guide gives a 1.1 correction example when Rec.709 content is decoded by a projector at gamma 2.4 — [Dataton](https://docs.dataton.com/guide/watchout/devices/edge-blending.html)
- Projector black adds up in overlaps — [JVRB paper](https://www.jvrb.org/jvrb/article/download/12.2015.4/pdf). GPU output cannot remove light emitted at zero input — [NVIDIA forum](https://forums.developer.nvidia.com/t/large-screen-warp-and-blend/65205)
- Epson's black-level adjustment reduces overlap differences; edge changes reset black level, so edges must be set first — [Epson](https://files.support.epson.com/docid/cpd5/cpd51321/source/adjustments/tasks/multi_projector_tasks/multi_projector_black_level_pl1000u_1505u.html)

**LED walls**
- Moire comes from interacting spatial grids, and higher refresh does not remove it; rolling shimmer is usually a refresh or sync problem. This is vendor guidance — [Dynamo LED](https://dynamo-led-displays.co.uk/led-screen-moire-on-camera-fixes/)
- Planar argues lower scan ratios such as 1:8 reduce dark banding on camera — [Planar](https://www.planar.com/blog/2023/lower-scan-means-higher-performance-for-on-camera-led/)
- Off-axis camera angles increase moire risk, and about 1.5 mm was described as a common broadcast pitch — [NewscastStudio](https://www.newscaststudio.com/2024/06/21/industry-insights-led-display-experts-shed-light-on-trends-innovations/)

**Syphon, Spout and NDI**
- On macOS, Electron's shared-texture handle is an `IOSurfaceRef`. Frames must be released promptly from the main process, the pool holds at most 10 frames, and the example imports them as 8-bit BGRA. The README describes Chromium 134 / Electron 35 — [Electron OSR README](https://raw.githubusercontent.com/electron/electron/main/shell/browser/osr/README.md)
- Syphon servers can publish IOSurface-backed frames — [syphon-core](https://docs.rs/crate/syphon-core/0.2.0)
- A forum source says NDI encodes on the CPU before network send — [TroikaTronix](https://community.troikatronix.com/post/48930)

**HDR and colour**
- `drawingBufferColorSpace` supports `srgb` and `display-p3` — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/drawingBufferColorSpace)
- Three.js discussion describes WebGL support as sRGB plus experimental Display P3 — [three.js PR](https://github.com/mrdoob/three.js/pull/31893)
- WebGL extended-range tone mapping was a proposal in Khronos and Chromium discussions — [Khronos PR](https://github.com/KhronosGroup/WebGL/pull/3668)
- Local probe: `drawingBufferStorage` exists, `drawingBufferColorSpace` exists, **`drawingBufferToneMapping` does not exist**, `EXT_color_buffer_float` exists, and CSS reports high dynamic range and P3 on this display.

### Inferences
| Capability | Status in Electron/WebGL on macOS | Spec decision |
|---|---|---|
| 4K60 output | Feasible, content-dependent | Primary supported target |
| 8K output | Canvas limit allows it; sustained 8K60 is unproven | Allow 8K canvas, but render heavy effects at 4K or lower and upscale |
| Multiple independent windows | Feasible | Good for separate surfaces; **not guaranteed frame-aligned** |
| Seamless blend across Mac outputs | No verified frame lock | Require one logical output into a splitter or processor |
| Apple genlock | OS/hardware-specific and documented for camera sync | Mark experimental; test before promising |
| Syphon | Requires native addon | Build only if routing to Resolume/MadMapper is a real need |
| Spout | Windows technology | Not applicable to macOS |
| NDI | Requires SDK/native encoder and adds latency | Monitoring or secondary feed only |
| Extended-range HDR in WebGL | **Not available in the local probe** | Do not promise. Render internally in RGBA16F and tone-map to SDR |
| 10-bit scanout | Unverified | Keep 16F internally, dither before output, test with a ramp and a capture device |
| P3 | API available | Offer per-output sRGB/P3 choice, default sRGB unless calibrated |

Output pipeline:
1. Render in linear RGBA16F.
2. Apply photosensitive limiter, tone map and output transform.
3. Apply warp, then blend ramps in linear light, then per-output gamma.
4. Add triangular-PDF dither at about 1 LSB of the output depth.
5. Present, with no browser-level scaling.

Per-output calibration fields: peak nits, black nits, EOTF gamma, blend gamma per channel, colour space, overlap geometry and optional black-lift mask. Black lift should raise non-overlap regions to match the overlap and be stored separately for each projector.

### Gaps
- Resolume's Apple Silicon sync thread returned HTTP 403. TouchDesigner, Notch and disguise documentation were not verified in this pass, so no competitor capability claims are made here.
- It remains unverified whether Electron 45 can route an RGBA16F WebGL canvas to a true 10-bit display path on macOS.
- It remains unverified whether Chromium's presentation of multiple windows can align across displays, even with genlock.
- The local WebGPU check ran on `about:blank`, so its negative result says nothing about WebGPU availability on the app's real origin.

## Installation reliability

### Takeaway
A weeks-long install needs three independent recovery layers: in-page WebGL recovery, Electron process recovery, and an OS supervisor. The current repo has part of the first layer, but an output renderer crash closes the output window rather than restoring the picture.

### Cited Findings
- Electron's `child-process-gone` reports GPU process exits and reasons including crashed, OOM, killed and launch-failed; renderer exits are separate — [Electron app](https://www.electronjs.org/docs/latest/api/app)
- Chromium can block 3D APIs per domain after repeated GPU crashes; `app.disableDomainBlockingFor3DAPIs()` disables that and must be called before ready — [Electron app](https://www.electronjs.org/docs/latest/api/app)
- `app.relaunch()` does not quit by itself; `app.quit()` or `app.exit()` must follow — [Electron app](https://www.electronjs.org/docs/latest/api/app)
- Reloading from `render-process-gone` could crash older Electron because the event fired during process-death handling; a fix defers it by one task and was backported to some branches — [Electron PR 51918](https://releases.electronjs.org/pr/51918)
- `prevent-display-sleep` keeps both system and display active — [Electron powerSaveBlocker](https://www.electronjs.org/docs/latest/api/power-save-blocker)
- `backgroundThrottling: false` keeps visibility `visible`, but the docs include a macOS occlusion caveat — [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- `win.kiosk`, `setKiosk`, `setSimpleFullScreen`, and `unresponsive`/`responsive` events are available — [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- launchd `KeepAlive` can restart jobs, and `SuccessfulExit: false` restarts only after a failed exit — [Apple launchd](https://developer.apple.com/library/mac/documentation/macosx/conceptual/bpsystemstartup/Chapters/CreatingLaunchdJobs.html)
- `pmset autorestart` controls restart after power loss — [pmset](https://en.wikipedia.org/wiki/Pmset)
- A long-running installation guide recommends disabling update interruptions and sleep, using auto-login with a standard account, launchd keep-alive, scheduled reboots, remote access and monitoring. It targets old OS X releases — [installation_up_4evr](https://github.com/juxtapix/installation_up_4evr)
- Apple exposes thermal state through `ProcessInfo` and change notifications — [Apple](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum.md). A third-party write-up reports the public states are coarse for detecting the onset of throttling — [MacThrottle write-up](https://stanislas.blog/2025/12/macos-thermal-throttling-app/)
- A developer reports macOS can choose GPU performance states poorly for latency-sensitive work, and asks for a control; that is a request rather than a shipped API — [Apple Developer Forums](https://developer.apple.com/forums/thread/768160)
- Repo: `src/map/compositor.ts` handles `webglcontextlost` for map instruments, drops the source to its colour and retries after 5 s.
- Repo: `electron/output-window.cjs` closes the output window on `render-process-gone`, and **Escape closes the output**.
- Repo: no `child-process-gone`, `disableDomainBlockingFor3DAPIs`, `webglcontextrestored`, or `unresponsive` handling was found in `electron/` or `src/`. `LiveRenderer` has no context-loss handler in the searched code.

### Inferences
Priority fixes for this repo:
1. Add an **Installation mode** in which a renderer crash recreates the output on the same display and restores the last show state, rather than closing it.
2. Disable or guard Escape in that mode, for example with a long-press plus operator confirmation.
3. Add context-loss handling to `LiveRenderer` and the final compositor, not only instrument slots.
4. Handle GPU `child-process-gone`, with escalation.

Recovery ladder:

| Failure | Detection | Action | Target to picture |
|---|---|---|---|
| Single source fails | Shader or render error | Crossfade that source to safe look | Under 1 frame to fallback |
| WebGL context lost | `webglcontextlost` | `preventDefault`, show CSS/black safe state, rebuild GPU resources on restore | Under 3 s |
| No restore | 5 s timer | Replace canvas and rebuild | Under 5 s |
| Renderer stuck | No heartbeat for 3 s, or `unresponsive` | Reload output, restore state | Under 8 s |
| Renderer gone | `render-process-gone` | Deferred recreate | Under 8 s |
| GPU process gone | `child-process-gone` | Recreate outputs; after 3 in 10 minutes relaunch app | Under 15 s |
| Main process hung | External heartbeat file or socket stale for 15 s | Supervisor kills and relaunches | Under 30 s |
| Crash loop | 5 restarts in 15 minutes | Static safe look, alert, stop escalating | Immediate |
| Power loss | `pmset autorestart`, auto-login, launch agent | Boot directly into last validated show | Under 3 min, measured |

Long-run soak gates:
- 72-hour pass before any show; **14-day soak** before a permanent installation.
- JS heap, GPU-related process memory and texture/render-target counts must plateau. Fail if the post-warmup trend exceeds 1 MB/hour or memory grows over 10%.
- Inject faults during soak: `WEBGL_lose_context` (locally available), renderer kill, GPU process kill, display unplug/replug, network loss and power cut.
- Persist show state atomically every 5 to 10 seconds and keep the last known-good copy.

Telemetry once per 10 seconds: FPS, p95/p99 GPU and CPU time, missed frames, governor level, context losses, process restarts, memory, thermal state, display configuration and a low-resolution thumbnail. Keep a local rolling log. Remote monitoring should be outbound-only or on a private VPN, with a dead-man alert if heartbeats stop.

Thermal policy: at `.fair`, cap governor recovery; at `.serious`, lower quality by one level and alert; at `.critical`, move to low-cost safe look. Electron needs a small native helper or addon to read this state. Also watch for a sustained GPU-time rise with unchanged content, since thermal state alone may respond late.

Fallback look: a pre-linked, low-cost, non-flashing shader with slow motion and bounded luminance, plus a static image if WebGL cannot start.

### Gaps
- No reliable published uptime figures were found for Electron/WebGL installations. Reliability must be established with the soak test.
- It is unverified whether Electron 45.2.3 contains the deferred `render-process-gone` fix, because the found PRs named branches 41 and 43. Defer recovery by one task regardless.
- Exact current behaviour of auto-login, FileVault and LaunchAgents after power loss should be tested on the target macOS. FileVault can prevent an unattended boot from reaching the user session, and this needs verification on the deployed configuration.
- Public APIs for GPU clock or throttle percentage on Apple Silicon were not found.

## Photosensitive safety and automatic flash limiting

### Takeaway
Build a mandatory final-stage limiter using the strictest practical rule: no more than 3 flashes per second, with a 360 ms minimum interval for full-area strobes and tighter handling of saturated red. A limiter reduces risk but cannot certify safety; broadcast or recorded deliverables still need a dedicated analyser such as Harding.

### Cited Findings
- **ITU-R BT.1702-3 (11/2023, in force):** a flash is a pair of opposing luminance changes. If the darker image is below 160 cd/m², the threshold is a difference of 20 cd/m² or more, for SDR and HDR — [ITU](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf)
- At 160 cd/m² or above, the BT.1702-3 HDR threshold is Michelson contrast above 1/17, where contrast is `(Lhigh-Llow)/(Lhigh+Llow)`. The Recommendation says this clause is for HDR programmes only — [ITU](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf)
- A transition to or from saturated red is potentially harmful irrespective of luminance — [ITU](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf)
- A flash sequence is not permitted when concurrent flashing covers more than 25% of the displayed area **and** there are more than 3 flashes in any one-second period — [ITU](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf)
- Successive flashes with leading edges at least 360 ms apart (50 Hz) or 334 ms apart (60 Hz) are acceptable irrespective of brightness or area — [ITU](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf)
- Fast cuts count if they create flashing areas. Flashing lasting more than 5 seconds might constitute a risk even when compliant — [ITU](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf)
- Pattern guidance: more than 5 light-dark stripe pairs may be harmful when stationary over 40% of the screen, or moving, oscillating, flashing or reversing over 25%. Stripes may be parallel, **radial**, curved or dot rows; smooth one-direction flow is exempt — [ITU](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf)
- BT.1702 assumes SDR peak white of 200 cd/m² and HLG peak white of 1,000 cd/m² for measurements — [ITU](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf)
- The Ofcom-hosted legacy ITC guidance has the same core 20 and 160 cd/m², quarter-screen, 3-flash and 5-second structure, with flashes 9 frames apart acceptable — [Ofcom/ITC](https://www.ofcom.org.uk/__data/assets/pdf_file/0021/16248/gn_flash.pdf)
- Ofcom Rule 2.12 requires TV broadcasters to take precautions for viewers with photosensitive epilepsy — [Ofcom Broadcast Code Section 2](https://www.ofcom.org.uk/__data/assets/pdf_file/0020/132077/Broadcast-Code-Section-2.pdf)
- **WCAG 2.2 SC 2.3.1:** general flash is an opposing relative-luminance change of 10% or more of maximum, with the darker image below 0.80. Saturated red is `R/(R+G+B) >= 0.8`, with a chromaticity difference above 0.2 — [W3C](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)
- WCAG's small-area allowance is 0.006 steradians, equal to 25% of a 10-degree field. Fine balanced patterns with squares below 0.1 degree are excepted — [W3C](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)
- Xbox guidance suggests reducing contrast, frequency and flashing area — [Microsoft](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/118)
- Cambridge Research Systems' Flash and Pattern Legaliser applies minimum corrections for luminance, red, extended flashing and patterns, with latency under 5 seconds; the literature is older — [Harding data sheet](https://www.hardingfpa.com/assets/Downloads/WEB%20Harding%20Data%20Sheets_Flash_Pattern%20Legaliser.pdf)
- Apple's flicker-reduction work is causal and reduces luminance and contrast during detected segments — [Apple](https://developer.apple.com/accessibility/downloads/Video-Flashing-Reduction-12.pdf)
- A 2025 preprint says there is a lack of efficient real-time mitigation and argues WCAG 2.3.1 alone does not fully mitigate risk — [arXiv](https://arxiv.org/pdf/2507.19692v1)
- The ASA has cautioned that automated test equipment did not guarantee compliance — [ASA](https://www.asa.org.uk/rulings/citroen-uk-ltd-a11-164759.html)

### Inferences
**Why TV percentages are not enough for venues:** 20 cd/m² is 10% of the 200-nit reference, but only 1.3% of a 1,500-nit LED wall. Use calibrated nits when available: `deltaThreshold = min(0.10, 20 / outputPeakNits)` in linear relative luminance. If peak is unknown, assume 1,000 nits for LED (2%) and use the 10% rule only for a verified projector below 200 nits.

Screen percentage is also weak for large surfaces. WCAG's 0.006 sr equals `0.006 x distance²`: 0.054 m² at 3 m, 0.15 m² at 5 m, 0.6 m² at 10 m. On a 6 x 3.4 m wall, 25% is 5.1 m², but the 10 m angular allowance is only about 2.9% of the wall. Installation profiles should store nearest viewer distance and use the smaller area limit.

Default limiter policy:

| Item | Default limit |
|---|---|
| Full-field or large-area flash spacing | 360 ms minimum between leading edges (about 2.7 Hz with frame rounding) |
| Frames at 50 / 60 / 120 Hz | 18 / 22 / 44 frames |
| Flash count | Max 3 in any rolling 1,000 ms; target 2 for automatic content |
| Flashing area | Min of 25% of output and the angular limit when distance is known |
| Saturated red | Block rapid transitions over the area limit; prefer max 1 red flash per second |
| Sustained activity | After 5 s near limit, reduce contrast and hold below threshold for at least 10 s (proposed recovery) |
| Patterns | Detect >5 pairs over 25% if reversing/oscillating, over 40% if static |
| Bypass | No silent bypass. Explicit per-show unlock, visible warning, logged, resets on launch |

Beat mapping: at 128 BPM a quarter note is 469 ms and safe, while an eighth note is 234 ms and must be limited. Above about 167 BPM, even quarter-note full-screen hits fall below 360 ms, so strobes should automatically move to half-time.

Limiter architecture:
1. **Prevention at control level.** Strobe, palette inversion, hard cuts and audio-triggered white hits pass through a shared rate gate. Audio reactivity must never directly drive full-field luminance.
2. **Measurement on the final image.** Render a linear luminance and red-state grid, about 32x18 tiles, after all compositing and before warp. Warped output can use per-surface area weights.
3. **Same-frame enforcement.** Avoid CPU readback latency for the critical path. Keep tile state in GPU textures: last extreme, direction and recent transition times. Compute tile gain in the current frame.
4. **Correction.** If a transition would exceed the count and area limit, first hold the tile near the previous displayed luminance, then ease back over 250 to 500 ms. Reduce contrast toward local mean; do not simply black out, since that creates another flash. Desaturate saturated red toward a safer neighbouring chroma.
5. **Patterns.** Run a coarse detector for repeated light-dark zero crossings, including polar analysis around kaleidoscope centres. On detection, reduce contrast, soften high frequency or enforce smooth one-way motion. This is especially relevant to radial kaleidoscope and tunnel effects.
6. **Operator feedback.** Show limiter activity, reason and percentage reduction. Log events with timestamps.

Validation: test with synthetic sequences at 2, 3, 4, 10 and 30 Hz; white/black, red/black, red/cyan, partial area and radial stripes. Record final output and run a recognised analyser for broadcast or recorded material. Add a venue warning when strobing is artistically intended.

### Gaps
- BT.1702 and Ofcom are written for television, while WCAG is for web content. No authoritative standard was confirmed for live VJ walls, projection mapping or immersive rooms.
- Local venue, event-safety and strobe-warning law was not researched and needs jurisdiction-specific review.
- No published, validated real-time WebGL limiter was found. The architecture above is proposed and must not be described as Harding-compliant without independent testing.
- BT.1702's Michelson rule is explicitly for HDR programmes. Applying it to bright SDR LED walls is a conservative inference, not a stated requirement.

## Visual artefacts on real LED walls and projectors

### Takeaway
Treat each physical output's pixel grid as the Nyquist limit. Fractal detail, kaleidoscope seams and thin moving lines must be band-limited in the shader and checked at native output on real hardware, because a good-looking laptop preview does not predict LED or projector behaviour.

### Cited Findings
- LED moire results from grid interaction; pixel pitch is the main physical lever, and refresh rate does not cure spatial moire — [Dynamo LED](https://dynamo-led-displays.co.uk/led-screen-moire-on-camera-fixes/)
- Scan ratio affects on-camera dark banding, per Planar's vendor analysis — [Planar](https://www.planar.com/blog/2023/lower-scan-means-higher-performance-for-on-camera-led/)
- Off-axis shots raise moire risk — [NewscastStudio](https://www.newscaststudio.com/2024/06/21/industry-insights-led-display-experts-shed-light-on-trends-innovations/)
- Software cannot remove the projector's zero-input light — [NVIDIA forum](https://forums.developer.nvidia.com/t/large-screen-warp-and-blend/65205)
- Black overlap is a physical additive problem — [JVRB paper](https://www.jvrb.org/jvrb/article/download/12.2015.4/pdf)
- Repo: `LiveRenderer` and `StudioRenderer` use `antialias: false` and `setPixelRatio(1)`, so line quality must come from shader filtering or explicit supersampling.

### Inferences
Proposed content rules at native output pixels:

| Artefact | Rule |
|---|---|
| Fine lines | Minimum 2 px wide for moving bright lines; 3 px on low-resolution LED or in high contrast |
| Line edges | Analytic AA with `fwidth`/distance fields, with a transition of about 1 to 1.5 px |
| Spatial frequency | Full-contrast periodic detail no finer than 4 px per light-dark cycle; fade contrast toward zero by 2 to 3 px per cycle |
| Fractals | Iteration and detail LOD from pixel footprint; fade orbit detail before subpixel; use smooth escape values |
| Kaleidoscope seams | Mirror in continuous coordinates, derive filter width before folding, avoid seam discontinuities |
| Temporal shimmer | Limit per-pixel luminance change for subpixel features; use stable noise and optional 2x supersampling on hero layers |
| Feedback | Clamp energy, apply tiny decay and filter so it cannot accumulate into flashing or blowout |
| Dark gradients | 16F internal, dithered final output, avoid crushed near-black animation on LED |
| Projector black | Never rely on true black. Use compensated overlap masks and keep some visual energy away from seams |
| Camera shows | Offer a camera-safe profile with reduced high-frequency contrast and fixed output rate; test the actual camera and shutter |

Hardware acceptance pattern set: 1 px and 2 px grids, moving diagonal lines, zone plate, radial star, near-black ramp, full-range ramp, solid colours, white/black blend, overlap alignment grid, and a timing bar across every output. Inspect at the nearest and farthest audience positions, and through any camera used for IMAG or streaming.

### Gaps
- No authoritative numeric minimum line width for LED walls or projectors was found. The table is an engineering starting point based on sampling limits and must be tuned per display.
- LED processor behaviour (scaling, low-grey processing, scan and refresh settings) is model-specific and was not surveyed.
- Most LED sources here are manufacturer or trade material with commercial interests.
