/**
 * Where Live gets its frames: a webcam, or a video file standing in for one.
 * Video only; audio is never requested. Nothing is recorded.
 */
import type { FrameSource } from './look';

export type SourceState =
  | { status: 'idle' } | { status: 'starting' }
  | { status: 'running'; label: string; width: number; height: number }
  | { status: 'refused' } | { status: 'none' } | { status: 'lost' }
  | { status: 'error'; message: string };

export function stateFromError(name: string): SourceState {
  if (name === 'NotAllowedError' || name === 'SecurityError') return { status: 'refused' };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { status: 'none' };
  return { status: 'error', message: name };
}

export class LiveSource implements FrameSource {
  element: HTMLVideoElement | null = null;
  frameId = 0;
  onState: (state: SourceState) => void = () => {};
  private stream: MediaStream | null = null;
  private url: string | null = null;
  /** Rises on every open or close, so a slow open that was overtaken is dropped. */
  private generation = 0;

  async listCameras(): Promise<{ deviceId: string; label: string }[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput').map((d, index) => ({ deviceId: d.deviceId, label: d.label || `Camera ${index + 1}` }));
  }

  async openCamera(deviceId: string | null): Promise<void> {
    this.close();
    const generation = this.generation;
    this.onState({ status: 'starting' });
    const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } };
    let stream: MediaStream;
    try {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { ...video, deviceId: { exact: deviceId } } : video }); }
      catch (error) {
        // A saved camera that is no longer connected: fall back to whichever camera there is.
        if (!deviceId || (error as DOMException).name !== 'OverconstrainedError') throw error;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      }
    } catch (error) {
      if (generation === this.generation) this.onState(stateFromError((error as DOMException)?.name ?? String(error)));
      return;
    }
    if (generation !== this.generation) { for (const track of stream.getTracks()) track.stop(); return; }
    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => { if (this.stream === stream) { this.release(); this.onState({ status: 'lost' }); } });
    await this.play(el => { el.srcObject = stream; }, track.label || 'Camera', generation);
  }

  async openFile(file: File): Promise<void> {
    this.close();
    const generation = this.generation, url = URL.createObjectURL(file);
    this.url = url;
    this.onState({ status: 'starting' });
    await this.play(el => { el.src = url; el.loop = true; }, file.name, generation);
  }

  close(): void {
    this.release();
    this.onState({ status: 'idle' });
  }

  private release(): void {
    this.generation++;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.element) { this.element.pause(); this.element.srcObject = null; this.element.removeAttribute('src'); this.element.load(); }
    this.element = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  private async play(attach: (element: HTMLVideoElement) => void, label: string, generation: number): Promise<void> {
    const element = document.createElement('video');
    element.muted = true; element.playsInline = true;
    attach(element);
    try { await element.play(); }
    catch (error) {
      if (generation === this.generation) { this.release(); this.onState({ status: 'error', message: (error as Error)?.message || 'This video could not be played.' }); }
      return;
    }
    if (generation !== this.generation) return;
    this.element = element;
    const tick = () => { if (this.element !== element) return; this.frameId++; element.requestVideoFrameCallback(tick); };
    element.requestVideoFrameCallback(tick);
    this.onState({ status: 'running', label, width: element.videoWidth, height: element.videoHeight });
  }
}
