"use client";

// Bulk edit's action bar (IMPROVEMENTS W4, SPEC §3 backlog). The change is
// sent as one outbox row per issue, one after another (the outbox writes a
// user's edits serially anyway), with progress "12 / 80" and a summary toast
// that can filter the list to the issues that failed. Over 50 issues asks
// first, stating the count and the change (SPEC §5).
import { useRef, useState } from "react";
import { bulkConfirmText, bulkEdit, describeChange, type BulkChange, type BulkSetField } from "@/lib/client/bulk";
import type { ClientIssue } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { Icon, type IconName } from "../icons";
import { useIssueEdits } from "../issue/edits";
import { Avatar, OptionDot, PriorityIcon, StatusIcon } from "../props";
import { Dialog } from "../ui/dialog";
import { PickList, Popover, btn, type PickItem } from "../ui/popover";
import { useToast } from "../ui/toast";

const NONE = "__none";

type Menu = "status" | "priority" | "team" | "platform" | "release" | "label+" | "label-" | "assign" | "unassign";

const MENUS: { id: Menu; label: string; icon: IconName }[] = [
  { id: "status", label: "Status", icon: "circleDot" },
  { id: "priority", label: "Priority", icon: "flag" },
  { id: "team", label: "Team", icon: "users" },
  { id: "platform", label: "Platform", icon: "monitorSmartphone" },
  { id: "release", label: "Release", icon: "calendar" },
  { id: "label+", label: "Add label", icon: "tag" },
  { id: "label-", label: "Remove label", icon: "tag" },
  { id: "assign", label: "Assign", icon: "user" },
  { id: "unassign", label: "Unassign", icon: "user" },
];

export function BulkBar({
  selected,
  onClear,
  onShowFailed,
}: {
  selected: ClientIssue[];
  onClear: () => void;
  /** Narrow the list to these issues. */
  onShowFailed: (nodeIds: string[]) => void;
}) {
  const { data, byNodeId, avatarOf, option } = useAppData();
  // The loop below outlives the render that started it: a refresh mid-run must
  // be read from here, not from that render's `byNodeId` (false conflicts; v5 3.10).
  const byNodeRef = useRef(byNodeId);
  byNodeRef.current = byNodeId;
  const { edit } = useIssueEdits();
  const { toast } = useToast();
  const meta = data.meta;
  const [menu, setMenu] = useState<Menu | null>(null);
  const anchors = useRef(new Map<Menu, HTMLButtonElement | null>());
  const [confirm, setConfirm] = useState<{ change: BulkChange; issues: ClientIssue[]; text: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const items = (m: Menu): PickItem[] => {
    switch (m) {
      case "status":
      case "priority":
      case "team":
      case "platform": {
        const opts = meta.fields[m];
        return [
          ...opts.map((o) => ({
            id: o.id,
            label: o.name,
            icon: m === "status" ? <StatusIcon option={o} total={opts.length} /> : m === "priority" ? <PriorityIcon option={o} total={opts.length} /> : <OptionDot color={o.color} />,
          })),
          { id: NONE, label: `No ${m}`, icon: <Icon name="x" size={12} className="text-faint" /> },
        ];
      }
      case "release":
        return [
          ...[...meta.releases].reverse().map((r) => ({ id: r.id, label: r.title, hint: r.id === meta.currentReleaseId ? "current" : r.id === meta.nextReleaseId ? "next" : undefined })),
          { id: NONE, label: "No release", icon: <Icon name="x" size={12} className="text-faint" /> },
        ];
      case "label+":
      case "label-":
        return meta.labels.map((l) => ({ id: l.id, label: l.name, icon: <OptionDot color={l.color} /> }));
      case "assign":
      case "unassign":
        return meta.users.map((u) => ({ id: u.login, label: u.login, icon: <Avatar login={u.login} url={avatarOf(u.login)} size={16} /> }));
    }
  };

  const changeFor = (m: Menu, id: string): BulkChange => {
    if (m === "label+" || m === "label-") return { kind: "label", op: m === "label+" ? "add" : "remove", id, name: meta.labels.find((l) => l.id === id)?.name ?? id };
    if (m === "assign" || m === "unassign") return { kind: "assignee", op: m === "assign" ? "add" : "remove", login: id };
    const value = id === NONE ? null : id;
    const valueLabel = value == null ? "" : m === "release" ? (meta.releases.find((r) => r.id === value)?.title ?? value) : (option(m as Exclude<BulkSetField, "release">, value)?.name ?? value);
    return { kind: "set", field: m as BulkSetField, value, valueLabel };
  };

  const run = async (change: BulkChange, issues: ClientIssue[]) => {
    const failed: ClientIssue[] = [];
    let changed = 0;
    setProgress({ done: 0, total: issues.length });
    for (const [n, picked] of issues.entries()) {
      // The latest values: an earlier step (or a refresh) may have changed them.
      const issue = byNodeRef.current.get(picked.nodeId) ?? picked;
      const e = bulkEdit(issue, change);
      if (e) {
        const outcome = await edit(issue, e.field, e.next, { quiet: true });
        if (outcome === "done" || outcome === "pending") changed++;
        else failed.push(issue);
      }
      setProgress({ done: n + 1, total: issues.length });
    }
    setProgress(null);
    const what = describeChange(change);
    if (!failed.length) {
      toast({ message: `${what}: ${issues.length} issue${issues.length === 1 ? "" : "s"} done${changed < issues.length ? ` (${issues.length - changed} already had it)` : ""}` });
      return;
    }
    const list = failed
      .slice(0, 5)
      .map((i) => `#${i.number}`)
      .join(", ");
    toast({
      kind: "error",
      message: `${what}: ${issues.length - failed.length} of ${issues.length} done, ${failed.length} failed (${list}${failed.length > 5 ? ", …" : ""})`,
      action: { label: "Show failed", run: () => onShowFailed(failed.map((i) => i.nodeId)) },
      duration: 20_000,
    });
  };

  const apply = (change: BulkChange) => {
    const issues = [...selected];
    const text = bulkConfirmText(change, issues.length);
    if (text) setConfirm({ change, issues, text });
    else void run(change, issues);
  };

  return (
    <>
      <div role="toolbar" aria-label="Bulk edit" className="anim-fade absolute inset-x-3 bottom-3 z-20 mx-auto flex max-w-max flex-wrap items-center gap-1 rounded-xl border border-line bg-popover px-2 py-1.5 shadow-modal">
        <span className="px-1.5 text-[12.5px] font-semibold tabular-nums">{progress ? `${progress.done} / ${progress.total}` : `${selected.length} selected`}</span>
        {progress ? (
          <span role="status" aria-label="Applying" className="mx-1 size-3 animate-spin rounded-full border-2 border-line border-t-brand" />
        ) : (
          MENUS.map((m) => (
            <button key={m.id} ref={(el) => void anchors.current.set(m.id, el)} type="button" onClick={() => setMenu(m.id)} className={btn.ghost}>
              <Icon name={m.icon} size={13} /> {m.label}
            </button>
          ))
        )}
        <button type="button" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)" className={btn.icon} disabled={!!progress}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <Popover anchor={{ current: menu ? (anchors.current.get(menu) ?? null) : null }} open={menu != null} onClose={() => setMenu(null)} width={260}>
        {menu && (
          <PickList
            placeholder={`${MENUS.find((m) => m.id === menu)!.label}…`}
            items={items(menu)}
            onPick={(id) => {
              const m = menu;
              setMenu(null);
              apply(changeFor(m, id));
            }}
          />
        )}
      </Popover>
      <Dialog open={confirm != null} onClose={() => setConfirm(null)} label="Confirm bulk edit" width={420}>
        {confirm && (
          <div className="p-4">
            <p className="text-[14px] font-semibold">{confirm.text}</p>
            <p className="mt-1 text-muted">Each issue is written to GitHub separately, one after another.</p>
            <div className="mt-4 flex justify-end gap-1.5">
              <button type="button" onClick={() => setConfirm(null)} className={btn.outline}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  void run(c.change, c.issues);
                }}
                className={btn.primary}
              >
                Apply to {confirm.issues.length}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
