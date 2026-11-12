import type { Layer, Project } from '../shared/types';
/** Evolving chemistry with Loop return at zero has a finite clip clock; it must never silently wrap. */
export function finiteEvolving(layer:Layer):boolean {
  return layer.kind==='livingink'&&layer.params.inkMode===2&&!((layer.params.loopReturn??0)>0);
}
export function isEvolving(project:Project):boolean {
  return project.layers.some(l=>l.visible&&finiteEvolving(l));
}
export function playbackPhase(phase:number,advance:number,project:Project):number {
  const tau=Math.PI*2;
  return isEvolving(project)?Math.max(0,Math.min(tau,phase+advance)):((phase+advance)%tau+tau)%tau;
}
