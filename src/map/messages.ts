import type { Project } from '../shared/types';
import { MIDIMIX_MAP, midimixInputs } from '../morphogen/midimix-map';
import { MAX_ID_LENGTH, MAX_SHAPES, usesLive, type CurvePoint, type Point, type ShowDocument, type WireShow } from './show';
import { shapeValidity } from './outline';
import { EMBER_SMOKE_INPUTS } from '../react/ember-smoke';
import { acceptSignals, type Signals } from '../react/signals';
import { wallGuardPolicy } from '../meridian/wall-guard';
import { ownCornersPinnable } from './placement';
import type { LiveSettings } from '../live/settings';
import { clipSourceIds } from '../perform/set';
import type { ZonePicture } from '../perform/resolve';
import { ZONE_COUNT } from '../perform/types';
import type { PerformValues, WallLaunch } from '../perform/wall-perform';

export type MapMessage =
  /** fadeMs: this show is a scene switch, crossfading over that long. */
  | { type: 'show'; show: WireShow; fadeMs?: number }
  /** One source's composition, sent once per revision. crossfade: a draft applied during a show, held until ready and then faded in. */
  | { type: 'source'; id: string; revision: number; project: Project; crossfade?: true }
  | { type: 'blackout'; on: boolean }
  | { type: 'testGrid'; on: boolean }
  | { type: 'freeze'; on: boolean }
  | { type: 'identify'; shapeId: string | null }
  | { type: 'crosshair'; point: Point | null; shapeId: string | null }
  /** Only these shapes reach the wall; none means no solo. Not saved. */
  | { type: 'solo'; ids: string[] }
  /** What sound, the beat, tempo and MIDI are doing, once a frame while something reacts. */
  | { type: 'signals'; signals: Signals }
  /** The next show change is a scene switch: its crossfade takes this long. */
  | { type: 'fade'; ms: number }
  /** Live in Map: the Live screen's settings (null: the show no longer uses Live), and its Clear and Capture empty room. */
  | { type: 'liveSettings'; settings: unknown }
  | { type: 'liveClear' }
  | { type: 'liveCaptureRoom' }
  /** Open Live's camera again (after it was unplugged, or refused and then allowed). */
  | { type: 'liveRetry' }
  /** Stage 6: every video that cannot play loads again. */
  | { type: 'videoRetry' }
  /** Perform: a show starts over the Map show, or ends and hands the wall back. */
  | { type: 'performStart'; zones: ZonePicture[]; phaseOffsets?: Record<string, number> }
  | { type: 'performEnd' }
  /** The sources to keep warm off-screen. */
  | { type: 'performArm'; sourceIds: string[] }
  /** An exact-time launch. The same id replaces it. */
  | { type: 'performLaunch'; launch: WallLaunch }
  | { type: 'performCancel'; launchId: string }
  /** Per-frame brightness, hue, speed and master. */
  | { type: 'performValues'; values: PerformValues }
  /** A show file was opened: linked Meridian moves from before it end. A scene change never sends this. */
  | { type: 'performanceReset' }
  /** Installation mode: whether Meridian's autopilot steers Evolve on the wall, and its pace in beats. */
  | { type: 'installation'; autopilot: boolean; everyBeats: number };

/** Live's settings travel under the same limit as on Live's own output. */
export const LIVE_SETTINGS_LIMIT = 16 * 1024;

/**
 * Map's own limit, larger than Live's 16 KB settings cap: the largest valid show (64 shapes of 32 curve points with
 * both handles, names, ids and groups at their limits) is about 360 KB at full precision, so a valid show is never
 * refused. Tested.
 */
export const MAP_MESSAGE_LIMIT = 512 * 1024;
/** A frame of signals is small; anything larger is refused. */
export const SIGNALS_LIMIT = 16 * 1024;
/**
 * A composition can hold up to four layers, each with an image and a mask of up to 20 MB (Studio's MAX_ASSET_BYTES),
 * stored as text about a third larger: so its message has its own, much larger limit.
 */
export const SOURCE_MESSAGE_LIMIT = 256 * 1024 * 1024;

/** Four decimal places of a stage fraction: 0.2 projector pixels at 1920 wide. */
const WIRE_PLACES = 1e4;
const roundForWire = (value: number) => Math.round(value * WIRE_PLACES) / WIRE_PLACES;
const roundPoint = (p: CurvePoint): CurvePoint => {
  const q: CurvePoint = { x: roundForWire(p.x), y: roundForWire(p.y) };
  if (p.in) q.in = { x: roundForWire(p.in.x), y: roundForWire(p.in.y) };
  if (p.out) q.out = { x: roundForWire(p.out.x), y: roundForWire(p.out.y) };
  return q;
};

/**
 * The show as sent to the wall: corners rounded to four decimal places, which keeps each message small, and the
 * sources without their compositions (those travel once per revision, see sourcesToSend).
 * Used on the send path only; the show the editor holds and saves keeps full precision.
 */
export function toWire(show: ShowDocument): WireShow {
  return {
    format: show.format, version: show.version, stage: show.stage,
    shapes: show.shapes.map(shape => {
      const rounded = { ...shape, points: shape.points.map(roundPoint), holes: shape.holes.map(h => h.map(roundPoint)) };
      // Rounding moves points by up to 0.1 projector pixels; a shape that would then touch itself goes as it is.
      return shapeValidity(rounded.points, rounded.holes).ok && ownCornersPinnable(rounded) === ownCornersPinnable(shape) ? rounded : shape;
    }),
    sources: show.sources.map(({ id, kind, speed, revision, tempoSync, followOutline }) => ({ id, kind, speed, revision, tempoSync, ...(followOutline ? { followOutline } : {}) })),
    links: show.links,
    groups: show.groups,
    // Not rounded: a pinnable quad at the edge of the rules could round to one that is not.
    stageCorners: show.stageCorners,
    usesLive: usesLive(show),
    // Only when true, so what a show without Meridian sends is unchanged.
    ...(wallGuardPolicy(show.sources.map(s => s.project)).on ? { guardWall: true } : {}),
    videos: show.videos,
    clipSourceIds: clipSourceIds(show.performance),
  };
}

/**
 * The composition messages an output still needs, given the revisions it has already been sent.
 * Pure: returns the record to keep. A new output starts from an empty record, so it is sent everything.
 */
export function sourcesToSend(show: ShowDocument, sent: ReadonlyMap<string, number>): { messages: MapMessage[]; sent: Map<string, number> } {
  const messages: MapMessage[] = [];
  const next = new Map<string, number>();
  for (const source of show.sources) {
    if (sent.get(source.id) !== source.revision) messages.push({ type: 'source', id: source.id, revision: source.revision, project: source.project });
    next.set(source.id, source.revision);
  }
  return { messages, sent: next };
}

// A copy of this check runs in the main process (electron/map.cjs); tests/map-messages.test.ts keeps the two in step.
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const within = (value: unknown, limit: number): boolean => { try { const text = JSON.stringify(value); return typeof text === 'string' && text.length < limit; } catch { return false; } };
const idOrNull = (value: unknown) => value === null || typeof value === 'string';
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/** Perform's limits: at most 8 armed sources (the renderer budget); a launch id is a clip-sized id plus ":ceiling", with room to spare. */
const PERFORM_ARMED_LIMIT = 8;
const LAUNCH_ID_LIMIT = 128;
const BAR_MS_LIMIT = 60000;
const BLEND_MS_LIMIT = 3600000;
const BLEND_KINDS: unknown[] = ['cut', 'fade', 'dip', 'dissolve'];
// Array.from first: every() skips the holes of a sparse array, and structured clone keeps them.
const listOf = (value: unknown, limit: number, check: (item: unknown) => boolean) => Array.isArray(value) && value.length <= limit && Array.from(value).every(item => check(item));
const sized = (value: unknown, limit: number) => typeof value === 'string' && value !== '' && value.length <= limit;
const performId = (value: unknown) => sized(value, MAX_ID_LENGTH);
const performIdOrNull = (value: unknown) => value === null || performId(value);
const zoneIndex = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) < ZONE_COUNT;
const everyZone = (value: unknown, check: (item: unknown) => boolean) => Array.isArray(value) && value.length === ZONE_COUNT && listOf(value, ZONE_COUNT, check);
const acceptPicture = (z: unknown) => plain(z) && listOf(z.shapeIds, MAX_SHAPES, performId) && performIdOrNull(z.sourceId) && typeof z.launched === 'boolean';
const acceptBlend = (b: unknown) => plain(b) && BLEND_KINDS.includes(b.kind) && finite(b.durationMs) && (b.durationMs as number) >= 0 && (b.durationMs as number) <= BLEND_MS_LIMIT;
const acceptChange = (c: unknown) => plain(c) && zoneIndex(c.zone) && performIdOrNull(c.sourceId) && listOf(c.shapeIds, MAX_SHAPES, performId) && acceptBlend(c.blend) && finite(c.phaseOffsetBeats);
const acceptLaunch = (l: unknown) => plain(l) && sized(l.id, LAUNCH_ID_LIMIT) && finite(l.atMs) && finite(l.barMs) && (l.barMs as number) >= 1 && (l.barMs as number) <= BAR_MS_LIMIT
  && listOf(l.changes, ZONE_COUNT, acceptChange) && new Set((l.changes as { zone: number }[]).map(c => c.zone)).size === (l.changes as unknown[]).length;
const acceptValueZone = (z: unknown) => plain(z) && finite(z.brightness) && finite(z.hueDeg) && finite(z.speed);
const acceptValues = (v: unknown) => plain(v) && finite(v.master) && everyZone(v.zones, acceptValueZone);
// At most one offset per zone's source. Object.entries reads own keys only, so __proto__ is checked like any other id.
const acceptOffsets = (o: unknown) => o === undefined || (plain(o) && Object.keys(o).length <= ZONE_COUNT && Object.entries(o).every(([id, beats]) => performId(id) && finite(beats)));

/** Checks the envelope and size only. The show's geometry and a composition's contents are checked where they are used. */
export function acceptMapMessage(value: unknown): value is MapMessage {
  if (!plain(value)) return false;
  if (!within(value, value.type === 'source' ? SOURCE_MESSAGE_LIMIT : MAP_MESSAGE_LIMIT)) return false;
  switch (value.type) {
    case 'show': return plain(value.show) && (value.fadeMs === undefined || (finite(value.fadeMs) && (value.fadeMs as number) >= 0 && (value.fadeMs as number) <= 30000));
    case 'source': return typeof value.id === 'string' && value.id !== '' && Number.isInteger(value.revision) && (value.revision as number) >= 0 && plain(value.project) && (value.crossfade === undefined || value.crossfade === true);
    case 'blackout':
    case 'testGrid':
    case 'freeze': return typeof value.on === 'boolean';
    case 'identify': return idOrNull(value.shapeId);
    case 'crosshair': return idOrNull(value.shapeId) && (value.point === null || (plain(value.point) && finite(value.point.x) && finite(value.point.y)));
    case 'solo': return Array.isArray(value.ids) && value.ids.every(id => typeof id === 'string');
    case 'signals': return within(value, SIGNALS_LIMIT) && acceptSignals(value.signals);
    case 'fade': return finite(value.ms) && (value.ms as number) >= 0 && (value.ms as number) <= 30000;
    case 'liveSettings': return (value.settings === null || plain(value.settings)) && within(value, LIVE_SETTINGS_LIMIT);
    case 'liveClear': case 'liveCaptureRoom': case 'liveRetry': case 'videoRetry': case 'performanceReset': return true;
    case 'installation': return typeof value.autopilot === 'boolean' && finite(value.everyBeats) && (value.everyBeats as number) >= 16 && (value.everyBeats as number) <= 128;
    case 'performStart': return everyZone(value.zones, acceptPicture) && acceptOffsets(value.phaseOffsets);
    case 'performEnd': return true;
    case 'performArm': return listOf(value.sourceIds, PERFORM_ARMED_LIMIT, performId);
    case 'performLaunch': return acceptLaunch(value.launch);
    case 'performCancel': return sized(value.launchId, LAUNCH_ID_LIMIT);
    case 'performValues': return acceptValues(value.values);
    default: return false;
  }
}

/** `tempo.external` is set by the operator window when the tempo comes from MIDI, tap or a fixed number. */
const MERIDIAN_INPUTS = ['audio.bass', 'audio.mids', 'audio.highs', 'audio.level', 'beat.pulse', 'tempo.bpm', 'tempo.external'];

/**
 * The signals the wall needs each frame: what Map's links listen to, the tempo (for tempo sync), and, while the show
 * plays Live, what Live's own links listen to. During a Perform show also the tempo's speed: a video locked to the
 * tempo plays at a rate worked out from it, and the zone's speed knob only works when the wall knows it.
 */
export function wallInputs(show: ShowDocument, live: LiveSettings | null, perform = false): Set<string> {
  const inputs = new Set<string>(['tempo.beat', 'tempo.phase', ...show.links.map(l => l.input)]);
  if (perform) inputs.add('tempo.bpm');
  if (live && usesLive(show)) for (const l of live.links) inputs.add(l.input);
  if (live?.look === 'morphogen' && usesLive(show)) for (const input of midimixInputs(MIDIMIX_MAP)) inputs.add(input);
  if (show.sources.some(s => s.project.layers.some(l => l.visible && l.kind === 'scope' && l.params.scopeMode === 1))) for (const input of EMBER_SMOKE_INPUTS) inputs.add(input);
  // Meridian follows the music on the wall as it does in Studio, so it needs the sound and the tempo's source.
  if (show.sources.some(s => s.project.layers.some(l => l.visible && l.kind === 'meridian'))) for (const input of MERIDIAN_INPUTS) inputs.add(input);
  return inputs;
}
