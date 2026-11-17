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

export type Shortcut = 'undo' | 'redo' | 'delete' | 'select' | 'rectangle' | 'deselect' | 'arrow';

/** What a key press asks the Map screen to do, or null when it asks nothing or belongs to a text box. */
export function shortcutFor(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; target: { tagName?: string; isContentEditable?: boolean } | null }): Shortcut | null {
  if (isTypingTarget(e.target)) return null;
  const key = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) return key === 'z' && !e.altKey ? (e.shiftKey ? 'redo' : 'undo') : null;
  if (e.altKey) return null;
  if (key === 'v') return 'select';
  if (key === 'r') return 'rectangle';
  if (e.key === 'Escape') return 'deselect';
  if (e.key === 'Delete' || e.key === 'Backspace') return 'delete';
  if (e.key in { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 }) return 'arrow';
  return null;
}
