/**
 * Map's Effect tab, below the instrument card: the effect's own settings, the ones Studio shows, with the same ranges,
 * groups and folding (Studio's own controls). Each can react to sound or MIDI where that can work.
 * A setting that only changes by restarting is greyed for ∿; one animated in Studio is shown, not moved here.
 */
import { useRef, useState } from 'react';
import type { useMap } from './useMap';
import { LayerShapeControls, Parameter, gradingKeys } from './LayerControls';
import { EditGrouper } from '../map/undo-group';
import { visibleParameterDefinitions } from '../core/project';
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
  /** One drag is one undo step; a reset, a typed value or a choice is a step of its own. */
  const grouper = useRef(new EditGrouper());
  if (!source) return null;
  const layers = source.project.layers, index = Math.min(layerIndex, layers.length - 1), layer = layers[index];
  const sharers = map.show.shapes.filter(s => s.sourceId === source.id);
  const finish = visibleParameterDefinitions(layer).filter(d => gradingKeys.includes(d.key));

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
      map.dispatch({ type: 'setSourceLayer', sourceId: id, layer: index, params: Object.fromEntries(changed.map(k => [k, next.params[k]])) }, grouper.current.key(`param-${id}-${index}-${changed.join(',')}`));
    } else {
      const project = map.show.sources.find(s => s.id === id)?.project ?? source.project;
      map.dispatch({ type: 'setSourceProject', sourceId: id, project: { ...project, layers: project.layers.map((l, n) => n === index ? next : l) } }, grouper.current.key(`project-${id}-${index}`));
    }
  };
  const targetOf = (d: ParameterDefinition) => `source.${source.id}.param.${index}.${d.key}`;
  const extra = (d: ParameterDefinition) => {
    if (layer.modulations[d.key]) return <span className="map-animated" title="This setting is animated in Studio: Studio’s animation moves it">animated in Studio</span>;
    if (!reactable(d).ok) return <span className="react-to disabled" title={RESTARTS} aria-label={`${d.label}: ${RESTARTS}`}><span className="react-to-icon">∿</span></span>;
    const t = targetOf(d), links = map.show.links.filter(l => l.target === t);
    return <ReactTo label={d.label} target={t} linked={links.length} engine={map.engine} disabled={locked} onStart={map.startEngine}
      onAdd={input => { const id = target(); if (id) map.dispatch({ type: 'addLink', link: linkFor(newItemId('link'), input, `source.${id}.param.${index}.${d.key}`, '') }); }}
      onStop={() => map.dispatch({ type: 'removeLinks', target: t })} />;
  };
  return <div className="map-effect-settings">
    {layers.length > 1 && <div className="map-layer-chips" role="group" aria-label="Layer">{layers.map((l, i) =>
      <button key={l.id} className={`look-chip ${i === index ? 'on' : ''}`} aria-pressed={i === index} onClick={() => setLayerIndex(i)}>{i + 1} · {l.name}</button>)}</div>}
    <LayerShapeControls layer={layer} edit={edit} onStart={() => grouper.current.begin()} onEnd={() => grouper.current.end()}
      seed={source.project.seed} duration={source.project.duration} notify={text => setNote(text)}
      oilFine={oilFine} setOilFine={change => setOilFine(change)} paramExtra={extra} readOnly={d => locked || !!layer.modulations[d.key]} />
    {/* Studio's Finish tab, for this layer: its grading and finish settings, then Opacity. */}
    <details className="control-section inspector-section" data-section="finish">
      <summary>Finish<span>{finish.length + 1}</span></summary>
      {finish.map(d => <Parameter key={d.key} definition={d} value={layer.params[d.key] ?? d.default} animated={!!layer.modulations[d.key]} readOnly={locked || !!layer.modulations[d.key]}
        onChange={n => edit(l => ({ ...l, params: { ...l.params, [d.key]: n } }))} extra={extra(d)} onStart={() => grouper.current.begin()} onEnd={() => grouper.current.end()} />)}
      <Parameter definition={{ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: .01, default: 1, section: 'Material' }} value={layer.opacity} animated={false} readOnly={locked}
        onChange={n => edit(l => ({ ...l, opacity: n }))} onStart={() => grouper.current.begin()} onEnd={() => grouper.current.end()} />
    </details>
  </div>;
}
