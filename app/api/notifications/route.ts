import { route } from "@/lib/server/route";
import { notificationsFor } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Polled every 30 s by the client; also fires the viewer's due reminders (§12.6).
// Firing here is deliberate: it needs no per-minute cron. It is idempotent (the
// dedupe key makes a re-fire a no-op), the route is session-gated, and the
// response is never cached, so a crawler or prefetch cannot fire a notification.
export const GET = route({ auth: "viewer" }, ({ viewer }) => notificationsFor(viewer));
