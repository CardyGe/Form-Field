/**
 * The wall's drawing on the graphics card (stage 4). One WebGL2 context on the stage canvas:
 * - shapes are drawn back to front into a stage-sized framebuffer, each as one rectangle over its box: its picture
 *   (an instrument texture, its own fill picture, or a colour; two of them during a crossfade) through its placement
 *   transform, given brightness and tint, cut by its coverage picture, with its border picture laid on top;
 * - the overlay picture (test grid, names, identify, crosshair) is laid over the stage;
 * - the stage goes to the canvas last, through the stage corners;
 * - a small flat copy of the stage is read back for the operator screen without waiting for the graphics card.
 * Pictures are premultiplied; coordinates are stage pixels with the origin top-left.
 */
import { STAGE_SIZE } from './show';
import { IDENTITY, type H3 } from './homography';
import { VERTEX, WallLimiterGl } from './wall-limiter-gl';
import { GUARD_COLUMNS, GUARD_MAX_STEP, GUARD_ROWS, flashGuardApplyGLSL, flashGuardGateGLSL, flashGuardStepGLSL } from '../rendering/flash-guard';


const SHAPE = `#version 300 es
precision highp float;
in vec2 vStage;
out vec4 o;
uniform vec4 uRect;
uniform sampler2D uCoverage;
uniform int uKind;          // 0 colour, 1 picture
uniform vec4 uColour;
uniform sampler2D uPicture;
uniform mat3 uInv;          // stage pixels to picture coordinates
uniform int uFromKind;      // -1 none, 0 colour, 1 picture
uniform vec4 uFromColour;
uniform sampler2D uFrom;
uniform mat3 uFromInv;      // the old picture keeps its own placement
uniform float uMix;
uniform int uHueOn;         // Perform: 1 turns the picture's hue; 0 leaves it exactly as it is
uniform vec2 uHue;          // the turn's cosine and sine
uniform vec3 uLook;         // brightness times tint
uniform float uAlpha;       // opacity, for drawing only (links, scene glides)
uniform int uDecor;
uniform float uDecorAlpha;  // Perform: how strongly the border shows through a blend; 1 otherwise
uniform sampler2D uDecorTex;
uniform int uRun;           // border runs: the border shows only the run's lit part
uniform sampler2D uRunTex;  // each border pixel's place round the outline, as an angle
uniform vec2 uRunAt;        // the head (0..1) and the length (0..1)
vec4 picture(sampler2D t, mat3 inv) {
  vec3 q = inv * vec3(vStage, 1.);
  if (q.z <= 0.) return vec4(0.);
  vec2 uv = q.xy / q.z;
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return vec4(0.);
  return texture(t, uv);
}
void main() {
  vec2 cu = (vStage - uRect.xy) / uRect.zw;
  float cover = texture(uCoverage, cu).a;
  // The border picture is already cut to the outline: it sits crisp on top of the (soft-edged) content.
  vec4 d = uDecor == 1 ? texture(uDecorTex, cu) * uDecorAlpha : vec4(0.);
  if (uRun == 1) {
    vec4 r = texture(uRunTex, cu);
    // Holes' borders (no place round the outer outline) keep their steady border.
    float lit = 1.;
    if (r.a > .02) {
      float t = fract(atan(r.g - .5 * r.a, r.r - .5 * r.a) / 6.2831853);
      float behind = fract(uRunAt.x - t);
      // Brightest at the head, fading to nothing at the tail; a soft edge just ahead of the head.
      lit = behind < uRunAt.y ? 1. - behind / uRunAt.y : smoothstep(.996, 1., behind);
    }
    d *= lit;
  }
  if (cover <= 0. && d.a <= 0.) discard;
  vec4 c = uKind == 1 ? picture(uPicture, uInv) : uColour;
  if (uFromKind >= 0) c = mix(uFromKind == 1 ? picture(uFrom, uFromInv) : uFromColour, c, uMix);
  if (uHueOn == 1) {
    // A turn round the grey axis: white, grey and black stay as they are. Kept inside the picture's own alpha.
    vec3 k = vec3(.57735027);
    c.rgb = clamp(c.rgb * uHue.x + cross(k, c.rgb) * uHue.y + k * dot(k, c.rgb) * (1. - uHue.x), 0., c.a);
  }
  c.rgb *= uLook;
  c *= cover;
  o = (d + c * (1. - d.a)) * uAlpha;
}`;

const LAYER = `#version 300 es
precision highp float;
in vec2 vStage;
out vec4 o;
uniform vec2 uStage;
uniform sampler2D uTex;
void main() { o = texture(uTex, vStage / uStage); }`;

/** Canvas pixels to stage pixels through uInv; the stage framebuffer is stored bottom row first. */
const FINAL = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uOut;          // the target's size in pixels
uniform vec2 uStage;
uniform mat3 uInv;          // target pixels (origin top-left) to stage pixels
uniform sampler2D uTex;
uniform float uMaster;      // Perform's master level over the whole stage; 1 for none
uniform float uGain, uRedScale;  // the flash limiter: 1 and 1 leave the picture exactly as it is
void main() {
  vec2 p = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y) * (uStage / uOut);
  vec3 q = uInv * vec3(p, 1.);
  vec2 s = q.xy / q.z;
  if (q.z <= 0. || s.x < 0. || s.y < 0. || s.x > uStage.x || s.y > uStage.y) { o = vec4(0., 0., 0., 1.); return; }
  vec4 c = texture(uTex, vec2(s.x / uStage.x, 1. - s.y / uStage.y));
  // Master first: the flash limiter measures and corrects what the wall really shows.
  vec3 v = c.rgb * uMaster;
  if (uGain < 1. || uRedScale < 1.) {
    v = pow(max(v, vec3(0.)), vec3(2.2));
    v = (vec3(dot(v, vec3(.2126, .7152, .0722))) * (1. - uRedScale) + v * uRedScale) * uGain;
    v = pow(v, vec3(1. / 2.2));
  }
  o = vec4(v, 1.);  // premultiplied over the black stage
}`;

/** Advances the flash guard's cells from the finished stage. */
const GUARD = `#version 300 es
precision highp float;
out vec4 o;
${flashGuardStepGLSL}
void main() { o = flashGuardStep(gl_FragCoord.xy / vec2(${GUARD_COLUMNS}., ${GUARD_ROWS}.)); }`;

/** One pixel saying how much of the screen is over its flash budget. */
const GUARD_GATE = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uStage;
${flashGuardGateGLSL}
void main() { o = flashGuardGate(); }`;

/** The guarded stage: this frame, with held cells blended towards the last frame shown. */
const GUARD_SHOW = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uStage;
${flashGuardApplyGLSL}
void main() { o = flashGuardShow(gl_FragCoord.xy / uStage); }`;

export interface Texture { tex: WebGLTexture; width: number; height: number }
/** One shape to draw. Matrices are 3 × 3, row major, from stage pixels to the picture's 0..1 square. */
export interface ShapeDraw {
  rect: { x: number; y: number; w: number; h: number };
  coverage: Texture;
  content: { kind: 'colour'; rgba: [number, number, number, number] } | { kind: 'picture'; texture: Texture; inv: H3 };
  from: { kind: 'colour'; rgba: [number, number, number, number] } | { kind: 'picture'; texture: Texture; inv: H3 } | null;
  mix: number;
  look: [number, number, number];
  decor: Texture | null;
  /** 0..1; 1 when missing. */
  alpha?: number;
  /** A border run: the border's position picture, where the head is and how long the run is (0..1 of the lap). */
  run?: { texture: Texture; head: number; length: number } | null;
  /** Perform: how strongly the border shows while its shape blends, 0..1; 1 when missing. */
  decorAlpha?: number;
  /** Perform: degrees to turn the picture's hue by; 0 or missing leaves it alone. The border is not turned. */
  hueDeg?: number;
}

/** Stage pixels to a picture made by Gpu.hold() over `rect`. */
export const heldInverse = (rect: { x: number; y: number; w: number; h: number }): H3 => [1 / rect.w, 0, -rect.x / rect.w, 0, -1 / rect.h, 1 + rect.y / rect.h, 0, 0, 1];

type Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
/** Read back at twice the preview's size, so the worker can shrink it smoothly and thin lines do not drop out. */
const PREVIEW = { width: 960, height: 540 };
/** The small uncorrected copy of the wall that the flash limiter reads each frame. */
export const FLASH_PROBE = { width: 64, height: 36 };
const FLASH_PROBES = 6;

/** Row major to the column-major order WebGL reads. */
const columns = (m: H3) => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);

export class Gpu {
  readonly gl: WebGL2RenderingContext;
  private shapeP!: Program;
  private layerP!: Program;
  private finalP!: Program;
  private quad!: WebGLVertexArrayObject;
  private stageTex!: WebGLTexture;
  private stageFb!: WebGLFramebuffer;
  private previewTex!: WebGLTexture;
  private previewFb!: WebGLFramebuffer;
  private copyFb!: WebGLFramebuffer;
  private drawFb!: WebGLFramebuffer;
  private blank!: Texture;
  private solid!: Texture;
  /** Perform's master level, as last drawn: the operator's preview shows it too. */
  private master = 1;
  private limiter!: WallLimiterGl;
  private stageCopy: WebGLTexture | null = null;
  private pointsFb: WebGLFramebuffer | null = null;
  private pointsStride = 0;
  /** Why the wall limiter could not be built; null when it is fine or not yet needed. */
  get guardError(): string | null { return this.limiter.error; }
  /** The share of the wall last found trying to change, read back a few times a second for the operator only. */
  get limitedArea(): number { return this.limiter.limitedArea; }
  private guardP!: Program;
  private guardShowP!: Program;
  private guardGateP!: Program;
  /** The screen-wide gate, one pixel, read from one and written to the other each frame. */
  private guardGates: { tex: WebGLTexture; fb: WebGLFramebuffer }[] | null = null;
  /** The last two guarded stages: index 0 is what the wall shows. */
  private guardFrames: { tex: WebGLTexture; fb: WebGLFramebuffer }[] | null = null;
  /** The flash guard's cells, read from one and written to the other each frame. Null if this card cannot hold them. */
  private guardTargets: { tex: WebGLTexture; fb: WebGLFramebuffer }[] | null = null;
  private guardFresh = true;
  private guardShown = false;
  private readback: { buffer: WebGLBuffer; sync: WebGLSync } | null = null;
  private flashReads: { sync: WebGLSync; buffer: WebGLBuffer; time: number }[] = [];
  private flashBuffers: WebGLBuffer[] = [];
  private flashFb!: WebGLFramebuffer;
  private correction = { gain: 1, redScale: 1 };
  private readbackBuffer: WebGLBuffer | null = null;
  /** Goes up whenever the context is set up again: a readback started before it will never arrive. */
  generation = 0;
  /** Whether a preview is on its way. */
  get previewPending(): boolean { return this.readback !== null; }

  /**
   * The picture is kept after it is shown (preserveDrawingBuffer), so a frame that draws nothing new leaves the wall
   * as it was, and the operator screen and the scripted checks can copy it.
   */
  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('This screen cannot draw the stage on its graphics card.');
    this.gl = gl;
    this.setUp();
  }

  /** Programs, buffers and the stage framebuffer. Called again after a lost context is restored. */
  setUp(): void {
    const gl = this.gl;
    const compile = (fragment: string, uniforms: string[]) => this.compile(fragment, uniforms);
    this.shapeP = compile(SHAPE, ['uRect', 'uStage', 'uCoverage', 'uKind', 'uColour', 'uPicture', 'uInv', 'uFromKind', 'uFromColour', 'uFrom', 'uFromInv', 'uMix', 'uHueOn', 'uHue', 'uLook', 'uAlpha', 'uDecor', 'uDecorAlpha', 'uDecorTex', 'uRun', 'uRunTex', 'uRunAt']);
    this.layerP = compile(LAYER, ['uRect', 'uStage', 'uTex']);
    this.finalP = compile(FINAL, ['uRect', 'uStage', 'uOut', 'uInv', 'uTex', 'uMaster', 'uGain', 'uRedScale']);
    this.guardP = compile(GUARD, ['uRect', 'uStage', 'uGuardSource', 'uGuardLast', 'uGuardState', 'uGuardGate', 'uGuardSeconds', 'uGuardReset', 'uGuardEncoded']);
    this.guardGateP = compile(GUARD_GATE, ['uRect', 'uStage', 'uGuardCells', 'uGuardGateLast', 'uGuardSeconds', 'uGuardReset']);
    this.guardShowP = compile(GUARD_SHOW, ['uRect', 'uStage', 'uGuardImage', 'uGuardPrevious', 'uGuardCells', 'uGuardImageEncoded']);
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const target = (w: number, h: number) => this.target(w, h);
    ({ tex: this.stageTex, fb: this.stageFb } = target(STAGE_SIZE.width, STAGE_SIZE.height));
    ({ tex: this.previewTex, fb: this.previewFb } = target(PREVIEW.width, PREVIEW.height));
    this.flashFb = target(FLASH_PROBE.width, FLASH_PROBE.height).fb;
    // The wall guard's passes are built the first time a show with Meridian needs them.
    this.limiter = new WallLimiterGl(gl, STAGE_SIZE.width, STAGE_SIZE.height, this.quad);
    this.stageCopy = null; this.pointsFb = null;
    this.copyFb = gl.createFramebuffer()!;
    this.drawFb = gl.createFramebuffer()!;
    this.guardTargets = null; this.guardFrames = null; this.guardGates = null; this.guardFresh = true; this.guardShown = false;
    if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) {
      const floatTarget = (width: number, height: number) => {
        const tex = this.texture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
        const fb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return { tex, fb };
      };
      this.guardTargets = [floatTarget(GUARD_COLUMNS, GUARD_ROWS), floatTarget(GUARD_COLUMNS, GUARD_ROWS)];
      this.guardGates = [floatTarget(1, 1), floatTarget(1, 1)];
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.guardTargets = null; this.guardGates = null; }
      else this.guardFrames = [target(STAGE_SIZE.width, STAGE_SIZE.height), target(STAGE_SIZE.width, STAGE_SIZE.height)];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // A one-pixel transparent picture for samplers with nothing to show.
    const blank = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.blank = { tex: blank, width: 1, height: 1 };
    // And a one-pixel solid one: full coverage, for a picture held whole.
    const solid = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.solid = { tex: solid, width: 1, height: 1 };
    this.readback = null; this.readbackBuffer = null;
    this.flashReads = []; this.flashBuffers = [];
    this.generation++;
  }

  private compile(fragment: string, uniforms: string[], vertex = VERTEX): Program {
    const gl = this.gl;
    const make = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, make(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, make(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'aUnit');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program');
    return { program, u: Object.fromEntries(uniforms.map(n => [n, gl.getUniformLocation(program, n)])) };
  }

  private target(w: number, h: number): { tex: WebGLTexture; fb: WebGLFramebuffer } {
    const gl = this.gl, tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb };
  }

  private texture(): WebGLTexture {
    const gl = this.gl, tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** A picture from a canvas: made, or its existing texture filled again. */
  upload(source: TexImageSource & { width: number; height: number }, into: Texture | null): Texture {
    const gl = this.gl;
    const t = into ?? { tex: this.texture(), width: 0, height: 0 };
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    // The same size again (an instrument every frame) refills the texture in place instead of making it anew.
    if (into && into.width === source.width && into.height === source.height) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    t.width = source.width; t.height = source.height;
    return t;
  }

  /** A copy of a picture, for crossfades: the original keeps changing while the copy holds. */
  copy(source: Texture): Texture {
    const gl = this.gl, t = { tex: this.texture(), width: source.width, height: source.height };
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFb);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source.tex, 0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 0, 0, source.width, source.height, 0);
    // Let go of the source, so a texture deleted later is not kept alive by this framebuffer.
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return t;
  }

  /** A copy of a picture at another size (Stagger's history), into `into` when it is already that size. */
  scaledCopy(source: Texture, into: Texture | null, width: number, height: number): Texture {
    const gl = this.gl;
    let t = into;
    if (!t || t.width !== width || t.height !== height) {
      this.free(t);
      t = { tex: this.texture(), width, height };
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFb);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source.tex, 0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.drawFb);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.blitFramebuffer(0, 0, source.width, source.height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    return t;
  }

  free(t: Texture | null | undefined): void { if (t) this.gl.deleteTexture(t.tex); }

  /** Starts a stage: black, in the stage framebuffer, with premultiplied blending. */
  begin(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stageFb);
    gl.viewport(0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.quad);
  }

  shape(d: ShapeDraw): void {
    const gl = this.gl, { program, u } = this.shapeP;
    gl.useProgram(program);
    gl.uniform4f(u.uRect, d.rect.x, d.rect.y, d.rect.w, d.rect.h);
    gl.uniform2f(u.uStage, STAGE_SIZE.width, STAGE_SIZE.height);
    const bind = (unit: number, name: string, t: Texture | null) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, (t ?? this.blank).tex); gl.uniform1i(u[name], unit); };
    bind(0, 'uCoverage', d.coverage);
    if (d.content.kind === 'picture') { gl.uniform1i(u.uKind, 1); bind(1, 'uPicture', d.content.texture); gl.uniformMatrix3fv(u.uInv, false, columns(d.content.inv)); }
    else { gl.uniform1i(u.uKind, 0); gl.uniform4fv(u.uColour, d.content.rgba); bind(1, 'uPicture', null); gl.uniformMatrix3fv(u.uInv, false, columns(IDENTITY)); }
    if (!d.from) { gl.uniform1i(u.uFromKind, -1); bind(2, 'uFrom', null); }
    else if (d.from.kind === 'picture') {
      gl.uniform1i(u.uFromKind, 1); bind(2, 'uFrom', d.from.texture);
      gl.uniformMatrix3fv(u.uFromInv, false, columns(d.from.inv));
    } else { gl.uniform1i(u.uFromKind, 0); gl.uniform4fv(u.uFromColour, d.from.rgba); bind(2, 'uFrom', null); }
    gl.uniform1f(u.uMix, d.mix);
    const hue = d.hueDeg ? d.hueDeg * Math.PI / 180 : 0;
    gl.uniform1i(u.uHueOn, hue ? 1 : 0);
    if (hue) gl.uniform2f(u.uHue, Math.cos(hue), Math.sin(hue));
    gl.uniform3f(u.uLook, ...d.look);
    gl.uniform1f(u.uAlpha, d.alpha ?? 1);
    gl.uniform1i(u.uDecor, d.decor ? 1 : 0); bind(3, 'uDecorTex', d.decor);
    gl.uniform1f(u.uDecorAlpha, d.decorAlpha ?? 1);
    gl.uniform1i(u.uRun, d.run && d.decor ? 1 : 0); bind(4, 'uRunTex', d.run?.texture ?? null);
    gl.uniform2f(u.uRunAt, d.run?.head ?? 0, d.run?.length ?? 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Perform: what a shape shows right now (a part-finished blend of two pictures), kept as one picture, so a new
   * blend can start from exactly what is on the wall. Drawn without the shape's look, coverage or border, over `rect`
   * (whole stage pixels). Like the stage it is stored bottom row first: heldInverse() is the way back to it.
   */
  hold(d: Pick<ShapeDraw, 'content' | 'from' | 'mix'>, rect: { x: number; y: number; w: number; h: number }): Texture {
    const gl = this.gl, t = { tex: this.texture(), width: rect.w, height: rect.h };
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, rect.w, rect.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    // The stage's own mapping, moved so that the rectangle fills the picture.
    gl.viewport(-rect.x, rect.y + rect.h - STAGE_SIZE.height, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.quad);
    this.shape({ rect, coverage: this.solid, content: d.content, from: d.from, mix: d.mix, look: [1, 1, 1], decor: null });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.BLEND);
    return t;
  }

  /**
   * The wall limiter, in the frame being drawn, with no readback in its path: measures the stage as drawn so far, updates each
   * cell's allowed light, and applies it to the flat stage before the overlays and corners. `init` starts from this picture;
   * `fade` (0 to 1) eases the limit away. Returns false if the limiter is unavailable, leaving the picture as it is.
   */
  limitStage(dt: number, fade: number, init: boolean, holds: { light: number; red: number } = { light: 1, red: 1 }): boolean {
    if (!this.limiter.ready()) { this.backToStage(); return false; }
    const gl = this.gl;
    // The limiter reads a copy of the stage and draws the limited picture back over it.
    this.backToStage();
    gl.activeTexture(gl.TEXTURE0);
    if (!this.stageCopy) {
      this.stageCopy = this.texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, STAGE_SIZE.width, STAGE_SIZE.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.stageCopy);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    const done = this.limiter.limit(this.stageCopy, this.stageFb, dt, fade, init, holds);
    gl.bindVertexArray(this.quad);
    this.backToStage();
    return done;
  }

  /** For the scripted checks: the flat stage's pixels as they stand. */
  readStage(out: Uint8Array): void {
    this.backToStage();
    this.gl.readPixels(0, 0, STAGE_SIZE.width, STAGE_SIZE.height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, out);
  }

  /** For the scripted checks: every `stride`th pixel of the flat stage, exactly as it stands, unfiltered. */
  readStagePoints(out: Uint8Array, stride: number): void {
    const gl = this.gl, w = Math.floor(STAGE_SIZE.width / stride), h = Math.floor(STAGE_SIZE.height / stride);
    if (!this.pointsFb || this.pointsStride !== stride) {
      ({ fb: this.pointsFb } = this.target(w, h)); this.pointsStride = stride;
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.stageFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.pointsFb);
    gl.blitFramebuffer(0, 0, w * stride, h * stride, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.pointsFb);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    this.backToStage();
  }

  backToStage(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stageFb);
    gl.viewport(0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.enable(gl.BLEND);
  }

  /** A stage-sized picture laid over everything drawn so far. */
  layer(t: Texture): void {
    const gl = this.gl, { program, u } = this.layerP;
    gl.useProgram(program);
    gl.uniform4f(u.uRect, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform2f(u.uStage, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(u.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Whether the flash guard can run on this graphics card. */
  get guardAvailable(): boolean { return this.guardTargets !== null; }

  /** One flash-guard step from the finished stage. The next step after a pause starts afresh. */
  private stepGuard(seconds: number): void {
    const gl = this.gl, targets = this.guardTargets, frames = this.guardFrames, gates = this.guardGates;
    if (!targets || !frames || !gates) { this.guardShown = false; return; }
    const { program, u } = this.guardP;
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1].fb);
    gl.viewport(0, 0, GUARD_COLUMNS, GUARD_ROWS);
    gl.useProgram(program);
    gl.uniform4f(u.uRect, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform2f(u.uStage, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.stageTex); gl.uniform1i(u.uGuardSource, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, targets[0].tex); gl.uniform1i(u.uGuardState, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.guardFresh ? this.stageTex : frames[0].tex); gl.uniform1i(u.uGuardLast, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, gates[0].tex); gl.uniform1i(u.uGuardGate, 3);
    gl.uniform1f(u.uGuardSeconds, Number.isFinite(seconds) ? Math.max(0, Math.min(GUARD_MAX_STEP, seconds)) : 0);
    gl.uniform1f(u.uGuardReset, this.guardFresh ? 1 : 0);
    gl.uniform1f(u.uGuardEncoded, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    targets.reverse();
    // How much of the screen is over budget now decides whether the next frame holds anything.
    const gate = this.guardGateP;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gates[1].fb);
    gl.viewport(0, 0, 1, 1);
    gl.useProgram(gate.program);
    gl.uniform4f(gate.u.uRect, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform2f(gate.u.uStage, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform1f(gate.u.uGuardSeconds, Number.isFinite(seconds) ? Math.max(0, Math.min(GUARD_MAX_STEP, seconds)) : 0);
    gl.uniform1f(gate.u.uGuardReset, this.guardFresh ? 1 : 0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.blank.tex);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, targets[0].tex); gl.uniform1i(gate.u.uGuardCells, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, gates[0].tex); gl.uniform1i(gate.u.uGuardGateLast, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gates.reverse();
    // The frame the audience sees, kept as the next frame's "last shown".
    const show = this.guardShowP;
    gl.bindFramebuffer(gl.FRAMEBUFFER, frames[1].fb);
    gl.viewport(0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.useProgram(show.program);
    gl.uniform4f(show.u.uRect, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform2f(show.u.uStage, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform1f(show.u.uGuardImageEncoded, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.stageTex); gl.uniform1i(show.u.uGuardImage, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.guardFresh ? this.stageTex : frames[0].tex); gl.uniform1i(show.u.uGuardPrevious, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, targets[0].tex); gl.uniform1i(show.u.uGuardCells, 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frames.reverse();
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.blank.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.blank.tex);
    gl.activeTexture(gl.TEXTURE0);
    this.guardFresh = false; this.guardShown = true;
  }

  /**
   * The stage to the canvas. inv: canvas pixels to stage pixels (the stage corners), or the identity.
   * master: Perform's master level, 1 without a show. guardSeconds: time since the last drawn frame, for the flash guard; null turns the guard off for this frame.
   */
  finish(inv: H3 = IDENTITY, master = 1, guardSeconds: number | null = null): void {
    const gl = this.gl;
    this.master = master;
    if (guardSeconds === null) { this.guardFresh = true; this.guardShown = false; }
    else this.stepGuard(guardSeconds);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.flat(inv, this.canvas.width, this.canvas.height);
  }

  /** The flash limiter's correction, applied to everything that leaves the stage. */
  setOutputCorrection(gain: number, redScale: number): void { this.correction = { gain, redScale }; }

  /** Starts reading a tiny copy of the stage, at Perform's master level but before the limiter's own correction. Several can be on their way, so a slow fence never skips frames. */
  requestFlashProbe(time = 0): boolean {
    if (this.flashReads.length >= FLASH_PROBES) return false;
    const gl = this.gl, { width, height } = FLASH_PROBE;
    const buffer = this.flashBuffers.pop() ?? gl.createBuffer();
    if (!buffer) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.flashFb);
    gl.viewport(0, 0, width, height);
    this.flat(IDENTITY, width, height, false);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, width * height * 4, gl.STREAM_READ);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) { this.flashBuffers.push(buffer); return false; }
    this.flashReads.push({ sync, buffer, time });
    gl.flush();
    return true;
  }

  /** The oldest finished probe and when it was taken; null while none is ready. Never waits. */
  collectFlashProbe(): { pixels: Uint8Array; time: number } | null {
    const read = this.flashReads[0];
    if (!read) return null;
    const gl = this.gl, state = gl.clientWaitSync(read.sync, 0, 0);
    if (state !== gl.ALREADY_SIGNALED && state !== gl.CONDITION_SATISFIED) return null;
    gl.deleteSync(read.sync);
    this.flashReads.shift();
    const pixels = new Uint8Array(FLASH_PROBE.width * FLASH_PROBE.height * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, read.buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.flashBuffers.push(read.buffer);
    return { pixels, time: read.time };
  }

  private flat(inv: H3, w: number, h: number, corrected = true): void {
    const gl = this.gl, { program, u } = this.finalP;
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.uniform4f(u.uRect, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform2f(u.uStage, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform2f(u.uOut, w, h);
    gl.uniform1f(u.uGain, corrected ? this.correction.gain : 1);
    gl.uniform1f(u.uRedScale, corrected ? this.correction.redScale : 1);
    gl.uniformMatrix3fv(u.uInv, false, columns(inv));
    gl.uniform1f(u.uMaster, this.master);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.guardShown && this.guardFrames ? this.guardFrames[0].tex : this.stageTex); gl.uniform1i(u.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
  }

  /** Starts reading a small flat copy of the stage back, unless one is already on its way. */
  requestPreview(): boolean {
    if (this.readback) return false;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.previewFb);
    gl.viewport(0, 0, PREVIEW.width, PREVIEW.height);
    this.flat(IDENTITY, PREVIEW.width, PREVIEW.height);
    this.readbackBuffer ??= gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.readbackBuffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, PREVIEW.width * PREVIEW.height * 4, gl.STREAM_READ);
    gl.readPixels(0, 0, PREVIEW.width, PREVIEW.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return false;
    this.readback = { buffer: this.readbackBuffer!, sync };
    gl.flush();
    return true;
  }

  /** The preview, once the graphics card has finished it; null while it is still on its way. Never waits. */
  collectPreview(): ImageData | null {
    if (!this.readback) return null;
    const gl = this.gl, { buffer, sync } = this.readback;
    const state = gl.clientWaitSync(sync, 0, 0);
    if (state !== gl.ALREADY_SIGNALED && state !== gl.CONDITION_SATISFIED) return null;
    gl.deleteSync(sync);
    this.readback = null;
    const { width: w, height: h } = PREVIEW, bytes = new Uint8Array(w * h * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    // Rows come bottom first.
    const out = new ImageData(w, h);
    for (let y = 0; y < h; y++) out.data.set(bytes.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return out;
  }
}
