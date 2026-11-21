# Show readiness for a browser/Electron three.js VJ app (Oscilloscope and Ember Pulse)

Research date: 2026-11-21. Evidence labels used in the checklist: **[STD]** = a published standard or regulator limit; **[VENDOR]** = a product or manufacturer document; **[PROPOSED]** = an engineering target derived in these notes, with no external authority. Proposed numbers are starting gates and should be tightened after measurement.

Repo facts were read from the working tree on branch `map-stage-1` (Electron 45.2.3, Chromium 156.0.8078.80, three 0.187.0). No effect named "Ember Pulse" exists in `src/` (a case-insensitive search found none; related presets are Ember Ring, Ember Cells and Ember Julia in `src/core/project.ts`). These notes assume Ember Pulse is a warm, red-orange, potentially full-field pulsing effect. If that is wrong, the red-flash conclusions need rechecking.

## What is the concrete, testable performance-readiness checklist?

### Takeaway
Ship in three gates: **Safe** (flash limiter, panic, recovery), **Show** (pacing, sync, display checks) and **Install** (soak, watchdog, remote health). Only the flash limits and A/V thresholds come directly from standards; most reliability numbers are proposed engineering gates.

### Cited Findings
- Flash limits: more than three flashes in any second over more than 25% of the screen is not permitted; luminance trigger is a 20 cd/m2 difference when the darker image is below 160 cd/m2 — [ITU-R BT.1702-3](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf)
- A/V detectability is about +45 ms (sound early) to -125 ms (sound late); acceptability is about +90 ms to -185 ms — [ITU-R BT.1359-1](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1359-1-199811-I!!PDF-E.pdf)
- Chromium can block WebGL for a domain until restart after repeated GPU process crashes, and Electron exposes a switch to disable this — [Electron app API](https://www.electronjs.org/docs/latest/api/app)

### Inferences

**Gate 1: Safe (blocks any public use)**

| # | Test | Pass | Basis |
|---|---|---|---|
| S1 | Feed a 10 Hz full-field white strobe through output | Measured leading edges never closer than 360 ms when area above 25% | [STD] 334 ms at 60 Hz, 360 ms at 50 Hz; 360 ms used everywhere as the conservative value |
| S2 | Same with saturated red at low luminance | Limiter still engages | [STD] red applies irrespective of luminance |
| S3 | Sweep BPM 60 to 200 with beat-locked pulse | Pulse halves its rate rather than exceeding limit; no burst at tempo change | [PROPOSED] |
| S4 | Sustained compliant flashing | Warning at 5 s; automatic reduction after a configured limit | [STD] for the 5 s caution; the action is [PROPOSED] |
| S5 | Stripe test: more than 5 light-dark pairs, oscillating, over 25% area | Contrast reduced or flagged | [STD] informative attachment |
| S6 | Limiter configured with measured wall peak nits (200, 1000, 1500) | Trigger follows real cd/m2, not code value | [PROPOSED] from the standard's cd/m2 basis |
| S7 | Panic from any UI state, keyboard, and external controller | Black at output within 2 frames; held through preset changes and restart | [PROPOSED] |
| S8 | Limiter bypass | Needs deliberate, logged, per-session unlock; resets to on at launch | [PROPOSED] |
| S9 | Offline render of each shipped preset through an analyser | Zero violations, report archived; Harding-class check before broadcast use | [STD] analysers recommended; product choice open |

**Gate 2: Show**

| # | Test | Pass at 60 Hz | Pass at 120 Hz | Basis |
|---|---|---|---|---|
| P1 | GPU + CPU frame time, worst preset at output resolution | p99 at most 11.7 ms | p99 at most 5.8 ms | [PROPOSED] 70% of budget |
| P2 | Missed presents over 60 min | At most 1 per 1000, never 2 consecutive | Same | [PROPOSED] |
| P3 | Reactive audio onset to photon (photodiode + mic) | p95 at most 45 ms; fail above 90 ms | Same | [STD] thresholds; TV-derived |
| P4 | Clocked beat (Link/MIDI clock) to photon, with latency offset | Within +/-1 frame (16.7 ms) | Within +/-8.3 ms | [PROPOSED] |
| P5 | Adaptive quality step during a slow gradient | No visible step in A/B capture; resolution changes eased over at least 500 ms or at a cut | Same | [PROPOSED] |
| P6 | Control input to visible change | p95 at most 50 ms | At most 33 ms | [PROPOSED] |
| P7 | Low-grey ramp 0 to 10% on the actual wall | No banding or colour shift at show brightness; dither enabled | Same | [VENDOR] test at operating brightness |
| P8 | Camera test if filmed: 50% grey, pan/tilt, at show shutter | No rolling bands | Same | [VENDOR] |
| P9 | One-pixel lines and scope trace on actual pixel pitch | Trace stays legible, no shimmer or moire at the audience position and on camera | Same | [PROPOSED] |

**Gate 3: Install**

| # | Test | Pass | Basis |
|---|---|---|---|
| I1 | Soak | 72 h before any install; 14 days before handover | [PROPOSED] |
| I2 | Memory after 1 h warm-up | JS heap, GPU process and texture count show no sustained growth; slope below 1 MB/h | [PROPOSED] |
| I3 | Force context loss 100 times (`WEBGL_lose_context`) | 100 recoveries, picture back within 3 s | [PROPOSED] |
| I4 | Kill renderer process, then GPU process, 20 times each | Picture back within 10 s, state restored | [PROPOSED] |
| I5 | Hard power cut | Boots unattended to the correct scene within 120 s | [PROPOSED] |
| I6 | Unplug and replug display; change resolution | Output returns to the right display and mapping | [PROPOSED] |
| I7 | Hung renderer (infinite loop) | Watchdog detects within 5 s, restarts | [PROPOSED] |
| I8 | Remote health | Heartbeat, FPS, GPU, memory, restart count, last error; alert within 60 s | [PROPOSED] |
| I9 | Schedule | On/off and dark hours survive reboot, DST and clock change | [PROPOSED] |
| I10 | Static-content audit | No fixed logo or UI element; slow drift enabled on emissive panels | [VENDOR] for OLED |

**Top gaps in the current app, in order** (from reading the code; none has been run or tested here):
1. No flash or pattern limiter found. A search of `src` and `electron` for strobe/photosensitive handling found only a comment about palette cycling in `src/core/project.ts:590`.
2. A crashed output renderer closes the window (`electron/output-window.cjs:31`). No `app.relaunch`, `child-process-gone`, `unresponsive` or `disableDomainBlockingFor3DAPIs` use was found in the non-test Electron files. Another path could reopen the window; this was not traced.
3. Context-loss handling exists only in `src/map/compositor.ts:253`. No `webglcontextrestored` listener exists in `src` or `electron`. three.js's internal handling was not assessed.
4. Blackout is applied as a shader uniform (`src/live/LiveRenderer.ts:136`), so it depends on the render loop still running. A hung renderer may be unable to go black.
5. Escape in the output window closes it (`electron/output-window.cjs`). That is a risky single-key failure during a show.
6. No Art-Net, sACN, Syphon, Spout, NDI, Link, Web MIDI or timecode code was found, and no use of `AudioContext.outputLatency`.

Already sound: `backgroundThrottling: false`, `prevent-display-sleep`, black window background, sandboxed output windows, and Blackout, test grid and freeze controls.

### Gaps
- No published standard defines frame-pacing, soak or recovery targets for VJ software. Those gates are proposals.

## Frame pacing and latency: what should the targets be?

### Takeaway
Reactive visuals cannot reliably beat the 45 ms detectability limit through a full display chain at 60 Hz, so beat-critical effects should use a clock and schedule ahead. Multi-machine frame lock is unrealistic in Electron; single-machine stable pacing is the practical goal.

### Cited Findings
- BT.1359 reports detectability at about +45/-125 ms and acceptability at about +90/-185 ms, where positive means sound is early. It recommends a +25/-100 ms zone for its broadcast chain — [ITU-R BT.1359-1](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1359-1-199811-I!!PDF-E.pdf)
- ATSC IS-191 figures are reported inconsistently in secondary sources: +30/-90 ms in [one TV Technology article](https://tvtechnology.com/opinions/atsc-recommends-av-sync-rules), and +15/-45 ms in [another](https://www.tvtechnology.com/opinions/av-synchronization-how-bad-is-bad). The primary document was not read.
- Link's test guidance expects audio onsets to align with peers within 3 ms, rechecked after output latency changes — [Ableton Link](https://ableton.github.io/link/)
- `AudioContext.outputLatency` estimates the delay from the audio graph to the output device, and is Baseline since March 2025 — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)
- Genlock aligns refresh intervals; hardware frame lock makes all displays update only when all are ready. Frame lock needs NVIDIA professional GPUs plus Quadro Sync, reduces performance, and is not fault tolerant: one machine dropping frames forces all to drop — [TouchDesigner Hardware Frame Lock](https://derivative.ca/UserGuide/Hardware_Frame_Lock)
- disguise distinguishes genlock (external reference) from framelock (internal GPU sync across a server's outputs) — [disguise Genlock Configuration](https://help.disguise.one/designer/configuration/genlock-configuration)
- TouchDesigner exposes dropped frames per frame through the Perform CHOP — [Perform CHOP](https://derivative.ca/UserGuide/Perform_CHOP)
- There is no web API that reports the hardware vsync rate, so developers must infer it — [W3C web-perf thread, 2024](https://lists.w3.org/Archives/Public/public-web-perf/2024Sep/0005.html)
- Developers report stutter on macOS with multiple displays attached, removed by using one display — [Apple Developer Forums](https://developer.apple.com/forums/thread/112468) (anecdotal, older)

### Inferences
- Frame budgets: 16.67 ms at 60 Hz, 8.33 ms at 120 Hz, 20 ms at 50 Hz.
- Illustrative reactive chain at 60 Hz: 5.3 ms audio buffer (256 samples at 48 kHz) + about 10.7 ms analysis delay (1024-point window) + 8.3 ms average wait + 16.7 ms render + 16.7 ms compositor + 8.3 ms scan to mid-screen + 16.7 ms for one frame in an LED processor = **about 83 ms**. This is an estimate to be replaced by photodiode measurement. It is inside acceptability but outside detectability for a viewer next to the speakers.
- Sound travels about 2.9 ms per metre, so late picture is partly hidden for distant viewers: at 15 m sound arrives about 44 ms after leaving the PA. The front row is the worst case, so measure there.
- BT.1359 is about television lip sync. Percussive music with hard visual onsets may be less forgiving, so treat 45 ms as a target, not proof of perceived sync.
- Use **two timing modes**: reactive (envelope follower for texture and energy) and clocked (Link, MIDI clock or tap, scheduled ahead by measured latency) for Ember Pulse hits.
- On a missed frame, advance animation by real elapsed time, never queue catch-up frames. Oscilloscope phase should be derived from the audio clock so it cannot drift.
- Adaptive quality should change in this order: feedback/bloom sample count, then internal resolution in small eased steps, and never trace line width or palette. Apply larger changes on a beat or cut, with hysteresis (for example, drop after 500 ms over budget, recover after 10 s under).

### Gaps
- No authoritative concert-specific audio-to-photon threshold was found.
- No source confirmed how Chromium 156 paces rAF on mixed-refresh multi-display systems. Test on target hardware.
- Chromium's `desynchronized` canvas behaviour for this use was not established.

## Professional integration: which protocols matter, and which are realistic?

### Takeaway
Build in this order: **MIDI and MIDI clock, OSC, Ableton Link, Art-Net/sACN output, Syphon/Spout, NDI, LTC/MTC**. ST 2110 and true genlock should be left to external hardware. HAP is irrelevant to these two generative effects unless clip playback is added.

### Cited Findings
- Web MIDI needs a secure context and user permission, and is not Baseline across browsers — [MDN Web MIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API)
- MIDI Timing Clock is sent 24 times per quarter note — [MIDI 1.0 real-time message summary](https://www.personal.kent.edu/~sbirch/Music_Production/MP-II/MIDI/midi_system_real.htm) (secondary reproduction)
- MTC uses Quarter Frame and Full messages — [MIDI Association](https://midi.org/?p=1438)
- Link syncs tempo, beat and phase on a local network, with start/stop in version 3; documented through a C++ library and iOS SDK — [Ableton Link](https://ableton.github.io/link/)
- A full 512-slot DMX packet takes about 22.7 ms, or about 44 updates per second — [ENTTEC](https://support.enttec.com/dmx/dmx-basics/what-is-dmx512)
- MadMapper advertises Art-Net 4 and sACN with universe synchronisation — [MadMapper features](https://madmapper.com/madmapper/features)
- Electron's GPU shared-texture offscreen mode needs a native module to use the texture in your own code — [Electron offscreen rendering](https://electronjs.org/docs/latest/api/structures/offscreen-shared-texture). The `sharedTexture` send API is marked experimental — [Electron sharedTexture](https://electronjs.org/docs/latest/api/shared-texture)
- NDI offers genlock functions in its Advanced SDK — [NDI docs](https://docs.ndi.video/all/developing-with-ndi/advanced-sdk/genlock). Published bandwidth for 1080p60 ranges from about 100 Mbps ([Magewell](https://magewell.com/blog/30/detail)) to about 150 Mbps ([NDI](https://ndi.video/tech/formats)).
- HAP is an open GPU-decoded codec family used by media servers including VDMX, disguise and TouchDesigner — [HAP](https://hap.video/)

### Inferences

| Protocol | Value for these effects | Electron path | Priority |
|---|---|---|---|
| MIDI / MIDI clock | High: macros, tap, tempo | Web MIDI | 1 |
| OSC | High: show-control integration | UDP in main process | 1 |
| Ableton Link | High: Ember Pulse hits | Native addon | 2 |
| Art-Net / sACN | High for LED pixels and syncing lights to Ember Pulse | UDP in main process, sampled from a low-res readback | 2 |
| Syphon / Spout | High: feeds Resolume, MadMapper, TouchDesigner | Native addon; platform-specific | 3 |
| NDI | Medium: flexible but adds latency; avoid for beat-critical path | Native SDK, licence review | 4 |
| LTC / MTC | Medium for timed shows and installs; low for improvised VJ sets | MTC through Web MIDI; LTC decoded from audio input | 4 |
| Genlock / frame lock | Needed for multi-server walls and some camera work | Not exposed to WebGL; rely on the LED processor or a media server | Do not build |
| ST 2110 | Broadcast facilities only | Use an external gateway | Do not build |
| HAP | Clip playback only | Not needed for generative effects | Later |

- Any DMX output path must apply the same flash limiter, because lights can break the safety limits independently of the video.
- A 512-channel universe carries 170 whole RGB pixels (512 / 3) at about 44 Hz, so Oscilloscope needs a dedicated low-res mode for pixel tape.

### Gaps
- No maintained Electron addon for Syphon, Spout, NDI or Link was verified.
- The Art-Net 4 and ST 2110 primary specifications were not read.
- Art-Net guidance conflicts on its status relative to sACN: [ETC](https://support.etcconnect.com/ETC/FAQ/History_of_Art-Net) describes deprecation in favour of sACN, while [Artistic Licence](https://artisticlicence.com/pages/art-net-overview) describes complementary use.

## Display realities: what breaks on projectors and LED walls?

### Takeaway
Dark, slow-moving gradients and thin bright lines are the hardest content, which is exactly what Ember Pulse decay tails and Oscilloscope traces produce. Every look must be judged on the real surface at show brightness.

### Cited Findings
- Ambient light can collapse projected contrast: about 2 foot-candles on the screen can reduce it below 10:1 — [Live Design](https://www.livedesignonline.com/display-killer-projected-images)
- Total environmental dynamic range = screen brightness / (projector black level + reflected ambient light) — [Live Design](https://www.livedesignonline.com/display-killer-projected-images)
- ANSI contrast uses a simultaneous checkerboard of 8 white and 8 black squares — [Barco](https://assets.barco.com/m/7f458cbdce2ad3e4/original/ANSI-Contrast-pdf.pdf)
- LED scan ratio is the number of lines a driver IC controls. Lower ratios allow higher refresh, more PWM bits, or both, and reduce low-brightness camera artefacts — [Planar, 2023](https://www.planar.com/blog/2023/lower-scan-means-higher-performance-for-on-camera-led/)
- On dark content, effective LED refresh falls and different sensor regions can capture different pulse counts, producing dark bands — [Planar, 2023](https://www.planar.com/blog/2023/lower-scan-means-higher-performance-for-on-camera-led/)
- 3840 Hz is a common vendor minimum — [Learn Stage Lighting](https://learnstagelighting.com/blog/what-refresh-rate-do-i-need-in-an-led-wall). One industry speaker argues for 7680 Hz — [Broadcast Bridge / HPA](https://www.thebroadcastbridge.com/content/entry/18265/creative-technology-hpa-review-led-walls-with-gary-feather/?cat_id=8)
- Dimming a wall can also reduce its actual refresh — [Learn Stage Lighting](https://learnstagelighting.com/blog/what-refresh-rate-do-i-need-in-an-led-wall)
- Moire comes from interference between the LED grid and the camera pixel grid, and worsens with low fill factor — [Broadcast Bridge / HPA](https://www.thebroadcastbridge.com/content/entry/18265/creative-technology-hpa-review-led-walls-with-gary-feather/?cat_id=8)
- Camera banding appears when shutter and display are not synchronised; genlock and phase adjustment are the standard remedies — [Bournemouth University white paper](https://eprints.bournemouth.ac.uk/36826/1/LED_Comparison_White_Paper%281%29.pdf); [Dynamo](https://dynamo-led-displays.co.uk/led-display-performance-refresh-rate-contrast-colour/)
- WebGL `drawingBufferColorSpace` accepts `srgb` (default) and `display-p3` — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/drawingBufferColorSpace)
- WebGPU canvas HDR uses `rgba16float` with `toneMapping: { mode: "extended" }`, added in Chrome 129 — [Chrome for Developers](https://developer.chrome.com/blog/new-in-webgpu-129)

### Inferences
- **Colour:** default to Rec.709/sRGB-primaries SDR, which is what most show pipelines expect. Offer P3 only as an explicit output option. Do not build Rec.2020 or HDR output for this phase: WebGL's documented options stop at P3, and a venue HDR chain would need separate validation.
- **Bit depth:** keep internal buffers floating point and add blue-noise or triangular dither at the final 8-bit quantise. Ember decay tails should not rely on the last few code values.
- **Black floor:** a "black" that is black on an LED wall is visibly grey on a projector. Provide per-output black level, gamma and peak trim, plus a low-grey test pattern.
- **Low-res canvases:** add a pixel-mapped preview at true output resolution. Scope line width should be specified in output pixels, with a minimum around 2 px and analytic anti-aliasing, so traces do not crawl.
- **Camera mode:** keep large areas above the lowest grey levels, avoid high-frequency static grids, and offer a frame-rate-aware pulse option.

### Gaps
- No independent measured comparison of 3840 Hz and 7680 Hz at low grey was found. Most LED sources are vendor material.
- No authoritative foot-lambert target for projection mapping was found.
- Whether Electron 45 passes a 10-bit or HDR canvas intact to a specific output was not tested.

## Safety: what are the photosensitive limits and how should a limiter work?

### Takeaway
Use **ITU-R BT.1702-3** as the engineering baseline, implemented in **measured cd/m2**, with a **360 ms minimum between flash leading edges** whenever the flash area exceeds the limit. These standards were written for TV or web viewing, so compliance reduces risk but does not make a venue show safe.

### Cited Findings

**ITU-R BT.1702-3 (11/2023, in force)** — [status](https://www.itu.int/rec/R-REC-BT.1702/en), [full text](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf). Values below are from Annex 1 and Annex 2:

| Item | Limit as published |
|---|---|
| Flash | A pair of opposing luminance changes |
| Darker image below 160 cd/m2 | Potentially harmful at a difference of 20 cd/m2 or more (SDR and HDR) |
| Darker image at or above 160 cd/m2 | Potentially harmful above 1/17 Michelson contrast, (LHIGH - LLOW)/(LHIGH + LLOW); HDR programmes only |
| Saturated red | A transition to or from saturated red is potentially harmful irrespective of luminance |
| Sequence not permitted when both apply | Concurrent flash area above 25% of displayed screen **and** more than three flashes (six luminance changes) in any one second |
| Always acceptable spacing | Leading edges at least 360 ms apart (50 Hz) or at least 334 ms apart (60 Hz), irrespective of brightness or area |
| Isolated flashes | Single, double or triple flashes are acceptable |
| Fast cuts | Same constraints when cuts make screen areas flash |
| Prolonged sequences | Cumulative risk is unknown; a sequence over five seconds might be a risk even when compliant |
| Patterns (informative) | More than five light-dark stripe pairs, with stationary pattern over 40% of screen, or changing/oscillating/reversing pattern over 25%, at the same luminance difference as a flash |
| Pattern exemption | Patterns obviously flowing smoothly in one direction across, into or out of the screen |
| Reference display | SDR peak white 200 cd/m2; HLG 1,000; PQ 10,000 |
| Scope of use | Clearly discernible flashing in normal domestic viewing; risk cannot be eliminated |
| Tools | Automatic video analysers can help alert staff |

**Ofcom Guidance Notes Section 2, Annex 1** — [Issue Twelve, 18 July 2017](https://www.ofcom.org.uk/__data/assets/pdf_file/0023/104657/Section-2-Guidance-Notes.pdf):
- 20 cd/m2 or more where the darker image is below 160 cd/m2; saturated red transitions are potentially harmful irrespective of luminance.
- Not permitted when concurrent flash area exceeds one quarter of the displayed screen and there are more than three flashes in any second. Leading edges 9 frames or more apart are acceptable.
- Pattern limits match the ITU values (more than five pairs; 40% stationary, 25% changing), and one-way smooth flow is exempt.
- Ofcom's Section Two page indicates [guidance updated February 2024](https://www.ofcom.org.uk/tv-radio-and-on-demand/broadcast-standards/section-two-harm-offence). The version read here is the 2017 issue, so check for any change before formal use.

**WCAG 2.2 SC 2.3.1** — [W3C Understanding 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html):
- Nothing flashes more than three times in any one-second period, or the flash is below the general and red thresholds.
- General flash: opposing changes in relative luminance of 10% or more of maximum, where the darker image is below 0.80.
- Red flash: opposing transitions involving a saturated red, with R/(R+G+B) at least 0.8 and a state difference above 0.2 in CIE 1976 UCS.
- Area: no more than 0.006 steradians within any 10-degree visual field (25% of that field), estimated as 341 x 256 px at 1024 x 768. W3C notes the criterion cannot account for actual viewing distance.

**Venue and medical context:**
- The UK Health and Safety Executive is reported to recommend that strobes at public performances or clubs run at a maximum of 4 Hz; 3 to 30 Hz are the most common triggers, and some people are sensitive up to 60 Hz — [Epilepsy Society, July 2023](https://epilepsysociety.org.uk/sites/default/files/2023-07/PhotosensitiveepilepsyJuly2023.pdf). The HSE's own text was not retrieved.
- UK law creates an offence for sending flashing images electronically with intent to cause harm to a person with epilepsy — [Online Safety Act 2023, s.183](https://www.legislation.gov.uk/ukpga/2023/50/section/183)

### Inferences
- **The 4 Hz venue figure and the broadcast limit conflict.** 4 Hz (250 ms) is above the three-per-second limit for large-area flashes. Use three per second or less for video.
- **360 ms is the safe universal floor.** At 60 Hz this means 22 frames (366.7 ms); at 120 Hz, 44 frames (366.7 ms); at 50 Hz, 18 frames (360 ms). Count in real time, not frames, so a dropped frame cannot compress the spacing.
- **Musical consequence:** flashing every quarter note stays compliant only up to **166 BPM** at 360 ms. Eighth notes stay compliant only to 83 BPM. Above this, Ember Pulse should fall to every second beat or convert the hit into a non-flashing motion or small-area accent.
- **A code-value limiter is unsafe on bright displays.** The 20 cd/m2 threshold is absolute. With gamma 2.2 from black, 20 nits is about 35% signal (code 90/255) on a 200-nit display, but about 17% (43/255) at 1,000 nits and 14% (36/255) at 1,500 nits. The limiter needs a per-output peak-luminance setting, defaulting to a high value if unknown.
- **WCAG is weaker on a bright wall.** Its 10% relative threshold is 150 nits on a 1,500-nit wall, compared with ITU's absolute 20 cd/m2. Do not use WCAG alone.
- **Area needs a stricter reading on big surfaces.** A wall can fill much more than a 10-degree field, so 25% of the screen may be a large retinal area. Apply the 25% limit to the whole output and to any sliding window sized to 10 degrees from the nearest expected viewer.
- **Oscilloscope risk is pattern risk.** Dense Lissajous or multi-trace modes can form more than five oscillating stripe pairs. Smooth one-way scroll is exempt; oscillation and contrast reversal are not.
- **Ember Pulse risk is red-flash risk.** Red-orange palettes can meet the saturated-red condition, and the limit applies at any brightness, so dimming alone does not solve it.

**Limiter design (post-process, last in the chain, before output):**
1. Downsample the final frame to a small linear-light grid (for example 64 x 36), convert with the output's measured peak, and compute luminance and red ratio per cell.
2. Track rising and falling transitions per cell against the 20 cd/m2, 1/17 Michelson and saturated-red rules. Apply the Michelson rule to all outputs, as a stricter choice than the HDR-only scope.
3. Sum concurrently flashing area. When over 25% and the next edge would land inside 360 ms, hold or ease luminance and desaturate red rather than cutting (a hard cut is itself a transition).
4. Run a 1-second sliding count plus a 5-second sustained-flash timer.
5. Apply the same gate to the DMX output. Show limiter activity on the operator screen and log it.
6. Add `Safe` as the launch default. Disabling requires a deliberate action, and never persists across launches.

### Gaps
- No standard found was written specifically for large-format venue LED or projection.
- The Harding test's current product details and licensing were not researched. It should not be described as passed unless an actual Harding FPA report exists.
- [A gap analysis of international guidelines](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11872230/) appeared relevant but was blocked by a browser check and was not read.
- Legal duties vary by country and venue. This is engineering guidance, not legal or medical advice. Audience warning signage should follow venue and local requirements.

## Installation reliability: how should it survive weeks unattended?

### Takeaway
Assume every layer will fail and recover in layers: WebGL context, renderer process, GPU process, app, then machine. Electron provides the signals, but the app must implement the recovery and restore state.

### Cited Findings
- `child-process-gone` reports GPU and other child process loss, with reasons including `crashed`, `oom`, `killed` and `memory-eviction` — [Electron app API](https://www.electronjs.org/docs/latest/api/app)
- `app.relaunch()` does not quit by itself and must be followed by `app.quit()` or `app.exit()`; multiple calls can start multiple instances — [Electron app API](https://www.electronjs.org/docs/latest/api/app)
- `app.getAppMetrics()` gives per-process memory and CPU — [Electron app API](https://www.electronjs.org/docs/latest/api/app)
- `prevent-display-sleep` keeps both system and display awake and takes precedence over `prevent-app-suspension` — [Electron powerSaveBlocker](https://www.electronjs.org/docs/latest/api/power-save-blocker)
- Windows Shell Launcher can replace the shell and map exit codes to restarting the shell or device. It is for Enterprise and Education, not Pro — [Microsoft Learn](https://learn.microsoft.com/en-us/windows/configuration/assigned-access/shell-launcher/quickstart-kiosk)
- launchd `KeepAlive` restarts a job, and jobs that exit quickly and repeatedly are throttled — [launchd.plist(5)](https://keith.github.io/xcode-man-pages/launchd.plist.5.html)
- macOS login items in Electron should be code signed and notarized to work reliably — [Electron app API](https://www.electronjs.org/docs/latest/api/app)
- Sony warns OLED image retention can become permanent with long or repeated static images, and uses pixel shift and brightness reduction as mitigation — [Sony](https://www.sony.co.uk/electronics/support/televisions-projectors/articles/00173479)

### Inferences
- **Recovery ladder:** context restore (3 s) → reload renderer (10 s) → relaunch app (30 s) → reboot machine (after N failures in an hour). Show black or a safe still during recovery, never a frozen bright frame.
- Run a **heartbeat** from the render loop to the main process, and an **external supervisor** (launchd or a Windows service/shell) outside Electron, because a hung main process cannot save itself.
- **Persist show state** atomically on change: scene, mapping, output assignment, levels, and limiter settings. On boot, restore to a known safe scene.
- On a long-running system, drive time-based shaders from a wrapped time value, since large float time values lose precision and can create visible stepping after days.
- For installs, disable OS updates during show hours, notifications, and sleep; use a wired network; and keep a spare, cloned boot drive.

### Gaps
- No primary source on GPU thermal throttling for this workload was collected. Log GPU clocks and temperature during the soak where platform tools allow.
- LED-panel differential ageing was not sourced; the burn-in evidence is OLED-only.
- Remote monitoring products were not compared.

## Operator experience: what makes it safe under pressure?

### Takeaway
A show-safe interface makes the safe action one keypress, makes dangerous actions hard, and lets the operator see the next look before the audience does.

### Cited Findings
- MadMapper's live control covers keyboard, MIDI, DMX, OSC, audio and gamepad mappings, with OSCQuery — [MadMapper docs](https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control)
- disguise's failover uses an Understudy that takes over after a configurable timeout, with health monitored through FPS — [disguise d3Net](https://help.disguise.one/designer/networking/setup-d3net)
- TouchDesigner advises launching directly into Perform Mode full-screen on the correct monitors, because window and mode changes are not robust with frame lock — [TouchDesigner](https://derivative.ca/UserGuide/Hardware_Frame_Lock)

### Inferences
- Required controls: Blackout, Freeze, Safe Look, master intensity, limiter state, and tempo/tap, all reachable without opening a panel and mappable to hardware.
- Implement a **second, renderer-independent panic path** (for example, hide or black the output window from the main process), because the current blackout is a shader uniform.
- Do not let Escape close an output during a show. Require a hold or confirmation.
- Macro controls: each effect should expose 4 to 8 musically named macros (Energy, Heat, Decay, Density), each range-limited to safe, attractive values.
- Preset morphing: interpolate continuous parameters over beats; crossfade rendered outputs when discrete structure changes. Test that a morph cannot create a flash, because it passes through the limiter.
- Cue system: Preview → Take, with fade time and quantise to beat or bar. Preview should show the real output mapping and limiter warnings.
- Launch state: limiter on, master at a safe level, output black or Safe Look, no surprise strobe.

### Gaps
- Official documentation for preview/program, cue and preset-morph workflows in each named product was not reviewed in enough depth to rank them.

## How do the professional tools compare, and what is the benchmark?

### Takeaway
The realistic benchmark is **Resolume/MadMapper for live control and integration**, and **disguise/TouchDesigner for reliability concepts**. The app can beat them on built-in photosensitive protection, since no flash-limiter feature was found in the product documentation reviewed (the search was not exhaustive).

### Cited Findings

| Tool | Documented capabilities | Source |
|---|---|---|
| Resolume Arena | SMPTE input, DMX/Art-Net, NDI, Syphon/Spout, Ableton Link | [Resolume support](https://resolume.com/support/avenue-arena) |
| TouchDesigner | Hardware frame lock, multi-machine sync, dropped-frame monitoring | [Syncing](https://derivative.ca/UserGuide/Syncing_Multiple_Computers); [Perform CHOP](https://derivative.ca/UserGuide/Perform_CHOP) |
| Notch | OSC, Art-Net, MIDI, Spout, NDI; standalone export with Playback licence; integrates with media servers | [Notch features](https://www.notch.one/features) |
| disguise | Genlock, framelock, Understudy failover, output sync test, failover APIs (r27) | [Genlock](https://help.disguise.one/designer/configuration/genlock-configuration); [Sync test](https://help.disguise.one/designer/networking/output-sync-test); [r27](https://help.disguise.one/designer/release-notes/r27) |
| MadMapper | Art-Net 4, sACN with universe sync, Spout/Syphon, NDI, MIDI, OSC/OSCQuery | [Features](https://madmapper.com/madmapper/features) |
| VDMX | LTC/MTC/OSC timecode in and out; Syphon and NDI output | [VDMX plugins](https://docs.vidvox.net/vdmx/vdmx_plugins) |

### Inferences
- **Meet:** MIDI, OSC, Link, Art-Net/sACN, Syphon/Spout, Blackout, output mapping and dropped-frame display.
- **Beat:** a calibrated always-on flash limiter, a readiness self-test that outputs a pass/fail report, per-output low-grey calibration, and a one-click diagnostic bundle.
- **Do not chase:** genlock, multi-server frame lock, ST 2110 or disguise-class failover. Interoperate through Syphon/Spout/NDI into a media server when a show needs them.

### Gaps
- Resolume genlock support was not confirmed from official documentation.
- MadMapper timecode was confirmed only by [a third-party article](https://cdm.link/madmapper-timelines-clips-v6/).
- Some Resolume and VDMX details come from pages of uncertain date. No independent reliability comparison among these products was found.

## Electron and Chromium limits: what constrains the app?

### Takeaway
Electron 45 / Chromium 156 is viable for single-machine show output when throttling, display sleep and crash recovery are handled explicitly. WebGPU is available but is not needed for readiness; moving to it now would add risk without solving the main gaps.

### Cited Findings
- `backgroundThrottling` defaults to true and affects animations and timers. When disabled, visibility stays `visible` even if the window is minimized, occluded or hidden — [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- On macOS, a fully covered window otherwise reports `hidden` — [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- `setKiosk`, macOS `setSimpleFullScreen`, and `setAlwaysOnTop` levels are available; levels from `pop-up-menu` upward sit above the Dock and taskbar — [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- BrowserWindow emits `unresponsive` and `responsive` — [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- `app.disableDomainBlockingFor3DAPIs()` must be called before app ready — [Electron app API](https://www.electronjs.org/docs/latest/api/app)
- WebGPU shipped in Chrome and Edge 113, Safari 26, and Firefox 141 on Windows and 145 on Apple-silicon macOS Tahoe — [web.dev, Nov 2025](https://web.dev/blog/webgpu-supported-major-browsers); status tracked in the [gpuweb wiki, edited May 2026](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)

### Inferences
- Add `disableDomainBlockingFor3DAPIs()` at startup; otherwise repeated GPU crashes could leave the output unable to create WebGL until restart.
- Each output window should have its own recovery. Avoid mixed-refresh display setups for shows until tested, and prefer matching 60 Hz outputs.
- Since `backgroundThrottling: false` keeps visibility `visible`, do not use the Page Visibility API as a health signal. Use the render heartbeat.
- Keep WebGL2 for the current effects. Reconsider WebGPU only for a specific need, such as compute-heavy particles or HDR output.

### Gaps
- Late-2026 Chromium release notes were not reviewed for changes to frame scheduling, and the newest WebGPU status source found is May 2026.
- Multi-window vsync behaviour in Electron 45 needs direct measurement on the target Mac and Windows hardware.
