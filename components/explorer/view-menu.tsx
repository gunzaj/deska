"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { encodeView } from "@/lib/views/share";
import type { View } from "@/lib/views/view";
import { useAppViews } from "../app/provider";
import { Icon } from "../icons";
import { PickList, Popover, btn } from "../ui/popover";
import { useToast } from "../ui/toast";
import { SeenOnOpen, WatchStar } from "../watch/star";

export function ViewMenu({ onRename, onDuplicate, onCopy, onDelete }: { onRename: () => void; onDuplicate: () => void; onCopy: () => void; onDelete: () => void | Promise<void> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (id: string) => {
    setOpen(false);
    if (id === "rename") onRename();
    if (id === "dup") onDuplicate();
    if (id === "copy") onCopy();
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
            { id: "rename", label: "Rename…", icon: <Icon name="save" size={13} className="text-faint" /> },
            { id: "dup", label: "Duplicate", icon: <Icon name="copy" size={13} className="text-faint" /> },
            { id: "copy", label: "Copy view", icon: <Icon name="link" size={13} className="text-faint" /> },
            { id: "del", label: "Delete view", icon: <Icon name="trash" size={13} className="text-critical" /> },
          ]}
        />
      </Popover>
    </>
  );
}

/**
 * The header controls of a saved view or of the filters that could become one:
 * Reset and Save while modified, the watch star, and the menu (rename,
 * duplicate, copy as a string, delete with Undo).
 */
export function ViewActions({
  view,
  modified,
  onReset,
  onSave,
  onOpenDialog,
}: {
  view?: View;
  modified: boolean;
  onReset: () => void;
  /** Overwrite the view with the current state. */
  onSave: () => void | Promise<void>;
  /** "new": save as a new view or a copy; "rename". */
  onOpenDialog: (kind: "new" | "rename") => void;
}) {
  const { removeView, restoreView } = useAppViews();
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
          <button type="button" onClick={() => void onSave()} className={btn.primary}>
            Save
          </button>
        </>
      )}
      <WatchStar kind="view" id={view.id} />
      <SeenOnOpen kind="view" id={view.id} />
      <ViewMenu
        onRename={() => onOpenDialog("rename")}
        onDuplicate={() => onOpenDialog("new")}
        onCopy={() => {
          // Clipboard write is the one clipboard permission the desktop window grants (§2.2).
          navigator.clipboard?.writeText(encodeView(view)).then(
            () => toast({ message: "View copied. Paste it into Import view." }),
            () => toast({ message: "Could not copy the view", kind: "error" }),
          );
        }}
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
