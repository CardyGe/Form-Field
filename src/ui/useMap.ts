import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditAction } from '../map/editor';
import { applyStudioEdit, initialMapState, mapReducer, type MapState } from '../map/state';
import type { Project } from '../shared/types';
import { autosaveSchedule, canEdit } from '../map/autosave';
import { acceptMapMessage, sourcesToSend, toWire, wallInputs, type MapMessage } from '../map/messages';
import { installationMessage, logFault, saveInstallation, useInstallation } from './installation';
import { installationDisplay } from './installation-display';
import { useLiveSettings } from './useLiveSettings';
import type { LiveSettings } from '../live/settings';
import { createShow, usesLive, validateShow, type ShowDocument } from '../map/show';
import { reactivity, type ReactivityEngine } from '../react/engine';
import { fire, type TriggerAction } from '../react/links';
import type { Signals } from '../react/signals';
import { MeterStore } from '../react/meter';
import { heardSignals, onlySignals } from '../live/heard';
import { showReacts } from './show-reacts';
import { autoAdvanceDue, nextAutoScene } from '../map/wild';
import { linkPerformToMap, performService, type PerformService } from '../perform/service';
import { clipsInUse, historyBlock, placeClip, savedShow, zonesSharingSource, type HistoryBlock } from '../perform/grid-edit';
import type { Clip } from '../perform/types';
import type { SwapResult } from '../map/compositor';
import { validateLiveSettings } from '../live/settings';

export { showReacts };

export type MapTool = 'select' | 'rectangle' | 'triangle' | 'ellipse' | 'pen';
/** The shapes soloed, directly or through their group, that are still in the show. */
export function soloIds(show: ShowDocument, solo: { shapes: string[]; groups: string[] }): string[] {
  return show.shapes.filter(s => solo.shapes.includes(s.id) || (s.groupId !== null && solo.groups.includes(s.groupId))).map(s => s.id);
}

export interface Display { id: number; label: string; primary: boolean }

const TOO_LARGE = 'This show is too large to send to the wall. The wall keeps its last show.';
const TOO_LARGE_SOURCE = 'A composition is too large to send to the projector, so its shape keeps what the projector already had, or its colour.';
export const SAVE_FAILED = 'Could not save — keep working, then use Save As';
const DAMAGED = 'That file could not be read. Nothing was changed.';
const SCENES_PAUSED = 'Map scenes are paused while a Perform show is running. They work again after End show.';
const UNDO_PLAYING = 'That undo would remove a clip the show is playing. End the show first.';
const UNDO_LAYOUT = 'That undo would change the zones or scenes the show is using. End the show first.';
const OPEN_PAUSED = 'End the Perform show before opening another show file.';
/** Everything on Map's scene bar: none of it changes while a show runs. */
const SCENE_BAR_EDITS: ReadonlySet<EditAction['type']> = new Set(['addScene', 'renameScene', 'deleteScene', 'setSceneFade', 'switchScene', 'setAutoAdvance']);
const HISTORY_NOTES: Record<HistoryBlock, string> = { scenes: SCENES_PAUSED, layout: UNDO_LAYOUT, playing: UNDO_PLAYING, picture: 'That undo would change the running picture. End the show first.' };
/** The wall holds a show's last looks through its handover (two seconds at most, then a short fade). */
const AFTER_HANDOVER_MS = 3000;
/** Why an undo or redo to this show cannot happen during a show, or null. */
function showBlocksHistory(now: ShowDocument, target: ShowDocument | undefined): string | null {
  const service = performService();
  if (!service.running || !target) return null;
  const blocked = historyBlock(now, target, clipsInUse(service.view().launcher));
  return blocked && HISTORY_NOTES[blocked];
}
const fileName = (file: string) => file.split(/[\\/]/).pop() || file;
/** How many shapes in a file did not survive validation. */
const leftOut = (raw: unknown, show: ShowDocument): number => {
  const shapes = raw && typeof raw === 'object' ? (raw as { shapes?: unknown }).shapes : undefined;
  return Array.isArray(shapes) ? Math.max(0, shapes.length - show.shapes.length) : 0;
};
const isDamaged = (value: unknown) => !!value && typeof value === 'object' && (value as { damaged?: unknown }).damaged === true && !('shapes' in value);

/**
 * One Map session per window. It outlives the Map screen, so leaving Map and coming back keeps the shapes
 * and the undo history, and a save that keeps failing still refuses the close after the screen has gone.
 */
interface Session {
  state: MapState;
  loaded: boolean;
  saveFailed: boolean;
  /** Writes the show when it has been still for half a second; the show is turned into text only then. */
  saver: ReturnType<typeof autosaveSchedule<ShowDocument>>;
  /** The screen showing the session, told when a save fails or recovers; null while Map is not shown. */
  onSaveResult: ((failed: boolean) => void) | null;
  /** Whether the wall's window is open, and which composition revisions it has been sent (emptied when it opens). */
  outputOpen: boolean;
  sentSources: Map<string, number>;
  /** The wall's switches, kept here so they survive leaving Map while the wall stays open. */
  blackout: boolean;
  /** Not saved: every launch starts with the guard on. */
  flashGuard: boolean;
  testGrid: boolean;
  freeze: boolean;
  /**
   * A composition being edited in Studio: the wall stays open and follows the edits. A draft (begun during a show)
   * holds its changes in `latest` instead, and neither the show nor the wall hears of them until Apply.
   */
  studioEdit: { sourceId: string; shapeId: string; first: boolean; draft: boolean; latest: Project | null; name: string; copy?: PendingCopy } | null;
  /** A draft applied to each source and not yet answered by the wall: at most one per source, so a rollback is always to the look on the wall. */
  applied: Map<string, { revision: number; before: { project: Project; revision: number }; pushed: ShowDocument; show: ShowDocument; project: Project; name: string }>;
  /** Drafts the wall could not start, waiting to be opened again so their work is not lost. */
  failedDrafts: { sourceId: string; project: Project; name: string }[];
  onDraftFailed: (() => void) | null;
  /** Told when an Apply stops waiting on the wall, with a note when the operator needs one. */
  onApplySettled: ((note: string | null) => void) | null;
  /** How many Map screens are mounted (React may mount one twice in development). */
  mounted: number;
  /** A Studio edit waiting to reach the wall at the next frame (edits come faster than frames while a slider moves). */
  wallFrame: number | null;
  /** Told when a Studio edit could not reach the wall. */
  onStudioWarning: ((text: string) => void) | null;
  /** Solo: shapes and groups soloed. Not saved, not an undo step; kept while the app is open. */
  solo: { shapes: string[]; groups: string[] };
  /** Snap, and whether the trace-over photo is shown on this screen. */
  snap: boolean;
  photoShown: boolean;
  /** Live's settings as last known, so a running show can resend them while Map is not shown. */
  live: LiveSettings | null;
  /** A show ended with the wall open: it stays open, on Map's picture, until the operator closes it. */
  wallHeld: boolean;
  /** The screen showing the session, told when the session's state is tidied without an edit. */
  onStateTidied: ((state: MapState) => void) | null;
}
/** Duplicate and edit during a show: the copy to make at Apply, so a Discard leaves the show exactly as it was. */
export interface ClipCopy { fromSourceId: string; sourceId: string; clip: Clip; row: number; zone: number }
type PendingCopy = ClipCopy & { sceneId: string; replaces: string | null };
let session: Session | null = null;
function mapSession(): Session {
  if (session) return session;
  const bridge = window.studio?.map;
  const created: Session = {
    state: initialMapState(createShow()), loaded: false, saveFailed: false, onSaveResult: null,
    outputOpen: false, sentSources: new Map(), blackout: false, flashGuard: true, testGrid: false, freeze: false, studioEdit: null, applied: new Map(), failedDrafts: [], onDraftFailed: null, onApplySettled: null, mounted: 0, wallFrame: null, onStudioWarning: null,
    solo: { shapes: [], groups: [] }, snap: true, photoShown: true, live: null, wallHeld: false, onStateTidied: null,
    saver: autosaveSchedule<ShowDocument>(async show => {
      if (!bridge) return;
      // A failed write is reported, never swallowed: the operator keeps working and can Save As.
      try { await bridge.saveAutosave(JSON.stringify(savedShow(show))); created.saveFailed = false; created.onSaveResult?.(false); }
      catch (error) { created.saveFailed = true; created.onSaveResult?.(true); throw error; }
    }, 500),
  };
  // Registered once for the window's life: closing must not lose an edit made in the last half second,
  // and a save that fails refuses the close, with a message, even when Map is not on screen.
  if (bridge) window.studio?.onBeforeClose(async () => {
    try { await created.saver.flush(); }
    catch { created.saveFailed = true; created.onSaveResult?.(true); throw new Error('The Map show could not be saved. Open Map and use Save As to keep it.'); }
  });
  // Followed for the window's life, so the session knows whether the wall is open even while Map is not shown.
  // A wall that opens or reloads during a show is told the show again from here, whichever section is on screen.
  bridge?.onOutputChanged(open => { created.outputOpen = open; wallChanged(created, open); if (!open) created.wallHeld = false; if (open) { created.sentSources = new Map(); performService().wallReopened(); } });
  bridge?.onState(state => { performService().wallState(state); for (const result of state.swapResults ?? []) swapAnswered(created, result); });
  linkPerformToMap({
    send: message => bridge?.send(message),
    isOpen: () => created.outputOpen,
    sendWholeShow: () => sendWholeShow(created),
    show: () => created.state.show,
    live: () => created.live,
  });
  session = created;
  return created;
}

/** Everything the wall needs to draw the show, in the order a newly opened wall takes it. Works with Map not on screen. */
function sendWholeShow(s: Session): void {
  const bridge = window.studio?.map;
  if (!s.outputOpen || !bridge) return;
  bridge.send({ type: 'blackout', on: s.blackout });
  bridge.send({ type: 'testGrid', on: s.testGrid });
  bridge.send({ type: 'freeze', on: s.freeze });
  bridge.send({ type: 'solo', ids: soloIds(s.state.show, s.solo) });
  const live: MapMessage = { type: 'liveSettings', settings: usesLive(s.state.show) ? s.live : null };
  if (acceptMapMessage(live as unknown)) bridge.send(live);
  pushToWall(s, s.state.show);
}

/** The Map session for the Perform service, with Live's settings read, so a show can run before Map has been opened. */
export function performSession(): PerformService {
  const s = mapSession();
  if (!s.live) void window.studio?.live?.loadSettings().then(saved => { s.live ??= validateLiveSettings(saved); }).catch(() => {});
  return performService();
}

/** Ends the show. An open wall stays open on Map's own picture, whichever section is on screen, until it is closed. */
export function endPerformShow(): void {
  const s = mapSession(), service = performService();
  if (!service.running) return;
  s.wallHeld = s.outputOpen;
  service.endShow();
  // Clips only the show was still holding go once the wall has finished handing over, so its last picture is not pulled away.
  // One timer: a later Start or End replaces it, so it can never land in another show's handover.
  clearShowEndTimer();
  showEndTimer = setTimeout(() => { showEndTimer = null; dropShowOnlyClips(s); }, s.outputOpen ? AFTER_HANDOVER_MS : 0);
}
let showEndTimer: ReturnType<typeof setTimeout> | null = null;
function clearShowEndTimer(): void { if (showEndTimer !== null) clearTimeout(showEndTimer); showEndTimer = null; }
/** Starts the show, and calls off any tidying left from the one before. */
export function startPerformShow(): void {
  mapSession();
  clearShowEndTimer();
  performService().startShow();
}
function dropShowOnlyClips(s: Session): void {
  if (performService().running) return;
  const { state } = s, show = savedShow(state.show), past = state.past.map(savedShow), future = state.future.map(savedShow);
  if (show === state.show && past.every((p, i) => p === state.past[i]) && future.every((f, i) => f === state.future[i])) return;
  s.state = { ...state, show, past, future };
  s.onStateTidied?.(s.state);
}
/** Whether leaving a section must keep the wall open: a show is running, or one has just ended on it. */
export function wallStaysOpen(): boolean { return performService().running || mapSession().wallHeld; }

/** Sends the wall the compositions it lacks, then the show. False when something was too large to send. */
function pushToWall(s: Session, show: ShowDocument): { show: boolean; sources: boolean } {
  const bridge = window.studio?.map;
  const result = { show: true, sources: true };
  if (!s.outputOpen || !bridge) return result;
  const { messages, sent } = sourcesToSend(show, s.sentSources);
  s.sentSources = sent;
  for (const message of messages) { if (acceptMapMessage(message as unknown)) bridge.send(message); else result.sources = false; }
  const message: MapMessage = { type: 'show', show: toWire(show) };
  if (acceptMapMessage(message as unknown)) bridge.send(message); else result.show = false;
  return result;
}

/**
 * Starts editing a shape's composition in Studio. The wall stays open and follows each change.
 * Returns the composition and the shape's name, or null when the shape plays no composition.
 */
export function beginStudioEdit(sourceId: string, shapeId: string, clipName?: string, draft = false): { project: Project; shapeName: string } | null {
  const s = mapSession();
  const source = s.state.show.sources.find(src => src.id === sourceId);
  const shape = s.state.show.shapes.find(sh => sh.id === shapeId);
  // A Perform clip may play on no shape yet: it is named by the clip instead.
  const shapeName = shape?.name ?? clipName;
  if (!source || shapeName === undefined) return null;
  s.studioEdit = { sourceId, shapeId, first: true, draft, latest: null, name: shapeName };
  // The Map screen's crosshair and flash belong to Map: they leave the wall while Studio has it.
  if (s.outputOpen) { window.studio?.map.send({ type: 'crosshair', point: null, shapeId: null }); window.studio?.map.send({ type: 'identify', shapeId: null }); }
  return { project: source.project, shapeName };
}

/** Opens a clip's look in Studio: as a private draft during a show, or editing live, as a Map shape does, without one. */
export function beginClipEdit(sourceId: string, draft: boolean): { project: Project; shapeName: string } | null {
  const clip = mapSession().state.show.performance.clips.find(c => c.sourceId === sourceId);
  return clip ? beginStudioEdit(sourceId, '', clip.name, draft) : null;
}

/** Duplicate and edit during a show: a draft of a copy that does not exist until Apply. */
export function beginClipCopyDraft(copy: ClipCopy): { project: Project; shapeName: string } | null {
  const s = mapSession(), show = s.state.show, source = show.sources.find(x => x.id === copy.fromSourceId), scene = show.performance.scenes[copy.row];
  if (!source || !scene) return null;
  s.studioEdit = { sourceId: copy.sourceId, shapeId: '', first: true, draft: true, latest: null, name: copy.clip.name, copy: { ...copy, sceneId: scene.id, replaces: scene.cells[copy.zone] } };
  if (s.outputOpen) { window.studio?.map.send({ type: 'crosshair', point: null, shapeId: null }); window.studio?.map.send({ type: 'identify', shapeId: null }); }
  return { project: source.project, shapeName: copy.clip.name };
}

/** Whether a draft is open. */
export function clipDraftOpen(): boolean { return !!mapSession().studioEdit?.draft; }
/** Whether the open draft is of a copy that is not in the show yet. */
export function clipDraftIsCopy(): boolean { return !!mapSession().studioEdit?.copy; }
/** The zones an open draft would change: all those sharing its look. */
export function clipDraftZones(): number[] {
  const s = mapSession(), edit = s.studioEdit;
  return edit?.draft && !edit.copy ? zonesSharingSource(s.state.show.performance, edit.sourceId) : [];
}
/** Whether the open draft's look is on the projector now, so that Apply would change the picture. */
export function clipDraftOnWall(): boolean {
  const s = mapSession(), edit = s.studioEdit, service = performService();
  if (!edit?.draft || edit.copy || !service.running) return false;
  const { playing, launched } = service.view().launcher, clips = s.state.show.performance.clips;
  return playing.some((id, zone) => launched[zone] && clips.find(c => c.id === id)?.sourceId === edit.sourceId);
}

/** Told when the wall could not start an applied draft. */
export function onClipDraftFailed(listener: (() => void) | null): void { mapSession().onDraftFailed = listener; }
/** Told when an Apply stops waiting on the wall. */
export function onClipApplySettled(listener: ((note: string | null) => void) | null): void { mapSession().onApplySettled = listener; }
/** Whether the open draft's look has an earlier Apply the wall has not answered yet. */
export function clipApplyStarting(): boolean {
  const s = mapSession(), edit = s.studioEdit;
  return !!edit?.draft && s.applied.has(edit.sourceId);
}

/** The wall's answer to an Apply. An answer for any other revision is out of date and changes nothing. */
function swapAnswered(s: Session, answer: SwapResult): void {
  const applied = s.applied.get(answer.id);
  if (!applied || applied.revision !== answer.revision) return;
  if (answer.result === 'failed') draftFailedOnWall(s, answer);
  else s.applied.delete(answer.id);
  s.onApplySettled?.(answer.result === 'lost' ? 'The projector could not confirm the new look because its graphics restarted. It will try the look again by itself.' : null);
}

/** A wall that closed or reloaded will never answer: nothing may stay waiting on it. */
function wallChanged(s: Session, open: boolean): void {
  if (!s.applied.size) return;
  s.applied.clear();
  s.onApplySettled?.(open ? 'The projector reloaded before the new look started. It will play the new look.' : 'The projector closed before the new look started. It will play the new look when it opens.');
}

/**
 * The wall kept the old look because the applied one could not start. The show goes back to that look with no undo
 * step, so the two agree, and any edit made since stays. The draft's work is kept to be opened again.
 */
function draftFailedOnWall(s: Session, failed: { id: string; revision: number }): void {
  const applied = s.applied.get(failed.id);
  if (!applied || applied.revision !== failed.revision) return;
  s.applied.delete(failed.id);
  const back = (show: ShowDocument): ShowDocument => show.sources.some(x => x.id === failed.id && x.revision === failed.revision)
    ? { ...show, sources: show.sources.map(x => x.id === failed.id ? { ...x, project: applied.before.project, revision: applied.before.revision } : x) } : show;
  const { state } = s;
  const show = state.show === applied.show ? applied.pushed : back(state.show);
  s.state = { ...state, show, past: state.past.filter(p => p !== applied.pushed).map(back), future: state.future.map(back) };
  s.saver.save(show);
  const source = show.sources.find(x => x.id === failed.id);
  if (source && s.outputOpen) {
    window.studio?.map.send({ type: 'source', id: source.id, revision: source.revision, project: source.project });
    s.sentSources = new Map(s.sentSources).set(source.id, source.revision);
  }
  s.onStateTidied?.(s.state);
  s.failedDrafts.push({ sourceId: failed.id, project: applied.project, name: applied.name });
  s.onDraftFailed?.();
}

/** Opens the next draft the wall could not start, with its work in it. Null while another edit is open, or when none is waiting. */
export function reopenFailedDraft(): { sourceId: string; project: Project; shapeName: string; from: 'map' | 'perform' } | null {
  const s = mapSession();
  if (s.studioEdit) return null;
  for (let next = s.failedDrafts.shift(); next; next = s.failedDrafts.shift()) {
    const { sourceId, project, name } = next;
    if (!s.state.show.sources.some(x => x.id === sourceId)) continue;
    s.studioEdit = { sourceId, shapeId: '', first: true, draft: true, latest: project, name };
    return { sourceId, project, shapeName: name, from: s.state.show.performance.clips.some(c => c.sourceId === sourceId) ? 'perform' : 'map' };
  }
  return null;
}

/** Makes the copy a Duplicate and edit draft stands for: one undo step, in the cell it was made from. */
function applyCopyDraft(s: Session, edit: NonNullable<Session['studioEdit']>, copy: PendingCopy): string | null {
  const show = s.state.show, from = show.sources.find(x => x.id === copy.fromSourceId);
  if (!from) return 'that clip is no longer in the set';
  const row = show.performance.scenes.findIndex(x => x.id === copy.sceneId);
  if (row < 0 || show.performance.scenes[row].cells[copy.zone] !== copy.replaces) return 'that cell has changed since the copy was started';
  const performance = placeClip(show.performance, row, copy.zone, copy.clip, clipsInUse(performService().view().launcher));
  const next = mapReducer(s.state, { type: 'edit', action: { type: 'addClipSource', sourceId: copy.sourceId, project: edit.latest ?? structuredClone(from.project), speed: from.speed, tempoSync: from.tempoSync, performance } });
  if (next.show === show) return next.refusal === 'too-many-sources' ? 'the set is full' : STUDIO_REFUSALS[next.refusal ?? ''] ?? next.refusal ?? 'the change could not be made';
  s.state = next;
  s.saver.save(next.show);
  s.onStateTidied?.(next);
  if (!pushToWall(s, next.show).sources) s.onStudioWarning?.('the copy is too large to send to the projector, so it cannot be launched yet');
  s.studioEdit = null;
  return null;
}

/**
 * Puts the open draft into the show: one undo step, and one source update that the wall holds and then crossfades.
 * Returns why it could not, in words, and the draft stays open. A draft with no real change closes and changes nothing.
 */
export function applyClipDraft(): string | null {
  const s = mapSession(), edit = s.studioEdit;
  if (!edit?.draft) return null;
  if (edit.copy) return applyCopyDraft(s, edit, edit.copy);
  const close = () => { s.studioEdit = null; return null; };
  if (edit.latest === null) return close();
  const before = s.state, was = before.show.sources.find(x => x.id === edit.sourceId);
  if (!was) return 'that clip is no longer in the set';
  const next = applyStudioEdit(before, edit.sourceId, edit.latest, true);
  if (next.show === before.show) return STUDIO_REFUSALS[next.refusal ?? ''] ?? next.refusal ?? 'the change could not be made';
  const source = next.show.sources.find(x => x.id === edit.sourceId)!;
  if (JSON.stringify(source.project) === JSON.stringify(was.project)) return close();
  // One Apply at a time for a look, so what the wall is playing is always known. The draft stays open meanwhile.
  if (s.applied.has(source.id)) return 'the last change to this look is still starting';
  const message: MapMessage = { type: 'source', id: source.id, revision: source.revision, project: source.project, crossfade: true };
  // Checked before anything changes, so the show and the wall never disagree.
  if (s.outputOpen && !acceptMapMessage(message as unknown)) return 'the composition is too large to send to the projector';
  s.state = next;
  s.saver.save(next.show);
  s.onStateTidied?.(next);
  if (s.outputOpen) {
    s.applied.set(source.id, { revision: source.revision, before: { project: was.project, revision: was.revision }, pushed: before.show, show: next.show, project: source.project, name: edit.name });
    window.studio?.map.send(message);
    s.sentSources = new Map(s.sentSources).set(source.id, source.revision);
  }
  return close();
}

/** Drops the open draft. The show was never touched, so there is nothing to put back. */
export function discardClipDraft(): void {
  const s = mapSession();
  if (s.studioEdit?.draft) s.studioEdit = null;
}

/** For tests: puts a show into the session, as if it had been loaded. */
export const mapSessionForTest = {
  load(state: MapState): void { const s = mapSession(); s.state = state; s.loaded = true; s.studioEdit = null; s.applied.clear(); s.failedDrafts = []; },
  state: (): MapState => mapSession().state,
  /** The show changes under an open edit. */
  replace(state: MapState): void { mapSession().state = state; },
  markAllSent(): void { const s = mapSession(); s.sentSources = new Map(s.state.show.sources.map(x => [x.id, x.revision])); },
};

/** Why Map could not take a change made in Studio, in words. */
const STUDIO_REFUSALS: Record<string, string> = {
  'too-many-layers': 'a shape\'s composition can have at most four layers',
  'bad-composition': 'the composition could not be read',
  locked: 'the shape is locked in Map',
  'not-found': 'the shape is no longer in the show',
};

/** A change made in Studio to the shape's composition. Returns why it was refused or did not reach the wall, or null. */
export function studioEdit(project: Project): string | null {
  const s = mapSession(), edit = s.studioEdit;
  if (!edit) return null;
  if (edit.draft) { edit.latest = project; return null; }
  const before = s.state;
  s.state = applyStudioEdit(before, edit.sourceId, project, edit.first);
  if (s.state.show === before.show) return STUDIO_REFUSALS[s.state.refusal ?? ''] ?? s.state.refusal;
  edit.first = false;
  s.saver.save(s.state.show);
  // At most once a frame: the latest change goes, earlier ones in the same frame are skipped.
  if (s.wallFrame === null) s.wallFrame = requestAnimationFrame(() => {
    s.wallFrame = null;
    const sent = pushToWall(s, s.state.show);
    if (!sent.sources) s.onStudioWarning?.('the composition is too large to send to the projector, so the projector keeps what it had (the show keeps the change)');
  });
  return null;
}

/** Studio's way to hear that an edit could not reach the projector. */
export function onStudioWallWarning(listener: ((text: string) => void) | null): void { mapSession().onStudioWarning = listener; }

/** Back to Map. */
export function endStudioEdit(): void {
  mapSession().studioEdit = null;
}

/** What the operator screen does with the show: hold it, save it, and keep the wall in step. */
export function useMap(onError: (message: string) => void) {
  const bridge = window.studio?.map;
  const kept = mapSession();
  // The state is advanced through the pure reducer; the ref lets callbacks read it without waiting for a render.
  const stateRef = useRef<MapState>(kept.state);
  const [state, setState] = useState<MapState>(stateRef.current);
  const show = state.show;
  const [loaded, setLoaded] = useState(kept.loaded);
  // The selection: every selected shape, the first being the one whose details and points are shown;
  // the chosen point is selectedIndex of ring selectedRing (-1 the outline, 0 and up its holes).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIds[0] ?? null;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedRing, setSelectedRing] = useState(-1);
  const [tool, setTool] = useState<MapTool>('select');
  const [solo, setSoloState] = useState(kept.solo);
  const [snap, setSnapState] = useState(kept.snap);
  const [photoShown, setPhotoShownState] = useState(kept.photoShown);
  const [lastRefusal, setLastRefusal] = useState<string | null>(null);
  const [sendWarning, setSendWarning] = useState<string | null>(null);
  /** Kept apart from the show's own warning, which every show message clears. */
  const [sourceWarning, setSourceWarning] = useState<string | null>(null);
  /** Goes up every time an output says it is ready, even one that reloaded while already open: it is sent everything. */
  const [outputEpoch, setOutputEpoch] = useState(0);
  const [blackout, setBlackoutState] = useState(kept.blackout);
  const [flashGuard, setFlashGuardState] = useState(kept.flashGuard);
  const [testGrid, setTestGridState] = useState(kept.testGrid);
  const [freeze, setFreezeState] = useState(kept.freeze);
  /** How the wall is keeping up, as it reports once a second while the output is open. */
  const [wallState, setWallState] = useState<import('../map/compositor').CompositorStats | null>(null);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [display, setDisplay] = useState<number | null>(null);
  // The wall may still be open from before (a shape edited in Studio keeps it open).
  const [outputOpen, setOutputOpen] = useState(kept.outputOpen);
  // While a drag is in progress this trial show is drawn and sent to the wall; the held show changes only on release.
  const [preview, setPreview] = useState<ShowDocument | null>(null);
  const shown = preview ?? show;
  const [saveError, setSaveError] = useState<string | null>(kept.saveFailed ? SAVE_FAILED : null);
  const [wallPicture, setWallPicture] = useState<ImageBitmap | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef({ shown, blackout, flashGuard, testGrid, freeze });
  latest.current = { shown, blackout, flashGuard, testGrid, freeze };
  const saver = kept.saver;

  // The saved working show, once per window. A damaged file was already moved aside by the main process, so an empty show is fine.
  useEffect(() => {
    if (kept.loaded) return;
    let cancelled = false;
    void (async () => {
      const saved = await bridge?.loadAutosave().catch(() => null) ?? null;
      if (cancelled || kept.loaded) return;
      const next = validateShow(saved).show;
      kept.state = stateRef.current = mapReducer(stateRef.current, { type: 'load', show: next });
      kept.loaded = true;
      setState(stateRef.current); setLoaded(true);
      const dropped = leftOut(saved, next);
      if (dropped > 0) setNotice(`${dropped} shape${dropped === 1 ? '' : 's'} in the saved show could not be read and ${dropped === 1 ? 'was' : 'were'} left out.`);
    })();
    return () => { cancelled = true; };
  }, []);

  const refreshDisplays = useCallback(async () => {
    const found = await bridge?.displays().catch(() => []) ?? [];
    setDisplays(found);
    setDisplay(current => found.some(d => d.id === current) ? current : (found.find(d => !d.primary) ?? found[0])?.id ?? null);
  }, []);
  useEffect(() => {
    void refreshDisplays();
    if (!bridge) return;
    const offOutput = bridge.onOutputChanged(open => { setOutputOpen(open); if (open) setOutputEpoch(n => n + 1); });
    const offDisplays = bridge.onDisplaysChanged(() => void refreshDisplays());
    // The wall's own picture, for the operator screen. Old pictures are left to the garbage collector,
    // so one still being drawn is never closed under it.
    const offPreview = bridge.onPreview(bytes => {
      void createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })).then(setWallPicture).catch(() => {});
    });
    const offState = bridge.onState(setWallState);
    kept.onSaveResult = failed => setSaveError(failed ? SAVE_FAILED : null);
    kept.onStateTidied = next => { stateRef.current = next; setState(next); };
    kept.mounted++;
    // Leaving Map writes what is waiting. A failure stays recorded in the session and still refuses the close.
    // The wall closes too, unless a shape is being edited in Studio: then it stays open and follows the edits.
    // Decided a moment later: React's development double mount remounts at once, and must not close the wall.
    return () => {
      offOutput(); offDisplays(); offPreview(); offState(); kept.onSaveResult = null; kept.onStateTidied = null; saver.flush().catch(() => {});
      kept.mounted--;
      setTimeout(() => { if (kept.mounted === 0 && !kept.studioEdit && !wallStaysOpen()) void bridge.closeOutput().catch(() => {}); }, 0);
    };
  }, []);
  useEffect(() => { if (!outputOpen) { setWallPicture(null); setWallState(null); } }, [outputOpen]);

  // Installation mode: on launch the last show goes to its projector, and Meridian's autopilot runs on the wall. It opens only on
  // the saved projector (or, with none saved, a display that is not the main screen), and tries again whenever the displays
  // change, so a projector switched on after the Mac is found. Closing the wall by hand is respected until the displays change.
  const installation = useInstallation(), triedDisplays = useRef<Display[] | null>(null);
  const [installationWaiting, setInstallationWaiting] = useState<string | null>(null);
  useEffect(() => { if (outputOpen) bridge?.send(installationMessage()); }, [outputOpen, outputEpoch, installation]);
  useEffect(() => {
    const active = loaded && !!bridge && !!installation?.on && installation.surface === 'map';
    if (!active || outputOpen) { setInstallationWaiting(null); return; }
    const choice = installationDisplay(installation!.display, displays);
    setInstallationWaiting(choice.waiting);
    if (choice.id === null || triedDisplays.current === displays) return;
    triedDisplays.current = displays;
    const id = choice.id;
    void bridge!.openOutput(id).then(() => { if (installation!.display !== id) void saveInstallation({ display: id }).catch(() => {}); })
      .catch(error => { triedDisplays.current = null; logFault(`Installation could not open the wall: ${(error as Error).message}`); });
  }, [loaded, outputOpen, displays, installation]);
  // Faults on the wall go to the installation log, as sentences.
  useEffect(() => {
    if (!wallState) return;
    for (const failing of wallState.failing) logFault(`Map ${failing.id}: ${failing.reason}`);
    if (wallState.flashGuard?.failed) logFault(`Map: flash limiter unavailable: ${wallState.flashGuard.failed}`);
    if (wallState.live?.limiter?.error) logFault(`Map: Live flash limiter unavailable: ${wallState.live.limiter.error}`);
  }, [wallState]);

  // Sends to the wall. During a drag, show and crosshair go at most once per animation frame (the latest wins);
  // anything sent at once replaces what is waiting for the frame, so an old preview never lands after a release.
  const waiting = useRef<{ show?: MapMessage; crosshair?: MapMessage }>({});
  const frame = useRef<number | null>(null);
  const deliver = (message: MapMessage) => {
    if (!acceptMapMessage(message as unknown)) { if (message.type === 'show') setSendWarning(TOO_LARGE); return; } // the wall keeps its last show
    if (message.type === 'show') setSendWarning(null);
    bridge?.send(message);
  };
  const sendNow = (message: MapMessage) => {
    if (message.type === 'show' || message.type === 'crosshair') delete waiting.current[message.type];
    deliver(message);
  };
  const sendNextFrame = (message: MapMessage & { type: 'show' | 'crosshair' }) => {
    waiting.current[message.type] = message;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const { show: nextShow, crosshair } = waiting.current;
      waiting.current = {};
      if (nextShow) deliver(nextShow);
      if (crosshair) deliver(crosshair);
    });
  };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const showMessage = (s: ShowDocument): MapMessage => ({ type: 'show', show: toWire(s) });
  /** A scene switch's fade time, for the wall: it travels on the switch's own show message. */
  const wallFade = useRef<number | null>(null);
  /** What the wall was last told of Live: its settings, null (not used), or undefined (nothing yet, since it opened). */
  const sentLive = useRef<LiveSettings | null | undefined>(undefined);
  const sendLive = () => {
    const want = usesLive(stateRef.current.show) ? liveRef.current : null;
    if (want === sentLive.current) return;
    if (want === null && sentLive.current === undefined) { sentLive.current = null; return; }
    const message: MapMessage = { type: 'liveSettings', settings: want };
    if (acceptMapMessage(message as unknown)) { bridge?.send(message); sentLive.current = want; }
  };

  /**
   * Compositions the output does not have yet go first, so the show never names one the wall cannot play.
   * The record of what the wall has is the session's (emptied whenever an output opens), shared with Studio edits.
   */
  const sendSources = (s: ShowDocument) => {
    const { messages, sent } = sourcesToSend(s, kept.sentSources);
    kept.sentSources = sent;
    if (!messages.length) return;
    let refused = false;
    for (const message of messages) {
      if (!acceptMapMessage(message as unknown)) { refused = true; continue; }
      bridge?.send(message);
    }
    setSourceWarning(refused ? TOO_LARGE_SOURCE : null);
  };

  // When the wall reports ready: blackout and test grid first, so the wall never paints shapes while Blackout is on.
  // This effect is declared before the show effect, so it runs first when the output opens.
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    sendNow({ type: 'blackout', on: latest.current.blackout });
    sendNow({ type: 'flashGuard', on: latest.current.flashGuard });
    sendNow({ type: 'testGrid', on: latest.current.testGrid });
    sendNow({ type: 'freeze', on: latest.current.freeze });
    // Solo before the show, so the wall never paints one frame of the shapes solo hides.
    sendNow({ type: 'solo', ids: soloIds(latest.current.shown, kept.solo) });
    sendSources(latest.current.shown);
    // Live's settings before the show, so a Live shape can start at once.
    sentLive.current = undefined;
    sendLive();
    sendNow(showMessage(latest.current.shown));
  }, [outputOpen, outputEpoch]);
  // Then the whole show again after every edit, and the trial show while a drag is in progress.
  const dragging = preview !== null;
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    sendSources(shown);
    if (dragging) sendNextFrame(showMessage(shown) as MapMessage & { type: 'show' });
    else {
      const fadeMs = wallFade.current;
      wallFade.current = null;
      sendNow(fadeMs === null ? showMessage(shown) : { ...showMessage(shown), fadeMs } as MapMessage);
    }
  }, [shown, outputOpen]);

  // Solo reaches the wall as the shapes it covers, sent again whenever that changes.
  const soloed = soloIds(shown, solo);
  const soloKey = soloed.join('\n');
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    sendNow({ type: 'solo', ids: soloed });
  }, [soloKey]);
  // Solo and the selection forget shapes and groups that have left the show (deleted, or undone).
  useEffect(() => {
    const s = kept.solo;
    const shapes = s.shapes.filter(id => show.shapes.some(sh => sh.id === id)), groups = s.groups.filter(id => show.groups.some(g => g.id === id));
    if (shapes.length !== s.shapes.length || groups.length !== s.groups.length) { kept.solo = { shapes, groups }; setSoloState(kept.solo); }
    setSelectedIds(ids => {
      const live = ids.filter(id => show.shapes.some(sh => sh.id === id));
      if (live.length === ids.length) return ids;
      if (live[0] !== ids[0]) { setSelectedIndex(null); setSelectedRing(-1); }
      return live;
    });
  }, [show]);

  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  const step = useCallback((action: Parameters<typeof mapReducer>[1]) => {
    const before = stateRef.current;
    const after = mapReducer(before, action);
    kept.state = stateRef.current = after;
    setState(after);
    if (after.show !== before.show) { saver.save(after.show); setNotice(null); }
    return after;
  }, []);
  const dispatch = useCallback((action: EditAction, merge?: string) => {
    if (!canEdit(loadedRef.current)) { setLastRefusal('Loading the show…'); return false; }
    if (performService().running && SCENE_BAR_EDITS.has(action.type)) { setLastRefusal(SCENES_PAUSED); return false; }
    const after = step({ type: 'edit', action, merge });
    // What triggers and auto-advance do never clears a note the operator may be reading.
    if (merge !== 'trigger' || after.refusal !== null) setLastRefusal(after.refusal);
    return after.refusal === null;
  }, [step]);
  const undo = useCallback(() => {
    if (!canEdit(loadedRef.current)) return;
    const { show: now, past } = stateRef.current, blocked = showBlocksHistory(now, past.at(-1));
    if (blocked) setLastRefusal(blocked); else step({ type: 'undo' });
  }, [step]);
  const redo = useCallback(() => {
    if (!canEdit(loadedRef.current)) return;
    const { show: now, future } = stateRef.current, blocked = showBlocksHistory(now, future[0]);
    if (blocked) setLastRefusal(blocked); else step({ type: 'redo' });
  }, [step]);
  const [performing, setPerforming] = useState(() => performService().running);
  useEffect(() => { setPerforming(performService().running); return performService().subscribe(v => setPerforming(v.running)); }, []);

  const setBlackout = (on: boolean) => { kept.blackout = on; setBlackoutState(on); if (outputOpen) bridge?.send({ type: 'blackout', on }); };
  const setFlashGuard = (on: boolean) => { kept.flashGuard = on; setFlashGuardState(on); if (outputOpen) bridge?.send({ type: 'flashGuard', on }); };
  const setTestGrid = (on: boolean) => { kept.testGrid = on; setTestGridState(on); if (outputOpen) bridge?.send({ type: 'testGrid', on }); };
  /** Freeze holds the wall's picture: the instruments stop where they are. */
  const setFreeze = (on: boolean) => { kept.freeze = on; setFreezeState(on); if (outputOpen) bridge?.send({ type: 'freeze', on }); };

  // ---- Scenes and reactivity (stage 5) ----
  /** This screen's own compositor is told of a scene switch's fade through this, as the wall is through a message. */
  const pendingFade = useRef<number | null>(null);
  /** Switches scene: the wall and this screen crossfade over the scene's own fade time, or the show's. */
  const switchScene = (sceneId: string, merge?: string) => {
    const s = stateRef.current.show, scene = s.scenes.find(sc => sc.id === sceneId);
    if (!scene || s.sceneId === sceneId) return false;
    if (performService().running) { setLastRefusal(SCENES_PAUSED); return false; }
    const ms = Math.round((scene.fadeSeconds ?? s.sceneFade) * 1000);
    if (!dispatch({ type: 'switchScene', sceneId }, merge)) return false;
    // Only once the switch is made. The wall gets the fade with the next whole show it is sent (never a drag's
    // trial show), so it can only ever belong to this switch.
    if (outputOpen) wallFade.current = ms;
    else pendingFade.current = ms;
    return true;
  };
  const stepScene = (by: 1 | -1, merge?: string) => {
    const s = stateRef.current.show;
    if (!s.scenes.length) return;
    const at = s.scenes.findIndex(sc => sc.id === s.sceneId);
    const next = s.scenes[((at < 0 ? (by > 0 ? -1 : 0) : at) + by + s.scenes.length) % s.scenes.length];
    switchScene(next.id, merge);
  };
  const [engine, setEngine] = useState<ReactivityEngine | null>(null);
  const meter = useMemo(() => new MeterStore(), []);
  /** This screen's compositor hears the signals here. */
  const onSignals = useRef<((signals: Signals) => void) | null>(null);
  // Live in Map: the Live screen's settings, sent to the wall while the show plays Live anywhere.
  const liveSettings = useLiveSettings();
  const live = liveSettings.settings;
  const liveRef = useRef<LiveSettings | null>(live);
  liveRef.current = live;
  const showUsesLive = usesLive(show);
  const reacts = showReacts(show) || (showUsesLive && (!!live?.links.some(l => l.on) || live?.look === 'morphogen'));
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => { if (live) kept.live = live; if (outputOpen) sendLive(); }, [live, showUsesLive, outputOpen]);
  /** This screen's own compositor hears Live's Clear and Capture empty room here, as the wall does through messages. */
  const onLiveAction = useRef<((action: 'clear' | 'captureRoom' | 'retry' | 'videoRetry' | 'performanceReset') => void) | null>(null);
  const clearLive = () => { onLiveAction.current?.('clear'); if (outputOpen) bridge?.send({ type: 'liveClear' }); };
  const retryVideos = () => { onLiveAction.current?.('videoRetry'); if (outputOpen) bridge?.send({ type: 'videoRetry' }); };
  const retryLive = () => { onLiveAction.current?.('retry'); if (outputOpen) bridge?.send({ type: 'liveRetry' }); };
  const captureLiveRoom = () => { onLiveAction.current?.('captureRoom'); if (outputOpen) bridge?.send({ type: 'liveCaptureRoom' }); };
  useEffect(() => { if ((reacts || panelOpen) && !engine) setEngine(reactivity()); }, [reacts, panelOpen, engine]);
  // Once a frame: signals to the wall and to this screen, and triggers fired as ordinary actions.
  const triggerAct = useRef<(action: TriggerAction) => void>(() => {});
  triggerAct.current = action => {
    switch (action.kind) {
      // What triggers do is one undo step however often they fire, so the beat never pushes the operator's edits out.
      case 'scene': switchScene(action.sceneId, 'trigger'); break;
      case 'next-scene': stepScene(1, 'trigger'); break;
      case 'previous-scene': stepScene(-1, 'trigger'); break;
      case 'vary': dispatch({ type: 'varySource', sourceId: action.sourceId, entropy: Math.floor(Math.random() * 1e6) }, 'trigger'); break;
      case 'blackout': setBlackout(!latest.current.blackout); break;
      case 'freeze': setFreeze(!latest.current.freeze); break;
      case 'tap': engine?.tap(); break;
    }
  };
  // Scene auto-advance: counts only while neither Freeze nor Blackout is on; any scene change starts the count again.
  // What it does is one undo step with the triggers, so it never pushes the operator's edits out.
  const switchRef = useRef(switchScene);
  switchRef.current = switchScene;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const auto = show.autoAdvance, autoKey = auto ? `${auto.unit}:${auto.every}:${auto.order}` : '';
  useEffect(() => {
    if (!auto) return;
    let elapsed = 0, bars = 0, last = performance.now(), lastBeat: number | null = null, sceneAt = stateRef.current.show.sceneId;
    const id = setInterval(() => {
      const t = performance.now(), s = stateRef.current.show, { freeze, blackout } = latest.current;
      const signals = engineRef.current?.signals, beat = signals?.['tempo.beat'] !== undefined && signals?.['tempo.phase'] !== undefined ? signals['tempo.beat'] + signals['tempo.phase'] : null;
      if (s.sceneId !== sceneAt) { sceneAt = s.sceneId; elapsed = 0; bars = 0; }
      // Paused during a Perform show; the count starts again when it ends.
      if (performService().running) { elapsed = 0; bars = 0; last = t; lastBeat = beat; return; }
      if (!freeze && !blackout) {
        elapsed += (t - last) / 1000;
        if (beat !== null && lastBeat !== null && beat > lastBeat) bars += (beat - lastBeat) / 4;
      }
      last = t; lastBeat = beat;
      if (!autoAdvanceDue(auto, elapsed, bars)) return;
      elapsed = 0; bars = 0;
      const next = nextAutoScene(s, s.sceneId, Math.random);
      if (next && switchRef.current(next, 'trigger')) sceneAt = next;
    }, 100);
    return () => clearInterval(id);
  }, [autoKey]);
  const listening = useRef({ panelOpen, outputOpen, reacts });
  listening.current = { panelOpen, outputOpen, reacts };
  const active = !!engine && (reacts || panelOpen);
  useEffect(() => {
    if (!engine || !active) return;
    // Triggers compare with the signals as they were, so a control already past halfway does not fire at once.
    let prev: Signals = { ...engine.signals }, shown = 0;
    // One subscription while anything reacts; the panel and the output are read as they are now, so opening either
    // never restarts the sound input.
    const off = engine.subscribe(now => {
      const { panelOpen, outputOpen, reacts } = listening.current;
      // During a Perform show the service sends the wall its signals, and Map's triggers wait.
      const performing = performService().running;
      // The wall gets only the signals the show uses, so a controller with many knobs never makes the message too large.
      // Whether the tempo stands on its own (MIDI, tap, a fixed number) travels with the signals, for Meridian's Conductor.
      const heard = heardSignals(now, engine.prefs.tempo);
      if (outputOpen && reacts && !performing) {
        const used = wallInputs(stateRef.current.show, liveRef.current);
        bridge?.send({ type: 'signals', signals: onlySignals(heard, used) });
      }
      onSignals.current?.(heard);
      if (!performing) for (const action of fire(stateRef.current.show.triggers, prev, now)) triggerAct.current(action);
      prev = now;
      // The panel's meters update a few times a second, not every frame.
      const t = performance.now();
      if (panelOpen && t - shown > 100) { shown = t; meter.set(now); }
    });
    // Leaving Map, or nothing reacting any more: the wall goes back to the set values at once.
    return () => { off(); if (listening.current.outputOpen && !performService().running) bridge?.send({ type: 'signals', signals: {} }); };
  }, [engine, active]);
  const openOutput = async () => {
    if (display === null) return;
    try {
      await bridge?.openOutput(display);
      // The projector the operator chose is the one an installation waits for.
      if (installation?.on && installation.surface === 'map' && installation.display !== display) void saveInstallation({ display }).catch(() => {});
    }
    catch (error) { onError((error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); await refreshDisplays(); }
  };
  const closeOutput = () => { void bridge?.closeOutput(); };

  // The wall's crosshair follows the selected corner, including while it is being dragged.
  const crossShape = selectedId !== null ? shown.shapes.find(s => s.id === selectedId) : undefined;
  const crossPoint = crossShape && selectedIndex !== null ? (selectedRing < 0 ? crossShape.points : crossShape.holes[selectedRing])?.[selectedIndex] ?? null : null;
  const crossX = crossPoint?.x ?? null, crossY = crossPoint?.y ?? null;
  useEffect(() => {
    if (!outputOpen || !bridge) return;
    const message: MapMessage & { type: 'crosshair' } = crossX === null || crossY === null ? { type: 'crosshair', point: null, shapeId: null } : { type: 'crosshair', point: { x: crossX, y: crossY }, shapeId: selectedId };
    if (dragging) sendNextFrame(message); else sendNow(message);
  }, [crossX, crossY, selectedId, outputOpen]);

  // Open replaces the held show and its undo history through the normal load path. A cancel does nothing and says nothing.
  const openShow = async () => {
    if (!bridge || !canEdit(loadedRef.current)) return;
    if (performService().running) { setLastRefusal(OPEN_PAUSED); return; }
    // Open replaces everything here, so it asks first when there is something to lose.
    const count = stateRef.current.show.shapes.length;
    if (count > 0 && !window.confirm(`Open a show file? It replaces the ${count} shape${count === 1 ? '' : 's'} here. Use Save As first to keep ${count === 1 ? 'it' : 'them'}.`)) return;
    let opened: unknown;
    try { opened = await bridge.openShow(); } catch { opened = { damaged: true }; }
    if (opened === null || opened === undefined) return;
    if (isDamaged(opened)) { setNotice(DAMAGED); return; }
    const { show: next } = validateShow(opened);
    setSelection(null); setPreview(null); setLastRefusal(null);
    // A real load ends linked Reseed, Recall and Mutate, even when the same show comes back and its sources keep playing.
    onLiveAction.current?.('performanceReset');
    if (listening.current.outputOpen) bridge.send({ type: 'performanceReset' });
    step({ type: 'load', show: next });
    const dropped = leftOut(opened, next);
    setNotice(dropped > 0 ? `Show opened. ${dropped} shape${dropped === 1 ? '' : 's'} could not be read and ${dropped === 1 ? 'was' : 'were'} left out.` : 'Show opened');
  };
  // Save As always asks for a file name, and says which file it wrote.
  const saveShowAs = async () => {
    if (!bridge || !canEdit(loadedRef.current)) return;
    try {
      const file = await bridge.saveShow(JSON.stringify(savedShow(stateRef.current.show)), true);
      if (file) setNotice(`Saved as ${fileName(file)}`);
    } catch { setNotice('Could not save the show file. Nothing was changed on disk.'); }
  };

  // Identify flashes the selected shape on the wall for three seconds; pressing again restarts the timer.
  const identifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopIdentify = () => { if (identifyTimer.current) clearTimeout(identifyTimer.current); identifyTimer.current = null; };
  // Leaving the screen mid-flash must not leave the wall flashing.
  useEffect(() => () => {
    if (identifyTimer.current) bridge?.send({ type: 'identify', shapeId: null });
    stopIdentify();
  }, []);
  const identify = () => {
    if (!selectedId || !bridge) return;
    stopIdentify();
    bridge.send({ type: 'identify', shapeId: selectedId });
    identifyTimer.current = setTimeout(() => { identifyTimer.current = null; bridge.send({ type: 'identify', shapeId: null }); }, 3000);
  };

  const setSelection = (id: string | null, index: number | null = null, ring = -1) => { setSelectedIds(id === null ? [] : [id]); setSelectedIndex(id === null ? null : index); setSelectedRing(id === null ? -1 : ring); };
  /** Several shapes; their points are not chosen. */
  const selectMany = (ids: string[]) => { setSelectedIds(ids); setSelectedIndex(null); setSelectedRing(-1); };
  /** Shift-click: adds a shape to the selection, or takes it out. */
  const toggleSelected = (id: string) => { setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]); setSelectedIndex(null); setSelectedRing(-1); };
  const setSolo = (next: { shapes: string[]; groups: string[] }) => { kept.solo = next; setSoloState(next); };
  const setSnap = (on: boolean) => { kept.snap = on; setSnapState(on); };
  const setPhotoShown = (on: boolean) => { kept.photoShown = on; setPhotoShownState(on); };

  return { performing, currentRefusal: () => stateRef.current.refusal, currentShow: () => stateRef.current.show, live, updateLive: liveSettings.update, clearLive, captureLiveRoom, retryLive, retryVideos, onLiveAction, switchScene, stepScene, pendingFade, engine: engine, startEngine: (): ReactivityEngine => { const e = engine ?? reactivity(); if (!engine) setEngine(e); return e; }, signals: meter, onSignals, reactivityPanel: panelOpen, setReactivityPanel: setPanelOpen,
    show, shown, preview, setPreview, wallPicture, openShow, saveShowAs, saveError, notice, loaded, selectedId, selectedIds, selectedIndex, selectedRing, setSelection, selectMany, toggleSelected, identify, setSelectedId: (id: string | null) => setSelection(id), tool, setTool,
    solo, setSolo, soloed, snap, setSnap, photoShown, setPhotoShown, setLastRefusal, dispatch, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0,
    lastRefusal, installationWaiting, sendWarning: sendWarning ?? sourceWarning, blackout, setBlackout, flashGuard, setFlashGuard, testGrid, setTestGrid, freeze, setFreeze, wallState, displays, display, setDisplay, outputOpen, openOutput, closeOutput, desktop: !!bridge };
}
