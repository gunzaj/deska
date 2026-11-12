// Ramble's transcription endpoint (item 13). Two sources:
// - an OpenAI-compatible `POST <base>/audio/transcriptions` upload, or
// - a local dictation app's `POST <base>/v1/transcribe` with the raw recording,
//   so the model already downloaded for that app does the work on this machine.
// The first defaults to the OpenAI-compatible chat endpoint; Claude Code users set
// one separately, since that CLI has no audio input. Called from the server
// process only.
import { redactSecrets } from "../redact";
import { transcribeKey, aiKey } from "./key";
import { checkBaseUrl } from "./url";
import { DEFAULT_LOCAL_TRANSCRIBE_URL, type AiFailure, type AiSettings } from "./types";

/** OpenAI's limit for one transcription upload. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const short = (s: string) => redactSecrets(s.replace(/\s+/g, " ").trim()).slice(0, 300);

/** Where Ramble records: its own endpoint, else the OpenAI-compatible chat endpoint. */
export function transcribeBaseUrl(settings: AiSettings): string | null {
  if (settings.transcribeApi === "local") return settings.transcribeLocalUrl || DEFAULT_LOCAL_TRANSCRIBE_URL;
  if (settings.transcribeBaseUrl) return settings.transcribeBaseUrl;
  return settings.provider === "openai" ? settings.baseUrl : null;
}

/** The transcription key: its own, else the chat endpoint's when both point at the same host. */
export function transcribeKeyFor(settings: AiSettings): string | null {
  if (settings.transcribeApi === "local") return null;
  const own = transcribeKey();
  if (own) return own;
  return settings.provider === "openai" && transcribeBaseUrl(settings) === settings.baseUrl ? aiKey() : null;
}

/** The local server's transcription endpoint; a base that already ends in `/v1` is not doubled. */
export function localTranscribeUrl(base: string): string {
  const path = new URL(base).pathname.replace(/\/+$/, "");
  return path.endsWith("/v1") ? `${base}/transcribe` : `${base}/v1/transcribe`;
}

/** The local server's health endpoint, on the same rule as the transcription endpoint. */
export function localHealthUrl(base: string): string {
  const path = new URL(base).pathname.replace(/\/+$/, "");
  return path.endsWith("/v1") ? `${base}/health` : `${base}/v1/health`;
}

export type Transcription = { ok: true; text: string } | ({ ok: false } & AiFailure);

export type LocalServerStatus = { ok: true; version: string | null } | ({ ok: false } & AiFailure);

type TranscribeArgs = {
  audio: ArrayBuffer;
  mime: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

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

/** The upload's name: the local dictation server decodes by content, OpenAI by type. */
function audioFileName(mime: string): string {
  const type = mime.toLowerCase();
  if (type.includes("mp4") || type.includes("m4a")) return "ramble.m4a";
  if (type.includes("wav")) return "ramble.wav";
  if (type.includes("ogg")) return "ramble.ogg";
  if (type.includes("mpeg") || type.includes("mp3")) return "ramble.mp3";
  return "ramble.webm";
}

/** One recording transcribed to text. Never follows a redirect (it could carry the key elsewhere). */
export async function transcribe(o: { settings: AiSettings } & TranscribeArgs): Promise<Transcription> {
  if (o.audio.byteLength === 0) return { ok: false, code: "failed", message: "The recording is empty." };
  if (o.audio.byteLength > MAX_AUDIO_BYTES) return { ok: false, code: "failed", message: "The recording is too long for the transcription endpoint (25 MB)." };
  const raw = transcribeBaseUrl(o.settings);
  if (!raw) return { ok: false, code: "failed", message: "No transcription endpoint is set. Set one in Settings → AI." };
  const base = checkBaseUrl(raw);
  if (!base.ok) return { ok: false, code: "bad-url", message: base.error };

  const local = o.settings.transcribeApi === "local";
  const endpoint = local ? localTranscribeUrl(base.url) : `${base.url}/audio/transcriptions`;
  const form = new FormData();
  if (!local) {
    form.append("file", new Blob([o.audio], { type: o.mime }), audioFileName(o.mime));
    form.append("model", o.settings.transcribeModel);
  }
  const key = local ? null : transcribeKeyFor(o.settings);
  const timeout = AbortSignal.timeout(o.timeoutMs);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: local ? { "content-type": o.mime || "application/octet-stream" } : key ? { authorization: `Bearer ${key}` } : undefined,
      body: local ? o.audio : form,
      redirect: "error",
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
    });
  } catch (e) {
    if (o.signal?.aborted) return { ok: false, code: "cancelled", message: "Cancelled." };
    if (timeout.aborted) {
      return { ok: false, code: "timeout", message: `${local ? "The local dictation server" : "The transcription endpoint"} did not answer within ${Math.round(o.timeoutMs / 1000)} seconds.` };
    }
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      code: "unreachable",
      message: local
        ? `Could not reach the local dictation server (${short(cause)}). Start the app and check that its local API is on.`
        : `Could not reach the transcription endpoint (${short(cause)}).`,
    };
  }
  const body = (await res.text()).slice(0, 4 * 1024 * 1024);
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: "unauthorized", message: local ? "The local dictation server refused the request." : "The transcription endpoint refused the API key (or none was set)." };
  }
  if (local) {
    if (res.status === 404) return { ok: false, code: "failed", message: `The local dictation server has no transcription endpoint at ${endpoint}. Check the URL in Settings → AI.` };
    if (res.status < 200 || res.status >= 300) return { ok: false, code: "failed", message: `The local dictation server answered ${res.status}${body ? `: ${short(errorText(body))}` : ""}.` };
    try {
      const json = JSON.parse(body) as { text?: unknown; error?: unknown };
      // The local server reports a recording it cannot decode as an error field,
      // usually with HTTP 200.
      if (typeof json.error === "string") return { ok: false, code: "failed", message: `The local dictation server could not transcribe the recording${json.error ? `: ${short(json.error)}` : "."}` };
      if (typeof json.text === "string") return { ok: true, text: json.text.trim() };
    } catch {
      /* plain text below */
    }
    const text = body.trim();
    if (!text) return { ok: false, code: "invalid-output", message: "The local dictation server returned no text." };
    return { ok: true, text };
  }
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

/** "Check server" for the local dictation app: it is up and its local API is ready. */
export async function checkLocalServer(base: string, timeoutMs = 5_000): Promise<LocalServerStatus> {
  const checked = checkBaseUrl(base);
  if (!checked.ok) return { ok: false, code: "bad-url", message: checked.error };
  const endpoint = localHealthUrl(checked.url);
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetch(endpoint, { redirect: "error", signal: timeout });
  } catch (e) {
    if (timeout.aborted) return { ok: false, code: "timeout", message: `The local dictation server did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e);
    return { ok: false, code: "unreachable", message: `Could not reach the local dictation server (${short(cause)}). Start the app and check that its local API is on.` };
  }
  const body = (await res.text()).slice(0, 64 * 1024);
  if (res.status === 401 || res.status === 403) return { ok: false, code: "unauthorized", message: "The local dictation server refused the request." };
  if (!res.ok) return { ok: false, code: "failed", message: `The local dictation server answered ${res.status}${body ? `: ${short(errorText(body))}` : ""}.` };
  try {
    const json = JSON.parse(body) as { status?: unknown; version?: unknown };
    if (json.status !== "ok") return { ok: false, code: "failed", message: "The local dictation server is not ready." };
    return { ok: true, version: typeof json.version === "string" ? json.version : null };
  } catch {
    return { ok: false, code: "invalid-output", message: "The local dictation server's health check was not valid JSON." };
  }
}
