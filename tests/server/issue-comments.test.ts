// Item 6: a triage suggestion needs the live comments, not the issue body.
// The cached body is already in the read model, so reading it again from GitHub
// was a needless live request per issue.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchIssueComments } from "@/lib/server/issue-detail";

const TOKEN = ["github", "pat", "TEST", "COMMENTS", "0".repeat(24)].join("_");
const requests: string[] = [];

beforeEach(() => {
  process.env.DESKA_GITHUB_API_URL = "http://127.0.0.1:9";
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(JSON.stringify([{ id: 1, user: { login: "alice" }, created_at: "2026-01-01T00:00:00Z", body: "hi", body_html: "<p>hi</p>", html_url: "https://github.com/acme/widgets/issues/901#issuecomment-1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DESKA_GITHUB_API_URL;
});

describe("fetchIssueComments", () => {
  it("reads only the comment thread, never the issue body", async () => {
    const out = await fetchIssueComments(901, TOKEN, "acme/widgets");
    expect(out).toMatchObject({ error: null });
    expect(out.comments).toHaveLength(1);
    expect(out.comments[0]).toMatchObject({ author: "alice", body: "hi", bodyHtml: "<p>hi</p>" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/repos/acme/widgets/issues/901/comments");
  });

  it("reuses the thread for a minute instead of reading it again", async () => {
    await fetchIssueComments(902, TOKEN, "acme/widgets");
    await fetchIssueComments(902, TOKEN, "acme/widgets");
    expect(requests).toHaveLength(1);
  });

  it("reports a failed thread without failing the caller", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500, headers: { "content-type": "application/json" } })));
    const out = await fetchIssueComments(903, TOKEN, "acme/widgets");
    expect(out.comments).toEqual([]);
    expect(out.error).toBeTruthy();
  });
});
