import { HttpError, route } from "@/lib/server/route";
import { MAX_AUDIO_BYTES, transcribe } from "@/lib/ai/transcribe";
import { readAiSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Ramble's recording becomes text (item 13). The audio goes only to the
 * transcription endpoint the user set; nothing is stored on disk.
 */
export const POST = route({ auth: "viewer" }, async ({ req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "A recording is required.");
  if (file.size > MAX_AUDIO_BYTES) throw new HttpError(413, "That recording is longer than 25 MB.");
  const settings = await readAiSettings();
  const r = await transcribe({
    settings,
    audio: await file.arrayBuffer(),
    mime: file.type || "audio/webm",
    timeoutMs: Math.min(settings.timeoutSec, 120) * 1000,
  });
  if (!r.ok) throw new HttpError(r.code === "timeout" ? 504 : r.code === "cancelled" ? 499 : 502, r.message);
  if (!r.text) throw new HttpError(422, "No speech was recognized. Try again, or type the tasks.");
  return { text: r.text };
});
