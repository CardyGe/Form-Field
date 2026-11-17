/**
 * Debounced writer: only the latest value is written, `delay` ms after the last save call.
 * A write that fails is kept, so the next flush tries it again rather than reporting success.
 */
export function autosaveSchedule<T>(write: (value: T) => void | Promise<void>, delay = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let started = 0; // how many writes have begun, so a failed write knows whether a newer one replaced it
  let latest: Promise<void> | null = null; // the most recent write, still running or finished
  const running = new Set<Promise<void>>();

  const start = (): Promise<void> | null => {
    timer = null;
    if (!pending) return null;
    const { value } = pending;
    pending = null;
    const number = ++started;
    let result: void | Promise<void>;
    try { result = write(value); } catch (error) { result = Promise.reject(error); }
    const operation = Promise.resolve(result).catch(error => {
      // Nothing newer was asked for: keep the value so a flush writes it again.
      if (number === started && !pending) pending = { value };
      throw error;
    });
    latest = operation;
    running.add(operation);
    // The timer path has no caller to report to; the caller's write function reports the failure itself.
    operation.catch(() => {}).finally(() => running.delete(operation));
    return operation;
  };

  return {
    save(value: T) { pending = { value }; if (timer) clearTimeout(timer); timer = setTimeout(start, delay); },
    /**
     * Writes a waiting value now, and resolves only when every write already running has finished too,
     * so leaving the screen does not lose the last change. Rejects when the latest write failed.
     */
    flush(): Promise<void> {
      if (timer) clearTimeout(timer);
      timer = null;
      start();
      const outcome = latest;
      return Promise.allSettled([...running]).then(() => outcome ?? undefined);
    },
    cancel() { if (timer) clearTimeout(timer); timer = null; pending = null; },
  };
}

/** Edits wait for the saved show, so a late load cannot overwrite them. */
export const canEdit = (loaded: boolean): boolean => loaded;
