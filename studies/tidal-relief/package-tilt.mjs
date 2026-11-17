// From the project root on macOS: node studies/tidal-relief/package-tilt.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build, Platform, Arch} from 'electron-builder';
import './build-tilt.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve('work/tilt-club');
const projectDir = path.join(root, 'desktop');
const electron = require('electron/package.json');
await fs.mkdir(projectDir, {recursive:true});
await fs.copyFile(path.join(root, 'Tilt Club.html'), path.join(projectDir, 'Tilt Club.html'));
await fs.copyFile('studies/tidal-relief/desktop.cjs', path.join(projectDir, 'desktop.cjs'));
await fs.writeFile(path.join(projectDir,'package.json'), JSON.stringify({
  name:'tilt-club', productName:'Tilt Club', version:'0.1.0', main:'desktop.cjs',
  description:'An interactive kinetic pinball wall', private:true,
}));
await build({
  projectDir, targets:Platform.MAC.createTarget(['dir'],Arch.arm64),
  config:{
    appId:'local.formandfield.tiltclub', productName:'Tilt Club',
    directories:{output:path.join(root,'release')},
    electronVersion:electron.version,
    electronDist:path.join(path.dirname(require.resolve('electron/package.json')),'dist'),
    files:['desktop.cjs','Tilt Club.html','package.json'],
    mac:{category:'public.app-category.entertainment',identity:null},
  },
});
