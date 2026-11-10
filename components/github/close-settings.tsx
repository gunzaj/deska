"use client";

// Settings → "Done Status for closing" (SPEC §4.8, W2): which Status option a
// close sets. Options come from the mapped Status field by ID, so a project whose
// done column is not called "Done" still works. Until one is chosen, Close is
// refused with the reason (the issue panel's Close button says so).
import { useEffect, useState } from "react";
import { useAppData } from "../app/provider";

type CloseSettings = {
  doneId: string | null;
  missing: boolean;
  options: { id: string; name: string; color: string }[];
  statusFieldMissing: boolean;
};

async function load(): Promise<CloseSettings> {
  const res = await fetch("/api/settings/close", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as CloseSettings;
}

export function CloseSettings() {
  const { refresh } = useAppData();
  const [state, setState] = useState<CloseSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load().then(setState, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function choose(optionId: string | null) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ optionId }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setState(await load());
      // Close is allowed or refused in the issue panel: the payload's closeBlocked changed.
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="close" aria-labelledby="close-settings" className="space-y-4 border-t border-line pt-6">
      <h2 id="close-settings" className="text-[15px] font-semibold">
        Closing issues
      </h2>
      <p className="text-[12.5px] text-muted">
        Closing an issue in Deska closes it on GitHub and moves its Status to the option below, so the board agrees with the issue state.
        Reopening leaves Status alone.
      </p>
      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-critical">
          {error}
        </p>
      )}
      {!state && !error && <p className="text-muted">Loading…</p>}
      {state && state.statusFieldMissing && (
        <p className="text-[12.5px] font-medium text-warning">Missing field — remap Status in Project and fields above.</p>
      )}
      {state && !state.statusFieldMissing && (
        <label className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-medium">Done Status for closing</span>
          <select
            aria-label="Done Status for closing"
            className="h-8 rounded-md border border-line bg-surface px-2 text-[13px]"
            value={state.doneId ?? ""}
            disabled={saving}
            onChange={(e) => void choose(e.target.value || null)}
          >
            <option value="">Choose a Status option…</option>
            {state.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {state.missing && <span className="text-[12px] font-medium text-warning">The chosen option is no longer a Status option — choose again.</span>}
          {state.doneId === null && <span className="text-[12px] text-faint">Close is disabled until one is chosen.</span>}
        </label>
      )}
    </section>
  );
}
