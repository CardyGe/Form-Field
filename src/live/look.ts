/**
 * The seam between tracking and looks.
 *
 * Tracking publishes plain textures through TrackingFeed. A look reads only
 * from the feed, never from Tracking itself, so new inputs (a person mask) and
 * new readers (other looks, later the studio's own effects) can be added
 * without touching either side.
 */
import type * as THREE from 'three';
import type { LiveSettings } from './settings';
import type { PeopleStatus } from './MaskProvider';
import type { MorphogenPlay } from '../morphogen/play';

export interface TrackingFeed {
  /** The camera image after mirroring, up to 1280 × 720. Stored as it arrives (sRGB values). */
  readonly camera: THREE.Texture;
  /** 320 × 180. rg: movement in uv per camera frame. b: strength 0..1. The interaction box is already applied. */
  readonly flow: THREE.Texture;
  /** True on display frames where a new camera frame was analysed. */
  readonly fresh: boolean;
  /** People, lined up with `camera`: likelihood 0..1 with the filters applied. Zero while not ready or not wanted. */
  readonly people: THREE.Texture;
  /** Two timers per point in seconds. r: since any movement nearby (sway counts). g: since deliberate movement. */
  readonly still: THREE.Texture;
  /** A mask arrived for this source within the last two seconds. */
  readonly peopleReady: boolean;
  readonly peopleStatus: PeopleStatus;
}

export interface Look {
  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void;
  /** Linear colour at artwork size. */
  readonly output: THREE.Texture;
  /** False while a look is still forming its first picture. Looks without this are ready at once. */
  readonly ready?: boolean;
  /** This frame's sound, tempo and MIDI, for a look that is played directly. */
  setSignals?(signals: Record<string, number>, operator: LiveSettings): void;
  /** Hands the look the performance that should survive it being rebuilt. */
  adoptPlay?(play: MorphogenPlay): void;
  /** What the operator should see about how the look is being played. */
  readonly midimix?: { active: boolean; look: number | null; queued: number | null };
  resize(width: number, height: number): void;
  clear(): void;
  dispose(): void;
}

/** Where frames come from. frameId rises with every new frame. */
export interface FrameSource {
  readonly element: HTMLVideoElement | HTMLCanvasElement | null;
  readonly frameId: number;
}
