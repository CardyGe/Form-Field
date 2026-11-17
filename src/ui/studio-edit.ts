import type { Project } from '../shared/types';

/** Studio's own state, set aside while a Map shape's composition is edited in Studio, and put back afterwards. */
export interface StudioStash { project: Project; history: Project[]; future: Project[]; filePath: string; selectedId: string; phase: number }
/** A Map shape being edited in Studio: which source, for the bar's wording, and Studio's own state. */
export interface ShapeEdit { sourceId: string; shapeName: string; stash: StudioStash }

/** Copies the history lists, so later edits in Studio cannot change what is put back. */
export function stashStudio(state: StudioStash): StudioStash {
  return { ...state, history: [...state.history], future: [...state.future] };
}

/** The project Studio's autosave and close-save must write: its own, set aside, while a shape is being edited. */
export function projectForStudioSave(current: Project, edit: ShapeEdit | null): Project {
  return edit ? edit.stash.project : current;
}
