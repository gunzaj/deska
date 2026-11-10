"use client";

// Settings → AI (SPEC §4.9): provider, model, endpoint, API key, timeout, extra
// instructions, what each feature sends, and Test connection. Off by default;
// nothing leaves the Mac until the chosen provider passes the test.
import { useCallback, useEffect, useState } from "react";
import type { AiKeyStatus } from "../../desktop/bridge";
import { AI_PROVIDERS, CLAUDE_MODELS, DEFAULT_AI_SETTINGS, DEFAULT_CLAUDE_MODEL, MAX_EXTRA_INSTRUCTIONS, MAX_TIMEOUT_SEC, MIN_TIMEOUT_SEC, type AiProvider, type AiSettings, type TestResult } from "@/lib/ai/types";

type View = {
  settings: AiSettings;
  hasKey: boolean;
  verified: boolean;
  features: { id: string; name: string; sends: string; milestone: string }[];
  neverSent: string;
  destinations: Record<"claude-code" | "openai", string>;
};

const PROVIDER_LABEL: Record<AiProvider, string> = { off: "Off", "claude-code": "Claude Code (your own Claude login)", openai: "OpenAI-compatible endpoint" };
const field = "h-9 min-w-0 rounded-md border border-line bg-field px-2.5 text-[12.5px] outline-none hover:border-line-field focus:border-focus";
const button = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 font-medium hover:bg-hover disabled:opacity-60";

async function call(url: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: body === undefined && !url.endsWith("/test") ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof out.error === "string" ? out.error : `Request failed (${res.status})`);
  return out;
}

export function AiSettingsSection() {
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
  // The key is entered through the desktop shell's bridge, never over HTTP (SPEC §2.3).
  const bridge = typeof window === "undefined" ? undefined : window.deska?.aiKey;

  const load = useCallback(async () => {
    try {
      const v = (await call("/api/ai/settings")) as unknown as View;
      setView(v);
      setDraft(v.settings);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
    setKeyStatus((await bridge?.status().catch(() => null)) ?? null);
  }, [bridge]);
  useEffect(() => void load(), [load]);

  const dirty = !!view && JSON.stringify(view.settings) !== JSON.stringify(draft);

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ kind: "ok", text });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const save = async () => {
    const v = (await call("/api/ai/settings", draft)) as unknown as View;
    setView(v);
    setDraft(v.settings);
    return v;
  };

  function pickProvider(provider: AiProvider) {
    // Each provider has its own kind of model name.
    setDraft((d) => ({ ...d, provider, model: provider === "claude-code" ? DEFAULT_CLAUDE_MODEL : provider === "openai" ? "" : d.model }));
    setModels([]);
  }

  async function test() {
    await run(async () => {
      if (dirty) await save();
      const r = (await call("/api/ai/test")) as unknown as TestResult;
      if (r.ok && r.models) setModels(r.models);
      await load();
      if (!r.ok) throw new Error(r.message);
      return r.message;
    });
  }

  async function keyAction(action: "set" | "clear") {
    if (!bridge) return;
    await run(async () => {
      setKeyStatus(action === "set" ? await bridge.set(keyInput) : await bridge.clear());
      setKeyInput("");
      await load();
      return action === "set" ? "Key saved in the keychain. Run Test connection." : "Key removed.";
    });
  }

  const provider = draft.provider;
  return (
    <section id="ai" aria-labelledby="ai-settings" className="space-y-5 border-t border-line pt-6">
      <h2 id="ai-settings" className="text-[15px] font-semibold">
        AI assist
      </h2>
      <p className="text-[12.5px] text-muted">
        Optional help with triage and tasks. It only suggests; you decide. It is off until you choose a provider and it passes Test connection, and it runs only when you ask.
      </p>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-[12.5px] font-medium ${message.kind === "error" ? "text-critical" : ""}`} data-ai-message>
          {message.text}
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="ai-provider" className="block text-[12.5px] font-medium">
          Provider
        </label>
        <select id="ai-provider" value={provider} disabled={!view} onChange={(e) => pickProvider(e.target.value as AiProvider)} className={`${field} w-full max-w-sm`}>
          {AI_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
        </select>
        {provider !== "off" && view && <p className="text-[11.5px] text-faint">{view.destinations[provider]}</p>}
        {provider === "claude-code" && <p className="text-[11.5px] text-faint">Needs the Claude Code CLI (claude) installed and signed in; the Claude desktop app alone is not enough. Deska stores no Anthropic key.</p>}
      </div>

      {provider !== "off" && (
        <>
          {provider === "openai" && (
            <div className="space-y-1.5">
              <label htmlFor="ai-base-url" className="block text-[12.5px] font-medium">
                Base URL
              </label>
              <input id="ai-base-url" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="http://localhost:11434/v1" spellCheck={false} autoCapitalize="off" className={`${field} w-full font-mono`} />
              <p className="text-[11.5px] text-faint">https for any host; plain http only for this machine and your own network.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="ai-model" className="block text-[12.5px] font-medium">
              Model
            </label>
            <input
              id="ai-model"
              list="ai-model-options"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value.trim() })}
              spellCheck={false}
              autoCapitalize="off"
              placeholder={provider === "openai" ? "model name" : DEFAULT_CLAUDE_MODEL}
              className={`${field} w-full max-w-sm font-mono`}
            />
            <datalist id="ai-model-options">
              {(provider === "claude-code" ? [...CLAUDE_MODELS] : models).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {provider === "openai" && models.length > 0 && <p className="text-[11.5px] text-faint">{models.length} models listed by the endpoint. You can also type one.</p>}
          </div>

          {provider === "openai" && (
            <div className="space-y-1.5" data-ai-key>
              <label htmlFor="ai-key" className="block text-[12.5px] font-medium">
                API key (optional)
              </label>
              {bridge ? (
                <>
                  <div className="flex max-w-md gap-2">
                    <input id="ai-key" type="password" autoComplete="off" spellCheck={false} autoCapitalize="off" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder={keyStatus?.stored ? "A key is saved" : "none"} className={`${field} flex-1 font-mono`} />
                    <button type="button" disabled={busy || !keyInput.trim()} onClick={() => void keyAction("set")} className={button}>
                      Save key
                    </button>
                    {keyStatus?.stored && (
                      <button type="button" disabled={busy} onClick={() => void keyAction("clear")} className={button}>
                        Remove key
                      </button>
                    )}
                  </div>
                  <p className="text-[11.5px] text-faint">Stored encrypted with your macOS keychain. It goes only to this endpoint.</p>
                </>
              ) : (
                <p className="text-[12.5px] text-muted">API keys can be entered in the desktop app only.</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="ai-timeout" className="block text-[12.5px] font-medium">
              Timeout (seconds)
            </label>
            <input id="ai-timeout" type="number" min={MIN_TIMEOUT_SEC} max={MAX_TIMEOUT_SEC} value={draft.timeoutSec} onChange={(e) => setDraft({ ...draft, timeoutSec: Number(e.target.value) })} className={`${field} w-28`} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ai-extra" className="block text-[12.5px] font-medium">
              Extra instructions
            </label>
            <textarea
              id="ai-extra"
              value={draft.extraInstructions}
              maxLength={MAX_EXTRA_INSTRUCTIONS}
              onChange={(e) => setDraft({ ...draft, extraInstructions: e.target.value })}
              rows={3}
              placeholder="Team conventions, what your labels mean…"
              className="w-full rounded-md border border-line bg-field p-2.5 text-[12.5px] outline-none hover:border-line-field focus:border-focus"
            />
            <p className="text-[11.5px] text-faint">Added to every prompt.</p>
          </div>

        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !dirty} onClick={() => void run(async () => (await save(), provider === "off" ? "Saved. AI assist is off." : "Saved. Run Test connection."))} className={button}>
          Save
        </button>
        {provider !== "off" && (
          <>
            <button type="button" disabled={busy} onClick={() => void test()} className={button} data-ai-test>
              {busy ? "Working…" : "Test connection"}
            </button>
            <span className="text-[12.5px] text-muted" data-ai-verified>
              {view?.verified && !dirty ? "Tested. AI assist is on." : "Not tested. Nothing is sent until the test passes."}
            </span>
          </>
        )}
      </div>

      {view && (
        <div className="space-y-2" data-ai-sends>
          <h3 className="text-[13px] font-semibold">What is sent, per feature</h3>
          <ul className="space-y-1.5 text-[12.5px] text-muted">
            {view.features.map((f) => (
              <li key={f.id}>
                <strong className="text-fg">{f.name}:</strong> {f.sends}
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] text-muted">Never sent: {view.neverSent}</p>
          <p className="text-[11.5px] text-faint">The model gets no tools, no files and no network from Deska. Its answers are shown as text; nothing is applied without you accepting it.</p>
        </div>
      )}
    </section>
  );
}
