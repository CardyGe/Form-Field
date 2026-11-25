/**
 * Characters: the glyphs of a character set, drawn once with the system's
 * monospace font and stored as distances to each glyph's edge, so the shader
 * can draw sharp type at any size from one small picture.
 *
 * `distanceField` is pure, so it runs in node tests. Only `buildGlyphAtlas`
 * needs a Canvas 2D context, which the renderer process provides.
 */

/** Pixels per glyph in the stored picture. */
export const GLYPH_PX = 64;
/** How far, in stored pixels, distances reach either side of an edge before they clamp. */
export const GLYPH_SPREAD = 8;
export const GLYPH_FONT = 'ui-monospace, Menlo, Consolas, monospace';

/** Squared distances along one line to the nearest zero, in place (Felzenszwalb and Huttenlocher). */
function line(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (f[v[k]] === Infinity) { v[k] = q; continue; }
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  if (f[v[0]] === Infinity) { d.fill(Infinity, 0, n); return; }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Euclidean distance from every pixel to the nearest pixel where `target` holds, in two passes. */
function distances(target: (i: number) => boolean, width: number, height: number): Float64Array {
  const grid = new Float64Array(width * height), size = Math.max(width, height);
  const f = new Float64Array(size), d = new Float64Array(size), v = new Int32Array(size), z = new Float64Array(size + 1);
  for (let i = 0; i < grid.length; i++) grid[i] = target(i) ? 0 : Infinity;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    line(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x];
    line(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = Math.sqrt(d[x]);
  }
  return grid;
}

/**
 * Signed distance to the glyph's edge, mapped so the edge is .5, inside is
 * above it and outside below, reaching 1 and 0 at `spread` pixels.
 * A pixel is inside when its alpha is at least half.
 */
export function distanceField(alpha: Uint8Array, width: number, height: number, spread: number): Float32Array {
  const inside = (i: number) => alpha[i] >= 128;
  const toInside = distances(inside, width, height), toOutside = distances(i => !inside(i), width, height);
  const field = new Float32Array(width * height);
  for (let i = 0; i < field.length; i++) {
    // Pixel centres sit half a pixel from the edge between them.
    const signed = inside(i) ? toOutside[i] - .5 : .5 - toInside[i];
    field[i] = Math.min(1, Math.max(0, .5 + signed / (2 * spread)));
  }
  return field;
}

/** One row of glyphs, left to right, each `cellPx` square. */
export function glyphAtlasLayout(count: number, cellPx: number): { width: number; height: number; columns: number } {
  const columns = Math.max(1, count);
  return { width: columns * cellPx, height: cellPx, columns };
}

/**
 * Draws each glyph centred in its own square with the system monospace font,
 * then stores its edge distances. Row 0 of `field` is the top of the glyphs.
 */
export function buildGlyphAtlas(glyphs: string, cellPx: number): { width: number; height: number; field: Float32Array; columns: number } {
  const list = Array.from(glyphs), layout = glyphAtlasLayout(list.length, cellPx);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(cellPx, cellPx) : Object.assign(document.createElement('canvas'), { width: cellPx, height: cellPx });
  const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('Characters need a 2D canvas.');
  const field = new Float32Array(layout.width * layout.height), alpha = new Uint8Array(cellPx * cellPx);
  const spread = GLYPH_SPREAD * cellPx / GLYPH_PX;
  context.font = `${cellPx}px ${GLYPH_FONT}`;
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#ffffff';
  list.forEach((glyph, index) => {
    context.clearRect(0, 0, cellPx, cellPx);
    context.fillText(glyph, cellPx / 2, cellPx / 2);
    const data = context.getImageData(0, 0, cellPx, cellPx).data;
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    const glyphField = distanceField(alpha, cellPx, cellPx, spread);
    const left = (index % layout.columns) * cellPx, top = Math.floor(index / layout.columns) * cellPx;
    for (let y = 0; y < cellPx; y++) field.set(glyphField.subarray(y * cellPx, (y + 1) * cellPx), (top + y) * layout.width + left);
  });
  return { ...layout, field };
}
