import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const asar=createRequire(import.meta.url)('@electron/asar');
const root=process.cwd(),bundle=path.resolve(process.argv[2]||'work/release/mac-arm64/Form & Field.app');
const archive=path.join(bundle,'Contents/Resources/app.asar'),entries=asar.listPackage(archive).map(f=>f.replace(/^\//,''));
const files=entries.filter(f=>(f.startsWith('dist/')&&!f.endsWith('.map')||['electron/main.cjs','electron/preload.cjs','electron/export-manager.cjs'].includes(f))&&path.extname(f));
const mismatches=[];
for(const f of files)if(!(await fs.readFile(path.join(root,f))).equals(asar.extractFile(archive,f)))mismatches.push(f);
const pkg=JSON.parse(asar.extractFile(archive,'package.json')),local=JSON.parse(await fs.readFile('package.json','utf8')),lock=JSON.parse(await fs.readFile('package-lock.json','utf8'));
assert.equal(pkg.version,local.version);assert.equal(lock.version,local.version);assert.equal(lock.packages[''].version,local.version);
const bundleVersion=execFileSync('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw',path.join(bundle,'Contents/Info.plist')],{encoding:'utf8'}).trim();assert.equal(bundleVersion,local.version);
const map=JSON.parse(asar.extractFile(archive,entries.find(f=>/^dist\/assets\/index-.*\.js\.map$/.test(f))));
const sourceMismatches=[],sourceFiles=[];
for(let i=0;i<map.sources.length;i++){
 const p=path.resolve(root,'dist/assets',map.sources[i]);
 if(p.startsWith(path.join(root,'src/'))&&/\.tsx?$/.test(p)){sourceFiles.push(path.relative(root,p));if((await fs.readFile(p,'utf8'))!==map.sourcesContent[i])sourceMismatches.push(p);}
}
for(const file of ['StudioRenderer','InstrumentRenderer','instrument-shaders','projection-optics','surface','sculpture','fractal','oil','super8','GraphicRenderer','CurrentRenderer','flow-field','InkSimulation','ReliefRenderer','surface-fields'])assert.ok(sourceFiles.includes(`src/rendering/${file}.ts`),file+' missing from package source map');
assert.equal(files.filter(f=>f.includes('signature-')).length,20);
const kinds=['livingink','currents','relief','resonance'];
for(const kind of kinds){const assets=files.filter(f=>f.startsWith('dist/assets/'+kind+'-')&&f.endsWith('.png'));assert.equal(assets.length,1,kind+' preview missing');assert.ok((await fs.readFile('src/ui/assets/instruments/'+kind+'.png')).equals(asar.extractFile(archive,assets[0])),kind+' preview differs from source');}
assert.ok((await fs.readFile('README.md')).equals(await fs.readFile(path.join(bundle,'Contents/Resources/Form & Field Guide.md'))),'Packaged guide differs');
for(const doc of ['docs/professional-effect-audit-0.10.md','docs/research/professional-effects-2026-11-09.md','docs/projection-media-direction-2026-11-10.md','docs/projection-media-0.11.md'])assert.ok((await fs.readFile(doc)).equals(await fs.readFile(path.join(bundle,'Contents/Resources',doc))),doc+' differs');
for(const id of ['silk-river','copper-confluence','gathering-light','ink-estuary','tidal-pigment','coral-development','breathing-facade','folding-copper','quiet-monument']){const file=files.find(f=>f.startsWith('dist/assets/'+id+'-')&&f.endsWith('.png'));assert.ok(file,id+' thumbnail missing');assert.ok((await fs.readFile('src/ui/assets/projection/'+id+'.png')).equals(asar.extractFile(archive,file)),id+' thumbnail differs');}
for(const name of ['ffmpeg','ffprobe'])assert.ok((await fs.readFile('build/media/'+name)).equals(await fs.readFile(path.join(bundle,'Contents/Resources/media',name))),name+' differs');
const report={status:'passed',bundle,version:pkg.version,runtimeFiles:files.length,runtimeMismatches:mismatches,sourceFiles,sourceMismatches,signatureAssets:20,instrumentAssets:10,mediaToolsAligned:true,guideAligned:true,archiveSHA256:crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex')};
assert.deepEqual(mismatches,[]);assert.deepEqual(sourceMismatches,[]);
await fs.mkdir('work/instruments',{recursive:true});await fs.writeFile('work/instruments/alignment.json',JSON.stringify(report,null,2));console.log(report);
