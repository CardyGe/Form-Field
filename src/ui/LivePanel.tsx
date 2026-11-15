import { useRef, type ReactNode } from 'react';
import { useLive } from './useLive';
import { NOISE_FLOOR, PAINT_CONTROLS, SENSITIVITY, type Box, type LiveSettings } from '../live/settings';
import { ACID_DRIP, CANDY, CYAN_YELLOW, ELECTRIC, HOT_SIGNAL, LIME_VIOLET, NEON_STRATA, POP_PORTAL, SOLAR } from '../core/palettes';

const PALETTES: [string, string[]][] = [['Hot Signal', HOT_SIGNAL], ['Neon Strata', NEON_STRATA], ['Acid Drip', ACID_DRIP], ['Pop Portal', POP_PORTAL],
  ['Lime Violet', LIME_VIOLET], ['Electric', ELECTRIC], ['Candy', CANDY], ['Solar', SOLAR], ['Cyan Yellow', CYAN_YELLOW]];
const TEST = '__test', FILE = '__file';
const CAMERA_OFF = 'Camera access is off. Allow Form & Field in System Settings › Privacy & Security › Camera, then reopen the app.';

function Slider({ label, value, min, max, step, unit = '', onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void }) {
  return <label className="live-control"><span>{label}<output>{step >= 1 ? value : value.toFixed(2)}{unit}</output></span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /></label>;
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
  const status = live.outputOpen ? 'Showing on the output'
    : s.source.kind === 'camera' && refused ? CAMERA_OFF
    : state.status === 'running' ? `${s.source.kind === 'camera' ? 'Camera running' : 'Playing'} · ${state.label}`
    : state.status === 'starting' ? 'Starting…'
    : state.status === 'none' ? 'No camera was found. Connect one, or use a video file or the test pattern.'
    : state.status === 'lost' ? 'Camera disconnected. Reconnect it or choose another source.'
    : state.status === 'error' ? state.message : '';
  const paletteName = PALETTES.find(([, colours]) => colours.join() === s.palette.join())?.[0] ?? '';

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
        {(state.status === 'lost' || state.status === 'none') && !live.outputOpen && <button className="secondary-button live-wide" onClick={live.retry}>Try the camera again</button>}
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
        <label className="stacked-label">Output quality<select aria-label="Output quality" value={s.quality} onChange={e => set({ quality: Number(e.target.value) === 720 ? 720 : 1080 })}><option value={1080}>1920 × 1080</option><option value={720}>1280 × 720 · lighter</option></select></label>
      </aside>
      <div className="live-stage">
        {live.outputOpen ? (live.preview ? <img alt="Output preview" src={live.preview} /> : <p className="live-status">Waiting for the output…</p>)
          : <canvas aria-label="Live preview" ref={live.setCanvas} />}
      </div>
      <aside className="live-column" aria-label="Paint"><h2>Paint</h2>
        <p className="live-note">Movement lays down paint. Standing still lets it fade.</p>
        {PAINT_CONTROLS.filter(c => c.key !== 'ground').map(c => <Slider key={c.key} label={c.label} value={s.paint[c.key]} min={c.min} max={c.max} step={c.step} unit={c.key === 'fadeSeconds' ? ' s' : ''}
          onChange={value => live.update(v => ({ ...v, paint: { ...v.paint, [c.key]: value } }))} />)}
        <label className="stacked-label">Palette<select aria-label="Palette" value={paletteName} onChange={e => { const found = PALETTES.find(([name]) => name === e.target.value); if (found) set({ palette: [...found[1]] }); }}>
          {!paletteName && <option value="">Custom</option>}{PALETTES.map(([name]) => <option key={name}>{name}</option>)}</select></label>
        <div className="live-swatches">{s.palette.slice(0, 5).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
        <label className="stacked-label">Ground<select aria-label="Ground" value={s.paint.ground >= .5 ? 1 : 0} onChange={e => live.update(v => ({ ...v, paint: { ...v.paint, ground: Number(e.target.value) } }))}><option value={0}>Black</option><option value={1}>White</option></select></label>
      </aside>
    </div>
  </section>;
}
