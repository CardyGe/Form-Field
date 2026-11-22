import { KALEIDOSCOPE_INPUT } from '../core/project';
import { kaleidoscopeInput } from '../rendering/feedback';

/** What the Studio calls each choice. Index equals the stored value. */
export const KALEIDOSCOPE_SOURCES = ['Motif', 'Image', 'Layer below', 'Feedback'];
export const KALEIDOSCOPE_SYMMETRIES = ['Rosette', 'Mirror', 'Triangle', 'Square', 'Hexagon'];
export const KALEIDOSCOPE_MOTIFS = ['Lines', 'Squares', 'Circles'];

/** Controls the panel draws itself, so the generic list leaves them out. */
export const KALEIDOSCOPE_OWN_KEYS = ['input', 'group', 'spiral', 'motif'];

/** Whether the source draws a motif of its own: the motif itself, or feedback before any echo. */
export const kaleidoscopeDrawsMotif = (params: Record<string, number>) => {
  const input = kaleidoscopeInput(params);
  return input === KALEIDOSCOPE_INPUT.motif || input === KALEIDOSCOPE_INPUT.feedback;
};

/** The generic controls that do nothing for these settings, so the panel does not show them. */
export function kaleidoscopeHidden(params: Record<string, number>): Set<string> {
  const spiral = Math.round(params.spiral ?? 0) === 1, group = Math.round(params.group ?? 0);
  const hidden = new Set<string>();
  if (spiral) { hidden.add('sectors'); hidden.add('cell'); } else {
    hidden.add('spiralA'); hidden.add('spiralB'); hidden.add('spiralScale'); hidden.add('zoomCycles');
    hidden.add(group === 0 ? 'cell' : 'sectors');
  }
  if (!kaleidoscopeDrawsMotif(params)) { hidden.add('motifScale'); hidden.add('lineWidth'); }
  return hidden;
}
