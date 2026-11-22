export const PHRASE_STATES = ['seed','draw','build','charge','peak','collapse','rest'] as const;
export type PhraseState = typeof PHRASE_STATES[number];
export type ElementGroup = 'ring'|'arc'|'band'|'tick'|'spoke'|'node'|'hub'|'hero';
export interface ScoreElement { group: ElementGroup; zone: number; radius: number; angle: number; length: number; weight: number; colour: number; enter: number; exit: number; slot: number; shape: 'square' | 'dot'; /** 1 belongs to the second centre of a twin form. */ origin?: 0 | 1; /** Held back unless Negative space is lowered. */ reserve?: boolean; /** Keeps its place in the frame while the rings turn. */ fixed?: boolean }
export interface Score { seed: number; symmetry: number; bars: number; stateEnds: readonly number[]; elements: readonly ScoreElement[]; rhythm: Readonly<Record<'ring'|'spoke'|'node', readonly boolean[]>>; quality: number; form?: ScoreForm }
export interface PerformanceState { hold: boolean; tension: number; burst: number; forcedState: PhraseState | null }
/** The composer's first spoke points up the frame. A form turns the design from here. */
export const AXIS = Math.PI * 1.5;
export const FORM_KINDS = ['bleed', 'edge', 'core', 'field', 'twin', 'horizon', 'spiral', 'cathedral'] as const;
export type FormKind = typeof FORM_KINDS[number];
export const COLLAPSE_STYLES = ['fold', 'implode', 'vortex', 'iris', 'recoil'] as const;
export type CollapseStyle = typeof COLLAPSE_STYLES[number];
/**
 * The silhouette of a composition. Centres are in frame heights from the middle of the frame. The system travels
 * out to them from the opening point and back to it in Collapse, so phrases still chain through one point.
 */
export interface ScoreForm {
  kind: FormKind; outer: number; turn: number; centreX: number; centreY: number; twinX: number; twinY: number;
  square: number; collapse: CollapseStyle; collapseAngle: number; scheme: number; peakScheme: number;
}
export const PRIMITIVE = { ring: 0, arc: 1, segment: 2, square: 3, dot: 4, fill: 5 } as const;
