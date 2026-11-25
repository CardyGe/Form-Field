/** Ember's picture: a burst of fine burning threads, torn crowns, a thin ring, ragged outer bands and sparks. */
const TAU = Math.PI * 2;
const STRIDE = 5;
const BEATS_PER_PHRASE = 4;
const HIT_STRENGTH = [1, .62, .84, .7];
const FIBRE_STEPS = 20, MAX_FIBRES = 1200, CROWNS = 9, CROWN_STEPS = 240, RINGS = 3, RING_STEPS = 360, BAND_LAYERS = 6, BAND_STEPS = 180, TUFTS = 150, TUFT_STEPS = 8, SPARKS = 1800;
/** The most points one Ember frame can write. */
export const EMBER_MAX_POINTS = MAX_FIBRES * (FIBRE_STEPS + 1) + CROWNS * (CROWN_STEPS + 1) + RINGS * (RING_STEPS + 1) + 2 * (BAND_LAYERS * (BAND_STEPS + 1) + TUFTS * (TUFT_STEPS + 1)) + SPARKS * 2;

const fract = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** A sharp zigzag, for torn edges that sine waves make too smooth. */
const zig = (x: number) => 2 * Math.abs(2 * fract(x) - 1) - 1;

function random(seed: number, index: number, salt = 0): number {
  let hash = Math.imul((seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b9) ^ Math.imul(salt + 1, 0x632be5ab), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

/** The beat at this moment: a one-frame attack, a short hold and a quick fall. */
export function emberHit(phase: number, phrases: number) {
  const beats = Math.max(1, Math.round(phrases)) * BEATS_PER_PHRASE;
  const position = fract(phase / TAU) * beats, index = Math.min(beats - 1, Math.floor(position)), age = position - index;
  const shape = age < .05 ? age / .05 : age < .18 ? 1 : 1 - smooth((age - .18) / .44);
  return { index, age, level: shape * HIT_STRENGTH[index % BEATS_PER_PHRASE] };
}

function finish(points: Float32Array, start: number, count: number, gain: number): number {
  const end = start + count * STRIDE;
  let length = 0;
  for (let i = start; i < end; i += STRIDE) length += Math.hypot(points[i + STRIDE] - points[i], points[i + STRIDE + 1] - points[i + 1]);
  const scale = gain * Math.max(length / count, .0001);
  for (let i = start; i < end; i += STRIDE) points[i + 3] *= scale;
  points[end + 3] = 0;
  return end + STRIDE;
}

function put(points: Float32Array, at: number, x: number, y: number, z: number, gain: number, heat: number): void {
  points[at] = x; points[at + 1] = y; points[at + 2] = z; points[at + 3] = gain; points[at + 4] = clamp01(heat);
}

/** Writes one frame and returns the number of points, the heat and the body radius. */
export function writeEmberBurst(points: Float32Array, params: Record<string, number>, phaseIn: number, aspect: number) {
  const phase = fract(phaseIn / TAU) * TAU, seed = (params.seed ?? 1729) >>> 0;
  const shortSide = Math.min(1, aspect), longSide = Math.max(1, aspect), radius = params.radius * shortSide;
  const hit = emberHit(phase, params.emberPhrases), pulse = params.emberPulse, turbulence = params.emberTurbulence;
  const rest = .05 + params.emberRest * .3, light = mix(1, rest + (1 - rest) * hit.level, pulse);
  // Each beat throws the structure into a new arrangement, then it drifts until the next.
  const shape = (seed + Math.imul(hit.index + 1, 7919)) >>> 0;
  const kick = (1 - smooth(hit.age / .8)) * pulse;
  const scale = radius * (1 + .1 * kick);
  const a = random(shape, 1) * TAU, b = random(shape, 2) * TAU, c = random(shape, 3) * TAU;
  const lobes = 3 + Math.floor(random(shape, 4) * 3);
  const edge = (t: number) => .68 + .13 * Math.sin(lobes * t + a + phase) + .08 * Math.sin((lobes + 2) * t + b - 2 * phase) + .05 * Math.sin(11 * t + c + 3 * phase);
  const hollow = params.emberOpening;
  let at = 0;

  const fibres = Math.round(300 + (MAX_FIBRES - 300) * clamp01(params.emberDensity)), bundles = 20 + Math.floor(random(shape, 5) * 18);
  const fibreGain = light * Math.sqrt(190 / fibres);
  for (let j = 0; j < fibres; j++) {
    const h = random(shape, j, 10), s = random(shape, j, 11) * TAU, hot = random(shape, j, 12);
    const bundle = Math.floor(random(shape, j, 13) * bundles);
    const spread = random(shape, j, 15) - .5, base = (bundle + .7 * random(shape, bundle, 14)) / bundles * TAU + spread * Math.abs(spread) * .5;
    const reach = .62 + .62 * random(shape, bundle, 18);
    const inner = .015 + hollow * .26 * h * h, outer = edge(base) * reach * (.42 + .62 * Math.pow(random(shape, j, 16), .6));
    const offX = (random(shape, j, 19) - .5) * .11, offY = (random(shape, j, 22) - .5) * .11;
    const curl = (random(shape, j, 17) - .5) * 1.5;
    for (let i = 0; i <= FIBRE_STEPS; i++) {
      const t = i / FIBRE_STEPS, r = mix(inner, outer, t);
      const w1 = Math.sin(r * 9 + base * 3 + s + 2 * phase), w2 = Math.sin(r * 23 - base * 5 + 2 * s - 3 * phase), w3 = Math.sin(r * 51 + 3 * s);
      const jag = zig(r * 7.3 + 2 * s / TAU + phase / TAU), angle = base + turbulence * t * (.2 * w1 + .1 * w2 + .05 * w3 + .075 * jag) + turbulence * curl * smooth((t - .68) / .32);
      const rr = r * (1 + turbulence * .055 * t * w2);
      const gain = (.2 + .8 * smooth(t * 2.2)) * (1 - .6 * smooth((t - .84) / .16)) * (.28 + 1.25 * h * h * h);
      const glow = (hot > .62 ? 1 : .3) * Math.pow(t, 1.25);
      put(points, at + i * STRIDE, (Math.cos(angle) * rr + offX * (1 - t)) * scale, (Math.sin(angle) * rr * .95 + offY * (1 - t)) * scale, .55 * Math.sin(base + s), gain, .04 + .96 * glow);
    }
    at = finish(points, at, FIBRE_STEPS, fibreGain);
  }

  // Crowns: torn, folded contours around the edge of the burst.
  for (let j = 0; j < CROWNS; j++) {
    const k = .9 + .03 * j, s = random(shape, j, 20) * TAU, teeth = 7 + Math.floor(random(shape, j, 21) * 8);
    for (let i = 0; i <= CROWN_STEPS; i++) {
      const t = i === CROWN_STEPS ? 0 : TAU * i / CROWN_STEPS;
      const tooth = Math.pow(1 - Math.abs(2 * fract((teeth + 6) * t / TAU + s) - 1), 4);
      const section = smooth(Math.sin(2 * t + s + phase) * 1.8 + .25);
      const torn = .018 * Math.sin(37 * t + s - 3 * phase) + .009 * Math.sin(83 * t + 2 * s);
      const r = (edge(t) * k + turbulence * (.17 * tooth * section + torn + .012 * zig(19 * t / TAU * 3 + s))) * scale;
      put(points, at + i * STRIDE, Math.cos(t) * r, Math.sin(t) * r * .95, .3, (.16 + .84 * section) * (.5 + .6 * tooth), .62 + .38 * tooth);
    }
    at = finish(points, at, CROWN_STEPS, light * .42 / (1 + j * .12));
  }

  // The thin ring, which jumps outward on each hit.
  if (params.emberRings > 0) for (let j = 0; j < RINGS; j++) {
    const ring = (1.1 + .012 * j + .035 * kick) * radius, s = random(seed, j, 30) * TAU;
    for (let i = 0; i <= RING_STEPS; i++) {
      const t = i === RING_STEPS ? 0 : TAU * i / RING_STEPS;
      const r = ring * (1 + .006 * Math.sin(5 * t + s + phase) + .004 * turbulence * Math.sin(29 * t + s - 2 * phase));
      put(points, at + i * STRIDE, Math.cos(t) * r, Math.sin(t) * r, .3, .55 + .45 * Math.sin(3 * t + s - phase), .85);
    }
    at = finish(points, at, RING_STEPS, params.emberRings * mix(1, .18 + .82 * hit.level, pulse) * (j === 0 ? 1.2 : .3));
  }

  // Ragged bands beyond the ring, along the long side of the frame.
  if (params.emberOuter > 0) {
    const across = aspect >= 1 ? 0 : Math.PI / 2, distance = Math.max(radius * 1.48, longSide * .36);
    for (let side = 0; side < 2; side++) for (let j = 0; j < BAND_LAYERS; j++) {
      const s = random(shape, side * 10 + j, 40) * TAU, centre = across + side * Math.PI;
      for (let i = 0; i <= BAND_STEPS; i++) {
        const u = i / BAND_STEPS, t = centre + (u - .5) * 1.7;
        const rip = .04 * Math.sin(9 * t + s + phase) + .022 * zig(3.7 * t + s / TAU - phase / TAU) + .018 * zig(11 * t + 2 * s) + .012 * Math.sin(67 * t + 3 * s) + .07 * Math.pow(Math.abs(Math.sin(14 * t + s)), 14);
        const r = distance * (1 + .022 * j + turbulence * rip * 1.5);
        const fade = smooth(u * 5) * smooth((1 - u) * 5) * smooth(Math.sin(7 * t + s + phase) * 1.5 + .75);
        put(points, at + i * STRIDE, Math.cos(t) * r, Math.sin(t) * r, 0, fade, .3 + .6 * Math.pow(Math.abs(Math.sin(5 * t + s)), 3));
      }
      at = finish(points, at, BAND_STEPS, params.emberOuter * 2.2 * mix(1, .1 + .9 * hit.level, pulse) / (1 + j * .35));
    }
    // Tufts of short threads tear away from the bands.
    for (let side = 0; side < 2; side++) for (let j = 0; j < TUFTS; j++) {
      const clump = Math.floor(random(shape, j, 60) * 11), t0 = across + side * Math.PI + ((clump + random(shape, j, 61) * .55) / 11 - .5) * 1.5;
      const s = random(shape, j, 62) * TAU, length = (.05 + .24 * random(shape, j, 63) ** 2) * (random(shape, j, 64) < .5 ? -1 : 1);
      for (let i = 0; i <= TUFT_STEPS; i++) {
        const u = i / TUFT_STEPS, t = t0 + .05 * u * Math.sin(s + 7 * u + phase) + .02 * zig(u * 2.3 + s);
        const r = distance * (1 + length * u);
        put(points, at + i * STRIDE, Math.cos(t) * r, Math.sin(t) * r, 0, 1 - .75 * u, .2 + .75 * (1 - u) * random(shape, j, 65));
      }
      at = finish(points, at, TUFT_STEPS, params.emberOuter * 1.25 * mix(1, .08 + .92 * hit.level, pulse));
    }
  }

  // Sparks: fine dust drifting outward across the black.
  const sparks = Math.round(SPARKS * clamp01(params.emberSparks ?? .6)), reach = Math.hypot(longSide, shortSide) * .56 / Math.max(radius, .01);
  for (let j = 0; j < sparks; j++) {
    const angle = random(seed, j, 50) * TAU, laps = 1 + Math.floor(random(seed, j, 51) * 3), life = fract(random(seed, j, 52) + laps * phase / TAU);
    const r = (.28 + reach * Math.sqrt(life)) * radius, size = .0007 + .0024 * random(seed, j, 53) ** 4;
    const bright = (.16 + 1.15 * random(seed, j, 54) ** 6) * smooth(life * 8) * smooth((1 - life) * 4);
    const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
    put(points, at, x, y, .4, bright, .92);
    put(points, at + STRIDE, x + Math.cos(angle) * size, y + Math.sin(angle) * size, .4, 0, .92);
    at = finish(points, at, 1, mix(.75, .12 + .88 * hit.level, pulse) * 1.5);
  }

  return { points: at / STRIDE, heat: params.emberHeat * (.4 + .6 * hit.level), radius };
}
