// POST /api/ai/transcribe (Ramble): an oversized upload is refused from its
// declared size, before it is read, and a recording never goes to a chat
// endpoint that has not passed "Test connection" (SPEC §4.9).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-e2e-login": "alice" }) }));

const { getDb } = await import("@/db");
const { POST } = await import("@/app/api/ai/transcribe/route");
const { MAX_AUDIO_BYTES } = await import("@/lib/ai/transcribe");
const { DEFAULT_AI_SETTINGS, verifyId } = await import("@/lib/ai/types");
const { resetSettingsCache, saveAiSettings, saveAiVerified } = await import("@/lib/settings");

const CHAT = { ...DEFAULT_AI_SETTINGS, provider: "openai" as const, baseUrl: "http://127.0.0.1:9/v1", model: "tiny-model" };

function upload(bytes: number, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "ramble.webm", { type: "audio/webm" }));
  return new NextRequest("http://127.0.0.1:3000/api/ai/transcribe", { method: "POST", body: form, headers });
}

beforeEach(async () => {
  process.env.E2E_AUTH_BYPASS = "1";
  process.env.E2E_BYPASS_ACK = "i-understand";
  resetSettingsCache();
  await getDb().execute(sql`TRUNCATE app_settings`);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/ai/transcribe", () => {
  it("refuses an upload declared larger than 25 MB without reading it", async () => {
    await saveAiSettings(CHAT);
    await saveAiVerified(verifyId(CHAT));
    const req = upload(16, { "content-length": String(MAX_AUDIO_BYTES + 1024 * 1024) });
    const read = vi.spyOn(req, "formData");
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(read).not.toHaveBeenCalled();
  });

  it("sends nothing to a chat endpoint that has not passed Test connection", async () => {
    await saveAiSettings(CHAT);
    await saveAiVerified(null);
    const sent = vi.spyOn(globalThis, "fetch");
    const res = await POST(upload(16));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Test connection/);
    expect(sent).not.toHaveBeenCalled();
  });

  it("a transcription endpoint of its own needs no tested chat provider", async () => {
    await saveAiSettings({ ...CHAT, transcribeBaseUrl: "http://127.0.0.1:9/v1" });
    await saveAiVerified(null);
    const sent = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ text: "buy milk" }), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await POST(upload(16));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "buy milk" });
    // The request's own signal travels with the upload, so Cancel aborts it.
    expect((sent.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});
