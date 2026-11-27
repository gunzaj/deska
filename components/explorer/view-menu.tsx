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
 * The header controls of a saved view, a built-in list or of the filters that
 * could become one: Reset and Save while modified, the watch star, and the menu
 * (rename, duplicate, copy as a string, delete with Undo).
 *
 * A built-in list saves its own defaults: Save keeps the current filters and
 * display options, Reset returns to them, and the ⋯ menu forgets them again
 * ("Reset to default"). Saving a named view stays available in that menu.
 */
export function ViewActions({
  view,
  modified,
  onReset,
  onSave,
  onOpenDialog,
  page,
}: {
  view?: View;
  modified: boolean;
  onReset: () => void;
  /** Overwrite the view, or the built-in page's defaults, with the current state. */
  onSave: () => void | Promise<void>;
  /** "new": save as a new view or a copy; "rename". */
  onOpenDialog: (kind: "new" | "rename") => void;
  /** A built-in page: whether it has saved defaults, and how to forget them. */
  page?: { saved: boolean; onResetToDefault: () => void };
}) {
  const { removeView, restoreView } = useAppViews();
  const { toast } = useToast();
  const router = useRouter();
  if (!view) {
    return (
      <>
        {modified ? (
          <>
            <button type="button" onClick={onReset} className={btn.ghost}>
              Reset
            </button>
            <button type="button" onClick={() => void onSave()} className={btn.primary} title="Save these filters and display options as this page's default">
              Save
            </button>
          </>
        ) : (
          <button type="button" onClick={() => onOpenDialog("new")} className={btn.ghost} title="Save these filters as a view">
            <Icon name="plus" size={14} />
            <span className="hidden sm:inline">Save view</span>
          </button>
        )}
        {(modified || page?.saved) && (
          <PageMenu
            onSaveAsView={() => onOpenDialog("new")}
            onResetToDefault={page?.saved ? page.onResetToDefault : undefined}
          />
        )}
      </>
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

/** The ⋯ menu of a built-in list: save the state as a named view, or forget the page's defaults. */
function PageMenu({ onSaveAsView, onResetToDefault }: { onSaveAsView: () => void; onResetToDefault?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (id: string) => {
    setOpen(false);
    if (id === "new") onSaveAsView();
    if (id === "reset") onResetToDefault?.();
  };
  return (
    <>
      <button ref={ref} type="button" aria-label="List options" onClick={() => setOpen(true)} className={btn.icon}>
        <Icon name="more" size={16} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" width={240}>
        <PickList
          autoFocus
          placeholder="Action…"
          onPick={pick}
          items={[
            { id: "new", label: "Save as view…", icon: <Icon name="plus" size={13} className="text-faint" /> },
            ...(onResetToDefault ? [{ id: "reset", label: "Reset to default", icon: <Icon name="refresh" size={13} className="text-faint" /> }] : []),
          ]}
        />
      </Popover>
    </>
  );
}
