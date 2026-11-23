import { useEffect, useRef, useState } from 'react';
import { MapCompositor } from '../map/compositor';
import { STAGE_SIZE } from '../map/show';
import { applyMapMessage, initialWall } from '../map/wall';
import PreviewWorker from '../map/preview-worker?worker&inline';

/** At most five previews a second, and only after the wall has changed. */
const PREVIEW_EVERY_MS = 200;
const REPORT_EVERY_MS = 1000;

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
    const apply = (fadeMs?: number) => {
      compositor.setShow(state.show, new Map([...state.projects].map(([id, held]) => [id, held.project])), fadeMs);
      compositor.setSignals(state.signals);
      compositor.setOptions(state.options);
      compositor.setFrozen(state.freeze);
      compositor.setLive(state.live);
      compositor.setCorners(state.show.stageCorners);
    };
    apply();
    const off = bridge.onMessage(message => {
      const kind = (message as { type?: string })?.type;
      state = applyMapMessage(state, message);
      // Signals come every frame: only they are passed on, not the whole show again.
      if (kind === 'signals') { heard = performance.now(); compositor.setSignals(state.signals); return; }
      if (kind === 'fade') return;
      if (kind === 'liveClear') { compositor.liveClear(); return; }
      if (kind === 'liveCaptureRoom') { compositor.liveCaptureRoom(); return; }
      if (kind === 'liveRetry') { compositor.liveRetry(); return; }
      if (kind === 'videoRetry') { compositor.videoRetry(); return; }
      if (kind === 'performanceReset') { compositor.resetPerformance(); return; }
      // A show carrying a fade time is a scene switch, crossfading over the scene's time.
      const fadeMs = (message as { fadeMs?: unknown }).fadeMs;
      if (kind === 'show' && typeof fadeMs === 'number') { apply(fadeMs); return; }
      apply();
    });

    // The operator screen gets a small picture of the wall, and once a second how the wall is keeping up.
    // The picture is taken without waiting for the graphics card and encoded in a worker, so the wall never stalls for it.
    // It is the flat stage, read back from the graphics card on a later frame, before the stage corners bend it.
    const encoder = new PreviewWorker();
    let raf = 0, busy = false, reading = false, changed = true, sentPicture = 0, sentReport = 0;
    encoder.onmessage = (event: MessageEvent<ArrayBuffer | null>) => { busy = false; if (event.data) bridge.sendPreview(event.data); };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (heard && now - heard > STALE_SIGNALS_MS) { heard = 0; state = { ...state, signals: {} }; compositor.setSignals({}); }
      if (compositor.frame(now)) changed = true;
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
        const stats = compositor.stats();
        // For scripted checks: what the compositor reports, read from the page.
        (window as unknown as { __mapStats?: unknown }).__mapStats = stats;
        bridge.sendState(stats);
      }
      if (busy || !changed || now - sentPicture < PREVIEW_EVERY_MS) return;
      // Started straight after a drawn frame.
      if (compositor.requestPreview()) { sentPicture = now; busy = true; reading = true; changed = false; }
    };
    raf = requestAnimationFrame(tick);
    (window as unknown as { __mapGuardProbe?: () => unknown }).__mapGuardProbe = () => compositor.probeGuardCost();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') bridge.requestClose(); };
    window.addEventListener('keydown', key);
    bridge.ready();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); off(); encoder.terminate(); compositor.dispose(); };
  }, []);
  return <div className="live-output">{failure ? <p>{failure}</p> : <canvas ref={canvas} width={STAGE_SIZE.width} height={STAGE_SIZE.height} />}</div>;
}
