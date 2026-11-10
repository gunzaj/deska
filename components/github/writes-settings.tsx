"use client";

// Settings → GitHub writes (SPEC §3.4): the switch that, with a token that can
// write and a build that allows writes, turns GitHub edits on. Off by default and
// after every token change. Turning it on asks GitHub first (read-only queries),
// so it can never be on for a token GitHub would refuse.
import { useEffect, useState } from "react";
import { useAppData } from "../app/provider";
import { useConnection } from "../app/connection";
import { Icon } from "../icons";

type Gate = {
  allowed: boolean;
  reason: string | null;
  buildAllows: boolean;
  settingOn: boolean;
  tokenAccess: "yes" | "no" | "unknown";
  tokenMessage: string | null;
};

async function load(): Promise<Gate> {
  const res = await fetch("/api/settings/writes", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return (body as { writes: Gate }).writes;
}

export function WritesSettings() {
  const { refresh } = useAppData();
  const { status, recheck } = useConnection();
  const [gate, setGate] = useState<Gate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load().then(setGate, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function toggle(on: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/writes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setGate((body as { writes: Gate }).writes);
      // The payload's writeMode changed: edit controls follow on the next load.
      await Promise.all([refresh(), recheck()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const canTurnOn = !!gate && gate.buildAllows && gate.tokenAccess === "yes";
  return (
    <section id="writes" aria-labelledby="writes-settings" className="space-y-4 border-t border-line pt-6">
      <h2 id="writes-settings" className="text-[15px] font-semibold">
        GitHub writes
      </h2>
      <p className="text-[12.5px] text-muted">
        Off by default. When on, changes you make in Deska are written to GitHub as you: Status, Priority, Sprint and the other mapped fields,
        assignees, labels, type, milestone, close/reopen and new issues. Deska writes only after your action, checks that nothing changed on GitHub
        since it read the issue, and never deletes anything.
      </p>

      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-critical">
          {error}
        </p>
      )}
      {!gate && !error && <p className="text-muted">Loading…</p>}

      {gate && (
        <>
          <label className="flex items-center gap-2.5 text-[13px]">
            <input
              type="checkbox"
              role="switch"
              aria-label="GitHub writes"
              aria-describedby="writes-state"
              className="size-4 accent-brand"
              checked={gate.settingOn}
              disabled={saving || (!canTurnOn && !gate.settingOn)}
              onChange={(e) => void toggle(e.target.checked)}
            />
            <span className="font-medium">{saving ? "Saving…" : "Write changes to GitHub"}</span>
          </label>
          <p id="writes-state" className="text-[12.5px]" data-writes-state={gate.allowed ? "on" : "off"}>
            {gate.buildAllows ? (
              gate.tokenAccess === "yes" ? (
                <span className="text-muted">
                  This token can write.
                  {status?.source === "gh" && " The GitHub CLI login can write to every repository you can, so this switch is what keeps Deska read-only."}
                </span>
              ) : gate.tokenAccess === "no" ? (
                <span className="flex items-start gap-1.5 text-warning">
                  <Icon name="lock" size={12} className="mt-[2px] shrink-0" />
                  <span>{gate.tokenMessage ?? "This token can't write."} Edit controls stay disabled; a read-only token is safer.</span>
                </span>
              ) : (
                <span className="text-muted">Checking what this token can write…</span>
              )
            ) : (
              <span className="flex items-start gap-1.5 text-muted">
                <Icon name="lock" size={12} className="mt-[2px] shrink-0" />
                <span>This build is read-only: it was built with DESKA_WRITES=off and never writes to GitHub.</span>
              </span>
            )}
          </p>
          {gate.settingOn && gate.allowed && (
            <p className="text-[12px] text-faint" data-writes-on>
              Writes are on. They turn off again when the token or sign-in source changes.
            </p>
          )}
        </>
      )}
    </section>
  );
}
