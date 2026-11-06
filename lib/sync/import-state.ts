// The first import's checkpoint and progress keys in sync_state
// (lib/sync/first-import.ts). No imports: lib/sync/runtime.ts lists these keys
// at load time, and the import module itself depends on runtime.

export type ImportPhase = "metadata" | "open" | "closed" | "items";

/** The import's checkpoint and progress, in sync_state. */
export const IMPORT_KEYS = {
  phase: "import.phase",
  startedAt: "import.startedAt",
  cutoff: "import.cutoff",
  since: "import.since",
  page: "import.page",
  issues: "import.issues",
  items: "import.items",
  itemsTotal: "import.itemsTotal",
  pendingParents: "import.pendingParents",
  resumed: "import.resumed",
} as const;

export type ImportProgress = {
  phase: ImportPhase | null;
  /** True when this run continued a checkpoint instead of starting fresh. */
  resumed: boolean;
  issues: number;
  items: number;
  itemsTotal: number | null;
};

export function importProgress(kv: { get(key: string): string | null }): ImportProgress {
  const phase = kv.get(IMPORT_KEYS.phase);
  const n = (k: string) => {
    const v = Number(kv.get(k) ?? "");
    return Number.isFinite(v) && v >= 0 ? v : 0;
  };
  const total = Number(kv.get(IMPORT_KEYS.itemsTotal) ?? "");
  return {
    phase: phase === "metadata" || phase === "open" || phase === "closed" || phase === "items" ? phase : null,
    resumed: kv.get(IMPORT_KEYS.resumed) === "1",
    issues: n(IMPORT_KEYS.issues),
    items: n(IMPORT_KEYS.items),
    itemsTotal: kv.get(IMPORT_KEYS.itemsTotal) && Number.isFinite(total) ? total : null,
  };
}

