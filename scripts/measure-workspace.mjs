import fs from 'node:fs/promises';
import path from 'node:path';
import {_electron as electron} from 'playwright';
const root=process.cwd(),label=process.argv[2]||'after',out=path.join(root,'work/workspace-ui');
await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
await fs.writeFile(path.join(out,'measure-main.cjs'),`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
const app=await electron.launch({args:[path.join(out,'measure-main.cjs')],env}),page=await app.firstWindow();
try {
 await page.getByText('Export engine ready',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 const results=[];
 for(const [width,height] of [[1180,760],[1440,900],[1920,1080]]){
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),[width,height]);
  await page.waitForTimeout(400);
  const metrics=await page.evaluate(()=>{
   const c=document.querySelector('canvas[aria-label="Composition preview"]'),r=c.getBoundingClientRect();
   return {viewport:{width:innerWidth,height:innerHeight},canvas:{width:r.width,height:r.height,area:r.width*r.height},coverage:r.width*r.height/(innerWidth*innerHeight)};
  });
  results.push(metrics);
  await page.screenshot({path:path.join(out,`${label}-${width}.png`)});
 }
 await fs.writeFile(path.join(out,label+'.json'),JSON.stringify(results,null,2));console.log(results);
} finally {await app.close();}
