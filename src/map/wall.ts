import type { Project } from '../shared/types';
import { validateProject } from '../core/project';
import { acceptMapMessage, type MapMessage } from './messages';
import type { Signals } from '../react/signals';
import { MAX_SOURCE_LAYERS, validateWireShow, type WireShow } from './show';
import type { DrawOptions } from './draw';
import { validateLiveSettings, type LiveSettings } from '../live/settings';
import { applyPerformMessage, initialWallPerform, type WallPerform } from '../perform/wall-perform';

/** What the wall shows: the show, the compositions it has been sent (by revision), and the overlays. */
export interface WallState {
  show: WireShow;
  projects: Map<string, { revision: number; project: Project }>;
  options: DrawOptions;
  freeze: boolean;
  /** The latest signals, and the fade time the next show change should use (a scene switch), if any. */
  signals: Signals;
  fadeMs: number | null;
  /** Live in Map: the Live screen's settings while the show plays Live, else null. */
  live: LiveSettings | null;
  /** Perform's overlay over the show, while a show runs. */
  perform: WallPerform;
}

export function initialWall(): WallState {
  return {
    show: validateWireShow({ format: 'formshow', version: 4, shapes: [], sources: [], groups: [], stageCorners: null }),
    projects: new Map(),
    options: { blackout: false, testGrid: false, identifyId: null, crosshair: null, selectedId: null, selectedIndex: null, outlinesOnly: false, invalidIds: [] },
    freeze: false,
    signals: {},
    fadeMs: null,
    live: null,
    perform: initialWallPerform(),
  };
}

/**
 * What the wall owes the studio for a draft applied to it, so an Apply is always answered. `swap`: it is on its way and
 * the compositor will answer. `started`: the wall already holds it. `failed`: the wall refused it. Null: not an Apply.
 */
export function swapOutcome(before: WallState, after: WallState, message: unknown): 'swap' | 'started' | 'failed' | null {
  const m = message as { type?: unknown; id?: unknown; revision?: unknown; crossfade?: unknown } | null;
  if (m?.type !== 'source' || m.crossfade !== true || typeof m.id !== 'string') return null;
  if (after.projects.get(m.id)?.revision !== m.revision) return 'failed';
  return after.projects !== before.projects ? 'swap' : 'started';
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
    case 'flashGuard': return { ...state, options: { ...state.options, flashGuard: message.on } };
    case 'testGrid': return { ...state, options: { ...state.options, testGrid: message.on } };
    case 'identify': return { ...state, options: { ...state.options, identifyId: message.shapeId } };
    case 'crosshair': return { ...state, options: { ...state.options, crosshair: message.point, selectedId: message.shapeId } };
    case 'solo': return { ...state, options: { ...state.options, solo: message.ids } };
    case 'signals': return { ...state, signals: message.signals };
    case 'fade': return { ...state, fadeMs: message.ms };
    case 'liveSettings': return { ...state, live: message.settings === null ? null : validateLiveSettings(message.settings) };
    case 'liveClear': case 'liveCaptureRoom': case 'liveRetry': case 'videoRetry': case 'performanceReset': case 'installation': return state;
    case 'performStart': case 'performEnd': case 'performArm': case 'performLaunch': case 'performCancel': case 'performValues': {
      const perform = applyPerformMessage(state.perform, message);
      return perform === state.perform ? state : { ...state, perform };
    }
  }
}

/** The main process refuses a wall report of 16 KB or more (acceptState in electron/map.cjs). */
export const WALL_REPORT_LIMIT = 16 * 1024;
/** Report fields only the scripted checks read (from the wall's own page): the first to go when a report would be too big. */
const CHECK_ONLY_REPORT_FIELDS = ['meridian', 'linked', 'meridianRecords'] as const;

/**
 * The report as sent to the studio. A busy wall (many Meridian sources during a Perform show, with landings and failures)
 * could pass the main process's size limit, and a refused report would lose Perform's landings: the fields only the scripted
 * checks read are left out first. A report that fits is sent exactly as it is.
 */
export function fitWallReport<T extends object>(report: T, limit = WALL_REPORT_LIMIT): T {
  if (JSON.stringify(report).length < limit) return report;
  const trimmed = { ...report } as Record<string, unknown>;
  for (const key of CHECK_ONLY_REPORT_FIELDS) delete trimmed[key];
  return trimmed as T;
}
