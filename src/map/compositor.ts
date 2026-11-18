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
import { drawCommands, shownOnWall, stageCommands, type DrawOptions } from './draw';
import { borderColour, fadeKey } from './edge';
import { advancePhase, drawsThisFrame, fadeAlpha, frameCost, governorStep, initialGovernor, GOVERNOR_SCALES, shouldFade, type Governor, type Playing } from './playout';
import { isEvolving } from '../core/playback';
import { STAGE_SIZE, type Group, type Point, type Shape } from './show';
import { ringBounds } from './outline';
import { IDENTITY, invert, quadToQuad, apply, type H3 } from './homography';
import { landing, sourceSizeFor, type Landing } from './placement';
import { Gpu, type ShapeDraw, type Texture } from './gpu';
import { Modulator, tempoPhase, withParams, type Modulated } from './modulate';
import type { Link } from '../react/links';
import type { Signals } from '../react/signals';
import { borderPicture, coveragePicture, flatPatternPicture, outlinePath, patternPicture, type Box } from './coverage';

/** What the compositor needs of a show: its shapes and groups, and each source's speed. Works for a stored show or the wall's. */
export interface PlayShow { shapes: Shape[]; sources: { id: string; speed: number; tempoSync?: number | null }[]; groups: Group[]; links?: Link[] }

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
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => {
      this.gpu.setUp();
      this.pictures.clear(); this.overlay = null;
      for (const slot of this.slots.values()) slot.texture = null;
      // The old pictures were on the lost card: those fades end, and the shapes show what they play now.
      for (const [id, fade] of [...this.fades]) if (typeof fade.from !== 'string') this.fades.delete(id);
      this.lost = false; this.dirty = true;
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
    this.projects = new Map(projects);
    this.dirty = true;
    // Fades start when a shape changes source, or its source changes instrument. The old picture is copied before
    // the old source is let go, so the shape holds it while the new one starts.
    for (const shape of show.shapes) {
      const next: Playing = { sourceId: shape.sourceId, kinds: kindsOf(shape.sourceId ? this.projects.get(shape.sourceId) : null) };
      const before = this.playing.get(shape.id);
      if (shouldFade(before, next) && !this.lost) {
        const old = before!.sourceId ? this.slots.get(before!.sourceId)?.texture : null;
        const held = this.fades.get(shape.id);
        // Changing again before the last change was ready keeps fading from what is on the wall, not from the colour.
        const from = old ? this.gpu.copy(old) : held ? held.from : shape.colour;
        if (held && held.from !== from && typeof held.from !== 'string') this.gpu.free(held.from);
        this.fades.set(shape.id, { from, start: shape.sourceId === null ? this.fadeClock : null, duration });
      }
      this.playing.set(shape.id, next);
    }
    for (const id of [...this.playing.keys()]) if (!show.shapes.some(s => s.id === id)) { this.playing.delete(id); this.endFade(id); }
    for (const id of [...this.pictures.keys()]) if (!show.shapes.some(s => s.id === id)) this.dropPictures(id);
    const live = new Set(show.sources.map(s => s.id));
    for (const [id, slot] of this.slots) if (!live.has(id)) this.release(id, slot);
    for (const id of [...this.restartAt.keys()]) if (!live.has(id)) this.restartAt.delete(id);
  }

  /** Called every frame by the operator screen, so only a real change counts. */
  setOptions(options: DrawOptions): void {
    const key = JSON.stringify(options);
    if (key === this.optionsKey) return;
    this.options = options; this.optionsKey = key; this.dirty = true;
  }
  /** The latest signals. A show that reacts is drawn again with them. */
  setSignals(signals: Signals): void {
    this.signals = signals;
    if (this.show.links?.length || this.show.sources.some(s => s.tempoSync)) this.dirty = true;
  }
  setFrozen(frozen: boolean): void { if (frozen !== this.frozen) { this.frozen = frozen; this.dirty = true; } }
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
    this.drawn = this.modulator.apply(this.show, this.projects, this.signals, seconds);
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
      if (project !== slot.project && project !== slot.pending && project !== slot.failedProject) this.prepare(slot, project);
      if (!slot.project || !slot.renderer) continue;
      if (!this.frozen) {
        // In tempo sync the loop follows the clock's beats; without a clock it runs at its own speed.
        const synced = source.tempoSync ? tempoPhase(this.signals, source.tempoSync) : null;
        slot.phase = synced ?? advancePhase(slot.phase, seconds, slot.project, this.drawn.speed.get(source.id) ?? source.speed);
      }
      if (!draw) continue;
      // Drawn once, at the size of the largest place it lands on the stage.
      const size = sourceSizeFor(users.map(s => landing(s, show)), scale);
      try {
        slot.renderer.render(withParams(slot.project, this.drawn.params.get(source.id)), slot.phase, size.width, size.height);
        slot.texture = this.gpu.upload(slot.canvas, slot.texture);
        rendered = true;
        if (slot.failedProject === null) slot.failed = null;
      } catch (error) { slot.failed = String((error as Error)?.message ?? error); }
    }

    const drawn = this.dirty || rendered || this.fades.size > 0 || this.glides.size > 0;
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
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const [id, slot] of this.slots) this.release(id, slot);
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
    if (p && !this.lost) { this.gpu.free(p.coverage); this.gpu.free(p.decor); this.gpu.free(p.own); }
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
      slot.project = project; slot.pending = null; slot.failed = null; slot.failedProject = null;
      this.dirty = true;
    }).catch(error => {
      if (slot.pending !== project) return;
      slot.pending = null;
      slot.failedProject = project;
      slot.failed = String((error as Error)?.message ?? error);
      this.dirty = true;
    });
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
      p = { shape, geometry, path: outlinePath(shape), box, coverageKey: '', coverage: p?.coverage ?? null, decorKey: '', decor: p?.decor ?? null, borderColour: '', ownKey: '', own: p?.own ?? null, ownFor: null };
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

  /** One shape: what it plays through its placement, its crossfade, its look, its coverage and its border. */
  private drawShape(shape: Shape, now: number, alpha = 1): void {
    const project = shape.sourceId ? this.projects.get(shape.sourceId) : undefined;
    const palette = project?.layers[0]?.palette ?? null;
    const p = this.picturesFor(shape, palette);
    if (p.box.w < 0.5 || p.box.h < 0.5 || !p.coverage) return;
    const land = landing(shape, this.drawn.show), inv = inverseOf(land);
    const slot = shape.sourceId ? this.slots.get(shape.sourceId) : undefined;
    // A source that will not play (failing, over the limit, restarting, or with no composition) plays the shape's own fill.
    const cannotPlay = shape.sourceId !== null && (!slot || !slot.renderer || (slot.failedProject !== null && slot.failedProject === project) || !project);
    const fill = (): ShapeDraw['content'] => this.own(shape, p, land);
    let content: ShapeDraw['content'];
    if (shape.blocker) content = { kind: 'colour', rgba: [0, 0, 0, 1] };
    else if (shape.sourceId === null || cannotPlay) content = fill();
    else if (slot?.project && slot.texture) content = { kind: 'picture', texture: slot.texture, inv };
    else content = fill(); // a source not ready yet plays the shape's own fill, never black
    // A fade waits for the composition the shape should now play, not one still drawing from before.
    const ready = shape.blocker || shape.sourceId === null || cannotPlay || (slot?.project === project && !!slot?.texture);
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
    });
  }
}
