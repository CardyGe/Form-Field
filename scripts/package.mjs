// Builds the app and packages it into work/release/mac-arm64, stamping the
// bundle with the build number (CFBundleVersion).
import { execFileSync } from 'node:child_process';
import { buildInfo } from './build-info.mjs';

const info = buildInfo();
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
console.log(`Packaging Form & Field ${info.version} build ${info.build} (${info.commit}${info.modified ? ', with uncommitted changes' : ''})`);
run('npm', ['run', 'build']);
run('npx', ['electron-builder', '--dir', '--mac', '--arm64', `-c.buildVersion=${info.build}`]);
