// AI assist settings and error codes (SPEC §4.9). Pure: no I/O, so the page,
// the server and the tests share one definition. Nothing secret lives here:
// the API key is held apart (lib/ai/key.ts, SPEC §2.3).
import { z } from "zod";
import { checkBaseUrl } from "./url";

export const AI_PROVIDERS = ["off", "claude-code", "openai"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** How Ramble gets a recording transcribed: an OpenAI-compatible upload, or a local dictation app's server. */
export const TRANSCRIBE_APIS = ["openai", "local"] as const;
export type TranscribeApi = (typeof TRANSCRIBE_APIS)[number];

/** The local dictation app's server on this machine, when the user has not typed another. */
export const DEFAULT_LOCAL_TRANSCRIBE_URL = "http://127.0.0.1:8787";

export const CLAUDE_MODELS = ["sonnet", "opus", "haiku"] as const;
export const DEFAULT_CLAUDE_MODEL = "sonnet";

/** `--effort` levels the Claude Code CLI takes. Empty = the CLI's own default. */
export const AI_EFFORTS = ["", "low", "medium", "high", "xhigh", "max"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

export const MIN_TIMEOUT_SEC = 10;
export const MAX_TIMEOUT_SEC = 600;
export const MAX_EXTRA_INSTRUCTIONS = 4000;

export type AiSettings = {
  provider: AiProvider;
  /** Claude Code: `sonnet`, `opus`, `haiku` or a typed model. OpenAI-compatible: the model name. */
  model: string;
  /** Claude Code only: `--effort` level, `""` = the CLI's default. Never sent to an endpoint. */
  effort: AiEffort;
  /** OpenAI-compatible only, without a trailing slash. */
  baseUrl: string;
  /** Ramble's transcription source: an OpenAI-compatible endpoint or a local dictation app. */
  transcribeApi: TranscribeApi;
  /** The OpenAI-compatible transcription endpoint (item 13), without a trailing slash. Empty = the chat endpoint. */
  transcribeBaseUrl: string;
  /** The transcription model; `whisper-1` when unset. */
  transcribeModel: string;
  /** The local dictation app's server, without a trailing slash. Empty = the app's usual local port. */
  transcribeLocalUrl: string;
  timeoutSec: number;
  /** Added to every prompt (team conventions, what labels mean). */
  extraInstructions: string;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "off",
  model: DEFAULT_CLAUDE_MODEL,
  effort: "",
  baseUrl: "",
  transcribeApi: "openai",
  transcribeBaseUrl: "",
  transcribeModel: "whisper-1",
  transcribeLocalUrl: "",
  timeoutSec: 120,
  extraInstructions: "",
};

/** A model name is one word: letters, digits and `. _ : / -` (covers `llama3.1:8b`, `org/model`, `claude-sonnet-5-5`). */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

/** The stored settings: every field checked, anything wrong replaced by its default. */
export function parseAiSettings(raw: unknown): AiSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_AI_SETTINGS;
  const provider = (AI_PROVIDERS as readonly unknown[]).includes(o.provider) ? (o.provider as AiProvider) : d.provider;
  const model = typeof o.model === "string" && MODEL.test(o.model) ? o.model : d.model;
  const effort = (AI_EFFORTS as readonly unknown[]).includes(o.effort) ? (o.effort as AiEffort) : d.effort;
  const base = typeof o.baseUrl === "string" ? checkBaseUrl(o.baseUrl) : null;
  const transcribeApi = (TRANSCRIBE_APIS as readonly unknown[]).includes(o.transcribeApi) ? (o.transcribeApi as TranscribeApi) : d.transcribeApi;
  const transcribeBase = typeof o.transcribeBaseUrl === "string" ? checkBaseUrl(o.transcribeBaseUrl) : null;
  const transcribeModel = typeof o.transcribeModel === "string" && MODEL.test(o.transcribeModel) ? o.transcribeModel : d.transcribeModel;
  const transcribeLocal = typeof o.transcribeLocalUrl === "string" ? checkBaseUrl(o.transcribeLocalUrl) : null;
  const timeout = typeof o.timeoutSec === "number" && Number.isFinite(o.timeoutSec) ? Math.round(o.timeoutSec) : d.timeoutSec;
  return {
    provider,
    model,
    effort,
    baseUrl: base?.ok ? base.url : d.baseUrl,
    transcribeApi,
    transcribeBaseUrl: transcribeBase?.ok ? transcribeBase.url : d.transcribeBaseUrl,
    transcribeModel,
    transcribeLocalUrl: transcribeLocal?.ok ? transcribeLocal.url : d.transcribeLocalUrl,
    timeoutSec: Math.min(MAX_TIMEOUT_SEC, Math.max(MIN_TIMEOUT_SEC, timeout)),
    extraInstructions: typeof o.extraInstructions === "string" ? o.extraInstructions.slice(0, MAX_EXTRA_INSTRUCTIONS) : d.extraInstructions,
  };
}

/** What Settings may send. Strict: an unknown field is a mistake, not something to keep. */
export const aiSettingsBody = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().regex(MODEL, "That is not a model name."),
    effort: z.enum(AI_EFFORTS),
    baseUrl: z.string().trim().max(500),
    transcribeApi: z.enum(TRANSCRIBE_APIS),
    transcribeBaseUrl: z.string().trim().max(500),
    transcribeModel: z.string().trim().regex(MODEL, "That is not a model name."),
    transcribeLocalUrl: z.string().trim().max(500),
    timeoutSec: z.number().int().min(MIN_TIMEOUT_SEC).max(MAX_TIMEOUT_SEC),
    extraInstructions: z.string().max(MAX_EXTRA_INSTRUCTIONS),
  })
  .strict();

/** Why an AI call failed. Each has its own message in Settings. */
export type AiErrorCode =
  | "off" // no provider chosen
  | "not-verified" // the provider has not passed "Test connection" yet
  | "cli-missing" // no `claude` on the login-shell PATH
  | "cli-flag-missing" // the installed CLI lacks a flag Deska needs
  | "not-logged-in" // `claude` is not signed in
  | "bad-url" // the base URL is refused
  | "unreachable" // the endpoint did not answer
  | "unauthorized" // 401 / 403
  | "unknown-model" // the endpoint does not know the model
  | "timeout"
  | "cancelled"
  | "invalid-output" // the model's answer failed the schema twice
  | "failed"; // anything else

export type AiFailure = { code: AiErrorCode; message: string };

/** The result of "Test connection". */
export type TestResult = { ok: true; message: string; models?: string[] } | ({ ok: false } & AiFailure);

/** Identifies what "Test connection" passed for: a different provider, model or URL has to pass again. */
export function verifyId(s: Pick<AiSettings, "provider" | "model" | "baseUrl">): string {
  return `${s.provider}|${s.model}|${s.provider === "openai" ? s.baseUrl : ""}`;
}
