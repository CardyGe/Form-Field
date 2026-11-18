import { useEffect, useMemo, useRef, useState } from 'react';
import MapIcon from './mapIcons';
import { kindArt } from './kindArt';
import { LookPreviews } from './lookPreviews';
import { PRESETS } from '../core/project';
import { KIND_LABELS } from '../core/library';

/** A look as the browser offers it: the shape's own fill, or a Library preset. value is what choosing it asks for. */
interface Look { value: string; name: string; kind: string; group: string; description: string }

const FILLS: Look[] = [
  { value: 'grid', name: 'Grid pattern', kind: 'fill', group: 'Fill', description: 'Lines in the shape’s colour, for lining up' },
  { value: 'colour', name: 'Its colour', kind: 'fill', group: 'Fill', description: 'The shape’s plain colour' },
];
const LOOKS: Look[] = [...FILLS, ...PRESETS.map(p => ({ value: `preset:${p.id}`, name: p.name, kind: p.kind, group: KIND_LABELS[p.kind] ?? p.kind, description: p.description }))];
const GROUPS = ['All', ...new Set(LOOKS.map(l => l.group))];
/** The chip last chosen, kept while the app is open. */
let lastGroup = 'All';

/** One tile: a still preview (or the instrument's picture until it is ready), moving while the pointer is on it. */
function Tile({ look, previews, current, onPick }: { look: Look; previews: LookPreviews; current: boolean; onPick: (value: string) => void }) {
  const preset = look.value.startsWith('preset:') ? look.value.slice('preset:'.length) : null;
  const [still, setStill] = useState<string | undefined>(() => preset ? LookPreviews.known(preset) : undefined);
  const live = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  const tile = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!preset || still) return;
    // Made when the tile comes into view, not all 91 at once.
    let cancelled = false;
    const seen = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      seen.disconnect();
      void previews.still(preset).then(url => { if (!cancelled && url) setStill(url); });
    });
    if (tile.current) seen.observe(tile.current);
    return () => { cancelled = true; seen.disconnect(); };
  }, [preset, still, previews]);
  useEffect(() => {
    if (!hover || !preset || !live.current) return;
    previews.play(preset, live.current);
    return () => previews.stop();
  }, [hover, preset, previews]);
  const art = preset ? still ?? kindArt(look.kind) : undefined;
  return <button ref={tile} type="button" className={`look-tile ${current ? 'current' : ''}`} data-look={look.value} aria-label={`Play ${look.name}`} aria-pressed={current} title={look.description}
    onClick={() => onPick(look.value)} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
    <span className={`look-art ${look.value === 'grid' ? 'grid' : look.value === 'colour' ? 'colour' : ''}`}>
      {art && <img src={art} alt="" />}
      {preset && <canvas ref={live} width={192} height={108} className={hover ? 'playing' : ''} />}
    </span>
    <span className="look-name">{look.name}</span>
  </button>;
}

/**
 * The look browser: everything a shape can play, with search, a chip for each kind of instrument, and tiles with
 * previews. Clicking a tile plays it in the shape at once; the browser stays open to try others. Esc or ✕ closes it.
 */
export default function MapLookBrowser({ current, colour, onPick, onClose }: { current: string; colour: string; onPick: (value: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(lastGroup);
  const previews = useMemo(() => new LookPreviews(), []);
  useEffect(() => () => previews.dispose(), [previews]);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } };
    const outside = (e: PointerEvent) => { if (panel.current && !panel.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-opens-looks]')) onClose(); };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', outside, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', outside, true); };
  }, [onClose]);
  const q = query.trim().toLowerCase();
  const shown = LOOKS.filter(l => (group === 'All' || l.group === group) && (!q || `${l.name} ${l.group} ${l.description}`.toLowerCase().includes(q)));
  // Escape closes from inside the panel too (focus is usually on a tile), as well as from anywhere in the window.
  return <div ref={panel} className="look-browser" role="dialog" aria-label="Looks" style={{ ['--shape-colour' as string]: colour }}
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <div className="look-head">
      <label className="look-search"><MapIcon name="search" /><input type="search" autoFocus aria-label="Search looks" placeholder="Search looks…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <button className="map-icon" aria-label="Close looks" onClick={onClose}><MapIcon name="close" size={16} /></button>
    </div>
    <div className="look-chips" role="group" aria-label="Kinds">{GROUPS.map(g => <button key={g} type="button" className={`look-chip ${g === group ? 'on' : ''}`} aria-pressed={g === group} onClick={() => { setGroup(g); lastGroup = g; }}>{g}</button>)}</div>
    <div className="look-grid">{shown.map(look => <Tile key={look.value} look={look} previews={previews} current={look.value === current} onPick={onPick} />)}
      {!shown.length && <p className="muted-text">No looks match “{query}”.</p>}</div>
  </div>;
}
