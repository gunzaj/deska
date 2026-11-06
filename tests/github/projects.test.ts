// Onboarding step 2 discovery (D4): the org's projects and one project's
// fields, read with the read-only client. A refusal says why; it is never an
// empty list (§3.3).
import { describe, expect, it } from "vitest";
import { altFields } from "@/lib/demo/fixtures-alt";
import { checkRepo, fetchProjectDetail, listOrgProjects } from "@/lib/github/projects";
import { createReadOnlyClient, type ProbeResponse, type ReadOnlyClient } from "@/lib/github/probe";

const ok = (data: unknown): ProbeResponse => ({ status: 200, headers: {}, data: { data } });

function fake(answer: (query: string, vars: Record<string, unknown>) => ProbeResponse): ReadOnlyClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    rest: async () => ({ status: 200, headers: {}, data: { full_name: "acme/widgets" } }),
    graphql: async (q, v = {}) => {
      queries.push(q);
      return answer(q, v);
    },
  };
}

describe("project discovery", () => {
  it("lists the org's projects across pages, open ones first", async () => {
    const client = fake((_q, v) =>
      ok({
        organization: {
          projectsV2: v.after
            ? { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "PVT_acme_widgets_roadmap", number: 7, title: "Widgets Roadmap", closed: false }] }
            : { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ id: "PVT_other_project", number: 2, title: "Archive", closed: true }, { id: "PVT_acme_ops_board", number: 3, title: "Ops Board", closed: false }] },
        },
      }),
    );
    const projects = await listOrgProjects(client, "acme");
    expect(projects.map((p) => `${p.title}#${p.number}`)).toEqual(["Ops Board#3", "Widgets Roadmap#7", "Archive#2"]);
    expect(client.queries).toHaveLength(2);
  });

  it("reads a project's fields with options and iterations", async () => {
    const fields = altFields({ now: new Date("2026-10-16T00:00:00Z") });
    const nodes = fields.map((f) => ({ id: f.id, name: f.name, dataType: f.dataType, ...(f.options ? { options: f.options } : {}), ...(f.iterations ? { configuration: { iterations: f.iterations.slice(0, 1), completedIterations: f.iterations.slice(1) } } : {}) }));
    const client = fake(() => ok({ organization: { projectV2: { id: "PVT_acme_ops_board", number: 3, title: "Ops Board", fields: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [...nodes, {}] } } } }));
    const p = await fetchProjectDetail(client, "acme", 3);
    expect(p).toMatchObject({ id: "PVT_acme_ops_board", title: "Ops Board" });
    expect(p.fields.map((f) => f.name)).toEqual(["Stage", "Urgency", "Squad", "Surface", "Estimate", "Cycle"]);
    expect(p.fields.find((f) => f.name === "Cycle")?.iterations).toHaveLength(2);
    expect(p.fields.find((f) => f.name === "Urgency")?.options?.map((o) => o.name)).toEqual(["P0", "P1", "P2"]);
  });

  it("a token without Projects read gets the permission named, not an empty list", async () => {
    const client = fake(() => ({ status: 200, headers: {}, data: { data: { organization: null }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }] } }));
    await expect(listOrgProjects(client, "acme")).rejects.toThrow("This token is missing a permission: Organization → Projects: Read");
    await expect(fetchProjectDetail(client, "acme", 3)).rejects.toThrow("Organization → Projects: Read");
  });

  it("an unknown project or repository says so; 401 and rate limits have their own words", async () => {
    await expect(fetchProjectDetail(fake(() => ok({ organization: { projectV2: null } })), "acme", 99)).rejects.toThrow(`Project 99 in "acme" not found`);
    const repo404: ReadOnlyClient = { rest: async () => ({ status: 404, headers: {}, data: { message: "Not Found" } }), graphql: async () => ok({}) };
    await expect(checkRepo(repo404, "acme/nope")).rejects.toThrow("Repository acme/nope not found");
    await expect(listOrgProjects(fake(() => ({ status: 401, headers: {}, data: { message: "Bad credentials" } })), "acme")).rejects.toThrow("Your GitHub token is invalid or expired");
    await expect(listOrgProjects(fake(() => ({ status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000000" }, data: {} })), "acme")).rejects.toThrow(/^Rate limited until/);
  });

  it("only sends queries: the real read-only client refuses anything else before a request", async () => {
    let calls = 0;
    const client = createReadOnlyClient("t", (async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: { organization: { projectsV2: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }));
    }) as typeof fetch);
    await expect(listOrgProjects(client, "acme")).resolves.toEqual([]);
    await expect(client.graphql("mutation { deleteProjectV2Item(input: {}) { clientMutationId } }")).rejects.toThrow(/refuses GraphQL mutations/);
    expect(calls).toBe(1);
  });
});
