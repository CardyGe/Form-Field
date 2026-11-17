import { useEffect, useRef, useState } from 'react';
import { MapCompositor } from '../map/compositor';
import { STAGE_SIZE } from '../map/show';
import { applyMapMessage, initialWall } from '../map/wall';

const PREVIEW = [480, 270] as const;
const PREVIEW_EVERY_MS = 100;
const REPORT_EVERY_MS = 1000;

/** The wall window: nothing but the picture. It is told what to show by the studio window, and plays the instruments itself. */
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
    const apply = () => {
      compositor.setShow(state.show, new Map([...state.projects].map(([id, held]) => [id, held.project])));
      compositor.setOptions(state.options);
      compositor.setFrozen(state.freeze);
    };
    apply();
    const off = bridge.onMessage(message => { state = applyMapMessage(state, message); apply(); });

    // The operator screen gets a small picture of the wall, and once a second how the wall is keeping up.
    const small = new OffscreenCanvas(...PREVIEW), smallContext = small.getContext('2d')!;
    let raf = 0, busy = false, sentPicture = 0, sentReport = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      compositor.frame(now);
      // For scripted checks: what the compositor reports, read from the page.
      (window as unknown as { __mapStats?: unknown }).__mapStats = compositor.stats();
      if (now - sentReport >= REPORT_EVERY_MS) { sentReport = now; bridge.sendState(compositor.stats()); }
      if (busy || now - sentPicture < PREVIEW_EVERY_MS) return;
      // Taken straight after the frame is drawn.
      sentPicture = now; busy = true;
      smallContext.drawImage(element, 0, 0, ...PREVIEW);
      void small.convertToBlob({ type: 'image/jpeg', quality: 0.7 }).then(blob => blob.arrayBuffer()).then(bytes => bridge.sendPreview(bytes)).catch(() => {}).finally(() => { busy = false; });
    };
    raf = requestAnimationFrame(tick);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') bridge.requestClose(); };
    window.addEventListener('keydown', key);
    bridge.ready();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); off(); compositor.dispose(); };
  }, []);
  return <div className="live-output">{failure ? <p>{failure}</p> : <canvas ref={canvas} width={STAGE_SIZE.width} height={STAGE_SIZE.height} />}</div>;
}
