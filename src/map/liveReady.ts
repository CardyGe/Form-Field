/** Live in Map: when the projector shows Live, waits for it, or gives up and plays the shapes' own fill. */
import type { SourceState } from '../live/source';

/** 'hold': keep showing the last picture without taking new ones (a new look's people-finding is loading). */
export type LiveReadiness = 'wait' | 'play' | 'hold' | 'cannot';

/**
 * 'wait' while the camera starts, or before Live has drawn with the camera running, or while people-finding loads for a
 * look that needs people. 'cannot' when the camera is refused, missing, lost or failed, or a video file is chosen:
 * the shapes play their own fill and a fade into Live completes. Otherwise 'play'.
 */
export function liveReadiness(state: SourceState, at: { file: boolean; needsCamera?: boolean; warming?: boolean; needsPeople: boolean; peopleLoading: boolean; drawnSinceRunning: number; hasPicture: boolean }): LiveReadiness {
  // A look that makes its own picture plays whatever the camera is doing.
  if (at.needsCamera === false) return at.warming ? (at.hasPicture ? 'hold' : 'wait') : 'play';
  if (at.file) return 'cannot';
  if (state.status === 'idle' || state.status === 'starting') return 'wait';
  if (state.status !== 'running') return 'cannot';
  if (at.drawnSinceRunning < 1) return 'wait';
  // Switching to a look that finds people mid-show: the shapes keep the last picture until it is ready, never their fill.
  if (at.needsPeople && at.peopleLoading) return at.hasPicture ? 'hold' : 'wait';
  return 'play';
}
