// Reproduce a saved composition in an isolated packaged profile, without
// changing its effect settings. Optional comparison against an earlier bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'work/smart-repeat');
const bundle=path.resolve(process.argv[2]||'work/release/mac-arm64/Form & Field.app');
const input=process.argv[3];
if(!input)throw Error('Pass a saved .formfield fixture as the second argument.');
const label=process.argv[4]||'updated',raw=await fs.readFile(input),project=JSON.parse(raw);
await fs.mkdir(out,{recursive:true});const profile=await fs.mkdtemp(path.join(out,'comparison-profile-'));
await fs.writeFile(path.join(profile,'autosave.formfield'),raw);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
const app=await electron.launch({executablePath:path.join(bundle,'Contents/MacOS/Form & Field'),args:[`--user-data-dir=${profile}`],env}),page=await app.firstWindow(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.setDefaultTimeout(30000);
try{
 await page.getByText('Export engine ready',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByTitle('Return to start',{exact:true}).click();
 const layer=project.layers.find(l=>l.kind==='graphic');
 if(layer)await page.getByRole('button',{name:'Select '+layer.name,exact:true}).click();
 await page.screenshot({path:path.join(out,label+'-editor.png'),fullPage:true});
 await page.getByRole('button',{name:'Export',exact:true}).click();await page.getByLabel('Export resolution',{exact:true}).selectOption('960x540');
 const file=path.join(out,label+'-composition.png');
 await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},file);
 await page.getByRole('button',{name:'Save PNG still',exact:true}).click();await page.getByText('PNG saved.',{exact:true}).waitFor({timeout:60000});
 const saved=await page.evaluate(()=>window.studio.loadAutosave());assert.deepEqual(saved,project,'Comparison must not edit the user composition');
 const decoded=spawnSync(path.join(bundle,'Contents/Resources/media/ffmpeg'),['-v','error','-nostdin','-i',file,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1'],{maxBuffer:8*1024*1024,timeout:30000});assert.equal(decoded.status,0,decoded.stderr.toString());
 let opaque=0;for(let i=3;i<decoded.stdout.length;i+=4)if(decoded.stdout[i]===255)opaque++;
 assert.deepEqual(errors,[]);const result={status:'passed',bundle,label,compositionPreserved:true,width:960,height:540,opaquePixels:opaque,errors};
 await fs.writeFile(path.join(out,label+'-ui.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{const timer=setTimeout(()=>app.process().kill('SIGKILL'),10000);try{await app.close();}finally{clearTimeout(timer);}}
