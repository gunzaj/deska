// "Test connection" (SPEC §4.9): tells apart CLI missing, a required flag
// missing, not signed in, and OK for Claude Code; endpoint unreachable, key
// refused, unknown model and OK for an endpoint. Sends no user data.
import { checkClaudeCli } from "./claude";
import { listModels } from "./openai";
import { aiKey } from "./key";
import { askModel } from "./provider";
import { buildPrompt, jsonSchemaOf } from "./prompt";
import { testTask } from "./prompts/test";
import { checkBaseUrl } from "./url";
import type { AiSettings, TestResult } from "./types";

export async function testConnection(settings: AiSettings): Promise<TestResult> {
  if (settings.provider === "off") return { ok: false, code: "off", message: "Choose a provider first." };
  let models: string[] | undefined;
  if (settings.provider === "claude-code") {
    const cli = await checkClaudeCli();
    if (!cli.ok) return cli;
  } else {
    const base = checkBaseUrl(settings.baseUrl);
    if (!base.ok) return { ok: false, code: "bad-url", message: base.error };
    const list = await listModels(base.url, aiKey(), Math.min(settings.timeoutSec, 30) * 1000);
    if (!list.ok) return list;
    models = list.models;
  }
  const answer = await askModel(settings, {
    prompt: (o) => buildPrompt(testTask, "", { schemaInPrompt: o.schemaInPrompt }),
    schemaName: testTask.schemaName,
    schema: jsonSchemaOf(testTask),
  });
  if (!answer.ok) return { ok: false, code: answer.code, message: answer.message };
  return {
    ok: true,
    models,
    message: settings.provider === "claude-code" ? "Claude Code is installed and signed in." : `Connected. The endpoint answered for ${settings.model}.`,
  };
}
