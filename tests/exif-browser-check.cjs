// Manual integration check: npx electron tests/exif-browser-check.cjs
// Confirms the dimension convention used by the production image importer.
const { app, BrowserWindow } = require('electron');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYwLjMuMTAwAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAHAQEBAAAAAAAAAAAAAAAAAAAFBxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgAEAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AI4Av4t//9k=', 'base64');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await window.loadURL('about:blank');
    const results = [];
    for (const little of [true, false]) {
      for (let orientation = 1; orientation <= 8; orientation++) {
        const tiff = Buffer.alloc(26); tiff.write(little ? 'II' : 'MM');
        const w16 = (value, offset) => little ? tiff.writeUInt16LE(value, offset) : tiff.writeUInt16BE(value, offset);
        const w32 = (value, offset) => little ? tiff.writeUInt32LE(value, offset) : tiff.writeUInt32BE(value, offset);
        w16(42, 2); w32(8, 4); w16(1, 8); w16(0x112, 10); w16(3, 12); w32(1, 14); w16(orientation, 18);
        const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
        const marker = Buffer.alloc(4); marker.writeUInt16BE(0xffe1); marker.writeUInt16BE(payload.length + 2, 2);
        const url = 'data:image/jpeg;base64,' + Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)]).toString('base64');
        const dimensions = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve([image.naturalWidth, image.naturalHeight]); image.onerror = () => reject(new Error('JPEG decode failed')); image.src = ${JSON.stringify(url)}; })`);
        const expected = orientation >= 5 ? [8, 16] : [16, 8];
        if (dimensions[0] !== expected[0] || dimensions[1] !== expected[1]) throw new Error(`Orientation ${orientation} (${little ? 'II' : 'MM'}): ${dimensions}, expected ${expected}`);
        results.push({ orientation, byteOrder: little ? 'II' : 'MM', dimensions });
      }
    }
    process.stdout.write(JSON.stringify({ chromium: process.versions.chrome, results }) + '\n');
    window.destroy(); app.exit(0);
  } catch (error) {
    process.stderr.write(String(error) + '\n'); window.destroy(); app.exit(1);
  }
});
