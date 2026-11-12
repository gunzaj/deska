// S11: GitHubWriteClient against GitHub mocked with MSW (SPEC §7). No request
// leaves the process: unhandled requests fail the test.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { readFileSync } from "node:fs";
import {
  ALLOWED_MUTATIONS,
  ALLOWED_REST_WRITES,
  assertAllowedMutation,
  assertAllowedRest,
  GitHubWriteClient,
} from "@/lib/github/write-client";
import { isRetryable, NonRetryableError } from "@/lib/outbox/worker";
import { suggestFieldMap } from "@/lib/sync/field-map";

const PROJECT = "PVT_acme_widgets_roadmap";
const FIELDS = [
  { id: "F_status", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "opt_todo", name: "To do" }] },
  { id: "F_priority", name: "Priority", dataType: "SINGLE_SELECT", options: [{ id: "opt_high", name: "High" }] },
  { id: "F_team", name: "Team", dataType: "SINGLE_SELECT", options: [{ id: "opt_core", name: "Core" }] },
  { id: "F_platform", name: "Platform", dataType: "SINGLE_SELECT", options: [{ id: "opt_desktop", name: "Desktop" }] },
  { id: "F_release", name: "Release", dataType: "ITERATION" },
];

type Gql = { query: string; variables: Record<string, unknown> };
let mutations: Gql[] = [];
let rest: { method: string; path: string; body: unknown }[] = [];
/** Project items the issue already has: [projectId, itemId]. */
let issueItems: [string, string][] = [];
let removeLabelStatus = 200;
/** 2: the item's field values come in two pages (the Priority value is on the second). */
let valuePages = 1;
/** The repo the issue node lives in (changes when it is transferred). */
let issueRepo = "acme/widgets";
let fieldPages = 1;

const server = setupServer(
  http.post("https://api.github.com/graphql", async ({ request }) => {
    const body = (await request.json()) as Gql;
    const q = body.query;
    if (q.includes("projectV2(number")) {
      if (fieldPages === 2) {
        // The Priority field sits on the second page of project fields.
        const second = Boolean(body.variables.after);
        const nodes = second ? FIELDS.filter((f) => f.name === "Priority") : FIELDS.filter((f) => f.name !== "Priority");
        return HttpResponse.json({
          data: { organization: { projectV2: { id: PROJECT, fields: { pageInfo: { hasNextPage: !second, endCursor: second ? null : "f1" }, nodes } } } },
        });
      }
      return HttpResponse.json({ data: { organization: { projectV2: { id: PROJECT, fields: { nodes: FIELDS } } } } });
    }
    if (q.includes("projectItems(first:100")) {
      return HttpResponse.json({
        data: { node: { projectItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: issueItems.map(([p, id]) => ({ id, project: { id: p } })) } } },
      });
    }
    if (q.includes("... on Issue { number repository")) {
      return HttpResponse.json({ data: { node: { number: 4242, repository: { nameWithOwner: issueRepo } } } });
    }
    if (q.includes("updateIssueIssueType")) {
      mutations.push(body);
      return HttpResponse.json({ data: { updateIssueIssueType: { issue: { id: "I_1" } } } });
    }
    if (q.includes("issueType { id }")) return HttpResponse.json({ data: { node: { issueType: { id: "IT_bug" } } } });
    if (q.includes("addProjectV2ItemById")) {
      mutations.push(body);
      return HttpResponse.json({ data: { addProjectV2ItemById: { item: { id: "PVTI_new" } } } });
    }
    if (q.includes("updateProjectV2ItemFieldValue") || q.includes("clearProjectV2ItemFieldValue")) {
      mutations.push(body);
      return HttpResponse.json({ data: { x: { clientMutationId: null } } });
    }
    if (q.includes("fieldValues(first:50")) {
      const page = body.variables.after ? 2 : 1;
      if (valuePages === 2 && page === 1) {
        // The Priority value sits on the second page.
        return HttpResponse.json({ data: { node: { fieldValues: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ optionId: "opt_todo", field: { id: "F_status", name: "Status" } }] } } } });
      }
      return HttpResponse.json({
        data: { node: { fieldValues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ optionId: "opt_high", field: { id: "F_priority", name: "Priority" } }, { iterationId: "it_1", field: { id: "F_release", name: "Release" } }] } } },
      });
    }
    return HttpResponse.json({ errors: [{ message: `unexpected query: ${q.slice(0, 60)}` }] }, { status: 400 });
  }),
  http.all("https://api.github.com/repos/:owner/:repo/issues/:n/*", async ({ request, params }) => {
    const path = new URL(request.url).pathname;
    const body = request.method === "DELETE" ? null : await request.json().catch(() => null);
    rest.push({ method: request.method, path, body });
    if (request.method === "DELETE" && path.includes("/labels/") && removeLabelStatus === 404) {
      return HttpResponse.json({ message: "Label does not exist" }, { status: 404 });
    }
    return HttpResponse.json(path.includes("/labels") ? [] : { number: Number(params.n) });
  }),
  http.patch("https://api.github.com/repos/:owner/:repo/issues/:n", async ({ request }) => {
    rest.push({ method: "PATCH", path: new URL(request.url).pathname, body: await request.json() });
    return HttpResponse.json({ number: 4242 });
  }),
  http.get("https://api.github.com/repos/:owner/:repo/issues/:n", () => HttpResponse.json({ number: 4242, state: "open", labels: [], assignees: [], milestone: { number: 12 } })),
);

let n = 0;
/** The full gate (SPEC §3.4): the tests exercise the write client, the gate itself is tested apart. */
const GATE = { allowed: true } as const;

/** A fresh client (and token) per test: clients are cached per token. */
const client = () => new GitHubWriteClient(`ghp_write_client_test_token_${++n}_000000000000`, suggestFieldMap(FIELDS, {}), undefined, GATE);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  process.env.GITHUB_REPO = "acme/widgets";
  mutations = [];
  rest = [];
  issueItems = [[PROJECT, "PVTI_existing"]];
  removeLabelStatus = 200;
  valuePages = 1;
  fieldPages = 1;
  issueRepo = "acme/widgets";
});
afterEach(() => {
  server.resetHandlers();
});

describe("GitHubWriteClient", () => {
  it("refuses to exist while the write gate is off (SPEC §3.4)", () => {
    expect(() => new GitHubWriteClient(`ghp_write_client_test_token_${++n}_000000000000`, suggestFieldMap(FIELDS, {}), undefined, { allowed: false })).toThrow(/write gate/);
  });

  it("refuses to write when the project is not the pinned GITHUB_PROJECT_ID (v5 1.2)", async () => {
    process.env.GITHUB_PROJECT_ID = "PVT_some_other_project";
    try {
      await expect(client().applyField("I_1", "status", "opt_todo")).rejects.toThrow(/different project than the pinned one/);
      expect(mutations).toHaveLength(0);
      process.env.GITHUB_PROJECT_ID = PROJECT;
      await client().applyField("I_1", "status", "opt_todo");
      expect(mutations).toHaveLength(1);
    } finally {
      delete process.env.GITHUB_PROJECT_ID;
    }
  });

  it.each([
    ["status", "F_status", "opt_todo", "singleSelectOptionId"],
    ["priority", "F_priority", "opt_high", "singleSelectOptionId"],
    // Dimensions by field ID (§4.1).
    ["dim:F_team", "F_team", "opt_core", "singleSelectOptionId"],
    ["dim:F_platform", "F_platform", "opt_desktop", "singleSelectOptionId"],
    ["release", "F_release", "it_2", "iterationId"],
  ])("sets %s on the existing project item", async (field, fieldId, value, key) => {
    await client().applyField("I_1", field, value);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]!.query).toContain("updateProjectV2ItemFieldValue");
    expect(mutations[0]!.query).toContain(`${key}:$value`);
    // GitHub types both value keys as String; `$value:ID!` was refused on every write.
    expect(mutations[0]!.query).toContain("$value:String!");
    expect(mutations[0]!.variables).toEqual({ project: PROJECT, item: "PVTI_existing", field: fieldId, value });
  });

  it("refuses to write when the project is not the node ID pinned in onboarding (D4)", async () => {
    const pinned = (projectId: string) =>
      new GitHubWriteClient(
        `ghp_write_client_test_token_${++n}_000000000000`,
        suggestFieldMap(FIELDS, {}),
        { repoFull: "acme/widgets", owner: "acme", repo: "widgets", org: "acme", projectNumber: 7, projectId },
        GATE,
      );
    await expect(pinned("PVT_some_other_project").applyField("I_1", "status", "opt_todo")).rejects.toThrow(/different project than the pinned one/);
    expect(mutations).toHaveLength(0);
    await pinned(PROJECT).applyField("I_1", "status", "opt_todo");
    expect(mutations).toHaveLength(1);
  });

  it("refuses a dimension that isn't mapped", async () => {
    await expect(client().applyField("I_1", "dim:F_unmapped", "opt_x")).rejects.toThrow(/not a mapped dimension/);
    await expect(client().applyField("I_1", "team", "opt_core")).rejects.toThrow(/unsupported field/);
    expect(mutations).toHaveLength(0);
  });

  it("reads a value past the first page of the item's field values (v5 2.7)", async () => {
    valuePages = 2;
    await expect(client().readField("I_1", "priority")).resolves.toBe("opt_high");
  });

  it("finds a field past the first page of project fields (v5 2.7)", async () => {
    fieldPages = 2;
    await client().applyField("I_1", "priority", "opt_high");
    expect(mutations).toHaveLength(1);
    expect(mutations[0]!.variables).toMatchObject({ field: "F_priority", value: "opt_high" });
  });

  it("clears a field when the new value is null", async () => {
    await client().applyField("I_1", "priority", null);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]!.query).toContain("clearProjectV2ItemFieldValue");
    expect(mutations[0]!.variables).toEqual({ project: PROJECT, item: "PVTI_existing", field: "F_priority" });
  });

  it("adds the issue to the project first when it has no project item yet", async () => {
    issueItems = [["PVT_other_project", "PVTI_elsewhere"]];
    await client().applyField("I_1", "status", "opt_todo");
    expect(mutations.map((m) => (m.query.includes("addProjectV2ItemById") ? "add" : "update"))).toEqual(["add", "update"]);
    expect(mutations[0]!.variables).toEqual({ project: PROJECT, content: "I_1" });
    expect(mutations[1]!.variables).toMatchObject({ item: "PVTI_new" });
  });

  it("applies label deltas: one removal and one add each, never the full set", async () => {
    await client().applyField("I_1", "labels", { added: ["bug"], removed: ["ui", "old"] });
    expect(rest.map((r) => `${r.method} ${r.path}`)).toEqual([
      "DELETE /repos/acme/widgets/issues/4242/labels/ui",
      "DELETE /repos/acme/widgets/issues/4242/labels/old",
      "POST /repos/acme/widgets/issues/4242/labels",
    ]);
    expect(rest[2]!.body).toEqual({ labels: ["bug"] });
  });

  it("refuses to write when the issue was transferred to another repo (v5 1.1)", async () => {
    issueRepo = "acme/gadgets";
    const c = client();
    await expect(c.applyField("I_1", "labels", { added: ["bug"], removed: [] })).rejects.toThrow(/gadgets/);
    await expect(c.applyField("I_1", "milestone", "12")).rejects.toThrow(/now lives in/);
    await expect(c.closeIssue("I_1")).rejects.toThrow(NonRetryableError);
    await expect(c.readField("I_1", "state")).rejects.toThrow(/nothing was written/);
    expect(rest).toHaveLength(0);
    expect(isRetryable(await c.closeIssue("I_1").catch((e) => e))).toBe(false);
  });

  it("treats a 404 on label removal as done", async () => {
    removeLabelStatus = 404;
    await expect(client().applyField("I_1", "labels", { added: [], removed: ["gone"] })).resolves.toBeUndefined();
  });

  it("applies assignee deltas", async () => {
    await client().applyField("I_1", "assignees", { added: ["bob", "alice"], removed: ["old"] });
    expect(rest.map((r) => `${r.method} ${r.path}`)).toEqual([
      "DELETE /repos/acme/widgets/issues/4242/assignees",
      "POST /repos/acme/widgets/issues/4242/assignees",
    ]);
    expect(rest[1]!.body).toEqual({ assignees: ["bob", "alice"] });
  });

  it("closes with the completed reason and reopens without touching the Status", async () => {
    const c = client();
    await c.closeIssue("I_1");
    await c.reopenIssue("I_1");
    expect(rest.map((r) => r.body)).toEqual([
      { state: "closed", state_reason: "completed" },
      { state: "open" },
    ]);
  });

  it("reads a project field's current value", async () => {
    expect(await client().readField("I_1", "priority")).toBe("opt_high");
    expect(await client().readField("I_1", "release")).toBe("it_1");
  });

  it("sets and clears the issue Type through GraphQL", async () => {
    const c = client();
    await c.applyField("I_1", "type", "IT_feature");
    await c.applyField("I_1", "type", null);
    expect(mutations.map((m) => m.variables)).toEqual([
      { issue: "I_1", type: "IT_feature" },
      { issue: "I_1", type: null },
    ]);
    expect(await c.readField("I_1", "type")).toBe("IT_bug");
  });

  it("sets and clears the milestone through REST, keyed by number", async () => {
    const c = client();
    await c.applyField("I_1", "milestone", "12");
    await c.applyField("I_1", "milestone", null);
    expect(rest.map((r) => r.body)).toEqual([{ milestone: 12 }, { milestone: null }]);
    expect(await c.readField("I_1", "milestone")).toBe("12");
  });

  it("creates an issue and returns the node ID from the response body (W3)", async () => {
    server.use(
      http.post("https://api.github.com/repos/:owner/:repo/issues", async ({ request }) => {
        rest.push({ method: "POST", path: new URL(request.url).pathname, body: await request.json() });
        return HttpResponse.json({ node_id: "I_made", number: 501 }, { status: 201 });
      }),
    );
    const made = await client().createIssue({ title: "New", body: "", labelNames: [], assigneeLogins: [], milestoneNumber: null, typeId: null, fields: [] });
    expect(made).toEqual({ nodeId: "I_made", number: 501 });
    expect(rest).toEqual([{ method: "POST", path: "/repos/acme/widgets/issues", body: { title: "New", body: "" } }]);
  });

  it("finds an issue an unconfirmed create already made, matching title and body (W3)", async () => {
    const since = new Date("2026-11-10T10:00:00Z");
    const seen: URLSearchParams[] = [];
    server.use(
      http.get("https://api.github.com/user", () => HttpResponse.json({ login: "alice" })),
      http.get("https://api.github.com/repos/:owner/:repo/issues", ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json([
          { node_id: "PR_1", number: 7, title: "New", body: "x", created_at: "2026-11-10T10:00:01Z", pull_request: {} },
          { node_id: "I_other", number: 8, title: "New", body: "different", created_at: "2026-11-10T10:00:01Z" },
          { node_id: "I_old", number: 9, title: "New", body: "x", created_at: "2026-11-09T10:00:00Z" },
          { node_id: "I_made", number: 10, title: "New", body: "x", created_at: "2026-11-10T10:00:02Z" },
        ]);
      }),
    );
    const payload = { title: "New", body: "x", labelNames: [], assigneeLogins: [], milestoneNumber: null, typeId: null, fields: [] };
    expect(await client().findCreatedIssue(payload, since)).toEqual({ nodeId: "I_made", number: 10 });
    expect(seen[0]?.get("creator")).toBe("alice");
    expect(await client().findCreatedIssue({ ...payload, title: "Nothing like it" }, since)).toBeNull();
  });

  it("rejects an unknown field", async () => {
    await expect(client().applyField("I_1", "nonsense", "x")).rejects.toThrow(/unsupported field/);
  });
});

describe("the operation allowlist (SPEC §4.8, W0)", () => {
  it("refuses every forbidden mutation and REST operation", () => {
    for (const q of [
      `mutation { deleteIssue(input:{issueId:"I_1"}) { clientMutationId } }`,
      `mutation { deleteProjectV2Item(input:{projectId:"PVT_1", itemId:"PVTI_1"}) { clientMutationId } }`,
      `mutation { transferIssue(input:{issueId:"I_1", repositoryId:"R_1"}) { clientMutationId } }`,
      `mutation { updateProjectV2Field(input:{fieldId:"F_1", name:"x"}) { projectV2Field { id } } }`,
      `mutation { createProjectV2Field(input:{projectId:"PVT_1", name:"x", dataType:SINGLE_SELECT}) { projectV2Field { id } } }`,
      `mutation { deleteProjectV2Field(input:{fieldId:"F_1"}) { projectV2Field { id } } }`,
      `mutation { deleteProjectV2FieldOption(input:{optionId:"o1"}) { clientMutationId } }`,
      `mutation { archiveProjectV2Item(input:{projectId:"PVT_1", itemId:"PVTI_1"}) { item { id } } }`,
    ]) {
      expect(() => assertAllowedMutation(q), q).toThrow(/allowlist/);
    }
    for (const op of ["issues.delete", "issues.removeAllLabels", "repos.delete", "issues.transfer"]) {
      expect(() => assertAllowedRest(op), op).toThrow(/allowlist/);
    }
  });

  it("accepts exactly the §4.8 writes", () => {
    expect(ALLOWED_MUTATIONS).toEqual(["addProjectV2ItemById", "updateProjectV2ItemFieldValue", "clearProjectV2ItemFieldValue", "updateIssueIssueType"]);
    expect(ALLOWED_REST_WRITES).toEqual(["issues.update", "issues.create", "issues.addLabels", "issues.removeLabel", "issues.addAssignees", "issues.removeAssignees"]);
    expect(() => assertAllowedMutation(`mutation($project:ID!, $content:ID!) { addProjectV2ItemById(input:{projectId:$project, contentId:$content}) { item { id } } }`)).not.toThrow();
  });

  it("every mutation and REST write in the client is on the allowlist", () => {
    // The source scan is the second net: a mutation added to the client without
    // an allowlist entry fails this test, before the runtime check would ever see it.
    const src = readFileSync("lib/github/write-client.ts", "utf8");
    const mutations = [...src.matchAll(/`mutation\b[^`]*?\{\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!);
    expect(mutations.length).toBeGreaterThanOrEqual(4);
    for (const m of mutations) expect(ALLOWED_MUTATIONS, m).toContain(m);
    const rest = [...src.matchAll(/this\.restWrite\("([^"]+)"/g)].map((m) => m[1]!);
    expect(rest.length).toBeGreaterThanOrEqual(5);
    for (const op of rest) expect(ALLOWED_REST_WRITES, op).toContain(op);
    // No delete anywhere, in any form.
    expect(src).not.toMatch(/mutation\b[^{]*\{\s*(?:delete|remove)/i);
    expect(src).not.toMatch(/\.delete\(|\.delete[A-Z]/);
  });
});
