/**
 * Stage 6: what a shape playing a video shows in its Effect tab: the file and whether it is playing, Speed (with ∿,
 * greyed while the loop follows the tempo), Loop with the tempo and what it plays as, Find… and Try again.
 */
import type { useMap } from './useMap';
import { ReactTo, linkFor } from './ReactControls';
import { newItemId } from './mapActions';
import { SPEED_RANGE, TEMPO_SYNC_BEATS, type Shape } from '../map/show';

type Map = ReturnType<typeof useMap>;
const STATES: Record<string, string> = {
  loading: 'Loading…',
  playing: 'Playing',
  missing: 'This file can’t be found. It may have been moved or renamed: use Find… to point at it.',
  unplayable: 'This file can’t be played here. Save it as an MP4 (H.264) and use Find… to point at it.',
};

export default function MapVideoPanel({ map, shape, locked, status }: { map: Map; shape: Shape; locked: boolean; status: { state: string; playsAs: number | null } | null }) {
  const video = map.show.videos.find(v => v.id === shape.sourceId);
  if (!video) return null;
  const target = `source.${video.id}.speed`, links = map.show.links.filter(l => l.target === target);
  const synced = video.tempoSync !== null;
  const find = async () => {
    const file = await window.studio?.map?.findVideo(video.name);
    if (file) map.dispatch({ type: 'relinkVideo', path: video.path, to: file.path, name: file.name });
  };
  const bad = status?.state === 'missing' || status?.state === 'unplayable';
  return <div className="map-video-panel">
    <p className="map-video-name" title={video.path}><strong>{video.name}</strong></p>
    {status && <p className={`react-status ${bad ? 'warn' : ''}`} role="status">{STATES[status.state] ?? status.state}</p>}
    <div className="map-react-field">
      <label className="map-field">Speed · {video.speed.toFixed(2)}×
        <input aria-label="Video speed" type="range" min={SPEED_RANGE.min} max={SPEED_RANGE.max} step={0.05} defaultValue={video.speed} key={video.speed} disabled={locked || synced}
          onPointerUp={e => map.dispatch({ type: 'setSourceSpeed', sourceId: video.id, speed: Number(e.currentTarget.value) })}
          onKeyUp={e => map.dispatch({ type: 'setSourceSpeed', sourceId: video.id, speed: Number(e.currentTarget.value) })} /></label>
      <ReactTo label="Video speed" target={target} linked={links.length} engine={map.engine} disabled={locked || synced} onStart={map.startEngine}
        onAdd={input => map.dispatch({ type: 'addLink', link: linkFor(newItemId('link'), input, target, '') })}
        onStop={() => map.dispatch({ type: 'removeLinks', target })} />
    </div>
    <label className="map-field">Loop with the tempo<select aria-label="Video loop with the tempo" value={video.tempoSync ?? ''} disabled={locked}
      title="Off: the video plays at its own speed. A number: it is stretched or squeezed to last that many beats, and starts again on the beat."
      onChange={e => { map.startEngine(); map.dispatch({ type: 'setTempoSync', sourceId: video.id, beats: e.target.value ? Number(e.target.value) : null }); }}>
      <option value="">Off</option>{TEMPO_SYNC_BEATS.map(n => <option key={n} value={n}>Every {n} {n === 1 ? 'beat' : 'beats'}</option>)}</select></label>
    {synced && status?.playsAs && status.playsAs !== video.tempoSync && <p className="react-status warn">Plays as {status.playsAs} beats: the clip is too {status.playsAs > video.tempoSync! ? 'long' : 'short'} for {video.tempoSync}</p>}
    <div className="map-toggles">
      <button className="text-button" disabled={locked} title="Point at the file in its new place: every shape and scene playing it follows" onClick={() => void find()}>Find…</button>
      {bad && <button className="text-button" onClick={map.retryVideos}>Try again</button>}
    </div>
  </div>;
}
