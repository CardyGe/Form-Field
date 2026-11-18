/**
 * Scenes: saved choices of what plays where. A scene keeps, for each shape, what it plays and how (its scene state);
 * never its outline. The shapes on screen are always the live scene, so editing changes the live scene.
 */
import type { Shape } from './show';

export type SceneState = Pick<Shape, 'sourceId' | 'fill' | 'placement' | 'brightness' | 'tint' | 'softEdge' | 'border' | 'visible' | 'blocker'>;
export interface Scene { id: string; name: string; fadeSeconds: number | null; shapes: Record<string, SceneState> }
export const MAX_SCENES = 32;
export const FADE_RANGE = { min: 0, max: 30 };

export function stateOf(shape: Shape): SceneState {
  return structuredClone({ sourceId: shape.sourceId, fill: shape.fill, placement: shape.placement, brightness: shape.brightness, tint: shape.tint, softEdge: shape.softEdge, border: shape.border, visible: shape.visible, blocker: shape.blocker });
}
/** Every shape's state, as a scene keeps it. */
export const capture = (shapes: Shape[]): Record<string, SceneState> => Object.fromEntries(shapes.map(s => [s.id, stateOf(s)]));
/** A shape with a scene's state on it (outline untouched). */
export const withState = (shape: Shape, state: SceneState | undefined): Shape => state ? { ...shape, ...structuredClone(state) } : shape;
