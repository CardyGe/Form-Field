import { applyEdit, type EditAction } from './editor';
import type { ShowDocument } from './show';
import type { Project } from '../shared/types';

const LIMIT = 100;

/** The show, what undo can return to, what redo can return to, and why the last edit was refused. */
/** merge: the last edit, when the next one of the same kind should join its undo step (nudging one stage corner). */
export interface MapState { show: ShowDocument; past: ShowDocument[]; future: ShowDocument[]; refusal: string | null; merge?: string | null }

export type MapAction =
  /** merge: consecutive edits with the same key are one undo step (triggers firing on the beat). */
  | { type: 'edit'; action: EditAction; merge?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; show: ShowDocument };

export const initialMapState = (show: ShowDocument): MapState => ({ show, past: [], future: [], refusal: null });

/** Pure: never changes its input. */
export function mapReducer(state: MapState, action: MapAction): MapState {
  switch (action.type) {
    case 'load': return initialMapState(action.show);
    case 'edit': {
      const result = applyEdit(state.show, action.action);
      if (!result.ok) return { ...state, refusal: result.reason };
      // An edit that changes nothing is not an undo step.
      if (result.show === state.show) return { ...state, refusal: null };
      // Moving one stage corner again and again (arrow nudges) is one undo step, so it cannot push older edits out.
      const merge = action.merge ?? (action.action.type === 'moveStageCorner' ? `corner-${action.action.index}` : null);
      if (merge && state.merge === merge && state.past.length) return { ...state, show: result.show, future: [], refusal: null, merge };
      return { show: result.show, past: [...state.past, state.show].slice(-LIMIT), future: [], refusal: null, merge };
    }
    case 'undo': {
      if (!state.past.length) return state;
      return { show: state.past[state.past.length - 1], past: state.past.slice(0, -1), future: [state.show, ...state.future], refusal: null };
    }
    case 'redo': {
      if (!state.future.length) return state;
      return { show: state.future[0], past: [...state.past, state.show], future: state.future.slice(1), refusal: null };
    }
  }
}

/**
 * A change made to a source in Studio. The first change of an editing session is an undo step like any edit;
 * the rest replace it, so the whole session in Studio undoes as one step in Map.
 */
export function applyStudioEdit(state: MapState, sourceId: string, project: Project, first: boolean): MapState {
  const result = applyEdit(state.show, { type: 'setSourceProject', sourceId, project });
  if (!result.ok) return { ...state, refusal: result.reason };
  if (first) return { show: result.show, past: [...state.past, state.show].slice(-LIMIT), future: [], refusal: null };
  return { ...state, show: result.show, future: [], refusal: null };
}
