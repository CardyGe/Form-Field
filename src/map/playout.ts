/**
 * The pure rules of playing instruments on the wall: how big each source is drawn, how its clock moves,
 * when the frame-rate governor steps, and how a change fades. The compositor (compositor.ts) applies them.
 */
import { playbackPhase } from '../core/playback';
import { frameCount } from '../core/timeline';
import type { Project } from '../shared/types';
import { readParameterDefinitions, visibleParameterDefinitions } from '../core/project';
import { reactable } from './targets';
import { STAGE_SIZE, type Point } from './show';

const TAU = Math.PI * 2;
/** Smallest side a source is drawn at, so a thin shape still gets a picture. */
const MIN_SOURCE_SIDE = 64;
/** A frame that took longer than this (a hidden window, a stall) moves the clock only this far. */
const MAX_STEP_SECONDS = 0.1;

/** Sizes go up in steps, so a shape being dragged does not resize its instrument (and reset its history) on every move. */
const SIZE_STEP = 16;

/** The pixel size to draw a source at for one shape: its bounding box on the stage, times the governor's scale. */
export function sourceSize(points: Point[], scale: number): { width: number; height: number } {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const side = (span: number, stage: number) => Math.min(stage, Math.max(MIN_SOURCE_SIDE, Math.ceil(span * stage * scale / SIZE_STEP) * SIZE_STEP));
  return { width: side(Math.max(...xs) - Math.min(...xs), STAGE_SIZE.width), height: side(Math.max(...ys) - Math.min(...ys), STAGE_SIZE.height) };
}

/** How long one loop of a composition lasts, in seconds, as Studio plays it. */
const loopSeconds = (project: Project) => frameCount(project) * project.fps.den / project.fps.num;

/** The composition's phase after `seconds` at `speed`. Uses Studio's own rule, so evolving compositions stop at their end. */
export function advancePhase(phase: number, seconds: number, project: Project, speed: number): number {
  const step = Math.min(Math.max(seconds, 0), MAX_STEP_SECONDS);
  if (step === 0) return phase;
  return playbackPhase(phase, step / loopSeconds(project) * TAU * speed, project);
}

/**
 * The frame-rate governor. level 0 draws instruments at full size; each step lowers their drawing size
 * (GOVERNOR_SCALES), and the last also draws them every other frame. slow and fast count consecutive frames.
 */
export interface Governor { level: 0 | 1 | 2 | 3; slow: number; fast: number }
export const GOVERNOR_SCALES = [1, 0.75, 0.5, 0.5] as const;
/** A frame slower than this is late (the 16.7 ms budget at 60 fps, less a margin). */
const LATE_MS = 15;
/** A frame faster than this leaves room to draw more. */
const EASY_MS = 10;
const STEP_DOWN_AFTER = 30;
const STEP_UP_AFTER = 120;

export const initialGovernor = (): Governor => ({ level: 0, slow: 0, fast: 0 });

/** A frame interval this long means the screen missed a refresh (two at 120 Hz, one and a half at 60 Hz). */
const MISSED_REFRESH_MS = 24;
/** Longer than this is a stall (a hidden window, a dialog), not a slow frame. */
const STALL_MS = 250;
/**
 * What a frame cost, for the governor. Usually the work the compositor did; but when the GPU is the bottleneck the
 * CPU work looks small while frames arrive late, so a missed refresh counts as its full interval.
 */
export function frameCost(workMs: number, intervalMs: number): number {
  return intervalMs > MISSED_REFRESH_MS && intervalMs < STALL_MS ? Math.max(workMs, intervalMs) : workMs;
}

export function governorStep(g: Governor, frameMs: number): Governor {
  if (frameMs > LATE_MS) {
    const slow = g.slow + 1;
    if (slow >= STEP_DOWN_AFTER && g.level < 3) return { level: (g.level + 1) as Governor['level'], slow: 0, fast: 0 };
    return { level: g.level, slow, fast: 0 };
  }
  if (frameMs < EASY_MS) {
    const fast = g.fast + 1;
    if (fast >= STEP_UP_AFTER && g.level > 0) return { level: (g.level - 1) as Governor['level'], slow: 0, fast: 0 };
    return { level: g.level, slow: 0, fast };
  }
  // Inside budget but without room to spare: hold, and start counting again.
  return { level: g.level, slow: 0, fast: 0 };
}

/** At the last level instruments are drawn every other frame; the shapes keep their last picture in between. */
export const drawsThisFrame = (level: Governor['level'], frameIndex: number) => level < 3 || frameIndex % 2 === 0;

/** How far a crossfade has gone, 0 to 1. */
export function fadeAlpha(startedMs: number, nowMs: number, durationMs = 400): number {
  // A fade of no time is a cut: done at once (never 0 / 0).
  if (!(durationMs > 0)) return 1;
  return Math.min(1, Math.max(0, (nowMs - startedMs) / durationMs));
}

/** What a shape plays, as far as fading is concerned: which source, and which instruments it is made of. */
export interface Playing { sourceId: string | null; kinds: string }

/** A change of source, or of instruments within the source, crossfades; Vary, palette and speed changes do not. */
export function shouldFade(before: Playing | undefined, after: Playing): boolean {
  if (!before) return false;
  return before.sourceId !== after.sourceId || before.kinds !== after.kinds;
}

/**
 * Whether a changed composition must be prepared again before it plays. Not when only settings that can follow sound
 * changed (the same as links change them for drawing): the effect is adjusted in place, never restarted.
 */
export function needsPrepare(before: Project, after: Project): boolean {
  if (before === after) return false;
  const { layers: a, ...restA } = before, { layers: b, ...restB } = after;
  if (JSON.stringify(restA) !== JSON.stringify(restB) || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const { params: pa, ...la } = a[i], { params: pb, ...lb } = b[i];
    if (JSON.stringify(la) !== JSON.stringify(lb)) return true;
    const visible = visibleParameterDefinitions(b[i]);
    for (const key of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
      if (pa[key] === pb[key]) continue;
      const d = readParameterDefinitions(b[i].kind).find(x => x.key === key);
      if (!d || typeof pb[key] !== 'number' || !reactable(d).ok || !visible.some(x => x.key === key)) return true;
    }
  }
  return false;
}
