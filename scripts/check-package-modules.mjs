// Check the actual archive, so new runtime modules cannot silently disappear from releases.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage, extractFile } from '@electron/asar';

export function checkPackageModules(archive, root) {
  const entries = new Set(listPackage(archive).map(name => name.replace(/^[/\\]/, '').replaceAll('\\', '/')));
  const runtime = fs.readdirSync(path.join(root, 'electron')).filter(name => name.endsWith('.cjs') && !name.endsWith('.test.cjs'));
  for (const name of runtime) assert.ok(entries.has(`electron/${name}`), `Missing packaged runtime module: electron/${name}`);
  for (const entry of entries) {
    assert.ok(!entry.startsWith('electron/') || !entry.endsWith('.test.cjs'), `Test included in release: ${entry}`);
    if (!entry.startsWith('electron/') || !entry.endsWith('.cjs')) continue;
    const source = extractFile(archive, entry).toString('utf8');
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(entry), match[1]));
      assert.ok([dependency, `${dependency}.cjs`, `${dependency}.js`, `${dependency}.json`, `${dependency}/index.js`].some(name => entries.has(name)), `${entry} requires missing ${dependency}`);
    }
  }
  assert.ok(entries.has('dist/index.html'), 'Missing packaged renderer');
  console.log(`Package checked: ${runtime.length} Electron runtime modules and their local dependencies are present.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  checkPackageModules(process.argv[2] || path.join(root, 'work/release/mac-arm64/Form & Field.app/Contents/Resources/app.asar'), root);
}
