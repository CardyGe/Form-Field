'use strict';

const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { checkSeam, describeSeam } = require('./seam-check.cjs');

const EXR_MAGIC = 20000630;
const CONTRACT = 'finished-sdr-linear-srgb-straight-v1';
const clone = value => JSON.parse(JSON.stringify(value));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const frameName = index => `frame-${String(index).padStart(6, '0')}.exr`;
const HAP_FORMATS = { hap: 'hap', hapq: 'hap_q', hapalpha: 'hap_alpha' };
const HAP_TAGS = { hap: 'Hap1', hapq: 'HapY', hapalpha: 'Hap5' };
const FORMATS = ['png', 'prores422', 'prores4444', ...Object.keys(HAP_FORMATS)];
const isHap = format => Object.hasOwn(HAP_FORMATS, format);
const slug = name => String(name || 'Untitled').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'Untitled';

async function atomicWrite(filename, bytes) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, filename);
    // Make the directory entry durable as well as the file contents.
    const directory = await fs.open(path.dirname(filename), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  throw new Error('Image data must be a byte array.');
}

function validateProject(project) {
  if (!project || ![1,2].includes(project.schemaVersion) || typeof project.name !== 'string' || typeof project.id !== 'string' ||
      !Array.isArray(project.layers) || project.layers.length > 4 || !Number.isFinite(project.seed)) {
    throw new Error('This is not a supported Form & Field project.');
  }
  if (project.highlights !== undefined && !['soft', 'exact'].includes(project.highlights)) throw new Error('Invalid highlight handling.');
  if (project.tileEdges !== undefined && typeof project.tileEdges !== 'boolean') throw new Error('Invalid tile edges setting.');
  if (JSON.stringify(project).length > 256 * 1024 * 1024) throw new Error('Project exceeds the 256 MB local document limit.');
  for (const layer of project.layers) {
    if (!layer || !['surface', 'sculpture', 'fractal', 'oil', 'liquid', 'scope', 'super8', 'graphic', 'image', 'livingink', 'relief', 'resonance', 'texturecuts', 'glitchtunnel'].includes(layer.kind) || typeof layer.id !== 'string' ||
        !layer.params || !Array.isArray(layer.palette) || !layer.transform || !layer.mask) throw new Error('Project contains an invalid layer.');
    for (const value of Object.values(layer.params)) if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Layer parameters must be finite numbers.');
    if(layer.surface){
      const s=layer.surface;
      if(project.schemaVersion!==2||!['polygon','mask'].includes(s.source)||!['obstacle','emitter','edge'].includes(s.role)||!Number.isFinite(s.influence)||s.influence<0||s.influence>1||!Array.isArray(s.points)||s.points.length<3||s.points.length>12||s.points.some(p=>!p||![p.x,p.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))||s.clipMask!==undefined&&typeof s.clipMask!=='boolean')throw new Error('Invalid version-2 surface layout.');
      if(s.source==='mask'&&layer.mask.kind!=='image')throw new Error('A surface mask requires an imported image.');
    }
    for(const mod of Object.values(layer.modulations??{}))if(mod?.range){const r=mod.range;if(project.schemaVersion!==2||!Number.isFinite(r.min)||!Number.isFinite(r.max)||r.min>=r.max)throw new Error('Invalid version-2 animation endpoints.');}
    for (const value of [layer.image?.dataUrl, layer.mask.dataUrl].filter(Boolean)) {
      if (typeof value !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)) throw new Error('Imported artwork must be an embedded image.');
    }
  }
  return clone(project);
}

function validateRequest(request, defaultExportDir) {
  if (!request || typeof request !== 'object') throw new Error('Missing export settings.');
  const result = clone(request);
  result.project = validateProject(result.project);
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(result[key]) || result[key] < 2 || result[key] > 8192) throw new Error('Export dimensions must be whole pixels between 2 and 8192.');
  }
  if (result.width * result.height > 33554432) throw new Error('This canvas exceeds the supported offline pixel budget.');
  if (!Number.isInteger(result.frameCount) || result.frameCount < 1 || result.frameCount > 216000) throw new Error('Invalid export frame count.');
  if (!result.fps || !Number.isSafeInteger(result.fps.num) || !Number.isSafeInteger(result.fps.den) ||
      result.fps.num < 1 || result.fps.den < 1 || result.fps.num > 240000 || result.fps.den > 100000 ||
      result.fps.num / result.fps.den < 1 || result.fps.num / result.fps.den > 240) throw new Error('Invalid rational frame rate.');
  if (!FORMATS.includes(result.format)) throw new Error('Unsupported export format.');
  if (typeof result.transparent !== 'boolean' || !/^#[0-9a-f]{6}$/i.test(result.background)) throw new Error('Invalid background or alpha settings.');
  if (result.format === 'prores422' && result.transparent) throw new Error('ProRes 422 HQ cannot contain alpha. Choose ProRes 4444 or an opaque export.');
  if ((result.format === 'hap' || result.format === 'hapq') && result.transparent) throw new Error('HAP and HAP Q cannot contain alpha. Choose HAP Alpha or an opaque export.');
  if (result.format === 'hapalpha' && !result.transparent) throw new Error('HAP Alpha requires transparent output. Choose HAP or HAP Q for opaque media.');
  if (isHap(result.format) && (result.width % 4 || result.height % 4)) throw new Error('HAP export dimensions must be multiples of 4.');
  if (result.format.startsWith('prores') && (result.width % 2 || result.height % 2)) throw new Error('ProRes export dimensions must be even.');
  // Supersampling renders at an integer multiple of the delivery size and
  // filters down in the renderer. Older saved jobs omit it and render at 1×.
  if (result.supersample === undefined) result.supersample = 1;
  if (![1, 2, 3].includes(result.supersample)) throw new Error('Supersampling must be 1×, 2× or 3×.');
  if (result.width * result.supersample > 8192 || result.height * result.supersample > 8192) throw new Error('This supersampling factor exceeds the 8192-pixel render limit. Choose a lower factor.');
  result.outputDir = path.resolve(result.outputDir || defaultExportDir);
  return result;
}

function validateEXR(data, width, height, requireAlpha = false) {
  const bytes = asBuffer(data);
  if (bytes.length < 128 || bytes.length > width * height * 20 + 16 * 1024 * 1024 || bytes.readUInt32LE(0) !== EXR_MAGIC) throw new Error('Invalid or truncated EXR frame.');
  const version = bytes.readUInt32LE(4);
  if ((version & 0xff) !== 2 || (version & ~0x400) !== 2) throw new Error('Only single-part scanline OpenEXR frames are supported.');
  let offset = 8;
  const attributes = new Map();
  const readString = () => {
    const end = bytes.indexOf(0, offset);
    if (end < offset || end - offset > 255) throw new Error('Invalid EXR header string.');
    const value = bytes.toString('ascii', offset, end);
    offset = end + 1;
    return value;
  };
  while (offset < bytes.length && bytes[offset] !== 0) {
    const name = readString();
    const type = readString();
    if (offset + 4 > bytes.length) throw new Error('Truncated EXR header.');
    const size = bytes.readUInt32LE(offset); offset += 4;
    if (size > bytes.length - offset || attributes.has(name)) throw new Error('Invalid EXR header attribute.');
    attributes.set(name, { type, value: bytes.subarray(offset, offset + size) });
    offset += size;
  }
  if (offset >= bytes.length) throw new Error('Truncated EXR header.');
  offset++;
  const window = attributes.get('dataWindow');
  if (window?.type !== 'box2i' || window.value.length !== 16) throw new Error('Missing EXR data window.');
  const [x0, y0, x1, y1] = [0, 4, 8, 12].map(index => window.value.readInt32LE(index));
  if (x0 !== 0 || y0 !== 0 || x1 + 1 !== width || y1 + 1 !== height) throw new Error('EXR dimensions do not match this export job.');
  const channels = attributes.get('channels');
  if (channels?.type !== 'chlist') throw new Error('Missing EXR channels.');
  const names = new Set();
  let channelOffset = 0;
  while (channelOffset < channels.value.length && channels.value[channelOffset] !== 0) {
    const end = channels.value.indexOf(0, channelOffset);
    if (end < 0 || end + 17 > channels.value.length) throw new Error('Invalid EXR channels.');
    const name = channels.value.toString('ascii', channelOffset, end);
    const pixelType = channels.value.readInt32LE(end + 1);
    const xSampling = channels.value.readInt32LE(end + 9);
    const ySampling = channels.value.readInt32LE(end + 13);
    if (![1, 2].includes(pixelType) || xSampling !== 1 || ySampling !== 1 || names.has(name)) throw new Error('EXR frames must use full-resolution float or half-float channels.');
    names.add(name); channelOffset = end + 17;
  }
  if (!['R', 'G', 'B'].every(name => names.has(name)) || (requireAlpha && !names.has('A'))) throw new Error('Missing EXR RGB or alpha channels.');
  const compression = attributes.get('compression');
  const lines = [1, 1, 1, 16, 32, 16, 32, 32, 32, 256][compression?.value[0]];
  if (compression?.type !== 'compression' || compression.value.length !== 1 || !lines) throw new Error('Unsupported EXR compression.');
  const chunks = Math.ceil(height / lines);
  const tableEnd = offset + chunks * 8;
  if (tableEnd > bytes.length) throw new Error('Truncated EXR chunk table.');
  const rows = new Set();
  for (let index = 0; index < chunks; index++) {
    const pointer = bytes.readBigUInt64LE(offset + index * 8);
    if (pointer < BigInt(tableEnd) || pointer > BigInt(bytes.length - 8)) throw new Error('Invalid EXR chunk offset.');
    const chunk = Number(pointer);
    const row = bytes.readInt32LE(chunk);
    const size = bytes.readUInt32LE(chunk + 4);
    if (row < 0 || row >= height || row % lines || rows.has(row) || size < 1 || size > bytes.length - chunk - 8) throw new Error('Invalid or truncated EXR pixel chunk.');
    rows.add(row);
  }
  return bytes;
}

function srgbToLinear(value) { return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }

function encodingFilter(request) {
  const filters = ['format=gbrapf32le'];
  if (!request.transparent) {
    const components = [1, 3, 5].map(index => srgbToLinear(parseInt(request.background.slice(index, index + 2), 16) / 255));
    filters.push(`geq=r='r(X,Y)*alpha(X,Y)+${components[0]}*(1-alpha(X,Y))':g='g(X,Y)*alpha(X,Y)+${components[1]}*(1-alpha(X,Y))':b='b(X,Y)*alpha(X,Y)+${components[2]}*(1-alpha(X,Y))':a=1`);
  }
  // The bundled zscale path changes float alpha when directly negotiating
  // yuva444p10le. A full-range 16-bit linear handoff preserves coverage and
  // retains substantially more precision than either delivery format needs.
  filters.push('format=gbrap16le');
  if (request.format === 'png') {
    filters.push('zscale=pin=709:tin=linear:min=gbr:rin=full:p=709:t=iec61966-2-1:m=gbr:r=full:d=error_diffusion');
    filters.push(request.transparent ? 'format=rgba64be' : 'format=rgb48be');
  } else if (isHap(request.format)) {
    // HAP stores 8-bit full-range sRGB RGB(A) as GPU texture blocks. Dither once
    // from the 16-bit linear master, then repack losslessly for the encoder.
    filters.push('zscale=pin=709:tin=linear:min=gbr:rin=full:p=709:t=iec61966-2-1:m=gbr:r=full:d=error_diffusion');
    filters.push(request.transparent ? 'format=gbrap' : 'format=gbrp');
    filters.push(request.transparent ? 'format=rgba' : 'format=rgb0');
  } else {
    filters.push('zscale=pin=709:tin=linear:min=gbr:rin=full:p=709:t=709:m=709:r=limited:d=error_diffusion');
    filters.push(request.transparent ? 'format=yuva444p10le' : request.format === 'prores4444' ? 'format=yuv444p10le' : 'format=yuv422p10le');
  }
  return filters.join(',');
}

function buildEncodingArgs(job, output) {
  const request = job.request;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-filter_threads', '1', '-framerate', `${request.fps.num}/${request.fps.den}`, '-start_number', '0', '-i', path.join(job.directory, 'cache', 'frame-%06d.exr'), '-frames:v', String(request.frameCount), '-an', '-vf', encodingFilter(request), '-threads', '2'];
  if (request.format === 'png') {
    args.push('-c:v', 'png', '-compression_level', '6', '-start_number', '0');
  } else if (isHap(request.format)) {
    // Chunked frames let playback software decompress in parallel at 4K.
    const chunks = request.width * request.height >= 3840 * 2160 ? 8 : 4;
    args.push('-c:v', 'hap', '-format', HAP_FORMATS[request.format], '-compressor', 'snappy', '-chunks', String(chunks), '-video_track_timescale', String(request.fps.num));
  } else {
    args.push('-c:v', 'prores_ks', '-profile:v', request.format === 'prores4444' ? '4444' : 'hq', '-alpha_bits', request.transparent ? '16' : '0', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-video_track_timescale', String(request.fps.num));
  }
  args.push('-progress', 'pipe:1', '-nostats', output);
  return args;
}

function resolveMediaTools({ allowSystemFallback = false } = {}) {
  const mediaDirectories = [
    typeof process.resourcesPath === 'string' ? path.join(process.resourcesPath, 'media') : null,
    path.join(__dirname, '..', 'build', 'media'),
  ].filter(Boolean);
  const packaged = /app\.asar(?:[/\\]|$)/.test(__dirname);
  function locate(moduleName, property, fallback) {
    const nativeName = process.platform === 'win32' ? `${fallback}.exe` : fallback;
    for (const directory of mediaDirectories) {
      const filename = path.join(directory, nativeName);
      if (existsSync(filename)) return filename;
    }
    // Historical npm binaries are development fallbacks only. Packaged builds
    // must carry the audited LGPL tools under Resources/media.
    if (packaged) return null;
    try {
      const exported = require(moduleName);
      const resolved = property ? exported[property] : exported;
      if (typeof resolved === 'string') return resolved.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
    } catch {}
    return allowSystemFallback ? fallback : null;
  }
  return { ffmpegPath: locate('ffmpeg-static', null, 'ffmpeg'), ffprobePath: locate('@ffprobe-installer/ffprobe', 'path', 'ffprobe') };
}

class ExportManager {
  constructor({ jobsDirectory, defaultExportDir, ffmpegPath, ffprobePath, rendererFingerprint = CONTRACT, onProgress = () => {} }) {
    this.jobsDirectory = path.resolve(jobsDirectory);
    this.defaultExportDir = path.resolve(defaultExportDir);
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.rendererFingerprint = rendererFingerprint;
    this.onProgress = onProgress;
    this.records = new Map();
    this.registry = {};
    this.registryQueue = Promise.resolve();
    this.admissionQueue = Promise.resolve();
    this.initializing = this.initialize();
  }

  async initialize() {
    await fs.mkdir(this.jobsDirectory, { recursive: true });
    try {
      const registry = JSON.parse(await fs.readFile(path.join(this.jobsDirectory, 'index.json'), 'utf8'));
      if (registry && typeof registry === 'object' && !Array.isArray(registry)) this.registry = registry;
    } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read the export queue: ${error.message}`); }
    for (const [id, directory] of Object.entries(this.registry)) {
      if (!/^[a-f0-9-]{36}$/.test(id) || typeof directory !== 'string') continue;
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
        if (manifest.version !== 1 || manifest.contract !== CONTRACT || manifest.job.id !== id || path.resolve(manifest.job.directory) !== path.resolve(directory)) throw new Error('Incompatible export manifest.');
        const record = { ...manifest, queue: Promise.resolve(), process: null, stopped: false, operation: null, pendingWrites: 0 };
        this.records.set(id, record);
        const snapshot = await fs.readFile(path.join(directory, 'snapshot.json'));
        if (hash(snapshot) !== manifest.snapshotHash || hash(Buffer.from(JSON.stringify(manifest.job.request))) !== manifest.snapshotHash) {
          record.invalid = true; record.job.status = 'failed'; record.job.error = 'The saved project snapshot has changed. Start a new export.';
          await this.persist(record); continue;
        }
        if (manifest.rendererFingerprint !== this.rendererFingerprint) {
          record.invalid = true;
          if (record.job.status !== 'complete') { record.job.status = 'failed'; record.job.error = 'The rendering software has changed. Start a new export from the saved project instead of mixing renderer versions.'; await this.persist(record); }
          continue;
        }
        if (['rendering', 'encoding', 'verifying'].includes(record.job.status)) {
          record.job.status = 'interrupted';
          record.job.error = 'The app closed before this job finished. Resume to continue.';
          await this.persist(record);
        }
      } catch (error) {
        // Preserve a broken job on disk, without letting it damage the other jobs.
        this.onProgress({ jobId: id, status: 'failed', rendered: 0, total: 0, error: error.message });
      }
    }
  }

  emit(record, extra = {}) {
    this.onProgress({ jobId: record.job.id, status: record.job.status, rendered: record.job.completedFrames.length, total: record.job.totalFrames, outputPath: record.job.outputPath, error: record.job.error, ...extra });
  }

  async persist(record) {
    const { version, contract, rendererFingerprint, snapshotHash, frameHashes, job } = record;
    await atomicWrite(path.join(job.directory, 'manifest.json'), JSON.stringify({ version, contract, rendererFingerprint, snapshotHash, frameHashes, job }, null, 2));
  }

  locked(record, operation) {
    const pending = record.queue.then(operation);
    record.queue = pending.catch(() => {});
    return pending;
  }

  async record(id) {
    await this.initializing;
    const record = this.records.get(id);
    if (!record) throw new Error('Export job not found.');
    return record;
  }

  run(binary, args, record, onFrame) {
    if (record?.stopped) return Promise.reject(new Error('Export stopped.'));
    if (!binary) return Promise.reject(new Error('The bundled media tools are unavailable. Reinstall the app.'));
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
      if (record) record.process = child;
      let stdout = '', stderr = '', carry = '', frames = 0;
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        stdout = (stdout + chunk).slice(-4 * 1024 * 1024);
        carry += chunk;
        let newline;
        while ((newline = carry.indexOf('\n')) >= 0) {
          const line = carry.slice(0, newline).trim(); carry = carry.slice(newline + 1);
          if (line.startsWith('frame=')) { frames = Number(line.slice(6)); onFrame?.(frames); }
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-65536); });
      child.on('error', error => { if (record?.process === child) record.process = null; reject(new Error(`Cannot launch ${path.basename(binary)}: ${error.message}`)); });
      child.on('close', (code, signal) => {
        if (record?.process === child) record.process = null;
        if (code === 0) resolve({ stdout, stderr, frames });
        else reject(new Error(stderr.trim() || `${path.basename(binary)} stopped (${signal || code}).`));
      });
    });
  }

  async capabilities() {
    const result = { ffmpeg: false, ffprobe: false, hap: false };
    try {
      const filters = await this.run(this.ffmpegPath, ['-hide_banner', '-filters']);
      const encoders = await this.run(this.ffmpegPath, ['-hide_banner', '-encoders']);
      const decoders = await this.run(this.ffmpegPath, ['-hide_banner', '-decoders']);
      result.ffmpeg = /\bzscale\b/.test(filters.stdout) && /\bgeq\b/.test(filters.stdout) && /\bprores_ks\b/.test(encoders.stdout) && /\bpng\b/.test(encoders.stdout);
      result.hap = result.ffmpeg && /\bhap\b/.test(encoders.stdout) && /\bhap\b/.test(decoders.stdout);
    } catch {}
    try { await this.run(this.ffprobePath, ['-version']); result.ffprobe = true; } catch {}
    return result;
  }

  beginExport(request) {
    const operation = this.admissionQueue.then(() => this.admitExport(request));
    this.admissionQueue = operation.catch(() => {});
    return operation;
  }

  async admitExport(request) {
    await this.initializing;
    if ([...this.records.values()].some(record => ['rendering', 'encoding', 'verifying'].includes(record.job.status))) throw new Error('Finish or cancel the current export before starting another.');
    const validated = validateRequest(request, this.defaultExportDir);
    const capability = await this.capabilities();
    if (!capability.ffmpeg || !capability.ffprobe) throw new Error('Export requires bundled FFmpeg with zscale/ProRes/PNG and ffprobe. The installed media tools are incomplete.');
    if (isHap(validated.format) && !capability.hap) throw new Error('The installed media tools cannot encode HAP. Rebuild them with npm run build:media, or choose ProRes.');
    await fs.mkdir(validated.outputDir, { recursive: true });
    const space = await fs.statfs(validated.outputDir);
    if (Number(space.bavail) * Number(space.bsize) < validated.width * validated.height * 16 * 3) throw new Error('Insufficient free disk space to begin a recoverable export.');
    const id = crypto.randomUUID();
    const directory = path.join(validated.outputDir, `${slug(validated.project.name)}-${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 8)}`);
    await fs.mkdir(path.join(directory, 'cache'), { recursive: true });
    const snapshot = Buffer.from(JSON.stringify(validated));
    const record = { version: 1, contract: CONTRACT, rendererFingerprint: this.rendererFingerprint, snapshotHash: hash(snapshot), frameHashes: {}, job: { id, status: 'rendering', request: validated, completedFrames: [], totalFrames: validated.frameCount, directory, createdAt: new Date().toISOString() }, queue: Promise.resolve(), process: null, stopped: false, operation: null, pendingWrites: 0 };
    await atomicWrite(path.join(directory, 'snapshot.json'), snapshot);
    await this.persist(record);
    this.records.set(id, record);
    this.registry[id] = directory;
    this.registryQueue = this.registryQueue.then(() => atomicWrite(path.join(this.jobsDirectory, 'index.json'), JSON.stringify(this.registry, null, 2)));
    await this.registryQueue;
    this.emit(record);
    return clone(record.job);
  }

  async writeFrame(id, frameIndex, data) {
    const record = await this.record(id);
    if (record.pendingWrites >= 2) throw new Error('The frame writer is full. Await each frame write before submitting another.');
    record.pendingWrites++;
    try { return await this.locked(record, async () => {
      if (record.stopped || record.job.status !== 'rendering') throw new Error('This export is not accepting frames.');
      if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= record.job.totalFrames) throw new Error('Frame index is outside this export.');
      const request = record.job.request;
      const bytes = validateEXR(data, request.width, request.height, request.transparent);
      const digest = hash(bytes);
      if (record.frameHashes[frameIndex] && record.frameHashes[frameIndex] !== digest) throw new Error('A completed frame cannot be replaced with different artwork. Start a new export.');
      await atomicWrite(path.join(record.job.directory, 'cache', frameName(frameIndex)), bytes);
      record.frameHashes[frameIndex] = digest;
      if (!record.job.completedFrames.includes(frameIndex)) record.job.completedFrames.push(frameIndex);
      record.job.completedFrames.sort((a, b) => a - b);
      await this.persist(record);
      this.emit(record);
    }); } catch (error) {
      if (error.code && !record.stopped) {
        record.job.status = 'failed'; record.job.error = `Cannot save the master frame: ${error.message}`;
        await this.persist(record).catch(() => {}); this.emit(record);
      }
      throw error;
    } finally { record.pendingWrites--; }
  }

  async reconcile(record, abortOnStop = false) {
    const { request } = record.job;
    const complete = [];
    const hashes = {};
    for (let index = 0; index < record.job.totalFrames; index++) {
      if (abortOnStop && record.stopped) throw new Error('Export stopped.');
      try {
        const bytes = validateEXR(await fs.readFile(path.join(record.job.directory, 'cache', frameName(index))), request.width, request.height, request.transparent);
        const digest = hash(bytes);
        if (record.frameHashes[index] && record.frameHashes[index] !== digest) continue;
        complete.push(index); hashes[index] = digest;
      } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EISDIR' && !/EXR/.test(error.message)) throw error; }
    }
    record.job.completedFrames = complete; record.frameHashes = hashes;
  }

  resumeExport(id) {
    const operation = this.admissionQueue.then(() => this.admitResume(id));
    this.admissionQueue = operation.catch(() => {});
    return operation;
  }

  async admitResume(id) {
    const record = await this.record(id);
    if (record.job.status === 'complete') return clone(record.job);
    if (record.invalid || record.rendererFingerprint !== this.rendererFingerprint) throw new Error(record.job.error || 'This job was created by different rendering software. Start a new export.');
    if ([...this.records.values()].some(other => other !== record && ['rendering', 'encoding', 'verifying'].includes(other.job.status))) throw new Error('Another export is active.');
    if (record.operation) throw new Error('Wait for the current operation to stop.');
    return this.locked(record, async () => {
      const snapshot = await fs.readFile(path.join(record.job.directory, 'snapshot.json'));
      if (hash(snapshot) !== record.snapshotHash || hash(Buffer.from(JSON.stringify(record.job.request))) !== record.snapshotHash) throw new Error('The immutable export snapshot has changed.');
      record.stopped = false;
      await this.reconcile(record, true);
      if (record.stopped) throw new Error('Export stopped.');
      record.job.status = 'rendering'; delete record.job.error;
      await this.persist(record); this.emit(record);
      return clone(record.job);
    });
  }

  async verify(record, output) {
    const request = record.job.request;
    const sourceArgs = request.format === 'png' ? ['-framerate', `${request.fps.num}/${request.fps.den}`, '-start_number', '0', '-i', path.join(output, 'frame-%06d.png')] : ['-i', output];
    const probeInput = request.format === 'png' ? path.join(output, 'frame-000000.png') : output;
    const result = await this.run(this.ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_streams', '-show_frames', '-of', 'json', probeInput], record);
    const probe = JSON.parse(result.stdout);
    const stream = probe.streams?.[0];
    if (!stream || stream.width !== request.width || stream.height !== request.height) throw new Error('Encoded output has incorrect dimensions.');
    const hasAlpha = /^(yuva|gbrap|rgba|bgra|argb|abgr)/.test(stream.pix_fmt || '');
    if (request.transparent && !hasAlpha) throw new Error('Encoded output lost its alpha channel.');
    if (request.format === 'png') {
      if (!['rgb48be', 'rgba64be'].includes(stream.pix_fmt)) throw new Error('PNG export lost its 16-bit precision.');
      const files = (await fs.readdir(output)).filter(name => /^frame-\d{6}\.png$/.test(name));
      if (files.length !== request.frameCount) throw new Error('PNG sequence has the wrong number of frames.');
    } else if (isHap(request.format)) {
      if (stream.codec_name !== 'hap' || stream.codec_tag_string !== HAP_TAGS[request.format]) throw new Error('HAP output has the wrong codec variant.');
      const rate = String(stream.avg_frame_rate || stream.r_frame_rate).split('/').map(Number);
      if (rate.length !== 2 || rate[0] * request.fps.den !== rate[1] * request.fps.num) throw new Error('Encoded frame rate differs from the requested rational rate.');
    } else {
      if (stream.codec_name !== 'prores' || !/p(10|12|16)/.test(stream.pix_fmt || '')) throw new Error('ProRes output has the wrong codec or precision.');
      // Newer FFmpeg exposes ProRes range on decoded frames rather than the
      // stream header. Inspect an actual decoded frame instead of assuming it.
      const range = probe.frames?.[0]?.color_range ?? stream.color_range;
      if (stream.color_space !== 'bt709' || stream.color_transfer !== 'bt709' || stream.color_primaries !== 'bt709' || range !== 'tv') throw new Error('ProRes output has incorrect colour metadata.');
      const rate = String(stream.avg_frame_rate || stream.r_frame_rate).split('/').map(Number);
      if (rate.length !== 2 || rate[0] * request.fps.den !== rate[1] * request.fps.num) throw new Error('Encoded frame rate differs from the requested rational rate.');
    }
    const decoded = await this.run(this.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', ...sourceArgs, '-map', '0:v:0', '-an', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], record);
    if (decoded.frames !== request.frameCount) throw new Error(`Decoded ${decoded.frames} frames; expected ${request.frameCount}.`);
  }

  // Advisory: a seam is reported on the finished job but never fails delivery.
  async checkSeam(record) {
    let result;
    try {
      result = await checkSeam({ run: args => this.run(this.ffmpegPath, args, record), directory: record.job.directory, request: record.job.request, frameName, toLinear: srgbToLinear });
    } catch (error) {
      if (record.stopped) throw error;
      result = { status: 'error', message: error.message.split('\n')[0] };
    }
    return { ...result, summary: describeSeam(result) };
  }

  async finishExport(id) {
    const record = await this.record(id);
    if (record.job.status === 'complete') return clone(record.job);
    if (record.operation) return record.operation;
    const operation = this.locked(record, async () => {
      if (record.stopped || record.job.status !== 'rendering') throw new Error('Resume this job before encoding it.');
      await this.reconcile(record, true);
      if (record.stopped) throw new Error('Export stopped.');
      if (record.job.completedFrames.length !== record.job.totalFrames) throw new Error('Some master frames are missing or corrupt. Render them before encoding.');
      record.job.status = 'encoding'; delete record.job.error;
      await this.persist(record); this.emit(record);
      if (record.stopped) throw new Error('Export stopped.');
      const png = record.job.request.format === 'png';
      const temporary = path.join(record.job.directory, png ? `png-${crypto.randomUUID()}.partial` : 'media.partial.mov');
      if (png) await fs.mkdir(temporary);
      const target = png ? path.join(temporary, 'frame-%06d.png') : temporary;
      await this.run(this.ffmpegPath, buildEncodingArgs(record.job, target), record, encoded => this.emit(record, { encoded }));
      if (record.stopped) throw new Error('Export stopped.');
      record.job.status = 'verifying'; await this.persist(record); this.emit(record);
      if (record.stopped) throw new Error('Export stopped.');
      await this.verify(record, temporary);
      if (record.stopped) throw new Error('Export stopped.');
      record.job.seam = await this.checkSeam(record);
      if (record.stopped) throw new Error('Export stopped.');
      let output = path.join(record.job.directory, png ? 'png' : 'media.mov');
      if (png) { try { await fs.access(output); output = path.join(record.job.directory, `png-${crypto.randomUUID().slice(0, 8)}`); } catch {} }
      await fs.rename(temporary, output);
      record.job.status = 'complete'; record.job.outputPath = output;
      await this.persist(record); this.emit(record);
      return clone(record.job);
    });
    record.operation = operation;
    try { return await operation; }
    catch (error) {
      if (!record.stopped) { record.job.status = 'failed'; record.job.error = error.message; }
      await this.persist(record); this.emit(record);
      if (record.stopped) return clone(record.job);
      throw error;
    } finally { record.operation = null; }
  }

  async stop(id, status) {
    const record = await this.record(id);
    if (record.job.status === 'complete') return;
    record.stopped = true; record.job.status = status;
    if (record.process) {
      const child = record.process;
      child.kill('SIGTERM');
      const force = setTimeout(() => { if (record.process === child) child.kill('SIGKILL'); }, 2000);
      force.unref();
    }
    await this.locked(record, () => this.persist(record));
    this.emit(record);
  }

  async cancelExport(id) { return this.stop(id, 'cancelled'); }
  async interruptAll() {
    await this.initializing;
    await Promise.all([...this.records.values()].filter(record => ['rendering', 'encoding', 'verifying'].includes(record.job.status)).map(record => this.stop(record.job.id, 'interrupted')));
  }
  async listJobs() {
    await this.initializing;
    return [...this.records.values()].map(record => clone(record.job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

module.exports = { ExportManager, FORMATS, isHap, atomicWrite, asBuffer, validateProject, validateRequest, validateEXR, resolveMediaTools, buildEncodingArgs, encodingFilter, frameName, srgbToLinear, CONTRACT };
