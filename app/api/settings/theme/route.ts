import { z } from "zod";
import { route } from "@/lib/server/route";
import { readTheme, saveTheme } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * The colour theme (ADR-001). Public like the mode switch: onboarding has the
 * theme control before there is a local user. The desktop guard and the origin
 * check still apply. Local setting only.
 */
export const GET = route({ auth: "public" }, async () => ({ theme: await readTheme() }));

export const POST = route({ auth: "public", body: z.object({ theme: z.enum(["system", "light", "dark"]) }).strict(), invalid: "invalid theme" }, async ({ body }) => {
  await saveTheme(body.theme);
  return { theme: body.theme };
});
