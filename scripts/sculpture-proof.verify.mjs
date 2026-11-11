// Independent decoded alpha/PNG inspection after sculpture-proof.cjs completes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'work/sculpture-proof');
const active = JSON.parse(await fs.readFile(path.join(directory, 'active-job.json'), 'utf8'));
const source = path.join(active.directory, 'media.mov');
const verification = JSON.parse(await fs.readFile(path.join(directory, 'verification.json'), 'utf8'));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('/opt/homebrew/bin/ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = ''; child.stderr.on('data', bytes => { error = (error + bytes).slice(-65536); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
  });
}
const alphaPath = path.join(directory, 'decoded-alpha-samples.gray16');
await run(['-v','error','-y','-i',source,'-vf',"select='eq(n,0)+eq(n,150)+eq(n,299)',alphaextract,format=gray16le",'-fps_mode','passthrough','-f','rawvideo',alphaPath]);
const alpha = await fs.readFile(alphaPath);
const pixels = 3840 * 2160;
if (alpha.length !== pixels * 2 * 3) throw new Error('Unexpected alpha sample count.');
const frames = [];
for (let frame = 0; frame < 3; frame++) {
  let zero=0, soft=0, solid=0, min=65535, max=0;
  for (let i=0;i<pixels;i++) {
    const value=alpha.readUInt16LE((frame*pixels+i)*2); min=Math.min(min,value);max=Math.max(max,value);
    if(value===0)zero++;else if(value>=65520)solid++;else soft++;
  }
  if (!zero || !soft || !solid) throw new Error('Decoded ProRes alpha lost expected zero, fractional or solid coverage.');
  frames.push({ frame:[0,150,299][frame], zero, soft, solid, min, max });
}
const pngPath = path.join(directory, 'decoded-still.rgba');
await run(['-v','error','-y','-i',path.join(directory,'Sculpted-Opal-v2-4K-alpha.png'),'-frames:v','1','-pix_fmt','rgba','-f','rawvideo',pngPath]);
const rgba = await fs.readFile(pngPath);
if(rgba.length!==pixels*4)throw new Error('Unexpected PNG pixel count.');
let zero=0,soft=0,solid=0,zeroAlphaRGB=0;
for(let i=0;i<rgba.length;i+=4){const a=rgba[i+3];if(a===0){zero++;if(rgba[i]||rgba[i+1]||rgba[i+2])zeroAlphaRGB++;}else if(a===255)solid++;else soft++;}
if(!zero||!soft||!solid||zeroAlphaRGB)throw new Error('PNG alpha/RGB cleanup check failed.');
const report={createdAt:new Date().toISOString(),rendererFingerprint:active.rendererFingerprint,
  decodedProResAlpha:frames,png:{width:3840,height:2160,zero,soft,solid,zeroAlphaRGB},
  fullDecodeVerified:verification.fullDecodeVerified,previewFullDecodeVerified:verification.preview?.fullDecodeVerified===true};
await fs.writeFile(path.join(directory,'decoded-alpha-verification.json'),JSON.stringify(report,null,2));
await fs.rm(alphaPath);await fs.rm(pngPath);
console.log(JSON.stringify(report,null,2));
