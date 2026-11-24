/** Twelve colour families, five stops each, as sRGB. The shader walks them as a loop. */
export const MORPH_PALETTES: readonly { name: string; stops: string[] }[] = [
  { name: 'Orchid', stops: ['#ff4fa3', '#ffd1ec', '#a33cff', '#ff2d6f', '#ffe45c'] },
  { name: 'Solar', stops: ['#ff6a00', '#ffd23f', '#fff4c2', '#ff3d2e', '#7a1fa2'] },
  { name: 'Mercury', stops: ['#c9d6e8', '#f5f8ff', '#5b6c8a', '#9fb3d1', '#22304a'] },
  { name: 'Abyss', stops: ['#032b4f', '#00c2d1', '#0a0f3c', '#3f5efb', '#7cffcb'] },
  { name: 'Pearl', stops: ['#fff1e6', '#f7c6d9', '#cde7f0', '#e8dcff', '#fff9d6'] },
  { name: 'Acid', stops: ['#c6ff00', '#00e676', '#ff00c8', '#fff200', '#1de9b6'] },
  { name: 'Chrome', stops: ['#e6e6e6', '#ffffff', '#6e6e73', '#b5b5ba', '#2b2b30'] },
  { name: 'Ember', stops: ['#3b0a0a', '#ff4d00', '#ffb300', '#a30015', '#ffe7a3'] },
  { name: 'Glacier', stops: ['#d9f6ff', '#6fd3ff', '#ffffff', '#2f7fd6', '#b8c9ff'] },
  { name: 'Oil', stops: ['#141026', '#00b8a9', '#f6416c', '#ffde7d', '#5c2a9d'] },
  { name: 'Moonlit', stops: ['#1c1f3b', '#8f94fb', '#e0e4ff', '#4e54c8', '#ff9de2'] },
  { name: 'Mono', stops: ['#0d0d0d', '#f2f2f2', '#595959', '#bfbfbf', '#262626'] },
];
