import {FINISH_PARAMETERS} from '../core/finishing';
import { InstrumentRenderer } from './InstrumentRenderer';
import { isInstrument } from '../core/instruments';
import * as THREE from 'three';
import { GraphicRenderer } from './GraphicRenderer';
import { graphicRenderPlan } from './graphic-view';
import { sourceViewMatrix } from './source-view';
import { EXRExporter, ZIP_COMPRESSION } from 'three/addons/exporters/EXRExporter.js';
import { evaluateLayer, frameCount, phaseAtFrame } from '../core/timeline';
import { feedbackActive, feedbackFragment, frameAtPhase, persistence, warmupFrames } from './feedback';
import { slitActive, slitFragment, sliceDelays } from './slitscan';
import { parameterDefinitions } from '../core/project';
import type { Layer, Project } from '../shared/types';
import { encodePNG } from './png';
import { fractalFragment } from './fractal';
import { oilFieldsFragment, oilPaintFragment, oilLensFragment } from './oil';
import { oilMotion, OIL_WAKE_SAMPLES } from './oil-motion';
import { OilPatternBaker } from './oil-pattern';
import { finiteEvolving } from '../core/playback';
import { super8Fragment } from './super8';
import { super8ProjectorFragment } from './super8-projector';
import { super8Clock, super8History, super8Transport, SUPER8_HISTORY } from './super8-motion';
import { sculptureDeformation, sculptureDetail, createSculptureTorusGeometry } from './sculpture';
import {
  fullscreenVertex, surfaceFragment, imageFragment, compositeFragment,
  finishFragment, displayFragment,
  downsampleFragment,
} from './shaders';

const TAU = Math.PI * 2;
const SURFACE_DEFAULTS = Object.fromEntries(parameterDefinitions('surface')
  .filter(({ key }) => !['cycles','exposure','saturation','hue'].includes(key)).map(({ key, default: value }) => [key, value]));
const SCULPTURE_SHAPE_DEFAULTS = Object.fromEntries(parameterDefinitions('sculpture')
  .filter(({ key }) => ['form','lobes','thickness','stretch','curl','foldFrequency','asymmetry','ridgeScale'].includes(key))
  .map(({ key, default: value }) => [key,value]));
const FRACTAL_DEFAULTS = Object.fromEntries(parameterDefinitions('fractal')
  .filter(({ key }) => !['cycles','saturation','hue','colorMode','colorSteps','colorMix'].includes(key)).map(({ key, default: value }) => [key, value]));
const OIL_DEFAULTS = Object.fromEntries(parameterDefinitions('oil').map(({ key, default: value }) => [key, value]));
const DEFAULT_PALETTE = ['#26cfee', '#adfc35', '#ec72dd', '#7535c0', '#ff805f', '#152043'];
type Uniforms = Record<string, THREE.IUniform>;
interface Asset { texture: THREE.Texture; promise: Promise<THREE.Texture> }
/** Per-layer feedback history: `current` holds the layer output at `frame`. */
/**
 * Per-layer feedback history. `current` holds the layer output at `frame`;
 * when `previousValid`, `next` holds the output at frame - 1.
 */
interface FeedbackState {
  /** Frame count and size. A change discards the history. */
  structure: string;
  /** The layer settings of the latest step. */
  key: string;
  frame: number;
  current: THREE.WebGLRenderTarget;
  next: THREE.WebGLRenderTarget;
  previousValid: boolean;
  /** The history covers the full warm-up with the current settings. */
  exact: boolean;
  /** Preview only: an exact history being rebuilt in the background. */
  settle: { key: string; frame: number; step: number; a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget } | null;
  spare: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null;
}
/** Seeks in the preview warm up with at most this many source renders at once. */
const PREVIEW_WARMUP = 60;
/** The preview steps through short forward jumps instead of warming up again. */
const PREVIEW_STEP_LIMIT = 8;
/** Background settle source renders per preview frame while paused. */
const SETTLE_CHUNK = 6;
/** Source renders per feedback step: one, or one per time slice. */
const stepCost = (layer: Layer) => slitActive(layer) ? sliceDelays(layer).length : 1;
const layerKey = (layer: Layer) =>
  JSON.stringify(layer, (key, value) => key === 'dataUrl' && typeof value === 'string' ? `${value.length}:${value.slice(-64)}` : value);

function viewUniforms(): Uniforms {
  return {uView:{value:new THREE.Matrix3()},uViewInverse:{value:new THREE.Matrix3()},uViewScale:{value:1}};
}
function setSourceView(uniforms: Uniforms, matrix: THREE.Matrix3, scale: number): void {
  (uniforms.uView.value as THREE.Matrix3).copy(matrix);
  (uniforms.uViewInverse.value as THREE.Matrix3).copy(matrix).invert();
  uniforms.uViewScale.value=1/scale;
}

function material(fragmentShader: string, uniforms: Uniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex, fragmentShader, uniforms,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
}

function target(depth = false, bytes = false): THREE.WebGLRenderTarget {
  const result = new THREE.WebGLRenderTarget(1, 1, {
    type: bytes ? THREE.UnsignedByteType : THREE.HalfFloatType,
    format: THREE.RGBAFormat, depthBuffer: depth, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  result.texture.colorSpace = bytes ? THREE.NoColorSpace : THREE.LinearSRGBColorSpace;
  return result;
}

function number(layer: Layer, key: string, fallback: number): number {
  const value = layer.params[key];
  return Number.isFinite(value) ? value : fallback;
}

/**
 * One GPU pipeline for preview and export. Sources and composition are associated
 * scene-linear RGBA16F; linearOutput is finished-SDR LINEAR-sRGB, STRAIGHT alpha.
 * Only displayMaterial applies an output transfer function (sRGB) and 8-bit dither.
 * The EXR cache deliberately contains no transfer function or display metadata guess.
 */
export class StudioRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly maxTargetSize: number;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly source = target(true);
  private readonly fractalPreview = target();
  private readonly copy = material(`precision highp float;varying vec2 vUv;uniform sampler2D uImage;void main(){gl_FragColor=texture2D(uImage,vUv);}`, { uImage: { value: null } });
  private readonly graphics = new GraphicRenderer();
  private readonly instruments = new InstrumentRenderer();
  private readonly accumA = target();
  private readonly accumB = target();
  private readonly linearOutput = target();
  private readonly byteOutput = target(false, true);
  /** Delivery-size result of a supersampled export; sized independently of the working targets. */
  private readonly resolved = target();
  private readonly surface: THREE.ShaderMaterial;
  private readonly fractal: THREE.ShaderMaterial;
  private readonly image: THREE.ShaderMaterial;
  private readonly super8: THREE.ShaderMaterial;
  private readonly super8Projector: THREE.ShaderMaterial;
  private super8Source: THREE.WebGLRenderTarget | null = null;
  private graphicSource: THREE.WebGLRenderTarget | null = null;
  private readonly oilFields: THREE.ShaderMaterial;
  private readonly oilPaint: THREE.ShaderMaterial;
  private readonly oilLens: THREE.ShaderMaterial;
  private oilData: THREE.WebGLRenderTarget | null = null;
  private readonly oilPattern: OilPatternBaker;
  private oilUnderlay: THREE.WebGLRenderTarget | null = null;
  private readonly composite: THREE.ShaderMaterial;
  private readonly finish: THREE.ShaderMaterial;
  private readonly display: THREE.ShaderMaterial;
  private readonly downsample: THREE.ShaderMaterial;
  private readonly feedback: THREE.ShaderMaterial;
  private readonly slit: THREE.ShaderMaterial;
  /** Slit-scan accumulation, consumed before the next layer is drawn. */
  private slitTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private readonly feedbackStates = new Map<string, FeedbackState>();
  /** Exports need the full steady state; the preview may approximate after a seek. */
  private exactFeedback = false;
  private readonly sculptureScene = new THREE.Scene();
  private readonly sculptureCamera = new THREE.PerspectiveCamera(40, 1, .1, 50);
  private readonly sculptureGeometry = new THREE.SphereGeometry(1, 320, 192);
  private readonly sculptureTorusGeometry = createSculptureTorusGeometry();
  private readonly sculptureMaterial: THREE.MeshPhysicalMaterial;
  private readonly sculptureDepthMaterial: THREE.MeshDepthMaterial;
  private readonly sculpture: THREE.Mesh;
  private readonly keyLight = new THREE.DirectionalLight(0xffe8d4, 2.8);
  private readonly rimLight = new THREE.DirectionalLight(0xb5caff, 2.4);
  private readonly fillLight = new THREE.DirectionalLight(0xc9d3ed, 1.35);
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly filmThickness: THREE.DataTexture;
  private readonly sculptureUniforms: Uniforms = {
    ...viewUniforms(),
    studioPhase: { value: 0 }, studioFold: { value: .6 }, studioRidges: { value: .5 },
    studioBreath: { value: .25 }, studioSeed: { value: 1 },
    studioOpening: { value: .55 }, studioTwist: { value: .3 },
    ...Object.fromEntries(Object.entries(SCULPTURE_SHAPE_DEFAULTS).map(([key,value])=>[`studio${key[0].toUpperCase()}${key.slice(1)}`,{value}])) ,
  };
  private readonly assets = new Map<string, Asset>();
  private readonly fallback: THREE.DataTexture;
  private width = 1;
  private height = 1;
  private disposed = false;
  private exporting = false;
  private prepareRevision = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.maxTargetSize=Math.min(this.renderer.capabilities.maxTextureSize,
      this.renderer.getContext().getParameter(this.renderer.getContext().MAX_RENDERBUFFER_SIZE) as number);
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0, 0);
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) {
      this.renderer.dispose();
      throw new Error('This GPU does not support the half-float render buffers required for high-quality output.');
    }
    this.source.samples = Math.min(4, this.renderer.capabilities.maxSamples);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.fallback = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.fallback.needsUpdate = true;

    this.surface = material(surfaceFragment, {
      ...viewUniforms(),
      uPalette: { value: DEFAULT_PALETTE.map((hex) => new THREE.Color(hex)) },
      uAspect: { value: 1 }, uPhase: { value: 0 }, uSeed: { value: 0 },
      uResolution:{value:new THREE.Vector2(1,1)},
      ...Object.fromEntries(Object.entries(SURFACE_DEFAULTS).map(([key,value])=>[`u${key[0].toUpperCase()}${key.slice(1)}`,{value}])),
    });
    this.fractal = material(fractalFragment, {
      ...viewUniforms(),
      uPalette: { value: DEFAULT_PALETTE.map((hex) => new THREE.Color(hex)) },
      uResolution: { value: new THREE.Vector2(1, 1) }, uAspect: { value: 1 },
      uPhase: { value: 0 }, uSeed: { value: 0 }, uStyle: { value: 0 },
      ...Object.fromEntries(Object.entries(FRACTAL_DEFAULTS).map(([key, value]) => [`u${key[0].toUpperCase()}${key.slice(1)}`, { value }])),
    });
    const oilUniforms: Uniforms = {
      ...viewUniforms(),
      ...Object.fromEntries(Object.entries(OIL_DEFAULTS).map(([key, value]) => [`u${key[0].toUpperCase()}${key.slice(1)}`, { value }])),
      uPalette: { value: DEFAULT_PALETTE.map(hex => new THREE.Color(hex)) },
      uResolution: { value: new THREE.Vector2(1, 1) }, uAspect: { value: 1 }, uSeed: { value: 0 },
      uSlide: { value: new THREE.Vector2() }, uLens: { value: new THREE.Vector2() },
      uDirection: { value: new THREE.Vector2(1, 0) }, uSlideAngle: { value: 0 },
      uLensAngle: { value: 0 }, uLensShapePhase: { value: 0 }, uPresence: { value: 1 }, uStrain: { value: 0 },
      uWake: { value: Array.from({ length: OIL_WAKE_SAMPLES }, () => new THREE.Vector4()) },
      uFields: { value: this.fallback }, uUnderlay: { value: this.fallback },
      uPattern: { value: this.fallback }, uPatternOffset: { value: new THREE.Vector2() },
    };
    this.oilFields = material(oilFieldsFragment, oilUniforms);
    this.oilPaint = material(oilPaintFragment, oilUniforms);
    this.oilLens = material(oilLensFragment, oilUniforms);
    this.oilPattern = new OilPatternBaker(this.renderer);
    this.super8 = material(super8Fragment, {
      ...viewUniforms(),
      uPalette: { value: DEFAULT_PALETTE.map(hex => new THREE.Color(hex)) },
      uResolution: { value: new THREE.Vector2(1, 1) }, uAspect: { value: 1 },
      uSeed: { value: 0 }, uMode: { value: 0 }, uSubstrate: { value: 1 },
      uShape: { value: Array.from({ length: SUPER8_HISTORY * 2 }, () => new THREE.Vector4()) },
      uPaint: { value: Array.from({ length: SUPER8_HISTORY * 2 }, () => new THREE.Vector4()) },
      uMotion: { value: Array.from({ length: SUPER8_HISTORY * 2 }, () => new THREE.Vector4()) },
      uEmulsion: { value: Array.from({ length: SUPER8_HISTORY * 2 }, () => new THREE.Vector2()) },
      uTransport: { value: new THREE.Vector2() }, uDust: { value: 0 }, uRoll: { value: new THREE.Vector4(0, 28, 1, 0) },
      uFilm: { value: new THREE.Vector4() }, uFeedback: { value: new THREE.Vector4() },
    });
    this.super8Projector = material(super8ProjectorFragment, {
      ...viewUniforms(), uPaintViewInverse: {value:new THREE.Matrix3()},
      uImage: { value: this.fallback }, uResolution: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 1 }, uSeed: { value: 0 }, uSubstrate: { value: 1 },
      uGate: { value: new THREE.Vector4() }, uOptics: { value: new THREE.Vector4() },
      uWear: { value: new THREE.Vector4() }, uTransport: { value: new THREE.Vector4() },
    });
    this.image = material(imageFragment, { ...viewUniforms(), uImage: { value: this.fallback }, uFit: { value: new THREE.Vector2(1, 1) }, uMirror: { value: 0 }, uRepeat: { value: 1 } });
    this.composite = material(compositeFragment, {
      uBelow: { value: this.accumA.texture }, uSource: { value: this.source.texture }, uMask: { value: this.fallback },
      uTranslation: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2(1, 1) },
      uScale: { value: 1 }, uRotation: { value: 0 }, uOpacity: { value: 1 }, uBlend: { value: 0 },
      uAspect: { value: 1 }, uMaskKind: { value: 0 }, uMaskSize: { value: 1 }, uMaskSoftness: { value: .1 },
      uPatternScale: { value: new THREE.Vector2(1, 1) }, uPatternTranslation: { value: new THREE.Vector2() },
      uPatternRotation: { value: 0 }, uPatternRepeat: { value: 0 },
      uSourceInView: {value:0},uSourceViewInverse:{value:new THREE.Matrix3()},
      uPatternRing: { value: new THREE.Vector4() }, uPatternBackground: { value: new THREE.Color() },
      uMaskInvert: { value: 0 }, uGlow: { value: 0 },
      ...Object.fromEntries(FINISH_PARAMETERS.map(d=>['u'+d.key[0].toUpperCase()+d.key.slice(1),{value:d.default}])),
      uSaturation: {value:1}, uHue: {value:0}, uExposure:{value:1},
      uColorMode:{value:0},uColorSteps:{value:6},uColorMix:{value:1},uColorOffset:{value:0},
      uGradePalette:{value:DEFAULT_PALETTE.map(hex=>new THREE.Color(hex))},
      uLoopPhase:{value:0},
    });
    this.finish = material(finishFragment, {
      uImage: { value: this.accumA.texture }, uBackground: { value: new THREE.Color(0) },
      uOpaque: { value: 0 }, uExactHighlights: { value: 0 }, toneMappingExposure: { value: 1 },
    });
    this.display = material(displayFragment, { uImage: { value: this.linearOutput.texture } });
    this.downsample = material(downsampleFragment, { uImage: { value: this.linearOutput.texture }, uSourceSize: { value: new THREE.Vector2(1, 1) }, uFactor: { value: 1 } });
    this.slit = material(slitFragment, {
      uAccum: { value: null }, uSource: { value: null }, uIndex: { value: 0 }, uCount: { value: 2 }, uSmooth: { value: 0 },
      uShape: { value: 0 }, uBlocks: { value: 8 }, uScroll: { value: 0 }, uAspect: { value: 1 }, uReverse: { value: 0 }, uSeed: { value: 0 },
    });
    this.feedback = material(feedbackFragment, {
      uSource: { value: null }, uPrevious: { value: null }, uAspect: { value: 1 }, uZoom: { value: 1 }, uRotate: { value: 0 },
      uFade: { value: 0 }, uHue: { value: 0 }, uWarp: { value: 0 }, uMode: { value: 0 }, uHole: { value: 0 }, uWindow: { value: 0 }, uDrift: { value: new THREE.Vector2() },
    });
    this.quad = new THREE.Mesh(this.quadGeometry, this.surface);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const room = new THREE.Scene();
    room.background = new THREE.Color('#545361');
    const cards: [number[], number[], string, number][] = [
      [[-4, 2, 3], [1.5, 5, .15], '#fff0df', 6],
      [[4, .5, -2], [1.1, 4, .15], '#c4dcff', 7],
      [[0, 5, 0], [3, .12, 2.5], '#f5edff', 3],
      [[1, -3, 2], [2.5, .15, 1.4], '#eac8d9', 1.8],
    ];
    for (const [position, size, color, intensity] of cards) {
      const card = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
      card.position.fromArray(position); card.lookAt(0, 0, 0); room.add(card);
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, .025);
    this.sculptureScene.environment = this.environment.texture;
    room.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); object.material.dispose(); } });
    pmrem.dispose();
    this.sculptureMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf2e8ee, metalness: .49, roughness: .3, clearcoat: .82, clearcoatRoughness: .16,
      iridescence: .85, sheen: .23, sheenRoughness: .45, envMapIntensity: .72,
      premultipliedAlpha: true,
    });
    const film = new Uint8Array(128 * 128 * 4);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const value = Math.round(255 * (.24 + .43*y/127 + .13*Math.sin(x/127*TAU+.6*Math.sin(y/127*4.))));
      film.set([value, value, value, 255], (y * 128 + x) * 4);
    }
    this.filmThickness = new THREE.DataTexture(film, 128, 128);
    this.filmThickness.minFilter = this.filmThickness.magFilter = THREE.LinearFilter;
    this.filmThickness.needsUpdate = true;
    this.sculptureMaterial.iridescenceThicknessMap = this.filmThickness;
    this.sculptureMaterial.iridescenceThicknessMinimum = 110;
    this.sculptureMaterial.iridescenceThicknessMaximum = 1050;
    this.sculptureMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.sculptureUniforms);
      shader.vertexShader = 'uniform mat3 uViewInverse;\nvarying vec3 studioSource;\n' + sculptureDeformation + '\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nobjectNormal = studioNormal(position);');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        'vec3 transformed = studioDeform(position);\nstudioSource = studioSourceCoordinates(position);');
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\nvec2 viewOffset=uViewInverse[0].xy+uViewInverse[1].xy+2.*uViewInverse[2].xy-vec2(1.);\ngl_Position.xy=mat2(uViewInverse)*gl_Position.xy+viewOffset*gl_Position.w;');
      shader.fragmentShader = sculptureDetail + '\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = studioDetailNormal(-vViewPosition, normal);');
    };
    this.sculptureMaterial.customProgramCacheKey = () => 'form-field-sculpture-v7-view';
    this.sculptureDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.sculptureDepthMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.sculptureUniforms);
      shader.vertexShader = sculptureDeformation + '\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = studioDeform(position);');
    };
    this.sculptureDepthMaterial.customProgramCacheKey = () => 'form-field-sculpture-depth-v6';
    this.sculpture = new THREE.Mesh(this.sculptureGeometry, this.sculptureMaterial);
    // Shader deformation moves vertices outside the original sphere bounds.
    this.sculpture.frustumCulled = false;
    this.sculpture.castShadow = true;
    this.sculpture.receiveShadow = true;
    this.sculpture.customDepthMaterial = this.sculptureDepthMaterial;
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    Object.assign(this.keyLight.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: .5, far: 12 });
    this.keyLight.shadow.camera.updateProjectionMatrix();
    this.keyLight.shadow.bias = -.00008;
    this.keyLight.shadow.normalBias = .007;
    this.sculptureScene.add(this.sculpture);
    this.sculptureScene.add(new THREE.HemisphereLight(0xe5e8ff, 0x32283c, .12));
    this.keyLight.position.set(4, 3, 4);
    this.rimLight.position.set(-3, 2, -3);
    this.fillLight.position.set(0, -1, 5);
    this.sculptureScene.add(this.keyLight, this.rimLight, this.fillLight);
    this.renderer.info.reset();
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('This renderer has been disposed.');
    if (this.renderer.getContext().isContextLost()) throw new Error('The GPU context was lost. Reload the renderer to resume the saved project.');
  }

  private assetKey(url: string, mask: boolean, repeat = false): string { return `${mask ? 'mask' : repeat ? 'repeat' : 'color'}:${url}`; }

  private loadAsset(url: string, mask: boolean, repeat = false): Asset {
    const key = this.assetKey(url, mask, repeat);
    const cached = this.assets.get(key);
    if (cached) return cached;
    const texture = new THREE.Texture();
    texture.colorSpace = mask ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    if(repeat) texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (this.disposed) { texture.dispose(); reject(new Error('Renderer closed while loading an image.')); return; }
        if (image.naturalWidth > this.renderer.capabilities.maxTextureSize || image.naturalHeight > this.renderer.capabilities.maxTextureSize) {
          reject(new Error('The imported image exceeds this GPU’s maximum texture size.')); return;
        }
        texture.image = image; texture.needsUpdate = true;
        resolve(texture);
      };
      image.onerror = () => reject(new Error('An imported image could not be decoded. Reimport the original PNG or JPEG.'));
      image.src = url;
    });
    const asset = { texture, promise };
    this.assets.set(key, asset);
    // Attach a rejection observer immediately; prepare() still propagates the error.
    void promise.catch(() => { if (this.assets.get(key) === asset) this.assets.delete(key); texture.dispose(); });
    return asset;
  }

  async prepare(project: Project): Promise<void> {
    this.assertUsable();
    const revision = ++this.prepareRevision;
    const required = new Set<string>();
    const pending: Promise<THREE.Texture>[] = [];
    for (const layer of project.layers) {
      if (layer.kind === 'image' && layer.image) {
        const repeat=layer.params.repeat>1;
        required.add(this.assetKey(layer.image.dataUrl, false, repeat));
        pending.push(this.loadAsset(layer.image.dataUrl, false, repeat).promise);
      }
      if (layer.mask.kind === 'image' && layer.mask.dataUrl) {
        required.add(this.assetKey(layer.mask.dataUrl, true));
        pending.push(this.loadAsset(layer.mask.dataUrl, true).promise);
      }
    }
    await Promise.all(pending);
    this.assertUsable();
    if (revision === this.prepareRevision) {
      this.instruments.prepare(project,(m,t)=>this.draw(m,t),layer=>layer.mask.dataUrl?this.assets.get(this.assetKey(layer.mask.dataUrl,true))?.texture.image as CanvasImageSource|undefined:undefined);
      for (const [key, asset] of this.assets) if (!required.has(key)) { asset.texture.dispose(); this.assets.delete(key); }
      if (!project.layers.some(layer => layer.kind === 'oil' && layer.visible)) this.releaseOilTargets();
      if (!project.layers.some(layer => layer.kind === 'graphic' && layer.visible)) {
        this.graphicSource?.dispose(); this.graphicSource = null;
      }
      if (!project.layers.some(layer => layer.kind === 'super8' && layer.visible)) {
        this.super8Source?.dispose(); this.super8Source = null;
      }
    }
  }

  private resize(width: number, height: number): void {
    const limit = this.maxTargetSize;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > limit || height > limit) {
      throw new Error(`Output dimensions must be positive whole pixels, no larger than ${limit} on this GPU.`);
    }
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    for (const rt of [this.source, this.accumA, this.accumB, this.linearOutput]) rt.setSize(width, height);
  }

  private draw(mat: THREE.ShaderMaterial, output: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(output);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  private releaseOilTargets(): void {
    this.oilData?.dispose(); this.oilUnderlay?.dispose();
    this.oilData = null; this.oilUnderlay = null;
    this.oilFields.uniforms.uFields.value = this.fallback;
    this.oilFields.uniforms.uUnderlay.value = this.fallback;
    this.oilFields.uniforms.uPattern.value = this.fallback;
    this.oilPattern?.release();
  }

  private drawOil(layer: Layer, original: Layer, phase: number): THREE.Texture {
    if (!this.oilData) {
      this.oilData = target();
      this.oilData.texture.colorSpace = THREE.NoColorSpace;
      this.oilUnderlay = target();
    }
    const data = this.oilData, underlay = this.oilUnderlay!;
    const u = this.oilFields.uniforms;
    const motion = oilMotion(original, phase);
    const draft = number(layer, 'quality', 1) < .5 ? .5 : 1;
    const fw = Math.max(1, Math.round(this.width * draft)), fh = Math.max(1, Math.round(this.height * draft));
    if (data.width !== fw || data.height !== fh) data.setSize(fw, fh);
    if (underlay.width !== this.width || underlay.height !== this.height) underlay.setSize(this.width, this.height);
    for (const [key, fallback] of Object.entries(OIL_DEFAULTS)) {
      u[`u${key[0].toUpperCase()}${key.slice(1)}`].value = number(layer, key, fallback);
    }
    u.uSeed.value = number(layer, 'seed', 0) % 1000003;
    const patternSeed = Math.round(number(layer, 'seed', 0)) % 1000003;
    u.uPattern.value = this.oilPattern.texture(patternSeed);
    (u.uPatternOffset.value as THREE.Vector2).set((patternSeed * .6180339887) % 1, (patternSeed * .7548776662) % 1);
    u.uAspect.value = this.width / this.height;
    (u.uSlide.value as THREE.Vector2).set(motion.slideX, motion.slideY);
    (u.uLens.value as THREE.Vector2).set(motion.x, motion.y);
    (u.uDirection.value as THREE.Vector2).set(motion.direction[0], motion.direction[1]);
    u.uSlideAngle.value = motion.rotation; u.uLensAngle.value = motion.angle;
    u.uLensShapePhase.value = motion.rotation + motion.slideX * 2. + motion.slideY;
    u.uPresence.value = motion.presence; u.uStrain.value = motion.strain;
    const wakes = u.uWake.value as THREE.Vector4[];
    motion.wake.forEach((sample, index) => wakes[index].set(sample[0], sample[1], sample[2], sample[3]));
    const palette = u.uPalette.value as THREE.Color[];
    for (let i = 0; i < 6; i++) palette[i].set(layer.palette[i]);
    (u.uResolution.value as THREE.Vector2).set(fw, fh);
    this.draw(this.oilFields, data);
    u.uFields.value = data.texture;
    this.draw(this.oilPaint, underlay);
    u.uUnderlay.value = underlay.texture;
    (u.uResolution.value as THREE.Vector2).set(this.width, this.height);
    // The raw fields are no longer needed after the underlay is shaded. Reuse
    // their full-resolution buffer for associated linear colour. The compositor
    // samples its numerical values directly, with no colour-space conversion.
    // Fullscreen Oil already filters its edges; a 4x MSAA resolve adds no detail.
    const output = draft === 1 ? data : this.source;
    this.draw(this.oilLens, output);
    return output.texture;
  }

  private drawSuper8(layer: Layer, original: Layer, phase: number, duration: number): void {
    const samples = super8History(original, phase, duration);
    const p = layer.params;
    const view=sourceViewMatrix(layer.transform,this.width/this.height);
    const inset=p.gateMode>.5?p.gateInset:0,rail=p.gateMode>1.5?.085:0;
    const gate=new THREE.Matrix3().set(1/(1-2*inset-rail),0,.5-(.5+rail*.5)/(1-2*inset-rail),
      0,1/(1-2*inset),.5-.5/(1-2*inset),0,0,1).multiply(view);
    setSourceView(this.super8.uniforms,gate,layer.transform.scale*(1-2*inset));
    const transport = super8Transport(phase, duration, original.params.filmFps, p.pullDown, p.shutter, p.shutterBlades, p.reelLoops);
    const previous = super8History(original, transport.previousPhase, duration);
    const u = this.super8.uniforms;
    u.uAspect.value = this.width / this.height;
    u.uSeed.value = number(layer, 'seed', 0) % 1_000_003;
    u.uMode.value = layer.params.mode; u.uSubstrate.value = layer.params.substrate;
    (u.uResolution.value as THREE.Vector2).set(this.width, this.height);
    (u.uFilm.value as THREE.Vector4).set(layer.params.scratches, layer.params.grain, layer.params.flicker, layer.params.weave);
    (u.uFeedback.value as THREE.Vector4).set(layer.params.feedback, layer.params.feedbackZoom, layer.params.feedbackRotation, samples[0].frame);
    (u.uTransport.value as THREE.Vector2).set(transport.pull, transport.roll);
    u.uDust.value = p.dust;
    (u.uRoll.value as THREE.Vector4).set(p.rollAmount ?? 0, p.rollBands ?? 28, p.rollOrigin ?? 1, p.rollSmear ?? 0);
    [...samples, ...previous].forEach(({ layer: sample, phase: samplePhase, frame }, index) => {
      const p = sample.params;
      (u.uShape.value as THREE.Vector4[])[index].set(p.scale, p.steps, p.coverage, p.erosion);
      (u.uPaint.value as THREE.Vector4[])[index].set(p.texture, p.textureScale, p.roughness, p.bleed);
      (u.uMotion.value as THREE.Vector4[])[index].set(p.travel, p.rotation, p.cycles, samplePhase);
      (u.uEmulsion.value as THREE.Vector2[])[index].set(p.emulsion, frame);
    });
    const colors = u.uPalette.value as THREE.Color[];
    for (let i = 0; i < 6; i++) colors[i].set(layer.palette[i] ?? DEFAULT_PALETTE[i]);
    if (!this.super8Source) this.super8Source = target(false);
    if (this.super8Source.width !== this.width || this.super8Source.height !== this.height) this.super8Source.setSize(this.width, this.height);
    this.draw(this.super8, this.super8Source);
    const lens = this.super8Projector.uniforms;
    (lens.uPaintViewInverse.value as THREE.Matrix3).copy(gate).invert();
    lens.uImage.value = this.super8Source.texture;
    lens.uAspect.value = this.width / this.height; lens.uSeed.value = u.uSeed.value;
    lens.uSubstrate.value = p.substrate;
    (lens.uResolution.value as THREE.Vector2).set(this.width, this.height);
    (lens.uGate.value as THREE.Vector4).set(p.gateMode, p.gateInset, p.gateRoundness, p.sprockets);
    (lens.uOptics.value as THREE.Vector4).set(p.lensSoftness, p.halation, p.vignette, p.colorFade);
    (lens.uWear.value as THREE.Vector4).set(p.hair, p.lightLeak, p.frameLines, p.weave);
    (lens.uTransport.value as THREE.Vector4).set(transport.pull, transport.roll, transport.light, transport.phase);
    this.draw(this.super8Projector, this.source);
  }

  private drawSource(layer: Layer, phase: number, original: Layer = layer, duration = 10): THREE.Texture {
    const aspect = this.width / this.height;
    const uniforms=layer.kind==='surface'?this.surface.uniforms:layer.kind==='fractal'?this.fractal.uniforms:
      layer.kind==='oil'?this.oilFields.uniforms:layer.kind==='super8'?this.super8Projector.uniforms:
      layer.kind==='image'?this.image.uniforms:layer.kind==='sculpture'?this.sculptureUniforms:null;
    if(uniforms)setSourceView(uniforms,sourceViewMatrix(layer.transform,aspect),layer.transform.scale);
    const cycles = Math.max(1, Math.round(number(layer, 'cycles', 1)));
    const localPhase = phase * cycles;
    if (isInstrument(layer.kind)) {
      this.instruments.draw(layer,phase,this.width,this.height,this.source,(m,t)=>this.draw(m,t),this.renderer,Math.max(0,Math.min(1,phase/TAU))*duration,duration);
    } else if (layer.kind === 'graphic') {
      if (!this.graphicSource) {
        this.graphicSource = target(true);
        this.graphicSource.samples = this.source.samples;
        this.graphicSource.texture.wrapS = this.graphicSource.texture.wrapT = THREE.RepeatWrapping;
        this.graphicSource.texture.generateMipmaps = true;
        this.graphicSource.texture.minFilter = THREE.LinearMipmapLinearFilter;
      }
      const plan=graphicRenderPlan(layer,phase,this.width,this.height,this.maxTargetSize);
      if (this.graphicSource.width !== plan.width || this.graphicSource.height !== plan.height) this.graphicSource.setSize(plan.width,plan.height);
      this.graphics.draw(this.renderer,this.graphicSource,layer,phase,plan.width,plan.height,plan.inView);
      return this.graphicSource.texture;
    } else if (layer.kind === 'super8') {
      this.drawSuper8(layer, original, phase, duration);
    } else if (layer.kind === 'oil') {
      return this.drawOil(layer, original, phase);
    } else if (layer.kind === 'surface') {
      const u = this.surface.uniforms;
      (u.uResolution.value as THREE.Vector2).set(this.width,this.height);
      u.uAspect.value = aspect; u.uPhase.value = localPhase;
      u.uSeed.value = number(layer, 'seed', 0) % 1_000_003;
      for (const [key, fallback] of Object.entries(SURFACE_DEFAULTS)) {
        u[`u${key[0].toUpperCase()}${key.slice(1)}`].value = number(layer, key, fallback);
      }
      const colors = u.uPalette.value as THREE.Color[];
      for (let i = 0; i < 6; i++) colors[i].set(layer.palette[i] ?? DEFAULT_PALETTE[i]);
      this.draw(this.surface, this.source);
    } else if (layer.kind === 'fractal') {
      const u = this.fractal.uniforms;
      u.uAspect.value = aspect; u.uPhase.value = localPhase;
      u.uSeed.value = number(layer, 'seed', 0) % 1_000_003;
      (u.uResolution.value as THREE.Vector2).set(this.width, this.height);
      for (const [key, fallback] of Object.entries(FRACTAL_DEFAULTS)) {
        u[`u${key[0].toUpperCase()}${key.slice(1)}`].value = number(layer, key, fallback);
      }
      if(number(layer,'colorMode',0)>0&&number(layer,'colorMix',1)>0)u.uExposure.value=1;
      // The live preview takes one fractal sample per pixel; Retina density
      // already oversamples it. Exports keep the chosen Render quality.
      if (!this.exporting) u.uQuality.value = 0;
      const colors = u.uPalette.value as THREE.Color[];
      for (let i = 0; i < 6; i++) colors[i].set(layer.palette[i] ?? DEFAULT_PALETTE[i]);
      if (!this.exporting && Math.round(number(layer, 'style', 0)) === 2) {
        // The ray-marched Mandelbox is the costliest source. The live preview
        // traces half as many pixels and scales them up; exports trace every pixel.
        const pw = Math.max(1, Math.round(this.width / 2)), ph = Math.max(1, Math.round(this.height / 2));
        if (this.fractalPreview.width !== pw || this.fractalPreview.height !== ph) this.fractalPreview.setSize(pw, ph);
        // uResolution stays at full size so the surface keeps the same level of detail as the export.
        this.draw(this.fractal, this.fractalPreview);
        this.copy.uniforms.uImage.value = this.fractalPreview.texture;
        this.draw(this.copy, this.source);
      } else this.draw(this.fractal, this.source);
    } else if (layer.kind === 'image') {
      if (!layer.image) { this.renderer.setRenderTarget(this.source); this.renderer.clear(); return this.source.texture; }
      const asset = this.assets.get(this.assetKey(layer.image.dataUrl, false,layer.params.repeat>1));
      if (!asset?.texture.image) throw new Error('The image is still loading. Wait for preparation before rendering.');
      this.image.uniforms.uImage.value = asset.texture;
      this.image.uniforms.uMirror.value = number(layer,'mirror',0);
      this.image.uniforms.uRepeat.value = number(layer,'repeat',1);
      const imageAspect = layer.image.width / layer.image.height;
      let x = 1, y = 1;
      if (layer.image.fit === 'contain') {
        if (imageAspect > aspect) y = aspect / imageAspect; else x = imageAspect / aspect;
      } else {
        if (imageAspect > aspect) x = imageAspect / aspect; else y = aspect / imageAspect;
      }
      (this.image.uniforms.uFit.value as THREE.Vector2).set(x, y);
      this.draw(this.image, this.source);
    } else {
      const u = this.sculptureUniforms;
      for(const [key,value] of Object.entries(SCULPTURE_SHAPE_DEFAULTS))u[`studio${key[0].toUpperCase()}${key.slice(1)}`].value=number(layer,key,value);
      this.sculpture.geometry=number(layer,'form',0)>=2?this.sculptureTorusGeometry:this.sculptureGeometry;
      u.studioPhase.value = localPhase;
      u.studioFold.value = number(layer, 'fold', .6); u.studioRidges.value = number(layer, 'ridges', .5);
      u.studioOpening.value = number(layer, 'opening', .55); u.studioTwist.value = number(layer, 'twist', .3);
      u.studioBreath.value = number(layer, 'breath', .25); u.studioSeed.value = number(layer, 'seed', 1) % 1_000_003;
      this.sculptureMaterial.color.set(layer.palette[0] ?? '#f6dfef').lerp(new THREE.Color('#ffffff'), .10).multiplyScalar(.58);
      this.sculptureMaterial.sheenColor.set(layer.palette[2] ?? '#bdb7eb');
      this.sculptureMaterial.roughness = number(layer, 'roughness', .3);
      this.sculptureMaterial.metalness = THREE.MathUtils.lerp(Math.max(0,.48-this.sculptureMaterial.roughness*.55),1,number(layer,'metallic',0));
      this.sculptureMaterial.clearcoat=number(layer,'clearcoat',.82);
      this.sculptureMaterial.sheen=number(layer,'sheen',.23);
      const film=number(layer,'filmScale',1);
      this.sculptureMaterial.iridescenceThicknessMinimum=110*film;
      this.sculptureMaterial.iridescenceThicknessMaximum=1050*film;
      const power=number(layer,'lightPower',1);
      this.keyLight.intensity=2.8*power;this.rimLight.intensity=2.4*power;this.fillLight.intensity=1.35*power;
      this.sculptureMaterial.envMapIntensity=.72*power;
      this.keyLight.shadow.intensity=number(layer,'shadowStrength',1);
      this.keyLight.shadow.radius=1+11*number(layer,'shadowSoftness',0);
      const extent=2.2*Math.max(1,number(layer,'stretch',1))+.4*number(layer,'asymmetry',0);
      const shadowCamera=this.keyLight.shadow.camera;
      if(shadowCamera.right!==extent){Object.assign(shadowCamera,{left:-extent,right:extent,top:extent,bottom:-extent});shadowCamera.updateProjectionMatrix();}
      this.sculptureMaterial.iridescence = number(layer, 'iridescence', .85);
      const breath = number(layer, 'breath', .25);
      this.sculpture.rotation.set(breath * .12 * Math.sin(localPhase), breath * .3 * Math.sin(localPhase), -.1 + breath * .08 * Math.sin(localPhase + .6));
      const yaw = number(layer, 'cameraYaw', 0);
      const pitch = number(layer, 'cameraPitch', .2);
      const distance = 4.4 / Math.max(.2, number(layer, 'zoom', 1));
      this.sculptureCamera.aspect = aspect;
      this.sculptureCamera.position.set(Math.sin(yaw) * Math.cos(pitch) * distance,
        Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance);
      this.sculptureCamera.lookAt(0, 0, 0); this.sculptureCamera.updateProjectionMatrix();
      const light = number(layer, 'lightAngle', .5) + .65;
      this.sculptureScene.environmentRotation.y = light * .35;
      this.keyLight.position.set(Math.sin(light) * 4.5, 2.8, Math.cos(light) * 4.5);
      this.renderer.setRenderTarget(this.source);
      this.renderer.render(this.sculptureScene, this.sculptureCamera);
    }
    return this.source.texture;
  }

  private renderFrame(project: Project, phase: number, width: number, height: number): void {
    this.assertUsable();
    if (!Number.isFinite(phase)) throw new Error('Frame phase must be finite.');
    if (project.layers.length > 4) throw new Error('This version supports at most four composition layers.');
    this.resize(width, height);
    this.renderer.info.reset();
    this.renderer.setClearColor(0, 0);
    this.renderer.setRenderTarget(this.accumA); this.renderer.clear();
    let below = this.accumA, next = this.accumB;
    const wrapped = ((phase % TAU) + TAU) % TAU;
    const duration = frameCount(project) * project.fps.den / project.fps.num;
    const total = frameCount(project);
    this.releaseFeedback(project);
    for (const original of project.layers) {
      if (!original.visible) continue;
      // Feedback layers advance in whole loop frames: every frame of the
      // history is a real step of the process, in preview and export alike.
      const feedback = feedbackActive(original);
      const framePhase = feedback ? phaseAtFrame(frameAtPhase(wrapped, total), total) : wrapped;
      const sourcePhase = this.sourcePhase(original, framePhase, duration);
      const layer = evaluateLayer(original, sourcePhase);
      if (layer.opacity <= 0) continue;
      const sourceTexture = feedback ? this.feedbackSource(original, framePhase, total, duration)
        : slitActive(original) ? this.slitSource(original, wrapped, total, duration)
        : this.drawSource(layer, finiteEvolving(original) ? Math.max(0,Math.min(TAU,phase)) : original.kind === 'super8' ? wrapped : sourcePhase, original, duration);
      const u = this.composite.uniforms;
      u.uBelow.value = below.texture; u.uSource.value = sourceTexture;
      (u.uTranslation.value as THREE.Vector2).set(layer.transform.x, -layer.transform.y);
      (u.uTexel.value as THREE.Vector2).set(1 / width, 1 / height);
      u.uAspect.value = width / height; u.uScale.value = layer.transform.scale;
      u.uRotation.value = layer.transform.rotation; u.uOpacity.value = layer.opacity;
      u.uPatternRepeat.value = layer.kind === 'graphic' ? (graphicRenderPlan(layer,sourcePhase,width,height,this.maxTargetSize).inView ? 2 : 1) : 0;
      u.uSourceInView.value=Number(layer.kind!=='graphic');
      (u.uSourceViewInverse.value as THREE.Matrix3).copy(sourceViewMatrix(layer.transform,width/height)).invert();
      (u.uPatternRing.value as THREE.Vector4).set(layer.params.innerRadius ?? 0,layer.params.ringWidth ?? 0,layer.params.backgroundOpacity ?? 0,Number(layer.kind==='graphic'&&layer.params.style===4&&layer.params.variant===3));
      (u.uPatternBackground.value as THREE.Color).set(layer.palette[5]);
      if (layer.kind === 'graphic') {
        (u.uPatternScale.value as THREE.Vector2).set(layer.params.size * layer.params.stretch, layer.params.size);
        (u.uPatternTranslation.value as THREE.Vector2).set(layer.params.centerX * .5, layer.params.centerY * .5);
        u.uPatternRotation.value = layer.params.orientation + (layer.params.style === 4 ? 0 : layer.params.turns * wrapped);
      }
      u.uBlend.value = { normal: 0, screen: 1, multiply: 2, add: 3 }[layer.blend];
      u.uMaskKind.value = layer.surface?.source==='mask'&&!layer.surface.clipMask?0:{ none: 0, circle: 1, rectangle: 2, image: 3 }[layer.mask.kind];
      u.uMaskSize.value = layer.mask.size; u.uMaskSoftness.value = layer.mask.softness;
      u.uMaskInvert.value = Number(layer.mask.invert);
      u.uGlow.value = number(layer, 'glow', layer.kind === 'sculpture' ? .12 : 0);
      for(const d of FINISH_PARAMETERS)u['u'+d.key[0].toUpperCase()+d.key.slice(1)].value=number(layer,d.key,d.default);
      u.uSaturation.value=number(layer,'saturation',1);u.uHue.value=number(layer,'hue',0);
      // Original Fractal exposure stays in its original source pass; new colour
      // modes expose the recoloured result once, here with the shared grading.
      u.uExposure.value=layer.kind==='fractal'&&(number(layer,'colorMode',0)===0||number(layer,'colorMix',1)===0)?1:number(layer,'exposure',1);
      u.uColorMode.value=layer.kind==='fractal'&&number(layer,'colorMix',1)>0?number(layer,'colorMode',0):0;
      u.uColorSteps.value=number(layer,'colorSteps',6);u.uColorMix.value=number(layer,'colorMix',1);
      u.uColorOffset.value=number(layer,'offset',0);
      u.uLoopPhase.value=wrapped;
      const gradeColors=u.uGradePalette.value as THREE.Color[];
      for(let i=0;i<6;i++)gradeColors[i].set(layer.palette[i]??DEFAULT_PALETTE[i]);
      u.uMask.value = this.fallback;
      if (layer.mask.kind === 'image' && layer.mask.dataUrl) {
        const asset = this.assets.get(this.assetKey(layer.mask.dataUrl, true));
        if (!asset?.texture.image) throw new Error('The mask is still loading.');
        u.uMask.value = asset.texture;
      }
      this.draw(this.composite, next);
      [below, next] = [next, below];
    }
    this.finish.uniforms.uImage.value = below.texture;
    (this.finish.uniforms.uBackground.value as THREE.Color).set(project.background);
    this.finish.uniforms.uOpaque.value = project.transparent ? 0 : 1;
    this.finish.uniforms.uExactHighlights.value = project.highlights === 'exact' ? 1 : 0;
    this.draw(this.finish, this.linearOutput);
  }

  private sourcePhase(original: Layer, wrapped: number, duration: number): number {
    return original.kind === 'super8' ? super8Clock(wrapped, duration, original.params.filmFps).phase : wrapped;
  }

  /** The layer's own source at a loop phase, with its animation evaluated there. */
  private plainSource(original: Layer, phase: number, duration: number): THREE.Texture {
    const sourcePhase = this.sourcePhase(original, phase, duration);
    return this.drawSource(evaluateLayer(original, sourcePhase), original.kind === 'super8' ? phase : sourcePhase, original, duration);
  }

  /**
   * Time displacement: the source at evenly spaced earlier phases, stitched by
   * the delay map. Each slice is a fresh evaluation of the looping source, so
   * there is no history to keep and the loop closes exactly.
   */
  private slitSource(original: Layer, phase: number, total: number, duration: number): THREE.Texture {
    const layer = evaluateLayer(original, phase), p = layer.params;
    if (!this.slitTargets) this.slitTargets = [target(), target()];
    for (const rt of this.slitTargets) if (rt.width !== this.width || rt.height !== this.height) rt.setSize(this.width, this.height);
    let [accum, next] = this.slitTargets;
    this.clearTarget(accum);
    const delays = sliceDelays(layer), u = this.slit.uniforms;
    u.uCount.value = delays.length; u.uSmooth.value = p.slitSmooth ?? 0;
    u.uShape.value = p.slitShape ?? 0; u.uBlocks.value = p.slitBlocks ?? 8;
    u.uScroll.value = (((p.slitScroll ?? 0) * phase / TAU) % 1 + 1) % 1;
    u.uAspect.value = this.width / this.height; u.uReverse.value = Number((p.slitShift ?? 0) < 0);
    u.uSeed.value = (p.seed ?? 0) % 1000;
    delays.forEach((delay, index) => {
      const earlier = ((phase - delay * TAU / total) % TAU + TAU) % TAU;
      u.uSource.value = this.plainSource(original, earlier, duration);
      u.uAccum.value = accum.texture; u.uIndex.value = index;
      this.draw(this.slit, next);
      [accum, next] = [next, accum];
    });
    this.slitTargets = [accum, next];
    return accum.texture;
  }

  /** One feedback step: the source at `phase` over the faded, transformed echo in `from`. */
  private feedbackStep(original: Layer, phase: number, total: number, duration: number, from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget): void {
    const layer = evaluateLayer(original, this.sourcePhase(original, phase, duration));
    const source = slitActive(original) ? this.slitSource(original, phase, total, duration) : this.plainSource(original, phase, duration);
    const p = layer.params, u = this.feedback.uniforms;
    u.uSource.value = source; u.uPrevious.value = from.texture;
    u.uAspect.value = this.width / this.height;
    u.uZoom.value = p.echoZoom ?? 1;
    u.uRotate.value = (p.echoRotate ?? 0) * Math.PI / 180;
    (u.uDrift.value as THREE.Vector2).set(p.echoDriftX ?? 0, p.echoDriftY ?? 0);
    u.uFade.value = persistence(layer);
    u.uHue.value = (p.echoHue ?? 0) * Math.PI / 180;
    u.uWarp.value = p.echoMelt ?? 0;
    u.uMode.value = p.echoBlend ?? 0;
    u.uHole.value = p.echoFrame ?? 0;
    u.uWindow.value = p.echoWindow ?? 0;
    this.draw(this.feedback, to);
  }

  private clearTarget(rt: THREE.WebGLRenderTarget): void {
    this.renderer.setRenderTarget(rt); this.renderer.setClearColor(0, 0); this.renderer.clear();
  }

  /** Advances `current` through loop frames first..last, one step each. */
  private feedbackRun(original: Layer, state: FeedbackState, first: number, last: number, total: number, duration: number): void {
    for (let k = first; k <= last; k++) {
      this.feedbackStep(original, phaseAtFrame(((k % total) + total) % total, total), total, duration, state.current, state.next);
      [state.current, state.next] = [state.next, state.current];
      state.previousValid = true;
    }
  }

  /**
   * The layer's feedback output at loop frame `phase`.
   *
   * Exports: consecutive frames cost one step; anything else, or a history not
   * built in full with these settings, warms up from black until the missing
   * history is below half-float precision.
   *
   * Preview: edits work like a live feedback rig. They apply from the next
   * step and older echoes age out, so a slider drag costs one step per frame.
   * While paused, the current frame is recomputed in one step from the stored
   * previous frame, and the exact history is rebuilt a few steps per frame in
   * the background (see needsRefresh), then swapped in.
   */
  private feedbackSource(original: Layer, phase: number, total: number, duration: number): THREE.Texture {
    const frame = frameAtPhase(phase, total);
    const structure = `${total}:${this.width}x${this.height}`;
    const key = layerKey(original);
    let state = this.feedbackStates.get(original.id);
    if (!state) {
      // An empty structure makes the check below size the new targets.
      state = { structure: '', key, frame: -1, current: target(), next: target(), previousValid: false, exact: false, settle: null, spare: null };
      this.feedbackStates.set(original.id, state);
    }
    if (state.structure !== structure) {
      state.structure = structure; state.frame = -1; state.previousValid = false; state.exact = false; state.settle = null;
      for (const rt of [state.current, state.next, ...(state.spare ?? [])]) rt.setSize(this.width, this.height);
    }
    // Animated feedback needs the longest memory it reaches during the loop.
    let fade = 0;
    for (let k = 0; k < 16; k++) fade = Math.max(fade, persistence(evaluateLayer(original, k * TAU / 16)));
    const full = warmupFrames(fade);
    // Preview budgets count source renders, so time-sliced sources warm up and
    // settle in fewer, costlier steps at a steady frame rate.
    const cost = stepCost(original), previewWarmup = Math.min(full, Math.max(6, Math.floor(PREVIEW_WARMUP / cost)));
    const changed = key !== state.key;
    const distance = state.frame < 0 ? Infinity : (frame - state.frame + total) % total;
    const warmUp = (frames: number) => {
      this.clearTarget(state.current);
      this.feedbackRun(original, state, frame - frames, frame, total, duration);
      state.exact = frames >= full;
    };

    if (this.exactFeedback) {
      state.settle = null;
      if (!changed && state.exact && distance === 0) return state.current.texture;
      if (!changed && state.exact && distance === 1) this.feedbackRun(original, state, frame, frame, total, duration);
      else warmUp(full);
    } else if (distance === 0 && !changed) {
      // Nothing new: only continue a background settle.
    } else if (distance === 0) {
      if (state.previousValid) {
        this.feedbackStep(original, phaseAtFrame(frame, total), total, duration, state.next, state.current);
        state.exact = false;
      } else warmUp(previewWarmup);
      this.startSettle(state, key, frame, full);
    } else if (distance <= PREVIEW_STEP_LIMIT) {
      this.feedbackRun(original, state, frame - distance + 1, frame, total, duration);
      if (changed) state.exact = false;
      state.settle = null;
    } else {
      warmUp(previewWarmup);
      if (!state.exact) this.startSettle(state, key, frame, full);
    }
    state.key = key; state.frame = frame;
    this.advanceSettle(original, state, key, frame, total, duration);
    return state.current.texture;
  }

  private startSettle(state: FeedbackState, key: string, frame: number, full: number): void {
    if (!state.spare) state.spare = [target(), target()];
    const [a, b] = state.spare;
    for (const rt of [a, b]) if (rt.width !== this.width || rt.height !== this.height) rt.setSize(this.width, this.height);
    this.clearTarget(a);
    state.settle = { key, frame, step: frame - full, a, b };
  }

  private advanceSettle(original: Layer, state: FeedbackState, key: string, frame: number, total: number, duration: number): void {
    const settle = state.settle;
    if (!settle) return;
    if (settle.key !== key || settle.frame !== frame) { state.settle = null; return; }
    const chunk = Math.max(1, Math.floor(SETTLE_CHUNK / stepCost(original)));
    for (let i = 0; i < chunk && settle.step <= frame; i++, settle.step++) {
      this.feedbackStep(original, phaseAtFrame(((settle.step % total) + total) % total, total), total, duration, settle.a, settle.b);
      [settle.a, settle.b] = [settle.b, settle.a];
    }
    if (settle.step <= frame) return;
    // Settled: `a` holds this frame and `b` the one before. Swap them in and
    // keep the old history's targets for the next settle.
    state.spare = [state.current, state.next];
    state.current = settle.a; state.next = settle.b;
    state.previousValid = true; state.exact = true; state.settle = null;
  }

  /** True while a paused preview is still refining a feedback history. */
  needsRefresh(): boolean {
    for (const state of this.feedbackStates.values()) if (state.settle) return true;
    return false;
  }

  private disposeFeedback(state: FeedbackState): void {
    for (const rt of [state.current, state.next, ...(state.spare ?? [])]) rt.dispose();
  }

  private releaseFeedback(project: Project): void {
    for (const [id, state] of this.feedbackStates) {
      if (project.layers.some(layer => layer.id === id && layer.visible && feedbackActive(layer))) continue;
      this.disposeFeedback(state); this.feedbackStates.delete(id);
    }
  }

  render(project: Project, phase: number, width?: number, height?: number): void {
    if (this.exporting) return;
    const w = width ?? Math.max(1, Math.round(this.canvas.clientWidth || this.canvas.width || 960));
    const h = height ?? Math.max(1, Math.round(this.canvas.clientHeight || this.canvas.height || 540));
    this.renderFrame(project, phase, w, h);
    this.renderer.setSize(w, h, false);
    this.display.uniforms.uImage.value = this.linearOutput.texture;
    this.draw(this.display, null);
  }

  /**
   * Renders a finished frame at delivery size. With supersample > 1 the whole
   * composition is rendered at that integer multiple and resolved with a
   * Mitchell filter, which removes shader-edge aliasing and moiré that MSAA
   * cannot reach. Returns the delivery-size, straight-alpha linear target.
   */
  private renderOutput(project: Project, phase: number, width: number, height: number, supersample = 1): THREE.WebGLRenderTarget {
    if (![1, 2, 3].includes(supersample)) throw new Error('Supersampling must be 1×, 2× or 3×.');
    if (supersample === 1) { this.renderFrame(project, phase, width, height); return this.linearOutput; }
    const sourceWidth = width * supersample, sourceHeight = height * supersample;
    if (sourceWidth > this.maxTargetSize || sourceHeight > this.maxTargetSize) {
      throw new Error(`${supersample}× supersampling needs ${sourceWidth} × ${sourceHeight} pixels; this GPU allows ${this.maxTargetSize}. Choose a lower factor.`);
    }
    this.renderFrame(project, phase, sourceWidth, sourceHeight);
    if (this.resolved.width !== width || this.resolved.height !== height) this.resolved.setSize(width, height);
    const u = this.downsample.uniforms;
    u.uImage.value = this.linearOutput.texture;
    (u.uSourceSize.value as THREE.Vector2).set(sourceWidth, sourceHeight);
    u.uFactor.value = supersample;
    this.draw(this.downsample, this.resolved);
    return this.resolved;
  }

  async exportEXR(project: Project, phase: number, width: number, height: number, supersample = 1): Promise<Uint8Array> {
    if (this.exporting) throw new Error('Wait for the current frame export before requesting another.');
    this.exporting = true;
    try {
      await this.prepare(project);
      this.exactFeedback = true;
      const output = this.renderOutput(project, phase, width, height, supersample);
      return await new EXRExporter().parse(this.renderer, output, {
        type: THREE.HalfFloatType, compression: ZIP_COMPRESSION,
      });
    } finally { this.renderer.setRenderTarget(null); this.exporting = false; this.exactFeedback = false; }
  }

  async exportPNG(project: Project, phase: number, width: number, height: number, supersample = 1): Promise<Uint8Array> {
    if (this.exporting) throw new Error('Wait for the current frame export before requesting another.');
    this.exporting = true;
    try {
      await this.prepare(project);
      this.exactFeedback = true;
      const output = this.renderOutput(project, phase, width, height, supersample);
      if (this.byteOutput.width !== width || this.byteOutput.height !== height) this.byteOutput.setSize(width, height);
      this.display.uniforms.uImage.value = output.texture;
      this.draw(this.display, this.byteOutput);
      this.display.uniforms.uImage.value = this.linearOutput.texture;
      const pixels = new Uint8Array(width * height * 4);
      await this.renderer.readRenderTargetPixelsAsync(this.byteOutput, 0, 0, width, height, pixels);
      return await encodePNG(pixels, width, height);
    } finally { this.renderer.setRenderTarget(null); this.exporting = false; this.exactFeedback = false; }
  }

  getStats(): { drawCalls: number; triangles: number; textures: number } {
    return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
      textures: this.renderer.info.memory.textures };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const asset of this.assets.values()) asset.texture.dispose();
    this.assets.clear();
    for (const rt of [this.source, this.fractalPreview, this.accumA, this.accumB, this.linearOutput, this.byteOutput, this.resolved, this.environment]) rt.dispose();
    this.releaseOilTargets();
    this.graphicSource?.dispose(); this.graphicSource = null;
    this.super8Source?.dispose(); this.super8Source = null;
    for (const state of this.feedbackStates.values()) this.disposeFeedback(state);
    this.slitTargets?.forEach(rt => rt.dispose()); this.slitTargets = null;
    this.feedbackStates.clear();
    this.graphics.dispose(); this.instruments.dispose();
    for (const mat of [this.super8, this.super8Projector, this.oilFields, this.oilPaint, this.oilLens, this.surface, this.fractal, this.copy, this.image, this.composite, this.finish, this.display, this.downsample, this.feedback, this.slit, this.sculptureMaterial, this.sculptureDepthMaterial]) mat.dispose();
    this.oilPattern.dispose();
    this.sculptureGeometry.dispose(); this.sculptureTorusGeometry.dispose(); this.quadGeometry.dispose(); this.fallback.dispose(); this.filmThickness.dispose();
    this.keyLight.shadow.dispose();
    this.renderer.dispose();
  }
}
