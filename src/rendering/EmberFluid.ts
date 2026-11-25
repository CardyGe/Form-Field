import * as THREE from 'three';
import { Fluid, type FluidState } from '../live/fluid';
import { Passes } from '../live/passes';
import type { SmokeAudioFrame } from '../react/ember-smoke';
import { emberBursts, emberFluidSettings, emberFluidSteps, emberLoopBlend, type EmberFluidSettings } from './ember-fluid-model';

const STEP = 1 / 60, PRE_ROLL_SECONDS = 4, MAX_CHECKPOINTS = 12, SEEK_STEPS_PER_FRAME = 24;

const noise = /* glsl */`
float hash(vec2 p){vec3 s=fract(vec3(p.xyx)*.1031);s+=dot(s,s.yzx+33.33);return fract((s.x+s.y)*s.z);}
float value(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){const mat2 turn=mat2(.8,.6,-.6,.8);float sum=0.,gain=.5;for(int i=0;i<3;i++){sum+=gain*value(p);p=turn*p*2.03+7.1;gain*=.5;}return sum;}
`;

const emitFragment = /* glsl */`
uniform sampler2D uCurrent; uniform float uAspect,uRadius,uOrigin,uEmit,uSeed,uTime; uniform vec4 uBurst;
${noise}
float source(vec2 p,float n){
  float r=length(p);
  if(uOrigin<.5)return exp(-r*r/.09);
  if(uOrigin<1.5)return exp(-pow((r-.85)/.11,2.))*smoothstep(.34,.62,n);
  if(uOrigin<2.5){float ridge=1.-abs(2.*fbm(p*3.4+uSeed+vec2(uTime*.05))-1.);return pow(ridge,7.)*(1.-smoothstep(.75,1.25,r));}
  return exp(-pow((p.y+1.3)/.12,2.))*smoothstep(.3,.6,n)*(1.-smoothstep(1.3,1.9,abs(p.x)));
}
void main(){
  vec2 p=(vUv-.5)*vec2(uAspect,1.)/uRadius;
  float n=fbm(p*7.5+vec2(uSeed)+uTime*.31);
  vec2 d=p-uBurst.xy;
  float add=source(p,n)*uEmit+uBurst.z*exp(-dot(d,d)/max(uBurst.w*uBurst.w,1e-5));
  vec3 dye=texture2D(uCurrent,vUv).rgb;
  dye.rg=min(dye.rg+add*vec2(.65+.7*n,.35+.9*(1.-n)),vec2(4.));
  gl_FragColor=vec4(dye,1.);
}`;

const forceFragment = /* glsl */`
uniform sampler2D uCurrent; uniform float uAspect,uRadius,uTurbulence,uSeed,uTime; uniform vec4 uBurst; uniform vec2 uDirection;
${noise}
void main(){
  vec2 p=(vUv-.5)*vec2(uAspect,1.)/uRadius, v=texture2D(uCurrent,vUv).xy, q=p*2.2+vec2(uSeed,-uSeed)+uTime*.22;
  const float e=.09;
  v+=vec2(fbm(q+vec2(0.,e))-fbm(q-vec2(0.,e)),fbm(q-vec2(e,0.))-fbm(q+vec2(e,0.)))/(2.*e)*uTurbulence*9.;
  vec2 d=p-uBurst.xy;
  float f=exp(-dot(d,d)/max(uBurst.w*uBurst.w,1e-5));
  v+=uDirection*uBurst.z*f+vec2(-d.y,d.x)*uBurst.z*f*sin(uTime*3.1+uSeed)*1.4;
  gl_FragColor=vec4(v,0.,1.);
}`;

const outputFragment = /* glsl */`
uniform sampler2D uDye,uTail; uniform mat3 uView; uniform float uMix,uDensity,uDetail; uniform vec2 uTexel;
vec2 at(vec2 uv){return mix(texture2D(uTail,uv).rg,texture2D(uDye,uv).rg,uMix);}
void main(){
  vec2 uv=(uView*vec3(vUv,1.)).xy;
  if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}
  vec2 d=at(uv);
  float dx=at(uv+vec2(uTexel.x,0.)).r-at(uv-vec2(uTexel.x,0.)).r, dy=at(uv+vec2(0.,uTexel.y)).r-at(uv-vec2(0.,uTexel.y)).r;
  // A small floor keeps thin residue from lifting the blacks.
  // The two dye channels were released in different proportions, so their ratio is a texture the flow carries along.
  float wisp=smoothstep(.42,1.32,d.g/max(d.r,.001));
  vec2 body=max(d-.025,0.)*uDensity*mix(1.,.08+1.5*wisp,clamp(uDetail*.62,0.,1.));
  gl_FragColor=vec4(body,min(length(vec2(dx,dy))*uDetail*5.,2.)*step(.025,d.r),1.);
}`;

export interface EmberFluidInput {
  params: Record<string, number>;
  seconds: number;
  loopSeconds: number;
  /** Export: the same seconds always gives the same picture, and the loop closes. */
  exact: boolean;
  playing: boolean;
  audio?: SmokeAudioFrame;
  view: THREE.Matrix3;
  radius: number;
  aspect: number;
}

export class EmberFluid {
  private readonly passes: Passes;
  private readonly fluid: Fluid;
  private readonly emit: THREE.ShaderMaterial;
  private readonly force: THREE.ShaderMaterial;
  private readonly output: THREE.ShaderMaterial;
  private readonly checkpoints = new Map<number, FluidState>();
  private tail: EmberFluid | null = null;
  private key = '';
  private tick = 0;
  private onTimeline = false;
  private clock = 0;
  private lastSeconds = -1;
  private remainder = 0;
  private lastBeat = -1;
  /** A paused seek is spread over frames; the last picture holds until it arrives. */
  pending = false;

  constructor(private readonly renderer: THREE.WebGLRenderer, readonly aspect: number) {
    this.passes = new Passes(renderer);
    const rows = 108, columns = Math.max(48, Math.min(384, Math.round(rows * aspect)));
    const dyeScale = 528 / Math.max(columns, rows);
    this.fluid = new Fluid(this.passes, [columns, rows], [Math.round(columns * dyeScale), Math.round(rows * dyeScale)], 6);
    const shared = () => ({ uCurrent: { value: null }, uAspect: { value: aspect }, uRadius: { value: .43 }, uSeed: { value: 0 }, uTime: { value: 0 }, uBurst: { value: new THREE.Vector4() } });
    this.emit = this.passes.material(emitFragment, { ...shared(), uOrigin: { value: 0 }, uEmit: { value: 0 } });
    this.force = this.passes.material(forceFragment, { ...shared(), uTurbulence: { value: 0 }, uDirection: { value: new THREE.Vector2() } });
    this.output = this.passes.material(outputFragment, { uDye: { value: null }, uTail: { value: null }, uView: { value: new THREE.Matrix3() }, uMix: { value: 1 }, uDensity: { value: 1 }, uDetail: { value: 1 }, uTexel: { value: new THREE.Vector2(1 / (columns * dyeScale), 1 / (rows * dyeScale)) } });
  }

  private burst(angle: number, strength: number, settings: EmberFluidSettings, origin: number, seconds: number, input: EmberFluidInput): void {
    const rising = origin === 3, reach = [.25, .85, .55][origin] ?? .25;
    const x = rising ? 1.4 * Math.sin(angle * 3) : Math.cos(angle) * reach, y = rising ? -1.25 : Math.sin(angle) * reach;
    const dx = rising ? .25 * Math.cos(angle) : Math.cos(angle), dy = rising ? 1 : Math.sin(angle), size = settings.radius * 3.2;
    const f = this.force.uniforms, e = this.emit.uniforms;
    (f.uBurst.value as THREE.Vector4).set(x, y, settings.force * strength, size);
    // Lift also steers each burst, so it visibly carries smoke up or down through the lit area.
    (f.uDirection.value as THREE.Vector2).set(dx, dy + 1.1 * (input.params.emberSmokeLift ?? 0));
    f.uTurbulence.value = 0; f.uRadius.value = input.radius; f.uTime.value = seconds;
    this.fluid.inject('velocity', this.force);
    (e.uBurst.value as THREE.Vector4).set(x, y, settings.emit * strength * .8, size);
    e.uEmit.value = 0; e.uRadius.value = input.radius; e.uTime.value = seconds;
    this.fluid.inject('dye', this.emit);
  }

  private stepOnce(seconds: number, settings: EmberFluidSettings, input: EmberFluidInput, extra: readonly { angle: number; strength: number }[] = []): void {
    const p = input.params, origin = Math.round(p.emberSmokeOrigin ?? 0), seed = (p.seed ?? 1729) >>> 0, seedOffset = (seed % 881) * .073;
    const e = this.emit.uniforms, f = this.force.uniforms;
    e.uSeed.value = f.uSeed.value = seedOffset; e.uOrigin.value = origin;
    for (const b of emberBursts(seconds, seconds + STEP, input.loopSeconds, p.emberPhrases ?? 5, seed)) this.burst(b.angle, b.strength, settings, origin, seconds, input);
    for (const b of extra) this.burst(b.angle, b.strength, settings, origin, seconds, input);
    (e.uBurst.value as THREE.Vector4).set(0, 0, 0, 1); e.uEmit.value = settings.emit * STEP * 1.8; e.uRadius.value = input.radius; e.uTime.value = seconds;
    this.fluid.inject('dye', this.emit);
    // Turbulence changes slowly, so it is stirred in every other step at twice the strength.
    if (Math.round(seconds * 60) % 2 === 0) {
      (f.uBurst.value as THREE.Vector4).set(0, 0, 0, 1); f.uTurbulence.value = settings.turbulence * 2; f.uRadius.value = input.radius; f.uTime.value = seconds;
      this.fluid.inject('velocity', this.force);
    }
    this.fluid.step(STEP, settings.curl, settings.velocityLife, settings.dyeLife, settings.buoyancy);
  }

  private clearCheckpoints(): void { for (const c of this.checkpoints.values()) c.dispose(); this.checkpoints.clear(); }

  /** Walks the repeatable timeline to `tick`. Returns false if the step budget ran out first. */
  private advanceExact(target: number, settings: EmberFluidSettings, input: EmberFluidInput, budget = Infinity): boolean {
    const start = -Math.round(Math.min(PRE_ROLL_SECONDS, input.loopSeconds) * 60);
    if (!this.onTimeline || target < this.tick) {
      let best: number | undefined;
      for (const tick of this.checkpoints.keys()) if (tick <= target && (best === undefined || tick > best)) best = tick;
      if (best !== undefined) { this.fluid.restoreState(this.checkpoints.get(best)!); this.tick = best; }
      else { this.fluid.clear(); this.tick = start; }
      this.onTimeline = true;
    }
    const spacing = Math.max(60, Math.ceil(input.loopSeconds * 2 * 60 / MAX_CHECKPOINTS));
    for (let used = 0; this.tick < target; used++) {
      if (used >= budget) return false;
      this.stepOnce(this.tick / 60, settings, input);
      this.tick++;
      if (this.tick > 0 && this.tick % spacing === 0 && !this.checkpoints.has(this.tick) && this.checkpoints.size < MAX_CHECKPOINTS) this.checkpoints.set(this.tick, this.fluid.saveState());
    }
    return true;
  }

  private advanceLive(settings: EmberFluidSettings, input: EmberFluidInput): void {
    if (this.lastSeconds < 0) { this.clock = input.seconds; this.lastSeconds = input.seconds; }
    let elapsed = input.seconds - this.lastSeconds;
    if (elapsed < -input.loopSeconds / 2) elapsed += input.loopSeconds;
    this.lastSeconds = input.seconds;
    if (elapsed <= 0) return;
    const fresh = (input.audio?.beats ?? []).filter(b => b.id > this.lastBeat);
    for (const b of fresh) this.lastBeat = Math.max(this.lastBeat, b.id);
    const hits = fresh.map(b => ({ angle: b.id * 2.39996, strength: b.strength * (input.params.emberSmokeResponse ?? 0) * 1.5 }));
    const owed = elapsed + this.remainder, steps = Math.max(emberFluidSteps(owed), hits.length ? 1 : 0);
    this.remainder = Math.min(STEP, Math.max(0, owed - steps * STEP));
    for (let i = 0; i < steps; i++) { this.stepOnce(this.clock, settings, input, i === 0 ? hits : []); this.clock += STEP; }
    if (steps) this.onTimeline = false;
  }

  /** Advances the smoke and writes front density, rear density and fine edges into `target`. */
  sample(input: EmberFluidInput, target: THREE.WebGLRenderTarget): void {
    // Every pass fills its whole target, so Studio's clear and shadow work would only add cost.
    const { autoClear } = this.renderer, shadows = this.renderer.shadowMap.autoUpdate;
    this.renderer.autoClear = false; this.renderer.shadowMap.autoUpdate = false;
    try { this.run(input, target); }
    finally { this.renderer.autoClear = autoClear; this.renderer.shadowMap.autoUpdate = shadows; }
  }

  private run(input: EmberFluidInput, target: THREE.WebGLRenderTarget): void {
    const settings = emberFluidSettings(input.params, input.exact ? undefined : input.audio);
    const stable = emberFluidSettings(input.params), p = input.params;
    const key = JSON.stringify([stable, p.seed, p.emberPhrases, p.emberSmokeOrigin, input.loopSeconds, input.radius]);
    if (key !== this.key) { this.key = key; this.clearCheckpoints(); this.onTimeline = false; this.tail?.dispose(); this.tail = null; }
    const u = this.output.uniforms;
    u.uMix.value = 1; u.uTail.value = this.fluid.dye;
    const tick = Math.round(input.seconds * 60);
    this.pending = false;
    if (input.exact) {
      this.advanceExact(tick, stable, input);
      this.lastSeconds = input.seconds;
      const blend = emberLoopBlend(input.seconds, input.loopSeconds);
      if (blend.weight < 1) {
        this.tail ??= new EmberFluid(this.renderer, this.aspect);
        this.tail.key = key;
        this.tail.advanceExact(tick + Math.round(input.loopSeconds * 60), stable, input);
        u.uTail.value = this.tail.fluid.dye; u.uMix.value = blend.weight;
      }
    } else if (input.playing || input.seconds === this.lastSeconds) {
      this.advanceLive(settings, input);
    } else {
      // Scrubbing while paused lands on the same smoke an export of this frame would show.
      if (!this.advanceExact(tick, stable, input, SEEK_STEPS_PER_FRAME)) { this.pending = true; return; }
      this.lastSeconds = input.seconds;
    }
    u.uDye.value = this.fluid.dye;
    (u.uView.value as THREE.Matrix3).copy(input.view);
    u.uDensity.value = settings.density; u.uDetail.value = settings.turbulence;
    this.passes.draw(this.output, target);
  }

  dispose(): void {
    this.clearCheckpoints(); this.tail?.dispose(); this.tail = null;
    this.fluid.dispose(); this.emit.dispose(); this.force.dispose(); this.output.dispose(); this.passes.dispose();
  }
}
