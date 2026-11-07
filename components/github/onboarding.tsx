"use client";

// Onboarding (SPEC D3, D4). Step 1: paste a fine-grained token, see who it
// belongs to and what it can read. Step 2: the repository and org project,
// and which project field is Status, Priority, Sprint and the dimensions.
import { useEffect, useState } from "react";
import type { ConnectionStatus } from "@/lib/github/token-states";
import type { SetupState } from "@/lib/server/project-setup";
import { Logo } from "../icons";
import { fetchConnection } from "../app/connection";
import { loadSetup, ProjectPicker } from "./mapping";
import { hasBridge, TokenForm, TokenGuide, TokenSummary } from "./token";

/** Step 2: pick the project and map its fields; the app opens once both are stored. */
function ProjectStep({ onBack }: { onBack: () => void }) {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    loadSetup().then(setSetup, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  return (
    <main className="min-h-dvh overflow-auto p-6">
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-line bg-surface p-8 shadow-modal">
        <Logo size={36} />
        <p className="mt-5 text-[12px] font-medium uppercase tracking-wide text-faint">Step 2 of 2 · Project and fields</p>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">Choose your project</h1>
        <p className="mt-1.5 text-[13.5px] text-muted">
          The repository Deska reads issues from, and the project (owned by an organization or by a user) that plans them. Then tell Deska which project field is which: it keeps the
          mapping by field ID, so renaming a field on GitHub changes nothing here.
        </p>
        {error && (
          <p role="alert" className="mt-6 text-[12.5px] font-medium text-critical">
            {error}
          </p>
        )}
        {setup && !setup.canDiscover && (
          <div className="mt-6 space-y-3">
            <p role="status" className="rounded-md border border-line bg-hover p-3 text-[12.5px]">
              Choosing a project needs a connected token, in the Deska desktop app. This preview runs on sample data.
            </p>
            <button type="button" onClick={() => window.location.assign("/issues")} className="inline-flex h-9 items-center rounded-md bg-brand px-4 font-semibold text-brand-on hover:bg-brand-hover">
              Continue
            </button>
          </div>
        )}
        {setup?.canDiscover && setup.target?.source === "settings" && setup.mapping && !changing ? (
          <div className="mt-6 space-y-3 text-[12.5px]">
            <p>
              Reading <strong className="font-semibold">{setup.target.repo}</strong> and “{setup.target.projectTitle}” ({setup.target.org} #{setup.target.projectNumber}).
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => window.location.assign("/issues")} className="inline-flex h-9 items-center rounded-md bg-brand px-4 font-semibold text-brand-on hover:bg-brand-hover">
                Continue
              </button>
              <button type="button" onClick={() => setChanging(true)} className="font-medium text-brand-text hover:underline">
                Choose another project
              </button>
            </div>
          </div>
        ) : setup?.canDiscover ? (
          <div className="mt-6">
            <ProjectPicker initial={setup.target} saveLabel="Save and open Deska" onDone={() => window.location.assign("/issues")} />
          </div>
        ) : null}
        <button type="button" onClick={onBack} className="mt-6 text-[12.5px] font-medium text-brand-text hover:underline">
          Back to the token
        </button>
      </div>
    </main>
  );
}

/** A token GitHub accepted: the app can open (problems show as banners there). */
const usable = (s: ConnectionStatus | null) => !!s?.login && s.state !== "invalid";

export function Onboarding() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [desktop, setDesktop] = useState<boolean | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    setDesktop(hasBridge());
    // `/onboarding?step=2`: the app sends a connected user here until a project is chosen.
    if (new URLSearchParams(window.location.search).get("step") === "2") setStep(2);
    void fetchConnection().then(setStatus);
  }, []);

  const connected = usable(status) && !replacing;
  if (step === 2 && connected) return <ProjectStep onBack={() => setStep(1)} />;

  return (
    <main className="min-h-dvh overflow-auto p-6">
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-line bg-surface p-8 shadow-modal">
        <Logo size={36} />
        <p className="mt-5 text-[12px] font-medium uppercase tracking-wide text-faint">Step 1 of 2 · GitHub token</p>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">Connect GitHub</h1>
        <p className="mt-1.5 text-[13.5px] text-muted">Deska reads one repository and one project (organization or personal) with your own GitHub token. No account, no server.</p>

        {desktop === false ? (
          <p role="status" className="mt-6 rounded-md border border-line bg-hover p-3 text-[12.5px]">
            Token entry is only available in the Deska desktop app. This preview runs on sample data.
          </p>
        ) : null}

        {status && !connected && status.state !== "missing" && status.state !== "preview" && (
          <div className="mt-6">
            <TokenSummary status={status} />
          </div>
        )}

        {connected ? (
          <div className="mt-6 space-y-5">
            <TokenSummary status={status!} />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex h-9 items-center rounded-md bg-brand px-4 font-semibold text-brand-on hover:bg-brand-hover"
              >
                Continue
              </button>
              <button type="button" onClick={() => setReplacing(true)} className="text-[12.5px] font-medium text-brand-text hover:underline">
                Use a different token
              </button>
            </div>
          </div>
        ) : desktop ? (
          <div className="mt-6 space-y-6">
            <TokenForm
              onChecked={(s) => {
                setStatus(s);
                setReplacing(false);
              }}
            />
            <section aria-labelledby="token-guide">
              <h2 id="token-guide" className="mb-2 text-[13px] font-semibold">
                How to create it
              </h2>
              <TokenGuide />
            </section>
          </div>
        ) : desktop === false ? (
          <section aria-labelledby="token-guide" className="mt-6">
            <h2 id="token-guide" className="mb-2 text-[13px] font-semibold">
              How to create it
            </h2>
            <TokenGuide />
          </section>
        ) : null}
        {desktop && !connected && <SkipGithub />}
      </div>
    </main>
  );
}

/** Use Deska for personal tasks only: nothing about GitHub blocks the app. Reversible from the sidebar. */
function SkipGithub() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function skip() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tasksOnly: true }) });
      if (!res.ok) throw new Error("failed");
      window.location.assign("/tasks");
    } catch {
      setError("Couldn't save that. Try again.");
      setBusy(false);
    }
  }
  return (
    <div className="mt-8 border-t border-line pt-5">
      <p className="text-[12.5px] text-muted">Just want to manage tasks? You can connect GitHub later from the sidebar.</p>
      <button type="button" disabled={busy} onClick={() => void skip()} data-skip-github className="mt-2 inline-flex h-8 items-center rounded-md border border-line px-3 text-[12.5px] font-medium hover:bg-hover disabled:opacity-60">
        {busy ? "Opening…" : "Skip, use tasks only"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
