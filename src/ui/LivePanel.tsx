import { useRef, type ComponentProps, type ReactNode } from 'react';
import { LiveLookControls, LiveReactSection, Slider, liveLinks } from './LiveLookControls';
import { useLive } from './useLive';
import { LINKS_BUDGET, IGNORE_STILL, LOOK_LABELS, RELIEF_CONTROLS, RELIEF_SIZES, RELIEF_SURFACES, RELIEF_MOTIONS, RELIEF_FINISHES, RELIEF_PRESETS, type ReliefSettings, type LookKind, NOISE_FLOOR, PAINT_CONTROLS, SENSITIVITY, SIGNAL_CONTROLS, SIGNAL_STARTS, SMOKE_CONTROLS, SMOKE_STARTS, usesPeople, type Box, type LiveSettings, type SignalKey } from '../live/settings';
import { RELIEF_PALETTES, validateReliefPalette } from '../live/relief-palettes';
import { rampHex } from '../live/colour';
import type { PeopleStatus } from '../live/MaskProvider';
import { ACID_DRIP, CANDY, CYAN_YELLOW, ELECTRIC, HOT_SIGNAL, LIME_VIOLET, NEON_STRATA, POP_PORTAL, SOLAR } from '../core/palettes';

const TEST = '__test', FILE = '__file';
function peopleLine(status: PeopleStatus | null): string {
  if (!status) return '';
  if (status.state === 'loading') return 'Finding people…';
  if (status.state === 'failed') return `People not found: ${status.reason}`;
  if (status.state === 'behind') return 'People finding is behind';
  return `People finding running${status.ms ? ` · ${Math.round(status.ms)} ms a frame` : ''}`;
}
const CAMERA_OFF = 'Camera access is off. Allow Form & Field in System Settings › Privacy & Security › Camera, then reopen the app.';

/** The Live screen. `header` is the app's own mode switch, so both screens share it. */
export default function LivePanel({ header, onError }: { header: ReactNode; onError: (message: string) => void }) {
  const live = useLive(onError), s = live.settings, fileInput = useRef<HTMLInputElement>(null);
  const state = live.sourceState, refused = live.access === 'refused' || state.status === 'refused';
  const set = (change: Partial<LiveSettings>) => live.update(v => ({ ...v, ...change }));
  const setBox = (side: keyof Box, value: number) => live.update(v => {
    // Keep at least a tenth of the view between opposite sides.
    const box = { ...v.box, [side]: value }, gap = .1;
    if (side === 'left') box.left = Math.min(value, box.right - gap); if (side === 'right') box.right = Math.max(value, box.left + gap);
    if (side === 'bottom') box.bottom = Math.min(value, box.top - gap); if (side === 'top') box.top = Math.max(value, box.bottom + gap);
    return { ...v, box };
  });
  const sourceValue = s.source.kind === 'test' ? TEST : s.source.kind === 'file' ? FILE : s.source.deviceId ?? '';
  const sourceStatus = s.source.kind === 'camera' && refused ? CAMERA_OFF
    : state.status === 'running' ? `${s.source.kind === 'camera' ? 'Camera running' : 'Playing'} · ${state.label}`
    : state.status === 'starting' ? 'Starting…'
    : state.status === 'none' ? 'No camera was found. Connect one, or use a video file or the test pattern.'
    : state.status === 'lost' ? 'Camera disconnected. Reconnect it or choose another source.'
    : state.status === 'error' ? state.message : '';
  const status = live.outputOpen ? ['Showing on the output', sourceStatus].filter(Boolean).join(' · ') : sourceStatus;
  const signal = s.look === 'signal', smoke = s.look === 'smoke', people = live.people;
  const peopleStatus = peopleLine(people.status);
  const findingPeople = usesPeople(s);
  const roomMissing = findingPeople && s.people.useEmptyRoom && !people.roomCaptured;
  const setPeople = (change: Partial<LiveSettings['people']>) => live.update(v => ({ ...v, people: { ...v.people, ...change } }));
  // Sound and MIDI: links live in the settings, so they are saved with them and reach the artwork window.
  const links = liveLinks(s, live.update, live.engine, live.startEngine, onError);
  const { reactFor } = links;

  return <section className="live-shell" role="region" aria-label="Live">
    <header className="app-header">{header}<div className="live-actions">
      <label className="live-inline">Display<select aria-label="Display" value={s.display ?? ''} disabled={live.outputOpen || !live.displays.length} onChange={e => set({ display: Number(e.target.value) })}>
        {live.displays.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      {live.outputOpen ? <button className="primary-button" onClick={live.closeOutput}>Close output</button>
        : <button className="primary-button" disabled={!live.desktop || s.display === null || s.source.kind === 'file'} title={s.source.kind === 'file' ? 'Video files play in this preview only. Choose a camera or the test pattern to open the output.' : 'Show the artwork full screen on the chosen display · Esc closes it'} onClick={() => void live.openOutput()}>Open output</button>}
      <button className={`text-button live-toggle ${live.blackout ? 'on' : ''}`} aria-pressed={live.blackout} onClick={() => live.setBlackout(!live.blackout)}>Blackout</button>
      <button className="text-button" onClick={live.clear}>Clear</button>
      <span className="live-fps" title="Frames per second">{live.fps ? `${Math.round(live.fps)} fps` : ''}</span>
    </div></header>
    <div className="live-body">
      <aside className="live-column" aria-label="Setup"><h2>Setup</h2>
        <label className="stacked-label">Source<select aria-label="Source" value={sourceValue} disabled={live.outputOpen && s.source.kind === 'file'} onChange={e => {
          const value = e.target.value;
          if (value === FILE) fileInput.current?.click();
          else live.update(v => ({ ...v, source: value === TEST ? { kind: 'test', deviceId: v.source.deviceId } : { kind: 'camera', deviceId: value || null } }));
        }}>
          {!live.cameras.length && <option value="">Camera</option>}
          {live.cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
          {s.source.kind === 'camera' && s.source.deviceId && !live.cameras.some(c => c.deviceId === s.source.deviceId) && <option value={s.source.deviceId}>Saved camera</option>}
          <option value={TEST}>Test pattern</option>
          {s.source.kind === 'file' && <option value={FILE}>{live.file?.name ?? 'Video file'}</option>}
        </select></label>
        <input ref={fileInput} hidden type="file" accept="video/*" onChange={e => { const chosen = e.target.files?.[0]; if (chosen) live.chooseFile(chosen); e.target.value = ''; }} />
        <button className="secondary-button live-wide" disabled={live.outputOpen} onClick={() => fileInput.current?.click()}>Use a video file</button>
        <p className={`live-status ${refused || ['none', 'lost', 'error'].includes(state.status) ? 'warn' : ''}`} role="status">{status}</p>
        {(state.status === 'lost' || state.status === 'none') && <button className="secondary-button live-wide" onClick={live.retry}>Try the camera again</button>}
        <label className="live-check"><input aria-label="Mirror" type="checkbox" checked={s.mirror} onChange={e => set({ mirror: e.target.checked })} />Mirror<small>On when the camera faces the people</small></label>
        <Slider label="Sensitivity" value={s.sensitivity} min={SENSITIVITY.min} max={SENSITIVITY.max} step={.05} onChange={sensitivity => set({ sensitivity })} react={reactFor('live.sensitivity')} />
        <Slider label="Camera noise floor" value={s.noiseFloor} min={NOISE_FLOOR.min} max={NOISE_FLOOR.max} step={.005} onChange={noiseFloor => set({ noiseFloor })} />
        <h3>Interaction area</h3>
        <Slider label="Area left" value={s.box.left} min={0} max={1} step={.01} onChange={v => setBox('left', v)} />
        <Slider label="Area right" value={s.box.right} min={0} max={1} step={.01} onChange={v => setBox('right', v)} />
        <Slider label="Area bottom" value={s.box.bottom} min={0} max={1} step={.01} onChange={v => setBox('bottom', v)} />
        <Slider label="Area top" value={s.box.top} min={0} max={1} step={.01} onChange={v => setBox('top', v)} />
        <label className="live-check"><input aria-label="Show tracking" type="checkbox" disabled={live.outputOpen} checked={live.view === 'tracking'} onChange={e => live.setView(e.target.checked ? 'tracking' : 'art')} />Show tracking
          <small>{live.outputOpen ? 'Close the output to adjust tracking.' : 'Camera with movement drawn over it. Only ever shown here.'}</small></label>
        {findingPeople && <section className="live-people" aria-label="Finding people">
          <h3>Finding people</h3>
          <label className="live-check"><input aria-label="Show people" type="checkbox" disabled={live.outputOpen} checked={live.view === 'people'} onChange={e => live.setView(e.target.checked ? 'people' : 'art')} />Show people
            <small>{live.outputOpen ? 'Close the output to adjust tracking.' : 'Blue is a person; pink is their outline. Only ever shown here.'}</small></label>
          {(smoke || (signal && !s.signal.keepStill)) && s.people.ignoreStillSeconds !== null && <Slider label="Ignore still objects" value={s.people.ignoreStillSeconds} min={IGNORE_STILL.min} max={IGNORE_STILL.max} step={1} unit=" s" onChange={v => setPeople({ ignoreStillSeconds: v })} />}
          {(smoke || (signal && !s.signal.keepStill)) && <label className="live-check"><input aria-label="Ignore still objects off" type="checkbox" checked={s.people.ignoreStillSeconds === null} onChange={e => setPeople({ ignoreStillSeconds: e.target.checked ? null : IGNORE_STILL.default })} />Count still objects too
            <small>Off: anything the camera thinks is a person counts, even a poster.</small></label>}
          <label className="live-check"><input aria-label="Use empty room" type="checkbox" checked={s.people.useEmptyRoom} onChange={e => setPeople({ useEmptyRoom: e.target.checked })} />Use empty room
            <small>Only counts what differs from the empty room. Needs a fixed camera and steady light.</small></label>
          {s.people.useEmptyRoom && <button className="secondary-button live-wide" onClick={live.captureRoom}>Capture empty room</button>}
          {peopleStatus && <p className={`live-status ${people.status?.state === 'failed' || people.status?.state === 'behind' ? 'warn' : ''}`} role="status">{peopleStatus}</p>}
          {roomMissing && <p className="live-status warn">Capture the empty room again</p>}
        </section>}
        <label className="stacked-label">Output quality<select aria-label="Output quality" value={s.quality} onChange={e => set({ quality: Number(e.target.value) === 720 ? 720 : 1080 })}><option value={1080}>1920 × 1080</option><option value={720}>1280 × 720 · lighter</option></select></label>
        <details className="live-react" open={live.reactivityPanel} onToggle={e => live.setReactivityPanel(e.currentTarget.open)}>
          <summary>Sound &amp; MIDI{s.links.length ? <small> · {s.links.length} {s.links.length === 1 ? 'link' : 'links'}</small> : null}</summary>
          <LiveReactSection s={s} links={links} engine={live.engine} meter={live.signals} onStart={live.startEngine} />
        </details>
      </aside>
      <div className="live-stage">
        {live.outputOpen ? (live.preview ? <img alt="Output preview" src={live.preview} /> : <p className="live-status">Waiting for the output…</p>)
          : <canvas aria-label="Live preview" ref={live.setCanvas} />}
      </div>
      <aside className="live-column" aria-label={LOOK_LABELS[s.look]}>
        {s.look === 'meridian' && live.meridian && <section className="live-people" aria-label="Meridian status">
          <p className={`live-status ${live.meridian.status.startsWith('Camera lost') || live.meridian.status.startsWith('Movement only') ? 'warn' : ''}`} role="status">{live.meridian.status}</p>
          {live.meridian.limiterError ? <p className="live-status warn" role="alert">Flash limiter is not running ({live.meridian.limiterError}). The picture is shown unlimited: keep strobing moves off.</p>
            : live.meridian.limiterOn ? <p className="live-status">Flash limiter on</p> : null}
        </section>}
        <LiveLookControls s={s} update={live.update} reactFor={reactFor} onView={() => live.setView('art')} onClear={live.clear} />
      </aside>
    </div>
  </section>;
}
