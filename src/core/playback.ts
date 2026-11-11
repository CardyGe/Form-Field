import type { Project } from '../shared/types';
/** Evolving chemistry has a finite clip clock; it must never silently wrap. */
export function isEvolving(project:Project):boolean {
  return project.layers.some(l=>l.visible&&l.kind==='livingink'&&l.params.inkMode===2);
}
export function playbackPhase(phase:number,advance:number,project:Project):number {
  const tau=Math.PI*2;
  return isEvolving(project)?Math.max(0,Math.min(tau,phase+advance)):((phase+advance)%tau+tau)%tau;
}
