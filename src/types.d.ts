import type { StudioBridge } from './shared/types';
declare global {
  /** Stamped by Vite from scripts/build-info.mjs. */
  const __FORM_FIELD_BUILD__: { version: string; build: number; commit: string; modified: boolean; date: string };
  interface Window {
    studio?: StudioBridge;
    __studioTest?: Record<string, unknown>;
  }
}
export {};
