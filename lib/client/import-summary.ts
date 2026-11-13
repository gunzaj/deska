/** The import result as the Settings page shows it (§4.7, FIX-SPEC B-1). */
export type ImportTables = Record<string, { rows: number; added: number; skipped: number; remapped: number }>;

const LABEL: Record<string, string> = {
  task_projects: "projects",
  task_labels: "labels",
  task_sections: "sections",
  tasks: "tasks",
  views: "views",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function importSummary(out: { added?: number; tables?: ImportTables }): string {
  const added = out.added ?? 0;
  const parts = [`Imported ${plural(added, "new row", "new rows")}.`];
  const remapped = Object.entries(out.tables ?? {})
    .filter(([, t]) => t.remapped > 0)
    .map(([name, t]) => `${t.remapped} ${LABEL[name] ?? name}`);
  if (remapped.length) parts.push(`Joined existing ones with the same name: ${remapped.join(", ")}.`);
  const skipped = Object.entries(out.tables ?? {})
    .map(([name, t]) => [name, t.skipped] as const)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${n} ${LABEL[name] ?? name.replace(/_/g, " ")}`);
  parts.push(skipped.length ? `Not imported (already here or missing their parent): ${skipped.join(", ")}.` : "Rows that already exist were kept as they are.");
  return parts.join(" ");
}
