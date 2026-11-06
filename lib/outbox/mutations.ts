/** Close-then-set-Status-done sequence (SPEC §5). Reopen leaves Status alone. */
export function closeSequence(): ["close-issue", "set-status-done"] {
  return ["close-issue", "set-status-done"];
}
