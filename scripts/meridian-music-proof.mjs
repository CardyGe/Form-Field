// Renders Evolve reacting to a synthetic track through the real analyser, detector, tempo clock and renderer, frame by frame.
// Writes work/meridian/music-preview.mp4 and music-light.png, and prints flash measurements of the rendered pixels.
// Run: npm run build && node scripts/meridian-music-proof.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'work/meridian'), stage = path.join(out, 'music-stage');
await fs.mkdir(stage, { recursive: true });
const RATE = 44100, SECONDS = 30, BPM = 128, BREAK_FROM = 14, BREAK_TO = 20;

function track() {
  const n = RATE * SECONDS, d = new Float32Array(n), beat = 60 / BPM;
  let noise = 12345; const rnd = () => { noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0; return noise / 2147483648 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / RATE, breakdown = t >= BREAK_FROM && t < BREAK_TO, into = t % beat, off = (t + beat / 2) % beat, bar = t % (beat * 16);
    let v = 0;
    if (!breakdown) { v += 0.85 * Math.sin(2 * Math.PI * (52 * into + 11 * (1 - Math.exp(-into * 28)))) * Math.exp(-into * 8); v += 0.2 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-off * 5); }
    v += (breakdown ? 0.05 : 0.16) * rnd() * Math.exp(-off * 70) + 0.05 * rnd() * Math.exp(-((t * 4 / beat) % 1) * 9) * (breakdown ? 0.4 : 1);
    const pad = breakdown ? 0.16 : 0.07, chord = bar < beat * 8 ? 220 : 196;
    v += pad * (Math.sin(2 * Math.PI * chord * t) + Math.sin(2 * Math.PI * chord * 1.5 * t) * 0.6 + Math.sin(2 * Math.PI * chord * 2.01 * t) * 0.4);
    d[i] = Math.max(-1, Math.min(1, v * 0.8));
  }
  const bytes = Buffer.alloc(44 + n * 2); bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + n * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) bytes.writeInt16LE(Math.round(d[i] * 32767), 44 + i * 2);
  return bytes;
}
const wav = path.join(stage, 'track.wav');
await fs.writeFile(wav, track());
await build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer} from './src/core/project';
export {heldMoves} from './src/meridian/held-moves';
export {musicStatus} from './src/meridian/music-status';
export {AutoGain,bandEnergies,rms} from './src/react/features';
export {BeatDetector} from './src/react/beat';
export {TempoClock} from './src/react/tempo';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'iife', globalName: 'proof', platform: 'browser', target: 'es2022', outfile: path.join(stage, 'bundle.js'), logLevel: 'silent' });
await fs.writeFile(path.join(stage, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas id="c" width="1920" height="1080"></canvas><script src="bundle.js"></script>');
await fs.writeFile(path.join(stage, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(stage, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:false,nodeIntegration:true}});w.loadFile(${JSON.stringify(path.join(stage, 'index.html'))});});`);

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(stage, 'main.cjs')], env });
try {
  const page = await app.firstWindow();
  page.on('pageerror', e => console.error('page error', e));
  await page.waitForFunction(() => !!window.proof);
  const result = await page.evaluate(async ({ wav, out, SECONDS, BPM, RATE }) => {
    const nodeFs = require('fs'), { spawn } = require('child_process'), p = window.proof, FPS = 60, frames = SECONDS * FPS;
    // 1. The signals, from the app's own analysis chain, at each video frame.
    const file = nodeFs.readFileSync(wav), ctx = new OfflineAudioContext(1, RATE * SECONDS, RATE);
    const buffer = await ctx.decodeAudioData(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    const source = ctx.createBufferSource(), analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.35;
    source.buffer = buffer; source.connect(analyser); analyser.connect(ctx.destination); source.start();
    const gains = { bass: new p.AutoGain(), mids: new p.AutoGain(), highs: new p.AutoGain(), level: new p.AutoGain() }, detector = new p.BeatDetector(), tempo = new p.TempoClock();
    tempo.setSource('beat'); tempo.setBpm(120);
    const freq = new Float32Array(analyser.frequencyBinCount), wave = new Float32Array(2048), signals = new Array(frames);
    for (let i = 0; i < frames; i++) {
      const at = (i + 1) / FPS;
      if (at >= SECONDS - 1 / FPS) continue; // Filled from the last analysed frame below.
      ctx.suspend(at).then(() => {
        analyser.getFloatFrequencyData(freq); analyser.getFloatTimeDomainData(wave);
        const b = p.bandEnergies(freq, RATE, 2048), dt = 1 / FPS, s = {};
        s['audio.bass'] = gains.bass.update(b.bass, dt); s['audio.mids'] = gains.mids.update(b.mids, dt); s['audio.highs'] = gains.highs.update(b.highs, dt); s['audio.level'] = gains.level.update(p.rms(wave), dt);
        const { onset } = detector.update(b.bass, at), state = detector.state(at);
        if (onset) tempo.detected(at, state.bpm);
        s['beat.pulse'] = state.pulse; s['beat.count'] = state.count;
        const c = tempo.advance(at); s['tempo.phase'] = c.phase; s['tempo.beat'] = c.beat; s['tempo.bpm'] = c.bpm;
        signals[i] = s; ctx.resume();
      });
    }
    await ctx.startRendering();
    for (let i = 1; i < frames; i++) signals[i] ??= signals[i - 1];

    let virtual = 0; performance.now = () => virtual;
    const canvas = document.getElementById('c'), studio = new p.StudioRenderer(canvas), gl = canvas.getContext('webgl2');
    const makeProject = extra => { const project = p.createProject(), layer = p.createLayer('meridian'); Object.assign(layer.params, extra); project.layers = [layer]; project.background = '#000000'; project.duration = 60; project.width = 1920; project.height = 1080; return project; };
    const linear = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const LUT = Float32Array.from({ length: 256 }, (_, i) => linear(i));
    /** Pairs of opposing luminance changes over at least 25% of the frame, from the rendered pixels. */
    const flashMeter = (w, h) => {
      const cols = 64, rows = 36, anchor = new Float32Array(cols * rows), way = new Int8Array(cols * rows), now = new Float32Array(cols * rows), events = []; let first = true, lastEvent = -9, maxShare = 0;
      return { see(px, f) {
        now.fill(0);
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const at = (y * w + x) * 4, cell = Math.floor(y / h * rows) * cols + Math.floor(x / w * cols); now[cell] += 0.2126 * LUT[px[at]] + 0.7152 * LUT[px[at + 1]] + 0.0722 * LUT[px[at + 2]]; }
        const per = (w / cols / 2) * (h / rows / 2); let turned = 0;
        for (let i = 0; i < now.length; i++) {
          const v = now[i] / per;
          if (first) { anchor[i] = v; continue; }
          if (way[i] === 1 && v > anchor[i]) anchor[i] = v; if (way[i] === -1 && v < anchor[i]) anchor[i] = v;
          if (way[i] >= 0 && v <= anchor[i] - 0.1 && v < 0.8) { way[i] = -1; anchor[i] = v; turned++; }
          else if (way[i] <= 0 && v >= anchor[i] + 0.1) { way[i] = 1; anchor[i] = v; turned++; }
        }
        first = false; const share = turned / now.length; maxShare = Math.max(maxShare, share);
        if (share >= 0.25 && f - lastEvent > 2) { events.push(f); lastEvent = f; }
      }, report() {
        let worst = 0; for (let i = 0; i < events.length; i++) { let n = 0; for (let k = i; k < events.length && events[k] < events[i] + FPS; k++) n++; worst = Math.max(worst, n); }
        return { largeChanges: events.length, worstFlashesPerSecond: Math.ceil(worst / 2), largestShareChanging: +maxShare.toFixed(4) };
      } };
    };
    const play = async (project, w, h, onFrame, press) => {
      await studio.prepare(project);
      for (let f = 0; f < frames; f++) {
        virtual = (f + 1) * 1000 / FPS; press?.(f, project.layers[0].id);
        studio.render(project, ((f + 1) / FPS) / 60 * Math.PI * 2 % (Math.PI * 2), w, h, { signals: signals[f], now: virtual, externalTempo: false });
        await onFrame(f);
      }
    };

    // 2. The film, at full size, straight into the encoder with the track.
    const W = 1920, H = 1080, pixels = new Uint8Array(W * H * 4);
    const encoder = spawn('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', '60', '-i', 'pipe:0', '-i', wav, '-vf', 'vflip,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-r', '60', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', `${out}/music-preview.mp4`], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encoderError = ''; encoder.stderr.on('data', d => { encoderError += d; });
    const finished = new Promise(resolve => encoder.on('close', resolve));
    const meter = flashMeter(W, H), statuses = { locked: 0, holding: 0, free: 0 }, bpmAt = {}, litByFrame = new Float32Array(frames);
    // One beat, once the music is locked: the same shape as the light passes through it.
    const beatFrames = Math.round(60 / BPM * FPS), sheetFrom = 11 * FPS, tiles = 8, sheet = document.createElement('canvas'), tileW = 480, tileH = 270;
    sheet.width = tileW * 4; sheet.height = tileH * 2; const paint = sheet.getContext('2d'), tile = new OffscreenCanvas(W, H), tilePaint = tile.getContext('2d');
    await play(makeProject({}), W, H, async f => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      statuses[p.musicStatus.status]++; if (f % 300 === 299) bpmAt[(f + 1) / 60] = +p.musicStatus.bpm.toFixed(2);
      meter.see(pixels, f);
      let lit = 0; for (let i = 1; i < pixels.length; i += 64) if (pixels[i] > 40) lit++; litByFrame[f] = lit / (pixels.length / 64);
      const into = f - sheetFrom;
      if (into >= 0 && into < beatFrames && into % Math.max(1, Math.floor(beatFrames / tiles)) === 0) {
        const n = Math.floor(into / Math.max(1, Math.floor(beatFrames / tiles)));
        if (n < tiles) { const image = new ImageData(new Uint8ClampedArray(pixels), W, H); tilePaint.putImageData(image, 0, 0); paint.save(); paint.translate((n % 4) * tileW, Math.floor(n / 4) * tileH + tileH); paint.scale(1, -1); paint.drawImage(tile, 0, 0, tileW, tileH); paint.restore(); }
      }
      if (!encoder.stdin.write(Buffer.from(pixels))) await new Promise(resolve => encoder.stdin.once('drain', resolve));
    });
    encoder.stdin.end(); const code = await finished;
    const png = await new Promise(resolve => sheet.toBlob(resolve, 'image/png'));
    nodeFs.writeFileSync(`${out}/music-light.png`, Buffer.from(await png.arrayBuffer()));
    const lits = Array.from(litByFrame), breakdownLit = lits.slice(15 * FPS, 19 * FPS), mainLit = lits.slice(6 * FPS, 13 * FPS), mean = a => a.reduce((x, y) => x + y, 0) / a.length;

    // 3. The worst case the brief names, on rendered output: test-track beat, maximum reaction, Burst, with the guard on and off.
    const MAX = { reactionBass: 2, reactionMids: 2, reactionHighs: 2, reactionBeat: 2, reactionAttack: 0, reactionRelease: 0, reactionTempoMultiplier: 4, rhythmAccent: 1, macroHeat: 1, macroWeight: 1, lightBloomAmount: 2, lightLineGlow: 2, lightExposure: 2 };
    const stress = async guard => {
      const w = 640, h = 360, px = new Uint8Array(w * h * 4), m = flashMeter(w, h), project = makeProject({ ...MAX, safetyFlashGuard: guard });
      await play(project, w, h, async f => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); m.see(px, f); },
        (f, id) => { p.heldMoves.set(id, 'moveBurst', f % 14 < 7 ? 1 : 0); p.heldMoves.set(id, 'moveDrop', f % 56 < 20 ? 1 : 0); });
      p.heldMoves.clear(project.layers[0].id);
      return m.report();
    };
    const guardOn = await stress(1), guardOff = await stress(0);
    return { code, encoderError, statuses, bpmAt, film: meter.report(), lit: { min: +Math.min(...lits).toFixed(5), main: +mean(mainLit).toFixed(5), breakdown: +mean(breakdownLit).toFixed(5) }, onsets: signals[frames - 1]['beat.count'], guardOn, guardOff };
  }, { wav, out, SECONDS, BPM, RATE });
  console.log(JSON.stringify(result, null, 1));
} finally { await app.close(); }
