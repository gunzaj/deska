"use client";

// "Save view" on Tasks (item 12): a name and the task filters a saved view
// keeps — project (any, Inbox, or one), label, priority and due window. The view
// is stored locally; opening it renders the Tasks list with those filters.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PRIORITIES, type Priority } from "@/lib/tasks/model";
import { TASK_DUE_WINDOWS, TASK_VIEW_LIMITS, type TaskDueWindow, type TaskViewFilter } from "@/lib/tasks/views";
import { useAppViews } from "../app/provider";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";
import { useTasks } from "./store";

const field = "h-8 w-full rounded-md border border-line bg-field px-2 text-[12.5px] outline-none hover:border-line-field focus:border-focus";

export const DUE_LABEL: Record<TaskDueWindow, string> = {
  any: "Any time",
  overdue: "Overdue",
  today: "Today",
  upcoming: "Next 14 days",
  none: "No date",
};

export function SaveTaskViewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { projects, labels } = useTasks();
  const { upsertTaskView } = useAppViews();
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [project, setProject] = useState("");
  const [label, setLabel] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState<TaskDueWindow>("any");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setName("");
    setProject("");
    setLabel("");
    setPriority("");
    setDue("any");
    setError(null);
    onClose();
  };

  const save = async () => {
    const filter: TaskViewFilter = {
      ...(project ? { projectId: project } : {}),
      ...(label ? { labelId: label } : {}),
      ...(priority ? { priority: Number(priority) as Priority } : {}),
      ...(due !== "any" ? { due } : {}),
    };
    setBusy(true);
    setError(null);
    const saved = await upsertTaskView({ name: name.trim(), filter });
    setBusy(false);
    if (!saved) {
      setError("Could not save the view.");
      return;
    }
    close();
    toast({ message: `Saved “${saved.name}”` });
    router.push(`/tasks/views/${saved.id}`);
  };

  return (
    <Dialog open={open} onClose={close} label="Save view" width={460}>
      {open && (
        <form
          className="space-y-3 p-4"
          data-save-task-view
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && name.trim()) void save();
          }}
        >
          <p className="text-[14px] font-semibold">Save view</p>
          <p className="text-[12px] text-faint">Keep the task filters you use most in the Tasks section of the sidebar.</p>
          {error && (
            <p role="alert" className="text-[12.5px] font-medium text-critical">
              {error}
            </p>
          )}
          <label className="block text-[12.5px] font-medium">
            View name
            <input
              autoFocus
              aria-label="View name"
              value={name}
              maxLength={TASK_VIEW_LIMITS.name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              className={`mt-1 ${field}`}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12.5px] font-medium">
              Project
              <select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className={`mt-1 ${field}`}>
                <option value="">Any project</option>
                <option value="none">Inbox (no project)</option>
                {projects
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-[12.5px] font-medium">
              Label
              <select aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)} className={`mt-1 ${field}`}>
                <option value="">Any label</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12.5px] font-medium">
              Priority
              <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={`mt-1 ${field}`}>
                <option value="">Any priority</option>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.short} · {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12.5px] font-medium">
              Due
              <select aria-label="Due" value={due} onChange={(e) => setDue(e.target.value as TaskDueWindow)} className={`mt-1 ${field}`}>
                {TASK_DUE_WINDOWS.map((d) => (
                  <option key={d} value={d}>
                    {DUE_LABEL[d]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-1.5 border-t border-line-soft pt-3">
            <button type="button" onClick={close} className={btn.ghost}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !name.trim()} className={btn.outline} data-save-task-view-submit>
              <Icon name="check" size={13} />
              {busy ? "Saving…" : "Save view"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
