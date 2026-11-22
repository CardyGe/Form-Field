export const PHRASE_STATES = ['seed','draw','build','charge','peak','collapse','rest'] as const;
export type PhraseState = typeof PHRASE_STATES[number];
export type ElementGroup = 'ring'|'arc'|'tick'|'spoke'|'node'|'hub'|'hero';
export interface ScoreElement { group: ElementGroup; zone: number; radius: number; angle: number; length: number; weight: number; colour: number; enter: number; exit: number; slot: number }
export interface Score { seed: number; symmetry: number; bars: number; stateEnds: readonly number[]; elements: readonly ScoreElement[]; rhythm: Readonly<Record<'ring'|'spoke'|'node', readonly boolean[]>>; quality: number }
export interface PerformanceState { hold: boolean; tension: number; burst: number; forcedState: PhraseState | null }
export const PRIMITIVE = { ring: 0, arc: 1, segment: 2, square: 3, dot: 4 } as const;
