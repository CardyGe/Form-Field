// Repackages the app after a commit on main, in the background.
// Started by .githooks/post-commit. Set FORM_FIELD_NO_AUTOPACKAGE=1 to skip.
//
// - Waits while the packaged app is open, so a running app is never replaced.
// - Commits made during a build are batched into one follow-up build.
// - Reports the result as a macOS notification. Log: work/auto-package.log.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInfo } from './build-info.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'work');
const lock = path.join(work, 'auto-package.lock');
const pending = path.join(work, 'auto-package.pending');
const logFile = path.join(work, 'auto-package.log');
const appBinary = path.join(work, 'release', 'mac-arm64', 'Form & Field.app', 'Contents', 'MacOS', 'Form & Field');
const log = message => fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const notify = (title, message) => spawnSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

fs.mkdirSync(work, { recursive: true });

// The hook's process can be cleaned up with its terminal; run detached from it.
if (!process.argv.includes('--child')) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { cwd: root, detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  process.exit(0);
}

// One runner at a time. A later commit just asks the running one to go again.
fs.writeFileSync(pending, '');
try {
  const owner = Number(fs.readFileSync(lock, 'utf8'));
  if (owner && alive(owner)) { log(`queued behind runner ${owner}`); process.exit(0); }
} catch {}
fs.writeFileSync(lock, String(process.pid));

function appRunning() {
  const result = spawnSync('pgrep', ['-f', appBinary], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() !== '';
}

try {
  while (fs.existsSync(pending)) {
    fs.rmSync(pending, { force: true });
    if (appRunning()) {
      log('waiting for Form & Field to quit');
      notify('Form & Field update ready to build', 'Quit Form & Field and the new version will be packaged.');
      while (appRunning()) await sleep(10_000);
    }
    const info = buildInfo();
    const label = `${info.version} build ${info.build}`;
    log(`packaging ${label} (${info.commit})`);
    const started = Date.now();
    const output = fs.openSync(logFile, 'a');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'package.mjs')], { cwd: root, stdio: ['ignore', output, output], env: process.env });
    fs.closeSync(output);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (result.status === 0) {
      log(`packaged ${label} in ${seconds} s`);
      if (!fs.existsSync(pending)) notify('Form & Field updated', `Version ${label} is ready in work/release.`);
    } else {
      log(`packaging ${label} failed (exit ${result.status})`);
      notify('Form & Field build failed', `Version ${label} did not package. See work/auto-package.log.`);
    }
  }
} finally {
  fs.rmSync(lock, { force: true });
}
