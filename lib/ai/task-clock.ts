// The page's clock, sent with every task-assist request (SPEC §4.9, AI2):
// today, now and the viewer's time zone, so "tomorrow" and "friday" resolve
// the way the page's own parser resolves them. A separate module because the
// route helper validates with zod v3 and the AI task schemas use zod/v4.
import { z } from "zod";
import { isIsoDate, isTimeZone } from "../tasks/dates";

export const taskClockBody = z
  .object({
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isIsoDate, "not a calendar date"),
    now: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    tz: z.string().max(64).refine(isTimeZone, "unknown time zone"),
  })
  .strict();
export type TaskClock = z.infer<typeof taskClockBody>;
