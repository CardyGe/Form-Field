'use strict';

// Loop seam check.
//
// A loop is seamless when the step from the last frame back to the first looks
// like any other step. We measure that in display space on a reduced image:
//
//   jump   mean |f(N-1) - f(0)| against the largest nearby frame difference.
//          Catches a pop: something that does not return to where it started.
//   hitch  mean |f(a) - 2 f(b) + f(c)| across the seam against the largest nearby.
//          Catches motion that arrives in the right place at the wrong speed,
//          such as an ease-in/ease-out or a reversal at the loop point.
//
// A ratio above the threshold is reported only when the seam difference is
// also above an absolute floor, so still images and near-static loops (where
// every ratio is noise over noise) pass.

const fs = require('node:fs/promises');
const path = require('node:path');

const ANALYSIS_WIDTH = 960;
const JUMP_LIMIT = 1.5;
const HITCH_LIMIT = 2;
// Differences below one 8-bit code value on average are not visible.
const FLOOR = 1 / 255;
// A one-frame blip of size d has a second difference of 2d.
const HITCH_FLOOR = 2 * FLOOR;

function meanAbs(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function meanAbsSecond(a, b, c) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - 2 * b[i] + c[i]);
  return sum / a.length;
}

// Frames either side of the loop point. A wide window means the seam is
// compared against the worst ordinary moment nearby, which matters for content
// whose cadence is irregular on purpose (held film frames, shutter flicker).
const SIDE = 6;
const MIN_SIDE = 3;

// Frame indices the measurement needs: the last `side` frames, then the first `side`.
function seamFrames(frameCount) {
  const side = Math.min(SIDE, Math.floor(frameCount / 2));
  if (side < MIN_SIDE) return [];
  return [...Array.from({ length: side }, (_, k) => frameCount - side + k), ...Array.from({ length: side }, (_, k) => k)];
}

// frames: arrays in display space (0..1), in seamFrames order. The loop point
// sits between frames[side - 1] and frames[side].
function measureSeam(frames) {
  const side = frames.length / 2;
  const steps = [], seconds = [];
  for (let k = 0; k + 1 < frames.length; k++) steps.push(meanAbs(frames[k], frames[k + 1]));
  for (let k = 0; k + 2 < frames.length; k++) seconds.push(meanAbsSecond(frames[k], frames[k + 1], frames[k + 2]));
  // Step side-1 crosses the loop point; second differences side-2 and side-1 include it.
  const jumpSeam = steps[side - 1];
  const jumpTypical = Math.max(...steps.filter((_, k) => k !== side - 1));
  const hitchSeam = Math.max(seconds[side - 2], seconds[side - 1]);
  const hitchTypical = Math.max(...seconds.filter((_, k) => k !== side - 2 && k !== side - 1));
  // Below the floor the ratio is noise over noise; report it capped at 1.
  const ratio = (seam, typical, floor) => seam <= floor ? Math.min(1, seam / Math.max(typical, 1e-9)) : seam / Math.max(typical, floor / 4);
  const jump = { seam: jumpSeam, typical: jumpTypical, ratio: ratio(jumpSeam, jumpTypical, FLOOR) };
  const hitch = { seam: hitchSeam, typical: hitchTypical, ratio: ratio(hitchSeam, hitchTypical, HITCH_FLOOR) };
  jump.visible = jumpSeam > FLOOR && jump.ratio > JUMP_LIMIT;
  hitch.visible = hitchSeam > HITCH_FLOOR && hitch.ratio > HITCH_LIMIT;
  return { status: jump.visible || hitch.visible ? 'seam' : 'clean', jump, hitch };
}

function describeSeam(result) {
  if (!result) return '';
  if (result.status === 'skipped') return 'Loop seam not checked: the loop is too short to measure.';
  if (result.status === 'error') return `Loop seam not checked: ${result.message}`;
  const x = value => `${value.toFixed(1)}×`;
  if (result.status === 'clean') return `Loop seam clean (jump ${x(result.jump.ratio)}, hitch ${x(result.hitch.ratio)} of a normal frame step).`;
  const parts = [];
  if (result.jump.visible) parts.push(`the last frame jumps ${x(result.jump.ratio)} further than a normal step`);
  if (result.hitch.visible) parts.push(`motion changes speed ${x(result.hitch.ratio)} more than normal`);
  return `Visible loop seam: ${parts.join(' and ')}.`;
}

// Same compositing and transfer as delivery, so the check sees what the viewer sees.
function analysisFilter(request, toLinear) {
  const filters = ['format=gbrapf32le'];
  const background = request.transparent ? [0, 0, 0] : [1, 3, 5].map(index => toLinear(parseInt(request.background.slice(index, index + 2), 16) / 255));
  filters.push(`geq=r='r(X,Y)*alpha(X,Y)+${background[0]}*(1-alpha(X,Y))':g='g(X,Y)*alpha(X,Y)+${background[1]}*(1-alpha(X,Y))':b='b(X,Y)*alpha(X,Y)+${background[2]}*(1-alpha(X,Y))':a=1`);
  filters.push('format=gbrap16le');
  filters.push('zscale=pin=709:tin=linear:min=gbr:rin=full:p=709:t=iec61966-2-1:m=gbr:r=full');
  filters.push('format=rgb48le');
  const width = Math.min(ANALYSIS_WIDTH, request.width);
  if (width < request.width) filters.push(`scale=${width}:-2:flags=area`);
  return filters.join(',');
}

// run: (args) => Promise, an ffmpeg runner that honours cancellation.
async function checkSeam({ run, directory, request, frameName, toLinear }) {
  const indices = seamFrames(request.frameCount);
  if (!indices.length) return { status: 'skipped' };
  const filter = analysisFilter(request, toLinear);
  const frames = [];
  for (const index of indices) {
    const output = path.join(directory, `seam-${index}.raw`);
    try {
      await run(['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', path.join(directory, 'cache', frameName(index)), '-vf', filter, '-frames:v', '1', '-f', 'rawvideo', output]);
      const bytes = await fs.readFile(output);
      const values = new Float32Array(bytes.length / 2);
      for (let i = 0; i < values.length; i++) values[i] = bytes.readUInt16LE(i * 2) / 65535;
      frames.push(values);
    } finally { await fs.rm(output, { force: true }); }
  }
  return measureSeam(frames);
}

module.exports = { checkSeam, measureSeam, describeSeam, seamFrames, analysisFilter, FLOOR, JUMP_LIMIT, HITCH_LIMIT };
