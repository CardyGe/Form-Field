/**
 * Saturated palettes for projection: five full-strength colours and a dark
 * ground in slot 6. Taken from the reference recordings (neon on black,
 * complementary pairs such as yellow/cyan, magenta/orange and lime/violet).
 */
export const NEON_STRATA = ['#ff2e93', '#ffe600', '#00e5ff', '#7a2cff', '#39ff14', '#0b0614'];
export const ACID_DRIP = ['#b6ff00', '#ffef00', '#ff3cac', '#2de2e6', '#ff8a00', '#120024'];
export const POP_PORTAL = ['#00f0ff', '#ff00a8', '#fff200', '#00ff6a', '#7b00ff', '#05010f'];
export const HOT_SIGNAL = ['#ff1f6b', '#ff8a00', '#ffd400', '#ff4fd8', '#00e5ff', '#14020c'];
export const LIME_VIOLET = ['#c6ff00', '#8a2cff', '#5cff5c', '#d04dff', '#00f0ff', '#0c0418'];
export const ELECTRIC = ['#00e5ff', '#2f6bff', '#8a2cff', '#ff2e93', '#e8ff00', '#04030f'];
export const CANDY = ['#ff5fa2', '#5ff2ff', '#ffe45c', '#b28cff', '#ff9a3c', '#0a0614'];
export const SOLAR = ['#ffcc00', '#ff5a1f', '#ff1744', '#ff9e00', '#ff4fd8', '#1a0408'];
export const CYAN_YELLOW = ['#00c2ff', '#ffe500', '#00ffd5', '#fff066', '#0066ff', '#020814'];
/** Acrylic pour: slot 6 is a light ground, not a dark one. */
export const POUR = ['#e8ff00', '#00b3ff', '#c6ff1a', '#0a0a0a', '#7dff00', '#008cff'];
export const LASER_GARDEN = ['#00ff9d', '#00d0ff', '#f6ff00', '#ff2bd6', '#6a3dff', '#02060a'];
export const ULTRAVIOLET = ['#d400ff', '#7300ff', '#ff00c8', '#00b7ff', '#ff6ee7', '#07000f'];
export const MOLTEN = ['#fff04a', '#ffa600', '#ff4d00', '#ff0048', '#b5002d', '#120202'];
export const TOXIC = ['#ccff00', '#00ff55', '#00ffc8', '#f2ff66', '#ff00aa', '#031006'];
export const DEEP_REEF = ['#00ffd9', '#00a2ff', '#ff6f61', '#ffd166', '#a24bff', '#011420'];
export const BUBBLEGUM = ['#ff4fb8', '#ff9de2', '#7df9ff', '#fff36b', '#a06bff', '#1a0620'];
export const SUNSET_RAVE = ['#ffd000', '#ff7a00', '#ff1f8f', '#a100ff', '#3a2bff', '#10031c'];
export const ICE_FIRE = ['#6ff3ff', '#0089ff', '#ffffff', '#ff5a00', '#ff0033', '#030712'];
export const BLOOD_ORANGE = ['#ff3b00', '#ff8c1a', '#ffe0a3', '#c4002f', '#ff0066', '#140305'];
export const AURORA = ['#35ff9b', '#17e9e0', '#4d7cff', '#b14dff', '#ff5fd2', '#020a12'];
export const GOLD_RUSH = ['#ffe680', '#ffc400', '#ff9500', '#fff7d6', '#00c8ff', '#0e0a02'];
export const PRISM = ['#ff0040', '#ffb000', '#3dff00', '#00b3ff', '#b000ff', '#050505'];
export const RISO = ['#ff4c65', '#0078bf', '#ffe800', '#00a95c', '#ff6c2f', '#f7f1e3'];
export const MONO_BLAZE = ['#ffffff', '#ff0033', '#ffffff', '#ff0033', '#7a0018', '#000000'];
export const COBALT_COPPER = ['#ff9a4d', '#ffcf99', '#2f7bff', '#00d5ff', '#d65a1f', '#030a1c'];
export const MINT_MAGENTA = ['#7dffcf', '#ff1fb4', '#d8fff0', '#ff74d4', '#00d6a1', '#0b0212'];
export const PSYCH_70S = ['#ff6a00', '#ffc300', '#d7263d', '#1b998b', '#c200fb', '#1b0a00'];
export const VAPOR = ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96', '#120a24'];
export const ELECTRIC_LIME = ['#d4ff00', '#00ffea', '#ffffff', '#5dff00', '#0066ff', '#000a02'];
export const CRIMSON_TEAL = ['#ff174d', '#00e0c6', '#ffb3c1', '#009e94', '#ffef5c', '#08090f'];

/** The palette picker, in the order it shows them. Every entry is five inks and a ground. */
export const PALETTE_LIBRARY: { name: string; colors: string[] }[] = [
  { name: 'Neon Strata', colors: NEON_STRATA }, { name: 'Acid Drip', colors: ACID_DRIP }, { name: 'Pop Portal', colors: POP_PORTAL },
  { name: 'Hot Signal', colors: HOT_SIGNAL }, { name: 'Lime Violet', colors: LIME_VIOLET }, { name: 'Electric', colors: ELECTRIC },
  { name: 'Candy', colors: CANDY }, { name: 'Solar', colors: SOLAR }, { name: 'Cyan Yellow', colors: CYAN_YELLOW }, { name: 'Pour', colors: POUR },
  { name: 'Laser Garden', colors: LASER_GARDEN }, { name: 'Ultraviolet', colors: ULTRAVIOLET }, { name: 'Molten', colors: MOLTEN },
  { name: 'Toxic', colors: TOXIC }, { name: 'Deep Reef', colors: DEEP_REEF }, { name: 'Bubblegum', colors: BUBBLEGUM },
  { name: 'Sunset Rave', colors: SUNSET_RAVE }, { name: 'Ice and Fire', colors: ICE_FIRE }, { name: 'Blood Orange', colors: BLOOD_ORANGE },
  { name: 'Aurora', colors: AURORA }, { name: 'Gold Rush', colors: GOLD_RUSH }, { name: 'Prism', colors: PRISM },
  { name: 'Riso Print', colors: RISO }, { name: 'Mono Blaze', colors: MONO_BLAZE }, { name: 'Cobalt Copper', colors: COBALT_COPPER },
  { name: 'Mint Magenta', colors: MINT_MAGENTA }, { name: "Psych '70s", colors: PSYCH_70S }, { name: 'Vapor', colors: VAPOR },
  { name: 'Electric Lime', colors: ELECTRIC_LIME }, { name: 'Crimson Teal', colors: CRIMSON_TEAL },
];

/** Flat colour with outlines, used as the starting finish for shaded families. */
export const FLAT_FINISH = { toonMix: 1, toonBands: 5, toonOutline: 2.5 };
