import { z } from "zod";
import { startRamble } from "@/lib/ai/ramble-service";
import { MAX_TRANSCRIPT } from "@/lib/ai/ramble";
import { taskClockBody } from "@/lib/ai/task-clock";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** Turns one transcript into task suggestions (item 13); nothing is created here. */
export const POST = route(
  {
    auth: "viewer",
    body: z.object({ transcript: z.string().trim().min(1).max(MAX_TRANSCRIPT), clock: taskClockBody }).strict(),
    invalid: "That transcript is not valid.",
  },
  async ({ body }) => ({ job: await startRamble(body.transcript, body.clock) }),
);
