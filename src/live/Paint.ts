import * as THREE from 'three';
import type { Passes, Pair } from './passes';
import type { Look, TrackingFeed } from './look';
import type { LiveSettings } from './settings';
import { fadeFactor } from './maths';
import { canvasFragment, fillFragment, particleFragment, restFragment, streakFragment, streakVertex } from './paint-shaders';

/** Particles are a SIDE × SIDE texture. */
export const PAINT_SIDE = 256;
/** How far wet paint is carried by movement, as a share of the movement per 1/30 s. */
const DRIFT = .25;
/** The last faint trace of paint is removed at this much per fade time. */
const SINK = .02;

export class Paint implements Look {
  private readonly state: Pair;
  private readonly canvas: Pair;
  private readonly simulate: THREE.ShaderMaterial;
  private readonly rest: THREE.ShaderMaterial;
  private readonly settle: THREE.ShaderMaterial;
  private readonly fill: THREE.ShaderMaterial;
  private readonly streaks: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly ground = new THREE.Vector3();
  private readonly palette = Array.from({ length: 5 }, () => new THREE.Vector3());
  private paletteKey = '';
  private frame = 0;
  private cleared = false;

  constructor(private readonly passes: Passes, private width: number, private height: number, side = PAINT_SIDE) {
    this.state = passes.pair(side, side, { float: true, nearest: true, count: 2 });
    this.canvas = passes.pair(width, height);
    this.simulate = passes.material(particleFragment, {
      uA: { value: null }, uB: { value: null }, uFlow: { value: null }, uStep: { value: 0 }, uTime: { value: 0 }, uSeed: { value: 0 },
      uResponse: { value: 1 }, uStroke: { value: .5 }, uSpread: { value: .35 }, uColourChange: { value: .3 },
    });
    this.rest = passes.material(restFragment, {});
    this.settle = passes.material(canvasFragment, { uCanvas: { value: null }, uFlow: { value: null }, uKeep: { value: 1 }, uDrift: { value: 0 }, uSink: { value: 0 }, uGround: { value: this.ground } });
    this.fill = passes.material(fillFragment, { uGround: { value: this.ground } });
    this.streaks = new THREE.ShaderMaterial({
      vertexShader: streakVertex, fragmentShader: `precision highp float;\n${streakFragment}`,
      uniforms: { uA: { value: null }, uB: { value: null }, uSize: { value: new THREE.Vector2(width, height) }, uStep: { value: 0 }, uWidth: { value: 2 }, uPalette: { value: this.palette } },
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.NormalBlending, premultipliedAlpha: false, toneMapped: false,
    });
    // One quad per particle: x runs along the streak, y across it.
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, -.5, 0, 1, -.5, 0, 1, .5, 0, 0, .5, 0], 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const refs = new Float32Array(side * side * 2);
    for (let i = 0; i < side * side; i++) { refs[i * 2] = (i % side + .5) / side; refs[i * 2 + 1] = (Math.floor(i / side) + .5) / side; }
    this.geometry.setAttribute('ref', new THREE.InstancedBufferAttribute(refs, 2));
    this.geometry.instanceCount = side * side;
    const mesh = new THREE.Mesh(this.geometry, this.streaks);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.clear();
  }

  get output(): THREE.Texture { return this.canvas.read.texture; }

  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void {
    const p = settings.paint;
    this.ground.setScalar(p.ground >= .5 ? 1 : 0);
    this.readPalette(settings.palette);
    if (this.cleared) { this.wipe(); this.cleared = false; }
    if (seconds <= 0) return;

    const sim = this.simulate.uniforms;
    sim.uA.value = this.state.read.textures[0]; sim.uB.value = this.state.read.textures[1]; sim.uFlow.value = feed.flow;
    sim.uStep.value = seconds; sim.uTime.value = time; sim.uSeed.value = (this.frame++ * .61803398875) % 1;
    sim.uResponse.value = p.response; sim.uStroke.value = p.strokeLength; sim.uSpread.value = p.spread; sim.uColourChange.value = p.colourChange;
    this.passes.draw(this.simulate, this.state.write);
    this.state.swap();

    const settle = this.settle.uniforms;
    settle.uCanvas.value = this.canvas.read.texture; settle.uFlow.value = feed.flow;
    settle.uKeep.value = fadeFactor(seconds, p.fadeSeconds); settle.uDrift.value = DRIFT * seconds * 30;
    settle.uSink.value = SINK * seconds / p.fadeSeconds;
    this.passes.draw(this.settle, this.canvas.write);

    const streak = this.streaks.uniforms;
    streak.uA.value = this.state.read.textures[0]; streak.uB.value = this.state.read.textures[1];
    streak.uStep.value = seconds; streak.uWidth.value = (6 + (1.2 - 6) * p.bristle) * this.height / 1080;
    const renderer = this.passes.renderer;
    renderer.setRenderTarget(this.canvas.write);
    renderer.render(this.scene, this.camera);
    this.canvas.swap();
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.canvas.setSize(width, height);
    (this.streaks.uniforms.uSize.value as THREE.Vector2).set(width, height);
    this.clear();
  }

  /** Wipes the paint and rests every particle. The ground colour is applied on the next step. */
  clear(): void {
    this.passes.draw(this.rest, this.state.read); this.passes.draw(this.rest, this.state.write);
    this.cleared = true;
  }

  dispose(): void {
    for (const item of [this.state, this.canvas, this.simulate, this.rest, this.settle, this.fill, this.streaks, this.geometry]) item.dispose();
  }

  private wipe(): void {
    this.passes.draw(this.fill, this.canvas.read); this.passes.draw(this.fill, this.canvas.write);
  }

  private readPalette(palette: string[]): void {
    const key = palette.join();
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    const colour = new THREE.Color();
    // The sixth palette entry is the app's dark ground colour; paint uses the five bright ones.
    this.palette.forEach((v, i) => { colour.set(palette[i % palette.length]); v.set(colour.r, colour.g, colour.b); });
  }
}
