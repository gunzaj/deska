// The prompt "Test connection" sends: no user data at all.
import { z } from "zod/v4";
import type { AiTask } from "../prompt";

export const testTask: AiTask = {
  feature: "test",
  subjectKind: "test",
  subject: "connection",
  subjectVersion: "1",
  instructions: "This is a connection test. Answer with ok set to true.",
  data: [],
  schema: z.object({ ok: z.boolean() }),
  schemaName: "connection_test",
};
