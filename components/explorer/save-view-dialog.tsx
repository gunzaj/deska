"use client";

import { useEffect, useState } from "react";
import type { View } from "@/lib/views/view";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";

/** The dialog behind "Save view", "Duplicate" and "Rename", for issue and PR views alike (v5 4.6). */
export function SaveViewDialog({
  open,
  onClose,
  initialName,
  initialVisibility,
  title,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initialName: string;
  initialVisibility: View["visibility"];
  title: string;
  onSave: (name: string, visibility: View["visibility"]) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(initialName);
      setVisibility(initialVisibility);
    }
  }, [open, initialName, initialVisibility]);
  return (
    <Dialog open={open} onClose={onClose} label={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          void onSave(name.trim(), visibility).finally(() => setBusy(false));
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
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-hover p-1">
            {(["personal", "shared"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={visibility === v}
                onClick={() => setVisibility(v)}
                className={`flex h-12 flex-col items-start justify-center rounded-md px-3 text-left ${visibility === v ? "bg-surface shadow-raised" : "text-muted"}`}
              >
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                  <Icon name={v === "personal" ? "lock" : "users"} size={13} />
                  {v === "personal" ? "Personal" : "Shared"}
                </span>
                <span className="text-[11.5px] text-faint">{v === "personal" ? "Only you see it" : "Visible to the whole Deska team"}</span>
              </button>
            ))}
          </div>
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
