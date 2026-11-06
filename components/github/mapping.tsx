"use client";

// Project and field mapping (SPEC D4, §4.1, §4.5): pick the repository and
// org project (onboarding step 2 and Settings), then map project fields to
// Status, Priority, Sprint and dimensions. Fields are shown by their current
// GitHub names; what is stored is their IDs.
import { useMemo, useState, type FormEvent } from "react";
import type { OrgProject } from "@/lib/github/projects";
import type { SetupField, SetupState } from "@/lib/server/project-setup";
import { MISSING_FIELD, priorityLowToHigh, type FieldMapping, type FieldRef } from "@/lib/sync/field-map";
import { Icon } from "../icons";

const input = "h-8 min-w-0 rounded-md border border-line bg-field px-2.5 text-[12.5px] outline-none hover:border-line-field focus:border-focus";
const primary = "inline-flex h-8 items-center rounded-md bg-brand px-3.5 font-semibold text-brand-on hover:bg-brand-hover disabled:opacity-60";
const secondary = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 font-medium hover:bg-hover disabled:opacity-60";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const loadSetup = () => api<SetupState>("/api/settings/project");

const ref = (f: SetupField | undefined): FieldRef | null => (f ? { id: f.id, name: f.name } : null);

function FieldSelect({ label, id, fields, value, onChange, optional, missing }: { label: string; id: string; fields: SetupField[]; value: FieldRef | null; onChange: (f: FieldRef | null) => void; optional?: boolean; missing?: boolean }) {
  const known = !value || fields.some((f) => f.id === value.id);
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
      <label htmlFor={id} className="text-[12.5px] font-medium">
        {label}
        {!optional && <span className="text-faint"> *</span>}
      </label>
      <div className="flex min-w-0 items-center gap-2">
        <select id={id} value={value?.id ?? ""} onChange={(e) => onChange(ref(fields.find((f) => f.id === e.target.value)))} className={`${input} flex-1`}>
          {optional ? <option value="">None</option> : !value && <option value="">Choose a field…</option>}
          {!known && <option value={value!.id}>{`${value!.name} (${MISSING_FIELD})`}</option>}
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {(missing || !known) && (
          <span role="alert" data-missing-field className="shrink-0 text-[12px] font-medium text-warning">
            {MISSING_FIELD}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The mapping itself. `fields` are the project's fields (from GitHub or the
 * cache); `initial` is the stored mapping or the suggestion (give the form a
 * new `key` to start over from a new one).
 */
export function MappingForm({
  fields,
  initial,
  missing = [],
  saveLabel,
  onSave,
}: {
  fields: SetupField[];
  initial: FieldMapping;
  missing?: { id: string }[];
  saveLabel: string;
  onSave: (m: FieldMapping) => Promise<void>;
}) {
  const [m, setM] = useState<FieldMapping>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const singles = fields.filter((f) => f.dataType.toUpperCase() === "SINGLE_SELECT");
  const iterations = fields.filter((f) => f.dataType.toUpperCase() === "ITERATION");
  const roleIds = new Set([m.status?.id, m.priority?.id].filter(Boolean));
  const dimFields = singles.filter((f) => !roleIds.has(f.id));
  const missingIds = new Set(missing.map((x) => x.id));
  const status = fields.find((f) => f.id === m.status?.id);
  const priority = fields.find((f) => f.id === m.priority?.id);
  const ordered = useMemo(() => (priority ? [...priorityLowToHigh(priority.options, m.priorityOrder)].reverse() : []), [priority, m.priorityOrder]);
  const missingDims = m.dimensions.filter((d) => !fields.some((f) => f.id === d.id));

  const setRole = (role: "status" | "priority", f: FieldRef | null) =>
    // A field takes one place: picking it for a role takes it out of the dimensions.
    setM((x) => ({ ...x, [role]: f, dimensions: x.dimensions.filter((d) => d.id !== f?.id), ...(role === "status" ? { doneStatusIds: [] } : {}) }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(m);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 text-[12.5px]" aria-label="Field mapping" data-mapping-form>
      <div className="space-y-2">
        <FieldSelect label="Status" id="map-status" fields={singles} value={m.status} onChange={(f) => setRole("status", f)} missing={!!m.status && missingIds.has(m.status.id)} />
        <FieldSelect label="Priority" id="map-priority" fields={singles} value={m.priority} onChange={(f) => setRole("priority", f)} optional missing={!!m.priority && missingIds.has(m.priority.id)} />
        {priority && (
          <fieldset className="ml-[7.25rem] space-y-1">
            <legend className="sr-only">Priority order</legend>
            {(["highest-first", "lowest-first"] as const).map((o) => (
              <label key={o} className="flex items-center gap-2">
                <input type="radio" name="priority-order" value={o} checked={m.priorityOrder === o} onChange={() => setM((x) => ({ ...x, priorityOrder: o }))} className="accent-brand" />
                {o === "highest-first" ? "First option is the highest priority" : "Last option is the highest priority"}
              </label>
            ))}
            <p className="text-faint" data-priority-preview>
              Highest to lowest: {ordered.map((o) => o.name).join(" › ") || "no options"}
            </p>
          </fieldset>
        )}
        <FieldSelect label="Sprint" id="map-sprint" fields={iterations} value={m.sprint} onChange={(f) => setM((x) => ({ ...x, sprint: f }))} optional missing={!!m.sprint && missingIds.has(m.sprint.id)} />
        {!iterations.length && <p className="ml-[7.25rem] text-faint">This project has no iteration field: sprint views, the backlog and planning stay hidden.</p>}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1 font-medium">Dimensions</legend>
        <p className="text-faint">Other single-select fields to filter, group and lay out boards by.</p>
        {dimFields.length === 0 && missingDims.length === 0 && <p className="text-faint">No other single-select fields.</p>}
        {dimFields.map((f) => (
          <label key={f.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={m.dimensions.some((d) => d.id === f.id)}
              onChange={(e) => setM((x) => ({ ...x, dimensions: e.target.checked ? [...x.dimensions, { id: f.id, name: f.name }] : x.dimensions.filter((d) => d.id !== f.id) }))}
              className="accent-brand"
            />
            {f.name}
            <span className="text-faint">· {f.options.length} options</span>
          </label>
        ))}
        {missingDims.map((d) => (
          <label key={d.id} className="flex items-center gap-2">
            <input type="checkbox" checked onChange={() => setM((x) => ({ ...x, dimensions: x.dimensions.filter((y) => y.id !== d.id) }))} className="accent-brand" />
            {d.name}
            <span role="alert" data-missing-field className="font-medium text-warning">
              {MISSING_FIELD}
            </span>
          </label>
        ))}
      </fieldset>

      {status && (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 font-medium">Status options that also count as done</legend>
          <p className="text-faint">Closed issues always count as done. Pick open Status options that should count too, if any.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {status.options.map((o) => (
              <label key={o.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={m.doneStatusIds.includes(o.id)}
                  onChange={(e) => setM((x) => ({ ...x, doneStatusIds: e.target.checked ? [...x.doneStatusIds, o.id] : x.doneStatusIds.filter((id) => id !== o.id) }))}
                  className="accent-brand"
                />
                {o.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !m.status} className={primary}>
          {busy ? "Saving…" : saveLabel}
        </button>
        {saved && !error && <span className="text-faint">Saved</span>}
      </div>
      {error && (
        <p role="alert" className="text-critical">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Repository, org and project, then the mapping for that project's fields.
 * `onDone` runs after the project and mapping are stored.
 */
export function ProjectPicker({ initial, saveLabel, onDone }: { initial: SetupState["target"]; saveLabel: string; onDone: (s: SetupState) => void }) {
  const [repo, setRepo] = useState(initial?.repo ?? "");
  const [org, setOrg] = useState(initial?.org ?? "");
  const [projects, setProjects] = useState<OrgProject[] | null>(null);
  const [number, setNumber] = useState<number | null>(initial?.projectNumber ?? null);
  const [preview, setPreview] = useState<{ fields: SetupField[]; suggestion: FieldMapping; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repoOk = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.trim());

  async function find(e: FormEvent) {
    e.preventDefault();
    const o = org.trim() || repo.split("/")[0]!.trim();
    setOrg(o);
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const r = await api<{ projects: OrgProject[] }>(`/api/settings/projects?org=${encodeURIComponent(o)}`);
      setProjects(r.projects);
      if (r.projects.length === 1) await pick(r.projects[0]!.number, o);
    } catch (err) {
      setProjects(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function pick(n: number, o = org) {
    setNumber(n);
    setPreview(null);
    setError(null);
    try {
      const q = new URLSearchParams({ repo: repo.trim(), org: o, number: String(n) });
      const r = await api<{ project: { title: string }; fields: SetupField[]; suggestion: FieldMapping }>(`/api/settings/project/preview?${q}`);
      setPreview({ fields: r.fields, suggestion: r.suggestion, title: r.project.title });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={(e) => void find(e)} className="grid gap-2 text-[12.5px] sm:grid-cols-[1fr_1fr_auto] sm:items-end" aria-label="Repository and organization">
        <label className="grid gap-1">
          <span className="font-medium">Repository</span>
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" spellCheck={false} autoCapitalize="off" className={input} aria-label="Repository" />
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Organization</span>
          <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder={repo.split("/")[0] || "org"} spellCheck={false} autoCapitalize="off" className={input} aria-label="Organization" />
        </label>
        <button type="submit" disabled={busy || !repoOk} className={secondary}>
          <Icon name="search" size={13} />
          {busy ? "Looking…" : "Find projects"}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-critical">
          {error}
        </p>
      )}

      {projects && (
        <fieldset className="space-y-1 text-[12.5px]">
          <legend className="mb-1 font-medium">Project</legend>
          {projects.length === 0 && <p className="text-faint">This token can read no projects in {org}.</p>}
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <input type="radio" name="project" checked={number === p.number} onChange={() => void pick(p.number)} className="accent-brand" />
              {p.title}
              <span className="text-faint">
                #{p.number}
                {p.closed ? " · closed" : ""}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {preview && number != null && (
        <section aria-label={`Fields of ${preview.title}`} className="space-y-3 border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold">Map the fields of “{preview.title}”</h3>
          <MappingForm
            key={`${number}:${preview.fields.length}`}
            fields={preview.fields}
            initial={preview.suggestion}
            saveLabel={saveLabel}
            onSave={async (mapping) => {
              const s = await api<SetupState>("/api/settings/project", { method: "POST", body: JSON.stringify({ repo: repo.trim(), org, projectNumber: number, mapping }) });
              onDone(s);
            }}
          />
        </section>
      )}
    </div>
  );
}
