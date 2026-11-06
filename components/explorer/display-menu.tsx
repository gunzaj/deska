"use client";

import { useRef, useState } from "react";
import {
  boardOptions,
  DEFAULT_PROPS,
  displayProps,
  groupOptions,
  sortOptions,
  stateFilterValue,
  withStateFilter,
  type BoardField,
  type ExplorerState,
  type Layout,
} from "@/lib/client/explorer";
import { MAX_SORT_KEYS } from "@/lib/client/sort";
import { Icon, type IconName } from "../icons";
import { Popover, btn } from "../ui/popover";
import { useAppData } from "../app/provider";

function Select<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-7 w-40 rounded-md border border-line bg-field px-2 text-[12.5px] text-fg outline-none hover:border-line-field focus:border-focus"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const LAYOUTS: { key: Layout; label: string; icon: IconName }[] = [
  { key: "list", label: "List", icon: "list" },
  { key: "board", label: "Board", icon: "board" },
  { key: "table", label: "Table", icon: "table" },
];

export function DisplayMenu({ state, onChange }: { state: ExplorerState; onChange: (s: ExplorerState) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const primarySort = state.sort[0] ?? { field: "updated", dir: "desc" as const };
  const columns = (state.columns ?? DEFAULT_PROPS) as string[];
  const closed = stateFilterValue(state.filters);
  // Dimensions come from the field mapping (§4.1); Sprint entries only with a Sprint field.
  const { meta } = useAppData().data;
  const BOARD_OPTIONS = boardOptions(meta);
  const GROUP_OPTIONS = groupOptions(meta);
  const SORT_OPTIONS = sortOptions(meta);
  const DISPLAY_PROPS = displayProps(meta);

  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen((o) => !o)} className={btn.outline} aria-haspopup="dialog">
        <Icon name="sliders" size={14} />
        Display
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" width={320}>
        <div className="space-y-3 overflow-y-auto p-3 text-[12.5px]">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-hover p-1">
            {LAYOUTS.map((l) => (
              <button
                key={l.key}
                type="button"
                aria-pressed={state.layout === l.key}
                onClick={() => onChange({ ...state, layout: l.key })}
                className={`flex h-12 flex-col items-center justify-center gap-1 rounded-md text-[12px] font-medium ${
                  state.layout === l.key ? "bg-surface text-fg shadow-raised" : "text-muted hover:text-fg"
                }`}
              >
                <Icon name={l.icon} size={15} />
                {l.label}
              </button>
            ))}
          </div>

          <div className="divide-y divide-line">
            <div className="pb-1">
              {state.layout === "board" ? (
                <Select
                  label="Columns"
                  value={(state.boardColumnsField ?? "status") as BoardField}
                  options={BOARD_OPTIONS}
                  onChange={(v) => onChange({ ...state, boardColumnsField: v })}
                />
              ) : (
                <Select
                  label="Grouping"
                  value={(state.groupBy ?? "") as string}
                  options={GROUP_OPTIONS.map((g) => ({ key: g.key as string, label: g.label }))}
                  onChange={(v) => {
                    const { groupBy: _drop, ...rest } = state;
                    void _drop;
                    onChange(v ? { ...rest, groupBy: v } : rest);
                  }}
                />
              )}
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-muted">Ordering</span>
                <div className="flex items-center gap-1">
                  <select
                    value={primarySort.field}
                    onChange={(e) => {
                      const def = SORT_OPTIONS.find((s) => s.key === e.target.value);
                      const rest = state.sort.slice(1).filter((s) => s.field !== e.target.value).slice(0, MAX_SORT_KEYS - 1);
                      onChange({ ...state, sort: [{ field: e.target.value, dir: def?.defaultDir ?? "asc" }, ...rest] });
                    }}
                    className="h-7 w-[8.5rem] rounded-md border border-line bg-field px-2 text-[12.5px] text-fg outline-none hover:border-line-field"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    title={primarySort.dir === "asc" ? "Ascending" : "Descending"}
                    onClick={() =>
                      onChange({ ...state, sort: [{ ...primarySort, dir: primarySort.dir === "asc" ? "desc" : "asc" }, ...state.sort.slice(1)] })
                    }
                    className="grid size-7 place-items-center rounded-md border border-line text-muted hover:bg-hover hover:text-fg"
                  >
                    <Icon name="arrowUpDown" size={13} className={primarySort.dir === "asc" ? "" : "rotate-180"} />
                  </button>
                </div>
              </div>
              {state.sort.slice(1).map((k, n) => (
                <div key={k.field} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-muted">Then by</span>
                  <div className="flex items-center gap-1">
                    <span className="w-[8.5rem] truncate px-2 text-[12.5px] text-fg">{SORT_OPTIONS.find((o) => o.key === k.field)?.label ?? k.field}</span>
                    <button
                      type="button"
                      title={k.dir === "asc" ? "Ascending" : "Descending"}
                      aria-label={`Flip direction of sort key ${n + 2}`}
                      onClick={() => onChange({ ...state, sort: state.sort.map((x, i) => (i === n + 1 ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x)) })}
                      className="grid size-7 place-items-center rounded-md border border-line text-muted hover:bg-hover hover:text-fg"
                    >
                      <Icon name="arrowUpDown" size={13} className={k.dir === "asc" ? "" : "rotate-180"} />
                    </button>
                    <button
                      type="button"
                      title="Remove sort key"
                      aria-label={`Remove sort key ${n + 2}`}
                      onClick={() => onChange({ ...state, sort: state.sort.filter((_, i) => i !== n + 1) })}
                      className="grid size-7 place-items-center rounded-md border border-line text-muted hover:bg-hover hover:text-fg"
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {state.sort.length > 0 && state.sort.length < MAX_SORT_KEYS && (
                <div className="flex items-center justify-between gap-3 py-1">
                  <span className="text-muted">Add sort key</span>
                  <select
                    aria-label="Add sort key"
                    value=""
                    onChange={(e) => {
                      const o = SORT_OPTIONS.find((x) => x.key === e.target.value);
                      if (o) onChange({ ...state, sort: [...state.sort, { field: o.key, dir: o.defaultDir }] });
                    }}
                    className="h-7 w-[8.5rem] rounded-md border border-line bg-field px-2 text-[12.5px] text-fg outline-none hover:border-line-field"
                  >
                    <option value="">Choose…</option>
                    {SORT_OPTIONS.filter((o) => !state.sort.some((k) => k.field === o.key)).map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="py-2">
              <p className="mb-1.5 text-muted">Issues</p>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-hover p-1">
                {(["open", "all", "closed"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={closed === v}
                    onClick={() => onChange({ ...state, filters: withStateFilter(state.filters, v) })}
                    className={`h-6 rounded-md text-[12px] font-medium capitalize ${closed === v ? "bg-surface text-fg shadow-raised" : "text-muted hover:text-fg"}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <p className="mb-1.5 text-muted">Display properties</p>
              <div className="flex flex-wrap gap-1">
                {DISPLAY_PROPS.map((p) => {
                  const on = columns.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        onChange({
                          ...state,
                          columns: on ? columns.filter((c) => c !== p.key) : DISPLAY_PROPS.map((d) => d.key).filter((k) => k === p.key || columns.includes(k)),
                        })
                      }
                      className={`h-6 rounded-md border px-2 text-[12px] font-medium ${
                        on ? "border-line-field bg-active text-fg" : "border-line text-faint hover:text-muted"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Popover>
    </>
  );
}
