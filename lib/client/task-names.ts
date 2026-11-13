// Duplicate-name check for labels, projects and sections, so a dialog can say
// so before the request (the server refuses the same names with a 400).

/** Whether `name` is already used in `list`, ignoring case and the item being renamed. */
export function nameTaken(list: readonly { id: string; name: string }[], name: string, exceptId?: string): boolean {
  const n = name.trim().toLowerCase();
  return list.some((x) => x.id !== exceptId && x.name.trim().toLowerCase() === n);
}
