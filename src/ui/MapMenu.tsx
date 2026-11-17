import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

/** One line of a right-click menu. */
export type MenuEntry =
  | { kind: 'item'; label: string; shortcut?: string; disabled?: boolean; danger?: boolean; checked?: boolean; onSelect: () => void }
  | { kind: 'separator' }
  | { kind: 'swatches'; label: string; colours: string[]; current: string | null; disabled?: boolean; onPick: (colour: string) => void };

/**
 * A right-click menu at the pointer. It keeps itself on screen, takes focus so the arrow keys move through it,
 * and closes on Escape, a click elsewhere, scrolling, resizing or leaving the window.
 */
export default function MapMenu({ x, y, entries, label, onClose }: { x: number; y: number; entries: MenuEntry[]; label: string; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });

  // Keep the whole menu inside the window: open up or left of the pointer when there is no room below or right.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    setAt({
      left: x + box.width + margin > window.innerWidth ? Math.max(margin, x - box.width) : x,
      top: y + box.height + margin > window.innerHeight ? Math.max(margin, y - box.height) : y,
    });
  }, [x, y]);

  const focusable = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  useEffect(() => { focusable()[0]?.focus(); }, []);

  useEffect(() => {
    const outside = (e: Event) => { if (!menu.current?.contains(e.target as Node)) onClose(); };
    const close = () => onClose();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('wheel', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = focusable(), index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); buttons[(index + 1) % buttons.length]?.focus(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); buttons[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); buttons.at(-1)?.focus(); }
    // Keys pressed inside the menu belong to it, never to the stage behind it.
    e.stopPropagation();
  };
  const choose = (action: () => void) => { onClose(); action(); };

  return <div ref={menu} className="map-menu" role="menu" aria-label={label} style={{ left: at.left, top: at.top }} onKeyDown={onKeyDown} onContextMenu={e => e.preventDefault()}>
    {entries.map((entry, i) => {
      if (entry.kind === 'separator') return <hr key={i} role="separator" />;
      if (entry.kind === 'swatches') return <div key={i} className="map-menu-swatches" role="group" aria-label={entry.label}>
        {entry.colours.map(colour => <button key={colour} type="button" role="menuitemradio" aria-checked={colour.toLowerCase() === entry.current?.toLowerCase()}
          aria-label={`${entry.label} ${colour}`} title={colour} disabled={entry.disabled} style={{ background: colour }} onClick={() => choose(() => entry.onPick(colour))} />)}
      </div>;
      return <button key={i} type="button" role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={entry.checked}
        className={entry.danger ? 'danger' : ''} disabled={entry.disabled} onClick={() => choose(entry.onSelect)}>
        <span>{entry.checked !== undefined && <span className="map-menu-check" aria-hidden>{entry.checked ? '✓' : ''}</span>}{entry.label}</span>
        {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
      </button>;
    })}
  </div>;
}
