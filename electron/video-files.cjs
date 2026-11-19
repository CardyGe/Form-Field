/**
 * Map stage 6: video files for the projector and the operator screen. The page asks for
 * formfield-video://file/<encoded path>; the main process answers only paths on its own list: files Greg picked
 * (Video… or Find…) and the video paths in a show opened through Open or restored from the app's autosave.
 * Only video files can be on the list. Byte ranges are served, so videos can loop and seek.
 */
const path = require('node:path');

const TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
const CHUNK = 4 * 1024 * 1024;
const typeOf = p => TYPES[path.extname(p).toLowerCase()] ?? null;

/** The path a page url names, or null when it is not one of ours. */
function videoPathFromUrl(url) {
  const prefix = 'formfield-video://file/';
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
  try { return decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0]); } catch { return null; }
}

function createVideoFiles({ fs }) {
  const allowed = new Set();
  const allow = p => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !typeOf(p)) return false;
    allowed.add(path.normalize(p));
    return true;
  };
  /** Grants the video paths a show file names (its videos list only). Returns how many. */
  const allowFromShow = text => {
    let show = text;
    if (typeof text === 'string') { try { show = JSON.parse(text); } catch { return 0; } }
    const videos = show && Array.isArray(show.videos) ? show.videos : [];
    return videos.filter(v => v && typeof v.path === 'string' && allow(v.path)).length;
  };
  const handle = async request => {
    const p = videoPathFromUrl(request.url);
    if (!p || !allowed.has(path.normalize(p))) return new Response('Not allowed', { status: 403 });
    let stat;
    try { stat = await fs.stat(p); } catch { return new Response('Not found', { status: 404 }); }
    if (!stat.isFile()) return new Response('Not found', { status: 404 });
    const size = stat.size, type = typeOf(p);
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    let start = 0, end = size - 1, status = 200;
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      // An open-ended range is answered a few megabytes at a time; the player asks again for the rest.
      end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : Math.min(size - 1, start + CHUNK - 1);
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      status = 206;
    }
    const handleFile = await fs.open(p, 'r');
    try {
      const buffer = Buffer.alloc(end - start + 1);
      await handleFile.read(buffer, 0, buffer.length, start);
      const headers = { 'content-type': type, 'content-length': String(buffer.length), 'accept-ranges': 'bytes' };
      if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${size}`;
      return new Response(buffer, { status, headers });
    } finally { await handleFile.close(); }
  };
  return { allow, allowFromShow, handle, has: p => allowed.has(path.normalize(p)) };
}

module.exports = { createVideoFiles, videoPathFromUrl, VIDEO_TYPES: TYPES };
