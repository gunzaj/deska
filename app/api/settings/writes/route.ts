import { z } from "zod";
import { connectionStatus } from "@/lib/connection";
import { localToken } from "@/lib/github/local-token";
import { HttpError, route } from "@/lib/server/route";
import { setWritesOn, writeGate, WRITE_MESSAGES } from "@/lib/writes/gate";

export const dynamic = "force-dynamic";

/**
 * Settings → "GitHub writes" (SPEC §3.4, part 2). Off by default and after
 * every token change. Turning it on checks the token's write permissions first
 * (read-only queries, never a write attempt): a token GitHub would refuse can
 * never turn the switch on.
 */
export const GET = route({ auth: "viewer" }, async () => ({ writes: await writeGate() }));

export const POST = route(
  { auth: "viewer", body: z.object({ on: z.boolean() }).strict(), invalid: "invalid write switch" },
  async ({ body }) => {
    if (!body.on) return { writes: await setWritesOn(false) };
    const gate = await writeGate();
    if (!gate.buildAllows) throw new HttpError(403, WRITE_MESSAGES.buildOff);
    if (!localToken()) throw new HttpError(401, WRITE_MESSAGES.notConnected);
    // Ask GitHub now: the gate must not turn on for a token that can't write.
    const status = await connectionStatus({ refresh: true });
    if (status.state !== "ok") throw new HttpError(409, status.message ?? WRITE_MESSAGES.notChecked);
    if (status.writeAccess !== "yes") throw new HttpError(409, WRITE_MESSAGES.cannotTurnOn(status.writeAccessMessage ?? WRITE_MESSAGES.readOnly));
    return { writes: await setWritesOn(true) };
  },
);
