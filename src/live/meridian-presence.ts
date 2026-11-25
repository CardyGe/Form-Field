/**
 * Meridian Live's presence grid: 64 x 36 cells, each saying how much of a person is there and how much it moves. It is drawn
 * from the people, movement and stillness textures only, never from the camera picture, and read back without waiting, one
 * read at a time, so drawing never stalls on it. The grid is a handful of numbers per cell, kept in memory and nowhere else.
 */
import * as THREE from 'three';
import type { Passes } from './passes';
import type { TrackingFeed } from './look';
import { GRID_HEIGHT, GRID_WIDTH } from '../meridian/bodies';
import type { PresenceMode } from '../meridian/live-core';

/** R: presence (the people model, or without it recent deliberate movement). G: movement. Nine taps per cell. */
const presenceFragment = /* glsl */`
uniform sampler2D uPeople, uFlow, uStill;
uniform float uPeopleMode;
uniform vec2 uCell;
void main() {
  float person = 0., move = 0., recent = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 p = clamp(vUv + vec2(float(x), float(y)) * uCell / 3., 0., 1.);
    person += texture2D(uPeople, p).r;
    move += texture2D(uFlow, p).b;
    // Seconds since deliberate movement here: someone moved within the last second or so.
    recent += 1. - smoothstep(.4, 1.5, texture2D(uStill, p).g);
  }
  float presence = uPeopleMode > .5 ? person / 9. : recent / 9.;
  gl_FragColor = vec4(clamp(presence, 0., 1.), clamp(move / 9. * 1.5, 0., 1.), 0., 1.);
}`;

export class PresenceGrid {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly buffer = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4);
  private pending = false;
  private arrived = false;
  private startedAt = 0;
  private lastArrived = 0;
  private disposed = false;
  /** How long the last read took, and the time between the last two grids, in ms. */
  readbackMs = 0;
  intervalMs = 0;
  failures = 0;

  constructor(private readonly passes: Passes) {
    this.target = new THREE.WebGLRenderTarget(GRID_WIDTH, GRID_HEIGHT, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    this.material = passes.material(presenceFragment, { uPeople: { value: null }, uFlow: { value: null }, uStill: { value: null }, uPeopleMode: { value: 0 }, uCell: { value: new THREE.Vector2(1 / GRID_WIDTH, 1 / GRID_HEIGHT) } });
  }

  /**
   * Once per display frame. Returns the grid on the frame it arrives (RGBA bytes, row 0 at the bottom), otherwise null. A new
   * read starts only on a frame with a fresh camera frame and only once the last has arrived and been used.
   */
  update(feed: TrackingFeed, mode: PresenceMode): Uint8Array | null {
    if (this.arrived) { this.arrived = false; return this.buffer; }
    if (this.pending || !feed.fresh || this.disposed) return null;
    const u = this.material.uniforms;
    u.uPeople.value = feed.people; u.uFlow.value = feed.flow; u.uStill.value = feed.still; u.uPeopleMode.value = mode === 'people' ? 1 : 0;
    this.passes.draw(this.material, this.target);
    this.pending = true; this.startedAt = performance.now();
    this.passes.renderer.readRenderTargetPixelsAsync(this.target, 0, 0, GRID_WIDTH, GRID_HEIGHT, this.buffer).then(() => {
      if (this.disposed) return;
      const now = performance.now();
      this.readbackMs = now - this.startedAt; this.intervalMs = this.lastArrived ? now - this.lastArrived : 0; this.lastArrived = now;
      this.pending = false; this.arrived = true;
    }, () => { this.pending = false; this.failures++; });
    return null;
  }

  dispose(): void { this.disposed = true; this.target.dispose(); this.material.dispose(); }
}
