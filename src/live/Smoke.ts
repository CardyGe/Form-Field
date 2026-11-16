/** Smoke: people become smoke. See docs/live-smoke-design-2026-11-16.md. */
import * as THREE from 'three';
import type { Passes } from './passes';
import type { Look, TrackingFeed } from './look';
import type { LiveSettings } from './settings';
import { Fluid } from './fluid';
import { setRamp } from './recolour';
import { compositeFragment, dyeFragment, velocityFragment } from './smoke-shaders';
import { PEOPLE_SIZE } from './People';

/** The simulation grid, 16:9. */
export const SMOKE_GRID: [number, number] = [256, 144];
/** Seconds after which 5% of the velocity is left. */
const VELOCITY_LIFE = 1.5;

export class Smoke implements Look {
  /** For checks: draw only the smoke, only the person, or both. */
  show: 'all' | 'smoke' | 'person' = 'all';
  private readonly fluid: Fluid;
  private readonly velocity: THREE.ShaderMaterial;
  private readonly dye: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly target: THREE.WebGLRenderTarget;

  constructor(private readonly passes: Passes, private width: number, private height: number) {
    this.fluid = new Fluid(passes, SMOKE_GRID, [width / 2, height / 2]);
    this.target = passes.target(width, height);
    const ramp = () => ({ uRamp: { value: null }, uRampShift: { value: 0 } });
    this.velocity = passes.material(velocityFragment, { uCurrent: { value: null }, uFlow: { value: null }, uPeople: { value: null }, uReady: { value: 0 },
      uResponse: { value: 1 }, uSmoulder: { value: .5 }, uStep: { value: 0 }, uGrid: { value: new THREE.Vector2(...SMOKE_GRID) } });
    this.dye = passes.material(dyeFragment, { uCurrent: { value: null }, uCamera: { value: null }, uFlow: { value: null }, uPeople: { value: null }, uStill: { value: null },
      uReady: { value: 0 }, uResponse: { value: 1 }, uSmoulder: { value: .5 }, uBurn: { value: 0 }, uStep: { value: 0 }, uTime: { value: 0 },
      uPeopleTexel: { value: new THREE.Vector2(1 / PEOPLE_SIZE[0], 1 / PEOPLE_SIZE[1]) }, ...ramp() });
    this.composite = passes.material(compositeFragment, { uDye: { value: null }, uCamera: { value: null }, uPeople: { value: null }, uStill: { value: null },
      uBurn: { value: 0 }, uTime: { value: 0 }, uShow: { value: 0 }, ...ramp() });
  }

  get output(): THREE.Texture { return this.target.texture; }

  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void {
    const s = settings.smoke, ready = feed.peopleReady ? 1 : 0;
    setRamp(this.dye.uniforms, s.palette, s.colourChange);
    setRamp(this.composite.uniforms, s.palette, s.colourChange);
    if (seconds > 0) {
      const v = this.velocity.uniforms;
      v.uFlow.value = feed.flow; v.uPeople.value = feed.people; v.uReady.value = ready; v.uResponse.value = s.response; v.uSmoulder.value = s.smoulder; v.uStep.value = seconds;
      this.fluid.inject('velocity', this.velocity);
      const d = this.dye.uniforms;
      d.uCamera.value = feed.camera; d.uFlow.value = feed.flow; d.uPeople.value = feed.people; d.uStill.value = feed.still;
      d.uReady.value = ready; d.uResponse.value = s.response; d.uSmoulder.value = s.smoulder; d.uBurn.value = s.burnAway; d.uStep.value = seconds; d.uTime.value = time;
      this.fluid.inject('dye', this.dye);
      this.fluid.step(seconds, s.swirl * 60, VELOCITY_LIFE, s.lifeSeconds, s.rise * .8 * SMOKE_GRID[1]);
    }
    const c = this.composite.uniforms;
    c.uDye.value = this.fluid.dye; c.uCamera.value = feed.camera; c.uPeople.value = feed.people; c.uStill.value = feed.still;
    c.uBurn.value = s.burnAway; c.uTime.value = time; c.uShow.value = this.show === 'person' ? 2 : this.show === 'smoke' ? 1 : 0;
    this.passes.draw(this.composite, this.target);
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.target.setSize(width, height);
    this.fluid.resizeDye(width / 2, height / 2);
  }

  clear(): void { this.fluid.clear(); }

  dispose(): void {
    for (const item of [this.fluid, this.velocity, this.dye, this.composite, this.target]) item.dispose();
  }
}
