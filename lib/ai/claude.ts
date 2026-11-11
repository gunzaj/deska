// The Claude Code provider (SPEC §4.9): the user's own `claude` CLI in print
// mode. The prompt goes in on stdin, the answer is the `structured_output` of
// the JSON the CLI prints. The child has no tools, no MCP servers, no settings
// files and no session, runs in an empty temp folder, and gets an environment
// with no GitHub token and nothing of Deska's.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redactSecrets } from "../redact";
import { findOnPath, loginPath } from "./path";
import type { AiFailure } from "./types";

/** Flags Deska needs; "Test connection" checks `claude --help` for each. */
export const REQUIRED_FLAGS = ["--print", "--output-format", "--json-schema", "--system-prompt", "--tools", "--strict-mcp-config", "--setting-sources", "--no-session-persistence", "--model"] as const;

const MAX_OUTPUT = 8 * 1024 * 1024;

/** `claude --help` per executable, kept for this process: main resolves the PATH once per launch. */
const helpByFile = new Map<string, string>();

/** Environment variables that never reach the `claude` child: Deska's own, GitHub's and the local server's. */
const BLOCKED = /^(DESKA_|GITHUB_|GH_|ELECTRON_|NEXT_|__NEXT|NODE_OPTIONS$|NODE_ENV$|PORT$|HOSTNAME$)/;

/** The `claude` child's environment: the server's, minus the blocked names, with the login-shell PATH. */
export function claudeEnv(env: NodeJS.ProcessEnv = process.env, pathValue: string = loginPath()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !BLOCKED.test(k)) out[k] = v;
  out.PATH = pathValue;
  return out;
}

/** The arguments of one call (SPEC §4.9). The prompt itself goes on stdin, not here. */
export function claudeArgs(o: { schema: unknown; system: string; model: string; effort?: string }): string[] {
  const args = ["-p", "--output-format", "json", "--json-schema", JSON.stringify(o.schema), "--system-prompt", o.system, "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--model", o.model];
  if (o.effort) args.push("--effort", o.effort);
  return args;
}

type RunResult = { ok: true; stdout: string; stderr: string } | { ok: false; reason: "timeout" | "cancelled" | "spawn" | "exit"; stdout: string; stderr: string; message: string };

function run(file: string, args: string[], stdin: string, o: { cwd: string; timeoutMs: number; signal?: AbortSignal; env: Record<string, string> }): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return resolve({ ok: false, reason: "spawn", stdout, stderr, message: e instanceof Error ? e.message : String(e) });
    }
    const kill = () => child.kill("SIGKILL");
    const timer = setTimeout(() => {
      kill();
      done({ ok: false, reason: "timeout", stdout, stderr, message: "timeout" });
    }, o.timeoutMs);
    function onAbort() {
      kill();
      done({ ok: false, reason: "cancelled", stdout, stderr, message: "cancelled" });
    }
    if (o.signal?.aborted) return onAbort();
    o.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += d.toString("utf8");
    });
    child.on("error", (e) => done({ ok: false, reason: "spawn", stdout, stderr, message: e.message }));
    child.on("close", (code) => done(code === 0 ? { ok: true, stdout, stderr } : { ok: false, reason: "exit", stdout, stderr, message: `exit code ${code}` }));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(stdin);
  });
}

const LOGIN_HINT = /not logged in|please run \/login|\/login|invalid api key|authentication|unauthori[sz]ed|oauth token|credit balance/i;

const short = (s: string) => redactSecrets(s.replace(/\s+/g, " ").trim()).slice(0, 300);

/** `claude --help`, from a temp folder. */
async function readHelp(file: string): Promise<{ ok: true; text: string } | ({ ok: false } & AiFailure)> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "deska-ai-"));
  try {
    const out = await run(file, ["--help"], "", { cwd, timeoutMs: 15_000, env: claudeEnv() });
    const help = out.stdout + out.stderr;
    if (!out.ok && !help) return { ok: false, code: "failed", message: `claude --help failed: ${short(out.message)}` };
    return { ok: true, text: help };
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * What the installed CLI offers (SPEC §4.9). The help text is read once per
 * executable, because the PATH is resolved once per launch; `refresh` re-reads it
 * after an update or for "Test connection". `found` only says the executable is
 * on the PATH, not that it has every flag Deska needs.
 */
export async function claudeCapabilities(o: { refresh?: boolean } = {}): Promise<{ found: boolean; effort: boolean }> {
  const file = findOnPath("claude");
  if (!file) return { found: false, effort: false };
  let text = o.refresh ? undefined : helpByFile.get(file);
  if (text === undefined) {
    const help = await readHelp(file);
    if (!help.ok) return { found: true, effort: false };
    text = help.text;
    helpByFile.set(file, text);
  }
  return { found: true, effort: /--effort\b/.test(text) };
}

/** `claude --help` and what it lacks. Always reads it fresh: this is the state "Test connection" reports. */
export async function checkClaudeCli(): Promise<{ ok: true; file: string } | ({ ok: false } & AiFailure)> {
  const file = findOnPath("claude");
  if (!file) return { ok: false, code: "cli-missing", message: "Deska could not find the Claude Code CLI (claude). Install Claude Code, then try again. The Claude desktop app alone is not enough." };
  const out = await readHelp(file);
  if (!out.ok) return out;
  helpByFile.set(file, out.text);
  const missing = REQUIRED_FLAGS.filter((f) => !out.text.includes(f));
  if (missing.length) return { ok: false, code: "cli-flag-missing", message: `This version of Claude Code lacks ${missing.join(", ")}, which Deska needs. Update Claude Code (claude update) and try again.` };
  return { ok: true, file };
}

export type ModelAnswer = { ok: true; output: unknown; costUsd: number | null } | ({ ok: false } & AiFailure);

/** One call to `claude`: the parsed `structured_output`, or why there is none. */
export async function callClaude(o: { model: string; effort?: string; system: string; user: string; schema: unknown; timeoutMs: number; signal?: AbortSignal }): Promise<ModelAnswer> {
  const file = findOnPath("claude");
  if (!file) return { ok: false, code: "cli-missing", message: "Deska could not find the Claude Code CLI (claude)." };
  // A stored effort is passed only when this CLI has `--effort`; an older CLI
  // would exit with "unknown option" instead of answering.
  const effort = o.effort && (await claudeCapabilities()).effort ? o.effort : undefined;
  const cwd = await mkdtemp(path.join(os.tmpdir(), "deska-ai-"));
  try {
    const out = await run(file, claudeArgs({ schema: o.schema, system: o.system, model: o.model, effort }), o.user, { cwd, timeoutMs: o.timeoutMs, signal: o.signal, env: claudeEnv() });
    if (!out.ok && out.reason === "timeout") return { ok: false, code: "timeout", message: `Claude Code did not answer within ${Math.round(o.timeoutMs / 1000)} seconds.` };
    if (!out.ok && out.reason === "cancelled") return { ok: false, code: "cancelled", message: "Cancelled." };
    if (!out.ok && out.reason === "spawn") return { ok: false, code: "failed", message: `Claude Code could not start: ${short(out.message)}` };
    let json: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(out.stdout);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    } catch {
      /* handled below */
    }
    const text = typeof json?.result === "string" ? json.result : "";
    if (!json || json.is_error === true || !out.ok) {
      const detail = `${text} ${out.stderr}`;
      if (LOGIN_HINT.test(detail)) return { ok: false, code: "not-logged-in", message: "Claude Code is not signed in. Run `claude` in a terminal and use /login, then try again." };
      return { ok: false, code: "failed", message: `Claude Code failed: ${short(detail) || (out.ok ? "no output" : short(out.message))}` };
    }
    if (json.structured_output === undefined || json.structured_output === null) return { ok: false, code: "invalid-output", message: "Claude Code returned no structured output." };
    return { ok: true, output: json.structured_output, costUsd: typeof json.total_cost_usd === "number" ? json.total_cost_usd : null };
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}
