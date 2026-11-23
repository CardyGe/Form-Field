/**
 * Map's Effect tab, below the instrument card: the effect's own settings, the ones Studio shows, with the same ranges,
 * groups and folding (Studio's own controls). Each can react to sound or MIDI where that can work.
 * A setting that only changes by restarting is greyed for ∿; one animated in Studio is shown, not moved here.
 */
import { useRef, useState } from 'react';
import type { useMap } from './useMap';
import { LayerShapeControls } from './LayerControls';
import { FinishSections } from './FinishControls';
import { visibleBelow } from '../rendering/warp';
import { EditGrouper } from '../map/undo-group';
import { visibleParameterDefinitions } from '../core/project';
import { ReactTo, linkFor } from './ReactControls';
import { mapActions, newItemId } from './mapActions';
import { reactable } from '../map/targets';
import type { Shape } from '../map/show';
import type { Layer, ParameterDefinition } from '../shared/types';

type Map = ReturnType<typeof useMap>;
const RESTARTS = 'Changing this restarts the effect, so it can’t follow sound';

export default function MapEffectTab({ map, shape, locked, linked, setNote }: { map: Map; shape: Shape; locked: boolean; linked: boolean; setNote: (text: string | null) => void }) {
  const source = shape.sourceId ? map.show.sources.find(s => s.id === shape.sourceId) ?? null : null;
  const [layerIndex, setLayerIndex] = useState(0);
  const [oilFine, setOilFine] = useState(false);
  /** The two parts of an effect's settings, as Studio splits them: its look and shape, and its finish. */
  const [part, setPart] = useState<'settings' | 'finish'>('settings');
  /** One drag is one undo step; a reset, a typed value or a choice is a step of its own. */
  const grouper = useRef(new EditGrouper());
  if (!source) return null;
  const layers = source.project.layers, index = Math.min(layerIndex, layers.length - 1), layer = layers[index];
  const sharers = map.show.shapes.filter(s => s.sourceId === source.id);

  /** The source to edit: with "Change all" off on a shared effect, this shape first gets its own copy (in the same undo step). */
  const target = (merge?: string): string | null => {
    if (sharers.length > 1 && !linked) {
      const made = mapActions(map).separate(shape.id, merge);
      if (made?.left) setNote(`${made.left} of the effect's reactions stayed with the other shapes: the show has as many reactions as it can hold`);
      return made?.id ?? null;
    }
    return source.id;
  };
  const edit = (change: (l: Layer) => Layer) => {
    if (locked) return;
    const next = change(layer);
    const changed = Object.keys({ ...layer.params, ...next.params }).filter(k => layer.params[k] !== next.params[k]);
    const { params: _a, ...restBefore } = layer, { params: _b, ...restAfter } = next;
    const onlyNumbers = JSON.stringify(restBefore) === JSON.stringify(restAfter) && changed.every(k => typeof next.params[k] === 'number');
    // One key for the whole change: the copy (if any) and the change are one undo step.
    const merge = grouper.current.key(onlyNumbers ? `param-${source.id}-${index}-${changed.join(',')}` : `project-${source.id}-${index}`);
    const id = target(merge);
    if (!id) return;
    if (onlyNumbers && changed.length) {
      map.dispatch({ type: 'setSourceLayer', sourceId: id, layer: index, params: Object.fromEntries(changed.map(k => [k, next.params[k]])) }, merge);
    } else {
      const project = map.currentShow().sources.find(s => s.id === id)?.project ?? source.project;
      map.dispatch({ type: 'setSourceProject', sourceId: id, project: { ...project, layers: project.layers.map((l, n) => n === index ? next : l) } }, merge);
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
  const picture = layer.kind === 'image' ? layer.image : undefined;
  return <div className="map-effect-settings">
    {picture && <div className="map-image-panel">
      <label className="map-field">Fit<select aria-label="Picture fit" value={picture.fit} disabled={locked} onChange={e => edit(l => ({ ...l, image: { ...l.image!, fit: e.target.value === 'contain' ? 'contain' : 'cover' } }))}>
        <option value="cover">Cover: fills the shape, cropping the edges</option><option value="contain">Contain: the whole picture, with bars</option></select></label>
      <button className="text-button" disabled={locked} title="Choose another picture for this shape" onClick={() => mapActions(map).play(shape.id, 'image', linked)}>Replace…</button>
    </div>}
    {layers.length > 1 && <div className="map-layer-chips" role="group" aria-label="Layer">{layers.map((l, i) =>
      <button key={l.id} className={`look-chip ${i === index ? 'on' : ''}`} aria-pressed={i === index} onClick={() => setLayerIndex(i)}>{i + 1} · {l.name}</button>)}</div>}
    <div className="tab-switch map-effect-parts" role="group" aria-label="Effect settings">{(['settings', 'finish'] as const).map(t =>
      <button key={t} aria-pressed={part === t} className={part === t ? 'active' : ''} onClick={() => setPart(t)}>{t === 'settings' ? 'Settings' : 'Finish'}</button>)}</div>
    {part === 'settings'
      ? <LayerShapeControls locked={locked} layer={layer} edit={edit} onStart={() => grouper.current.begin()} onEnd={() => grouper.current.end()}
          seed={source.project.seed} duration={source.project.duration} notify={text => setNote(text)}
          oilFine={oilFine} setOilFine={change => setOilFine(change)} paramExtra={extra} readOnly={d => locked || !!layer.modulations[d.key]} />
      : <FinishSections hasLayerBelow={visibleBelow(layers, layer.id)} layer={layer} definitions={visibleParameterDefinitions(layer)} edit={edit} onStart={() => grouper.current.begin()} onEnd={() => grouper.current.end()}
          extra={extra} readOnly={d => locked || !!layer.modulations[d.key]} />}
  </div>;
}
