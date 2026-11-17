import { useEffect, useRef } from 'react';
import { paint } from '../map/draw';
import { STAGE_SIZE } from '../map/show';
import { applyMapMessage, initialWall } from '../map/wall';

const PREVIEW = [480, 270] as const;
const PREVIEW_EVERY_MS = 100;

/** The wall window: nothing but the picture. It is told what to show by the studio window. */
export default function MapOutput() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const bridge = window.studio?.map;
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!bridge || !element || !context) return;
    let state = initialWall();
    // The operator screen shows a small picture of what the wall really has, sent after each change.
    let changed = true, busy = false;
    const draw = () => { paint(context, state.show, state.options); changed = true; };
    draw();
    const small = new OffscreenCanvas(...PREVIEW), smallContext = small.getContext('2d')!;
    const sending = setInterval(() => {
      if (!changed || busy) return;
      changed = false; busy = true;
      smallContext.drawImage(element, 0, 0, ...PREVIEW);
      void small.convertToBlob({ type: 'image/jpeg', quality: 0.7 }).then(blob => blob.arrayBuffer()).then(bytes => bridge.sendPreview(bytes)).catch(() => {}).finally(() => { busy = false; });
    }, PREVIEW_EVERY_MS);
    const off = bridge.onMessage(message => { state = applyMapMessage(state, message); draw(); });
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') bridge.requestClose(); };
    window.addEventListener('keydown', key);
    bridge.ready();
    return () => { clearInterval(sending); window.removeEventListener('keydown', key); off(); };
  }, []);
  return <div className="live-output"><canvas ref={canvas} width={STAGE_SIZE.width} height={STAGE_SIZE.height} /></div>;
}
