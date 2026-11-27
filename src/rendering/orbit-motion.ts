import { ORBIT_TAU as TAU } from '../core/orbital';

export interface OrbitPhase { spin: number; wave: number; background: number; colour: number }
export interface OrbitPose { x: number; y: number; z: number; angle: number; tilt: number; roll: number; size: number; band: number }
export const makeOrbitPose = (): OrbitPose => ({ x: 0, y: 0, z: 0, angle: 0, tilt: 0, roll: 0, size: 0, band: 0 });
export const wrapOrbit = (phase: number) => phase % TAU;
export function orbitLoopPhase(p: Record<string, number>, phase: number): OrbitPhase {
  return { spin: phase * p.orbitTurns, wave: phase * p.orbitCycles, background: phase * p.orbitBackgroundCycles, colour: phase * p.orbitColourCycles };
}
export function advanceOrbitPhase(previous: OrbitPhase, p: Record<string, number>, seconds: number): OrbitPhase {
  return {
    spin: wrapOrbit(previous.spin + seconds * p.orbitRate * TAU * .29),
    wave: wrapOrbit(previous.wave + seconds * p.orbitRate * TAU),
    background: wrapOrbit(previous.background + seconds * p.orbitBackgroundRate * TAU),
    colour: wrapOrbit(previous.colour + seconds * p.orbitColourRate * TAU),
  };
}
export function orbitEase(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
export function waveOrder(order: number, radial: number, across: number): number {
  return order === 1 ? 1 - radial : order === 2 ? across : radial;
}
export function orbitMorphProgress(progress: number, order: number, spread: number): number {
  return orbitEase((progress - order * spread) / (1 - spread));
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function random(index: number, seed: number): number {
  let n = Math.imul(index + 1, 0x9e3779b9) ^ seed;
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
  return ((n ^ (n >>> 15)) >>> 0) / 0x100000000;
}
export function sampleOrbit(out: OrbitPose, i: number, p: Record<string, number>, time: OrbitPhase): void {
  const count = Math.round(p.orbitCount), arms = Math.min(Math.round(p.orbitArms), count);
  const arm = i % arms, step = Math.floor(i / arms);
  const steps = Math.floor((count - 1 - arm) / arms);
  const t = step / Math.max(steps, 1);
  const lead = arm / arms, circle = i / count;
  const order = waveOrder(p.orbitOrder, t, circle);
  const local = (p.orbitMotion === 5 ? 0 : time.wave) - TAU * p.orbitSpread * order + .62 * lead;
  const raw = .5 + .5 * Math.cos(local);
  const beat = mix(raw, orbitEase(raw), p.orbitEase);
  const vibration = Math.sin(local);
  const amount = p.orbitMotion === 5 ? 0 : p.orbitAmount;
  const turn = p.orbitMotion === 5 ? 0 : time.spin;
  const winding = p.orbitMotion === 0 ? amount * beat : 0;
  const spread = p.orbitMotion === 4 ? 1 + .4 * amount * vibration : 1;
  let angle = TAU * (lead + t / arms * .92) + turn;
  let radius = mix(p.orbitOpening, 1, t) * p.orbitRadius;
  let depth = .01;
  switch (p.orbitLayout) {
    case 1:
      angle = TAU * (lead + t * .22 * p.orbitTwist) + turn;
      radius = p.orbitRadius * (.18 + .82 * t) * (1 + .16 * Math.sin(3 * angle - turn));
      depth = .06 * Math.sin(t * Math.PI);
      break;
    case 2:
      angle = TAU * (lead + t * (1 + .55 * p.orbitTwist)) + turn;
      radius = p.orbitRadius * (.66 + .26 * Math.sin(t * Math.PI));
      depth = .19 * t;
      break;
    case 3:
      angle = circle * TAU + turn;
      radius = p.orbitRadius * (.68 + .27 * Math.cos(circle * TAU * 3));
      depth = .09 * Math.sin(circle * TAU * 3);
      break;
    case 4:
      break;
    case 5:
      angle = TAU * (t + lead * .23) + turn;
      radius = p.orbitRadius * mix(.32, 1, (arm + 1) / arms);
      depth = .08 * lead;
      break;
    default: {
      const coil = .16 + .7 * winding;
      angle += t * TAU * coil * p.orbitTwist;
      const openRadius = .32 + p.orbitOpening * .76;
      radius = p.orbitRadius * mix(mix(openRadius, openRadius * .23, winding), 1, t)
        * (1 - .43 * amount * (1 - beat) * (.5 + .5 * Math.cos(time.wave - .7)));
      depth = .065 * winding * (1 - t);
    }
  }
  if (p.orbitMotion === 1) radius *= 1 + .32 * amount * vibration;
  if (p.orbitMotion === 2) angle += (arm % 2 ? -1 : 1) * time.spin - turn + .4 * amount * vibration;
  const wobble = random(i, p.seed);
  const sizeWave = p.orbitMotion === 5 ? .9 : mix(.85, .22 + .78 * beat, amount);
  out.size = i < count ? p.orbitSize * Math.max(p.orbitMinimum, sizeWave * (.72 + .4 * t) * mix(1, .66 + .68 * wobble, p.orbitScatter)) : 0;
  if (p.orbitLayout === 4) {
    const cols = Math.ceil(count / arms);
    const x = ((cols > 1 ? step / (cols - 1) : .5) - .5) * p.orbitRadius * 2;
    const y = ((arms > 1 ? arm / (arms - 1) : .5) - .5) * p.orbitRadius * 2;
    out.x = (x * Math.cos(turn) - y * Math.sin(turn)) * spread;
    out.y = (y * Math.cos(turn) + x * Math.sin(turn)) * spread;
  } else {
    out.x = Math.cos(angle) * radius * spread;
    out.y = Math.sin(angle) * radius * spread;
  }
  out.z = .125 + (depth + .068 * amount * vibration) * p.orbitDepth + (wobble - .5) * .025;
  out.angle = angle + .32 * Math.sin(local);
  out.tilt = (p.orbitMotion === 3 ? 1.72 : .95) * p.orbitRoll * Math.sin(local + t * 1.4) * amount;
  out.roll = .32 * p.orbitRoll * Math.cos(local - lead * TAU) * amount;
  out.band = p.orbitColourMode === 1 ? lead * 3 : p.orbitColourMode === 2 ? t * 3
    : p.orbitColourMode === 3 ? out.z * 11 : (i * 2) % 3;
}
function angleBetween(a: number, b: number, t: number): number {
  const d = b - a;
  return a + Math.atan2(Math.sin(d), Math.cos(d)) * t;
}
export function blendOrbit(out: OrbitPose, from: OrbitPose, to: OrbitPose, t: number): void {
  out.x = mix(from.x, to.x, t); out.y = mix(from.y, to.y, t); out.z = mix(from.z, to.z, t);
  out.size = mix(from.size, to.size, t); out.band = mix(from.band, to.band, t);
  out.angle = angleBetween(from.angle, to.angle, t);
  out.tilt = mix(from.tilt, to.tilt, t); out.roll = mix(from.roll, to.roll, t);
}
