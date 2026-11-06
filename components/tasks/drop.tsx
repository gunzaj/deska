"use client";

// Sidebar drop targets for tasks: drag a task row onto Inbox, Today, Upcoming,
// a project or a label to file or reschedule it, with an Undo toast.
import { useState, type DragEvent } from "react";
import { dropOutcome, needsEditRights, TASK_DRAG_TYPE, type DropTarget } from "@/lib/client/task-drop";
import { canEdit } from "@/lib/tasks/model";
import { useAppData } from "../app/provider";
import { useToast } from "../ui/toast";
import { useToday } from "./notifications";
import { useTasks } from "./store";

export function useTaskDrop(target: DropTarget) {
  const { tasks, labels, update } = useTasks();
  const { viewer } = useAppData();
  const { today } = useToday();
  const { toast } = useToast();
  const [over, setOver] = useState(false);
  const isTask = (e: DragEvent) => e.dataTransfer.types.includes(TASK_DRAG_TYPE);

  const handlers = {
    onDragOver(e: DragEvent) {
      if (!isTask(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(true);
    },
    onDragLeave() {
      setOver(false);
    },
    async onDrop(e: DragEvent) {
      setOver(false);
      if (!isTask(e)) return;
      e.preventDefault();
      const task = tasks.find((t) => t.id === e.dataTransfer.getData(TASK_DRAG_TYPE));
      if (!task) return;
      if (needsEditRights(target) && !canEdit(task, viewer)) {
        toast({ kind: "error", message: "Only the creator or assignee can change when it's due" });
        return;
      }
      const names = task.labels.map((id) => labels.find((l) => l.id === id)?.name).filter((n): n is string => Boolean(n));
      const out = dropOutcome(task, names, target, today);
      if (!out) return;
      const res = await update(task.id, out.patch);
      if (res) toast({ message: `${out.message}: “${task.title}”`, action: { label: "Undo", run: () => void update(task.id, out.undo) } });
    },
  };
  return { over, handlers };
}
