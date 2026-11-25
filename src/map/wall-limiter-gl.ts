/**
 * The wall's flash limiter on the graphics card: the rule of src/meridian/wall-limiter.ts, run in the frame being drawn with
 * no readback in its path. Map's stage and Live's output both use this one implementation, so the two cannot drift apart.
 *
 * Each frame it follows every pixel's own changes, measures 4 px blocks, finds how much of the picture is trying to change,
 * moves each block's allowed light by the rule, and draws the picture through the resulting gain. Where nothing is limited a
 * pixel is copied exactly. Raw WebGL2: the caller owns the context and restores its own state afterwards.
 */
import { FALL_SHARE, MOST_AGE, LIGHT_RULE, LIMITER, LIMITER_BLOCK, LIMITER_TICKS, RED_RULE, type ChannelRule } from '../meridian/wall-limiter';

/** The rectangle every pass draws: a unit quad placed in pixels. Map's own shapes share it. */
export const VERTEX = `#version 300 es
in vec2 aUnit;
uniform vec4 uRect;      // x, y, width, height in stage pixels
uniform vec2 uStage;
out vec2 vStage;
void main() {
  vStage = uRect.xy + aUnit * uRect.zw;
  gl_Position = vec4(vStage.x / uStage.x * 2. - 1., 1. - vStage.y / uStage.y * 2., 0., 1.);
}`;

const LINEAR_GLSL = `vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }`;
/**
 * The wall limiter's first step, on every stage pixel: each pixel's own changes, accumulated from where it last turned, so a slow
 * ramp counts as surely as a jump and nothing is judged from one frame's step. State per pixel: (light anchor, red anchor, light direction, red direction), and for
 * each channel the clock ticks of its last four rises. A pixel is hot on a fourth rise inside a second: three flashes a second are legal.
 */
const PIXEL_TRACK = `#version 300 es
precision highp float;
layout(location = 0) out vec4 oAnchor;
layout(location = 1) out vec4 oLightAges;
layout(location = 2) out vec4 oRedAges;
layout(location = 3) out vec4 oEvent;     // light now, its flags, red now, its flags. Flags: 1 fell, 2 hot, and in the fraction the low a fallen pixel reached.
uniform sampler2D uTex, uAnchor, uLightAges, uRedAges;
uniform float uTick;
uniform int uInit;
// The sRGB curve to within about 1%.
vec3 lin(vec3 c) { return c * (c * (c * .305306011 + .682171111) + .012522878); }
float lightOf(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
float redOf(vec3 c) { float sum = c.r + c.g + c.b; return sum > 1e-6 && c.r / sum >= .8 ? max(0., c.r - c.g - c.b) : 0.; }
float fresh(float stamp) { return stamp > 254.5 || mod(uTick - stamp + 255., 255.) >= ${(LIMITER.window * LIMITER_TICKS).toFixed(1)} ? 255. : stamp; }
float track(float x, inout float anchor, inout float way, inout vec4 s, float edge) {
  vec4 st = round(s * 255.);
  st = vec4(fresh(st.x), fresh(st.y), fresh(st.z), fresh(st.w));
  bool fell = false, rose = false;
  float reach = x;
  if (way > .5 && x > anchor) anchor = x;
  else if (way < -.5 && x < anchor) { fell = x < anchor - ${LIMITER.deeper.toFixed(5)}; anchor = x; }
  if (way > -.5 && x <= anchor - edge) { way = -1.; anchor = x; fell = true; }
  else if (way < .5 && x >= anchor + edge) { reach = anchor; rose = true; way = 1.; anchor = x; st = vec4(uTick, st.x, st.y, st.z); }
  s = st / 255.;
  bool hot = st.x < 254.5 && st.y < 254.5 && st.z < 254.5 && st.w < 254.5;
  // The rise that makes a pixel hot is limited from the low it started at, so the fourth flash never arrives.
  if (rose && hot) fell = true;
  return (fell ? 1. : 0.) + (hot ? 2. : 0.) + clamp(reach, 0., 1.) * .99;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = lin(texelFetch(uTex, p, 0).rgb);
  float l = lightOf(c), r = redOf(c);
  if (uInit == 1) { oAnchor = vec4(l, r, 0., 0.); oLightAges = oRedAges = vec4(1.); oEvent = vec4(l, clamp(l, 0., 1.) * .99, r, clamp(r, 0., 1.) * .99); return; }
  vec4 anchor = texelFetch(uAnchor, p, 0);
  vec4 a = texelFetch(uLightAges, p, 0), b = texelFetch(uRedAges, p, 0);
  float fl = track(l, anchor.x, anchor.z, a, ${LIMITER.pixelStep.toFixed(5)}), fr = track(r, anchor.y, anchor.w, b, ${LIMITER.redPixelStep.toFixed(5)});
  oAnchor = anchor; oLightAges = a; oRedAges = b; oEvent = vec4(l, fl, r, fr);
}`;
/** Per 4 px block, for light and for red: (brightest pixel, mean light plus 2 if a pixel fell, the share of its pixels that are hot, the lowest a fallen pixel reached). */
const MEASURE = `#version 300 es
precision highp float;
layout(location = 0) out vec4 oLight;
layout(location = 1) out vec4 oRed;
uniform sampler2D uEvent;
void see(inout vec4 m, inout float sum, float now, float flags) {
  int f = int(floor(flags));
  sum += now;
  m.x = max(m.x, now);
  if ((f & 1) != 0) { m.y = 1.; m.w = min(m.w, fract(flags) / .99); }
  if ((f & 2) != 0) m.z += ${(1 / (LIMITER_BLOCK * LIMITER_BLOCK)).toFixed(5)};
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * ${LIMITER_BLOCK};
  vec4 l = vec4(0., 0., 0., 2.), r = vec4(0., 0., 0., 2.);
  float sumL = 0., sumR = 0.;
  for (int y = 0; y < ${LIMITER_BLOCK}; y++) for (int x = 0; x < ${LIMITER_BLOCK}; x++) {
    vec4 e = texelFetch(uEvent, p + ivec2(x, y), 0);
    see(l, sumL, e.x, e.y); see(r, sumR, e.z, e.w);
  }
  l.w = min(l.w, l.x); r.w = min(r.w, r.x);
  // y carries the block's mean light, plus 2 if a pixel fell.
  l.y = l.y * 2. + sumL / ${LIMITER_BLOCK * LIMITER_BLOCK}.; r.y = r.y * 2. + sumR / ${LIMITER_BLOCK * LIMITER_BLOCK}.;
  oLight = l; oRed = r;
}`;
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
/** Which blocks are trying to rise past what they may show, or hold a pixel on its fourth rise within a second. */
const LIMIT_WANT = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uBlock, uBlockRed, uLight, uRed, uMisc;
uniform float uDt;
uniform vec2 uHold;
${LIMIT_RULE}
// Past what the block may show, with the block's whole light jumping this frame. Detail moving across a block leaves its mean
// steady, so it is judged by its pixels' own rises instead. A block already held back climbs by the rule on its own (see advance),
// so holding it does not keep the whole wall engaged.
bool over(vec4 m, vec4 s, float lastMean, vec3 rule, float scale, float step) {
  float mean = m.y >= 1.5 ? m.y - 2. : m.y;
  return m.x > max(s.r, capOf(s, uDt, rule, scale)) + 1e-4 && mean - lastMean >= step;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 l = texelFetch(uBlock, p, 0), r = texelFetch(uBlockRed, p, 0);
  // A jump counts the whole block; flashing counts only the share of its pixels that are really flashing.
  vec4 misc = texelFetch(uMisc, p, 0);
  o = vec4(over(l, texelFetch(uLight, p, 0), misc.b, LIGHT_RULE, uHold.x, ${LIMITER.pixelStep.toFixed(5)}) ? 1. : l.z,
           over(r, texelFetch(uRed, p, 0), misc.a, RED_RULE, uHold.y, ${LIMITER.redPixelStep.toFixed(5)}) ? 1. : r.z, 0., 1.);
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
uniform sampler2D uBlock, uBlockRed, uLight, uRed, uWant, uMisc;
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
  // A flashing pixel that fell is a fall for the block, even when another pixel keeps the block's peak up. Detail merely moving
  // through is not, or it would hold the block down for as long as it moved.
  // Each such fall also restarts the hold, so a block cannot climb while its pixels are still flashing.
  // One gain serves the whole block, so where a brighter pixel stands over the flashing ones the low is set so that the flashing
  // pixels' own swing, scaled by that gain, stays inside the band.
  if (m.y >= 1.5 && m.z > 0.) {
    float low = x - m.w > rule.x ? min(m.w, max(0., x * rule.x / (x - m.w) - rule.x)) : m.w;
    if (low < s.r) s = move(s, low, rule);
    s.a = 0.;
  }
  float v = x <= s.r || !engaged ? x : min(x, max(s.r, capOf(s, uDt, rule, scale)));
  s = move(s, v, rule);
  s.a = min(${MOST_AGE.toFixed(1)}, s.a + uDt);
  return s;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 l = texelFetch(uBlock, p, 0), r = texelFetch(uBlockRed, p, 0);
  if (uInit == 1) { oLight = vec4(l.x, l.x, l.x, 0.); oRed = vec4(r.x, r.x, r.x, 0.); oMisc = vec4(1., 1., l.y >= 1.5 ? l.y - 2. : l.y, r.y >= 1.5 ? r.y - 2. : r.y); return; }
  vec2 area = texelFetch(uWant, ivec2(0), 0).rg, was = texelFetch(uMisc, p, 0).rg;
  // A block being held back keeps to the rule until it has climbed back, whatever the rest of the wall is doing.
  oLight = advance(texelFetch(uLight, p, 0), l, area.r >= TRIGGER || was.r < .9995, LIGHT_RULE, uHold.x);
  oRed = advance(texelFetch(uRed, p, 0), r, area.g >= TRIGGER || was.g < .9995, RED_RULE, uHold.y);
  oMisc = vec4(l.x > 1e-4 ? clamp(oLight.r / l.x, 0., 1.) : 1., r.x > 1e-4 ? clamp(oRed.r / r.x, 0., 1.) : 1., l.y >= 1.5 ? l.y - 2. : l.y, r.y >= 1.5 ? r.y - 2. : r.y);
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
/** Blocks are summed in two steps, so no single shader reads all of them. */
const AREA_STEP = 10;
interface LimitState { light: WebGLTexture; red: WebGLTexture; misc: WebGLTexture; fb: WebGLFramebuffer; anchor: WebGLTexture; lightAges: WebGLTexture; redAges: WebGLTexture; pixelFb: WebGLFramebuffer }
type Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

export class WallLimiterGl {
  /** Why the limiter could not be built; null when it is fine or not yet needed. */
  error: string | null = null;
  /** The share of the picture last found trying to change, read back a few times a second for the operator only. */
  limitedArea = 0;
  private state: 'unbuilt' | 'ready' | 'failed' = 'unbuilt';
  private readonly cols: number;
  private readonly rows: number;
  private readonly areaCols: number;
  private readonly areaRows: number;
  private readonly ownQuad: boolean;
  private quad: WebGLVertexArrayObject | null;
  private measureP!: Program;
  private wantP!: Program;
  private updateP!: Program;
  private applyP!: Program;
  private areaP!: Program;
  private pixelP!: Program;
  private eventTex!: WebGLTexture;
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
  private states: [LimitState, LimitState] | null = null;
  private clock = 0;
  private readonly made: { textures: WebGLTexture[]; framebuffers: WebGLFramebuffer[]; programs: WebGLProgram[]; buffers: WebGLBuffer[] } = { textures: [], framebuffers: [], programs: [], buffers: [] };

  /**
   * `width` and `height` are the picture's size; both must divide by 40. `quad` is a vertex array with a unit square at
   * attribute 0 (aUnit); without one the limiter makes its own. Nothing is built until the first frame needs it.
   */
  constructor(private readonly gl: WebGL2RenderingContext, readonly width: number, readonly height: number, quad: WebGLVertexArrayObject | null = null) {
    if (width % (LIMITER_BLOCK * AREA_STEP) || height % (LIMITER_BLOCK * AREA_STEP)) throw new Error(`the limiter cannot measure a ${width} x ${height} picture`);
    this.cols = width / LIMITER_BLOCK; this.rows = height / LIMITER_BLOCK;
    this.areaCols = this.cols / AREA_STEP; this.areaRows = this.rows / AREA_STEP;
    this.ownQuad = quad === null; this.quad = quad;
  }

  /** Builds the passes once. A failure is reported and never reaches the caller's own drawing. */
  ready(): boolean {
    if (this.state !== 'unbuilt') return this.state === 'ready';
    const gl = this.gl;
    try {
      if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) throw new Error('this graphics card cannot draw to floating-point pictures');
      if (this.ownQuad) {
        this.quad = gl.createVertexArray()!;
        gl.bindVertexArray(this.quad);
        const buffer = gl.createBuffer()!; this.made.buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
      }
      this.measureP = this.compile(MEASURE, ['uRect', 'uStage', 'uEvent']);
      this.wantP = this.compile(LIMIT_WANT, ['uRect', 'uStage', 'uBlock', 'uBlockRed', 'uLight', 'uRed', 'uMisc', 'uDt', 'uHold']);
      this.updateP = this.compile(LIMIT_UPDATE, ['uRect', 'uStage', 'uBlock', 'uBlockRed', 'uLight', 'uRed', 'uWant', 'uMisc', 'uDt', 'uHold', 'uInit']);
      this.pixelP = this.compile(PIXEL_TRACK, ['uRect', 'uStage', 'uTex', 'uAnchor', 'uLightAges', 'uRedAges', 'uTick', 'uInit']);
      this.areaP = this.compile(LIMIT_AREA, ['uRect', 'uStage', 'uWant', 'uAcross']);
      this.applyP = this.compile(LIMIT_APPLY, ['uRect', 'uStage', 'uTex', 'uGain', 'uFade']);
      const w = this.cols, h = this.rows;
      const floatAt = (width: number, height: number) => { const t = this.texture(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null); return t; };
      const float = () => floatAt(w, h);
      const framebuffer = () => { const fb = gl.createFramebuffer()!; this.made.framebuffers.push(fb); return fb; };
      this.blockTex = float(); this.blockRedTex = float();
      this.blockFb = framebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blockFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blockTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.blockRedTex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the limiter picture could not be made');
      ({ tex: this.wantTex, fb: this.wantFb } = this.target(w, h));
      this.wantCoarseTex = floatAt(this.areaCols, this.areaRows);
      this.wantCoarseFb = framebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.wantCoarseFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.wantCoarseTex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the limiter picture could not be made');
      ({ tex: this.areaTex, fb: this.statusFb } = this.target(1, 1));
      this.statusBuffer = gl.createBuffer()!; this.made.buffers.push(this.statusBuffer);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.statusBuffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.eventTex = floatAt(this.width, this.height);
      const state = (): LimitState => {
        const light = float(), red = float(), misc = float(), fb = framebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, light, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, red, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, misc, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the limiter state could not be made');
        const anchor = this.texture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.width, this.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
        const bytes = () => { const t = this.texture(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); return t; };
        const lightAges = bytes(), redAges = bytes(), pixelFb = framebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, pixelFb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, anchor, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, lightAges, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, redAges, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, this.eventTex, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the limiter state could not be made');
        return { light, red, misc, fb, anchor, lightAges, redAges, pixelFb };
      };
      this.states = [state(), state()];
      this.state = 'ready';
    } catch (error) {
      this.state = 'failed'; this.error = String((error as Error)?.message ?? error);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.state === 'ready';
  }

  /**
   * One frame: measures `input` (an 8-bit encoded picture of exactly this size, which must not be the output), updates each
   * block's allowed light and draws the limited picture into `output` (null for the canvas). `init` starts from this picture;
   * `fade` (0 to 1) eases the limit away. Returns false, drawing nothing, if the limiter is unavailable. Leaves blending off.
   */
  limit(input: WebGLTexture, output: WebGLFramebuffer | null, dt: number, fade: number, init: boolean, holds: { light: number; red: number } = { light: 1, red: 1 }): boolean {
    if (!this.ready() || !this.states) return false;
    const gl = this.gl, [from, to] = this.states, w = this.cols, h = this.rows;
    const rect = (u: Program['u'], width: number, height: number) => { gl.uniform4f(u.uRect, 0, 0, width, height); gl.uniform2f(u.uStage, width, height); };
    const bind = (unit: number, location: WebGLUniformLocation | null, texture: WebGLTexture) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(location, unit); };
    // A shared context (three's, on Live) may have left culling, depth or scissor on: every pass here must cover its target.
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(this.quad);
    // Every pixel's own changes, accumulated in real time from where it last turned.
    this.clock = init ? 0 : (this.clock + dt) % (255 / LIMITER_TICKS);
    let p = this.pixelP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.pixelFb);
    gl.viewport(0, 0, this.width, this.height);
    rect(p.u, this.width, this.height);
    bind(0, p.u.uTex, input); bind(1, p.u.uAnchor, from.anchor); bind(2, p.u.uLightAges, from.lightAges); bind(3, p.u.uRedAges, from.redAges);
    gl.uniform1f(p.u.uTick, Math.floor(this.clock * LIMITER_TICKS) % 255); gl.uniform1i(p.u.uInit, init ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // To 4 px blocks: each block's peak, whether a pixel fell, whether a pixel is flashing.
    p = this.measureP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blockFb);
    gl.viewport(0, 0, w, h);
    rect(p.u, w, h);
    bind(0, p.u.uEvent, this.eventTex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // How much of the picture is trying to change more than it may.
    p = this.wantP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.wantFb);
    rect(p.u, w, h);
    bind(0, p.u.uBlock, this.blockTex); bind(1, p.u.uBlockRed, this.blockRedTex); bind(2, p.u.uLight, from.light); bind(3, p.u.uRed, from.red); bind(4, p.u.uMisc, from.misc);
    gl.uniform1f(p.u.uDt, dt); gl.uniform2f(p.u.uHold, holds.light, holds.red);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    p = this.areaP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.wantCoarseFb);
    gl.viewport(0, 0, this.areaCols, this.areaRows);
    rect(p.u, this.areaCols, this.areaRows);
    bind(0, p.u.uWant, this.wantTex); gl.uniform2i(p.u.uAcross, AREA_STEP, AREA_STEP);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.statusFb);
    gl.viewport(0, 0, 1, 1);
    rect(p.u, 1, 1);
    bind(0, p.u.uWant, this.wantCoarseTex); gl.uniform2i(p.u.uAcross, this.areaCols, this.areaRows);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.viewport(0, 0, w, h);
    // Each block moves as far as it may.
    p = this.updateP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
    rect(p.u, w, h);
    bind(0, p.u.uBlock, this.blockTex); bind(1, p.u.uBlockRed, this.blockRedTex); bind(2, p.u.uLight, from.light); bind(3, p.u.uRed, from.red); bind(4, p.u.uWant, this.areaTex); bind(5, p.u.uMisc, from.misc);
    gl.uniform1f(p.u.uDt, dt); gl.uniform2f(p.u.uHold, holds.light, holds.red); gl.uniform1i(p.u.uInit, init ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.states = [to, from];
    this.readStatus();
    // The result, through the gain.
    p = this.applyP;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output);
    gl.viewport(0, 0, this.width, this.height);
    rect(p.u, this.width, this.height);
    bind(0, p.u.uTex, input); bind(1, p.u.uGain, to.misc);
    gl.uniform1f(p.u.uFade, fade);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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

  private compile(fragment: string, uniforms: string[]): Program {
    const gl = this.gl;
    const make = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, make(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, make(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'aUnit');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program');
    this.made.programs.push(program);
    return { program, u: Object.fromEntries(uniforms.map(n => [n, gl.getUniformLocation(program, n)])) };
  }

  private texture(): WebGLTexture {
    const gl = this.gl, tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.made.textures.push(tex);
    return tex;
  }

  private target(w: number, h: number): { tex: WebGLTexture; fb: WebGLFramebuffer } {
    const gl = this.gl, tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!; this.made.framebuffers.push(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb };
  }

  /** Lets go of everything it made. Safe on a lost context. */
  dispose(): void {
    const gl = this.gl;
    if (this.statusSync) { gl.deleteSync(this.statusSync); this.statusSync = null; }
    for (const t of this.made.textures) gl.deleteTexture(t);
    for (const f of this.made.framebuffers) gl.deleteFramebuffer(f);
    for (const p of this.made.programs) gl.deleteProgram(p);
    for (const b of this.made.buffers) gl.deleteBuffer(b);
    if (this.ownQuad && this.quad) gl.deleteVertexArray(this.quad);
    this.made.textures.length = 0; this.made.framebuffers.length = 0; this.made.programs.length = 0; this.made.buffers.length = 0;
    this.states = null; this.state = 'unbuilt';
  }
}
