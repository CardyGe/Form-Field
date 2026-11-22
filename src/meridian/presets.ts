export interface MeridianLook { id: string; name: string; description: string; palette: string[]; params: Record<string, number> }

const WHITE = (accent: string, second: string, ground = '#08070b'): string[] => ['#ffffff', accent, second, '#ffffff', '#ffffff', ground];

/**
 * The curated library. Pulse looks come first: mostly white line on near-black, each with its own character.
 * Looks named Dense use the full phrase machine, where a seed's remainder by 8 picks the form:
 * 0 field, 1 bleed, 2 edge, 3 core, 4 twin, 5 spiral, 6 horizon, 7 cathedral.
 */
export const MERIDIAN_LOOKS: readonly MeridianLook[] = [
  { id: 'meridian-pulse-first-light', name: 'First Light', description: 'The default Pulse. Rings and long spokes on a steady grid, with a rare flash of colour.', palette: WHITE('#ff3fd0', '#35d0ff'),
    params: { seed: 1729 } },
  { id: 'meridian-pulse-bare-wire', name: 'Bare Wire', description: 'Almost nothing. Hairlines in pure white and a great deal of black.', palette: WHITE('#ffffff', '#c8ccd4'),
    params: { seed: 2203, macroDensity: 0.24, macroWeight: 0.32, macroHeat: 0, macroGlitch: 0, macroTension: 0.3 } },
  { id: 'meridian-pulse-slow-orbit', name: 'Slow Orbit', description: 'Long eight-bar phrases at a walking pace. Each hit has room to ring.', palette: WHITE('#6fe3ff', '#5b6cff'),
    params: { seed: 3187, scoreBpm: 84, scorePulseBars: 8, macroSpeed: 0.38, macroDensity: 0.42, macroTension: 0.3, macroHeat: 0.3, macroGlitch: 0.12 } },
  { id: 'meridian-pulse-iron-ring', name: 'Iron Ring', description: 'Few elements, heavy lines. The hero lands hard and often.', palette: WHITE('#ffb000', '#ff4a00'),
    params: { seed: 4441, macroWeight: 0.84, macroDensity: 0.3, macroTension: 0.82, macroHeat: 0.3, macroGlitch: 0.2 } },
  { id: 'meridian-pulse-night-lattice', name: 'Night Lattice', description: 'A full build with a green field of nodes glowing behind the lines.', palette: WHITE('#19e68c', '#f2ff49'),
    params: { seed: 5519, macroDensity: 0.8, macroHeat: 0.62, macroOrder: 0.3, macroGlitch: 0.25 } },
  { id: 'meridian-pulse-flurry', name: 'Flurry', description: 'Two-bar phrases at double time. It builds, rattles and collapses again.', palette: WHITE('#2fb4ff', '#ff3fd0'),
    params: { seed: 6073, scorePulseBars: 2, macroSpeed: 0.7, macroTension: 0.7, macroGlitch: 0.58, macroDensity: 0.6 } },
  { id: 'meridian-pulse-wide-field', name: 'Wide Field', description: 'Zoomed in past the frame, so great arcs and spokes cross an empty screen.', palette: WHITE('#b45cff', '#35d0ff'),
    params: { seed: 7211, macroScale: 0.84, macroDensity: 0.44, macroHeat: 0.38, macroTension: 0.42 } },
  { id: 'meridian-pulse-small-hours', name: 'Small Hours', description: 'A tiny, quiet mechanism in the middle of a black frame.', palette: WHITE('#ffd23f', '#ff5fa2'),
    params: { seed: 8363, macroScale: 0.08, macroDensity: 0.36, macroWeight: 0.4, macroTension: 0.25, macroHeat: 0.22, macroGlitch: 0.1 } },
  { id: 'meridian-pulse-loose-wire', name: 'Loose Wire', description: 'The grid comes apart: off-beat hits, wandering radii, spokes at odd angles.', palette: WHITE('#00ffc2', '#ff2d55'),
    params: { seed: 9127, macroOrder: 0.94, macroDensity: 0.56, macroGlitch: 0.46, macroTension: 0.55 } },
  { id: 'meridian-pulse-signal-red', name: 'Signal Red', description: 'White structure with a hero that burns red and tears on the accents.', palette: WHITE('#ff1f1f', '#ff7a00'),
    params: { seed: 10601, macroHeat: 0.74, macroGlitch: 0.72, macroTension: 0.66, macroDensity: 0.46 } },
  { id: 'meridian-solar-gate', name: 'Dense Solar Gate', description: 'Hot. A vast sun of amber bands rises off the bottom of the frame.', palette: ['#fff0d6', '#ff8a00', '#ff2a00', '#fffbe8', '#ff6a10', '#070201'],
    params: { scoreStyle: 1, seed: 966, lightBloomAmount: 0.95, lightExposure: 1.2, heroGlow: 1.6, glitchAmount: 0.8 } },
  { id: 'meridian-radiolaria', name: 'Dense Radiolaria', description: 'Dense. A tight living core throws hundreds of rays past the frame.', palette: ['#e9fff8', '#00ffd0', '#ff3fa4', '#ffffff', '#1fe8c4', '#010807'],
    params: { scoreStyle: 1, seed: 1283, symmetry: 12, ringCount: 16, spokeCount: 60, nodeDensity: 1, ringTicks: 0.85, structureNegativeSpace: 0.15, nodeChaseSpeed: 2 } },
  { id: 'meridian-acid-grid', name: 'Dense Acid Grid', description: 'Dense. A wide lattice floods the frame while a ring system burns through it.', palette: ['#f6ffdc', '#b4ff00', '#ff00b4', '#ffffff', '#8dff20', '#030500'],
    params: { scoreStyle: 1, seed: 2048, nodeDensity: 0.95, nodeChaseSpeed: 2.6, nodeChasePattern: 1, nodeSize: 1.4, glitchAmount: 1.3, glitchColourShred: 0.5 } },
  { id: 'meridian-twin-engines', name: 'Dense Twin Engines', description: 'Two interlocked machines turning against each other.', palette: ['#eaf4ff', '#2f9bff', '#ff4d2e', '#ffffff', '#3ea8ff', '#01040b'],
    params: { scoreStyle: 1, seed: 1204, symmetry: 8, ringRotationSpeed: 1.8, ringCounterRotation: 1, spokeCount: 24, heroPulse: 0.8 } },
  { id: 'meridian-event-horizon', name: 'Dense Event Horizon', description: 'Giant violet arcs sweep in from beyond the edge of the frame.', palette: ['#f0e8ff', '#a13bff', '#ff2fc0', '#ffffff', '#8c3dff', '#04010a'],
    params: { scoreStyle: 1, seed: 1626, ringCount: 12, lightBloomAmount: 0.85, lightBloomSize: 0.7, glitchRadialTear: 0.5, heroWeight: 1.4 } },
  { id: 'meridian-overdrive', name: 'Dense Overdrive', description: 'Fast. Two-bar phrases that hit, tear and vanish.', palette: ['#fff2ee', '#ff1f3d', '#19e3ff', '#ffffff', '#ff2c4d', '#060103'],
    params: { scoreStyle: 1, seed: 1377, scoreBars: 2, ringDrawOnStyle: 3, ringRotationSpeed: 3, nodeChaseSpeed: 3.4, glitchAmount: 1.6, glitchSlipH: 0.55, glitchColourShred: 0.45 } },
];
