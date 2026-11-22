/** What a shape can play besides a Library preset: its own fills, and Live (the Live screen's look). */
export interface Look { value: string; name: string; kind: string; group: string; description: string }

export const OWN_LOOKS: Look[] = [
  { value: 'grid', name: 'Grid pattern', kind: 'fill', group: 'Fill', description: 'Lines in the shape’s colour, for lining up' },
  { value: 'colour', name: 'Its colour', kind: 'fill', group: 'Fill', description: 'The shape’s plain colour' },
  { value: 'live', name: 'Live', kind: 'live', group: 'Live', description: 'The Live screen’s look, from the camera' },
  { value: 'image', name: 'Image…', kind: 'image', group: 'Your own', description: 'A picture of your own: PNG or JPEG' },
  { value: 'video', name: 'Video…', kind: 'video', group: 'Your own', description: 'A short loop of your own: MP4 or MOV' },
];
