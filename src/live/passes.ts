/** Full-screen passes and render targets for Live. Separate from StudioRenderer on purpose. */
import * as THREE from 'three';

export const fullscreenVertex = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class Passes {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly blank: THREE.ShaderMaterial;

  constructor(readonly renderer: THREE.WebGLRenderer) {
    if (!renderer.extensions.has('EXT_color_buffer_float'))
      throw new Error('This GPU does not support the half-float render buffers required for high-quality output.');
    this.blank = this.material('void main(){gl_FragColor=vec4(0.);}', {});
    this.quad = new THREE.Mesh(this.geometry, this.blank);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** A full-screen material: no blending, no depth, `varying vec2 vUv`. */
  material(fragment: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex, fragmentShader: fragment.includes('precision ') ? fragment : `precision highp float;\nvarying vec2 vUv;\n${fragment}`, uniforms,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
  }

  draw(material: THREE.ShaderMaterial, output: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(output);
    this.renderer.render(this.scene, this.camera);
  }

  /** Half-float RGBA unless `float`; linear filtering unless `nearest`. */
  target(width: number, height: number, options: { float?: boolean; nearest?: boolean; count?: number } = {}): THREE.WebGLRenderTarget {
    const filter = options.nearest ? THREE.NearestFilter : THREE.LinearFilter;
    const result = new THREE.WebGLRenderTarget(width, height, {
      type: options.float ? THREE.FloatType : THREE.HalfFloatType, format: THREE.RGBAFormat, count: options.count ?? 1,
      depthBuffer: false, stencilBuffer: false, minFilter: filter, magFilter: filter, generateMipmaps: false,
    });
    for (const texture of result.textures) texture.colorSpace = THREE.NoColorSpace;
    return result;
  }

  pair(width: number, height: number, options: { float?: boolean; nearest?: boolean; count?: number } = {}): Pair {
    return new Pair(this.target(width, height, options), this.target(width, height, options));
  }

  dispose(): void {
    this.geometry.dispose();
    this.blank.dispose();
  }
}

/** Two targets that take turns: read the last result, write the next. */
export class Pair {
  constructor(public read: THREE.WebGLRenderTarget, public write: THREE.WebGLRenderTarget) {}
  swap(): void { [this.read, this.write] = [this.write, this.read]; }
  setSize(width: number, height: number): void { this.read.setSize(width, height); this.write.setSize(width, height); }
  dispose(): void { this.read.dispose(); this.write.dispose(); }
}
