import type { InstrumentKind } from '../core/instruments';
import type { LiveSettings } from '../live/settings';
import type { SourceState } from '../live/source';
import type { PeopleStatus } from '../live/MaskProvider';
import type { MapMessage } from '../map/messages';
export type LayerKind = 'surface' | 'sculpture' | 'fractal' | 'oil' | 'liquid' | 'scope' | 'super8' | 'graphic' | 'image' | 'kaleidoscope' | InstrumentKind;
export type BlendMode = 'normal' | 'screen' | 'multiply' | 'add' | 'source';
export type ModulationKind = 'sine' | 'pulse' | 'noise' | 'keyframes';
export interface KeyPoint { time: number; value: number }
export interface Modulation {
  range?: { min: number; max: number };
  kind: ModulationKind;
  cycles: number;
  phase: number;
  amount: number;
  points: KeyPoint[];
}
export interface LayerMask {
  kind: 'none' | 'circle' | 'rectangle' | 'image';
  softness: number;
  invert: boolean;
  size: number;
  dataUrl?: string;
}
export interface Layer {
  surface?: { source: 'polygon' | 'mask'; role: 'obstacle' | 'emitter' | 'edge'; influence: number; clipMask?:boolean; points: { x: number; y: number }[] };
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  transform: { x: number; y: number; scale: number; rotation: number };
  mask: LayerMask;
  params: Record<string, number>;
  palette: string[];
  image?: { name: string; dataUrl: string; width: number; height: number; fit: 'contain' | 'cover' };
  modulations: Record<string, Modulation>;
}
export interface Project {
  schemaVersion: 1 | 2;
  id: string;
  name: string;
  seed: number;
  duration: number;
  fps: { num: number; den: number };
  width: number;
  height: number;
  background: string;
  transparent: boolean;
  /** Final highlight handling. Absent means 'soft' (neutral roll-off), the original behaviour. */
  highlights?: 'soft' | 'exact';
  /** Tile edges across the frame. Absent means off. */
  tileEdges?: boolean;
  layers: Layer[];
}
export interface ParameterDefinition {
  preparation?: boolean;
  advanced?: boolean;
  description?: string;
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  section: 'Shape' | 'Motion' | 'Material' | 'Camera';
}
export interface Preset {
  id: string;
  name: string;
  description: string;
  kind: Exclude<LayerKind, 'image'>;
  palette: string[];
  params: Record<string, number>;
}
export type ExportFormat = 'prores4444' | 'prores422' | 'png' | 'hap' | 'hapq' | 'hapalpha';
export type Supersample = 1 | 2 | 3;
export interface ExportRequest {
  project: Project;
  format: ExportFormat;
  outputDir?: string;
  width: number;
  height: number;
  fps: { num: number; den: number };
  frameCount: number;
  transparent: boolean;
  background: string;
  /** Render at this integer multiple of the delivery size, then filter down. Absent in older jobs (1×). */
  supersample?: Supersample;
}
export interface ExportJob {
  id: string;
  status: 'rendering' | 'encoding' | 'verifying' | 'complete' | 'cancelled' | 'failed' | 'interrupted';
  request: ExportRequest;
  completedFrames: number[];
  totalFrames: number;
  directory: string;
  outputPath?: string;
  error?: string;
  createdAt: string;
  seam?: SeamCheck;
  /** Only for projects with tile edges on. */
  edges?: EdgeCheck;
}
export interface SeamMeasure { seam: number; typical: number; ratio: number; visible: boolean }
export type SeamCheck = { summary: string } & (
  | { status: 'clean' | 'seam'; jump: SeamMeasure; hitch: SeamMeasure }
  | { status: 'skipped' }
  | { status: 'error'; message: string });
export type EdgeCheck = { summary: string } & (
  | { status: 'clean' | 'seam'; horizontal: SeamMeasure; vertical: SeamMeasure }
  | { status: 'error'; message: string });
export interface ExportProgress {
  jobId: string;
  status: ExportJob['status'];
  rendered: number;
  total: number;
  encoded?: number;
  message?: string;
  outputPath?: string;
  error?: string;
  seam?: SeamCheck;
  edges?: EdgeCheck;
}
export interface StudioStatus {
  version: string;
  platform: string;
  ffmpeg: boolean;
  ffprobe: boolean;
  hap?: boolean;
  defaultExportDir: string;
}
export interface StudioBridge {
  getStatus(): Promise<StudioStatus>;
  loadAutosave(): Promise<Project | null>;
  saveAutosave(project: Project): Promise<void>;
  /** Saves to the file last opened or saved; asks for a file when there is none or saveAs is true. */
  saveProject(project: Project, saveAs?: boolean): Promise<{ canceled: boolean; path?: string }>;
  /** A new project has no file: the next save asks where to put it. */
  forgetProjectPath(): Promise<void>;
  openProject(): Promise<{ canceled: boolean; project?: Project; path?: string }>;
  chooseExportDirectory(): Promise<string | null>;
  saveStill(bytes: Uint8Array, suggestedName: string): Promise<{ canceled: boolean; path?: string }>;
  beginExport(request: ExportRequest): Promise<ExportJob>;
  writeFrame(jobId: string, frameIndex: number, bytes: Uint8Array): Promise<void>;
  finishExport(jobId: string): Promise<ExportJob>;
  cancelExport(jobId: string): Promise<void>;
  listJobs(): Promise<ExportJob[]>;
  resumeExport(jobId: string): Promise<ExportJob>;
  revealPath(path: string): Promise<void>;
  onBeforeClose(callback: () => Promise<void>): () => void;
  onExportProgress(callback: (progress: ExportProgress) => void): () => void;
  live: LiveBridge;
  map: MapBridge;
}
/** Sent from the studio window to the artwork window. */
export type LiveMessage = { type: 'settings'; settings: LiveSettings } | { type: 'blackout'; on: boolean } | { type: 'clear' } | { type: 'retry' } | { type: 'captureRoom' };
/** What the artwork window reports: its camera, and person finding when the look uses it. */
export type LiveReport = SourceState & { people?: PeopleStatus; roomCaptured?: boolean };
export interface LiveBridge {
  /** The saved settings as stored, or null. Pass the result through validateLiveSettings. */
  loadSettings(): Promise<unknown>;
  saveSettings(settings: LiveSettings): Promise<void>;
  cameraAccess(): Promise<'granted' | 'refused'>;
  displays(): Promise<{ id: number; label: string; primary: boolean }[]>;
  openOutput(displayId: number): Promise<void>;
  closeOutput(): Promise<void>;
  send(message: LiveMessage): void;
  onMessage(callback: (message: LiveMessage) => void): () => void;
  /** True once the artwork window is ready to receive settings; false when it closes. */
  onOutputChanged(callback: (open: boolean) => void): () => void;
  /** Called by the artwork window when it can receive messages. */
  ready(): void;
  /** Called by the artwork window to close itself (Escape). */
  requestClose(): void;
  /** The artwork window reports its camera, so the operator sees a lost camera during a show. */
  sendState(state: LiveReport): void;
  onState(callback: (state: LiveReport) => void): () => void;
  /** A display was connected, removed or changed. */
  onDisplaysChanged(callback: () => void): () => void;
  /** A small picture of the artwork and its frame rate, for the operator. */
  sendPreview(jpeg: ArrayBuffer, fps: number): void;
  onPreview(callback: (jpeg: ArrayBuffer, fps: number) => void): () => void;
}

export interface MapBridge {
  /** The saved working show as parsed JSON, or null. Pass the result through validateShow. */
  loadAutosave(): Promise<unknown>;
  saveAutosave(text: string): Promise<void>;
  /** The chosen show file as parsed JSON; null when cancelled; { damaged: true } when the file cannot be read. */
  openShow(): Promise<unknown>;
  /** The file written, or null when the person cancelled. */
  saveShow(text: string, saveAs: boolean): Promise<string | null>;
  displays(): Promise<{ id: number; label: string; primary: boolean }[]>;
  openOutput(displayId: number): Promise<void>;
  closeOutput(): Promise<void>;
  send(message: MapMessage): void;
  onMessage(callback: (message: unknown) => void): () => void;
  /** True once the output window is ready to receive the show; false when it closes. */
  onOutputChanged(callback: (open: boolean) => void): () => void;
  onDisplaysChanged(callback: () => void): () => void;
  /** Called by the output window when it can receive messages. */
  ready(): void;
  /** Called by the output window to close itself (Escape). */
  requestClose(): void;
  /** Called by the output window: a small JPEG of what the wall shows. */
  sendPreview(jpeg: ArrayBuffer): void;
  /** The wall's picture, about ten times a second while it changes. */
  onPreview(callback: (jpeg: ArrayBuffer) => void): () => void;
  /** Called by the output window once a second: frame rate, governor level, failing sources. */
  sendState(state: import('../map/compositor').CompositorStats): void;
  onState(callback: (state: import('../map/compositor').CompositorStats) => void): () => void;
}
