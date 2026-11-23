import { describe, expect, it } from "vitest";
import {
  activateNumber,
  activeTab,
  classifyNav,
  closeTab,
  currentUrl,
  cycle,
  initTabs,
  isTabUrl,
  MAX_TABS,
  normalizeUrl,
  openTab,
  parseSaved,
  recordNavigation,
  reopenClosed,
  restore,
  serialize,
  step,
  type TabsState,
} from "@/lib/client/tabs";

const urls = (s: TabsState) => s.tabs.map((t) => currentUrl(t));

describe("tab history", () => {
  it("a new page and opening a side panel are history steps; the rest replaces", () => {
    expect(classifyNav("/my", "/backlog")).toBe("push");
    expect(classifyNav("/backlog", "/backlog?issue=100")).toBe("push");
    expect(classifyNav("/backlog?issue=100", "/backlog?issue=101")).toBe("replace");
    expect(classifyNav("/backlog?issue=100", "/backlog")).toBe("replace");
    expect(classifyNav("/issues?s=a", "/issues?s=b")).toBe("replace");
  });

  it("closing a panel lands on the step before it opened, and Back/Forward walk the tab's own entries", () => {
    let s = initTabs("/my");
    s = recordNavigation(s, "/backlog");
    s = recordNavigation(s, "/backlog?issue=100");
    s = recordNavigation(s, "/backlog?issue=101");
    expect(activeTab(s).entries).toEqual(["/my", "/backlog", "/backlog?issue=101"]);
    s = recordNavigation(s, "/backlog");
    expect(activeTab(s).entries).toEqual(["/my", "/backlog"]);
    s = step(s, -1);
    expect(currentUrl(activeTab(s))).toBe("/my");
    s = step(s, -1);
    expect(currentUrl(activeTab(s))).toBe("/my");
    s = step(s, 1);
    expect(currentUrl(activeTab(s))).toBe("/backlog");
    // A new page after Back drops the forward entries, like a browser.
    s = step(s, -1);
    s = recordNavigation(s, "/epics");
    expect(activeTab(s).entries).toEqual(["/my", "/epics"]);
  });

  it("each tab keeps its own history", () => {
    let s = initTabs("/my");
    s = recordNavigation(s, "/backlog");
    s = openTab(s, "/issues/100", true).state;
    s = recordNavigation(s, "/issues/101");
    expect(activeTab(s).entries).toEqual(["/issues/100", "/issues/101"]);
    s = cycle(s, -1);
    expect(activeTab(s).entries).toEqual(["/my", "/backlog"]);
  });
});

describe("opening and closing tabs", () => {
  it("background tabs open after the active tab and the tabs it already opened, in order", () => {
    let s = restore({ tabs: [{ entries: ["/backlog"], index: 0 }, { entries: ["/my"], index: 0 }], active: 0 }, "/backlog", true);
    s = openTab(s, "/issues/101", false).state;
    s = openTab(s, "/issues/102", false).state;
    expect(urls(s)).toEqual(["/backlog", "/issues/101", "/issues/102", "/my"]);
    expect(currentUrl(activeTab(s))).toBe("/backlog");
  });

  it("an issue already open in a tab is found, not opened twice; ⇧ switches to it", () => {
    let s = initTabs("/backlog");
    const first = openTab(s, "/issues/101", false);
    s = first.state;
    const again = openTab(s, "/issues/101?issue=7", false);
    expect(again.existing).toBe(true);
    expect(again.id).toBe(first.id);
    expect(again.state.tabs).toHaveLength(2);
    expect(openTab(s, "/issues/101", true).state.active).toBe(first.id);
    // Pages other than an issue may be open twice.
    expect(openTab(s, "/backlog", false).state.tabs).toHaveLength(3);
  });

  it("refuses past the tab limit", () => {
    let s = initTabs("/my");
    for (let n = 1; n < MAX_TABS; n++) s = openTab(s, `/issues/${n}`, false).state;
    const r = openTab(s, "/issues/9999", false);
    expect(r.full).toBe(true);
    expect(r.state).toBe(s);
  });

  it("closing the active tab goes to its next sibling, else back to its opener; ⌘⇧T reopens it", () => {
    let s = initTabs("/backlog");
    const home = s.active;
    s = openTab(s, "/issues/101", false).state;
    s = openTab(s, "/issues/102", false).state;
    s = activateNumber(s, 2);
    s = closeTab(s, s.active);
    expect(currentUrl(activeTab(s))).toBe("/issues/102");
    s = closeTab(s, s.active);
    expect(s.active).toBe(home);
    expect(s.closed.map((t) => currentUrl(t))).toEqual(["/issues/101", "/issues/102"]);
    s = reopenClosed(s);
    expect(currentUrl(activeTab(s))).toBe("/issues/102");
    expect(s.closed).toHaveLength(1);
    // Back where it stood, not next to the active tab.
    s = reopenClosed(s);
    expect(urls(s)).toEqual(["/backlog", "/issues/101", "/issues/102"]);
  });

  it("the last tab never closes", () => {
    const s = initTabs("/my");
    expect(closeTab(s, s.active)).toBe(s);
  });

  it("⌘9 is the last tab, ⌘1–8 by place; cycling wraps around", () => {
    let s = initTabs("/a");
    for (const u of ["/b", "/c", "/d"]) s = openTab(s, u, true).state;
    expect(currentUrl(activeTab(activateNumber(s, 9)))).toBe("/d");
    expect(currentUrl(activeTab(activateNumber(s, 2)))).toBe("/b");
    expect(activateNumber(s, 7)).toBe(s);
    expect(currentUrl(activeTab(cycle(activateNumber(s, 9), 1)))).toBe("/a");
    expect(currentUrl(activeTab(cycle(activateNumber(s, 1), -1)))).toBe("/d");
  });
});

describe("tab URLs", () => {
  it("only pages inside the app shell can be tabs", () => {
    for (const u of ["/my", "/issues/100?issue=101", "/tasks/p/abc", "/onboardingx"]) expect(isTabUrl(u)).toBe(true);
    for (const u of ["/onboarding", "/onboarding?step=2", "/importing", "/quick-add", "/api/local-data/export", "//evil.example", "https://evil.example/", null]) expect(isTabUrl(u)).toBe(false);
  });

  it("are compared in the form the window reports them", () => {
    expect(normalizeUrl("/views/x?s=a%20b#top")).toBe("/views/x?s=a+b");
    expect(normalizeUrl("/backlog#x")).toBe("/backlog");
    expect(normalizeUrl("/backlog?")).toBe("/backlog");
    expect(normalizeUrl("/issues/100?issue=101")).toBe("/issues/100?issue=101");
  });
});

describe("saved tabs", () => {
  it("a URL too long to keep is dropped from the save, and the entry shown stays the one shown", () => {
    const long = `/issues?s=${"x".repeat(2100)}`;
    let s = initTabs("/my");
    s = recordNavigation(s, long);
    s = recordNavigation(s, "/backlog");
    s = openTab(s, "/onboarding", false).state;
    const saved = serialize(s);
    expect(saved).toEqual({ tabs: [{ entries: ["/my", "/backlog"], index: 1 }], active: 0 });
    expect(parseSaved(saved)).toEqual(saved);
    // The step shown was the dropped one: the nearest earlier step is shown.
    expect(serialize(step(s, -1)).tabs[0]).toEqual({ entries: ["/my", "/backlog"], index: 0 });
  });

  it("round-trips and drops anything that is not an in-app URL", () => {
    let s = initTabs("/my");
    s = openTab(s, "/issues/101", true).state;
    expect(parseSaved(serialize(s))).toEqual({ tabs: [{ entries: ["/my"], index: 0 }, { entries: ["/issues/101"], index: 0 }], active: 1 });
    expect(
      parseSaved({
        tabs: [{ entries: ["//evil.example/x", "https://evil.example/", "/epics", 4], index: 9 }, { entries: [], index: 0 }, "junk"],
        active: 5,
      }),
    ).toEqual({ tabs: [{ entries: ["/epics"], index: 0 }], active: 0 });
    expect(parseSaved(null)).toBeNull();
    expect(parseSaved({ tabs: [] })).toBeNull();
  });

  it("launching on the home page shows the saved active tab; a specific launch URL opens in it", () => {
    const saved = { tabs: [{ entries: ["/my"], index: 0 }, { entries: ["/issues/100"], index: 0 }], active: 1 };
    expect(urls(restore(saved, "/my", true))).toEqual(["/my", "/issues/100"]);
    expect(currentUrl(activeTab(restore(saved, "/my", true)))).toBe("/issues/100");
    const fromReminder = restore(saved, "/tasks?task=abc", false);
    expect(currentUrl(activeTab(fromReminder))).toBe("/tasks?task=abc");
    expect(activeTab(fromReminder).entries).toEqual(["/issues/100", "/tasks?task=abc"]);
    expect(urls(restore(null, "/backlog", true))).toEqual(["/backlog"]);
  });
});
