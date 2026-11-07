"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { View } from "@/lib/views/view";
import { useAppViews } from "../app/provider";
import { Icon } from "../icons";
import { PickList, Popover, btn } from "../ui/popover";
import { useToast } from "../ui/toast";
import { SeenOnOpen, WatchStar } from "../watch/star";

export function ViewMenu({ view, mine, onRename, onDuplicate, onDelete, onToggleVisibility }: { view: View; mine: boolean; onRename: () => void; onDuplicate: () => void; onDelete: () => void | Promise<void>; onToggleVisibility: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (id: string) => {
    setOpen(false);
    if (id === "rename") onRename();
    if (id === "dup") onDuplicate();
    if (id === "vis") onToggleVisibility();
    if (id === "del") void onDelete();
  };
  return (
    <>
      <button ref={ref} type="button" aria-label="View options" onClick={() => setOpen(true)} className={btn.icon}>
        <Icon name="more" size={16} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" width={220}>
        <PickList
          autoFocus
          placeholder="Action…"
          onPick={pick}
          items={[
            ...(mine ? [{ id: "rename", label: "Rename…", icon: <Icon name="save" size={13} className="text-faint" /> }] : []),
            { id: "dup", label: "Duplicate", icon: <Icon name="copy" size={13} className="text-faint" /> },
            ...(mine
              ? [
                  {
                    id: "vis",
                    label: view.visibility === "shared" ? "Make personal" : "Share with team",
                    icon: <Icon name={view.visibility === "shared" ? "lock" : "users"} size={13} className="text-faint" />,
                  },
                  { id: "del", label: "Delete view", icon: <Icon name="trash" size={13} className="text-critical" /> },
                ]
              : []),
          ]}
        />
      </Popover>
    </>
  );
}

/**
 * The header controls of a saved view or of the filters that could become one:
 * Reset and Save while modified, the visibility mark, the watch star, and the
 * menu (rename, duplicate, share, delete with Undo).
 */
export function ViewActions({
  view,
  mine,
  modified,
  onReset,
  onSave,
  onOpenDialog,
}: {
  view?: View;
  mine: boolean;
  modified: boolean;
  onReset: () => void;
  /** Overwrite the view with the current state (only offered to its owner). */
  onSave: () => void | Promise<void>;
  /** "new": save as a new view or a copy; "rename". */
  onOpenDialog: (kind: "new" | "rename") => void;
}) {
  const { upsertView, removeView, restoreView } = useAppViews();
  const { toast } = useToast();
  const router = useRouter();
  if (!view) {
    return (
      <button type="button" onClick={() => onOpenDialog("new")} className={btn.ghost} title="Save these filters as a view">
        <Icon name="plus" size={14} />
        <span className="hidden sm:inline">Save view</span>
      </button>
    );
  }
  return (
    <>
      {modified && (
        <>
          <button type="button" onClick={onReset} className={btn.ghost}>
            Reset
          </button>
          <button type="button" onClick={() => (mine ? void onSave() : onOpenDialog("new"))} className={btn.primary}>
            {mine ? "Save" : "Save as copy"}
          </button>
        </>
      )}
      <span title={view.visibility === "shared" ? "Shared view" : "Personal view"} className="text-faint">
        <Icon name={view.visibility === "shared" ? "users" : "lock"} size={14} />
      </span>
      <WatchStar kind="view" id={view.id} />
      <SeenOnOpen kind="view" id={view.id} />
      <ViewMenu
        view={view}
        mine={mine}
        onRename={() => onOpenDialog("rename")}
        onDuplicate={() => onOpenDialog("new")}
        onToggleVisibility={() => void upsertView({ ...view, visibility: view.visibility === "shared" ? "personal" : "shared" })}
        onDelete={async () => {
          // No confirm: the delete can be undone (U1).
          if (!(await removeView(view.id))) {
            toast({ message: `Could not delete “${view.name}”`, kind: "error" });
            return;
          }
          router.push("/my");
          toast({
            message: `Deleted view “${view.name}”`,
            action: {
              label: "Undo",
              run: async () => {
                if (await restoreView(view.id)) router.push(`/views/${view.id}`);
              },
            },
          });
        }}
      />
    </>
  );
}
