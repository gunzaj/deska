import { describe, expect, it } from "vitest";
import { parseQuickAdd, tokenKey, type ParseContext } from "@/lib/tasks/quick-add";

// Monday 12 Oct 2026, 14:00.
const ctx: ParseContext = {
  today: "2026-10-12",
  now: "14:00",
  projects: ["Specs", "PR reviews", "Specs to finish"],
  users: ["alice", "bob"],
  hasItem: (n) => [101, 1234, 5678].includes(n),
};
const p = (s: string, extra: Partial<ParseContext> = {}) => parseQuickAdd(s, { ...ctx, ...extra });

describe("due dates (§12.4 row 1)", () => {
  it.each([
    ["Spec today", "2026-10-12"],
    ["Spec tod", "2026-10-12"],
    ["Spec tomorrow", "2026-10-13"],
    ["Spec tmr", "2026-10-13"],
    ["Spec tmrw", "2026-10-13"],
    ["Spec mon", "2026-10-19"], // a weekday never means today
    ["Spec monday", "2026-10-19"],
    ["Spec on friday", "2026-10-16"],
    ["Spec wed", "2026-10-14"],
    ["Spec sun", "2026-10-18"],
    ["Spec next week", "2026-10-19"],
    ["Spec next monday", "2026-10-19"],
    ["Spec next friday", "2026-10-23"],
    ["Spec in 3 days", "2026-10-15"],
    ["Spec in 2 weeks", "2026-10-26"],
    ["Spec in a month", "2026-11-12"],
    ["Spec oct 20", "2026-10-20"],
    ["Spec October 20th", "2026-10-20"],
    ["Spec 20 oct", "2026-10-20"],
    ["Spec 1 jan", "2027-01-01"], // next occurrence
    ["Spec oct 1", "2027-10-01"], // already passed this year
    ["Spec 20.10.", "2026-10-20"], // Czech
    ["Spec 20. 10.", "2026-10-20"],
    ["Spec 20.10.2027", "2027-10-20"],
    ["Spec 2026-10-20", "2026-10-20"],
  ])("%s → %s", (input, date) => {
    const r = p(input);
    expect(r.dueDate).toBe(date);
    expect(r.title).toBe("Spec");
  });

  it("rejects impossible dates and keeps them as text", () => {
    expect(p("Spec 31.02.").dueDate).toBeNull();
    expect(p("Spec 31.02.").title).toBe("Spec 31.02.");
    expect(p("Bump to 2.5").dueDate).toBeNull();
  });

  it("only matches whole words", () => {
    expect(p("Update todays digest").dueDate).toBeNull();
    expect(p("Fix monitor layout").dueDate).toBeNull();
  });
});

describe("due times (§12.4 row 2)", () => {
  it.each([
    ["Call 3pm", "2026-10-12", "15:00"], // later today
    ["Call 9am", "2026-10-13", "09:00"], // passed, so tomorrow
    ["Call 15:30", "2026-10-12", "15:30"],
    ["Call at 9", "2026-10-13", "09:00"],
    ["Call at 16", "2026-10-12", "16:00"],
    ["Call tomorrow 3pm", "2026-10-13", "15:00"],
    ["Call fri at 10:15am", "2026-10-16", "10:15"],
    ["Call 12am", "2026-10-13", "00:00"],
    ["Call 12pm", "2026-10-13", "12:00"],
  ])("%s → %s %s", (input, date, time) => {
    const r = p(input);
    expect(r.dueTime).toBe(time);
    expect(r.dueDate).toBe(date);
    expect(r.title).toBe("Call");
  });

  it("a time alone means today, or tomorrow if it has passed", () => {
    expect(p("Call 3pm").dueDate).toBe("2026-10-12");
    expect(p("Call 9am").dueDate).toBe("2026-10-13");
  });

  it("does not read bare numbers as times", () => {
    expect(p("Review 3 PRs").dueTime).toBeNull();
    expect(p("Review 3 PRs").title).toBe("Review 3 PRs");
  });
});

describe("recurrence (§12.4 row 3, §12.5)", () => {
  it.each([
    ["Standup every day", "FREQ=DAILY", "2026-10-12", false],
    ["Standup daily", "FREQ=DAILY", "2026-10-12", false],
    ["Standup every 2 days", "FREQ=DAILY;INTERVAL=2", "2026-10-12", false],
    ["Standup every weekday", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "2026-10-12", false],
    ["Standup every friday", "FREQ=WEEKLY;BYDAY=FR", "2026-10-16", false],
    ["Standup every monday", "FREQ=WEEKLY;BYDAY=MO", "2026-10-12", false], // today is Monday
    ["Standup every other tue", "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", "2026-10-13", false],
    ["Standup every 2 weeks", "FREQ=WEEKLY;INTERVAL=2", "2026-10-12", false],
    ["Standup every month on the 1st", "FREQ=MONTHLY;BYMONTHDAY=1", "2026-11-01", false],
    ["Standup every month on the 20th", "FREQ=MONTHLY;BYMONTHDAY=20", "2026-10-20", false],
    ["Standup every year", "FREQ=YEARLY", "2026-10-12", false],
    ["Standup every! 3 days", "FREQ=DAILY;INTERVAL=3", "2026-10-12", true],
  ])("%s → %s from %s", (input, rule, first, fromCompletion) => {
    const r = p(input);
    expect(r.recurrence).toMatchObject({ rule, fromCompletion });
    expect(r.dueDate).toBe(first);
    expect(r.title).toBe("Standup");
  });

  it("combines with a time and an explicit start date", () => {
    const r = p("Standup every friday at 9am");
    expect(r.recurrence?.rule).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(r.dueTime).toBe("09:00");
    expect(r.dueDate).toBe("2026-10-16");
    expect(p("Report every month starting 1 nov").dueDate).toBe("2026-11-01");
  });
});

describe("priority, labels, projects, links, assignee (§12.4 rows 4–8)", () => {
  it.each([
    ["Fix p1", 1],
    ["Fix urgent", 1],
    ["Fix P2", 2],
    ["Fix high", 2],
    ["Fix medium", 3],
    ["Fix med", 3],
    ["Fix p3", 3],
    ["Fix low", 4],
    ["Fix p4", 4],
  ])("%s → P%i", (input, prio) => {
    expect(p(input).priority).toBe(prio);
    expect(p(input).title).toBe("Fix");
  });

  it("does not match priority words inside other words", () => {
    expect(p("Fix highlight colour").priority).toBeNull();
    expect(p("Fix p12 build").priority).toBeNull();
  });

  it("labels repeat; unknown labels are still labels", () => {
    const r = p("Spec +design +spec +design");
    expect(r.labels).toEqual(["design", "spec"]);
    expect(r.title).toBe("Spec");
    expect(p("Mail dave@example.com").labels).toEqual([]);
    expect(p("Vote +1 on C++ +2 more").labels).toEqual([]);
  });

  it("projects match known names, longest first; unknown stays text", () => {
    expect(p("Write =Specs to finish").project).toBe("Specs to finish");
    expect(p("Write =Specs to finish").title).toBe("Write");
    expect(p("Write =specs").project).toBe("Specs");
    expect(p("Write =PR reviews now").project).toBe("PR reviews");
    const unknown = p("Write =Roadmap");
    expect(unknown.project).toBeNull();
    expect(unknown.title).toBe("Write =Roadmap");
    expect(p("Write #Specs").project).toBeNull();
    expect(p("Check a=Specs").project).toBeNull();
  });

  it("#digits link known issues and PRs, several allowed; unknown numbers stay text", () => {
    const r = p("Review #1234 and #5678 #999");
    expect(r.links).toEqual([1234, 5678]);
    expect(r.title).toBe("Review and #999");
  });

  it("pasted widgets URLs become links; other repos stay text", () => {
    const r = p("Look at https://github.com/acme/widgets/pull/5678#discussion_r1 and https://github.com/other/repo/issues/101");
    expect(r.links).toEqual([5678]);
    expect(r.title).toBe("Look at and https://github.com/other/repo/issues/101");
  });

  it("@login assigns a known user, once", () => {
    const r = p("Ask @bob @alice");
    expect(r.assignee).toBe("bob");
    expect(r.title).toBe("Ask @alice");
    expect(p("Ask @stranger").assignee).toBeNull();
  });
});

describe("the full example and ambiguity", () => {
  it("parses the spec example", () => {
    const r = p("Finish spec #1234 tomorrow 3pm high +spec =Specs @bob every friday");
    expect(r).toMatchObject({
      title: "Finish spec",
      dueDate: "2026-10-13",
      dueTime: "15:00",
      priority: 2,
      labels: ["spec"],
      project: "Specs",
      links: [1234],
      assignee: "bob",
      recurrence: { rule: "FREQ=WEEKLY;BYDAY=FR", fromCompletion: false },
    });
  });

  it("first match wins; later ones stay text", () => {
    const r = p("Ship today high tomorrow low");
    expect(r.dueDate).toBe("2026-10-12");
    expect(r.priority).toBe(2);
    expect(r.title).toBe("Ship tomorrow low");
  });

  it("a reverted token stays in the title", () => {
    const input = "Review low battery warning";
    expect(p(input).priority).toBe(4);
    const r = p(input, { ignored: new Set([tokenKey("priority", "low")]) });
    expect(r.priority).toBeNull();
    expect(r.title).toBe("Review low battery warning");
  });

  it("reverting the first match lets a later one count", () => {
    const r = p("Fix low priority bug high", { ignored: new Set([tokenKey("priority", "low")]) });
    expect(r.priority).toBe(2);
    expect(r.title).toBe("Fix low priority bug");
  });

  it("reports token ranges for highlighting", () => {
    const input = "Spec tomorrow p1";
    const r = p(input);
    expect(r.tokens.map((t) => [t.kind, input.slice(t.start, t.end)])).toEqual([
      ["date", "tomorrow"],
      ["priority", "p1"],
    ]);
  });

  it("uses the viewer's today", () => {
    expect(p("Spec tomorrow", { today: "2026-12-31" }).dueDate).toBe("2027-01-01");
    expect(p("Spec fri", { today: "2026-10-16" }).dueDate).toBe("2026-10-23");
  });

  it("parses a 120-character input in under 2 ms", () => {
    const input = "Finish the send flow spec #1234 tomorrow at 3pm high +spec +design =Specs to finish @bob every friday plus notes";
    for (let i = 0; i < 20; i++) p(input);
    const t0 = performance.now();
    const runs = 200;
    for (let i = 0; i < runs; i++) p(input);
    expect((performance.now() - t0) / runs).toBeLessThan(2);
  });

describe("recurrence start and rejects (v5 2.11)", () => {
  // Monday 12 Oct 2026, 14:00 (ctx).
  it("a recurrence whose time has passed today starts at its next occurrence", () => {
    expect(p("Standup every day at 9").dueDate).toBe("2026-10-13"); // 09:00 < 14:00
    expect(p("Standup every day at 3pm").dueDate).toBe("2026-10-12"); // 15:00 is still ahead
    expect(p("Standup every monday at 9").dueDate).toBe("2026-10-19"); // today is Monday: next Monday
    expect(p("Standup every weekday at 9").dueDate).toBe("2026-10-13");
    expect(p("Standup every friday at 9").dueDate).toBe("2026-10-16"); // not today: unchanged
    expect(p("Standup every day at 9 tomorrow").dueDate).toBe("2026-10-13"); // an explicit date wins
  });

  it("leaves 'every other weekday' and 'every 3 weekdays' as text instead of saving every weekday", () => {
    for (const input of ["Standup every other weekday", "Standup every 3 weekdays"]) {
      const r = p(input);
      expect(r.recurrence).toBeNull();
      expect(r.title).toBe(input);
    }
    expect(p("Standup every weekday").recurrence?.rule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(p("Standup every other tue").recurrence?.rule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU");
  });
});
});
