/**
 * Runs MediaPipe Multiclass off the screen's thread. Receives camera frames as
 * ImageBitmaps and replies with person masks (1 − background) as bytes.
 * Loaded as a classic inline worker: MediaPipe's loader uses importScripts.
 */
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const MODEL = 'models/selfie_multiclass_256x256.tflite';
let segmenter: ImageSegmenter | null = null;
let lastTimestamp = 0;
const scope = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent) => void) | null };

async function load(base: string): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(base);
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: `${base}/${MODEL}`, delegate },
    runningMode: 'VIDEO' as const, outputConfidenceMasks: true, outputCategoryMask: false,
    canvas: new OffscreenCanvas(1, 1),
  });
  let delegate = 'GPU';
  try { segmenter = await ImageSegmenter.createFromOptions(fileset, options('GPU')); }
  catch { delegate = 'CPU'; segmenter = await ImageSegmenter.createFromOptions(fileset, options('CPU')); }
  scope.postMessage({ loaded: true, delegate });
}

function segment(bitmap: ImageBitmap, frameId: number, timestamp: number): void {
  if (!segmenter) { bitmap.close(); return; }
  const started = performance.now();
  lastTimestamp = Math.max(lastTimestamp + 1, timestamp);
  const result = segmenter.segmentForVideo(bitmap, lastTimestamp);
  try {
    const background = result.confidenceMasks?.[0];
    if (!background) return;
    const values = background.getAsFloat32Array(), data = new Uint8Array(values.length);
    for (let i = 0; i < values.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, 1 - values[i])) * 255);
    scope.postMessage({ data, width: background.width, height: background.height, frameId, ms: performance.now() - started }, [data.buffer]);
  } finally {
    result.close();
    bitmap.close();
  }
}

scope.onmessage = (event: MessageEvent) => {
  const message = event.data;
  try {
    if (typeof message?.base === 'string') load(message.base).catch(error => scope.postMessage({ error: String(error?.message ?? error) }));
    else if (message?.bitmap) segment(message.bitmap, message.frameId, message.timestamp);
  } catch (error) {
    scope.postMessage({ error: String((error as Error)?.message ?? error) });
  }
};
