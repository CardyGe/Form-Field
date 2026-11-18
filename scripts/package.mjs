// Builds the app and packages it into work/release/mac-arm64, stamping the
// bundle with the build number (CFBundleVersion).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkPackageModules } from './check-package-modules.mjs';
import { buildInfo } from './build-info.mjs';

const info = buildInfo();
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
console.log(`Packaging Form & Field ${info.version} build ${info.build} (${info.commit}${info.modified ? ', with uncommitted changes' : ''})`);
run('npm', ['run', 'build']);
const localElectron = path.resolve('node_modules/electron/dist');
const distribution = fs.existsSync(path.join(localElectron, 'Electron.app')) ? [`-c.electronDist=${localElectron}`] : [];
run('npx', ['electron-builder', '--dir', '--mac', '--arm64', ...distribution, `-c.buildVersion=${info.build}`]);
checkPackageModules(path.resolve('work/release/mac-arm64/Form & Field.app/Contents/Resources/app.asar'), process.cwd());
