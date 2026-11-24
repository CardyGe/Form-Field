/** Smoke Cloud's controls, beat and timing, with no GPU code. */
const clamp = (x: number) => Math.max(0, Math.min(1, x || 0));
const STRENGTHS = [1, .62, .84, .7];
/** Automatic light pulses stay well under the three flashes a second that broadcast flash limits allow. */
export const CLOUD_MAX_BEATS_PER_SECOND = 2.5;

export interface CloudSettings {
  emit: number; turbulence: number; shear: number; plumes: number; punch: number; dyeLife: number;
  core: number; ring: number; channels: number; outer: number; sharpness: number; haze: number; lighting: number; sparkle: number; exposure: number; size: number;
}

/** Each control's middle value is the look approved in the prototype. */
export function cloudSettings(p: Record<string, number>): CloudSettings {
  return {
    emit: 2 * clamp(p.cloudSmoke),
    turbulence: 1.16 * clamp(p.cloudTurbulence),
    shear: 1.04 * clamp(p.cloudShear),
    plumes: 2 * clamp(p.cloudPlumes),
    punch: 2 * clamp(p.cloudPunch),
    dyeLife: .4 + 3.5 * clamp(p.cloudLife),
    core: 2 * clamp(p.cloudCore),
    ring: 2 * clamp(p.cloudRing),
    channels: Math.min(.98, 1.8 * clamp(p.cloudChannels)),
    outer: 2 * clamp(p.cloudOuter),
    sharpness: clamp(p.cloudSoftness) < .5 ? 1 - 1.4 * clamp(p.cloudSoftness) : .6 * (1 - clamp(p.cloudSoftness)),
    haze: Math.max(0, clamp(p.cloudSoftness) - .5) * 1.7,
    lighting: 2 * clamp(p.cloudLighting),
    sparkle: 2 * clamp(p.cloudSparkle),
    exposure: 2.25,
    size: p.cloudSize ?? .315,
  };
}

/** Whole beats in one loop, held under the flash limit however short the loop is. */
export function cloudBeats(requested: number, loopSeconds: number): number {
  return Math.max(1, Math.min(Math.round(requested) || 1, Math.floor(loopSeconds * CLOUD_MAX_BEATS_PER_SECOND)));
}

/** The light at this moment: a very quick attack, a short hold, then a fall. Repeats exactly each loop. */
export function cloudHit(seconds: number, loopSeconds: number, beats: number): { index: number; strength: number; level: number } {
  const loop = Math.max(1e-6, loopSeconds), wrapped = ((seconds % loop) + loop) % loop;
  const position = wrapped / loop * beats, index = Math.min(beats - 1, Math.floor(position + 1e-9)), age = Math.max(0, position - index);
  const strength = STRENGTHS[index % STRENGTHS.length], fall = clamp((age - .18) / .5);
  return { index, strength, level: strength * (age < .05 ? age / .05 : 1 - fall * fall * (3 - 2 * fall)) };
}

/** Whole 1/60 s steps owed. A stall is dropped rather than bought back with more GPU work. */
export function cloudSteps(seconds: number): number {
  return Math.min(2, Math.floor(Math.max(0, seconds) * 60 + 1e-6));
}

/** How far an exported loop's opening has mixed from the state after the loop into its own. */
export function cloudLoopBlend(seconds: number, loopSeconds: number): { weight: number; blendSeconds: number } {
  const blendSeconds = Math.min(1.5, loopSeconds * .25), t = clamp(seconds / Math.max(blendSeconds, 1e-6));
  return { weight: t * t * (3 - 2 * t), blendSeconds };
}

// Deep shadow, main body, pale highlight, spark, second hue, unused.
const scheme = (id: string, name: string, deep: string, main: string, pale: string, accent: string) => ({ id: `cloud-${id}`, name, palette: [deep, main, pale, pale, accent, '#000000'] });
export const SMOKE_CLOUD_SCHEMES = [
  scheme('ultraviolet', 'Ultraviolet Smoke', '#3a1780', '#7a43ff', '#e3d1ff', '#7a43ff'),
  scheme('ember', 'Ember Smoke', '#820008', '#d8240f', '#ffd074', '#fa6a14'),
  scheme('glacier', 'Glacier Smoke', '#17718a', '#49c8e8', '#e9fcff', '#2466cd'),
  scheme('orchid', 'Orchid Smoke', '#782c9e', '#e24fda', '#ffc8e7', '#8f38ac'),
  scheme('acid', 'Acid Smoke', '#426716', '#9ad42a', '#fff9a1', '#2eeb80'),
  scheme('silver', 'Silver Smoke', '#4d586a', '#aebdca', '#fbfdff', '#7a889b'),
  scheme('solar', 'Solar Smoke', '#8a3b00', '#f09a18', '#fff1b8', '#ff7a18'),
  scheme('toxic', 'Toxic Smoke', '#3f6b10', '#a4e82a', '#f6ffb0', '#7a2fd6'),
  scheme('deep-sea', 'Deep Sea Smoke', '#0d4f73', '#2bbfe0', '#dffbff', '#2b2fa8'),
  scheme('neon-dusk', 'Neon Dusk Smoke', '#7a0f55', '#f02a98', '#ffd1ec', '#0fa89c'),
  scheme('blood-moon', 'Blood Moon Smoke', '#6e0010', '#d40f28', '#ffc4a8', '#7c7a80'),
  scheme('arctic-fire', 'Arctic Fire Smoke', '#506d86', '#b6c4cf', '#ffffff', '#db5b11'),
  scheme('copper', 'Copper Smoke', '#6e3518', '#e0804a', '#ffdcb8', '#2f9c86'),
  scheme('ink', 'Ink Smoke', '#3a3a3e', '#b4b4b8', '#ffffff', '#6a6a70'),
  scheme('aurora', 'Aurora Smoke', '#0f6b4c', '#34e08a', '#d9ffe9', '#8a3de0'),
];
