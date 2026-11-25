import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONCERTINA_BEATS, concertinaEnvelope, concertinaProfile } from '../src/rendering/concertina-pose';

const MAX = 0.9;

test('the sheet is flat at the start and end of the loop', () => {
  for (const beat of [0, 1, 1.5]) {
    const { points } = concertinaProfile(beat);
    for (const p of points) assert.ok(Math.abs(p.z) < 1e-9, `beat ${beat}: z=${p.z}`);
  }
  const start = concertinaProfile(0).points;
  const end = concertinaProfile(CONCERTINA_BEATS).points;
  for (let i = 0; i < start.length; i++) {
    assert.ok(Math.abs(start[i].x - end[i].x) < 1e-9);
    assert.ok(Math.abs(start[i].z - end[i].z) < 1e-9);
  }
});

test('each facet keeps its length, so hinges never stretch or open cracks', () => {
  const width = 1;
  const facets = 7;
  for (let beat = 0; beat < CONCERTINA_BEATS; beat += 0.25) {
    const { points } = concertinaProfile(beat, { facets, width });
    for (let k = 0; k < facets; k++) {
      const len = Math.hypot(points[k + 1].x - points[k].x, points[k + 1].z - points[k].z);
      assert.ok(Math.abs(len - width / facets) < 1e-9, `beat ${beat} facet ${k}: ${len}`);
    }
  }
});

test('neighbouring facets fold in opposite directions at full depth', () => {
  const { tilts } = concertinaProfile(5.25, { facets: 7, maxTilt: MAX });
  for (let k = 0; k < tilts.length - 1; k++) {
    assert.ok(Math.sign(tilts[k]) !== Math.sign(tilts[k + 1]), `facets ${k} and ${k + 1} do not alternate`);
  }
  for (const t of tilts) assert.ok(Math.abs(t) <= MAX + 1e-9);
});

test('the crease travels from left to right while rising', () => {
  // Facet 0 (left) must be moving before the right-hand facet starts.
  const leftEarly = concertinaEnvelope(2.5, 0);
  const rightEarly = concertinaEnvelope(2.5, 1);
  assert.ok(leftEarly > rightEarly, `left ${leftEarly} should lead right ${rightEarly} at beat 2.5`);
});

test('the far right releases before the left, pleats pulling straight in sequence', () => {
  const rightLate = concertinaEnvelope(6, 1);
  const leftLate = concertinaEnvelope(6, 0);
  assert.ok(rightLate < leftLate, `right ${rightLate} should release before left ${leftLate} at beat 6`);
});

test('the envelope stays in [0, 1] and loops across the bar line', () => {
  for (let x = 0; x <= 1; x += 0.1) {
    for (let beat = 0; beat < CONCERTINA_BEATS; beat += 0.1) {
      const e = concertinaEnvelope(beat, x);
      assert.ok(e >= 0 && e <= 1, `beat ${beat} x ${x}: ${e}`);
    }
    assert.ok(Math.abs(concertinaEnvelope(0, x) - concertinaEnvelope(CONCERTINA_BEATS, x)) < 1e-9);
  }
});
