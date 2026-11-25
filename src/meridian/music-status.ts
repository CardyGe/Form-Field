/** What the Conductor is doing, for the panel to show. Written once a frame by the renderer; holds no history. */
export const musicStatus: { status: 'locked' | 'holding' | 'free'; bpm: number } = { status: 'free', bpm: 124 };
