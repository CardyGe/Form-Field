/** Palette colours for people: the five bright entries, darkest first, as linear RGB. */
import * as THREE from 'three';

export function paletteRamp(palette: string[]): [number, number, number][] {
  const colour = new THREE.Color();
  // The sixth entry of every app palette is its ground colour; people are drawn with the other five.
  return palette.slice(0, 5).map(hex => { colour.set(hex); return [colour.r, colour.g, colour.b] as [number, number, number]; })
    .sort((a, b) => luminance(a) - luminance(b));
}
const luminance = ([r, g, b]: [number, number, number]) => .2126 * r + .7152 * g + .0722 * b;
