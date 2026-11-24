/**
 * Anonymous bodies from a small presence grid, for Meridian Live.
 *
 * The grid is read back from the graphics card a few times a second at 64 x 36. Each cell holds a person likelihood (or, with
 * no people model, recent movement) and the movement there. Connected cells become blobs; blobs are matched to the bodies
 * of the last frame by their predicted positions, so a person keeps one id while walking, crossing someone or being lost for
 * a moment. Nothing here is a picture: a body is a position, a speed, a size, an energy and a stillness timer, held only in
 * memory and forgotten when the person leaves.
 *
 * Party light changes the whole camera image at once. A frame in which most of the grid changes is a lighting event: it can
 * neither create a body nor raise anyone's energy.
 */

export const GRID_WIDTH = 64;
export const GRID_HEIGHT = 36;
/** The most bodies ever tracked. */
export const MAX_BODIES = 8;

export interface Body {
  /** Rises with every new person. Never reused while the tracker runs. */
  id: number;
  /** Centre in the camera's uv, origin bottom-left, already mirrored as the camera is shown. Eased by Follow speed. */
  x: number; y: number;
  /** uv per second, measured from the blob itself, not eased by Follow speed. */
  vx: number; vy: number;
  /** Height of the blob as a share of the frame. */
  size: number;
  /** 0 to 1: how much this person is moving. */
  energy: number;
  /** Seconds since this person last moved. */
  stillness: number;
  /** Seconds since this person was first seen. */
  age: number;
  /** 0 to 1: eases in when found and out while lost, so nothing driven by it pops. */
  presence: number;
}

export interface BodySettings {
  /** 1 to 8. The largest people are kept. */
  maxBodies: number;
  /** 0 to 1: how quickly a body's position follows its blob. */
  followSpeed: number;
  /** The smallest blob that can be a person, as a share of the frame's area. */
  minSize: number;
  /**
   * No people model: presence is only recent movement, so light beams and a projection the camera can see could look like
   * people. Blobs must then be person-shaped (solid, upright, not a thin line or a ring) and stay a moment at a steady size
   * before anyone is found.
   */
  movementOnly?: boolean;
}

const ON = 0.4;               // Presence at which a cell belongs to someone.
const CHANGED = 0.3;          // A cell whose presence moved this much in one frame has changed.
const MOVING = 0.25;          // A cell with this much movement is moving.
const LIGHTING_SHARE = 0.6;   // A frame in which this share of the grid changes is a lighting event, not people.
const COVERED_SHARE = 0.8;    // Presence over this share of the grid is a lighting artefact.
const GIANT_SHARE = 0.5;      // A blob this large cannot be one person.
const REFRACTORY = 0.6;       // Seconds after a lighting event in which nobody new is found.
const SURVIVE = 0.75;         // Seconds a body is kept without a match.
const GATE = 0.2;             // uv: the furthest a blob may be from where a body was expected.
const TRUST_AFTER = 0.15;     // Seconds before a new body's speed is believed.
const SPEED_TAU = 0.12;       // Seconds over which measured speed is smoothed.
const MAX_SPEED = 3;          // uv per second.
const STILL_MOVE = 0.12, STILL_SPEED = 0.05;
const ENERGY_RISE = 0.15, ENERGY_FALL = 0.5;
const PRESENCE_RISE = 0.3, PRESENCE_FALL = 0.5;
const SHARED_DAMP = 3;        // Seconds: how slowly two people inside one blob lose the speed they came in with.
const MAX_BLOBS = 32;
const CONFIRM_SECONDS = 0.4;  // Movement only: how long a blob must last, at a steady size, before it is a person.
const CONFIRM_GATE = 0.08;    // uv: how far a waiting blob may move between grids and still be the same one.
const STEADY_SIZE = 1.45;     // The most a waiting blob's area may grow or shrink by between grids.
const MIN_FILL = 0.4;         // Movement only: share of its bounding box a blob must fill. A line or a ring fills far less.
const MIN_UPRIGHT = 0.5, MAX_UPRIGHT = 6; // Movement only: height over width, in cells. A shaft of light is far taller.

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const ease = (dt: number, tau: number): number => 1 - Math.exp(-dt / Math.max(1e-4, tau));
const byId = (a: Body, b: Body): number => a.id - b.id;

/** One person as the tracker keeps them: the published body plus what matching needs. */
interface Track { body: Body; alive: boolean; rawX: number; rawY: number; missing: number; matched: boolean; shared: boolean; area: number }

export class BodyTracker {
  private presence = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
  private last = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
  private movement = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
  private labels = new Int32Array(GRID_WIDTH * GRID_HEIGHT);
  private stack = new Int32Array(GRID_WIDTH * GRID_HEIGHT);
  private size = GRID_WIDTH * GRID_HEIGHT;
  // Blobs, as parallel arrays.
  private blobCount = 0;
  private readonly bCells = new Float64Array(MAX_BLOBS);
  private readonly bWeight = new Float64Array(MAX_BLOBS);
  private readonly bX = new Float64Array(MAX_BLOBS);
  private readonly bY = new Float64Array(MAX_BLOBS);
  private readonly bMove = new Float64Array(MAX_BLOBS);
  private readonly bLeft = new Int32Array(MAX_BLOBS);
  private readonly bRight = new Int32Array(MAX_BLOBS);
  private readonly bBottom = new Int32Array(MAX_BLOBS);
  private readonly bTop = new Int32Array(MAX_BLOBS);
  private readonly bTaken = new Uint8Array(MAX_BLOBS);
  private readonly bInside = new Uint8Array(MAX_BLOBS);
  private readonly tracks: Track[] = Array.from({ length: MAX_BODIES }, () => ({
    body: { id: 0, x: 0, y: 0, vx: 0, vy: 0, size: 0, energy: 0, stillness: 0, age: 0, presence: 0 }, alive: false, rawX: 0, rawY: 0, missing: 0, matched: false, shared: false, area: 0,
  }));
  private readonly active: Body[] = [];
  // Movement only: blobs waiting to be confirmed as people.
  private waiting = 0;
  private readonly wX = new Float64Array(MAX_BLOBS);
  private readonly wY = new Float64Array(MAX_BLOBS);
  private readonly wArea = new Float64Array(MAX_BLOBS);
  private readonly wAge = new Float64Array(MAX_BLOBS);
  private readonly nX = new Float64Array(MAX_BLOBS);
  private readonly nY = new Float64Array(MAX_BLOBS);
  private readonly nArea = new Float64Array(MAX_BLOBS);
  private readonly nAge = new Float64Array(MAX_BLOBS);
  private readonly bAge = new Float64Array(MAX_BLOBS);
  private nextId = 1;
  private refractory = 0;
  private primed = false;
  private lighting = false;

  /** True while the last frame, or one moments before it, changed nearly everywhere at once. */
  get lightingEvent(): boolean { return this.lighting; }

  reset(): void {
    for (const t of this.tracks) t.alive = false;
    this.active.length = 0; this.waiting = 0;
    this.refractory = 0; this.primed = false; this.lighting = false;
  }

  /**
   * One grid. `grid` holds 2 (RG) or 4 (RGBA) bytes per cell, row 0 at the bottom: R person likelihood, G movement.
   * `dt` is the time since the last grid.
   */
  update(grid: Uint8Array, width: number, height: number, dt: number, settings: BodySettings): readonly Body[] {
    const cells = width * height, stride = cells > 0 ? Math.floor(grid.length / cells) : 0;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.5) : 0;
    if (cells <= 0 || stride < 2) return this.publish();
    if (cells !== this.size) this.resize(cells);
    const presence = this.presence, movement = this.movement, last = this.last;
    let on = 0, changed = 0, moving = 0;
    for (let i = 0; i < cells; i++) {
      const p = grid[i * stride] / 255, m = grid[i * stride + 1] / 255;
      if (p >= ON) on++;
      if (m >= MOVING) moving++;
      if (this.primed && Math.abs(p - last[i]) >= CHANGED) changed++;
      presence[i] = p; movement[i] = m; last[i] = p;
    }
    this.primed = true;
    const flash = moving / cells > LIGHTING_SHARE || changed / cells > LIGHTING_SHARE || on / cells > COVERED_SHARE;
    if (flash) this.refractory = REFRACTORY; else this.refractory = Math.max(0, this.refractory - step);
    this.lighting = flash || this.refractory > 0;

    this.findBlobs(width, height, settings.minSize, settings.movementOnly === true);
    this.confirm(step, settings.movementOnly === true);
    this.match(width, height, step, settings);
    return this.publish();
  }

  private resize(cells: number): void {
    this.size = cells;
    this.presence = new Float32Array(cells); this.last = new Float32Array(cells); this.movement = new Float32Array(cells);
    this.labels = new Int32Array(cells); this.stack = new Int32Array(cells);
    this.primed = false;
  }

  /** Connected cells above ON, four-connected. Blobs too small to be a person, or too large to be one, are left out. */
  private findBlobs(width: number, height: number, minSize: number, movementOnly: boolean): void {
    const cells = width * height, labels = this.labels, presence = this.presence, movement = this.movement, stack = this.stack;
    const smallest = Math.max(3, clamp(Number.isFinite(minSize) ? minSize : 0.006, 0, 0.5) * cells), largest = GIANT_SHARE * cells;
    labels.fill(0);
    this.blobCount = 0;
    let label = 0;
    for (let start = 0; start < cells; start++) {
      if (labels[start] !== 0 || presence[start] < ON) continue;
      label++;
      let top = 0, count = 0, weight = 0, sx = 0, sy = 0, move = 0, left = width, right = -1, bottom = height, up = -1;
      stack[top++] = start; labels[start] = label;
      while (top > 0) {
        const i = stack[--top], c = i % width, r = (i - c) / width, p = presence[i];
        count++; weight += p; sx += (c + 0.5) * p; sy += (r + 0.5) * p; move += movement[i];
        if (c < left) left = c; if (c > right) right = c; if (r < bottom) bottom = r; if (r > up) up = r;
        if (c > 0 && labels[i - 1] === 0 && presence[i - 1] >= ON) { labels[i - 1] = label; stack[top++] = i - 1; }
        if (c < width - 1 && labels[i + 1] === 0 && presence[i + 1] >= ON) { labels[i + 1] = label; stack[top++] = i + 1; }
        if (r > 0 && labels[i - width] === 0 && presence[i - width] >= ON) { labels[i - width] = label; stack[top++] = i - width; }
        if (r < height - 1 && labels[i + width] === 0 && presence[i + width] >= ON) { labels[i + width] = label; stack[top++] = i + width; }
      }
      if (count < smallest || count > largest) continue;
      if (movementOnly) {
        const cols = right - left + 1, rows = up - bottom + 1, upright = rows / cols;
        if (count / (cols * rows) < MIN_FILL || upright < MIN_UPRIGHT || upright > MAX_UPRIGHT) continue;
      }
      // Full: the new blob replaces the smallest kept, if it is larger.
      let at = this.blobCount;
      if (at >= MAX_BLOBS) {
        at = 0;
        for (let k = 1; k < MAX_BLOBS; k++) if (this.bCells[k] < this.bCells[at]) at = k;
        if (this.bCells[at] >= count) continue;
      } else this.blobCount++;
      this.bCells[at] = count; this.bWeight[at] = weight; this.bX[at] = sx / weight / width; this.bY[at] = sy / weight / height; this.bMove[at] = move / count;
      this.bLeft[at] = left; this.bRight[at] = right; this.bBottom[at] = bottom; this.bTop[at] = up;
    }
  }

  private match(width: number, height: number, step: number, settings: BodySettings): void {
    const tracks = this.tracks, blobs = this.blobCount, lighting = this.lighting;
    const most = clamp(Math.round(Number.isFinite(settings.maxBodies) ? settings.maxBodies : MAX_BODIES), 1, MAX_BODIES);
    this.bTaken.fill(0, 0, blobs); this.bInside.fill(0, 0, blobs);
    for (const t of tracks) { t.matched = false; t.shared = false; }

    // Two people inside one blob (crossing, or standing together) both carry on as they were, rather than one being dragged.
    for (let b = 0; b < blobs; b++) {
      const left = (this.bLeft[b] - 0.5) / width, right = (this.bRight[b] + 1.5) / width, bottom = (this.bBottom[b] - 0.5) / height, top = (this.bTop[b] + 1.5) / height;
      let inside = 0;
      for (const t of tracks) {
        if (!t.alive) continue;
        const px = t.rawX + t.body.vx * step, py = t.rawY + t.body.vy * step;
        if (px >= left && px <= right && py >= bottom && py <= top) inside++;
      }
      if (inside < 2) continue;
      this.bInside[b] = 1; this.bTaken[b] = 1;
      for (const t of tracks) {
        if (!t.alive) continue;
        const px = t.rawX + t.body.vx * step, py = t.rawY + t.body.vy * step;
        if (px < left || px > right || py < bottom || py > top) continue;
        t.matched = true; t.shared = true;
        const damp = Math.exp(-step / SHARED_DAMP);
        t.body.vx *= damp; t.body.vy *= damp;
        t.rawX = clamp(px, left, right); t.rawY = clamp(py, bottom, top);
        this.seen(t, b, step, lighting, settings, width, height, false);
      }
    }

    // Nearest first: the closest pair of body and blob is matched, then the next closest, and so on.
    for (;;) {
      let best = Infinity, bestTrack = -1, bestBlob = -1;
      for (let k = 0; k < tracks.length; k++) {
        const t = tracks[k];
        if (!t.alive || t.matched) continue;
        const px = t.rawX + t.body.vx * step, py = t.rawY + t.body.vy * step, gate = GATE + Math.hypot(t.body.vx, t.body.vy) * step * 3;
        for (let b = 0; b < blobs; b++) {
          if (this.bTaken[b]) continue;
          const d = Math.hypot(this.bX[b] - px, (this.bY[b] - py) * height / width);
          if (d < gate && d < best) { best = d; bestTrack = k; bestBlob = b; }
        }
      }
      if (bestTrack < 0) break;
      const t = tracks[bestTrack], b = bestBlob;
      this.bTaken[b] = 1; t.matched = true;
      this.measure(t, b, step, width, height);
      this.seen(t, b, step, lighting, settings, width, height, true);
    }

    // The unmatched carry on along their way for a moment, then are let go.
    for (const t of tracks) {
      if (!t.alive || t.matched) continue;
      t.missing += step;
      if (t.missing > SURVIVE) { t.alive = false; continue; }
      const damp = Math.exp(-step / 0.4), b = t.body;
      t.rawX = clamp(t.rawX + b.vx * step, 0, 1); t.rawY = clamp(t.rawY + b.vy * step, 0, 1);
      b.vx *= damp; b.vy *= damp;
      b.presence = Math.max(0, b.presence - step / PRESENCE_FALL);
      b.energy *= Math.exp(-step / ENERGY_FALL);
      b.stillness += step;
      this.follow(t, step, settings);
      b.age += step;
    }

    // New people, largest first, while there is room. Nobody is found during a lighting event.
    if (!lighting) for (;;) {
      let alive = 0;
      for (const t of tracks) if (t.alive) alive++;
      if (alive >= most) break;
      let largest = -1;
      for (let b = 0; b < blobs; b++) if (!this.bTaken[b] && this.bAge[b] >= 0 && (largest < 0 || this.bCells[b] > this.bCells[largest])) largest = b;
      if (largest < 0) break;
      this.bTaken[largest] = 1;
      let free = 0;
      while (tracks[free].alive) free++;
      const t = tracks[free], body = t.body;
      t.alive = true; t.missing = 0; t.matched = true; t.shared = false;
      t.rawX = this.bX[largest]; t.rawY = this.bY[largest]; t.area = this.bCells[largest];
      body.id = this.nextId++; body.x = t.rawX; body.y = t.rawY; body.vx = 0; body.vy = 0;
      body.size = (this.bTop[largest] - this.bBottom[largest] + 1) / height;
      body.energy = 0; body.stillness = 0; body.age = 0; body.presence = 0;
      this.seen(t, largest, 0, false, settings, width, height, false);
    }

    // Too many (Max bodies was lowered): the smallest go.
    for (;;) {
      let alive = 0, smallest: Track | null = null;
      for (const t of tracks) if (t.alive) { alive++; if (!smallest || t.area < smallest.area) smallest = t; }
      if (alive <= most || !smallest) break;
      smallest.alive = false;
    }
  }

  /**
   * Movement only: each blob is matched to one waiting from the last grid, nearest first. One that has stayed near, at a
   * steady size, for CONFIRM_SECONDS may become a person; one that has not is held back (bAge below zero). With the people
   * model every blob may become a person at once.
   */
  private confirm(step: number, movementOnly: boolean): void {
    const blobs = this.blobCount;
    if (!movementOnly) { this.bAge.fill(0, 0, blobs); this.waiting = 0; return; }
    let next = 0;
    for (let b = 0; b < blobs; b++) {
      let best = -1, bestD = CONFIRM_GATE;
      for (let w = 0; w < this.waiting; w++) {
        const d = Math.hypot(this.bX[b] - this.wX[w], this.bY[b] - this.wY[w]), ratio = this.bCells[b] / Math.max(1, this.wArea[w]);
        if (d < bestD && ratio < STEADY_SIZE && ratio > 1 / STEADY_SIZE) { bestD = d; best = w; }
      }
      const age = best >= 0 ? this.wAge[best] + step : 0;
      if (best >= 0) this.wArea[best] = -1; // used
      this.nX[next] = this.bX[b]; this.nY[next] = this.bY[b]; this.nArea[next] = this.bCells[b]; this.nAge[next] = age; next++;
      this.bAge[b] = age >= CONFIRM_SECONDS ? age : -1;
    }
    this.wX.set(this.nX); this.wY.set(this.nY); this.wArea.set(this.nArea); this.wAge.set(this.nAge); this.waiting = next;
  }

  /** Speed from the blob's own centre. Along an axis where the blob is cut by the frame edge, the centre says nothing. */
  private measure(t: Track, b: number, step: number, width: number, height: number): void {
    const body = t.body, x = this.bX[b], y = this.bY[b];
    if (step > 0) {
      const trusted = body.age >= TRUST_AFTER && !this.lighting;
      const cutX = this.bLeft[b] <= 0 || this.bRight[b] >= width - 1, cutY = this.bBottom[b] <= 0 || this.bTop[b] >= height - 1;
      const mx = trusted && !cutX ? (x - t.rawX) / step : 0, my = trusted && !cutY ? (y - t.rawY) / step : 0;
      const k = ease(step, SPEED_TAU);
      body.vx += (mx - body.vx) * k; body.vy += (my - body.vy) * k;
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > MAX_SPEED) { body.vx *= MAX_SPEED / speed; body.vy *= MAX_SPEED / speed; }
    }
    t.rawX = x; t.rawY = y;
  }

  /** A body that has a blob this frame: its size, energy, stillness and presence. */
  private seen(t: Track, b: number, step: number, lighting: boolean, settings: BodySettings, width: number, height: number, own: boolean): void {
    const body = t.body;
    t.missing = 0;
    if (own) { t.area = this.bCells[b]; body.size += ((this.bTop[b] - this.bBottom[b] + 1) / height - body.size) * ease(step, 0.25); }
    const speed = Math.hypot(body.vx, body.vy * height / width);
    const move = this.bMove[b];
    const wanted = clamp(move * 1.6 + speed * 0.8, 0, 1);
    if (!lighting || wanted < body.energy) body.energy += (wanted - body.energy) * ease(step, wanted > body.energy ? ENERGY_RISE : ENERGY_FALL);
    // Party light moves every cell at once, so during a lighting event only speed can say someone moved.
    if ((lighting || move < STILL_MOVE) && speed < STILL_SPEED) body.stillness += step;
    else body.stillness = 0;
    body.presence = Math.min(1, body.presence + step / PRESENCE_RISE);
    this.follow(t, step, settings);
    body.age += step;
  }

  private follow(t: Track, step: number, settings: BodySettings): void {
    const follow = clamp(Number.isFinite(settings.followSpeed) ? settings.followSpeed : 0.5, 0, 1);
    const k = step > 0 ? ease(step, 0.03 + (1 - follow) * 0.5) : 1;
    t.body.x += (t.rawX - t.body.x) * k; t.body.y += (t.rawY - t.body.y) * k;
  }

  private publish(): readonly Body[] {
    const out = this.active;
    out.length = 0;
    for (const t of this.tracks) if (t.alive) out.push(t.body);
    out.sort(byId);
    return out;
  }
}
