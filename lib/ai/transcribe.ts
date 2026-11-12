// Ramble's transcription endpoint (item 13): `POST <base>/audio/transcriptions`
// with the recording and the model, OpenAI-compatible. It defaults to the
// OpenAI-compatible chat endpoint; Claude Code users set one separately, since
// that CLI has no audio input. Called from the server process only.
import { redactSecrets } from "../redact";
import { transcribeKey, aiKey } from "./key";
import { checkBaseUrl } from "./url";
import type { AiFailure, AiSettings } from "./types";

/** OpenAI's limit for one transcription upload. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const short = (s: string) => redactSecrets(s.replace(/\s+/g, " ").trim()).slice(0, 300);

/** Where Ramble records: its own endpoint, else the OpenAI-compatible chat endpoint. */
export function transcribeBaseUrl(settings: AiSettings): string | null {
  if (settings.transcribeBaseUrl) return settings.transcribeBaseUrl;
  return settings.provider === "openai" ? settings.baseUrl : null;
}

/** The transcription key: its own, else the chat endpoint's when both point at the same host. */
export function transcribeKeyFor(settings: AiSettings): string | null {
  const own = transcribeKey();
  if (own) return own;
  return settings.provider === "openai" && transcribeBaseUrl(settings) === settings.baseUrl ? aiKey() : null;
}

export type Transcription = { ok: true; text: string } | ({ ok: false } & AiFailure);

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

/** One recording transcribed to text. Never follows a redirect (it could carry the key elsewhere). */
export async function transcribe(o: {
  settings: AiSettings;
  audio: ArrayBuffer;
  mime: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<Transcription> {
  if (o.audio.byteLength === 0) return { ok: false, code: "failed", message: "The recording is empty." };
  if (o.audio.byteLength > MAX_AUDIO_BYTES) return { ok: false, code: "failed", message: "The recording is too long for the transcription endpoint (25 MB)." };
  const raw = transcribeBaseUrl(o.settings);
  if (!raw) return { ok: false, code: "failed", message: "No transcription endpoint is set. Set one in Settings → AI." };
  const base = checkBaseUrl(raw);
  if (!base.ok) return { ok: false, code: "bad-url", message: base.error };

  const form = new FormData();
  form.append("file", new Blob([o.audio], { type: o.mime }), "ramble.webm");
  form.append("model", o.settings.transcribeModel);
  const key = transcribeKeyFor(o.settings);
  const timeout = AbortSignal.timeout(o.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base.url}/audio/transcriptions`, {
      method: "POST",
      headers: key ? { authorization: `Bearer ${key}` } : undefined,
      body: form,
      redirect: "error",
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
    });
  } catch (e) {
    if (o.signal?.aborted) return { ok: false, code: "cancelled", message: "Cancelled." };
    if (timeout.aborted) return { ok: false, code: "timeout", message: `The transcription endpoint did not answer within ${Math.round(o.timeoutMs / 1000)} seconds.` };
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e);
    return { ok: false, code: "unreachable", message: `Could not reach the transcription endpoint (${short(cause)}).` };
  }
  const body = (await res.text()).slice(0, 4 * 1024 * 1024);
  if (res.status === 401 || res.status === 403) return { ok: false, code: "unauthorized", message: "The transcription endpoint refused the API key (or none was set)." };
  if (res.status === 404 || (/model/i.test(body) && /not found|does not exist|unknown|not supported|invalid/i.test(body))) {
    return { ok: false, code: "unknown-model", message: `The transcription endpoint does not know this model${body ? ` (${short(errorText(body))})` : ""}.` };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, code: "failed", message: `The transcription endpoint answered ${res.status}${body ? `: ${short(errorText(body))}` : ""}.` };
  try {
    const json = JSON.parse(body) as { text?: unknown };
    if (typeof json.text === "string") return { ok: true, text: json.text.trim() };
  } catch {
    /* plain text below */
  }
  const text = body.trim();
  if (!text) return { ok: false, code: "invalid-output", message: "The transcription endpoint returned no text." };
  return { ok: true, text };
}
