/**
 * Installation mode in this window. The studio window sets it from the saved installation settings; the wall and Live output
 * windows are told by message. Meridian's renderer reads it every frame, so it holds plain values only.
 */
export const installation: { autopilot: boolean; everyBeats: number } = { autopilot: false, everyBeats: 32 };

/** Sets this window's installation state from untrusted input: anything unexpected switches the autopilot off. */
export function setInstallation(value: unknown): void {
  const v = (value && typeof value === 'object' ? value : {}) as { autopilot?: unknown; everyBeats?: unknown };
  installation.autopilot = v.autopilot === true;
  installation.everyBeats = typeof v.everyBeats === 'number' && Number.isFinite(v.everyBeats) ? Math.max(16, Math.min(128, Math.round(v.everyBeats))) : 32;
}
