// Manual order of a task list, by `position`. Pure, so drops are unit-tested.
import type { Task } from "../tasks/model";

/**
 * The position that puts `movedId` after every other task of `group`, or null
 * when it already is last (nothing to do). `group` is in display order.
 */
export function endPosition(group: readonly Pick<Task, "id" | "position">[], movedId: string): number | null {
  const rest = group.filter((t) => t.id !== movedId);
  const last = rest[rest.length - 1];
  const moved = group.find((t) => t.id === movedId);
  if (moved && (!last || group.indexOf(moved) > group.length - 2)) return null;
  return last ? last.position + 1 : 0;
}
