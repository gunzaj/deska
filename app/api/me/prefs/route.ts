import { route } from "@/lib/server/route";
import { prefsSchema } from "@/lib/tasks/model";
import { getPrefs, setPrefs } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Per-user settings: time zone and browser notifications (§12.5, §12.6).
export const GET = route({ auth: "viewer" }, ({ owner }) => getPrefs(owner));

export const PATCH = route({ auth: "viewer", body: prefsSchema, invalid: "invalid task" }, ({ owner, body }) => setPrefs(owner, body));
