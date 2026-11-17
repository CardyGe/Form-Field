import * as THREE from 'three';
import type { Look, TrackingFeed } from './look';
import type { LiveSettings, ReliefSettings } from './settings';
import { Passes, type Pair } from './passes';
import { reliefGeometry, scaleDimensions } from './relief-geometry';
import { latchFragment, reliefFragment, reliefVertex, rippleFragment, sweepFragment } from './relief-shaders';

const surfaceIndex = { blades: 0, scales: 1, weave: 2 };
const motionIndex = { sweep: 0, ripple: 1, latch: 2 };
const finishIndex = { silver: 0, brass: 1, pearl: 2, foil: 3 };

export class Relief implements Look {
  private readonly field: Pair;
  private readonly sweep: THREE.ShaderMaterial;
  private readonly ripple: THREE.ShaderMaterial;
  private readonly latch: THREE.ShaderMaterial;
  private readonly zero: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, .1, 25);
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: reliefVertex, fragmentShader: reliefFragment,
    uniforms: {
      uState: { value: null }, uDepth: { value: 1 }, uMotion: { value: 0 }, uSurface: { value: 0 },
      uPitch: { value: .5 }, uFinish: { value: 0 }, uEdgeLight: { value: 0 }, uLight: { value: new THREE.Vector2(1,0) },
    },
  });
  private readonly wall = new THREE.Mesh(reliefGeometry('blades','medium'), this.material);
  private surface: ReliefSettings['surface'] = 'blades';
  private size: ReliefSettings['size'] = 'medium';
  private motion: ReliefSettings['motion'] = 'sweep';
  private readonly target: THREE.WebGLRenderTarget;

  constructor(private readonly passes: Passes, width: number, height: number) {
    this.field = passes.pair(160, 90);
    const simUniforms = { uState: { value: null }, uFlow: { value: null }, uStep: { value: 0 },
      uReach: { value: 0 }, uSettle: { value: 1 }, uFresh: { value: 0 } };
    this.sweep = passes.material(sweepFragment, simUniforms);
    this.ripple = passes.material(rippleFragment, simUniforms);
    this.latch = passes.material(latchFragment, simUniforms);
    this.zero = passes.material('void main(){gl_FragColor = vec4(0.);}', {});
    this.target = passes.target(width, height);
    this.target.depthBuffer = true;
    this.target.samples = Math.min(4, passes.renderer.capabilities.maxSamples);
    this.scene.background = new THREE.Color(0x15202c);
    this.camera.position.z = 10;
    this.wall.frustumCulled = false;
    this.scene.add(this.wall);
    this.clear();
  }

  get output() { return this.target.texture; }

  step(seconds: number, _time: number, feed: TrackingFeed, settings: LiveSettings) {
    const style = settings.relief;
    if (this.surface !== style.surface || this.size !== style.size) {
      const previous = this.wall.geometry;
      this.wall.geometry = reliefGeometry(style.surface, style.size);
      previous.dispose();
      this.surface = style.surface;
      this.size = style.size;
    }
    if (this.motion !== style.motion) {
      this.clear(); // Each simulation has its own field layout.
      this.motion = style.motion;
    }
    const pass = this[this.motion];
    const steps = this.motion === 'sweep' ? 1 : Math.max(1, Math.ceil(seconds*90));
    const u = pass.uniforms;
    u.uFlow.value = feed.flow;
    u.uReach.value = style.reach;
    u.uSettle.value = style.settle;
    u.uStep.value = seconds / steps;
    for (let i = 0; i < steps; i++) {
      u.uState.value = this.field.read.texture;
      u.uFresh.value = i === 0 && feed.fresh ? 1 : 0;
      this.passes.draw(pass, this.field.write);
      this.field.swap();
    }
    const art = this.material.uniforms;
    art.uState.value = this.field.read.texture;
    art.uDepth.value = style.depth;
    art.uPitch.value = scaleDimensions[this.size].pitch;
    art.uSurface.value = surfaceIndex[this.surface];
    art.uFinish.value = finishIndex[style.finish];
    art.uMotion.value = motionIndex[this.motion];
    art.uEdgeLight.value = style.edgeLight;
    const angle = THREE.MathUtils.degToRad(style.lightAngle);
    art.uLight.value.set(Math.cos(angle), Math.sin(angle));
    const renderer = this.passes.renderer;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number) { this.target.setSize(width, height); }
  clear() { this.passes.draw(this.zero, this.field.read); this.passes.draw(this.zero, this.field.write); }
  dispose() {
    this.field.dispose(); this.sweep.dispose(); this.ripple.dispose(); this.latch.dispose(); this.zero.dispose();
    this.material.dispose(); this.wall.geometry.dispose(); this.target.dispose();
  }
}
