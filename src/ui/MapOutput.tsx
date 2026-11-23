import { useEffect, useRef, useState } from 'react';
import { MapCompositor, MAX_ARMED, type ShapeBlend, type SwapResult } from '../map/compositor';
import { performDraw } from '../perform/wall-values';
import { isShapeShown, LIVE_SOURCE_ID, STAGE_SIZE } from '../map/show';
import { applyMapMessage, initialWall, swapOutcome } from '../map/wall';
import { overlayShow, type ZonePicture } from '../perform/resolve';
import { stepWallPerform, type WallPerform } from '../perform/wall-perform';
import PreviewWorker from '../map/preview-worker?worker&inline';

/** At most five previews a second, and only after the wall has changed. */
const PREVIEW_EVERY_MS = 200;
const REPORT_EVERY_MS = 1000;
/** Perform starting or ending changes the wall like a short scene switch, never as a jump. */
const HANDOVER_FADE_MS = 400;
/** After End show the last picture stays up until Map's own looks are ready, but never longer than this. */
const HANDOVER_WAIT_MS = 2000;

/** The wall window: nothing but the picture. It is told what to show by the studio window, and plays the instruments itself. */
const STALE_SIGNALS_MS = 500;
export default function MapOutput() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    const bridge = window.studio?.map;
    const element = canvas.current;
    if (!bridge || !element) return;
    let compositor: MapCompositor;
    try { compositor = new MapCompositor(element); }
    catch (error) { setFailure((error as Error).message); return; }
    let state = initialWall();
    // Signals stop arriving if the studio stops sending them: after half a second the targets go back to their set values.
    let heard = 0;
    // Perform: while a show runs the wall draws its zones over the Map show, which is never changed. `ending` keeps a
    // finished show's last picture up until Map's own looks are ready. With no show, none of this does anything.
    let ending: { zones: ZonePicture[]; looks: string[]; until: number } | null = null;
    let overlay: { show: typeof state.show; zones: ZonePicture[]; made: typeof state.show } | null = null;
    let valuesFrom: Pick<WallPerform, 'zones' | 'values' | 'phaseOffsets'> | null = null;
    // A show running when this wall opened: its first show comes up through the handover, so a zone waits in black
    // until its look is ready and never shows its flat fill.
    let awaitingShow = false;
    const shown = () => {
      const zones = state.perform.active ? state.perform.zones : ending?.zones;
      if (!zones) return state.show;
      // The same overlay while neither the show nor the zones change, so the wall's pictures are not made again.
      if (!overlay || overlay.show !== state.show || overlay.zones !== zones) overlay = { show: state.show, zones, made: overlayShow(state.show, zones) };
      return overlay.made;
    };
    /** Brightness, hue, speed and master reach the compositor clamped (performDraw), and only when they change. */
    const syncValues = () => {
      const p = state.perform;
      // A show that has ended: its master, brightness and hue ease back to plain with the handover, never in one step.
      if (!p.active) { if (!ending && valuesFrom) { valuesFrom = null; compositor.setPerformValues(null, HANDOVER_FADE_MS); } return; }
      if (valuesFrom && valuesFrom.zones === p.zones && valuesFrom.values === p.values && valuesFrom.phaseOffsets === p.phaseOffsets) return;
      valuesFrom = { zones: p.zones, values: p.values, phaseOffsets: p.phaseOffsets };
      compositor.setPerformValues(performDraw(p));
    };
    const apply = (fade?: number | ReadonlyMap<string, ShapeBlend>, handover = false) => {
      compositor.setShow(shown(), new Map([...state.projects].map(([id, held]) => [id, held.project])), fade, handover);
      compositor.setSignals(state.signals);
      compositor.setOptions(state.options);
      compositor.setFrozen(state.freeze);
      compositor.setLive(state.live);
      compositor.setCorners(state.show.stageCorners);
      syncValues();
    };
    apply();
    let swapResults: SwapResult[] = [];
    const off = bridge.onMessage(message => {
      const kind = (message as { type?: string })?.type;
      const before = state.perform, wallBefore = state;
      state = applyMapMessage(state, message);
      // A draft applied during a show: the running look holds until the new one is ready, then crossfades. Always answered.
      const outcome = swapOutcome(wallBefore, state, message);
      if (outcome) {
        const { id, revision } = message as { id: string; revision: number };
        if (outcome === 'swap') compositor.crossfadeNext(id, revision); else swapResults.push({ id, revision, result: outcome });
      }
      if (typeof kind === 'string' && kind.startsWith('perform')) {
        // A refused message, or one for a show that is not running, changes nothing.
        if (state.perform === before) return;
        if (kind === 'performStart') { ending = null; awaitingShow = state.show.shapes.length === 0; compositor.setArmed(new Set()); apply(HANDOVER_FADE_MS); }
        else if (kind === 'performEnd') {
          awaitingShow = false;
          // Map's own looks are made ready behind the show's last picture; the tick hands over when they are.
          const looks = [...new Set(state.show.shapes.filter(s => !s.blocker && s.sourceId !== null && s.sourceId !== LIVE_SOURCE_ID && isShapeShown(state.show, s)).map(s => s.sourceId!))].slice(0, MAX_ARMED);
          ending = { zones: before.zones, looks, until: performance.now() + HANDOVER_WAIT_MS };
          compositor.setArmed(new Set(looks));
        }
        else if (kind === 'performArm') compositor.setArmed(new Set(state.perform.armed));
        else if (kind === 'performValues') syncValues();
        // A launch or a cancel only changes the queue: the tick lands what is due.
        return;
      }
      // Signals come every frame: only they are passed on, not the whole show again.
      if (kind === 'signals') { heard = performance.now(); compositor.setSignals(state.signals); return; }
      if (kind === 'fade') return;
      if (kind === 'liveClear') { compositor.liveClear(); return; }
      if (kind === 'liveCaptureRoom') { compositor.liveCaptureRoom(); return; }
      if (kind === 'liveRetry') { compositor.liveRetry(); return; }
      if (kind === 'videoRetry') { compositor.videoRetry(); return; }
      // A show carrying a fade time is a scene switch, crossfading over the scene's time.
      const fadeMs = (message as { fadeMs?: unknown }).fadeMs;
      if (kind === 'show' && awaitingShow) { awaitingShow = false; apply(HANDOVER_FADE_MS, true); return; }
      if (kind === 'show' && typeof fadeMs === 'number') { apply(fadeMs); return; }
      apply();
    });

    // The operator screen gets a small picture of the wall, and once a second how the wall is keeping up.
    // The picture is taken without waiting for the graphics card and encoded in a worker, so the wall never stalls for it.
    // It is the flat stage, read back from the graphics card on a later frame, before the stage corners bend it.
    const encoder = new PreviewWorker();
    let raf = 0, busy = false, reading = false, changed = true, sentPicture = 0, sentReport = 0;
    let landed: { launchId: string; zones: number[] }[] = [], sentArmed = '';
    const report = () => {
      // While a show runs every report says which armed looks are ready; a landing or a look that failed is reported once.
      const stats = { ...compositor.stats(), ...(state.perform.active ? { armed: compositor.armedIds() } : {}), ...(landed.length ? { landed } : {}), ...(swapResults.length ? { swapResults: swapResults.slice(0, 8) } : {}) };
      landed = [];
      swapResults = swapResults.slice(8);
      sentArmed = (stats.armed ?? []).join('\n');
      // For scripted checks: what the compositor reports, read from the page.
      (window as unknown as { __mapStats?: unknown }).__mapStats = stats;
      bridge.sendState(stats);
    };
    encoder.onmessage = (event: MessageEvent<ArrayBuffer | null>) => { busy = false; if (event.data) bridge.sendPreview(event.data); };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (heard && now - heard > STALE_SIGNALS_MS) { heard = 0; state = { ...state, signals: {} }; compositor.setSignals({}); }
      if (state.perform.active) {
        // Launches land by the clock both windows share. The queue is kept even when nothing landed: a source that
        // was not ready has been moved on a bar.
        const step = stepWallPerform(state.perform, performance.timeOrigin + performance.now(), id => compositor.isReady(id));
        if (step.perform !== state.perform) state = { ...state, perform: step.perform };
        if (step.changed) apply(step.blends);
        if (step.landed.length) landed.push(...step.landed);
      } else if (ending && (performance.now() >= ending.until || ending.looks.every(id => compositor.isReady(id)))) {
        ending = null;
        compositor.setArmed(new Set());
        // Map's show fades in from what the show left on the wall; a look still not ready stays black until it is.
        apply(HANDOVER_FADE_MS, true);
      }
      if (compositor.frame(now)) changed = true;
      // The studio hears at once when a launch lands or an armed look becomes ready (or stops being).
      swapResults.push(...compositor.takeSwapResults());
      if (landed.length || swapResults.length || (state.perform.active && compositor.armedIds().join('\n') !== sentArmed)) report();
      if (reading) {
        const picture = compositor.collectPreview();
        // A readback lost with the graphics context never arrives: start again.
        if (!picture && !compositor.previewPending) { reading = false; busy = false; }
        if (picture) {
          reading = false;
          createImageBitmap(picture).then(bitmap => encoder.postMessage(bitmap, [bitmap])).catch(() => { busy = false; });
        }
      }
      if (now - sentReport >= REPORT_EVERY_MS) {
        sentReport = now;
        report();
      }
      if (busy || !changed || now - sentPicture < PREVIEW_EVERY_MS) return;
      // Started straight after a drawn frame.
      if (compositor.requestPreview()) { sentPicture = now; busy = true; reading = true; changed = false; }
    };
    raf = requestAnimationFrame(tick);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') bridge.requestClose(); };
    window.addEventListener('keydown', key);
    bridge.ready();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); off(); encoder.terminate(); compositor.dispose(); };
  }, []);
  return <div className="live-output">{failure ? <p>{failure}</p> : <canvas ref={canvas} width={STAGE_SIZE.width} height={STAGE_SIZE.height} />}</div>;
}
