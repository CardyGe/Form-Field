/**
 * Map's Effect tab, below the instrument card: the effect's own settings, the ones Studio shows, with the same ranges,
 * groups and folding (Studio's own controls). Each can react to sound or MIDI where that can work.
 * A setting that only changes by restarting is greyed for ∿; one animated in Studio is shown, not moved here.
 */
import { useRef, useState } from 'react';
import type { useMap } from './useMap';
import { LayerShapeControls } from './LayerControls';
import { ReactTo, linkFor } from './ReactControls';
import { newItemId, newSourceId } from './mapActions';
import { reactable } from '../map/targets';
import type { Shape } from '../map/show';
import type { Layer, ParameterDefinition } from '../shared/types';

type Map = ReturnType<typeof useMap>;
const RESTARTS = 'Changing this restarts the effect, so it can’t follow sound';

export default function MapEffectTab({ map, shape, locked, linked, setNote }: { map: Map; shape: Shape; locked: boolean; linked: boolean; setNote: (text: string | null) => void }) {
  const source = shape.sourceId ? map.show.sources.find(s => s.id === shape.sourceId) ?? null : null;
  const [layerIndex, setLayerIndex] = useState(0);
  const [oilFine, setOilFine] = useState(false);
  /** Each drag (or key run) is one undo step: the merge key changes with each gesture. */
  const gesture = useRef(0);
  if (!source) return null;
  const layers = source.project.layers, index = Math.min(layerIndex, layers.length - 1), layer = layers[index];
  const sharers = map.show.shapes.filter(s => s.sourceId === source.id);

  /** The source to edit: with "Change all" off on a shared effect, this shape first gets its own copy. */
  const target = (): string | null => {
    if (sharers.length > 1 && !linked) {
      const id = newSourceId();
      return map.dispatch({ type: 'makeSeparate', shapeId: shape.id, sourceId: id }) ? id : null;
    }
    return source.id;
  };
  const edit = (change: (l: Layer) => Layer) => {
    if (locked) return;
    const next = change(layer);
    const changed = Object.keys({ ...layer.params, ...next.params }).filter(k => layer.params[k] !== next.params[k]);
    const { params: _a, ...restBefore } = layer, { params: _b, ...restAfter } = next;
    const onlyNumbers = JSON.stringify(restBefore) === JSON.stringify(restAfter) && changed.every(k => typeof next.params[k] === 'number');
    const id = target();
    if (!id) return;
    if (onlyNumbers && changed.length) {
      map.dispatch({ type: 'setSourceLayer', sourceId: id, layer: index, params: Object.fromEntries(changed.map(k => [k, next.params[k]])) }, `param-${id}-${index}-${changed.join(',')}-${gesture.current}`);
    } else {
      const project = map.show.sources.find(s => s.id === id)?.project ?? source.project;
      map.dispatch({ type: 'setSourceProject', sourceId: id, project: { ...project, layers: project.layers.map((l, n) => n === index ? next : l) } });
    }
  };
  const targetOf = (d: ParameterDefinition) => `source.${source.id}.param.${index}.${d.key}`;
  const extra = (d: ParameterDefinition) => {
    if (layer.modulations[d.key]) return <span className="map-animated" title="This setting is animated in Studio: Studio’s animation moves it">animated in Studio</span>;
    if (!reactable(d).ok) return <span className="react-to disabled" title={RESTARTS} aria-label={`${d.label}: ${RESTARTS}`}><span className="react-to-icon">∿</span></span>;
    const t = targetOf(d), links = map.show.links.filter(l => l.target === t);
    return <ReactTo label={d.label} target={t} linked={links.length} engine={map.engine} disabled={locked} onStart={map.startEngine}
      onAdd={input => map.dispatch({ type: 'addLink', link: linkFor(newItemId('link'), input, t, '') })}
      onStop={() => map.dispatch({ type: 'removeLinks', target: t })} />;
  };
  return <div className="map-effect-settings">
    {layers.length > 1 && <div className="map-layer-chips" role="group" aria-label="Layer">{layers.map((l, i) =>
      <button key={l.id} className={`look-chip ${i === index ? 'on' : ''}`} aria-pressed={i === index} onClick={() => setLayerIndex(i)}>{i + 1} · {l.name}</button>)}</div>}
    <LayerShapeControls layer={layer} edit={edit} onStart={() => { gesture.current++; }} onEnd={() => {}}
      seed={source.project.seed} duration={source.project.duration} notify={text => setNote(text)}
      oilFine={oilFine} setOilFine={change => setOilFine(change)} paramExtra={extra} readOnly={d => locked || !!layer.modulations[d.key]} />
  </div>;
}
