import type { Project } from '../shared/types';
import { validateProject } from '../core/project';
import { acceptMapMessage, type MapMessage } from './messages';
import { MAX_SOURCE_LAYERS, validateWireShow, type WireShow } from './show';
import type { DrawOptions } from './draw';

/** What the wall shows: the show, the compositions it has been sent (by revision), and the overlays. */
export interface WallState {
  show: WireShow;
  projects: Map<string, { revision: number; project: Project }>;
  options: DrawOptions;
  freeze: boolean;
}

export function initialWall(): WallState {
  return {
    show: validateWireShow({ format: 'formshow', version: 4, shapes: [], sources: [], groups: [], stageCorners: null }),
    projects: new Map(),
    options: { blackout: false, testGrid: false, identifyId: null, crosshair: null, selectedId: null, selectedIndex: null, outlinesOnly: false, invalidIds: [] },
    freeze: false,
  };
}

/** The next wall state for a message. A refused message changes nothing, so the last good picture stays up. */
export function applyMapMessage(state: WallState, value: unknown): WallState {
  if (!acceptMapMessage(value)) return state;
  const message: MapMessage = value;
  switch (message.type) {
    case 'show': {
      const show = validateWireShow(message.show);
      // Compositions for sources that left the show are let go.
      const keep = new Set(show.sources.map(s => s.id));
      const projects = new Map([...state.projects].filter(([id]) => keep.has(id)));
      return { ...state, show, projects };
    }
    case 'source': {
      // Any revision other than the one held replaces it: undo brings back an older one, and the studio's record of
      // what it sent decides what the wall should have (messages arrive in order).
      const held = state.projects.get(message.id);
      if (held && held.revision === message.revision) return state;
      let project: Project;
      try { project = validateProject(message.project); } catch { return state; }
      if (project.layers.length > MAX_SOURCE_LAYERS) return state;
      const projects = new Map(state.projects);
      projects.set(message.id, { revision: message.revision, project });
      return { ...state, projects };
    }
    case 'freeze': return { ...state, freeze: message.on };
    case 'blackout': return { ...state, options: { ...state.options, blackout: message.on } };
    case 'testGrid': return { ...state, options: { ...state.options, testGrid: message.on } };
    case 'identify': return { ...state, options: { ...state.options, identifyId: message.shapeId } };
    case 'crosshair': return { ...state, options: { ...state.options, crosshair: message.point, selectedId: message.shapeId } };
    case 'solo': return { ...state, options: { ...state.options, solo: message.ids } };
  }
}
