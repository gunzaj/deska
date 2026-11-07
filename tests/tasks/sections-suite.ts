// D13 (SPEC §4.6): sections, the Completed view and task search through the
// service. One body, run on the in-memory repo (sections.test.ts) and on
// PostgresTaskRepo over PGlite (sections.pg.test.ts), so both stay equal.
import { beforeEach, describe, expect, it } from "vitest";
import { addComment, createProject, createSection, createTask, deleteSection, deleteTask, listCompleted, listTasks, removeComment, searchTasks, updateSection, updateTask } from "@/lib/tasks/service";
import type { CreateTaskInput, PatchTaskInput, Task } from "@/lib/tasks/model";
import { createTaskSchema } from "@/lib/tasks/model";

const me = "local";
const new_ = (over: Partial<CreateTaskInput> & { title: string }) => createTaskSchema.parse(over);

async function ok<T>(p: Promise<{ ok: true; value: T } | { ok: false; status: number; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.value;
}
const task = (over: Partial<CreateTaskInput> & { title: string }) => ok(createTask(me, new_(over)));
const patch = (id: string, p: PatchTaskInput) => ok(updateTask(me, id, p));
const project = (name: string) => ok(createProject(me, { name, color: "blue" }));
const byId = async (id: string): Promise<Task> => (await listTasks(me)).tasks.find((t) => t.id === id)!;

export function defineSectionTests(reset: () => Promise<void> | void): void {
  beforeEach(async () => {
    await reset();
  });

  describe("sections", () => {
    it("are created at the end, renamed, reordered and collapsed, and listed in order", async () => {
      const p = await project("Launch");
      const a = await ok(createSection(me, { projectId: p.id, name: "Design" }));
      const b = await ok(createSection(me, { projectId: p.id, name: "Build" }));
      expect(b.position).toBeGreaterThan(a.position);
      expect(a.collapsed).toBe(false);
      await ok(updateSection(me, a.id, { name: "Discovery", collapsed: true }));
      await ok(updateSection(me, b.id, { position: a.position - 1 }));
      const { sections } = await listTasks(me);
      expect(sections.map((s) => [s.name, s.collapsed])).toEqual([
        ["Build", false],
        ["Discovery", true],
      ]);
    });

    it("refuse an unknown or archived project and an unknown section", async () => {
      const p = await project("Old");
      await ok(import("@/lib/tasks/service").then((m) => m.updateProject(me, p.id, { archived: true })));
      expect((await createSection(me, { projectId: p.id, name: "x" })).ok).toBe(false);
      expect((await createSection(me, { projectId: "00000000-0000-4000-8000-000000000000", name: "x" })).ok).toBe(false);
      expect((await updateSection(me, "00000000-0000-4000-8000-000000000000", { name: "x" })).ok).toBe(false);
      expect((await deleteSection(me, "not-a-uuid")).ok).toBe(false);
    });

    it("hold tasks: created into one, moved between two, and out of the section by a project move", async () => {
      const p = await project("Launch");
      const q = await project("Other");
      const a = await ok(createSection(me, { projectId: p.id, name: "A" }));
      const b = await ok(createSection(me, { projectId: p.id, name: "B" }));
      const t = await task({ title: "Write copy", projectId: p.id, sectionId: a.id });
      expect(t.sectionId).toBe(a.id);
      expect((await patch(t.id, { sectionId: b.id })).sectionId).toBe(b.id);
      expect((await patch(t.id, { sectionId: null })).sectionId).toBeNull();
      await patch(t.id, { sectionId: a.id });
      // Another project: the old section goes, the project changes.
      const moved = await patch(t.id, { projectId: q.id });
      expect(moved).toMatchObject({ projectId: q.id, sectionId: null });
      expect((await byId(t.id)).sectionId).toBeNull();
    });

    it("only fit their own project, and only top-level tasks", async () => {
      const p = await project("Launch");
      const q = await project("Other");
      const a = await ok(createSection(me, { projectId: p.id, name: "A" }));
      expect((await createTask(me, new_({ title: "x", projectId: q.id, sectionId: a.id }))).ok).toBe(false);
      expect((await createTask(me, new_({ title: "x", sectionId: a.id }))).ok).toBe(false); // Inbox
      const t = await task({ title: "in q", projectId: q.id });
      expect((await updateTask(me, t.id, { sectionId: a.id })).ok).toBe(false);
      // Naming the new project and its section in one patch is fine.
      expect((await patch(t.id, { projectId: p.id, sectionId: a.id })).sectionId).toBe(a.id);
      const parent = await task({ title: "parent", projectId: p.id, sectionId: a.id });
      const child = await task({ title: "child", parentId: parent.id });
      expect((await updateTask(me, child.id, { projectId: p.id, sectionId: a.id })).ok).toBe(false);
      expect((await createTask(me, new_({ title: "kid", parentId: parent.id, projectId: p.id, sectionId: a.id }))).ok).toBe(false);
    });

    it("deleting one keeps its tasks in the project, without a section", async () => {
      const p = await project("Launch");
      const a = await ok(createSection(me, { projectId: p.id, name: "A" }));
      const t = await task({ title: "keep me", projectId: p.id, sectionId: a.id });
      await ok(deleteSection(me, a.id));
      expect((await listTasks(me)).sections).toEqual([]);
      expect(await byId(t.id)).toMatchObject({ title: "keep me", projectId: p.id, sectionId: null });
    });
  });

  describe("completed view", () => {
    it("lists the last 30 days newest first; un-completing returns the task to its project and section", async () => {
      const p = await project("Launch");
      const s = await ok(createSection(me, { projectId: p.id, name: "Build" }));
      const first = await task({ title: "first", projectId: p.id, sectionId: s.id });
      const second = await task({ title: "second", projectId: p.id, sectionId: s.id });
      await task({ title: "still open", projectId: p.id });
      await patch(first.id, { completed: true });
      await new Promise((r) => setTimeout(r, 5));
      await patch(second.id, { completed: true });
      const { items } = await listCompleted(me);
      expect(items.map((i) => i.task.title)).toEqual(["second", "first"]);
      expect(items.every((i) => i.occurrence === null && i.undoable)).toBe(true);
      // Outside the window they're gone.
      expect((await listCompleted(me, new Date(Date.now() + 31 * 86_400_000))).items).toEqual([]);

      const back = await patch(first.id, { completed: false });
      expect(back).toMatchObject({ completedAt: null, projectId: p.id, sectionId: s.id, position: first.position });
      expect((await listCompleted(me)).items.map((i) => i.task.title)).toEqual(["second"]);
    });

    it("leaves out deleted tasks", async () => {
      const t = await task({ title: "gone" });
      await patch(t.id, { completed: true });
      await ok(deleteTask(me, t.id));
      expect((await listCompleted(me)).items).toEqual([]);
    });

    it("shows each completed occurrence of a recurring task, and only the newest can be taken back", async () => {
      const t = await task({ title: "Water plants", dueDate: "2030-01-10", recurrence: { rule: "FREQ=DAILY", text: "every day", fromCompletion: false } });
      const one = await patch(t.id, { completed: true });
      expect(one.dueDate).toBe("2030-01-11");
      await new Promise((r) => setTimeout(r, 5));
      await patch(t.id, { completed: true });
      const { items } = await listCompleted(me);
      expect(items.map((i) => [i.occurrence, i.undoable])).toEqual([
        ["2030-01-11", true],
        ["2030-01-10", false],
      ]);
      // Taking the newest back moves the date back and removes that line.
      expect((await patch(t.id, { undoOccurrence: "2030-01-11" })).dueDate).toBe("2030-01-11");
      const after = await listCompleted(me);
      expect(after.items.map((i) => [i.occurrence, i.undoable])).toEqual([["2030-01-10", true]]);
    });
  });

  describe("task search", () => {
    it("finds a word only in the description or in a comment, and says where", async () => {
      const t = await task({ title: "Quarterly review", description: "needs the **zebra** report" });
      const c = await task({ title: "Other thing" });
      await ok(addComment(me, c.id, "ask about the giraffe numbers"));
      const inDesc = await searchTasks(me, "zebra");
      expect(inDesc.hits.map((h) => [h.task.id, h.in])).toEqual([[t.id, "description"]]);
      const inComment = await searchTasks(me, "GIRAFFE");
      expect(inComment.hits.map((h) => [h.task.id, h.in])).toEqual([[c.id, "comment"]]);
      expect((await searchTasks(me, "quarterly")).hits.map((h) => h.in)).toEqual(["title"]);
    });

    it("needs every word, ignores deleted comments and deleted tasks", async () => {
      const t = await task({ title: "Spec", description: "alpha" });
      const note = await ok(addComment(me, t.id, "beta"));
      expect((await searchTasks(me, "alpha beta")).hits.map((h) => h.task.id)).toEqual([t.id]);
      expect((await searchTasks(me, "alpha gamma")).hits).toEqual([]);
      await ok(removeComment(me, t.id, note.id));
      expect((await searchTasks(me, "beta")).hits).toEqual([]);
      await ok(deleteTask(me, t.id));
      expect((await searchTasks(me, "alpha")).hits).toEqual([]);
      expect((await searchTasks(me, "   ")).hits).toEqual([]);
    });

    it("treats % and _ as plain characters and lists open tasks first", async () => {
      const a = await task({ title: "done 100% sure" });
      await patch(a.id, { completed: true });
      const b = await task({ title: "open 100% plan" });
      await task({ title: "open 1000 plan" });
      expect((await searchTasks(me, "100%")).hits.map((h) => h.task.id)).toEqual([b.id, a.id]);
      expect((await searchTasks(me, "a_b")).hits).toEqual([]);
    });
  });
}
