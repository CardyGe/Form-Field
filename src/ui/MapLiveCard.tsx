/**
 * Live in Map: what a shape playing Live shows in Details. The Live screen's own look controls, on the Live screen's
 * own settings, so the look is adjusted without leaving Map (which would close Map's projector). Changes reach the
 * projector at once and are saved for the Live screen; they are not part of Map's undo.
 */
import { useEffect, useState } from 'react';
import { MORPH_LOOKS } from '../morphogen/looks';
import { MIDIMIX_MAP } from '../morphogen/midimix-map';
import type { useMap } from './useMap';
import { LiveLookControls, LiveReactSection, Slider, liveLinks } from './LiveLookControls';
import { SENSITIVITY, type LiveSettings } from '../live/settings';

type Map = ReturnType<typeof useMap>;
const TEST = '__test';
const CAMERA_OFF = 'Camera access is off. Allow Form & Field in System Settings › Privacy & Security › Camera, then reopen the app.';
const FILE_NOTE = 'Video files play on the Live screen only. Choose a camera or the test pattern to show Live here.';

/** localStatus: this screen's own Live, while the output is closed (with it open, the wall's is used). */
export default function MapLiveCard({ map, locked, onError, localStatus = null }: { map: Map; locked: boolean; onError: (message: string) => void; localStatus?: { running: boolean; state: string; midimix?: { active: boolean; look: number | null; queued: number | null } | null } | null }) {
  const s = map.live;
  const [cameras, setCameras] = useState<{ deviceId: string; label: string }[]>([]);
  const [access, setAccess] = useState<'granted' | 'refused' | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const granted = await (window.studio?.live?.cameraAccess().catch(() => 'refused' as const) ?? Promise.resolve('granted' as const));
      const found = await navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? [];
      if (cancelled) return;
      setAccess(granted);
      setCameras(found.filter(d => d.kind === 'videoinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })));
    })();
    return () => { cancelled = true; };
  }, []);
  if (!s) return <p className="muted-text">Loading Live…</p>;
  const update = (change: (value: LiveSettings) => LiveSettings) => { if (!locked) map.updateLive(change); };
  const links = liveLinks(s, update, map.engine, map.startEngine, onError);
  const sourceValue = s.source.kind === 'test' ? TEST : s.source.kind === 'file' ? '__file' : s.source.deviceId ?? '';
  const live = map.outputOpen ? map.wallState?.live : localStatus;
  const refused = s.source.kind === 'camera' && access === 'refused';
  return <div className="map-live-card">
    <label className="map-field">Camera<select aria-label="Live camera" value={sourceValue} disabled={locked} onChange={e => {
      const value = e.target.value;
      update(v => ({ ...v, source: value === TEST ? { kind: 'test', deviceId: v.source.deviceId } : { kind: 'camera', deviceId: value || null } }));
    }}>
      {!cameras.length && <option value="">Camera</option>}
      {cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
      {s.source.kind === 'camera' && s.source.deviceId && !cameras.some(c => c.deviceId === s.source.deviceId) && <option value={s.source.deviceId}>Saved camera</option>}
      <option value={TEST}>Test pattern</option>
      {s.source.kind === 'file' && <option value="__file">Video file</option>}
    </select></label>
    {s.look === 'morphogen' && <p className="react-status" role="status">{live?.midimix?.active ? `MIDImix: Morphogen mode on${live.midimix.queued !== null ? ` · ${MORPH_LOOKS[live.midimix.queued]?.name} on the next beat` : live.midimix.look !== null ? ` · ${MORPH_LOOKS[live.midimix.look]?.name}` : ''}` : 'MIDImix: normal. Solo + Send All enters Morphogen mode.'}</p>}
    {s.look === 'morphogen' && !MIDIMIX_MAP.confirmed && <p className="react-status warn" role="status">MIDImix controls are not captured from the real device yet.</p>}
    {refused && s.look !== 'morphogen' && <p className="react-status warn" role="status">{CAMERA_OFF}</p>}
    {s.source.kind === 'file' && <p className="react-status warn" role="status">{FILE_NOTE}</p>}
    {live && !live.running && s.source.kind !== 'file' && <p className="react-status" role="status">{live.state === 'starting' ? 'The camera is starting…' : live.state === 'lost' ? 'The camera was disconnected. Reconnect it, or choose another.' : live.state === 'refused' ? CAMERA_OFF : 'Live is not running yet.'}</p>}
    <label className="map-check"><input type="checkbox" aria-label="Live mirror" checked={s.mirror} disabled={locked} onChange={e => update(v => ({ ...v, mirror: e.target.checked }))} />Mirror<small className="muted-text">on when the camera faces the people</small></label>
    <Slider label="Sensitivity" value={s.sensitivity} min={SENSITIVITY.min} max={SENSITIVITY.max} step={.05} disabled={locked} onChange={sensitivity => update(v => ({ ...v, sensitivity }))} react={{ ...links.reactFor('live.sensitivity'), disabled: locked }} />
    <LiveLookControls s={s} update={update} reactFor={target => ({ ...links.reactFor(target), disabled: locked })} onClear={map.clearLive} />
    <div className="map-toggles">
      <button className="text-button" disabled={locked} title="Empty the picture and start again" onClick={map.clearLive}>Clear</button>
      {live && !live.running && s.source.kind === 'camera' && <button className="text-button" title="Open the camera again" onClick={map.retryLive}>Try the camera again</button>}
      {s.people.useEmptyRoom && <button className="text-button" disabled={locked} title="Take the room as it is now, with nobody in it" onClick={map.captureLiveRoom}>Capture empty room</button>}
    </div>
    <details className="live-react" onToggle={e => map.setReactivityPanel(e.currentTarget.open)}>
      <summary>Sound &amp; MIDI for Live{s.links.length ? <small> · {s.links.length} {s.links.length === 1 ? 'link' : 'links'}</small> : null}</summary>
      <LiveReactSection s={s} links={links} engine={map.engine} meter={map.signals} onStart={map.startEngine} />
    </details>
    <p className="muted-text">The same look as the Live screen. The interaction area and output quality are set there.</p>
  </div>;
}
