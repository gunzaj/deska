"use client";

// Settings → Project and fields (SPEC D4, §2.4, §4.1): the repository and
// project Deska reads, its pinned node ID, and the field mapping, which can
// be changed at any time. "Reload fields" reads the project's fields from
// GitHub again (renames show up, deleted fields say "Missing field — remap").
import { useEffect, useState } from "react";
import type { SetupState } from "@/lib/server/project-setup";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { loadSetup, MappingForm, ProjectPicker } from "./mapping";

export function ProjectSettings() {
  const { refresh } = useAppData();
  const [state, setState] = useState<SetupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    loadSetup().then(setState, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  /** New state from the server; `restart` starts the form over (new fields), a plain save keeps it. */
  const apply = async (s: SetupState, restart = true) => {
    setState(s);
    if (restart) setVersion((v) => v + 1);
    await refresh();
  };

  async function reload() {
    setReloading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/fields", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      await apply(body as SetupState);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReloading(false);
    }
  }

  const t = state?.target;
  return (
    <section id="mapping" aria-labelledby="mapping-settings" className="space-y-5 border-t border-line pt-6">
      <div className="flex items-center gap-2">
        <h2 id="mapping-settings" className="flex-1 text-[15px] font-semibold">
          Project and fields
        </h2>
        {state?.canDiscover && t?.source === "settings" && (
          <button type="button" disabled={reloading} onClick={() => void reload()} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium hover:bg-hover disabled:opacity-60">
            <Icon name="refresh" size={12} />
            {reloading ? "Reloading…" : "Reload fields"}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-critical">
          {error}
        </p>
      )}
      {!state && !error && <p className="text-muted">Loading…</p>}

      {state && (
        <>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12.5px]" data-project-target>
            <dt className="text-faint">Repository</dt>
            <dd>{t?.repo ?? "Not chosen yet"}</dd>
            <dt className="text-faint">Project</dt>
            <dd>{t ? `${t.projectTitle || "Project"} · ${t.org} #${t.projectNumber}` : "Not chosen yet"}</dd>
            {t?.projectId && (
              <>
                <dt className="text-faint">Pinned node ID</dt>
                <dd className="font-mono text-[11.5px]">{t.projectId}</dd>
              </>
            )}
          </dl>
          {state.missing.length > 0 && (
            <p role="alert" className="rounded-md bg-hover px-3 py-2 text-[12.5px] text-warning" data-missing-summary>
              {state.missing.map((m) => `“${m.name}”`).join(", ")} {state.missing.length === 1 ? "is" : "are"} no longer in the project. Map {state.missing.length === 1 ? "it" : "them"} again below.
            </p>
          )}

          {state.canDiscover && (
            <div className="space-y-3">
              {changing ? (
                <ProjectPicker
                  initial={t ?? null}
                  saveLabel="Save project and fields"
                  onDone={(s) => {
                    setChanging(false);
                    void apply(s);
                  }}
                />
              ) : (
                <button type="button" onClick={() => setChanging(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[12.5px] font-medium hover:bg-hover">
                  Change project…
                </button>
              )}
            </div>
          )}

          {!changing && (
            <div className="space-y-2">
              <h3 className="text-[13px] font-semibold">Field mapping</h3>
              {state.fields.length === 0 ? (
                <p className="text-[12.5px] text-faint">No project fields are known yet.</p>
              ) : (
                <MappingForm
                  key={version}
                  fields={state.fields}
                  initial={state.mapping ?? state.suggestion}
                  missing={state.missing}
                  saveLabel="Save mapping"
                  onSave={async (mapping) => {
                    const res = await fetch("/api/settings/mapping", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mapping) });
                    const body = await res.json();
                    if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
                    await apply(body as SetupState, false);
                  }}
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
