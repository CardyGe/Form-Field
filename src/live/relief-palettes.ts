// sRGB swatches in order: shadow, two body colours, highlight, two crest colours.
type ReliefPalette = { label: string; colours: readonly [string, string, string, string, string, string] };

export const RELIEF_PALETTES = {
  material: { label: 'Material', colours: [] },
  sixties: { label: '’60s Psychedelic', colours: ['#25103f','#f25624','#e92b80','#ffe998','#ffd231','#f549bf'] },
  neon: { label: 'Neon', colours: ['#110a29','#ff1493','#1b32bb','#fff7ff','#ff39d4','#5bff2c'] },
  cyber: { label: 'Cyber', colours: ['#080d21','#213fa7','#6b367a','#c9edff','#27f3ff','#ff9b24'] },
  pastel: { label: 'Pastel', colours: ['#655483','#e59ab0','#a3baf1','#fff5ec','#b1ffe1','#ffbcda'] },
  acid: { label: 'Acid', colours: ['#11271b','#57aa0b','#057962','#eeffaf','#ccff36','#b767ff'] },
  sunset: { label: 'Sunset', colours: ['#231638','#933667','#e58546','#ffe0ab','#ffbc60','#ec86c9'] },
  ocean: { label: 'Ocean', colours: ['#0b2141','#15548f','#119d90','#d3fff0','#54ffe5','#4289ff'] },
  ultraviolet: { label: 'Ultraviolet', colours: ['#180f34','#6944e7','#a220a6','#efdaff','#83a2ff','#fa57e8'] },
  infrared: { label: 'Infrared', colours: ['#230952','#92205a','#dc3413','#fff39e','#ffea39','#ff3146'] },
  ice: { label: 'Ice', colours: ['#26344f','#7aa4ce','#85c9d3','#f1fdff','#baf3ff','#b0b6ff'] },
  gilded: { label: 'Gilded', colours: ['#2d1b16','#a96f2b','#805247','#fff0c8','#ffd774','#ffc1a0'] },
  monochrome: { label: 'Black & white', colours: ['#151515','#646464','#919191','#ffffff','#ffffff','#b6b6b6'] },
} as const satisfies Record<string, ReliefPalette | { label: string; colours: readonly [] }>;

export type ReliefPaletteName = keyof typeof RELIEF_PALETTES;

export function validateReliefPalette(value: unknown): ReliefPaletteName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RELIEF_PALETTES, value)
    ? value as ReliefPaletteName : 'material';
}
