/** Directed stream-function flow. Design references and limitations:
 * docs/projection-media-direction-2026-11-10.md (Bridson et al.; teamLab).
 * This analytic field is not a Navier–Stokes fluid solver.
 */
export const FLOW_STEPS = 64;
export const TAU = Math.PI * 2;
export const wrapUnit = (x: number) => ((x % 1) + 1) % 1;
export const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
export function flowHash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export interface FlowSettings { travel: number; curl: number; eddy: number; detail: number; direction: number; obstacle: number; seed: number;boundary?:(x:number,y:number)=>{distance:number;nx:number;ny:number} }
export function flowVelocity(x: number, y: number, time: number, p: FlowSettings): [number, number] {
  const c = Math.cos(p.direction), s = Math.sin(p.direction);
  const X = c * x + s * y, Y = -s * x + c * y;
  const t = time * TAU, k = p.eddy, z = (p.seed % 997) * .017;
  // Curl of a sum of stream functions. Different scales have independent phases.
  let vx = .35 + p.travel * 1.6, vy = 0;
  vx += p.curl * 1.6 * Math.sin(X * k + .27 * Math.sin(t + z)) * Math.cos(Y * k + .36 * Math.cos(2 * t - .4));
  vy -= p.curl * 1.6 * Math.cos(X * k + .27 * Math.sin(t + z)) * Math.sin(Y * k + .36 * Math.cos(2 * t - .4));
  vx += p.detail * .28 * Math.cos(X * k * 2.7 + Math.sin(3 * t + z)) * Math.cos(Y * k * 2.7 - .2 * Math.sin(t));
  vy += p.detail * .28 * Math.sin(X * k * 2.7 + Math.sin(3 * t + z)) * Math.sin(Y * k * 2.7 - .2 * Math.sin(t));
  let ox = c * vx - s * vy, oy = s * vx + c * vy;
  if (p.obstacle > 0) {
    const radius = p.obstacle, r = Math.hypot(x, y), nx = x / Math.max(r, 1e-6), ny = y / Math.max(r, 1e-6);
    // Remove inward velocity in a smooth boundary band; collision projection in RK2
    // also prevents a finite integration step from tunnelling through the circle.
    const band = 1 - smooth((r - radius) / .35);
    const inward = Math.min(0, ox * nx + oy * ny);
    ox -= nx * inward * band; oy -= ny * inward * band;
    const side = Y < 0 ? -1 : 1;
    ox += -s * side * band * .9; oy += c * side * band * .9;
  }
  if(p.boundary){const f=p.boundary(x,y),band=1-smooth(f.distance/.2),inward=Math.min(0,ox*f.nx+oy*f.ny);ox-=f.nx*inward*band;oy-=f.ny*inward*band;}
  return [ox, oy];
}
export function flowStep(x: number, y: number, time: number, dt: number, p: FlowSettings): [number, number] {
  const a = flowVelocity(x, y, time, p), b = flowVelocity(x + a[0] * dt * .5, y + a[1] * dt * .5, time + dt * .5, p);
  let X = x + b[0] * dt, Y = y + b[1] * dt;
  const r = Math.hypot(X, Y);
  if (r < p.obstacle) { const angle = r > 1e-9 ? Math.atan2(Y, X) : p.direction + Math.PI / 2; X = Math.cos(angle) * (p.obstacle + .0001); Y = Math.sin(angle) * (p.obstacle + .0001); }
  if(p.boundary)for(let i=1;i<=4;i++){const f=p.boundary(x+(X-x)*i/4,y+(Y-y)*i/4);if(f.distance<0){X+=f.nx*(-f.distance+.001);Y+=f.ny*(-f.distance+.001);}}
  return [X, Y];
}
/** A monotonically advancing periodic time warp. Endpoints and derivatives agree. */
export function phraseTime(time: number, amount: number, phrase: number): number {
  const t = wrapUnit(time);
  if (phrase === 1) return t - amount * .78 * Math.sin(TAU * t) / TAU;
  if (phrase === 2) return t + amount * .3 * (Math.sin(TAU * t + .8) - Math.sin(.8)) / TAU + amount * .16 * Math.sin(2 * TAU * t) / (2 * TAU);
  return t;
}
