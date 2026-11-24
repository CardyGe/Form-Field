import { EmberSmokeAudio, usesEmberSmokeAudio, type SmokeAudioFrame } from '../react/ember-smoke';
import type { Signals } from '../react/signals';
import {FINISH_PARAMETERS} from '../core/finishing';
import { InstrumentRenderer } from './InstrumentRenderer';
import { isInstrument } from '../core/instruments';
import * as THREE from 'three';
import { GraphicRenderer } from './GraphicRenderer';
import { graphicRenderPlan } from './graphic-view';
import { imageFit, sourceViewMatrix } from './source-view';
import { EXRExporter, ZIP_COMPRESSION } from 'three/addons/exporters/EXRExporter.js';
import { evaluateLayer, frameCount, phaseAtFrame } from '../core/timeline';
import { echoFade, echoSettings, feedbackActive, feedbackFragment, frameAtPhase, historyFrames } from './feedback';
import { channelSliceCounts, echoWeights, previewSliceScale, slicePhase, sliceWarpScale, slitActive, slitFragment, sliceDelays, sliceSourceRenders } from './slitscan';
import { TIME_ECHO, TIME_MEDIAN, medianFramePlan, type MedianPlan, timeGatherFragment, timeMedianFragment, timeMode, timeTargetNeeds } from './time-stats';
import { parameterDefinitions } from '../core/project';
import type { Layer, Project } from '../shared/types';
import { encodePNG } from './png';
import { fractalFragment } from './fractal';
import { oilFieldsFragment, oilPaintFragment, oilLensFragment } from './oil';
import { oilMotion, OIL_WAKE_SAMPLES } from './oil-motion';
import { OilPatternBaker } from './oil-pattern';
import { liquidFragment } from './liquid';
import { ScopeRenderer } from './ScopeRenderer';
import { SmokeCloudRenderer } from './SmokeCloud';
import { compositesPlainly, plainOverFragment } from './smoke-cloud-composite';
import { printActive, printUniforms } from './print-screen';
import { BLOOM_HEIGHTS, BloomPyramid, StreakBlur, bloomChannelWeights, glowActive, glowBrightFragment, lightTarget, setWrap } from './bloom';
import { gradientStops, lensActive, lensFragment, safeMidpoint, spectralWeights, whiteBalance } from './colour-lens';
import { layerWarpView, warpActive, warpFragment, warpPicture, warpPoints } from './warp';
import { SURFACE_DEFAULTS, snapQuarterTurn, tileBlockers, tilePeriod } from '../core/tile-edges';
import { packDroplets, liquidPackKey, LIQUID_BINS, LIQUID_SLOTS } from './liquid-pack';
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
const SCULPTURE_SHAPE_DEFAULTS = Object.fromEntries(parameterDefinitions('sculpture')
  .filter(({ key }) => ['form','lobes','thickness','stretch','curl','foldFrequency','asymmetry','ridgeScale'].includes(key))
  .map(({ key, default: value }) => [key,value]));
const FRACTAL_DEFAULTS = Object.fromEntries(parameterDefinitions('fractal')
  .filter(({ key }) => !['cycles','saturation','hue','colorMode','colorSteps','colorMix'].includes(key)).map(({ key, default: value }) => [key, value]));
const LIQUID_UNIFORMS = ['scale','drift','warp','breathing','shimmer','thickness','outline','backgroundOpacity','crowding','dimple','rim','floaters','farLayer','farBlur','refraction','wash','vein','merge','press','pressRadius','pressPulse','pressX','pressY','vignette','focus','fringe','grain'];
const LIQUID_DEFAULTS = Object.fromEntries(parameterDefinitions('liquid').filter(({ key }) => LIQUID_UNIFORMS.includes(key)).map(({ key, default: value }) => [key, value]));
/** Baked droplet layouts kept ready; switching between a few looks does not rebuild them. */
const LIQUID_LAYOUTS = 4;
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
const stepCost = (layer: Layer) => slitActive(layer) ? sliceSourceRenders(layer) : 1;
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

/** Chromatic Field with the periodic TILE branch; see surface.ts. */
function tiledSurfaceMaterial(): THREE.ShaderMaterial {
  const result = material(surfaceFragment, { ...surfaceUniforms(), uTile: { value: new THREE.Vector2() } });
  result.defines = { TILE: '' };
  return result;
}

function surfaceUniforms(): Uniforms {
  return {
    ...viewUniforms(),
    uPalette: { value: DEFAULT_PALETTE.map((hex) => new THREE.Color(hex)) },
    uAspect: { value: 1 }, uPhase: { value: 0 }, uSeed: { value: 0 },
    uResolution:{value:new THREE.Vector2(1,1)},
    ...Object.fromEntries(Object.entries(SURFACE_DEFAULTS).map(([key,value])=>[`u${key[0].toUpperCase()}${key.slice(1)}`,{value}])),
  };
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
  private emberAudio?: EmberSmokeAudio;
  /** Reused by render() to read the canvas size without allocating. */
  private readonly canvasSize = new THREE.Vector2();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly maxTargetSize: number;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private source = target(true);
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
  /** Chromatic Field compiled with TILE, built on the first tiled frame. */
  private tiledSurface: THREE.ShaderMaterial | null = null;
  /** Tile edges for this frame: the project asks for it and every visible layer can tile. */
  private tiling = false;
  private readonly fractal: THREE.ShaderMaterial;
  private readonly image: THREE.ShaderMaterial;
  private readonly super8: THREE.ShaderMaterial;
  private readonly super8Projector: THREE.ShaderMaterial;
  private super8Source: THREE.WebGLRenderTarget | null = null;
  private graphicSource: THREE.WebGLRenderTarget | null = null;
  private readonly liquid: THREE.ShaderMaterial;
  private readonly liquidLayouts = new Map<string, THREE.DataTexture>();
  private scope: ScopeRenderer | null = null;
  private smokeClouds: SmokeCloudRenderer | null = null;
  private plainOver: THREE.ShaderMaterial | null = null;
  /** For checks: draws every layer through the full compositor. */
  fullCompositorOnly = false;
  private previewPlaying = true;
  /** Reduced-size stand-ins for `source` while the preview draws time slices. */
  private sliceSource: THREE.WebGLRenderTarget | null = null;
  private sliceSourceSmooth: THREE.WebGLRenderTarget | null = null;
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
  /** The slit shader in its MAX-blended form: the brightest straight colour among the slices. */
  private readonly slitBound: THREE.ShaderMaterial;
  /** The slit shader in its additive form: the change Colour lag makes to red and blue. */
  private readonly slitLag: THREE.ShaderMaterial;
  /** Half the slice size, for the Brightness map. Allocated on first use. */
  private slitDriverTarget: THREE.WebGLRenderTarget | null = null;
  /** Slice size, for Colour lag. Allocated on first use. */
  private slitBoundTarget: THREE.WebGLRenderTarget | null = null;
  private slitLagTarget: THREE.WebGLRenderTarget | null = null;
  /** Echo, Darkest and Brightest: combines the slices over the slit targets. */
  private readonly timeGather: THREE.ShaderMaterial;
  /** The gather shader in its MAX-blended form: the brightest straight colour each channel combined. */
  private readonly timeBound: THREE.ShaderMaterial;
  /** The gather shader's light with no coverage: added for Echo, MAX-blended otherwise. */
  private readonly timeLight: THREE.ShaderMaterial;
  private readonly timeMedian: THREE.ShaderMaterial;
  /** Allocated only while channels remember different numbers of slices. */
  private statBoundTarget: THREE.WebGLRenderTarget | null = null;
  private statLightTarget: THREE.WebGLRenderTarget | null = null;
  /** The Median slices. Allocated on first use, within the memory budget. */
  private medianTarget: THREE.WebGLArrayRenderTarget | null = null;
  /** This frame's size for the Median array, the same for every layer. */
  private medianPlan: MedianPlan | null = null;
  private readonly glowBright: THREE.ShaderMaterial;
  /** Glow finish: one bright-pass target and blur pyramid, shared by all layers. */
  private glow: { bright: THREE.WebGLRenderTarget; pyramid: BloomPyramid; streak: StreakBlur } | null = null;
  /** Colour and Lens finish: one target shared by all layers, built on first use. */
  private lensTarget: THREE.WebGLRenderTarget | null = null;
  private readonly lens = material(lensFragment, {
    uSource: { value: null }, uAspect: { value: 1 }, uHeight: { value: 1 }, uTile: { value: 0 }, uPhase: { value: 0 }, uSeed: { value: 0 },
    uSplitOn: { value: 0 }, uSplitAmount: { value: 0 }, uSplitShape: { value: 0 }, uSplitThreshold: { value: .15 },
    uSplitWaves: { value: 4 }, uSplitTravel: { value: 1 }, uSplitOrder: { value: 0 }, uSplitBlocks: { value: 0 }, uSplitChance: { value: .5 },
    uSplitDirection: { value: new THREE.Vector2(1, 0) }, uSplitCount: { value: 3 },
    uSplitOffsets: { value: new Array<number>(15).fill(0) },
    uSplitWeights: { value: Array.from({ length: 15 }, () => new THREE.Vector3()) },
    uGradMix: { value: 0 }, uGradMidpoint: { value: .5 }, uGradShift: { value: 0 }, uGradKeep: { value: 0 }, uGradCount: { value: 0 },
    uGradStops: { value: Array.from({ length: 6 }, () => new THREE.Color()) },
    uGradeWb: { value: new THREE.Vector3(1, 1, 1) }, uShadowColour: { value: new THREE.Color() }, uHighlightColour: { value: new THREE.Color() },
    uShadowTint: { value: 0 }, uHighlightTint: { value: 0 },
    uKeyMix: { value: 0 }, uKeyMode: { value: 0 }, uKeyLow: { value: .25 }, uKeyHigh: { value: 1 }, uKeySoft: { value: .1 },
    uKeyHue: { value: 120 }, uKeyHueRange: { value: 40 }, uKeyInvert: { value: 0 },
  });
  /** Warp finish: one target shared by all layers, built on first use. */
  private warpTarget: THREE.WebGLRenderTarget | null = null;
  private readonly warp = material(warpFragment, {
    uSource: { value: null }, uResolution: { value: new THREE.Vector2(1, 1) }, uAspect: { value: 1 }, uSeed: { value: 0 },
    uBendAmount: { value: 0 }, uBendField: { value: 0 }, uBendScale: { value: 3 }, uBendDirection: { value: new THREE.Vector2(1, 0) },
    uBendTurn: { value: 0 }, uBendDetail: { value: 3 }, uBendFalloff: { value: .5 }, uBendChroma: { value: 0 }, uBendCount: { value: 1 },
    uBendPoints: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    uLiquidAmount: { value: 0 }, uLiquidStyle: { value: 0 }, uLiquidScale: { value: 2 }, uLiquidSteps: { value: 6 }, uLiquidDetail: { value: 3 },
    uLiquidTurn: { value: 0 }, uLiquidTrail: { value: 0 }, uLiquidChroma: { value: 0 }, uLiquidDrift: { value: new THREE.Vector2(1, 0) },
    uBelow: { value: null }, uLumaAmount: { value: 0 }, uLumaSource: { value: 0 }, uLumaChannel: { value: 0 }, uLumaMode: { value: 0 },
    uLumaDirection: { value: new THREE.Vector2(0, 1) }, uLumaThreshold: { value: 0 }, uLumaSoft: { value: .2 }, uLumaChroma: { value: 0 },
    uPolarAmount: { value: 0 }, uPolarMode: { value: 0 }, uPolarCentre: { value: new THREE.Vector2() }, uPolarTwist: { value: 0 },
    uMirrorAmount: { value: 0 }, uMirrorMode: { value: 0 }, uMirrorSegments: { value: 6 }, uMirrorTurn: { value: 0 },
    uLayerView: { value: new THREE.Matrix3() }, uLayerInverse: { value: new THREE.Matrix3() }, uLayerMoved: { value: 0 }, uLayerBounded: { value: 0 }, uLayerExtent: { value: new THREE.Vector2(1, 1) }, uPictureInset: { value: new THREE.Vector2(0, 0) },
  });
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

  /** Anything whose contents were built up over frames lived on the lost context, so it is rebuilt. */
  private readonly onContextRestored = () => {
    for (const state of this.feedbackStates.values()) this.disposeFeedback(state);
    this.feedbackStates.clear();
    this.releaseOilTargets();
    this.instruments.resetGpuHistory();
    this.smokeClouds?.resetGpuHistory();
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
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

    this.surface = material(surfaceFragment, surfaceUniforms());
    this.fractal = material(fractalFragment, {
      ...viewUniforms(),
      uPalette: { value: DEFAULT_PALETTE.map((hex) => new THREE.Color(hex)) },
      uResolution: { value: new THREE.Vector2(1, 1) }, uAspect: { value: 1 },
      uPhase: { value: 0 }, uSeed: { value: 0 }, uStyle: { value: 0 },
      ...Object.fromEntries(Object.entries(FRACTAL_DEFAULTS).map(([key, value]) => [`u${key[0].toUpperCase()}${key.slice(1)}`, { value }])),
    });
    this.liquid = material(liquidFragment, {
      ...viewUniforms(),
      uPalette: { value: DEFAULT_PALETTE.map((hex) => new THREE.Color(hex)) },
      uDroplets: { value: this.fallback }, uAspect: { value: 1 }, uPhase: { value: 0 }, uSeed: { value: 0 },
      ...Object.fromEntries(Object.entries(LIQUID_DEFAULTS).map(([key, value]) => [`u${key[0].toUpperCase()}${key.slice(1)}`, { value }])),
    });
    const oilUniforms: Uniforms = {
      ...viewUniforms(),
      ...Object.fromEntries(Object.entries(OIL_DEFAULTS).map(([key, value]) => [`u${key[0].toUpperCase()}${key.slice(1)}`, { value }])),
      uPalette: { value: DEFAULT_PALETTE.map(hex => new THREE.Color(hex)) },
      uResolution: { value: new THREE.Vector2(1, 1) }, uAspect: { value: 1 }, uSeed: { value: 0 },
      uSlide: { value: new THREE.Vector2() }, uLens: { value: new THREE.Vector2() },
      uDirection: { value: new THREE.Vector2(1, 0) }, uSlideAngle: { value: 0 },
      uLensAngle: { value: 0 }, uLensShapePhase: { value: 0 }, uPresence: { value: 1 }, uStrain: { value: 0 }, uLoop: { value: 0 },
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
    this.image = material(imageFragment, { ...viewUniforms(), uImage: { value: this.fallback }, uFit: { value: new THREE.Vector2(1, 1) }, uMirror: { value: 0 }, uRepeat: { value: 1 }, uExactEdge: { value: 0 } });
    this.composite = material(compositeFragment, {
      uBelow: { value: this.accumA.texture }, uSource: { value: this.source.texture }, uMask: { value: this.fallback },
      uTranslation: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2(1, 1) },
      uScale: { value: 1 }, uRotation: { value: 0 }, uOpacity: { value: 1 }, uBlend: { value: 0 }, uTopMean: { value: new THREE.Vector3(.5, .5, .5) },
      uAspect: { value: 1 }, uMaskKind: { value: 0 }, uMaskSize: { value: 1 }, uMaskSoftness: { value: .1 },
      uPatternScale: { value: new THREE.Vector2(1, 1) }, uPatternTranslation: { value: new THREE.Vector2() },
      uPatternRotation: { value: 0 }, uPatternRepeat: { value: 0 },
      uSourceInView: {value:0},uSourceViewInverse:{value:new THREE.Matrix3()},
      uPatternRing: { value: new THREE.Vector4() }, uPatternBackground: { value: new THREE.Color() },
      uMaskInvert: { value: 0 }, uGlow: { value: 0 },
      ...Object.fromEntries(BLOOM_HEIGHTS.map((_, i) => [`uGlowLevel${i}`, { value: this.fallback }])),
      uGlowChannels: { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector3()) }, uGlowStreakMap: { value: this.fallback }, uGlowColour: { value: new THREE.Color() }, uGlowOn: { value: 0 },
      uPrintOn: { value: 0 }, uPrintCells: { value: 135 }, uPrintOffset: { value: 0 }, uPrintAngles: { value: [0, 0, 0, 0] },
      ...Object.fromEntries(FINISH_PARAMETERS.map(d=>['u'+d.key[0].toUpperCase()+d.key.slice(1),{value:d.default}])),
      uSaturation: {value:1}, uHue: {value:0}, uExposure:{value:1},
      uColorMode:{value:0},uColorSteps:{value:6},uColorMix:{value:1},uColorOffset:{value:0},
      uGradePalette:{value:DEFAULT_PALETTE.map(hex=>new THREE.Color(hex))},
      uLoopPhase:{value:0},
    });
    this.glowBright = material(glowBrightFragment, { uSource: { value: this.fallback }, uThreshold: { value: .5 } });
    this.finish = material(finishFragment, {
      uImage: { value: this.accumA.texture }, uBackground: { value: new THREE.Color(0) },
      uOpaque: { value: 0 }, uExactHighlights: { value: 0 }, toneMappingExposure: { value: 1 },
    });
    this.display = material(displayFragment, { uImage: { value: this.linearOutput.texture } });
    this.downsample = material(downsampleFragment, { uImage: { value: this.linearOutput.texture }, uSourceSize: { value: new THREE.Vector2(1, 1) }, uFactor: { value: 1 }, uWrap: { value: 0 } });
    this.slit = material(slitFragment, {
      uAccum: { value: null }, uSource: { value: null }, uIndex: { value: 0 }, uCount: { value: 2 }, uSmooth: { value: 0 },
      uShape: { value: 0 }, uBlocks: { value: 8 }, uScroll: { value: 0 }, uAspect: { value: 1 }, uReverse: { value: 0 }, uSeed: { value: 0 },
      uDriver: { value: this.fallback }, uBound: { value: this.fallback }, uLag: { value: this.fallback }, uTwist: { value: 0 }, uZoom: { value: 0 }, uChroma: { value: 0 },
    });
    this.slitBound = material(slitFragment, this.slit.uniforms);
    this.slitBound.defines = { SLIT_BOUND: '' };
    this.slitBound.blending = THREE.CustomBlending;
    this.slitBound.blendEquation = THREE.MaxEquation;
    this.slitBound.blendSrc = THREE.OneFactor; this.slitBound.blendDst = THREE.OneFactor;
    this.slitLag = material(slitFragment, this.slit.uniforms);
    this.slitLag.defines = { SLIT_LAG: '' };
    this.slitLag.blending = THREE.CustomBlending;
    this.slitLag.blendEquation = THREE.AddEquation;
    this.slitLag.blendSrc = THREE.OneFactor; this.slitLag.blendDst = THREE.OneFactor;
    this.timeGather = material(timeGatherFragment, {
      uAccum: { value: this.fallback }, uSource: { value: this.fallback }, uBoundMap: { value: this.fallback }, uLightMap: { value: this.fallback },
      uMode: { value: 1 }, uFirst: { value: 0 }, uLast: { value: 0 }, uBounded: { value: 0 }, uAlphaWeight: { value: 1 },
      uKeep: { value: new THREE.Vector3(1, 1, 1) }, uWeights: { value: new THREE.Vector3(1, 1, 1) },
    });
    this.timeBound = material(timeGatherFragment, this.timeGather.uniforms);
    this.timeBound.defines = { GATHER_BOUND: '' };
    this.timeLight = material(timeGatherFragment, this.timeGather.uniforms);
    this.timeLight.defines = { GATHER_LIGHT: '' };
    for (const mat of [this.timeBound, this.timeLight]) {
      mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.MaxEquation;
      mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor;
    }
    this.timeMedian = material(timeMedianFragment, {
      uLayers: { value: null }, uFill: { value: new THREE.Vector2(1, 1) }, uCount: { value: 3 }, uBounded: { value: 0 }, uChannels: { value: new THREE.Vector3(3, 3, 3) },
    });
    this.feedback = material(feedbackFragment, {
      uSource: { value: null }, uPrevious: { value: null }, uAspect: { value: 1 }, uZoom: { value: 1 }, uRotate: { value: 0 },
      uFade: { value: 0 }, uHue: { value: 0 }, uWarp: { value: 0 }, uMode: { value: 0 }, uHole: { value: 0 }, uWindow: { value: 0 }, uDrift: { value: new THREE.Vector2() },
      uCentre: { value: new THREE.Vector2() }, uTilt: { value: new THREE.Vector2() }, uLens: { value: 0 }, uRound: { value: 0 }, uSquare: { value: 0 },
      uStreak: { value: 0 }, uStreakAxis: { value: 0 }, uBlock: { value: 0 }, uSlip: { value: 0 }, uCrush: { value: 0 }, uFrame: { value: 0 }, uEdge: { value: 0 }, uKeep: { value: 0 }, uEvents: { value: 0 }, uColourDrift: { value: 0 }, uPunch: { value: 0 }, uPixel: { value: 0 }, uTexels: { value: new THREE.Vector2(1, 1) },
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

  isContextLost(): boolean { return this.renderer.getContext().isContextLost(); }

  private assertUsable(): void {
    if (this.disposed) throw new Error('This renderer has been disposed.');
    if (this.isContextLost()) throw new Error('The GPU context was lost. Reload the renderer to resume the saved project.');
  }

  // Looked up every frame. Building the key by joining strings would copy and
  // hash a multi-megabyte data URL each time, so keys are remembered per URL.
  private readonly assetKeys = new Map<string, string[]>();
  private assetKey(url: string, mask: boolean, repeat = false): string {
    const slot = mask ? 0 : repeat ? 1 : 2;
    let keys = this.assetKeys.get(url);
    if (!keys) { if (this.assetKeys.size > 16) this.assetKeys.clear(); keys = []; this.assetKeys.set(url, keys); }
    return keys[slot] ??= `${mask ? 'mask' : repeat ? 'repeat' : 'color'}:${url}`;
  }

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
      this.smokeClouds?.keep(new Set(project.layers.filter(layer => layer.kind === 'smokecloud' && layer.visible).map(layer => layer.id)));
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

  /** Draws with blending onto what the target already holds. */
  private drawOnto(mat: THREE.ShaderMaterial, output: THREE.WebGLRenderTarget): void {
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    try { this.draw(mat, output); } finally { this.renderer.autoClear = autoClear; }
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
    u.uPresence.value = motion.presence * number(layer, 'dome', 1); u.uStrain.value = motion.strain;
    u.uLoop.value = phase * Math.max(1, Math.round(number(layer, 'cycles', 1)));
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

  /** The baked droplet layout for this layer's seed, size range and density. */
  private liquidLayout(layer: Layer): THREE.DataTexture {
    const seed = number(layer, 'seed', 0), range = number(layer, 'sizeRange', 16), density = number(layer, 'density', .6);
    const key = liquidPackKey(seed, range, density);
    let texture = this.liquidLayouts.get(key);
    if (texture) { this.liquidLayouts.delete(key); this.liquidLayouts.set(key, texture); return texture; }
    texture = new THREE.DataTexture(packDroplets(seed, range, density).texture, LIQUID_BINS * LIQUID_SLOTS, LIQUID_BINS, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
    this.liquidLayouts.set(key, texture);
    while (this.liquidLayouts.size > LIQUID_LAYOUTS) {
      const oldest = this.liquidLayouts.keys().next().value!;
      this.liquidLayouts.get(oldest)!.dispose(); this.liquidLayouts.delete(oldest);
    }
    return texture;
  }

  private drawSource(layer: Layer, phase: number, original: Layer = layer, duration = 10, smokeAudio?: SmokeAudioFrame): THREE.Texture {
    const aspect = this.width / this.height;
    const surface = this.tiling ? this.tiledSurface ??= tiledSurfaceMaterial() : this.surface;
    const uniforms=layer.kind==='surface'?surface.uniforms:layer.kind==='fractal'?this.fractal.uniforms:
      layer.kind==='oil'?this.oilFields.uniforms:layer.kind==='liquid'?this.liquid.uniforms:layer.kind==='super8'?this.super8Projector.uniforms:
      layer.kind==='image'?this.image.uniforms:layer.kind==='sculpture'?this.sculptureUniforms:null;
    // Tile edges snap the view to quarter turns so the frame stays a whole period.
    const transform = this.tiling ? { ...layer.transform, rotation: snapQuarterTurn(layer.transform.rotation) } : layer.transform;
    if(uniforms)setSourceView(uniforms,sourceViewMatrix(transform,aspect),layer.transform.scale);
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
    } else if (layer.kind === 'scope') {
      this.scope ??= new ScopeRenderer();
      this.scope.draw(this.renderer, layer, localPhase, this.width, this.height, this.source, (m, t) => this.draw(m, t), smokeAudio);
    } else if (layer.kind === 'smokecloud') {
      this.smokeClouds ??= new SmokeCloudRenderer();
      this.smokeClouds.draw(this.renderer, layer, original, localPhase, this.width, this.height, this.source, smokeAudio, { exact: this.exactFeedback, playing: this.previewPlaying, duration });
    } else if (layer.kind === 'liquid') {
      const u = this.liquid.uniforms;
      u.uAspect.value = aspect; u.uPhase.value = localPhase;
      u.uSeed.value = number(layer, 'seed', 0) % 1_000_003;
      u.uDroplets.value = this.liquidLayout(layer);
      for (const [key, fallback] of Object.entries(LIQUID_DEFAULTS)) {
        u[`u${key[0].toUpperCase()}${key.slice(1)}`].value = number(layer, key, fallback);
      }
      const colors = u.uPalette.value as THREE.Color[];
      for (let i = 0; i < 6; i++) colors[i].set(layer.palette[i] ?? DEFAULT_PALETTE[i]);
      this.draw(this.liquid, this.source);
    } else if (layer.kind === 'surface') {
      const u = surface.uniforms;
      (u.uResolution.value as THREE.Vector2).set(this.width,this.height);
      u.uAspect.value = aspect; u.uPhase.value = localPhase;
      u.uSeed.value = number(layer, 'seed', 0) % 1_000_003;
      for (const [key, fallback] of Object.entries(SURFACE_DEFAULTS)) {
        u[`u${key[0].toUpperCase()}${key.slice(1)}`].value = number(layer, key, fallback);
      }
      const colors = u.uPalette.value as THREE.Color[];
      for (let i = 0; i < 6; i++) colors[i].set(layer.palette[i] ?? DEFAULT_PALETTE[i]);
      if (this.tiling) {
        const period = tilePeriod(layer, aspect);
        (u.uTile.value as THREE.Vector2).set(period.x, period.y);
        u.uRotation.value = snapQuarterTurn(number(layer, 'rotation', 0));
      }
      this.draw(surface, this.source);
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
      const [x, y] = imageFit(layer.image, aspect);
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
      // Spin turns the form a whole number of times per loop about a tilted
      // axis, so its silhouette keeps changing and the loop still closes.
      const spin = Math.round(number(layer, 'spin', 0)) * localPhase;
      this.sculpture.rotation.set(breath * .12 * Math.sin(localPhase) + spin * .35, breath * .3 * Math.sin(localPhase) + spin, -.1 + breath * .08 * Math.sin(localPhase + .6));
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

  private renderFrame(project: Project, phase: number, width: number, height: number, smokeAudio?: SmokeAudioFrame): void {
    this.assertUsable();
    if (!Number.isFinite(phase)) throw new Error('Frame phase must be finite.');
    if (project.layers.length > 4) throw new Error('This version supports at most four composition layers.');
    this.resize(width, height);
    this.tiling = project.tileEdges === true && tileBlockers(project).length === 0;
    // Tiled sources wrap, so Glow and outlines read across the frame edges.
    setWrap(this.source, this.tiling);
    this.renderer.info.reset();
    this.renderer.setClearColor(0, 0);
    this.renderer.setRenderTarget(this.accumA); this.renderer.clear();
    let below = this.accumA, next = this.accumB;
    let soleSource: THREE.Texture | null = null;
    const wrapped = ((phase % TAU) + TAU) % TAU;
    const duration = frameCount(project) * project.fps.den / project.fps.num;
    const total = frameCount(project);
    this.releaseFeedback(project);
    this.releaseTimeTargets(project);
    this.medianPlan = medianFramePlan(project.layers, width, height, this.exporting);
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
        : this.drawSource(layer, finiteEvolving(original) ? Math.max(0,Math.min(TAU,phase)) : original.kind === 'super8' ? wrapped : sourcePhase, original, duration, smokeAudio);
      const warped = warpActive(original) ? this.warpSource(original, layer, sourceTexture, below.texture, wrapped, width, height) : sourceTexture;
      const finished = lensActive(original) ? this.lensSource(original, layer, warped, wrapped, width, height) : warped;
      // Exports always use the full compositor; a live untouched Smoke Cloud does not need its cost at 4K.
      if (!this.exporting && !this.fullCompositorOnly && compositesPlainly(layer, this.tiling)) {
        // Alone in the frame, it is already the finished composite: drawing it over nothing changes no pixel.
        if (project.layers.filter(item => item.visible).length === 1) { soleSource = finished; continue; }
        this.plainOver ??= new THREE.ShaderMaterial({ vertexShader: fullscreenVertex, fragmentShader: plainOverFragment, uniforms: { uBelow: { value: null }, uSource: { value: null } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false });
        this.plainOver.uniforms.uBelow.value = below.texture; this.plainOver.uniforms.uSource.value = finished;
        this.draw(this.plainOver, next);
        [below, next] = [next, below];
        continue;
      }
      const u = this.composite.uniforms;
      u.uBelow.value = below.texture; u.uSource.value = finished;
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
      u.uBlend.value = { normal: 0, screen: 1, multiply: 2, add: 3, source: 4 }[layer.blend];
      // Average palette brightness: Colour from below maps this to the colour underneath.
      const mean = new THREE.Color(); for (let i = 0; i < 5; i++) mean.add(new THREE.Color(layer.palette[i] ?? '#808080')); (u.uTopMean.value as THREE.Vector3).set(mean.r / 5, mean.g / 5, mean.b / 5);
      u.uMaskKind.value = layer.surface?.source==='mask'&&!layer.surface.clipMask?0:{ none: 0, circle: 1, rectangle: 2, image: 3 }[layer.mask.kind];
      u.uMaskSize.value = layer.mask.size; u.uMaskSoftness.value = layer.mask.softness;
      u.uMaskInvert.value = Number(layer.mask.invert);
      u.uGlow.value = number(layer, 'glow', layer.kind === 'sculpture' ? .12 : 0);
      this.bindGlow(original, layer, finished, width, height);
      this.bindPrint(original, layer, wrapped);
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
    this.finish.uniforms.uImage.value = soleSource ?? below.texture;
    (this.finish.uniforms.uBackground.value as THREE.Color).set(project.background);
    this.finish.uniforms.uOpaque.value = project.transparent ? 0 : 1;
    this.finish.uniforms.uExactHighlights.value = project.highlights === 'exact' ? 1 : 0;
    this.draw(this.finish, this.linearOutput);
  }

  /**
   * Warp finish: moves the layer's pixels after Feedback and Time and before
   * Colour and Lens, in its own target, so it never enters the echo history.
   * `below` is the picture under this layer, read by Luma Warp.
   */
  warpSource(original: Layer, layer: Layer, source: THREE.Texture, below: THREE.Texture, phase: number, width: number, height: number): THREE.Texture {
    if (!warpActive(original)) return source;
    // A modulated amount can rest at zero, where there is nothing to do.
    const amount = Math.max(0, number(layer, 'bendAmount', 0)), liquid = Math.max(0, number(layer, 'liquidAmount', 0)), luma = Math.max(0, number(layer, 'lumaWarpAmount', 0));
    const polar = Math.min(1, Math.max(0, number(layer, 'polarAmount', 0))), mirror = Math.min(1, Math.max(0, number(layer, 'mirrorAmount', 0)));
    if (amount <= 0 && liquid <= 0 && luma <= 0 && polar <= 0 && mirror <= 0) return source;
    this.warpTarget ??= target();
    const output = this.warpTarget;
    if (output.width !== width || output.height !== height) output.setSize(width, height);
    setWrap(output, this.tiling);
    const u = this.warp.uniforms, angle = number(layer, 'bendAngle', 0) * Math.PI / 180, seed = number(layer, 'seed', 0) % 1000;
    const points = warpPoints(Math.min(8, Math.round(number(layer, 'bendPoints', 3))), seed);
    u.uSource.value = source; u.uAspect.value = width / height; u.uSeed.value = seed;
    (u.uResolution.value as THREE.Vector2).set(width, height);
    u.uBendAmount.value = amount; u.uBendField.value = Math.round(number(layer, 'bendField', 0));
    u.uBendScale.value = number(layer, 'bendScale', 3);
    (u.uBendDirection.value as THREE.Vector2).set(Math.cos(angle), Math.sin(angle));
    // Whole cycles only, so the loop closes.
    u.uBendTurn.value = Math.round(number(layer, 'bendCycles', 1)) * phase;
    u.uBendDetail.value = Math.round(number(layer, 'bendDetail', 3));
    u.uBendFalloff.value = number(layer, 'bendFalloff', .5); u.uBendChroma.value = number(layer, 'bendChroma', 0);
    u.uBendCount.value = points.length;
    points.forEach((point, i) => (u.uBendPoints.value as THREE.Vector3[])[i].set(point.x, point.y, point.polarity));
    const style = Math.round(number(layer, 'liquidStyle', 0)), drift = seed * 2.39996;
    u.uLiquidAmount.value = liquid; u.uLiquidStyle.value = style; u.uLiquidScale.value = number(layer, 'liquidScale', 2);
    u.uLiquidSteps.value = Math.min(16, Math.max(1, Math.round(number(layer, 'liquidSteps', 6))));
    u.uLiquidDetail.value = Math.min(5, Math.max(1, Math.round(number(layer, 'liquidDetail', 3))));
    // Whole cycles only, so the loop closes.
    u.uLiquidTurn.value = Math.round(number(layer, 'liquidCycles', 1)) * phase;
    // The trail control belongs to Flow, so a value left from Flow never shows on another style.
    u.uLiquidTrail.value = style === 1 ? number(layer, 'liquidTrail', 0) : 0;
    u.uLiquidChroma.value = number(layer, 'liquidChroma', 0);
    (u.uLiquidDrift.value as THREE.Vector2).set(Math.cos(drift), Math.sin(drift));
    const lumaAngle = number(layer, 'lumaWarpAngle', 90) * Math.PI / 180;
    u.uBelow.value = below; u.uLumaAmount.value = luma;
    u.uLumaSource.value = Math.round(number(layer, 'lumaWarpSource', 0)); u.uLumaChannel.value = Math.round(number(layer, 'lumaWarpChannel', 0));
    u.uLumaMode.value = Math.round(number(layer, 'lumaWarpMode', 0));
    (u.uLumaDirection.value as THREE.Vector2).set(Math.cos(lumaAngle), Math.sin(lumaAngle));
    u.uLumaThreshold.value = number(layer, 'lumaWarpThreshold', 0); u.uLumaSoft.value = number(layer, 'lumaWarpSoft', .2);
    u.uLumaChroma.value = number(layer, 'lumaWarpChroma', 0);
    // Positive Y is down the screen, the same as a layer's position.
    u.uPolarAmount.value = polar; u.uPolarMode.value = Math.round(number(layer, 'polarMode', 0));
    (u.uPolarCentre.value as THREE.Vector2).set(number(layer, 'polarCentreX', 0), -number(layer, 'polarCentreY', 0));
    u.uPolarTwist.value = number(layer, 'polarTwist', 0);
    u.uMirrorAmount.value = mirror; u.uMirrorMode.value = Math.round(number(layer, 'mirrorMode', 0));
    u.uMirrorSegments.value = Math.max(2, Math.round(number(layer, 'mirrorSegments', 6)));
    // Whole turns only, so the loop closes.
    u.uMirrorTurn.value = number(layer, 'mirrorAngle', 0) * Math.PI / 180 + Math.round(number(layer, 'mirrorTurns', 0)) * phase;
    // Mirror and Polar pivot on the layer, so a moved picture stays in view.
    const pose = layerWarpView(layer.transform, width / height), picture = warpPicture(layer, width, height);
    (u.uLayerView.value as THREE.Matrix3).copy(pose.view); (u.uLayerInverse.value as THREE.Matrix3).copy(pose.inverse);
    // A bounded Image works in its layer's space even unmoved, where that space is the frame's.
    u.uLayerMoved.value = Number(pose.moved || picture.bounded);
    u.uLayerBounded.value = Number(picture.bounded);
    (u.uLayerExtent.value as THREE.Vector2).set(picture.extent[0], picture.extent[1]);
    (u.uPictureInset.value as THREE.Vector2).set(picture.inset[0], picture.inset[1]);
    this.draw(this.warp, output);
    return output.texture;
  }

  /**
   * Colour and Lens finish: runs on the layer's source after Feedback and Time
   * displacement and writes to its own target, so it never enters the echo
   * history. Sizes are in pixels of a 1080-line frame.
   */
  lensSource(original: Layer, layer: Layer, source: THREE.Texture, phase: number, width: number, height: number): THREE.Texture {
    if (!lensActive(original)) return source;
    const amount = number(layer, 'splitAmount', 0), order = Math.round(number(layer, 'splitOrder', 0));
    // A modulated amount can rest at zero, where there is nothing to do.
    const mix = number(layer, 'gradMix', 0);
    const temperature = number(layer, 'gradeTemperature', 0), tint = number(layer, 'gradeTint', 0);
    const shadow = number(layer, 'gradeShadowTint', 0), highlight = number(layer, 'gradeHighlightTint', 0), key = number(layer, 'keyMix', 0);
    if (amount <= 0 && order === 0 && mix <= 0 && temperature === 0 && tint === 0 && shadow <= 0 && highlight <= 0 && key <= 0) return source;
    this.lensTarget ??= target();
    const output = this.lensTarget;
    if (output.width !== width || output.height !== height) output.setSize(width, height);
    setWrap(output, this.tiling);
    const u = this.lens.uniforms, taps = spectralWeights(Math.min(15, number(layer, 'splitSamples', 3)));
    const angle = number(layer, 'splitAngle', 0) * Math.PI / 180;
    u.uSource.value = source; u.uAspect.value = width / height; u.uHeight.value = height; u.uTile.value = Number(this.tiling);
    u.uPhase.value = phase; u.uSeed.value = number(layer, 'seed', 0) % 1000;
    u.uSplitOn.value = Number(amount > 0); u.uSplitAmount.value = amount;
    u.uSplitShape.value = Math.round(number(layer, 'splitShape', 0));
    u.uSplitThreshold.value = number(layer, 'splitThreshold', .15);
    u.uSplitWaves.value = Math.round(number(layer, 'splitWaves', 4));
    u.uSplitTravel.value = Math.round(number(layer, 'splitTravel', 1));
    u.uSplitOrder.value = order; u.uSplitBlocks.value = Math.round(number(layer, 'splitBlocks', 0));
    u.uSplitChance.value = number(layer, 'splitChance', .5);
    (u.uSplitDirection.value as THREE.Vector2).set(Math.cos(angle), Math.sin(angle));
    u.uSplitCount.value = taps.length;
    taps.forEach((sample, i) => {
      (u.uSplitOffsets.value as number[])[i] = sample.offset;
      (u.uSplitWeights.value as THREE.Vector3[])[i].fromArray(sample.weight);
    });
    // Gradient Map: a whole number of cycles, so the loop closes. The shift is
    // in half periods of the fold (see foldTone), so offset 1 is a full turn.
    u.uGradMix.value = mix; u.uGradMidpoint.value = safeMidpoint(number(layer, 'gradMidpoint', .5));
    u.uGradShift.value = 2 * (number(layer, 'gradOffset', 0) + Math.round(number(layer, 'gradCycles', 0)) * phase / TAU);
    u.uGradKeep.value = number(layer, 'gradKeep', 0);
    const stops = gradientStops(Math.round(number(layer, 'gradPalette', 0)), layer.palette), colours = u.uGradStops.value as THREE.Color[];
    u.uGradCount.value = Math.min(6, stops.length);
    for (let i = 0; i < 6; i++) colours[i].set(stops[Math.min(i, stops.length - 1)] ?? '#000000');
    // Grading and Key: neutral values leave the pixel exactly as it was.
    (u.uGradeWb.value as THREE.Vector3).fromArray(whiteBalance(temperature, tint));
    u.uShadowTint.value = shadow; u.uHighlightTint.value = highlight;
    const swatch = (key: string, fallback: number) => { const i = Math.round(number(layer, key, fallback)); return layer.palette[i - 1] ?? DEFAULT_PALETTE[i - 1]; };
    (u.uShadowColour.value as THREE.Color).set(swatch('gradeShadowColour', 1));
    (u.uHighlightColour.value as THREE.Color).set(swatch('gradeHighlightColour', 2));
    u.uKeyMix.value = key; u.uKeyMode.value = Math.round(number(layer, 'keyMode', 0));
    u.uKeyLow.value = number(layer, 'keyLow', .25); u.uKeyHigh.value = number(layer, 'keyHigh', 1); u.uKeySoft.value = number(layer, 'keySoftness', .1);
    u.uKeyHue.value = number(layer, 'keyHue', 120); u.uKeyHueRange.value = number(layer, 'keyHueRange', 40);
    u.uKeyInvert.value = Math.round(number(layer, 'keyInvert', 0));
    this.draw(this.lens, output);
    return output.texture;
  }

  /**
   * Glow finish: blurs the bright light of the layer's finished source for the
   * composite pass. It reads the source after Feedback and Time displacement
   * and writes only to its own targets, so it never enters the echo history.
   */
  private bindGlow(original: Layer, layer: Layer, source: THREE.Texture, width: number, height: number): void {
    const u = this.composite.uniforms, amount = number(layer, 'glowMix', 0);
    const on = glowActive(original) && amount > 0;
    u.uGlowOn.value = Number(on);
    if (!on) { BLOOM_HEIGHTS.forEach((_, i) => { u[`uGlowLevel${i}`].value = this.fallback; }); u.uGlowStreakMap.value = this.fallback; return; }
    this.glow ??= { bright: lightTarget(true), pyramid: new BloomPyramid(), streak: new StreakBlur() };
    const { bright, pyramid, streak } = this.glow, w = Math.ceil(width / 2), h = Math.ceil(height / 2);
    if (bright.width !== w || bright.height !== h) bright.setSize(w, h);
    setWrap(bright, this.tiling);
    this.glowBright.uniforms.uSource.value = source;
    this.glowBright.uniforms.uThreshold.value = number(layer, 'glowThreshold', .5);
    this.draw(this.glowBright, bright);
    pyramid.render(bright.texture, width, height, (m, t) => this.draw(m, t), this.tiling).forEach((level, i) => { u[`uGlowLevel${i}`].value = level; });
    bloomChannelWeights(amount, number(layer, 'glowSize', .5), number(layer, 'glowSpread', 0)).forEach((c, i) => (u.uGlowChannels.value[i] as THREE.Vector3).set(c[0], c[1], c[2]));
    // Streaks stretch the same bright light; Cross also runs across, at right angles.
    if (number(layer, 'glowStreak', 0) > 0) {
      const cross = Math.round(number(layer, 'glowStreakShape', 0)) >= 1;
      u.uGlowStreakMap.value = streak.render(bright.texture, width, height, number(layer, 'glowStreakAngle', 0), cross, (m, t) => this.draw(m, t), this.tiling);
    } else u.uGlowStreakMap.value = this.fallback;
    const tint = Math.round(number(layer, 'glowTint', 0));
    if (tint >= 1) (u.uGlowColour.value as THREE.Color).set(layer.palette[tint - 1] ?? DEFAULT_PALETTE[tint - 1]);
  }

  /**
   * Print screen finish: the screen is drawn inside the composite pass, so it
   * needs no targets of its own and never enters the echo history. Its
   * geometry is in frame units, the same at every render size.
   */
  private bindPrint(original: Layer, layer: Layer, loopPhase: number): void {
    const u = this.composite.uniforms, on = printActive(original) && number(layer, 'printMix', 0) > 0;
    u.uPrintOn.value = Number(on);
    if (!on) return;
    const screen = printUniforms(layer, loopPhase);
    u.uPrintCells.value = screen.cells; u.uPrintAngles.value = screen.angles; u.uPrintOffset.value = screen.scroll;
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
    // Time displacement draws the layer once per slice, twelve times a frame by
    // default, and the cost is almost all pixels. The live preview therefore
    // draws the slices smaller and lets the compositor scale the result up:
    // half size for a few slices, down to a quarter for many, so all the
    // slices together cost about as much as one and a half full frames.
    // Exports draw every slice at full size.
    if (this.exporting) return this.slices(original, phase, total, duration);
    const width = this.width, height = this.height, source = this.source;
    const scale = previewSliceScale(sliceSourceRenders(evaluateLayer(original, phase)));
    // Solid geometry keeps its edge smoothing; shaders smooth their own edges.
    const solid = original.kind === 'sculpture' || original.kind === 'relief';
    let stand = solid ? this.sliceSourceSmooth : this.sliceSource;
    if (!stand) {
      stand = target(true);
      if (solid) { stand.samples = source.samples; this.sliceSourceSmooth = stand; } else this.sliceSource = stand;
    }
    this.width = Math.max(1, Math.round(width * scale)); this.height = Math.max(1, Math.round(height * scale));
    if (stand.width !== this.width || stand.height !== this.height) stand.setSize(this.width, this.height);
    this.source = stand;
    try { return this.slices(original, phase, total, duration); }
    finally { this.width = width; this.height = height; this.source = source; }
  }

  private slices(original: Layer, phase: number, total: number, duration: number): THREE.Texture {
    const layer = evaluateLayer(original, phase), p = layer.params;
    if (!this.slitTargets) this.slitTargets = [target(), target()];
    for (const rt of this.slitTargets) if (rt.width !== this.width || rt.height !== this.height) rt.setSize(this.width, this.height);
    if (timeMode(p.slitMode) > 0) {
      // These modes keep single pixels from any slice, so a stray edge line would persist.
      this.image.uniforms.uExactEdge.value = 1;
      try { return this.statSlices(original, phase, total, duration); }
      finally { this.image.uniforms.uExactEdge.value = 0; }
    }
    let [accum, next] = this.slitTargets;
    this.clearTarget(accum);
    const delays = sliceDelays(layer), u = this.slit.uniforms;
    u.uCount.value = delays.length; u.uSmooth.value = p.slitSmooth ?? 0;
    u.uShape.value = p.slitShape ?? 0; u.uBlocks.value = p.slitBlocks ?? 8;
    u.uScroll.value = (((p.slitScroll ?? 0) * phase / TAU) % 1 + 1) % 1;
    u.uAspect.value = this.width / this.height; u.uReverse.value = Number((p.slitShift ?? 0) < 0);
    u.uSeed.value = (p.seed ?? 0) % 1000;
    const warp = sliceWarpScale(p.slitShift ?? 0);
    u.uTwist.value = (p.slitTwist ?? 0) * warp; u.uZoom.value = (p.slitZoom ?? 0) * warp;
    const chroma = Math.max(0, p.slitChroma ?? 0);
    u.uChroma.value = chroma;
    const shape = p.slitShape ?? 0;
    if (shape >= 4.5 && shape < 5.5) u.uDriver.value = this.slitDriver(original, phase, duration);
    let lagTargets: { bound: THREE.WebGLRenderTarget; lag: THREE.WebGLRenderTarget } | null = null;
    if (chroma > 0) {
      lagTargets = { bound: this.slitBoundTarget ??= target(), lag: this.slitLagTarget ??= target() };
      for (const rt of [lagTargets.bound, lagTargets.lag]) {
        if (rt.width !== this.width || rt.height !== this.height) rt.setSize(this.width, this.height);
        this.clearTarget(rt);
      }
      u.uBound.value = lagTargets.bound.texture; u.uLag.value = lagTargets.lag.texture;
    }
    const direction = p.slitDirection ?? 0;
    delays.forEach((delay, index) => {
      u.uSource.value = this.plainSource(original, slicePhase(phase, delay, total, direction), duration);
      u.uAccum.value = accum.texture; u.uIndex.value = index;
      if (lagTargets) {
        this.drawOnto(this.slitBound, lagTargets.bound);
        this.drawOnto(this.slitLag, lagTargets.lag);
      }
      this.draw(this.slit, next);
      [accum, next] = [next, accum];
    });
    this.slitTargets = [accum, next];
    return accum.texture;
  }

  /**
   * Echo, Median, Darkest and Brightest: the slices combined per channel. These
   * modes ignore the delay map, Twist, Zoom and Colour lag.
   */
  private statSlices(original: Layer, phase: number, total: number, duration: number): THREE.Texture {
    const evaluated = evaluateLayer(original, phase), mode = timeMode(evaluated.params.slitMode);
    const p: Record<string, number> = { ...evaluated.params, slitMode: mode };
    const delays = sliceDelays({ params: p }), count = delays.length, direction = p.slitDirection ?? 0;
    const channels = channelSliceCounts(count, p.slitReach ?? 1);
    const bounded = channels[0] !== count || channels[1] !== count;
    const sliceAt = (delay: number) => this.plainSource(original, slicePhase(phase, delay, total, direction), duration);
    if (mode === TIME_MEDIAN) {
      const size = this.medianPlan;
      if (!size) throw new Error('Median has no size for this frame.');
      let layers = this.medianTarget;
      if (!layers) {
        layers = new THREE.WebGLArrayRenderTarget(size.width, size.height, size.depth, {
          type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
          minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
        });
        layers.texture.colorSpace = THREE.LinearSRGBColorSpace;
        this.medianTarget = layers;
      } else if (layers.width !== size.width || layers.height !== size.height || layers.depth !== size.depth) layers.setSize(size.width, size.height, size.depth);
      setWrap(layers, this.tiling);
      // A shorter layer fills a corner pixel for pixel; one above the budget fills it all, scaled.
      const fillWidth = Math.min(this.width, layers.width), fillHeight = Math.min(this.height, layers.height);
      layers.viewport.set(0, 0, fillWidth, fillHeight);
      delays.forEach((delay, index) => {
        this.copy.uniforms.uImage.value = sliceAt(delay);
        this.quad.material = this.copy;
        this.renderer.setRenderTarget(layers, index);
        this.renderer.render(this.quadScene, this.quadCamera);
      });
      const u = this.timeMedian.uniforms;
      u.uLayers.value = layers.texture; u.uCount.value = count; u.uBounded.value = Number(bounded);
      (u.uFill.value as THREE.Vector2).set(fillWidth / layers.width, fillHeight / layers.height);
      (u.uChannels.value as THREE.Vector3).fromArray(channels);
      const output = this.slitTargets![0];
      this.draw(this.timeMedian, output);
      return output.texture;
    }
    let [accum, next] = this.slitTargets!;
    this.clearTarget(accum);
    const u = this.timeGather.uniforms, decay = p.slitDecay ?? .7;
    const alphaWeights = echoWeights(count, decay), weights = channels.map(n => echoWeights(n, decay));
    u.uMode.value = mode; u.uBounded.value = Number(bounded);
    let extra: { bound: THREE.WebGLRenderTarget; light: THREE.WebGLRenderTarget } | null = null;
    if (bounded) {
      extra = { bound: this.statBoundTarget ??= target(), light: this.statLightTarget ??= target() };
      for (const rt of [extra.bound, extra.light]) {
        if (rt.width !== this.width || rt.height !== this.height) rt.setSize(this.width, this.height);
        this.clearTarget(rt);
      }
      u.uBoundMap.value = extra.bound.texture; u.uLightMap.value = extra.light.texture;
      this.timeLight.blendEquation = mode === TIME_ECHO ? THREE.AddEquation : THREE.MaxEquation;
    }
    delays.forEach((delay, index) => {
      u.uSource.value = sliceAt(delay); u.uAccum.value = accum.texture;
      u.uFirst.value = Number(index === 0); u.uLast.value = Number(index === count - 1);
      u.uAlphaWeight.value = alphaWeights[index];
      (u.uKeep.value as THREE.Vector3).set(Number(index < channels[0]), Number(index < channels[1]), Number(index < channels[2]));
      (u.uWeights.value as THREE.Vector3).set(weights[0][index] ?? 0, weights[1][index] ?? 0, weights[2][index] ?? 0);
      if (extra) {
        this.drawOnto(this.timeBound, extra.bound);
        this.drawOnto(this.timeLight, extra.light);
      }
      this.draw(this.timeGather, next);
      [accum, next] = [next, accum];
    });
    this.slitTargets = [accum, next];
    return accum.texture;
  }

  /** The current frame at half the slice size, which the Brightness map reads its delay from. */
  private slitDriver(original: Layer, phase: number, duration: number): THREE.Texture {
    const driver = this.slitDriverTarget ??= target();
    const width = Math.max(1, Math.round(this.width / 2)), height = Math.max(1, Math.round(this.height / 2));
    if (driver.width !== width || driver.height !== height) driver.setSize(width, height);
    // plainSource reuses its target for every slice, so the frame is copied out.
    this.copy.uniforms.uImage.value = this.plainSource(original, phase, duration);
    this.draw(this.copy, driver);
    return driver.texture;
  }

  /** One feedback step: the source at `phase` over the faded, transformed echo in `from`. */
  private feedbackStep(original: Layer, phase: number, total: number, duration: number, from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget): void {
    const layer = evaluateLayer(original, this.sourcePhase(original, phase, duration));
    const source = slitActive(original) ? this.slitSource(original, phase, total, duration) : this.plainSource(original, phase, duration);
    const p = echoSettings(layer, phase), u = this.feedback.uniforms;
    u.uSource.value = source; u.uPrevious.value = from.texture;
    u.uAspect.value = this.width / this.height;
    u.uZoom.value = p.echoZoom ?? 1;
    u.uRotate.value = (p.echoRotate ?? 0) * Math.PI / 180;
    (u.uDrift.value as THREE.Vector2).set(p.echoDriftX ?? 0, p.echoDriftY ?? 0);
    u.uFade.value = echoFade(p);
    u.uHue.value = (p.echoHue ?? 0) * Math.PI / 180;
    u.uWarp.value = p.echoMelt ?? 0;
    u.uMode.value = p.echoBlend ?? 0;
    u.uHole.value = p.echoFrame ?? 0;
    u.uWindow.value = p.echoWindow ?? 0;
    (u.uCentre.value as THREE.Vector2).set(p.echoCentreX ?? 0, p.echoCentreY ?? 0);
    (u.uTilt.value as THREE.Vector2).set(p.echoTiltX ?? 0, p.echoTiltY ?? 0);
    u.uLens.value = p.echoLens ?? 0; u.uRound.value = p.echoRound ?? 0; u.uSquare.value = p.echoSquare ?? 0;
    u.uStreak.value = p.echoStreak ?? 0; u.uStreakAxis.value = p.echoStreakAxis ?? 0;
    u.uBlock.value = p.echoBlock ?? 0; u.uSlip.value = p.echoSlip ?? 0; u.uCrush.value = p.echoCrush ?? 0; u.uEdge.value = p.echoEdge ?? 0;
    u.uKeep.value = p.echoKeep ?? 0; u.uEvents.value = p.echoEvents ?? 0; u.uColourDrift.value = p.echoColourDrift ?? 0;
    u.uPunch.value = p.echoPunch ?? 0; u.uPixel.value = p.echoPixel ?? 0;
    (u.uTexels.value as THREE.Vector2).set(this.width, this.height);
    // Hashes key on the loop frame, so warm-ups replay identical glitches.
    u.uFrame.value = frameAtPhase(phase, total);
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
    let full = 0;
    for (let k = 0; k < 16; k++) full = Math.max(full, historyFrames(echoSettings(evaluateLayer(original, k * TAU / 16), k * TAU / 16)));
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
    return this.smokeClouds?.needsRefresh() ?? false;
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

  /** Frees the optional finish targets as soon as no visible layer can use them. */
  private releaseTimeTargets(project: Project): void {
    const needs = timeTargetNeeds(project.layers), slit = this.slit.uniforms, gather = this.timeGather.uniforms;
    if (!needs.median && this.medianTarget) { this.medianTarget.dispose(); this.medianTarget = null; this.timeMedian.uniforms.uLayers.value = null; }
    if (!needs.statBound && this.statBoundTarget) {
      this.statBoundTarget.dispose(); this.statBoundTarget = null; gather.uBoundMap.value = this.fallback;
      this.statLightTarget?.dispose(); this.statLightTarget = null; gather.uLightMap.value = this.fallback;
    }
    if (!needs.colourLag && this.slitBoundTarget) {
      this.slitBoundTarget.dispose(); this.slitBoundTarget = null; slit.uBound.value = this.fallback;
      this.slitLagTarget?.dispose(); this.slitLagTarget = null; slit.uLag.value = this.fallback;
    }
    if (!needs.driver && this.slitDriverTarget) { this.slitDriverTarget.dispose(); this.slitDriverTarget = null; slit.uDriver.value = this.fallback; }
    if (this.lensTarget && !project.layers.some(layer => layer.visible && lensActive(layer))) { this.lensTarget.dispose(); this.lensTarget = null; }
    if (this.warpTarget && !project.layers.some(layer => layer.visible && warpActive(layer))) { this.warpTarget.dispose(); this.warpTarget = null; }
  }

  render(project: Project, phase: number, width?: number, height?: number, sound?: { signals: Signals; now: number }, playing = true): void {
    if (this.exporting) return;
    this.previewPlaying = playing;
    const w = width ?? Math.max(1, Math.round(this.canvas.clientWidth || this.canvas.width || 960));
    const h = height ?? Math.max(1, Math.round(this.canvas.clientHeight || this.canvas.height || 540));
    if (sound && project.layers.some(usesEmberSmokeAudio)) this.emberAudio ??= new EmberSmokeAudio();
    else this.emberAudio = undefined;
    const smoke = sound ? this.emberAudio?.advance(sound.signals, sound.now) : undefined;
    this.renderFrame(project, phase, w, h, smoke);
    // Resizing a canvas, even to the size it already has, resets it and re-allocates its drawing buffer:
    // only when the size changes.
    const canvasSize = this.renderer.getSize(this.canvasSize);
    if (canvasSize.x !== w || canvasSize.y !== h) this.renderer.setSize(w, h, false);
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
    u.uWrap.value = Number(this.tiling);
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
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    for (const asset of this.assets.values()) asset.texture.dispose();
    this.assets.clear();
    for (const rt of [this.source, this.fractalPreview, this.accumA, this.accumB, this.linearOutput, this.byteOutput, this.resolved, this.environment]) rt.dispose();
    this.releaseOilTargets();
    this.graphicSource?.dispose(); this.graphicSource = null;
    this.super8Source?.dispose(); this.super8Source = null;
    for (const state of this.feedbackStates.values()) this.disposeFeedback(state);
    this.slitTargets?.forEach(rt => rt.dispose()); this.slitTargets = null;
    this.slitDriverTarget?.dispose(); this.slitDriverTarget = null;
    this.slitBoundTarget?.dispose(); this.slitBoundTarget = null;
    this.slitLagTarget?.dispose(); this.slitLagTarget = null;
    this.statBoundTarget?.dispose(); this.statBoundTarget = null;
    this.statLightTarget?.dispose(); this.statLightTarget = null;
    this.medianTarget?.dispose(); this.medianTarget = null;
    this.feedbackStates.clear();
    this.glow?.bright.dispose(); this.glow?.pyramid.dispose(); this.glow?.streak.dispose(); this.glow = null; this.glowBright.dispose();
    this.tiledSurface?.dispose(); this.tiledSurface = null;
    this.lensTarget?.dispose(); this.lensTarget = null; this.lens.dispose();
    this.warpTarget?.dispose(); this.warpTarget = null; this.warp.dispose();
    this.graphics.dispose(); this.instruments.dispose();
    for (const mat of [this.super8, this.super8Projector, this.oilFields, this.oilPaint, this.oilLens, this.liquid, this.surface, this.fractal, this.copy, this.image, this.composite, this.finish, this.display, this.downsample, this.feedback, this.slit, this.slitBound, this.slitLag, this.timeGather, this.timeBound, this.timeLight, this.timeMedian, this.sculptureMaterial, this.sculptureDepthMaterial]) mat.dispose();
    this.oilPattern.dispose();
    this.scope?.dispose(); this.scope = null;
    this.smokeClouds?.dispose(); this.smokeClouds = null;
    this.plainOver?.dispose(); this.plainOver = null;
    this.sliceSource?.dispose(); this.sliceSource = null;
    this.sliceSourceSmooth?.dispose(); this.sliceSourceSmooth = null;
    for (const texture of this.liquidLayouts.values()) texture.dispose();
    this.liquidLayouts.clear();
    this.sculptureGeometry.dispose(); this.sculptureTorusGeometry.dispose(); this.quadGeometry.dispose(); this.fallback.dispose(); this.filmThickness.dispose();
    this.keyLight.shadow.dispose();
    this.renderer.dispose();
  }
}
