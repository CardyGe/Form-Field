/// <reference lib="webworker" />
/**
 * Encodes the wall's small preview picture off the projector page's main thread. Encoding a JPEG waits for the
 * graphics card; done on the page it stalled the wall for about 40 ms each time (see the performance audit).
 * Receives an ImageBitmap of the wall at preview size, replies with the JPEG's bytes.
 */
const canvas = new OffscreenCanvas(480, 270);
const context = canvas.getContext('2d')!;
self.onmessage = async (event: MessageEvent<ImageBitmap>) => {
  const picture = event.data;
  try {
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const bytes = await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })).arrayBuffer();
    (self as unknown as Worker).postMessage(bytes, [bytes]);
  } catch {
    (self as unknown as Worker).postMessage(null);
  } finally { picture.close(); }
};
