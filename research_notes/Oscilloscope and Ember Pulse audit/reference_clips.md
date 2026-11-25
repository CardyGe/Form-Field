# Reference clips: what they show for Oscilloscope and Ember Pulse

Evidence labels: **Cited Findings** are direct frame observations or pixel/audio measurements. **Inferences** are my interpretation. Timestamps are seconds from clip start. Luma is Rec.709 on a 0-255 scale, measured from the decoded video without display calibration. All three clips are compressed, so fine detail and exact peak values are approximate.

The clips are treated as inspiration for how each effect works. Nothing here is a brief to recreate a clip's composition, and Oscilloscope and Ember Pulse stay separate.

Source key: C1 = clip1, C2 = clip2, C3 = clip3. M = measurement taken from the original file with ffmpeg and a short analysis script.

[C1]: </Users/grego/Downloads/SaveClip.App_AQPnlkwR4TchNV_iQgYzrI6g9OoufeJsqyJ4TIWlfIlEHmOHERa8Wf7GQr6nb_h8nK_bXdQiovvBVBUgJDNaqMHokNm4329BuXXCMPM.mp4>
[C2]: </Users/grego/Documents/Screenshot/Screen Recording 2026-11-12 at 19.32.24.mov>
[C3]: </Users/grego/Downloads/SaveClip.App_AQNnqFV2nB-1LEQN0BfTPwpjy02fo5jU56v_osQVFTKTRJJUH0IBjRsrY0K9m4Wfc2eXpPt1CBvQmAJIEtqWHYVDu3R1ysLXw_xcXa0.mp4>

## Which clip demonstrates which effect?

### Takeaway
Clip3 is the Oscilloscope reference (high confidence). Clip1 is the Ember Pulse reference (medium-high confidence). Clip2 demonstrates neither; at most it is a reference for restraint and hard timing.

### Cited Findings
- Clip3 shows a single glowing vector-like trace forming Lissajous-style figures, figure-eights, looped orbits and jagged wrapped tangles inside a roughly circular silhouette — [C3, 2.3 s, 7-8 s, 10.4 s][C3].
- Clip3's trace sits over a separate liquid backdrop of red, orange and yellow oil-like droplets, which later becomes marbled magenta/violet and molten yellow — [C3, 0-20 s][C3].
- Clip1 shows a red-orange radial burst made of thousands of fine filaments, with sparse pale dust and thin contour-like lines around it, flashing in hard pulses on black — [C1, 1.87-4.3 s][C1].
- Clip2 is a screen recording of a white geometric title animation: play icon, concentric rings, radial hairlines, green dots, an RGB glitch burst, then collapse to a dot and a "MICRODOSE" wordmark. It has no audio track — [C2, 0-7.1 s][C2].

### Inferences
- Clip1 is closer to Ember Pulse by colour and pulse behaviour, but it is **filament-and-spark fire, not soft smoke**. If Ember Pulse is meant to be smoky, this clip argues for adding fine structure rather than more blur.
- Clip3's droplet backdrop is not evidence for Oscilloscope's own look. The usable evidence is the trace and how it holds up against a busy or empty background.
- Clip2 may have been included for its pacing or graphic discipline. Its intended role cannot be determined from the video alone.

### Gaps
- The user's intended clip-to-effect mapping is not stated in the clips. Confirming what clip2 was meant to show would remove the main ambiguity.

## Line and beam: how does the trace look?

### Takeaway
The clip3 beam reads as light because it has a narrow near-white core, a saturated coloured body, a tight halo, and strong brightness variation along one continuous path. Its colour moves toward white through channel saturation rather than simply getting brighter.

### Cited Findings
- Measured beam width on two scanlines at 7.5 s: 8-12 px at half maximum of the blue channel, or about 1.1-1.7% of the 720 px frame. Oblique crossings and video blur inflate this — [M on C3, 7.5 s][C3].
- Cross-section at 7.5 s runs from background about (250, 5, 10), through (246, 7, 103) and (255, 153, 247), to a core about (252, 205, 255). Red stays near clipping while green and blue rise — [M on C3, 7.5 s][C3].
- The core-to-background shoulder is narrow, about 2-4 px per side on the sampled scanlines — [M on C3, 7.5 s][C3].
- In the blue section, the halo is deep blue, the body is cyan, and short hot segments turn pale pink/magenta — [C3, 2.3 s][C3].
- Brightness varies along the path: short dashes and some curve segments are near-white while neighbouring lengths remain saturated red — [C3, 10.42-10.69 s][C3].
- At 7-8 s, a bright figure-eight sits inside a dimmer enclosing circle. A short darker violet section travels around the path from frame to frame — [C3, 7.0-8.1 s][C3].
- Curve families seen: figure-eight, rotated loop/orbit figures, fish-like crossed loops, dense sphere-like windings, and square-wave or stepped jagged paths wrapped around a sphere — [C3, 2-20 s][C3].
- Dense figures foreshorten and pack toward the circular limb, giving a globe-like impression without visible 3D shading — [C3, 2.3 s, 10.4 s][C3].

### Inferences
- The strongest beam model is **core + coloured body + tight halo**, with HDR-style values tone-mapped so the core desaturates toward white. A flat colored line with bloom would miss the hue shift.
- Along-path intensity variation is essential. It is consistent with analog beam dwell, where slower segments receive more energy, but the clip does not prove that speed causes it.
- The travelling darker section suggests a scan or refresh phase, or a camera capturing a scanned light source. A subtle moving write-head or phase variation would add life; a literal gap is optional.
- The depth comes from path geometry and limb density, so a real 3D camera is not required to get this quality.

### Gaps
- Speed-to-brightness cannot be measured without recovering the beam's path timing.
- Trace count is ambiguous: the dimmer circle may be a second trace, persistence, or part of one long path.
- Persistence length cannot be separated from camera exposure and compression. The shape appears to refresh within about 1-2 frames during fast changes, so long phosphor tails are not evident.

## Ember, smoke, and glow: how does the material behave?

### Takeaway
Clip1's material is a dark red volume defined by bright, thin gold filaments and sparse sparks. Its luxury comes from fine detail and a tightly controlled black-red-orange-gold ramp, not from large amounts of glow.

### Cited Findings
- Colour ramp at a pulse peak, mean RGB by rising luma bin: (32,16,5), (79,37,11), (144,64,25), (179,95,48), (203,130,79), (226,164,112), (245,197,146), (254,229,184) — [M on C1, 3.9 s][C1].
- At that peak, 47.8% of pixels have luma below 32 and only about 1.4% have luma of 160 or higher — [M on C1, 3.9 s][C1].
- The dense centre is saturated red-orange and softer; the brightest gold mostly appears on thin filaments, ridges and outer edges — [C1, 3.0 s and 3.9 s][C1].
- The structure combines fibrous radial strands, folded sheet-like contours, small pale dust specks, and thin outer arcs — [C1, 3.0 s and 3.9 s][C1].
- Low-energy frames keep the same overall mass in dim red, with far less gold — [C1, 1 frame/s sample][C1].
- Pulses visibly change the structure as well as the brightness: strand layout and the ring/contour shapes differ between neighbouring pulses — [C1, 3.0-4.1 s][C1].

### Inferences
- Map heat to **both** colour and detail. A pulse should reveal hot filaments, not simply multiply the whole image.
- Turbulence should be multi-scale: a large radial form, medium folds, and very fine strands. Single-scale noise would look like generic smoke.
- Keep gold scarce. The measured distribution suggests highlights should occupy only a few percent of the frame even at peak.
- Sparks should remain sparse and small so they add scale without becoming a confetti layer.

### Gaps
- It is not clear whether clip1 is a particle simulation, displaced line geometry, feedback, or an edge-processed fluid render. The notes describe appearance only.

## Motion over time: pacing, evolution, and beat response

### Takeaway
Clip1 is percussive: near-instant attacks, short holds, fast falls, and real blackout between hits. Clip3 is continuous within a section, then punctuated by sudden changes in the curve, palette, or backdrop.

### Cited Findings
- Clip1 per-frame luma from 1.60 s includes 24, 39, 41, 26, 4, 1, 1, 1, 36, 36, 36, 17, 15, 8, 7, 6, 35, 33, 17, 3, 1, 0, 0. Attacks take about 1 frame, holds 2-4 frames, and falls about 3-6 frames at 30 fps — [M on C1][C1].
- Clip1's largest frame changes repeatedly land on a 2-second grid: 1.87, 3.87, 5.87, 9.87, 11.87, 13.87, 17.87, 21.87, 25.87 and 27.87 s — [M on C1][C1].
- Clip1 luma autocorrelation peaks at 60 frames (2.0 s, r = 0.48) — [M on C1][C1].
- Clip1 audio onset autocorrelation peaks at 1.0 s (r = 0.50) and 0.5 s (r = 0.37), and overall luma correlates with audio RMS at r = 0.44 — [M on C1][C1].
- Clip3's largest changes cluster near 1.97, 6.03-6.20 and 10.30-10.40 s, about 4.2 s apart. At 1.97 s the backdrop drops out within a few frames while the trace remains — [M and frames on C3, 1.85-2.15 s][C3].
- Clip3 can hold one figure family for about a second with slow drift, as in the figure-eight at 7-8 s, and can also change a dense tangle substantially within 1-2 frames at about 10.4 s — [C3][C3].
- Clip3 trace colour moves from cyan/blue, through violet near 4 s, to red/pink afterwards. The backdrop reaches its brightest period near 17 s — [C3 and M][C3].
- Clip3 luma does not track audio RMS overall (r = 0.03), and its audio onset periodicity is weak (best r = 0.25) — [M on C3][C3].
- Clip2's motion alternates clean and heavily glitched frames during its burst, with luma periodicity at 5 frames of 60 fps video (12 Hz, r = 0.61) — [M and frames on C2, about 4-5.5 s][C2].

### Inferences
- Ember Pulse should use a fast attack with a designed release curve and let the output reach true black between strong hits. A smooth sine-like pulse would lose the character.
- Clip1 likely follows music at 120 BPM with accents every 4 beats, but the metadata cannot confirm the tempo.
- Oscilloscope should combine continuous phase motion with occasional quantized figure changes. Its reference does not support driving overall brightness directly from loudness.
- The 1 frame/s clip1 sheet appears to alternate bright and dim because it undersamples the pulse pattern. That alternation should not be read as the true rhythm.

### Gaps
- Clip1's plateaued luma values could be an intentional stepped/stutter treatment or a source-frame-rate artefact.
- The musical relationship in clip3 could exist in frequency bands or phrase structure not captured by broadband RMS.

## Composition, black level, negative space, and venue readability

### Takeaway
Clip1 is the stronger guide for projector and LED use because it protects black and concentrates energy. Clip3 proves the beam can survive visual density, but its strongest and most legible moments are those with room around the trace.

### Cited Findings
- Clip1 luma: mean 10.3, median 0, 95th percentile 46, 99th percentile 79 after downsampling — [M on C1][C1].
- Clip1 has approximate mirror structure, with median correlation 0.68 left-right and 0.71 top-bottom. Clip3 scores 0.41 and 0.33 — [M on C1 and C3][C1].
- Clip1 uses a central mass with thin structures near the frame edges and large dark regions — [C1][C1].
- Clip3 luma: mean 56.8, median 47, 95th percentile 160, with mean RGB 148/31/39. It is much brighter and redder than clip1 — [M on C3][C3].
- Clip3's trace silhouette usually occupies about 60-65% of frame width (visual estimate) — [C3][C3].
- In clip3's late, full-frame backdrop, the thin trace becomes noticeably harder to separate from the image — [C3, about 18-20 s][C3].
- Clip2 keeps a near-black field around luma 10-11 and uses white line weight contrast between heavy rings and hairlines — [M and frames on C2][C2].

### Inferences
- On a projector, real black will be lifted by the room, so large dark areas and high local contrast matter more than subtle shadow detail. Clip1's low-luma detail may disappear; its gold filaments will carry.
- On an LED wall, single-pixel strands may alias or vanish depending on pixel pitch, so line width and spark size should have a minimum tied to output resolution.
- Oscilloscope should keep a clean field by default, because trace legibility falls quickly once the background competes in the same hue and brightness range.
- Saturated red is risky on some projectors and LED processors. Peak detail should retain some green/blue energy, which both the clip1 ramp and the clip3 core do.

### Gaps
- No venue footage is included, so projector and LED conclusions are engineering inferences, not observed results.

## What makes each effect feel high-end?

### Takeaway
For Oscilloscope, the premium quality is believable light on a precise, evolving path. For Ember Pulse, it is restraint: fine hot detail, black space, and a hard rhythmic envelope.

### Cited Findings
- The rankings below are drawn from the measurements and frames cited in the sections above — [C1][C1]; [C3][C3].

### Inferences

**Oscilloscope, ranked**
1. A near-white core inside a saturated body, with hue shifting through clipping.
2. Large brightness variation along a single continuous path.
3. A tight halo that keeps the line crisp instead of fogging the frame.
4. Mathematically coherent curves: Lissajous loops, orbit figures, and stepped waveforms.
5. Depth implied by wrapped paths and density at the limb.
6. Continuous phase drift punctuated by sudden figure changes.
7. A subtle travelling scan or phase irregularity that makes the beam feel physical.
8. Palette shifts by section rather than constant colour cycling.
9. Enough clear space for the trace to stay the subject.

**Ember Pulse, ranked**
1. A disciplined black → deep red → orange → pale gold ramp.
2. Very fine filament detail, with the brightest values on thin edges.
3. Real blackout or near-blackout between major hits.
4. Near-instant attack, short hold, fast designed decay.
5. Pulses that reveal or reshape structure instead of only changing exposure.
6. Multi-scale radial turbulence: large mass, medium folds, fine strands.
7. Scarce highlights, only a few percent of the frame at peak.
8. Sparse tiny sparks that add scale.
9. Loose, imperfect symmetry that feels designed without looking kaleidoscopic.

### Gaps
- These rankings are an informed visual judgment from three clips. A/B testing in the app on the actual projector or LED wall would be the best validation.
