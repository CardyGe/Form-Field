# Displacement engine: rulings

Decisions made while building branch `warp-engine`, in order: what was decided, why, and what it costs if wrong.

- carry forward the HDR, loop-seam, engage and release rules proved on the Colour and Time branch — they fixed real defects there — low.
- each warp's colour fringe follows only its own movement — total coordinate change would make Mirror and Polar explode the fringe — small extra shader state.
- keep the 1.25-footprint sparkle filter — it halves shimmer at 4K — squeezed areas are slightly softer.
- always use 4 taps above one texel, bendScale also scales Magnetic fade, and Ripple uses bendFalloff — simple and consistent controls — low.
- Liquid keeps a 16-step maximum although Chaos at 16 steps misses 60 fps at 720p (21.6 ms) — the default is 6 steps at 9.5 ms and high steps suit exports — heavy settings can drop preview frames.
- Trail applies to Flow only — the plan's control rule says so — Trail has no effect on other styles and stays hidden there.
- luma-scale compares movement on busy pictures and the image on smooth sources for Edges and Contours — 1x cannot resolve the fine folds that 2x shows, and movement matches to .26% — busy Edges looks may differ slightly between preview and 4K.
- keep slope gain .1, minimum reach .002 and the nine-read kernel — sensible measured defaults — Edges and Contours are gentle on smooth pictures.
- To circle shows the picture twice, mirrored — this is the only way to avoid a wrap seam on any picture — one continuous unmirrored image is not available.
- Luma Layer below is not folded by Mirror — it follows the shape where it appears on screen — a mirrored layer can bend asymmetrically.
- accept one-half-float-step differences in Plasma, Edges and Contours after the shared filter change — at most .00049 on under 100 of 2 million values, and no existing saved look uses these new effects — invisible if wrong.
- allow one hasLayerBelow prop in MapEffectTab despite the no-Map-code constraint — it lets Map's shared Finish panel show the same bottom-layer message — one line to remove.
- leave the existing "Time displacement" label — the plain-label rule was written for new warp controls — one technical word stays in the Time effect.
- keep the per-type Warp gains, so Waves peaks at .275 of frame height instead of the plan's .5 — the same amount now looks similar across all five types — maximum Waves bend is smaller.
- Luma Warp stays with Fractal named as a weak case at high amounts — fine fractal detail drives fine grain, and softness did not cure it — users should keep Luma low on Fractal.
- Luma Warp, Polar and Mirror may be still on a still Image — they follow the source and have no motion by design unless animated — those looks need a moving source or a Motion route.
- Mirror and Polar pivot on the layer's transformed centre and rotation — otherwise a moved layer can vanish — full-frame generators are unchanged at a default transform.
- leave Map sound-reaction visibility for later — Map links are outside this engine's data model — warp controls stay hidden while a reaction drives an amount from base 0, so raise the base amount first.
- a moved bounded Image takes no fold past its own edge, and a fold needing an off-frame part shows a reflection at the frame edge — this prevents stray copies, and the hidden part is not rendered — partly off-frame mirrored images can look slightly different from a full copy.
- do not merge with the Cover tear and do not start a second fix wave unasked — the workflow allows one fix wave and this defect is visible — the branch waits for the owner's go-ahead.
- when a moved bounded Image's fold needs a part that is off-frame, that pixel stays unfolded — off-frame source does not exist, and a picture must never vanish — symmetry is incomplete on those pixels. This replaces the earlier frame-edge reflection ruling for bounded Images.
- Unroll on a Contain Image may read its own transparent bars, recorded as one named exception at .780x plain — that is what unrolling a letterboxed picture means, the picture stays visible, and hiding the bars would change in-frame renders — this pose shows some gaps.
- treat a Contain Image's transparent bars as outside the picture, replacing the Unroll exception ruling — Mirror and Polar are unreleased, so no saved look depends on the old result, and a picture must not nearly vanish — mirrored Contain Images fold at their visible edge.
- apply the picture-edge rule to unmoved Contain Images too — Mirror and Polar are unreleased, and a default-position picture must not nearly vanish either — default mirrored Contain looks change from earlier branch commits.
- bounded Image symmetry may be approximate within about 1.4 texels of its edge and creases — this keeps filtered reads off transparent pixels and removes dark lines — a very slight edge asymmetry can remain.
- stop before another fix round and ask — this combination was outside the approved Cover fix and is a product trade-off — the branch stays unmerged until the owner decides.
- while Mirror is between 0 and 1, its plain half is not held, so a later warp still bends that half's outline in proportion — holding it would make the picture jump as Mirror leaves 0 — partial Mirror can show some bent outline.
- gate stacked-warp tears by distance between neighbouring reads (picture-hold), and report busy-picture hard steps only — a later warp adds hard steps on busy detail even on a full-frame Image with no picture rule — a subtle tear that keeps reads close could pass.
