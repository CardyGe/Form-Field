// Engineering screen for flashing, modelled on ITU-R BT.1702-3. It is not a certified analyser.
// Input is linear-light R, G, B per grid cell (0..1), one frame at a time.
const FLASH_DELTA = 20; // cd/m2, or the red metric's equivalent threshold
const DARK_LIMIT = 160; // cd/m2: the darker state must be below this for a general flash
const MIN_TRANSITIONS = 7; // the 7th opposing change in one second means a 4th flash has begun
const AREA_LIMIT = 0.25;

class Tracker {
  constructor(cells, rate, darkLimit) {
    Object.assign(this, { cells, rate, darkLimit, maxArea: 0, framesOverArea: 0, peakFrameArea: 0, maxWideEventsPerSecond: 0 });
    this.lo = new Float32Array(cells); this.hi = new Float32Array(cells); this.dir = new Int8Array(cells);
    this.count = new Uint8Array(cells); this.ring = new Uint8Array(cells * rate);
    this.wide = new Uint8Array(rate); this.wideCount = 0; this.frame = 0;
  }
  push(values) {
    const { cells, rate, lo, hi, dir, count, ring, darkLimit } = this;
    const offset = (this.frame % rate) * cells;
    let over = 0, events = 0;
    for (let i = 0; i < cells; i++) {
      const v = values[i];
      if (this.frame === 0) { lo[i] = hi[i] = v; }
      let event = 0;
      if (dir[i] >= 0 && v > hi[i]) hi[i] = v;
      if (dir[i] <= 0 && v < lo[i]) lo[i] = v;
      if (dir[i] >= 0 && hi[i] - v >= FLASH_DELTA && v < darkLimit) { event = 1; dir[i] = -1; lo[i] = v; }
      else if (dir[i] <= 0 && v - lo[i] >= FLASH_DELTA && lo[i] < darkLimit) { event = 1; dir[i] = 1; hi[i] = v; }
      count[i] += event - ring[offset + i];
      ring[offset + i] = event;
      events += event;
      if (count[i] >= MIN_TRANSITIONS) over++;
    }
    const area = over / cells, frameArea = events / cells, isWide = frameArea >= AREA_LIMIT ? 1 : 0, slot = this.frame % rate;
    this.wideCount += isWide - this.wide[slot]; this.wide[slot] = isWide;
    this.maxArea = Math.max(this.maxArea, area);
    this.peakFrameArea = Math.max(this.peakFrameArea, frameArea);
    this.maxWideEventsPerSecond = Math.max(this.maxWideEventsPerSecond, this.wideCount);
    if (area > AREA_LIMIT) this.framesOverArea++;
    this.frame++;
  }
  result() {
    return { maxAreaOverLimitPct: +(this.maxArea * 100).toFixed(3), framesOverArea: this.framesOverArea, peakSingleFrameChangePct: +(this.peakFrameArea * 100).toFixed(3),
      maxWideFlashesPerSecond: this.maxWideEventsPerSecond / 2, pass: this.maxArea <= AREA_LIMIT };
  }
}

export class FlashAnalyzer {
  constructor(cells, rate, peaks = [200, 1000, 1500]) {
    this.cells = cells; this.peaks = peaks;
    this.general = peaks.map(() => new Tracker(cells, rate, DARK_LIMIT));
    this.red = new Tracker(cells, rate, Infinity);
    this.buffer = new Float32Array(cells); this.redBuffer = new Float32Array(cells);
    this.meanSum = 0; this.frames = 0; this.saturatedRedMax = 0;
  }
  push(r, g, b) {
    const { cells, buffer, redBuffer } = this;
    let mean = 0, saturated = 0;
    for (let i = 0; i < cells; i++) {
      const sum = r[i] + g[i] + b[i];
      buffer[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
      mean += buffer[i];
      // WCAG's numeric definition of saturated red, on linear values.
      const isRed = sum > 0 && r[i] / sum >= 0.8;
      redBuffer[i] = isRed ? Math.max(0, r[i] - g[i] - b[i]) * 320 : 0;
      if (redBuffer[i] > FLASH_DELTA) saturated++;
    }
    this.meanSum += mean / cells; this.frames++;
    this.saturatedRedMax = Math.max(this.saturatedRedMax, saturated / cells);
    this.peaks.forEach((peak, index) => {
      const scaled = new Float32Array(cells);
      for (let i = 0; i < cells; i++) scaled[i] = buffer[i] * peak;
      this.general[index].push(scaled);
    });
    this.red.push(redBuffer);
  }
  result() {
    return { meanLinearLuminance: +(this.meanSum / this.frames).toFixed(5), peakSaturatedRedAreaPct: +(this.saturatedRedMax * 100).toFixed(3),
      general: Object.fromEntries(this.peaks.map((peak, i) => [`${peak}nit`, this.general[i].result()])), red: this.red.result() };
  }
}

// Known signals. The screen is only trusted if every one of these gets the expected verdict.
export function runControls(rate = 60, cols = 32, rows = 18) {
  const cells = cols * rows;
  const cases = [
    ['white 10 Hz, full field', 10, 1, [1, 1, 1], false, true],
    ['white 2 Hz, full field', 2, 1, [1, 1, 1], true, true],
    ['white 10 Hz, 20% area', 10, .2, [1, 1, 1], true, true],
    ['white 10 Hz, 30% area', 10, .3, [1, 1, 1], false, true],
    ['dim red 10 Hz, full field', 10, 1, [.1, 0, 0], true, false],
  ];
  return cases.map(([name, hz, area, colour, expectGeneral, expectRed]) => {
    const analyzer = new FlashAnalyzer(cells, rate, [200]);
    const lit = Math.round(cells * area);
    const r = new Float32Array(cells), g = new Float32Array(cells), b = new Float32Array(cells);
    for (let f = 0; f < rate * 3; f++) {
      const on = Math.floor(2 * hz * f / rate) % 2 === 0;
      for (let i = 0; i < cells; i++) { const v = on && i < lit; r[i] = v ? colour[0] : 0; g[i] = v ? colour[1] : 0; b[i] = v ? colour[2] : 0; }
      analyzer.push(r, g, b);
    }
    const out = analyzer.result();
    const general = out.general['200nit'].pass, red = out.red.pass;
    return { name, general, red, ok: general === expectGeneral && red === expectRed };
  });
}
