import { z } from "zod";
import { parseSaved } from "@/lib/client/tabs";
import { route } from "@/lib/server/route";
import { saveTabs } from "@/lib/settings";

export const dynamic = "force-dynamic";

const body = z
  .object({
    tabs: z.array(z.object({ entries: z.array(z.string().max(2000)).max(50), index: z.number().int() }).strict()).max(30),
    active: z.number().int(),
  })
  .strict();

/**
 * The open in-app tabs, restored on the next launch (ADR-001: `localStorage`
 * is emptied on every launch). Local setting only; anything that is not an
 * in-app URL is dropped.
 */
export const POST = route({ auth: "viewer", body, invalid: "invalid tabs" }, async ({ body }) => {
  const saved = parseSaved(body);
  await saveTabs(saved);
  return { ok: true };
});
