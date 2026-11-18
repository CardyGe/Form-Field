import * as THREE from 'three';
import { SIGNAL_MAX_POSES, type LiveSettings } from './settings';
import type { Passes } from './passes';

const COLUMNS = 4;
const ROWS = SIGNAL_MAX_POSES / COLUMNS;
const WIDTH = 640;
const HEIGHT = 360;

/** Store cutout edges and coverage only. The raw camera never enters this pass. */
const captureFragment = /* glsl */`
uniform sampler2D uSubject;
void main() {
  vec2 px = 2. / vec2(${WIDTH}.0, ${HEIGHT}.0);
  float coverage = texture2D(uSubject, vUv).a;
  float inside = min(
    min(texture2D(uSubject, vUv + vec2(px.x, 0.)).a, texture2D(uSubject, vUv - vec2(px.x, 0.)).a),
    min(texture2D(uSubject, vUv + vec2(0., px.y)).a, texture2D(uSubject, vUv - vec2(0., px.y)).a)
  );
  gl_FragColor = vec4(max(0., coverage - inside), coverage, 0., 1.);
}`;

export const echoGLSL = /* glsl */`
uniform sampler2D uPoseAtlas;
uniform vec2 uPoses[${SIGNAL_MAX_POSES}];
uniform float uPoseFill, uHasPoses;

vec3 poseEchoes(vec2 p) {
  if (uHasPoses < .5) return vec3(0.);
  vec2 grid = vec2(${COLUMNS}.0, ${ROWS}.0);
  // Keep linear filtering inside each tile, even at the edge of the camera image.
  vec2 inset = .5 / vec2(${WIDTH}.0, ${HEIGHT}.0);
  vec2 local = clamp(p, inset, 1. - inset);
  vec3 colour = vec3(0.);
  for (int i = 0; i < ${SIGNAL_MAX_POSES}; i++) {
    vec2 pose = uPoses[i];
    if (pose.x <= 0.) continue;
    float slot = float(i);
    vec2 tile = vec2(mod(slot, grid.x), floor(slot / grid.x));
    vec2 ink = texture2D(uPoseAtlas, (tile + local) / grid).rg;
    float coverage = clamp(ink.r * .9 + ink.g * uPoseFill * .8, 0., 1.);
    colour += (1. - colour) * rampAt(pose.y) * coverage * pose.x;
  }
  return colour;
}`;

/** Keep poses in a single GPU texture, writing just one tile when a new pose arrives. */
export class SignalEchoes {
  private readonly capture: THREE.ShaderMaterial;
  private readonly atlas: THREE.WebGLRenderTarget;
  private readonly times = Array<number>(SIGNAL_MAX_POSES).fill(-Infinity);
  private readonly poses = new Float32Array(SIGNAL_MAX_POSES * 2);
  private next = 0;
  private lastCapture = -Infinity;

  constructor(private readonly passes: Passes) {
    this.atlas = new THREE.WebGLRenderTarget(WIDTH * COLUMNS, HEIGHT * ROWS, {
      type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    // With autoClear or a future explicit clear, earlier tiles must stay intact.
    this.atlas.scissorTest = true;
    this.capture = passes.material(captureFragment, { uSubject: { value: null } });
  }

  uniforms(): Record<string, THREE.IUniform> {
    return {
      uPoseAtlas: { value: this.atlas.texture },
      uPoses: { value: this.poses },
      uPoseFill: { value: 0 },
      uHasPoses: { value: 0 },
    };
  }

  apply(subject: THREE.Texture, time: number, fresh: boolean, settings: LiveSettings['signal'], uniforms: Record<string, THREE.IUniform>): void {
    const { poseSpacing: spacing, poseCount, poseFill } = settings;
    const amount = settings.removeBackground ? settings.poseEcho : 0;
    if (amount === 0) {
      if (this.lastCapture !== -Infinity) this.clear();
      uniforms.uHasPoses.value = 0;
      return;
    }
    if (fresh && !settings.hold && time - this.lastCapture >= spacing - .0001) {
      const x = this.next % COLUMNS * WIDTH, y = Math.floor(this.next / COLUMNS) * HEIGHT;
      this.atlas.viewport.set(x, y, WIDTH, HEIGHT);
      this.atlas.scissor.copy(this.atlas.viewport);
      this.capture.uniforms.uSubject.value = subject;
      this.passes.draw(this.capture, this.atlas);
      this.times[this.next] = time;
      this.next = (this.next + 1) % SIGNAL_MAX_POSES;
      this.lastCapture = time;
    }

    let hasPoses = false;
    this.poses.fill(0);
    for (let rank = 0; rank < poseCount; rank++) {
      const slot = (this.next + SIGNAL_MAX_POSES - 1 - rank) % SIGNAL_MAX_POSES;
      const age = (time - this.times[slot]) / spacing;
      if (age >= poseCount) continue;
      const life = 1 - age / poseCount;
      const weight = amount * Math.min(1, age * 2) * life;
      this.poses[slot * 2] = weight;
      this.poses[slot * 2 + 1] = life;
      hasPoses ||= weight > 0;
    }
    uniforms.uPoseFill.value = poseFill;
    uniforms.uHasPoses.value = hasPoses ? 1 : 0;
  }

  clear(): void {
    this.times.fill(-Infinity);
    this.poses.fill(0);
    this.next = 0;
    this.lastCapture = -Infinity;
  }

  dispose(): void {
    this.capture.dispose();
    this.atlas.dispose();
  }
}
