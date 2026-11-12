// Item 13: the transcription endpoint, with fetch stubbed (nothing real is called).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAiKey, setTranscribeKey } from "@/lib/ai/key";
import { transcribe, transcribeBaseUrl, transcribeKeyFor } from "@/lib/ai/transcribe";
import { redactSecrets } from "@/lib/redact";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "@/lib/ai/types";

const KEY = "sk-transcribe-0123456789abcdef";
const settings = (over: Partial<AiSettings> = {}): AiSettings => ({ ...DEFAULT_AI_SETTINGS, provider: "openai", baseUrl: "http://127.0.0.1:11434/v1", ...over });
let seen: { url: string; init: RequestInit }[];

beforeEach(() => {
  seen = [];
  setAiKey(null);
  setTranscribeKey(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAiKey(null);
  setTranscribeKey(null);
});

const stub = (status: number, body: string) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init: init ?? {} });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    }),
  );
};

const audio = () => new TextEncoder().encode("fake audio").buffer;

describe("transcription (item 13)", () => {
  it("posts the recording and the model to <base>/audio/transcriptions", async () => {
    stub(200, JSON.stringify({ text: " Buy milk " }));
    expect(await transcribe({ settings: settings(), audio: audio(), mime: "audio/webm", timeoutMs: 5_000 })).toEqual({ ok: true, text: "Buy milk" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("http://127.0.0.1:11434/v1/audio/transcriptions");
    expect(seen[0]!.init.method).toBe("POST");
    const form = seen[0]!.init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect((form.get("file") as File).size).toBeGreaterThan(0);
    expect(seen[0]!.init.headers).toBeUndefined();
  });

  it("takes its own endpoint and key, and reuses the chat key only on the same host", async () => {
    setAiKey(KEY);
    expect(transcribeKeyFor(settings())).toBe(KEY);
    setTranscribeKey("sk-own-0123456789abcdefgh");
    expect(transcribeKeyFor(settings())).toBe("sk-own-0123456789abcdefgh");
    setTranscribeKey(null);
    expect(transcribeKeyFor(settings({ provider: "claude-code" }))).toBeNull();
    expect(transcribeBaseUrl(settings({ provider: "claude-code" }))).toBeNull();
    expect(transcribeBaseUrl(settings({ provider: "claude-code", transcribeBaseUrl: "http://127.0.0.1:8080/v1" }))).toBe("http://127.0.0.1:8080/v1");

    stub(200, JSON.stringify({ text: "Hello" }));
    expect(await transcribe({ settings: settings({ transcribeBaseUrl: settings().baseUrl }), audio: audio(), mime: "audio/webm", timeoutMs: 5_000 })).toEqual({ ok: true, text: "Hello" });
    expect(seen[0]!.url).toBe("http://127.0.0.1:11434/v1/audio/transcriptions");
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);

    stub(200, JSON.stringify({ text: "Hello" }));
    expect(await transcribe({ settings: settings({ transcribeBaseUrl: "http://127.0.0.1:8080/v1" }), audio: audio(), mime: "audio/webm", timeoutMs: 5_000 })).toEqual({ ok: true, text: "Hello" });
    expect(seen.at(-1)!.url).toBe("http://127.0.0.1:8080/v1/audio/transcriptions");
    expect(seen.at(-1)!.init.headers).toBeUndefined();
  });

  it("redacts its key wherever a string goes", () => {
    setTranscribeKey(KEY);
    expect(redactSecrets(`failed with ${KEY} here`)).toBe("failed with [redacted] here");
  });

  it("accepts a plain-text answer and tells apart a refusal, an unknown model and no endpoint", async () => {
    stub(200, "A plain transcript");
    expect(await transcribe({ settings: settings(), audio: audio(), mime: "audio/webm", timeoutMs: 5_000 })).toEqual({ ok: true, text: "A plain transcript" });

    stub(401, JSON.stringify({ error: { message: "bad key" } }));
    expect(await transcribe({ settings: settings(), audio: audio(), mime: "audio/webm", timeoutMs: 5_000 })).toMatchObject({ ok: false, code: "unauthorized" });
    stub(404, JSON.stringify({ error: { message: "The model `whisper-1` does not exist" } }));
    expect(await transcribe({ settings: settings(), audio: audio(), mime: "audio/webm", timeoutMs: 5_000 })).toMatchObject({ ok: false, code: "unknown-model" });

    setAiKey(null);
    expect(await transcribe({ settings: { ...DEFAULT_AI_SETTINGS, provider: "off" }, audio: audio(), mime: "audio/webm", timeoutMs: 5_000 })).toMatchObject({ ok: false, message: expect.stringContaining("No transcription endpoint") });
    expect(await transcribe({ settings: settings(), audio: new ArrayBuffer(0), mime: "audio/webm", timeoutMs: 5_000 })).toMatchObject({ ok: false, message: expect.stringContaining("empty") });
  });
});
