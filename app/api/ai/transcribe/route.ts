import { HttpError, route } from "@/lib/server/route";
import { MAX_AUDIO_BYTES, transcribe, usesChatEndpoint } from "@/lib/ai/transcribe";
import { verifyId } from "@/lib/ai/types";
import { readAiSettings, readAiVerified } from "@/lib/settings";

/** Room for the multipart boundaries and field headers around the recording. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

export const dynamic = "force-dynamic";

/**
 * Ramble's recording becomes text (item 13). The audio goes only to the
 * transcription endpoint the user set; nothing is stored on disk.
 */
export const POST = route({ auth: "viewer" }, async ({ req }) => {
  // Refused from its declared size, before the upload is read into memory.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + FORM_OVERHEAD_BYTES) throw new HttpError(413, "That recording is longer than 25 MB.");
  const settings = await readAiSettings();
  // With no transcription endpoint of its own, the recording goes to the chat
  // endpoint: only once that one passed "Test connection" (§4.9), like every
  // other AI call to it.
  if (usesChatEndpoint(settings) && (await readAiVerified()) !== verifyId(settings)) {
    throw new HttpError(409, "Run \"Test connection\" in Settings → AI, or set a transcription endpoint, before recording.");
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "A recording is required.");
  if (file.size > MAX_AUDIO_BYTES) throw new HttpError(413, "That recording is longer than 25 MB.");
  const r = await transcribe({
    settings,
    audio: await file.arrayBuffer(),
    mime: file.type || "audio/webm",
    timeoutMs: Math.min(settings.timeoutSec, 120) * 1000,
    // Cancel in the Ramble dialog aborts the request: the upload stops with it.
    signal: req.signal,
  });
  if (!r.ok) throw new HttpError(r.code === "timeout" ? 504 : r.code === "cancelled" ? 499 : 502, r.message);
  if (!r.text) throw new HttpError(422, "No speech was recognized. Try again, or type the tasks.");
  return { text: r.text };
});
