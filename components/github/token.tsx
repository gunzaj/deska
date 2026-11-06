"use client";

// Token entry and what Deska found out about a token, shared by onboarding
// and Settings. The token goes from this field straight into the preload
// bridge (SPEC §2.3): never over HTTP, never into state that outlives the
// submit, never back out of main.
import { useState, type FormEvent } from "react";
import { PERMISSIONS, type ConnectionStatus, type PermissionResult } from "@/lib/github/token-states";
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
        Fine-grained personal access token
      </label>
      <div className="flex gap-2">
        <input
          id="github-token"
          name="github-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          placeholder="github_pat_…"
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
      <p className="text-faint">Classic tokens and OAuth apps are not supported. Deska never writes to GitHub with a read-only token.</p>
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
      {status.expiryWarning && (
        <p className="flex items-start gap-1.5 text-warning">
          <Icon name="clock" size={13} className="mt-0.5 shrink-0" />
          {status.expiryWarning}
        </p>
      )}
      {status.login && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-faint">Expires</dt>
          <dd>{status.expiresAt ? status.expiresAt.slice(0, 10) : "No expiration date reported"}</dd>
          <dt className="text-faint">Access</dt>
          <dd className="flex items-center gap-1.5">
            {status.readOnly ? (
              <>
                <Icon name="lock" size={12} /> {status.readOnlyMessage}
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
