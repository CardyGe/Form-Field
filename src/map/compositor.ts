/**
 * The Map compositor: plays every instrument source with its own StudioRenderer (the stage 0 route) and draws
 * each shape on a Canvas 2D stage, clipped to its outline. Used by the output window, and by the operator screen
 * while the output is closed.
 *
 * The rules (sizing, clock, governor, fades) are in playout.ts and tested there. This class applies them.
 */
import { StudioRenderer } from '../rendering/StudioRenderer';
import type { Project } from '../shared/types';
import { drawCommands, ringPx, shownOnWall, stageCommands, traceRing, type DrawOptions } from './draw';
import { borderColour, effectiveSoftEdge, fadeKey, fadeSize } from './edge';
import { advancePhase, drawsThisFrame, fadeAlpha, frameCost, governorStep, initialGovernor, GOVERNOR_SCALES, shouldFade, sourceSize, type Governor, type Playing } from './playout';
import { isEvolving } from '../core/playback';
import { STAGE_SIZE, type Group, type Shape } from './show';
import { ringBounds } from './outline';

/** What the compositor needs of a show: its shapes and groups, and each source's speed. Works for a stored show or the wall's. */
export interface PlayShow { shapes: Shape[]; sources: { id: string; speed: number }[]; groups: Group[] }

/** A shape's outline and holes as one path in stage pixels, with its box; kept until the shape's geometry changes. */
interface Outline { shape: Shape; key: string; path: Path2D; box: { x: number; y: number; w: number; h: number } }
/** A shape's soft edge: white where the content shows, fading to nothing at the outline. */
interface Fader { shape: Shape; key: string; picture: OffscreenCanvas }

type Frame = OffscreenCanvas;

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
  /** The last drawn picture, kept in 2D: a WebGL canvas is cleared after it is shown, and frames are sometimes skipped. */
  frame: Frame | null;
  failed: string | null;
  /** A composition that could not be prepared is not tried again every frame; a new composition is. */
  failedProject: Project | null;
  prepares: number;
}

/** A shape's crossfade from what it played before to what it plays now. start is set once the new content is ready. */
interface Fade { from: Frame | string; start: number | null }

export interface CompositorStats {
  fps: number;
  /** Governor level: 0 full size; 1 and 2 drawn smaller; 3 also every other frame. */
  level: number;
  /** Sources whose composition could not be prepared, with the reason. */
  failing: { id: string; reason: string }[];
  /** How many times each source has been prepared (for checks: editing one shape must not re-prepare another). */
  prepares: Record<string, number>;
  /** How many soft-edge pictures have been made (for checks: they are made when a shape changes, not every frame). */
  edgeBuilds: number;
}

const copyFrame = (source: CanvasImageSource, width: number, height: number, into: Frame | null): Frame => {
  const frame = into && into.width === width && into.height === height ? into : new OffscreenCanvas(width, height);
  const ctx = frame.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return frame;
};
const kindsOf = (project: Project | null | undefined) => project ? project.layers.map(l => l.kind).join(',') : '';

export class MapCompositor {
  private readonly ctx: CanvasRenderingContext2D;
  private show: PlayShow = { shapes: [], sources: [], groups: [] };
  private readonly outlines = new Map<string, Outline>();
  private readonly faders = new Map<string, Fader>();
  private edgeBuilds = 0;
  /** Where a soft-edged shape's content is put together before its fade is applied; stage-sized, reused. */
  private scratch: OffscreenCanvas | null = null;
  private projects = new Map<string, Project>();
  private options: DrawOptions = { blackout: false, testGrid: false, identifyId: null, crosshair: null, selectedId: null, selectedIndex: null, outlinesOnly: false, invalidIds: [] };
  private frozen = false;
  private readonly slots = new Map<string, Slot>();
  private readonly playing = new Map<string, Playing>();
  private readonly fades = new Map<string, Fade>();
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
  private disposed = false;
  /** Something changed since the stage was last drawn: the show, the overlays, Freeze, or an instrument became ready. */
  private dirty = true;
  private optionsKey = '';

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = STAGE_SIZE.width;
    canvas.height = STAGE_SIZE.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This screen cannot draw the stage.');
    this.ctx = ctx;
  }

  /** The shapes and sources to play, and the compositions the stage has for them (by source id). */
  setShow(show: PlayShow, projects: ReadonlyMap<string, Project>): void {
    this.show = show;
    this.projects = new Map(projects);
    this.dirty = true;
    // Fades start when a shape changes source, or its source changes instrument. The old picture is taken before
    // the old source is let go, so the shape holds it while the new one starts.
    const now = performance.now();
    for (const shape of show.shapes) {
      const next: Playing = { sourceId: shape.sourceId, kinds: kindsOf(shape.sourceId ? this.projects.get(shape.sourceId) : null) };
      const before = this.playing.get(shape.id);
      if (shouldFade(before, next)) {
        const old = before!.sourceId ? this.slots.get(before!.sourceId)?.frame : null;
        // Changing again before the last change was ready keeps fading from what is on the wall, not from the colour.
        const from = old ? copyFrame(old, old.width, old.height, null) : this.fades.get(shape.id)?.from ?? shape.colour;
        this.fades.set(shape.id, { from, start: shape.sourceId === null ? now : null });
      }
      this.playing.set(shape.id, next);
    }
    for (const id of [...this.playing.keys()]) if (!show.shapes.some(s => s.id === id)) { this.playing.delete(id); this.fades.delete(id); }
    for (const id of [...this.outlines.keys()]) if (!show.shapes.some(s => s.id === id)) { this.outlines.delete(id); this.faders.delete(id); }
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
  setFrozen(frozen: boolean): void { if (frozen !== this.frozen) { this.frozen = frozen; this.dirty = true; } }
  /** Draw the stage again on the next frame even if nothing changed: the operator screen draws its own marks over it. */
  invalidate(): void { this.dirty = true; }

  /**
   * Advances the clock, draws every source that is due, and composites the stage. Returns whether the stage was drawn:
   * a still show (nothing playing, no fade, nothing changed) is not drawn again.
   */
  frame(now: number): boolean {
    if (this.disposed) return false;
    const started = performance.now();
    const seconds = this.last === null ? 0 : (now - this.last) / 1000;
    this.last = now;
    const scale = GOVERNOR_SCALES[this.governor.level];
    const draw = !this.frozen && drawsThisFrame(this.governor.level, this.frameIndex);

    this.overLimit.clear();
    let rendered = false;
    for (const source of this.show.sources) {
      const project = this.projects.get(source.id);
      if (!project) continue;
      // Only sources some visible shape plays are started; one whose shapes are all hidden gives its context back.
      const users = this.show.shapes.filter(s => s.sourceId === source.id && shownOnWall(this.show, s, this.options.solo));
      if (!users.length) { const idle = this.slots.get(source.id); if (idle) this.release(source.id, idle); continue; }
      const slot = this.slot(source.id, now);
      if (!slot) continue;
      if (project !== slot.project && project !== slot.pending && project !== slot.failedProject) this.prepare(slot, project);
      if (!slot.project || !slot.renderer) continue;
      if (!this.frozen) slot.phase = advancePhase(slot.phase, seconds, slot.project, source.speed);
      if (!draw) continue;
      // Drawn at the size of the largest shape playing it on the stage.
      const size = users.map(s => sourceSize(s.points, scale)).reduce((a, b) => ({ width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) }));
      try {
        slot.renderer.render(slot.project, slot.phase, size.width, size.height);
        slot.frame = copyFrame(slot.canvas, size.width, size.height, slot.frame);
        rendered = true;
        if (slot.failedProject === null) slot.failed = null;
      } catch (error) { slot.failed = String((error as Error)?.message ?? error); }
    }

    const drawn = this.dirty || rendered || this.fades.size > 0;
    if (drawn) { this.composite(now); this.dirty = false; }
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
      ],
      prepares: Object.fromEntries([...this.slots].map(([id, s]) => [id, s.prepares])),
      edgeBuilds: this.edgeBuilds,
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const [id, slot] of this.slots) this.release(id, slot);
  }

  /** Lets a source go, and gives its graphics context back now rather than whenever it is garbage collected. */
  private release(id: string, slot: Slot): void {
    slot.renderer?.dispose();
    slot.renderer = null;
    this.dirty = true; // its shape now plays its colour
    const gl = slot.canvas.getContext('webgl2') ?? slot.canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.slots.delete(id);
  }

  /** The source's slot, started if need be. Null while over the limit or waiting to restart after a lost context. */
  private slot(id: string, now: number): Slot | null {
    const existing = this.slots.get(id);
    if (existing) return existing;
    if ((this.restartAt.get(id) ?? 0) > now) return null;
    if (this.slots.size >= MAX_LIVE_INSTRUMENTS) { this.overLimit.add(id); return null; }
    this.restartAt.delete(id);
    const canvas = document.createElement('canvas');
    const slot: Slot = { canvas, renderer: null, project: null, pending: null, phase: 0, frame: null, failed: null, failedProject: null, prepares: 0 };
    // A lost context (the graphics card reset, or too many contexts) drops the source: its shape plays its colour
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
    const ctx = this.ctx, { width: W, height: H } = STAGE_SIZE;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    if (this.options.blackout) { ctx.restore(); return; }
    // The test grid shows outlines, names and numbers instead of content.
    if (!this.options.testGrid && !this.options.outlinesOnly) {
      for (const shape of this.show.shapes) if (shownOnWall(this.show, shape, this.options.solo)) this.drawShape(shape, now);
    }
    ctx.restore();
    drawCommands(ctx, stageCommands(this.show, this.options).filter(c => c.kind !== 'fill'));
  }

  /** The shape's outline and holes as one path, made again only when its geometry changes. */
  private outline(shape: Shape): Outline {
    const held = this.outlines.get(shape.id);
    // An unchanged show hands over the same shape objects, so most frames need no comparison at all.
    if (held && held.shape === shape) return held;
    const key = JSON.stringify([shape.points, shape.holes]);
    if (held && held.key === key) { held.shape = shape; return held; }
    const path = new Path2D();
    for (const ring of [shape.points, ...shape.holes]) traceRing(path, ringPx(ring));
    const b = ringBounds([shape.points]);
    const box = { x: b.x0 * STAGE_SIZE.width, y: b.y0 * STAGE_SIZE.height, w: (b.x1 - b.x0) * STAGE_SIZE.width, h: (b.y1 - b.y0) * STAGE_SIZE.height };
    const made = { shape, key, path, box };
    this.outlines.set(shape.id, made);
    return made;
  }

  /**
   * The shape's fade picture, at half resolution over its box: the outline filled, worn back by half the soft edge,
   * blurred, and cut by the outline again, so the content fades to nothing at the outline.
   */
  private fader(shape: Shape, outline: Outline): OffscreenCanvas {
    const held = this.faders.get(shape.id);
    if (held && held.shape === shape) return held.picture;
    const key = fadeKey(shape);
    if (held && held.key === key) { held.shape = shape; return held.picture; }
    const { width, height, scale } = fadeSize(outline.box);
    const draw = (canvas: OffscreenCanvas) => {
      const c = canvas.getContext('2d')!;
      c.setTransform(scale, 0, 0, scale, -outline.box.x * scale, -outline.box.y * scale);
      return c;
    };
    // Worn back by 0.6 of the edge and blurred by a quarter of it, the outline sits 2.4 blur widths out: under 1 % is left there.
    const soft = effectiveSoftEdge(shape.softEdge, outline.box);
    const worn = new OffscreenCanvas(width, height), w = draw(worn);
    w.fillStyle = '#ffffff'; w.fill(outline.path, 'evenodd');
    w.globalCompositeOperation = 'destination-out'; w.lineWidth = soft * 1.2; w.lineJoin = 'round'; w.stroke(outline.path);
    const picture = held?.picture.width === width && held.picture.height === height ? held.picture : new OffscreenCanvas(width, height);
    const p = picture.getContext('2d')!;
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.globalCompositeOperation = 'source-over';
    p.clearRect(0, 0, width, height);
    p.filter = `blur(${Math.max(0.5, soft / 4 * scale)}px)`;
    p.drawImage(worn, 0, 0);
    p.filter = 'none';
    p.globalCompositeOperation = 'destination-in';
    p.setTransform(scale, 0, 0, scale, -outline.box.x * scale, -outline.box.y * scale);
    p.fillStyle = '#ffffff'; p.fill(outline.path, 'evenodd');
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.globalCompositeOperation = 'source-over';
    this.faders.set(shape.id, { shape, key, picture });
    this.edgeBuilds++;
    return picture;
  }

  /**
   * One shape: its source's picture covering its bounding box (or its colour, or black for a Blocker), cut by its
   * outline and holes. With a soft edge it is put together on the scratch canvas and faded there first. Then its border.
   */
  private drawShape(shape: Shape, now: number): void {
    const ctx = this.ctx;
    const outline = this.outline(shape), box = outline.box;
    // The part of the box on the stage: a curve may bulge past the edge, and nothing there is seen.
    const vx0 = Math.max(0, box.x), vy0 = Math.max(0, box.y);
    const vw = Math.min(STAGE_SIZE.width, box.x + box.w) - vx0, vh = Math.min(STAGE_SIZE.height, box.y + box.h) - vy0;
    const soft = shape.softEdge > 0 && vw >= 1 && vh >= 1;
    // With a soft edge the content is put together on the scratch canvas, whose origin is the visible box's corner;
    // otherwise it is drawn straight onto the stage, clipped.
    let target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D = ctx;
    let at = { x: box.x, y: box.y };
    if (soft) {
      if (!this.scratch) this.scratch = new OffscreenCanvas(STAGE_SIZE.width, STAGE_SIZE.height);
      target = this.scratch.getContext('2d')!;
      target.globalCompositeOperation = 'source-over';
      target.globalAlpha = 1;
      target.clearRect(0, 0, Math.ceil(vw) + 1, Math.ceil(vh) + 1);
      at = { x: box.x - vx0, y: box.y - vy0 };
    } else {
      ctx.save();
      ctx.clip(outline.path, 'evenodd');
    }
    const paintWith = (content: Frame | string, alpha: number) => {
      target.globalAlpha = alpha;
      if (typeof content === 'string') { target.fillStyle = content; target.fillRect(at.x, at.y, box.w, box.h); }
      else target.drawImage(content, at.x, at.y, box.w, box.h);
    };

    if (shape.blocker) paintWith('#000000', 1);
    else this.paintContent(shape, now, paintWith);

    if (soft) {
      const t = target as OffscreenCanvasRenderingContext2D;
      const fader = this.fader(shape, outline), { scale } = fadeSize(box);
      t.globalAlpha = 1;
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(fader, at.x, at.y, fader.width / scale, fader.height / scale);
      t.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(this.scratch!, 0, 0, vw, vh, vx0, vy0, vw, vh);
      ctx.restore();
    } else ctx.restore();

    // The border sits inside the outline (the clip takes the outer half of a stroke twice as wide), so it never spills off the object.
    if (shape.border.width > 0 && !shape.blocker) {
      const colour = borderColour(shape, shape.sourceId ? this.projects.get(shape.sourceId)?.layers[0]?.palette ?? null : null);
      ctx.save();
      ctx.clip(outline.path, 'evenodd');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colour;
      ctx.lineWidth = shape.border.width * 2;
      ctx.lineJoin = 'round';
      if (shape.border.glow > 0) { ctx.shadowColor = colour; ctx.shadowBlur = shape.border.glow; }
      ctx.stroke(outline.path);
      ctx.restore();
    }
  }

  /** What the shape plays: its source's picture, or its colour, crossfading after a change. */
  private paintContent(shape: Shape, now: number, paintWith: (content: Frame | string, alpha: number) => void): void {
    const slot = shape.sourceId ? this.slots.get(shape.sourceId) : undefined;
    const wanted = shape.sourceId ? this.projects.get(shape.sourceId) : undefined;
    // A source that will not play (failing, over the limit, restarting, or with no composition) plays the shape's colour.
    const cannotPlay = shape.sourceId !== null && (!slot || !slot.renderer || (slot.failedProject !== null && slot.failedProject === wanted) || !wanted);
    const picture = shape.sourceId === null || cannotPlay ? shape.colour : slot?.project && slot.frame ? slot.frame : null;
    // A fade waits for the composition the shape should now play, not one still drawing from before.
    const ready = cannotPlay || shape.sourceId === null ? shape.colour : slot?.project === wanted && slot?.frame ? slot.frame : null;
    const fade = this.fades.get(shape.id);
    if (fade) {
      // The old picture holds until the new one is ready, then they crossfade.
      if (ready && fade.start === null) fade.start = now;
      const a = fade.start === null ? 0 : fadeAlpha(fade.start, now);
      paintWith(fade.from, 1);
      if (ready && a > 0) paintWith(ready, a);
      if (a >= 1) this.fades.delete(shape.id);
    } else if (picture) paintWith(picture, 1);
    else paintWith(shape.colour, 1); // a source not ready yet plays the shape's colour, never black
  }
}
