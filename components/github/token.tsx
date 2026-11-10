"use client";

// Token entry and what Deska found out about a token, shared by onboarding
// and Settings. The token goes from this field straight into the preload
// bridge (SPEC §2.3): never over HTTP, never into state that outlives the
// submit, never back out of main.
import { useEffect, useState, type FormEvent } from "react";
import type { GithubAuthStatus } from "@/desktop/bridge";
import { GH_COMMANDS, PERMISSIONS, type ConnectionStatus, type PermissionResult } from "@/lib/github/token-states";
import { Icon } from "../icons";
import { fetchConnection } from "../app/connection";

const NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

/** Electron wraps a rejection from main as "Error invoking remote method '…': Error: <message>". */
function bridgeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "") || "Deska couldn't save the token.";
}

export function hasBridge(): boolean {
  return typeof window !== "undefined" && !!window.deska;
}

/** What main knows about the GitHub CLI (installed, logged in, as whom); null outside the app or in an older build. */
export function useGithubCli(): { cli: GithubAuthStatus | null; reload: () => Promise<GithubAuthStatus | null> } {
  const [cli, setCli] = useState<GithubAuthStatus | null>(null);
  const reload = async () => {
    const next = (await window.deska?.github?.status().catch(() => null)) ?? null;
    setCli(next);
    return next;
  };
  useEffect(() => {
    void reload();
  }, []);
  return { cli, reload };
}

/** A command for the user to run in a terminal. Deska shows it and never runs it. */
export function Command({ children }: { children: string }) {
  return (
    <code data-command className="block w-fit max-w-full select-all overflow-x-auto rounded-md border border-line bg-field px-2 py-1 font-mono text-[12px]">
      {children}
    </code>
  );
}

/**
 * "Use my GitHub CLI login" (SPEC §3.1): main reads the token with
 * `gh auth token` and hands it to the local server; nothing is pasted and
 * nothing of the token is stored. Shown only when `gh` is installed and
 * logged in, unless `always` (Settings), where it says what is missing.
 */
export function GithubCliOption({ cli, label, always = false, onChecked }: { cli: GithubAuthStatus | null; label: string; always?: boolean; onChecked: (s: ConnectionStatus | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<GithubAuthStatus["cli"] | null>(null);
  if (!cli || (cli.cli !== "ok" && !always)) return null;
  const state = problem ?? cli.cli;

  async function use() {
    const bridge = window.deska?.github;
    if (!bridge) return;
    setBusy(true);
    setProblem(null);
    const after = await bridge.useCli().catch(() => null);
    if (!after || after.cli !== "ok") {
      setProblem(after?.cli ?? "logged-out");
      setBusy(false);
      return;
    }
    const status = await fetchConnection(true);
    setBusy(false);
    onChecked(status);
  }

  return (
    <div className="space-y-2" data-github-cli={state}>
      <button type="button" disabled={busy} onClick={() => void use()} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3.5 font-semibold text-brand-on hover:bg-brand-hover disabled:opacity-60">
        {busy ? "Checking…" : label}
        {state === "ok" && cli.cliLogin ? <span className="font-normal">(signed in as {cli.cliLogin})</span> : null}
      </button>
      {state !== "ok" ? (
        <div role="alert" className="space-y-1.5 text-[12.5px]">
          <p className="font-medium text-critical">{state === "not-found" ? "GitHub CLI isn't installed" : "GitHub CLI isn't logged in"}</p>
          <p className="text-muted">{state === "not-found" ? "Install it (brew install gh), then run this in a terminal and try again:" : "Run this in a terminal, then try again:"}</p>
          <Command>{GH_COMMANDS.login}</Command>
        </div>
      ) : (
        <p className="text-[11.5px] text-faint">Deska reads the token from the GitHub CLI each time it starts and never stores it. It never logs the CLI in or out.</p>
      )}
    </div>
  );
}

/**
 * Paste → bridge → `GET /user` and the permission checks. An invalid token is
 * deleted again, so the app never keeps a token GitHub refuses.
 */
export function TokenForm({ submitLabel = "Connect", onChecked }: { submitLabel?: string; onChecked: (s: ConnectionStatus | null) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const bridge = window.deska;
    if (!bridge) {
      setError("Token entry works only in the Deska desktop app.");
      return;
    }
    const token = value.trim();
    // The field is emptied before anything else happens.
    setValue("");
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await bridge.token.set(token);
    } catch (err) {
      setError(bridgeError(err));
      setBusy(false);
      return;
    }
    const status = await fetchConnection(true);
    if (status?.state === "invalid") await bridge.token.clear().catch(() => undefined);
    setBusy(false);
    onChecked(status);
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2" id="token">
      <label htmlFor="github-token" className="block text-[12.5px] font-medium">
        Personal access token
      </label>
      <div className="flex gap-2">
        <input
          id="github-token"
          name="github-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          placeholder="github_pat_… or ghp_…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-md border border-line bg-field px-2.5 font-mono text-[12.5px] outline-none hover:border-line-field focus:border-focus"
        />
        <button type="submit" disabled={busy || !value.trim()} className="inline-flex h-9 items-center rounded-md bg-brand px-3.5 font-semibold text-brand-on hover:bg-brand-hover disabled:opacity-60">
          {busy ? "Checking…" : submitLabel}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[12.5px] text-critical">
          {error}
        </p>
      )}
      <p className="text-[11.5px] text-faint">Stored encrypted with your macOS keychain. It never leaves this Mac except to GitHub.</p>
    </form>
  );
}

/** "How to create it": the token Deska needs (SPEC §3.1, §3.2). */
export function TokenGuide() {
  return (
    <div className="space-y-3 text-[12.5px]">
      <ol className="list-decimal space-y-1.5 pl-5 text-muted">
        <li>
          On GitHub, open{" "}
          <a href={NEW_TOKEN_URL} target="_blank" rel="noreferrer" className="font-medium text-brand-text hover:underline">
            Settings → Developer settings → Fine-grained tokens → Generate new token
          </a>
          .
        </li>
        <li>
          <strong className="text-fg">Resource owner:</strong> your organization.
        </li>
        <li>
          <strong className="text-fg">Expiration:</strong> whatever your org allows. Deska warns you 14 days before it ends.
        </li>
        <li>
          <strong className="text-fg">Repository access:</strong> Only select repositories, then pick the one repository Deska reads.
        </li>
        <li>
          <strong className="text-fg">Permissions:</strong> the ones below, all <em>Read-only</em>. Nothing else.
        </li>
        <li>Generate the token, copy it and paste it here. If your org approves tokens first, it works once an owner has approved it.</li>
      </ol>
      <p className="text-muted">
        <strong className="text-fg">Waiting for approval?</strong> If the repository is public, a classic token works right away: create one with only{" "}
        <code>read:project</code> (add <code>read:org</code> if the project isn&apos;t found) and nothing else. Never tick <code>repo</code>; it can write.
      </p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-faint">
            <th className="py-1 pr-3 font-medium">Permission</th>
            <th className="py-1 pr-3 font-medium">Access</th>
            <th className="py-1 font-medium">Used for</th>
          </tr>
        </thead>
        <tbody>
          {PERMISSIONS.map((p) => (
            <tr key={p.key} className="border-b border-line-soft align-top">
              <td className="py-1.5 pr-3 font-medium">{p.label}</td>
              <td className="py-1.5 pr-3">
                {p.level}
                {!p.required && <span className="text-faint"> (optional)</span>}
              </td>
              <td className="py-1.5 text-muted">{p.usedFor}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-faint">Deska has no OAuth app of its own. It never writes to GitHub with a read-only token.</p>
    </div>
  );
}

const STATUS_TEXT: Record<PermissionResult["status"], string> = {
  granted: "Granted",
  missing: "Missing",
  unavailable: "Not granted (optional)",
  unchecked: "Not checked yet",
};

/** Detected permissions, the token's owner, expiry and read-only status. */
export function TokenSummary({ status }: { status: ConnectionStatus }) {
  const problem = status.state !== "ok" && status.state !== "preview";
  return (
    <div className="space-y-3 text-[12.5px]" data-connection-summary={status.state}>
      {status.login && (
        <p>
          Connected as <strong className="font-semibold">@{status.login}</strong>
          {status.name ? <span className="text-muted"> ({status.name})</span> : null}
        </p>
      )}
      {problem && status.message && (
        <p role="alert" className="flex items-start gap-1.5 font-medium text-critical">
          <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
          {status.message}
        </p>
      )}
      {problem && status.command && (
        <div className="space-y-1.5">
          <p className="text-muted">{status.state === "gh-not-found" ? "Install the GitHub CLI (brew install gh), then run this in a terminal and check again:" : "Run this in a terminal, then check again:"}</p>
          <Command>{status.command}</Command>
        </div>
      )}
      {status.expiryWarning && (
        <p className="flex items-start gap-1.5 text-warning">
          <Icon name="clock" size={13} className="mt-0.5 shrink-0" />
          {status.expiryWarning}
        </p>
      )}
      {status.scopeWarning && (
        <p className="flex items-start gap-1.5 text-warning">
          <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
          {status.scopeWarning}
        </p>
      )}
      {status.login && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-faint">Sign-in</dt>
          <dd data-auth-source={status.source}>{status.source === "gh" ? "GitHub CLI login (not stored by Deska)" : "Personal access token"}</dd>
          {status.scopes && (
            <>
              <dt className="text-faint">Scopes</dt>
              <dd data-scopes>{status.scopes.length ? status.scopes.join(", ") : "None"}</dd>
            </>
          )}
          <dt className="text-faint">Expires</dt>
          <dd>{status.expiresAt ? status.expiresAt.slice(0, 10) : "No expiration date reported"}</dd>
          <dt className="text-faint">Access</dt>
          <dd className="flex items-center gap-1.5">
            {status.readOnly ? (
              <>
                <Icon name="lock" size={12} /> {status.readOnlyMessage}
                {status.writeAccessMessage && <span className="text-faint">· {status.writeAccessMessage}</span>}
              </>
            ) : (
              "Read and write"
            )}
          </dd>
        </dl>
      )}
      {status.login && (
        <ul className="divide-y divide-line-soft rounded-md border border-line" aria-label="Detected permissions">
          {status.permissions.map((p) => (
            <li key={p.key} className="flex items-center gap-2 px-2.5 py-1.5" data-permission={p.key} data-status={p.status}>
              <Icon
                name={p.status === "granted" ? "circleCheck" : p.status === "unchecked" ? "circleDot" : "circleSlash"}
                size={13}
                className={p.status === "granted" ? "text-brand-text" : p.status === "missing" ? "text-critical" : "text-faint"}
              />
              <span className="min-w-0 flex-1">
                {p.label}: {p.level}
              </span>
              <span className={p.status === "missing" ? "font-medium text-critical" : "text-faint"}>{STATUS_TEXT[p.status]}</span>
            </li>
          ))}
        </ul>
      )}
      {status.login && status.permissions.every((p) => p.status === "unchecked") && (
        <p className="text-faint">Permissions are checked once Deska knows which repository and project to read.</p>
      )}
    </div>
  );
}
