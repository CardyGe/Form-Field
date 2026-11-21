/**
 * The Map compositor: plays every instrument source with its own StudioRenderer (the stage 0 route) and draws the
 * stage on the graphics card (stage 4, see gpu.ts): each shape's picture through its placement (Fit, Pin in
 * perspective, Across group or stage), cut by its coverage, with its look and border, then the overlays, then the
 * stage corners. Used by the output window, and by the operator screen while the output is closed.
 *
 * The rules (sizing, clock, governor, fades, placement) are in playout.ts and placement.ts and tested there.
 */
import { StudioRenderer } from '../rendering/StudioRenderer';
import type { Project } from '../shared/types';
import { drawCommands, ringPx, shownOnWall, stageCommands, type DrawOptions } from './draw';
import { borderColour, fadeKey } from './edge';
import { advancePhase, drawsThisFrame, fadeAlpha, frameCost, governorStep, initialGovernor, GOVERNOR_SCALES, needsPrepare, shouldFade, type Governor, type Playing } from './playout';
import { isEvolving } from '../core/playback';
import { LIVE_SOURCE_ID, STAGE_SIZE, usesLive, type FollowOutline, type Group, type Point, type Shape } from './show';
import type { Scene } from './scenes';
import { LiveSlot, LIVE_ASPECT } from './liveSlot';
import { VideoSlot } from './videoSlot';
import { isVideoId, type VideoSource } from './show';
import type { LiveSettings } from '../live/settings';
import { flatten, ringBounds } from './outline';
import { IDENTITY, invert, multiply, quadToQuad, apply, type H3 } from './homography';
import { coverCrop, landing, landingAspect, sourceSizeFor, type Landing } from './placement';
import { Gpu, type ShapeDraw, type Texture } from './gpu';
import { chaseOffsets, outlinePolygon, runHead, staggerDelays, withSurface } from './wild';
import { FrameHistory } from './frameHistory';
import { Modulator, tempoPhase, withParams, type Modulated } from './modulate';
import type { Link } from '../react/links';
import type { Signals } from '../react/signals';
import { borderPicture, borderRunPicture, coveragePicture, flatPatternPicture, outlinePath, patternPicture, type Box } from './coverage';

/** What the compositor needs of a show: its shapes and groups, and each source's speed. Works for a stored show or the wall's. */
export interface PlayShow { shapes: Shape[]; sources: { id: string; speed: number; tempoSync?: number | null; followOutline?: FollowOutline | null }[]; groups: Group[]; links?: Link[];
  /** Live in Map: the wall is told whether the show uses Live; the operator screen has the scenes to work it out. */
  usesLive?: boolean; scenes?: Scene[];
  /** Stage 6: the videos shapes play. */
  videos?: VideoSource[] }

/**
 * Most instruments that play at once. Chromium caps live WebGL contexts per page; past the cap it silently kills the
 * oldest, so Map stays well under it. A source over the limit plays its shape's colour, and the operator is told why.
 */
export const MAX_LIVE_INSTRUMENTS = 24;
/** After its graphics context is lost, a source waits this long before it is started again. */
const RESTART_AFTER_MS = 5000;

/** One instrument source on this stage. */
interface Slot {
  canvas: HTMLCanvasElement;
  /** Newer settings that can follow sound, arrived while `pending` was being prepared: used when it is ready. */
  latest?: Project | null;
  renderer: StudioRenderer | null;
  /** The composition being drawn, once prepared; the one being prepared, if any. */
  project: Project | null;
  pending: Project | null;
  phase: number;
  /** The last drawn picture, on the stage's graphics card: it holds while frames are skipped or frozen. */
  texture: Texture | null;
  failed: string | null;
  /** A composition that could not be prepared is not tried again every frame; a new composition is. */
  failedProject: Project | null;
  prepares: number;
}

/** A shape's crossfade from what it played before to what it plays now. start is set once the new content is ready. */
interface Fade { from: Texture | string; start: number | null; duration: number }
/** A scene switch's glide of a shape's brightness and visibility, from where they were. */
interface Glide { brightness: number; alpha: number; start: number; duration: number }
const CHANGE_FADE_MS = 400;

/** The pictures a shape reuses until it changes. */
interface Pictures {
  shape: Shape;
  geometry: string; path: Path2D; box: Box;
  coverageKey: string; coverage: Texture | null;
  decorKey: string; decor: Texture | null; borderColour: string;
  runKey: string; run: Texture | null;
  ownKey: string; own: Texture | null; ownFor: { shape: Shape; pinned: boolean; w: number; h: number } | null;
}

export interface CompositorStats {
  fps: number;
  /** Governor level: 0 full size; 1 and 2 drawn smaller; 3 also every other frame. */
  level: number;
  /** Sources whose composition could not be prepared, with the reason. */
  failing: { id: string; reason: string }[];
  /** How many times each source has been prepared (for checks: editing one shape must not re-prepare another). */
  prepares: Record<string, number>;
  /** How many coverage pictures have been made (for checks: they are made when a shape changes, not every frame). */
  edgeBuilds: number;
  /** The stage's own graphics context was lost and is waiting to come back: the wall is black meanwhile. */
  contextLost: boolean;
  /** Live in Map: whether the show's Live runs (null: none, camera off). */
  live?: { running: boolean; state: string } | null;
  /** Stage 6: each video playing, by id: its state, and the beats a tempo loop plays as. */
  videos?: Record<string, { state: string; playsAs: number | null }>;
  linked?: Record<string, number>;
  /** How many times a playing effect took new settings without being prepared again (for checks). */
  adjusted?: number;
}

const kindsOf = (project: Project | null | undefined) => project ? project.layers.map(l => l.kind).join(',') : '';
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
const opaque = (hex: string): [number, number, number, number] => [...rgb(hex), 1];
const STAGE_RECT: Point[] = [{ x: 0, y: 0 }, { x: STAGE_SIZE.width, y: 0 }, { x: STAGE_SIZE.width, y: STAGE_SIZE.height }, { x: 0, y: STAGE_SIZE.height }];
/** The landing's inverse: stage pixels to the picture's square. A landing too flat to invert lands nowhere. */
const inverseOf = (l: Landing): H3 => invert(l.h) ?? [0, 0, -1, 0, 0, -1, 0, 0, 1];
/** A box's own square: Fit's grid pattern is drawn over the box, whatever the zoom. */
const boxInverse = (b: Box): H3 => invert([b.w || 1, 0, b.x, 0, b.h || 1, b.y, 0, 0, 1]) ?? IDENTITY;

export class MapCompositor {
  readonly canvas: HTMLCanvasElement;
  private readonly gpu: Gpu;
  private show: PlayShow = { shapes: [], sources: [], groups: [] };
  private projects = new Map<string, Project>();
  private options: DrawOptions = { blackout: false, testGrid: false, identifyId: null, crosshair: null, selectedId: null, selectedIndex: null, outlinesOnly: false, invalidIds: [] };
  private corners: H3 = IDENTITY;
  private frozen = false;
  private readonly slots = new Map<string, Slot>();
  private readonly playing = new Map<string, Playing>();
  private readonly fades = new Map<string, Fade>();
  private readonly pictures = new Map<string, Pictures>();
  private readonly glides = new Map<string, Glide>();
  private readonly modulator = new Modulator();
  private signals: Signals = {};
  /** What is drawn this frame: the show with its links applied. */
  private drawn: Modulated<PlayShow> = { show: this.show, opacity: new Map(), speed: new Map(), params: new Map() };
  /** The overlay (test grid, names, identify, crosshair, selection), drawn in 2D when it changes. */
  private overlay: { key: string; canvas: OffscreenCanvas; texture: Texture | null; empty: boolean } | null = null;
  /** Sources whose graphics context was lost, and when they may start again. */
  private readonly restartAt = new Map<string, number>();
  /** Sources over MAX_LIVE_INSTRUMENTS this frame: they play their colour. */
  private readonly overLimit = new Set<string>();
  private governor: Governor = initialGovernor();
  private last: number | null = null;
  private frameIndex = 0;
  private framesThisSecond = 0;
  private secondStarted = 0;
  private fps = 0;
  private edgeBuilds = 0;
  private disposed = false;
  private lost = false;
  /** Something changed since the stage was last drawn: the show, the overlays, Freeze, or an instrument became ready. */
  private dirty = true;
  private optionsKey = '';
  /** Fades run on their own clock, which stands still while frozen, so Freeze holds a fade where it is. */
  private fadeClock = 0;
  private drawnShapes = new Set<string>();
  private overlayFor: { show: PlayShow; options: string } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = STAGE_SIZE.width;
    canvas.height = STAGE_SIZE.height;
    this.canvas = canvas;
    this.gpu = new Gpu(canvas);
    // A lost context blanks the wall until Chromium gives it back; then every picture is made again.
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; this.live?.dispose(); this.live = null; this.liveTexture = null; for (const v of this.videoSlots.values()) v.dispose(); this.videoSlots.clear(); this.videoTextures.clear(); });
    canvas.addEventListener('webglcontextrestored', () => {
      this.gpu.setUp();
      this.pictures.clear(); this.overlay = null; this.histories.clear();
      for (const slot of this.slots.values()) slot.texture = null;
      // The old pictures were on the lost card: those fades end, and the shapes show what they play now.
      for (const [id, fade] of [...this.fades]) if (typeof fade.from !== 'string') this.fades.delete(id);
      this.lost = false; this.dirty = true;
      this.updateLive();
      this.updateVideos();
    });
  }

  /** The shapes and sources to play, and the compositions the stage has for them (by source id). */
  /** fadeMs: a scene switch's fade time; otherwise a change of content crossfades in 0.4 s. */
  setShow(show: PlayShow, projects: ReadonlyMap<string, Project>, fadeMs?: number): void {
    const before = this.show;
    const duration = fadeMs ?? CHANGE_FADE_MS;
    // A scene switch glides brightness and visibility from where they were.
    if (fadeMs !== undefined && fadeMs > 0) {
      for (const shape of show.shapes) {
        const old = before.shapes.find(s => s.id === shape.id);
        if (!old) continue;
        const wasShown = shownOnWall(before, old, this.options.solo), isShown = shownOnWall(show, shape, this.options.solo);
        if (old.brightness !== shape.brightness || wasShown !== isShown) this.glides.set(shape.id, { brightness: old.brightness, alpha: wasShown ? 1 : 0, start: this.fadeClock, duration: fadeMs });
      }
    }
    this.show = show;
    this.projects = this.played(show, projects);
    this.dirty = true;
    // Fades start when a shape changes source, or its source changes instrument. The old picture is copied before
    // the old source is let go, so the shape holds it while the new one starts.
    for (const shape of show.shapes) {
      const next: Playing = { sourceId: shape.sourceId, kinds: shape.sourceId === LIVE_SOURCE_ID ? 'live' : kindsOf(shape.sourceId ? this.projects.get(shape.sourceId) : null) };
      const before = this.playing.get(shape.id);
      if (shouldFade(before, next) && !this.lost) {
        const old = before!.sourceId === LIVE_SOURCE_ID ? this.live?.current ?? null : isVideoId(before!.sourceId) ? this.videoSlots.get(before!.sourceId)?.current ?? null : before!.sourceId ? this.slots.get(before!.sourceId)?.texture : null;
        const held = this.fades.get(shape.id);
        // Changing again before the last change was ready keeps fading from what is on the wall, not from the colour.
        const from = old ? this.gpu.copy(old) : held ? held.from : shape.colour;
        if (held && held.from !== from && typeof held.from !== 'string') this.gpu.free(held.from);
        this.fades.set(shape.id, { from, start: shape.sourceId === null ? this.fadeClock : null, duration });
      }
      this.playing.set(shape.id, next);
    }
    for (const id of [...this.playing.keys()]) if (!show.shapes.some(s => s.id === id)) { this.playing.delete(id); this.endFade(id); }
    // A shape removed mid-glide takes its glide with it, or the stage would be redrawn every frame from then on.
    for (const id of [...this.glides.keys()]) if (!show.shapes.some(s => s.id === id)) this.glides.delete(id);
    for (const id of [...this.pictures.keys()]) if (!show.shapes.some(s => s.id === id)) this.dropPictures(id);
    const live = new Set(show.sources.map(s => s.id));
    for (const [id, slot] of this.slots) if (!live.has(id)) this.release(id, slot);
    for (const id of [...this.restartAt.keys()]) if (!live.has(id)) this.restartAt.delete(id);
    // Live last, like the sources: a shape leaving Live has already copied its picture to fade from.
    this.updateLive();
    this.updateVideos();
  }

  // ---- Stage 6: videos ----
  private readonly videoSlots = new Map<string, VideoSlot>();
  private videoTextures = new Map<string, Texture | null>();
  /** One player per video a shape on screen plays; the others are closed. */
  private updateVideos(): void {
    const videos = this.show.videos ?? [];
    const wanted = new Set(this.lost || this.disposed ? [] : this.show.shapes.filter(s => isVideoId(s.sourceId) && !s.blocker).map(s => s.sourceId!));
    for (const [id, slot] of this.videoSlots) if (!wanted.has(id) || !videos.some(v => v.id === id)) { slot.dispose(); this.videoSlots.delete(id); this.videoTextures.delete(id); this.dirty = true; }
    for (const video of videos) {
      if (!wanted.has(video.id)) continue;
      const slot = this.videoSlots.get(video.id);
      if (slot) slot.update(video);
      else { const made = new VideoSlot(this.gpu, video); made.setFrozen(this.frozen); this.videoSlots.set(video.id, made); }
    }
  }
  /** Find…'s Try again: every video that cannot play loads again. */
  videoRetry(): void { for (const slot of this.videoSlots.values()) if (slot.state !== 'playing') slot.retry(); }

  /** Called every frame by the operator screen, so only a real change counts. */
  setOptions(options: DrawOptions): void {
    const key = JSON.stringify(options);
    if (key === this.optionsKey) return;
    this.options = options; this.optionsKey = key; this.dirty = true;
  }
  /** The latest signals. A show that reacts is drawn again with them. */
  setSignals(signals: Signals): void {
    this.signals = signals;
    // Freeze holds the picture: links stay where they were until it is let go.
    if (this.frozen) return;
    if (this.show.links?.length || this.show.sources.some(s => s.tempoSync)) this.dirty = true;
  }
  setFrozen(frozen: boolean): void { if (frozen !== this.frozen) { this.frozen = frozen; this.frozenSignals = this.signals; this.live?.setFrozen(frozen); for (const v of this.videoSlots.values()) v.setFrozen(frozen); this.dirty = true; } }

  // ---- Live in Map ----
  private adjusted = 0;
  private live: LiveSlot | null = null;
  private liveTexture: Texture | null = null;
  private liveSettings: LiveSettings | null = null;
  /** The Live screen's settings while the show plays Live (null: it does not). */
  setLive(settings: LiveSettings | null): void { if (settings === this.liveSettings) return; this.liveSettings = settings; this.updateLive(); }
  liveClear(): void { this.live?.clear(); }
  liveCaptureRoom(): void { this.live?.captureRoom(); }
  liveRetry(): void { if (this.live && this.liveSettings) this.live.retry(this.liveSettings); }
  /** Keeps one Live while the show uses Live anywhere, shapes or scenes, so a scene switching back never waits; lets it go (camera off) once nothing does. */
  private updateLive(): void {
    const wanted = !this.disposed && !this.lost && !!this.liveSettings && (this.show.usesLive ?? usesLive(this.show));
    if (!wanted) { if (this.live) { this.live.dispose(); this.live = null; this.dirty = true; } return; }
    if (!this.live) { this.live = new LiveSlot(this.gpu, this.liveSettings!); this.live.setFrozen(this.frozen); }
    else this.live.setSettings(this.liveSettings!);
  }
  private frozenSignals: Signals = {};
  /** Where the stage's corners go on the projector (stage fractions), or null for none. The wall uses this; the operator screen never does. */
  setCorners(corners: Point[] | null): void {
    const to = corners?.map(p => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height }));
    const h = to ? quadToQuad(STAGE_RECT, to) : null;
    // The final pass needs output pixels to stage pixels.
    const next = (h && invert(h)) ?? IDENTITY;
    if (next.some((v, i) => v !== this.corners[i])) { this.corners = next; this.dirty = true; }
  }
  /** Draw the stage again on the next frame even if nothing changed. */
  invalidate(): void { this.dirty = true; }
  /** The operator's picture of the wall: started after a drawn frame, collected on a later one, never waited for. */
  requestPreview(): boolean { return !this.lost && this.gpu.requestPreview(); }
  collectPreview(): ImageData | null { return this.lost ? null : this.gpu.collectPreview(); }
  /** Whether a preview is still on its way; false after a lost context, when it never will arrive. */
  get previewPending(): boolean { return !this.lost && this.gpu.previewPending; }

  /**
   * Advances the clock, draws every source that is due, and composites the stage. Returns whether the stage was drawn:
   * a still show (nothing playing, no fade, nothing changed) is not drawn again.
   */
  frame(now: number): boolean {
    if (this.disposed || this.lost) return false;
    const started = performance.now();
    const seconds = this.last === null ? 0 : (now - this.last) / 1000;
    this.last = now;
    if (!this.frozen) this.fadeClock += seconds * 1000;
    const scale = GOVERNOR_SCALES[this.governor.level];
    const draw = !this.frozen && drawsThisFrame(this.governor.level, this.frameIndex);

    this.overLimit.clear();
    let rendered = false;
    // The links applied for this frame (for drawing only); with none, the show itself.
    // Frozen, the links are held at the signals of the moment Freeze went on, and their smoothing stands still.
    // Videos' speed can be linked like an effect's, so the links see them as sources.
    const modShow = this.show.videos?.length ? { ...this.show, sources: [...this.show.sources, ...this.show.videos] } : this.show;
    this.drawn = this.modulator.apply(modShow, this.projects, this.frozen ? this.frozenSignals : this.signals, this.frozen ? 0 : seconds);
    const show = this.drawn.show;
    for (const source of this.show.sources) {
      const project = this.projects.get(source.id);
      if (!project) continue;
      // Only sources some visible shape plays are started; one whose shapes are all hidden gives its context back.
      // A shape gliding out of view after a scene switch still needs its picture.
      const users = show.shapes.filter(s => s.sourceId === source.id && (shownOnWall(show, s, this.options.solo) || this.glides.has(s.id)));
      if (!users.length) { const idle = this.slots.get(source.id); if (idle) this.release(source.id, idle); continue; }
      const slot = this.slot(source.id, now);
      if (!slot) continue;
      // A setting that can follow sound changed (Map's Effect tab): the playing effect is adjusted in place, never restarted.
      if (project !== slot.project && slot.project && !slot.pending && slot.failedProject === null && !needsPrepare(slot.project, project)) { slot.project = project; this.adjusted++; }
      // A drag while a restart is still being prepared: the newer settings wait for it, rather than restarting it again.
      else if (slot.pending && project !== slot.pending && project !== slot.project && !needsPrepare(slot.pending, project)) slot.latest = project;
      else if (project !== slot.project && project !== slot.pending && project !== slot.failedProject) { slot.latest = null; this.prepare(slot, project); }
      if (!slot.project || !slot.renderer) continue;
      if (!this.frozen) {
        // In tempo sync the loop follows the clock's beats; without a clock it runs at its own speed.
        const synced = source.tempoSync ? tempoPhase(this.signals, source.tempoSync) : null;
        slot.phase = synced ?? advancePhase(slot.phase, seconds, slot.project, this.drawn.speed.get(source.id) ?? source.speed);
      }
      if (!draw) continue;
      // Drawn once, at the size of the largest place it lands on the stage.
      // Sized from the shapes as set, not as links move them: a zoom on the bass would otherwise resize the instrument many times a second.
      const size = sourceSizeFor(users.map(s => landing(this.show.shapes.find(x => x.id === s.id) ?? s, this.show)), scale);
      try {
        slot.renderer.render(withParams(slot.project, this.drawn.params.get(source.id)), slot.phase, size.width, size.height, { signals: this.signals, now });
        slot.texture = this.gpu.upload(slot.canvas, slot.texture);
        rendered = true;
        if (slot.failedProject === null) slot.failed = null;
      } catch (error) { slot.failed = String((error as Error)?.message ?? error); }
    }

    // Each video's newest frame, once for every shape that plays it.
    for (const [id, slot] of this.videoSlots) {
      const had = !!this.videoTextures.get(id);
      const now = slot.frame(this.frozen ? this.frozenSignals : this.signals, this.drawn.speed.get(id));
      this.videoTextures.set(id, now);
      // A video that fails mid-show stops giving a picture: its shapes go to their fill at once.
      if (slot.fresh || had !== !!now) rendered = true;
    }
    // Live's newest picture, once for every shape that plays it.
    // A Live whose own graphics context was lost is made again; meanwhile its shapes play their fill.
    if (this.live?.broken) { this.live.dispose(); this.live = null; this.dirty = true; this.updateLive(); }
    if (this.live) {
      if (!this.frozen) this.live.setSignals(this.signals);
      this.liveTexture = this.live.frame();
      if (this.live.fresh) rendered = true;
    } else this.liveTexture = null;
    // A border run moves every frame (it holds with Freeze).
    const running = !this.frozen && this.show.shapes.some(s => s.border.run && s.border.width > 0 && !s.blocker);
    const staggering = this.keepHistories(show);
    const drawn = this.dirty || rendered || running || staggering || this.fades.size > 0 || this.glides.size > 0;
    if (drawn) { this.composite(this.fadeClock); this.dirty = false; }
    this.frameIndex++;
    const work = performance.now() - started;
    // The governor judges frames that draw; an idle frame says nothing about how heavy the show is.
    if (!this.frozen && drawn) this.governor = governorStep(this.governor, frameCost(work, seconds * 1000));
    this.framesThisSecond++;
    if (now - this.secondStarted >= 1000) { this.fps = this.framesThisSecond * 1000 / (now - this.secondStarted); this.framesThisSecond = 0; this.secondStarted = now; }
    return drawn;
  }

  stats(): CompositorStats {
    return {
      fps: Math.round(this.fps), level: this.governor.level,
      failing: [
        ...[...this.slots].filter(([, s]) => s.failed).map(([id, s]) => ({ id, reason: s.failed! })),
        ...[...this.overLimit].map(id => ({ id, reason: `more than ${MAX_LIVE_INSTRUMENTS} instruments are playing at once` })),
        ...[...this.restartAt.keys()].filter(id => !this.slots.has(id)).map(id => ({ id, reason: 'the graphics card stopped this instrument; it will start again' })),
        ...(this.lost ? [{ id: 'stage', reason: 'the graphics card reset the projector picture; it will come back by itself' }] : []),
      ],
      prepares: Object.fromEntries([...this.slots].map(([id, s]) => [id, s.prepares])),
      edgeBuilds: this.edgeBuilds,
      contextLost: this.lost,
      live: this.live ? { running: this.live.state.status === 'running', state: this.live.state.status } : null,
      videos: Object.fromEntries([...this.videoSlots].map(([id, v]) => [id, { state: v.state, playsAs: v.playsAs }])),
      // For the scripted checks: the effect settings links are moving now, as drawn (source:layer:key → value).
      adjusted: this.adjusted,
      linked: Object.fromEntries([...this.drawn.params].flatMap(([id, list]) => list.map(o => [`${id}:${o.layer}:${o.key}`, o.value])).slice(0, 16)),
    };
  }

  dispose(): void {
    this.disposed = true;
    if (!this.lost) for (const h of this.histories.values()) h.dispose();
    this.histories.clear();
    for (const [id, slot] of this.slots) this.release(id, slot);
    this.live?.dispose(); this.live = null;
    for (const v of this.videoSlots.values()) v.dispose(); this.videoSlots.clear();
    for (const id of [...this.pictures.keys()]) this.dropPictures(id);
    for (const id of [...this.fades.keys()]) this.endFade(id);
    this.gpu.free(this.overlay?.texture);
    this.gpu.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /** Lets a source go, and gives its graphics context back now rather than whenever it is garbage collected. */
  private release(id: string, slot: Slot): void {
    slot.renderer?.dispose();
    slot.renderer = null;
    if (!this.lost) this.gpu.free(slot.texture);
    slot.texture = null;
    this.dirty = true; // its shape now plays its own fill
    const gl = slot.canvas.getContext('webgl2') ?? slot.canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.slots.delete(id);
  }

  private endFade(id: string): void {
    const fade = this.fades.get(id);
    if (fade && typeof fade.from !== 'string' && !this.lost) this.gpu.free(fade.from);
    this.fades.delete(id);
  }

  private dropPictures(id: string): void {
    const p = this.pictures.get(id);
    if (p && !this.lost) { this.gpu.free(p.coverage); this.gpu.free(p.decor); this.gpu.free(p.run); this.gpu.free(p.own); }
    this.pictures.delete(id);
  }

  /** The source's slot, started if need be. Null while over the limit or waiting to restart after a lost context. */
  private slot(id: string, now: number): Slot | null {
    const existing = this.slots.get(id);
    if (existing) return existing;
    if ((this.restartAt.get(id) ?? 0) > now) return null;
    if (this.slots.size >= MAX_LIVE_INSTRUMENTS) { this.overLimit.add(id); return null; }
    this.restartAt.delete(id);
    const canvas = document.createElement('canvas');
    const slot: Slot = { canvas, renderer: null, project: null, pending: null, phase: 0, texture: null, failed: null, failedProject: null, prepares: 0 };
    // A lost context (the graphics card reset, or too many contexts) drops the source: its shape plays its own fill
    // rather than freezing on its last picture, and the source starts again after a pause.
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      if (this.slots.get(id) !== slot) return;
      this.release(id, slot);
      this.restartAt.set(id, performance.now() + RESTART_AFTER_MS);
    });
    try { slot.renderer = new StudioRenderer(canvas); }
    catch (error) { slot.failed = `This computer could not start an instrument: ${String((error as Error)?.message ?? error)}`; }
    this.slots.set(id, slot);
    return slot;
  }

  /** Prepares a composition in the background. Until it is ready the shape keeps its last picture. */
  private prepare(slot: Slot, project: Project): void {
    if (!slot.renderer) return;
    slot.pending = project;
    slot.prepares++;
    slot.renderer.prepare(project).then(() => {
      if (slot.pending !== project) return; // a newer composition arrived meanwhile
      // An evolving composition plays from its start; a looping one carries on where it was.
      if (isEvolving(project)) slot.phase = 0;
      slot.project = slot.latest && !needsPrepare(project, slot.latest) ? slot.latest : project; slot.latest = null; slot.pending = null; slot.failed = null; slot.failedProject = null;
      this.dirty = true;
    }).catch(error => {
      if (slot.pending !== project) return;
      slot.pending = null;
      slot.failedProject = project;
      slot.failed = String((error as Error)?.message ?? error);
      this.dirty = true;
    });
  }

  // ---- Stage 7: Outline drives the instrument, and Stagger ----
  private readonly outlined = new Map<string, { base: Project; key: string; played: Project }>();
  /**
   * The compositions as played: a source set to follow its shape's outline gets the outline of the first shape that
   * plays it as its instruments' surface. The same object is kept while nothing changes, so it is prepared again
   * only when the outline (to a thousandth of the picture) or the composition changes.
   */
  private played(show: PlayShow, projects: ReadonlyMap<string, Project>): Map<string, Project> {
    const out = new Map(projects);
    for (const source of show.sources) {
      const base = projects.get(source.id), shape = show.shapes.find(s => s.sourceId === source.id);
      if (!source.followOutline || !base || !shape) { this.outlined.delete(source.id); continue; }
      const inv = inverseOf(landing(shape, show));
      const picture = flatten(ringPx(shape.points)).map(p => apply(inv, p));
      const polygon = outlinePolygon(picture, { x: 0, y: 0, w: 1, h: 1 }).map(p => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
      const key = JSON.stringify([source.followOutline, polygon]), memo = this.outlined.get(source.id);
      if (memo && memo.base === base && memo.key === key) { out.set(source.id, memo.played); continue; }
      const played = withSurface(base, polygon, source.followOutline);
      this.outlined.set(source.id, { base, key, played });
      out.set(source.id, played);
    }
    for (const id of [...this.outlined.keys()]) if (!show.sources.some(s => s.id === id)) this.outlined.delete(id);
    return out;
  }

  private readonly histories = new Map<string, FrameHistory>();
  /** Each staggered shape's delay in seconds (only those above 0). */
  private delays = new Map<string, number>();
  /**
   * Keeps the last second of every source a staggered group plays, and lets the others go. Returns whether any shape
   * shows a delayed picture, so the stage is drawn each frame while it does (it holds with Freeze).
   */
  private keepHistories(show: PlayShow): boolean {
    this.delays = new Map();
    for (const group of show.groups) if (group.stagger) for (const [id, d] of staggerDelays(show, group.id)) if (d > 0) this.delays.set(id, d);
    const wanted = new Set<string>();
    for (const shape of show.shapes) if (shape.sourceId && this.delays.has(shape.id) && shownOnWall(show, shape, this.options.solo)) wanted.add(shape.sourceId);
    for (const [id, h] of this.histories) if (!wanted.has(id)) { h.dispose(); this.histories.delete(id); }
    if (!wanted.size) return false;
    for (const id of wanted) {
      const texture = id === LIVE_SOURCE_ID ? this.liveTexture : isVideoId(id) ? this.videoTextures.get(id) ?? null : this.slots.get(id)?.project ? this.slots.get(id)!.texture : null;
      if (!texture || this.frozen) continue;
      let h = this.histories.get(id);
      if (!h) { h = new FrameHistory(this.gpu); this.histories.set(id, h); }
      h.push(texture, this.fadeClock);
    }
    return !this.frozen;
  }

  private composite(now: number): void {
    const gpu = this.gpu;
    this.drawnShapes.clear();
    gpu.begin();
    if (!this.options.blackout) {
      // The test grid shows outlines, names and numbers instead of content.
      if (!this.options.testGrid && !this.options.outlinesOnly) {
        const show = this.drawn.show;
        for (const shape of show.shapes) {
          const glide = this.glides.get(shape.id), shown = shownOnWall(show, shape, this.options.solo);
          const t = glide ? fadeAlpha(glide.start, now, glide.duration) : 1;
          if (glide && t >= 1) this.glides.delete(shape.id);
          const alpha = (glide && t < 1 ? glide.alpha + ((shown ? 1 : 0) - glide.alpha) * t : shown ? 1 : 0) * (this.drawn.opacity.get(shape.id) ?? 1);
          if (alpha <= 0) continue;
          const brightness = glide && t < 1 ? glide.brightness + (shape.brightness - glide.brightness) * t : shape.brightness;
          this.drawShape(brightness === shape.brightness ? shape : { ...shape, brightness }, now, alpha);
        }
      } else this.glides.clear();
      const overlay = this.overlayPicture();
      if (overlay) gpu.layer(overlay);
    }
    gpu.finish(this.corners);
    // A fade on a shape that is not being drawn (hidden, a Blocker, test grid, blackout) has nothing to show: it ends,
    // so a still show stops being redrawn.
    for (const id of [...this.fades.keys()]) if (!this.drawnShapes.has(id)) this.endFade(id);
  }

  /** The overlays drawn in 2D, and given to the graphics card only when they change. Null when there are none. */
  private overlayPicture(): Texture | null {
    if (this.overlay && this.overlayFor?.show === this.show && this.overlayFor.options === this.optionsKey) return this.overlay.empty ? null : this.overlay.texture;
    this.overlayFor = { show: this.show, options: this.optionsKey };
    const commands = stageCommands(this.show, this.options).filter(c => c.kind !== 'fill' && c.kind !== 'pattern');
    const key = commands.length ? JSON.stringify(commands, (k, v) => (k === 'shape' ? undefined : v)) : '';
    if (this.overlay && this.overlay.key === key) return this.overlay.empty ? null : this.overlay.texture;
    const canvas = this.overlay?.canvas ?? new OffscreenCanvas(STAGE_SIZE.width, STAGE_SIZE.height);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCommands(ctx, commands);
    const texture = commands.length ? this.gpu.upload(canvas, this.overlay?.texture ?? null) : this.overlay?.texture ?? null;
    this.overlay = { key, canvas, texture, empty: commands.length === 0 };
    return commands.length ? texture : null;
  }

  /** The shape's cached pictures, made again only for what changed. */
  private picturesFor(shape: Shape, palette: string[] | null): Pictures {
    let p = this.pictures.get(shape.id);
    const colour = shape.border.width > 0 ? borderColour(shape, palette) : '';
    if (p && p.shape === shape && p.borderColour === colour) return p;
    const geometry = JSON.stringify([shape.points, shape.holes]);
    if (!p || p.geometry !== geometry) {
      const b = ringBounds([shape.points]);
      const box = { x: b.x0 * STAGE_SIZE.width, y: b.y0 * STAGE_SIZE.height, w: (b.x1 - b.x0) * STAGE_SIZE.width, h: (b.y1 - b.y0) * STAGE_SIZE.height };
      p = { shape, geometry, path: outlinePath(shape), box, coverageKey: '', coverage: p?.coverage ?? null, decorKey: '', decor: p?.decor ?? null, borderColour: '', runKey: '', run: p?.run ?? null, ownKey: '', own: p?.own ?? null, ownFor: null };
    }
    p.shape = shape; p.borderColour = colour;
    const coverageKey = `${fadeKey(shape)}|${geometry}`;
    if (p.coverageKey !== coverageKey) {
      p.coverage = this.gpu.upload(coveragePicture(shape, p.path, p.box), p.coverage);
      p.coverageKey = coverageKey;
      this.edgeBuilds++;
    }
    const decorKey = this.decorKey(shape, palette);
    if (p.decorKey !== decorKey) {
      if (shape.border.width > 0 && !shape.blocker) p.decor = this.gpu.upload(borderPicture(shape, p.path, p.box, borderColour(shape, palette)), p.decor);
      else { this.gpu.free(p.decor); p.decor = null; }
      p.decorKey = decorKey;
    }
    const runKey = shape.border.run && shape.border.width > 0 && !shape.blocker ? JSON.stringify([shape.points, shape.holes, shape.border.width, shape.border.glow]) : '';
    if (p.runKey !== runKey) {
      if (runKey) p.run = this.gpu.upload(borderRunPicture(shape, p.path, p.box), p.run);
      else { this.gpu.free(p.run); p.run = null; }
      p.runKey = runKey;
    }
    this.pictures.set(shape.id, p);
    return p;
  }
  private decorKey(shape: Shape, palette: string[] | null): string {
    return shape.border.width > 0 && !shape.blocker ? JSON.stringify([shape.points, shape.holes, shape.border, borderColour(shape, palette)]) : '';
  }

  /** The shape's own fill when it plays nothing: its plain colour, or its grid pattern (flat through a pin's perspective). */
  private own(shape: Shape, p: Pictures, land: Landing): ShapeDraw['content'] {
    if (shape.fill !== 'grid') return { kind: 'colour', rgba: opaque(shape.colour) };
    const pinned = shape.placement.kind === 'pin' && land.perspective;
    // Unchanged shape: the picture and its key are as they were (a pinned landing depends only on the shape).
    if (p.own && p.ownFor && p.ownFor.shape === shape && p.ownFor.pinned === pinned) return { kind: 'picture', texture: p.own, inv: pinned ? inverseOf(land) : boxInverse(p.box) };
    const corner = (u: number, v: number) => apply(land.h, { x: u, y: v });
    const landed = { w: Math.hypot(corner(1, 0).x - corner(0, 0).x, corner(1, 0).y - corner(0, 0).y), h: Math.hypot(corner(0, 1).x - corner(0, 0).x, corner(0, 1).y - corner(0, 0).y) };
    const key = pinned ? JSON.stringify(['pin', shape.colour, Math.round(landed.w / 16), Math.round(landed.h / 16)]) : JSON.stringify(['box', p.geometry, shape.colour, shape.name]);
    if (p.ownKey !== key) {
      p.own = this.gpu.upload(pinned ? flatPatternPicture(shape, landed) : patternPicture(shape, p.path, p.box), p.own);
      p.ownKey = key;
    }
    p.ownFor = { shape, pinned, w: landed.w, h: landed.h };
    return { kind: 'picture', texture: p.own!, inv: pinned ? inverseOf(land) : boxInverse(p.box) };
  }

  /** Where a shape's border run is: by the show's clock (it holds with Freeze), or the tempo's beats; chasing round its group. */
  private runHeadOf(shape: Shape, now: number): number {
    const signals = this.frozen ? this.frozenSignals : this.signals;
    const beat = signals['tempo.beat'] !== undefined && signals['tempo.phase'] !== undefined ? signals['tempo.beat'] + signals['tempo.phase'] : null;
    const group = shape.groupId ? this.drawn.show.groups.find(g => g.id === shape.groupId) : undefined;
    const offset = group?.chase ? chaseOffsets(this.drawn.show, group.id).get(shape.id) ?? 0 : 0;
    return runHead(shape.border.run!, now / 1000, beat, offset);
  }

  /** One shape: what it plays through its placement, its crossfade, its look, its coverage and its border. */
  private drawShape(shape: Shape, now: number, alpha = 1): void {
    const project = shape.sourceId ? this.projects.get(shape.sourceId) : undefined;
    const palette = project?.layers[0]?.palette ?? null;
    const p = this.picturesFor(shape, palette);
    if (p.box.w < 0.5 || p.box.h < 0.5 || !p.coverage) return;
    const land = landing(shape, this.drawn.show), inv = inverseOf(land);
    const isLive = shape.sourceId === LIVE_SOURCE_ID, isVideo = isVideoId(shape.sourceId);
    const videoSlot = isVideo ? this.videoSlots.get(shape.sourceId!) : undefined;
    const slot = shape.sourceId && !isLive && !isVideo ? this.slots.get(shape.sourceId) : undefined;
    // A source that will not play (failing, over the limit, restarting, or with no composition) plays the shape's own fill.
    const cannotPlay = !isLive && !isVideo && shape.sourceId !== null && (!slot || !slot.renderer || (slot.failedProject !== null && slot.failedProject === project) || !project);
    const fill = (): ShapeDraw['content'] => this.own(shape, p, land);
    let content: ShapeDraw['content'];
    if (shape.blocker) content = { kind: 'colour', rgba: [0, 0, 0, 1] };
    else if (shape.sourceId === null || cannotPlay) content = fill();
    // Live covers the place it lands and is cropped, never stretched; until it has a picture the shape plays its fill.
    // A video covers the place it lands, cropped, never stretched; until it plays (or when its file is missing) the fill.
    else if (isVideo) { const t = this.videoTextures.get(shape.sourceId!); content = t && videoSlot ? { kind: 'picture', texture: t, inv: multiply(coverCrop(landingAspect(land), videoSlot.aspect), inv) } : fill(); }
    else if (isLive) content = this.liveTexture ? { kind: 'picture', texture: this.liveTexture, inv: multiply(coverCrop(landingAspect(land), LIVE_ASPECT), inv) } : fill();
    else if (slot?.project && slot.texture) content = { kind: 'picture', texture: slot.texture, inv };
    else content = fill(); // a source not ready yet plays the shape's own fill, never black
    // Stagger: a shape later in its group shows its source a little while ago (until a second is kept, the oldest kept).
    const delay = this.delays.get(shape.id);
    if (delay && content.kind === 'picture' && shape.sourceId && !cannotPlay && !shape.blocker) {
      const live = isVideo ? this.videoTextures.get(shape.sourceId) : isLive ? this.liveTexture : slot?.texture;
      const past = content.texture === live ? this.histories.get(shape.sourceId)?.at(delay) : null;
      if (past) content = { ...content, texture: past };
    }
    // A fade waits for the composition the shape should now play, not one still drawing from before.
    // A fade into Live waits only while Live is starting; a camera that cannot play lets it finish to the fill.
    const ready = shape.blocker || shape.sourceId === null || cannotPlay || (isVideo ? !videoSlot || videoSlot.state !== 'loading' : isLive ? !this.live || this.live.readiness !== 'wait' : slot?.project === project && !!slot?.texture);
    let from: ShapeDraw['from'] = null, mix = 1;
    const fade = this.fades.get(shape.id);
    if (fade && !shape.blocker) {
      if (ready && fade.start === null) fade.start = now;
      mix = fade.start === null ? 0 : fadeAlpha(fade.start, now, fade.duration);
      from = typeof fade.from === 'string' ? { kind: 'colour', rgba: opaque(fade.from) } : { kind: 'picture', texture: fade.from, inv };
      if (mix >= 1) { this.endFade(shape.id); from = null; }
    }
    if (!shape.blocker) this.drawnShapes.add(shape.id);
    const tint = rgb(shape.tint), b = shape.blocker ? 1 : shape.brightness;
    this.gpu.shape({
      rect: p.box, coverage: p.coverage, content, from, mix,
      look: shape.blocker ? [1, 1, 1] : [tint[0] * b, tint[1] * b, tint[2] * b],
      decor: p.decor,
      alpha,
      run: p.run && shape.border.run ? { texture: p.run, head: this.runHeadOf(shape, now), length: shape.border.run.length } : null,
    });
  }
}
