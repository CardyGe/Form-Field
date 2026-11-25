import { useState } from 'react';
import { INSTALLATION_PACES, saveInstallation, useInstallation } from './installation';

/**
 * Installation mode, for unattended shows: shared by the Meridian panel and the Live screen. With it on, the app opens straight
 * onto the last show's output when it starts, keeps the display awake, and Meridian changes by itself through Next and Mutate.
 * `display` is the projector chosen where this is shown (Live), if any.
 */
export function InstallationControls({ surface, display }: { surface: 'map' | 'live'; display?: number | null }) {
  const settings = useInstallation(), [error, setError] = useState<string | null>(null);
  if (!window.studio?.installation || !settings) return null;
  const save = (change: Parameters<typeof saveInstallation>[0]) => { setError(null); void saveInstallation(change).catch(e => setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))); };
  const here = settings.surface === surface;
  return <section className="installation" aria-label="Installation">
    <div className="installation-head"><strong>Installation</strong>{settings.on && <small role="status">{here ? 'On' : `On for ${settings.surface === 'map' ? 'Map' : 'Live'}`}</small>}</div>
    <label className="installation-row"><input type="checkbox" aria-label="Installation mode" checked={settings.on && here} onChange={e => save({ on: e.target.checked, surface, ...(display !== undefined ? { display } : {}) })} />
      <span>Run as an installation<small>When the app starts, it opens the last {surface === 'map' ? 'Map show on the projector' : 'Live look on the output'}, keeps the display awake, and logs faults.</small></span></label>
    <label className="installation-row"><input type="checkbox" aria-label="Autopilot" checked={settings.autopilot} onChange={e => save({ autopilot: e.target.checked })} />
      <span>Autopilot<small>Meridian moves on by itself with Next and Mutate, never cutting. Hold shape stops it.</small></span></label>
    <div className="installation-pace" role="group" aria-label="Autopilot pace">{INSTALLATION_PACES.map(p => <button key={p.beats} aria-pressed={settings.everyBeats === p.beats} className={settings.everyBeats === p.beats ? 'is-on' : ''} onClick={() => save({ everyBeats: p.beats })} title={`A change about every ${p.beats} beats`}>{p.label}</button>)}</div>
    {error && <p className="installation-error" role="alert">{error}</p>}
  </section>;
}
