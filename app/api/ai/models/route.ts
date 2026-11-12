import { aiKey } from "@/lib/ai/key";
import { listModels } from "@/lib/ai/openai";
import { checkBaseUrl } from "@/lib/ai/url";
import { route } from "@/lib/server/route";
import { readAiSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * The models the configured OpenAI-compatible endpoint lists (item 5), so
 * Settings can offer a real list before "Test connection". Always 200: a missing
 * list is not an error (the model can be typed), and `error` says why it is empty.
 * Reads the saved settings, so it sends the API key only to the saved endpoint.
 */
export const GET = route({ auth: "public" }, async () => {
  const settings = await readAiSettings();
  if (settings.provider !== "openai") return { models: [] as string[], error: null };
  const base = checkBaseUrl(settings.baseUrl);
  if (!base.ok) return { models: [] as string[], error: base.error };
  const list = await listModels(base.url, aiKey(), Math.min(settings.timeoutSec, 30) * 1000);
  return list.ok ? { models: list.models, error: null } : { models: [] as string[], error: list.message };
});
