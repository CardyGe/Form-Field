'use strict';

/** Show file I/O for the Map. The page validates the fields; the main process only checks the file is a JSON object. */
const fs = require('node:fs/promises');
const path = require('node:path');

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

/** The parsed show, or null when the file is missing. A file that is not a JSON object is copied to `${file}.damaged`. */
async function loadShowFile(file) {
  let bytes;
  try { bytes = await fs.readFile(file); }
  catch (error) { if (error && error.code === 'ENOENT') return null; throw error; }
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* falls through to the damaged copy */ }
  await fs.writeFile(`${file}.damaged`, bytes);
  return null;
}

/** Atomic save: the previous file is kept as `${file}.previous`; a failure leaves the original in place. */
async function saveShowFile(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporary, text);
    if (await exists(file)) await fs.copyFile(file, `${file}.previous`);
    await fs.rename(temporary, file);
  } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}

module.exports = { loadShowFile, saveShowFile };
