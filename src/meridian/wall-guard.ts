/** What a show asks of the wall's flash limiter (src/meridian/wall-limiter.ts). Not a certified photosensitivity test. */
export interface WallGuardSettings { safetyFlashGuard: number; safetyMaxFlashes: number; safetyRedLimit: number; safetyFullField: number }
export interface WallGuardPolicy {
  /** A visible Meridian layer is in the show. */
  present: boolean;
  /** At least one of them has Flash Guard on, so the wall is guarded. */
  on: boolean;
  /** At least one of them has Flash Guard off, so the operator is warned. */
  warn: boolean;
  settings: WallGuardSettings;
}
interface GuardLayer { kind: string; visible: boolean; params: Readonly<Record<string, number>> }

const setting = (value: number | undefined, fallback: number): number => (Number.isFinite(value) ? value as number : fallback);

/** What the show asks of the wall guard: the strictest settings among its guarded Meridian layers. */
export function wallGuardPolicy(projects: Iterable<{ layers: readonly GuardLayer[] }>): WallGuardPolicy {
  const settings: WallGuardSettings = { safetyFlashGuard: 0, safetyMaxFlashes: 3, safetyRedLimit: 1, safetyFullField: 1 };
  let present = false, on = false, warn = false;
  for (const project of projects) for (const layer of project.layers) {
    if (!layer.visible || layer.kind !== 'meridian') continue;
    present = true;
    if (setting(layer.params.safetyFlashGuard, 1) < 0.5) { warn = true; continue; }
    on = true;
    settings.safetyMaxFlashes = Math.min(settings.safetyMaxFlashes, setting(layer.params.safetyMaxFlashes, 3));
    settings.safetyRedLimit = Math.min(settings.safetyRedLimit, setting(layer.params.safetyRedLimit, 0.5));
    settings.safetyFullField = Math.min(settings.safetyFullField, setting(layer.params.safetyFullField, 0.5));
  }
  settings.safetyFlashGuard = on ? 1 : 0;
  return { present, on, warn, settings };
}
