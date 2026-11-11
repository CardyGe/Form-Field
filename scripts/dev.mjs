import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteCLI = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const electron = require('electron');
const address = 'http://127.0.0.1:5173';
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const children = new Set();
let stopping = false;

function launch(command, args, env = environment) {
  const child = spawn(command, args, { cwd: directory, env, stdio: 'inherit', shell: false });
  children.add(child);
  child.on('error', error => { console.error(error.message); shutdown(1); });
  child.on('exit', code => { children.delete(child); if (!stopping) shutdown(code || 0); });
  return child;
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  const deadline = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 2500);
  deadline.unref();
  Promise.all([...children].map(child => new Promise(resolve => child.once('exit', resolve)))).then(() => process.exit(code));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
launch(process.execPath, [viteCLI, '--host', '127.0.0.1', '--port', '5173', '--strictPort']);

try {
  const start = Date.now();
  while (!stopping) {
    try {
      const response = await fetch(address, { signal: AbortSignal.timeout(500) });
      if (response.ok) break;
    } catch {}
    if (Date.now() - start > 25000) throw new Error('Vite did not become ready on the local studio port.');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!stopping) launch(electron, ['.'], { ...environment, STUDIO_DEV_URL: address });
} catch (error) { console.error(error.message); shutdown(1); }
