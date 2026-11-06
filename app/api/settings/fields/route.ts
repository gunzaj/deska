import { reloadFields } from "@/lib/server/project-setup";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** Settings → read the project's fields from GitHub again (renames, deleted fields). Read-only on GitHub. */
export const POST = route({ auth: "viewer" }, async () => reloadFields());
