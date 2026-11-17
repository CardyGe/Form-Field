import { useEffect, useRef } from 'react';
import { paint, type DrawOptions } from '../map/draw';
import { acceptMapMessage, type MapMessage } from '../map/messages';
import { STAGE_SIZE, createShow, validateShow, type ShowDocument } from '../map/show';

interface WallState { show: ShowDocument; options: DrawOptions }

const PREVIEW = [480, 270] as const;
const PREVIEW_EVERY_MS = 100;

export function initialWall(): WallState {
  return { show: createShow(), options: { blackout: false, testGrid: false, identifyId: null, crosshair: null, selectedId: null, selectedIndex: null, outlinesOnly: false, invalidIds: [] } };
}

/** The next wall state for a message. A refused message changes nothing, so the last good picture stays up. */
export function applyMapMessage(state: WallState, value: unknown): WallState {
  if (!acceptMapMessage(value)) return state;
  const message: MapMessage = value;
  switch (message.type) {
    case 'show': return { ...state, show: validateShow(message.show).show };
    case 'blackout': return { ...state, options: { ...state.options, blackout: message.on === true } };
    case 'testGrid': return { ...state, options: { ...state.options, testGrid: message.on === true } };
    case 'identify': return { ...state, options: { ...state.options, identifyId: message.shapeId } };
    case 'crosshair': return { ...state, options: { ...state.options, crosshair: message.point, selectedId: message.shapeId } };
  }
}

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
