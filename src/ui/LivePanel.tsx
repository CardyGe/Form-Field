import { useRef, type ReactNode } from 'react';
import { useLive } from './useLive';
import { IGNORE_STILL, KALEIDOSCOPE_LIVE, NOISE_FLOOR, PAINT_CONTROLS, SENSITIVITY, SIGNAL_CONTROLS, SIGNAL_STARTS, SMOKE_CONTROLS, SMOKE_STARTS, wantsPeople, type Box, type LiveSettings, type SignalKey } from '../live/settings';
import { rampHex } from '../live/colour';
import type { PeopleStatus } from '../live/MaskProvider';
import { ACID_DRIP, CANDY, CYAN_YELLOW, ELECTRIC, HOT_SIGNAL, LIME_VIOLET, NEON_STRATA, POP_PORTAL, SOLAR } from '../core/palettes';

const POSE_CONTROLS: SignalKey[] = ['poseEcho', 'poseCount', 'poseSpacing', 'poseFill'];
/** In SYMMETRY_GROUPS order. */
const SYMMETRY_NAMES = ['Rosette', 'Mirror', 'Triangle', 'Square', 'Hexagon'];

const PALETTES: [string, string[]][] = [['Hot Signal', HOT_SIGNAL], ['Neon Strata', NEON_STRATA], ['Acid Drip', ACID_DRIP], ['Pop Portal', POP_PORTAL],
  ['Lime Violet', LIME_VIOLET], ['Electric', ELECTRIC], ['Candy', CANDY], ['Solar', SOLAR], ['Cyan Yellow', CYAN_YELLOW]];
const TEST = '__test', FILE = '__file';
function peopleLine(status: PeopleStatus | null): string {
  if (!status) return '';
  if (status.state === 'loading') return 'Finding people…';
  if (status.state === 'failed') return `People not found: ${status.reason}`;
  if (status.state === 'behind') return 'People finding is behind';
  return `People finding running${status.ms ? ` · ${Math.round(status.ms)} ms a frame` : ''}`;
}
const CAMERA_OFF = 'Camera access is off. Allow Form & Field in System Settings › Privacy & Security › Camera, then reopen the app.';

function Slider({ label, value, min, max, step, unit = '', shown, disabled = false, onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; shown?: string; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className="live-control"><span>{label}<output>{shown ?? `${step >= 1 ? value : value.toFixed(2)}${unit}`}</output></span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} /></label>;
}

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
  const paletteName = PALETTES.find(([, colours]) => colours.join() === s.palette.join())?.[0] ?? '';
  const signalPaletteName = PALETTES.find(([, colours]) => colours.join() === s.signal.palette.join())?.[0] ?? '';
  const smokePaletteName = PALETTES.find(([, colours]) => colours.join() === s.smoke.palette.join())?.[0] ?? '';
  const signal = s.look === 'signal', smoke = s.look === 'smoke', kaleidoscope = s.look === 'kaleidoscope', people = live.people;
  const peopleStatus = peopleLine(people.status);
  const findingPeople = wantsPeople(s);
  const setKaleidoscope = (change: Partial<LiveSettings['kaleidoscope']>) => live.update(v => ({ ...v, kaleidoscope: { ...v.kaleidoscope, ...change } }));
  const roomMissing = findingPeople && s.people.useEmptyRoom && !people.roomCaptured;
  const setSmoke = (change: Partial<LiveSettings['smoke']>) => live.update(v => ({ ...v, smoke: { ...v.smoke, ...change } }));
  const setSignal = (change: Partial<LiveSettings['signal']>) => live.update(v => ({ ...v, signal: { ...v.signal, ...change } }));
  const setPeople = (change: Partial<LiveSettings['people']>) => live.update(v => ({ ...v, people: { ...v.people, ...change } }));

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
        <Slider label="Sensitivity" value={s.sensitivity} min={SENSITIVITY.min} max={SENSITIVITY.max} step={.05} onChange={sensitivity => set({ sensitivity })} />
        <Slider label="Camera noise floor" value={s.noiseFloor} min={NOISE_FLOOR.min} max={NOISE_FLOOR.max} step={.005} onChange={noiseFloor => set({ noiseFloor })} />
        <h3>Area that paints</h3>
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
          {!(signal && s.signal.keepStill) && s.people.ignoreStillSeconds !== null && <Slider label="Ignore still objects" value={s.people.ignoreStillSeconds} min={IGNORE_STILL.min} max={IGNORE_STILL.max} step={1} unit=" s" onChange={v => setPeople({ ignoreStillSeconds: v })} />}
          {!(signal && s.signal.keepStill) && <label className="live-check"><input aria-label="Ignore still objects off" type="checkbox" checked={s.people.ignoreStillSeconds === null} onChange={e => setPeople({ ignoreStillSeconds: e.target.checked ? null : IGNORE_STILL.default })} />Count still objects too
            <small>Off: anything the camera thinks is a person counts, even a poster.</small></label>}
          <label className="live-check"><input aria-label="Use empty room" type="checkbox" checked={s.people.useEmptyRoom} onChange={e => setPeople({ useEmptyRoom: e.target.checked })} />Use empty room
            <small>Only counts what differs from the empty room. Needs a fixed camera and steady light.</small></label>
          {s.people.useEmptyRoom && <button className="secondary-button live-wide" onClick={live.captureRoom}>Capture empty room</button>}
          {peopleStatus && <p className={`live-status ${people.status?.state === 'failed' || people.status?.state === 'behind' ? 'warn' : ''}`} role="status">{peopleStatus}</p>}
          {roomMissing && <p className="live-status warn">Capture the empty room again</p>}
        </section>}
        <label className="stacked-label">Output quality<select aria-label="Output quality" value={s.quality} onChange={e => set({ quality: Number(e.target.value) === 720 ? 720 : 1080 })}><option value={1080}>1920 × 1080</option><option value={720}>1280 × 720 · lighter</option></select></label>
      </aside>
      <div className="live-stage">
        {live.outputOpen ? (live.preview ? <img alt="Output preview" src={live.preview} /> : <p className="live-status">Waiting for the output…</p>)
          : <canvas aria-label="Live preview" ref={live.setCanvas} />}
      </div>
      <aside className="live-column" aria-label={signal ? 'Signal Melt' : smoke ? 'Smoke' : kaleidoscope ? 'Kaleidoscope' : 'Paint'}>
        <label className="stacked-label">Look<select aria-label="Look" value={s.look} onChange={e => { live.setView('art'); set({ look: e.target.value === 'signal' ? 'signal' : e.target.value === 'smoke' ? 'smoke' : e.target.value === 'kaleidoscope' ? 'kaleidoscope' : 'paint' }); }}><option value="paint">Paint</option><option value="smoke">Smoke</option><option value="signal">Signal Melt</option><option value="kaleidoscope">Kaleidoscope</option></select></label>
        {signal ? <>
          <p className="live-note">Sweep an arm to leave coloured outlines of earlier poses. Hold still to build light, then move to release it.</p>
          <div className="live-starts" role="group" aria-label="Start from">{SIGNAL_STARTS.map(start =>
            <button key={start.label} className={`text-button ${Object.entries(start.values).every(([k, v]) => s.signal[k as keyof typeof start.values] === v) ? 'on' : ''}`} onClick={() => { setSignal({ ...start.values, hold: false }); live.clear(); }}>{start.label}</button>)}</div>
          <label className="live-check"><input aria-label="Remove background" type="checkbox" checked={s.signal.removeBackground} onChange={e => setSignal({ removeBackground: e.target.checked })} />Remove background<small>Only people enter the artwork. The room stays black while detection loads.</small></label>
          <label className="live-check"><input aria-label="Keep still poses" type="checkbox" checked={s.signal.keepStill} onChange={e => setSignal({ keepStill: e.target.checked })} />Keep still poses<small>Standing still charges the artwork instead of making you disappear.</small></label>
          <label className="stacked-label">Palette<select aria-label="Palette" value={signalPaletteName} onChange={e => { const found = PALETTES.find(([name]) => name === e.target.value); if (found) setSignal({ palette: [...found[1]] }); }}>
            {!signalPaletteName && <option value="">Custom</option>}{PALETTES.map(([name]) => <option key={name}>{name}</option>)}</select></label>
          <div className="live-swatches">{rampHex(s.signal.palette).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
          <div role="group" aria-label="Pose history">
            {SIGNAL_CONTROLS.filter(c => POSE_CONTROLS.includes(c.key)).map(c => <Slider key={c.key}
              label={c.label} value={s.signal[c.key]} min={c.min} max={c.max} step={c.step}
              unit={c.key === 'poseSpacing' ? ' s' : ''}
              disabled={!s.signal.removeBackground || (c.key !== 'poseEcho' && s.signal.poseEcho === 0)}
              onChange={value => setSignal({ [c.key]: value })} />)}
          </div>
          {SIGNAL_CONTROLS.filter(c => !POSE_CONTROLS.includes(c.key) && !['maskThreshold', 'maskSoftness', 'focus', 'blockSize', 'mix'].includes(c.key)).map(c => <Slider key={c.key}
            label={c.label} value={s.signal[c.key]} min={c.min} max={c.max} step={c.step}
            unit={['memorySeconds', 'chargeSeconds'].includes(c.key) ? ' s' : ''}
            onChange={value => setSignal({ [c.key]: value })} />)}
          <details><summary>Cutout and detail</summary>{SIGNAL_CONTROLS.filter(c => ['maskThreshold','maskSoftness','focus','blockSize','mix'].includes(c.key)).map(c => <Slider key={c.key} label={c.label} value={s.signal[c.key]} min={c.min} max={c.max} step={c.step} onChange={value => setSignal({ [c.key]: value })} />)}</details>
          <label className="live-check"><input aria-label="Hold frame memory" type="checkbox" checked={s.signal.hold} onChange={e => setSignal({ hold: e.target.checked })} />Hold frame memory<small>Stops new frames and poses from being captured. Movement still bends the frame memory.</small></label>
          <p className="live-note">Depth relief uses brightness as a depth map. Depth focus chooses the brightness plane that stays in place.</p>
        </> : smoke ? <>
          <p className="live-note">People are made of smoke. Moving tears it off them.</p>
          <div className="live-starts" role="group" aria-label="Start from">{SMOKE_STARTS.map(start =>
            <button key={start.id} className={`text-button ${Object.entries(start.values).every(([k, v]) => s.smoke[k as keyof typeof start.values] === v) ? 'on' : ''}`} onClick={() => setSmoke({ ...start.values })}>{start.label}</button>)}</div>
          {SMOKE_CONTROLS.map(c => c.key === 'lifeSeconds' ? <div key={c.key}>
            <Slider label={c.label} value={s.smoke.lifeSeconds} min={c.min} max={c.max} step={c.step} unit=" s" shown={s.smoke.forever ? 'Forever' : undefined} disabled={s.smoke.forever} onChange={value => setSmoke({ lifeSeconds: value })} />
            <label className="live-check"><input aria-label="Forever" type="checkbox" checked={s.smoke.forever} onChange={e => setSmoke({ forever: e.target.checked })} />Forever
              <small>Smoke never fades and stays in the picture: people move it around. Turn Emit down once it is full; Clear empties it.</small></label>
          </div> : <Slider key={c.key} label={c.label} value={s.smoke[c.key]} min={c.min} max={c.max} step={c.step} onChange={value => setSmoke({ [c.key]: value })} />)}
          <label className="stacked-label">Palette<select aria-label="Palette" value={smokePaletteName} onChange={e => { const found = PALETTES.find(([name]) => name === e.target.value); if (found) setSmoke({ palette: [...found[1]] }); }}>
            {!smokePaletteName && <option value="">Custom</option>}{PALETTES.map(([name]) => <option key={name}>{name}</option>)}</select></label>
          <div className="live-swatches" title="Darkest to brightest, as people are coloured">{rampHex(s.smoke.palette).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
        </> : kaleidoscope ? <>
          <p className="live-note">Folds the camera or video into a turning pattern. If the source stops, the last picture holds.</p>
          <label className="live-check"><input aria-label="Spiral" type="checkbox" checked={s.kaleidoscope.spiral} onChange={e => setKaleidoscope({ spiral: e.target.checked })} />Spiral<small>Wraps the picture into an endless spiral instead of folding it.</small></label>
          {!s.kaleidoscope.spiral && <>
            <label className="stacked-label">Symmetry<select aria-label="Symmetry" value={s.kaleidoscope.group} onChange={e => setKaleidoscope({ group: Number(e.target.value) })}>
              {SYMMETRY_NAMES.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
            {s.kaleidoscope.group === 0
              ? <Slider label="Mirrors" value={s.kaleidoscope.sectors} min={KALEIDOSCOPE_LIVE.sectors.min} max={KALEIDOSCOPE_LIVE.sectors.max} step={1} onChange={sectors => setKaleidoscope({ sectors })} />
              : <Slider label="Repeat size" value={s.kaleidoscope.cell} min={KALEIDOSCOPE_LIVE.cell.min} max={KALEIDOSCOPE_LIVE.cell.max} step={.01} onChange={cell => setKaleidoscope({ cell })} />}
          </>}
          <Slider label="Spin" value={s.kaleidoscope.spin} min={KALEIDOSCOPE_LIVE.spin.min} max={KALEIDOSCOPE_LIVE.spin.max} step={.01} onChange={spin => setKaleidoscope({ spin })} />
          {s.kaleidoscope.spiral && <Slider label="Zoom" value={s.kaleidoscope.zoom} min={KALEIDOSCOPE_LIVE.zoom.min} max={KALEIDOSCOPE_LIVE.zoom.max} step={.05} onChange={zoom => setKaleidoscope({ zoom })} />}
        </> : <>
          <p className="live-note">Movement lays down paint. Standing still lets it fade.</p>
          {PAINT_CONTROLS.filter(c => c.key !== 'ground').map(c => <Slider key={c.key} label={c.label} value={s.paint[c.key]} min={c.min} max={c.max} step={c.step} unit={c.key === 'fadeSeconds' ? ' s' : ''}
            onChange={value => live.update(v => ({ ...v, paint: { ...v.paint, [c.key]: value } }))} />)}
          <label className="stacked-label">Palette<select aria-label="Palette" value={paletteName} onChange={e => { const found = PALETTES.find(([name]) => name === e.target.value); if (found) set({ palette: [...found[1]] }); }}>
            {!paletteName && <option value="">Custom</option>}{PALETTES.map(([name]) => <option key={name}>{name}</option>)}</select></label>
          <div className="live-swatches">{s.palette.slice(0, 5).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
          <label className="stacked-label">Ground<select aria-label="Ground" value={s.paint.ground >= .5 ? 1 : 0} onChange={e => live.update(v => ({ ...v, paint: { ...v.paint, ground: Number(e.target.value) } }))}><option value={0}>Black</option><option value={1}>White</option></select></label>
        </>}
      </aside>
    </div>
  </section>;
}
