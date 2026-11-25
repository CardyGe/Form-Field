export interface MeridianLook { id: string; name: string; description: string; palette: string[]; params: Record<string, number> }

const WHITE = (accent: string, second: string, ground = '#08070b'): string[] => ['#ffffff', accent, second, '#ffffff', '#ffffff', ground];

/**
 * The curated library. Evolve looks come first, each a different character of the same slow living structure.
 * A few Pulse and Dense looks stay available under clear names. Looks named Dense use the full phrase machine,
 * where a seed's remainder by 8 picks the form: 0 field, 1 bleed, 2 edge, 3 core, 4 twin, 5 spiral, 6 horizon, 7 cathedral.
 */
const EVOLVE = 2;
export const MERIDIAN_LOOKS: readonly MeridianLook[] = [
  { id: 'meridian-evolve-meridian', name: 'Meridian', description: 'The default. One calm white structure, always becoming its next form.', palette: WHITE('#8fd8ff', '#ffb26b'),
    params: { scoreStyle: EVOLVE, seed: 1729 } },
  { id: 'meridian-evolve-hairline', name: 'Hairline', description: 'The finest white lines and a great deal of black. Almost a drawing.', palette: WHITE('#dfe6f0', '#c8ccd4'),
    params: { scoreStyle: EVOLVE, seed: 2203, macroWeight: 0.24, macroDensity: 0.34, macroHeat: 0.1, macroTension: 0.36 } },
  { id: 'meridian-evolve-orrery', name: 'Orrery', description: 'Many fine rings and spokes turning against one another like a brass instrument.', palette: WHITE('#ffcf7a', '#ff8f4a'),
    params: { scoreStyle: EVOLVE, seed: 3187, macroDensity: 0.82, macroWeight: 0.36, macroSpeed: 0.62, macroHeat: 0.46, ringCounterRotation: 1 } },
  { id: 'meridian-evolve-breath', name: 'Long Breath', description: 'A heavy glowing hero swells and settles slowly inside very little else.', palette: WHITE('#ff9d7a', '#ffd9a0'),
    params: { scoreStyle: EVOLVE, seed: 4441, macroDensity: 0.26, macroTension: 0.86, macroWeight: 0.72, macroHeat: 0.62, macroSpeed: 0.36, heroGlow: 1.7 } },
  { id: 'meridian-evolve-seed-garden', name: 'Seed Garden', description: 'Lattices of points condense out of the rings and dissolve back in.', palette: WHITE('#7ff0c0', '#d8ff8a'),
    params: { scoreStyle: EVOLVE, seed: 5519, macroDensity: 0.68, nodeDensity: 1, nodeSize: 1.5, nodeGlow: 1, macroHeat: 0.56, macroOrder: 0.34 } },
  { id: 'meridian-evolve-tide', name: 'Tide', description: 'Scaled past the frame, so huge arcs cross an empty screen like a horizon.', palette: WHITE('#6fb7ff', '#9f8cff'),
    params: { scoreStyle: EVOLVE, seed: 7211, macroScale: 0.9, macroDensity: 0.4, macroSpeed: 0.34, macroHeat: 0.44, macroTension: 0.42 } },
  { id: 'meridian-evolve-jewel', name: 'Jewel', description: 'A tiny bright mechanism alone in the middle of a black frame.', palette: WHITE('#ffd23f', '#ff5fa2'),
    params: { scoreStyle: EVOLVE, seed: 8363, macroScale: 0.1, macroDensity: 0.62, macroWeight: 0.42, macroTension: 0.62, macroHeat: 0.6 } },
  { id: 'meridian-evolve-drift', name: 'Drift', description: 'Symmetry loosens into something organic, like rings on moving water.', palette: WHITE('#9fe8ff', '#b4a7ff'),
    params: { scoreStyle: EVOLVE, seed: 9127, macroOrder: 0.92, macroDensity: 0.56, macroSpeed: 0.42, macroHeat: 0.5, scoreEvolution: 0.62 } },
  { id: 'meridian-evolve-ember', name: 'Ember', description: 'Rich slow colour moves through the lines and the hero burns low and warm.', palette: WHITE('#ff5a2a', '#ffb000'),
    params: { scoreStyle: EVOLVE, seed: 10601, macroHeat: 0.94, macroTension: 0.62, macroDensity: 0.46, macroWeight: 0.56 } },
  { id: 'meridian-evolve-restless', name: 'Restless', description: 'Changes form as fast as it can without hurrying, with a rare local glitch.', palette: WHITE('#2fd4ff', '#ff4fc0'),
    params: { scoreStyle: EVOLVE, seed: 6073, scoreEvolution: 0.92, macroSpeed: 0.68, macroDensity: 0.62, macroGlitch: 0.66, macroHeat: 0.58 } },
  { id: 'meridian-pulse-first-light', name: 'Pulse First Light', description: 'Rings and long spokes on a steady grid, with a rare flash of colour.', palette: WHITE('#ff3fd0', '#35d0ff'),
    params: { scoreStyle: 0, seed: 1729 } },
  { id: 'meridian-pulse-slow-orbit', name: 'Pulse Slow Orbit', description: 'Long eight-bar phrases at a walking pace. Each hit has room to ring.', palette: WHITE('#6fe3ff', '#5b6cff'),
    params: { scoreStyle: 0, seed: 3187, scoreBpm: 84, scorePulseBars: 8, macroSpeed: 0.38, macroDensity: 0.42, macroTension: 0.3, macroHeat: 0.3, macroGlitch: 0.12 } },
  { id: 'meridian-pulse-night-lattice', name: 'Pulse Night Lattice', description: 'A full build with a green field of nodes glowing behind the lines.', palette: WHITE('#19e68c', '#f2ff49'),
    params: { scoreStyle: 0, seed: 5519, macroDensity: 0.8, macroHeat: 0.62, macroOrder: 0.3, macroGlitch: 0.25 } },
  { id: 'meridian-solar-gate', name: 'Dense Solar Gate', description: 'Hot. A vast sun of amber bands rises off the bottom of the frame.', palette: ['#fff0d6', '#ff8a00', '#ff2a00', '#fffbe8', '#ff6a10', '#070201'],
    params: { scoreStyle: 1, seed: 966, lightBloomAmount: 0.95, lightExposure: 1.2, heroGlow: 1.6, glitchAmount: 0.8 } },
  { id: 'meridian-radiolaria', name: 'Dense Radiolaria', description: 'Dense. A tight living core throws hundreds of rays past the frame.', palette: ['#e9fff8', '#00ffd0', '#ff3fa4', '#ffffff', '#1fe8c4', '#010807'],
    params: { scoreStyle: 1, seed: 1283, symmetry: 12, ringCount: 16, spokeCount: 60, nodeDensity: 1, ringTicks: 0.85, structureNegativeSpace: 0.15, nodeChaseSpeed: 2 } },
  { id: 'meridian-event-horizon', name: 'Dense Event Horizon', description: 'Giant violet arcs sweep in from beyond the edge of the frame.', palette: ['#f0e8ff', '#a13bff', '#ff2fc0', '#ffffff', '#8c3dff', '#04010a'],
    params: { scoreStyle: 1, seed: 1626, ringCount: 12, lightBloomAmount: 0.85, lightBloomSize: 0.7, glitchRadialTear: 0.5, heroWeight: 1.4 } },
];
