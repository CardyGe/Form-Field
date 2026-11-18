/** Live in Map: when the projector shows Live, waits for it, or gives up and plays the shapes' own fill. */
import type { SourceState } from '../live/source';

export type LiveReadiness = 'wait' | 'play' | 'cannot';

/**
 * 'wait' while the camera starts, or before Live has drawn with the camera running, or while people-finding loads for a
 * look that needs people. 'cannot' when the camera is refused, missing, lost or failed, or a video file is chosen:
 * the shapes play their own fill and a fade into Live completes. Otherwise 'play'.
 */
export function liveReadiness(state: SourceState, at: { file: boolean; needsPeople: boolean; peopleLoading: boolean; drawnSinceRunning: number }): LiveReadiness {
  if (at.file) return 'cannot';
  if (state.status === 'idle' || state.status === 'starting') return 'wait';
  if (state.status !== 'running') return 'cannot';
  if (at.drawnSinceRunning < 1) return 'wait';
  if (at.needsPeople && at.peopleLoading) return 'wait';
  return 'play';
}
