import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.resolve(process.argv[2] || path.join(base, 'work/release/mac-arm64/Form & Field.app'));
const executablePath = path.join(bundle, 'Contents/MacOS/Form & Field');
const expectedVersion = JSON.parse(await fs.readFile(path.join(base, 'package.json'), 'utf8')).version;
const artifacts = path.join(base, 'work/packaged-smoke', new Date().toISOString().replace(/[:.]/g, '-'));
const profile = path.join(artifacts, 'profile'), destination = path.join(artifacts, 'exports');
await fs.mkdir(destination, { recursive: true });
await fs.mkdir(profile, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STUDIO_DEV_URL;
const errors = [];
const width = process.env.PACKAGED_SMOKE_SMALL === '1' ? 960 : 3840, height = width * 9 / 16;
async function writtenFile(filename) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const bytes = await fs.readFile(filename).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (bytes) return bytes;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`The native save did not produce ${filename}`);
}
let app, packageSha256;
try {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 60000 });
  const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath('userData'), resources: process.resourcesPath }));
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.userData, profile);
  packageSha256 = crypto.createHash('sha256').update(await fs.readFile(path.join(runtime.resources, 'app.asar'))).digest('hex');
  const page = await app.firstWindow({ timeout: 45000 });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.getByText('Export engine ready', { exact: true }).waitFor({ timeout: 45000 });
  const status = await page.evaluate(() => window.studio.getStatus());
  assert.equal(status.version, expectedVersion);
  await page.getByText(`v${expectedVersion}`, { exact: true }).waitFor();
  assert.equal(status.ffmpeg, true); assert.equal(status.ffprobe, true);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const canvas = page.locator('canvas[aria-label="Composition preview"]');
  const digest = async () => crypto.createHash('sha256').update(await canvas.screenshot()).digest('hex');
  const before = await digest();
  await page.getByLabel('Flow value', { exact: true }).fill('0.73');
  await page.getByLabel('Flow value', { exact: true }).press('Tab');
  await page.waitForTimeout(300);
  assert.notEqual(await digest(), before);
  await page.getByRole('button', { name: 'Add sculpture', exact: true }).click();
  await page.locator('.layer-row').filter({ hasText: 'Acid Tide' }).getByTitle('Hide layer', { exact: true }).click();
  await page.getByLabel('Sculpture form', { exact: true }).selectOption('3');
  for (const [label, value] of [['Thickness', '0.65'], ['Metal finish', '0.45'], ['Shadow strength', '0.45'], ['Shadow softness', '0.6']]) {
    await page.getByLabel(`${label} value`, { exact: true }).fill(value);
    await page.getByLabel(`${label} value`, { exact: true }).press('Tab');
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifacts, 'studio.png') });

  await page.getByLabel('Loop duration', { exact: true }).fill('1');
  await page.getByRole('button', { name: /^Export/ }).click();
  await page.getByLabel('Export resolution', { exact: true }).selectOption(`${width}x${height}`);
  await page.getByLabel('Export frame rate', { exact: true }).selectOption('30/1');
  await page.getByLabel('Delivery format', { exact: true }).selectOption('prores4444');
  await page.getByLabel('Export destination', { exact: true }).fill(destination);
  const ffprobe = path.join(runtime.resources, 'media/ffprobe');
  const ffmpeg = path.join(runtime.resources, 'media/ffmpeg');

  // Exercise the new geometry and Surface variants through the real packaged
  // GPU and native full-resolution path before encoding a Fractal movie.
  const stillPath = path.join(artifacts, 'sculpture-still.png');
  await app.evaluate(({ dialog }, output) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: output }); }, stillPath);
  await page.getByRole('button', { name: 'Save PNG still', exact: true }).click();
  await page.getByText('PNG saved.', { exact: true }).waitFor({ timeout: 45000 });
  const png = await writtenFile(stillPath);
  assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
  const sculptureDecode = spawnSync(ffmpeg, ['-v', 'error', '-nostdin', '-i', stillPath, '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'], { timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(sculptureDecode.status, 0, sculptureDecode.stderr?.toString());
  let sculptureAlphaMin = 255, sculptureAlphaMax = 0;
  for (let index = 3; index < sculptureDecode.stdout.length; index += 4) { sculptureAlphaMin = Math.min(sculptureAlphaMin, sculptureDecode.stdout[index]); sculptureAlphaMax = Math.max(sculptureAlphaMax, sculptureDecode.stdout[index]); }
  assert.ok(sculptureAlphaMin < sculptureAlphaMax && sculptureAlphaMax > 240, 'Sculpture native PNG must retain its genuine alpha coverage.');
  console.log(`PASS packaged Sculpture: actual GPU preview and ${width}×${height} native PNG with genuine alpha.`);

  await page.getByRole('button', { name: 'Close export', exact: true }).click();
  await page.locator('.layer-row').filter({ hasText: 'Pearl Sculpture' }).getByTitle('Hide layer', { exact: true }).click();
  const surfaceLayer = page.locator('.layer-row').filter({ hasText: 'Acid Tide' });
  await surfaceLayer.getByTitle('Show layer', { exact: true }).click();
  await surfaceLayer.click();
  await page.getByRole('button', { name: 'Shape', exact: true }).click();
  await page.getByLabel('Surface variant', { exact: true }).selectOption('2');
  await page.getByLabel('Pattern density value', { exact: true }).fill('1.2');
  await page.getByLabel('Pattern density value', { exact: true }).press('Tab');
  await page.getByLabel('Turbulence value', { exact: true }).fill('0.2');
  await page.getByLabel('Turbulence value', { exact: true }).press('Tab');
  await page.getByLabel('Roundness value', { exact: true }).fill('0.74');
  await page.getByLabel('Roundness value', { exact: true }).press('Tab');
  await page.getByLabel('Relief value', { exact: true }).fill('0.78');
  await page.getByLabel('Relief value', { exact: true }).press('Tab');
  await page.getByTitle('Return to start', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(artifacts, 'surface-studio.png') });
  await page.getByRole('button', { name: /^Export/ }).click();
  await page.getByLabel('Export resolution', { exact: true }).selectOption(`${width}x${height}`);
  await page.getByLabel('Export frame rate', { exact: true }).selectOption('24/1');
  await page.getByLabel('Delivery format', { exact: true }).selectOption('prores422');
  assert.equal(await page.getByLabel('Transparent output', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('Transparent output', { exact: true }).isChecked(), false);

  const surfaceStillPath = path.join(artifacts, 'surface-still.png');
  await app.evaluate(({ dialog }, output) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: output }); }, surfaceStillPath);
  await page.getByRole('button', { name: 'Save PNG still', exact: true }).click();
  await page.getByText('PNG saved.', { exact: true }).waitFor({ timeout: 45000 });
  const surfacePNG = await writtenFile(surfaceStillPath);
  assert.equal(surfacePNG.readUInt32BE(16), width); assert.equal(surfacePNG.readUInt32BE(20), height);
  let srgbIntent = null;
  for (let offset = 8; offset < surfacePNG.length;) {
    const size = surfacePNG.readUInt32BE(offset), name = surfacePNG.toString('ascii', offset + 4, offset + 8);
    assert.ok(offset + size + 12 <= surfacePNG.length, 'The Surface PNG chunk must be complete.');
    if (name === 'sRGB') { assert.equal(size, 1); srgbIntent = surfacePNG[offset + 8]; }
    offset += size + 12;
  }
  assert.equal(srgbIntent, 0, 'The actual Surface PNG must carry its sRGB color declaration.');
  const pngDecode = spawnSync(ffmpeg, ['-v', 'error', '-nostdin', '-i', surfaceStillPath, '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'], { timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(pngDecode.status, 0, pngDecode.stderr?.toString());
  assert.equal(pngDecode.stdout.length, width * height * 4);
  let surfaceRGBMin = 255, surfaceRGBMax = 0, surfaceAlphaMin = 255, surfaceAlphaMax = 0;
  const channelMinimum = [255, 255, 255], channelMaximum = [0, 0, 0];
  for (let index = 0; index < pngDecode.stdout.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const value = pngDecode.stdout[index + channel];
      surfaceRGBMin = Math.min(surfaceRGBMin, value); surfaceRGBMax = Math.max(surfaceRGBMax, value);
      channelMinimum[channel] = Math.min(channelMinimum[channel], value); channelMaximum[channel] = Math.max(channelMaximum[channel], value);
    }
    surfaceAlphaMin = Math.min(surfaceAlphaMin, pngDecode.stdout[index + 3]); surfaceAlphaMax = Math.max(surfaceAlphaMax, pngDecode.stdout[index + 3]);
  }
  assert.equal(surfaceAlphaMin, 255); assert.equal(surfaceAlphaMax, 255);
  assert.ok(channelMaximum.some((value, channel) => value - channelMinimum[channel] > 32), 'The Surface still must vary spatially, rather than being a flat color.');
  const surface = { stillPath: surfaceStillPath, srgbIntent, stillRGB: { minimum: surfaceRGBMin, maximum: surfaceRGBMax, channelMinimum, channelMaximum }, stillAlpha: { minimum: surfaceAlphaMin, maximum: surfaceAlphaMax } };
  console.log(`PASS packaged Surface: actual GPU preview and ${width}×${height} opaque native sRGB PNG.`);
  await page.getByRole('button', { name: 'Close export', exact: true }).click();

  await surfaceLayer.getByTitle('Hide layer', { exact: true }).click();
  await page.locator('.oil-card').click();
  await page.getByLabel('Oil substrate', { exact: true }).selectOption('0');
  const oilBefore = await digest();
  await page.getByLabel('Refraction value', { exact: true }).fill('0');
  await page.getByLabel('Refraction value', { exact: true }).press('Tab');
  await page.waitForTimeout(300);
  assert.notEqual(await digest(), oilBefore, 'Packaged Oil refraction must change its paused GPU image.');
  await page.getByLabel('Refraction value', { exact: true }).fill('0.65');
  await page.getByLabel('Refraction value', { exact: true }).press('Tab');
  await page.screenshot({ path: path.join(artifacts, 'oil-studio.png') });
  await page.getByRole('button', { name: /^Export/ }).click();
  await page.getByLabel('Export resolution', { exact: true }).selectOption('3840x2160');
  await page.getByLabel('Delivery format', { exact: true }).selectOption('prores4444');
  await page.getByLabel('Transparent output', { exact: true }).check();
  const oilStillPath=path.join(artifacts,'oil-still-4k.png');
  await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},oilStillPath);
  await page.getByRole('button', { name: 'Save PNG still', exact: true }).click();
  await page.getByText('PNG saved.', { exact: true }).waitFor({ timeout: 45000 });
  const oilPNG=await writtenFile(oilStillPath);
  assert.equal(oilPNG.readUInt32BE(16),3840);assert.equal(oilPNG.readUInt32BE(20),2160);
  const oilDecode=spawnSync(ffmpeg,['-v','error','-nostdin','-i',oilStillPath,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1'],{timeout:120000,maxBuffer:64*1024*1024});
  assert.equal(oilDecode.status,0,oilDecode.stderr?.toString());
  let oilAlphaMin=255,oilAlphaMax=0;
  for(let i=3;i<oilDecode.stdout.length;i+=4){oilAlphaMin=Math.min(oilAlphaMin,oilDecode.stdout[i]);oilAlphaMax=Math.max(oilAlphaMax,oilDecode.stdout[i]);}
  assert.equal(oilAlphaMin,0);assert.equal(oilAlphaMax,255);
  const oil={stillPath:oilStillPath,width:3840,height:2160,alphaMin:oilAlphaMin,alphaMax:oilAlphaMax};
  console.log('PASS packaged Oil Slides: real controls and 3840×2160 native PNG with transparent coverage.');
  await page.getByRole('button', { name: 'Close export', exact: true }).click();
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();

  await page.getByRole('button', { name: 'Add fractal', exact: true }).click();
  const familyImages = new Set();
  for (const name of ['Folded Lace', 'Julia Bloom', 'Mandelbox']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(500);
    familyImages.add(await digest());
  }
  assert.equal(familyImages.size, 3, 'The packaged Fractal families must render three distinct GPU images.');
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  await page.locator('.preset-card').filter({ has: page.locator('strong', { hasText: /^Chromatic Lattice$/ }) }).click();
  await page.getByRole('button', { name: 'Instruments', exact: true }).click();
  await page.getByLabel('Fractal variant', { exact: true }).selectOption('2');
  await page.getByLabel('Fractal render quality', { exact: true }).selectOption('2');
  await page.getByLabel('Fractal coloring', { exact: true }).selectOption('2');
  await page.getByLabel('Contour colors value', { exact: true }).fill('8');
  await page.getByLabel('Contour colors value', { exact: true }).press('Tab');
  const beforeColorMix = await digest();
  await page.getByLabel('Coloring amount value', { exact: true }).fill('0.8');
  await page.getByLabel('Coloring amount value', { exact: true }).press('Tab');
  await page.waitForTimeout(400);
  assert.notEqual(await digest(), beforeColorMix, 'Coloring amount must blend the actual packaged GPU coloring.');
  const beforeBoxScale = await digest();
  await page.getByLabel('Box scale value', { exact: true }).fill('2.15');
  await page.getByLabel('Box scale value', { exact: true }).press('Tab');
  await page.waitForTimeout(400);
  assert.notEqual(await digest(), beforeBoxScale, 'The packaged family-specific Box scale control must alter the actual GPU image.');
  const beforeFold = await digest();
  await page.getByLabel('Fold value', { exact: true }).fill('0.08');
  await page.getByLabel('Fold value', { exact: true }).press('Tab');
  await page.waitForTimeout(400);
  assert.notEqual(await digest(), beforeFold, 'The packaged Fold control must alter the actual GPU image while paused.');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.locator('label.stacked-label').filter({ hasText: /^Mask shape/ }).locator('select').selectOption('circle');
  await page.getByLabel('Mask size value', { exact: true }).fill('0.9');
  await page.getByLabel('Mask size value', { exact: true }).press('Tab');
  await page.getByTitle('Return to start', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifacts, 'fractal-studio.png') });
  await page.getByRole('button', { name: /^Export/ }).click();
  await page.getByLabel('Export resolution', { exact: true }).selectOption(`${width}x${height}`);
  await page.getByLabel('Export frame rate', { exact: true }).selectOption('30/1');
  await page.getByLabel('Delivery format', { exact: true }).selectOption('prores4444');
  await page.getByLabel('Transparent output', { exact: true }).check();
  const fractalStillPath = path.join(artifacts, 'fractal-still.png');
  await app.evaluate(({ dialog }, output) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: output }); }, fractalStillPath);
  await page.getByRole('button', { name: 'Save PNG still', exact: true }).click();
  await page.getByText('PNG saved.', { exact: true }).waitFor({ timeout: 45000 });
  const fractalPNG = await writtenFile(fractalStillPath);
  assert.equal(fractalPNG.readUInt32BE(16), width); assert.equal(fractalPNG.readUInt32BE(20), height);
  await page.getByRole('button', { name: 'Render loop', exact: true }).click();
  const deadline = Date.now() + 360000;
  let completed;
  while (Date.now() < deadline) {
    const jobs = await page.evaluate(() => window.studio.listJobs());
    completed = jobs.find(job => job.request.project.layers.some(layer => layer.kind === 'fractal' && layer.visible));
    if (completed?.status === 'complete') break;
    if (completed && ['failed', 'cancelled', 'interrupted'].includes(completed.status)) throw new Error(`Fractal native export ${completed.status}: ${completed.error || 'no error details'}`);
    await page.waitForTimeout(300);
  }
  assert.ok(completed?.status === 'complete' && completed.outputPath, 'The actual packaged Fractal native movie must finish.');
  assert.equal(completed.completedFrames.length, 30);
  assert.equal(completed.request.transparent, true);
  const visible = completed.request.project.layers.filter(layer => layer.visible);
  assert.equal(visible.length, 1); assert.equal(visible[0].kind, 'fractal');
  assert.equal(visible[0].params.style, 2); assert.equal(visible[0].params.variant, 2); assert.equal(visible[0].params.quality, 2);
  assert.equal(visible[0].params.colorMode, 2); assert.equal(visible[0].params.colorSteps, 8);
  assert.equal(visible[0].params.colorMix, 0.8);
  assert.equal(visible[0].params.boxScale, 2.15); assert.equal(visible[0].params.fold, 0.08); assert.equal(visible[0].mask.kind, 'circle');
  const probe = spawnSync(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', completed.outputPath], { encoding: 'utf8', timeout: 120000 });
  assert.equal(probe.status, 0, probe.stderr);
  const video = JSON.parse(probe.stdout).streams.find(stream => stream.codec_type === 'video');
  assert.equal(video.width, width); assert.equal(video.height, height);
  assert.equal(Number(video.nb_read_frames), 30); assert.equal(video.r_frame_rate, '30/1');
  assert.equal(video.codec_name, 'prores'); assert.equal(video.profile, '4444');
  assert.match(video.pix_fmt, /^yuva/);
  assert.equal(video.color_transfer, 'bt709'); assert.equal(video.color_space, 'bt709'); assert.equal(video.color_primaries, 'bt709');
  const hashes = spawnSync(ffmpeg, ['-v', 'error', '-nostdin', '-i', completed.outputPath, '-an', '-f', 'framemd5', 'pipe:1'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(hashes.status, 0, hashes.stderr);
  const frameHashes = hashes.stdout.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
  assert.equal(frameHashes.length, 30, 'Every Fractal movie frame must decode successfully.');
  assert.ok(new Set(frameHashes).size > 1, 'The Fractal movie must contain actual animation.');
  const alpha = spawnSync(ffmpeg, ['-v', 'error', '-nostdin', '-i', completed.outputPath, '-vf', 'alphaextract', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray16le', 'pipe:1'], { timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(alpha.status, 0, alpha.stderr?.toString());
  let alphaMin = 65535, alphaMax = 0;
  for (let index = 0; index < alpha.stdout.length; index += 2) { const value = alpha.stdout.readUInt16LE(index); alphaMin = Math.min(alphaMin, value); alphaMax = Math.max(alphaMax, value); }
  assert.ok(alphaMin < alphaMax && alphaMax > 60000, `Expected real masked Fractal coverage, got ${alphaMin}…${alphaMax}`);
  await page.getByRole('button', { name: 'Close export', exact: true }).click();
  await page.locator('.layer-row').filter({ hasText: 'Chromatic Lattice' }).getByTitle('Hide layer', { exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Import image/ }).click();
  await (await chooser).setFiles(stillPath);
  await page.getByRole('button', { name: 'Shape', exact: true }).click();
  await page.getByLabel('Image mirror', { exact: true }).waitFor();
  const beforeImage = await digest();
  await page.getByLabel('Image mirror', { exact: true }).selectOption('3');
  await page.getByLabel('Repeat value', { exact: true }).fill('2');
  await page.getByLabel('Repeat value', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  for (const [label, value] of [['Saturation', '0.7'], ['Hue shift', '0.35'], ['Exposure', '0.85']]) {
    await page.getByLabel(`${label} value`, { exact: true }).fill(value);
    await page.getByLabel(`${label} value`, { exact: true }).press('Tab');
  }
  await page.waitForTimeout(400);
  assert.notEqual(await digest(), beforeImage, 'Image mirror, repeat and grading must alter the actual packaged GPU image.');
  const imageStillPath = path.join(artifacts, 'image-still.png');
  await app.evaluate(({ dialog }, output) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: output }); }, imageStillPath);
  await page.getByRole('button', { name: /^Export/ }).click();
  await page.getByLabel('Export resolution', { exact: true }).selectOption(`${width}x${height}`);
  await page.getByRole('button', { name: 'Save PNG still', exact: true }).click();
  await page.getByText('PNG saved.', { exact: true }).waitFor({ timeout: 45000 });
  const imagePNG = await writtenFile(imageStillPath);
  assert.equal(imagePNG.readUInt32BE(16), width); assert.equal(imagePNG.readUInt32BE(20), height);
  const imageDecode = spawnSync(ffmpeg, ['-v', 'error', '-nostdin', '-i', imageStillPath, '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'], { timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(imageDecode.status, 0, imageDecode.stderr?.toString());
  assert.equal(imageDecode.stdout.length, width * height * 4);
  let imageAlphaMin = 255, imageAlphaMax = 0;
  for (let index = 3; index < imageDecode.stdout.length; index += 4) { imageAlphaMin = Math.min(imageAlphaMin, imageDecode.stdout[index]); imageAlphaMax = Math.max(imageAlphaMax, imageDecode.stdout[index]); }
  assert.ok(imageAlphaMin < imageAlphaMax && imageAlphaMax > 240, 'Flipping, tiling and grading an image must retain its genuine alpha.');
  console.log(`PASS packaged Image: actual flipped, tiled and graded ${width}×${height} native PNG.`);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ status: 'passed', bundle, packageSha256, runtime, statusInfo: status, sculpture: { stillPath, form: 3, alphaMin: sculptureAlphaMin, alphaMax: sculptureAlphaMax }, surface, oil, fractal: { outputPath: completed.outputPath, video, stillPath: fractalStillPath, colorMode: 2, colorSteps: 8, colorMix: 0.8, alphaMin, alphaMax, distinctFrames: new Set(frameHashes).size }, image: { stillPath: imageStillPath, mirror: 3, repeat: 2, saturation: 0.7, hue: 0.35, exposure: 0.85, alphaMin: imageAlphaMin, alphaMax: imageAlphaMax }, errors }, null, 2));
  console.log(`Packaged app PASS: all five source kinds and native stills; ${width}×${height} Fractal 4444 movie, all 30 frames decoded with genuine alpha. ${artifacts}`);
} catch (error) {
  await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ status: 'failed', bundle, packageSha256, error: String(error?.stack || error), errors }, null, 2));
  throw error;
} finally {
  if (app) {
    const force = setTimeout(() => app.process().kill('SIGKILL'), 10000);
    try { await app.close(); } catch { app.process().kill('SIGKILL'); }
    finally { clearTimeout(force); }
  }
}
