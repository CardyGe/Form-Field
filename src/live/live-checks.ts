/**
 * For the scripted checks only. The app never imports this file, so none of it ships in a normal build: it adds to one
 * LiveRenderer the hooks the checks need to force a strobe, a graphics reset or a missing limiter, and to measure the limiter.
 */
import * as THREE from 'three';
import type { LiveRenderer } from './LiveRenderer';
import type { WallLimiterGl } from '../map/wall-limiter-gl';
import { limiterScales } from '../meridian/wall-limiter';
import { MERIDIAN_DEFAULTS } from '../meridian/parameters';

/** The parts of LiveRenderer these hooks reach. They are private to the app. */
interface Inside {
  renderer: THREE.WebGLRenderer;
  limiter: WallLimiterGl | null;
  limitInput: THREE.WebGLRenderTarget | null;
  limitFresh: boolean;
  limited: boolean;
  contextLost: boolean;
  width: number;
  height: number;
  checkImage: ((image: THREE.Texture) => THREE.Texture) | null;
}

export interface LiveChecks {
  /** True: the artwork becomes a full-field white flash on every other frame. 'white': steady white. */
  flashTest: boolean | 'white';
  loseContextForCheck(): { lose(): void; restore(): void } | null;
  breakLimiter(): void;
  probeLimiter(): { changedBytes: number; bytes: number; brightest: number } | null;
  probeLimiterCost(): { medianMs: number; worstMs: number } | null;
}

const HOLDS = limiterScales({ safetyMaxFlashes: MERIDIAN_DEFAULTS.safetyMaxFlashes, safetyRedLimit: MERIDIAN_DEFAULTS.safetyRedLimit });

export function installLiveChecks(live: LiveRenderer): LiveRenderer & LiveChecks {
  const inside = live as unknown as Inside, target = live as LiveRenderer & LiveChecks;
  const pixel = (value: number) => { const t = new THREE.DataTexture(new Uint8Array([value, value, value, 255]), 1, 1); t.needsUpdate = true; return t; };
  const white = pixel(255), black = pixel(0);
  let mode: boolean | 'white' = false, on = false;
  Object.defineProperty(target, 'flashTest', {
    configurable: true,
    get: () => mode,
    set: (value: boolean | 'white') => {
      mode = value;
      inside.checkImage = value === 'white' ? () => white : value ? () => { on = !on; return on ? white : black; } : null;
    },
  });
  target.loseContextForCheck = () => {
    const extension = inside.renderer.getContext().getExtension('WEBGL_lose_context');
    return extension ? { lose: () => extension.loseContext(), restore: () => extension.restoreContext() } : null;
  };
  target.breakLimiter = () => {
    inside.limiter?.dispose();
    inside.limiter = { width: inside.width, height: inside.height, error: 'switched off for a check', limitedArea: 0, limit: () => false, dispose() {}, ready: () => false } as unknown as WallLimiterGl;
  };
  target.probeLimiter = () => {
    if (!inside.limitInput || inside.contextLost) return null;
    const gl = inside.renderer.getContext(), w = inside.width, h = inside.height, input = new Uint8Array(w * h * 4), shown = new Uint8Array(w * h * 4);
    inside.renderer.readRenderTargetPixels(inside.limitInput, 0, 0, w, h, input);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, shown); inside.renderer.resetState();
    let changedBytes = 0, brightest = 0;
    for (let i = 0; i < input.length; i++) { if (input[i] !== shown[i]) changedBytes++; if ((i & 3) !== 3 && shown[i] > brightest) brightest = shown[i]; }
    return { changedBytes, bytes: input.length, brightest };
  };
  target.probeLimiterCost = () => {
    if (!inside.limiter || !inside.limitInput || !inside.limited) return null;
    const gl = inside.renderer.getContext() as WebGL2RenderingContext, one = new Uint8Array(4), costs: number[] = [];
    const texture = (inside.renderer.properties.get(inside.limitInput.texture) as { __webglTexture?: WebGLTexture }).__webglTexture!;
    for (let i = 0; i < 40; i++) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
      const a = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
      const b = performance.now();
      inside.limiter.limit(texture, null, 0, 0, false, HOLDS);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
      costs.push(Math.max(0, performance.now() - b - (b - a)));
    }
    inside.renderer.resetState(); inside.limitFresh = true;
    costs.sort((x, y) => x - y);
    return { medianMs: costs[costs.length >> 1], worstMs: costs[costs.length - 1] };
  };
  return target;
}
