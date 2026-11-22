export interface MeridianLook { id: string; name: string; description: string; palette: string[]; params: Record<string, number> }

/**
 * The curated library. A seed's remainder by 8 picks its form:
 * 0 field, 1 bleed, 2 edge, 3 core, 4 twin, 5 spiral, 6 horizon, 7 cathedral.
 * Each look draws from its own swatches, so the layer palette stays editable.
 */
export const MERIDIAN_LOOKS: readonly MeridianLook[] = [
  { id: 'meridian-solar-gate', name: 'Solar Gate', description: 'Hot. A vast sun of amber bands rises off the bottom of the frame.', palette: ['#fff0d6', '#ff8a00', '#ff2a00', '#fffbe8', '#ff6a10', '#070201'],
    params: { seed: 966, lightBloomAmount: 0.95, lightExposure: 1.2, heroGlow: 1.6, glitchAmount: 0.8 } },
  { id: 'meridian-black-signal', name: 'Black Signal', description: 'Mono and sparse. A few exact white lines in a great deal of black.', palette: ['#ffffff', '#f2f4f8', '#8c94a6', '#ffffff', '#d5dcec', '#000000'],
    params: { seed: 1737, outputMono: 1, ringCount: 4, spokeCount: 6, nodeDensity: 0.1, structureNegativeSpace: 0.86, lightBloomAmount: 0.35, glitchAmount: 0.45, colourFringe: 0 } },
  { id: 'meridian-radiolaria', name: 'Radiolaria', description: 'Dense. A tight living core throws hundreds of rays past the frame.', palette: ['#e9fff8', '#00ffd0', '#ff3fa4', '#ffffff', '#1fe8c4', '#010807'],
    params: { seed: 1283, symmetry: 12, ringCount: 16, spokeCount: 60, nodeDensity: 1, ringTicks: 0.85, structureNegativeSpace: 0.15, nodeChaseSpeed: 2 } },
  { id: 'meridian-acid-grid', name: 'Acid Grid', description: 'Dense. A wide lattice floods the frame while a ring system burns through it.', palette: ['#f6ffdc', '#b4ff00', '#ff00b4', '#ffffff', '#8dff20', '#030500'],
    params: { seed: 2048, nodeDensity: 0.95, nodeChaseSpeed: 2.6, nodeChasePattern: 1, nodeSize: 1.4, glitchAmount: 1.3, glitchColourShred: 0.5 } },
  { id: 'meridian-twin-engines', name: 'Twin Engines', description: 'Two interlocked machines turning against each other.', palette: ['#eaf4ff', '#2f9bff', '#ff4d2e', '#ffffff', '#3ea8ff', '#01040b'],
    params: { seed: 1204, symmetry: 8, ringRotationSpeed: 1.8, ringCounterRotation: 1, spokeCount: 24, heroPulse: 0.8 } },
  { id: 'meridian-event-horizon', name: 'Event Horizon', description: 'Giant violet arcs sweep in from beyond the edge of the frame.', palette: ['#f0e8ff', '#a13bff', '#ff2fc0', '#ffffff', '#8c3dff', '#04010a'],
    params: { seed: 1626, ringCount: 12, lightBloomAmount: 0.85, lightBloomSize: 0.7, glitchRadialTear: 0.5, heroWeight: 1.4 } },
  { id: 'meridian-slow-vortex', name: 'Slow Vortex', description: 'Slow. A spiral opens over thirty-two bars and never hurries.', palette: ['#e4f7ff', '#39c6ff', '#6a5bff', '#ffffff', '#35b4ff', '#01050c'],
    params: { seed: 1325, scoreBars: 32, ringRotationSpeed: 0.5, glitchAmount: 0.25, lightAfterglow: 0.6, lightTrailLength: 0.7, nodeChaseSpeed: 0.4 } },
  { id: 'meridian-ceiling-rose', name: 'Ceiling Rose', description: 'Ceiling-friendly. Centred, four-square and readable from any side of the room.', palette: ['#fff0f4', '#ff4f87', '#ffd24a', '#ffffff', '#ff5d92', '#070205'],
    params: { seed: 1999, symmetry: 8, structureCentreX: 0, structureCentreY: 0, glitchSlipH: 0.12, glitchSlipV: 0.12, glitchAmount: 0.4, ringCount: 10 } },
  { id: 'meridian-overdrive', name: 'Overdrive', description: 'Fast. Two-bar phrases that hit, tear and vanish.', palette: ['#fff2ee', '#ff1f3d', '#19e3ff', '#ffffff', '#ff2c4d', '#060103'],
    params: { seed: 1377, scoreBars: 2, ringDrawOnStyle: 3, ringRotationSpeed: 3, nodeChaseSpeed: 3.4, glitchAmount: 1.6, glitchSlipH: 0.55, glitchColourShred: 0.45 } },
  { id: 'meridian-long-tide', name: 'Long Tide', description: 'Slow and wide. Deep green rings breathe across the whole frame.', palette: ['#e8fff1', '#14e58a', '#d7ff3e', '#ffffff', '#16c97c', '#010704'],
    params: { seed: 1409, scoreBars: 24, ringRotationSpeed: 0.4, ringCount: 11, glitchAmount: 0.2, heroContraction: 0.9, lightAfterglow: 0.5 } },
  { id: 'meridian-red-line', name: 'Red Line', description: 'Sparse and severe. One red ring holds a nearly empty frame.', palette: ['#ffe9e4', '#ff1414', '#ff7a00', '#fff2ea', '#ff2410', '#050000'],
    params: { seed: 1411, ringCount: 3, spokeCount: 4, nodeDensity: 0.05, structureNegativeSpace: 0.92, heroWeight: 1.8, heroGlow: 2, glitchAmount: 0.5, ringTicks: 0.2 } },
  { id: 'meridian-glass-dial', name: 'Glass Dial', description: 'A cold precision instrument, all hairlines and scales.', palette: ['#f2fbff', '#8fe6ff', '#7f8cff', '#ffffff', '#6fd4ff', '#01040a'],
    params: { seed: 1443, symmetry: 6, ringTicks: 1, ringTickLength: 0.8, ringCount: 18, lightBloomAmount: 0.4, glitchAmount: 0.3, colourFringe: 0.35 } },
  { id: 'meridian-magma-cross', name: 'Magma Cross', description: 'Hot and square. Burning frames nest towards a white centre.', palette: ['#fff0dc', '#ff5a00', '#ffc800', '#fffdf0', '#ff4400', '#080200'],
    params: { seed: 1503, symmetry: 4, ringCount: 12, heroGlow: 2.2, lightBloomAmount: 0.9, glitchAmount: 0.55, glitchRadialTear: 0.1, glitchBlockAspect: 2.4 } },
  { id: 'meridian-ultra-pulse', name: 'Ultra Pulse', description: 'Fast twin discs in ultraviolet, kicking on every beat.', palette: ['#f4ecff', '#7a2bff', '#2bffd5', '#ffffff', '#8a44ff', '#030109'],
    params: { seed: 1572, scoreBars: 4, heroPulse: 1, heroOvershoot: 0.9, ringRotationSpeed: 2.4, spokeSweepSpeed: 3, glitchAmount: 1.1 } },
];
