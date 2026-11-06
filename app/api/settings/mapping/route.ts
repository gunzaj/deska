import { mappingSchema } from "@/lib/server/mapping-schema";
import { remap } from "@/lib/server/project-setup";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** Settings → remap the fields already known (§4.1). Stored by field ID. */
export const POST = route({ auth: "viewer", body: mappingSchema, invalid: "invalid mapping" }, async ({ body }) => remap(body));
