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
