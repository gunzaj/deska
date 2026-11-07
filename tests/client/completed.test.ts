import { describe, expect, it } from "vitest";
import { dayTitle, groupByDay } from "@/lib/client/completed";
import { mergeTaskHits } from "@/lib/client/palette";
import type { CompletedItem, SearchHit, Task } from "@/lib/tasks/model";

const task = (id: string, title = id) => ({ id, title }) as unknown as Task;
const item = (id: string, at: string): CompletedItem => ({ key: id, task: task(id), at, occurrence: null, undoable: true });

describe("Completed view grouping (D13)", () => {
  it("groups by the day in the viewer's zone, newest day and newest completion first", () => {
    const items = [item("a", "2026-11-07T08:00:00Z"), item("b", "2026-11-07T20:30:00Z"), item("c", "2026-11-06T10:00:00Z"), item("d", "2026-10-20T10:00:00Z")];
    const days = groupByDay(items, "UTC", "2026-11-07");
    expect(days.map((d) => [d.day, d.items.map((i) => i.key)])).toEqual([
      ["2026-11-07", ["b", "a"]],
      ["2026-11-06", ["c"]],
      ["2026-10-20", ["d"]],
    ]);
    expect(days.map((d) => d.title)).toEqual(["Today · Sat 7 Nov", "Yesterday · Fri 6 Nov", "Tue 20 Oct"]);
  });

  it("uses the zone: 23:30 UTC is already the next day in Prague", () => {
    const days = groupByDay([item("late", "2026-11-06T23:30:00Z")], "Europe/Prague", "2026-11-07");
    expect(days[0]).toMatchObject({ day: "2026-11-07", title: "Today · Sat 7 Nov" });
  });

  it("titles today and yesterday", () => {
    expect(dayTitle("2026-11-07", "2026-11-07")).toMatch(/^Today/);
    expect(dayTitle("2026-11-06", "2026-11-07")).toMatch(/^Yesterday/);
  });
});

describe("palette task rows (D13)", () => {
  it("title matches first, then server hits, without repeats, up to the limit", () => {
    const remote: SearchHit[] = [
      { task: task("1"), in: "title" },
      { task: task("2"), in: "description" },
      { task: task("3"), in: "comment" },
    ];
    expect(mergeTaskHits([task("1")], remote, 5).map((h) => [h.task.id, h.in])).toEqual([
      ["1", "title"],
      ["2", "description"],
      ["3", "comment"],
    ]);
    expect(mergeTaskHits([task("1")], remote, 2).map((h) => h.task.id)).toEqual(["1", "2"]);
    expect(mergeTaskHits([], [], 5)).toEqual([]);
  });
});
