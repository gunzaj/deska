// Token redaction (SPEC §2.3): the GitHub token and the AI API key never reaches a log, an error
// message, an API answer or an export. Two rules, applied to every string:
// anything shaped like a GitHub token (`github_pat_…` and the classic
// `gh?_…` shapes) and any occurrence of the exact token or key the app holds,
// when that value looks like a secret (see `looksSecret`).
import { aiKey, transcribeKey } from "./ai/key";
import { localToken } from "./github/local-token";

const REDACTED = "[redacted]";

// `sk-…` is the usual shape of an AI API key; the held key is replaced whatever its shape.
const TOKEN_SHAPES = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g;

/**
 * Whether a held value is worth replacing wherever it appears. A local model
 * server takes any key, so people type a placeholder ("lm-studio", "ollama",
 * "sk-no-key-required"); replacing that everywhere rewrote ordinary words in
 * task titles, comments and settings, in backups and exports too, and a
 * restore brought the damage back. A placeholder is no secret, so only a value
 * that looks generated is replaced: long, no spaces, letters and digits, and
 * varied (Shannon entropy of at least 3 bits per character).
 */
export function looksSecret(v: string): boolean {
  if (v.length < 16 || /\s/.test(v) || !/[A-Za-z]/.test(v) || !/\d/.test(v)) return false;
  const counts = new Map<string, number>();
  for (const c of v) counts.set(c, (counts.get(c) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= (n / v.length) * Math.log2(n / v.length);
  return bits >= 3;
}

/** `text` with token-shaped strings, the held token and key (when secret-looking) and `extra` values replaced. */
export function redactSecrets(text: string, extra: readonly (string | null | undefined)[] = []): string {
  let out = text;
  for (const v of [localToken(), aiKey(), transcribeKey()]) {
    if (v && looksSecret(v)) out = out.split(v).join(REDACTED);
  }
  for (const v of extra) {
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
