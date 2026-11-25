# Ember Pulse: real fluid smoke and more colour schemes

22 November 2026 · Form & Field 0.17.0 · For approval. Nothing is built.

## Why

The owner's verdict on Ember: "the smoke feels rubbish, no control, very samey".

Measurement agrees. Taking each smoke control from minimum to maximum visibly changes this share of the picture: Smoke 3.7%, Persistence 0.9%, Spread 0.7%, Lift 0.7%, Curl 0.2%, and Thickness, Detail and Lighting 0%. The current smoke is five scripted puffs drawn with noise on a fixed timing, so it repeats and cannot interact.

## Goals

1. Ember's smoke is a real fluid that rolls, collides and is pushed by the beat.
2. Every smoke control makes an obvious difference.
3. Ember stops looking the same from one setting to the next.
4. More colour schemes, with smoke that can contrast with the filaments.

## Non-goals

- Recreating any reference clip.
- Combining Ember with other effects, or adding a combined starter.
- Changing Classic Oscilloscope, its energy model, or the shared beam code.
- Filament geometry, sparks and the wider beat rework from the audit. These are separate work.
- A general flash limiter.

## Failure, even if it technically works

- Smoke that is still dim enough for its controls to go unnoticed.
- Smoke that hides the filaments or washes out the blacks.
- A visible jump at the loop point in an export.
- A look that passes by eye but breaks the flash screen.

## Approaches

| Approach | Trade-off | Decision |
|---|---|---|
| **Real fluid, reusing Live's solver** | Real motion and variety. Costs GPU time, and the smoke now has memory, so loops and exports need care | **Chosen by the owner** |
| Retune the current smoke | Quick and exactly loopable, but still the same five puffs | Rejected: stays samey |

## Design

### Simulation

- Reuse `Fluid` from `src/live/fluid.ts` through `Passes`, without changing how Live behaves. Start from Live's 256×144 grid, with dye at a resolution set by the performance gate.
- One simulation per visible Ember layer, created only when its smoke is above zero and released when it is not.
- Fixed 60 Hz simulation steps, so speed does not depend on the display's frame rate. Catch-up is capped so a stall cannot fling the smoke.
- Smoke is emitted from Ember's filament body, so it visibly comes from the form.
- Beats add a burst of force and dye. Bass adds body and highs add fine turbulence. With no sound, Ember's authored phrase drives the same bursts.

### Controls

Existing keys stay, so saved projects still load. Their ranges are remapped so each one is strong.

| Control | New meaning |
|---|---|
| Smoke | How much smoke is emitted |
| Smoke spread | How hard bursts push outward |
| Smoke curl | Swirl strength |
| Smoke lift | Rise or fall |
| Smoke persistence | How long smoke hangs |
| Smoke thickness | Density, and how much it hides the filaments |
| Smoke detail | Fine wisps against soft billows |
| Smoke lighting | How strongly the filaments light the smoke |
| Smoke audio response | How hard the music drives it |
| **Smoke style** (new) | Wisps, Rolling, Billow, Plume, Storm. Each is a distinct set of simulation behaviour |
| **Smoke source** (new) | Core, Ring, Filaments, Rising |

Spread, Curl, Lift, Persistence, Detail and Lighting move out of the hidden advanced section where needed, so the main smoke controls are visible.

### Colour schemes

Palette slot 6 already colours the smoke independently, so new schemes can contrast without a new colour system. Ten are added, for 15 in total:

| Scheme | Filaments | Smoke |
|---|---|---|
| Solar Flare | Gold | Rust |
| Toxic Violet | Acid green | Violet |
| Deep Sea | Cyan | Indigo |
| Neon Dusk | Hot pink | Teal |
| Blood Moon | Crimson | Ash grey |
| Arctic Fire | Ice white | Orange |
| Copper Patina | Copper | Verdigris |
| Ultraviolet | Violet | Magenta |
| Ink | White | Charcoal |
| Aurora | Green | Purple |

### Loops, seeking and export

- **Playing live:** the simulation simply runs. It does not need to repeat exactly.
- **Export:** deterministic. The simulation pre-rolls from a fixed seed, then the end of the loop crossfades into the state at its start, so the exported loop is seamless and two exports match.
- **Seeking while paused:** replay from saved checkpoints, following the pattern in `InkSimulation`, with a bounded cost.
- **GPU context loss:** the simulation is dropped and rebuilt through the existing recovery path.

### Saved projects

The owner rejected the old smoke, so **all Ember layers move to the new smoke, with no legacy mode**. Saved settings keep their values but will look different. This is the builder's proposal and the owner can overrule it.

## Done when

- Each smoke control, from minimum to maximum, visibly changes at least 10% of the picture at default settings (the current best is 3.7%).
- The five styles are clearly different on a contact sheet approved by the owner.
- Filaments remain readable, and at least half the pixels reach true black in trough frames at default.
- Exported loops show no visible jump, and two exports of one frame are identical.
- 4K p99 stays at or under 11.7 ms for one Ember layer on the M5 Pro. If it cannot, the simulation resolution drops before the look ships.
- All 15 schemes pass the flash screen at default at 200, 1,000 and 1,500 nits, on the 2 px grid. Acid Plume is already at 24.9%, so it may need retuning.
- Context recovery, unit tests and the interaction suite still pass.

## Left to the builder

Exact hex values, shader details, simulation constants, checkpoint spacing, and the crossfade length.

## Risks

- **Flash:** larger moving smoke raises the flashing area. The screen is a gate, not a report.
- **Map:** each Ember source adds a simulation. Multi-shape cost is measured, and a limit is added if needed.
- **Loop quality:** a crossfade between two smoke states can look ghostly. If it does, the fallback is a longer pre-roll with a shorter blend.
