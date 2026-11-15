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

export interface TrackingFeed {
  /** The camera image after mirroring, up to 1280 × 720. Stored as it arrives (sRGB values). */
  readonly camera: THREE.Texture;
  /** 320 × 180. rg: movement in uv per camera frame. b: strength 0..1. The interaction box is already applied. */
  readonly flow: THREE.Texture;
  /** True on display frames where a new camera frame was analysed. */
  readonly fresh: boolean;
}

export interface Look {
  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void;
  /** Linear colour at artwork size. */
  readonly output: THREE.Texture;
  resize(width: number, height: number): void;
  clear(): void;
  dispose(): void;
}

/** Where frames come from. frameId rises with every new frame. */
export interface FrameSource {
  readonly element: HTMLVideoElement | HTMLCanvasElement | null;
  readonly frameId: number;
}
