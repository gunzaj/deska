import { NextResponse } from "next/server";
import { displayRepo } from "@/lib/config";
import { renderMarkdownLite, sanitizeHtml } from "@/lib/server/issue-detail";
import { getStore } from "@/lib/store";
import type { ReadModel } from "@/lib/sync/read-model";
import type { Task, TaskComment } from "./model";
import type { Resolve, Result } from "./service";

// Shared helpers for the /api/tasks routes.

// The lookup is derived from the issue cache, which changes once per sync
// generation: build it once per store, not on every task POST and PATCH (a
// checkbox toggle used to rebuild ~5k entries; v5 3.8).
const numbersOf = new WeakMap<ReadModel, Map<number, { nodeId: string; title: string }>>();

/** Issues in the cache by number. */
export async function resolver(): Promise<Resolve> {
  try {
    const store = await getStore();
    let byNumber = numbersOf.get(store);
    if (!byNumber) {
      byNumber = new Map();
      for (const i of store.issues.values()) byNumber.set(i.number, { nodeId: i.nodeId, title: i.title });
      numbersOf.set(store, byNumber);
    }
    const index = byNumber;
    return (n) => {
      const i = index.get(n);
      return i ? { kind: "issue", nodeId: i.nodeId, number: n, title: i.title } : null;
    };
  } catch {
    return () => null;
  }
}

/** A task plus its rendered description, for the panel. */
export function withHtml(task: Task) {
  return { task, descriptionHtml: task.description ? sanitizeHtml(renderMarkdownLite(task.description, displayRepo())) : "" };
}

export function fail(r: Extract<Result<unknown>, { ok: false }>) {
  // A conflict carries the current task so the client can show it (S9).
  if (r.status === 409 && r.current) return NextResponse.json({ error: r.error, current: withHtml(r.current) }, { status: 409 });
  return NextResponse.json({ error: r.error }, { status: r.status });
}

/** A comment plus its rendered markdown. */
export const withBodyHtml = (c: TaskComment) => ({ ...c, bodyHtml: sanitizeHtml(renderMarkdownLite(c.body, displayRepo())) });
