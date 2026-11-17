import { applyEdit, type EditAction } from './editor';
import type { ShowDocument } from './show';

const LIMIT = 100;

/** The show, what undo can return to, what redo can return to, and why the last edit was refused. */
export interface MapState { show: ShowDocument; past: ShowDocument[]; future: ShowDocument[]; refusal: string | null }

export type MapAction =
  | { type: 'edit'; action: EditAction }
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
      return { show: result.show, past: [...state.past, state.show].slice(-LIMIT), future: [], refusal: null };
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
