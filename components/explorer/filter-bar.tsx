"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  filterFields,
  dateFilterLabel,
  fieldLabel,
  isDateFilter,
  filterValues,
  isValuesFilter,
  issueValueIds,
  newFilter,
  opsFor,
  setFilterValues,
  valueLabel,
  type FilterFieldKey,
} from "@/lib/client/explorer";
import type { ClientIssue } from "@/lib/client/types";
import type { Filter } from "@/lib/views/view";
import { Icon, type IconName } from "../icons";
import { Avatar, OptionDot, PriorityIcon, StatusIcon } from "../props";
import { useAppData } from "../app/provider";
import { PickList, Popover, btn, type PickItem } from "../ui/popover";

function useValueIcon() {
  const { data, avatarOf } = useAppData();
  const { meta } = data;
  return (field: FilterFieldKey, id: string, color?: string | null): ReactNode => {
    switch (field) {
      case "status":
        return <StatusIcon option={meta.fields.status.find((o) => o.id === id)} total={meta.fields.status.length} />;
      case "priority":
        return <PriorityIcon option={meta.fields.priority.find((o) => o.id === id)} total={meta.fields.priority.length} />;
      case "assignee":
        return <Avatar login={id === "me" ? meta.viewer : id} url={avatarOf(id === "me" ? meta.viewer : id)} size={16} />;
      case "release":
        return <Icon name="calendar" size={13} className="text-faint" />;
      case "state":
        return <StatusIcon option={null} total={0} state={id === "closed" ? "closed" : undefined} />;
      case "parent":
        return <Icon name="epic" size={13} className="text-faint" />;
      case "milestone":
        return <Icon name="milestone" size={13} className="text-faint" />;
      default:
        return <OptionDot color={color} />;
    }
  };
}

/** Multi-select value picker for one field with live counts from `pool`. */
export function ValuePicker({
  field,
  selected,
  pool,
  onToggle,
}: {
  field: FilterFieldKey;
  selected: string[];
  pool: ClientIssue[];
  onToggle: (id: string) => void;
}) {
  const { data } = useAppData();
  const iconOf = useValueIcon();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of pool) {
      for (const v of issueValueIds(i, field)) {
        const k = field === "assignee" ? v.toLowerCase() : v;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [pool, field]);
  const viewerKey = data.meta.viewer.toLowerCase();
  const items: PickItem[] = filterValues(field, data.meta, data.issues).map((v) => {
    const key = field === "assignee" ? (v.id === "me" ? viewerKey : v.id.toLowerCase()) : v.id;
    const relativeTarget =
      v.id === "current" ? data.meta.currentReleaseId : v.id === "next" ? data.meta.nextReleaseId : v.id === "previous" ? data.meta.previousReleaseId : null;
    const count = v.kind === "relative" ? (relativeTarget ? counts.get(relativeTarget) : 0) : counts.get(key);
    return {
      id: v.id,
      label: v.label,
      icon: iconOf(field, v.id, v.color),
      hint: count ?? 0,
      checked: selected.includes(v.id),
    };
  });
  // Most useful first: selected, then values that actually occur.
  if (field === "label" || field === "assignee" || field === "milestone") {
    items.sort((a, b) => Number(b.checked) - Number(a.checked) || Number(b.hint) - Number(a.hint));
  }
  return <PickList multi items={items} onPick={onToggle} placeholder={`Filter by ${fieldLabel(field, data.meta).toLowerCase()}…`} />;
}

/** "statuses", "priorities", "teams" for the chip summary. */
const plural = (w: string) => (w.endsWith("s") ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);

function Chip({ filter, index, filters, onChange, pool }: { filter: Filter; index: number; filters: Filter[]; onChange: (f: Filter[]) => void; pool: ClientIssue[] }) {
  const { data } = useAppData();
  const iconOf = useValueIcon();
  const opRef = useRef<HTMLButtonElement>(null);
  const valRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<"op" | "values" | null>(null);
  const remove = () => onChange(filters.filter((_, i) => i !== index));

  if (filter.field === "any") {
    const parts = filter.filters.map((f) => `${fieldLabel(f.field, data.meta)} ${"op" in f && f.op === "empty" ? "empty" : "…"}`);
    return (
      <span className="inline-flex h-7 items-center rounded-md border border-line bg-surface text-[12.5px] shadow-raised">
        <span className="px-2 text-muted">Any of</span>
        <span className="border-l border-line px-2 font-medium">{parts.join(" or ")}</span>
        <button type="button" aria-label="Remove filter" onClick={remove} className="grid h-full w-7 place-items-center border-l border-line text-faint hover:text-fg">
          <Icon name="x" size={12} />
        </button>
      </span>
    );
  }
  if (isDateFilter(filter)) {
    return (
      <span className="inline-flex h-7 items-center rounded-md border border-line bg-surface text-[12.5px] shadow-raised">
        <span className="flex items-center gap-1.5 px-2 font-medium">
          <Icon name="clock" size={13} className="text-faint" />
          {dateFilterLabel(filter)}
        </span>
        <button type="button" aria-label="Remove date filter" onClick={remove} className="grid h-full w-7 place-items-center rounded-r-md border-l border-line text-faint hover:bg-hover hover:text-fg">
          <Icon name="x" size={12} />
        </button>
      </span>
    );
  }
  if (!isValuesFilter(filter)) return null;
  const field = filter.field as FilterFieldKey;
  const meta = filterFields(data.meta).find((f) => f.key === field);
  const values = filter.values ?? [];
  const op = filter.op;
  const opLabel = opsFor(field).find((o) => o.op === op)?.label ?? op;
  const needsValues = op === "in" || op === "not_in";
  const shown = values.slice(0, 2).map((v) => valueLabel(field, v, data.meta, data.issues));
  const summary = values.length === 0 ? "any" : values.length <= 2 ? shown.join(", ") : `${values.length} ${plural(fieldLabel(field, data.meta).toLowerCase())}`;

  const toggle = (id: string) => {
    const next = values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
    onChange(setFilterValues(filters, index, next));
  };

  return (
    <span className="inline-flex h-7 max-w-full items-center rounded-md border border-line bg-surface text-[12.5px] shadow-raised">
      <span className="flex items-center gap-1.5 pl-2 pr-1.5 text-muted">
        <Icon name={(meta?.icon ?? "filter") as IconName} size={13} className="text-faint" />
        {fieldLabel(field, data.meta)}
      </span>
      {opsFor(field).length > 1 ? (
        <button ref={opRef} type="button" onClick={() => setMenu("op")} className="h-full border-l border-line px-2 text-muted hover:bg-hover hover:text-fg">
          {opLabel}
        </button>
      ) : (
        <span className="border-l border-line px-2 text-muted">{opLabel}</span>
      )}
      {needsValues && (
        <button ref={valRef} type="button" onClick={() => setMenu("values")} className="flex h-full min-w-0 items-center gap-1.5 border-l border-line px-2 font-medium hover:bg-hover">
          {values.length > 0 && values.length <= 3 && (
            <span className="flex -space-x-0.5">
              {values.slice(0, 3).map((v) => (
                <span key={v} className="grid place-items-center">
                  {iconOf(field, v, filterValues(field, data.meta, []).find((x) => x.id === v)?.color)}
                </span>
              ))}
            </span>
          )}
          <span className="truncate">{summary}</span>
        </button>
      )}
      <button type="button" aria-label={`Remove ${fieldLabel(field, data.meta)} filter`} onClick={remove} className="grid h-full w-7 shrink-0 place-items-center rounded-r-md border-l border-line text-faint hover:bg-hover hover:text-fg">
        <Icon name="x" size={12} />
      </button>

      <Popover anchor={opRef} open={menu === "op"} onClose={() => setMenu(null)} width={200}>
        <PickList
          autoFocus
          items={opsFor(field).map((o) => ({ id: o.op, label: o.label, checked: o.op === op }))}
          onPick={(newOp) => {
            const next = [...filters];
            const base = { field: filter.field, op: newOp } as Filter;
            next[index] = newOp === "in" || newOp === "not_in" ? ({ ...base, values } as Filter) : base;
            onChange(next);
            setMenu(null);
          }}
          placeholder="Condition…"
        />
      </Popover>
      <Popover anchor={valRef} open={menu === "values"} onClose={() => setMenu(null)} width={300}>
        <ValuePicker field={field} selected={values} pool={pool} onToggle={toggle} />
      </Popover>
    </span>
  );
}

const DATE_PRESETS: { id: string; label: string; filter: Filter }[] = [
  { id: "c7", label: "Created in the last 7 days", filter: { field: "created", op: "within_days", days: 7 } },
  { id: "c30", label: "Created in the last 30 days", filter: { field: "created", op: "within_days", days: 30 } },
  { id: "u7", label: "Updated in the last 7 days", filter: { field: "updated", op: "within_days", days: 7 } },
  { id: "u90", label: "Not updated for 90+ days", filter: { field: "updated", op: "older_than_days", days: 90 } },
  { id: "u180", label: "Not updated for 180+ days", filter: { field: "updated", op: "older_than_days", days: 180 } },
  { id: "cl14", label: "Closed in the last 14 days", filter: { field: "closed", op: "within_days", days: 14 } },
];

/** Fired by the F shortcut to open the page's "+ Filter" picker. */
export const FILTER_EVENT = "deska:filter";

/** "+ Filter" button: pick a field, then values (adds or extends a filter). */
export function AddFilter({ filters, onChange, pool, compact = false }: { filters: Filter[]; onChange: (f: Filter[]) => void; pool: ClientIssue[]; compact?: boolean }) {
  const { data } = useAppData();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<FilterFieldKey | null>(null);
  const close = () => {
    setOpen(false);
    setField(null);
  };
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(FILTER_EVENT, show);
    return () => window.removeEventListener(FILTER_EVENT, show);
  }, []);
  const existingIndex = field ? filters.findIndex((f) => f.field === field && isValuesFilter(f) && f.op === "in") : -1;
  const existing = existingIndex >= 0 ? filters[existingIndex] : undefined;
  const selected = existing && isValuesFilter(existing) ? (existing.values ?? []) : [];

  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(true)} className={btn.ghost} aria-label="Add filter" title="Add filter (f)" aria-haspopup="dialog">
        <Icon name="filter" size={14} />
        {!compact && filters.filter((f) => f.field !== "text" && f.field !== "state").length === 0 && "Filter"}
      </button>
      <Popover anchor={ref} open={open} onClose={close} width={field ? 300 : 240}>
        {!field ? (
          <PickList
            items={[
              ...filterFields(data.meta).map((f) => ({ id: f.key, label: f.label, icon: <Icon name={f.icon as IconName} size={14} className="text-faint" /> })),
              ...DATE_PRESETS.map((d) => ({ id: d.id, label: d.label, section: "Dates", icon: <Icon name="clock" size={14} className="text-faint" /> })),
            ]}
            onPick={(id) => {
              const preset = DATE_PRESETS.find((d) => d.id === id);
              if (preset) {
                onChange([...filters.filter((f) => !(isDateFilter(f) && f.field === preset.filter.field)), preset.filter]);
                close();
              } else setField(id as FilterFieldKey);
            }}
            placeholder="Filter by…"
          />
        ) : (
          <ValuePicker
            field={field}
            selected={selected}
            pool={pool}
            onToggle={(id) => {
              if (field === "state") {
                const next = filters.filter((f) => f.field !== "state");
                onChange([newFilter("state", id), ...next]);
                close();
                return;
              }
              if (existingIndex >= 0) {
                const next = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id];
                onChange(next.length ? setFilterValues(filters, existingIndex, next) : filters.filter((_, i) => i !== existingIndex));
              } else {
                onChange([...filters, newFilter(field, id)]);
              }
            }}
          />
        )}
      </Popover>
    </>
  );
}

export function FilterChips({ filters, onChange, pool }: { filters: Filter[]; onChange: (f: Filter[]) => void; pool: ClientIssue[] }) {
  return (
    <>
      {filters.map((f, i) =>
        f.field === "text" ? null : <Chip key={`${f.field}-${i}`} filter={f} index={i} filters={filters} onChange={onChange} pool={pool} />,
      )}
    </>
  );
}
