/** Close-then-set-Status-done sequence (SPEC §5). Reopen leaves Status alone. */
export function closeSequence(): ["close-issue", "set-status-done"] {
  return ["close-issue", "set-status-done"];
}

/** Create issue, then add it to the project, set the mapped fields and the Type (W3). */
export function createSequence(): ["create-issue", "add-to-project", "set-fields", "set-type"] {
  return ["create-issue", "add-to-project", "set-fields", "set-type"];
}
