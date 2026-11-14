'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { ExportManager, resolveMediaTools, validateEXR, validateRequest, atomicWrite, frameName, srgbToLinear } = require('./export-manager.cjs');

const tools = resolveMediaTools();
let root, fixture;
const project = { schemaVersion: 1, id: 'test-project', name: 'Export integration', seed: 123, duration: 0.1, fps: { num: 30, den: 1 }, width: 16, height: 16, background: '#336699', transparent: true, layers: [] };

function ffmpeg(args) {
  const result = spawnSync(tools.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  return result.stdout;
}

before(async () => {
  assert.ok(tools.ffmpegPath && tools.ffprobePath, 'Install the pinned bundled media tools before running export tests.');
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'form-field-export-'));
  const filename = path.join(root, 'fixture.exr');
  ffmpeg(['-y', '-f', 'lavfi', '-i', 'nullsrc=s=16x16,format=gbrapf32le,geq=r=0.25:g=0.125:b=0.0625:a=0.5', '-frames:v', '1', '-c:v', 'exr', '-format', 'half', filename]);
  fixture = await fs.readFile(filename);
});

after(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

async function createContext(label, format = 'png', transparent = true, frameCount = 3) {
  const base = await fs.mkdtemp(path.join(root, label));
  const options = { ...tools, jobsDirectory: path.join(base, 'queue'), defaultExportDir: path.join(base, 'output') };
  const events = [];
  const manager = new ExportManager({ ...options, onProgress: event => events.push(event) });
  const request = { project, format, width: 16, height: 16, fps: { num: 30000, den: 1001 }, frameCount, transparent, background: '#336699' };
  const job = await manager.beginExport(request);
  return { manager, options, events, job, request };
}

async function supply(manager, job) {
  for (let index = 0; index < job.totalFrames; index++) await manager.writeFrame(job.id, index, fixture);
}

test('EXR validator checks dimensions, float channels and complete chunks', () => {
  assert.equal(validateEXR(fixture, 16, 16, true), fixture);
  assert.throws(() => validateEXR(fixture, 32, 16), /dimensions/);
  assert.throws(() => validateEXR(fixture.subarray(0, fixture.length - 50), 16, 16), /truncated|Invalid/);
  const corrupt = Buffer.from(fixture); corrupt.writeUInt32LE(0, 0);
  assert.throws(() => validateEXR(corrupt, 16, 16), /EXR/);
});

test('request validation refuses impossible alpha and malformed time/dimensions', () => {
  const request = { project, format: 'png', width: 16, height: 16, fps: { num: 60000, den: 1001 }, frameCount: 3, transparent: true, background: '#000000' };
  assert.equal(validateRequest(request, root).fps.den, 1001);
  assert.throws(() => validateRequest({ ...request, format: 'prores422' }, root), /cannot contain alpha/);
  assert.throws(() => validateRequest({ ...request, fps: { num: 30, den: 0 } }, root), /frame rate/);
  assert.throws(() => validateRequest({ ...request, format: 'prores4444', width: 15 }, root), /even/);
});

test('request validation enforces HAP alpha variants, block-aligned sizes and supersampling limits', () => {
  const request = { project, format: 'hapq', width: 16, height: 16, fps: { num: 30, den: 1 }, frameCount: 3, transparent: false, background: '#000000' };
  assert.equal(validateRequest(request, root).supersample, 1, 'Older requests render at 1×.');
  assert.throws(() => validateRequest({ ...request, transparent: true }, root), /cannot contain alpha/);
  assert.throws(() => validateRequest({ ...request, format: 'hap', transparent: true }, root), /cannot contain alpha/);
  assert.throws(() => validateRequest({ ...request, format: 'hapalpha' }, root), /requires transparent/);
  assert.equal(validateRequest({ ...request, format: 'hapalpha', transparent: true }, root).format, 'hapalpha');
  assert.throws(() => validateRequest({ ...request, width: 18 }, root), /multiples of 4/);
  assert.equal(validateRequest({ ...request, supersample: 2 }, root).supersample, 2);
  assert.throws(() => validateRequest({ ...request, supersample: 4 }, root), /Supersampling/);
  assert.throws(() => validateRequest({ ...request, width: 3840, height: 2160, supersample: 3 }, root), /8192/);
});

test('native snapshots preserve version-2 surface fields and endpoint routes and reject malformed additions',()=>{
 const layer={kind:'livingink',id:'field-v2',params:{seed:1729,inkMode:1},palette:['#112233','#223344','#334455','#445566','#556677','#667788'],transform:{x:0,y:0,scale:1,rotation:0},mask:{kind:'none'},modulations:{opacity:{kind:'sine',cycles:1,phase:0,amount:1,points:[],range:{min:.2,max:.9}}},surface:{source:'polygon',role:'obstacle',influence:1,points:[{x:.3,y:.3},{x:.7,y:.3},{x:.5,y:.7}]}};
 const request={project:{...project,schemaVersion:2,layers:[layer]},format:'prores4444',width:16,height:16,fps:{num:30,den:1},frameCount:3,transparent:true,background:'#000000'};
 assert.deepEqual(validateRequest(request,root).project,request.project);
 for(const change of [p=>p.schemaVersion=1,p=>p.layers[0].surface.influence=NaN,p=>p.layers[0].surface.points[0].x=2,p=>p.layers[0].modulations.opacity.range.min=Infinity]){const q=structuredClone(request);change(q.project);assert.throws(()=>validateRequest(q,root),/version-2/);}
});

test('native document and export boundary accepts every supported source kind including Fractal', () => {
  const mixed = { ...project, layers: ['surface', 'sculpture', 'fractal', 'image'].map((kind, index) => ({
    kind, id: 'layer-' + index, params: { seed: 123, fold: 0.6 },
    palette: ['#112233', '#223344', '#334455', '#445566', '#556677', '#667788'],
    transform: { x: 0, y: 0, scale: 1, rotation: 0 }, mask: { kind: 'none' },
  })) };
  const request = { project: mixed, format: 'prores4444', width: 16, height: 16,
    fps: { num: 30, den: 1 }, frameCount: 3, transparent: true, background: '#000000' };
  const accepted = validateRequest(request, root);
  assert.deepEqual(accepted.project, mixed);
  accepted.project.layers[2].params.fold = 0.2;
  assert.equal(mixed.layers[2].params.fold, 0.6, 'Native snapshots must be independent of editor state.');
  const unsupported = structuredClone(request); unsupported.project.layers[2].kind = 'unknown';
  assert.throws(() => validateRequest(unsupported, root), /invalid layer/);
  const corrupt = structuredClone(request); corrupt.project.layers[2].params.fold = Infinity;
  assert.throws(() => validateRequest(corrupt, root), /finite numbers/);
});

test('native export accepts every projection instrument and preserves its saved controls', () => {
  for(const kind of ['livingink','relief','resonance']) {
    const layer={kind,id:'instrument',params:{seed:1729,scale:2,branching:.3},palette:['#112233','#223344','#334455','#445566','#556677','#667788'],transform:{x:0,y:0,scale:1,rotation:0},mask:{kind:'none'}};
    const request={project:{...project,layers:[layer]},format:'prores4444',width:16,height:16,fps:{num:30,den:1},frameCount:3,transparent:true,background:'#000000'};
    const accepted=validateRequest(request,root);assert.deepEqual(accepted.project.layers[0],layer);
    accepted.project.layers[0].params.branching=.9;assert.equal(layer.params.branching,.3);
  }
});

test('native export accepts saved Oil Slides and preserves its optical controls', () => {
  const layer = {kind:'oil',id:'oil',params:{seed:1729,refraction:.7,substrate:0},palette:['#eeff00','#a7de12','#060710','#25b8ed','#071275','#e2a51c'],transform:{x:0,y:0,scale:1,rotation:0},mask:{kind:'none'}};
  const request={project:{...project,layers:[layer]},format:'prores4444',width:16,height:16,fps:{num:30,den:1},frameCount:3,transparent:true,background:'#000000'};
  const accepted=validateRequest(request,root);
  assert.deepEqual(accepted.project.layers[0],layer);
  accepted.project.layers[0].params.refraction=.1;
  assert.equal(layer.params.refraction,.7);
});

test('native persistence and export retain all four Super 8 Paint modes', () => {
  for (let mode = 0; mode < 4; mode++) {
    const layer = { kind: 'super8', id: 'film', params: { seed: 1729, mode, filmFps: 18, feedback: .65, texture: .8, substrate: 0 },
      palette: ['#ff6238', '#f5c842', '#408bba', '#be4266', '#171824', '#eeddb4'],
      transform: { x: 0, y: 0, scale: 1, rotation: 0 }, mask: { kind: 'none' } };
    const request = { project: { ...project, layers: [layer] }, format: 'prores4444', width: 16, height: 16,
      fps: { num: 30000, den: 1001 }, frameCount: 3, transparent: true, background: '#000000' };
    const accepted = validateRequest(request, root);
    assert.deepEqual(accepted.project.layers[0], layer);
    accepted.project.layers[0].params.feedback = 0;
    assert.equal(layer.params.feedback, .65);
  }
});

test('PNG export retains high precision, correct sRGB conversion and straight alpha', async () => {
  const { manager, job, request, events } = await createContext('png-');
  await supply(manager, job);
  const completed = await manager.finishExport(job.id);
  assert.equal(completed.status, 'complete');
  assert.deepEqual(events.filter(event => ['encoding', 'verifying', 'complete'].includes(event.status)).map(event => event.status).filter((status, index, all) => index === 0 || status !== all[index - 1]), ['encoding', 'verifying', 'complete']);
  const pixels = ffmpeg(['-i', path.join(completed.outputPath, 'frame-000000.png'), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba64le', 'pipe:1']);
  const encode = value => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  for (const [channel, linear] of [0.25, 0.125, 0.0625].entries()) assert.ok(Math.abs(pixels.readUInt16LE(channel * 2) / 65535 - encode(linear)) < 0.0001);
  assert.ok(Math.abs(pixels.readUInt16LE(6) / 65535 - 0.5) < 0.0001);
  assert.ok(pixels.readUInt16LE(0) % 257 !== 0, 'Colour must not be an expanded 8-bit value.');
  assert.equal((await fs.readdir(path.join(job.directory, 'cache'))).filter(name => name.endsWith('.exr')).length, request.frameCount, 'Masters remain after successful delivery.');
});

test('opaque background is composited in linear light before the output transfer', async () => {
  const { manager, job } = await createContext('matte-', 'png', false, 1);
  await supply(manager, job);
  const completed = await manager.finishExport(job.id);
  const pixels = ffmpeg(['-i', path.join(completed.outputPath, 'frame-000000.png'), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb48le', 'pipe:1']);
  const source = [0.25, 0.125, 0.0625], background = [0x33, 0x66, 0x99];
  for (let index = 0; index < 3; index++) {
    const actual = srgbToLinear(pixels.readUInt16LE(index * 2) / 65535);
    const expected = source[index] * 0.5 + srgbToLinear(background[index] / 255) * 0.5;
    assert.ok(Math.abs(actual - expected) < 0.0001, `Linear matte channel ${index}: ${actual} vs ${expected}`);
  }
});

for (const [format, transparent, tag] of [['hap', false, 'Hap1'], ['hapq', false, 'HapY'], ['hapalpha', true, 'Hap5']]) {
  test(`${format} round-trip verifies codec variant, rational FPS, sRGB colour and alpha`, async () => {
    const { manager, job } = await createContext(`${format}-`, format, transparent);
    await supply(manager, job);
    const completed = await manager.finishExport(job.id);
    assert.equal(completed.status, 'complete');
    const output = spawnSync(tools.ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', completed.outputPath], { encoding: 'utf8' });
    const stream = JSON.parse(output.stdout).streams[0];
    assert.equal(stream.codec_name, 'hap');
    assert.equal(stream.codec_tag_string, tag);
    assert.equal(stream.avg_frame_rate, '30000/1001');
    const pixels = ffmpeg(['-i', completed.outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
    const encode = value => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    const source = [0.25, 0.125, 0.0625], background = [0x33, 0x66, 0x99];
    for (let channel = 0; channel < 3; channel++) {
      // Transparent output keeps straight colour; opaque output mattes in linear light.
      const linear = transparent ? source[channel] : source[channel] * 0.5 + srgbToLinear(background[channel] / 255) * 0.5;
      assert.ok(Math.abs(pixels[channel] / 255 - encode(linear)) < 6 / 255, `HAP channel ${channel}: ${pixels[channel]} vs ${encode(linear) * 255}`);
    }
    assert.ok(Math.abs(pixels[3] / 255 - (transparent ? 0.5 : 1)) < 3 / 255, 'HAP alpha must match the requested variant.');
  });
}

for (const [format, transparent] of [['prores4444', true], ['prores422', false]]) {
  test(`${format} round-trip verifies rational FPS, high precision, colour and alpha`, async () => {
    const { manager, job } = await createContext(`${format}-`, format, transparent);
    await supply(manager, job);
    const completed = await manager.finishExport(job.id);
    assert.equal(completed.status, 'complete');
    const output = spawnSync(tools.ffprobePath, ['-v', 'error', '-read_intervals', '%+#1', '-show_streams', '-show_frames', '-of', 'json', completed.outputPath], { encoding: 'utf8' });
    const probe = JSON.parse(output.stdout);
    const stream = probe.streams[0];
    assert.equal(stream.avg_frame_rate, '30000/1001');
    assert.equal(stream.color_transfer, 'bt709');
    assert.equal(stream.color_space, 'bt709');
    assert.equal(stream.color_primaries, 'bt709');
    assert.equal(probe.frames[0].color_range, 'tv');
    assert.equal(/^yuva/.test(stream.pix_fmt), transparent);
    if (transparent) {
      const pixels = ffmpeg(['-i', completed.outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba64le', 'pipe:1']);
      assert.ok(Math.abs(pixels.readUInt16LE(6) / 65535 - 0.5) < 0.002, 'Alpha should survive ProRes round-trip.');
    }
  });
}

test('immutable snapshots, frame bounds and duplicate replacement protect existing masters', async () => {
  const { manager, job, request } = await createContext('immutable-');
  request.project.name = 'Changed outside the job';
  assert.equal((await manager.listJobs())[0].request.project.name, 'Export integration');
  request.project.name = 'Export integration';
  await assert.rejects(manager.writeFrame(job.id, -1, fixture), /outside/);
  await manager.writeFrame(job.id, 0, fixture);
  const changed = Buffer.from(fixture); changed[changed.length - 1] ^= 1;
  await assert.rejects(manager.writeFrame(job.id, 0, changed), /cannot be replaced/);
  assert.deepEqual(await fs.readFile(path.join(job.directory, 'cache', frameName(0))), fixture);
});

test('restart reconciles orphaned complete frames and rejects corrupted or missing masters', async () => {
  const { manager, options, job } = await createContext('recovery-');
  await manager.writeFrame(job.id, 0, fixture);
  await atomicWrite(path.join(job.directory, 'cache', frameName(1)), fixture); // Crash after rename, before manifest.
  await fs.writeFile(path.join(job.directory, 'cache', frameName(2)), fixture.subarray(0, 128));
  const restarted = new ExportManager(options);
  assert.equal((await restarted.listJobs())[0].status, 'interrupted');
  const resumed = await restarted.resumeExport(job.id);
  assert.deepEqual(resumed.completedFrames, [0, 1]);
  await assert.rejects(restarted.finishExport(job.id), /missing or corrupt/);
  await restarted.resumeExport(job.id);
  await restarted.writeFrame(job.id, 2, fixture);
  assert.equal((await restarted.finishExport(job.id)).status, 'complete');
});

test('cancellation retains frames and supports a complete resumed delivery', async () => {
  const { manager, job } = await createContext('cancel-');
  await manager.writeFrame(job.id, 0, fixture);
  await manager.cancelExport(job.id);
  assert.equal((await manager.listJobs())[0].status, 'cancelled');
  await assert.rejects(manager.writeFrame(job.id, 1, fixture), /not accepting/);
  const resumed = await manager.resumeExport(job.id);
  assert.deepEqual(resumed.completedFrames, [0]);
  for (const index of [1, 2]) await manager.writeFrame(job.id, index, fixture);
  assert.equal((await manager.finishExport(job.id)).status, 'complete');
});

test('only one active export is admitted', async () => {
  const { manager, job, request } = await createContext('one-job-');
  await assert.rejects(manager.beginExport(request), /current export/);
  await manager.cancelExport(job.id);
  const results = await Promise.allSettled([manager.beginExport(request), manager.beginExport(request)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'Concurrent starts must not admit two jobs.');
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
});

test('bounded writes reject a third unawaited frame rather than accumulating a loop in memory', async () => {
  const { manager, job } = await createContext('bounded-');
  const results = await Promise.allSettled([0, 1, 2].map(index => manager.writeFrame(job.id, index, fixture)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /writer is full/);
  await manager.writeFrame(job.id, 2, fixture);
  assert.equal((await manager.finishExport(job.id)).status, 'complete');
});

test('a renderer change blocks frame reuse while retaining the old snapshot and masters', async () => {
  const { manager, options, job } = await createContext('version-');
  await manager.writeFrame(job.id, 0, fixture);
  await manager.cancelExport(job.id);
  const upgraded = new ExportManager({ ...options, rendererFingerprint: 'another-shader-build' });
  const restored = (await upgraded.listJobs())[0];
  assert.equal(restored.status, 'failed');
  assert.match(restored.error, /software has changed/);
  await assert.rejects(upgraded.resumeExport(job.id), /software has changed/);
  assert.deepEqual(await fs.readFile(path.join(job.directory, 'cache', frameName(0))), fixture);
});

test('cancellation terminates an active helper process', async () => {
  const { manager, job } = await createContext('kill-');
  const record = await manager.record(job.id);
  const running = manager.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], record).then(() => 'unexpected success', error => error.message);
  await manager.cancelExport(job.id);
  assert.match(await running, /stopped/);
  assert.equal(record.process, null);
  assert.equal((await manager.listJobs())[0].status, 'cancelled');
  await assert.rejects(manager.run(process.execPath, ['-e', 'process.exit(0)'], record), /Export stopped/);
});

test('cancellation during master reconciliation cannot be overwritten by encoding state', async () => {
  const { manager, job } = await createContext('cancel-boundary-');
  await supply(manager, job);
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const reconcile = manager.reconcile.bind(manager);
  manager.reconcile = async (...args) => { enter(); await gate; return reconcile(...args); };
  const finishing = manager.finishExport(job.id);
  await entered;
  const stopping = manager.cancelExport(job.id);
  release();
  await Promise.all([finishing, stopping]);
  assert.equal((await manager.listJobs())[0].status, 'cancelled');
  assert.equal((await manager.record(job.id)).process, null);
});

test('every export reports whether its loop closes, without failing a loop that pops', async () => {
  const frameCount = 8;
  async function exportLoop(label, phaseOf) {
    const context = await createContext(label, 'png', true, frameCount);
    for (let index = 0; index < frameCount; index++) {
      const filename = path.join(root, `${label}-${index}.exr`);
      const value = `0.5+0.4*sin(X/16*2*PI+${phaseOf(index)})`;
      ffmpeg(['-y', '-f', 'lavfi', '-i', `nullsrc=s=16x16,format=gbrapf32le,geq=r='${value}':g='${value}':b='${value}':a=1`, '-frames:v', '1', '-c:v', 'exr', '-format', 'half', filename]);
      await context.manager.writeFrame(context.job.id, index, await fs.readFile(filename));
    }
    return context.manager.finishExport(context.job.id);
  }
  const clean = await exportLoop('seam-clean', i => (2 * Math.PI * i) / frameCount);
  assert.equal(clean.status, 'complete');
  assert.equal(clean.seam.status, 'clean', clean.seam.summary);
  assert.match(clean.seam.summary, /clean/);
  const popping = await exportLoop('seam-pop', i => (2 * Math.PI * 0.6 * i) / frameCount);
  assert.equal(popping.status, 'complete', 'A seam is advisory and still delivers the media.');
  assert.equal(popping.seam.status, 'seam');
  assert.match(popping.seam.summary, /Visible loop seam/);
  const leftovers = (await fs.readdir(clean.directory)).filter(name => name.startsWith('seam-'));
  assert.deepEqual(leftovers, [], 'Analysis frames are removed.');
});
