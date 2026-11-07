"use client";

import { useEffect, useState } from "react";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";

/** The dialog behind "Save view", "Duplicate" and "Rename". */
export function SaveViewDialog({
  open,
  onClose,
  initialName,
  title,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initialName: string;
  title: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(initialName);
    }
  }, [open, initialName]);
  return (
    <Dialog open={open} onClose={onClose} label={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          void onSave(name.trim()).finally(() => setBusy(false));
        }}
      >
        <div className="p-4">
          <p className="text-[14px] font-semibold">{title}</p>
          <input
            autoFocus
            aria-label="View name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="View name"
            className="mt-3 h-9 w-full rounded-lg border border-line-field bg-field px-3 text-[14px] outline-none focus:border-focus"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-bg/50 px-4 py-3">
          <button type="button" onClick={onClose} className={btn.ghost}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim()} className={btn.primary}>
            {busy ? "Saving…" : "Save view"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
