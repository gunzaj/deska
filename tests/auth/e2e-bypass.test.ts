import { afterEach, describe, expect, it } from "vitest";
import { e2eBypassActive } from "@/lib/e2e-bypass";

// NODE_ENV is readonly on the typed process.env, but the runtime allows it.
function setNodeEnv(value: string) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

describe("E2E auth bypass is never active in production", () => {
  afterEach(() => {
    delete process.env.E2E_AUTH_BYPASS;
    delete process.env.E2E_BYPASS_ACK;
    setNodeEnv("test");
  });

  it("requires both the flag and the acknowledgement", () => {
    setNodeEnv("test");
    process.env.E2E_AUTH_BYPASS = "1";
    expect(e2eBypassActive()).toBe(false);
    process.env.E2E_BYPASS_ACK = "i-understand";
    expect(e2eBypassActive()).toBe(true);
  });

  it("is disabled outright when NODE_ENV=production", () => {
    // Regression: the bypass granted access as whoever the x-e2e-login header
    // named, so a stray env var in production would have opened the app.
    setNodeEnv("production");
    process.env.E2E_AUTH_BYPASS = "1";
    process.env.E2E_BYPASS_ACK = "i-understand";
    expect(e2eBypassActive()).toBe(false);
  });
});
