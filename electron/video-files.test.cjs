// Map stage 6: the main process serves the video files Greg chose, and nothing else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createVideoFiles, videoPathFromUrl } = require('./video-files.cjs');

const url = p => `formfield-video://file/${encodeURIComponent(p)}`;
const setup = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-files-'));
  const clip = path.join(dir, 'loop.mp4');
  await fs.writeFile(clip, Buffer.from('0123456789abcdef'));
  const secret = path.join(dir, 'notes.txt');
  await fs.writeFile(secret, 'private');
  return { dir, clip, secret, files: createVideoFiles({ fs }) };
};

test('only video extensions can be allowed', async () => {
  const { files, clip, secret } = await setup();
  assert.equal(files.allow(clip), true);
  assert.equal(files.allow(secret), false);
  assert.equal(files.allow('/clips/loop.MOV'), true);
  assert.equal(files.allow(''), false);
});

test('a path not on the list is refused (403), even if it exists', async () => {
  const { files, clip } = await setup();
  const res = await files.handle(new Request(url(clip)));
  assert.equal(res.status, 403);
});

test('an allowed file is served with its type and supports byte ranges', async () => {
  const { files, clip } = await setup();
  files.allow(clip);
  const whole = await files.handle(new Request(url(clip)));
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'video/mp4');
  assert.equal(await whole.text(), '0123456789abcdef');
  const part = await files.handle(new Request(url(clip), { headers: { range: 'bytes=4-7' } }));
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 4-7/16');
  assert.equal(await part.text(), '4567');
  const open = await files.handle(new Request(url(clip), { headers: { range: 'bytes=10-' } }));
  assert.equal(await open.text(), 'abcdef');
});

test('a missing allowed file answers 404', async () => {
  const { files, dir } = await setup();
  const gone = path.join(dir, 'gone.mp4');
  files.allow(gone);
  assert.equal((await files.handle(new Request(url(gone)))).status, 404);
});

test('allowFromShow grants the video paths a show names, and nothing else', async () => {
  const { files, clip } = await setup();
  const show = JSON.stringify({ format: 'formshow', version: 7, videos: [{ id: 'video-1', path: clip, name: 'loop.mp4' }, { id: 'video-2', path: '/etc/passwd', name: 'x' }], sources: [{ id: 's', path: '/Users/me/other.mp4' }] });
  assert.equal(files.allowFromShow(show), 1);
  assert.equal((await files.handle(new Request(url(clip)))).status, 200);
  assert.equal((await files.handle(new Request(url('/etc/passwd')))).status, 403);
  assert.equal((await files.handle(new Request(url('/Users/me/other.mp4')))).status, 403, 'only the videos list counts');
  assert.equal(files.allowFromShow('not json'), 0);
});

test('the page’s url for a path reads back to the same path', () => {
  assert.equal(videoPathFromUrl(url('/Users/greg/My Clips/loop #1.mp4')), '/Users/greg/My Clips/loop #1.mp4');
  assert.equal(videoPathFromUrl('formfield-video://other/x'), null);
});

test('review: a HEAD request answers with headers only, never reading the file', async () => {
  const { files, clip } = await setup();
  files.allow(clip);
  const res = await files.handle(new Request(url(clip), { method: 'HEAD' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), '16');
  assert.equal((await res.text()).length, 0);
});

test('review: the autosave only grants paths Greg granted before (kept by the main process), never new ones', async () => {
  const { dir, clip } = await setup();
  const record = path.join(dir, 'granted.json');
  const first = createVideoFiles({ fs, recordFile: record });
  await first.ready;
  first.allow(clip, { record: true });
  await first.saved;
  const other = path.join(dir, 'other.mp4'); await fs.writeFile(other, 'x');
  const later = createVideoFiles({ fs, recordFile: record });
  await later.ready;
  const autosave = JSON.stringify({ videos: [{ path: clip }, { path: other }] });
  assert.equal(later.allowFromShow(autosave, { trusted: false }), 1, 'only the path granted before');
  assert.equal((await later.handle(new Request(url(other)))).status, 403);
  assert.equal(later.allowFromShow(autosave, { trusted: true }), 2, 'a show Greg opened grants its videos');
});

test('review: a path through a symlink is served only as the file it really is', async () => {
  const { dir, clip, files } = await setup();
  const sub = path.join(dir, 'sub'); await fs.mkdir(sub);
  const link = path.join(dir, 'link'); await fs.symlink(sub, link);
  files.allow(clip);
  // /dir/link/../loop.mp4 normalises to /dir/loop.mp4, but read raw it would be /dir/sub/../loop.mp4 → /dir/loop.mp4 too;
  // a request must open exactly the allowed file.
  const res = await files.handle(new Request(url(path.join(link, '..', 'loop.mp4'))));
  assert.ok(res.status === 403 || (res.status === 200 && (await res.text()) === '0123456789abcdef'));
  const sneaky = path.join(sub, 'loop.mp4'); await fs.writeFile(sneaky, 'SECRET');
  const viaLink = await files.handle(new Request(url(`${link}/../loop.mp4`)));
  if (viaLink.status === 200) assert.equal(await viaLink.text(), '0123456789abcdef', 'never the other file');
});

test('final review: the record of granted videos is written whole (a temporary file, then a rename)', async () => {
  const calls = [];
  const spy = { ...fs, readFile: fs.readFile, writeFile: (...a) => { calls.push(['write', a[0]]); return fs.writeFile(...a); }, rename: (...a) => { calls.push(['rename', a[0], a[1]]); return fs.rename(...a); } };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-record-'));
  const record = path.join(dir, 'granted.json');
  const files = createVideoFiles({ fs: spy, recordFile: record });
  await files.ready;
  files.allow(path.join(dir, 'a.mp4'), { record: true });
  await files.saved;
  assert.ok(calls.some(c => c[0] === 'write' && c[1] !== record), 'written to a temporary file first');
  assert.ok(calls.some(c => c[0] === 'rename' && c[2] === record), 'then renamed into place');
  assert.deepEqual(JSON.parse(await fs.readFile(record, 'utf8')), [path.join(dir, 'a.mp4')]);
});

test('final review: through a two-level symlink, only the allowed file is ever served', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-link-'));
  await fs.mkdir(path.join(dir, 'a', 'b'), { recursive: true });
  await fs.writeFile(path.join(dir, 'loop.mp4'), 'ALLOWED');
  await fs.writeFile(path.join(dir, 'a', 'loop.mp4'), 'SECRET');
  await fs.symlink(path.join(dir, 'a', 'b'), path.join(dir, 'deep'));
  const files = createVideoFiles({ fs });
  files.allow(path.join(dir, 'loop.mp4'));
  // Read raw, deep/../loop.mp4 is a/loop.mp4 (the kernel follows the link first); normalised it is the allowed file.
  const res = await files.handle(new Request(url(`${dir}/deep/../loop.mp4`)));
  if (res.status === 200) assert.equal(await res.text(), 'ALLOWED', 'never the file behind the link');
});
