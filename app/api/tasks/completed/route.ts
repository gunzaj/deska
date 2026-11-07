import { route } from "@/lib/server/route";
import { listCompleted } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// The Completed view (SPEC §4.6, D13): the last 30 days of completions.
export const GET = route({ auth: "viewer" }, ({ owner }) => listCompleted(owner));
