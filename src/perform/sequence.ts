/** Perform follow rules: a scene can move on by itself after a set number of bars. */
import type { LauncherState } from './launcher';
import { BEATS_PER_BAR, type PerformanceSet, type Scene } from './types';

/** The beat a scene that landed on landedBeat moves on, or null if it has no rule. */
export function followBeat(scene: Scene, landedBeat: number): number | null {
  return scene.follow ? landedBeat + scene.follow.afterBars * BEATS_PER_BAR : null;
}

/** The row a follow rule targets. Keywords are read first, so a scene that happens to be called "next" cannot hijack one. */
function followTarget(to: string, current: number, scenes: readonly Scene[], random: () => number): number | null {
  const count = scenes.length;
  if (to === 'next') return current + 1 < count ? current + 1 : null;
  if (to === 'previous') return current > 0 ? current - 1 : null;
  if (to === 'first') return 0;
  if (to === 'random') {
    if (count < 2) return null;
    const pick = Math.min(count - 2, Math.floor(random() * (count - 1)));
    return pick >= current ? pick + 1 : pick;
  }
  const row = scenes.findIndex(x => x.id === to);
  return row < 0 ? null : row;
}

/** The scene row to queue because a follow rule is due at this beat, or null. A scene already queued by hand takes priority. */
export function dueFollow(s: LauncherState, set: PerformanceSet, beat: number, random: () => number): number | null {
  if (s.followAtBeat === null || beat < s.followAtBeat) return null;
  if (s.queue.some(l => l.sceneIndex !== null)) return null;
  const scene = set.scenes[s.sceneIndex];
  return scene?.follow ? followTarget(scene.follow.to, s.sceneIndex, set.scenes, random) : null;
}
