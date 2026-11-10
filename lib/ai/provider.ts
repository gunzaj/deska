// One question to the active provider (SPEC §4.9), whichever it is. Knows the
// `json_schema` → `json_object` fallback and remembers it per endpoint.
import { readEndpointModes, saveEndpointModes } from "../settings";
import { callClaude, type ModelAnswer } from "./claude";
import { aiKey } from "./key";
import { callOpenAi } from "./openai";
import type { BuiltPrompt } from "./prompt";
import type { AiSettings } from "./types";

export type Ask = {
  /** Builds the prompt; `schemaInPrompt` is set for an endpoint that only does `json_object`. */
  prompt: (o: { schemaInPrompt: boolean }) => BuiltPrompt;
  schemaName: string;
  /** JSON Schema of the answer. */
  schema: Record<string, unknown>;
  signal?: AbortSignal;
};

export async function askModel(settings: AiSettings, ask: Ask): Promise<ModelAnswer> {
  const timeoutMs = settings.timeoutSec * 1000;
  if (settings.provider === "claude-code") {
    const p = ask.prompt({ schemaInPrompt: false });
    return callClaude({ model: settings.model, system: p.system, user: p.user, schema: ask.schema, timeoutMs, signal: ask.signal });
  }
  if (settings.provider === "openai") {
    const modes = await readEndpointModes();
    let mode: "json_schema" | "json_object" = modes[settings.baseUrl] ?? "json_schema";
    for (;;) {
      const p = ask.prompt({ schemaInPrompt: mode === "json_object" });
      const res = await callOpenAi({ baseUrl: settings.baseUrl, key: aiKey(), model: settings.model, system: p.system, user: p.user, schemaName: ask.schemaName, schema: ask.schema, mode, timeoutMs, signal: ask.signal });
      if (res.ok) return { ok: true, output: res.output, costUsd: null };
      if (res.schemaRefused && mode === "json_schema") {
        // This endpoint does not do json_schema: ask once more for json_object, and remember that.
        mode = "json_object";
        await saveEndpointModes({ ...modes, [settings.baseUrl]: "json_object" });
        continue;
      }
      return { ok: false, code: res.code, message: res.message };
    }
  }
  return { ok: false, code: "off", message: "AI assist is off. Choose a provider in Settings → AI." };
}
