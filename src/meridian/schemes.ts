export interface MeridianScheme { name: string; swatches: readonly string[] }

/** Base, accent, second accent, hero core, halo, ground. A Palette value of n is entry n - 1. */
export const MERIDIAN_SCHEMES: readonly MeridianScheme[] = [
  { name: 'Crimson', swatches: ['#f4f7ff', '#ff2d55', '#7a5cff', '#ffffff', '#ff3d6e', '#050308'] },
  { name: 'Aqua', swatches: ['#d8fff4', '#00ffc2', '#2a8bff', '#ffffff', '#16e6c0', '#010607'] },
  { name: 'Amber', swatches: ['#fff1dc', '#ffb000', '#ff4a00', '#fffbe8', '#ff7a18', '#070402'] },
  { name: 'Violet', swatches: ['#ece6ff', '#b45cff', '#ff3fd0', '#ffffff', '#9a4dff', '#05030b'] },
  { name: 'Electric', swatches: ['#e6f6ff', '#2fb4ff', '#c8ff2e', '#ffffff', '#1f8cff', '#01040a'] },
  { name: 'Silver', swatches: ['#ffffff', '#ffffff', '#9aa4b8', '#ffffff', '#c8d4ea', '#030304'] },
  { name: 'Rose', swatches: ['#ffe9f2', '#ff5fa2', '#ffd23f', '#ffffff', '#ff4d8d', '#080306'] },
  { name: 'Acid', swatches: ['#f4ffd6', '#b6ff00', '#ff00a8', '#ffffff', '#8cff1a', '#040602'] },
  { name: 'Glacier', swatches: ['#eefaff', '#6fe3ff', '#5b6cff', '#ffffff', '#49c6ff', '#01050b'] },
  { name: 'Infrared', swatches: ['#ffe8e0', '#ff1f1f', '#ff00c8', '#fff4ec', '#ff3a1a', '#080102'] },
  { name: 'Jade', swatches: ['#eafff2', '#19e68c', '#f2ff49', '#ffffff', '#12c977', '#010704'] },
  { name: 'Blaze', swatches: ['#fff6e8', '#ff5a00', '#00d5ff', '#ffffff', '#ff7a1f', '#060302'] },
];
/** The Palette value that lets each composition pick its own scheme. */
export const SEED_SCHEME = MERIDIAN_SCHEMES.length + 1;
