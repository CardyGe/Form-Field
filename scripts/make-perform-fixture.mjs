// Writes a synthetic 128 BPM WAV for the rehearsal check: a kick on every beat and a quiet hi-hat between, 32 beats
// that loop cleanly. It is made-up audio, so a pass on it says nothing about how well real DJ mixes are followed.
// Run: node scripts/make-perform-fixture.mjs   (writes work/perform/rehearsal-128.wav, which git ignores)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_BPM = 128;
/** Carried in a chunk players ignore, so the check can tell if the file's bytes were ever saved anywhere. */
export const FIXTURE_MARKER = 'FORM-AND-FIELD-REHEARSAL-FIXTURE';
const RATE = 44100, BEATS = 32;

/** The WAV file's bytes. The noise is seeded, so every run makes the same file. */
export function fixtureWav() {
  const perBeat = RATE * 60 / FIXTURE_BPM, length = Math.round(BEATS * perBeat), samples = new Float32Array(length);
  let seed = 12345;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
  for (let b = 0; b < BEATS; b++) {
    const start = Math.round(b * perBeat), end = Math.round((b + 1) * perBeat), hat = Math.round((b + 0.5) * perBeat);
    for (let i = start; i < end; i++) {
      const t = (i - start) / RATE;
      samples[i] += 0.9 * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9);
      if (i >= hat && i < hat + 0.05 * RATE) samples[i] += noise() * 0.2 * Math.exp(-(i - hat) / RATE * 60);
    }
  }
  const marker = Buffer.from(FIXTURE_MARKER, 'latin1'), pcm = Buffer.alloc(length * 2);
  samples.forEach((v, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const head = Buffer.alloc(36);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + 24 + 8 + marker.length + 8 + pcm.length, 4); head.write('WAVE', 8, 'latin1');
  head.write('fmt ', 12, 'latin1'); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  const note = Buffer.alloc(8); note.write('ffnm', 0, 'latin1'); note.writeUInt32LE(marker.length, 4);
  const data = Buffer.alloc(8); data.write('data', 0, 'latin1'); data.writeUInt32LE(pcm.length, 4);
  return Buffer.concat([head, note, marker, data, pcm]);
}

export async function writeFixture(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const bytes = fixtureWav();
  await fs.writeFile(file, bytes);
  return bytes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../work/perform/rehearsal-128.wav');
  await writeFixture(file);
  console.log(`wrote ${file}`);
}
