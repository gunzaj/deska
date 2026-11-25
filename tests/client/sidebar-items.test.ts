import { describe, expect, it } from "vitest";
import { arrangeSidebar, DEFAULT_FAVORITES, dropItem, toggleFavorite, type Keyed } from "@/lib/client/sidebar-items";
import { prefsSchema, type SidebarLayout, type SidebarSection } from "@/lib/tasks/model";

const item = (key: string, home: SidebarSection): Keyed => ({ key, home });
const ITEMS = [
  item("/home", "workspace"),
  item("/triage", "workspace"),
  item("/my", "workspace"),
  item("/watching", "workspace"),
  item("/issues", "workspace"),
  item("/epics", "workspace"),
  item("/tasks", "tasks"),
  item("/tasks/today", "tasks"),
  item("/tasks/p/a", "projects"),
  item("/tasks/p/b", "projects"),
  item("/tasks/p/c", "projects"),
  item("/views/1", "views"),
  item("/views/2", "views"),
];
const exists = (key: string) => ITEMS.some((i) => i.key === key);
const keys = (layout: SidebarLayout | null) => {
  const lists = arrangeSidebar(ITEMS, layout);
  return { favorites: lists.favorites.map((i) => i.key), sections: Object.fromEntries(Object.entries(lists.sections).map(([id, l]) => [id, l.map((i) => i.key)])) as Record<SidebarSection, string[]> };
};
const layout = (more: Partial<SidebarLayout>): SidebarLayout => ({ order: [], hidden: [], ...more });

describe("sidebar favorites", () => {
  it("starts with Home, Triage, My issues and Watching; everything else is in its section", () => {
    const out = keys(null);
    expect(out.favorites).toEqual(DEFAULT_FAVORITES);
    expect(out.sections.workspace).toEqual(["/issues", "/epics"]);
    expect(out.sections.projects).toEqual(["/tasks/p/a", "/tasks/p/b", "/tasks/p/c"]);
  });

  it("an unstarred default returns to the top of the GitHub lists", () => {
    const next = layout(toggleFavorite(null, keys(null).favorites, "/triage", exists));
    expect(next.favorites).toEqual(["/home", "/my", "/watching"]);
    expect(keys(next).sections.workspace).toEqual(["/triage", "/issues", "/epics"]);
  });

  it("a starred item moves to the end of Favorites and leaves its section", () => {
    const next = layout(toggleFavorite(null, keys(null).favorites, "/tasks/p/b", exists));
    const out = keys(next);
    expect(out.favorites).toEqual([...DEFAULT_FAVORITES, "/tasks/p/b"]);
    expect(out.sections.projects).toEqual(["/tasks/p/a", "/tasks/p/c"]);
  });

  it("every favorite can be removed", () => {
    let l: SidebarLayout | null = null;
    for (const key of DEFAULT_FAVORITES) l = layout(toggleFavorite(l, keys(l).favorites, key, exists));
    expect(keys(l).favorites).toEqual([]);
    expect(keys(l).sections.workspace.slice(0, 4)).toEqual(DEFAULT_FAVORITES);
  });

  it("keeps a built-in favorite that is not shown now, and drops one whose page is gone", () => {
    const stored = layout({ favorites: ["/home", "/backlog", "/views/deleted", "/my"] });
    const next = toggleFavorite(stored, keys(stored).favorites, "/views/1", exists);
    expect(next.favorites).toEqual(["/home", "/backlog", "/my", "/views/1"]);
  });
});

describe("sidebar drag and drop", () => {
  const drop = (l: SidebarLayout | null, drag: Parameters<typeof dropItem>[2], to: Parameters<typeof dropItem>[3]) => {
    const change = dropItem(l, keys(l), drag, to, exists);
    return change && layout({ ...l, ...change });
  };

  it("reorders inside a section", () => {
    const next = drop(null, { key: "/tasks/p/c", home: "projects", from: "projects" }, { list: "projects", target: "/tasks/p/a", after: false });
    expect(keys(next).sections.projects).toEqual(["/tasks/p/c", "/tasks/p/a", "/tasks/p/b"]);
    const again = drop(next, { key: "/tasks/p/c", home: "projects", from: "projects" }, { list: "projects", target: null, after: true });
    expect(keys(again).sections.projects).toEqual(["/tasks/p/a", "/tasks/p/b", "/tasks/p/c"]);
  });

  it("reorders Favorites", () => {
    const next = drop(null, { key: "/watching", home: "workspace", from: "favorites" }, { list: "favorites", target: "/home", after: true });
    expect(keys(next).favorites).toEqual(["/home", "/watching", "/triage", "/my"]);
  });

  it("a drop on Favorites stars the item where it was dropped", () => {
    const next = drop(null, { key: "/views/2", home: "views", from: "views" }, { list: "favorites", target: "/triage", after: false });
    expect(keys(next).favorites).toEqual(["/home", "/views/2", "/triage", "/my", "/watching"]);
    expect(keys(next).sections.views).toEqual(["/views/1"]);
  });

  it("a favorite dropped on its own section is unstarred there", () => {
    const next = drop(null, { key: "/my", home: "workspace", from: "favorites" }, { list: "workspace", target: "/issues", after: true });
    expect(keys(next).favorites).toEqual(["/home", "/triage", "/watching"]);
    expect(keys(next).sections.workspace).toEqual(["/issues", "/my", "/epics"]);
  });

  it("refuses a drop on another section, and one that moves nothing", () => {
    expect(drop(null, { key: "/views/1", home: "views", from: "views" }, { list: "projects", target: null, after: true })).toBeNull();
    expect(drop(null, { key: "/views/1", home: "views", from: "views" }, { list: "views", target: "/views/1", after: true })).toBeNull();
  });

  it("a starred project keeps its slot in Projects for when it is unstarred", () => {
    const ordered = drop(null, { key: "/tasks/p/c", home: "projects", from: "projects" }, { list: "projects", target: "/tasks/p/a", after: true });
    const starred = layout({ ...ordered, ...toggleFavorite(ordered, keys(ordered).favorites, "/tasks/p/c", exists) });
    const moved = drop(starred, { key: "/tasks/p/b", home: "projects", from: "projects" }, { list: "projects", target: "/tasks/p/a", after: false });
    expect(keys(moved).sections.projects).toEqual(["/tasks/p/b", "/tasks/p/a"]);
    const back = layout({ ...moved, ...toggleFavorite(moved, keys(moved).favorites, "/tasks/p/c", exists) });
    expect(keys(back).sections.projects).toEqual(["/tasks/p/b", "/tasks/p/a", "/tasks/p/c"]);
  });

  it("an item created later comes after the ordered ones", () => {
    const next = drop(null, { key: "/views/2", home: "views", from: "views" }, { list: "views", target: "/views/1", after: false });
    const lists = arrangeSidebar([...ITEMS, item("/views/3", "views")], next);
    expect(lists.sections.views.map((i) => i.key)).toEqual(["/views/2", "/views/1", "/views/3"]);
  });
});

describe("stored sidebar layout", () => {
  it("accepts favorites and item orders, and layouts stored before they existed", () => {
    expect(prefsSchema.safeParse({ sidebar: { order: [], hidden: [] } }).success).toBe(true);
    expect(prefsSchema.safeParse({ sidebar: { order: [], hidden: [], favorites: ["/home"], items: { projects: ["/tasks/p/a"] } } }).success).toBe(true);
    expect(prefsSchema.safeParse({ sidebar: { order: [], hidden: [], items: { nope: [] } } }).success).toBe(false);
    expect(prefsSchema.safeParse({ sidebar: { order: [], hidden: [], favorites: [""] } }).success).toBe(false);
  });
});
