import { z } from "zod";
import { checkLocalServer } from "@/lib/ai/transcribe";
import { DEFAULT_LOCAL_TRANSCRIBE_URL } from "@/lib/ai/types";
import { HttpError, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** "Check server" in Settings → AI: the local dictation app's health endpoint, not a transcription. */
export const POST = route(
  {
    auth: "public",
    body: z.object({ baseUrl: z.string().trim().max(500) }).strict(),
    invalid: "That server URL is not valid.",
  },
  async ({ body }) => {
    const r = await checkLocalServer(body.baseUrl || DEFAULT_LOCAL_TRANSCRIBE_URL);
    if (!r.ok) throw new HttpError(r.code === "timeout" ? 504 : 502, r.message);
    return { ok: true, version: r.version };
  },
);
