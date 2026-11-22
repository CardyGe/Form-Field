import * as THREE from 'three';
import type { MorphParams } from './params';
import type { GpuPasses } from './solver';
import { formAt } from './forms';
import { MORPH_PALETTES } from './palettes';
import { blurFragment, brightFragment, finishFragment, shadeFragment } from './shade-shaders';

const linearStops = (index: number) => MORPH_PALETTES[Math.max(0, Math.min(MORPH_PALETTES.length - 1, Math.round(index)))].stops.map(hex => {
  const c = new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
  return new THREE.Vector3(c.r, c.g, c.b);
});

/** Turns the stripe field into the finished picture at output size. */
export class MorphShade {
  private readonly surface: ReturnType<GpuPasses['pair']>;
  private readonly glow: ReturnType<GpuPasses['pair']>;
  private readonly result: ReturnType<GpuPasses['pair']>;
  private readonly shade: THREE.ShaderMaterial;
  private readonly bright: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly finish: THREE.ShaderMaterial;
  private palette = -1;
  private bloomLevel = 1;

  constructor(private readonly passes: GpuPasses, private width: number, private height: number) {
    this.surface = passes.pair(width, height, {});
    this.glow = passes.pair(width >> 2, height >> 2, {});
    this.result = passes.pair(width, height, {});
    const number = (...keys: string[]) => Object.fromEntries(keys.map(k => [k, { value: 0 }]));
    this.shade = passes.material(shadeFragment, {
      uState: { value: null }, uStops: { value: linearStops(0) }, uFormPos: { value: new THREE.Vector2() }, uOut: { value: new THREE.Vector2(width, height) },
      ...number('uAspect', 'uFormType', 'uFormSize', 'uFormSoft', 'uRefraction', 'uDepth', 'uBevel', 'uSharp', 'uWavelength', 'uRough', 'uMetal', 'uCoat', 'uLightAngle', 'uEnvRotate', 'uIrid', 'uFilm', 'uFilmVary', 'uFilmIor', 'uColourShift', 'uZones', 'uSaturation', 'uExposure', 'uChroma', 'uTime', 'uShimmer'),
    });
    this.bright = passes.material(brightFragment, { uImage: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.blur = passes.material(blurFragment, { uImage: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.finish = passes.material(finishFragment, { uImage: { value: null }, uBloom: { value: null }, uAmount: { value: 0 }, uGrain: { value: 0 }, uTime: { value: 0 }, uFade: { value: 1 } });
  }

  get output(): THREE.Texture { return this.result.read.texture; }

  draw(state: THREE.Texture, params: MorphParams, time: number, finish: { widthScale: number; fade: number; bloom: boolean } = { widthScale: 1, fade: 1, bloom: true }): void {
    const u = this.shade.uniforms;
    if (this.palette !== params.palette) { u.uStops.value = linearStops(params.palette); this.palette = params.palette; }
    u.uState.value = state; u.uAspect.value = this.width / this.height; (u.uOut.value as THREE.Vector2).set(this.width, this.height);
    const form = formAt(params, time);
    (u.uFormPos.value as THREE.Vector2).set(form.x, form.y);
    const values: Record<string, number> = {
      uFormType: params.formType, uFormSize: params.formSize, uFormSoft: params.formSoft, uRefraction: params.refraction, uDepth: params.depth, uBevel: params.bevel,
      uSharp: params.lineSharp, uWavelength: params.wavelength * finish.widthScale, uRough: params.roughness, uMetal: params.metal, uCoat: params.clearcoat, uLightAngle: params.lightAngle,
      uEnvRotate: params.envRotate, uIrid: params.irid, uFilm: params.filmNm, uFilmVary: params.filmVary, uFilmIor: params.filmIor, uColourShift: params.colourShift,
      uZones: params.colourZones, uSaturation: params.saturation, uExposure: params.exposure, uChroma: params.chroma, uTime: time, uShimmer: params.shimmer,
    };
    for (const key in values) u[key].value = values[key];
    this.passes.draw(this.shade, this.surface.write); this.surface.swap();

    // Bloom eases in and out, so the governor can never make it visibly pop.
    this.bloomLevel = finish.bloom ? Math.min(1, this.bloomLevel + .04) : Math.max(0, this.bloomLevel - .04);
    if (this.bloomLevel > 0) this.glowPasses();
    const f = this.finish.uniforms;
    f.uImage.value = this.surface.read.texture; f.uBloom.value = this.glow.read.texture; f.uAmount.value = params.bloom * this.bloomLevel; f.uGrain.value = params.grain; f.uTime.value = time; f.uFade.value = finish.fade;
    this.passes.draw(this.finish, this.result.write); this.result.swap();
  }

  private glowPasses(): void {
    this.bright.uniforms.uImage.value = this.surface.read.texture;
    (this.bright.uniforms.uTexel.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    this.passes.draw(this.bright, this.glow.write); this.glow.swap();
    const texel = new THREE.Vector2(4 / this.width, 4 / this.height);
    for (const direction of [new THREE.Vector2(texel.x, 0), new THREE.Vector2(0, texel.y), new THREE.Vector2(texel.x * 2, 0), new THREE.Vector2(0, texel.y * 2)]) {
      this.blur.uniforms.uImage.value = this.glow.read.texture; this.blur.uniforms.uStep.value = direction;
      this.passes.draw(this.blur, this.glow.write); this.glow.swap();
    }
  }

  resize(width: number, height: number): void {
    this.width = width; this.height = height;
    this.surface.setSize(width, height); this.glow.setSize(width >> 2, height >> 2); this.result.setSize(width, height);
  }

  dispose(): void {
    for (const item of [this.surface, this.glow, this.result, this.shade, this.bright, this.blur, this.finish]) item.dispose();
  }
}
