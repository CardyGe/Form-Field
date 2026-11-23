/** The Perform screen's link to the running show: its view, and every on-screen and keyboard control. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ControlEvent } from '../perform/controls';
import type { PerformView } from '../perform/service';
import { endPerformShow, performSession } from './useMap';

type KeyLike = Pick<KeyboardEvent, 'type' | 'code' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>;

const RED_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI'];
const NOT_TYPING = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color']);

/** A text field, a menu or a dialog has the keys: the controller does not. */
export function keysBelongElsewhere(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { type?: string }) | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
  if (el.tagName === 'INPUT' && !NOT_TYPING.has(el.type ?? 'text')) return true;
  return !!el.closest?.('[role="menu"], [role="dialog"], dialog');
}

/**
 * The computer keyboard as the MIDImix. Read by physical key, so Shift (Solo) + 1 is still key 1.
 * Space (tap) and F (Follow) are actions rather than controller events, so they are not here.
 */
export function keyboardControl(event: KeyLike): ControlEvent | null {
  const down = event.type === 'keydown';
  if (down && (event.repeat || event.metaKey || event.ctrlKey || event.altKey || keysBelongElsewhere(event.target))) return null;
  const { code } = event;
  if (/^Digit[1-8]$/.test(code)) return { kind: 'amber', strip: Number(code.slice(5)) - 1, down };
  const red = RED_KEYS.indexOf(code);
  if (red >= 0) return { kind: 'red', strip: red, down };
  if (code === 'BracketLeft') return { kind: 'bankBack', down };
  if (code === 'BracketRight') return { kind: 'bankNext', down };
  if (code === 'ShiftLeft' || code === 'ShiftRight') return { kind: 'solo', down };
  if (code === 'Backslash') return { kind: down ? 'sendAllStart' : 'sendAllEnd' };
  return null;
}

/** What ends a held control, so a press can always be released, even if its key-up never arrives. */
function releaseOf(e: ControlEvent): ControlEvent | null {
  if (e.kind === 'sendAllStart') return { kind: 'sendAllEnd' };
  if (e.kind === 'amber' || e.kind === 'red') return { kind: e.kind, strip: e.strip, down: false };
  if (e.kind === 'bankNext' || e.kind === 'bankBack' || e.kind === 'solo') return { kind: e.kind, down: false };
  return null;
}
const controlId = (e: ControlEvent) => 'strip' in e ? `${e.kind}-${e.strip}` : e.kind === 'sendAllStart' || e.kind === 'sendAllEnd' ? 'sendAll' : e.kind;

export function usePerform() {
  const service = performSession();
  const [view, setView] = useState<PerformView>(() => service.view());
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const down = useRef(new Map<string, ControlEvent>());
  const showHeld = () => setHeld(new Set(down.current.keys()));

  useEffect(() => {
    setView(service.view());
    const test = window.__studioTest ?? {};
    window.__studioTest = { ...test, perform: () => service.view() };
    return service.subscribe(setView);
  }, [service]);

  const press = useCallback((e: ControlEvent) => {
    const id = controlId(e);
    if (down.current.has(id)) return;
    const release = releaseOf(e);
    if (release) down.current.set(id, release);
    service.control(e);
    showHeld();
  }, [service]);
  const release = useCallback((id: string) => {
    const end = down.current.get(id);
    if (!end) return;
    down.current.delete(id);
    service.control(end);
    showHeld();
  }, [service]);
  /** Focus went away: everything held lets go, but a Send All cut off part-way has not read the controls, so it does not finish. */
  const releaseAll = useCallback(() => {
    down.current.delete('sendAll');
    for (const id of [...down.current.keys()]) release(id);
    showHeld();
  }, [release]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!service.running) return;
      const isDown = e.type === 'keydown';
      if (!keysBelongElsewhere(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey && (e.code === 'Space' || e.code === 'KeyF')) {
        // Held on a focused button, Space must not also click it.
        e.preventDefault();
        if (isDown && !e.repeat) service.action({ type: e.code === 'Space' ? 'tap' : 'follow' });
        return;
      }
      const control = keyboardControl(e);
      if (!control) return;
      const id = controlId(control);
      if (isDown) { e.preventDefault(); press(control); }
      // Only a press that was taken is released: a stray key-up must never finish a Send All.
      else if (down.current.has(id)) release(id);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', releaseAll);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', releaseAll); releaseAll(); };
  }, [service, press, release, releaseAll]);

  const sendAll = useCallback(() => { service.control({ kind: 'sendAllStart' }); service.control({ kind: 'sendAllEnd' }); }, [service]);
  const endShow = useCallback(() => { releaseAll(); endPerformShow(); }, [releaseAll]);
  return { service, view, held, press, release, sendAll, endShow, controlId };
}
