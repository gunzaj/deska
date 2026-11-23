import { describe, expect, it } from "vitest";
import { createStore } from "@/components/app/tab-store";
import { currentUrl } from "@/lib/client/tabs";

const saved = { tabs: [{ entries: ["/my"], index: 0 }, { entries: ["/backlog", "/issues/100"], index: 1 }], active: 1 };
const urls = (s: ReturnType<ReturnType<typeof createStore>["get"]>) => s.tabs.map((t) => currentUrl(t));

describe("tab store", () => {
  it("restores the saved tabs on the first URL even when the strip read the store first", () => {
    const store = createStore(saved, true);
    const went: string[] = [];
    store.setNavigate((u) => went.push(u));
    // The strip renders (and reads the store) before the URL sync's effect runs.
    expect(store.get().tabs).toHaveLength(1);
    store.observe("/my");
    expect(urls(store.get())).toEqual(["/my", "/issues/100"]);
    expect(went).toEqual(["/issues/100"]);
    // Arriving there is the tab's own navigation, not a new step.
    store.observe("/issues/100");
    expect(store.get().tabs[1]!.entries).toEqual(["/backlog", "/issues/100"]);
  });

  it("without persistence it starts with one tab on the URL shown", () => {
    const store = createStore(saved, false);
    store.observe("/epics");
    expect(urls(store.get())).toEqual(["/epics"]);
  });

  it("a background open keeps the window where it is; switching navigates to the tab", () => {
    const store = createStore(null, false);
    const went: string[] = [];
    store.setNavigate((u) => went.push(u));
    store.observe("/backlog?issue=100");
    store.openIssue(101, false);
    expect(went).toEqual([]);
    const [, child] = store.get().tabs;
    store.switchTo(child!.id);
    expect(went).toEqual(["/issues/101"]);
    store.observe("/issues/101");
    store.number(1);
    expect(went).toEqual(["/issues/101", "/backlog?issue=100"]);
  });

  it("a tab opened on the URL already shown leaves nothing pending: the next page is a new step", () => {
    const store = createStore(null, false);
    const went: string[] = [];
    store.setNavigate((u) => went.push(u));
    store.observe("/my");
    store.open("/my#top", true);
    expect(went).toEqual([]);
    store.observe("/backlog");
    expect(store.get().tabs[1]!.entries).toEqual(["/my", "/backlog"]);
  });

  it("the same URL observed twice (an effect run twice) does not end a restore's navigation", () => {
    const store = createStore(saved, true);
    store.setNavigate(() => {});
    store.observe("/my");
    store.observe("/my");
    store.observe("/issues/100");
    expect(store.get().tabs[1]!.entries).toEqual(["/backlog", "/issues/100"]);
  });

  it("pages outside the shell are not opened; a flash and a title reach subscribers without a tab change", () => {
    const store = createStore(null, false);
    store.observe("/backlog");
    store.open("/onboarding", true);
    expect(store.get().tabs).toHaveLength(1);
    store.openIssue(101, false);
    const tabs = store.get();
    let calls = 0;
    store.subscribe(() => (calls += 1));
    const first = store.flash();
    store.openIssue(101, false);
    expect(store.get()).toBe(tabs);
    expect(store.flash()).not.toBe(first);
    expect(calls).toBe(1);
    const v = store.titleVersion();
    store.setTitle(tabs.active, "/backlog", "Backlog");
    expect(store.titleVersion()).toBe(v + 1);
    expect(store.title("/backlog")).toBe("Backlog");
    expect(calls).toBe(2);
  });

  it("a redirect on the way to a tab replaces the entry it asked for", () => {
    const store = createStore(null, false);
    store.setNavigate(() => {});
    store.observe("/backlog");
    store.open("/", true);
    store.observe("/my");
    expect(store.get().tabs[1]!.entries).toEqual(["/my"]);
  });
});
