import { aiStatus } from "@/lib/ai/status";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * Whether AI may run, and why not (SPEC §4.9): "off" or "not tested". Checked
 * before a suggestion is asked for, so nothing is sent to a model when it can't run.
 */
export const GET = route({ auth: "public" }, async () => aiStatus());
