// Map stage 6: pictures (stored in the show) and videos (left on disk) as things a shape plays.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { applyEdit, type EditAction } from '../src/map/editor';
import { createShow, validateShow, imageBytes, isVideoId, MAX_VIDEOS, type CurvePoint, type ShowDocument } from '../src/map/show';
import { targetRange } from '../src/map/targets';

const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ok = (show: ShowDocument, action: EditAction): ShowDocument => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const refused = (show: ShowDocument, action: EditAction, reason: string) => assert.deepEqual(applyEdit(show, action), { ok: false, reason });
const shapeOf = (show: ShowDocument, id: string) => show.shapes.find(s => s.id === id)!;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const picture = (dataUrl = PNG) => ({ name: 'dot.png', dataUrl, width: 1, height: 1 });
/** Three shapes, a b c. */
const base = () => ok(ok(ok(createShow(), { type: 'addShape', id: 'a', points: sq(.1, .1, .3, .3), colour: '#ff0000' }), { type: 'addShape', id: 'b', points: sq(.4, .1, .6, .3), colour: '#00ff00' }), { type: 'addShape', id: 'c', points: sq(.7, .1, .9, .3), colour: '#0000ff' });
const video = (show: ShowDocument, shapeId: string, videoId: string, path = '/clips/loop.mp4', linked?: boolean) =>
  ok(show, { type: 'setContent', shapeId, content: { kind: 'video', videoId, path, name: path.split('/').pop()!, ...(linked === undefined ? {} : { linked }) } });

test('a shape plays a picture: a one-layer image composition, cover fit; the same picture picked again is shared, stored once', () => {
  let show = ok(base(), { type: 'setContent', shapeId: 'a', content: { kind: 'image', sourceId: 'img1', image: picture() } });
  const src = show.sources.find(s => s.id === 'img1')!;
  assert.equal(src.project.layers.length, 1);
  assert.equal(src.project.layers[0].kind, 'image');
  assert.equal(src.project.layers[0].image?.fit, 'cover');
  show = ok(show, { type: 'setContent', shapeId: 'b', content: { kind: 'image', sourceId: 'img2', image: picture() } });
  assert.equal(shapeOf(show, 'b').sourceId, 'img1', 'the same picture is shared');
  assert.equal(show.sources.filter(s => s.project.layers[0]?.kind === 'image').length, 1);
  assert.ok(imageBytes(show) > 0 && imageBytes(show) < 200);
});

test('a picture over 8 MB, or one that takes the show past 32 MB, is refused and changes nothing', () => {
  // A real PNG made as large as needed with a text chunk before its end; each fill makes a different picture.
  const big = (n: number, fill: string) => {
    const png = Buffer.from(PNG.split(',')[1], 'base64'), iend = png.length - 12;
    const data = Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(Math.round(n), fill.charCodeAt(0))]);
    const type = Buffer.from('tEXt'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0);
    return `data:image/png;base64,${Buffer.concat([png.subarray(0, iend), len, type, data, crc, png.subarray(iend)]).toString('base64')}`;
  };
  refused(base(), { type: 'setContent', shapeId: 'a', content: { kind: 'image', sourceId: 'i', image: picture(big(9 * 1024 * 1024, 'AAAA')) } }, 'image-too-large');
  // Four pictures of 7.5 MB are 30 MB: a fifth takes the show past 32 MB.
  let show = ok(ok(base(), { type: 'addShape', id: 'd', points: sq(.1, .5, .3, .7), colour: '#ffffff' }), { type: 'addShape', id: 'e', points: sq(.4, .5, .6, .7), colour: '#ffffff' });
  for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) show = ok(show, { type: 'setContent', shapeId: id, content: { kind: 'image', sourceId: `i${i}`, image: picture(big(7.5 * 1024 * 1024, 'ABCD'[i])) } });
  const before = JSON.stringify(show);
  refused(show, { type: 'setContent', shapeId: 'e', content: { kind: 'image', sourceId: 'i9', image: picture(big(7.5 * 1024 * 1024, 'E')) } }, 'images-over-budget');
  assert.equal(JSON.stringify(show), before);
});

test('a shape plays a video; linked shapes share it; Make separate gives this shape its own copy with its own speed', () => {
  let show = video(base(), 'a', 'video-1');
  show = ok(show, { type: 'shareSource', shapeId: 'b', withShapeId: 'a' });
  assert.equal(shapeOf(show, 'b').sourceId, 'video-1');
  assert.deepEqual(show.videos.map(v => v.id), ['video-1']);
  assert.ok(isVideoId('video-1') && !isVideoId('source-1') && !isVideoId(null));
  show = ok(show, { type: 'makeSeparate', shapeId: 'b', sourceId: 'video-2' });
  assert.equal(shapeOf(show, 'b').sourceId, 'video-2');
  assert.deepEqual(show.videos.map(v => [v.id, v.path]), [['video-1', '/clips/loop.mp4'], ['video-2', '/clips/loop.mp4']]);
  show = ok(show, { type: 'setSourceSpeed', sourceId: 'video-2', speed: 2 });
  assert.equal(show.videos.find(v => v.id === 'video-2')!.speed, 2);
  assert.equal(show.videos.find(v => v.id === 'video-1')!.speed, 1);
});

test('a video’s speed and Loop with the tempo work through setSourceSpeed and setTempoSync', () => {
  let show = video(base(), 'a', 'video-1');
  show = ok(show, { type: 'setSourceSpeed', sourceId: 'video-1', speed: 9 });
  assert.equal(show.videos[0].speed, 4, 'kept to 0.1..4');
  show = ok(show, { type: 'setTempoSync', sourceId: 'video-1', beats: 8 });
  assert.equal(show.videos[0].tempoSync, 8);
  assert.equal(show.videos[0].speed, 4, 'speed is kept');
  refused(show, { type: 'setTempoSync', sourceId: 'video-1', beats: 3 }, 'bad-tempo');
});

test('a 17th video is refused; a file without a video extension is refused', () => {
  let show = createShow();
  for (let i = 0; i < MAX_VIDEOS + 1; i++) show = ok(show, { type: 'addShape', id: `s${i}`, points: sq(i / 20, .1, i / 20 + .04, .2), colour: '#ffffff' });
  for (let i = 0; i < MAX_VIDEOS; i++) show = video(show, `s${i}`, `video-${i}`, `/clips/${i}.mp4`);
  refused(show, { type: 'setContent', shapeId: `s${MAX_VIDEOS}`, content: { kind: 'video', videoId: 'video-x', path: '/clips/x.mp4', name: 'x.mp4' } }, 'too-many-videos');
  refused(base(), { type: 'setContent', shapeId: 'a', content: { kind: 'video', videoId: 'video-y', path: '/etc/passwd', name: 'passwd' } }, 'not-a-video');
});

test('relinkVideo moves every video on the missing path, and scenes keep their shapes on it', () => {
  let show = video(base(), 'a', 'video-1', '/old/loop.mp4');
  show = ok(show, { type: 'addScene', sceneId: 's1', name: 'One' });
  show = video(show, 'b', 'video-2', '/old/loop.mp4');
  show = ok(show, { type: 'relinkVideo', path: '/old/loop.mp4', to: '/new/loop.mov', name: 'loop.mov' });
  assert.deepEqual(show.videos.map(v => [v.path, v.name]), [['/new/loop.mov', 'loop.mov'], ['/new/loop.mov', 'loop.mov']]);
  assert.equal(show.scenes[0].shapes.a.sourceId, 'video-1');
});

test('version 7 round-trips; version 6 opens with no videos, unrepaired; a video id with no video in the file is a missing source, repaired', () => {
  let show = video(base(), 'a', 'video-1');
  show = ok(show, { type: 'setContent', shapeId: 'b', content: { kind: 'image', sourceId: 'img1', image: picture() } });
  assert.equal(show.version, 7);
  const again = validateShow(JSON.parse(JSON.stringify(show)));
  assert.equal(again.repaired, false);
  assert.deepEqual(again.show.videos, show.videos);
  assert.equal(shapeOf(again.show, 'a').sourceId, 'video-1');
  const old = JSON.parse(JSON.stringify(base())); old.version = 6; delete old.videos;
  assert.equal(validateShow(old).repaired, false);
  assert.deepEqual(validateShow(old).show.videos, []);
  const broken = JSON.parse(JSON.stringify(show)); broken.videos = [];
  const read = validateShow(broken);
  assert.equal(read.repaired, true);
  assert.equal(shapeOf(read.show, 'a').sourceId, null);
});

test('scenes keep a video a shape plays only in another scene; deleting its last player removes it', () => {
  let show = ok(video(base(), 'a', 'video-1'), { type: 'addScene', sceneId: 's1', name: 'One' });
  show = ok(show, { type: 'addScene', sceneId: 's2', name: 'Two' });
  show = ok(show, { type: 'setContent', shapeId: 'a', content: { kind: 'colour' } });
  assert.deepEqual(show.videos.map(v => v.id), ['video-1'], 'scene 1 still plays it');
  show = ok(show, { type: 'delete', shapeId: 'a' });
  assert.deepEqual(show.videos, []);
});

test('a reaction on a video’s speed has a range of 0.1 to 4 and a label naming the video', () => {
  const show = video(base(), 'a', 'video-1', '/clips/waves.mp4');
  assert.deepEqual(targetRange(show, 'source.video-1.speed'), { min: 0.1, max: 4, label: 'waves.mp4 · Speed' });
});
