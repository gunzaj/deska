// v5 1.5: every GitHub call has a deadline, well under the outbox lease.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { gqlClient, requestTimeoutMs, restClient } from "@/lib/github/client";
import { isRetryable } from "@/lib/outbox/worker";

const server = setupServer(
  http.get("https://api.github.com/repos/o/r/issues/1", async () => {
    await delay(2_000);
    return HttpResponse.json({ number: 1 });
  }),
  http.post("https://api.github.com/graphql", async () => {
    await delay(2_000);
    return HttpResponse.json({ data: {} });
  }),
);

beforeAll(() => {
  process.env.GITHUB_REQUEST_TIMEOUT_MS = "100";
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => server.resetHandlers());
afterAll(() => {
  delete process.env.GITHUB_REQUEST_TIMEOUT_MS;
  server.close();
});

describe("request timeout", () => {
  it("defaults to 30 s, under the 120 s lease", () => {
    delete process.env.GITHUB_REQUEST_TIMEOUT_MS;
    expect(requestTimeoutMs()).toBe(30_000);
    process.env.GITHUB_REQUEST_TIMEOUT_MS = "100";
    expect(requestTimeoutMs()).toBe(100);
  });

  it("aborts a slow REST call, and the failure is retryable", async () => {
    const started = Date.now();
    const err = await restClient("ghp_timeout_rest_token_000000000000").issues.get({ owner: "o", repo: "r", issue_number: 1 }).catch((e) => e);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(err).toBeInstanceOf(Error);
    expect(isRetryable(err)).toBe(true);
  });

  it("aborts a slow GraphQL call", async () => {
    const started = Date.now();
    await expect(gqlClient("ghp_timeout_gql_token_0000000000000")("query { viewer { login } }")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
