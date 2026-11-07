// A one-way signal from the task service to the desktop services: "a task
// changed", so the Dock badge can follow without waiting for the next tick.
// A globalThis slot, because Next loads server modules more than once.
const SLOT = Symbol.for("deska.tasksChanged");

type Listener = () => void;
const slot = () => globalThis as Record<symbol, Listener | undefined>;

/** The desktop reminder service registers here; there is at most one listener. */
export function onTasksChanged(fn: Listener | null): void {
  slot()[SLOT] = fn ?? undefined;
}

/** Called after a task was created, changed, deleted or restored. Never throws. */
export function tasksChanged(): void {
  try {
    slot()[SLOT]?.();
  } catch {
    /* a badge that did not update must not fail a task edit */
  }
}
