import { describe, expect, it } from "vitest";
import { importSummary } from "@/lib/client/import-summary";

describe("importSummary (FIX-SPEC B-1)", () => {
  it("names remapped and skipped rows per table", () => {
    const text = importSummary({
      added: 3,
      tables: {
        task_projects: { rows: 1, added: 0, skipped: 1, remapped: 1 },
        tasks: { rows: 3, added: 3, skipped: 0, remapped: 0 },
        task_reminders: { rows: 2, added: 0, skipped: 2, remapped: 0 },
      },
    });
    expect(text).toContain("Imported 3 new rows.");
    expect(text).toContain("same name: 1 projects");
    expect(text).toContain("1 projects, 2 task reminders");
  });

  it("with nothing skipped keeps the short message", () => {
    expect(importSummary({ added: 1, tables: { tasks: { rows: 1, added: 1, skipped: 0, remapped: 0 } } })).toBe(
      "Imported 1 new row. Rows that already exist were kept as they are.",
    );
  });
});
