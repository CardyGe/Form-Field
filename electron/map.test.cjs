'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadShowFile, saveShowFile } = require('./map.cjs');

async function inTempDir(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-show-'));
  try { await body(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('a missing show file loads as null', async () => {
  await inTempDir(async dir => {
    assert.equal(await loadShowFile(path.join(dir, 'show.json')), null);
  });
});

test('a valid show file loads as its parsed object', async () => {
  await inTempDir(async dir => {
    const file = path.join(dir, 'show.json');
    await fs.writeFile(file, '{"version":1,"surfaces":[]}');
    assert.deepEqual(await loadShowFile(file), { version: 1, surfaces: [] });
  });
});

test('a file that does not parse is copied byte for byte to .damaged and loads as null', async () => {
  await inTempDir(async dir => {
    const file = path.join(dir, 'show.json');
    const bytes = Buffer.from([0x7b, 0x22, 0x61, 0xff, 0xfe, 0x00]);
    await fs.writeFile(file, bytes);
    assert.equal(await loadShowFile(file), null);
    assert.deepEqual(await fs.readFile(`${file}.damaged`), bytes);
  });
});

test('valid JSON that is not a plain object is treated as damaged', async () => {
  for (const text of ['[]', '"x"', 'null', '3']) {
    await inTempDir(async dir => {
      const file = path.join(dir, 'show.json');
      await fs.writeFile(file, text);
      assert.equal(await loadShowFile(file), null, text);
      assert.equal(await fs.readFile(`${file}.damaged`, 'utf8'), text);
    });
  }
});

test('saving twice keeps the first version as .previous', async () => {
  await inTempDir(async dir => {
    const file = path.join(dir, 'show.json');
    await saveShowFile(file, '{"n":1}');
    await saveShowFile(file, '{"n":2}');
    assert.equal(await fs.readFile(file, 'utf8'), '{"n":2}');
    assert.equal(await fs.readFile(`${file}.previous`, 'utf8'), '{"n":1}');
  });
});

test('a failed rename leaves the original untouched and removes the temporary file', async () => {
  await inTempDir(async dir => {
    const file = path.join(dir, 'show.json');
    await saveShowFile(file, '{"n":1}');
    const real = fs.rename;
    fs.rename = async (from, to) => {
      if (to === file) throw new Error('disk full');
      return real(from, to);
    };
    try {
      await assert.rejects(saveShowFile(file, '{"n":2}'), /disk full/);
    } finally { fs.rename = real; }
    assert.equal(await fs.readFile(file, 'utf8'), '{"n":1}');
    const left = (await fs.readdir(dir)).filter(name => name.endsWith('.tmp'));
    assert.deepEqual(left, []);
  });
});
