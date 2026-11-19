/**
 * The strip under the stage, always visible: the sound input with its meters, the tempo with Tap, MIDI, the scenes,
 * and Show, a popover for what acts on the whole show (triggers, and reactions only a scene not on screen uses).
 * What a single shape reacts to is in that shape's Sound tab.
 */
import { useEffect, useRef, useState } from 'react';
import type { useMap } from './useMap';
import { ReactDevices } from './ReactControls';
import MapScenes from './MapScenes';
import MapReactivity from './MapReactivity';

type Map = ReturnType<typeof useMap>;

export default function MapSoundStrip({ map }: { map: Map }) {
  const [showOpen, setShowOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  // The meters run while the strip is on screen, once sound and MIDI have been started.
  useEffect(() => { map.setReactivityPanel(true); return () => map.setReactivityPanel(false); }, []);
  useEffect(() => {
    if (!showOpen) return;
    const away = (e: PointerEvent) => { if (!pop.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setShowOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setShowOpen(false); } };
    window.addEventListener('pointerdown', away); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key, true); };
  }, [showOpen]);
  const count = map.show.triggers.length;
  return <div className="map-sound-strip" role="region" aria-label="Sound and scenes">
    <ReactDevices engine={map.engine} meter={map.signals} onStart={map.startEngine} layout="strip" needsInput={map.show.links.some(l => l.on && /^(audio|beat)\./.test(l.input))} />
    <MapScenes map={map} />
    <button ref={button} className={`text-button ${showOpen ? 'live-toggle on' : ''}`} aria-label="Show-wide sound and triggers" aria-expanded={showOpen}
      title="Triggers, and reactions only a scene not on screen uses" onClick={() => setShowOpen(o => !o)}>Show{count ? <small> · {count}</small> : null}</button>
    {showOpen && <div ref={pop} className="map-show-pop" role="dialog" aria-label="Show-wide sound and triggers"><MapReactivity map={map} /></div>}
  </div>;
}
