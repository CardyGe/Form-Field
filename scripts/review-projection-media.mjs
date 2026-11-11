import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'work/projection-media');
const ffmpeg=process.env.REVIEW_FFMPEG??'/opt/homebrew/bin/ffmpeg',ffprobe=process.env.REVIEW_FFPROBE??path.join(path.dirname(ffmpeg),'ffprobe');
const run=(binary,args)=>{const r=spawnSync(binary,['-v','error',...args],{maxBuffer:32*1024*1024,timeout:60000});assert.equal(r.status,0,r.stderr?.toString()||r.error?.message);return r.stdout;};
const results=[];
for(const name of ['silk-river','ink-estuary','breathing-facade']){
 const project=JSON.parse(await fs.readFile(path.join(out,name+'.formfield'),'utf8')),file=path.join(out,name+'.mp4'),frames=project.duration*24;
 const stream=JSON.parse(run(ffprobe,['-count_frames','-show_streams','-of','json',file])).streams[0];assert.equal(Number(stream.nb_read_frames),frames);assert.equal(stream.width,640);assert.equal(stream.height,360);assert.equal(stream.avg_frame_rate,'24/1');
 const select=`select=eq(n\\,0)+eq(n\\,1)+eq(n\\,${frames-2})+eq(n\\,${frames-1})`;
 const bytes=run(ffmpeg,['-i',file,'-vf',select,'-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
 const size=640*360*3;assert.equal(bytes.length,size*4);const parts=Array.from({length:4},(_,i)=>bytes.subarray(i*size,(i+1)*size));
 const delta=(a,b)=>{let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;};
 const head=delta(parts[0],parts[1]),tail=delta(parts[2],parts[3]),seam=delta(parts[3],parts[0]);
 const evolving=project.layers.some(l=>l.kind==='livingink'&&l.params.inkMode===2);
 if(!evolving)assert.ok(seam<=4*Math.max(head,tail,1/255),name+' unexplained boundary jump '+JSON.stringify({head,tail,seam}));
 const hashes=run(ffmpeg,['-i',file,'-f','framemd5','pipe:1']).toString().split('\n').filter(s=>s&&!s.startsWith('#')).map(s=>s.split(',').at(-1).trim());assert.equal(hashes.length,frames);assert.ok(new Set(hashes).size>1,name+' static movie');
 run(ffmpeg,['-y','-i',file,'-vf',`fps=12/${project.duration},scale=320:180,tile=4x3:padding=4:margin=4:color=0x101318`,'-frames:v','1',path.join(out,name+'-motion-sheet.png')]);
 results.push({name,frames,duration:project.duration,evolving,distinctDecodedFrames:new Set(hashes).size,meanByteChanges:{head,tail,seam},boundaryChecked:!evolving});
}
await fs.writeFile(path.join(out,'temporal-report.json'),JSON.stringify({status:'passed',results},null,2));console.log(JSON.stringify(results));
