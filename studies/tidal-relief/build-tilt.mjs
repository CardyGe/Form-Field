// Run from the repository root with: node studies/tidal-relief/build-tilt.mjs
import fs from 'node:fs/promises';
import {build} from 'esbuild';

const bundle=await build({
  entryPoints:['studies/tidal-relief/tilt-viewer.mjs'],bundle:true,
  minify:true,format:'iife',write:false,
});
const script=bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const dir='work/tilt-club';
await fs.mkdir(dir,{recursive:true});
await fs.writeFile(dir+'/Tilt Club.html',`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tilt Club</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0c1020;color:#f9ecdc;font:15px system-ui;display:grid;place-items:center;height:100dvh}
canvas{display:block;width:min(100vw,177.777dvh);height:auto;cursor:pointer}nav{position:fixed;bottom:14px;display:flex;align-items:center;gap:12px;padding:7px 10px;background:#191326eb;border:1px solid #fff3;border-radius:7px}input{width:min(28vw,240px);accent-color:#ffbe36}
button{font:inherit;color:inherit;background:none;border:none;min-width:52px;cursor:pointer}#jackpot{font-weight:700;background:#ffbf3e;color:#24132b;border-radius:4px;padding:6px 10px}
</style><canvas aria-label="Kinetic pinball wall"></canvas><nav aria-label="Playback"><button id="play">Pause</button><input aria-label="Loop position" type="range" min="0" max="1" step=".001" value="0"><button id="jackpot" title="Trigger jackpot · Space">Jackpot</button></nav><script>${script}</script></html>`);
