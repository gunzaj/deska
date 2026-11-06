"use client";

// The first import's progress (SPEC D5): what is being read, how far it got,
// and, when it stopped, why (SPEC §3.3 words) with a way on. It never shows a
// partial issue list; the app opens when the import is complete. Quitting
// part-way is fine: the next launch continues from here.
import { useCallback, useEffect, useRef, useState } from "react";
import { MESSAGES, type ConnectionStatus } from "@/lib/github/token-states";
import { IMPORT_COPY, IMPORT_STEPS, importView, type ImportStepState } from "@/lib/import-view";
import type { ImportPhase } from "@/lib/sync/import-state";
import { Logo } from "../icons";
import { fetchConnection } from "../app/connection";

type Status = {
  needsInitialImport: boolean;
  running: boolean;
  import: { phase: ImportPhase | null; resumed: boolean; issues: number; items: number; itemsTotal: number | null };
  failure: "invalid" | "offline" | "rate-limited" | "forbidden" | "other" | null;
  lastError: string | null;
  rateLimitedUntil: string | null;
};

const POLL_MS = 1_000;

/** The dot for one step: done, in progress (animated only on a fresh start), or still to do. */
function dotClass(step: ImportStepState, failed: boolean): string {
  if (step === "done") return "bg-brand";
  if (step === "active") return failed ? "bg-warning" : "animate-pulse bg-brand-border";
  if (step === "active-idle") return failed ? "bg-warning" : "bg-brand-border";
  return "bg-faint";
}

export function ImportProgress() {
  const [status, setStatus] = useState<Status | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const kicked = useRef(false);

  const start = useCallback(async () => {
    setRetrying(true);
    try {
      await fetch("/api/sync-now", { method: "POST" });
    } catch {
      /* the status below says what happened */
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/sync-status", { cache: "no-store" });
        if (res.status === 401) return window.location.assign("/onboarding");
        if (!res.ok) return;
        const s = (await res.json()) as Status;
        if (stop) return;
        if (!s.needsInitialImport) return window.location.assign("/issues");
        setStatus(s);
        // Nothing running and nothing failed (the run that should have started was skipped): start it.
        if (!kicked.current && !s.running && !s.failure) {
          kicked.current = true;
          void start();
        }
      } catch {
        /* the local server is restarting; try again */
      }
    };
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [start]);

  // A refused permission is named by the connection check (§3.3).
  const failure = status?.failure ?? null;
  useEffect(() => {
    if (failure === "forbidden" || failure === "other") void fetchConnection(true).then(setConnection);
  }, [failure]);

  const p = status?.import;
  // Everything the screen shows is derived here (lib/import-view.ts), so the
  // Electron-only screen has a gate that does not need Electron.
  const view = status
    ? importView({
        needsInitialImport: status.needsInitialImport,
        running: status.running,
        phase: p!.phase,
        resumed: p!.resumed,
        issues: p!.issues,
        items: p!.items,
        itemsTotal: p!.itemsTotal,
        failure: status.failure,
      })
    : null;

  return (
    <main className="min-h-dvh overflow-auto p-6">
      <div className="mx-auto w-full max-w-xl rounded-xl border border-line bg-surface p-8 shadow-modal">
        <Logo size={36} />
        <p className="mt-5 text-[12px] font-medium uppercase tracking-wide text-faint">First import</p>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">Importing from GitHub</h1>
        <p className="mt-1.5 text-[13.5px] text-muted">
          Deska copies the repository&apos;s issues and the project&apos;s items to this Mac once. After that it only fetches what changed. You can quit at any
          time: the import continues where it stopped.
        </p>

        <ol className="mt-6 space-y-2 text-[13px]" data-import-steps>
          {IMPORT_STEPS.map((phase, i) => {
            const step = view?.steps[i] ?? "todo";
            return (
              <li key={phase} data-step={phase} data-state={step} className="flex items-center gap-2">
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${dotClass(step, view?.state === "failed")}`} />
                <span className={step === "todo" ? "text-muted" : ""}>{IMPORT_COPY.steps[phase]}</span>
                <span className="sr-only">{step === "done" ? " (done)" : step === "todo" ? "" : " (in progress)"}</span>
              </li>
            );
          })}
        </ol>

        <p role="status" aria-live="polite" className="mt-5 text-[13px]" data-import-progress>
          {!view || view.progress === "none" ? (
            // Before the first status arrives, and until anything is copied.
            IMPORT_COPY.starting
          ) : view.state === "resumed" ? (
            // A resume that has not re-read its first page has no number to show; it
            // still says it is continuing rather than starting.
            <span data-import-resumed>{p!.issues > 0 ? IMPORT_COPY.resumed(p!.issues) : IMPORT_COPY.resumedNoCount}</span>
          ) : (
            <>
              <strong className="font-semibold" data-import-issues>
                {p!.issues.toLocaleString()} {p!.issues === 1 ? "issue" : "issues"}
              </strong>{" "}
              imported
              {view.progress === "items" ? (
                <>
                  {" · "}
                  <span data-import-items>
                    {p!.items.toLocaleString()}
                    {p!.itemsTotal != null ? ` of ${p!.itemsTotal.toLocaleString()}` : ""} project items
                  </span>
                </>
              ) : null}
            </>
          )}
        </p>
        {/* Gated on the derived progress, not on `phase`: the phase survives a failure
            (the checkpoint is cleared only on success), so a bar would sit at its last
            percentage under the alert, looking like it is still moving. The alert
            carries the words instead. */}
        {view?.progress === "items" && view.state !== "failed" && p?.itemsTotal ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover">
            <div className="h-full bg-brand" style={{ width: `${Math.min(100, Math.round((p.items / p.itemsTotal) * 100))}%` }} />
          </div>
        ) : null}

        {/* Gated on the derived state, not on `failure`: that field survives a retry
            (lib/sync/service.ts clears it only on success), so a live Retry button
            would sit on an import that is already running. */}
        {view?.state === "failed" && (
          <ImportProblem failure={failure!} status={status!} connection={connection} retrying={retrying} onRetry={() => void start()} />
        )}
      </div>
    </main>
  );
}

function ImportProblem({
  failure,
  status,
  connection,
  retrying,
  onRetry,
}: {
  failure: NonNullable<Status["failure"]>;
  status: Status;
  connection: ConnectionStatus | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  const named = connection && connection.state !== "ok" && connection.state !== "preview" ? connection.message : null;
  const message =
    failure === "invalid"
      ? MESSAGES.invalid
      : failure === "offline"
        ? MESSAGES.offline
        : failure === "rate-limited"
          ? status.rateLimitedUntil
            ? MESSAGES.rateLimited(new Date(status.rateLimitedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
            : "GitHub is rate limiting Deska"
          : (named ?? IMPORT_COPY.failed);
  const hint =
    failure === "invalid"
      ? "Create a new token on GitHub and replace it. The import continues where it stopped."
      : failure === "offline"
        ? "Nothing is lost: Deska tries again in a minute and continues where it stopped."
        : failure === "rate-limited"
          ? "The import continues when GitHub allows it."
          : named
            ? "Fix it on GitHub, then try again. The import continues where it stopped."
            : status.lastError;
  return (
    <div role="alert" data-import-failure={failure} className="mt-5 rounded-md border border-line bg-warning-soft p-3 text-[12.5px]">
      <p className="font-semibold">{message}</p>
      {hint ? <p className="mt-0.5 text-muted">{hint}</p> : null}
      <div className="mt-2 flex gap-2">
        {failure === "invalid" ? (
          <a href="/onboarding" className="inline-flex h-8 items-center rounded-md bg-brand px-3 font-semibold text-brand-on hover:bg-brand-hover">
            Replace token
          </a>
        ) : (
          <button type="button" disabled={retrying} onClick={onRetry} className="inline-flex h-8 items-center rounded-md border border-line px-3 font-medium hover:bg-hover disabled:opacity-60">
            {retrying ? "Trying…" : "Try again"}
          </button>
        )}
      </div>
    </div>
  );
}
