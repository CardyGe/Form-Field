# Ember Fluid: build notes

25 November 2026 · branch `ember-fluid-smoke` · Spec: `specs/2026-11-22-ember-fluid-smoke-design.md` · Plan: `plans/2026-11-22-ember-fluid-smoke.md`

## What changed

- **Real fluid smoke.** Ember's five scripted puffs are replaced by Live's fluid solver, running at a fixed 60 steps a second, with one simulation per visible Ember layer. Bursts follow Ember's phrase, and the beat, bass and highs push it when sound is on.
- **Two new choices.** Smoke style (Wisps, Rolling, Billow, Plume, Storm) and Smoke source (Core, Ring, Filaments, Rising). Spread, Lift, Persistence, Detail and Lighting are no longer hidden in the advanced section.
- **Ten new colour schemes**, 15 in all: Solar Flare, Toxic Violet, Deep Sea, Neon Dusk, Blood Moon, Arctic Fire, Copper Patina, Ultraviolet, Ink and Aurora. The smoke colour can contrast with the filaments.
- **New burst filaments.** Ember draws a burst of fine threads, torn crowns, a thin ring, ragged outer bands and sparks (`scope-ember-burst.ts`). The spec had left filament changes for later; the owner chose to ship them with the smoke on 25 November.
- **Exports and scrubbing.** An export is repeatable: the same frame always gives the same picture, and the loop end blends into its start. Scrubbing while paused lands on the same smoke as an export of that frame, spread over a few frames so the app stays responsive.
- Saved projects load. Their smoke values are kept, but they now drive the fluid, so old Ember layers look different. An old layer saved with the old default Smoke of 0.04 will show very little smoke until it is raised.

## Results

| Gate (from the spec) | Result |
|---|---|
| Each smoke control, min to max, changes at least 10% of the picture | 10.1% to 16.3% (Thickness and Lighting only just clear it) |
| At least half the pixels true black in trough frames | 51.9% |
| Two exports of one frame identical; no jump at the loop | Identical. Loop seam 7.7, smaller than an ordinary frame step of 8.1 |
| Flash screen, all schemes, 200/1,000/1,500 nits, 2 px grid, at or under 25% | Worst 17.5% (Toxic Violet at 1,500 nits); red at most 12.0% |
| 4K p99 at or under 11.7 ms | **Not proven** (see Known limits) |
| Context recovery, unit tests, interaction suite, Map check | All pass (20/20 looks, 1,631 tests, interaction, 69/69 Map) |
| Styles clearly different on a contact sheet the owner approves | Sheets sent 25 November |

## Decisions made while building

Each with what it costs if it was the wrong call.

1. The smoke writes into Scope's existing target instead of returning a texture. Cost: low.
2. Simulation grid 192×108 (from 256×144), 6 pressure iterations, turbulence stirred every second step, dye at 528 px. All for speed at 4K. Cost: slightly coarser large swirls, and the smoke is a little less incompressible.
3. Acid Plume and Silver Ash dimmed 8%, and Arctic Fire 14%, keeping their hot highlights. They were over the flash limit at 1,500 nits. Cost: slightly less punch on those three.
4. Live catch-up is capped at 2 steps a frame, not the plan's 6, so a slow frame never buys more GPU work. Cost: under heavy stalls the smoke briefly slows.
5. **Default Smoke raised from 0.04 to 0.5.** At 0.04 the fluid barely showed, and no other smoke control could change the picture (they all measured 0%). Cost: heavier smoke by default, and old saved layers keep 0.04 and stay faint.
6. Ember's black floor raised from 0.0016 to 0.003. Even with the smoke off, only 46.9% of the darkest frame was true black because of faint glow tails. Cost: the very faintest outer glow is cut slightly harder.
7. Control ranges widened. Spread also keeps each push moving longer, Thickness and Lighting have wider curved ranges, and the faint smoke fill is halved. Needed for every control to clear 10%. Cost: Thickness and Lighting sit just above the line.
8. The builder's own haze check (not in the spec) reads 10.2% to 10.9% against its 10% line on the Ring, Filaments and Rising sources. The fluid is chaotic, and this reading swings by about 5 points with tiny changes. Cost: a little dim lit smoke may sit beside the form on those sources.

## Known limits

- **4K speed is unproven.** On a busy machine (another Electron app open, load 6.5), Ember with its smoke switched off already took 14.8 ms median and 17.2 ms p99. The smoke added 0.5 ms median and 1.3 ms p99. It needs a run on an idle machine: `node scripts/verify-ember-smoke.mjs --perf`.
- **Long loop exports start slowly.** The first export frame simulates the smoke up to that point: 0.5 s for a 10 s loop, 1.4 s for 60 s, and 12.4 s for the 600 s maximum. Later frames are quick.
- `writeEmberPoints` in `scope-ember.ts` is no longer used by Ember and can be removed.

## How to check it

```
node scripts/verify-ember-smoke.mjs            # range, black, haze, perf, export and contact sheets
node scripts/verify-ember-smoke.mjs --sheet    # just the contact sheets, in work/ember-smoke
```
