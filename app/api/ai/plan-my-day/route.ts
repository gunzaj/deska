import { taskClockBody } from "@/lib/ai/task-clock";
import { latestPlan, startPlanMyDay } from "@/lib/ai/plan-my-day-service";
import { HttpError, route, storeUnavailable } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * Today's plan and what a new one would be built from (SPEC §4.9, AI3). Reads
 * the task store, the issue cache, snoozes and `ai_results` only: nothing is sent
 * to a model here. A dismissed plan is not shown again, and a changed candidate
 * marks the stored plan outdated.
 */
export const GET = route({ auth: "viewer", query: taskClockBody.pick({ today: true }), invalid: "invalid day" }, async ({ viewer, query }) => {
  return latestPlan(viewer, { today: query.today, now: "00:00", tz: "UTC" }).catch((e: unknown) => {
    throw storeUnavailable("/api/ai/plan-my-day", e);
  });
});

/**
 * Asks the model for today's plan (SPEC §4.9, AI3): one job, run only when the
 * user asks. The candidate tasks and the user's issues in the current sprint go;
 * nothing changes until the user accepts an item.
 */
export const POST = route({ auth: "viewer", body: taskClockBody, invalid: "That day is not valid." }, async ({ viewer, body }) => {
  const job = await startPlanMyDay(viewer, body).catch((e: unknown) => {
    throw storeUnavailable("/api/ai/plan-my-day", e);
  });
  if (!job) throw new HttpError(400, "There is nothing to plan today.");
  return { job };
});
