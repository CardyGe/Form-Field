/**
 * For the scripted checks: plays exact light patterns through the real limiter shaders on their own graphics context, at a fixed
 * 60 frames a second, and counts changes per cell on the output pixels. Nothing here touches a show or the wall.
 */
import { Gpu } from './gpu';
import { STAGE_SIZE } from './show';

const COLS = 48, ROWS = 27, CELL = 40, FPS = 60, SECONDS = 6, STRIDE = 2;
type Paint = { colour: [number, number, number]; lit: (frame: number, col: number, row: number) => boolean; blackout?: (frame: number) => boolean };
const on = (frame: number, shift = 0) => ((((frame / FPS + shift) * 5) % 1) + 1) % 1 < .5;
const checker = (size: number) => (f: number, c: number, r: number) => on(f) === ((Math.floor(c / size) + Math.floor(r / size)) % 2 === 0);
const WHITE: [number, number, number] = [1, 1, 1], RED: [number, number, number] = [1, 0, 0];
const RATCHET = [0, 1, .009, 1, .018, 1];

export const LAB_PATTERNS: Record<string, Paint> = {
  'full wall': { colour: WHITE, lit: f => on(f) },
  'checker 40 px': { colour: WHITE, lit: checker(1) },
  'checker 80 px': { colour: WHITE, lit: checker(2) },
  'checker 120 px': { colour: WHITE, lit: checker(3) },
  'stripes 40 px': { colour: WHITE, lit: (f, c) => on(f) === (c % 2 === 0) },
  'two 18.75% bands in antiphase': { colour: WHITE, lit: (f, c) => c < 9 ? on(f) : c < 18 ? !on(f) : false },
  'four 18.75% bands, 55 ms apart': { colour: WHITE, lit: (f, c) => c < 36 && on(f, Math.floor(c / 9) * .055) },
  'saturated red checker': { colour: RED, lit: checker(1) },
  'Blackout hammered on a checker': { colour: WHITE, lit: (_f, c, r) => (c + r) % 2 === 0, blackout: f => !on(f) },
};

export interface LabResult { worst: number; together: number; peak: number; redWorst: number; blackFrames: number; litInBlack: number }

const linear = Float32Array.from({ length: 256 }, (_, i) => { const n = i / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });

class Counter {
  private readonly anchor = new Float32Array(COLS * ROWS);
  private readonly way = new Int8Array(COLS * ROWS);
  readonly times: number[][] = Array.from({ length: COLS * ROWS }, () => []);
  private started = false;
  constructor(private readonly step: number, private readonly darker: number) {}
  see(cells: Float32Array, frame: number): void {
    if (!this.started) { this.anchor.set(cells); this.started = true; return; }
    const { anchor, way, step, darker } = this;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (way[i] === 1 && v > anchor[i]) anchor[i] = v; else if (way[i] === -1 && v < anchor[i]) anchor[i] = v;
      if (way[i] >= 0 && v <= anchor[i] - step && v < darker) { way[i] = -1; anchor[i] = v; this.times[i].push(frame); }
      else if (way[i] <= 0 && v >= anchor[i] + step && anchor[i] < darker) { way[i] = 1; anchor[i] = v; this.times[i].push(frame); }
    }
  }
  /** The most changes any cell makes in a second, and the largest share of the wall over `limit` in the same second. */
  verdict(frames: number, limit: number): { worst: number; together: number } {
    let worst = 0, together = 0;
    for (let start = 0; start + FPS <= frames; start += 3) {
      let over = 0;
      for (const list of this.times) { let n = 0; for (const f of list) if (f >= start && f < start + FPS) n++; if (n > worst) worst = n; if (n > limit) over++; }
      together = Math.max(together, over / this.times.length);
    }
    return { worst, together };
  }
}

function play(gpu: Gpu, paint: Paint | 'ratchet', limited: boolean): LabResult {
  const gl = gpu.gl, frames = FPS * SECONDS, pixels = new Uint8Array(STAGE_SIZE.width * STAGE_SIZE.height * 4), light = new Counter(.1, .8), red = new Counter(.0625, 2);
  const cells = new Float32Array(COLS * ROWS), r = new Float32Array(COLS * ROWS), g = new Float32Array(COLS * ROWS), b = new Float32Array(COLS * ROWS), redCells = new Float32Array(COLS * ROWS);
  const perCell = (CELL / STRIDE) * (CELL / STRIDE);
  let peak = 0, blackFrames = 0, litInBlack = 0;
  // Starts from black, as a show does.
  gpu.begin();
  if (limited) gpu.limitStage(0, 1, true);
  for (let f = 0; f < frames; f++) {
    gpu.begin();
    const dark = paint !== 'ratchet' && paint.blackout?.(f);
    if (!dark) {
      gl.enable(gl.SCISSOR_TEST);
      if (paint === 'ratchet') {
        const value = RATCHET[f % RATCHET.length], encoded = value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
        gl.scissor(0, 0, STAGE_SIZE.width, STAGE_SIZE.height); gl.clearColor(encoded, encoded, encoded, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      } else {
        gl.clearColor(paint.colour[0], paint.colour[1], paint.colour[2], 1);
        for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (paint.lit(f, col, row)) { gl.scissor(col * CELL, row * CELL, CELL, CELL); gl.clear(gl.COLOR_BUFFER_BIT); }
      }
      gl.disable(gl.SCISSOR_TEST);
    }
    if (limited) gpu.limitStage(1 / FPS, 0, false);
    gpu.readStage(pixels);
    r.fill(0); g.fill(0); b.fill(0);
    for (let y = 0; y < STAGE_SIZE.height; y += STRIDE) for (let x = 0; x < STAGE_SIZE.width; x += STRIDE) {
      const at = (y * STAGE_SIZE.width + x) * 4, i = Math.floor(y / CELL) * COLS + Math.floor(x / CELL);
      r[i] += linear[pixels[at]]; g[i] += linear[pixels[at + 1]]; b[i] += linear[pixels[at + 2]];
    }
    let brightest = 0;
    for (let i = 0; i < cells.length; i++) {
      const cr = r[i] / perCell, cg = g[i] / perCell, cb = b[i] / perCell, sum = cr + cg + cb;
      cells[i] = .2126 * cr + .7152 * cg + .0722 * cb;
      redCells[i] = sum > 1e-4 && cr / sum >= .8 ? Math.max(0, cr - cg - cb) : 0;
      if (cells[i] > brightest) brightest = cells[i];
    }
    if (f > FPS / 2 && brightest > peak) peak = brightest;
    if (dark) { blackFrames++; if (brightest > 0) litInBlack++; }
    light.see(cells, f); red.see(redCells, f);
  }
  const counted = light.verdict(frames, 6), reds = red.verdict(frames, 4);
  return { worst: counted.worst, together: counted.together, peak, redWorst: reds.worst, blackFrames, litInBlack };
}

/** Every pattern, with the limiter off as a control and on. */
export async function runLimiterLab(): Promise<Record<string, { raw: LabResult; limited: LabResult }>> {
  const canvas = new OffscreenCanvas(STAGE_SIZE.width, STAGE_SIZE.height), gpu = new Gpu(canvas), out: Record<string, { raw: LabResult; limited: LabResult }> = {};
  const patterns: [string, Paint | 'ratchet'][] = [...Object.entries(LAB_PATTERNS), ['ratchet 0, 1, .009, 1, .018, 1', 'ratchet']];
  try {
    for (const [name, paint] of patterns) {
      const raw = play(gpu, paint, false);
      await new Promise(done => setTimeout(done, 0));
      const limited = play(gpu, paint, true);
      if (gpu.guardError) throw new Error(`the limiter could not be built: ${gpu.guardError}`);
      out[name] = { raw, limited };
      await new Promise(done => setTimeout(done, 0));
    }
  } finally { gpu.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  return out;
}
