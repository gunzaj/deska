// The AI API key as the local server holds it (SPEC §2.3): the same rules as the
// GitHub token. Main decrypts it and sends it over IPC; the server entry keeps it
// on `globalThis`, in memory only. Nothing here reads an environment variable,
// a file or the database. globalThis, not a module variable: Next loads server
// modules more than once.
const KEY = Symbol.for("deska.aiKey");

/** The key, or null when none is set. */
export function aiKey(): string | null {
  const k = (globalThis as Record<symbol, unknown>)[KEY];
  return typeof k === "string" && k ? k : null;
}

/** What desktop/server-entry.ts does with an `ai-key` message; tests use it too. */
export function setAiKey(key: string | null): void {
  (globalThis as Record<symbol, unknown>)[KEY] = key ?? undefined;
}
