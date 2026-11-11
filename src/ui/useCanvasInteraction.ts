import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Layer, ParameterDefinition } from '../shared/types';
import type { VariationLocks } from '../core/project';
import { canvasAxes, panFromDrag, sameCanvasValues, shapeFromDrag, wheelZoomFactor, zoomAt } from '../core/canvas-interaction';

interface Options {
  canvas: RefObject<HTMLCanvasElement | null>;
  layer: Layer | undefined;
  locks: VariationLocks;
  blocked: boolean;
  onChange: (layer: Layer, record: boolean) => void;
  onVary: (id: string) => void;
  onNotice: (message: string) => void;
}
interface Gesture {
  pointer: number; mode: 'shape' | 'pan'; base: Layer; axes: ParameterDefinition[];
  x: number; y: number; width: number; height: number; moved: boolean; changed: boolean;
  lastX: number; lastY: number; dx: number; dy: number;
}
export interface CanvasFeedback { mode: 'shape' | 'pan' | 'zoom' | null; x: number; y: number }

export function useCanvasInteraction(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [control, setControl] = useState(false);
  const [feedback, setFeedback] = useState<CanvasFeedback>({ mode: null, x: 0, y: 0 });
  const release = useRef<() => void>(() => {});
  useEffect(() => {
    const element = latest.current.canvas.current;
    if (!element) return;
    let gesture: Gesture | null = null, frame = 0;
    let pending: { x: number; y: number; fine: boolean } | null = null;
    let wheel: { id: string; time: number } | null = null;
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
    const enabled = () => !latest.current.blocked && latest.current.layer?.visible;
    const transformAnimated = (layer: Layer) => ['x', 'y', 'scale'].some(key => layer.modulations[`transform.${key}`]);
    const update = (next: Layer, record: boolean) => {
      if (!enabled() || latest.current.layer?.id !== next.id || sameCanvasValues(next, latest.current.layer)) return false;
      latest.current.onChange(next, record);
      latest.current = { ...latest.current, layer: next };
      return true;
    };
    const apply = () => {
      frame = 0;
      const point = pending, g = gesture; pending = null;
      if (!g || !point || !enabled() || latest.current.layer?.id !== g.base.id) return;
      const px = point.x - g.x, py = point.y - g.y;
      if (!g.moved && Math.hypot(px, py) < 4) return;
      g.moved = true;
      const speed = point.fine ? .2 : 1;
      g.dx += (point.x - g.lastX) / g.width * speed;
      g.dy += (point.y - g.lastY) / g.height * speed;
      g.lastX = point.x; g.lastY = point.y;
      const next = g.mode === 'pan' ? { ...g.base, transform: panFromDrag(g.base.transform, g.dx, g.dy) } : shapeFromDrag(g.base, g.axes, g.dx, g.dy);
      if (update(next, !g.changed)) g.changed = true;
      const rect = element.parentElement!.getBoundingClientRect();
      setFeedback({ mode: g.mode, x: point.x - rect.left, y: point.y - rect.top });
    };
    const finish = () => {
      if (frame) cancelAnimationFrame(frame);
      apply();
      const pointer = gesture?.pointer; gesture = null; pending = null; wheel = null;
      if (pointer !== undefined && element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
      setFeedback({ mode: null, x: 0, y: 0 });
    };
    release.current = finish;
    const down = (event: PointerEvent) => {
      if (!enabled() || !event.isPrimary || gesture || (event.button !== 0 && !(event.ctrlKey && event.button === 2))) return;
      wheel = null;
      const layer = latest.current.layer!;
      if (event.ctrlKey && transformAnimated(layer)) {
        latest.current.onNotice('Remove position or size animation routes in Motion to pan or zoom this layer.'); return;
      }
      event.preventDefault(); element.focus({ preventScroll: true });
      clearTimeout(feedbackTimer);
      const rect = element.getBoundingClientRect();
      gesture = { pointer: event.pointerId, mode: event.ctrlKey ? 'pan' : 'shape', base: layer,
        axes: canvasAxes(layer, latest.current.locks), x: event.clientX, y: event.clientY,
        width: Math.max(1, rect.width), height: Math.max(1, rect.height), moved: false, changed: false,
        lastX: event.clientX, lastY: event.clientY, dx: 0, dy: 0 };
      setControl(event.ctrlKey);
      element.setPointerCapture(event.pointerId);
      if (event.ctrlKey) setFeedback({ mode: 'pan', x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.pointer !== event.pointerId) { setControl(event.ctrlKey); return; }
      pending = { x: event.clientX, y: event.clientY, fine: event.shiftKey };
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const up = (event: PointerEvent) => {
      const g = gesture;
      if (!g || g.pointer !== event.pointerId) return;
      pending = { x: event.clientX, y: event.clientY, fine: event.shiftKey };
      if (frame) cancelAnimationFrame(frame);
      apply();
      const click = !g.moved && g.mode === 'shape' && !event.ctrlKey && enabled() && latest.current.layer?.id === g.base.id;
      finish();
      if (click) latest.current.onVary(g.base.id);
      else if (g.moved && g.mode === 'shape' && !g.axes.length) latest.current.onNotice(g.base.kind === 'image' ? 'Use Ctrl-drag to position an image layer, or click to vary its finish.' : 'Shape controls are locked or animated. Unlock Structure in Keep or remove a shape animation route in Motion.');
    };
    const cancel = (event: PointerEvent) => { if (gesture?.pointer === event.pointerId) finish(); };
    const zoom = (factor: number, x: number, y: number, group = false) => {
      const layer = latest.current.layer;
      if (!enabled() || !layer) return;
      if (transformAnimated(layer)) { latest.current.onNotice('Remove position or size animation routes in Motion to pan or zoom this layer.'); return; }
      const now = performance.now();
      const record = !group || !wheel || wheel.id !== layer.id || now - wheel.time > 250;
      if (update({ ...layer, transform: zoomAt(layer.transform, factor, x, y) }, record)) {
        wheel = group ? { id: layer.id, time: now } : null;
        setFeedback({ mode: 'zoom', x: 0, y: 0 });
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => setFeedback({ mode: null, x: 0, y: 0 }), 600);
      }
    };
    const scroll = (event: WheelEvent) => {
      if (!event.ctrlKey || !enabled()) return;
      event.preventDefault();
      if (gesture) return;
      const rect = element.getBoundingClientRect();
      zoom(wheelZoomFactor(event.deltaY * (event.shiftKey ? .2 : 1), event.deltaMode, rect.height),
        (event.clientX - rect.left) / rect.width - .5, (event.clientY - rect.top) / rect.height - .5, true);
    };
    const key = (event: KeyboardEvent) => {
      setControl(event.ctrlKey);
      // Layout shortcuts can move the canvas or focus a drawer during capture.
      // Finish against the original view before the workspace changes it.
      if (document.activeElement === element && !event.ctrlKey && !event.metaKey && !event.altKey &&
        ['b', 'f', 'i', 'l'].includes(event.key.toLowerCase())) finish();
      // End pointer and wheel transactions before shortcuts can change history.
      if (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && ['z', 's', 'o'].includes(event.key.toLowerCase())) finish();
      if (document.activeElement !== element || !enabled() || event.metaKey || event.altKey || gesture) return;
      const layer = latest.current.layer!;
      if (['Enter', ' '].includes(event.key) && !event.ctrlKey) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) latest.current.onVary(layer.id);
      } else if (event.ctrlKey && ['+', '=', '-', '_'].includes(event.key)) {
        event.preventDefault(); zoom(['-', '_'].includes(event.key) ? 1 / 1.1 : 1.1, 0, 0);
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        const x = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const y = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        const amount = event.shiftKey ? .002 : .01;
        if (event.ctrlKey) {
          if (transformAnimated(layer)) { latest.current.onNotice('Remove position or size animation routes in Motion to pan or zoom this layer.'); return; }
          update({ ...layer, transform: panFromDrag(layer.transform, x * amount, y * amount) }, true);
        } else update(shapeFromDrag(layer, canvasAxes(layer, latest.current.locks), x * amount, y * amount), true);
      }
    };
    const keyup = (event: KeyboardEvent) => setControl(event.ctrlKey);
    const blur = () => { finish(); setControl(false); };
    const context = (event: MouseEvent) => { if (event.ctrlKey) event.preventDefault(); };
    const outside = (event: PointerEvent) => { if (event.target !== element) { finish(); } };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
    element.addEventListener('lostpointercapture', cancel);
    element.addEventListener('wheel', scroll, { passive: false });
    element.addEventListener('contextmenu', context);
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    window.addEventListener('pointerdown', outside);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(feedbackTimer);
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', cancel);
      element.removeEventListener('lostpointercapture', cancel); element.removeEventListener('wheel', scroll);
      element.removeEventListener('contextmenu', context);
      window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur); window.removeEventListener('pointerdown', outside);
      release.current = () => {};
    };
  }, []);
  useEffect(() => { release.current(); }, [options.layer?.id, options.blocked]);
  return { control, feedback, axes: options.layer ? canvasAxes(options.layer, options.locks) : [] };
}
