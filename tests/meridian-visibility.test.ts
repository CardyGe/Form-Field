import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayList, STRIDE } from '../src/meridian/display-list';
import { advanceEvolve, createEvolveTransport, evaluateEvolve, EVOLVE_FORM_NAMES, evolveFormKind, type EvolveMoves } from '../src/meridian/evolve';
import { MERIDIAN_DEFAULTS } from '../src/meridian/parameters';
import { PRIMITIVE } from '../src/meridian/types';

const ASPECT = 16 / 9, idle: EvolveMoves = { next: false, hold: false, drop: false, collapse: false, burst: false };
const inFrame = (x: number, y: number) => Math.abs(x) <= ASPECT / 2 && Math.abs(y) <= 0.5;

/** How much of a mark's drawn line is inside the frame, in frame heights, by walking along it. */
function onScreenLength(d: Float32Array, at: number): number {
  const kind = d[at], steps = 96;
  let inside = 0, length = 0;
  if (kind === PRIMITIVE.segment) {
    length = Math.hypot(d[at + 3] - d[at + 1], d[at + 4] - d[at + 2]);
    for (let i = 0; i < steps; i++) { const t = (i + 0.5) / steps; if (inFrame(d[at + 1] + (d[at + 3] - d[at + 1]) * t, d[at + 2] + (d[at + 4] - d[at + 2]) * t)) inside++; }
  } else if (kind === PRIMITIVE.arc || kind === PRIMITIVE.ring) {
    const r = Math.abs(d[at + 3]), start = kind === PRIMITIVE.arc ? d[at + 4] : 0, sweep = kind === PRIMITIVE.arc ? d[at + 5] : Math.PI * 2;
    length = r * sweep;
    for (let i = 0; i < steps; i++) { const a = start + sweep * (i + 0.5) / steps; if (inFrame(d[at + 1] + Math.cos(a) * r, d[at + 2] + Math.sin(a) * r)) inside++; }
  }
  return length * inside / steps;
}

function visible(list: DisplayList): { marks: number; length: number } {
  let marks = 0, length = 0;
  for (let i = 0; i < list.count; i++) {
    const at = i * STRIDE;
    if (list.data[at] === PRIMITIVE.dot || list.data[at + 9] < 0.05) continue;
    const seen = onScreenLength(list.data, at);
    if (seen >= 0.008) { marks++; length += seen; }
  }
  return { marks, length };
}

test('every form keeps visible structure on screen at every Seed, Density, Scale and Tension', () => {
  const list = new DisplayList(2000), kinds = new Set<number>(), failures: string[] = [];
  let worstMarks = Infinity, worstLength = Infinity;
  for (let seed = 1; seed <= 24; seed++) for (const macroScale of [0, 0.25, 0.5, 0.65, 0.8, 0.9, 1]) for (const macroDensity of [0, 0.5, 1]) for (const macroTension of [0, 0.5, 1]) {
    const p = { ...MERIDIAN_DEFAULTS, macroScale, macroDensity, macroTension }, transport = createEvolveTransport(), view: Record<string, number> = {};
    const clock = advanceEvolve(transport, 0, 60, 0, seed, p, idle);
    Object.assign(view, p, transport.values);
    for (let evolution = 0; evolution < 900; evolution += 19) {
      clock.evolution = evolution;
      kinds.add(evolveFormKind(seed, evolution));
      evaluateEvolve(seed, clock, view, list);
      const { marks, length } = visible(list);
      worstMarks = Math.min(worstMarks, marks); worstLength = Math.min(worstLength, length);
      if ((marks < 5 || length < 0.3) && failures.length < 8) failures.push(`seed ${seed} ${EVOLVE_FORM_NAMES[evolveFormKind(seed, evolution)]} t${evolution} scale ${macroScale} density ${macroDensity} tension ${macroTension}: ${marks} marks, ${length.toFixed(3)} long`);
    }
  }
  assert.equal(kinds.size, EVOLVE_FORM_NAMES.length, 'the sweep must reach every form');
  assert.deepEqual(failures, [], `worst ${worstMarks} marks, ${worstLength.toFixed(3)} long`);
});
