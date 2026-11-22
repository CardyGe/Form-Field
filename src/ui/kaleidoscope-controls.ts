/** What the Studio calls each choice. Index equals the stored value. */
export const KALEIDOSCOPE_SOURCES = ['Motif', 'Image', 'Layer below', 'Feedback'];
export const KALEIDOSCOPE_SYMMETRIES = ['Rosette', 'Mirror', 'Triangle', 'Square', 'Hexagon'];
export const KALEIDOSCOPE_MOTIFS = ['Lines', 'Squares', 'Circles', 'Neon', 'Ribbons', 'Dots'];

/** Controls the panel draws itself, so the generic list leaves them out. */
export const KALEIDOSCOPE_OWN_KEYS = ['input', 'group', 'spiral', 'motif', 'morphTo'];
/** Index equals the stored value: 0 is off, then each motif. */
export const KALEIDOSCOPE_MORPHS = ['Off', ...KALEIDOSCOPE_MOTIFS];

export { kaleidoscopeDrawsMotif, kaleidoscopeHidden, kaleidoscopeRouteHidden } from '../core/project';
