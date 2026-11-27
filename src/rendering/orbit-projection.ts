import { figureEightWidth } from './orbit-motion';

export const ORBIT_FOV = 29;
export const ORBIT_TAN_HALF_FOV = Math.tan(ORBIT_FOV * Math.PI / 360);

/** A fixed envelope for the entire movement, so automatic fitting never pumps along with the sculpture. */
export function orbitProjectionDistance(p: Record<string, number>, aspect: number): number {
  const fixedFigure = p.orbitLayout === 8 && (p.orbitSpinMode === 2 || p.orbitSpinMode === 0 && p.orbitMotion === 5);
  const faithfulAspect = fixedFigure && p.orbitSafeMargin > 0 ? 1 : Math.min(1, aspect / .82);
  const authored = 2.2 / (p.orbitFraming * faithfulAspect);
  if (!p.orbitSafeMargin) return authored;
  const waving = p.orbitMotion === 1 ? 1 + .32 * p.orbitAmount
    : p.orbitMotion === 4 ? 1 + .4 * p.orbitAmount : 1;
  const figureWidth = figureEightWidth(p);
  const corner = p.orbitLayout === 4 ? Math.SQRT2 : p.orbitLayout === 1 ? 1.16
    : p.orbitLayout === 8 ? Math.max(1.08, 1.16 * p.orbitLobeWidth) : p.orbitLayout === 6 ? 1.07 : 1;
  const figureWave = p.orbitLayout === 8 ? 1 + .16 * p.orbitAmount : 1;
  const extent = p.orbitRadius * waving * (1 + .12 * p.orbitPhrasing) * figureWave;
  const piece = p.orbitSize * 1.35 * (Math.max(1, p.orbitAspect) * (p.orbitPiece === 6 ? 1.16 : 1) + .45 * p.orbitAccent);
  const depth = (p.orbitLayout >= 6 ? .25 : .15) + p.orbitDepth * .28 + piece;
  const tilt = Math.abs(Math.sin(p.orbitCamera));
  const usable = (1 - p.orbitSafeMargin * 2) * ORBIT_TAN_HALF_FOV;
  if (fixedFigure) {
    // The horizontal and vertical extents can be fitted separately once the heading is fixed.
    const heading = p.orbitHeading * Math.PI / 180;
    const c = Math.abs(Math.cos(heading)), s = Math.abs(Math.sin(heading));
    const horizontal = extent * (c * figureWidth + s), vertical = extent * (s * figureWidth + c);
    const projected = Math.max((horizontal + piece) / aspect, vertical + piece + depth * tilt) / usable;
    return Math.max(authored, projected + depth + vertical * tilt);
  }
  const radius = extent * corner;
  const projected = (radius + piece + depth * tilt) / (usable * Math.min(1, aspect));
  return Math.max(authored, projected + depth + radius * tilt);
}

/** Remove sub-pixel details gradually as Map's render scale or the surface size drops. */
export function orbitDetailGain(radiusPixels: number, strength: number): number {
  const edge = Math.min(1, Math.max(0, (radiusPixels - .85) / 2.1));
  return 1 - strength * (1 - edge * edge * (3 - 2 * edge));
}

export interface OrbitView {
  distance: number;
  tilt: number;
  density: number;
  rotation: number;
  contrast: number;
  focus: number;
}

export function orbitView(p: Record<string, number>, aspect: number): OrbitView {
  return {
    distance: orbitProjectionDistance(p, aspect), tilt: p.orbitCamera,
    density: p.orbitPatternSize, rotation: p.orbitPatternAngle,
    contrast: p.orbitPatternContrast, focus: p.orbitPatternFocus,
  };
}

export function blendOrbitView(from: OrbitView, to: OrbitView, amount: number, sameAspect: boolean): OrbitView {
  const a = 1 - amount;
  const turn = to.rotation - from.rotation;
  return {
    distance: sameAspect ? 1 / (a / from.distance + amount / to.distance) : to.distance,
    tilt: a * from.tilt + amount * to.tilt,
    density: a * from.density + amount * to.density,
    rotation: from.rotation + amount * Math.atan2(Math.sin(turn), Math.cos(turn)),
    contrast: a * from.contrast + amount * to.contrast,
    focus: a * from.focus + amount * to.focus,
  };
}
