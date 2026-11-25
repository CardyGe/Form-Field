# Colour and Time engines: rulings

Decisions made while building branch `colour-time-engines`, in order: what was decided, why, and what it costs if wrong.

- short-circuit neutral — test demands exact value — trivial if wrong |
- supportsLens excludes graphic only; Scope keeps Split and Gradient — the constraint's reason is tiled sources, and Scope is a full-frame source like Print allows — if wrong, one-line filter change.
- gradientStops(0) may return up to 6 stops; renderer uses uGradCount with uGradStops[6] — plan already defines this — no cost.
- replace rgb<=alpha with a bound by the brightest sampled straight colour — the literal clamp clips legitimate HDR and makes Split jump on engage (240/255 on Sculpture edges) — if wrong, slight fringe brightness on soft edges.
- alpha-fringe limit measured under exact highlights — soft highlights tone-map after the pass — report only.
- keep Lens easing at tile edges and the one-pixel Edges step — needed for seamless tiles and resolution stability — small extra code.
- zero-alpha samples may add light outside the straight-colour bound — premultiplied emissive light has no straight colour and dropping it makes Split jump — if wrong, faint light outside soft edges.
- all loop checks must compare across the wrap seam — phase 0 vs TAU is vacuous after normalisation — costs one extra render per check.
- gradient shift is doubled so offset 1 and each whole cycle equal one triangle-fold period — required for odd cycles to close the loop — offset control moves twice as fast as the literal plan.
- streak strength is glowStreak x glowMix — otherwise animating Glow from zero pops the streak on at full strength — streak looks differ from the literal plan at glowMix other than 1.
- Streak shape 1 is Cross only, a second chain at angle+90 with the same taps — the plan defines Line or Cross and no sharper variant — none.
- tint and grade apply to the streak — it is part of the layer's glow — none.
- Hue key ignores Key low and high, and softness is in half-range units — the plan defines hue by centre and range — Task 6 must show Low and High only in Brightness mode and Hue and Hue range only in Hue mode.
- new Time keys may appear as plain sliders until Task 10 — Task 10 owns the Time UI — only visible mid-branch.
- Time finish needs no tile wrapping — layerTileBlocker already prevents Time layers from tiling — if that changes, Vortex must wrap.
- time-engage gates .001 on a smooth layer and all sources at 1e-6 — a .001 turn genuinely moves sharp detail by several pixels, so my literal limit was wrong — no easing, keeps the brief's formula.
- bound only the change from a plain accumulation, so neutral holds by construction.
- engage neutrality for Colour lag is gated at the time pass; Flat colour and Feedback may amplify a one-step change — a 0.1% red nudge with no lag flips the same pixels, so this is existing threshold and feedback sensitivity — a user could see a sudden change only when first moving Colour lag on those looks.
- Twist engage gate at 1e-7 accepted — 1e-6 is a real sub-pixel move on sharp detail — low.
- keep the .001 uncovered-light threshold in stats modes — consistent with Split and Colour lag — up to +6/255 on 3 values at alpha 1/255.
- Median array depth follows the actual slice count instead of always 9 — saves up to about 400 MB at 4K for 3 slices and keeps more resolution — reallocates when the count changes.
- sliceSourceRenders must not count the Brightness driver in stat modes — they do not render it — one-line change outside Task 9's listed files.
- keep the time-looks render check and the Median cap note — I asked for the look check and the note explains the capped slider — none.
- Edge Prism look removed, 26 finish cards — the plan says remove a look that retuning cannot fix, and the Edges Split shape remains available — one fewer preset.
- project schema assertion follows actual behaviour, createProject writes 1 and files stay valid at 1 or 2 — plan wording meant no schema bump — none.
- Anamorphic stays if it clearly passes on at least three of the four test kinds, with Fractal named as a known weak case — my Task 11 dispatch allowed a look to miss one kind — one preset may do little on Fractal.
- Long Exposure must have its Image hairlines root-caused and fixed, or the look is removed — rule 6 is about clean projection, so a visible defect cannot ship in a preset.
- the workspace Focus preview timeout is left alone — it also fails on the untouched baseline (branch P/F/P, baseline F/F/P) — the UI check stays intermittent until fixed separately.
- the one-pixel edge line on plain moving Image layers is left alone — it exists in baseline and fixing it changes existing renders, which the constraints forbid — users can still see it on plain Image motion.
- looks no longer clear Colour balance or Key, overriding the plan's FINISH_LOOK_KEYS instruction — trying a look must not silently remove an artist's cut-out or grade — No finish will not reset them either.
- variations leave new effects at neutral when stored neutral, overriding Task 1 and Task 7 wording — the binding constraint says variations never switch an effect on — fewer surprises in variations.
- tint gain is capped at 16 — prevents near-black swatches exploding — very bright pixels can dim under saturated dark swatches.
- Streak angle stays fixed in variations — variations should not reorient an authored streak — less variation in streak looks.
