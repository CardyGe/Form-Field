// Encode short GPU art-review captures with an explicit, audited colour path.
// node scripts/fractal-study.review.mjs <snapshot-label> [preset-id]
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2], selected = process.argv[3];
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(label || '')) throw new Error('A snapshot label is required.');
if (selected && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(selected)) throw new Error('Invalid preset id.');
const directory = path.join(root, 'work/fractal-study', label);
const report = JSON.parse(await fs.readFile(path.join(directory, 'report.json'), 'utf8'));
if (report.status === 'failed') throw new Error('Cannot review a failed renderer capture.');
const candidates = (report.motionReview || []).filter(item => !selected || item.preset === selected);
if (!candidates.length) throw new Error('No motion captures. Run the GPU harness with --motion first.');
const verification = { verifiedAt: new Date().toISOString(), rendererSha256: report.snapshot.bundleSha256, clips: [] };
for (const item of candidates) {
  const raw = path.join(directory, `motion-${item.preset}.yuv`);
  const output = path.join(directory, `motion-${item.preset}.mp4`);
  const options = { maxBuffer: 4*1024*1024 };
  await run(path.join(root, 'build/media/ffmpeg'), ['-v','error','-y','-framerate',String(item.fps),'-i',path.join(directory,`motion-${item.preset}-%04d.png`),
    '-frames:v',String(item.frameCount),'-an','-vf','format=gbrp16le,zscale=pin=709:tin=iec61966-2-1:min=gbr:rin=full:p=709:t=709:m=709:r=limited:d=error_diffusion,format=yuv420p',
    '-c:v','rawvideo','-pix_fmt','yuv420p','-f','rawvideo',raw], options);
  await run('/opt/homebrew/bin/ffmpeg', ['-v','error','-y','-f','rawvideo','-pixel_format','yuv420p','-video_size',`${item.width}x${item.height}`,
    '-framerate',String(item.fps),'-i',raw,'-frames:v',String(item.frameCount),'-an','-vf','setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v','libx264','-preset','medium','-crf','16','-movflags','+faststart','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv',output], options);
  await run('/opt/homebrew/bin/ffmpeg', ['-v','error','-xerror','-i',output,'-f','null','-'], options);
  const probe = JSON.parse((await run('/opt/homebrew/bin/ffprobe', ['-v','error','-count_frames','-show_streams','-show_format','-of','json',output], options)).stdout);
  const video = probe.streams[0];
  if (Number(video.nb_read_frames)!==item.frameCount || video.width!==item.width || video.height!==item.height ||
      video.color_space!=='bt709' || video.color_transfer!=='bt709' || video.color_primaries!=='bt709' || video.color_range!=='tv') throw new Error('Motion-review metadata mismatch.');
  const bytes = await fs.readFile(output);
  verification.clips.push({ preset:item.preset,path:output,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),fullDecodeVerified:true,source:item,ffprobe:probe });
  await fs.rm(raw);
}
await fs.writeFile(path.join(directory, 'motion-review-verification.json'), JSON.stringify(verification,null,2));
console.log(JSON.stringify({status:'review-clips-ready',rendererSha256:verification.rendererSha256,clips:verification.clips.map(({preset,path,bytes})=>({preset,path,bytes}))},null,2));
