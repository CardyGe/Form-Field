# Fractal and kaleidoscope live instruments: market benchmark, operator control and audio reactivity

Research date: 2026-11-21. Evidence tags:
- **[F]** page fetched and read this session.
- **[S]** search-result summary only; the page itself was not read. Resolume forum pages returned HTTP 403, so all Resolume forum evidence is [S].
- **[OLD]** dated before 2025, or undated and probably older.
- Prices are list prices seen on the fetch date. Synesthesia was running a Black Friday sale, so its prices are promotional.

## What do the leading tools offer for kaleidoscope and fractal work, and at what price?

### Takeaway
No surveyed product was found to treat fractals and kaleidoscopes as a dedicated performance instrument. The market splits into playable tools with shallow or scene-bound fractal control (Resolume, Synesthesia, MilkDrop-family), deep authoring environments that make the artist build the instrument (TouchDesigner, Notch, Wire), and show infrastructure (Smode, disguise, Unreal).

### Cited Findings

**Comparison matrix**

| Tool | Kaleidoscope / fractal route | Audio and sync | Price / licence | Main limit for this use |
|---|---|---|---|---|
| Resolume Arena / Avenue | Basic Kaleidoscope effect, per [forum discussion](https://resolume.com/forum/viewtopic.php?p=89090) [S]; feedback recipes via Wire | FFT with Lin/Log/Mel filters in [7.29](https://resolume.com/blog) [F]; [Pro DJ Link track-linked playback](https://resolume.com/article/137), Arena only [F] | [Avenue €299, Arena €799](https://resolume.com/shop), 12 months of updates [F] | Fractal depth must come from Wire, plugins or content |
| Resolume Wire | Node patches; [feedback tutorial with generative and reaction-diffusion examples](https://resolume.com/forum/viewtopic.php?p=101886) [S] | [Spectral Flux, Centroid, Flatness and Spectrum Bin nodes in 7.29](https://resolume.com/blog) [F] | [€399](https://resolume.com/shop) [F] | Author-time patching, no fractal-specific performance model found |
| TouchDesigner | Community: [RayTK](https://t3kt.github.io/raytk) [S], [RayTK kaleidoscope](https://derivative.ca/community-post/tutorial/make-reusable-kaleidoscope-effect-raytk/69894) [S], [TouchFractal, 10 shapes](https://derivative.ca/community-post/asset/touchfractal-v10-3d-fractal-toolkit/74535) [S], [FOP 3D/4D operators](https://derivative.ca/community-post/asset/fop-3d4d-modular-fractal-operator-system/75417) [S] | [Ableton Link CHOP](https://docs.derivative.ca/Ableton_Link_CHOP) [F]; [audioAnalysis component](https://docs.derivative.ca/Palette:audioAnalysis) with bands, kick, snare, rhythm, centroid [F] | [Free non-commercial capped at 1280x1280; Commercial from $600; PRO from $2,200](https://derivative.ca/download/pricing) [F] | You build, test and maintain the instrument yourself |
| Notch | Node-based real-time graphics; fractal-specific nodes not verified | [Live audio, camera, OSC, MIDI and depth camera input from Indie tier](https://www.notch.one/pricing) [F] | [Indie $279/yr; VFX $1,399/yr; RFX $2,589/yr; Render Node $249/yr](https://www.notch.one/pricing) [F] | Cost; Indie excludes NDI, Spout and Blocks |
| VDMX6 | ISF/custom generators in Plus | [Audio analysis, auto BPM, MIDI, OSC, DMX, HID, LTC/MTC, OSCQuery](https://vidvox.net/) [F] | [$199; Plus $349](https://vidvox.net/) [F] | Mac-centred; no dedicated fractal system found |
| MadMapper 6 | Mapping first; generative materials not verified | Not verified | [Free watermarked trial; temporary and perpetual 6.xx licences](https://www.madmapper.com/madbundle) [F]; amounts not shown | Mapping tool, not a fractal instrument |
| Synesthesia | [GLSL scenes, Shadertoy and ISF import, live coding, 80 built-in scenes](https://synesthesia.live/) [F] | "Advanced audio algorithms", [MIDI and OSC](https://synesthesia.live/) [F] | [Standard $99 (normally $199); Pro $249 (normally $399); perpetual](https://synesthesia.live/pricing) [F] | Closest competitor; depth depends on each scene |
| MilkDrop / projectM | Preset-based warp and feedback; [open-source Milkdrop reimplementation](https://github.com/projectM-visualizer/projectm) [S] | [Beat detection and FFT in the library](https://github.com/projectM-visualizer/projectm) [S]; [smooth transitions restored in 4.1](https://github.com/projectM-visualizer/projectm/releases) [F] | Open source | Library-first; [front ends described as development previews](https://github.com/projectM-visualizer/projectm/blob/master/README.md) [S] |
| Magic Music Visuals | Modular audio-reactive graph | [Real-time audio analysis and modular design](https://www.sourceforge.net/software/compare/Magic-Music-Visuals-vs-Sonic-Visualiser) [S] | [$44.95 for one computer](https://www.softwaretestinghelp.com/?p=170982) [S, OLD] | Official site returned 403; unverified |
| Modul8 | Layer compositor with modules | [MIDI, DMX, OSC, audio or beat response](https://garagecube.com/modul8/) [F] | Price not listed | [macOS only; Apple silicon requires Rosetta](https://garagecube.com/modul8/) [F] |
| CoGe | VJ mixer | Not verified | [$129, v1.8.6, not compatible with Catalina or later](https://coge-vj.macupdate.com) [S, OLD] | Appears stale; discontinuation not confirmed |
| Smode | [Shader scripting, ISF and Shadertoy, 3D particles, Stream Diffusion](https://www.smode.io/en/product/smode-live) [F] | [Audio reactivity, tap tempo; LTC/MTC on Live tiers](https://www.smode.io/en/product/smode-live) [F] | [Free Community (non-commercial); four Live tiers by quote, dongle](https://www.smode.io/en/product/smode-live) [F] | Show-server class, PC-based |
| disguise | [Hosts Unreal content through RenderStream on dedicated hardware](https://disguise.one/en/products) [S] | Show-control oriented | No public price found | Hardware and pipeline scale |
| Unreal pipelines | Custom builds; [Audio Synesthesia analysis plugin](https://dev.epicgames.com/documentation/en-us/unreal-engine/audio-synesthesia-in-unreal-engine) [S] | Custom | Licence terms not researched | Needs an engineering team |

**Notable 2026 movement**
- Resolume shipped [depth estimation, human segmentation and depth effects in 7.28](https://resolume.com/blog) and [spectral analysis nodes and Spectral effects in 7.29](https://resolume.com/blog) [F]. The audio and depth gap against generative tools is narrowing.
- Resolume 7.26 added [MCP servers for Arena/Avenue and Wire plus expanded REST APIs](https://resolume.com/blog) [F], so AI-assisted patch building is now a shipped feature.
- TouchDesigner 2025 introduced [GPU-based Point Operators (POPs)](https://derivative.ca/community-post/whats-new-2025-touchdesigner-release/73348) [S].
- projectM's latest listed release is [4.1.8](https://github.com/projectM-visualizer/projectm/releases) [F]. The page gives "06 Oct" with no year.
- Trypta's Keith Lostracco describes a TouchDesigner fractal piece combining an escape-time fractal and KIFS with [over 100 parameters](https://derivative.ca/community-post/keith-lostraccos-mindbending-fractal-world-escape-time/60727) [S, OLD]. This shows both the ceiling and the control problem.

### Inferences
- Synesthesia is the closest product benchmark. TouchDesigner plus RayTK or FOP is the closest depth benchmark.
- A browser-based instrument cannot win on raw GPU ceiling or show-server integration. Its credible position is the best playable fractal instrument, with zero install and strong interoperability.
- A 100-parameter fractal is not playable directly. The hard product problem is reducing that space to a few musically and visually meaningful controls.

### Gaps
- Exact current prices for MadMapper, Modul8, Magic, disguise and Smode Live were not obtainable.
- Notch fractal nodes, MadMapper materials and Magic's module list were not verified.
- No frame-rate benchmark across tools was found, so no performance ranking is claimed.

## What do working VJs complain about or praise?

### Takeaway
The clearest recurring complaints are unreliable tempo and phrase alignment, and presets that jump rather than morph. The evidence is mostly older forum material and is directional, not a quantified survey.

### Cited Findings
- Resolume staff said in 2020 that it [did not do BPM detection](https://resolume.com/forum/viewtopic.php?p=90541) [S, OLD]. Later Resolume 7 threads discuss an [auto BPM option with wrong results on some tracks](https://resolume.com/forum/viewtopic.php?p=90584) [S, OLD]. Current behaviour is unconfirmed.
- Users commonly route around this with [Pulse, tap tempo or external OSC tools](https://resolume.com/forum/viewtopic.php?p=88495) [S, OLD].
- A suggested Link workflow still requires the operator to [press Re-Sync manually for downbeats](https://www.resolume.com/forum/viewtopic.php?p=84387) [S, OLD]. Link can match tempo without knowing where the musical "one" is.
- Users have reported [Link and DJ-software sync problems](https://www.resolume.com/forum/viewtopic.php?p=84396) [S, OLD].
- A forum request asks for [one-button macro presets recalling multiple effect states](https://resolume.com/forum/viewtopic.php?p=103327) [S].
- Kaleidoscope-specific pain: [pixelation at the centre](https://resolume.com/forum/viewtopic.php?p=89090), with users resorting to Resize sandwiches or alpha masks [S].
- Praise: Wire's value is [encapsulating recipes into reusable effects](https://resolume.com/forum/viewtopic.php?p=89090) [S]. An Ableton interview describes the [Resolume community as comparatively open](https://ableton.com/en/blog/visualizing-sound-a-beginners-guide-to-using-touchdesigner-with-live) [S].
- A Derivative tutorial addresses [turning a collection of TouchDesigner projects into a live VJ rig](https://derivative.ca/community-post/tutorial/live-performance-rig-tutorial/72078) [S], indicating that performance packaging is separate work.

### Inferences
- Trust is the product requirement. An operator will accept a simpler detector that visibly reports confidence and is instantly correctable over a smarter one that fails silently.
- Kaleidoscope quality details such as centre-point sampling, seam handling and anti-aliasing are visible differentiators because users are patching around them today.

### Gaps
- No reliable 2025-2026 VJ survey was found. Resolume mentions a 2026 user survey but no results were found.
- VJ Union primary discussion was not retrievable. Reddit and Discord were not sampled, so sentiment may skew toward forum users.
- A Resolume team comment that parameter morphing "would be nice" appeared in search results, but its thread could not be opened or dated, so it should not be quoted as current.

## What are the best operator controls?

### Takeaway
The best control model combines macro controls, snapshot morphing, A/B preview, quantized launch and multiple clock sources with a visible fallback. Each piece exists somewhere, but no surveyed VJ tool was confirmed to combine them around a generative instrument.

### Cited Findings
- **Crossfader-linked parameters:** Resolume offers [Crossfader Phase envelopes](https://resolume.com/support/en/parameter-animation), animating a parameter as the crossfader moves from A to B [F].
- **Per-clip transitions:** Resolume 7.25 added [per-clip transition time and blend mode](https://resolume.com/blog) [F].
- **Tempo animation:** Resolume supports [BPM-synced parameters with phase lock](https://resolume.com/support/en/parameter-animation) [F].
- **Control without recompiling:** Wire 7.27 exposes [attribute parameters to OSC, MIDI, DMX and keyboard without recompiling](https://resolume.com/blog) [F].
- **Discoverable control:** VDMX supports [OSCQuery publishing and custom Control Surface layouts](https://vidvox.net/) [F].
- **Morphing precedent:** Apple MainStage's [Transform pad morphs between snapshots with a glide rate](https://support.apple.com/en-au/guide/mainstage/lgsib359659f/mac) [S]. TouchDesigner's community [TDMorph](https://forum.derivative.ca/t/tdmorph-2020-01-08-02-25/118937?page=2) provides snapshot recall and two-set morphing [S, OLD].
- **Ableton Link:** Link shares [tempo, beat alignment and phase through a per-app quantum; v3 adds start/stop sync, and arrangement sync shares song position](https://ableton.github.io/link/) [F].
- **Pro DJ Link, official route:** Arena uses [Pro DJ Link Bridge or ShowKontrol, follows track identity, state, fader and playhead for up to four players, and supports CDJ-3000, CDJ-2000NXS2, DJM-V10 and DJM-900NXS2](https://resolume.com/article/137) [F]. That page does not describe phrase data.
- **Pioneer licensing:** Third-party access runs through [licensed connection to PRO DJ LINK Bridge](https://www.pioneerdj.com/en/news/2019/pro-dj-link-network-information-licensed-to-vfx-companies/) [S, OLD].
- **Pro DJ Link, community route:** [Beat Link Trigger](https://raw.githubusercontent.com/Deep-Symmetry/beat-link-trigger/main/README.md) can trigger on track start, phrase type or beat, and supports CDJ-3000. It states it is not a sanctioned protocol implementation, needs analysed tracks, and should not share a machine with rekordbox [F].
- **Other DJ and timecode links:** Arena supports [Denon StageLinQ](https://resolume.com/article/79) [S]. VDMX supports [LTC and MTC](https://vidvox.net/) [F].

### Inferences
Recommended control architecture:
1. **Eight macros** with semantic names (Energy, Complexity, Symmetry, Zoom Drive, Fold, Colour Heat, Motion, Feedback). Each maps to curated multi-parameter curves.
2. **Safe ranges** per macro, so any position produces a usable image.
3. **A/B morphing** that interpolates in perceptual or structure-aware spaces. Discrete values such as segment count need a designed transition, not a numeric lerp.
4. **Quantized launch** at beat, bar, 4, 8, 16 or 32 bars, with a visible countdown and an immediate override.
5. **Clock priority with visible status:** Pro DJ Link bridge, then Link, then MIDI clock, then audio tracker, then tap tempo. A one-touch "this is the one" button corrects the downbeat.
6. **Panic and safety controls:** blackout, freeze, hold, return to last safe state, and strobe limit.
7. **Performance surface:** a tablet or second-screen layout plus learnable MIDI and OSC, with OSCQuery for discovery.
8. **DMX input** for lighting-desk control, and optional output so lighting can follow the visual state.

### Gaps
- A browser cannot join Ableton Link or Pro DJ Link directly as far as this research established. The Link page does not address browsers, so a local bridge should be assumed until tested.
- Whether Arena now consumes rekordbox phrase data is unconfirmed.
- Licensing terms for a small independent product joining Pioneer's Bridge programme were not found.

## What is audio reactivity best practice?

### Takeaway
Use a layered pipeline: fast causal onsets for impact, adaptive band envelopes for body, a confidence-gated tempo clock for motion, and slower section-energy state for scene behaviour. Do not drive visuals from raw FFT values.

### Cited Findings

**Commercial baseline**
- Resolume exposes [band selection, gain, fall and direction](https://resolume.com/support/en/parameter-animation) for FFT animation [F], and now [Lin, Log and Mel filters](https://resolume.com/blog) [F].
- TouchDesigner's audioAnalysis offers [per-band threshold, smooth, gain and add, plus kick, snare, rhythm, centroid and partial-density outputs](https://docs.derivative.ca/Palette:audioAnalysis) [F]. It does not document the algorithms, latency or accuracy.
- Wire's [Spectral Flux, Centroid and Flatness nodes](https://resolume.com/blog) [F] confirm these features are now mainstream.

**Libraries**

| Library | Fit | Licence / status |
|---|---|---|
| [BTrack](https://github.com/adamstark/BTrack) [F] | Causal real-time beat tracker; default hop 512, frame 1024 | GPLv3; v1.0.7 released 31 Dec 2025 |
| [aubio](https://aubio.org/) [F] | Causal onset, pitch, beat and tempo | GPL; site copyright ends 2018 |
| [madmom](https://github.com/CPJKU/madmom) [F] | Strong RNN/DBN reference, has online mode | Code BSD; **models CC BY-NC-SA**, commercial use requires contact |
| [Essentia.js](https://mtg.github.io/essentia.js/) [F] | WebAssembly, real-time or offline browser analysis | AGPLv3 badge; check licensing |
| [BeatNet](https://arxiv.org/pdf/2108.03576) [S] | CRNN plus particle filter for online beat, downbeat and meter | Check repository licence |
| [BeatNet+](https://doaj.org/article/393c7ce2039d4e8dad5843c4c498a6d7) [S] | Extends real-time analysis to singing and non-percussive music | Check repository licence |

**Accuracy evidence (not a head-to-head)**
- One GTZAN comparison reports beat F-measure of about [57 for aubio, 75 for BeatNet and 74 for a Böck model](https://arxiv.org/pdf/2111.00704) [S].
- On the difficult SMC dataset, a 2026 study reports state-of-the-art systems [still around F=0.63](https://arxiv.org/html/2605.12287) [S].
- EDM structure work exists but is largely offline: [Yadati et al. drop detection, ISMIR 2014](https://archives.ismir.net/ismir2014/paper/000297.pdf) [S, OLD] and the [EDMFormer 2026 preprint](https://arxiv.org/abs/2603.08759) [S].

**Web Audio constraints**
- The default render quantum is [128 frames; a hardware-selected size is now specified](https://www.w3.org/TR/webaudio/) [F].
- `outputLatency` [varies and should be queried often when precise sync matters](https://www.w3.org/TR/webaudio/) [F].
- AnalyserNode [fftSize runs 32 to 32768, default 2048; smoothing default 0.8 uses one coefficient](https://www.w3.org/TR/webaudio/) [F].
- AudioWorklet runs on a [dedicated audio thread shared with the audio graph, communicates via MessagePort, and requires a secure context](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet) [F].

**Safety**
- WCAG 2.3.1 sets a limit of [three flashes per second unless below defined thresholds](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) [S]. It is a web standard, not a venue regulation.

### Inferences
Recommended pipeline (engineering judgement, to be validated on real sets):
1. **Run analysis in an AudioWorklet or worker.** Set AnalyserNode smoothing to 0 if it is used, because one coefficient slows attacks and releases equally. Apply separate attack and release envelopes downstream.
2. **Mind the window.** A 2048-sample FFT spans about 42.7 ms at 48 kHz. Use a shorter window for transient detection and a longer one for bass and tonal features.
3. **Split the signal by musical role:** sub/kick, bass, low-mid body, presence, air, plus flux, centroid and flatness.
4. **Adaptive gain:** per-band rolling percentile normalisation with a noise floor and a silence gate. Slow it enough that a breakdown still reads as quieter.
5. **Onsets:** spectral flux with an adaptive threshold and refractory period.
6. **Tempo:** a phase-locked clock that flywheels through breakdowns. Only accept tracker corrections above a confidence threshold, and slew phase rather than jumping.
7. **Musical mapping:** kick to impulse or zoom, bass to fold depth, centroid to colour or detail, flatness to noise or roughness, long-term energy to complexity. Keep structural changes such as symmetry count on bar or phrase boundaries.
8. **Anti-jitter:** hysteresis on discrete changes, rate limits on camera and fractal parameters, and a limit on how quickly high-sensitivity fractal parameters can change.
9. **Latency compensation:** measure audio-to-photon delay and expose a per-venue offset. With a stable clock, visuals can be scheduled ahead of the beat.
10. **Flash governor:** at 120 BPM, one full flash per eighth note is 4 Hz, which exceeds the three-per-second limit unless below threshold. The limiter should run after all modulation.
11. **Licensing:** BTrack, aubio, Essentia.js and madmom's models all carry restrictions that matter for a closed commercial product. A small in-house flux and tempo tracker is the lowest-risk baseline.

### Gaps
- No single current benchmark compares BTrack, aubio, Essentia, madmom and BeatNet in real time on club music. A project-specific test set is needed.
- The search summary linked both BeatNet+ and a 2024 zero-latency PLP tracker (Meier, Chiu and Müller) to one DOI. The PLP citation needs checking before use.
- Browser support for configurable render quantum was not verified.

## How should installations handle interactivity and long-form evolution?

### Takeaway
Installation readiness is a separate product mode: presence-driven behaviour, multi-timescale evolution, scheduling and unattended recovery. Public evidence on avoiding visual repetition over days is thin, making this a real opportunity.

### Cited Findings
- Brian Eno's *77 Million Paintings* builds its scale from [296 original works layered and combined](https://Www.Wikipedia.org/wiki/77_Million_Paintings) [S, OLD]. Combinatorial layering is a proven long-form concept.
- A RealSense D415 project [segments by distance, so it works under ambient light with no backdrop](https://hackaday.io/project/205947-bubblesynth-bubbles-lasers-and-a-modular-synth) [S].
- A two-month TouchDesigner and Azure Kinect installation [used a custom script to start and autorun at scheduled times](https://www.creativeapplications.net/member/space-odyssey-azure-kinect-touchdesigner-powered-interactive-projection) [S].
- A large LED project used a [Python and TouchDesigner scheduler, with each concept's presets in separate versioned text files](https://derivative.ca/community-post/leviathans-extraordinary-150-media-stream-living-digital-sculpture/60672) [S, OLD].
- Lozano-Hemmer's operating manual covers [power-cycle recovery and careful depth-camera cleaning to avoid misalignment](https://www.lozano-hemmer.com/texts/manuals/reporters_with_borders_realsense.pdf) [S, OLD]. Long-run work needs operator documentation as well as software.
- Resolume 7.28 brought [depth estimation and human segmentation](https://resolume.com/blog) into a mainstream VJ tool [F], which lowers the barrier to camera-only presence effects.

### Inferences
- **Evolution model:** nest timescales (seconds, minutes, hours, days), using non-integer or coprime cycle lengths, with a seeded journey through curated regions of parameter space.
- **Novelty memory:** store compact visual fingerprints and penalise returning to recently seen states. Exact repeats matter less than perceived sameness.
- **Quality guard:** reject states that are black, blown out, too noisy or too static, and move to a nearby safe state.
- **Presence model:** use privacy-preserving aggregate signals (count, proximity, motion energy, dwell). Idle should be a designed state, and the piece should settle gradually when people leave.
- **Unattended operation:** watchdog, WebGL context-loss recovery, day-part schedules, brightness curves, remote health status, config snapshots and a printed recovery runbook.

### Gaps
- No published metric or benchmark for "non-repetition over days" in live visuals was found.
- Long-run browser/WebGPU stability evidence was not researched and should be soak-tested on target hardware.
- Legal requirements for camera sensing in public spaces vary by jurisdiction and were not researched.

## Which capabilities are unserved, and what would make this industry-leading?

### Takeaway
The strongest opening is a **phrase-aware, performable fractal instrument**: curated macro control over deep fractal spaces, safe morphing between structurally different states, and reliable musical timing. Individual features exist elsewhere; the differentiator is their integration around this one visual domain.

### Cited Findings
- Deep fractal tooling exists mainly as [TouchDesigner community toolkits](https://derivative.ca/tags/fractal) [S], which require a host patch and operator design.
- Synesthesia offers [scene-based GLSL performance](https://synesthesia.live/) [F], but its public material does not describe cross-scene structural morphing.
- Arena's documented Pioneer integration focuses on [linked playback of track-matched clips](https://resolume.com/article/137) [F].
- Beat Link Trigger proves [phrase-type triggering is technically possible](https://raw.githubusercontent.com/Deep-Symmetry/beat-link-trigger/main/README.md) [F], but through an unsanctioned community stack.
- Offline EDM section models are advancing ([EDMFormer](https://arxiv.org/abs/2603.08759) [S]), while hard-case beat tracking [remains imperfect](https://arxiv.org/html/2605.12287) [S].
- Competitors are moving quickly on [spectral analysis, depth and AI-accessible APIs](https://resolume.com/blog) [F], so generic versions of these features will not stay differentiating.

### Inferences

**Differentiators, ranked by likely value and defensibility**

| Rank | Capability | Market status from this research | Confidence |
|---|---|---|---|
| 1 | **Structure-aware fractal morphing** across formula, fold and symmetry changes without pops | Not found in surveyed tools | Medium-high |
| 2 | **Semantic macro system** with safe ranges over 100+ parameter fractal spaces | Possible to hand-build; not found as a product feature | High |
| 3 | **Phrase engine:** count-in, 8/16/32-bar launch, build and drop behaviours, using DJ data when present and audio estimation otherwise | Parts exist, integration not found | Medium-high |
| 4 | **Timing trust UI:** clock source, confidence, phase, one-touch downbeat correction, flywheel | Not found as a unified feature | High |
| 5 | **Reference-quality kaleidoscope:** clean centre, seam-free folds, anti-aliasing, animated symmetry changes, wallpaper and polyhedral groups | Users report artifacts in basic effects | Medium |
| 6 | **Musical mapping presets** that survive genre and level changes | Tools expose raw routing | Medium |
| 7 | **Installation mode** with novelty memory, quality guard, presence states and recovery | Usually custom-built per project | Medium-high |
| 8 | **Built-in flash governor** that works after all modulation | Not found in surveyed tools | Medium; absence not exhaustively proven |
| 9 | **Projection-aware fractals:** detail, brightness and symmetry axes adapt to mapped surfaces | Not found; this repository's mapping stage is a natural base | Medium |
| 10 | **Zero-install browser delivery with interoperability** through MIDI, OSC bridge, NDI/Syphon/Spout path and shader export | Desktop tools dominate | Medium; depends on bridge quality |

**Table stakes, not differentiators:** MIDI learn, OSC, tap tempo, Link, BPM-synced LFOs, band-based FFT, presets, shader import, and video output into other tools.

**Do not try to compete on:** media-server scale, multi-machine frame-lock, full node-graph authoring, or general clip playback. Resolume, TouchDesigner, Smode and disguise are entrenched there. Integrate with them.

**Suggested proof points for an "industry-leading" claim:**
- No visible pop in a defined set of cross-formula morphs.
- Beat phase holds through a 32-bar breakdown on a test set.
- A new operator produces a usable set within 10 minutes using macros only.
- A 72-hour soak test with no crash, black-frame lockup or detected near-repeat.
- Flash limiter passes an automated analysis on captured output.

These targets are proposals, not industry standards.

### Gaps
- Absence claims mean "not found in sources reviewed", not proof that no product or private patch does this.
- Hands-on testing of the competing products was not performed.
- Market size, buyer willingness to pay and share by tool were not found in reliable sources.
