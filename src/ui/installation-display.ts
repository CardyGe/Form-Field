/**
 * Where Installation mode opens its output. A saved projector is waited for, never swapped for another screen; with none saved,
 * the first display that is not the main screen is used. The main screen is never chosen, so a projector that powers up after
 * the Mac is not beaten to it by a window on the laptop. `waiting` says, in plain words, what it is waiting for.
 */
export interface DisplayChoice { id: number | null; waiting: string | null }

export function installationDisplay(saved: number | null, displays: readonly { id: number; label: string; primary: boolean }[]): DisplayChoice {
  if (saved !== null) {
    if (displays.some(d => d.id === saved)) return { id: saved, waiting: null };
    return { id: null, waiting: 'Installation is waiting for its projector to be connected and switched on.' };
  }
  const projector = displays.find(d => !d.primary);
  return projector ? { id: projector.id, waiting: null } : { id: null, waiting: 'Installation is waiting for a projector: connect and switch on a second display.' };
}
