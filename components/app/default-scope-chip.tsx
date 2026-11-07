"use client";

// The "My default" dimension value is a filter the viewer didn't type, so it is
// always shown as a chip they can remove (§4.2: no hidden filters).
import { plainName } from "@/lib/client/format";
import { withDefaultScope } from "@/lib/client/team-scope";
import type { Filter } from "@/lib/views/view";
import { Icon } from "../icons";
import { useDefaultScope } from "./team-scope";

/** Whether the default value narrows a list with these filters (the page's own filter on that dimension wins). */
export function useDefaultScopeApplies(filters: Filter[], base: Filter[]): boolean {
  const { defaultScope } = useDefaultScope();
  return !!defaultScope && withDefaultScope(filters, base, defaultScope).length > filters.length;
}

/** `fixed`: shown but not removable here (a walk-through is fixed when it starts; change it on the list). */
export function DefaultScopeChip({ filters = [], base = [], fixed = false }: { filters?: Filter[]; base?: Filter[]; fixed?: boolean }) {
  const { defaultScope, off, setOff } = useDefaultScope();
  const applies = useDefaultScopeApplies(filters, base);
  if (!defaultScope || !applies) return null;
  const value = plainName(defaultScope.name) || defaultScope.name;
  if (fixed) {
    return (
      <span data-team-scope-chip title={`Your default ${defaultScope.dimension.name} was on when this walk-through started. Change it on the triage list.`} className="flex h-7 items-center rounded-md border border-brand-border bg-brand-soft px-2 text-[12px] font-medium text-brand-text">
        {off ? `Default off: ${value}` : `Default: ${value}`}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-team-scope-chip
      aria-pressed={!off}
      onClick={() => setOff(!off)}
      title={off ? `Filter by your default ${defaultScope.dimension.name} again` : `Showing your default ${defaultScope.dimension.name} only. Click to show all.`}
      className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium ${off ? "border-line text-faint hover:text-fg" : "border-brand-border bg-brand-soft text-brand-text"}`}
    >
      {off ? `Default off: ${value}` : `Default: ${value}`}
      <Icon name={off ? "plus" : "x"} size={12} />
    </button>
  );
}
