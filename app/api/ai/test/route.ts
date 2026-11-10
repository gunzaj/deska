import { testConnection } from "@/lib/ai/test-connection";
import { verifyId } from "@/lib/ai/types";
import { route } from "@/lib/server/route";
import { readAiSettings, saveAiVerified } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * "Test connection" for the saved settings (SPEC §4.9). Sends no user data. A pass
 * is what lets AI jobs run, for these provider, model and URL only.
 */
export const POST = route({ auth: "public" }, async () => {
  const settings = await readAiSettings();
  const result = await testConnection(settings);
  await saveAiVerified(result.ok ? verifyId(settings) : null);
  return result;
});
