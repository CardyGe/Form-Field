/** Perform follow rules: a scene can move on by itself after a set number of bars. */
import type { LauncherState } from './launcher';
import { BEATS_PER_BAR, type PerformanceSet, type Scene } from './types';

/** The beat a scene that landed on landedBeat moves on, or null if it has no rule. */
export function followBeat(scene: Scene, landedBeat: number): number | null {
  return scene.follow ? landedBeat + scene.follow.afterBars * BEATS_PER_BAR : null;
}

/** The rows a scene's rule can go to. Keywords are read first, so a scene that happens to be called "next" cannot hijack one. Random never includes the current row. */
export function followChoices(scene: Scene, current: number, scenes: readonly Scene[]): number[] {
  if (!scene.follow) return [];
  const { to } = scene.follow;
  if (to === 'next') return current + 1 < scenes.length ? [current + 1] : [];
  if (to === 'previous') return current > 0 ? [current - 1] : [];
  if (to === 'first') return [0];
  if (to === 'random') return scenes.map((_, i) => i).filter(i => i !== current);
  const row = scenes.findIndex(x => x.id === to);
  return row < 0 ? [] : [row];
}

export function pickFollow(choices: readonly number[], random: () => number): number | null {
  if (choices.length === 0) return null;
  if (choices.length === 1) return choices[0];
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

/** The row the current scene will follow to, known ahead so it can be armed. A random choice made on landing is used while it is still a valid row. */
export function plannedFollow(s: LauncherState, set: PerformanceSet): number | null {
  const scene = set.scenes[s.sceneIndex];
  if (!scene?.follow) return null;
  const choices = followChoices(scene, s.sceneIndex, set.scenes);
  if (scene.follow.to !== 'random') return choices[0] ?? null;
  return s.followTarget !== null && choices.includes(s.followTarget) ? s.followTarget : null;
}

/** The scene row to queue because a follow rule is due at this beat, or null. A scene already queued by hand takes priority. */
export function dueFollow(s: LauncherState, set: PerformanceSet, beat: number, random: () => number): number | null {
  if (s.followAtBeat === null || beat < s.followAtBeat) return null;
  if (s.queue.some(l => l.sceneIndex !== null)) return null;
  const scene = set.scenes[s.sceneIndex];
  if (!scene?.follow) return null;
  return plannedFollow(s, set) ?? pickFollow(followChoices(scene, s.sceneIndex, set.scenes), random);
}
