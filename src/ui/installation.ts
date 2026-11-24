/**
 * Installation mode in the studio window: the saved settings, shared by the Meridian and Live panels, the Map and Live outputs
 * they are sent to, and the fault log. Faults are plain sentences, never pictures.
 */
import { useSyncExternalStore } from 'react';
import type { InstallationSettings } from '../shared/types';
import { setInstallation } from '../meridian/installation-state';

export const INSTALLATION_PACES = [{ beats: 64, label: 'Slow' }, { beats: 32, label: 'Medium' }, { beats: 16, label: 'Fast' }] as const;
const DEFAULTS: InstallationSettings = { on: false, surface: 'map', autopilot: true, everyBeats: 32, display: null };
/** The same fault is written at most once in this long. */
const REPEAT_MS = 60000;

let current: InstallationSettings | null = null;
const listeners = new Set<() => void>();
const lastLogged = new Map<string, number>();

function apply(settings: InstallationSettings): void {
  current = settings;
  // This window's own Meridian (the Studio preview and the Map or Live drawn here while the output is closed).
  setInstallation(installationMessage());
  for (const listener of listeners) listener();
}

/** Reads the saved settings once at launch. Null without the desktop app. */
export async function loadInstallation(): Promise<InstallationSettings | null> {
  const bridge = window.studio?.installation;
  if (!bridge) return null;
  try { const { settings } = await bridge.get(); apply(settings); return settings; } catch { return null; }
}

export async function saveInstallation(change: Partial<InstallationSettings>): Promise<void> {
  const bridge = window.studio?.installation;
  if (!bridge) return;
  const { settings } = await bridge.set({ ...(current ?? DEFAULTS), ...change });
  apply(settings);
}

/** What the Map wall and the Live output are told: whether Meridian's autopilot runs, and its pace. */
export function installationMessage(): { type: 'installation'; autopilot: boolean; everyBeats: number } {
  return { type: 'installation', autopilot: !!current?.on && current.autopilot, everyBeats: current?.everyBeats ?? DEFAULTS.everyBeats };
}

export function useInstallation(): InstallationSettings | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => current);
}

/** Writes a fault to the installation log while Installation is on. The same sentence at most once a minute. */
export function logFault(text: string): void {
  if (!current?.on) return;
  const now = Date.now(), last = lastLogged.get(text);
  if (last !== undefined && now - last < REPEAT_MS) return;
  lastLogged.set(text, now);
  if (lastLogged.size > 200) lastLogged.clear();
  void window.studio?.installation?.log(text).catch(() => {});
}
