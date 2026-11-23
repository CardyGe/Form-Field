/**
 * For the scripted checks: plays exact light patterns through the real limiter shaders on their own graphics context, and counts
 * changes on the output pixels themselves, every 7th pixel across the whole stage (7 shares no factor with any pattern size, so
 * the samples land on every part of a square). Nothing here touches a show or the wall. It is not a certified photosensitivity test.
 */
import { Gpu } from './gpu';
import { STAGE_SIZE } from './show';

const STRIDE = 7, POINTS_X = Math.floor(STAGE_SIZE.width / STRIDE), POINTS_Y = Math.floor(STAGE_SIZE.height / STRIDE), POINTS = POINTS_X * POINTS_Y;
const SECONDS = 3, RING = 16, LIGHT_LIMIT = 6, RED_LIMIT = 4;
type Colour = [number, number, number];
const WHITE: Colour = [1, 1, 1], RED: Colour = [1, 0, 0];
const RATCHET = [0, 1, .009, 1, .018, 1];

/** A drawn pattern. `shape` 0 is the whole wall; `invert` swaps the two halves of the pattern, otherwise the lit half goes to black. */
interface Spec { shape: 0 | 1 | 2; size: number; offset: number; invert: boolean; colour: Colour; blackout?: boolean; bpm?: number; band?: 'antiphase' | 'staggered'; ratchet?: boolean; lines?: { count: number; width: number; speed: number }; patch?: boolean; comb?: number }
/** `calm` patterns must come through byte for byte; every other non-beat pattern must be held within the limit. */
export interface LabCase { name: string; fps: number; spec: Spec; control: boolean; beat: boolean; calm?: boolean; known?: boolean }
export interface LabResult { worst: number; together: number; peak: number; swing: number; redWorst: number; redTogether: number; blackFrames: number; litInBlack: number; sum: number }

const SIZES = [10, 20, 40, 80, 120], OFFSETS = [0, 13, 20];

/** Every pattern the check plays. */
export function labCases(): LabCase[] {
  const out: LabCase[] = [];
  const add = (name: string, spec: Spec, fps = 60, control = false, beat = false) => out.push({ name, fps, spec, control, beat });
  add('full wall', { shape: 0, size: 1, offset: 0, invert: false, colour: WHITE }, 60, true);
  for (const [colourName, colour] of [['white', WHITE], ['red', RED]] as [string, Colour][])
    for (const [shapeName, shape] of [['checker', 1], ['stripes', 2]] as [string, 1 | 2][])
      for (const invert of [true, false]) for (const size of SIZES) for (const offset of OFFSETS)
        add(`${colourName} ${shapeName} ${invert ? 'inverting' : 'to black'} ${size} px +${offset}`, { shape, size, offset, invert, colour }, 60, offset === 13);
  for (const [shapeName, shape] of [['checker', 1], ['stripes', 2]] as [string, 1 | 2][])
    for (const size of [10, 40, 80]) for (const offset of [0, 13])
      add(`Blackout on ${shapeName} ${size} px +${offset}`, { shape, size, offset, invert: false, colour: WHITE, blackout: true }, 60, offset === 13);
  const worst: [string, Spec][] = [
    ['white checker inverting 10 px +13', { shape: 1, size: 10, offset: 13, invert: true, colour: WHITE }],
    ['white checker inverting 20 px +13', { shape: 1, size: 20, offset: 13, invert: true, colour: WHITE }],
    ['white checker inverting 40 px +13', { shape: 1, size: 40, offset: 13, invert: true, colour: WHITE }],
    ['white stripes inverting 20 px +20', { shape: 2, size: 20, offset: 20, invert: true, colour: WHITE }],
    ['white checker to black 40 px +13', { shape: 1, size: 40, offset: 13, invert: false, colour: WHITE }],
    ['red checker inverting 20 px +13', { shape: 1, size: 20, offset: 13, invert: true, colour: RED }],
  ];
  for (const fps of [30, 50, 120]) for (const [name, spec] of worst) add(`${name} at ${fps} fps`, spec, fps, true);
  add('two 18.75% bands in antiphase', { shape: 0, size: 1, offset: 0, invert: false, colour: WHITE, band: 'antiphase' }, 60, true);
  add('four 18.75% bands, 55 ms apart', { shape: 0, size: 1, offset: 0, invert: false, colour: WHITE, band: 'staggered' }, 60, true);
  add('ratchet 0, 1, .009, 1, .018, 1', { shape: 0, size: 1, offset: 0, invert: false, colour: WHITE, ratchet: true }, 60, true);
  for (const bpm of [120, 128, 140, 150, 160, 174]) {
    add(`beat ${bpm} BPM, full wall`, { shape: 0, size: 1, offset: 0, invert: false, colour: WHITE, bpm }, 60, false, true);
    add(`beat ${bpm} BPM, 40 px checker +13`, { shape: 1, size: 40, offset: 13, invert: false, colour: WHITE, bpm }, 60, false, true);
  }
  // The finest inverting patterns, below the 4 px block.
  for (const size of [1, 2, 3, 4, 6, 8]) add(`finest: white checker inverting ${size} px +13`, { shape: 1, size, offset: 13, invert: true, colour: WHITE }, 60, true);
  const combBase = { shape: 0, size: 1, offset: 0, invert: false, colour: WHITE } as const;
  add('comb: 1 px lines every 4 px, swapping by 2 px', { ...combBase, comb: 2 }, 60, true);
  // Reported, not required: a line shaking by one pixel reads as an edge moving. Its light stays in the same place to the eye.
  out.push({ name: 'known limit: 1 px lines every 4 px, shaking by 1 px', fps: 60, spec: { ...combBase, comb: 1 }, control: true, beat: false, known: true });
  // Calm content the limiter must leave alone.
  const none = { shape: 0, size: 1, offset: 0, invert: false, colour: WHITE } as const;
  for (const [count, width, speed] of [[12, 1, 1], [12, 2, 1], [12, 2, 3], [24, 1, 2]]) out.push({ name: `calm: ${count} lines ${width} px wide moving ${speed} px a frame`, fps: 60, spec: { ...none, lines: { count, width, speed } }, control: true, beat: false, calm: true });
  out.push({ name: 'calm: a 10% patch flashing at 10 Hz', fps: 60, spec: { ...none, patch: true }, control: true, beat: false, calm: true });
  return out;
}

const PAINT_VERTEX = `#version 300 es
in vec2 aUnit;
void main() { gl_Position = vec4(aUnit * 2. - 1., 0., 1.); }`;
const PAINT = `#version 300 es
precision highp float;
out vec4 o;
uniform vec3 uColour;
uniform float uSize, uOffset;
uniform int uShape, uInvert, uOn;
void main() {
  vec2 q = floor((gl_FragCoord.xy + uOffset) / uSize);
  int odd = uShape == 1 ? (int(q.x) + int(q.y)) & 1 : uShape == 2 ? int(q.x) & 1 : 0;
  bool lit = uInvert == 1 ? (odd == 0) == (uOn == 1) : odd == 0 && uOn == 1;
  if (!lit) discard;
  o = vec4(uColour, 1.);
}`;

const linear = Float32Array.from({ length: 256 }, (_, i) => { const n = i / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });

/** Counts each sample point's changes, and keeps the times of the latest so any rolling second can be judged as it passes. */
class Counter {
  private readonly anchor = new Float32Array(POINTS);
  private readonly way = new Int8Array(POINTS);
  private readonly ring = new Int32Array(POINTS * RING).fill(-1e9);
  private readonly seen = new Int32Array(POINTS);
  private started = false;
  worst = 0;
  together = 0;
  constructor(private readonly step: number, private readonly darker: number, private readonly limit: number) {}
  see(values: Float32Array, frame: number, window: number): void {
    if (!this.started) { this.anchor.set(values); this.started = true; return; }
    const { anchor, way, step, darker, ring, seen, limit } = this;
    let over = 0;
    for (let i = 0; i < POINTS; i++) {
      const v = values[i];
      if (way[i] === 1 && v > anchor[i]) anchor[i] = v; else if (way[i] === -1 && v < anchor[i]) anchor[i] = v;
      let changed = false;
      if (way[i] >= 0 && v <= anchor[i] - step && v < darker) { way[i] = -1; anchor[i] = v; changed = true; }
      else if (way[i] <= 0 && v >= anchor[i] + step && anchor[i] < darker) { way[i] = 1; anchor[i] = v; changed = true; }
      if (changed) { ring[i * RING + seen[i] % RING] = frame; seen[i]++; }
      let n = 0;
      for (let k = 1; k <= RING && k <= seen[i]; k++) { if (ring[i * RING + (seen[i] - k) % RING] > frame - window) n++; else break; }
      if (n > this.worst) this.worst = n;
      if (n > limit) over++;
    }
    if (over / POINTS > this.together) this.together = over / POINTS;
  }
}

class Painter {
  private readonly program: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null>;
  constructor(private readonly gl: WebGL2RenderingContext) {
    const make = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'lab shader'); return s; };
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, make(gl.VERTEX_SHADER, PAINT_VERTEX)); gl.attachShader(this.program, make(gl.FRAGMENT_SHADER, PAINT));
    gl.bindAttribLocation(this.program, 0, 'aUnit'); gl.linkProgram(this.program);
    this.u = Object.fromEntries(['uColour', 'uSize', 'uOffset', 'uShape', 'uInvert', 'uOn'].map(n => [n, gl.getUniformLocation(this.program, n)]));
  }
  draw(spec: Spec, on: boolean): void {
    const { gl, u } = this;
    gl.useProgram(this.program);
    gl.uniform3fv(u.uColour, spec.colour); gl.uniform1f(u.uSize, spec.size); gl.uniform1f(u.uOffset, spec.offset);
    gl.uniform1i(u.uShape, spec.shape); gl.uniform1i(u.uInvert, spec.invert ? 1 : 0); gl.uniform1i(u.uOn, on ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

const phase = (t: number, hz = 5) => (((t * hz) % 1) + 1) % 1 < .5;

function drawFrame(gl: WebGL2RenderingContext, painter: Painter, spec: Spec, frame: number, fps: number): boolean {
  const t = frame / fps;
  if (spec.blackout && !phase(t)) return true;
  if (spec.ratchet) {
    const value = RATCHET[frame % RATCHET.length], encoded = value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
    gl.clearColor(encoded, encoded, encoded, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  } else if (spec.band) {
    const W = STAGE_SIZE.width, bandW = W * .1875;
    gl.enable(gl.SCISSOR_TEST); gl.clearColor(1, 1, 1, 1);
    for (let b = 0; b < (spec.band === 'antiphase' ? 2 : 4); b++) {
      const lit = spec.band === 'antiphase' ? phase(t) === (b === 0) : phase(t + b * .055);
      if (lit) { gl.scissor(Math.round(b * bandW), 0, Math.round(bandW), STAGE_SIZE.height); gl.clear(gl.COLOR_BUFFER_BIT); }
    }
    gl.disable(gl.SCISSOR_TEST);
  } else if (spec.lines) {
    const { count, width, speed } = spec.lines, W = STAGE_SIZE.width;
    gl.enable(gl.SCISSOR_TEST); gl.clearColor(1, 1, 1, 1);
    for (let i = 0; i < count; i++) { gl.scissor(Math.floor(i * W / count + frame * speed) % W, 0, width, STAGE_SIZE.height); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.disable(gl.SCISSOR_TEST);
  } else if (spec.comb) {
    gl.enable(gl.SCISSOR_TEST); gl.clearColor(1, 1, 1, 1);
    for (let x = phase(t) ? 0 : spec.comb; x < STAGE_SIZE.width; x += 4) { gl.scissor(x, 0, 1, STAGE_SIZE.height); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.disable(gl.SCISSOR_TEST);
  } else if (spec.patch) {
    if (phase(t, 10)) { gl.enable(gl.SCISSOR_TEST); gl.clearColor(1, 1, 1, 1); gl.scissor(0, 0, Math.round(STAGE_SIZE.width * .1), STAGE_SIZE.height); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST); }
  } else if (spec.bpm) painter.draw(spec, ((t % (60 / spec.bpm)) + 60 / spec.bpm) % (60 / spec.bpm) < .12);
  else painter.draw(spec, spec.blackout ? true : phase(t));
  return false;
}

function play(gpu: Gpu, painter: Painter, item: LabCase, limited: boolean, bytes: Uint8Array): LabResult {
  const gl = gpu.gl, { fps, spec } = item, frames = fps * SECONDS, light = new Counter(.1, .8, LIGHT_LIMIT), red = new Counter(.0625, 2, RED_LIMIT);
  const lightValues = new Float32Array(POINTS), redValues = new Float32Array(POINTS);
  let peak = 0, low = Infinity, blackFrames = 0, litInBlack = 0, sum = 0;
  // Starts from black, as a show does.
  gpu.begin();
  if (limited) gpu.limitStage(0, 1, true);
  for (let f = 0; f < frames; f++) {
    gpu.begin();
    const dark = drawFrame(gl, painter, spec, f, fps);
    if (limited) gpu.limitStage(1 / fps, 0, false);
    gpu.readStagePoints(bytes, STRIDE);
    let brightest = 0;
    for (let i = 0; i < bytes.length; i++) sum = (Math.imul(sum, 31) + bytes[i]) | 0;
    for (let i = 0; i < POINTS; i++) {
      const cr = linear[bytes[i * 4]], cg = linear[bytes[i * 4 + 1]], cb = linear[bytes[i * 4 + 2]], sum = cr + cg + cb, y = .2126 * cr + .7152 * cg + .0722 * cb;
      lightValues[i] = y; redValues[i] = sum > 1e-4 && cr / sum >= .8 ? Math.max(0, cr - cg - cb) : 0;
      if (y > brightest) brightest = y;
    }
    if (f > fps / 2) { if (brightest > peak) peak = brightest; if (brightest < low) low = brightest; }
    if (dark) { blackFrames++; if (brightest > 0) litInBlack++; }
    light.see(lightValues, f, fps); red.see(redValues, f, fps);
  }
  return { worst: light.worst, together: light.together, peak, swing: peak - (low === Infinity ? 0 : low), redWorst: red.worst, redTogether: red.together, blackFrames, litInBlack, sum };
}

export type LabReport = Record<string, { fps: number; beat: boolean; calm: boolean; known: boolean; raw: LabResult | null; limited: LabResult }>;

/** The patterns whose names contain `only` (all of them by default), limited, and with the limiter off for the controls. */
export async function runLimiterLab(only = ''): Promise<LabReport> {
  const canvas = new OffscreenCanvas(STAGE_SIZE.width, STAGE_SIZE.height), gpu = new Gpu(canvas), out: LabReport = {};
  const painter = new Painter(gpu.gl), bytes = new Uint8Array(POINTS * 4);
  try {
    for (const item of labCases()) {
      if (only && !item.name.includes(only)) continue;
      const raw = item.control ? play(gpu, painter, item, false, bytes) : null;
      const limited = play(gpu, painter, item, true, bytes);
      if (gpu.guardError) throw new Error(`the limiter could not be built: ${gpu.guardError}`);
      out[item.name] = { fps: item.fps, beat: item.beat, calm: !!item.calm, known: !!item.known, raw, limited };
      await new Promise(done => setTimeout(done, 0));
    }
  } finally { gpu.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  return out;
}
