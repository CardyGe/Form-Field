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
import { FALL_SHARE, MOST_AGE, LIGHT_RULE, LIMITER, LIMITER_BLOCK, RED_RULE, type ChannelRule } from '../meridian/wall-limiter';

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

const LINEAR_GLSL = `vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }`;
/**
 * The wall limiter's first step, per 4 px block: the brightest pixel, and the largest fall and rise of any one pixel since the
 * last frame, for light and for saturated red. Light that swaps places inside a block leaves the peak alone but not these.
 */
const MEASURE = `#version 300 es
precision highp float;
layout(location = 0) out vec4 oLight;
layout(location = 1) out vec4 oRed;
uniform sampler2D uTex, uPrev;
// The sRGB curve to within about 1%, without a pow for each of the many texels read here.
vec3 lin(vec3 c) { return c * (c * (c * .305306011 + .682171111) + .012522878); }
float lightOf(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
float redOf(vec3 c) { float sum = c.r + c.g + c.b; return sum > 1e-6 && c.r / sum >= .8 ? max(0., c.r - c.g - c.b) : 0.; }
// One channel's pixels: (peak, largest fall, largest rise, lowest value a fallen pixel reached), and how many fell and rose.
struct Read { vec4 m; int fell, rose, lone; };
void see(inout Read r, float now, float was, float edge, float beside) {
  r.m.x = max(r.m.x, now);
  if (was - now >= edge) { r.m.y = max(r.m.y, was - now); r.m.w = min(r.m.w, now); r.fell++; }
  if (now - was >= edge) { r.m.z = max(r.m.z, now - was); r.rose++; if (now - beside >= edge) r.lone++; }
}
// Half the block or less trading light, every risen pixel lit from right beside it, is an edge moving through. Anything else is light swapping places.
vec4 settled(Read r) {
  if (r.fell > 0 && r.rose > 0 && r.lone == 0 && r.fell + r.rose <= ${LIMITER_BLOCK * LIMITER_BLOCK / 2}) { r.m.y = 0.; r.m.z = 0.; r.m.w = r.m.x; }
  r.m.w = min(r.m.w, r.m.x);
  return r.m;
}
// The most light and red any of a pixel's four neighbours held last frame.
vec2 besideWas(ivec2 q) {
  ivec2 top = textureSize(uPrev, 0) - 1;
  vec2 most = vec2(0.);
  for (int i = 0; i < 4; i++) {
    ivec2 d = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
    vec3 c = lin(texelFetch(uPrev, clamp(q + d, ivec2(0), top), 0).rgb);
    most = max(most, vec2(lightOf(c), redOf(c)));
  }
  return most;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * ${LIMITER_BLOCK};
  Read l = Read(vec4(0., 0., 0., 2.), 0, 0, 0), r = Read(vec4(0., 0., 0., 2.), 0, 0, 0);
  for (int y = 0; y < ${LIMITER_BLOCK}; y++) for (int x = 0; x < ${LIMITER_BLOCK}; x++) {
    ivec2 q = p + ivec2(x, y);
    vec3 now = lin(texelFetch(uTex, q, 0).rgb), was = lin(texelFetch(uPrev, q, 0).rgb);
    float a = lightOf(now), b = lightOf(was), c = redOf(now), d = redOf(was);
    vec2 beside = a - b >= ${(LIMITER.band * FALL_SHARE).toFixed(5)} || c - d >= ${(LIMITER.redBand * FALL_SHARE).toFixed(5)} ? besideWas(q) : vec2(2.);
    see(l, a, b, ${(LIMITER.band * FALL_SHARE).toFixed(5)}, beside.x);
    see(r, c, d, ${(LIMITER.redBand * FALL_SHARE).toFixed(5)}, beside.y);
  }
  oLight = settled(l); oRed = settled(r);
}`;
const BLOCK_COLS = STAGE_SIZE.width / LIMITER_BLOCK, BLOCK_ROWS = STAGE_SIZE.height / LIMITER_BLOCK;
/** Blocks are summed in two steps, so no single shader reads all 129,600 of them. */
const AREA_STEP = 10, AREA_COLS = BLOCK_COLS / AREA_STEP, AREA_ROWS = BLOCK_ROWS / AREA_STEP;
const glslRule = (r: ChannelRule) => `vec3(${r.band.toFixed(5)}, ${r.hold.toFixed(5)}, ${r.climb.toFixed(5)})`;
/** The rule of src/meridian/wall-limiter.ts. A channel's state is (allowed value, low, high, seconds since the low). */
const LIMIT_RULE = `
const vec3 LIGHT_RULE = ${glslRule(LIGHT_RULE)};
const vec3 RED_RULE = ${glslRule(RED_RULE)};
const float WINDOW = ${LIMITER.window.toFixed(5)};
const float AT_LOW = ${LIMITER.atLow.toFixed(5)};
const float OVER = ${LIMITER.over.toFixed(5)};
const float TRIGGER = ${LIMITER.trigger.toFixed(5)};
const float FALL_SHARE = ${FALL_SHARE.toFixed(5)};
float lightOf(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
float redOf(vec3 c) { float sum = c.r + c.g + c.b; return sum > 1e-6 && c.r / sum >= .8 ? max(0., c.r - c.g - c.b) : 0.; }
float capOf(vec4 s, float dt, vec3 rule, float scale) { float first = s.g + rule.x; return s.a >= rule.y * scale ? max(first, s.r + rule.z * min(dt, ${LIMITER.longestClimb.toFixed(5)})) : first; }`;
/** Follows the input's own changes per block: (anchor, directions, seconds since it last rose, since the rise before). */
const LIMIT_INPUT = `#version 300 es
precision highp float;
layout(location = 0) out vec4 oLight;
layout(location = 1) out vec4 oRed;
layout(location = 2) out vec4 oOlder;   // seconds since the third-latest rise: light, red
uniform sampler2D uBlock, uBlockRed, uInLight, uInRed, uInOlder;
uniform float uDt;
uniform int uInit;
${LIMIT_RULE}
vec4 follow(vec4 s, vec3 m, float size, float edge, inout float older) {
  older = min(2., older + uDt);
  float x = m.x, anchor = s.r, pixel = round(s.g / 4.), way = s.g - 4. * pixel, up = min(2., s.b + uDt), before = min(2., s.a + uDt);
  bool rose = false;
  if (way > .5 && x > anchor) anchor = x;
  else if (way < -.5 && x < anchor) anchor = x;
  if (way > -.5 && x <= anchor - size) { way = -1.; anchor = x; }
  else if (way < .5 && x >= anchor + size) { way = 1.; anchor = x; rose = true; }
  if (m.z >= edge) { if (pixel < -.5) rose = true; pixel = 1.; }
  if (m.y >= edge) pixel = -1.;
  if (rose) { older = before; before = up; up = 0.; }
  return vec4(anchor, way + 4. * pixel, up, before);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 l = texelFetch(uBlock, p, 0).rgb, r = texelFetch(uBlockRed, p, 0).rgb;
  if (uInit == 1) { oLight = vec4(l.x, 0., 2., 2.); oRed = vec4(r.x, 0., 2., 2.); oOlder = vec4(2., 2., 0., 1.); return; }
  vec2 older = texelFetch(uInOlder, p, 0).rg;
  oLight = follow(texelFetch(uInLight, p, 0), l, ${LIMITER.lightStep.toFixed(5)}, LIGHT_RULE.x * FALL_SHARE, older.x);
  oRed = follow(texelFetch(uInRed, p, 0), r, ${LIMITER.redStep.toFixed(5)}, RED_RULE.x * FALL_SHARE, older.y);
  oOlder = vec4(older, 0., 1.);
}`;
/** Which blocks are trying to rise past what they may show, or have risen three times within the last second. */
const LIMIT_WANT = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uBlock, uBlockRed, uLight, uRed, uInLight, uInRed, uInOlder;
uniform float uDt;
uniform vec2 uHold;
${LIMIT_RULE}
bool flashing(vec4 s, float older) { return s.b < WINDOW && s.a < WINDOW && older < WINDOW; }
bool over(float x, vec4 s, vec3 rule, float scale) { return x > max(s.r, capOf(s, uDt, rule, scale)) + 1e-4; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 older = texelFetch(uInOlder, p, 0).rg;
  o = vec4(over(texelFetch(uBlock, p, 0).x, texelFetch(uLight, p, 0), LIGHT_RULE, uHold.x) || flashing(texelFetch(uInLight, p, 0), older.x) ? 1. : 0.,
           over(texelFetch(uBlockRed, p, 0).x, texelFetch(uRed, p, 0), RED_RULE, uHold.y) || flashing(texelFetch(uInRed, p, 0), older.y) ? 1. : 0., 0., 1.);
}`;
/** The exact share of blocks wanting to change, in two box steps. A mip chain is not used: it can drop whole columns from the average. */
const LIMIT_AREA = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uWant;
uniform ivec2 uAcross;      // how many texels of the source one output pixel sums
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * uAcross;
  vec2 sum = vec2(0.);
  for (int y = 0; y < uAcross.y; y++) for (int x = 0; x < uAcross.x; x++) sum += texelFetch(uWant, p + ivec2(x, y), 0).rg;
  o = vec4(sum / float(uAcross.x * uAcross.y), 0., 1.);
}`;
const LIMIT_UPDATE = `#version 300 es
precision highp float;
layout(location = 0) out vec4 oLight;
layout(location = 1) out vec4 oRed;
layout(location = 2) out vec4 oMisc;
uniform sampler2D uBlock, uBlockRed, uLight, uRed, uWant;
uniform float uDt;
uniform vec2 uHold;
uniform int uInit;
${LIMIT_RULE}
// A partial fall can neither raise the low nor restart the hold: only a return to the low, or a fall after a real climb.
vec4 move(vec4 s, float v, vec3 rule) {
  float was = s.r, low = s.g, high = max(s.b, v), age = s.a;
  if (v < low) { low = v; high = v; age = 0.; }
  else if (was > low + AT_LOW && v <= low + AT_LOW) { high = v; age = 0.; }
  else if (high > low + rule.x + OVER && high - v >= rule.x * FALL_SHARE) { low = v; high = v; age = 0.; }
  return vec4(v, low, high, age);
}
vec4 advance(vec4 s, vec4 m, bool engaged, vec3 rule, float scale) {
  float x = m.x;
  // A pixel that fell is a fall for the block, even when another pixel keeps the block's peak up.
  if (m.y >= rule.x * FALL_SHARE && m.w < s.r) s = move(s, m.w, rule);
  float v = x <= s.r || !engaged ? x : min(x, max(s.r, capOf(s, uDt, rule, scale)));
  s = move(s, v, rule);
  s.a = min(${MOST_AGE.toFixed(1)}, s.a + uDt);
  return s;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 l = texelFetch(uBlock, p, 0), r = texelFetch(uBlockRed, p, 0);
  if (uInit == 1) { oLight = vec4(l.x, l.x, l.x, 0.); oRed = vec4(r.x, r.x, r.x, 0.); oMisc = vec4(1.); return; }
  vec2 area = texelFetch(uWant, ivec2(0), 0).rg;
  oLight = advance(texelFetch(uLight, p, 0), l, area.r >= TRIGGER, LIGHT_RULE, uHold.x);
  oRed = advance(texelFetch(uRed, p, 0), r, area.g >= TRIGGER, RED_RULE, uHold.y);
  oMisc = vec4(l.x > 1e-4 ? clamp(oLight.r / l.x, 0., 1.) : 1., r.x > 1e-4 ? clamp(oRed.r / r.x, 0., 1.) : 1., 0., 1.);
}`;
/** The limit on the flat stage, as a gain per block in linear light. Where nothing is limited the pixel is left exactly as it was. */
const LIMIT_APPLY = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uTex, uGain;
uniform vec2 uStage;
uniform float uFade;
${LINEAR_GLSL}
void main() {
  vec4 c = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0);
  // Softened across block edges, but never above the pixel's own block: a dark neighbour cannot lend it gain.
  vec2 own = texelFetch(uGain, ivec2(gl_FragCoord.xy) / ${LIMITER_BLOCK}, 0).rg;
  vec2 g = mix(clamp(texture(uGain, gl_FragCoord.xy / uStage).rg, own * ${LIMITER.softEdge.toFixed(3)}, own), vec2(1.), uFade);
  if (g.r >= .9995 && g.g >= .9995) { o = c; return; }
  vec3 l = lin(c.rgb);
  float grey = dot(l, vec3(.2126, .7152, .0722));
  l = max(vec3(grey) + (l - vec3(grey)) * g.g, vec3(0.)) * g.r;
  o = vec4(enc(l), c.a);
}`;
/** How often, in drawn frames, the operator's status is read back. It never drives the limiter. */
const STATUS_EVERY = 12;
interface LimitState { light: WebGLTexture; red: WebGLTexture; misc: WebGLTexture; fb: WebGLFramebuffer; inLight: WebGLTexture; inRed: WebGLTexture; inOlder: WebGLTexture; inFb: WebGLFramebuffer }
type LimitProgram = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

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
  private wantP!: Program;
  private updateP!: Program;
  private applyP!: Program;
  private areaP!: Program;
  private inputP!: Program;
  private areaTex!: WebGLTexture;
  private blockTex!: WebGLTexture;
  private blockRedTex!: WebGLTexture;
  private blockFb!: WebGLFramebuffer;
  private wantTex!: WebGLTexture;
  private wantFb!: WebGLFramebuffer;
  private wantCoarseTex!: WebGLTexture;
  private wantCoarseFb!: WebGLFramebuffer;
  private statusFb!: WebGLFramebuffer;
  private statusBuffer!: WebGLBuffer;
  private statusSync: WebGLSync | null = null;
  private statusCount = 0;
  private readonly statusBytes = new Uint8Array(4);
  private limitStates: [LimitState, LimitState] | null = null;
  private stageCopy: WebGLTexture | null = null;
  private pointsFb: WebGLFramebuffer | null = null;
  private pointsStride = 0;
  private guardState: 'unbuilt' | 'ready' | 'failed' = 'unbuilt';
  /** Why the wall limiter could not be built; null when it is fine or not yet needed. */
  guardError: string | null = null;
  /** The share of the wall last found trying to change, read back a few times a second for the operator only. */
  limitedArea = 0;
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
    this.stageCopy = null; this.pointsFb = null; this.limitStates = null; this.statusSync = null; this.statusCount = 0; this.limitedArea = 0;
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

  /** Builds the wall limiter's passes once. A failure is reported and never reaches the stage's own drawing. */
  private ensureGuard(): boolean {
    if (this.guardState !== 'unbuilt') return this.guardState === 'ready';
    const gl = this.gl;
    try {
      if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) throw new Error('this graphics card cannot draw to floating-point pictures');
      this.measureP = this.compile(MEASURE, ['uRect', 'uStage', 'uTex', 'uPrev']);
      this.wantP = this.compile(LIMIT_WANT, ['uRect', 'uStage', 'uBlock', 'uBlockRed', 'uLight', 'uRed', 'uInLight', 'uInRed', 'uInOlder', 'uDt', 'uHold']);
      this.updateP = this.compile(LIMIT_UPDATE, ['uRect', 'uStage', 'uBlock', 'uBlockRed', 'uLight', 'uRed', 'uWant', 'uDt', 'uHold', 'uInit']);
      this.inputP = this.compile(LIMIT_INPUT, ['uRect', 'uStage', 'uBlock', 'uBlockRed', 'uInLight', 'uInRed', 'uInOlder', 'uDt', 'uInit']);
      this.areaP = this.compile(LIMIT_AREA, ['uRect', 'uStage', 'uWant', 'uAcross']);
      this.applyP = this.compile(LIMIT_APPLY, ['uRect', 'uStage', 'uTex', 'uGain', 'uFade']);
      const w = BLOCK_COLS, h = BLOCK_ROWS;
      const floatAt = (width: number, height: number) => { const t = this.texture(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null); return t; };
      const float = () => floatAt(w, h);
      this.blockTex = float(); this.blockRedTex = float();
      this.blockFb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blockFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blockTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.blockRedTex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the limiter picture could not be made');
      ({ tex: this.wantTex, fb: this.wantFb } = this.target(w, h));
      this.wantCoarseTex = floatAt(AREA_COLS, AREA_ROWS);
      this.wantCoarseFb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.wantCoarseFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.wantCoarseTex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the limiter picture could not be made');
      ({ tex: this.areaTex, fb: this.statusFb } = this.target(1, 1));
      this.statusBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.statusBuffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const state = (): LimitState => {
        const light = float(), red = float(), misc = float(), fb = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, light, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, red, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, misc, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the limiter state could not be made');
        const inLight = float(), inRed = float(), inOlder = float(), inFb = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, inFb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, inLight, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, inRed, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, inOlder, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the limiter state could not be made');
        return { light, red, misc, fb, inLight, inRed, inOlder, inFb };
      };
      this.limitStates = [state(), state()];
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
   * The wall limiter, in the frame being drawn, with no readback in its path: measures the stage as drawn so far, updates each
   * cell's allowed light, and applies it to the flat stage before the overlays and corners. `init` starts from this picture;
   * `fade` (0 to 1) eases the limit away. Returns false if the limiter is unavailable, leaving the picture as it is.
   */
  limitStage(dt: number, fade: number, init: boolean, holds: { light: number; red: number } = { light: 1, red: 1 }): boolean {
    if (!this.ensureGuard() || !this.limitStates) return false;
    const gl = this.gl, [from, to] = this.limitStates, w = BLOCK_COLS, h = BLOCK_ROWS;
    const rect = (u: Program['u'], width: number, height: number) => { gl.uniform4f(u.uRect, 0, 0, width, height); gl.uniform2f(u.uStage, width, height); };
    const bind = (unit: number, location: WebGLUniformLocation | null, texture: WebGLTexture) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(location, unit); };
    gl.disable(gl.BLEND);
    // The stage to 4 px blocks: each block's peak, and its pixels' own falls and rises since the last input frame.
    let p = this.measureP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blockFb);
    gl.viewport(0, 0, w, h);
    rect(p.u, w, h);
    bind(0, p.u.uTex, this.stageTex); bind(1, p.u.uPrev, init || !this.stageCopy ? this.stageTex : this.stageCopy);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // The input's own changes, over a rolling second.
    p = this.inputP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.inFb);
    rect(p.u, w, h);
    bind(0, p.u.uBlock, this.blockTex); bind(1, p.u.uBlockRed, this.blockRedTex); bind(2, p.u.uInLight, from.inLight); bind(3, p.u.uInRed, from.inRed); bind(4, p.u.uInOlder, from.inOlder);
    gl.uniform1f(p.u.uDt, dt); gl.uniform1i(p.u.uInit, init ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // How much of the wall is trying to change more than it may.
    p = this.wantP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.wantFb);
    rect(p.u, w, h);
    bind(0, p.u.uBlock, this.blockTex); bind(1, p.u.uBlockRed, this.blockRedTex); bind(2, p.u.uLight, from.light); bind(3, p.u.uRed, from.red); bind(4, p.u.uInLight, to.inLight); bind(5, p.u.uInRed, to.inRed); bind(6, p.u.uInOlder, to.inOlder);
    gl.uniform1f(p.u.uDt, dt); gl.uniform2f(p.u.uHold, holds.light, holds.red);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    p = this.areaP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.wantCoarseFb);
    gl.viewport(0, 0, AREA_COLS, AREA_ROWS);
    rect(p.u, AREA_COLS, AREA_ROWS);
    bind(0, p.u.uWant, this.wantTex); gl.uniform2i(p.u.uAcross, AREA_STEP, AREA_STEP);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.statusFb);
    gl.viewport(0, 0, 1, 1);
    rect(p.u, 1, 1);
    bind(0, p.u.uWant, this.wantCoarseTex); gl.uniform2i(p.u.uAcross, AREA_COLS, AREA_ROWS);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.viewport(0, 0, w, h);
    // Each block moves as far as it may.
    p = this.updateP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
    rect(p.u, w, h);
    bind(0, p.u.uBlock, this.blockTex); bind(1, p.u.uBlockRed, this.blockRedTex); bind(2, p.u.uLight, from.light); bind(3, p.u.uRed, from.red); bind(4, p.u.uWant, this.areaTex);
    gl.uniform1f(p.u.uDt, dt); gl.uniform2f(p.u.uHold, holds.light, holds.red); gl.uniform1i(p.u.uInit, init ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.limitStates = [to, from];
    this.readStatus();
    // The result, on the flat stage.
    this.backToStage();
    gl.disable(gl.BLEND);
    p = this.applyP;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    if (!this.stageCopy) {
      this.stageCopy = this.texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, STAGE_SIZE.width, STAGE_SIZE.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.stageCopy);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
    rect(p.u, STAGE_SIZE.width, STAGE_SIZE.height);
    bind(0, p.u.uTex, this.stageCopy); bind(1, p.u.uGain, to.misc);
    gl.uniform1f(p.u.uFade, fade);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    return true;
  }

  /** For the operator's status only, a few times a second, never waited for. It does not feed the limiter. */
  private readStatus(): void {
    const gl = this.gl;
    if (this.statusSync) {
      const state = gl.clientWaitSync(this.statusSync, 0, 0);
      if (state !== gl.ALREADY_SIGNALED && state !== gl.CONDITION_SATISFIED) return;
      gl.deleteSync(this.statusSync); this.statusSync = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.statusBuffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.statusBytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.limitedArea = Math.max(this.statusBytes[0], this.statusBytes[1]) / 255;
    }
    if (++this.statusCount < STATUS_EVERY) return;
    this.statusCount = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.statusFb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.statusBuffer);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.statusSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
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
