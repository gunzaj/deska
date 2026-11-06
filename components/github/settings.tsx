"use client";

// Settings → GitHub (SPEC D3): the token's owner, detected permissions and
// expiry; replace the token; disconnect. Disconnecting deletes the token only:
// the GitHub cache and personal tasks stay (§2.3).
import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { useAppData } from "../app/provider";
import { useConnection } from "../app/connection";
import { hasBridge, TokenForm, TokenGuide, TokenSummary } from "./token";

export function GithubSettings() {
  const { viewer } = useAppData();
  const { status, checking, recheck } = useConnection();
  const [desktop, setDesktop] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => setDesktop(hasBridge()), []);

  async function disconnect() {
    await window.deska?.token.clear();
    window.location.assign("/onboarding");
  }

  return (
    <section aria-labelledby="github-settings" className="space-y-5">
      <div className="flex items-center gap-2">
        <h2 id="github-settings" className="flex-1 text-[15px] font-semibold">
          GitHub
        </h2>
        {status && status.state !== "preview" && (
          <button type="button" disabled={checking} onClick={() => void recheck()} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium hover:bg-hover disabled:opacity-60">
            <Icon name="refresh" size={12} />
            {checking ? "Checking…" : "Check again"}
          </button>
        )}
      </div>

      {!status ? (
        <p className="text-muted">Loading…</p>
      ) : status.state === "preview" ? (
        <p role="status" className="rounded-md border border-line bg-hover p-3 text-[12.5px]">
          This preview runs on sample data as @{viewer}. Connecting a GitHub token works only in the Deska desktop app.
        </p>
      ) : (
        <TokenSummary status={status} />
      )}

      {desktop && (
        <div className="space-y-2 border-t border-line pt-5">
          <h3 className="text-[13px] font-semibold">Replace token</h3>
          <p className="text-[12.5px] text-muted">A new token replaces the stored one. Your tasks and the cached GitHub data stay.</p>
          <TokenForm
            submitLabel="Replace"
            onChecked={(s) => {
              // A different owner is a different local user: reload the app.
              if (!s?.login || s.login !== viewer) window.location.assign(s?.login ? "/issues" : "/onboarding");
              else void recheck();
            }}
          />
          <button type="button" onClick={() => setShowGuide((v) => !v)} className="text-[12.5px] font-medium text-brand-text hover:underline">
            {showGuide ? "Hide" : "How to create it"}
          </button>
          {showGuide && <TokenGuide />}
        </div>
      )}

      {desktop && status?.state !== "missing" && (
        <div className="space-y-2 border-t border-line pt-5">
          <h3 className="text-[13px] font-semibold">Disconnect GitHub</h3>
          <p className="text-[12.5px] text-muted">Deletes the token from this Mac. The cached GitHub data and your tasks stay.</p>
          {confirming ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void disconnect()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-critical px-3 font-semibold text-brand-on">
                <Icon name="logout" size={13} />
                Disconnect
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="inline-flex h-8 items-center rounded-md px-3 font-medium hover:bg-hover">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 font-medium hover:bg-hover">
              <Icon name="logout" size={13} />
              Disconnect GitHub…
            </button>
          )}
        </div>
      )}
    </section>
  );
}
