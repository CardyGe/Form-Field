/**
 * Map's Show popover (from the sound strip): the triggers that switch scenes, vary effects, black out, freeze or tap
 * the tempo, and the reactions only a scene not on screen uses (every other reaction is in its shape's Sound tab).
 */
import { useMemo } from 'react';
import type { useMap } from './useMap';
import { InputSelect, LinkRow } from './ReactControls';
import { newItemId } from './mapActions';
import { offScreenLinks, targetOptions, targetRange } from '../map/targets';
import { MAX_TRIGGERS } from '../map/show';
import type { Trigger, TriggerAction } from '../react/links';

type Map = ReturnType<typeof useMap>;
const EVERY = [1, 2, 4, 8, 16, 32];

const actionValue = (a: TriggerAction) => a.kind === 'scene' ? `scene:${a.sceneId}` : a.kind === 'vary' ? `vary:${a.sourceId}` : a.kind;
function actionFrom(value: string): TriggerAction {
  if (value.startsWith('scene:')) return { kind: 'scene', sceneId: value.slice(6) };
  if (value.startsWith('vary:')) return { kind: 'vary', sourceId: value.slice(5) };
  return { kind: value as 'next-scene' | 'previous-scene' | 'blackout' | 'freeze' | 'tap' };
}

export default function MapReactivity({ map }: { map: Map }) {
  const show = map.show, engine = map.engine;
  // Remade only when the show changes.
  const targets = useMemo(() => targetOptions(show), [show]);
  const addTrigger = () => {
    map.startEngine();
    const trigger: Trigger = { id: newItemId('trigger'), input: 'tempo.beat', when: 'beats', every: 16, action: { kind: 'next-scene' }, on: true };
    map.dispatch({ type: 'addTrigger', trigger });
  };
  const offScreen = offScreenLinks(show);
  return <div className="react-panel">
    <div className="map-list-head"><h3>Triggers <span className="muted-text">{show.triggers.length || ''}</span></h3>
      <button className="text-button" disabled={show.triggers.length >= MAX_TRIGGERS} title="Do something on a note, a control, the beat, or every few beats" onClick={addTrigger}>+ Trigger</button></div>
    {show.triggers.map(t => <TriggerRow key={t.id} trigger={t} map={map} />)}
    {!show.triggers.length && <p className="muted-text">A trigger switches scenes, varies an effect, blacks out, freezes or taps the tempo on a note, a control or every few beats.</p>}
    {offScreen.length > 0 && <>
      <div className="map-list-head"><h3>Reactions in other scenes <span className="muted-text">{offScreen.length}</span></h3></div>
      <p className="muted-text">On effects only a scene that is not on screen plays.</p>
      {offScreen.map(link => <LinkRow key={link.id} link={link} engine={engine} targets={targets} targetLabel={targetRange(show, link.target)?.label ?? 'Missing'}
        onChange={change => map.dispatch({ type: 'updateLink', linkId: link.id, change })} onRemove={() => map.dispatch({ type: 'removeLink', linkId: link.id })} />)}
    </>}
  </div>;
}

function TriggerRow({ trigger: t, map }: { trigger: Trigger; map: Map }) {
  const change = (c: Partial<Omit<Trigger, 'id'>>) => map.dispatch({ type: 'updateTrigger', triggerId: t.id, change: c });
  const beats = t.when === 'beats';
  return <div className="react-trigger" data-trigger={t.id}>
    <div className="react-trigger-head">
      <input type="checkbox" aria-label="Trigger on" checked={t.on} onChange={e => change({ on: e.target.checked })} />
      <label className="map-field">When<select aria-label="When" value={beats ? 'beats' : 'on'} onChange={e => change(e.target.value === 'beats' ? { when: 'beats', input: 'tempo.beat' } : { when: 'on', input: 'beat.pulse' })}>
        <option value="beats">Every few beats</option><option value="on">A note, control or beat</option></select></label>
      <button className="map-icon" aria-label="Remove trigger" title="Remove" onClick={() => map.dispatch({ type: 'removeTrigger', triggerId: t.id })}>×</button>
    </div>
    {beats ? <label className="map-field">Every<select aria-label="Every" value={t.every} onChange={e => change({ every: Number(e.target.value) })}>
      {EVERY.map(n => <option key={n} value={n}>{n} {n === 1 ? 'beat' : 'beats'}{n % 4 === 0 ? ` (${n / 4} ${n === 4 ? 'bar' : 'bars'})` : ''}</option>)}</select></label>
      : <InputSelect value={t.input} engine={map.engine} learnKey={`trigger:${t.id}`} label="Goes on" onChange={input => change({ input })} />}
    <label className="map-field">Does<select aria-label="Does" value={actionValue(t.action)} onChange={e => change({ action: actionFrom(e.target.value) })}>
      <option value="next-scene">Next scene</option><option value="previous-scene">Previous scene</option>
      {map.show.scenes.map(s => <option key={s.id} value={`scene:${s.id}`}>Scene: {s.name}</option>)}
      {map.show.sources.map(s => <option key={s.id} value={`vary:${s.id}`}>Vary: {s.project.name}</option>)}
      <option value="blackout">Blackout on or off</option><option value="freeze">Freeze on or off</option><option value="tap">Tap the tempo</option>
    </select></label>
  </div>;
}
