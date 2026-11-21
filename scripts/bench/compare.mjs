// Compares two benchmark result folders case by case.
//   node scripts/bench/compare.mjs work/bench/<before> work/bench/<after> [--tolerance 0.05]
// Exits 1 when any shared case's median GPU frame time moved by more than the tolerance,
// so the same commit run twice must exit 0, and a change that should not affect speed can be checked.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const toleranceAt = args.indexOf('--tolerance');
const tolerance = toleranceAt < 0 ? .05 : Number(args[toleranceAt + 1]);
const folders = args.filter((a, i) => !a.startsWith('--') && (toleranceAt < 0 || i !== toleranceAt + 1));
if (folders.length !== 2 || !(tolerance > 0)) { console.error('Usage: compare.mjs <before> <after> [--tolerance 0.05]'); process.exit(2); }

const load = folder => JSON.parse(fs.readFileSync(path.join(folder, 'results.json'), 'utf8'));
const [a, b] = folders.map(load);
for (const r of [a, b]) if (r.smoke || r.softwareGL) console.warn(`Warning: ${r.label} is a ${r.smoke ? 'smoke' : 'software-GL'} run; its numbers mean nothing.`);
if (a.gpu?.renderer !== b.gpu?.renderer) console.warn(`Warning: different GPUs (${a.gpu?.renderer} / ${b.gpu?.renderer}).`);
if (a.timing !== b.timing) console.warn(`Warning: different timing methods (${a.timing} / ${b.timing}).`);

// With several runs in a folder, a case's figure is the median of its run medians.
const medianOf = values => { const s = [...values].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const byCase = r => {
  const out = new Map();
  for (const c of r.cases) { const e = out.get(c.name) ?? { medians: [], p95s: [] }; e.medians.push(c.gpu.total.median); e.p95s.push(c.gpu.total.p95); out.set(c.name, e); }
  return new Map([...out].map(([name, e]) => [name, { median: medianOf(e.medians), p95: medianOf(e.p95s) }]));
};
const before = byCase(a), after = byCase(b);
const ms = v => v.toFixed(2).padStart(8);
console.log(`${'case'.padEnd(30)} ${'median before'.padStart(13)} ${'after'.padStart(8)} ${'change'.padStart(8)} ${'p95 before'.padStart(10)} ${'after'.padStart(8)}`);
let failed = false;
for (const [name, x] of before) {
  const y = after.get(name);
  if (!y) { console.log(`${name.padEnd(30)} only in ${a.label}`); continue; }
  const change = y.median / x.median - 1, agrees = Math.abs(change) <= tolerance;
  failed ||= !agrees;
  console.log(`${name.padEnd(30)} ${ms(x.median).padStart(13)} ${ms(y.median)} ${((change >= 0 ? '+' : '') + (change * 100).toFixed(1) + '%').padStart(8)} ${ms(x.p95).padStart(10)} ${ms(y.p95)}${agrees ? '' : '  outside ' + (tolerance * 100) + '%'}`);
}
for (const name of after.keys()) if (!before.has(name)) console.log(`${name.padEnd(30)} only in ${b.label}`);
process.exit(failed ? 1 : 0);
