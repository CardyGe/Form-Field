/** Perform: the set of zones, scenes and clips a live show launches. Saved in the .formshow file (version 9). */
export const ZONE_COUNT = 8;
export const MAX_PERFORM_SCENES = 16;
export const BEATS_PER_BAR = 4;
/** Looks start one at a time, so a full row can honestly take two bars: longer than this, a look is stuck. */
export const STUCK_AFTER_BARS = 2;

export type Quantize = '1/4' | '1/2' | '1bar' | '2bar' | '4bar';
export type BlendKind = 'cut' | 'fade' | 'dip' | 'dissolve';
export interface Blend { kind: BlendKind; bars: number }
/** A zone is one place on the wall: a group or a shape, or nothing yet. A protected zone (the Ceiling) is left alone by scenes unless they say so. */
export interface Zone { id: string; name: string; target: { kind: 'group' | 'shape'; id: string } | null; protected: boolean }
/** What a cell plays: an instrument, a video or Live (sourceId), tinted and driven by one audio band. */
export interface Clip { id: string; name: string; sourceId: string; hueOffset: number; blend: Blend | null; audioBand: 'bass' | 'mid' | 'high' | 'level' }
/** One row of the grid: a clip id per zone (null keeps what is playing), and where to go after a few bars, if anywhere. */
export interface Scene { id: string; name: string; cells: (string | null)[]; includeProtected: boolean; follow: { afterBars: 4 | 8 | 16 | 32; to: 'next' | 'previous' | 'first' | 'random' | string } | null }
export interface PerformanceSet { zones: Zone[]; scenes: Scene[]; clips: Clip[]; launchQuantize: Quantize }
