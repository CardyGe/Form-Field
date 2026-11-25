# Harden Oscilloscope and Ember Pulse Separately

Neither effect is ready for an unattended installation or a public show yet, but both have sound foundations and the blocking work is well defined. **The first two jobs are shared: add a flash and pattern limiter, because none exists, and fix WebGL context recovery, because a simulated context loss left the Studio preview blank even after the context came back.** A follow-up flash screen found that all 12 looks pass at default settings, but Acid Plume is borderline at 24.9% of the screen against a 25% limit, and three Ember looks fail at the fastest Phrases setting. After that, Oscilloscope's top fix is its energy model, since the default look computes to a slow-to-fast brightness ratio of 1.00 where correct beam physics gives 4.85. Ember Pulse's top fix is beat and plume stability: every new beat re-rolls all live plumes, and only the smoke hears the music. Ember's visual upgrade should centre on filaments, sparse sparks and hard pulses, because clip1 shows filament-and-spark fire with restrained light; a full fluid simulation stays an optional, later experiment. Performance is not the main problem on the tested Mac, where only the Oscilloscope preset Ember Ring falls below 60 fps at 4K (56 fps). Those timings come from one Apple M5 Pro under load, so they do not establish stage readiness. "Industry leading" is not achieved today, and this report defines the evidence that would justify the claim.

## The ranked plan puts audience safety and recovery first

Ranks reflect consequence, strength of evidence and dependency. The limiter comes before the look changes because the energy fix and harder Ember pulses both change luminance over time. Automated checks come before re-tuning so that every visual change can be compared with a saved baseline.

Evidence labels are used throughout. **Measured** means run on `main` at `cd4830c` on the M5 Pro. **Computed** means real code or a shader port evaluated outside the GPU, or arithmetic from the code. **Estimated** means an engineering judgement, including every effort figure. **Unverified** means nobody has tested it. All pass thresholds are proposed engineering gates unless they cite a standard. Effort assumes one engineer who knows the codebase: S is up to 2 days, M is 3 to 7 days, L is 2 to 4 weeks.

All work should start from `main`. The current `map-stage-1` checkout is 68 commits behind `main` and does not contain Ember Pulse, which lives in `src/rendering/scope-ember.ts` and `src/rendering/scope-ember-smoke.ts`. Notes that reported no Ember Pulse searched the wrong branch, so their assumption of a "potentially full-field" pulse is withdrawn: the real effect is mostly dark filament structure with a low mean luma. The red-flash check still applies because the effect is red-orange and pulses hard. The [flash screen][F] measured up to 10.4% of the frame as saturated red at default settings, with at most 1.3% flashing in red at default and 8.0% at the fastest Phrases setting, both under the 25% limit.

### Shared show-readiness work

| Rank | Phase | Work | Effort, risk | Acceptance test | Baseline to beat |
|---|---|---|---|---|---|
| **S1** | 0 Safe | Final-output flash, red-flash and pattern limiter, on at launch, with an analysis pass over every preset | L, medium-high: can dull looks or create false assurance | Full-field 10 Hz white and saturated-red tests never produce leading edges under 360 ms above 25% area; BPM sweep 60 to 200 halves or converts pulses; limiter follows configured wall nits at 200, 1,000 and 1,500 | No limiter found. Measured screen: 12 of 12 looks pass at default, worst 24.9% (Acid Plume, 1,500 nits, 2 px grid); at 16 phrases Acid Plume, Silver Ash and Glacier Vapour reach 28.8% to 32.6% |
| **S2** | 0 Safe | Context recovery in Studio, then verify Live and Map | S to M, low | 100 of 100 forced losses recover, picture back within 3 s, no bright frame during recovery | Measured: draw calls fell from 2,040/s to 0 and stayed 0 about 10 s after restore |
| **S3** | 0 Safe | Panic path independent of the renderer; no single-key output close; crash relaunch | M, medium | Black within 2 frames from any UI state; a hung renderer can still be blacked out; 20 of 20 renderer and GPU process kills return within 10 s | Escape closes the output; a renderer crash closes the window |
| **S4** | 1 Correct | Reliable verifier plus light-model, beat-stability and recovery tests | M, low | 20 consecutive `verify-scope` passes; new tests fail on the current energy and plume bugs | Measured: 2 of 9 runs died, cause unknown; 468 + 82 unit tests pass but miss these faults |
| **S5** | 2 Show | Frame-time gates and governor on real output hardware | M, medium | Worst shipped preset p99 at most 11.7 ms at 60 Hz at output resolution; at most 1 missed present per 1,000 over 60 min, never 2 in a row | Measured 4K p99: Ember Ring 21.8 ms, Signal Burst 12.5 ms |
| **S6** | 2 Show | Audio-to-light measurement and latency offset | M, low | Photodiode and mic: reactive p95 at most 45 ms, fail above 90 ms; clocked beat within ±1 frame | Unmeasured; estimated 60 to 110 ms on the wall |
| **S7** | 2 Show | Per-output calibration: peak nits, black floor, gamma, minimum line width, native 4K Map path | L, medium | Low-grey ramp and trace tests pass on the actual projector or LED wall | Map is capped at 1920x1080; no venue test exists |
| **S8** | 3 Install | OSC, then Ableton Link, Art-Net/sACN, Syphon/Spout | L per group, medium | Protocol round-trip tests; all light output passes through S1 | MIDI input and MIDI clock already exist on `main`; the others do not |
| **S9** | 3 Install | Watchdog, supervisor, persisted state, remote health | L, medium | 72 h soak before any install, 14 days before handover; heap slope under 1 MB/h after a 1 h warm-up; unattended boot within 120 s | Longest soak is 6 min at 1080p |

### Oscilloscope

| Rank | Phase | Work | Effort, risk | Acceptance test | Baseline to beat |
|---|---|---|---|---|---|
| **O1** | 1 | **Energy model:** deposit energy per time slice, remove the `max(vLength, sigma*.5)` floor's effect, then re-tune every look | M to L, **high**: every existing look depends on the bug | Slow/fast ratio within 10% of ideal; median line light 0.9 to 1.1 of Intensity across looks; Ring/figure 0.9 to 1.1 at Ring 1 | Computed ratio: default 1.00 vs 4.85; Intensity share 0.12 to 1.06; Ring/figure up to 8.52x; Afterglow multiplier up to 5.10x |
| **O2** | 1 | Correct the minimum beam width under layer scale and depth fade | S, low | Sigma at least 0.65 output px at scale 0.05 to 8 and on the far side of the figure | Computed: 0.07 px at scale 0.05; 41.6 px instead of 11.2 px at scale 8; about 0.36 px far side |
| **O3** | 1 | Cut Ember Ring's fill cost with tighter quads and glow from bloom | M, medium | 4K p99 at most 11.7 ms with an approved visual match | Measured: 17.7 ms median, 21.8 ms p99, 56 fps; computed 39.3 full-frame fills |
| **O4** | 2 | Performable changes: quantised figure changes, crossfades, direct Morph position | M, medium | Linked figure, drift and pitch controls never move the line more than a set limit in one frame outside a crossfade | Computed: up to 427 px in one frame vs 4.4 px normal |
| **O5** | 2 | True stereo X/Y input via AudioWorklet and a waveform path to the wall | L, medium-high | Known stereo test signals draw the correct figures; no duplicate or missing samples over 60 min; latency meets S6 | Classic has no audio X/Y path; the analyser is mono-summed |
| **O6** | 3 | Real phosphor persistence with time-based decay | M to L, medium | Same decay at 30, 60 and 120 fps within 2%; no NaN or stuck residue over a soak | Afterglow is 8 redrawn copies; 64.6% of copies separate in the worst case |
| **O7** | 3 | Curve vocabulary and path quality: phase-locked ratios, roses, harmonographs, wavefolds, corner dwell | M, low | Each family closes cleanly, stays legible at 1080p, and passes S1's pattern check | 8 curated ratios; no continuous detune |

### Ember Pulse

| Rank | Phase | Work | Effort, risk | Acceptance test | Baseline to beat |
|---|---|---|---|---|---|
| **E1** | 1 | **Plume stability:** a permanent slot and noise seed per plume, with a fade on removal | S, low | A plume's origin and noise offset stay identical across 8 further beats; removal gain under 0.01 | Computed: noise offset jumps 41.5, 49.8, 58.1, 66.4; gain at removal up to 0.441 at 174 BPM |
| **E2** | 1 | **One beat for the whole effect:** filaments, rings and heat follow the same event and a smoothed clock | M, medium | Click track at 90, 128 and 174 BPM: all parts peak within ±1 frame; 16-beat sync gives true 4-beat phrases; syncopated kicks cause no visible phase snap | Only smoke hears audio; phrases last 3.2 beats at 16-beat sync; clock can snap up to half a beat |
| **E3** | 1 | **Hard pulse envelope and silence policy:** fast attack, short hold, designed fall, noise gate | M, medium: must work inside S1 | Attack within 1 display frame after detection; 10 min of room noise triggers no plumes; hold, breathe and dim modes all work | Smoke takes about 132 ms to peak; a quiet noise floor can be auto-gained to full scale |
| **E4** | 1 | Resolution-independent beam energy, kept consistent with O1 | S to M, medium | Exposure within 5% from 540 to 2160 lines | Computed: about 1.82x line energy at 540 lines, so the look brightens when the governor cuts quality |
| **E5** | 2 | **Filament quality and heat-revealed detail** | M to L, medium | No visible facets at 4x zoom; at a peak, highlights cover at most about 5% of the frame; at least half the pixels reach true black in trough frames | Visible polyline corners; 19 to 37% pure black; mean luma 1.8 to 5.2 |
| **E6** | 2 | Sparse, tiny, deterministic sparks | M, low | Seek and loop give identical frames; sparks stay at least 1.2 output px wide; cost under 1 ms on the show machine | No spark system exists |
| **E7** | 3 | Better stateless smoke as a supporting layer: density colour ramp, short light march, rotated noise | M, medium | Filaments remain the brightest structure; no lifted black; export stays deterministic | No self-shadowing; axis-aligned value noise; smoke capped at 528x297 |
| **E8** | Optional | Fluid-simulation spike, only if an A/B on the real wall shows E5 to E7 fall short | L, high | Beats the stateless version in a blind A/B, holds S5, survives S2 and has a defined export story | Not built; costs are write-count estimates only |

## The baseline is strong on this Mac and silent about stages

Every number below comes from the [measured baseline][B]. Runs used a visible Electron window through Metal on one Apple M5 Pro with 24 GB of memory and a 120 Hz built-in display. **The machine was busy, with a load average of 3.7 to 7.0.** No projector, LED processor, capture path or external display was tested. The "4K" frames were rendered at full size, then composited into a 1280x720-point window, so true 4K presentation remains unmeasured. The raw capture files behind this baseline were in a temporary folder that has since been cleared, so its figures can only be rechecked by re-running the captures.

| Look | 1080p paced median / p99 | 4K paced median / p99 | 4K achieved fps | Draw calls | Estimated target memory at 4K |
|---|--:|--:|--:|--:|--:|
| Plain Oscilloscope | 5.0 / 7.8 ms | 6.3 / 7.6 ms | 120.0 | 15 | 706.6 MB |
| Ember Ring (Oscilloscope preset) | 7.0 / 8.6 ms | **17.7 / 21.8 ms** | **56.1** | 15 | 706.6 MB |
| Signal Burst | 7.2 / 8.7 ms | 9.7 / **12.5 ms** | 100.5 | 15 | 706.6 MB |
| Cyan Tangle | 7.4 / 8.5 ms | 9.1 / 10.8 ms | 107.9 | 15 | 706.6 MB |
| Ember Pulse | 5.3 / 8.1 ms | 7.0 / 8.1 ms | 120.0 | 16 | 707.8 MB |

Despite its name, **Ember Ring is an Oscilloscope preset and has nothing to do with Ember Pulse's performance.** Against the proposed 60 Hz gate of 11.7 ms p99, only Ember Ring and Signal Burst fail at 4K. Against the proposed 120 Hz gate of 5.8 ms p99, no preset passes in paced mode even at 1080p, where the best result is 7.4 ms. Paced timing includes clock scaling and a `readPixels` wait, so it can overstate the app's real cost. The sensible show target is therefore a stable 60 Hz, with 120 Hz treated as a bonus until tested on target hardware.

The stability picture is good but short. Two 6-minute 1080p soaks produced 86,399 frames with no GL errors, no crashed child processes and flat geometry, texture and program counts. Heap grew about 0.1 MB. From minute 1.5 onward, simple extrapolation gives about 0.3 MB/h for the plain line and 0.7 MB/h for Ember Pulse, inside the proposed 1 MB/h gate, but a six-minute run cannot prove the slope holds over a show. Memory figures are calculated upper estimates, and actual Metal allocation is unmeasured. GPU timer queries disagreed with wall-clock time and should not be used. Sound-reactive Ember, multi-layer compositions, Finish effects, and Live and Map output were all outside the timed runs.

## Flash limiting and recovery outrank every visual upgrade

The limiter ranks first because its failure affects people in the room. The app has no protection, and Ember Pulse's intended behaviour moves directly toward the risky zone.

A [flash screen][F] modelled on BT.1702 now gives the first measurements. It rendered each look at 1080p and 60 fps for a full loop, with assumed wall peaks of 200, 1,000 and 1,500 nits, and correctly classified five known test signals first. It is not a certified analyser, so **this report still does not claim that any look passes or violates the standard.**

| Case | Worst share of screen over the flash limit (limit 25%) | Result |
|---|--:|---|
| All 12 looks, default, 6 px grid | 20.5% (Acid Plume, 1,500 nits) | Pass |
| Acid Plume, default, 2 px grid | **24.9%** (1,500 nits) | Pass, no real margin |
| Ember Pulse, 16 phrases | 12.0% general, 8.0% saturated red | Pass |
| Orchid Static, 16 phrases | 19.0% (1,500 nits) | Pass |
| Glacier Vapour, 16 phrases | **28.8%** (1,500 nits) | Fail at 1,500 nits |
| Silver Ash, 16 phrases | **32.4%** (1,500 nits), 26.6% (1,000 nits) | Fail at 1,000 and 1,500 nits |
| Acid Plume, 16 phrases | **32.6%** (1,500 nits), 26.9% (1,000 nits) | Fail at 1,000 and 1,500 nits |

**The risk is scattered flicker on bright walls, not a full-screen strobe.** No look changed more than 19.4% of the screen in one frame, so a limiter that only watches whole-frame brightness would miss these cases. The screen counts areas that flash within the same second even when they are out of step, which is deliberately cautious, so a certified analyser may judge the 16-phrase cases differently. Sound-reactive Ember, loops shorter than 10 seconds, multi-layer compositions, Finish effects, Live and Map output, 4K and the pattern check remain unmeasured.

[ITU-R BT.1702-3](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf) is the strongest engineering baseline in the notes. It defines a flash as a pair of opposing luminance changes. Where the darker image is below 160 cd/m², a difference of **20 cd/m² or more** is potentially harmful, and **a transition to or from saturated red is potentially harmful irrespective of luminance**. A sequence is not permitted when the concurrent flash area exceeds **25% of the displayed screen and there are more than three flashes in any one second**. Leading edges at least 360 ms apart at 50 Hz, or 334 ms at 60 Hz, are acceptable irrespective of brightness or area. The Recommendation also warns that sequences longer than five seconds might carry risk even when compliant, and that risk cannot be eliminated. [Ofcom's guidance](https://www.ofcom.org.uk/__data/assets/pdf_file/0023/104657/Section-2-Guidance-Notes.pdf) uses matching limits, although the version read is the 2017 issue and a later update is indicated. [WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) uses a relative threshold, which is far looser on a bright wall, so it should not be used alone.

**This is engineering guidance, and passing it is not legal or medical compliance certification.** These standards were written for television or web viewing, and no standard found covers large-format venue LED or projection. Local law, venue rules and audience warnings remain separate duties. The app should not claim a Harding pass unless an actual Harding report exists.

Three practical consequences follow. The limiter must work in **measured cd/m², not code values**: from black, 20 cd/m² is about code 90 on a 200-nit display but about code 36 on a 1,500-nit wall. It should use **360 ms as the single conservative spacing**, counted in real time so a dropped frame cannot compress it. That keeps quarter-note flashing compliant only up to **166 BPM** and eighth notes only up to 83 BPM; above that, Ember must drop to every second beat or turn the hit into motion or a small-area accent. Oscilloscope has a different exposure: dense oscillating figures can trigger the pattern guidance of more than five light-dark pairs, so S1 needs a pattern check as well as a flash check.

Clip1 sharpens the tension. Its sampled luma run has rises 8 frames apart at 30 fps, about 267 ms, and at a pulse peak about 52% of pixels sit at or above luma 32 ([clip notes][C]). Area above the true threshold was not measured, but on a 1,000-nit wall the threshold is near code 43. **Ember Pulse should take clip1's discipline, not its exact cadence at full area.** Thin hot detail, large black regions and limiter-aware pulse division can keep the percussive feel.

Context recovery ranks second and should be the first code to land, because it is confirmed and small. Forcing context loss with an Oscilloscope layer selected dropped drawing to zero, and it stayed there after the context returned ([baseline][B]). The cause is visible on `main`: the render loop's catch sets `prepared.current = null` at `src/ui/Preview.tsx:62`, and frames only draw when `prepared.current === state.project` at line 46. The renderer itself recovered to an identical frame in 41 to 47 ms, so the fix is probably narrow. Real GPU resets, and context loss in Live and Map, remain untested. The output window also closes on any renderer crash and on a single Escape press (`electron/output-window.cjs:30-31`), and blackout is a shader uniform that needs a running render loop. Those three facts justify S3 before any public use.

## Oscilloscope needs correct light before it needs more features

The beam geometry is good. It integrates a Gaussian along each segment with `erf`, the established analytic approach described by [woscope](https://m1el.github.io/woscope-how/), and joints sum seamlessly. **The defect is the denominator in `ScopeRenderer.ts:88`.** Segments are usually shorter than `sigma*.5`, so brightness stops depending on beam speed. One shared cause explains the flat default line, the ninefold Intensity spread between looks, the 8.52x Ember Ring rim and Afterglow's excess light ([Oscilloscope audit][O]).

The proposed correction deposits energy per time slice, so brightness falls with speed without a separate speed term ([technique notes][T]). A small crossfade near zero length avoids a brightness step at stationary points, and explicit guards prevent NaN values. Clip3 supports the target: its trace reads as a near-white core, a saturated body and a tight halo, with strong brightness variation along one continuous path, and its colour moves toward white as channels saturate ([clip notes][C]). That favours keeping the existing per-channel roll-off as the default, or offering a mix, instead of replacing it with a hue-preserving curve. The clip does not prove that beam speed caused its brightness variation, so the fix is justified by the app's own stated design and physics rather than by the video.

**Every existing look will need re-tuning, because each one's current appearance depends on the bug.** Saved projects should not silently change. The safest route is a versioned beam model: existing projects load with their old response or a compensated migration, while new work uses the corrected model. Before and after contact sheets for all seven classic presets should be approved by eye. Ember Pulse shares the beam, bloom and resolve code, so the fix must also carry its own Ember calibration (E4) or it will change Ember's exposure as a side effect. Sharing a low-level renderer is fine; the two effects keep separate controls, looks and development paths.

After the light is correct, the most valuable performance gain is making the instrument playable. Stepped controls currently jump up to 427 px in one frame, against 4.4 px in normal playback. Ratios should change only on a beat or shared zero crossing, with a crossfade, while phase, rotation and amplitude move continuously. Directly interpolating a ratio passes through irrational values and collapses the figure into noise ([technique notes][T]).

True stereo X/Y is the largest capability gap and the feature most likely to distinguish the instrument. It requires raw stereo capture in an AudioWorklet, a pre-allocated ring buffer as [Chrome's audio pattern guidance](https://developer.chrome.com/blog/audio-worklet-design-pattern) recommends, drawing exactly the samples that became audible since the last frame, and a new path to the wall because current signals carry only named numbers. Cross-origin isolation for SharedArrayBuffer in this Electron setup is unverified, so a transfer-based fallback belongs in the design. Real persistence should follow X/Y because the current stateless Afterglow cannot retain what a live signal did. Code reuse needs care: [woscope](https://github.com/m1el/woscope) is MIT, while [osci-render](https://github.com/jameshball/osci-render) is GPL-3.0 and should be studied rather than copied into this project.

Clip3's oil-like backdrop is not a requirement for Oscilloscope. Its useful lesson is the opposite: the thin trace becomes harder to read when the late full-frame background competes with it. Oscilloscope should default to a clean field.

## Ember Pulse should win on filaments, sparks and timing

Clip1 is the best available reference for Ember Pulse, at medium-high confidence. It shows **thousands of fine filaments, sparse pale specks and thin contours on black**, with bright gold on thin edges. At a measured peak, only about 1.4% of pixels reach luma 160, and 47.8% stay below luma 32. Attacks take about one frame, holds two to four frames, and falls three to six frames at 30 fps ([clip notes][C]). That evidence changes the upgrade headline: Ember's premium quality comes from **fine hot structure, black space and a hard envelope**, not from more soft volume.

The stability work comes first because a beautiful effect that disagrees with the music will still fail on stage. The plume bug is confirmed: new beats are inserted at the front of the array, so each older plume changes shader slot, origin, shear and noise on every beat (`src/react/ember-smoke.ts:42`; [Ember audit][E]). The fix is cheap. The harder issue is that audio reaches only the smoke while filaments, rings and the main light follow a fixed authored bar. E2 should send one beat event to all of them, smooth the detected-beat clock, and fix the default phrase maths. The current default of five four-beat phrases needs a 20-beat loop, which the 1, 2, 4, 8 and 16-beat options cannot provide. **Moving the default to four phrases and an 8-second loop preserves 120 BPM and locks to 16 beats**, but existing projects need migration.

Then the pulse should change structure, not just exposure. Heat should reveal hot filaments, shift them along a black, deep red, orange and pale gold ramp, and leave the rest of the form dark. The current stills show why this matters: Ember Pulse is both dim, with mean luma 1.8 to 5.2, and short of true black, with only 19 to 37% of pixels at zero. Clip1's whole-clip median luma is 0. The two measurements are not perfectly comparable, since clip1 is compressed and sampled across the full clip, but together they point to **too much low-level haze and too little concentrated light**. Up close, filaments also show straight segments and angular corners, so the geometry needs smoother curves or more adaptive segments. The clip is a guide to behaviour only, so these targets describe distributions and timing and must not become a recreation of its composition.

Sparks should stay few, tiny and subordinate. A closed-form path from each spark's seed and birth phase preserves one of Ember's real strengths: **the authored look is deterministic, seekable, loop-exact and free of accumulating simulation state**. Live sparks can use the same bounded event approach as the corrected plumes.

### A fluid solver is a late experiment, not the headline

The fluid research is solid and should not be discarded. A 2D stable-fluids core would solve real limitations: today's plumes have no momentum, cannot interact and cannot wrap around filaments. Its smallest proposed tier is about 1.81 million pixel writes per step, roughly 0.87 of a 1080p fill, with guidance drawn from [GPU Gems](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids) and [Dobryakov's MIT WebGL solver](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation).

It still ranks last, for four reasons. Clip1's defining features are filaments and sparks, and the clip does not establish that a fluid solver made them. A simulation would add persistent state exactly where Ember is currently deterministic and easy to recover after context loss, and it would complicate seeking and export. Its GPU cost is a write-count estimate with no timing. Most importantly, it would not fix the beat, filament or envelope problems that currently limit the effect. The cheaper smoke improvements in E7 should come first, and E8 should run only if a real-wall A/B shows that the stateless version has reached its ceiling.

## "Industry leading" must be earned with published evidence

The notes support a realistic benchmark: **[Resolume](https://resolume.com/support/avenue-arena) and [MadMapper](https://madmapper.com/madmapper/features) for live control and integration, and [disguise](https://help.disguise.one/designer/networking/setup-d3net) and [TouchDesigner](https://derivative.ca/UserGuide/Hardware_Frame_Lock) for reliability concepts**. The app does not need to chase genlock, multi-server frame lock or ST 2110. Its most credible path to leadership is narrower: an always-on calibrated flash limiter, a self-test with a pass/fail report, per-output low-grey calibration, and two best-in-class instruments. The claim that competitors lack a built-in limiter comes from a non-exhaustive documentation review and should be rechecked before it is used publicly.

| Claim | Evidence required | Status |
|---|---|---|
| Show-safe | S1 to S3 pass, with archived analyser reports and venue-specific review | Not met |
| Stage-performant | S5 and S6 pass on the real machine, outputs and surface | Not tested |
| Installation-grade | 72 h soak, 14-day handover soak, fault injection, unattended recovery | Not tested |
| Best Oscilloscope | Correct energy tests, accurate stereo X/Y, blind comparison against named scope tools using the same test signals | Not met |
| Best Ember Pulse | Beat-accuracy results across genres, blind A/B with working VJs on a projector and an LED wall | Not met |
| Industry leading | All of the above, plus independent operators choosing it in real shows and a published test method | Not supportable today |

## Five questions decide the remaining priorities

**What was clip2 meant to show?** It is a white geometric title animation and clearly demonstrates neither effect, so this report takes no requirement from it. If it was included for restraint, timing or another purpose, that intent needs to come from you.

**Should Ember Pulse remain partly smoky, or is filament-and-spark fire the true target?** The plan assumes filaments lead and smoke supports. A preference for visible rolling smoke would raise E7 and could justify the E8 spike.

**What hardware and surfaces are the first real targets?** The machine, output resolution, projector or LED processor, measured peak nits and viewing distance determine S5 to S7 and the limiter's calibration.

**Which comes first: live VJ sets or unattended installations?** Live work pulls forward S6, O4 and E2 to E3. Installations pull forward S9 and the silence policy.

**How should existing saved looks migrate?** Preserving them exactly favours a versioned legacy beam model. Accepting a one-time re-tune would make the codebase simpler.

## Conclusion

The audit's most useful finding is that the two effects need opposite kinds of ambition. Oscilloscope needs to become more physically truthful, because its bright, playable future depends on a correct light model and real signal input. Ember Pulse needs more restraint, because its strongest evidence points to less haze, fewer bright pixels and sharper timing rather than a heavier simulation.

The dependencies also make the sequence cheaper than it looks. A limiter makes aggressive pulse work safe to attempt, recovery tests protect every later change, and a corrected energy contract gives both looks a stable base for tuning. Keeping the two effects separate through that process protects what makes each worth performing.

[B]: ../research_notes/Oscilloscope%20and%20Ember%20Pulse%20audit/measured_baseline.md
[C]: ../research_notes/Oscilloscope%20and%20Ember%20Pulse%20audit/reference_clips.md
[F]: ../research_notes/Oscilloscope%20and%20Ember%20Pulse%20audit/flash_baseline.md
[O]: ../research_notes/Oscilloscope%20and%20Ember%20Pulse%20audit/code_audit_oscilloscope.md
[E]: ../research_notes/Oscilloscope%20and%20Ember%20Pulse%20audit/code_audit_ember_pulse.md
[T]: ../research_notes/Oscilloscope%20and%20Ember%20Pulse%20audit/scope_techniques.md
