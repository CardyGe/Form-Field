import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'work/graphics-build/ui');
await fs.mkdir(out,{recursive:true});
await fs.rm(path.join(out,'user-data'),{recursive:true,force:true});
const projectFile=path.join(out,'graphics.formfield');
await fs.writeFile(path.join(out,'main.cjs'),`const {app,dialog}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'user-data'))});dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(projectFile)}});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(projectFile)}]});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
const app=await electron.launch({args:[path.join(out,'main.cjs')],env,cwd:root}),page=await app.firstWindow(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.setDefaultTimeout(15000);
try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1520,980));
  await page.getByRole('button',{name:'Add graphic patterns',exact:true}).click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('combobox',{name:'Graphic family',exact:true}).waitFor();
  const counts=[];
  for(let style=0;style<5;style++){
    await page.getByRole('combobox',{name:'Graphic family',exact:true}).selectOption(String(style));
    const names=await page.getByRole('combobox',{name:'Graphic look',exact:true}).locator('option').allTextContents();
    assert.ok(names.length>=3);
    const count=await page.locator('.inspector-content .parameter').count();assert.ok(count>=20,'detailed family controls');counts.push({style,count,looks:names.length});
    await page.waitForTimeout(200);assert.equal(await page.getByRole('alert').count(),0);
    await page.screenshot({path:path.join(out,`family-${style}.png`)});
  }
  await page.getByRole('combobox',{name:'Graphic family',exact:true}).selectOption('2');
  await page.getByRole('combobox',{name:'Graphic look',exact:true}).selectOption('2');
  const input=page.getByRole('spinbutton',{name:'Contour spacing value',exact:true});await input.fill('8');await input.press('Enter');
  await page.getByRole('button',{name:'Animate Contour spacing',exact:true}).click();
  await page.getByRole('combobox',{name:'Motion source',exact:true}).selectOption('sine');
  await page.getByRole('button',{name:'Finish',exact:true}).click();
  await page.getByRole('slider',{name:'Opacity',exact:true}).fill('.65');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  let saved;
  for(let i=0;i<40;i++){saved=await fs.readFile(projectFile,'utf8').then(JSON.parse).catch(()=>null);if(saved?.layers.some(l=>l.kind==='graphic'&&l.params.contourSpacing===8))break;await page.waitForTimeout(100);}
  const layer=saved.layers.find(l=>l.kind==='graphic');assert.equal(layer.params.style,2);assert.equal(layer.params.variant,2);assert.equal(layer.params.contourSpacing,8);assert.equal(layer.opacity,.65);assert.equal(layer.modulations.contourSpacing.kind,'sine');
  await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.waitForTimeout(400);assert.equal(await page.getByRole('alert').count(),0);
  await page.locator('.layer-row').filter({hasText:'Nested Tiles'}).click();
  await page.getByRole('button',{name:'Shape',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'Graphic family',exact:true}).inputValue(),'2');
  assert.equal(await page.getByRole('spinbutton',{name:'Contour spacing value',exact:true}).inputValue(),'8');
  await page.getByRole('button',{name:'Presets',exact:true}).click();
  const cards=await page.locator('.preset-card').count();assert.equal(cards,6,'selected graphics family preset filter');
  await page.screenshot({path:path.join(out,'integrated-graphics.png')});
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({status:'passed',counts,persistence:true,modulation:true,opacity:true,presetFilter:true,errors},null,2));console.log('Graphics UI verified',counts);
}finally{await app.close();}
