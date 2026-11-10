// The OpenAI-compatible provider (SPEC §4.9): `POST <base>/chat/completions`
// with a JSON Schema response format, and `GET <base>/models` for the model
// list. Called from the server process only. The API key is optional.
import { redactSecrets } from "../redact";
import { checkBaseUrl } from "./url";
import type { AiFailure } from "./types";

export type ResponseMode = "json_schema" | "json_object";

const short = (s: string) => redactSecrets(s.replace(/\s+/g, " ").trim()).slice(0, 300);

function headers(key: string | null): Record<string, string> {
  return { "content-type": "application/json", accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
}

type Fetched = { ok: true; status: number; text: string } | ({ ok: false } & AiFailure);

/** One request. Never follows a redirect (a redirect could carry the key to another host). */
async function request(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Fetched> {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, { ...init, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    return { ok: true, status: res.status, text: (await res.text()).slice(0, 4 * 1024 * 1024) };
  } catch (e) {
    if (signal?.aborted) return { ok: false, code: "cancelled", message: "Cancelled." };
    if (timeout.aborted) return { ok: false, code: "timeout", message: `The endpoint did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e);
    return { ok: false, code: "unreachable", message: `Could not reach the endpoint (${short(cause)}). Check the URL and that the server is running.` };
  }
}

function errorText(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const m = typeof j.error === "string" ? j.error : j.error?.message ?? j.message;
    if (typeof m === "string") return m;
  } catch {
    /* not JSON */
  }
  return body;
}

/** A refused status → the failure Settings shows. `schema` is set when the endpoint refused the response format. */
function failure(status: number, body: string): (AiFailure & { schema?: boolean }) {
  const text = errorText(body);
  if (status === 401 || status === 403) return { code: "unauthorized", message: "The endpoint refused the API key (or none was set)." };
  if (/response_format|json_schema|json_object|structured/i.test(text) && (status === 400 || status === 422)) return { code: "failed", message: `The endpoint does not support this response format: ${short(text)}`, schema: true };
  if (status === 404 || (/model/i.test(text) && /not found|does not exist|unknown|not supported|invalid/i.test(text))) return { code: "unknown-model", message: `The endpoint does not know this model${text ? ` (${short(text)})` : ""}.` };
  return { code: "failed", message: `The endpoint answered ${status}${text ? `: ${short(text)}` : ""}.` };
}

export type ModelsResult = { ok: true; models: string[] } | ({ ok: false } & AiFailure);

/** `GET <base>/models`. */
export async function listModels(baseUrl: string, key: string | null, timeoutMs: number, signal?: AbortSignal): Promise<ModelsResult> {
  const base = checkBaseUrl(baseUrl);
  if (!base.ok) return { ok: false, code: "bad-url", message: base.error };
  const res = await request(`${base.url}/models`, { method: "GET", headers: headers(key) }, timeoutMs, signal);
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    const f = failure(res.status, res.text);
    // Many servers have no /models: not an error by itself, the model can be typed.
    return f.code === "unknown-model" ? { ok: true, models: [] } : { ok: false, code: f.code, message: f.message };
  }
  try {
    const j = JSON.parse(res.text) as { data?: { id?: unknown }[] };
    const models = (Array.isArray(j.data) ? j.data : []).map((m) => m.id).filter((id): id is string => typeof id === "string");
    return { ok: true, models: [...new Set(models)].sort() };
  } catch {
    return { ok: true, models: [] };
  }
}

export type ChatAnswer = { ok: true; output: unknown } | ({ ok: false; schemaRefused?: boolean } & AiFailure);

/** One chat completion asking for JSON that matches `schema`; `output` is the parsed content. */
export async function callOpenAi(o: {
  baseUrl: string;
  key: string | null;
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: unknown;
  mode: ResponseMode;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ChatAnswer> {
  const base = checkBaseUrl(o.baseUrl);
  if (!base.ok) return { ok: false, code: "bad-url", message: base.error };
  const name = o.schemaName.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "answer";
  const body = {
    model: o.model,
    messages: [
      { role: "system", content: o.system },
      { role: "user", content: o.user || "(no data)" },
    ],
    response_format: o.mode === "json_schema" ? { type: "json_schema", json_schema: { name, strict: true, schema: o.schema } } : { type: "json_object" },
  };
  const res = await request(`${base.url}/chat/completions`, { method: "POST", headers: headers(o.key), body: JSON.stringify(body) }, o.timeoutMs, o.signal);
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    const f = failure(res.status, res.text);
    return { ok: false, code: f.code, message: f.message, schemaRefused: f.schema };
  }
  let content: unknown;
  try {
    content = (JSON.parse(res.text) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  } catch {
    return { ok: false, code: "invalid-output", message: "The endpoint's answer was not JSON." };
  }
  if (typeof content !== "string") return { ok: false, code: "invalid-output", message: "The endpoint returned no message content." };
  // Some models wrap JSON in a code fence.
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return { ok: true, output: JSON.parse(text) };
  } catch {
    return { ok: false, code: "invalid-output", message: "The model's answer was not valid JSON." };
  }
}
