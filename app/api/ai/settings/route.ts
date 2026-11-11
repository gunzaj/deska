import { aiKey } from "@/lib/ai/key";
import { claudeCapabilities } from "@/lib/ai/claude";
import { AI_DESTINATIONS, AI_FEATURES, AI_NEVER_SENT } from "@/lib/ai/features";
import { aiSettingsBody, verifyId } from "@/lib/ai/types";
import { checkBaseUrl } from "@/lib/ai/url";
import { HttpError, route } from "@/lib/server/route";
import { readAiSettings, readAiVerified, saveAiSettings, saveAiVerified } from "@/lib/settings";

export const dynamic = "force-dynamic";

async function view() {
  const settings = await readAiSettings();
  return {
    settings,
    // Whether the API key is set: never the key (SPEC §2.3).
    hasKey: aiKey() !== null,
    // "Test connection" passed for exactly these settings; nothing leaves the Mac before.
    verified: settings.provider !== "off" && (await readAiVerified()) === verifyId(settings),
    // What the installed Claude Code CLI offers (item 5): `effort` hides the
    // effort picker on a CLI without `--effort`. Re-read on every Settings load
    // so an update is noticed without a relaunch.
    claude: await claudeCapabilities({ refresh: true }),
    features: AI_FEATURES,
    neverSent: AI_NEVER_SENT,
    destinations: AI_DESTINATIONS,
  };
}

/**
 * Settings → AI (SPEC §4.9). Public like the other settings routes: tasks-only
 * users have no GitHub user. The desktop guard and the origin check still apply.
 * Local setting only; changing the provider, model or URL clears the "tested" mark.
 */
export const GET = route({ auth: "public" }, view);

export const POST = route({ auth: "public", body: aiSettingsBody, invalid: "Those AI settings are not valid." }, async ({ body }) => {
  let baseUrl = "";
  if (body.provider === "openai") {
    const checked = checkBaseUrl(body.baseUrl);
    if (!checked.ok) throw new HttpError(400, checked.error);
    baseUrl = checked.url;
  }
  const next = { ...body, baseUrl };
  const before = await readAiSettings();
  await saveAiSettings(next);
  if (verifyId(before) !== verifyId(next)) await saveAiVerified(null);
  return view();
});
