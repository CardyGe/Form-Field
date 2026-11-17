// Real Electron/WebGL checks for Live mode.
// Run: node scripts/verify-live.mjs [--performance [--relief]]
// Drives LiveRenderer frame by frame with the synthetic TestSource and reads the canvas back.
// Writes work/live/*.png for review by eye.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reliefPerf = process.argv.includes('--relief');
const performanceRun = process.argv.includes('--performance');
const out = path.join(root, 'work/live');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {LiveRenderer} from './src/live/LiveRenderer';
export {TestSource, TestMaskProvider} from './src/live/test-source';
export {defaultLiveSettings, RELIEF_PRESETS} from './src/live/settings';
export {recolourGLSL, setRamp} from './src/live/recolour';
export {Passes} from './src/live/passes';
export {audienceFragment, ricochetFragment} from './src/live/relief-shaders';
export * as THREE from 'three';
export {HOT_SIGNAL, POUR, NEON_STRATA} from './src/core/palettes';
export const fromHalf = v => { const s = v >> 15, e = (v >> 10) & 31, f = v & 1023; return (s ? -1 : 1) * (e ? Math.pow(2, e - 15) * (1 + f / 1024) : Math.pow(2, -14) * f / 1024); };`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'live.js'), logLevel: 'silent' });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="a" style="width:100vw;height:100vh;display:block"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:${performanceRun},width:1920,height:1080,useContentSize:true,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
const started = Date.now();
app.process().stderr?.on('data', d => { const t = String(d); if (/gpu|crash|lost|fatal|error/i.test(t)) console.error(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${t.trim().slice(0, 300)}`); });
page.on('crash', () => console.error(`[${((Date.now() - started) / 1000).toFixed(1)}s] page crashed`));
page.on('console', m => { if (performanceRun) console.error(`[${((Date.now() - started) / 1000).toFixed(1)}s] console ${m.type()}: ${m.text().slice(0, 200)}`); });
page.on('close', () => console.error(`[${((Date.now() - started) / 1000).toFixed(1)}s] page closed`));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const results = [];
const check = async (name, run) => {
  try { await run(); results.push(`ok    ${name}`); }
  catch (error) { results.push(`FAIL  ${name}\n      ${String(error.message).split('\n')[0]}`); process.exitCode = 1; }
};
const save = async (name, base64) => fs.writeFile(path.join(out, `${name}.png`), Buffer.from(base64, 'base64'));

try {
  // In-page helpers. live.make() builds a fresh renderer on a fresh canvas with a TestSource.
  await page.evaluate(async () => {
    const m = await import('./live.js');
    const STEP = 1 / 60;
    window.live = {
      m, STEP,
      // options.figure: a person-shaped figure instead of the discs. The source can be swapped with swap().
      make(change, options = {}) {
        window.live.current?.renderer.dispose();
        const old = document.querySelector('#a'), canvas = old.cloneNode(); old.replaceWith(canvas);
        const first = new m.TestSource(); first.figure = !!options.figure;
        const holder = { source: first }, made = { providers: 0 };
        const frames = { get element() { return holder.source.element; }, get frameId() { return holder.source.frameId; } };
        const renderer = new m.LiveRenderer(canvas, frames, () => { made.providers++; return made.provider = new m.TestMaskProvider(() => holder.source); });
        const settings = m.defaultLiveSettings(); settings.quality = 720; change?.(settings); renderer.settings = settings;
        const current = { get source() { return holder.source; }, renderer, canvas, made,
          swap() { const next = new m.TestSource(); next.figure = holder.source.figure; holder.source = next; return next; } };
        return window.live.current = current;
      },
      run(frames) { const { source, renderer } = window.live.current; for (let i = 0; i < frames; i++) { source.advance(STEP); renderer.frame(STEP); } },
      // The canvas as 8-bit RGBA, row 0 at the top. Must be called in the same task as the last frame.
      pixels() {
        const { canvas } = window.live.current, copy = new OffscreenCanvas(canvas.width, canvas.height), context = copy.getContext('2d', { willReadFrequently: true });
        context.drawImage(canvas, 0, 0);
        return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
      },
      async png() {
        const { canvas, renderer } = window.live.current, copy = new OffscreenCanvas(canvas.width, canvas.height); renderer.frame(0); copy.getContext('2d').drawImage(canvas, 0, 0);
        const bytes = new Uint8Array(await (await copy.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s);
      },
      // Fraction of pixels whose colour differs from `ground` (0 or 255) by more than `tolerance` in any channel,
      // inside the band of rows [top, bottom) given as fractions of the height from the top.
      painted(ground, tolerance = 8, top = 0, bottom = 1) {
        const { data, width, height } = window.live.pixels(); let count = 0, total = 0, sx = 0, sy = 0, max = 0;
        for (let y = Math.floor(top * height); y < Math.floor(bottom * height); y++) for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4, d = Math.max(Math.abs(data[i] - ground), Math.abs(data[i + 1] - ground), Math.abs(data[i + 2] - ground));
          total++; if (d > max) max = d; if (d > tolerance) { count++; sx += x / width; sy += y / height; }
        }
        return { fraction: count / total, x: count ? sx / count : 0, y: count ? sy / count : 0, max };
      },
    };
  });

  if (performanceRun) {
    // Drive real display frames with the synthetic source and optionally encode the operator preview.
    const measure = (seconds, relay, quality = 1080, preset = null) => page.evaluate(async ([seconds, relay, quality, preset]) => {
      const { source, renderer, canvas } = window.live.make(s => { s.quality = quality; if (preset) { s.look = 'relief'; s.relief = preset.settings; } });
      let last = performance.now(), sent = 0, busy = false, running = true; const gaps = [];
      const small = new OffscreenCanvas(480, 270), context = small.getContext('2d');
      renderer.start();
      const tick = now => { if (!running) return; gaps.push(now - last); source.advance((now - last) / 1000); last = now;
        if (relay && !busy && now - sent >= 100) { sent = now; busy = true; context.drawImage(canvas, 0, 0, 480, 270); small.convertToBlob({ type: 'image/jpeg', quality: .7 }).then(b => b.arrayBuffer()).finally(() => { busy = false; }); }
        requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 2000)); gaps.length = 0; renderer.stats();
      await new Promise(r => setTimeout(r, seconds * 1000)); running = false;
      const stats = renderer.stats(); renderer.stop(); renderer.frame(0); const painted = window.live.painted(0).fraction; gaps.sort((a, b) => a - b);
      return { seconds, relay, quality, preset: preset?.name, fps: stats.fps, worstMs: stats.worstMs, medianMs: gaps[gaps.length >> 1], p99Ms: gaps[Math.floor(gaps.length * .99)], over25ms: gaps.filter(g => g > 25).length, frames: stats.frames, painted };
    }, [seconds, relay, quality, preset]);
    const length = Number(process.env.LIVE_PERF_SECONDS) || 120;
    const runs = [];
    if (reliefPerf) {
      const presets = await page.evaluate(() => window.live.m.RELIEF_PRESETS);
      runs.push(await measure(length, true, 720, presets[0]));
      for (const preset of presets) runs.push(await measure(length, true, 1080, preset));
    } else runs.push(await measure(length, false), await measure(Math.ceil(length / 2), true));
    await fs.writeFile(path.join(out, reliefPerf ? 'relief-performance.json' : 'performance.json'), JSON.stringify(runs, null, 2));
    console.log(JSON.stringify(runs, null, 2));
    await app.close();
    process.exit(0);
  }
  await check('Relief responds at both tracked positions, mirrors, settles and clears', async () => {
    for (const mirror of [true, false]) {
      const result = await page.evaluate(async mirror => {
        const { renderer, made } = window.live.make(s => { s.look = 'relief'; s.mirror = mirror; });
        renderer.frame(0);
        const idle = window.live.pixels();
        function difference() {
          const { data, width, height } = window.live.pixels();
          const bands = [{ sum: 0, moment: 0 }, { sum: 0, moment: 0 }];
          for (let y = 0; y < height; y += 3) for (let x = 0; x < width; x += 3) {
            const i = 4*(y*width+x), diff = Math.abs(data[i] - idle.data[i]);
            const band = bands[Number(y >= height/2)];
            band.sum += diff; band.moment += diff*x/width;
          }
          return bands.map(b => ({ energy: b.sum, x: b.moment / Math.max(1,b.sum) }));
        }
        window.live.run(40);
        const moving = difference(), picture = await window.live.png();
        for (let i=0; i<180; i++) renderer.frame(1/60); // source stopped sending frames
        const settled = difference();
        window.live.run(10);
        renderer.clear(); renderer.frame(0);
        const cleared = difference();
        window.live.make(s => { s.look = 'relief'; s.box = { left: 0, right: 1, bottom: 0, top: .12 }; });
        window.live.run(40);
        const boxed = difference();
        return { moving, settled, cleared, boxed, providers: made.providers, picture };
      }, mirror);
      if (!mirror) await save('relief', result.picture);
      const [upper, lower] = result.moving;
      assert.ok(upper.energy > 10000 && lower.energy > 10000, 'both moving patches should bend the wall');
      assert.ok((upper.x - lower.x) * (mirror ? -1 : 1) > .16, 'folds should follow the mirrored camera');
      assert.ok(result.settled.every((b,i) => b.energy < result.moving[i].energy * .02), 'stale input kept driving the wall');
      assert.ok(result.cleared.every(b => b.energy === 0), 'clear left part of a wake');
      assert.ok(result.boxed.every(b => b.energy === 0), 'movement outside the interaction box bent the wall');
      assert.equal(result.providers, 0);
    }
  });
  await check('Relief presets each render a different surface and react to movement', async () => {
    const presets = await page.evaluate(() => window.live.m.RELIEF_PRESETS);
    const { count } = await page.evaluate(() => {
      window.live.make(s => { s.look = 'relief'; });
      window.reliefIdle = [];
      return { count: window.live.m.RELIEF_PRESETS.length };
    });
    for (const preset of presets) {
      const result = await page.evaluate(async preset => {
        const { renderer } = window.live.current;
        renderer.settings.relief = preset.settings;
        renderer.clear(); renderer.frame(0);
        function sample() {
          const { data } = window.live.pixels();
          const rgb = [];
          for (let i = 0; i < data.length; i += 1012) rgb.push(data[i], data[i+1], data[i+2]);
          return rgb;
        }
        const idle = sample();
        const distance = (a,b) => a.reduce((sum,v,i) => sum+Math.abs(v-b[i]),0)/a.length;
        const separate = window.reliefIdle.every(previous => distance(idle,previous) > 7);
        window.reliefIdle.push(idle);
        window.live.run(42);
        const delta = distance(sample(),idle), picture = await window.live.png();
        for (let i=0; i<180; i++) renderer.frame(1/30);
        const tail = distance(sample(),idle);
        return { separate, delta, tail, picture };
      }, preset);
      await save('relief-' + preset.name.toLowerCase().replaceAll(' ','-'), result.picture);
      assert.ok(result.separate, preset.name + ' repeats another preset');
      assert.ok(result.delta > .7, preset.name + ' barely reacted: ' + result.delta);
      assert.ok(result.tail < .45, preset.name + ' failed to settle: ' + result.tail);
    }
    assert.ok(count >= 5);
  });
  await check('Relief shows a standing person on each surface and switches back to motion only', async () => {
    for (const surface of ['blades','scales','weave']) {
      const result = await page.evaluate(async surface => {
        const { source, renderer, made } = window.live.make(s => {
          s.look = 'relief'; s.relief.surface = surface; s.relief.size = 'extraFine';
        });
        source.audience = true; source.moving = false;
        source.advance(1/30); // Prime with the performers already in place.
        window.live.run(30);
        const idle = window.live.pixels();
        function difference() {
          const { data, width, height } = window.live.pixels();
          let body = 0, other = 0;
          for (let y=0; y<height; y+=4) for (let x=0; x<width; x+=4) {
            const i = 4*(y*width+x);
            const delta = Math.abs(data[i+1]-idle.data[i+1]);
            if (x > .12*width && x < .37*width || x > .63*width && x < .88*width) body += delta;
            else other += delta;
          }
          return { body, other };
        }
        renderer.settings.reliefPresence = true;
        window.live.run(90);
        const standing = difference(), image = await window.live.png();
        renderer.settings.reliefPresence = false;
        renderer.frame(1/60);
        return { standing, off: difference(), image, providers: made.providers };
      }, surface);
      await save('relief-presence-'+surface,result.image);
      assert.ok(result.standing.body > 10000, surface + ' imprint too faint');
      assert.ok(result.standing.body > 2*result.standing.other, surface + ' imprint spread too far');
      assert.deepEqual(result.off, { body: 0, other: 0 });
      assert.equal(result.providers, 1);
    }
  });
  await check('Relief encounter lights up only when two inward sweeps meet', async () => {
    const result = await page.evaluate(() => {
      const { THREE, Passes, audienceFragment } = window.live.m;
      const width = 160, height = 90;
      const gpu = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(width,height) });
      const passes = new Passes(gpu), pair = passes.pair(width,height);
      const mask = new THREE.DataTexture(new Uint8Array(width*height).fill(255),width,height,THREE.RedFormat);
      const flowData = new Float32Array(width*height*4);
      const flow = new THREE.DataTexture(flowData,width,height,THREE.RGBAFormat,THREE.FloatType);
      mask.needsUpdate = true;
      const uniforms = { uPrevious: {value:null}, uPeople: {value:mask}, uFlow: {value:flow},
        uStep: {value:1/60}, uFresh: {value:1}, uBox: {value:new THREE.Vector4(0,1,0,1)} };
      const sim = passes.material(audienceFragment,uniforms);
      const zero = passes.material('void main(){gl_FragColor=vec4(0.);}',{});
      function trial(two) {
        flowData.fill(0);
        for (let y=36;y<52;y++) for (let x=0;x<width;x++) {
          const left = x>=57 && x<64, right = two && x>=96 && x<103;
          if (!left && !right) continue;
          const i = 4*(y*width+x); flowData[i] = left ? .012 : -.012; flowData[i+2] = .9;
        }
        flow.needsUpdate = true;
        passes.draw(zero,pair.read);
        let peak = 0;
        for (let frame=0;frame<60;frame++) {
          uniforms.uPrevious.value = pair.read.texture; uniforms.uFresh.value = Number(frame<7);
          passes.draw(sim,pair.write); pair.swap();
          const pixel = new Uint16Array(4);
          gpu.readRenderTargetPixels(pair.read,80,44,1,1,pixel);
          peak = Math.max(peak,THREE.DataUtils.fromHalfFloat(pixel[3]));
        }
        return peak;
      }
      try { return { solo: trial(false), pair: trial(true) }; }
      finally { sim.dispose(); zero.dispose(); mask.dispose(); flow.dispose(); pair.dispose(); passes.dispose(); gpu.dispose(); }
    });
    assert.equal(result.solo,0);
    assert.ok(result.pair > .2, 'overlapping wakes did not light up');
  });
  await check('Ricochet reflects a crest at each edge and preserves opposing crests', async () => {
    const results = await page.evaluate(() => {
      const { THREE, Passes, ricochetFragment } = window.live.m;
      const width = 160, height = 90;
      const gpu = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(width,height) });
      const passes = new Passes(gpu), field = passes.pair(width,height);
      const cells = new Float32Array(width*height*4);
      const seed = new THREE.DataTexture(cells,width,height,THREE.RGBAFormat,THREE.FloatType);
      const uniforms = { uState: { value: seed }, uFlow: { value: seed }, uStep: { value:1/60 },
        uReach: { value: .8 }, uSettle: { value: 1.65 }, uFresh: { value: 0 } };
      const pass = passes.material(ricochetFragment,uniforms);
      const pixel = new Uint16Array(4);
      function advance(frames) {
        seed.needsUpdate = true;
        uniforms.uState.value = seed;
        for (let i=0; i<frames; i++) {
          passes.draw(pass,field.write); field.swap();
          uniforms.uState.value = field.read.texture;
        }
      }
      function stamp(x,y,channel) {
        for (let j=y-3; j<=y+3; j++) for (let i=x-4; i<=x+4; i++)
          cells[4*(j*width+i)+channel] = 1;
      }
      function at(x,y,channel) {
        gpu.readRenderTargetPixels(field.read,x,y,1,1,pixel);
        return THREE.DataUtils.fromHalfFloat(pixel[channel]);
      }
      try {
        // The pulse travels just under 40 cells in 15 frames on either axis.
        const edges = [[136,45,0,144,45,1],[24,45,1,16,45,0],
          [80,74,2,80,66,3],[80,16,3,80,24,2]].map(([x,y,d,rx,ry,reflected]) => {
          cells.fill(0); stamp(x,y,d); advance(15);
          return at(rx,ry,reflected);
        });
        cells.fill(0); stamp(40,45,0); stamp(120,45,1); advance(15);
        return { edges, opposing: [at(80,45,0),at(80,45,1)] };
      } finally {
        seed.dispose(); pass.dispose(); field.dispose(); passes.dispose(); gpu.dispose();
      }
    });
    assert.ok(results.edges.every(e => e > .3), 'reflected crests: ' + results.edges);
    assert.ok(results.opposing.every(e => e > .45), 'opposing crests: ' + results.opposing);
  });
  await check('bare pipeline: the picture is not uniform', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.current.renderer.view = 'tracking'; window.live.run(30); const p = window.live.painted(0); return { p, frames: window.live.current.renderer.stats().frames }; });
    assert.ok(r.p.fraction > .01, `only ${r.p.fraction} of pixels lit`); assert.ok(r.frames >= 30, `${r.frames} frames`);
  });
  await check('blackout is pure black', async () => {
    const r = await page.evaluate(() => { window.live.make(); const { renderer } = window.live.current; renderer.view = 'tracking'; renderer.blackout = true; window.live.run(5); return window.live.painted(0, 0); });
    assert.equal(r.max, 0);
  });
  await check('artwork size follows quality', async () => {
    const r = await page.evaluate(() => { const { canvas } = window.live.make(s => { s.quality = 1080; }); window.live.run(1); return [canvas.width, canvas.height]; });
    assert.deepEqual(r, [1920, 1080]);
  });
  // --- Movement tracking ---
  // Mean of the flow field over rows [bottom, top) and columns [left, right), as uv fractions from the bottom-left.
  await page.evaluate(() => {
    window.live.flow = (bottom = 0, top = 1, left = 0, right = 1) => {
      const { data, width, height } = window.live.current.renderer.readFlow(); let r = 0, b = 0, max = 0, n = 0;
      for (let y = Math.floor(bottom * height); y < Math.floor(top * height); y++) for (let x = Math.floor(left * width); x < Math.floor(right * width); x++) {
        const i = (y * width + x) * 4; r += data[i]; b += data[i + 2]; if (data[i + 2] > max) max = data[i + 2]; n++;
      }
      return { r: r / n, strength: b / n, max };
    };
  });
  await check('tracking: movement is found where the discs move', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(30); return { upper: window.live.flow(.6, .8), lower: window.live.flow(.2, .4), edge: window.live.flow(.94, 1) }; });
    assert.ok(r.upper.max > .5 && r.lower.max > .5, `peak strength ${r.upper.max}, ${r.lower.max}`);
    assert.ok(r.upper.strength > .03 && r.lower.strength > .03, `mean strength ${r.upper.strength}, ${r.lower.strength}`);
    assert.ok(r.edge.max < .01, `strength ${r.edge.max} where nothing moves`);
  });
  await check('tracking: still input settles to nothing', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(30); window.live.current.source.moving = false; window.live.run(60); return window.live.flow(); });
    assert.ok(r.strength < .005 && r.max < .02, `strength ${r.strength}, peak ${r.max}`);
  });
  await check('tracking: outside the box is exactly zero', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.box.right = .5; }); window.live.run(30); return { out: window.live.flow(0, 1, .5, 1), inside: window.live.flow(0, 1, 0, .5) }; });
    assert.equal(r.out.max, 0); assert.ok(r.inside.max > .3, `inside peak ${r.inside.max}`);
  });
  await check('tracking: direction follows the movement and flips with mirror', async () => {
    const r = await page.evaluate(() => {
      const run = mirror => { window.live.make(s => { s.mirror = mirror; }); window.live.run(30); return { upper: window.live.flow(.6, .8).r, lower: window.live.flow(.2, .4).r, discs: window.live.current.source.discs() }; };
      return { plain: run(false), mirrored: run(true) };
    });
    assert.ok(r.plain.discs[0].vx > .2 && r.plain.discs[1].vx < -.2, 'test source is not moving as expected');
    assert.ok(r.plain.upper > 0 && r.plain.lower < 0, `plain ${r.plain.upper}, ${r.plain.lower}`);
    assert.ok(r.mirrored.upper < 0 && r.mirrored.lower > 0, `mirrored ${r.mirrored.upper}, ${r.mirrored.lower}`);
  });
  await check('tracking: a camera that goes away leaves no movement behind', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(30); const { source } = window.live.current; source.advance = () => {}; Object.defineProperty(source, 'element', { value: null }); window.live.run(2); return window.live.flow(); });
    assert.equal(r.max, 0);
  });
  await check('tracking: the first frame after a gap is not compared with the frame before it', async () => {
    const r = await page.evaluate(async () => { window.live.make(); window.live.run(30); const { source, renderer } = window.live.current;
      await new Promise(resolve => setTimeout(resolve, 700)); // no frames for longer than the tracker's patience
      source.advance(3); renderer.frame(1 / 60); const afterGap = window.live.flow();
      window.live.run(10); return { afterGap, resumed: window.live.flow() }; });
    assert.equal(r.afterGap.max, 0); assert.ok(r.resumed.max > .3, `tracking did not resume (${r.resumed.max})`);
  });
  await check('tracking view shows the camera', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.current.renderer.view = 'tracking'; window.live.run(30); return window.live.painted(0, 40); });
    assert.ok(r.fraction > .02, `only ${r.fraction} lit`);
    await save('tracking', await page.evaluate(() => window.live.png()));
  });
  // --- Paint ---
  // Rows are fractions from the top. The discs sweep along rows .3 and .7; the outer strips are never crossed.
  await check('paint: movement lays paint where it happens', async () => {
    // Paint starts where the movement is; given time it flows outward, so the edges are judged early.
    const r = await page.evaluate(() => { window.live.make(); window.live.run(45); const top = window.live.painted(0, 8, 0, .05), bottom = window.live.painted(0, 8, .95, 1); window.live.run(135);
      return { all: window.live.painted(0), upper: window.live.painted(0, 8, .15, .45), lower: window.live.painted(0, 8, .55, .85), top, bottom }; });
    await save('paint', await page.evaluate(() => window.live.png())); // saved first, so a failing run can still be looked at
    assert.ok(r.all.fraction > .03, `only ${r.all.fraction} painted`);
    assert.ok(r.upper.fraction > .05 && r.lower.fraction > .05, `bands ${r.upper.fraction}, ${r.lower.fraction}`);
    assert.ok(r.top.fraction < .03 && r.bottom.fraction < .03, `strips ${r.top.fraction}, ${r.bottom.fraction}`);
  });
  await check('paint: several colours are laid down', async () => {
    const hues = await page.evaluate(() => { window.live.make(s => { s.paint.colourChange = 1; }); window.live.run(360); const { data } = window.live.pixels(), seen = new Set();
      for (let i = 0; i < data.length; i += 4) { const r = data[i], g = data[i + 1], b = data[i + 2], max = Math.max(r, g, b), min = Math.min(r, g, b); if (max < 120 || max - min < 60) continue;
        const h = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4; seen.add(Math.floor(h * 2)); }
      return seen.size; });
    assert.ok(hues >= 3, `${hues} hue families`);
  });
  await check('paint: still input fades back to the ground', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.paint.fadeSeconds = 2; }); window.live.run(120); const before = window.live.painted(0).fraction; window.live.current.source.moving = false; window.live.run(480); return { before, after: window.live.painted(0, 0) }; });
    assert.ok(r.before > .02, `nothing painted first (${r.before})`); assert.ok(r.after.max <= 5, `left ${r.after.max}/255`);
  });
  await check('paint: clear returns exactly the ground', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(120); const { renderer, source } = window.live.current; source.moving = false; window.live.run(40); renderer.clear(); renderer.frame(0); return window.live.painted(0, 0); });
    assert.equal(r.max, 0);
  });
  await check('paint: white ground', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.paint.ground = 1; }); window.live.run(15); const corner = window.live.painted(255, 0, 0, .04); window.live.run(105); return { corner, all: window.live.painted(255) }; });
    assert.equal(r.corner.max, 0); assert.ok(r.all.fraction > .02, `only ${r.all.fraction} painted`);
  });
  await check('paint: a long stall does not fling or wipe the picture', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(120); const before = window.live.painted(0); window.live.current.renderer.frame(5); window.live.current.renderer.frame(NaN);
      return { before, after: window.live.painted(0) }; });
    assert.ok(Math.abs(r.after.fraction - r.before.fraction) < .02, `${r.before.fraction} -> ${r.after.fraction}`);
  });
  await check('paint: the camera image never reaches the artwork', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.paint.response = 0; }); window.live.run(120); return window.live.painted(0, 0); });
    assert.equal(r.max, 0);
  });
  // --- People in tracking ---
  await page.evaluate(() => {
    // people: person likelihood at a uv point (origin bottom-left, as the artwork shows it). still: the two timers there.
    window.live.peopleAt = (x, y) => { const p = window.live.current.renderer.readPeople(); const at = (img, ch, n) => img.data[(Math.min(img.height - 1, Math.floor(y * img.height)) * img.width + Math.min(img.width - 1, Math.floor(x * img.width))) * n + ch];
      return { people: at(p.people, 0, 4), still: at(p.still, 0, 4), deliberate: at(p.still, 1, 4) }; };
    window.live.peopleMax = (left = 0, right = 1, bottom = 0, top = 1) => { const { people } = window.live.current.renderer.readPeople(); let max = 0;
      for (let y = Math.floor(bottom * people.height); y < Math.floor(top * people.height); y++) for (let x = Math.floor(left * people.width); x < Math.floor(right * people.width); x++) max = Math.max(max, people.data[(y * people.width + x) * 4]);
      return max; };
    // Where the figure appears in the artwork: mirrored by default.
    window.live.figureAt = () => { const { source, renderer } = window.live.current, f = source.figurePlace(); return { x: renderer.settings.mirror ? 1 - f.x : f.x, y: f.y }; };
  });
  const POSTER = { x: 1 - .915, y: .72 }; // poster centre, mirrored
  // Nothing counts as moved during the first 2 s after a source starts (camera warm-up), so runs here go past that.
  await check('people: the figure is found and empty room is not', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.look = 'smoke'; }, { figure: true }); window.live.run(180); const f = window.live.figureAt();
      return { figure: window.live.peopleAt(f.x, f.y + .08).people, empty: window.live.peopleAt(f.x < .5 ? .9 : .1, .1).people }; });
    assert.ok(r.figure > .5, `figure ${r.figure}`); assert.ok(r.empty < .05, `empty room ${r.empty}`);
  });
  await check('people: the poster never counts; a figure standing with sway stays counted', async () => {
    const r = await page.evaluate(([px, py]) => { window.live.make(s => { s.look = 'smoke'; }, { figure: true }); window.live.run(180);
      const poster = window.live.peopleAt(px, py).people; window.live.current.source.standing = true; window.live.run(60 * 40); const f = window.live.figureAt();
      return { poster, posterLater: window.live.peopleAt(px, py).people, figure: window.live.peopleAt(f.x, f.y + .08).people }; }, [POSTER.x, POSTER.y]);
    assert.ok(r.poster < .05 && r.posterLater < .05, `poster ${r.poster}, ${r.posterLater}`); assert.ok(r.figure > .5, `standing figure ${r.figure}`);
  });
  await check('people: sway keeps the any-movement timer low while the deliberate timer counts up', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.look = 'smoke'; }, { figure: true }); window.live.run(180); window.live.current.source.standing = true; window.live.run(150); const f = window.live.figureAt();
      return window.live.peopleAt(f.x, f.y); });
    assert.ok(r.deliberate > 1, `deliberate ${r.deliberate}`); assert.ok(r.still < 1, `any ${r.still}`);
  });
  await check('people: nothing is found outside the area box', async () => {
    const max = await page.evaluate(() => { window.live.make(s => { s.look = 'smoke'; s.box.right = .5; }, { figure: true }); window.live.run(180); return window.live.peopleMax(.5, 1); });
    assert.equal(max, 0);
  });
  await check('people: a new source starts afresh (Review Focus 2)', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.look = 'smoke'; }, { figure: true }); window.live.run(90); const next = window.live.current.swap();
      window.live.current.renderer.frame(1 / 60); const f = window.live.figureAt();
      return { people: window.live.peopleMax(), still: window.live.peopleAt(f.x, f.y).still, nextFrames: next.frameId }; });
    assert.equal(r.people, 0); assert.ok(r.still > 1000, `timers carried over (${r.still})`);
  });
  await check('people: an empty-room capture asked for while a source is starting is not lost', async () => {
    const r = await page.evaluate(() => { const { renderer } = window.live.make(s => { s.look = 'smoke'; s.people.useEmptyRoom = true; }, { figure: true }); renderer.captureRoom(); window.live.run(1);
      window.live.current.swap(); window.live.run(1); const early = renderer.roomCaptured; window.live.run(180); return { early, later: renderer.roomCaptured }; });
    assert.equal(r.early, false, 'captured during the camera warm-up'); assert.equal(r.later, true, 'the capture was lost');
  });
  await check('people: Paint never starts person finding', async () => {
    const r = await page.evaluate(() => { window.live.make(undefined, { figure: true }); window.live.run(60); return window.live.current.made.providers; });
    assert.equal(r, 0);
  });
  // --- Recolouring and Show people ---
  await check('recolour: people stay visible on every palette, and bright stays bright (Review Focus 4)', async () => {
    const r = await page.evaluate(() => {
      const { THREE, Passes, recolourGLSL, setRamp, HOT_SIGNAL, POUR } = window.live.m;
      const canvas = new OffscreenCanvas(256, 4), renderer = new THREE.WebGLRenderer({ canvas }), passes = new Passes(renderer);
      // Brightness 0.1 → 0.9 left to right, standing in for a lit person.
      const bytes = new Uint8Array(256 * 4 * 4); for (let x = 0; x < 256; x++) for (let y = 0; y < 4; y++) { const v = Math.round((.1 + .8 * x / 255) * 255), i = (y * 256 + x) * 4; bytes.set([v, v, v, 255], i); }
      const ramp = new THREE.DataTexture(bytes, 256, 4); ramp.needsUpdate = true;
      const target = passes.target(256, 4), uniforms = { uImage: { value: ramp }, uRamp: { value: [] }, uRampShift: { value: 0 } };
      const material = passes.material(`${recolourGLSL}\nuniform sampler2D uImage;\nvoid main(){ vec3 c = recolour(texture2D(uImage, vUv).rgb, vUv, 0.); c = clamp(c, 0., 1.); gl_FragColor = vec4(mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)), 1.); }`, uniforms);
      const out = {};
      for (const [name, palette] of [['Hot Signal', HOT_SIGNAL], ['Pour', POUR]]) {
        setRamp(uniforms, palette, 0); passes.draw(material, target);
        const half = new Uint16Array(256 * 4 * 4); renderer.readRenderTargetPixels(target, 0, 0, 256, 4, half);
        const px = Array.from(half, v => window.live.m.fromHalf(v) * 255), at = x => px.slice(x * 4, x * 4 + 3), lum = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
        let darkest = 255; for (let x = 0; x < 256; x++) darkest = Math.min(darkest, Math.max(...at(x)));
        out[name] = { darkest, low: lum(at(4)), high: lum(at(251)) };
      }
      renderer.dispose(); return out;
    });
    for (const [name, v] of Object.entries(r)) { assert.ok(v.darkest >= 12, `${name} goes down to ${v.darkest}/255`); assert.ok(v.high > v.low, `${name}: bright ${v.high} not above dark ${v.low}`); }
  });
  await check('Show people lights the figure blue and the poster not at all', async () => {
    const r = await page.evaluate(([px, py]) => { window.live.make(s => { s.look = 'smoke'; }, { figure: true }); window.live.run(180); const { renderer } = window.live.current; renderer.view = 'people'; renderer.frame(1 / 60);
      const { data, width, height } = window.live.pixels(), f = window.live.figureAt(), at = (x, y) => { const i = (Math.floor((1 - y) * height) * width + Math.floor(x * width)) * 4; return [data[i], data[i + 1], data[i + 2]]; };
      return { figure: at(f.x, f.y + .08), poster: at(px, py) }; }, [POSTER.x, POSTER.y]);
    assert.ok(r.figure[2] > r.figure[0] + 40, `figure ${r.figure}`); assert.ok(r.poster[2] < r.poster[0] + 10, `poster ${r.poster}`);
    await save('show-people', await page.evaluate(() => window.live.png()));
  });
  // --- Smoke ---
  await page.evaluate(() => {
    // Smoke's layers: 'smoke' or 'all' (they are the same now people are made of smoke). Then the usual pixel helpers apply.
    window.live.layer = show => { window.live.current.renderer.look.show = show; window.live.current.renderer.frame(0); };
    // Painted pixels outside a box around the figure, and their centroid (y from the top).
    window.live.outsideFigure = () => { const { data, width, height } = window.live.pixels(), f = window.live.figureAt(), h = window.live.current.source.figurePlace().height;
      const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
      let count = 0, sy = 0, sum = 0, light = 0, n = 0; const x0 = (f.x - h * .32 * 9 / 16) * width, x1 = (f.x + h * .32 * 9 / 16) * width, y0 = (1 - f.y - h * .5) * height, y1 = (1 - f.y + h * .5) * height;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { if (x > x0 && x < x1 && y > y0 && y < y1) continue; const i = (y * width + x) * 4, v = Math.max(data[i], data[i + 1], data[i + 2]); sum = Math.max(sum, v); n++; light += .2126 * lin(data[i]) + .7152 * lin(data[i + 1]) + .0722 * lin(data[i + 2]); if (v > 8) { count++; sy += y / height; } }
      return { fraction: count / (width * height), y: count ? sy / count : 1, max: sum, light: light / n }; };
    // Mean brightness in linear light (the output is sRGB-encoded, which makes 10% of the light look like 35%).
    window.live.meanLuma = () => { const { data } = window.live.pixels(), lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
      let s = 0; for (let i = 0; i < data.length; i += 4) s += .2126 * lin(data[i]) + .7152 * lin(data[i + 1]) + .0722 * lin(data[i + 2]); return s / (data.length / 4); };
    window.live.difference = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4 * 3); };
    window.live.smoke = change => window.live.make(s => { s.look = 'smoke'; change?.(s); }, { figure: true });
    // Mean brightness in linear light inside the figure's torso.
    window.live.aboveHead = () => { const { data, width, height } = window.live.pixels(), f = window.live.figureAt(), h = window.live.current.source.figurePlace().height, lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
      let s = 0, n = 0; for (let y = 0; y < Math.floor((1 - f.y - h * .5) * height); y++) for (let x = Math.floor((f.x - .15) * width); x < Math.floor((f.x + .15) * width); x++) {
        const i = (y * width + x) * 4; s += .2126 * lin(data[i]) + .7152 * lin(data[i + 1]) + .0722 * lin(data[i + 2]); n++; } return s / Math.max(1, n); };
    window.live.figureBrightness = () => { const { data, width, height } = window.live.pixels(), f = window.live.figureAt(), lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
      let s = 0, n = 0; for (let y = Math.floor((1 - f.y - .1) * height); y < Math.floor((1 - f.y + .05) * height); y++) for (let x = Math.floor((f.x - .025) * width); x < Math.floor((f.x + .025) * width); x++) {
        const i = (y * width + x) * 4; s += .2126 * lin(data[i]) + .7152 * lin(data[i + 1]) + .0722 * lin(data[i + 2]); n++; } return s / n; };
  });
  await check('smoke: comes off the moving figure and rises', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); window.live.run(240); window.live.layer('smoke'); const before = window.live.outsideFigure();
      window.live.layer('all'); window.live.current.source.standing = true; window.live.run(120); window.live.layer('smoke'); const after = window.live.outsideFigure(); window.live.layer('all'); return { before, after }; });
    assert.ok(r.before.fraction > .01, `only ${r.before.fraction} smoke`); assert.ok(r.after.y < r.before.y, `centroid ${r.before.y} -> ${r.after.y}`);
    await save('smoke', await page.evaluate(() => window.live.png()));
  });
  await check('smoke: keeps moving after the figure stops', async () => {
    const d = await page.evaluate(() => { window.live.smoke(); window.live.run(240); window.live.current.source.moving = false; window.live.current.source.figure = true; window.live.run(30);
      const a = window.live.pixels().data.slice(); window.live.run(30); return window.live.difference(a, window.live.pixels().data); });
    assert.ok(d > .5, `mean change ${d}/255`);
  });
  await check('smoke: higher Density gives a brighter figure', async () => {
    const r = await page.evaluate(() => { const at = density => { window.live.smoke(s => { s.smoke.density = density; }); window.live.run(240); window.live.current.source.standing = true; window.live.run(120); return window.live.figureBrightness(); };
      return { thin: at(.25), thick: at(1) }; });
    assert.ok(r.thick > r.thin * 1.5, `density 1: ${r.thick}, density 0.25: ${r.thin}`);
  });
  await check('smoke: the camera picture never reaches the artwork', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); window.live.run(30); const look = window.live.current.renderer.look;
      return Object.entries(look).filter(([, v]) => v?.isShaderMaterial).map(([k, v]) => [k, 'uCamera' in v.uniforms]); });
    assert.ok(r.length >= 3, `found ${r.length} materials`); assert.deepEqual(r.filter(([, has]) => has), []);
  });
  // Three seconds after the figure stops: what a still figure sheds rises off it, so it is measured above the head.
  await check('smoke: the three Start from points are clearly different', async () => {
    const r = await page.evaluate(() => { const starts = { wispy: { density: .25, smoulder: .9, rise: .8, swirl: .7, lifeSeconds: 4, response: 1.5 }, solid: { density: 1, smoulder: .1, rise: .15, swirl: .3, lifeSeconds: 10, response: .7 } };
      const out = {}; for (const [name, values] of Object.entries(starts)) { window.live.smoke(s => Object.assign(s.smoke, values)); window.live.run(240); window.live.current.source.standing = true; window.live.run(180);
        window.live.layer('smoke'); out[name] = { inside: window.live.figureBrightness(), outside: window.live.aboveHead() }; window.live.layer('all'); } return out; });
    assert.ok(r.solid.inside > r.wispy.inside * 1.5, `figure brightness: solid ${r.solid.inside}, wispy ${r.wispy.inside}`);
    assert.ok(r.wispy.outside > r.solid.outside * 1.5, `smoke off the figure: wispy ${r.wispy.outside}, solid ${r.solid.outside}`);
  });
  // 20 s: at the default Smoke life of 6 s, older smoke is then far below one 8-bit step.
  await check('smoke: with Smoulder at 0 a still figure sheds almost nothing', async () => {
    const r = await page.evaluate(() => { window.live.smoke(s => { s.smoke.smoulder = 0; }); window.live.run(240); window.live.current.source.standing = true; window.live.run(1200);
      window.live.layer('smoke'); const out = window.live.outsideFigure(); window.live.layer('all'); return out; });
    assert.ok(r.max < 5, `smoke up to ${r.max}/255 after 20 s still`);
  });
  await check('smoke: nothing that never moved smokes, the poster included', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); window.live.current.source.moving = false; window.live.run(600); return window.live.painted(0, 2); });
    assert.ok(r.fraction < .001, `${r.fraction} painted, up to ${r.max}`);
  });
  await check('smoke: clear gives exactly black', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); window.live.run(240); const { renderer, source } = window.live.current; source.moving = false; renderer.settings.smoke.smoulder = 0;
      renderer.clear(); renderer.look.show = 'smoke'; renderer.frame(0); const out = window.live.painted(0, 0); renderer.look.show = 'all'; return out; });
    assert.equal(r.max, 0);
  });
  await check('smoke: a frame full of people does not turn into a white sheet (Review Focus 3)', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); window.live.run(150); window.live.current.made.provider.coverAll = true; window.live.run(600);
      const { data } = window.live.pixels(); let hot = 0; for (let i = 0; i < data.length; i += 4) if (Math.min(data[i], data[i + 1], data[i + 2]) > 250) hot++; return hot / (data.length / 4); });
    assert.ok(r < .05, `${(r * 100).toFixed(1)}% white`);
  });
  await check('smoke: without person finding, movement still makes smoke (Review Focus 5)', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); window.live.run(240); window.live.current.made.provider.dispose(); window.live.run(180);
      const a = window.live.pixels().data.slice(); window.live.run(30); return { painted: window.live.painted(0).fraction, change: window.live.difference(a, window.live.pixels().data), ready: window.live.current.renderer.peopleDiagnostics().ready }; });
    assert.equal(r.ready, false); assert.ok(r.painted > .01, `${r.painted} painted`); assert.ok(r.change > .3, `change ${r.change}`);
  });
  await check('smoke: a long stall does not throw smoke across the picture', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); window.live.run(240); const before = window.live.painted(0).fraction; window.live.current.renderer.frame(5); return { before, after: window.live.painted(0).fraction }; });
    assert.ok(Math.abs(r.after - r.before) < .05, `${r.before} -> ${r.after}`);
  });
  // --- Review fixes ---
  await check('smoke: bright movement across the whole frame does not go white, with or without people found (Review Focus 3)', async () => {
    const r = await page.evaluate(() => {
      const white = () => { const { data } = window.live.pixels(); let hot = 0; for (let i = 0; i < data.length; i += 4) if (Math.min(data[i], data[i + 1], data[i + 2]) > 250) hot++; return hot / (data.length / 4); };
      const run = fallback => { window.live.smoke(); const { source, made } = window.live.current; source.field = true; window.live.run(150);
        if (fallback) made.provider.dispose(); else made.provider.coverAll = true; window.live.run(600); return white(); };
      return { covered: run(false), fallback: run(true) };
    });
    assert.ok(r.covered < .05, `${(r.covered * 100).toFixed(1)}% white with people everywhere`); assert.ok(r.fallback < .05, `${(r.fallback * 100).toFixed(1)}% white without people found`);
  });
  await check('smoke: the person fades out when people stop being found, and fades back in (Review Focus 5)', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); window.live.run(240); const { made } = window.live.current, person = () => window.live.figureBrightness();
      window.live.current.source.standing = true; window.live.run(30); const before = person(); made.provider.paused = true; window.live.run(120 + 30); const fading = person(); window.live.run(240); const gone = person();
      made.provider.paused = false; window.live.run(30); const returning = person(); window.live.run(90); const back = person(); return { before, fading, gone, returning, back }; });
    // The figure is smoke: without people it stops being fed, drifts and thins away at the pace of Smoke life, and fills back in when they are found.
    assert.ok(r.gone < r.before * .5, `gone: ${r.gone} of ${r.before}`);
    assert.ok(r.back > r.before * .5, `back: ${r.back} of ${r.before}`);
  });
  await check('people: a lighting change across the whole picture does not wake the poster', async () => {
    const r = await page.evaluate(([px, py]) => { window.live.make(s => { s.look = 'smoke'; }, { figure: true }); window.live.run(180); const { source } = window.live.current;
      source.brightness = .15; window.live.run(20); return { poster: window.live.peopleAt(px, py), figure: window.live.peopleAt(window.live.figureAt().x, window.live.figureAt().y + .08).people }; }, [POSTER.x, POSTER.y]);
    assert.ok(r.poster.people < .05, `poster ${r.poster.people} (any-movement timer ${r.poster.still})`); assert.ok(r.figure > .5, `figure ${r.figure}`);
  });
  await check('people: an error starting person finding does not stop Live', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.look = 'smoke'; }, { figure: true }); const { renderer } = window.live.current;
      renderer.tracking.makeProvider = () => { throw new Error('no worker here'); };
      let frames = 0; for (let i = 0; i < 60; i++) { try { window.live.current.source.advance(1 / 60); renderer.frame(1 / 60); frames++; } catch { break; } }
      return { frames, status: renderer.peopleDiagnostics().status }; });
    assert.equal(r.frames, 60); assert.equal(r.status.state, 'failed'); assert.match(r.status.reason, /no worker here/);
  });
  // --- Second try-out: smoke, not a cut-out ---
  await page.evaluate(() => {
    const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    // Linear brightness of every canvas pixel, with how much of a person is there (0..1) from the people texture.
    window.live.withPeople = () => { const { data, width, height } = window.live.pixels(), { people } = window.live.current.renderer.readPeople(); const out = [];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4, px = Math.floor(x / width * people.width), py = Math.floor((1 - (y + .5) / height) * people.height);
        out.push([.2126 * lin(data[i]) + .7152 * lin(data[i + 1]) + .0722 * lin(data[i + 2]), people.data[(py * people.width + px) * 4], x / width, y / height]); } return out; };
    // Fine detail inside the figure: mean difference between neighbouring pixels (1 and 2 pixels apart), in 8-bit steps, where it is lit.
    window.live.figureDetail = () => { const { data, width, height } = window.live.pixels(), { people } = window.live.current.renderer.readPeople(); let sum = 0, n = 0;
      const v = (x, y) => { const i = (y * width + x) * 4; return .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]; };
      for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) { const px = Math.floor(x / width * people.width), py = Math.floor((1 - (y + .5) / height) * people.height);
        if (people.data[(py * people.width + px) * 4] < .9 || v(x, y) < 20) continue; sum += Math.abs(v(x + 1, y) - v(x, y)) + Math.abs(v(x, y + 1) - v(x, y)) + .5 * (Math.abs(v(x + 2, y) - v(x, y)) + Math.abs(v(x, y + 2) - v(x, y))); n++; }
      return sum / Math.max(1, n); };
    // At the middle of Calm ↔ Wild: a thin figure is broken up by the eddies, which calmer settings smooth out.
    window.live.stillFigure = density => { window.live.smoke(s => { s.smoke.swirl = .5; if (density !== undefined) s.smoke.density = density; }); window.live.run(240); window.live.current.source.standing = true; window.live.run(240); return window.live.withPeople(); };
  });
  await check('smoke: a low-Density figure has dark gaps, more than a high-Density one', async () => {
    const r = await page.evaluate(() => { const gaps = density => { const inside = window.live.stillFigure(density).filter(p => p[1] > .9).map(p => p[0]); const top = [...inside].sort((a, b) => a - b)[Math.floor(inside.length * .9)];
      return inside.filter(v => v < top * .3).length / inside.length; }; return { thin: gaps(.25), thick: gaps(1) }; });
    assert.ok(r.thin > .2, `only ${(r.thin * 100).toFixed(0)}% of a Density 0.25 figure is gaps`); assert.ok(r.thin > r.thick, `thin ${r.thin}, thick ${r.thick}`);
  });
  await check('smoke: the outline is not brighter than the inside of the figure', async () => {
    const r = await page.evaluate(() => { const px = window.live.stillFigure(), mean = list => list.reduce((a, b) => a + b, 0) / list.length;
      return { edge: mean(px.filter(p => p[1] > .2 && p[1] < .6).map(p => p[0])), inside: mean(px.filter(p => p[1] > .9).map(p => p[0])) }; });
    assert.ok(r.edge <= r.inside * 1.1, `outline ${r.edge}, inside ${r.inside}`);
  });
  await check('smoke: smoke does not build up at the frame edges', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); const { source, made } = window.live.current; source.field = true; window.live.run(1); made.provider.dispose(); window.live.run(600); source.field = false; source.moving = false; window.live.run(180);
      const px = window.live.withPeople(), mean = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0, border = p => Math.min(p[2], 1 - p[2], p[3], 1 - p[3]) < .03;
      return { border: mean(px.filter(border).map(p => p[0])), middle: mean(px.filter(p => !border(p)).map(p => p[0])) }; });
    // A picture that has fully cleared passes too.
    assert.ok(r.border <= r.middle || r.border < 1e-4, `edges ${r.border}, middle ${r.middle}`);
  });
  await check('smoke: with a figure moving at the default settings, most of the picture stays dark', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); window.live.run(600); return window.live.painted(0, 8).fraction; });
    assert.ok(r < .5, `${(r * 100).toFixed(0)}% of the picture has smoke`);
  });
  // --- Third try-out: clear air, texture that travels ---
  await check('smoke: faint haze clears to black, even with long Smoke life', async () => {
    // Faint smoke everywhere (gentle movement across the whole frame, no people found), then everything stops: the leftover haze must clear.
    const r = await page.evaluate(() => { window.live.smoke(s => Object.assign(s.smoke, { lifeSeconds: 12, response: .15 })); const { source, made } = window.live.current; source.field = true; window.live.run(1); made.provider.dispose();
      window.live.run(300); source.field = false; source.moving = false; window.live.run(240);
      const { data } = window.live.pixels(); let haze = 0; for (let i = 0; i < data.length; i += 4) { const v = Math.max(data[i], data[i + 1], data[i + 2]); if (v > 3 && v < 100) haze++; } return haze / (data.length / 4); });
    // Without clear air this scene leaves about 60% of the picture as dim haze; clear air must cut that to well under half.
    assert.ok(r < .25, `${(r * 100).toFixed(0)}% of the picture is dim haze four seconds after everything stopped`);
  });
  await check('smoke: the texture inside a moving figure travels with it', async () => {
    const r = await page.evaluate(() => { window.live.smoke(s => { s.smoke.density = .6; s.smoke.smoulder = 0; }); window.live.run(240);
      const patch = (data, width, height, cx, cy) => { const out = []; for (let y = -12; y < 12; y++) for (let x = -12; x < 12; x++) { const i = ((Math.floor((1 - cy) * height) + y) * width + Math.floor(cx * width) + x) * 4; out.push(data[i] + data[i + 1] + data[i + 2]); } return out; };
      const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
      let screen = 0, travelling = 0;
      for (let k = 0; k < 6; k++) {
        const one = window.live.pixels(), f1 = window.live.figureAt(); const a = patch(one.data, one.width, one.height, f1.x, f1.y + .05);
        window.live.run(4); const two = window.live.pixels(), f2 = window.live.figureAt();
        screen += diff(a, patch(two.data, two.width, two.height, f1.x, f1.y + .05)); travelling += diff(a, patch(two.data, two.width, two.height, f2.x, f2.y + .05)); window.live.run(20);
      }
      return { screen, travelling }; });
    assert.ok(r.travelling < r.screen, `with the figure ${r.travelling}, fixed to the screen ${r.screen}`);
  });
  // --- Emit and Forever ---
  await check('smoke: at Emit 0 a moving figure adds far less smoke than at Emit 1', async () => {
    const r = await page.evaluate(() => { const at = emit => { window.live.smoke(s => { s.smoke.emit = emit; }); window.live.run(360); window.live.layer('smoke'); const out = window.live.outsideFigure().light; window.live.layer('all'); return out; };
      return { none: at(0), full: at(1) }; });
    assert.ok(r.none < r.full * .3, `Emit 0: ${r.none}, Emit 1: ${r.full}`);
  });
  await check('smoke: on Forever, smoke stays in the picture and movement pushes it around', async () => {
    const r = await page.evaluate(() => { window.live.smoke(s => { s.smoke.forever = true; s.smoke.emit = 1; }); window.live.run(360); const { renderer } = window.live.current;
      const off = () => { window.live.layer('smoke'); const v = window.live.outsideFigure().light; window.live.layer('all'); return v; };
      renderer.settings.smoke.emit = 0; window.live.run(1); const before = off(), a = window.live.pixels().data.slice();
      window.live.run(600); return { before, after: off(), change: window.live.difference(a, window.live.pixels().data) }; });
    assert.ok(r.after > r.before * .6, `smoke off the figure ${r.before} -> ${r.after} after 10 s with nothing added`); assert.ok(r.change > 2, `the smoke barely moved (${r.change}/255)`);
  });
  await check('smoke: Forever keeps smoke at the frame edges instead of letting it drift out', async () => {
    const r = await page.evaluate(() => { window.live.smoke(s => { s.smoke.forever = true; s.smoke.emit = 1; s.smoke.rise = 1; }); window.live.run(600);
      const { renderer, source } = window.live.current; renderer.settings.smoke.emit = 0; source.moving = false; window.live.run(300);
      const { data, width, height } = window.live.pixels(); let top = 0; for (let y = 0; y < Math.floor(height * .05); y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; top = Math.max(top, data[i], data[i + 1], data[i + 2]); } return top; });
    assert.ok(r > 20, `top edge up to ${r}/255: the risen smoke left the picture`);
  });
  // --- Fourth try-out: a real camera's faint readings ---
  await check('smoke: a faint trace of a person across the room draws nothing there (real-camera confetti)', async () => {
    const r = await page.evaluate(() => { window.live.smoke(); window.live.current.made; window.live.run(1); window.live.current.made.provider.faintRoom = .25; window.live.run(360);
      window.live.current.source.standing = true; window.live.run(600); const f = window.live.figureAt(); let lit = 0, n = 0; const { data, width, height } = window.live.pixels();
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { if (Math.abs(x / width - f.x) < .25) continue; n++; const i = (y * width + x) * 4; if (Math.max(data[i], data[i + 1], data[i + 2]) > 8) lit++; }
      return lit / n; });
    assert.ok(r < .05, `${(r * 100).toFixed(0)}% of the room away from the figure is lit`);
  });
  // --- Fifth try-out: the figure back in the smoke, Forever capped ---
  // The figure is poured into the smoke itself, as in the version Greg approved, not drawn over it: at any Emit.
  await check('smoke: even at Emit 0 the figure is part of the smoke itself', async () => {
    const r = await page.evaluate(() => { const at = emit => { window.live.smoke(s => { s.smoke.emit = emit; }); window.live.run(240); window.live.current.source.standing = true; window.live.run(180);
      window.live.layer('smoke'); const v = window.live.figureBrightness(); window.live.layer('all'); return v; }; return { none: at(0), usual: at(.6) }; });
    assert.ok(r.none > r.usual * .5, `figure in the smoke at Emit 0: ${r.none}, at 0.6: ${r.usual}`);
  });
  await check('smoke: Forever with Emit at full stops adding before the picture is full', async () => {
    const r = await page.evaluate(() => { window.live.smoke(s => { s.smoke.forever = true; s.smoke.emit = 1; }); const { source, made } = window.live.current; source.field = true; window.live.run(1); made.provider.dispose();
      window.live.run(1200); return window.live.painted(0, 40).fraction; });
    // Visible smoke: with nothing fading, the faintest trace spreads everywhere and does not swamp the picture.
    assert.ok(r < .8, `${(r * 100).toFixed(0)}% of the picture has visible smoke`);
  });
  // --- Sixth try-out: calm or wild, vivid ---
  await page.evaluate(() => {
    // Fine detail in the smoke away from the figure, and how saturated its colours are, where it is lit.
    window.live.offFigure = () => { const { data, width, height } = window.live.pixels(), f = window.live.figureAt(); let detail = 0, n = 0, sat = 0, m = 0;
      const v = (x, y) => { const i = (y * width + x) * 4; return .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]; };
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) { if (Math.abs(x / width - f.x) < .15) continue; const i = (y * width + x) * 4, hi = Math.max(data[i], data[i + 1], data[i + 2]); if (hi < 30) continue;
        detail += Math.abs(v(x + 1, y) - v(x, y)) + Math.abs(v(x, y + 1) - v(x, y)); n++; sat += (hi - Math.min(data[i], data[i + 1], data[i + 2])) / hi; m++; }
      return { detail: detail / Math.max(1, n), saturation: sat / Math.max(1, m), lit: n }; };
  });
  await check('smoke: Calm gives smooth flowing smoke, Wild breaks it into curls', async () => {
    const r = await page.evaluate(() => { const at = swirl => { window.live.smoke(s => { s.smoke.swirl = swirl; s.smoke.response = 2; }); window.live.run(360); return window.live.offFigure(); }; return { calm: at(0), wild: at(1) }; });
    assert.ok(r.calm.lit > 1000 && r.wild.lit > 1000, `too little smoke to judge (${r.calm.lit}, ${r.wild.lit})`);
    assert.ok(r.calm.detail < r.wild.detail * .6, `calm ${r.calm.detail.toFixed(2)}, wild ${r.wild.detail.toFixed(2)}`);
  });
  await check('smoke: Vividness keeps mixed colours saturated instead of grey', async () => {
    const r = await page.evaluate(() => { const at = vividness => { window.live.smoke(s => { s.smoke.vividness = vividness; s.smoke.swirl = 1; s.smoke.colourChange = 1; s.smoke.palette = [...window.live.m.NEON_STRATA]; }); window.live.run(480); return window.live.offFigure().saturation; };
      return { flat: at(0), vivid: at(1) }; });
    assert.ok(r.vivid > r.flat * 1.3, `saturation at Vividness 1: ${r.vivid.toFixed(2)}, at 0: ${r.flat.toFixed(2)}`);
  });
  /* STAGES */
  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await app.close();
}
console.log(results.join('\n'));
