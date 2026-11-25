import type { Layer, Project } from '../shared/types';
import { feedbackActive } from '../rendering/feedback';
import { printActive } from '../rendering/print-screen';
import { slitActive } from '../rendering/slitscan';
import { tilesActive } from '../rendering/tiles';
import { warpActive } from '../rendering/warp';
import { parameterDefinitions } from './project';
import { sourceViewMatrix } from '../rendering/source-view';

export const TAU = Math.PI * 2;

/** Surface parameter defaults, shared with the renderer so tiling reads the same fallbacks. */
export const SURFACE_DEFAULTS: Record<string, number> = Object.fromEntries(parameterDefinitions('surface')
  .filter(({ key }) => !['cycles','exposure','saturation','hue'].includes(key)).map(({ key, default: value }) => [key, value]));

/** The first reason this layer cannot tile, or null. */
export function layerTileBlocker(layer: Layer): string | null {
  const n = layer.name, p = layer.params;
  if (layer.kind !== 'surface') return `${n}: this instrument can't tile yet.`;
  if (p.style === 1) return `${n}: the Contours style can't tile.`;
  if (p.style === 3) return `${n}: the Fusion style can't tile.`;
  if (p.style === 2 && p.variant === 0) return `${n}: the Melt style can't tile.`;
  if (layer.mask.kind !== 'none') return `${n} has a mask.`;
  if (layer.surface) return `${n} has a surface shape.`;
  if ((p.delaySpread ?? 0) > 0 || (p.pause ?? 0) > 0) return `${n}: Delay spread and Pause can't tile.`;
  const m = layer.modulations;
  if (m.scale || m.rotation || m.stretch || m.density || m['transform.scale'] || m['transform.rotation']) return `${n}: animated Scale, Direction, Stretch, Density, layer size or layer rotation can't tile.`;
  if (feedbackActive(layer)) return `${n}: Feedback can't tile.`;
  if (slitActive(layer)) return `${n}: Time displacement can't tile.`;
  if (printActive(layer)) return `${n}: Print screen can't tile.`;
  if (tilesActive(layer)) return `${n}: Tiles can't tile.`;
  if (warpActive(layer)) return `${n}: Warp can't tile.`;
  return null;
}

export function tileBlockers(project: Project): string[] {
  return project.layers.filter(l => l.visible).map(layerTileBlocker).filter((b): b is string => b !== null);
}

/** Turns tiling off, with a message naming the first blocker, when the project can no longer tile. */
export function reconcileTile(project: Project): { project: Project; message: string | null } {
  if (!project.tileEdges) return { project, message: null };
  const blockers = tileBlockers(project);
  if (!blockers.length) return { project, message: null };
  return { project: { ...project, tileEdges: false }, message: `Tile edges turned off. ${blockers[0]}` };
}

/** Nearest multiple of a quarter turn. */
export function snapQuarterTurn(angle: number): number {
  return Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
}

/** The frame's size in Chromatic Field pattern space (`p` in surface.ts main). */
export function tilePeriod(layer: Layer, aspect: number): { x: number; y: number } {
  const m = sourceViewMatrix({ ...layer.transform, rotation: snapQuarterTurn(layer.transform.rotation) }, aspect).elements;
  const th = snapQuarterTurn(layer.params.rotation ?? 0), c = Math.cos(th), s = Math.sin(th);
  const scale = Math.max(layer.params.scale ?? SURFACE_DEFAULTS.scale, .1), stretch = Math.sqrt(Math.max(layer.params.stretch ?? SURFACE_DEFAULTS.stretch, .25));
  const axis = (u: number, v: number) => {
    const wx = u * aspect, wy = v;
    return { x: Math.abs((c * wx + s * wy) * scale * stretch), y: Math.abs((-s * wx + c * wy) * scale / stretch) };
  };
  const ax = axis(m[0], m[1]), ay = axis(m[3], m[4]);
  return { x: ax.x + ay.x, y: ax.y + ay.y };
}

/** Wave number for sin(k·x) with a whole number of cycles across L. */
export function tileWave(k: number, L: number): number {
  if (L <= 0) return k;
  const n = Math.max(1, Math.round(Math.abs(k) * L / TAU));
  return Math.sign(k || 1) * TAU * n / L;
}

/** Rate for a linear term feeding a period-1 function; may reach 0. */
export function tileRate(k: number, L: number): number {
  return L <= 0 ? k : Math.round(k * L) / L;
}

/** Noise lattice period in cells. */
export function tileCells(f: number, L: number): number {
  return Math.max(1, Math.round(f * L));
}
