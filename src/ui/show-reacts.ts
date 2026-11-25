import type { ShowDocument } from '../map/show';
import { usesEmberSmokeAudio } from '../react/ember-smoke';

/** Whether a show uses sound, the beat, tempo or MIDI at all: only then does the engine listen. Meridian always listens. */
export const showReacts = (show: ShowDocument) => show.links.length > 0 || show.triggers.length > 0 || show.sources.some(s => s.tempoSync !== null || s.project.layers.some(l => usesEmberSmokeAudio(l) || (l.visible && l.kind === 'meridian')))
  // Stage 7: a border run with the tempo, or auto-advance by bars, follows the beat.
  || show.shapes.some(s => !!s.border.run?.beats) || show.autoAdvance?.unit === 'bars';
