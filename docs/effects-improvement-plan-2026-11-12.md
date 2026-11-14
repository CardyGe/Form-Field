# Form & Field: effect improvement plan (rewritten)

12 November 2026 · main at `29f9aa6` (0.12.0, build 8)

This replaces the plan drafted on 11 November. It accounts for the six commits made to `main` since then. Judgements come from stills: the 11 November contact sheets for untouched families, and the newer renders in `work/oil-tune/` and `work/seam-audit/` for the reworked ones. Full-speed motion has still not been reviewed.

## 1. What has been done since the last plan

| Commit | What it added | How it looks in the stills |
| --- | --- | --- |
| `bb1a2b0` Feedback | Any layer (except Graphic and evolving Ink) can echo into itself with zoom, turn, drift, hue shift and melt. Exports warm up until the loop closes. | Recursion Tunnel is the first look that matches the feedback-tunnel reference: flat neon, hard outlines, real depth. |
| `f530bd0` Versioning | 0.12.0, build number in the footer, a post-commit hook that repackages the app, faster feedback editing. | Not visual. |
| `1a663b8` Slit-scan | Time displacement through rows, columns, rings, diagonal or blocks. Stateless, so loops stay exact. | Time Terraces and Block Shuffle are crisp and on-reference. |
| `db37628` Oil ink | Ink inside the dome is now grown by reaction-diffusion (maze, threads, foam), with a hard shadow and paper texture. | The ink is much better: solid, crisp, varied between presets. The composition is unchanged: one blob and one dome on a flat ground. |
| `a990f6a` Super 8 | Rolling shutter on every mode, plus a Painted Tunnel mode and preset. | Painted Tunnel is the strongest new look: full frame, saturated, matches the scanned-paint reference. |
| `29f9aa6` Ink Evolving | The clip now loops by receding back to its opening state. | The seam is clean (measured ratio about 0.98). The picture is unchanged: soft pale blobs that grow until they cover almost the whole frame. |

Tests on main: 95 unit tests and 31 Electron tests pass; typecheck is clean.

### What that changes

- **The engine gap is closed.** The old plan's biggest shared item (feedback) is done, and slit-scan arrived as a bonus. Both are per-layer finishes, so every family can use them.
- **The cull never landed.** `main` still has all six retired families and now has 151 presets, up from 144. The removal sits uncommitted in `work/wt-effect-cull`, six commits behind, and will not merge cleanly (`project.ts`, `App.tsx`, `instruments.ts`, the tests and the README all moved).
- **Surface grew from 22 to 28 presets.** The six new feedback and slit-scan looks were added as Surface presets. They are finishes, not Surface variants, and they hide the fact that any family can use them.
- **Nothing from the look-language list has started:** palettes are still pastel outside Surface, Oil and Super 8, and motion is still one shared phase.

## 2. Where each family stands now

| Family | Presets | Status | What is still wrong |
| --- | ---: | --- | --- |
| Surface | 28 | Strong, and now the showcase for feedback and slit-scan. | Too many presets; four are the same portal over bands; base motion is still one wobble. |
| Super 8 Paint | 7 | Strong. Painted Tunnel sets the bar. | The older modes still use a procedural checker for paint. |
| Oil Slides | 9 | Improved ink, right palette. | All nine are the same composition. |
| Graphic Patterns | 32 | Unchanged. Good range. | About eight near-black presets; purple dominates; everything moves in sync. |
| Fractal Worlds | 15 | Unchanged. | Small object centred on black; 3D boxes barely move. |
| Kinetic Relief | 7 | Unchanged. | Uniform grid; beige shading. |
| Resonant Sand | 4 | Unchanged. | Hardly changes over the loop. |
| Living Ink | 7 | Loop fixed, look not. | Evolving presets are soft, pale and over-fill; loop presets barely move. |
| Velvet Currents | 7 | Unchanged. Probation. | Uniform line combs, or a few sparse strokes. |
| Sculpture | 11 | Unchanged. Probation. | Tiny pastel object in a tenth of the frame. |
| Image | n/a | Unchanged. | Only a layer, not a source for other effects. |
| Caustic, Magnetic, Loom, Reef, Prism, Veils | 24 | Still on main. | Retired in the cull; see stage 0. |

## 3. Rules every preset must meet

Unchanged. A preset that fails after its family's pass is deleted, not tuned.

1. **Fills the frame**: at least 60% coverage at defaults, unless the empty area is clearly deliberate.
2. **Reads on a wall**: full-saturation colour on black or a flat ground.
3. **Changes over the loop**: three phase stills are obviously different at thumbnail size.
4. **Not in unison**: elements move with offsets, delays or travel.
5. **No twins**: presets in a family differ in structure, not only palette.
6. **Clean at projector scale**: no line pitch under about 4 px at 1080p, no hard seams.

Recursion Tunnel, Time Terraces, Block Shuffle and Painted Tunnel already pass all six in stills. They are the reference for "good enough".

## 4. The plan

### Stage 0: land the cull on main

Re-apply the removal on top of `29f9aa6` rather than merging the stale branch. The change is mechanical: drop the six kinds from `instruments.ts`, `instrument-shaders.ts`, `canvas-interaction.ts`, the `App.tsx` icons and help text, and the export validator; keep the `RETIRED_KINDS` drop-on-load in `project.ts` and its test; update preset counts (151 becomes 127) and the verification scripts. Then delete the `effect-cull` branch and worktree.

Done when: unit tests, `verify-instruments.mjs --quick` and `verify-workspace-ui.mjs` pass on main.

### Stage 1: shrink and recolour (no new rendering code)

1. **Preset cull to about 70.** Apply rules 2 and 5. Surface portal twins down to one; the near-black Graphic presets; two of three Sculpture shells; `signature-*` presets that duplicate their base.
2. **Move feedback and slit-scan looks out of Surface.** Offer them as finish presets that apply to the selected layer of any kind, and keep one or two Surface examples. This is what makes the new engine work pay off across the library.
3. **Palette reset.** Replace the `cool`, `warm` and `pearl` instrument palettes and the pastel Sculpture and Fractal palettes with the neon sets already used by the new Surface looks (`NEON_STRATA`, `POP_PORTAL`, `ACID_DRIP`) plus three or four more. Make flat colour with outlines the default finish for Graphic, Relief and Resonance.

Done when: every family's contact sheet passes rule 2.

### Stage 2: per-element timing, then the three flat families

4. **Timing helper.** Each element (band, tile, petal, panel) gets a phase offset from its position or id, plus an optional hold. Integer cycles keep loops exact.
5. **Surface.** Bands run at their own speeds; Drips start, run, pool and restart with staggered timing. Cull to about twelve.
6. **Graphic Patterns.** Apply the helper to every family; add two or three size classes to tile and circle layouts. Target about 18 presets.
7. **Kinetic Relief.** Mixed panel sizes; opening spreads from one or two origin points; flat saturated faces with one hard shadow.

Stop if Surface does not pass rule 4 after this. It is the strongest family; if timing does not lift it, rethink before going wider.

### Stage 3: spend the new finishes on the weak families

8. **Fractal Worlds.** Scale 2D forms to fill the frame and add a continuous zoom loop. Put the 3D camera inside the structure. Pair with feedback for a tunnel look.
9. **Living Ink.** Restyle Evolving with a hard edge and flat saturated colour instead of the soft pale emboss, and cap coverage so it stays between 30% and 70% across the loop. Add flow to the loop presets so veins visibly travel. Fix the `surfaceHole` control that the full verification script reports as inactive.
10. **Velvet Currents (probation).** Drop the comb presets. Raise strand count five to ten times, vary width along each strand, and use feedback for trails. If it still reads as sparse scribbles, cut the family.

### Stage 4: composition and real texture

11. **Oil Slides.** Add two layouts beside the current one: a full-frame pour with many cells, and edge-to-edge lacing. Make the dome optional. Cells split and merge over the loop.
12. **Image as a source.** Let any effect take an imported image as its colour source.
13. **Super 8 Paint.** Feed scanned paint through the older modes in place of the procedural checker; vary layouts so they are not all one diagonal.

### Stage 5: the last two

14. **Resonant Sand.** Score a sequence of modes (hold, snap, hold, return) and fill regions with flat colour.
15. **Sculpture (probation).** Frame to fill the screen, toon shading with an outline, rotation that changes the silhouette. If it still reads as a product render, cut the family.

### After every stage

Regenerate the contact sheets with the harness in `work/effect-audit-2026-11-11/` and check the six rules. Review at least the changed families at full speed in the app, since stills cannot judge rule 4. No new families until every survivor passes.

## 5. Open points

- The post-commit hook repackages the app after every commit on main. Stage 0 and stage 1 will each trigger it; that is expected.
- The dossiers under `docs/effect-audit-2026-11-11/effects/` still cover the six retired families and are kept as a record.
- `docs/fidelity-audit-and-plan-2026-11-11.md` phases 1 to 3 are now largely delivered (HAP, supersampling, seam check, flat colour, feedback, slit-scan). Its phase 4, the cube and surface template mode, is not in this plan; it should follow stage 2, once Surface and Relief are ready to wrap around faces.
