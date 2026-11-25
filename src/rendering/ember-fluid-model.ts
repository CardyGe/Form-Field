/** Turns Ember's smoke controls into fluid settings and a repeatable schedule of bursts. No GPU code. */
export const EMBER_SMOKE_STYLES = ['Wisps', 'Rolling', 'Billow', 'Plume', 'Storm'] as const;
export const EMBER_SMOKE_ORIGINS = ['Core', 'Ring', 'Filaments', 'Rising'] as const;

export interface EmberFluidSettings {
  curl: number; velocityLife: number; dyeLife: number; buoyancy: number;
  force: number; emit: number; radius: number; turbulence: number; density: number; lighting: number;
}
export interface EmberBurst { time: number; angle: number; strength: number }

type Style = Omit<EmberFluidSettings, 'lighting'>;
// Multipliers on the control values: each style is a different kind of motion, not a brightness change.
const STYLES: Style[] = [
  { curl: .7, velocityLife: .7, dyeLife: .7, buoyancy: .8, force: .75, emit: .55, radius: .55, turbulence: 1.5, density: .55 },
  { curl: 1, velocityLife: 1, dyeLife: 1, buoyancy: 1, force: 1, emit: 1, radius: 1, turbulence: 1, density: 1 },
  { curl: .6, velocityLife: 1.4, dyeLife: 1.35, buoyancy: .5, force: .7, emit: 1.4, radius: 1.7, turbulence: .5, density: 1.4 },
  { curl: .45, velocityLife: 1.1, dyeLife: 1.15, buoyancy: 2.2, force: .6, emit: 1.1, radius: .85, turbulence: .8, density: 1 },
  { curl: 1.9, velocityLife: .75, dyeLife: .8, buoyancy: .4, force: 1.9, emit: 1.15, radius: 1.05, turbulence: 1.4, density: 1.1 },
];

// The moments in each four-beat phrase that launch smoke.
const BEATS = [
  { at: .18, strength: .83, angle: -.84 },
  { at: .43, strength: .77, angle: 1.31 },
  { at: .69, strength: 1, angle: -2.01 },
  { at: .72, strength: .83, angle: .26 },
  { at: .94, strength: .63, angle: 2.58 },
];

const clamp = (x: number) => Math.max(0, Math.min(1, x || 0));

export function emberFluidSettings(params: Record<string, number>, audio?: { bass: number; highs: number }): EmberFluidSettings {
  const style = STYLES[Math.max(0, Math.min(STYLES.length - 1, Math.round(params.emberSmokeStyle ?? 1)))];
  const response = clamp(params.emberSmokeResponse);
  const bass = clamp(audio?.bass ?? 0) * response, highs = clamp(audio?.highs ?? 0) * response;
  return {
    curl: (1 + 185 * clamp(params.emberSmokeCurl) ** 1.3) * style.curl,
    // Spread also keeps each push moving for longer, so a strong burst carries smoke across the frame.
    velocityLife: 1.6 * (.55 + .9 * clamp(params.emberSmokeSpread)) * style.velocityLife,
    dyeLife: (.2 + 11 * clamp(params.emberSmokeLife) ** 1.5) * style.dyeLife,
    buoyancy: (params.emberSmokeLift ?? 0) * 520 * style.buoyancy,
    force: (15 + 2000 * clamp(params.emberSmokeSpread) + 320 * bass) * style.force,
    emit: 2.3 * clamp(params.emberSmoke) ** 1.4 * style.emit,
    radius: .07 * style.radius * (1 + .3 * bass),
    turbulence: (.1 + 1.6 * clamp(params.emberSmokeDetail) + .8 * highs) * style.turbulence,
    density: (.02 + 9 * clamp(params.emberSmokeBody) ** 2.2) * style.density,
    lighting: .01 + 3.6 * clamp(params.emberSmokeLight),
  };
}

/** Every burst with from <= time < to. The schedule repeats exactly each loop. */
export function emberBursts(fromSeconds: number, toSeconds: number, loopSeconds: number, phrases: number, seed: number): EmberBurst[] {
  const count = Math.max(1, Math.round(phrases)), phrase = loopSeconds / count, spin = ((seed >>> 0) % 6283) / 1000;
  const bursts: EmberBurst[] = [];
  for (let k = Math.floor(fromSeconds / phrase) - 1; k * phrase < toSeconds; k++) {
    const inLoop = ((k % count) + count) % count;
    BEATS.forEach((beat, i) => {
      const time = (k + beat.at) * phrase;
      if (time < fromSeconds || time >= toSeconds) return;
      const angle = beat.angle + spin + 2.39996 * inLoop + .7 * Math.sin(spin * (i + 1) + inLoop);
      bursts.push({ time, angle, strength: beat.strength });
    });
  }
  return bursts;
}

/** Whole 1/60 s steps owed for this much elapsed time. A stall is dropped instead of flinging the smoke. */
export function emberFluidSteps(seconds: number): number {
  return Math.min(2, Math.floor(Math.max(0, seconds) * 60 + 1e-6));
}

/** How far the start of an exported loop has mixed from the state after the loop into its own state. */
export function emberLoopBlend(seconds: number, loopSeconds: number): { weight: number; blendSeconds: number } {
  const blendSeconds = Math.min(1.5, loopSeconds * .25), t = clamp(seconds / Math.max(blendSeconds, 1e-6));
  return { weight: t * t * (3 - 2 * t), blendSeconds };
}
