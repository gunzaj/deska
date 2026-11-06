
import { mappingSchema, targetSchema } from "@/lib/server/mapping-schema";
import { chooseProject, setupState } from "@/lib/server/project-setup";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** The project, its fields and the field mapping as stored (§2.4, §4.1). No GitHub call. */
export const GET = route({ auth: "viewer" }, async () => setupState());

/**
 * Onboarding step 2 / Settings: read the project from GitHub (read-only), pin
 * its node ID, cache its fields and store the target with the mapping.
 */
export const POST = route({ auth: "viewer", body: targetSchema.extend({ mapping: mappingSchema }).strict(), invalid: "invalid project" }, async ({ body }) =>
  chooseProject(body),
);

