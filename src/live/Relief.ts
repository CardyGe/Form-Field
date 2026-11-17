import * as THREE from 'three';
import type { Look, TrackingFeed } from './look';
import type { LiveSettings, ReliefSettings } from './settings';
import { Passes, type Pair } from './passes';
import { RELIEF_PALETTES, type ReliefPaletteName } from './relief-palettes';
import { reliefGeometry, scaleDimensions } from './relief-geometry';
import { audienceFragment, latchFragment, reliefFragment, reliefVertex, ricochetFragment, rippleFragment, sweepFragment } from './relief-shaders';

const surfaceIndex = { blades: 0, scales: 1, weave: 2 };
const motionIndex = { sweep: 0, ripple: 1, latch: 2, ricochet: 3 };
const finishIndex = { silver: 0, brass: 1, pearl: 2, foil: 3 };

export class Relief implements Look {
  private readonly field: Pair;
  private readonly audience: Pair;
  private readonly audiencePass: THREE.ShaderMaterial;
  private imprint = false;
  private readonly sweep: THREE.ShaderMaterial;
  private readonly ripple: THREE.ShaderMaterial;
  private readonly ricochet: THREE.ShaderMaterial;
  private readonly latch: THREE.ShaderMaterial;
  private readonly zero: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, .1, 25);
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: reliefVertex, fragmentShader: reliefFragment,
    uniforms: {
      uState: { value: null }, uAudience: { value: null }, uBodyImprint: { value: false }, uDepth: { value: 1 }, uMotion: { value: 0 }, uSurface: { value: 0 },
      uUsePalette: { value: false }, uPalette: { value: Array.from({ length: 6 }, () => new THREE.Color()) },
      uPitch: { value: .5 }, uFinish: { value: 0 }, uEdgeLight: { value: 0 }, uLight: { value: new THREE.Vector2(1,0) },
    },
  });
  private readonly wall = new THREE.Mesh(reliefGeometry('blades','fine'), this.material);
  private surface: ReliefSettings['surface'] = 'blades';
  private size: ReliefSettings['size'] = 'fine';
  private motion: ReliefSettings['motion'] = 'sweep';
  private palette: ReliefPaletteName = 'material';
  private readonly target: THREE.WebGLRenderTarget;

  constructor(private readonly passes: Passes, width: number, height: number) {
    this.field = passes.pair(160, 90);
    this.audience = passes.pair(160, 90);
    this.audiencePass = passes.material(audienceFragment, {
      uPrevious: { value: null }, uPeople: { value: null }, uFlow: { value: null },
      uStep: { value: 0 }, uFresh: { value: 0 }, uBox: { value: new THREE.Vector4() },
    });
    const simUniforms = { uState: { value: null }, uFlow: { value: null }, uStep: { value: 0 },
      uReach: { value: 0 }, uSettle: { value: 1 }, uFresh: { value: 0 } };
    this.sweep = passes.material(sweepFragment, simUniforms);
    this.ricochet = passes.material(ricochetFragment, simUniforms);
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
    const steps = this.motion === 'ripple' || this.motion === 'latch' ? Math.max(1, Math.ceil(seconds*90)) : 1;
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
    if (this.imprint !== settings.reliefPresence) {
      this.clearAudience();
      this.imprint = settings.reliefPresence;
    }
    if (this.imprint) {
      const a = this.audiencePass.uniforms, box = settings.box;
      a.uPrevious.value = this.audience.read.texture;
      a.uPeople.value = feed.people;
      a.uFlow.value = feed.flow;
      a.uStep.value = seconds;
      a.uFresh.value = feed.fresh ? 1 : 0;
      a.uBox.value.set(box.left, box.right, box.bottom, box.top);
      this.passes.draw(this.audiencePass, this.audience.write);
      this.audience.swap();
    }

    const art = this.material.uniforms;
    if (this.palette !== settings.reliefPalette) {
      this.palette = settings.reliefPalette;
      art.uUsePalette.value = this.palette !== 'material';
      RELIEF_PALETTES[this.palette].colours.forEach((swatch, index) => art.uPalette.value[index].set(swatch));
    }
    art.uBodyImprint.value = this.imprint;
    art.uAudience.value = this.audience.read.texture;
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
  clear() {
    this.passes.draw(this.zero, this.field.read);
    this.passes.draw(this.zero, this.field.write);
    this.clearAudience();
  }
  private clearAudience() {
    this.passes.draw(this.zero, this.audience.read);
    this.passes.draw(this.zero, this.audience.write);
  }
  dispose() {
    this.audience.dispose(); this.audiencePass.dispose();
    this.field.dispose(); this.sweep.dispose(); this.ricochet.dispose(); this.ripple.dispose(); this.latch.dispose(); this.zero.dispose();
    this.material.dispose(); this.wall.geometry.dispose(); this.target.dispose();
  }
}
