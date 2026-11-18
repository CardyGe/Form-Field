/**
 * Map's Sound tab: what makes this one shape (and the effect it plays) move with sound and MIDI. The ready-made
 * reactions, then one compact row per reaction that opens to its full controls. Show-wide sound (the input, tempo,
 * MIDI, triggers) is in the strip under the stage.
 */
import { useMemo } from 'react';
import type { useMap } from './useMap';
import { LinkRow } from './ReactControls';
import { newItemId } from './mapActions';
import { REACTIONS, linkInUse, reactionLinks, shapeLinks, targetOptions, targetRange, type Reaction } from '../map/targets';
import { LIVE_SOURCE_ID, type Shape } from '../map/show';

type Map = ReturnType<typeof useMap>;
const SOUND_INPUTS = ['audio.', 'beat.'];

export default function MapSoundTab({ map, shape, locked, setNote }: { map: Map; shape: Shape; locked: boolean; setNote: (text: string | null) => void }) {
  const links = shapeLinks(map.show, shape.id);
  // This shape's own settings, and its effect's: what its reactions can move.
  const targets = useMemo(() => targetOptions(map.show).filter(t => t.target.startsWith(`shape.${shape.id}.`) || (shape.sourceId !== null && t.target.startsWith(`source.${shape.sourceId}.`))), [map.show, shape.id, shape.sourceId]);
  const noInput = !map.engine?.prefs.audioDevice;
  const add = (reaction: Reaction) => {
    const made = reactionLinks(map.show, reaction, shape.id, [newItemId('link')]);
    if (typeof made === 'string') { setNote(made === 'needs-instrument' ? 'This reaction needs the shape to play an effect with a motion setting' : 'That shape is gone'); return; }
    setNote(null);
    map.startEngine();
    map.dispatch({ type: 'addReaction', reaction, shapeId: shape.id, ids: made.map(l => l.id) });
  };
  return <div className="map-sound-tab">
    {shape.sourceId === LIVE_SOURCE_ID && <p className="muted-text">Live’s own reactions are in the Effect tab, with Live’s sliders.</p>}
    <label className="map-field">Add a reaction<select aria-label="Add a reaction" value="" disabled={locked || shape.blocker} onChange={e => { if (e.target.value) add(e.target.value as Reaction); }}>
      <option value="">Choose…</option>
      {(Object.keys(REACTIONS) as Reaction[]).map(r => <option key={r} value={r} disabled={r === 'instrument-bass' && (!shape.sourceId || shape.sourceId === LIVE_SOURCE_ID)}>{REACTIONS[r].label}</option>)}
    </select></label>
    {!links.length && <p className="muted-text">Nothing on this shape reacts yet. Use ∿ beside a setting in the Shape or Effect tab, or a reaction above.</p>}
    {links.map(link => {
      const note = !linkInUse(map.show, link) ? 'Not in use: this setting is hidden for this pattern'
        : noInput && SOUND_INPUTS.some(p => link.input.startsWith(p)) ? 'Choose a sound input in the strip below' : undefined;
      return <LinkRow key={link.id} link={link} engine={map.engine} targets={targets} targetLabel={targetRange(map.show, link.target)?.label ?? 'Missing'} note={note}
        onChange={change => map.dispatch({ type: 'updateLink', linkId: link.id, change })} onRemove={() => map.dispatch({ type: 'removeLink', linkId: link.id })} />;
    })}
  </div>;
}
