"use client";

// Onboarding step 1 (SPEC D3): paste a fine-grained token, see who it belongs
// to and what it can read, continue to the issues.
import { useEffect, useState } from "react";
import type { ConnectionStatus } from "@/lib/github/token-states";
import { Logo } from "../icons";
import { fetchConnection } from "../app/connection";
import { hasBridge, TokenForm, TokenGuide, TokenSummary } from "./token";

/** A token GitHub accepted: the app can open (problems show as banners there). */
const usable = (s: ConnectionStatus | null) => !!s?.login && s.state !== "invalid";

export function Onboarding() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [desktop, setDesktop] = useState<boolean | null>(null);
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    setDesktop(hasBridge());
    void fetchConnection().then(setStatus);
  }, []);

  const connected = usable(status) && !replacing;

  return (
    <main className="min-h-dvh overflow-auto p-6">
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-line bg-surface p-8 shadow-modal">
        <Logo size={36} />
        <p className="mt-5 text-[12px] font-medium uppercase tracking-wide text-faint">Step 1 of 2 · GitHub token</p>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">Connect GitHub</h1>
        <p className="mt-1.5 text-[13.5px] text-muted">Deska reads one repository and one organization project with your own fine-grained token. No account, no server.</p>

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
                onClick={() => window.location.assign("/issues")}
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
      </div>
    </main>
  );
}
