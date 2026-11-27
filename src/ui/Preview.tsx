import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { Layer, Project } from '../shared/types';
import type { VariationLocks } from '../core/project';
import { frameCount } from '../core/timeline';
import { playbackPhase } from '../core/playback';
import { StudioRenderer } from '../rendering/StudioRenderer';
import { useCanvasInteraction } from './useCanvasInteraction';
import { previewSize } from '../rendering/preview-size';
import type { ReactivityEngine } from '../react/engine';

const TAU = Math.PI * 2;
const CONTEXT_RESTORE_WARNING_MS = 5000;
const actualDuration = (p: Project) => frameCount(p) * p.fps.den / p.fps.num;

export function Preview({ tiled, project, playing, phase, rendererRef, smokeSound, onError, onEnded, checker, layer, locks, blocked, onChange, onVary, onNotice }: {
  tiled: boolean; project: Project; playing: boolean; phase: RefObject<number>; rendererRef: RefObject<StudioRenderer | null>; onError: (s: string) => void; onEnded?:()=>void; checker: boolean; smokeSound?: ReactivityEngine | null;
  layer: Layer | undefined; locks: VariationLocks; blocked: boolean;
  onChange: (layer: Layer, record: boolean) => void; onVary: (id: string) => void; onNotice: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null), tileCanvas = useRef<HTMLCanvasElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const helpId = useId();
  const { control, feedback, axes } = useCanvasInteraction({ canvas, layer, locks, blocked, onChange, onVary, onNotice });
  const enabled = !blocked && !tiled && layer?.visible;
  const current = useRef({ project, playing,onEnded,tiled,smokeSound,onNotice }), invalidate = useRef(true);
  const prepared = useRef<Project | null>(null);
  // Meridian's quality governor gave something up to keep the preview smooth.
  const [qualityReduced, setQualityReduced] = useState(false);
  current.current = { project, playing,onEnded,tiled,smokeSound,onNotice };
  useEffect(() => { invalidate.current = true; }, [tiled]);
  useEffect(() => {
    if (!canvas.current || !host.current) return;
    let engine: StudioRenderer;
    try { engine = new StudioRenderer(canvas.current); rendererRef.current = engine; }
    catch (error) { onError(String(error)); return; }
    let alive = true, raf = 0, previous = performance.now(), lastPhase = -1, lastDrawn = -1, reduced = false;
    let box = { width: 960, height: 540 }, density = window.devicePixelRatio;
    const resize = new ResizeObserver(([entry]) => {
      box = { width: entry.contentRect.width, height: entry.contentRect.height };
      invalidate.current = true;
    });
    resize.observe(host.current);
    // three.js rebuilds its GPU state when the context returns; the project must then be prepared again.
    const surface = canvas.current;
    let lostTimer = 0, reportedLost = false;
    const onContextLost = () => {
      prepared.current = null;
      window.clearTimeout(lostTimer);
      current.current.onNotice('Graphics reset. Restoring the picture…');
      lostTimer = window.setTimeout(() => { reportedLost = true; onError('The graphics context has not come back. Reload the app to resume the saved project.'); }, CONTEXT_RESTORE_WARNING_MS);
    };
    const onContextRestored = () => {
      window.clearTimeout(lostTimer);
      if (reportedLost) { reportedLost = false; onError(''); }
      const project = current.current.project;
      void engine.prepare(project).then(() => {
        if (!alive || current.current.project !== project) return;
        prepared.current = project; invalidate.current = true;
        current.current.onNotice('Picture restored');
      }).catch(error => { if (alive && !engine.isContextLost()) onError(String(error)); });
    };
    surface.addEventListener('webglcontextlost', onContextLost);
    surface.addEventListener('webglcontextrestored', onContextRestored);
    const loop = (now: number) => {
      if (!alive) return;
      const state = current.current;
      if(density!==window.devicePixelRatio){density=window.devicePixelRatio;invalidate.current=true;}
      if (state.playing) {phase.current=playbackPhase(phase.current,Math.min((now-previous)/1000,.1)/actualDuration(state.project)*TAU,state.project);if(phase.current>=TAU)state.onEnded?.();}
      previous = now;
      // A paused feedback layer keeps refining its history for a few frames after an edit.
      if (prepared.current === state.project && (invalidate.current || phase.current !== lastPhase || engine.needsRefresh())) {
        const ratio = state.project.width / state.project.height;
        const size=previewSize(box.width,box.height,ratio,density);
        canvas.current!.style.width=`${size.cssWidth}px`;canvas.current!.style.height=`${size.cssHeight}px`;
        // Meridian's governor judges back-to-back drawn frames only: a paused preview says nothing about how heavy the show is.
        const meridian = state.project.layers.some(l => l.visible && l.kind === 'meridian');
        if (meridian && lastDrawn >= 0) engine.paceMeridian(now - lastDrawn);
        try { engine.render(state.project, phase.current, size.width, size.height,
          state.smokeSound ? { signals: state.smokeSound.signals, now, externalTempo: state.smokeSound.prefs.tempo !== 'beat', tempoOnly: !state.playing } : undefined, state.playing);
          const overlay = tileCanvas.current;
          if (state.tiled && overlay) {
            // Drawn in the same frame as the render, while the WebGL buffer is still valid.
            overlay.style.width = canvas.current!.style.width; overlay.style.height = canvas.current!.style.height;
            if (overlay.width !== size.width || overlay.height !== size.height) { overlay.width = size.width; overlay.height = size.height; }
            const g = overlay.getContext('2d')!, w = size.width / 2, h = size.height / 2;
            g.clearRect(0, 0, size.width, size.height);
            for (let i = 0; i < 4; i++) g.drawImage(canvas.current!, (i % 2) * w, Math.floor(i / 2) * h, w, h);
          }
          invalidate.current = false; lastPhase = phase.current; lastDrawn = now;
          const nowReduced = meridian && engine.meridianQuality().reduced;
          if (nowReduced !== reduced) { reduced = nowReduced; setQualityReduced(nowReduced); } }
        catch (error) { prepared.current = null; lastDrawn = -1; if (!engine.isContextLost()) onError(String(error)); }
      } else lastDrawn = -1;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false; prepared.current = null; cancelAnimationFrame(raf); resize.disconnect(); window.clearTimeout(lostTimer);
      surface.removeEventListener('webglcontextlost', onContextLost); surface.removeEventListener('webglcontextrestored', onContextRestored);
      engine.dispose(); rendererRef.current = null;
    };
  }, [onError, phase, rendererRef]);
  useEffect(() => {
    invalidate.current = true; prepared.current = null;
    let alive = true;
    void rendererRef.current?.prepare(project).then(() => { if (alive) { prepared.current = project; invalidate.current = true; } }).catch(error => { if (alive && !rendererRef.current?.isContextLost()) onError(String(error)); });
    return () => { alive = false; };
  }, [project, onError, rendererRef]);
  return <>
    <div className={`preview-host ${checker ? 'checker' : ''} ${enabled ? 'interactive' : ''} ${control ? 'pan-ready' : ''} ${feedback.mode === 'pan' ? 'is-panning' : ''}`} ref={host} data-interaction={feedback.mode ?? 'idle'}>
      <canvas ref={canvas} style={tiled ? { visibility: 'hidden' } : undefined} aria-label="Composition preview" role="button" tabIndex={0} aria-disabled={!enabled} aria-describedby={helpId} title="Click to vary · Drag to shape · Ctrl-drag to pan · Ctrl-scroll to zoom · Shift for fine control" />
      <canvas ref={tileCanvas} className="tile-preview" aria-hidden="true" hidden={!tiled} />
      {qualityReduced && <div className="m-quality-note" role="status" title="Meridian is drawing less bloom, tearing or small detail to keep the preview smooth. Lines stay sharp and Flash guard is unchanged. It comes back after a few calm seconds.">Quality reduced</div>}
      {layer && <div className="canvas-target" aria-hidden="true"><span className={enabled ? 'canvas-target-dot' : 'canvas-target-dot inactive'} /><strong>{layer.name}</strong><span>{!layer.visible ? 'Hidden' : blocked ? 'Interaction paused' : feedback.mode === 'shape' ? 'Shaping' : feedback.mode === 'pan' ? 'Panning' : feedback.mode === 'zoom' ? 'Zooming' : 'Interactive'}</span></div>}
      {feedback.mode === 'shape' && axes.length > 0 && <><div className="canvas-reticle" aria-hidden="true" style={{ left: feedback.x, top: feedback.y }} /><div className="canvas-readout" aria-hidden="true">{axes.map((d, i) => <span key={d.key}><b>{i === 0 ? '↔' : '↕'}</b>{d.label}<strong>{Number(layer!.params[d.key].toFixed(3))}</strong></span>)}</div></>}
    </div>
    <div className={`canvas-interaction-bar ${control ? 'navigation-active' : ''}`}>
      <p id={helpId}>{tiled ? 'Tiled view: turn it off to edit on the canvas.' : !layer?.visible ? 'Select a visible layer to interact' : <><span>Click to vary{axes.length > 0 ? ' · Drag to shape' : ''}</span><span><kbd>Ctrl</kbd> drag to pan · scroll to zoom</span><span className="sr-only">Hold Shift for fine control. With the canvas focused, Enter varies, arrow keys shape, Ctrl and arrow keys pan, and Ctrl plus or minus zooms. Edits apply to the selected layer and save with the project.</span></>}</p>
      <button className="canvas-reset" aria-label="Reset layer framing" title="Reset this layer’s pan and zoom" disabled={!enabled || !!layer?.modulations['transform.x'] || !!layer?.modulations['transform.y'] || !!layer?.modulations['transform.scale'] || layer?.transform.x === 0 && layer?.transform.y === 0 && layer?.transform.scale === 1} onClick={() => { if (layer) onChange({ ...layer, transform: { ...layer.transform, x: 0, y: 0, scale: 1 } }, true); }}><span>{Math.round((layer?.transform.scale ?? 1) * 100)}%</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7" /></svg></button>
    </div>
  </>;
}
