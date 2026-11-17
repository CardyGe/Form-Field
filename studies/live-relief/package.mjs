// Build the isolated macOS rehearsal app from the project root.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Arch, build, Platform } from 'electron-builder';
import { buildInfo } from '../../scripts/build-info.mjs';

const require = createRequire(import.meta.url);
const config = require('../../package.json').build;
const entry = 'studies/live-relief/preview.cjs';
const buildNumber = buildInfo().build;
const output = path.join('work/live-relief-release', 'build-' + buildNumber);
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
await build({
  targets: Platform.MAC.createTarget(['dir'], Arch.arm64),
  config: {
    ...config,
    appId: 'local.formandfield.reliefpreview',
    productName: 'Form & Field Relief',
    buildVersion: String(buildNumber),
    directories: { output },
    electronDist: path.join(path.dirname(require.resolve('electron/package.json')), 'dist'),
    files: [...config.files, entry],
    extraMetadata: { main: entry },
  },
});
// Seal the renamed bundle for local launches and its macOS camera permission.
const bundle = path.join(output, 'mac-arm64/Form & Field Relief.app');
execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
