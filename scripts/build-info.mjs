// Version and build identity for the app and its package.
// The build number is the commit count on the current branch, so it rises by
// one with every commit and never needs editing by hand.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
};

export function buildInfo() {
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {
    version,
    build: Number(git('rev-list', '--count', 'HEAD')) || 0,
    commit: git('rev-parse', '--short', 'HEAD') || 'unknown',
    // Uncommitted changes are included in the build but not in the commit.
    modified: git('status', '--porcelain', '--untracked-files=no') !== '',
    date: new Date().toISOString(),
  };
}
