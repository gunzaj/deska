"use client";

// Settings → Local data (SPEC D8, §4.7): backups, export / import, and the two
// resets. Everything here is about data on this Mac that GitHub does not have
// (tasks, views, snoozes, watches, settings); none of it carries the token.
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";

type Backup = { name: string; createdAt: string; reason: string; bytes: number };
type Status = { database: { ok: boolean; error: string | null }; backups: { enabled: boolean; items: Backup[] } };
type Step = null | "cache" | "all-1" | "all-2";

const button = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 font-medium hover:bg-hover disabled:opacity-60";
const danger = "inline-flex h-8 items-center gap-1.5 rounded-md bg-critical px-3 font-semibold text-brand-on disabled:opacity-60";
const plain = "inline-flex h-8 items-center rounded-md px-3 font-medium hover:bg-hover";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

async function post(url: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof out.error === "string" ? out.error : `Request failed (${res.status})`);
  return out;
}

export function LocalDataSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [step, setStep] = useState<Step>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/local-data/status");
      setStatus((await res.json()) as Status);
    } catch {
      setStatus(null);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function run(fn: () => Promise<string | void>, after?: () => void) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ kind: "ok", text });
      setStep(null);
      await load();
      after?.();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    await run(async () => {
      let doc: unknown;
      try {
        doc = JSON.parse(await file.text());
      } catch {
        throw new Error("This file is not valid JSON.");
      }
      const out = (await post("/api/local-data/import", doc)) as { added?: number };
      return `Imported ${out.added ?? 0} new ${out.added === 1 ? "row" : "rows"}. Rows that already exist were kept as they are.`;
    });
  }

  const backups = status?.backups;
  const newest = backups?.items[0];
  return (
    <section id="local-data" aria-labelledby="local-data-settings" className="space-y-5 border-t border-line pt-6">
      <h2 id="local-data-settings" className="text-[15px] font-semibold">
        Local data
      </h2>
      <p className="text-[12.5px] text-muted">Tasks, views, snoozes, watches and settings live on this Mac only. Backups and exports never contain your GitHub token or the cached GitHub data.</p>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-[12.5px] font-medium ${message.kind === "error" ? "text-critical" : ""}`}>
          {message.text}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-[13px] font-semibold">Backups</h3>
        {!backups ? (
          <p className="text-muted">Loading…</p>
        ) : !backups.enabled ? (
          <p className="text-[12.5px] text-muted">Automatic backups run in the desktop app.</p>
        ) : (
          <>
            <p className="text-[12.5px] text-muted" data-last-backup>
              {newest ? `Last backup ${when(newest.createdAt)} · ${backups.items.length} kept (the newest 14).` : "No backup yet. One is taken daily and before every update of the database."}
            </p>
            <button type="button" disabled={busy} onClick={() => void run(async () => (await post("/api/local-data/backup"), "Backup saved."))} className={button}>
              <Icon name="save" size={13} />
              Back up now
            </button>
          </>
        )}
      </div>

      <div className="space-y-2 border-t border-line pt-5">
        <h3 className="text-[13px] font-semibold">Export and import</h3>
        <p className="text-[12.5px] text-muted">Import merges by ID: rows that already exist stay as they are, and the GitHub cache is never touched.</p>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/local-data/export" download className={button}>
            <Icon name="save" size={13} />
            Export
          </a>
          <label className={`${button} cursor-pointer`}>
            <Icon name="plus" size={13} />
            Import…
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importFile(f);
              }}
            />
          </label>
        </div>
      </div>

      <div className="space-y-2 border-t border-line pt-5">
        <h3 className="text-[13px] font-semibold">Reset GitHub cache</h3>
        <p className="text-[12.5px] text-muted">Deletes the issues and project data copied from GitHub and imports them again. Your tasks, views and settings stay.</p>
        {step === "cache" ? (
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void run(async () => (await post("/api/local-data/reset-cache"), "Cache reset. Importing from GitHub again…"), () => window.location.assign("/importing"))} className={danger}>
              <Icon name="refresh" size={13} />
              Reset cache
            </button>
            <button type="button" onClick={() => setStep(null)} className={plain}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => setStep("cache")} className={button}>
            <Icon name="refresh" size={13} />
            Reset GitHub cache…
          </button>
        )}
      </div>

      <div className="space-y-2 border-t border-line pt-5">
        <h3 className="text-[13px] font-semibold">Reset everything</h3>
        <p className="text-[12.5px] text-muted">Deletes all local data and the cache and starts onboarding again. A backup is taken first. The GitHub token stays until you disconnect it.</p>
        {step === "all-1" ? (
          <div className="space-y-2" role="group" aria-label="Confirm reset">
            <p className="text-[12.5px] font-medium">This deletes every task, project, label, saved view, snooze and watch on this Mac.</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setStep("all-2")} className={danger}>
                Continue
              </button>
              <button type="button" onClick={() => setStep(null)} className={plain}>
                Cancel
              </button>
            </div>
          </div>
        ) : step === "all-2" ? (
          <div className="space-y-2" role="group" aria-label="Confirm reset again">
            <p className="text-[12.5px] font-medium">Last chance. Reset everything now?</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(async () => (await post("/api/local-data/reset-all", { confirm: "reset-everything" }), "Everything was reset."), () => window.location.assign("/onboarding"))}
                className={danger}
              >
                <Icon name="trash" size={13} />
                Yes, reset everything
              </button>
              <button type="button" onClick={() => setStep(null)} className={plain}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => setStep("all-1")} className={button}>
            <Icon name="trash" size={13} />
            Reset everything…
          </button>
        )}
      </div>
    </section>
  );
}
