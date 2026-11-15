import { useEffect, useRef, useState } from 'react';
import { Stage } from '../live/Stage';
import { validateLiveSettings } from '../live/settings';

const PREVIEW = [480, 270] as const;
const PREVIEW_EVERY_MS = 100;

/** The artwork window: nothing but the picture. It is told what to do by the studio window. */
export default function LiveOutput() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    const bridge = window.studio?.live;
    if (!canvas.current || !bridge) return;
    let stage: Stage;
    try { stage = new Stage(canvas.current); } catch (error) { setFailure((error as Error).message); return; }
    const off = bridge.onMessage(message => {
      if (message.type === 'settings') stage.apply(validateLiveSettings(message.settings));
      else if (message.type === 'blackout') stage.renderer.blackout = message.on === true;
      else if (message.type === 'clear') stage.renderer.clear();
    });
    // A small picture for the operator, taken straight after a frame is drawn, ten times a second.
    const small = new OffscreenCanvas(...PREVIEW), context = small.getContext('2d')!;
    let raf = 0, sent = 0, busy = false, fps = 0, counted = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - counted >= 1000) { fps = stage.renderer.stats().fps; counted = now; }
      if (busy || now - sent < PREVIEW_EVERY_MS) return;
      sent = now; busy = true;
      context.drawImage(canvas.current!, 0, 0, ...PREVIEW);
      void small.convertToBlob({ type: 'image/jpeg', quality: .7 }).then(blob => blob.arrayBuffer()).then(bytes => bridge.sendPreview(bytes, fps)).catch(() => {}).finally(() => { busy = false; });
    };
    raf = requestAnimationFrame(tick);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') bridge.requestClose(); };
    window.addEventListener('keydown', key);
    bridge.ready();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); off(); stage.dispose(); };
  }, []);
  return <div className="live-output">{failure ? <p>{failure}</p> : <canvas ref={canvas} />}</div>;
}
