// Whether AI may run, and why not (SPEC §4.9): "off" or "not tested".
// Shared by the status route and every feature, so nothing is sent to a model
// before the user turned AI on and "Test connection" passed.
import { aiNotReady } from "./runner";

export type AiStatus = { ready: boolean; reason: string | null };

export async function aiStatus(): Promise<AiStatus> {
  const { failure } = await aiNotReady();
  return { ready: !failure, reason: failure?.message ?? null };
}
