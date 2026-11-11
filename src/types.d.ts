import type { StudioBridge } from './shared/types';
declare global {
  interface Window {
    studio?: StudioBridge;
    __studioTest?: Record<string, unknown>;
  }
}
export {};
