import type { Layer, Modulation, Project } from '../shared/types';
import { clampParameter, hashSeed, readParameterDefinitions, seededRandom } from './project';

const TAU = Math.PI * 2;
const wrap = (value: number, period = TAU): number => ((value % period) + period) % period;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function frameCount(project: Pick<Project, 'duration' | 'fps'>): number {
  const { num, den } = project.fps;
  if (!Number.isFinite(project.duration) || project.duration <= 0 || !Number.isInteger(num) || !Number.isInteger(den) || num <= 0 || den <= 0) throw new Error('Duration and rational frame rate must be positive.');
  return Math.max(1, Math.round(project.duration * num / den));
}

export function phaseAtFrame(index: number, total: number): number {
  if (!Number.isFinite(index) || !Number.isInteger(total) || total < 1) throw new Error('Frame phase requires a finite frame index and a positive integer frame count.');
  return wrap(index, total) * TAU / total;
}

function cyclicKeys(points: Modulation['points'], position: number): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].value;
  const count = points.length;
  // A repeated index also carries the corresponding cycle offset.
  const point = (index: number) => ({
    time: points[wrap(index, count)].time + Math.floor(index / count),
    value: points[wrap(index, count)].value,
  });
  let segment = count - 1;
  let t = position;
  if (t < points[0].time) t += 1;
  else {
    for (let i = 0; i < count - 1; i++) if (t >= points[i].time && t < points[i + 1].time) { segment = i; break; }
  }
  const before = point(segment - 1); const left = point(segment); const right = point(segment + 1); const after = point(segment + 2);
  const duration = right.time - left.time;
  if (duration <= 0) return left.value;
  const u = clamp((t - left.time) / duration, 0, 1);
  // Monotone cubic tangents keep authored values inside their neighboring values,
  // including extrema at the loop boundary, without clipping a nonzero slope.
  const tangent = (previous: typeof left, current: typeof left, next: typeof left) => {
    const previousSpan = current.time - previous.time; const nextSpan = next.time - current.time;
    const previousSlope = (current.value - previous.value) / previousSpan;
    const nextSlope = (next.value - current.value) / nextSpan;
    if (previousSlope * nextSlope <= 0) return 0;
    const firstWeight = 2 * nextSpan + previousSpan; const secondWeight = nextSpan + 2 * previousSpan;
    return (firstWeight + secondWeight) / (firstWeight / previousSlope + secondWeight / nextSlope);
  };
  const leftTangent = tangent(before, left, right);
  const rightTangent = tangent(left, right, after);
  const u2 = u * u; const u3 = u2 * u;
  return clamp((2 * u3 - 3 * u2 + 1) * left.value + (u3 - 2 * u2 + u) * duration * leftTangent + (-2 * u3 + 3 * u2) * right.value + (u3 - u2) * duration * rightTangent, -1, 1);
}

export function sampleModulation(mod: Modulation, phase: number, seed: number): number {
  if (!Number.isFinite(phase) || !Number.isInteger(mod.cycles) || mod.cycles < 1 || !Number.isFinite(mod.phase)) throw new Error('Modulation requires finite phase and positive integer cycles.');
  const angle = wrap(wrap(phase) * mod.cycles + mod.phase * TAU);
  switch (mod.kind) {
    case 'sine': return Math.sin(angle);
    // A smooth bounded pulse: sharp enough to read rhythmically without a discontinuity at wrap.
    case 'pulse': return Math.tanh(Math.sin(angle) * 3) / Math.tanh(3);
    case 'noise': {
      const random = seededRandom(seed);
      let value = 0; let weight = 0;
      for (let harmonic = 1; harmonic <= 4; harmonic++) {
        const amplitude = 1 / (harmonic * harmonic);
        value += Math.sin(angle * harmonic + random() * TAU) * amplitude;
        weight += amplitude;
      }
      return value / weight;
    }
    case 'keyframes': return cyclicKeys(mod.points, angle / TAU);
    default: throw new Error(`Unknown modulation kind: ${String(mod.kind)}`);
  }
}

export function evaluateLayer(layer: Layer, phase: number): Layer {
  if (!Number.isFinite(phase)) throw new Error('Layer phase must be finite.');
  // Runs for every layer on every frame. Copy the small structures, but share
  // the embedded image and mask strings: they can be megabytes each and are never changed here.
  const result: Layer = {
    ...layer,
    transform: { ...layer.transform },
    params: { ...layer.params },
    palette: [...layer.palette],
    mask: { ...layer.mask },
    modulations: structuredClone(layer.modulations),
  };
  if (layer.image) result.image = { ...layer.image };
  if (layer.surface) result.surface = structuredClone(layer.surface);
  // Read, not copied: this runs for every layer on every frame.
  const definitions = readParameterDefinitions(layer.kind);
  const seed = layer.params.seed ?? hashSeed(layer.id);
  for (const [key, mod] of Object.entries(layer.modulations)) {
    const signal = sampleModulation(mod, phase, hashSeed(`${seed}:${key}`));
    const sample = signal * mod.amount;
    if(mod.range){
      const value=mod.range.min+(mod.range.max-mod.range.min)*(.5+signal*.5);
      if(key==='opacity')result.opacity=value;
      else if(key.startsWith('transform.'))result.transform[key.slice(10) as keyof Layer['transform']]=value;
      else result.params[key]=value;
      continue;
    }
    const definition = definitions.find((item) => item.key === key);
    if (definition) {
      result.params[key] = clampParameter(layer.params[key] + sample * (definition.max - definition.min) / 2, definition);
    } else if (key === 'opacity') {
      result.opacity = clamp(layer.opacity + sample / 2, 0, 1);
    } else if (key.startsWith('transform.')) {
      const field = key.slice('transform.'.length) as keyof Layer['transform'];
      const bounds = { x: [-2, 2], y: [-2, 2], scale: [0.05, 8], rotation: [-TAU, TAU] } as const;
      if (!(field in bounds)) throw new Error(`Unknown modulation target: ${key}`);
      const [min, max] = bounds[field];
      result.transform[field] = clamp(layer.transform[field] + sample * (max - min) / 2, min, max);
    } else {
      throw new Error(`Unknown modulation target: ${key}`);
    }
  }
  return result;
}
