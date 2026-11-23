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

const VERTEX = `#version 300 es
in vec2 aUnit;
uniform vec4 uRect;      // x, y, width, height in stage pixels
uniform vec2 uStage;
out vec2 vStage;
void main() {
  vStage = uRect.xy + aUnit * uRect.zw;
  gl_Position = vec4(vStage.x / uStage.x * 2. - 1., 1. - vStage.y / uStage.y * 2., 0., 1.);
}`;

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
uniform vec3 uLook;         // brightness times tint
uniform float uAlpha;       // opacity, for drawing only (links, scene glides)
uniform int uDecor;
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
  vec4 d = uDecor == 1 ? texture(uDecorTex, cu) : vec4(0.);
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
void main() {
  vec2 p = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y) * (uStage / uOut);
  vec3 q = uInv * vec3(p, 1.);
  vec2 s = q.xy / q.z;
  if (q.z <= 0. || s.x < 0. || s.y < 0. || s.x > uStage.x || s.y > uStage.y) { o = vec4(0., 0., 0., 1.); return; }
  vec4 c = texture(uTex, vec2(s.x / uStage.x, 1. - s.y / uStage.y));
  o = vec4(c.rgb, 1.);  // premultiplied over the black stage
}`;

const LINEAR = `vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }`;
/** Wall Flash Guard: each output pixel is the true average light of a block of the source, kept as its square root in 8 bits. */
const MEASURE = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uTex;
uniform int uCell;
uniform int uEncoded;       // 1: the source holds the square root of light; 0: it is the display-encoded stage
// The sRGB curve to within about 1%, without a pow for each of the many texels read here.
vec3 lin(vec3 c) { return c * (c * (c * .305306011 + .682171111) + .012522878); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * uCell;
  vec3 sum = vec3(0.);
  for (int y = 0; y < uCell; y++) for (int x = 0; x < uCell; x++) {
    vec3 c = texelFetch(uTex, p + ivec2(x, y), 0).rgb;
    sum += uEncoded == 1 ? c * c : lin(c);
  }
  o = vec4(sqrt(sum / float(uCell * uCell)), 1.);
}`;
/** The wall's master dim, in linear light, on the flat stage: before the corners, so it can never touch geometry. */
const DIM = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uTex;
uniform float uGain;
uniform float uSaturation;
${LINEAR}
void main() {
  vec4 c = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0);
  vec3 l = lin(c.rgb);
  float grey = dot(l, vec3(.2126, .7152, .0722));
  l = max(vec3(grey) + (l - vec3(grey)) * uSaturation, vec3(0.)) * uGain;
  o = vec4(enc(l), c.a);
}`;
const MEASURE_MIDDLE = { width: 480, height: 270 };
const MEASURE_SIZE = { width: 48, height: 27 };
const MEASURE_SLOTS = 4;
interface MeasureSlot { buffer: WebGLBuffer; sync: WebGLSync | null; at: number; gain: number }

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
}

type Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
/** Read back at twice the preview's size, so the worker can shrink it smoothly and thin lines do not drop out. */
const PREVIEW = { width: 960, height: 540 };

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
  private measureP!: Program;
  private dimP!: Program;
  private middleTex!: WebGLTexture;
  private middleFb!: WebGLFramebuffer;
  private smallTex!: WebGLTexture;
  private smallFb!: WebGLFramebuffer;
  private dimCopy: WebGLTexture | null = null;
  private guardState: 'unbuilt' | 'ready' | 'failed' = 'unbuilt';
  /** Why the wall guard could not be built; null when it is fine or not yet needed. */
  guardError: string | null = null;
  /** The gain the reading last collected was shown with. */
  measuredGain = 1;
  get measurePending(): boolean { return this.measureHead !== this.measureTail; }
  private measures: MeasureSlot[] = [];
  private measureHead = 0;
  private measureTail = 0;
  private timer: { ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }; query: WebGLQuery | null; running: boolean } | null = null;
  /** The graphics card's time for the wall guard's measuring passes, in ms, where the driver can report it. */
  guardGpuMs: number | null = null;
  private readback: { buffer: WebGLBuffer; sync: WebGLSync } | null = null;
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
    this.shapeP = compile(SHAPE, ['uRect', 'uStage', 'uCoverage', 'uKind', 'uColour', 'uPicture', 'uInv', 'uFromKind', 'uFromColour', 'uFrom', 'uFromInv', 'uMix', 'uLook', 'uAlpha', 'uDecor', 'uDecorTex', 'uRun', 'uRunTex', 'uRunAt']);
    this.layerP = compile(LAYER, ['uRect', 'uStage', 'uTex']);
    this.finalP = compile(FINAL, ['uRect', 'uStage', 'uOut', 'uInv', 'uTex']);
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const target = (w: number, h: number) => this.target(w, h);
    ({ tex: this.stageTex, fb: this.stageFb } = target(STAGE_SIZE.width, STAGE_SIZE.height));
    ({ tex: this.previewTex, fb: this.previewFb } = target(PREVIEW.width, PREVIEW.height));
    // The wall guard's passes are built the first time a show with Meridian needs them.
    this.guardState = 'unbuilt'; this.guardError = null;
    this.dimCopy = null; this.measures = []; this.measureHead = this.measureTail = 0;
    this.timer = null; this.guardGpuMs = null;
    this.copyFb = gl.createFramebuffer()!;
    this.drawFb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // A one-pixel transparent picture for samplers with nothing to show.
    const blank = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.blank = { tex: blank, width: 1, height: 1 };
    this.readback = null; this.readbackBuffer = null;
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

  /** Builds the wall guard's passes once. A failure is reported and never reaches the stage's own drawing. */
  private ensureGuard(): boolean {
    if (this.guardState !== 'unbuilt') return this.guardState === 'ready';
    const gl = this.gl;
    try {
      this.measureP = this.compile(MEASURE, ['uRect', 'uStage', 'uTex', 'uCell', 'uEncoded']);
      this.dimP = this.compile(DIM, ['uRect', 'uStage', 'uTex', 'uGain', 'uSaturation']);
      ({ tex: this.middleTex, fb: this.middleFb } = this.target(MEASURE_MIDDLE.width, MEASURE_MIDDLE.height));
      ({ tex: this.smallTex, fb: this.smallFb } = this.target(MEASURE_SIZE.width, MEASURE_SIZE.height));
      this.measures = Array.from({ length: MEASURE_SLOTS }, () => {
        const buffer = gl.createBuffer()!;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, MEASURE_SIZE.width * MEASURE_SIZE.height * 4, gl.STREAM_READ);
        return { buffer, sync: null, at: 0, gain: 1 };
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
      this.timer = timerExt ? { ext: timerExt, query: null, running: false } : null;
      this.guardState = 'ready';
    } catch (error) {
      this.guardState = 'failed'; this.guardError = String((error as Error)?.message ?? error);
    }
    this.backToStage();
    return this.guardState === 'ready';
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
    gl.uniform3f(u.uLook, ...d.look);
    gl.uniform1f(u.uAlpha, d.alpha ?? 1);
    gl.uniform1i(u.uDecor, d.decor ? 1 : 0); bind(3, 'uDecorTex', d.decor);
    gl.uniform1i(u.uRun, d.run && d.decor ? 1 : 0); bind(4, 'uRunTex', d.run?.texture ?? null);
    gl.uniform2f(u.uRunAt, d.run?.head ?? 0, d.run?.length ?? 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Wall Flash Guard: starts reading the stage as drawn so far into 48 x 27 cells, without waiting for the graphics card.
   * The buffers are made once. Returns false when every reading is still on its way.
   */
  measureStage(at: number, gain = 1): boolean {
    if (!this.ensureGuard()) return false;
    const gl = this.gl, slot = this.measures[this.measureHead % MEASURE_SLOTS];
    if (slot.sync) return false;
    const { program, u } = this.measureP, timer = this.timer;
    let timing = false;
    if (timer && !timer.running) { timer.query ??= gl.createQuery(); if (timer.query) { gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, timer.query); timing = true; } }
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u.uTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.middleFb);
    gl.viewport(0, 0, MEASURE_MIDDLE.width, MEASURE_MIDDLE.height);
    gl.uniform4f(u.uRect, 0, 0, MEASURE_MIDDLE.width, MEASURE_MIDDLE.height); gl.uniform2f(u.uStage, MEASURE_MIDDLE.width, MEASURE_MIDDLE.height);
    gl.bindTexture(gl.TEXTURE_2D, this.stageTex); gl.uniform1i(u.uCell, 4); gl.uniform1i(u.uEncoded, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.smallFb);
    gl.viewport(0, 0, MEASURE_SIZE.width, MEASURE_SIZE.height);
    gl.uniform4f(u.uRect, 0, 0, MEASURE_SIZE.width, MEASURE_SIZE.height); gl.uniform2f(u.uStage, MEASURE_SIZE.width, MEASURE_SIZE.height);
    gl.bindTexture(gl.TEXTURE_2D, this.middleTex); gl.uniform1i(u.uCell, 10); gl.uniform1i(u.uEncoded, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (timing && timer) { gl.endQuery(timer.ext.TIME_ELAPSED_EXT); timer.running = true; }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
    gl.readPixels(0, 0, MEASURE_SIZE.width, MEASURE_SIZE.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    slot.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    slot.at = at; slot.gain = gain;
    if (slot.sync) this.measureHead++;
    gl.flush();
    this.backToStage();
    return !!slot.sync;
  }

  /** The oldest finished reading, into `out`; its time, or null when none is ready. Never waits. */
  collectMeasure(out: Uint8Array): number | null {
    const gl = this.gl, timer = this.timer;
    if (this.guardState !== 'ready') return null;
    if (timer?.running && timer.query && gl.getQueryParameter(timer.query, gl.QUERY_RESULT_AVAILABLE)) {
      const ns = gl.getQueryParameter(timer.query, gl.QUERY_RESULT) as number;
      if (!gl.getParameter(timer.ext.GPU_DISJOINT_EXT)) this.guardGpuMs = this.guardGpuMs === null ? ns / 1e6 : this.guardGpuMs * .9 + ns / 1e6 * .1;
      timer.running = false;
    }
    if (this.measureTail === this.measureHead) return null;
    const slot = this.measures[this.measureTail % MEASURE_SLOTS];
    if (!slot.sync) return null;
    const state = gl.clientWaitSync(slot.sync, 0, 0);
    if (state !== gl.ALREADY_SIGNALED && state !== gl.CONDITION_SATISFIED) return null;
    gl.deleteSync(slot.sync); slot.sync = null;
    this.measureTail++;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.measuredGain = slot.gain;
    return slot.at;
  }

  /** Dims the flat stage, in linear light. Called only while the guard is limiting, so an unguarded stage is never touched. */
  dimStage(gain: number, saturation: number): void {
    if (!this.ensureGuard()) return;
    const gl = this.gl, { program, u } = this.dimP;
    gl.activeTexture(gl.TEXTURE0);
    if (!this.dimCopy) {
      this.dimCopy = this.texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, STAGE_SIZE.width, STAGE_SIZE.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.dimCopy);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.uniform4f(u.uRect, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform2f(u.uStage, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform1i(u.uTex, 0);
    gl.uniform1f(u.uGain, gain);
    gl.uniform1f(u.uSaturation, Math.min(1, saturation));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
  }

  private backToStage(): void {
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

  /** The stage to the canvas. inv: canvas pixels to stage pixels (the stage corners), or the identity. */
  finish(inv: H3 = IDENTITY): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.flat(inv, this.canvas.width, this.canvas.height);
  }

  private flat(inv: H3, w: number, h: number): void {
    const gl = this.gl, { program, u } = this.finalP;
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.uniform4f(u.uRect, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform2f(u.uStage, STAGE_SIZE.width, STAGE_SIZE.height);
    gl.uniform2f(u.uOut, w, h);
    gl.uniformMatrix3fv(u.uInv, false, columns(inv));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.stageTex); gl.uniform1i(u.uTex, 0);
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
