/** Smoke: people are made of smoke. See docs/live-smoke-design-2026-11-16.md, including its change after the first try-out. */
import * as THREE from 'three';
import type { Pair, Passes } from './passes';
import type { Look, TrackingFeed } from './look';
import type { LiveSettings } from './settings';
import { Fluid } from './fluid';
import { setRamp } from './recolour';
import { CLEAR, compositeFragment, driftFragment, dyeFragment, fullnessFragment, holdFragment, velocityFragment } from './smoke-shaders';
import { PEOPLE_SIZE } from './People';

/** The simulation grid, 16:9. */
export const SMOKE_GRID: [number, number] = [256, 144];
/** Seconds after which 5% of the velocity is left. */
const VELOCITY_LIFE = 1.5;
/** Upward acceleration at Rise 1, in picture heights per second² per unit of smoke brightness. Strong enough that rising smoke clearly moves, so clear air does not mistake it for haze. */
const RISE = 2.4;
/** On Forever, smoke thinner than this fades at FOREVER_RATE per second. */
const FOREVER_THIN = .02, FOREVER_RATE = .3;

export class Smoke implements Look {
  /** For checks. Figures are part of the smoke, so both draw the same picture. */
  show: 'all' | 'smoke' = 'all';
  private readonly fluid: Fluid;
  private readonly velocity: THREE.ShaderMaterial;
  private readonly hold: THREE.ShaderMaterial;
  private readonly drift: Pair;
  private readonly fullness: THREE.WebGLRenderTarget;
  private readonly measureFull: THREE.ShaderMaterial;
  private readonly drifting: THREE.ShaderMaterial;
  private readonly dye: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly target: THREE.WebGLRenderTarget;

  constructor(private readonly passes: Passes, private width: number, private height: number) {
    this.fluid = new Fluid(passes, SMOKE_GRID, [width / 2, height / 2]);
    this.target = passes.target(width, height);
    const ramp = () => ({ uRamp: { value: null }, uRampShift: { value: 0 } });
    this.velocity = passes.material(velocityFragment, { uCurrent: { value: null }, uFlow: { value: null }, uPeople: { value: null }, uReady: { value: 0 },
      uResponse: { value: 1 }, uSmoulder: { value: .5 }, uSwirl: { value: .5 }, uRise: { value: 0 }, uDye: { value: null }, uStep: { value: 0 }, uTime: { value: 0 }, uGrid: { value: new THREE.Vector2(...SMOKE_GRID) } });
    this.hold = passes.material(holdFragment, { uCurrent: { value: null }, uFlow: { value: null }, uPeople: { value: null }, uDrift: { value: null }, uReady: { value: 0 },
      uSmoulder: { value: .5 }, uSwirl: { value: .5 }, uTime: { value: 0 }, uGrid: { value: new THREE.Vector2(...SMOKE_GRID) } });
    this.drift = passes.pair(1, 1, { float: true, nearest: true });
    this.fullness = passes.target(1, 1, { float: true, nearest: true });
    this.measureFull = passes.material(fullnessFragment, { uDye: { value: null } });
    this.drifting = passes.material(driftFragment, { uPrevious: { value: null }, uFlow: { value: null }, uPeople: { value: null }, uReady: { value: 0 }, uStep: { value: 0 } });
    this.dye = passes.material(dyeFragment, { uDrift: { value: null }, uVelocity: { value: null }, uFullness: { value: null }, uCapFull: { value: 0 }, uClear: { value: new THREE.Vector4() }, uCurrent: { value: null }, uFlow: { value: null }, uPeople: { value: null },
      uReady: { value: 0 }, uDensity: { value: .6 }, uEmit: { value: .6 }, uOpen: { value: 1 }, uSmoulder: { value: .5 }, uStep: { value: 0 }, uTime: { value: 0 },
      uPeopleTexel: { value: new THREE.Vector2(1 / PEOPLE_SIZE[0], 1 / PEOPLE_SIZE[1]) }, ...ramp() });
    this.composite = passes.material(compositeFragment, { uDye: { value: null } });
  }

  get output(): THREE.Texture { return this.target.texture; }

  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void {
    const s = settings.smoke, ready = feed.peopleReady ? 1 : 0;
    setRamp(this.dye.uniforms, s.palette, s.colourChange);
    if (seconds > 0) {
      const g = this.drifting.uniforms;
      g.uPrevious.value = this.drift.read.texture; g.uFlow.value = feed.flow; g.uPeople.value = feed.people; g.uReady.value = ready; g.uStep.value = seconds;
      this.passes.draw(this.drifting, this.drift.write); this.drift.swap();
      const v = this.velocity.uniforms;
      v.uFlow.value = feed.flow; v.uPeople.value = feed.people; v.uReady.value = ready; v.uResponse.value = s.response; v.uSmoulder.value = s.smoulder; v.uSwirl.value = s.swirl; v.uStep.value = seconds; v.uTime.value = time;
      v.uDye.value = this.fluid.dye; v.uRise.value = s.rise * RISE * SMOKE_GRID[1];
      this.fluid.inject('velocity', this.velocity);
      const d = this.dye.uniforms;
      this.measureFull.uniforms.uDye.value = this.fluid.dye; this.passes.draw(this.measureFull, this.fullness);
      d.uFullness.value = this.fullness.texture; d.uCapFull.value = s.forever ? 1 : 0;
      d.uFlow.value = feed.flow; d.uPeople.value = feed.people; d.uDrift.value = this.drift.read.texture; d.uVelocity.value = this.fluid.velocity;
      // Forever: nothing fades and nothing is cleared.
      // Forever: only the faintest smoke fades, slowly, so dense smoke stays but stirring cannot spread a haze over everything.
      (d.uClear.value as THREE.Vector4).set(CLEAR.slowFrom, CLEAR.slowTo, s.forever ? FOREVER_THIN : CLEAR.thin, s.forever ? FOREVER_RATE : CLEAR.rate);
      this.fluid.walls = s.forever;
      d.uReady.value = ready; d.uDensity.value = s.density; d.uEmit.value = s.emit; d.uOpen.value = s.forever ? 0 : 1; d.uSmoulder.value = s.smoulder; d.uStep.value = seconds; d.uTime.value = time;
      this.fluid.inject('dye', this.dye);
      // Rise is applied in the velocity pass above, where a held figure can switch it off.
      const h = this.hold.uniforms;
      h.uFlow.value = feed.flow; h.uPeople.value = feed.people; h.uDrift.value = this.drift.read.texture; h.uReady.value = ready; h.uSmoulder.value = s.smoulder; h.uSwirl.value = s.swirl; h.uTime.value = time;
      this.fluid.step(seconds, s.swirl * 60, VELOCITY_LIFE, s.forever ? Infinity : s.lifeSeconds, 0, () => this.fluid.inject('velocity', this.hold));
    }
    const c = this.composite.uniforms;
    c.uDye.value = this.fluid.dye;
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
    for (const item of [this.fluid, this.velocity, this.hold, this.drift, this.drifting, this.fullness, this.measureFull, this.dye, this.composite, this.target]) item.dispose();
  }
}
