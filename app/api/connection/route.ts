import { z } from "zod";
import { connectionStatus } from "@/lib/connection";
import { redactDeep } from "@/lib/redact";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * The GitHub connection as SPEC §3.3 tells it apart: state, its message, the
 * token owner, expiry and detected permissions. Never the token. Public: the
 * onboarding page asks before there is a local user (in the desktop app the
 * middleware has checked the launch secret). `?refresh=1` asks GitHub again.
 */
export const GET = route({ auth: "public", query: z.object({ refresh: z.string().optional() }) }, async ({ query }) =>
  // Every string already comes redacted from the check; this is the backstop.
  redactDeep(await connectionStatus({ refresh: query.refresh === "1" })),
);
