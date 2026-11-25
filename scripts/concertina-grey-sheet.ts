// Writes a grey side-profile sheet of the Copper Concertina poses, for approving shape before colour.
// Usage: npx tsx scripts/concertina-grey-sheet.ts <output.svg>
import { writeFileSync } from 'node:fs';
import { concertinaProfile } from '../src/rendering/concertina-pose';

const out = process.argv[2];
if (!out) throw new Error('Pass an output .svg path');

const beats = [1.5, 3.5, 5, 6.5];
const labels = ['beat 1.5 · lifting', 'beat 3.5 · crease travelling', 'beat 5 · full depth', 'beat 6.5 · pleats releasing'];
const cell = { w: 520, h: 500 };
const scale = 380;
const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell.w * 2}" height="${cell.h * 2 + 40}" viewBox="0 0 ${cell.w * 2} ${cell.h * 2 + 40}">`);
parts.push(`<rect width="100%" height="100%" fill="#1a1a1a"/>`);
parts.push(`<text x="20" y="28" fill="#bbb" font-family="Helvetica" font-size="18">Copper Concertina · grey profile (x along wall, z toward audience)</text>`);
beats.forEach((beat, i) => {
  const ox = (i % 2) * cell.w;
  const oy = Math.floor(i / 2) * cell.h + 40;
  const { points } = concertinaProfile(beat);
  const baseX = ox + 70;
  const baseY = oy + cell.h - 50;
  const pts = points.map(p => `${(baseX + p.x * scale).toFixed(1)},${(baseY - p.z * scale).toFixed(1)}`).join(' ');
  parts.push(`<line x1="${baseX}" y1="${baseY}" x2="${baseX + scale}" y2="${baseY}" stroke="#333" stroke-dasharray="4 4"/>`);
  parts.push(`<polyline points="${pts}" fill="none" stroke="#c8c8c8" stroke-width="14" stroke-linejoin="round" stroke-linecap="round"/>`);
  parts.push(`<polyline points="${pts}" fill="none" stroke="#2a2a2a" stroke-width="2" stroke-linejoin="round"/>`);
  parts.push(`<text x="${ox + 20}" y="${oy + 24}" fill="#999" font-family="Helvetica" font-size="15">${labels[i]}</text>`);
});
parts.push('</svg>');
writeFileSync(out, parts.join('\n'));
console.log(`wrote ${out}`);
