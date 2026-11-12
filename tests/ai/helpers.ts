// Test doubles for AI assist (SPEC Phase E): a fake `claude` CLI on a PATH of
// its own and a mock OpenAI-compatible server on 127.0.0.1. The real `claude`
// and any real endpoint are never called.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

export const HELP_TEXT = [
  "Usage: claude [options] [prompt]",
  "  -p, --print                    Print response and exit",
  "  --output-format <format>       Output format (json)",
  "  --json-schema <schema>         JSON Schema for structured output",
  "  --system-prompt <prompt>       System prompt",
  "  --tools <tools...>             Available tools",
  "  --strict-mcp-config            Only use MCP servers from --mcp-config",
  "  --setting-sources <sources>    Setting sources to load",
  "  --no-session-persistence       Do not save sessions",
  "  --model <model>                Model",
  "  --effort <level>               Effort level (low, medium, high, xhigh, max)",
].join("\n");

export type FakeClaude = {
  dir: string;
  /** The PATH to give the server: the fake first. */
  path: string;
  /** Every run's arguments, stdin, environment and working folder. */
  runs(): { args: string[]; stdin: string; env: Record<string, string>; cwd: string }[];
  /** What the next runs print on stdout (the first call uses the first item, and so on; the last repeats). */
  reply(...outputs: unknown[]): void;
  /** Make `claude --help` lack this flag. */
  withoutFlag(flag: string): void;
  /** Sleep this long before answering. */
  slow(ms: number): void;
  cleanup(): void;
};

/** A `claude` stand-in written in Node (its shebang is this Node), driven by files next to it. */
export function fakeClaude(): FakeClaude {
  const dir = mkdtempSync(path.join(os.tmpdir(), "deska-claude-"));
  writeFileSync(path.join(dir, "help.txt"), HELP_TEXT);
  const script = `#!${process.execPath}
const fs = require("fs");
const dir = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
if (args.includes("--help")) { process.stdout.write(fs.readFileSync(dir + "/help.txt", "utf8")); process.exit(0); }
let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  const n = fs.existsSync(dir + "/runs.jsonl") ? fs.readFileSync(dir + "/runs.jsonl", "utf8").trim().split("\\n").length : 0;
  fs.appendFileSync(dir + "/runs.jsonl", JSON.stringify({ args, stdin, env: process.env, cwd: process.cwd() }) + "\\n");
  const outputs = JSON.parse(fs.readFileSync(dir + "/outputs.json", "utf8"));
  const out = outputs[Math.min(n, outputs.length - 1)];
  const delay = fs.existsSync(dir + "/delay") ? Number(fs.readFileSync(dir + "/delay", "utf8")) : 0;
  setTimeout(() => { process.stdout.write(typeof out === "string" ? out : JSON.stringify(out)); process.exit(out && out.__exit ? out.__exit : 0); }, delay);
});
`;
  const file = path.join(dir, "claude");
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  writeFileSync(path.join(dir, "outputs.json"), JSON.stringify([{ type: "result", is_error: false, result: "", structured_output: { ok: true }, total_cost_usd: 0.01 }]));
  return {
    dir,
    path: `${dir}:/usr/bin:/bin`,
    runs: () => (existsSync(path.join(dir, "runs.jsonl")) ? readFileSync(path.join(dir, "runs.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    reply: (...outputs) => writeFileSync(path.join(dir, "outputs.json"), JSON.stringify(outputs)),
    withoutFlag: (flag) => writeFileSync(path.join(dir, "help.txt"), HELP_TEXT.split("\n").filter((l) => !l.includes(flag)).join("\n")),
    slow: (ms) => writeFileSync(path.join(dir, "delay"), String(ms)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The JSON `claude -p --output-format json` prints for a structured answer. */
export const claudeOk = (structured: unknown, cost = 0.02) => ({ type: "result", is_error: false, result: "", structured_output: structured, total_cost_usd: cost });
export const claudeError = (text: string) => ({ type: "result", is_error: true, result: text });

export type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
export type MockEndpoint = {
  /** `http://127.0.0.1:<port>/v1` */
  url: string;
  requests: Seen[];
  /** Answers requests; the function sees the request and returns [status, body] (status 0: never answer). */
  handle(fn: (req: Seen) => [number, unknown]): void;
  close(): Promise<void>;
};

/** A chat-completions answer carrying `content` (a JSON string or an object). */
export const chatOk = (content: unknown) => ({ choices: [{ message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }] });

export async function mockEndpoint(models: string[] = ["tiny-model"]): Promise<MockEndpoint> {
  const requests: Seen[] = [];
  let handler: (req: Seen) => [number, unknown] = (req) => (req.url.endsWith("/models") ? [200, { data: models.map((id) => ({ id })) }] : [200, chatOk({ ok: true })]);
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const seen: Seen = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body };
      requests.push(seen);
      const [status, payload] = handler(seen);
      if (status === 0) return; // never answers
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    handle: (fn) => void (handler = fn),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
