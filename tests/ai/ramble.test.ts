// Item 13: the Ramble parse's strict schema, prompt and subject.
import { describe, expect, it } from "vitest";
import { jsonSchemaOf } from "@/lib/ai/prompt";
import { rambleHash, rambleSchema, rambleTask, type RambleInput } from "@/lib/ai/ramble";

const input = (over: Partial<RambleInput> = {}): RambleInput => ({
  transcript: "Buy milk tomorrow and call the dentist on Friday",
  today: "2026-10-13",
  now: "09:30",
  tz: "UTC",
  projects: [{ id: "p1", name: "Home", sections: [{ id: "s1", name: "Errands" }] }],
  labels: [{ id: "l1", name: "phone" }],
  subjectVersion: "abc12345",
  ...over,
});

describe("Ramble (item 13)", () => {
  it("accepts only the real project, section and label IDs", () => {
    expect(rambleSchema(input()).safeParse({ tasks: [{ title: "Buy milk", dueDate: "2026-10-14", dueTime: null, priority: 4, reason: "Shopping.", projectId: "p1", sectionId: "s1", labelIds: ["l1"] }] }).success).toBe(true);
    expect(rambleSchema(input()).safeParse({ tasks: [{ title: "Buy milk", dueDate: null, dueTime: null, priority: 4, reason: "Shopping.", projectId: "other" }] }).success).toBe(false);
    expect(rambleSchema(input()).safeParse({ tasks: [{ title: "Buy milk", dueDate: null, dueTime: null, priority: 4, reason: "Shopping.", labelIds: ["other"] }] }).success).toBe(false);
    expect(rambleSchema(input()).safeParse({ tasks: [{ title: "Buy milk", dueDate: "2026-02-30", dueTime: null, priority: 4, reason: "Shopping." }] }).success).toBe(false);
    expect(rambleSchema(input()).safeParse({ tasks: [] }).success).toBe(false);
    expect(rambleSchema(input()).safeParse({ tasks: [{ title: "Buy milk", dueDate: null, dueTime: null, priority: 9, reason: "Shopping." }] }).success).toBe(false);
  });

  it("leaves out the choices the user has none of", () => {
    const schema = jsonSchemaOf(rambleTask(input({ projects: [], labels: [] })));
    const properties = (schema as { properties: { tasks: { items: { properties: Record<string, unknown> } } } }).properties.tasks.items.properties;
    expect(properties).not.toHaveProperty("projectId");
    expect(properties).not.toHaveProperty("sectionId");
    expect(properties).not.toHaveProperty("labelIds");
  });

  it("puts the transcript, clock and choices in data blocks and hashes the transcript", () => {
    const task = rambleTask(input());
    expect(task.feature).toBe("ramble");
    expect(task.subjectKind).toBe("list");
    expect(task.subject).toBe(`ramble:${rambleHash(input().transcript)}`);
    expect(task.data.map((d) => d.label)).toEqual(["context", "transcript", "projects", "labels"]);
    expect(task.data[1]!.text).toContain("Buy milk");
    expect(task.data[2]!.text).toContain("Home (p1) — sections: Errands (s1)");
    expect(rambleHash("one")).toBe(rambleHash("one"));
    expect(rambleHash("one")).not.toBe(rambleHash("two"));
  });

  it("trims a long transcript instead of sending all of it", () => {
    const task = rambleTask(input({ transcript: "x".repeat(20_000) }));
    expect(task.data[1]!.text).toHaveLength(8_000);
  });
});
