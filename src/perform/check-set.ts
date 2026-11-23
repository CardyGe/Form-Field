/** Perform: Check Set. Reads the show and lists what is likely to go wrong, in plain English. It never changes anything. */
import { isShapeShown, type ShowDocument } from '../map/show';
import { zoneShapes } from './resolve';
import { BEATS_PER_BAR, type Clip } from './types';

export interface CheckResult { level: 'error' | 'warning'; zone: number | null; message: string }
export interface CheckStats {
  /** How long each clip (by id) took to get ready, in milliseconds. */
  prepareMs?: Record<string, number>;
  /** Control signals the MIDImix layout uses (as links name them, e.g. midi.cc.1.19). Left out, the clash check is skipped. */
  midiInputs?: readonly string[];
  /** The tempo that sets how long a bar is; 128 BPM when left out. */
  bpm?: number;
}

const MAX_RENDERERS = 8;
const DEFAULT_BPM = 128;
/** Looks that cut or flicker fast inside themselves: the only ones the code can name. */
const FAST_KINDS = ['texturecuts', 'glitchtunnel'] as const;
const KIND_NAMES: Record<string, string> = { texturecuts: 'Texture Cuts', glitchtunnel: 'Feedback Glitch' };
const REMINDER = 'The app limits flashes that follow the audio, but it does not analyse flashing inside a look. Check every look by eye before a public show.';

export function checkSet(show: ShowDocument, stats: CheckStats = {}): CheckResult[] {
  const out: CheckResult[] = [];
  const set = show.performance;
  const owned = zoneShapes(set.zones, show.shapes);
  const clipById = new Map(set.clips.map(c => [c.id, c]));
  const zoneName = (i: number) => set.zones[i]?.name || `Zone ${i + 1}`;

  const clipsIn = (zone: number): Clip[] => {
    const seen = new Map<string, Clip>();
    for (const s of set.scenes) { const c = clipById.get(s.cells[zone] ?? ''); if (c) seen.set(c.id, c); }
    return [...seen.values()];
  };

  set.zones.forEach((zone, i) => {
    const clips = clipsIn(i);
    if (!zone.target) {
      out.push(clips.length
        ? { level: 'error', zone: i, message: `${zoneName(i)} has no place on the wall, so its clips will never show. Choose a group or shape for it.` }
        : { level: 'warning', zone: i, message: `${zoneName(i)} has no place on the wall yet, so it stays black.` });
      return;
    }
    if (owned[i].length === 0) out.push({ level: 'warning', zone: i, message: `${zoneName(i)} points at a place with no shapes left in it, so it stays black.` });
    if (clips.length === 0) out.push({ level: 'warning', zone: i, message: `${zoneName(i)} has no clips in any scene, so it stays black.` });
  });

  const claimed = new Set(owned.flat());
  for (const s of show.shapes) {
    if (s.blocker || !isShapeShown(show, s) || claimed.has(s.id)) continue;
    out.push({ level: 'warning', zone: null, message: `Shape "${s.name}" is not in any zone, so it stays black during the show.` });
  }

  for (const sc of set.scenes) {
    const n = new Set(sc.cells.map(id => clipById.get(id ?? '')?.sourceId).filter((id): id is string => !!id)).size;
    if (n > MAX_RENDERERS) out.push({ level: 'error', zone: null, message: `Scene "${sc.name}" needs ${n} looks at once, and the projector can only draw ${MAX_RENDERERS}. Remove some clips from it.` });
  }

  const barMs = BEATS_PER_BAR * 60000 / (stats.bpm && stats.bpm > 0 ? stats.bpm : DEFAULT_BPM);
  for (const [clipId, ms] of Object.entries(stats.prepareMs ?? {})) {
    const clip = clipById.get(clipId);
    if (!clip || !(ms > barMs)) continue;
    const zone = set.zones.findIndex((_, z) => clipsIn(z).some(c => c.id === clipId));
    out.push({ level: 'warning', zone: zone >= 0 ? zone : null, message: `${clip.name} takes too long to get ready (${(ms / 1000).toFixed(1)} s, more than one bar), so it may miss its launch. Pick a lighter look.` });
  }

  set.zones.forEach((zone, i) => {
    for (const clip of clipsIn(i)) {
      const layers = show.sources.find(s => s.id === clip.sourceId)?.project.layers ?? [];
      const kind = FAST_KINDS.find(k => layers.some(l => l.kind === k));
      if (!kind) continue;
      out.push(zone.protected
        ? { level: 'warning', zone: i, message: `${clip.name} in ${zoneName(i)} is ${KIND_NAMES[kind]}, whose fine detail is likely to shimmer on the mesh, and it also flickers fast. Try a slower look.` }
        : { level: 'warning', zone: i, message: `${clip.name} in ${zoneName(i)} is ${KIND_NAMES[kind]}, which flashes fast inside the look. Check it by eye before a public show.` });
    }
    if (!zone.protected) return;
    for (const id of owned[i]) {
      const s = show.shapes.find(x => x.id === id);
      if (s && !s.blocker && s.softEdge === 0) out.push({ level: 'warning', zone: i, message: `Shape "${s.name}" in ${zoneName(i)} has no soft edge, so its edge will look hard on the mesh. Give it a soft edge in Map.` });
    }
  });

  if (stats.midiInputs) {
    const used = new Set(stats.midiInputs);
    for (const l of show.links) if (used.has(l.input)) out.push({ level: 'warning', zone: null, message: `Link "${l.name || l.target}" listens to a control the MIDImix layout also uses, so moving that control does both.` });
    for (const t of show.triggers) if (used.has(t.input)) out.push({ level: 'warning', zone: null, message: `A trigger (${t.action.kind}) listens to a control the MIDImix layout also uses, so pressing it does both.` });
  } else out.push({ level: 'warning', zone: null, message: 'MIDI clashes are not checked until the MIDImix is set up.' });

  const untimed = set.clips.filter(c => stats.prepareMs?.[c.id] === undefined).length;
  if (untimed > 0) out.push({ level: 'warning', zone: null, message: `${untimed} ${untimed === 1 ? 'look has' : 'looks have'} not been timed yet. A rehearsal run will time them.` });

  out.push({ level: 'warning', zone: null, message: REMINDER });
  return out;
}
