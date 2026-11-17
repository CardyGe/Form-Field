import { useEffect, useRef, type ReactNode } from 'react';
import { useMap } from './useMap';
import { paint } from '../map/draw';
import { STAGE_SIZE } from '../map/show';

/** The Map screen. `header` is the app's own mode switch, so all screens share it. */
export default function MapPanel({ header, onError }: { header: ReactNode; onError: (message: string) => void }) {
  const map = useMap(onError);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    paint(ctx, map.show, { blackout: false, testGrid: false, identifyId: null, crosshair: null, selectedId: map.selectedId, selectedIndex: null, outlinesOnly: false, invalidIds: [] });
  }, [map.show, map.selectedId]);

  const status = map.lastRefusal ? `Not applied: ${map.lastRefusal}` : map.sendWarning ?? (map.outputOpen ? 'Showing on the output' : map.loaded ? 'Ready' : 'Loading…');

  return <section className="live-shell map-shell" role="region" aria-label="Map">
    <header className="app-header">{header}<div className="live-actions">
      <label className="live-inline">Projector<select aria-label="Projector" value={map.display ?? ''} disabled={map.outputOpen || !map.displays.length} onChange={e => map.setDisplay(Number(e.target.value))}>
        {map.displays.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      {map.outputOpen ? <button className="primary-button" onClick={map.closeOutput}>Close output</button>
        : <button className="primary-button" disabled={!map.desktop || map.display === null} title="Show the stage full screen on the chosen projector · Esc closes it" onClick={() => void map.openOutput()}>Open output</button>}
      <button className={`text-button live-toggle ${map.blackout ? 'on' : ''}`} aria-pressed={map.blackout} onClick={() => map.setBlackout(!map.blackout)}>Blackout</button>
      <button className="text-button" aria-pressed={map.testGrid} onClick={() => map.setTestGrid(!map.testGrid)}>Test grid</button>
      <button className="text-button" disabled title="Flash the selected shape on the output">Identify</button>
    </div></header>
    <div className="map-body">
      <aside className="live-column map-shapes" aria-label="Shapes">
        <h2>Shapes</h2>
        {map.show.shapes.length === 0 && <p className="muted-text">No shapes yet.</p>}
        <ul className="map-shape-list">{map.show.shapes.map(shape => <li key={shape.id} className={shape.id === map.selectedId ? 'selected' : ''}>
          <button className="map-shape-name" aria-pressed={shape.id === map.selectedId} onClick={() => map.setSelectedId(shape.id)}>
            <span className="map-swatch" style={{ background: shape.colour }} />{shape.name}</button>
          <button className="text-button" aria-pressed={shape.visible} aria-label={`${shape.visible ? 'Hide' : 'Show'} ${shape.name}`} onClick={() => map.dispatch({ type: 'setVisible', shapeId: shape.id, visible: !shape.visible })}>{shape.visible ? 'Shown' : 'Hidden'}</button>
          <button className="text-button" aria-pressed={shape.locked} aria-label={`${shape.locked ? 'Unlock' : 'Lock'} ${shape.name}`} onClick={() => map.dispatch({ type: 'setLocked', shapeId: shape.id, locked: !shape.locked })}>{shape.locked ? 'Locked' : 'Unlocked'}</button>
        </li>)}</ul>
      </aside>
      <main className="map-stage"><canvas ref={canvas} aria-label="Stage" width={STAGE_SIZE.width} height={STAGE_SIZE.height} /></main>
    </div>
    <footer className="map-status" role="status">{status}</footer>
  </section>;
}
