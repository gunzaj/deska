// Token redaction (SPEC §2.3): the GitHub token never reaches a log, an error
// message, an API answer or an export. Two rules, applied to every string:
// anything shaped like a GitHub token (`github_pat_…` and the classic
// `gh?_…` shapes) and any occurrence of the exact token the app holds.
import { localToken } from "./github/local-token";

const REDACTED = "[redacted]";

const TOKEN_SHAPES = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

/** `text` with token-shaped strings, the held token and `extra` values replaced. */
export function redactSecrets(text: string, extra: readonly (string | null | undefined)[] = []): string {
  let out = text;
  for (const v of [localToken(), ...extra]) {
    // Short values (a placeholder like "off") would mangle ordinary words.
    if (v && v.length >= 8) out = out.split(v).join(REDACTED);
  }
  return out.replace(TOKEN_SHAPES, REDACTED);
}

/** A copy of `value` with every string inside redacted (plain JSON values only). */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}

function redactArg(arg: unknown): unknown {
  if (typeof arg === "string") return redactSecrets(arg);
  if (arg instanceof Error) {
    const copy = new Error(redactSecrets(arg.message));
    copy.name = arg.name;
    copy.stack = arg.stack ? redactSecrets(arg.stack) : undefined;
    return copy;
  }
  return redactDeep(arg);
}

const INSTALLED = Symbol.for("deska.logRedaction");

/**
 * Every console method of this process redacts its arguments. Next.js and the
 * app log through `console`, so this covers the server's whole log output.
 * Idempotent: Next loads server modules more than once.
 */
export function installLogRedaction(target: Console = console): void {
  const t = target as Console & { [INSTALLED]?: boolean };
  if (t[INSTALLED]) return;
  t[INSTALLED] = true;
  for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const) {
    const original = t[method].bind(t);
    t[method] = (...args: unknown[]) => original(...args.map(redactArg));
  }
}
