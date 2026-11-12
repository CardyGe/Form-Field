import type { InstrumentKind } from '../core/instruments';
export type LayerKind = 'surface' | 'sculpture' | 'fractal' | 'oil' | 'super8' | 'graphic' | 'image' | InstrumentKind;
export type BlendMode = 'normal' | 'screen' | 'multiply' | 'add';
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
}
export interface SeamMeasure { seam: number; typical: number; ratio: number; visible: boolean }
export type SeamCheck = { summary: string } & (
  | { status: 'clean' | 'seam'; jump: SeamMeasure; hitch: SeamMeasure }
  | { status: 'skipped' }
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
  saveProject(project: Project): Promise<{ canceled: boolean; path?: string }>;
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
}
