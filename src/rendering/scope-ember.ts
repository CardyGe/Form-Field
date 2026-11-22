const TAU = Math.PI * 2;
export const SCOPE_POINT_STRIDE = 5;

const STRAND_COUNT = 48;
const STRAND_SEGMENTS = 112;
const TRAIL_STRANDS = 12;
const TRAIL_SEGMENTS = 56;
const RING_SEGMENTS = 144;
const RING_OFFSETS = [0, .027, .061];
const RING_GAINS = [1, .57, .31];
const RING_ACCENTS = [
  { at: .02, strength: .5, life: .30 },
  { at: .50, strength: .72, life: .32 },
  { at: .73, strength: 1, life: .33 },
];

const fract = (x: number) => x - Math.floor(x);
const wrapPhase = (phase: number) => phase < 0 || phase >= TAU ? TAU * fract(phase / TAU) : phase;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function accent(bar: number, start: number, rise: number, fall: number): number {
  const age = fract(bar - start);
  return smooth(age / rise) * (1 - smooth((age - rise) / fall));
}

export function emberPhrase(phase: number, phrases: number) {
  const bar = fract(wrapPhase(phase) * phrases / TAU);
  const opening = accent(bar, .175, .074, .134) + .71 * accent(bar, .645, .105, .20);
  const body = Math.max(.58 * accent(bar, .914, .068, .18), .78 * accent(bar, .19, .059, .15),
    .75 * accent(bar, .427, .09, .16), accent(bar, .692, .079, .174));
  const heat = Math.max(.42 * accent(bar, .003, .065, .14), .68 * accent(bar, .496, .067, .124),
    accent(bar, .72, .06, .148));
  return { bar, opening, body, heat };
}

function randomPhase(seed: number, strand: number): number {
  let hash = Math.imul((seed >>> 0) ^ Math.imul(strand + 1, 0x9e3779b9), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) * TAU / 4294967296;
}

/**
 * A group of independent polylines in the scope buffer. The closing point of
 * each path has zero gain, which suppresses the segment joining the next path.
 * Match the beam's inverse-length falloff with the average length of this path.
 */
function scalePath(points: Float32Array, start: number, count: number, gain: number): number {
  const end = start + count * SCOPE_POINT_STRIDE;
  let length = 0;
  for (let i = start; i < end; i += SCOPE_POINT_STRIDE) {
    length += Math.hypot(points[i + SCOPE_POINT_STRIDE] - points[i], points[i + SCOPE_POINT_STRIDE + 1] - points[i + 1]);
  }
  const scale = gain * Math.max(length / count, .0001);
  for (let i = start; i < end; i += SCOPE_POINT_STRIDE) points[i + 3] *= scale;
  points[end + 3] = 0;
  return end + SCOPE_POINT_STRIDE;
}

function writeBody(points: Float32Array, start: number, params: Record<string, number>, phase: number,
  radius: number, strandCount: number, steps: number, trailGain: number): number {
  const phrase = emberPhrase(phase, params.emberPhrases);
  const seed = params.seed ?? 1729, turbulence = params.emberTurbulence;
  const opening = clamp01(params.emberOpening * (.38 + params.emberPulse * phrase.opening) + .09 * phrase.opening);
  const response = 1 - (1 - params.emberPulse) ** 2;
  const light = mix(.36, mix(params.emberRest * .24, 1, phrase.body), response);
  const strands = mix(9, strandCount, params.emberDensity);
  const normalise = Math.sqrt(12 / strands);
  const cavity = smooth((opening - .23) / .54);
  const major = mix(.425, .745, cavity), tube = mix(.565, .228, cavity);
  const squash = mix(.90, .72, cavity);
  const tilt = .14 + .16 * (1 - cavity);
  const cx = Math.cos(tilt), sx = Math.sin(tilt);
  const drift = phase * 2;
  let at = start;

  for (let j = 0; j < Math.ceil(strands); j++) {
    const spin = randomPhase(seed, j);
    const anchor = j * 2.399963229728653 + spin * .21;
    const around = j % 6 === 0;
    const sampleGain = (around ? .65 : 1) * smooth(strands - j) * normalise * light * trailGain;
    for (let i = 0; i <= steps; i++) {
      const a = i === steps ? 0 : TAU * i / steps;
      const theta = around
        ? a + .16 * Math.sin(3 * a + spin + drift) + .12 * Math.sin(a + spin)
        : anchor + .28 * Math.sin(a + spin) + .13 * Math.sin(3 * a - drift + spin);
      const fold = .17 * Math.sin(5 * theta + phase) + .075 * Math.sin(11 * theta - 3 * phase + spin);
      const longitude = theta + turbulence * (fold + .06 * Math.sin(13 * a + spin + 3 * phase));
      const phi = (around ? 2 + j % 5 : 1) * a + spin
        + .43 * Math.sin(2 * a - phase + spin) + .25 * Math.sin(5 * a + 3 * phase)
        + turbulence * .31 * Math.sin(9 * a - 4 * phase + spin);
      const lobe = .12 * Math.sin(4 * theta + 2 * phase) + .085 * Math.sin(6 * theta - 3 * phase)
        + .052 * Math.sin(3 * theta + 5 * phase);
      const ribs = .11 * Math.sin(12 * theta + 3 * phi - 4 * phase)
        + .08 * Math.sin(23 * theta - 5 * phi + spin + 3 * phase)
        + .045 * Math.sin(37 * theta + 6 * phi - 3 * phase)
        + .038 * Math.sin(17 * a + spin - 3 * phase);
      const ripple = lobe + turbulence * ribs;
      const tubeR = tube + ripple * mix(1, .56, cavity);
      const radial = major + tubeR * Math.cos(phi) + turbulence * .075 * Math.sin(11 * theta + phi - 3 * phase);
      const x = radial * Math.cos(longitude);
      const y = radial * Math.sin(longitude) * squash;
      const z = tubeR * Math.sin(phi) * 1.25;
      const depth = y * sx + z * cx;
      const perspective = 1 + .13 * depth;
      const fleck = smooth((Math.sin(43 * a + spin + 7 * phase) - .88) * 8)
        * smooth((Math.sin(11 * a - 3 * phase + spin) - .50) * 2);
      const index = at + i * SCOPE_POINT_STRIDE;
      points[index] = x * perspective * radius;
      points[index + 1] = (y * cx - z * sx) * perspective * radius;
      points[index + 2] = depth;
      const ridge = smooth(.45 + .63 * Math.sin(6 * a + spin + 2 * phase));
      const recede = mix(.34, 1, smooth((Math.abs(radial) - .08) / .70));
      points[index + 3] = recede * (.24 + .84 * ridge + 1.9 * fleck);
      points[index + 4] = clamp01(.24 + .75 * ripple + .70 * fleck + .44 * phrase.heat);
    }
    at = scalePath(points, at, steps, sampleGain);
  }
  return at;
}

function writeRing(points: Float32Array, start: number, radius: number, phase: number, turbulence: number,
  gain: number, warm: number, roughness: number, shapePhase: number): number {
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const theta = i === RING_SEGMENTS ? 0 : TAU * i / RING_SEGMENTS;
    const crease = Math.tanh(4 * Math.sin(8 * theta + shapePhase + 2 * phase))
      * (1 + .57 * Math.sin(4 * theta - phase + shapePhase));
    const folds = Math.sin(17 * theta - 3 * phase + shapePhase);
    const r = radius * (1 + .026 * Math.sin(3 * theta + shapePhase - phase)
      + turbulence * roughness * (.076 * crease + .040 * folds + .022 * Math.sin(31 * theta + 2 * phase)
        + .014 * Math.sin(43 * theta + shapePhase - 5 * phase)));
    const index = start + i * SCOPE_POINT_STRIDE;
    points[index] = Math.cos(theta) * r;
    points[index + 1] = Math.sin(theta) * r;
    points[index + 2] = .25;
    points[index + 3] = .59 + .34 * Math.sin(3 * theta - 2 * phase + shapePhase) + .28 * Math.max(0, folds);
    points[index + 4] = warm;
  }
  return scalePath(points, start, RING_SEGMENTS, gain);
}

/** Fill the reusable Scope beam buffer with one frame, independent of play order. */
export function writeEmberPoints(points: Float32Array, params: Record<string, number>, phase: number, aspect: number) {
  phase = wrapPhase(phase);
  const shortSide = Math.min(1, aspect), longSide = Math.max(1, aspect);
  const radius = params.radius * shortSide;
  const phrase = emberPhrase(phase, params.emberPhrases);
  const turbulence = params.emberTurbulence, pulse = params.emberPulse;
  const seedPhase = randomPhase(params.seed ?? 1729, STRAND_COUNT);
  let at = writeBody(points, 0, params, phase, radius, STRAND_COUNT, STRAND_SEGMENTS, 1);
  if (params.afterglow > 0) {
    for (let trail = 1; trail <= 2; trail++) {
      const earlier = wrapPhase(phase - trail * (.014 + .052 * params.afterglow));
      at = writeBody(points, at, params, earlier, radius, TRAIL_STRANDS, TRAIL_SEGMENTS, params.afterglow * .54 / trail);
    }
  }

  if (params.emberRings > 0) {
    for (const event of RING_ACCENTS) {
      const age = fract(phrase.bar - event.at) / event.life;
      if (age >= 1) continue;
      const envelope = smooth(age * 9) * (1 - smooth((age - .21) / .79));
      const beatLight = .06 + .94 * Math.max(phrase.body, phrase.heat);
      const strength = params.emberRings * event.strength * mix(1, beatLight, pulse) * envelope;
      const travel = mix(.73, 1.88, age * (2 - age));
      for (let j = 0; j < RING_OFFSETS.length; j++) {
        at = writeRing(points, at, radius * (travel + RING_OFFSETS[j]), phase, turbulence,
          strength * RING_GAINS[j], .44 + .45 * phrase.heat, .57, seedPhase + event.at * TAU);
      }
    }
  }

  if (params.emberOuter > 0) {
    const far = Math.max(radius * 1.45, longSide * .43);
    const glow = params.emberOuter * mix(.42, .04 + .96 * phrase.body, 1 - (1 - pulse) ** 2);
    for (let j = 0; j < 2; j++) {
      at = writeRing(points, at, far * (1 + .19 * j), phase, turbulence, glow * (j === 0 ? 1 : .45),
        .30 + .35 * phrase.heat, 1.4, seedPhase + .48 * j);
    }
  }

  return { points: at / SCOPE_POINT_STRIDE, heat: params.emberHeat * (.06 + .94 * phrase.heat), radius };
}
