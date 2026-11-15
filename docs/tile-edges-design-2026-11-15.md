# Tile edges: design

Date: 2026-11-15
Status: draft for approval

## Why

People projection-map one clip onto every face of an object. A couch is the common case: each back cushion, seat cushion, arm and front panel is a separate mapped shape playing its own copy of the same video. Where two copies meet, the join shows, because the pattern stops at the frame edge.

The look we want is the clouds, wavy-rainbow and grid examples in the reference recording: the pattern *flows* from one cushion into the next, so the couch reads as one continuous surface. Copies that merely end on a matching colour were considered and rejected. The pattern itself has to continue across the join.

## Goals

- An optional **Tile edges** mode. When it's on, the exported frame wraps: the right edge continues exactly into the left, and the top into the bottom. That includes motion, so a shape leaving one copy arrives on the next.
- Each tileable instrument keeps the look it has today. Wrapping must not make a tuned look into a different look.
- The export confirms that a tiled clip really tiles, just as it already confirms that loops close.
- Tile edges works at any canvas size, including the square and portrait sizes that suit cushions.

## Non-goals

- Tiling instruments built around a centre or a single object: Feedback Glitch, Oscilloscope, Super 8, the fractals, Pearl Sculpture, and Resonant Sand's radial/mandala sequences.
- Matching copies that have *different* sizes or shapes. Tiling lines up only when neighbouring copies are mapped at the same scale and orientation. That's a property of the mapping, not of the clip.
- Border or frame treatments. They are a separate feature and may come later.
- Offsetting time per copy (each cushion at a different moment).

## Anti-goals (failure even if it technically works)

- **Changing anything when Tile edges is off.** Off is the default. Existing projects, looks and exports must render exactly as they do today, bit for bit where they are bit-exact now. Every wrap code path is gated on the setting.
- A visible join line, a brightness step, or motion that jumps or fades at the edge.
- Silently exporting a clip that doesn't tile. If something in the composition can't wrap, the user is told what it is, and the switch can't be turned on until it's fixed.
- A noticeably different look with Tile edges on: a different noise character, cell size or colour balance.

## Constraints from the current code

- The project already stores output settings next to `transparent` and `highlights` (`src/shared/types.ts`, validated in `src/core/project.ts`, where `keys(project, [...])` lists the allowed root keys). The Output section is in `src/ui/App.tsx`.
- Instrument fields are built from 2-D hash and value noise with fbm octaves. Most fbm loops rotate each octave (`spin(.6)`, `rot(.7)`), and that rotation is what stops the noise repeating (`src/rendering/instrument-shaders.ts`, `oil.ts`, `surface.ts`, `liquid.ts` and others).
- Layer transforms (scale, rotation, pan via `sourceUV`) apply before the field. Scale has to be a whole number of pattern periods across the frame, and rotation has to be a multiple of 90°.
- Living Ink's simulation (`src/rendering/InkSimulation.ts`) treats the frame edge as a wall: it clamps outside `[0,1]` to a fixed state and drops pigment there. Its stream function and seeds aren't periodic.
- Glow (`bloom.ts`), Print screen (`print-screen.ts`) and Flat colour outlines all sample neighbouring pixels, and today they clamp at the edge.
- Feedback echo zooms and moves each frame toward a centre, so it can never wrap.
- Layer masks, surface shapes and image layers are positioned in frame space and don't wrap.
- The export pipeline already has a loop seam check (`electron/seam-check.cjs`), which runs on reduced frames and reports with ratios against an absolute floor.

## Approaches considered

1. **Shared wrap core, one pilot instrument first (chosen).** Write repeating ("periodic") versions of the noise functions the instruments already use: same lattice, same interpolation, hash on the cell index modulo the period, with octave rotations replaced by rotations that keep the lattice (or by offsets alone). Add wrap support to the Living Ink simulation and the neighbour-sampling finishes. Each instrument opts in when it has been wired up and checked. *Trade-off:* real work for each instrument, but the looks are preserved and the joins are exact.
2. **Torus noise.** Feed every noise call coordinates taken from a 4-D torus (cos/sin of x and y), which wraps automatically. *Trade-off:* quick to spread across the instruments, but it changes every look's noise character, costs roughly twice as much, and does nothing for the shutter grid, the simulation or the finishes. *Rejected:* it breaks the "keep the look" goal and still leaves half the work.
3. **Edge cross-fade after rendering.** Blend each edge with the opposite one. *Rejected earlier:* motion fades out and back in instead of travelling across the join, which fails the "flow across" requirement.

You chose approach 1, with the requirement that Tile edges is optional and off by default.

## Design

### The setting

- A new optional project field, `tileEdges?: boolean`. If it's missing, it counts as `false`, so older project files load unchanged and no schema version bump is needed. Add it to the allowed root keys in the project validator.
- In the UI, a **Tile edges** checkbox goes in Finish → Output, next to Exact colour. The help line reads: "The exported clip repeats seamlessly side by side and top to bottom, for mapping copies onto neighbouring surfaces."
- The setting is saved with the project, so it travels with the composition and isn't a one-off export option. That way the preview and the export always agree.

### Support rules

- Every layer kind and finish declares whether it can tile, following the same pattern the app already uses for support rules (for example `supportsFeedback`).
- The checkbox can only be turned on when every *visible* layer can tile. If one can't, the checkbox is disabled and a line names each blocker, for example "Feedback Glitch can't tile", "Layer 2 has a mask" or "Feedback echo on Layer 1 can't tile".
- If Tile edges is already on and the user adds or turns on something that can't tile, the app says so through the usual notification and turns Tile edges off. *(Builder's call: blocking the edit instead is also acceptable. Pick whichever matches how the app handles similar conflicts, such as evolving chemistry and clip length.)*
- Blockers: non-tileable instruments, layer masks, surface shapes, image layers, Graphic layers, Feedback echo, and Resonant Sand's radial sequences. Slit-scan counts as a blocker until it is checked.
- Support can depend on a layer's style as well as its kind. A centred or radial style within an otherwise tileable kind (for example a ring style of Chromatic Field) is a blocker.

### Layer transforms while tiling

- **Scale** is left alone. Each spatial frequency inside the instrument instead snaps to a whole number of waves across the frame width, and separately across the height. *(Changed while planning: one Scale value can't fit Chromatic Field's many unrelated frequencies.)*
- **Rotation** snaps to the nearest multiple of 90°.
- **Pan** stays free, because panning a wrapping field still wraps.
- Animated scale or rotation counts as a blocker. Snapping every frame would make the pattern jump.

### Shared periodic noise

- One GLSL module provides periodic versions of each hash, noise and fbm function the tileable instruments use today, taking a period (cells per axis) as an extra argument. When Tile edges is off, the existing functions stay exactly as they are and are still called. The periodic versions are only used when the shader is compiled with a `TILE` define, or when a period uniform is non-zero. *(Builder's call which: a define avoids any cost when off.)*
- The fbm octaves keep their current scale step (about ×2.03). That only works if each octave's period is rounded to a whole number, which changes the scale step slightly. The aim is that a side-by-side comparison at default settings reads as the same look.
- Domain warps and flow offsets computed from periodic fields stay periodic, so no special handling is needed beyond using the periodic noise.
- Time stays non-periodic in space. Loop closure in time is unaffected.

### Living Ink simulation

- When Tile edges is on, state lookups, the Laplacian and pigment spread wrap (fractional UV / `RepeatWrapping`) instead of treating the edge as a wall.
- The stream function uses whole-number wave counts across the simulation domain, so the flow is periodic.
- Seeds are placed on the torus, with distance measured the wrapped way.
- The central obstacle counts as a blocker.

### Finishes

- **Glow:** the pyramid's down- and up-sampling wraps instead of clamping.
- **Flat colour outlines:** neighbour samples wrap.
- **Print screen:** a blocker in the pilot. Its rotated screens only repeat at special angles, so it gets its own follow-up.
- The final composite and output are unchanged.

### Tiled preview

- The preview gets a toggle that shows the frame 2×2 (or 3×3 at small sizes), so the user can see the joins while working. It only appears when Tile edges is on. It's a view only: it doesn't change the export and it isn't saved. *(My call: you can't judge a tiling without seeing the copies next to each other.)*

### Edge seam check

- Runs alongside the loop seam check, on the same reduced frames, and only for exports with Tile edges on.
- For a sample of frames, it compares the last column with the first and the last row with the first, against the largest difference between neighbouring columns and rows nearby. It uses the same ratio-plus-floor method as the loop check, so flat or still images pass.
- A failure is reported like a loop seam failure, naming the edge (left/right or top/bottom). The export still completes.

### Rollout

1. The shared core: the setting, the support rules, snapping, periodic noise, the wrapped finishes, the tiled preview and the edge seam check, all proven on the **pilot instrument, Chromatic Field**. *(My call: it's noise-only with no simulation, so it proves the core with the fewest moving parts.)*
2. Then each instrument separately, each opting in only once its exports pass the edge seam check and a side-by-side look comparison: Liquid Light, Oil, Texture Cuts, Kinetic Relief (whole number of columns), Living Ink (simulation work), and Resonant Sand's non-radial sequences.
3. Each instrument's looks in the library are checked with Tile edges on. Any look whose settings can't tile (for example animated rotation) is simply blocked with the usual explanation, not changed.

## Left to the builder

- The exact GLSL structure of the periodic module, and whether it's switched by a define or a uniform.
- How each instrument's base period is defined and exposed for snapping.
- The thresholds for the edge seam check, starting from the loop check's values.
- Whether a conflicting edit turns Tile edges off or is blocked (see Support rules).
- Tests: support rules, the snapping maths, project validation of `tileEdges`, and the edge seam check on synthetic frames (a tileable and a non-tileable image), following the existing `seam-check.test.cjs`. Add a render test showing that Tile edges off is unchanged.
