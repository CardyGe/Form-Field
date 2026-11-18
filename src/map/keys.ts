/** True when a key press belongs to a text box, so stage shortcuts must leave it alone. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

/** A field commits only when its text differs from what it showed when the user began editing. */
export function shouldCommit(startText: string, draft: string): boolean {
  return draft !== startText;
}

export type Shortcut = 'undo' | 'redo' | 'delete' | 'duplicate' | 'select' | 'rectangle' | 'triangle' | 'ellipse' | 'pen' | 'close'
  | 'select-all' | 'group' | 'ungroup' | 'deselect' | 'arrow' | 'next-corner' | 'previous-corner' | 'scene' | 'tap';

/**
 * What a key press asks the Map screen to do, or null when it asks nothing or belongs to a text box.
 * `onStage` is true when focus is on the stage: Delete, Backspace and Tab act only then, so a key
 * pressed while a button has focus never deletes a shape or steals Tab from moving between controls.
 */
export function shortcutFor(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; onStage?: boolean; target: { tagName?: string; isContentEditable?: boolean } | null }): Shortcut | null {
  if (isTypingTarget(e.target)) return null;
  const key = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) {
    if (e.altKey) return null;
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'd' && !e.shiftKey) return 'duplicate';
    if (key === 'a' && !e.shiftKey) return 'select-all';
    if (key === 'g') return e.shiftKey ? 'ungroup' : 'group';
    return null;
  }
  if (e.altKey) return null;
  if (key === 'v') return 'select';
  if (key === 'r') return 'rectangle';
  if (key === 't') return 'triangle';
  if (key === 'e') return 'ellipse';
  if (key === 'p') return 'pen';
  // Stage 5: 1 to 9 switch to that scene; B taps the tempo (T is the triangle).
  if (/^[1-9]$/.test(e.key)) return 'scene';
  if (key === 'b') return 'tap';
  // Enter closes a Pen outline, only from the stage: on a button it presses the button.
  if (e.key === 'Enter') return e.onStage ? 'close' : null;
  if (e.key === 'Escape') return 'deselect';
  if (e.key === 'Delete' || e.key === 'Backspace') return e.onStage ? 'delete' : null;
  if (e.key === 'Tab') return e.onStage ? (e.shiftKey ? 'previous-corner' : 'next-corner') : null;
  if (e.key in { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 }) return 'arrow';
  return null;
}
