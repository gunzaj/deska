"use client";

import type { ExplorerState } from "@/lib/client/explorer";
import { PRESETS } from "@/lib/client/presets";
import type { Filter } from "@/lib/views/view";
import { Explorer } from "../explorer/explorer";
import { Icon } from "../icons";

// Epics are issues with sub-issues: a locked base filter, not a chip the user can remove.
const EPIC_BASE: Filter[] = [{ field: "parent", op: "has_sub_issues" }];

// Open epics, most progress first (the old page's default), in the list layout.
const EPIC_DEFAULTS: ExplorerState = { ...PRESETS.all, sort: [{ field: "progress", dir: "desc" }] };

/**
 * The Epics list, built on the shared Explorer: search, every applicable issue
 * filter, saved views and the viewer's default team all behave as on /issues.
 */
export function EpicsPage() {
  return (
    <Explorer
      title="Epics"
      icon={<Icon name="epic" size={15} />}
      base={EPIC_BASE}
      defaults={EPIC_DEFAULTS}
      emptyTitle="No epics"
      emptyHint="Issues with sub-issues on GitHub appear here."
    />
  );
}
