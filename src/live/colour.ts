/** Palette colours for people: the five bright entries, darkest first, as linear RGB. */
import * as THREE from 'three';

export function paletteRamp(palette: string[]): [number, number, number][] {
  const colour = new THREE.Color();
  // The sixth entry of every app palette is its ground colour; people are drawn with the other five.
  const colours = palette.slice(0, 5).map(hex => { colour.set(hex); return [colour.r, colour.g, colour.b] as [number, number, number]; })
    .sort((a, b) => luminance(a) - luminance(b));
  // Some palettes (Pour) keep a near-black among their first five. People drawn with it would vanish, so it is
  // left out and the brightest colours fill the gap, unless that would leave fewer than two colours.
  const bright = colours.filter(c => luminance(c) > NEAR_BLACK);
  if (bright.length < 2) return colours;
  while (bright.length < 5) bright.push(bright[bright.length - 1]);
  return bright;
}
/** Linear luminance below which a palette colour counts as near-black. */
const NEAR_BLACK = .01;
const luminance = ([r, g, b]: [number, number, number]) => .2126 * r + .7152 * g + .0722 * b;

/** The ramp as CSS colours, darkest first, for swatches. */
export function rampHex(palette: string[]): string[] {
  const colour = new THREE.Color();
  return paletteRamp(palette).map(([r, g, b]) => `#${colour.setRGB(r, g, b, THREE.LinearSRGBColorSpace).getHexString(THREE.SRGBColorSpace)}`);
}
