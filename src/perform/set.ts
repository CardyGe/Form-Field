/** The Perform set: created empty, and checked field by field when a show is opened (as validateShow does for the rest). */
import { ZONE_COUNT, MAX_PERFORM_SCENES, type Blend, type Clip, type PerformanceSet, type Quantize, type Scene, type Zone } from './types';

const MAX_ID = 64, MAX_NAME = 40, MAX_BARS = 32, MAX_CLIPS = 256;
const QUANTIZES: readonly Quantize[] = ['1/4', '1/2', '1bar', '2bar', '4bar'];
const BLEND_KINDS = ['cut', 'fade', 'dip', 'dissolve'] as const;
const BANDS = ['bass', 'mid', 'high', 'level'] as const;
const AFTER_BARS = [4, 8, 16, 32] as const;
const FOLLOW_WORDS = ['next', 'previous', 'first', 'random'];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const goodId = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= MAX_ID;
const cleanName = (v: unknown, fallback: string) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_NAME) : fallback;

export function createPerformanceSet(): PerformanceSet {
  const zones: Zone[] = Array.from({ length: ZONE_COUNT }, (_, i) => ({ id: `zone-${i + 1}`, name: i === ZONE_COUNT - 1 ? 'Ceiling' : `Zone ${i + 1}`, target: null, protected: i === ZONE_COUNT - 1 }));
  return { zones, scenes: [], clips: [], launchQuantize: '1bar' };
}

function readZone(raw: unknown, fallback: Zone): { zone: Zone; repaired: boolean } {
  if (!isRecord(raw)) return { zone: fallback, repaired: true };
  const id = goodId(raw.id) ? raw.id : fallback.id;
  const name = cleanName(raw.name, fallback.name);
  const t = raw.target;
  const target = isRecord(t) && (t.kind === 'group' || t.kind === 'shape') && goodId(t.id) ? { kind: t.kind as 'group' | 'shape', id: t.id } : null;
  const prot = typeof raw.protected === 'boolean' ? raw.protected : fallback.protected;
  const zone: Zone = { id, name, target, protected: prot };
  return { zone, repaired: id !== raw.id || name !== raw.name || (raw.target !== null && raw.target !== undefined && target === null) || prot !== raw.protected };
}

function readBlend(raw: unknown): { blend: Blend | null; repaired: boolean } {
  if (raw === null || raw === undefined) return { blend: null, repaired: false };
  if (!isRecord(raw) || !BLEND_KINDS.includes(raw.kind as never) || typeof raw.bars !== 'number' || !Number.isFinite(raw.bars) || raw.bars < 0 || raw.bars > MAX_BARS) return { blend: null, repaired: true };
  return { blend: { kind: raw.kind as Blend['kind'], bars: raw.bars }, repaired: false };
}

function readClip(raw: unknown, known: ReadonlySet<string>): { clip: Clip; repaired: boolean } | null {
  if (!isRecord(raw) || !goodId(raw.id) || !goodId(raw.sourceId) || !known.has(raw.sourceId)) return null;
  const hue = typeof raw.hueOffset === 'number' && Number.isFinite(raw.hueOffset) ? ((raw.hueOffset % 360) + 360) % 360 : 0;
  const band = BANDS.includes(raw.audioBand as never) ? raw.audioBand as Clip['audioBand'] : 'level';
  const blend = readBlend(raw.blend);
  const name = cleanName(raw.name, 'Clip');
  return { clip: { id: raw.id, name, sourceId: raw.sourceId, hueOffset: hue, blend: blend.blend, audioBand: band }, repaired: hue !== raw.hueOffset || band !== raw.audioBand || blend.repaired || name !== raw.name };
}

function readFollow(raw: unknown, sceneIds: ReadonlySet<string>): { follow: Scene['follow']; repaired: boolean } {
  if (raw === null || raw === undefined) return { follow: null, repaired: false };
  if (!isRecord(raw) || !AFTER_BARS.includes(raw.afterBars as never) || typeof raw.to !== 'string' || !(FOLLOW_WORDS.includes(raw.to) || sceneIds.has(raw.to))) return { follow: null, repaired: true };
  return { follow: { afterBars: raw.afterBars as 4 | 8 | 16 | 32, to: raw.to }, repaired: false };
}

/** Checks a saved set. A clip whose source is gone is dropped, and cells that named it empty out. Anything unreadable falls back to the default. */
export function validatePerformanceSet(value: unknown, knownSourceIds: ReadonlySet<string>): { set: PerformanceSet; repaired: boolean } {
  const set = createPerformanceSet();
  if (!isRecord(value)) return { set, repaired: value !== undefined };
  let repaired = false;

  if (Array.isArray(value.zones) && value.zones.length === ZONE_COUNT) {
    const seen = new Set<string>();
    set.zones = value.zones.map((raw, i) => {
      const r = readZone(raw, set.zones[i]);
      if (r.repaired) repaired = true;
      if (seen.has(r.zone.id)) { repaired = true; r.zone.id = set.zones[i].id; }
      seen.add(r.zone.id);
      return r.zone;
    });
  } else if (value.zones !== undefined) repaired = true;

  if (QUANTIZES.includes(value.launchQuantize as Quantize)) set.launchQuantize = value.launchQuantize as Quantize;
  else if (value.launchQuantize !== undefined) repaired = true;

  const clips = new Map<string, Clip>();
  if (Array.isArray(value.clips)) {
    for (const raw of value.clips) {
      if (clips.size >= MAX_CLIPS) { repaired = true; break; }
      const r = readClip(raw, knownSourceIds);
      if (!r || clips.has(r.clip.id)) { repaired = true; continue; }
      if (r.repaired) repaired = true;
      clips.set(r.clip.id, r.clip);
    }
  } else if (value.clips !== undefined) repaired = true;
  set.clips = [...clips.values()];

  const rawScenes = Array.isArray(value.scenes) ? value.scenes : [];
  if (value.scenes !== undefined && !Array.isArray(value.scenes)) repaired = true;
  if (rawScenes.length > MAX_PERFORM_SCENES) repaired = true;
  const kept = rawScenes.slice(0, MAX_PERFORM_SCENES);
  const sceneIds = new Set<string>();
  for (const raw of kept) if (isRecord(raw) && goodId(raw.id)) sceneIds.add(raw.id);
  const seenScenes = new Set<string>();
  for (const raw of kept) {
    if (!isRecord(raw) || !goodId(raw.id) || seenScenes.has(raw.id)) { repaired = true; continue; }
    seenScenes.add(raw.id);
    const rawCells = Array.isArray(raw.cells) ? raw.cells : [];
    if (rawCells.length !== ZONE_COUNT) repaired = true;
    const cells = Array.from({ length: ZONE_COUNT }, (_, i) => {
      const c = rawCells[i];
      if (typeof c === 'string' && clips.has(c)) return c;
      if (c !== null && c !== undefined) repaired = true;
      return null;
    });
    const follow = readFollow(raw.follow, sceneIds);
    if (follow.repaired) repaired = true;
    const name = cleanName(raw.name, `Scene ${set.scenes.length + 1}`);
    const includeProtected = raw.includeProtected === true;
    if (name !== raw.name || includeProtected !== raw.includeProtected) repaired = true;
    set.scenes.push({ id: raw.id, name, cells, includeProtected, follow: follow.follow });
  }
  // A scene that follows a row that was dropped has nowhere to go.
  for (const sc of set.scenes) if (sc.follow && !FOLLOW_WORDS.includes(sc.follow.to) && !seenScenes.has(sc.follow.to)) { sc.follow = null; repaired = true; }
  return { set, repaired };
}

/** The ids of the sources clips play: these stay in the show even when no shape plays them. */
export function clipSourceIds(set: PerformanceSet): string[] {
  return [...new Set(set.clips.map(c => c.sourceId))];
}
