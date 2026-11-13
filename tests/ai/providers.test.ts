// SPEC §4.9: the two providers against test doubles. The `claude` child's
// arguments, environment and folder; the endpoint's request shape and its
// failure modes; the base-URL rule. Nothing real is called.
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkClaudeCli, callClaude, claudeArgs, claudeCapabilities, claudeEnv } from "@/lib/ai/claude";
import { callOpenAi, listModels } from "@/lib/ai/openai";
import { checkBaseUrl, isLocalNetworkHost } from "@/lib/ai/url";
import { DEFAULT_AI_SETTINGS, parseAiSettings } from "@/lib/ai/types";
import { claudeError, claudeOk, chatOk, fakeClaude, mockEndpoint, type FakeClaude, type MockEndpoint } from "./helpers";

const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

describe("AI settings (§4.9)", () => {
  it("keeps a known effort and drops an unknown one", () => {
    expect(parseAiSettings({ ...DEFAULT_AI_SETTINGS, effort: "xhigh" }).effort).toBe("xhigh");
    expect(parseAiSettings({ ...DEFAULT_AI_SETTINGS, effort: "turbo" }).effort).toBe("");
    expect(parseAiSettings({ ...DEFAULT_AI_SETTINGS, effort: 3 }).effort).toBe("");
    expect(parseAiSettings({ ...DEFAULT_AI_SETTINGS, transcribeApi: "local" }).transcribeApi).toBe("local");
    expect(parseAiSettings({ ...DEFAULT_AI_SETTINGS, transcribeApi: "nope" }).transcribeApi).toBe("openai");
    expect(parseAiSettings(undefined)).toEqual(DEFAULT_AI_SETTINGS);
  });
});

describe("base URL (§4.9)", () => {
  it("allows https anywhere and plain http only on this machine or the user's network", () => {
    expect(checkBaseUrl("https://models.example.test/v1/")).toEqual({ ok: true, url: "https://models.example.test/v1" });
    for (const ok of ["http://localhost:11434/v1", "http://127.0.0.1:8080/v1", "http://[::1]:8080/v1", "http://10.1.2.3/v1", "http://172.16.0.9/v1", "http://172.31.255.1/v1", "http://192.168.1.20:1234/v1", "http://studio.local:1234/v1"]) {
      expect(checkBaseUrl(ok).ok, ok).toBe(true);
    }
    for (const bad of ["http://models.example.test/v1", "http://8.8.8.8/v1", "http://172.32.0.1/v1", "http://192.169.0.1/v1", "http://10.0.0.1.example.test/v1", "http://localhost.example.test/v1", "ftp://localhost/v1", "not a url", ""]) {
      expect(checkBaseUrl(bad).ok, bad).toBe(false);
    }
  });

  it("refuses credentials in the URL and drops the query and fragment", () => {
    expect(checkBaseUrl("https://user:pass@localhost/v1").ok).toBe(false);
    expect(checkBaseUrl("https://models.example.test/v1?key=abc#x")).toEqual({ ok: true, url: "https://models.example.test/v1" });
    expect(isLocalNetworkHost("LOCALHOST")).toBe(true);
  });
});

describe("Claude Code provider", () => {
  let fake: FakeClaude;
  beforeEach(() => {
    fake = fakeClaude();
    process.env.DESKA_LOGIN_PATH = fake.path;
  });
  afterEach(() => {
    delete process.env.DESKA_LOGIN_PATH;
    fake.cleanup();
  });

  it("keeps a character whose bytes arrive in two chunks", async () => {
    // The CLI's answer in two writes, cut in the middle of a 3-byte character.
    const text = JSON.stringify(claudeOk({ ok: true, note: "Příliš žluťoučký kůň ✓" }));
    const bytes = Buffer.from(text, "utf8");
    const cut = bytes.indexOf(Buffer.from("✓", "utf8")) + 1;
    const { chmodSync, writeFileSync } = await import("node:fs");
    const file = `${fake.dir}/claude`;
    writeFileSync(
      file,
      `#!${process.execPath}
const out = Buffer.from(${JSON.stringify(bytes.toString("base64"))}, "base64");
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(out.subarray(0, ${cut}), () => setTimeout(() => process.stdout.write(out.subarray(${cut}), () => process.exit(0)), 150));
});
`,
    );
    chmodSync(file, 0o755);
    const res = await callClaude({ model: "sonnet", system: "s", user: "u", schema: SCHEMA, timeoutMs: 10_000 });
    expect(res).toMatchObject({ ok: true, output: { ok: true, note: "Příliš žluťoučký kůň ✓" } });
  });

  it("calls `claude -p` with the SPEC arguments, the prompt on stdin, and returns structured_output and cost", async () => {
    fake.reply({ ...claudeOk({ ok: true }, 0.037), duration_ms: 4_200, duration_api_ms: 3_100 });
    const res = await callClaude({ model: "sonnet", system: "SYSTEM TEXT", user: "USER TEXT", schema: SCHEMA, timeoutMs: 10_000 });
    expect(res).toEqual({ ok: true, output: { ok: true }, costUsd: 0.037, timings: { durationMs: 4_200, apiMs: 3_100 } });
    const [run] = fake.runs();
    expect(run!.args).toEqual(claudeArgs({ schema: SCHEMA, system: "SYSTEM TEXT", model: "sonnet" }));
    expect(run!.args).toEqual(["-p", "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA), "--system-prompt", "SYSTEM TEXT", "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--model", "sonnet"]);
    expect(run!.stdin).toBe("USER TEXT");
  });

  it("passes --effort only when one is set and this CLI has the flag", async () => {
    fake.reply(claudeOk({ ok: true }));
    expect(claudeArgs({ schema: SCHEMA, system: "s", model: "opus", effort: "high" })).toEqual([
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(SCHEMA),
      "--system-prompt",
      "s",
      "--tools",
      "",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--no-session-persistence",
      "--model",
      "opus",
      "--effort",
      "high",
    ]);
    expect(claudeArgs({ schema: SCHEMA, system: "s", model: "opus" })).not.toContain("--effort");

    expect(await claudeCapabilities()).toEqual({ found: true, effort: true });
    await callClaude({ model: "sonnet", effort: "high", system: "s", user: "u", schema: SCHEMA, timeoutMs: 10_000 });
    expect(fake.runs().at(-1)!.args.slice(-2)).toEqual(["--effort", "high"]);

    // An older CLI without --effort still passes Test connection; the stored
    // effort is left out of the call instead of failing on an unknown option.
    fake.withoutFlag("--effort");
    expect(await checkClaudeCli()).toMatchObject({ ok: true });
    expect(await claudeCapabilities()).toEqual({ found: true, effort: false });
    await callClaude({ model: "sonnet", effort: "high", system: "s", user: "u", schema: SCHEMA, timeoutMs: 10_000 });
    expect(fake.runs().at(-1)!.args).not.toContain("--effort");
  });

  it("runs in an empty temp folder that is removed afterwards", async () => {
    await callClaude({ model: "sonnet", system: "s", user: "u", schema: SCHEMA, timeoutMs: 10_000 });
    const cwd = fake.runs()[0]!.cwd;
    expect(cwd).toMatch(/deska-ai-/);
    expect(existsSync(cwd)).toBe(false);
  });

  it("gives the child no GitHub token and nothing of Deska's, in arguments or environment", async () => {
    const before = { ...process.env };
    Object.assign(process.env, { GITHUB_TOKEN: "ghp_fake_in_env", GH_TOKEN: "gho_fake_in_env", GH_ENTERPRISE_TOKEN: "x", DESKA_LAUNCH_SECRET: "launch-secret-value", DESKA_HOST: "127.0.0.1:1", ELECTRON_RUN_AS_NODE: "1", ANTHROPIC_API_KEY: "kept-for-claude" });
    try {
      await callClaude({ model: "sonnet", system: "s", user: "u", schema: SCHEMA, timeoutMs: 10_000 });
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
      Object.assign(process.env, before);
    }
    const run = fake.runs()[0]!;
    const names = Object.keys(run.env);
    expect(names.filter((n) => /^(DESKA_|GITHUB_|GH_|ELECTRON_)/.test(n))).toEqual([]);
    expect(JSON.stringify(run)).not.toMatch(/fake_in_env|launch-secret-value/);
    // The user's own Claude settings still reach it, and PATH is the login-shell one.
    expect(run.env.ANTHROPIC_API_KEY).toBe("kept-for-claude");
    expect(run.env.PATH).toBe(fake.path);
    expect(claudeEnv({ GITHUB_TOKEN: "a", GH_HOST: "b", DESKA_X: "c", HOME: "/h", PORT: "1", NODE_ENV: "production" }, "/p")).toEqual({ HOME: "/h", PATH: "/p" });
  });

  it("tells apart: CLI missing, a required flag missing, not logged in, OK", async () => {
    process.env.DESKA_LOGIN_PATH = "/nonexistent-deska-dir";
    expect(await checkClaudeCli()).toMatchObject({ ok: false, code: "cli-missing" });
    expect(await callClaude({ model: "sonnet", system: "s", user: "u", schema: SCHEMA, timeoutMs: 5_000 })).toMatchObject({ ok: false, code: "cli-missing" });

    process.env.DESKA_LOGIN_PATH = fake.path;
    fake.withoutFlag("--json-schema");
    const flag = await checkClaudeCli();
    expect(flag).toMatchObject({ ok: false, code: "cli-flag-missing" });
    expect((flag as { message: string }).message).toContain("--json-schema");

    fake.cleanup();
    fake = fakeClaude();
    process.env.DESKA_LOGIN_PATH = fake.path;
    fake.reply(claudeError("Not logged in · Please run /login"));
    expect(await callClaude({ model: "sonnet", system: "s", user: "u", schema: SCHEMA, timeoutMs: 5_000 })).toMatchObject({ ok: false, code: "not-logged-in" });
    fake.reply(claudeOk({ ok: true }));
    expect(await checkClaudeCli()).toMatchObject({ ok: true });
    expect(await callClaude({ model: "sonnet", system: "s", user: "u", schema: SCHEMA, timeoutMs: 5_000 })).toMatchObject({ ok: true });
  });

  it("times out, cancels, and reports unreadable output", async () => {
    fake.slow(5_000);
    expect(await callClaude({ model: "sonnet", system: "s", user: "u", schema: SCHEMA, timeoutMs: 300 })).toMatchObject({ ok: false, code: "timeout" });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 200);
    expect(await callClaude({ model: "sonnet", system: "s", user: "u", schema: SCHEMA, timeoutMs: 10_000, signal: ctrl.signal })).toMatchObject({ ok: false, code: "cancelled" });
    fake.slow(0);
    fake.reply("this is not json");
    expect(await callClaude({ model: "sonnet", system: "s", user: "u", schema: SCHEMA, timeoutMs: 5_000 })).toMatchObject({ ok: false });
    fake.reply({ type: "result", is_error: false, result: "text only" });
    expect(await callClaude({ model: "sonnet", system: "s", user: "u", schema: SCHEMA, timeoutMs: 5_000 })).toMatchObject({ ok: false, code: "invalid-output" });
  });
});

describe("OpenAI-compatible provider", () => {
  let ep: MockEndpoint;
  beforeEach(async () => void (ep = await mockEndpoint(["zeta", "alpha"])));
  afterEach(() => ep.close());
  const ask = (over: Partial<Parameters<typeof callOpenAi>[0]> = {}) => callOpenAi({ baseUrl: ep.url, key: null, model: "tiny-model", system: "SYS", user: "USR", schemaName: "my schema!", schema: SCHEMA, mode: "json_schema", timeoutMs: 5_000, ...over });

  it("posts chat/completions with a strict json_schema response format and the key as a bearer token", async () => {
    ep.handle(() => [200, chatOk({ ok: true })]);
    expect(await ask({ key: "test-key-123456" })).toEqual({ ok: true, output: { ok: true } });
    const req = ep.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v1/chat/completions");
    expect(req.headers.authorization).toBe("Bearer test-key-123456");
    expect(JSON.parse(req.body)).toEqual({
      model: "tiny-model",
      messages: [
        { role: "system", content: "SYS" },
        { role: "user", content: "USR" },
      ],
      response_format: { type: "json_schema", json_schema: { name: "my_schema_", strict: true, schema: SCHEMA } },
    });
  });

  it("sends no Authorization header without a key, and asks for json_object when told to", async () => {
    await ask({ mode: "json_object" });
    expect(ep.requests[0]!.headers.authorization).toBeUndefined();
    expect(JSON.parse(ep.requests[0]!.body).response_format).toEqual({ type: "json_object" });
  });

  it("lists models from GET /models, sorted; a missing /models is an empty list, not an error", async () => {
    expect(await listModels(ep.url, null, 5_000)).toEqual({ ok: true, models: ["alpha", "zeta"] });
    ep.handle(() => [404, { error: { message: "not found" } }]);
    expect(await listModels(ep.url, null, 5_000)).toEqual({ ok: true, models: [] });
  });

  it("tells apart unreachable, 401, unknown model and a refused response format", async () => {
    const dead = await mockEndpoint();
    const deadUrl = dead.url;
    await dead.close();
    expect(await ask({ baseUrl: deadUrl })).toMatchObject({ ok: false, code: "unreachable" });
    expect(await listModels(deadUrl, null, 5_000)).toMatchObject({ ok: false, code: "unreachable" });

    ep.handle(() => [401, { error: { message: "Incorrect API key provided" } }]);
    expect(await ask()).toMatchObject({ ok: false, code: "unauthorized" });
    expect(await listModels(ep.url, null, 5_000)).toMatchObject({ ok: false, code: "unauthorized" });

    ep.handle(() => [404, { error: { message: "The model `nope` does not exist" } }]);
    expect(await ask({ model: "nope" })).toMatchObject({ ok: false, code: "unknown-model" });

    ep.handle(() => [400, { error: { message: "response_format.type json_schema is not supported" } }]);
    expect(await ask()).toMatchObject({ ok: false, schemaRefused: true });
  });

  it("refuses plain http to a public address and never follows a redirect", async () => {
    expect(await ask({ baseUrl: "http://models.example.test/v1" })).toMatchObject({ ok: false, code: "bad-url" });
    expect(await listModels("http://8.8.8.8/v1", null, 1_000)).toMatchObject({ ok: false, code: "bad-url" });
    ep.handle(() => [302, {}]);
    expect(await ask({ key: "test-key-123456" })).toMatchObject({ ok: false, code: "unreachable" });
  });

  it("strips a code fence and reports non-JSON answers as invalid output", async () => {
    ep.handle(() => [200, chatOk('```json\n{"ok": true}\n```')]);
    expect(await ask()).toEqual({ ok: true, output: { ok: true } });
    ep.handle(() => [200, chatOk("sure, here you go")]);
    expect(await ask()).toMatchObject({ ok: false, code: "invalid-output" });
  });

  it("times out", async () => {
    ep.handle(() => [0, {}]);
    expect(await ask({ timeoutMs: 200 })).toMatchObject({ ok: false, code: "timeout" });
  });
});
