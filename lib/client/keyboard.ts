/**
 * True while the user is typing, a popover/dialog owns the keyboard, or Enter
 * or Space would activate the focused button or link (not the focused row).
 *
 * Lives here, not in the explorer, so the global shortcuts and other lists do
 * not pull the explorer, the board and `@dnd-kit` into every route (v5 3.9).
 */
export function keyboardBusy(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return true;
  if (el && (e.key === "Enter" || e.key === " ") && el.closest("button, a[href], [role='button']")) return true;
  return !!document.querySelector('[role="dialog"]');
}
