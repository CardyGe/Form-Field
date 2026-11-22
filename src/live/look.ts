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

export interface TrackingFeed {
  /** The camera image after mirroring, up to 1280 × 720. Stored as it arrives (sRGB values). */
  readonly camera: THREE.Texture;
  /** 320 × 180. rg: movement in uv per camera frame. b: strength 0..1. The interaction box is already applied. */
  readonly flow: THREE.Texture;
  /** True on display frames where a new camera frame was analysed. */
  readonly fresh: boolean;
  /** True on display frames where `camera` received a new image, including ones too far apart to compare for movement. */
  readonly newImage: boolean;
  /** True while `camera` holds a real picture from the current source, even if that source has stopped sending. */
  readonly hasImage: boolean;
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
  resize(width: number, height: number): void;
  clear(): void;
  dispose(): void;
}

/** Where frames come from. frameId rises with every new frame. */
export interface FrameSource {
  readonly element: HTMLVideoElement | HTMLCanvasElement | null;
  readonly frameId: number;
}
