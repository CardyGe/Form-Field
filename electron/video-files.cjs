/**
 * Map stage 6: video files for the projector and the operator screen. The page asks for
 * formfield-video://file/<encoded path>; the main process answers only paths on its own list.
 * The list holds files Greg picked (Video… or Find…) and the video paths in a show he opened with Open. Those grants
 * are kept in the main process's own record, so the autosave (which the page writes) can only restore paths already
 * granted, never add new ones. Only video files can be on the list. Byte ranges are served, so videos can loop and
 * seek; files are streamed, never read whole into memory.
 */
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');

const TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
const CHUNK = 4 * 1024 * 1024;
const MAX_RECORD = 2000;
const typeOf = p => TYPES[path.extname(p).toLowerCase()] ?? null;

/** The path a page url names, or null when it is not one of ours. */
function videoPathFromUrl(url) {
  const prefix = 'formfield-video://file/';
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
  try { return decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0]); } catch { return null; }
}

function createVideoFiles({ fs, recordFile = null }) {
  const allowed = new Set(), granted = new Set();
  let saved = Promise.resolve();
  const ready = (async () => {
    if (!recordFile) return;
    try { const list = JSON.parse(await fs.readFile(recordFile, 'utf8')); if (Array.isArray(list)) for (const p of list.slice(-MAX_RECORD)) if (typeof p === 'string' && typeOf(p)) granted.add(path.normalize(p)); }
    catch { /* no record yet */ }
  })();
  const remember = p => {
    if (!recordFile || granted.has(p)) return;
    granted.add(p);
    const list = [...granted].slice(-MAX_RECORD);
    saved = saved.then(() => fs.writeFile(recordFile, JSON.stringify(list))).catch(() => {});
  };
  /** Puts a video file on the list. record: Greg chose it here (a dialog, or a show he opened), so it is kept. */
  const allow = (p, { record = false } = {}) => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !typeOf(p)) return false;
    const n = path.normalize(p);
    allowed.add(n);
    if (record) remember(n);
    return true;
  };
  /**
   * Grants the video paths a show names (its videos list only). trusted: a show Greg opened with Open, whose paths
   * are granted and kept; otherwise (the autosave) only paths granted before. Returns how many were granted.
   */
  const allowFromShow = (text, { trusted = true } = {}) => {
    let show = text;
    if (typeof text === 'string') { try { show = JSON.parse(text); } catch { return 0; } }
    const videos = show && Array.isArray(show.videos) ? show.videos : [];
    return videos.filter(v => v && typeof v.path === 'string' && (trusted || granted.has(path.normalize(v.path))) && allow(v.path, { record: trusted })).length;
  };
  const handle = async request => {
    const raw = videoPathFromUrl(request.url);
    // Always the normalised path: what is checked is exactly what is opened.
    const p = raw && path.isAbsolute(raw) ? path.normalize(raw) : null;
    if (!p || !allowed.has(p) || !typeOf(p)) return new Response('Not allowed', { status: 403 });
    let stat;
    try { stat = await fs.stat(p); } catch { return new Response('Not found', { status: 404 }); }
    if (!stat.isFile()) return new Response('Not found', { status: 404 });
    const size = stat.size, type = typeOf(p);
    const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { ...headers, 'content-length': String(size) } });
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    let start = 0, end = size - 1, status = 200;
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      // An open-ended range is answered a few megabytes at a time; the player asks again for the rest.
      end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : Math.min(size - 1, start + CHUNK - 1);
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      status = 206;
      headers['content-range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['content-length'] = String(size === 0 ? 0 : end - start + 1);
    if (size === 0) return new Response(null, { status, headers });
    return new Response(Readable.toWeb(createReadStream(p, { start, end })), { status, headers });
  };
  return { allow, allowFromShow, handle, has: p => allowed.has(path.normalize(p)), ready, get saved() { return saved; } };
}

module.exports = { createVideoFiles, videoPathFromUrl, VIDEO_TYPES: TYPES };
