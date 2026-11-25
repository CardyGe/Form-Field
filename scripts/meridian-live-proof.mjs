// Meridian Live proof: the Live output (flash limiter included) driven by the built-in crowd test source.
// Run after nothing else: node scripts/meridian-live-proof.mjs
// Writes work/meridian/live-preview.mp4 (30 s, 1920 x 1080, H.264, 30 fps) and work/meridian/live-sequence.png (labelled frames).
// The 'proof' scene: an empty room, one person walking in, standing still, bursting into motion, three people crossing,
// eight people moving together, and the room emptying again. No camera is used; nothing is saved but these two files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/meridian'), scratch = path.join(root, 'work/meridian/live-proof-build');
await fs.mkdir(scratch, { recursive: true });
const SECONDS = 30, FPS = 30, SIM = 60, W = 1920, H = 1080;
await build({ stdin: { contents: `export {LiveRenderer} from './src/live/LiveRenderer';
export {TestSource, TestMaskProvider} from './src/live/test-source';
export {defaultLiveSettings} from './src/live/settings';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(scratch, 'proof.js'), logLevel: 'silent' });
await fs.writeFile(path.join(scratch, 'index.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="a"></canvas>');
await fs.writeFile(path.join(scratch, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(scratch, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1920,height:1080,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(scratch, 'index.html'))});});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(scratch, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const encoder = spawn('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-r', String(FPS), '-i', 'pipe:0',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', path.join(out, 'live-preview.mp4')], { stdio: ['pipe', 'ignore', 'pipe'] });
let encoderError = '';
encoder.stderr.on('data', d => { encoderError += d; });
const finished = new Promise(resolve => encoder.on('close', resolve));
try {
  await page.evaluate(async ([W, H]) => {
    const m = await import('./proof.js');
    const canvas = document.querySelector('#a'), source = new m.TestSource();
    source.crowd = 'proof';
    const renderer = new m.LiveRenderer(canvas, { get element() { return source.element; }, get frameId() { return source.frameId; } }, () => new m.TestMaskProvider(() => source));
    const settings = m.defaultLiveSettings(); settings.look = 'meridian'; settings.quality = H; renderer.settings = settings;
    const copy = new OffscreenCanvas(W, H), context = copy.getContext('2d');
    window.proof = {
      // Moves the simulation on by `steps` 60 fps frames, pausing between them so the presence grid can arrive, then captures one.
      async next(steps) {
        for (let i = 0; i < steps; i++) { await new Promise(r => setTimeout(r, 0)); source.advance(1 / 60); renderer.frame(1 / 60); }
        context.drawImage(canvas, 0, 0);
        const blob = await copy.convertToBlob({ type: 'image/jpeg', quality: .95 });
        const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const r = renderer.meridianReport();
        return { jpeg: btoa(s), report: { t: source.seconds, bodies: r.bodies, attract: r.attract, links: r.links, merges: r.merges, throws: r.throws, releases: r.releases, charge: r.charge, crowd: r.crowd, status: r.status, limiter: r.limiter.on, limited: r.limiter.area } };
      },
      // The labelled sheet: frames in a grid, each with its interaction and what Meridian measured.
      async sheet(frames) {
        const cols = 3, rows = Math.ceil(frames.length / cols), tw = 640, th = 360, pad = 16, label = 54;
        const sheet = new OffscreenCanvas(cols * (tw + pad) + pad, rows * (th + label + pad) + pad + 60), c = sheet.getContext('2d');
        c.fillStyle = '#111'; c.fillRect(0, 0, sheet.width, sheet.height);
        c.fillStyle = '#eee'; c.font = '600 26px -apple-system, Helvetica, sans-serif'; c.fillText('Meridian Live · crowd test source · Live output through the flash limiter', pad, 40);
        for (const [i, f] of frames.entries()) {
          const x = pad + (i % cols) * (tw + pad), y = 60 + pad + Math.floor(i / cols) * (th + label + pad);
          const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(f.jpeg), ch => ch.charCodeAt(0))], { type: 'image/jpeg' }));
          c.drawImage(bitmap, x, y, tw, th);
          c.fillStyle = '#f2f2f2'; c.font = '600 20px -apple-system, Helvetica, sans-serif'; c.fillText(f.title, x, y + th + 24);
          c.fillStyle = '#9a9a9a'; c.font = '15px -apple-system, Helvetica, sans-serif'; c.fillText(f.caption, x, y + th + 46);
        }
        const bytes = new Uint8Array(await (await sheet.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      },
    };
  }, [W, H]);
  const frames = [];
  for (let i = 0; i < SECONDS * FPS; i++) {
    const f = await page.evaluate(steps => window.proof.next(steps), SIM / FPS);
    encoder.stdin.write(Buffer.from(f.jpeg, 'base64'));
    frames.push(f);
    if (i % 150 === 0) console.log(`${(f.report.t).toFixed(1)} s · ${f.report.status} · links ${f.report.links} merges ${f.report.merges} throws ${f.report.throws} releases ${f.report.releases} charge ${f.report.charge.toFixed(2)} crowd ${f.report.crowd.toFixed(2)} attract ${f.report.attract.toFixed(2)}`);
  }
  encoder.stdin.end();
  // One frame for each interaction, chosen from what Meridian itself measured at the time.
  const r = frames.map(f => f.report), at = (test, after = 0) => { const i = r.findIndex((x, k) => k >= after && test(x, k)); return i < 0 ? null : i; };
  const firstThrow = at(x => x.throws > 0), firstRelease = at(x => x.releases > 0);
  const picks = [
    ['Attract', 'Nobody there: slow rings call people in', at(x => x.attract > .9)],
    ['Orbit', 'A ring system drifts out to the person and follows them', at(x => x.bodies === 1 && x.attract < .1 && x.t > 5.5)],
    ['Lattice', 'Points light inside the silhouette, with a fading wake', at(x => x.bodies === 1 && x.t > 6.2)],
    ['Charge', 'Standing still fills the ring and swells the hero', at(x => x.charge > .9)],
    ['Release', 'Moving suddenly after charging releases one bloom', firstRelease === null ? null : Math.min(r.length - 1, firstRelease + 6)],
    ['Throw', 'Fast motion fires spokes and a ripple along it', firstThrow === null ? null : Math.min(r.length - 1, firstThrow + 5)],
    ['Constellation', 'A spoke links people standing near each other', at(x => x.links > 0 && x.bodies >= 2)],
    ['Merge', 'People close together share one larger structure', at(x => x.merges > 0)],
    ['Conduct', 'The crowd moving together lifts Evolution and light', at(x => x.crowd > .3 && x.bodies >= 6) ?? at(x => x.bodies >= 6)],
    ['Beat snap', 'Large consequences land on the beat; the Throw did not wait', firstRelease],
    ['Crossing', 'Two people cross and keep their own rings', at(x => x.bodies === 3 && x.t > 12)],
    ['Attract again', 'The room empties; the structure carries on, never black', at(x => x.attract > .5, Math.floor(r.length * .85))],
  ];
  const chosen = picks.filter(p => p[2] !== null).map(([title, caption, i]) => ({ title: `${title} · ${r[i].t.toFixed(1)} s`, caption: `${caption}. ${r[i].status}.`, jpeg: frames[i].jpeg }));
  const missing = picks.filter(p => p[2] === null).map(p => p[0]);
  await fs.writeFile(path.join(out, 'live-sequence.png'), Buffer.from(await page.evaluate(f => window.proof.sheet(f), chosen), 'base64'));
  const code = await finished;
  if (code !== 0) throw new Error(`ffmpeg failed: ${encoderError}`);
  const summary = { frames: frames.length, missing, maxBodies: Math.max(...r.map(x => x.bodies)), throws: r.at(-1).throws, releases: r.at(-1).releases, maxLinks: Math.max(...r.map(x => x.links)), maxMerges: Math.max(...r.map(x => x.merges)), maxCrowd: Math.max(...r.map(x => x.crowd)), limiterAlwaysOn: r.every(x => x.limiter), maxLimitedArea: Math.max(...r.map(x => x.limited)), errors };
  await fs.writeFile(path.join(out, 'live-proof.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (errors.length || missing.length) process.exitCode = 1;
} finally {
  if (!encoder.stdin.writableEnded) encoder.stdin.end();
  await app.close();
}
