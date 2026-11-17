/** Debounced writer: only the latest value is written, `delay` ms after the last save call. */
export function autosaveSchedule<T>(write: (value: T) => void | Promise<void>, delay = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  const run = (): void | Promise<void> => {
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    return write(value);
  };
  return {
    save(value: T) { pending = { value }; if (timer) clearTimeout(timer); timer = setTimeout(run, delay); },
    /** Writes a waiting value now, so leaving the screen does not lose the last change. */
    flush(): void | Promise<void> { if (timer) clearTimeout(timer); return run(); },
    cancel() { if (timer) clearTimeout(timer); timer = null; pending = null; },
  };
}

/** Edits wait for the saved show, so a late load cannot overwrite them. */
export const canEdit = (loaded: boolean): boolean => loaded;
